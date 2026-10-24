import { createHash } from 'node:crypto';
import { ApiError, authenticate, canUseApp, respond, readJson, onlyKeys, clientIp } from '../garageBuilding/core.mjs';
const sha = s => createHash('sha256').update(s).digest('hex');
const TOKEN=/^[a-f0-9]{64}$/;
const ROLES=['director','shareholder','salesperson','mechanic','admin','investor','banker','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray'];
const GENERIC={message:'If the account is eligible, an email will arrive shortly.'};
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
const email=v=>typeof v==='string'&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const password=v=>typeof v==='string'&&v.length>=6&&Buffer.byteLength(v)<=72;
export function accountConfig(env, origins, {mail=true}={}) {
  let origin;
  try { const u=new URL(env.AUTH_PUBLIC_ORIGIN); if(u.protocol==='https:'&&origins.includes(u.origin)&&u.pathname==='/'&&!u.search&&!u.hash)origin=u.origin; }catch{}
  const user=env.AUTH_GMAIL_USER;const secret=(env.AUTH_GMAIL_APP_PASSWORD||'').replace(/ /g,'');
  if(Object.entries(env).some(([k,v])=>k.startsWith('VITE_')&&v&&secret&&String(v).includes(secret)))throw new ApiError(503,'SETUP','Email configuration must remain server-only.');
  if(env.AUTH_INVITES_ENABLED!=='1'||!origin||(mail&&(!email(user)||secret.length<16))) throw new ApiError(503,'SETUP','Account invitations and recovery are not enabled yet.');
  return {origin,user,password:secret};
}
async function rate(ctx,key,limit,window=900) {
  const r=await ctx.repo.throttleHit('account:'+sha(key),limit,window);
  if(!r.allowed)throw new ApiError(429,'RATE_LIMITED','Too many attempts. Please try again later.');
}
async function action(ctx,name,actor,data,fn='autodream_account_action') {
  const out=await ctx.repo.rpc(fn,{p_action:name,p_actor:actor,p_data:data});
  if(out.error){
    const m=out.error.message||'';
    if(m.includes('NOT_DIRECTOR'))throw new ApiError(403,'FORBIDDEN','Only directors can manage staff access.');
    if(m.includes('LAST_DIRECTOR'))throw new ApiError(409,'INVALID','Keep at least one enabled director.');
    if(out.error.code==='23505')throw new ApiError(409,'INVALID','Those registration details are unavailable. Please check them or ask your director.');
    if(/INVALID_LINK|INVALID_ENROLLMENT/.test(m))throw new ApiError(400,'INVALID','This link is invalid, expired or already used. Ask for a new link.');
    if(m.includes('INVALID_USERNAME_UNAVAILABLE'))throw new ApiError(409,'INVALID','That username is already taken. Choose another.');
    if(m.includes('INVALID'))throw new ApiError(400,'INVALID','Check the account details.');
    if(['42883','42P01','42703'].includes(out.error.code))throw new ApiError(503,'SETUP','Account registration is not configured yet.');
    throw new ApiError(502,'CLOUD','Could not update the account. Please try again.');
  }
  return out.data;
}
export async function sendAccountMail(config,recipient,purpose,token) {
  const {default:nodemailer}=await import('nodemailer');
  const link=`${config.origin}/#/account/${purpose==='verify'?'verify':'reset'}?token=${token}`;
  const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:config.user,pass:config.password},tls:{minVersion:'TLSv1.2'},logger:false,debug:false,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
  try {
    const result=await transport.sendMail({from:{name:'AutoDream',address:config.user},to:recipient.email,subject:purpose==='verify'?'Verify your AutoDream email':'Reset your AutoDream password',text:`${purpose==='verify'?'Confirm your email to activate your AutoDream account.':'Choose a new AutoDream password.'}\n\n${link}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`});
    if(!result.accepted?.length)throw new Error('mail delivery failed');
  }finally{transport.close();}
}

function access(role,businessAccess) {
  return ROLES.includes(role)&&['used_car','garage','both'].includes(businessAccess)&&(!['director','shareholder'].includes(role)||businessAccess==='both')&&(!role.startsWith('garage_')||businessAccess==='garage');
}
export async function handleAccounts(req,deps) {
  return respond(req,deps,['GET','POST'],async(ctx,res)=>{
    const b=req.method==='POST'?readJson(req,8192):null;
    const config=accountConfig(deps.env,ctx.config.origins,{mail:!!b&&['register','forgot','resend'].includes(b.action)});
    const mail=(recipient,purpose,token)=>(deps.sendMail??sendAccountMail)(config,recipient,purpose,token);
    if(req.method==='GET') {
      const {user}=await authenticate(req,ctx,res,canUseApp);
      if(user.role!=='director')throw new ApiError(403,'FORBIDDEN','Only directors can manage staff access.');
      const directory=await action(ctx,'list',user.id,{});
      const existing=await action(ctx,'list',user.id,{},'autodream_existing_staff_action');
      return {status:200,body:{...directory,accounts:[...directory.accounts,...existing.accounts]}};
    }
    if(['invite','connect','revoke','update'].includes(b.action)){
      const {user}=await authenticate(req,ctx,{cookies:[]},canUseApp);
      if(user.role!=='director')throw new ApiError(403,'FORBIDDEN','Only directors can manage staff access.');
      await rate(ctx,'director:'+user.id,30);
      if(b.action==='invite'||b.action==='connect'){
        onlyKeys(b,['action','role','businessAccess','targetId']);
        if(b.action==='connect'?(!text(b.targetId,64)||!access(b.role,b.businessAccess)):(b.targetId?!text(b.targetId,64):!access(b.role,b.businessAccess)))throw new ApiError(400,'INVALID','Choose a valid role and business access.');
        const token=ctx.random(32).toString('hex');
        const result=await action(ctx,b.action==='connect'?'connect':'invite',user.id,{id:ctx.random(16).toString('hex'),tokenHash:sha(token),role:b.role,businessAccess:b.businessAccess,targetId:b.targetId},b.action==='connect'?'autodream_existing_staff_action':'autodream_account_action');
        return {status:201,body:{...result,link:`${config.origin}/#/account/register?token=${token}`}};
      }
      if(b.action==='revoke'){onlyKeys(b,['action','id']);if(!text(b.id,64))throw new ApiError(400,'INVALID','Choose an invitation.');}
      else {onlyKeys(b,['action','id','role','businessAccess','enabled']);if(!text(b.id,64)||!access(b.role,b.businessAccess)||typeof b.enabled!=='boolean')throw new ApiError(400,'INVALID','Choose valid account permissions.');}
      await action(ctx,b.action,user.id,b);return {status:200,body:{ok:true}};
    }
    await rate(ctx,'ip:'+clientIp(req),30);
    if(['inspect','register'].includes(b.action)){
      onlyKeys(b,b.action==='inspect'?['action','token']:['action','token','name','email','username','phone','password']);
      if(!TOKEN.test(b.token??''))throw new ApiError(400,'INVALID','This invitation is invalid or expired.');
      await rate(ctx,'invite:'+sha(b.token),10);
      const info=await action(ctx,'invite_info',null,{tokenHash:sha(b.token)});
      if(b.action==='inspect')return {status:200,body:info};
      if(!text(b.name,100)||!email(b.email)||!text(b.username,100)||!text(b.phone,30)||!password(b.password))throw new ApiError(400,'INVALID','Enter your details and a password of at least 6 characters (at most 72 bytes).');
      const emailToken=ctx.random(32).toString('hex');
      const recipient=await action(ctx,'register',null,{tokenHash:sha(b.token),emailTokenHash:sha(emailToken),staffId:ctx.random(16).toString('hex'),name:b.name.trim(),email:b.email.trim().toLowerCase(),username:b.username.trim(),phone:b.phone.trim(),passwordHash:await ctx.bcrypt.hash(b.password,12)});
      try{await mail(recipient,'verify',emailToken);}catch{throw new ApiError(503,'MAIL','Your registration is saved, but the email could not be sent. Use Resend verification to try again.');}
      return {status:201,body:{message:'Check your email to activate your account.'}};
    }
    if(['forgot','resend'].includes(b.action)){
      onlyKeys(b,['action','email']);if(!email(b.email))return {status:200,body:GENERIC};
      // Identical response for nonexistent, disabled, pending and throttled emails.
      try {
        await rate(ctx,'email:'+b.email.trim().toLowerCase(),3,3600);
        const token=ctx.random(32).toString('hex'),purpose=b.action==='forgot'?'reset':'verify';
        const recipient=await action(ctx,'request_email',null,{email:b.email.trim().toLowerCase(),purpose,emailTokenHash:sha(token)});
        if(recipient){
          const deliver=async()=>{try{await mail(recipient,purpose,token);}catch{deps.log?.('accounts: recovery email delivery failed');}};
          if(deps.defer)deps.defer(deliver);else await deliver();
        }
      }catch{deps.log?.('accounts: recovery request unavailable');}
      return {status:200,body:GENERIC};
    }
    if(['verify','reset'].includes(b.action)){
      onlyKeys(b,b.action==='verify'?['action','token']:['action','token','password']);
      if(!TOKEN.test(b.token??'')||(b.action==='reset'&&!password(b.password)))throw new ApiError(400,'INVALID','Use a valid link and a password of at least 6 characters (at most 72 bytes).');
      await action(ctx,'check_email_token',null,{tokenHash:sha(b.token),purpose:b.action});
      await action(ctx,b.action,null,{tokenHash:sha(b.token),...(b.action==='reset'?{passwordHash:await ctx.bcrypt.hash(b.password,12)}:{})});
      return {status:200,body:{message:b.action==='verify'?'Email verified. You can sign in.':'Password changed. Sign in with your new password.'}};
    }
    throw new ApiError(400,'INVALID','Unknown account action.');
  });
}
