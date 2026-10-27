import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{transformSync}from'esbuild';import vm from'node:vm';
const source=readFileSync(new URL('../src/utils/tintQuoteTotal.ts',import.meta.url),'utf8').replace('export ','');const ctx=vm.createContext({Math});vm.runInContext(transformSync(source,{loader:'ts'}).code+';globalThis.quote=tintQuoteTotal;',ctx);const quote=ctx.quote;
const base={packageType:'full',fullPrice:900,mixTotal:700,roofTotal:150,extrasTotal:0,discount:0};
test('full package adds the agreed roof charge',()=>assert.equal(quote(base),1050));
test('mix prices already include roof charges so they are not charged twice',()=>assert.equal(quote({...base,packageType:'mix',mixTotal:850}),850));
test('van or bus agreed base replaces grid pricing and adds roof extras',()=>assert.equal(quote({...base,agreedBase:1800,packageType:'mix',extrasTotal:40,discount:90}),1900));
test('agreed free base is deliberate and does not fall back to grid',()=>assert.equal(quote({...base,agreedBase:0,roofTotal:75}),75));
test('final payable amount is rounded to cents and does not go below zero',()=>{assert.equal(quote({...base,agreedBase:100.10,roofTotal:25.20,discount:5}),120.30);assert.equal(quote({...base,discount:2000}),0);});
