// Disposable local databases only; no production URL is accepted.
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
export async function createFinanceRehearsal(pgliteRoot){
 if(process.env.AUTODREAM_TEST_POSTGRES!=='1'){
  const {PGlite}=await import(pathToFileURL(resolve(pgliteRoot,'dist/index.js')));return new PGlite();
 }
 const driver=process.env.AUTODREAM_TEST_PG_DRIVER||fileURLToPath(new URL('../../work/pg-rehearsal/node_modules/pg/lib/index.js',import.meta.url));
 const pg=(await import(pathToFileURL(driver))).default;pg.types.setTypeParser(20,Number);pg.types.setTypeParser(1700,Number);
 const options={host:'127.0.0.1',port:55439,user:'rehearsal',database:'postgres',connectionTimeoutMillis:5000,statement_timeout:20000};
 const admin=new pg.Client(options);await admin.connect();const name='ad_test_'+randomBytes(8).toString('hex');await admin.query('CREATE DATABASE '+name);
 const client=new pg.Client({...options,database:name});await client.connect();
 return {isPostgres:true,query:(...args)=>client.query(...args),exec:sql=>client.query(sql.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end $$;`)),
  connection:async()=>{const c=new pg.Client({...options,database:name});await c.connect();return c;},
  close:async()=>{await client.end();try{await admin.query('DROP DATABASE '+name+' WITH (FORCE)');}finally{await admin.end();}}};
}
