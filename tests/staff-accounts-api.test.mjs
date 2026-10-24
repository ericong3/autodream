import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {handleAccounts,accountConfig} from '../server/accounts/core.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const ORIGIN='https://app.example';
const ENV={GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-key-not-real-1234567890',GARAGE_SESSION_SECRET:'test-session-secret-not-real-1234567890',GARAGE_ALLOWED_ORIGINS:ORIGIN,AUTH_PUBLIC_ORIGIN:ORIGIN,AUTH_INVITES_ENABLED:'1',AUTH_GMAIL_USER:'sender@example.com',AUTH_GMAIL_APP_PASSWORD:'not-a-real-app-password'};
const sha=s=>createHash('sha256').update(s).digest('hex');
function request(body,cookie,method='POST'){return {method,url:'/api/auth/accounts',headers:{origin:ORIGIN,'x-garage-building':'1','content-type':'application/json','sec-fetch-site':'same-origin',...(cookie?{cookie:`${COOKIE_NAME}=${cookie}`}:{})},body:JSON.stringify(body),socketAddress:'203.0.113.4'};}
function world(role='director'){
 const users=new Map([['d1',{id:'d1',username:'director',name:'Director',role,business_access:role==='director'||role==='shareholder'?'both':'garage',enabled:true,password:bcrypt.hashSync('private-password',4)}]]),sessions=new Map(),calls=[],messages=[],limits=new Map();let seed=0;
 const deps={env:ENV,bcrypt,now:()=>Date.parse('2026-10-20T10:00:00Z'),randomBytes:n=>Buffer.alloc(n,++seed),sendMail:async(...args)=>messages.push(args),repo:()=>({findUserByUsername:async n=>[...users.values()].find(u=>u.username===n),findUserById:async id=>users.get(id),createSession:async s=>sessions.set(sha(s.tokenHash),s),findSession:async token=>[...sessions.values()].find(s=>s.tokenHash===token),deleteSession:async token=>{for(const[k,s]of sessions)if(s.tokenHash===token)sessions.delete(k);},deleteExpiredSessions:async()=>{},touchSession:async()=>{},throttleClear:async()=>{},throttleHit:async(key,limit)=>{limits.set(key,(limits.get(key)||0)+1);return {allowed:limits.get(key)<=limit,retryAfter:900};},rpc:async(name,args)=>{calls.push(args);if(args.p_action==='invite_info')return {data:{role:'admin',businessAccess:'used_car'},error:null};if(args.p_action==='invite')return {data:{id:args.p_data.id,role:args.p_data.role,businessAccess:args.p_data.businessAccess},error:null};if(args.p_action==='register')return {data:{name:args.p_data.name,email:args.p_data.email},error:null};return {data:null,error:null};}})};
 return {deps,users,sessions,calls,messages};
}
async function signIn(w){const out=await handleAppSession(request({username:'director',password:'private-password'}),w.deps);assert.equal(out.status,200);return [].concat(out.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0].slice(COOKIE_NAME.length+1);}
test('director creates locked invitation; only hash enters database and raw link is shown once',async()=>{
 const w=world(),cookie=await signIn(w);const out=await handleAccounts(request({action:'invite',role:'admin',businessAccess:'used_car'},cookie),w.deps);
 assert.equal(out.status,201);const body=JSON.parse(out.body),token=new URLSearchParams(body.link.split('?')[1]).get('token');assert.match(token,/^[a-f0-9]{64}$/);assert.equal(w.calls[0].p_actor,'d1');assert.equal(w.calls[0].p_data.tokenHash,sha(token));assert.ok(!JSON.stringify(w.calls).includes(token));
});
test('shareholders and Garage heads cannot create or change access, even with forged actor field',async()=>{
 for(const role of ['shareholder','garage_head']){const w=world(role),cookie=await signIn(w);for(const action of ['invite','update','revoke'])assert.equal((await handleAccounts(request({action,actor:'director',role:'director',businessAccess:'both'},cookie),w.deps)).status,403);assert.equal(w.calls.length,0);}
});
test('registration refuses client-assigned role and never stores plaintext password',async()=>{
 const w=world();const input={action:'register',token:'a'.repeat(64),name:'New Staff',username:'staff',phone:'0123456789',email:'STAFF@example.com',password:'new-private-password'};
 assert.equal((await handleAccounts(request({...input,role:'director'}),w.deps)).status,400);
 assert.equal((await handleAccounts(request(input),w.deps)).status,201);const stored=w.calls.find(c=>c.p_action==='register').p_data;assert.equal(stored.email,'staff@example.com');assert.ok(await bcrypt.compare(input.password,stored.passwordHash));assert.equal(stored.password,undefined);assert.equal(stored.role,undefined);assert.equal(w.messages.length,1);assert.ok(!JSON.stringify(w.calls).includes(input.password));
});
test('forgotten password responses do not reveal missing accounts or rate limits',async()=>{
 const w=world();const first=await handleAccounts(request({action:'forgot',email:'missing@example.com'}),w.deps);for(let i=0;i<5;i++){const out=await handleAccounts(request({action:'forgot',email:'missing@example.com'}),w.deps);assert.equal(out.status,first.status);assert.equal(out.body,first.body);}assert.equal(w.messages.length,0);
});

test('setup and reset accept six-character passwords and reject shorter ones',async()=>{
 for(const password of ['short','short6']){
  const registration=world();
  const registered=await handleAccounts(request({action:'register',token:'a'.repeat(64),name:'Staff',username:'staff',phone:'0123456789',email:'staff@example.com',password}),registration.deps);
  assert.equal(registered.status,password.length===6?201:400);
  const reset=world();
  const changed=await handleAccounts(request({action:'reset',token:'b'.repeat(64),password}),reset.deps);
  assert.equal(changed.status,password.length===6?200:400);
 }
});
test('email is not sent and account operations fail closed without email configuration',async()=>{
 const w=world();w.deps.env={...ENV,AUTH_GMAIL_APP_PASSWORD:''};assert.equal((await handleAccounts(request({action:'register',token:'a'.repeat(64)}),w.deps)).status,503);assert.equal(w.calls.length,0);assert.equal(w.messages.length,0);
 assert.throws(()=>accountConfig({...ENV,VITE_MAIL_SECRET:ENV.AUTH_GMAIL_APP_PASSWORD},[ORIGIN]));
});
test('email scanners cannot activate an account with a GET request',async()=>{const w=world();const out=await handleAccounts(request(undefined,undefined,'GET'),w.deps);assert.equal(out.status,401);assert.equal(w.calls.length,0);});
test('pending staff cannot sign in before email verification',async()=>{const w=world();w.users.get('d1').registration_status='pending';const out=await handleAppSession(request({username:'director',password:'private-password'}),w.deps);assert.equal(out.status,401);assert.equal(w.sessions.size,0);});
test('director controls still work during an email-credential outage',async()=>{
 const w=world(),cookie=await signIn(w);w.deps.env={...ENV,AUTH_GMAIL_APP_PASSWORD:''};
 assert.equal((await handleAccounts(request({action:'update',id:'other',role:'admin',businessAccess:'used_car',enabled:false},cookie),w.deps)).status,200);
 assert.equal(w.calls.at(-1).p_actor,'d1');assert.equal(w.messages.length,0);
});
test('password recovery does not await SMTP for an existing account',async()=>{
 const w=world(),tasks=[];const factory=w.deps.repo;
 w.deps.repo=c=>{const r=factory(c),original=r.rpc;r.rpc=async(...args)=>args[1].p_action==='request_email'?{data:{email:'known@example.com',name:'Known'},error:null}:original(...args);return r;};
 w.deps.defer=job=>tasks.push(job);
 const out=await handleAccounts(request({action:'forgot',email:'known@example.com'}),w.deps);
 assert.equal(out.status,200);assert.equal(w.messages.length,0);assert.equal(tasks.length,1);
 await tasks[0]();assert.equal(w.messages.length,1);
});

test('connecting existing staff requires director confirmation of role and access',async()=>{
 const w=world(),cookie=await signIn(w);
 for(const data of [{action:'connect',targetId:'old-id'},{action:'connect',targetId:'old-id',role:'director',businessAccess:'used_car'},{action:'connect',targetId:'old-id',role:'salesperson',businessAccess:'used_car',password:'forbidden'}])assert.equal((await handleAccounts(request(data,cookie),w.deps)).status,400);
 const out=await handleAccounts(request({action:'connect',targetId:'old-id',role:'salesperson',businessAccess:'used_car'},cookie),w.deps);assert.equal(out.status,201);assert.equal(w.calls.at(-1).p_action,'connect');assert.equal(w.calls.at(-1).p_actor,'d1');assert.equal(w.calls.at(-1).p_data.targetId,'old-id');assert.equal(w.messages.length,0);
 const other=world('shareholder'),otherCookie=await signIn(other);assert.equal((await handleAccounts(request({action:'connect',targetId:'old-id',role:'salesperson',businessAccess:'used_car'},otherCookie),other.deps)).status,403);
});
