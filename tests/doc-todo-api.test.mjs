import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateTodo,todoError} from '../server/usedCar/docTodo.mjs';
const id='77777777-7777-4777-8777-777777777777';
test('admin can send back with a reason; only the Director can delete, edit or answer',()=>{
 const admin={role:'admin'},director={role:'director'};
 assert.doesNotThrow(()=>validateTodo(admin,'send_back',{paymentId:'bill-1',reason:'Duplicate bill'}));
 assert.throws(()=>validateTodo(admin,'send_back',{paymentId:'bill-1',reason:'x'}),/reason/i);
 assert.throws(()=>validateTodo(admin,'send_back',{paymentId:'bill-1',moneyId:id,reason:'Duplicate'}),/Open the item/);
 for(const a of ['delete_bill','edit_bill','resolve'])assert.throws(()=>validateTodo(admin,a,{id}),e=>e.status===403);
 assert.doesNotThrow(()=>validateTodo(director,'delete_bill',{id}));
 assert.throws(()=>validateTodo(director,'edit_bill',{id,amountCents:0}),/amount/);
 assert.throws(()=>validateTodo(director,'resolve',{id,resolution:'maybe'}),/answer/);
 assert.throws(()=>validateTodo({role:'salesperson'},'list',{}),e=>e.status===403);
});
test('database refusals become plain messages',()=>{
 assert.equal(todoError({message:'BILL_HAS_DOCUMENTS'}).status,409);
 assert.equal(todoError({code:'23503',message:'fk'}).code,'BILL_HAS_DOCUMENTS');
 assert.match(todoError({message:'CONSIGNMENT_APPROVED_CORRECTION_REQUIRED'}).message,/Adjust approved bill/);
 assert.match(todoError({message:'NEW_THING_HAPPENED'}).message,/NEW_THING_HAPPENED/);
});
