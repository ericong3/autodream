// Metadata-only production shape, disposable local database. No live data or URL.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createFinanceRehearsal} from './helpers/finance-rehearsal.mjs';
const contract=JSON.parse(readFileSync(new URL('../docs/finance-release/production-table-shape-20261106.json',import.meta.url),'utf8'));
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const db=await createFinanceRehearsal(process.argv[2]);
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create schema extensions;create schema storage;create table storage.objects(bucket_id text,name text);create sequence garage_invoice_seq');
 // Reproduce a permissive Supabase default, so a missing revoke really fails.
 await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated');
 const tables=Map.groupBy(contract.columns,c=>c.table_name);
 for(const [table,columns] of tables){
  const defs=columns.map(c=>{
   assert.match(c.udt_name,/^_?[a-z0-9_]+$/);
   const type=c.data_type==='ARRAY'?quote(c.udt_name.slice(1))+'[]':quote(c.udt_name);
   return quote(c.column_name)+' '+type+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'');
  });
  await db.exec('create table '+quote(table)+' ('+defs.join(',')+')');
 }
 // Unique keys must exist before foreign keys; table rows remain empty.
 for(const kind of ['p','u','c','f'])for(const c of contract.constraints.filter(c=>c.kind===kind))await db.exec('alter table '+quote(c.table)+' add constraint '+quote(c.name)+' '+c.definition);
 const triggers=JSON.parse(readFileSync(new URL('../docs/finance-release/production-finance-triggers-20261106.json',import.meta.url),'utf8'));
 for(const definition of new Set(triggers.map(t=>t.function_definition)))await db.exec(definition);
 for(const t of triggers)await db.exec(t.trigger_definition);
 const chart=JSON.parse(readFileSync(new URL('../docs/finance-release/production-chart-20261106.json',import.meta.url),'utf8'));
 for(const a of chart)await db.query('insert into ledger_accounts(id,name,type) values($1,$2,$3)',[a.id,a.name,a.type]);
 await db.exec("select set_config('autodream.private_finance_ready','reviewed-20261104',false)");
 const dir=new URL('../supabase/migrations/',import.meta.url);
 const files=readdirSync(dir).filter(n=>/^2026110[456].*\.sql$/.test(n)).sort();
 for(const file of files){
  try{await db.exec(readFileSync(new URL(file,dir),'utf8'));}catch(error){throw new Error(file+': '+error.message,{cause:error});}
 }
 const {rows}=await db.query("select count(*)::integer n from pg_tables where schemaname='public' and tablename like 'uc_%'");
 assert.ok(rows[0].n>30);
 const result=await db.query("select count(*)::integer n from pg_tables t where schemaname='public' and tablename like 'uc_%' and not rowsecurity");
 assert.equal(result.rows[0].n,0,'Every private finance table must enable RLS');
 const exposed=await db.query("select p.oid::regprocedure::text name from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'uc_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))");
 assert.deepEqual(exposed.rows,[],'Private finance functions must not be browser-callable');
 const publicTables=await db.query("select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m') and c.relname like 'uc_%' and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))");
 assert.deepEqual(publicTables.rows,[],'Private finance tables must not grant browser access');
 const disposableHash='$2b$12$'+'a'.repeat(53);
 await db.query("insert into users(id,username,name,password,role,business_access) values('schema-director','schema-director','Disposable Director',$1,'director','both')",[disposableHash]);
 await db.query("insert into garage_building_staff(id,username,name,password,role,business_access) values('schema-director','schema-director','Disposable Director',$1,'director','both')",[disposableHash]);
 const banks=await db.query("select uc_company_bank_money('schema-director','banks','{}') result");
 assert.deepEqual(banks.rows[0].result.banks,[]);
 const profiles=await db.query("select uc_investor_activation('schema-director','list_profiles','{}') result");
 assert.deepEqual(profiles.rows[0].result.profiles,[]);
 await assert.rejects(()=>db.query("select uc_company_bank_money('missing-actor','banks','{}')"),/NOT_ALLOWED/);
 console.log('PASS: '+files.length+' prepared migrations on empty production-shaped tables with existing finance triggers; private tables have RLS and private views/functions reject browser access under permissive defaults. Live data and sessions are not reproduced.');
}finally{await db.close();}
