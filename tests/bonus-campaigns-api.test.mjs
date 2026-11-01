import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example';
function fixture(role='director',access='both'){
 const user={id:'sales-a',username:'staff',name:'Sample',password:bcrypt.hashSync('test-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return {data:{enquiries:[]}};}};
 const deps={env:{USED_CAR_BONUS_CAMPAIGNS_ONLINE:'1',GARAGE_ENQUIRIES_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie,method='POST')=>({method,url:'/api/garage/sales',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'test-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {user,repo,deps,calls,req,login};
}

const draft={title:'Year-end',startMonth:'2026-10',endMonth:'2026-12',minimumUnits:6,amountPerUnit:500,participantIds:['sales-a']};
const id='11111111-1111-4111-8111-111111111111';
test('campaigns use the private session and reject forged actors',async()=>{
 const w=fixture();assert.equal((await handleSales(w.req({scope:'bonus_campaigns',action:'list'}),w.deps)).status,401);const cookie=await w.login();
 assert.equal((await handleSales(w.req({scope:'bonus_campaigns',action:'list',actorId:'other'},cookie),w.deps)).status,400);
 assert.equal((await handleSales(w.req({scope:'bonus_campaigns',action:'list'},cookie),w.deps)).status,200);assert.equal(w.calls[0].fn,'used_car_bonus_campaign');assert.equal(w.calls[0].args.p_actor,'sales-a');
});
test('payroll oversight stays read-only for shareholders; sales/admin/Garage staff cannot read campaign totals',async()=>{
 const w=fixture('shareholder'),cookie=await w.login();assert.equal((await handleSales(w.req({scope:'bonus_campaigns',action:'list'},cookie),w.deps)).status,200);
 assert.equal((await handleSales(w.req({scope:'bonus_campaigns',action:'save',requestId:'sample-save-request-001',campaign:draft},cookie),w.deps)).status,403);
 for(const [role,access] of [['salesperson','used_car'],['admin','used_car'],['garage_head','garage']]){const x=fixture(role,access),c=await x.login();assert.equal((await handleSales(x.req({scope:'bonus_campaigns',action:'list'},c),x.deps)).status,403);}
});
test('disabled rollout does not query new tables or pretend a save succeeded',async()=>{
 const w=fixture(),cookie=await w.login();w.deps.env.USED_CAR_BONUS_CAMPAIGNS_ONLINE='0';let r=await handleSales(w.req({scope:'bonus_campaigns',action:'list'},cookie),w.deps);assert.equal(JSON.parse(r.body).enabled,false);assert.equal(w.calls.length,0);
 r=await handleSales(w.req({scope:'bonus_campaigns',action:'save',requestId:'sample-save-request-001',campaign:draft},cookie),w.deps);assert.equal(r.status,503);assert.equal(w.calls.length,0);
});
test('rules, enrolments and cents are validated before database writes',async()=>{
 const w=fixture(),cookie=await w.login();
 for(const campaign of [{...draft,minimumUnits:5.5},{...draft,amountPerUnit:500.001},{...draft,participantIds:['sales-a','sales-a']},{...draft,startMonth:'2026-13'},{...draft,endMonth:'2026-01'},{...draft,endMonth:'2035-12'},{...draft,participantIds:[]},{...draft,role:'director'}])assert.equal((await handleSales(w.req({scope:'bonus_campaigns',action:'save',requestId:'sample-save-request-001',campaign},cookie),w.deps)).status,400);
 assert.equal(w.calls.length,0);
 assert.equal((await handleSales(w.req({scope:'bonus_campaigns',action:'save',requestId:'sample-save-request-001',campaign:draft},cookie),w.deps)).status,200);assert.deepEqual(w.calls[0].args.p_data.campaign,draft);
});
test('confirmation requires the exact reviewed preview and keeps rule calculation server-side',async()=>{
 const w=fixture(),cookie=await w.login();const base={scope:'bonus_campaigns',action:'confirm_month',id,month:'2026-10',requestId:'sample-confirm-request-001',previewHash:'a'.repeat(32)};
 assert.equal((await handleSales(w.req({...base,pool:999999},cookie),w.deps)).status,400);assert.equal((await handleSales(w.req({...base,previewHash:''},cookie),w.deps)).status,400);assert.equal((await handleSales(w.req(base,cookie),w.deps)).status,200);
 w.repo.rpc=async()=>({error:{message:'PREVIEW_CHANGED'}});const r=await handleSales(w.req(base,cookie),w.deps);assert.equal(r.status,409);assert.equal(JSON.parse(r.body).error.code,'PREVIEW_CHANGED');
});
test('cross-origin requests fail and private database errors are not exposed',async()=>{
 const w=fixture(),cookie=await w.login(),req=w.req({scope:'bonus_campaigns',action:'list'},cookie);req.headers.origin='https://unrelated.example';assert.equal((await handleSales(req,w.deps)).status,403);
 w.repo.rpc=async()=>({error:{message:'Private internal details',code:'XX000'}});const r=await handleSales(w.req({scope:'bonus_campaigns',action:'list'},cookie),w.deps);assert.equal(r.status,503);assert.ok(!r.body.includes('Private internal'));
});
