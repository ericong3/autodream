import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/store/index.ts',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('async function confirmFinanceWrite'),source.indexOf('// Runs query-producing thunks'));
const action=source.slice(source.indexOf('  addPayment: async '),source.indexOf('  applyBonusPayrollPosting:',source.indexOf('  addPayment: async ')));
function harness(){
 let state={currentUser:{id:'A'},payments:[],users:[]},finish,fail;
 const saving=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
 const context=vm.createContext({get:()=>state,set:f=>{state={...state,...(typeof f==='function'?f(state):f)};},financeFrom:()=>({insert:()=>saving}),paymentToRow:p=>p,sendPush:()=>{},mgmtIds:()=>[]});
 vm.runInContext(transformSync(helper+'\nglobalThis.actions={'+action+'}',{loader:'ts'}).code,context);
 return {context,finish,fail,get state(){return state;},switchAccount(){state={currentUser:{id:'B'},payments:[],users:[]};}};
}
const payment={id:'sample',type:'expense_claim',amount:100,recipientName:'Workshop'};
test('a rejected finance save never appears as a saved payment',async()=>{
 const h=harness(),save=h.context.actions.addPayment(payment);assert.equal(h.state.payments.length,0);
 h.fail(new Error('offline'));await assert.rejects(save,/offline/);assert.equal(h.state.payments.length,0);
});
test('a payment appears only after confirmation, and late confirmations cannot fill another account',async()=>{
 const h=harness(),save=h.context.actions.addPayment(payment);h.finish({data:[payment],error:null});await save;assert.equal(h.state.payments[0].id,payment.id);
 const switched=harness(),late=switched.context.actions.addPayment(payment);switched.switchAccount();switched.finish({data:[payment],error:null});await late;assert.equal(switched.state.payments.length,0);
});
