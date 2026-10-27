import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmSaleAppointment} from '../src/lib/garageAppointments.ts';
test('transient conflicts retry the same invoice once',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));assert.equal(options.credentials,'same-origin');return new Response(JSON.stringify(calls.length===1?{error:{code:'RETRYABLE',message:'Try again'}}:{saved:{id:'sample-booking',customer_id:'sample-customer',service:'tinted',appointment_kind:'installation',revision:2,invoice_id:'sample-invoice'}}),{status:calls.length===1?503:200});};
 try{const saved=await confirmSaleAppointment('sample-invoice',{appointmentId:'sample-booking',revision:1});assert.equal(saved.invoiceId,'sample-invoice');assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);}finally{globalThis.fetch=previous;}
});
test('a stale booking is not silently retried',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:'CONFLICT',message:'Reload the booking'}}),{status:409});};
 try{await assert.rejects(()=>confirmSaleAppointment('sample-invoice',{appointmentId:'sample-booking',revision:1}),/Reload the booking/);assert.equal(calls,1);}finally{globalThis.fetch=previous;}
});
test('transient retry stays bounded',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:'RETRYABLE',message:'Still busy'}}),{status:503});};
 try{await assert.rejects(()=>confirmSaleAppointment('sample-invoice',{startsAt:'2026-10-30T02:00:00Z',endsAt:'2026-10-30T03:00:00Z'}),/Still busy/);assert.equal(calls,2);}finally{globalThis.fetch=previous;}
});
