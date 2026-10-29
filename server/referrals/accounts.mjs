import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys,clientIp,parseCookies} from '../garageBuilding/core.mjs';
import {accountConfig} from '../accounts/core.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const token=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const email=v=>typeof v==='string'&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const generic={message:'If the account is eligible, an email will arrive shortly.'};
const cookie='autodream_referral_session';
const profileKeys=['legalName','recipientType','identityNumber','tin','address','phone','brand','branch','bank','bankAccount','bankHolder'];
function readProfile(profile){
 if(!profile||typeof profile!=='object'||Array.isArray(profile))throw new ApiError(400,'INVALID','Complete the salesman profile.');
 onlyKeys(profile,profileKeys);
 if(!['individual','business'].includes(profile.recipientType)||['legalName','phone','brand','branch'].some(k=>typeof profile[k]!=='string'||!profile[k].trim())||Object.values(profile).some(v=>typeof v!=='string'||v.length>500))throw new ApiError(400,'INVALID','Enter the name, phone, dealership brand and branch.');
 return Object.fromEntries(Object.entries(profile).map(([k,v])=>[k,v.trim()]));
}
export function isReferralAccountRequest(req){try{return (typeof req.body==='string'?JSON.parse(req.body):req.body)?.scope==='referral_accounts';}catch{return false;}}
async function rpc(ctx,action,actor,data){
 const r=await ctx.repo.rpc('garage_referral_account',{p_action:action,p_actor:actor,p_data:data});
 if(!r.error)return r.data;
 const m=r.error.message||'';
 if(m.includes('SESSION_REQUIRED'))throw new ApiError(401,'AUTH','Sign in to your referral account.');
 if(m.includes('NOT_ALLOWED'))throw new ApiError(403,'FORBIDDEN','This action is unavailable for your account.');
 if(m.includes('INVALID_LINK'))throw new ApiError(400,'INVALID','This link is invalid, expired or already used.');
 if(m.includes('PROFILE_NOT_READY'))throw new ApiError(409,'INVALID','Complete the profile first. Login accounts also need email verification before approval.');
 if(m.includes('REQUEST_CHANGED'))throw new ApiError(409,'CHANGED','This save reference belongs to different profile details. Check the saved profile before trying again.');
 if(m.includes('REVISION_CONFLICT'))throw new ApiError(409,'CONFLICT','This profile changed on another screen. Reopen it to review the latest details.');
 if(m.includes('ALREADY_REGISTERED')||r.error.code==='23505')throw new ApiError(409,'INVALID','This profile or registration detail is already registered. Ask Garage management to check it.');
 if(m.includes('INVALID')||r.error.code==='22P02')throw new ApiError(400,'INVALID','Check the profile details.');
 if(['42883','42P01','42703'].includes(r.error.code))throw new ApiError(503,'SETUP','External referral accounts are being prepared.');
 throw new ApiError(502,'CLOUD','Could not update the referral account. Try again.');
}
async function rate(ctx,key,limit,seconds=900){if(!(await ctx.repo.throttleHit('referral:'+hash(key),limit,seconds)).allowed)throw new ApiError(429,'RATE_LIMITED','Too many attempts. Please try again later.');}
async function mailVerification(config,address,raw,purpose='verify'){
 const {default:nodemailer}=await import('nodemailer');
 const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:config.user,pass:config.password},tls:{minVersion:'TLSv1.2'},logger:false,debug:false,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
 try{const sent=await transport.sendMail({from:{name:'AutoDream Garage',address:config.user},to:address,subject:purpose==='reset'?'Reset your AutoDream referral password':'Verify your AutoDream referral account',text:`${purpose==='reset'?'Choose a new password for your external referral account:':'Confirm your email for your external referral account:'}\n\n${config.origin}/#/referral-account/${purpose}?token=${raw}\n\nThis link expires in 30 minutes. Garage management approval is also required before sign-in.`});if(!sent.accepted?.length)throw Error('mail rejected');}finally{transport.close();}
}
export async function handleReferralAccounts(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 if(deps.env.GARAGE_REFERRALS_ONLINE!=='1')throw new ApiError(503,'SETUP','External referral accounts are being prepared. Existing Garage sales remain available.');
 const b=readJson(req,12000);if(b.scope!=='referral_accounts')throw new ApiError(400,'INVALID','Unknown request.');
 if(['list','create_profile','update_profile','invite','cancel_invite','approve','disable','enable'].includes(b.action)){
  const {user}=await authenticate(req,ctx,res,canUseApp);
  if(!['director','garage_head'].includes(user.role)||!['garage','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Garage Head or Director access is required.');
  await rate(ctx,'manager:'+user.id,60);
  onlyKeys(b,['scope','action',...(b.action==='create_profile'?['profile','requestId','externalSalesmanId']:b.action==='update_profile'?['id','revision','profile','requestId','remainAccountless']:b.action==='invite'?['externalSalesmanId','profileId']:b.action==='list'?[]:['id'])]);
  if(['create_profile','update_profile'].includes(b.action)){
   if(typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(b.requestId)||b.externalSalesmanId!==undefined&&!/^[a-f0-9-]{36}$/i.test(b.externalSalesmanId))throw new ApiError(400,'INVALID','Choose a valid profile and save reference.');
   if(b.action==='update_profile'&&(!/^[a-f0-9-]{36}$/i.test(b.id??'')||!Number.isInteger(b.revision)||b.revision<1||b.revision>=2147483647))throw new ApiError(400,'INVALID','Reload the profile before editing.');
   if(b.remainAccountless!==undefined&&typeof b.remainAccountless!=='boolean')throw new ApiError(400,'INVALID','Choose the account option again.');
   return {status:b.action==='create_profile'?201:200,body:await rpc(ctx,b.action,user.id,{profile:readProfile(b.profile),requestId:b.requestId,...(b.externalSalesmanId?{externalSalesmanId:b.externalSalesmanId}:{}),...(b.action==='update_profile'?{id:b.id,revision:b.revision,...(b.remainAccountless!==undefined?{remainAccountless:b.remainAccountless}:{})}:{})})};
  }
  if(b.action==='invite'){
   if(b.externalSalesmanId!==undefined&&!/^[a-f0-9-]{36}$/i.test(b.externalSalesmanId))throw new ApiError(400,'INVALID','Choose an existing external profile.');
   if(b.profileId!==undefined&&!/^[a-f0-9-]{36}$/i.test(b.profileId)||b.profileId&&b.externalSalesmanId)throw new ApiError(400,'INVALID','Choose one existing profile.');
   const config=accountConfig(deps.env,ctx.config.origins,{mail:false}),raw=ctx.random(32).toString('hex');
   const result=await rpc(ctx,'invite',user.id,{tokenHash:hash(raw),externalSalesmanId:b.externalSalesmanId,profileId:b.profileId});
   return {status:201,body:{...result,link:`${config.origin}/#/referral-account/register?token=${raw}`}};
  }
  if(b.action!=='list'&&!/^[a-f0-9-]{36}$/i.test(b.id??''))throw new ApiError(400,'INVALID','Choose a profile.');
  return {status:200,body:await rpc(ctx,b.action,user.id,b)};
 }
 await rate(ctx,'ip:'+clientIp(req),30);
 if(['inspect','register','save_profile','verify','reset'].includes(b.action)){
  onlyKeys(b,b.action==='register'?['scope','action','token','email','password','profile']:b.action==='save_profile'?['scope','action','token','profile']:b.action==='reset'?['scope','action','token','password']:['scope','action','token']);
  if(!token(b.token))throw new ApiError(400,'INVALID','This link is invalid or expired.');
  await rate(ctx,'token:'+hash(b.token),10);
  if(b.action==='reset'){
   if(typeof b.password!=='string'||b.password.length<6||Buffer.byteLength(b.password)>72)throw new ApiError(400,'INVALID','Use a password of at least 6 characters and at most 72 bytes.');
   await rpc(ctx,'reset',null,{tokenHash:hash(b.token),passwordHash:await ctx.bcrypt.hash(b.password,12)});
   return {status:200,body:{message:'Password changed. Sign in with your new password.'}};
  }
  if(b.action==='save_profile'){
   const saved=await rpc(ctx,'save_profile',null,{tokenHash:hash(b.token),profile:readProfile(b.profile)});
   return {status:201,body:{...saved,message:'Profile saved without a login. Garage management will review it.'}};
  }
  if(b.action!=='register')return {status:200,body:await rpc(ctx,b.action,null,{tokenHash:hash(b.token)})};
  if(!email(b.email)||typeof b.password!=='string'||b.password.length<6||Buffer.byteLength(b.password)>72||!b.profile||typeof b.profile!=='object'||Array.isArray(b.profile))throw new ApiError(400,'INVALID','Complete your profile and use a password of at least 6 characters.');
  const profile=readProfile(b.profile);
  const config=accountConfig(deps.env,ctx.config.origins),raw=ctx.random(32).toString('hex');
  const saved=await rpc(ctx,'register',null,{tokenHash:hash(b.token),email:b.email.trim().toLowerCase(),passwordHash:await ctx.bcrypt.hash(b.password,12),profile,emailTokenHash:hash(raw)});
  try{await (deps.sendReferralMail??mailVerification)(config,saved.email,raw);}catch{throw new ApiError(503,'MAIL','Your registration is saved. Use Resend verification to send the email again.');}
  return {status:201,body:{message:'Registration saved. Verify your email, then wait for Garage management approval.'}};
 }
 if(['resend','forgot'].includes(b.action)){
  onlyKeys(b,['scope','action','email']);if(!email(b.email))return {status:200,body:generic};
  const config=accountConfig(deps.env,ctx.config.origins);await rate(ctx,'mail:'+b.email.trim().toLowerCase(),3,3600);
  const raw=ctx.random(32).toString('hex'),recipient=await rpc(ctx,b.action,null,{email:b.email.trim().toLowerCase(),emailTokenHash:hash(raw)});
  if(recipient){const send=async()=>{try{await (deps.sendReferralMail??mailVerification)(config,recipient.email,raw,b.action==='forgot'?'reset':'verify');}catch{deps.log?.('referrals: account mail failed');}};if(deps.defer)deps.defer(send);else await send();}
  return {status:200,body:generic};
 }
 if(b.action==='login'){
  onlyKeys(b,['scope','action','email','password']);if(!email(b.email)||typeof b.password!=='string'||b.password.length>100||Buffer.byteLength(b.password)>100)throw new ApiError(400,'INVALID','Enter your email and password.');
  await rate(ctx,'login:'+b.email.trim().toLowerCase(),8);
  const found=await rpc(ctx,'login_lookup',null,{email:b.email.trim().toLowerCase()});
  const matched=await ctx.bcrypt.compare(b.password,found?.passwordHash??'$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
  if(!found||!matched)throw new ApiError(401,'AUTH','Sign-in unavailable. Check your details, email verification and management approval.');
  const raw=ctx.random(32).toString('hex');await rpc(ctx,'new_session',null,{...found,tokenHash:hash(raw)});
  res.cookies.push(`${cookie}=${raw}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`);
  return {status:200,body:{ok:true}};
 }
 if(['session','logout'].includes(b.action)){
  onlyKeys(b,['scope','action']);const raw=parseCookies(req.headers.cookie)[cookie];
  if(b.action==='logout'){if(token(raw))await rpc(ctx,'logout',null,{tokenHash:hash(raw)});res.cookies.push(`${cookie}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);return {status:200,body:{ok:true}};}
  if(!token(raw))throw new ApiError(401,'AUTH','Sign in to your referral account.');
  return {status:200,body:await rpc(ctx,'session',null,{tokenHash:hash(raw)})};
 }
 throw new ApiError(400,'INVALID','Unknown referral account action.');
});}
