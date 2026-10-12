'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../game/prediction.cjs'),M=require('../game/match.cjs'),I=require('../game/input.cjs');
const world=()=>M.create({countdown:false,stage:'moon'});
const view=(m,extra={})=>({match:M.snapshot(m),matchNo:1,ack:0,pause:null,...extra});
const advance=(m,pad,count=1)=>{for(let i=0;i<count;i++){M.setInput(m,1,pad);M.step(m);}return m;};

test('scheduled pending inputs replay the full world, and receipt advancement cannot shorten its target',()=>{
 const m=world(),p=P.create(),pad=I.create();p.reconcile(view(m));
 const inputs=[];
 for(let i=0;i<12;i++){pad.x=i<6?1:i<9?-1:0;pad.seq=i+1;inputs.push(I.clone(pad));p.tick(pad);}
 const authoritative=M.restore(M.snapshot(m));for(const input of inputs.slice(0,5))advance(authoritative,input);
 const expected=M.restore(M.snapshot(authoritative));for(const input of inputs.slice(5))advance(expected,input);
 p.reconcile(view(authoritative,{ack:5}));
 assert.deepEqual(M.snapshot(p.live()),M.snapshot(expected));
 assert.equal(p.live().frame,12);
 // Once authority reaches the target, nothing extra is simulated.
 p.reconcile(view(expected,{ack:12}));assert.deepEqual(M.snapshot(p.live()),M.snapshot(expected));assert.equal(p.diagnostics().history,0);
});

test('ACK pruning fills remaining target time using actual authority input, not an artificial frame clamp',()=>{
 const p=P.create(),m=world(),pad=I.create();pad.x=1;p.reconcile(view(m));
 for(let i=0;i<12;i++){pad.seq=i+1;p.tick(pad);}
 advance(m,pad,3);p.reconcile(view(m,{ack:12}));const expected=M.restore(M.snapshot(m));advance(expected,pad,9);
 assert.equal(p.live().frame,12);assert.deepEqual(M.snapshot(p.live()),M.snapshot(expected));assert.equal(p.diagnostics().history,0);
});

for(const action of ['attack','jump'])for(const consumed of [false,true])test(`${action} receipt ${consumed?'already applied':'not applied yet'} is consumed exactly once in the reconstructed world`,()=>{
 const m=world(),pad=I.create(),p=P.create();p.reconcile(view(m));I.press(pad,action);
 for(let i=0;i<12;i++)p.tick(pad);
 M.setInput(m,1,pad);if(consumed)M.step(m);
 p.reconcile(view(m,{ack:12}));
 const expected=M.restore(M.snapshot(m));advance(expected,pad,12-m.frame);
 assert.deepEqual(M.snapshot(p.live()),M.snapshot(expected));assert.equal(p.live().stats[1].pressesSeen[action],1);
 const once=M.snapshot(p.live());p.reconcile(view(m,{ack:12}));assert.deepEqual(M.snapshot(p.live()),once,'repeated snapshot never accumulates extra actions');
});

test('pause, resume and epoch reset discard old frame history and follow authority',()=>{
 const m=world(),pad=I.create(),p=P.create();p.reconcile(view(m));pad.x=1;for(let i=0;i<20;i++)p.tick(pad);
 m.paused=true;p.reconcile(view(m,{pause:{reason:'peer_lost'}}));const paused=M.snapshot(p.live());p.tick(pad);assert.deepEqual(M.snapshot(p.live()),paused);
 assert.equal(p.diagnostics().predictionReset,'paused');assert.equal(p.diagnostics().history,0);
 m.paused=false;p.reconcile(view(m));assert.equal(p.diagnostics().predictionReset,'resume');assert.deepEqual(M.snapshot(p.live()),M.snapshot(m));
 pad.x=-1;p.tick(pad);const expected=M.restore(M.snapshot(m));advance(expected,pad);assert.deepEqual(M.snapshot(p.live()),M.snapshot(expected));
 p.reconcile(view(m),{reset:'epoch'});assert.equal(p.diagnostics().predictionReset,'epoch');assert.deepEqual(M.snapshot(p.live()),M.snapshot(m));
});

test('authoritative results and a new round replace predicted world without old movement or attacks',()=>{
 const m=world(),pad=I.create(),p=P.create();p.reconcile(view(m));pad.x=1;I.press(pad,'attack');for(let i=0;i<15;i++)p.tick(pad);
 m.phase='results';m.result={winner:0,reason:'forfeit',frame:0};p.reconcile(view(m));p.tick(pad);assert.deepEqual(M.snapshot(p.live()),M.snapshot(m));
 const next=world();M.setInput(next,1,pad);M.resetInputBaseline(next,1);p.reconcile(view(next,{matchNo:2}));
 assert.equal(p.diagnostics().predictionReset,'round');assert.equal(p.diagnostics().history,0);assert.deepEqual(M.snapshot(p.live()),M.snapshot(next));
 pad.x=0;p.tick(pad);assert.equal(p.live().stats[1].pressesSeen.attack,0,'old held counter is not a new round press');
});

test('missing bounded history is an explicit reset, never fabricated time advancement',()=>{
 const m=world(),p=P.create(),pad=I.create();p.reconcile(view(m));for(let i=0;i<260;i++)p.tick(pad);
 p.reconcile(view(m));assert.equal(p.diagnostics().predictionReset,'history-gap');assert.deepEqual(M.snapshot(p.live()),M.snapshot(m));
});
