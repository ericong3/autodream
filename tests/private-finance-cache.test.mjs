import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/utils/privateFinanceCache.ts',import.meta.url),'utf8');const module={exports:{}};
vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports});const {privateFinanceCacheJson:clean}=module.exports;
test('old finance caches cannot rehydrate salary or bank records under a changed role',()=>{
 const raw=JSON.stringify({version:0,state:{currentUser:{id:'a',role:'admin',basicSalary:9000,bankAccountNumber:'private'},loaded:true,phase2Loaded:true,users:[{basicSalary:9000}],payments:[{type:'salary'}],journalEntries:[{lines:['private']}],bankTransactions:[{description:'salary'}],payslips:[{basicSalary:9000}],cars:[{id:'stock'}],viewPreference:{a:'grid'}}});
 const result=JSON.parse(clean(raw));assert.equal(result.state.currentUser.basicSalary,undefined);assert.equal(result.state.currentUser.bankAccountNumber,undefined);
 for(const key of ['users','payments','journalEntries','bankTransactions','payslips'])assert.deepEqual(result.state[key],[]);
 assert.equal(result.state.loaded,false);assert.equal(result.state.phase2Loaded,false);assert.equal(result.state.cars[0].id,'stock');assert.equal(result.state.viewPreference.a,'grid');
});
test('investor startup also removes any old staff car/customer snapshots',()=>{
 const result=JSON.parse(clean(JSON.stringify({state:{currentUser:{id:'i',role:'investor'},cars:[{id:'other-stock'}],customers:[{name:'Other customer'}],viewPreference:{other:'grid'}}})));
 assert.deepEqual(result.state.cars,[]);assert.deepEqual(result.state.customers,[]);assert.deepEqual(result.state.viewPreference,{});assert.equal(clean('broken'),null);
});
