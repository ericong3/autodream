import {readFileSync,readdirSync} from 'node:fs';
import {createFinanceRehearsal} from './finance-rehearsal.mjs';
export async function productionFinanceFixture(pglite){
 const db=await createFinanceRehearsal(pglite),read=p=>JSON.parse(readFileSync(new URL('../../docs/finance-release/'+p,import.meta.url),'utf8')),quote=s=>'"'+s.replaceAll('"','""')+'"';
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema extensions;create schema storage;create table storage.objects(bucket_id text,name text);create sequence garage_invoice_seq');
  const shape=read('production-table-shape-20261106.json');
  for(const [table,columns] of Map.groupBy(shape.columns,c=>c.table_name))await db.exec('create table '+quote(table)+'('+columns.map(c=>quote(c.column_name)+' '+(c.data_type==='ARRAY'?quote(c.udt_name.slice(1))+'[]':quote(c.udt_name))+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'')).join(',')+')');
  for(const kind of ['p','u','c','f'])for(const c of shape.constraints.filter(c=>c.kind===kind))await db.exec('alter table '+quote(c.table)+' add constraint '+quote(c.name)+' '+c.definition);
  const triggers=read('production-finance-triggers-20261106.json');for(const definition of new Set(triggers.map(t=>t.function_definition)))await db.exec(definition);for(const t of triggers)await db.exec(t.trigger_definition);
  for(const a of read('production-chart-20261106.json'))await db.query('insert into ledger_accounts(id,name,type) values($1,$2,$3)',[a.id,a.name,a.type]);
  await db.exec("select set_config('autodream.private_finance_ready','reviewed-20261104',false)");
  const dir=new URL('../../supabase/migrations/',import.meta.url);for(const n of readdirSync(dir).filter(n=>/^2026110[456].*\.sql$/.test(n)).sort())await db.exec(readFileSync(new URL(n,dir),'utf8'));
  return db;
 }catch(e){await db.close();throw e;}
}
