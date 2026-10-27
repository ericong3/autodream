import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/pages/GarageFollowUps.tsx',import.meta.url),'utf8');
const find=source.slice(source.indexOf(' async function find()'),source.indexOf(' async function create('));
function setup(){let finish;const state={matches:[],checked:false,busy:false};const context=vm.createContext({busy:false,phone:'0100000001',name:'Sample',customerSearch:{current:0},lifetime:{current:1},setBusy:v=>state.busy=v,setError:()=>{},setMatches:v=>state.matches=v,setChecked:v=>state.checked=v,enquiryRequest:()=>new Promise(resolve=>finish=resolve)});vm.runInContext(transformSync(find,{loader:'ts'}).code,context);return {context,state,resolve:()=>finish({customers:[{id:'old-phone-match'}]})};}
test('customer search results apply to the unchanged enquiry form',async()=>{const h=setup(),pending=h.context.find();h.resolve();await pending;assert.equal(h.state.checked,true);assert.equal(h.state.matches[0].id,'old-phone-match');assert.equal(h.state.busy,false);});
test('editing customer details invalidates an in-flight search',async()=>{const h=setup(),pending=h.context.find();h.context.customerSearch.current++;h.resolve();await pending;assert.equal(h.state.checked,false);assert.equal(h.state.matches.length,0);assert.equal(h.state.busy,false);});
test('switching account discards customer search responses',async()=>{const h=setup(),pending=h.context.find();h.context.lifetime.current++;h.resolve();await pending;assert.equal(h.state.checked,false);assert.equal(h.state.matches.length,0);});
