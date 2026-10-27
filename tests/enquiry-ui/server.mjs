// Local disposable UI harness. All persistence is an in-memory database.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import bcrypt from 'bcryptjs';
import {handleEnquiryBoard} from '../../server/enquiries/board.mjs';
import {handleAppointments} from '../../server/appointments/core.mjs';
import {handleEnquiries} from '../../server/enquiries/core.mjs';
import {handleAppSession,COOKIE_NAME} from '../../server/garageBuilding/core.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2],'dist/index.js')));
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create table users(id text primary key);insert into users values('sample-a');create table garage_building_staff(id text primary key,enabled boolean,registration_status text,role text,business_access text);insert into garage_building_staff values('sample-a',true,'active','garage_salesman','garage');`);
for(const file of ['20260913020000_garage_customers_vehicles.sql','20261023000000_garage_enquiries.sql','20261025000000_garage_enquiry_boards.sql','20260919010000_garage_appointments.sql','20261025010000_garage_private_appointments.sql','20261025020000_garage_appointments_lockdown.sql'])await db.exec(readFileSync(resolve('supabase/migrations',file),'utf8'));
const user={id:'sample-a',username:'sample-a',name:'Sample Salesperson',role:'garage_salesman',business_access:'garage',registration_status:'active',enabled:true,password:bcrypt.hashSync('fictional-test-password',4)};
const testPort=Number(process.env.ENQUIRY_TEST_PORT||5181);
const sessions=new Map(),origin='http://127.0.0.1:'+testPort;
const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),deleteSession:async h=>sessions.delete(h),touchSession:async()=>{},deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{try{return {data:(await db.query('select '+(fn==='garage_appointment_action'?'garage_appointment_action':fn==='garage_enquiry_board_action'?'garage_enquiry_board_action':'garage_enquiry_action')+'($1,$2,$3::jsonb) result',[args.p_actor,args.p_action,JSON.stringify(args.p_data)])).rows[0].result};}catch(error){return {error};}}};
const deps={bcrypt,repo:()=>repo,env:{GARAGE_ENQUIRIES_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service-key-not-real-1234567890',GARAGE_SESSION_SECRET:'test-session-secret-not-real-12345678901234',GARAGE_ALLOWED_ORIGINS:origin}};
const login=await handleAppSession({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json'},body:JSON.stringify({username:user.username,password:'fictional-test-password'})},deps);
const cookie=[].concat(login.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];
await repo.rpc('',{p_actor:user.id,p_action:'create',p_data:{name:'Mei Lin (Sample)',phone:'0100000001',services:['Tint','Coating','PPF']}});
const server=await createServer({configFile:false,optimizeDeps:{entries:['tests/enquiry-ui/index.html']},plugins:[react(),{name:'isolated-api',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.method==='GET'&&req.url.startsWith('/garage/')&&req.headers.accept?.includes('text/html'))req.url='/tests/enquiry-ui/index.html';if(!req.url.startsWith('/api/garage/enquiries')&&!req.url.startsWith('/api/garage/board')&&!req.url.startsWith('/api/garage/appointments'))return next();const chunks=[];for await(const c of req)chunks.push(c);const out=await (req.url.startsWith('/api/garage/appointments')?handleAppointments:req.url.startsWith('/api/garage/board')?handleEnquiryBoard:handleEnquiries)({method:req.method,url:req.url,headers:{...req.headers,cookie,origin,'x-garage-building':'1'},body:Buffer.concat(chunks).toString()||undefined},deps);res.writeHead(out.status,out.headers);res.end(out.body);});}}],resolve:{alias:[{find:/^\.\/garageSession$/,replacement:resolve('tests/enquiry-ui/session.ts')},{find:/^\.\.\/lib\/supabase$/,replacement:resolve('tests/enquiry-ui/supabase.ts')},{find:/^\.\/supabase$/,replacement:resolve('tests/enquiry-ui/supabase.ts')},{find:/^\.\.\/store$/,replacement:resolve('tests/enquiry-ui/store.ts')},{find:/^\.\.\/lib\/garageSession$/,replacement:resolve('tests/enquiry-ui/session.ts')}]},server:{host:'127.0.0.1',port:testPort,strictPort:true}});
await server.listen();console.log('Isolated test ready: '+origin+'/tests/enquiry-ui/index.html');


