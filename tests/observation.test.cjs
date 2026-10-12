'use strict';
// Pure observation boundaries; real keyboard/render integration is accepted by
// the host's hidden cloud E2E, not by these injected observation calls.
const test=require('node:test'),assert=require('node:assert/strict');
const O=require('../game/observation.cjs'),I=require('../game/input.cjs'),M=require('../game/match.cjs');
const view=(m,matchNo=1)=>({match:m,matchNo,you:1,pause:null});

test('observation is off by default, does not read time or touch supplied match data',()=>{
 const o=O.create({now:()=>{throw Error('off recorder read clock');}}),m=M.create({countdown:false}),original=M.snapshot(m);
 assert.equal(o.enabled,false);assert.equal(o.beforeTick(1,m),null);
 o.key({seat:1,matchNo:1,action:'attack',counter:1});o.published(1,view(m));o.applied({serial:1,view:view(m),previous:null,pred:m,previousMatchNo:-1});o.scene({matchNo:1,match:m,fighters:[]});
 assert.deepEqual(m,original);assert.deepEqual(o.read().events,[]);assert.equal(o.read().recorded,0);
});

test('bounded ring overwrites oldest records, drain preserves loss counters, stop and restart are explicit',()=>{
 let t=0;const o=O.create({now:()=>++t});o.start({capacity:3});
 for(let n=1;n<=5;n++)o.key({seat:1,matchNo:2,action:'attack',counter:n,code:'KeyJ',trusted:true});
 const a=o.read();assert.equal(a.recorded,5);assert.equal(a.dropped,2);assert.deepEqual(a.events.map(x=>x.counter),[3,4,5]);assert.deepEqual(a.events.map(x=>x.id),[3,4,5]);
 a.events[0].counter=900;assert.equal(o.drain().events[0].counter,3);assert.equal(o.read().events.length,0);assert.equal(o.read().dropped,2);
 o.stop();o.key({seat:1,matchNo:2,action:'attack',counter:6});assert.equal(o.read().recorded,5);
 o.start();assert.equal(o.read().recorded,0);assert.equal(o.read().dropped,0);assert.equal(o.read().capacity,O.LIMITS.defaultCapacity);
 for(const capacity of [0,-1,1.2,NaN,Infinity,O.LIMITS.maxCapacity+1])assert.throws(()=>o.start({capacity}),/invalid_observation_capacity/);
});

test('authority consumption comes only from applied counter changes after an actual match step',()=>{
 let t=10;const o=O.create({now:()=>t}),m=M.create({countdown:false}),p=I.create();o.start();
 I.press(p,'attack');I.press(p,'attack');M.setInput(m,1,p);
 const before=o.beforeTick(3,m);o.afterTick(before,3,m);assert.equal(o.read().events.length,0,'accepting input is not consuming it');
 M.step(m);t=11;o.afterTick(before,3,m);
 const event=o.read().events[0];assert.equal(event.type,'authority.consume');assert.equal(event.t,11);assert.equal(event.action,'attack');assert.equal(event.previousCounter,0);assert.equal(event.counter,2);assert.equal(event.delta,2);assert.equal(event.seat,1);assert.equal(event.matchNo,3);assert.equal(event.frame,m.frame);
 const baseline=o.beforeTick(3,m);M.step(m);o.afterTick(baseline,3,m);assert.equal(o.read().events.length,1,'holding the same counters cannot fabricate another action');
 const next=M.create({countdown:true});M.setInput(next,1,p);M.resetInputBaseline(next,1);o.afterTick(o.beforeTick(4,next),4,next);assert.equal(o.read().events.length,1,'new-round baseline is not an action');
});

test('decoded apply times and continuous corrections use real prediction before/after in game units',()=>{
 let t=100;const o=O.create({now:()=>t}),m=M.create({countdown:false});o.start();
 o.applied({serial:1,view:view(m),previous:null,pred:m,previousMatchNo:-1});
 const prior=M.restore(m),next=M.restore(m);next.fighters[1].x+=3;next.fighters[1].y+=4;
 t=148;o.applied({serial:2,view:view(m),previous:prior,pred:next,previousMatchNo:1});
 const applied=o.read().events.filter(e=>e.type==='state.apply');assert.deepEqual(applied.map(e=>e.gapMs),[null,48]);
 const c=o.read().events.find(e=>e.type==='correction'&&e.serial===2&&e.seat===1);
 assert.equal(c.kind,'continuous');assert.equal(c.dx,3);assert.equal(c.dy,4);assert.equal(c.distance,5);assert.equal(c.local,true);
 next.fighters[1].x=500;assert.equal(o.read().events.find(e=>e.id===c.id).after.x,c.after.x,'events own their small copies');
});

test('round, phase, death and respawn are not merged into continuous correction distributions',()=>{
 const o=O.create({now:()=>1}),m=M.create({countdown:false});o.start();
 for(const [kind,edit,previousMatchNo] of [
  ['round',x=>x,0],['phase',x=>{x.phase='results';},1],
  ['death',x=>{x.fighters[1].stocks--;x.fighters[1].state='dead';},1],
  ['respawn',x=>{x.fighters[1].state='respawn';},1],
 ]){const next=M.restore(m);edit(next);o.applied({serial:1,view:view(next),previous:m,pred:next,previousMatchNo});assert.equal(o.drain().events.find(e=>e.type==='correction'&&e.seat===1).kind,kind);}
});

test('publish, apply and scene evidence keep authoritative and predicted provenance separate',()=>{
 let t=1;const o=O.create({now:()=>t}),m=M.create({countdown:false});o.start();m.applied[1].c.attack=2;
 o.published(7,view(m));o.applied({serial:7,view:view(m),previous:null,pred:m,previousMatchNo:-1});
 const presentation={localSeat:1,mode:'interpolation',lowerSerial:5,upperSerial:6,lowerFrame:20,upperFrame:23,alpha:.4,lowerConsumed:[{attack:0},{attack:0}],upperConsumed:[{attack:1},{attack:1}],fighters:[{seat:0,sourceMode:'interpolation'}]};
 o.presentation(presentation);m.applied[1].c.attack=99;
 t=2;o.scene({matchNo:1,match:m,fighters:[{seat:0,gameX:3,gameY:4,worldX:.31,worldY:.4,visible:true,state:'move',move:'jab'}]});
 const scene=o.read().events.find(e=>e.type==='scene.submit');assert.equal(scene.t,2);assert.equal(scene.authoritySerial,7);assert.equal(scene.authorityConsumed[1].attack,2,'never use pred.applied as authority');
 assert.equal(scene.presentation.upperSerial,6);assert.equal(scene.presentation.upperConsumed[0].attack,1);assert.equal(scene.fighters[0].worldX,.31,'use the actual root coordinate including existing scene offsets');
 presentation.upperSerial=100;m.applied[1].c.attack=100;assert.equal(o.read().events.find(e=>e.id===scene.id).presentation.upperSerial,6);
});

test('network resets annotate gaps without concealing an actual long interval between decoded applications',()=>{
 let t=10;const o=O.create({now:()=>t}),m=M.create({countdown:false});o.start();
 o.applied({serial:1,view:view(m),previous:null,pred:m,previousMatchNo:-1});t=100;o.network('reset',{reason:'epoch',epoch:2});t=2100;
 o.applied({serial:2,view:view(m),previous:m,pred:m,previousMatchNo:1});
 assert.equal(o.read().events.filter(e=>e.type==='state.apply').at(-1).gapMs,2090);assert(o.read().events.some(e=>e.type==='network.reset'));
});

test('a broken observation clock is counted and never throws into simulation or networking',()=>{
 const o=O.create({now:()=>{throw Error('diagnostic clock failed');}}),m=M.create({countdown:false});o.start();
 assert.doesNotThrow(()=>{o.key({});o.published(1,view(m));o.applied({serial:1,view:view(m),previous:null,pred:m});o.scene({matchNo:1,match:m,fighters:[]});o.network('state',{state:'connected'});});
 assert.equal(o.read().errors,5);assert.equal(o.read().recorded,0);assert.equal(m.frame,0);
});

test('remote motion samples report the actual source snapshots while leaving every output byte unchanged',()=>{
 const Motion=require('../game/remote-motion.cjs');
 const plain=Motion.create(),observed=Motion.create(),m=M.create({countdown:false});
 const push=(frame,x,serial)=>{const n=M.restore(m);n.frame=frame;n.fighters[0].x=x;n.applied[0].c.attack=serial;plain.push(view(n),1000+frame*1000/60,serial);observed.push(view(n),1000+frame*1000/60,serial);};
 push(0,0,10);push(3,3,11);push(6,6,12);
 let source;const pred=M.restore(m);pred.frame=12;pred.applied[0].c.attack=999;
 for(const t of [1180,1220,1300,1600]){
  const expected=plain.sample(pred,t),actual=observed.sample(pred,t,false,s=>{source=s;});assert.deepEqual(actual,expected);
  assert(source.lowerSerial<=source.upperSerial);assert.equal(source.upperConsumed[0].attack,source.upperSerial);assert.notEqual(source.upperConsumed[0].attack,999);
  assert.equal(source.localSeat,1);assert.equal(source.fighters[0].sourceMode,'prediction');assert.match(source.fighters[1].sourceMode,/^remote-/);
 }
 assert.doesNotThrow(()=>observed.sample(pred,1700,false,()=>{throw Error('broken diagnostic consumer');}));
 assert.deepEqual(observed.sample(pred,1800),plain.sample(pred,1800),'throwing consumer cannot alter subsequent motion output');
});
