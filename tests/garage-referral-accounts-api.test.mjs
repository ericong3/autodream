import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example';
function fixture(role='director',access='both'){
 const user={id:'staff',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return {data:{ok:true,profiles:[]}};}};
 const deps={env:{GARAGE_REFERRALS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin,AUTH_INVITES_ENABLED:'1',AUTH_PUBLIC_ORIGIN:origin,AUTH_GMAIL_USER:'mail@example.test',AUTH_GMAIL_APP_PASSWORD:'fictional-mail-secret'},bcrypt,repo:()=>repo,sendReferralMail:async()=>{}};
 const req=(data={},cookie)=>({method:'POST',url:'/api/garage/sales',headers:{origin,'content-type':'application/json','x-garage-building':'1',...(cookie?{cookie}:{})},body:JSON.stringify({scope:'referral_accounts',...data})});
 const login=async()=>{const r=await handleAppSession({...req(),body:JSON.stringify({username:'staff',password:'sample-password'})},deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {user,repo,deps,calls,req,login};
}
test('referral accounts require rollout flag; original sales endpoint stays authenticated',async()=>{
 const f=fixture();delete f.deps.env.GARAGE_REFERRALS_ONLINE;
 assert.equal((await handleSales(f.req({action:'list'}),f.deps)).status,503);assert.equal(f.calls.length,0);
 const req=f.req();req.body=JSON.stringify({action:'status',requestId:'sample-request-00001'});
 assert.equal((await handleSales(req,f.deps)).status,401);
});
test('only Garage Head and Director can access private registration details',async()=>{
 const f=fixture();assert.equal((await handleSales(f.req({action:'list'}),f.deps)).status,401);
 for(const [role,access,expected] of [['director','both',200],['garage_head','garage',200],['shareholder','both',403],['garage_salesman','garage',403],['salesperson','used_car',403],['admin','used_car',403]]){
  const s=fixture(role,access),cookie=await s.login();assert.equal((await handleSales(s.req({action:'list'},cookie),s.deps)).status,expected);
  if(expected===200)assert.equal(s.calls[0].args.p_actor,'staff');else assert.equal(s.calls.length,0);
 }
});
test('manager invitations reject spoofed actors and return only a scoped registration link',async()=>{
 const f=fixture(),cookie=await f.login();
 assert.equal((await handleSales(f.req({action:'invite',actor:'forged'},cookie),f.deps)).status,400);
 const r=await handleSales(f.req({action:'invite'},cookie),f.deps),body=JSON.parse(r.body);
 assert.equal(r.status,201);assert.match(body.link,/^https:\/\/app.example\/#\/referral-account\/register\?token=[a-f0-9]{64}$/);
 assert.notEqual(body.link.split('token=')[1],f.calls[0].args.p_data.tokenHash);assert.equal(f.calls[0].args.p_actor,'staff');
});
test('partner registration hashes credentials; email failure preserves saved registration',async()=>{
 const f=fixture(),password='a-test-password',token='a'.repeat(64),profile={legalName:'Sample Partner',recipientType:'individual',identityNumber:'TEST-ID',tin:'TEST-TIN',address:'Sample address',phone:'0100000000',brand:'Sample',branch:'Sample branch',bank:'Sample bank',bankAccount:'000000',bankHolder:'Sample Partner'};
 const data={action:'register',token,email:'person@example.test',password,profile};
 assert.equal((await handleSales(f.req({...data,role:'director'}),f.deps)).status,400);
 assert.equal((await handleSales(f.req({...data,profile:{...profile,approved:true}}),f.deps)).status,400);
 f.repo.rpc=async(fn,args)=>{f.calls.push({fn,args});return {data:{email:'person@example.test'}};};
 f.deps.sendReferralMail=async()=>{throw Error('private-mail-server-details');};
 const r=await handleSales(f.req(data),f.deps),saved=f.calls.at(-1).args;
 assert.equal(r.status,503);assert.equal(JSON.parse(r.body).error.code,'MAIL');assert.ok(!r.body.includes('private-mail-server-details'));
 assert.notEqual(saved.p_data.passwordHash,password);assert.equal(await bcrypt.compare(password,saved.p_data.passwordHash),true);
 assert.equal(saved.p_actor,null);assert.ok(!r.body.includes(saved.p_data.passwordHash));
});
test('partner sessions cannot supply another profile ID and use a separate HttpOnly cookie',async()=>{
 const f=fixture(),hash=bcrypt.hashSync('partner-password',4),id='00000000-0000-0000-0000-000000000001';
 f.repo.rpc=async(fn,args)=>{f.calls.push({fn,args});return {data:args.p_action==='login_lookup'?{id,passwordHash:hash,version:0}:{ok:true}};};
 const r=await handleSales(f.req({action:'login',email:'partner@example.test',password:'partner-password'}),f.deps);
 assert.equal(r.status,200);assert.ok(!r.body.includes(hash));assert.ok(!r.body.includes('passwordHash'));
 const cookie=[].concat(r.headers['Set-Cookie'])[0];assert.match(cookie,/^autodream_referral_session=[a-f0-9]{64};/);assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.ok(!cookie.startsWith(COOKIE_NAME+'='));
 assert.equal((await handleSales(f.req({action:'session',id:'forged'},cookie),f.deps)).status,400);
 assert.equal((await handleSales(f.req({action:'session'},cookie),f.deps)).status,200);
 assert.equal(f.calls.at(-1).args.p_action,'session');assert.equal(f.calls.at(-1).args.p_actor,null);assert.equal(f.calls.at(-1).args.p_data.id,undefined);
 assert.equal((await handleSales(f.req({action:'list'},cookie),f.deps)).status,401,'a partner session does not authenticate as staff');
});
test('referral requests reject cross-origin calls and do not expose database details',async()=>{
 const f=fixture();for(const change of [r=>r.headers.origin='https://evil.example',r=>delete r.headers['x-garage-building']]){const req=f.req({action:'inspect',token:'a'.repeat(64)});change(req);assert.equal((await handleSales(req,f.deps)).status,403);}
 f.repo.rpc=async()=>({error:{code:'42P01',message:'private database details'}});
 const result=await handleSales(f.req({action:'inspect',token:'a'.repeat(64)}),f.deps);assert.equal(result.status,503);assert.ok(!result.body.includes('private database details'));assert.equal(result.headers['Cache-Control'],'no-store');
});
test('password recovery keeps account existence private and hashes a bounded new password',async()=>{
 const f=fixture();let recipient=null;f.repo.rpc=async(fn,args)=>{f.calls.push({fn,args});return {data:recipient};};
 const unknown=await handleSales(f.req({action:'forgot',email:'person@example.test'}),f.deps);
 recipient={email:'person@example.test'};
 const known=await handleSales(f.req({action:'forgot',email:'person@example.test'}),f.deps);
 assert.equal(known.status,200);assert.equal(known.body,unknown.body);
 const before=f.calls.length;
 assert.equal((await handleSales(f.req({action:'reset',token:'a'.repeat(64),password:'界'.repeat(30)}),f.deps)).status,400);
 assert.equal(f.calls.length,before);
 const reset=await handleSales(f.req({action:'reset',token:'a'.repeat(64),password:'new-test-password'}),f.deps);
 assert.equal(reset.status,200);assert.equal(f.calls.at(-1).args.p_action,'reset');
 assert.equal(await bcrypt.compare('new-test-password',f.calls.at(-1).args.p_data.passwordHash),true);
 assert.ok(!reset.body.includes('passwordHash'));
});
test('staff can save an accountless profile without email infrastructure or login credentials',async()=>{
 const f=fixture('garage_head','garage'),cookie=await f.login();delete f.deps.env.AUTH_INVITES_ENABLED;delete f.deps.env.AUTH_GMAIL_USER;delete f.deps.env.AUTH_GMAIL_APP_PASSWORD;
 const profile={recipientType:'individual',legalName:'Sample dealer salesman',phone:'0100000000',brand:'Sample brand',branch:'Sample branch'};
 const body={action:'create_profile',requestId:'profile-save-test-0001',profile};
 const r=await handleSales(f.req(body,cookie),f.deps);assert.equal(r.status,201);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].args.p_action,'create_profile');assert.equal(f.calls[0].args.p_actor,'staff');assert.equal(f.calls[0].args.p_data.passwordHash,undefined);assert.equal(f.calls[0].args.p_data.emailTokenHash,undefined);
 assert.equal((await handleSales(f.req({...body,password:'not-allowed'},cookie),f.deps)).status,400);
 assert.equal((await handleSales(f.req({...body,profile:{...profile,approvedAt:'forged'}},cookie),f.deps)).status,400);
 const sales=fixture('garage_salesman','garage'),salesCookie=await sales.login();assert.equal((await handleSales(sales.req(body,salesCookie),sales.deps)).status,403);
});
test('one invitation form can save a profile accountless and cannot accept hidden login fields',async()=>{
 const f=fixture();delete f.deps.env.AUTH_INVITES_ENABLED;
 const body={action:'save_profile',token:'a'.repeat(64),profile:{recipientType:'individual',legalName:'Sample',phone:'0100000000',brand:'Sample',branch:'Sample branch'}};
 const saved=await handleSales(f.req(body),f.deps);assert.equal(saved.status,201);assert.match(JSON.parse(saved.body).message,/without a login/);
 assert.equal(f.calls[0].args.p_action,'save_profile');assert.equal(f.calls[0].args.p_actor,null);
 for(const extra of [{password:'not-allowed'},{email:'not-allowed@example.test'},{profileId:'forged'},{approved:true}])assert.equal((await handleSales(f.req({...body,...extra}),f.deps)).status,400);
});
test('creating account access later binds the invitation to the existing permanent profile',async()=>{
 const f=fixture(),cookie=await f.login(),id='00000000-0000-0000-0000-000000000001';
 const r=await handleSales(f.req({action:'invite',profileId:id},cookie),f.deps);assert.equal(r.status,201);assert.equal(f.calls[0].args.p_data.profileId,id);
 assert.equal((await handleSales(f.req({action:'invite',profileId:id,externalSalesmanId:id},cookie),f.deps)).status,400);
 assert.equal((await handleSales(f.req({action:'cancel_invite',id},cookie),f.deps)).status,200);
 assert.equal(f.calls.at(-1).args.p_action,'cancel_invite');assert.equal(f.calls.at(-1).args.p_actor,'staff');
});
test('profile edits retain staff authentication and require a valid revision',async()=>{
 const f=fixture(),cookie=await f.login(),id='00000000-0000-0000-0000-000000000001';
 const profile={recipientType:'individual',legalName:'Sample',phone:'0100000000',brand:'Sample',branch:'Sample branch'};
 const body={action:'update_profile',id,revision:1,requestId:'update-profile-test-0001',profile};
 assert.equal((await handleSales(f.req({...body,revision:2147483647},cookie),f.deps)).status,400);
 assert.equal((await handleSales(f.req({...body,password:'forged'},cookie),f.deps)).status,400);
 assert.equal((await handleSales(f.req(body,cookie),f.deps)).status,200);assert.equal(f.calls[0].args.p_actor,'staff');assert.equal(f.calls[0].args.p_data.id,id);
 f.repo.rpc=async()=>({error:{message:'REVISION_CONFLICT',code:'P0001'}});
 const stale=await handleSales(f.req(body,cookie),f.deps);assert.equal(stale.status,409);assert.equal(JSON.parse(stale.body).error.code,'CONFLICT');
});
