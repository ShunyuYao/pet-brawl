'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../game/state-wire.cjs');
const R=require('../game/room.cjs');
const value=n=>{const r=R.create();r.join(0,{name:'房主',signature:'host',kind:'toy'});r.join(1,{name:'客人',signature:'guest',kind:'toy'});return {serial:n,view:r.view(1)};};
async function encoded(w,p){const result=await w.encode(p);w.sent(result);return result.envelope;}
test('only a fully applied, digest-verified view becomes feedback; deltas reproduce exact JSON',async()=>{
 const h=create(),g=create();let applied;
 const first=await encoded(h,value(1));await g.decode(first,v=>{assert(R.validView(v.view));applied=v;});assert.deepEqual(applied,value(1));
 assert(h.acknowledge(g.feedback()));const next=await h.encode(value(2));assert(next.packet.base>0);
 await g.decode(next.envelope,v=>{applied=v;});assert.deepEqual(applied,value(2));assert.equal(g.feedback().serial,2);
});
test('bad digest does not ACK and a full later in the same consumer batch recovers',async()=>{
 const h=create(),g=create(),one=await encoded(h,value(1)),two=await encoded(h,value(2));
 await assert.rejects(g.decode({...one,digest:'0'.repeat(64)},()=>{}),/integrity_mismatch/);assert.equal(g.feedback().serial,0);
 let count=0;await g.decode(two,()=>count++);assert.equal(count,1);assert.equal(g.feedback().serial,2);
});
test('valid hash with failed application does not ACK and later full can recover',async()=>{
 const h=create(),g=create(),one=await encoded(h,value(1));
 await assert.rejects(g.decode(one,()=>{throw Error('invalid_view');}),/invalid_view/);assert.equal(g.feedback().serial,0);
 await g.decode(await encoded(h,value(2)),()=>{});assert.equal(g.feedback().serial,2);
});
test('reset or close while SHA is pending invalidates old encoding before sender cache preparation',async()=>{
 let resolve;const w=create({hash:()=>new Promise(r=>{resolve=r;})});
 const task=w.encode(value(1));w.reset();resolve('a'.repeat(64));assert.equal(await task,null);assert.equal(w.diagnostics().sender.entries,0);
 const again=w.encode(value(2));w.close();resolve('b'.repeat(64));assert.equal(await again,null);assert.equal(w.diagnostics().sender.entries,0);
});
test('reset during verification cannot apply or ACK an old view',async()=>{
 const h=create(),normal=await encoded(h,value(1));let finish;
 const g=create({hash:()=>new Promise(r=>{finish=r;})}),pending=g.decode(normal,()=>assert.fail('stale decode applied'));
 while(!finish)await new Promise(r=>setImmediate(r));g.reset();finish(normal.digest);assert.equal((await pending).ignored,'reset');assert.equal(g.feedback().serial,0);
});
test('unknown envelope fields, bad base64, oversized claims, truncated and trailing gzip are rejected',async()=>{
 const h=create(),one=await encoded(h,value(1));
 for(const e of [{...one,extra:true},{...one,data:'!'}, {...one,rawBytes:100000}, {...one,data:one.data.slice(0,-4)}, {...one,data:Buffer.concat([Buffer.from(one.data,'base64'),Buffer.from([1])]).toString('base64')}]) {
  const g=create();await assert.rejects(g.decode(e,()=>assert.fail('bad envelope applied')));assert.equal(g.feedback().serial,0);
 }
});

test('reset and close during asynchronous compression discard prepared old generations',async()=>{
 for(const method of ['reset','close']){
  let release;const w=create({compress:()=>new Promise(r=>{release=r;})});
  const work=w.encode(value(1));while(!release)await new Promise(r=>setImmediate(r));
  w[method]();release({data:'unused',encodedBytes:10});assert.equal(await work,null);assert.equal(w.diagnostics().sender.entries,0);
 }
});
test('ACK arriving during compression cannot rewrite the already prepared packet baseline',async()=>{
 const {gzipSync}=require('node:zlib');let release;
 const compress=async p=>{if(p.serial===3&&p.kind==='full')await new Promise(r=>{release=r;});const b=Buffer.from(JSON.stringify(p));return {data:gzipSync(b).toString('base64'),encodedBytes:b.length};};
 const h=create({compress}),g=create();await g.decode(await encoded(h,value(1)),()=>{});h.acknowledge(g.feedback());
 await g.decode(await encoded(h,value(2)),()=>{});const ack2=g.feedback();
 const work=h.encode(value(3));while(!release)await new Promise(r=>setImmediate(r));
 assert(h.acknowledge(ack2));release();const prepared=await work;assert.equal(prepared.packet.base,1);
 await g.decode(prepared.envelope,()=>{});assert.equal(g.feedback().serial,3);
});
test('applied proof records match sent canonical digests and diagnostics cannot mutate their history',async()=>{
 const h=create(),g=create();for(let n=1;n<=70;n++){await g.decode(await encoded(h,value(n)),()=>{});h.acknowledge(g.feedback());}
 const a=h.diagnostics().proofs.sent,b=g.diagnostics().proofs.applied;assert.equal(a.length,64);assert.deepEqual(a,b);
 a[0].digest='tampered';assert.notEqual(h.diagnostics().proofs.sent[0].digest,'tampered');
});
