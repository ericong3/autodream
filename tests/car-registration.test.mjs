import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
function load(path){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:n=>load('../src/utils/'+n.replace('./','')+'.ts')});return module.exports;}
const {registrationCommission,RECON_COMMISSION_DEFAULT}=load('../src/utils/carRegistration.ts');
const {salesCommission}=load('../src/utils/salesCommission.ts');
test('recon registration saves the default or director amount used by the existing finance calculation',()=>{
 for(const amount of [RECON_COMMISSION_DEFAULT,2500,0,1999.99]){
  const saved={id:'new-recon',isRecon:true,salesCommission:registrationCommission(true,amount,true),sellingPrice:100000};
  assert.equal(salesCommission(saved),amount);
 }
});
test('registration preserves director-only custom rates and drops recon amounts for used cars',()=>{
 assert.equal(registrationCommission(true,9000,false),2000);
 assert.equal(registrationCommission(true,undefined,false),2000);
 assert.equal(registrationCommission(false,2500,true),undefined);
 assert.equal(registrationCommission(false,2000,false),undefined);
});
test('invalid recon rates cannot reach the saved car',()=>{
 for(const value of [undefined,NaN,Infinity,-1,100000.01,1.005])assert.throws(()=>registrationCommission(true,value,true),/commission/);
});
