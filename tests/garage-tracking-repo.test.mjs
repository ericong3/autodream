import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supabaseRepo} from '../server/garageBuilding/supabaseRepo.mjs';
const user={id:'sample-manager',role:'garage_head',business_access:'garage'};
const config={supabaseUrl:'https://tracking.example.test',serviceKey:'sample-only-service-key'};

test('tracking combines invoice, vehicle, customer, job and glass reads in one query',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async input=>{requests.push(new URL(input));return new Response(JSON.stringify([{id:'sample-order',vehicle:{id:'v'},customer:{id:'c',name:'Sample'},jobs:[],glass:[]}]),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  const rows=await supabaseRepo(config).trackingOrders(user);
  assert.equal(rows.length,1);assert.equal(requests.length,1);
  const select=requests[0].searchParams.get('select');
  for(const projection of ['vehicle:garage_vehicles(*)','customer:garage_customers(id,name)','jobs:garage_installer_jobs(*)','glass:garage_tint_installation_pieces(*)'])assert.ok(select.includes(projection));
  assert.ok(!select.includes('ic_number'));assert.ok(!select.includes('phone'));
 }finally{globalThis.fetch=original;}
});

test('tracking pagination retains every invoice and denies non-manager reads',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async input=>{const url=new URL(input);requests.push(url);const count=requests.length===1?200:1;return new Response(JSON.stringify(Array.from({length:count},(_,i)=>({id:`sample-${requests.length}-${i}`}))),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  const repo=supabaseRepo(config);const rows=await repo.trackingOrders(user);
  assert.equal(rows.length,201);assert.equal(requests.length,2);
  assert.equal(requests[0].searchParams.get('offset'),'0');assert.equal(requests[1].searchParams.get('offset'),'200');
  await assert.rejects(()=>repo.trackingOrders({...user,role:'garage_salesman'}),/NOT_ALLOWED/);
  await assert.rejects(()=>repo.trackingOrders({...user,business_access:'used_car'}),/NOT_ALLOWED/);
  assert.equal(requests.length,2);
 }finally{globalThis.fetch=original;}
});
