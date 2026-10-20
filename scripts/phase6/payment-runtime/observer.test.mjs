import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {createObserver} from './observer.mjs';
import {m} from './offline-fixture.mjs';
const stripe=new Stripe('rk_test_synthetic');
for(const failure of [false,true])test('one exact signed duplicate; no retry after '+(failure?'unknown':'success'),async()=>{
 let calls=0;const raw=JSON.stringify({id:'evt_synthetic',type:'checkout.session.completed'});
 const signature=stripe.webhooks.generateTestHeaderString({payload:raw,secret:'whsec_synthetic'});
 const o=createObserver({manifest:m,record:()=>{},secret:()=> 'whsec_synthetic',request:()=>{},replay:async(b,s)=>{calls++;assert.equal(b,raw);assert.equal(s,signature);if(failure)throw Error('unknown');}});
 o.webhook(raw,signature);
 if(failure)await assert.rejects(o.duplicate());else await o.duplicate();
 await assert.rejects(o.duplicate());assert.equal(calls,1);
});
test('expired signature is not replayed or replaced',async()=>{
 let calls=0;const raw='{}';const o=createObserver({manifest:m,record:()=>{},secret:()=> 'whsec_synthetic',request:()=>{},replay:async()=>calls++});
 o.webhook(raw,stripe.webhooks.generateTestHeaderString({payload:raw,secret:'whsec_synthetic',timestamp:1}));await assert.rejects(o.duplicate());assert.equal(calls,0);
});
for(const leak of [false,true])test('RLS uses each user token and '+(leak?'stops on B row':'checks four reads'),async()=>{
 const records=[],seen=[];const o=createObserver({manifest:m,record:(e,d)=>records.push([e,d]),secret:()=>'',replay:async()=>{},request:async(token,path)=>{seen.push(token);const payment=path.startsWith('payments?');if(token==='B-secret'&&!leak)return [];return [{id:payment?'payment-id':'report-id',diagnosis_id:m.diagnosis,user_id:m.a.id,payment_id:'payment-id',status:payment?'paid':'ready'}];}});
 o.accepted({kind:'login',user:m.a.id},{access_token:'A-secret'});o.accepted({kind:'login',user:m.b.id},{access_token:'B-secret'});
 if(leak)await assert.rejects(o.rls('payment-id'));else {await o.rls('payment-id');assert.deepEqual(seen,['A-secret','A-secret','B-secret','B-secret']);}
 await assert.rejects(o.rls('payment-id'));assert(!JSON.stringify(records).includes('secret'));
});
