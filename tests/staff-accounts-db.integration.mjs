// Run with: node tests/staff-accounts-db.integration.mjs <temporary pglite package directory>
// This uses a fresh in-memory Postgres, never an application database or real staff.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import bcrypt from 'bcryptjs';
import {createHash} from 'node:crypto';
import {handleAccounts} from '../server/accounts/core.mjs';
const root=process.argv[2];if(!root)throw new Error('Supply a temporary PGlite package directory.');
const {PGlite}=await import(pathToFileURL(resolve(root,'dist/index.js')));
const {pgcrypto}=await import(pathToFileURL(resolve(root,'dist/contrib/pgcrypto.js')));
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;
create table users(id text primary key,name text not null,username text unique not null,password text not null,role text not null,business_access text,phone text,monthly_target integer,cars_in_month integer);`);
for(const file of ['20261020000000_garage_building_projects.sql','20261020010000_garage_building_online_sessions.sql','20261020020000_garage_building_activation.sql','20261021000000_garage_login_roles.sql','20261021010000_autodream_staff_invitations.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
const hash=bcrypt.hashSync('test-password-only',4);
await db.query("insert into users(id,name,username,password,role,business_access)values('d1','Director','director',$1,'director','both'),('s1','Shareholder','shareholder',$1,'shareholder','both')",[hash]);
await db.query("insert into garage_building_staff(id,name,username,password,role,business_access)select id,name,username,password,role,business_access from users");
const action=async(a,actor,data)=> (await db.query('select public.autodream_account_action($1,$2,$3::jsonb) result',[a,actor,JSON.stringify(data)])).rows[0].result;
// Exercise the HTTP-to-Postgres boundary, including the real throttle key contract.
const inspectToken='9'.repeat(64),origin='https://app.example';
await action('invite','d1',{id:'http-inspect',tokenHash:createHash('sha256').update(inspectToken).digest('hex'),role:'admin',businessAccess:'used_car'});
const inspectResponse=await handleAccounts({method:'POST',url:'/api/auth/accounts',headers:{origin,'content-type':'application/json','x-garage-building':'1','sec-fetch-site':'same-origin'},body:JSON.stringify({action:'inspect',token:inspectToken}),socketAddress:'203.0.113.4'},{env:{GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-key-not-real-1234567890',GARAGE_SESSION_SECRET:'test-session-secret-not-real-1234567890',GARAGE_ALLOWED_ORIGINS:origin,AUTH_PUBLIC_ORIGIN:origin,AUTH_INVITES_ENABLED:'1'},bcrypt,repo:()=>({
 throttleHit:async(key,limit,windowSeconds)=>{const row=(await db.query('select * from public.garage_building_auth_throttle_hit($1,$2,$3)',[key,limit,windowSeconds])).rows[0];return {allowed:row.allowed,retryAfter:row.retry_after};},
 rpc:async(_fn,args)=>({data:await action(args.p_action,args.p_actor,args.p_data),error:null})
})});
assert.equal(inspectResponse.status,200,inspectResponse.body);
assert.equal(JSON.parse(inspectResponse.body).role,'admin');
let seq=0;
async function invitation(role='admin',businessAccess='used_car'){const id='invite'+(++seq),tokenHash=String(seq).padStart(64,'a');await action('invite','d1',{id,tokenHash,role,businessAccess});return {id,tokenHash};}
const registration=(inv,id,emailTokenHash='b'.repeat(64))=>({tokenHash:inv.tokenHash,emailTokenHash,staffId:id,name:'Example Staff',username:id,email:id+'@example.com',phone:'example',passwordHash:hash});
await assert.rejects(()=>action('invite','s1',{id:'forged',tokenHash:'a'.repeat(64),role:'director',businessAccess:'both'}),/NOT_DIRECTOR/);
const inv=await invitation();
const race=await Promise.allSettled([action('register',null,registration(inv,'n1')),action('register',null,registration(inv,'n2','c'.repeat(64)))]);
assert.equal(race.filter(r=>r.status==='fulfilled').length,1,'one invitation creates exactly one account');
const created=(await db.query("select * from garage_building_staff where id in ('n1','n2')")).rows[0];
assert.equal(created.role,'admin');assert.equal(created.business_access,'used_car');assert.equal(created.registration_status,'pending');
const token=(await db.query('select token_hash from autodream_email_tokens where staff_id=$1',[created.id])).rows[0].token_hash;
await action('verify',null,{tokenHash:token});await assert.rejects(()=>action('verify',null,{tokenHash:token}),/INVALID_LINK/);
assert.equal((await db.query('select registration_status from garage_building_staff where id=$1',[created.id])).rows[0].registration_status,'active');
const inv2=await invitation();await action('revoke','d1',{id:inv2.id});await assert.rejects(()=>action('register',null,registration(inv2,'blocked')),/INVALID_LINK/);
const inv3=await invitation();await db.query("update autodream_staff_invitations set created_at=now()-interval '49 hours',expires_at=now()-interval '1 hour' where id=$1",[inv3.id]);await assert.rejects(()=>action('invite_info',null,{tokenHash:inv3.tokenHash}),/INVALID_LINK/);
await assert.rejects(()=>action('update','d1',{id:'d1',role:'director',businessAccess:'both',enabled:false}),/LAST_DIRECTOR/);
const resetHash='d'.repeat(64);await action('request_email',null,{email:created.email,purpose:'reset',emailTokenHash:resetHash});
await db.query("insert into garage_building_sessions(token_hash,user_id,credential_fingerprint,created_at,last_seen_at,expires_at) values($1,$2,'fffffffffffffffffffffffffffffffffffffffffff',now(),now(),now()+interval '1 hour')",['e'.repeat(64),created.id]);
const before=(await db.query('select session_version from garage_building_staff where id=$1',[created.id])).rows[0].session_version;
await action('reset',null,{tokenHash:resetHash,passwordHash:bcrypt.hashSync('new-test-password',4)});
assert.equal((await db.query('select count(*)::int n from garage_building_sessions where user_id=$1',[created.id])).rows[0].n,0);
assert.equal((await db.query('select session_version from garage_building_staff where id=$1',[created.id])).rows[0].session_version,before+1);
await assert.rejects(()=>action('reset',null,{tokenHash:resetHash,passwordHash:hash}),/INVALID_LINK/);

// Existing director self-enrollment preserves their old trusted login until email verification.
const own=await action('invite','d1',{id:'own',tokenHash:'1'.repeat(64),targetId:'d1'});
await action('register',null,{tokenHash:'1'.repeat(64),emailTokenHash:'2'.repeat(64),name:'Director',username:'director',email:'director@example.com',phone:'private phone',passwordHash:bcrypt.hashSync('fresh-director-password',4)});
const unchanged=(await db.query("select * from garage_building_staff where id='d1'")).rows[0];
assert.equal(unchanged.registration_status,'active');assert.equal(unchanged.password,hash);assert.equal(unchanged.email,null);
await action('verify',null,{tokenHash:'2'.repeat(64)});
assert.equal((await db.query("select email from garage_building_staff where id='d1'")).rows[0].email,'director@example.com');
await db.query("insert into users(id,name,username,password,role,business_access)values('e1','Existing','existing',$1,'garage_salesman','garage')",[hash]);
await db.query("insert into garage_building_staff(id,name,username,password,role,business_access)select id,name,username,password,role,business_access from users where id='e1'");
await action('invite','d1',{id:'older',tokenHash:'3'.repeat(64),targetId:'e1'});
await action('register',null,{tokenHash:'3'.repeat(64),emailTokenHash:'4'.repeat(64),name:'Existing',username:'existing',email:'old@example.com',phone:'private',passwordHash:hash});
await action('invite','d1',{id:'newer',tokenHash:'5'.repeat(64),targetId:'e1'});
await assert.rejects(()=>action('verify',null,{tokenHash:'4'.repeat(64)}),/INVALID_LINK/);
assert.equal(await action('request_email',null,{email:'old@example.com',purpose:'verify',emailTokenHash:'6'.repeat(64)}),null,'resend cannot revive revoked enrollment');
await action('register',null,{tokenHash:'5'.repeat(64),emailTokenHash:'7'.repeat(64),name:'Existing',username:'existing',email:'new@example.com',phone:'private',passwordHash:hash});
await action('request_email',null,{email:'new@example.com',purpose:'verify',emailTokenHash:'8'.repeat(64)});
await assert.rejects(()=>action('verify',null,{tokenHash:'7'.repeat(64)}),/INVALID_LINK/);
await action('verify',null,{tokenHash:'8'.repeat(64)});
assert.equal((await db.query("select email from garage_building_staff where id='e1'")).rows[0].email,'new@example.com');
await db.exec('set role service_role');await assert.rejects(()=>db.query("select autodream_bootstrap_director_invitation('d1')"),/permission denied/);await db.exec('reset role');
await db.exec('set role anon');await assert.rejects(()=>db.query('select * from autodream_email_tokens'),/permission denied/);await assert.rejects(()=>action('list','d1',{}),/permission denied/);await db.exec('reset role');
await db.close();console.log('Local Postgres: migrations, role locks, concurrent invitation redemption, verify/replay, revoke, expiry, last-director, reset/session invalidation and browser denial passed.');
