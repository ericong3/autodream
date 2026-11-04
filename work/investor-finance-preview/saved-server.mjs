// Local SAMPLE server. Never deploy: role picker is intentionally not real auth.
// It uses a disposable local PostgreSQL database, never Supabase credentials.
import http from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {pathToFileURL,fileURLToPath} from 'node:url';import {resolve} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2],'dist/index.js')));
const root=new URL('./',import.meta.url),sampleDir=new URL('./sample-data/',root),pointer=new URL('current.json',sampleDir);
await mkdir(sampleDir,{recursive:true});let db;let potId;const version=2;
const migrationFiles=['20261104000000_investor_capital_foundation.sql','20261104010000_investor_car_expenses.sql'];
const schemaHash=createHash('sha256');for(const f of migrationFiles)schemaHash.update(await readFile(new URL('../../supabase/migrations/'+f,root)));const schemaVersion=schemaHash.digest('hex');
async function command(actor,action,data,requestId){return (await db.query('select uc_investor_capital($1,$2,$3) r',[actor,action,{...data,...(requestId?{requestId}:{})}])).rows[0].r;}
async function openSample(reset=false,resetRequestId=null){
 let info={};try{info=JSON.parse(await readFile(pointer,'utf8'));}catch{}
 if(reset&&resetRequestId&&info.resetRequestId===resetRequestId&&info.schemaVersion===schemaVersion)return;
 if(db)await db.close();let folder=!reset&&info.version===version&&info.schemaVersion===schemaVersion?info.folder:null;
 if(!folder||!/^sample-[a-f0-9-]+$/.test(folder))folder='sample-'+randomUUID();
 db=new PGlite(fileURLToPath(new URL(folder+'/',sampleDir)));await db.waitReady;
 if(!(await db.query("select to_regclass('public.uc_investor_cars') t")).rows[0].t){
  await db.exec('begin');try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table garage_building_staff(id text primary key,enabled boolean,registration_status text,role text,business_access text);
   insert into garage_building_staff values('sample-director',true,'active','director','both'),('sample-admin',true,'active','admin','used_car'),('sample-investor',true,'active','investor','used_car');
   create table cars(id text primary key,make text,model text,year integer,car_plate text,photo text,status text,investor_id text,investor_split numeric,trade_in_source_car_id text,purchase_price numeric,consignment jsonb,outgoing_consignment jsonb);
   insert into cars(id,make,model,year,car_plate,photo,status,investor_id,purchase_price,consignment,outgoing_consignment) values('sample-vios','Toyota','Vios',2022,'DEMO 001','./sample-car.jpg','available',null,50000,null,null);
   create table sample_receipt_names(bill_id uuid primary key,name text not null);
   create table sample_matches(entry_id uuid primary key);`);
  for(const file of migrationFiles)await db.exec(await readFile(new URL('../../supabase/migrations/'+file,root),'utf8'));
  const p=await command('sample-director','create_profile',{name:'Investor A'},'sample_create_profile_001');potId=p.potId;
  await command('sample-director','link_account',{potId,staffId:'sample-investor'},'sample_link_account_001');
  const today=await localDay();await command('sample-director','capital_received',{potId,amountCents:50000000,paidOn:today,bankAccount:'Sample bank',bankReference:'opening-capital'},'sample_opening_capital_001');
  await command('sample-director','fund_car',{potId,carId:'sample-vios',purchaseCents:5000000},'sample_fund_vios_001');
  await command('sample-admin','add_car_bill',{carId:'sample-vios',category:'repair',purpose:'Front suspension repair',payee:'Sample workshop',amountCents:350000},'sample_repair_bill_001');
  await db.exec('commit');
  }catch(error){await db.exec('rollback');throw error;}
 }
 potId=(await db.query('select id from uc_investor_pots order by created_at limit 1')).rows[0].id;
 await writeFile(pointer,JSON.stringify({folder,version,schemaVersion,resetRequestId:resetRequestId??info.resetRequestId??null}));
}
const actors={Director:'sample-director',Admin:'sample-admin',Investor:'sample-investor'};
const localDay=async()=>(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
async function stateFor(role){
 if(!Object.hasOwn(actors,role))throw Error('Choose a sample role.');const actor=actors[role];
 const detail=await command(actor,'car_snapshot',{carId:'sample-vios'});
 const snapshot=role==='Admin'?{position:{cashCents:0,reservedCents:0,availableCents:0,investedCents:0},entries:[],withdrawals:[]}:await command(actor,'snapshot',role==='Investor'?{}:{potId});
 const names=(await db.query('select * from sample_receipt_names')).rows;
 const profits=role==='Director'?(await db.query('select coalesce(sum(amount_cents),0) a from uc_company_investor_profit')).rows[0].a:0;
 const events=role==='Admin'?[]:(await db.query(`select a.id,a.action,a.created_at,e.amount_cents,s.role from uc_investor_audit a join garage_building_staff s on s.id=a.actor_id
  left join uc_investor_cash_entries e on e.id::text=a.detail->>'entryId' where a.pot_id=$1 order by a.sequence desc limit 30`,[potId])).rows;
 const labels={create_profile:'Investor account created',link_account:'Investor login linked',capital_received:'Capital received',fund_car:'Car purchase approved',purchase_paid:'Car purchase paid',add_car_bill:'Car bill added',approve_car_bill:'Car bill approved',pay_car_bill:'Car bill paid',agree_sale:'Sale price agreed',sale_received:'Sale money received',settle_car:'Profit sharing confirmed',request_withdrawal:'Withdrawal requested',approve_withdrawal:'Withdrawal approved',withdrawal_paid:'Withdrawal paid',cancel_withdrawal:'Withdrawal cancelled'};
 return {role,cash:Number(snapshot.position.cashCents),company:role==='Director'?10000000+Number(profits):0,position:snapshot.position,
  purchase:Number(detail.purchaseCents||0),bought:typeof detail.purchaseCents==='number'&&detail.purchasePaidCents===detail.purchaseCents,proceeds:detail.saleCents??7000000,
  collected:typeof detail.saleCents==='number'&&detail.receivedCents===detail.saleCents,settled:!!detail.settledAt,share:(detail.investorBasisPoints??4000)/100,
  car:detail,bills:detail.bills.filter(b=>b.state!=='voided').map(b=>({id:b.id,purpose:b.purpose,payee:b.payee,amount:Number(b.amountCents),approved:b.state==='approved',paid:Number(b.paidCents),proof:names.find(n=>n.bill_id===b.id)?.name||''})),
  withdrawals:snapshot.withdrawals.map(w=>({id:w.id,amount:Number(w.amountCents),status:w.state})),
  events:events.map(e=>({id:e.id,label:labels[e.action]||e.action,amount:Number(e.amount_cents||0),time:new Date(e.created_at).toLocaleString('en-MY')+' · '+e.role})),
  matches:(await db.query('select entry_id from sample_matches')).rows.map(r=>r.entry_id),statement:snapshot.entries.filter(e=>!['company_profit'].includes(e.kind)).map(e=>({id:e.id,label:({capital_in:'Capital received',car_purchase:'Car purchase',car_expense:'Car expense',car_sale:'Car sale',withdrawal_out:'Withdrawal'})[e.kind]||e.kind,amount:Number(e.amountCents)})),serial:0};
}
async function execute(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Check the sample request.');
 const {role,action,payload={},requestId}=input;
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Check the sample details.');
 if(!Object.hasOwn(actors,role)||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))throw Error('Invalid sample request.');
 const actor=actors[role],carId='sample-vios';
 const prior=(await db.query('select payload from uc_investor_commands where actor_id=$1 and request_id=$2',[actor,requestId])).rows[0];
 const bank={bankAccount:'Sample bank',bankReference:'sample-'+requestId,paidOn:prior?.payload?.data?.paidOn??await localDay()};
 const amount=()=>{const n=Number(payload.amount);if(!Number.isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('Enter a valid amount.');return Math.round(n*100);};
 if(action==='reset'){await openSample(true,requestId);return stateFor(role);}
 if(action==='match'){if(role!=='Director')throw Error('Director access required.');await db.query('insert into sample_matches(entry_id) select id from uc_investor_cash_entries where id=$1 and kind<>$2 on conflict do nothing',[payload.id,'company_profit']);return stateFor(role);}
 if(action==='proof'){
  if(!['Director','Admin'].includes(role)||typeof payload.name!=='string'||payload.name.length>255)throw Error('Choose a sample receipt name.');
  const car=await command(actor,'car_snapshot',{carId});if(!car.bills.some(b=>b.id===payload.id&&b.paidCents>0))throw Error('Record the payment first.');
  await db.query('insert into sample_receipt_names values($1,$2) on conflict(bill_id) do update set name=excluded.name',[payload.id,payload.name]);return stateFor(role);
 }
 let rpc,data;
 switch(action){
  case 'purchase':rpc='purchase_paid';data={carId,...bank};break;
  case 'bill':rpc='add_car_bill';data={carId,category:'misc',purpose:payload.purpose,payee:payload.payee,amountCents:amount()};break;
  case 'approve':rpc='approve_car_bill';data={carId,billId:payload.id};break;
  case 'pay':rpc='pay_car_bill';data={carId,billId:payload.id,amountCents:amount(),...bank};break;
  case 'collect':{
   const car=await command(actor,'car_snapshot',{carId});
   if(car.saleCents===null)await command(actor,'agree_sale',{carId,amountCents:7000000},createHash('sha256').update(requestId+'_sale').digest('hex'));
   rpc='sale_received';data={carId,amountCents:7000000,...bank};break;
  }
  case 'settle':rpc='settle_car';data={carId,confirmCosts:true};break;
  case 'withdraw':rpc='request_withdrawal';data={potId,amountCents:amount()};break;
  case 'approveWithdrawal':rpc='approve_withdrawal';data={potId,withdrawalId:payload.id};break;
  case 'payWithdrawal':rpc='withdrawal_paid';data={potId,withdrawalId:payload.id,...bank};break;
  default:throw Error('Choose a valid sample action.');
 }
 await command(actor,rpc,data,requestId);return stateFor(role);
}
await openSample();let queue=Promise.resolve();
const files=new Set(['index.html','style.css','app.mjs','model.mjs','gateway.mjs','sample-car.jpg']);
http.createServer((req,res)=>{
 const host=req.headers.host;if(!['127.0.0.1:5204','localhost:5204'].includes(host)){res.writeHead(403);return res.end();}
 queue=queue.catch(()=>{}).then(async()=>{
  const url=new URL(req.url,'http://'+host);res.setHeader('Cache-Control','no-store');
  try{
   if(url.pathname==='/sample/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(await stateFor(url.searchParams.get('role'))));}
   if(url.pathname==='/sample/action'&&req.method==='POST'){
    if(req.headers.origin!=='http://'+host)throw Error('Open the local sample page first.');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Sample request too large.');}
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(await execute(JSON.parse(body))));
   }
   const name=url.pathname.slice(1)||'index.html';if(!files.has(name)){res.writeHead(404);return res.end();}
   res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.jpg')?'image/jpeg':'text/javascript');res.end(await readFile(new URL(name,root)));
  }catch(error){res.setHeader('Content-Type','application/json');const raw=error.message||'';const messages={INSUFFICIENT_FUNDS:'There is not enough money available.',NOT_ALLOWED:'This sample role cannot do that.',INVESTOR_REQUEST_REQUIRED:'Switch to Investor to request their withdrawal.',SETTLEMENT_NOT_READY:'Receive all sale money and check the bills first.',CAR_SETTLED_ADJUSTMENT_REQUIRED:'Profit is already confirmed. A correction needs review.',APPROVAL_REQUIRED:'The Director must approve this first.',REQUEST_CHANGED:'Retry the same save before changing it.',CAR_BILLS_REVIEW_REQUIRED:'Check the waiting car bills before approving or paying a withdrawal.',PAYMENT_EXCEEDS_BALANCE:'The payment is more than the amount still owing.',PAYMENT_BEFORE_APPROVAL:'The payment date cannot be before approval.',SALE_PRICE_REQUIRED:'Agree the sale price first.',SALE_AGREEMENT_LOCKED:'The sale price is already agreed, or the car is not yet paid.',PURCHASE_PRICE_CHANGED:'The car purchase price has changed. Check it again.',PURCHASE_ALREADY_PAID:'The car payment is already saved.',ALREADY_REVIEWED:'This request has already been checked.',INVALID:'Check the details and try again.',FUTURE_PAYMENT:'Choose the date the payment was made.'};const known=Object.hasOwn(messages,raw)||['P0001','23505','23514','22007','22008','22P02','22003'].includes(error.code)||/^(Choose|Check|Enter|Invalid sample|Director access|Record the payment|Open the local|Sample request too)/.test(raw);res.statusCode=known?400:500;res.end(JSON.stringify({message:messages[raw]||(/constraint|relation|syntax|column|^[A-Z_]+$/.test(raw)?'The sample record could not be saved.':raw)}));}
 });
}).listen(5204,'127.0.0.1',()=>console.log('Saved SAMPLE preview http://127.0.0.1:5204 — local database only'));
