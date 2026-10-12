'use strict';
// Run the actual transport with a deterministic clock and SDK delivery, not a
// replacement prediction algorithm. Its normal timers and acknowledgements run.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),M=require('../../game/match.cjs'),I=require('../../game/input.cjs');
async function replay({batched=false,projectiles=false,source=process.env.BRAWL_BASELINE_NET,delayMs,guestControls=null,capturePrediction=false,inputDelayMs=20,epochResetStep=null,epochSnapshotDelaySteps=18,steps=720}={}){
 let clock=1000,waiter=null,cursor=0,ack=0,serial=0,epoch=1;const timers=[],packets=[],acks=[],errors=[],sentInputs=[],reconciles=[];
 const observation=capturePrediction?require('../../game/observation.cjs').create({now:()=>clock}):null;if(observation)observation.start({capacity:32768});
 const wire=require('../../game/state-wire.cjs').create({now:()=>clock});
 const sdk={getContext:async()=>({role:'guest',protocol:module.exports.PROTOCOL}),join:async()=>({status:'connected',epoch:1}),
  poll:()=>new Promise(r=>{waiter=r;}),send:async m=>{if(m.type==='brawl.input'){const input=I.clone(m.payload.input);acks.push({at:clock+(typeof inputDelayMs==='function'?inputDelayMs(clock):inputDelayMs),seq:input.seq,input});if(capturePrediction)sentInputs.push({t:clock,input});if(m.payload.stateAck)wire.acknowledge(m.payload.stateAck);}},leave:async()=>({})};
 // Inject only the presentation parameter at the real module boundary. The
 // production net source and its prediction/timer/message algorithms are intact.
 const actualRequire=createRequire(path.join(root,'game/net.cjs'));
 const module={exports:{}},box={module,require:id=>{const value=actualRequire(id);return id==='./remote-motion.cjs'&&delayMs!==undefined?{...value,create:options=>value.create({...options,delayMs})}:value;},Date,Promise,TextEncoder,TextDecoder,Uint8Array,btoa,atob,setTimeout,clearTimeout,
  setInterval(fn,ms){const t={fn,ms,next:clock+ms};timers.push(t);return t;},clearInterval(t){t.off=true;}};
 vm.runInNewContext(fs.readFileSync(source||path.join(root,'game/net.cjs'),'utf8'),box,{filename:'actual-net.cjs'});
 const n=module.exports.create(sdk,{now:()=>clock,observation,onError:e=>errors.push(e.message),onView:v=>{if(capturePrediction)reconciles.push({t:clock,authorityFrame:v.match?.frame,predictedFrame:n.live()?.frame,localState:n.live()?.fighters[1].state,localMoveFrame:n.live()?.fighters[1].move?.frame??null,localPresses:n.live()?.stats[1].pressesSeen,ack:v.ack,...n.diagnostics()});}});
 await n.start({name:'Guest',signature:'guest',kind:'toy',color:'#ff0000'});
 const m=M.create({countdown:false,stage:'moon',styles:[projectiles?'mage':'hammer','hammer']});M.place(m,0,{x:-55});M.place(m,1,{x:75});const hostPad=I.create();
 const rows=[],flush=async(expected)=>{
  if(expected!==undefined&&module.exports.PROTOCOL.version===2){const until=Date.now()+3000;while(n.diagnostics().applied<expected&&!errors.length&&Date.now()<until)await new Promise(r=>setImmediate(r));if(n.diagnostics().applied<expected&&!errors.length)throw Error('wire_decode_timeout');}
  for(let j=0;j<8;j++)await Promise.resolve();
 };
 for(let step=0;step<steps;step++){
  clock=1000+step*1000/60;
  if(guestControls&&n.live()){n.setInput(guestControls(step));await flush();}
  while(acks.length&&acks[0].at<=clock){const received=acks.shift();ack=received.seq;if(guestControls)M.setInput(m,1,received.input);}
  const cycle=step%100,dir=cycle<50?1:-1;
  if(projectiles){if(cycle===0)I.press(hostPad,'special');}else hostPad.x=dir;
  M.setInput(m,0,hostPad);M.step(m);
  if(step%3===0){const arrival=batched?Math.ceil((clock+20)/200)*200:clock+20;packets.push({at:arrival,view:{v:1,you:1,solo:false,phase:'match',settings:{timeLimit:480,stocks:3,stage:'moon'},matchNo:1,notice:'',ack,pause:null,players:[],match:M.snapshot(m)}});}
  if(step===epochResetStep){
   if(!waiter)throw Error('reset_poll_not_ready');
   epoch++;wire.reset();packets.length=0;const r=waiter;waiter=null;r({cursor:++cursor,epoch,transportState:'connected',events:[{type:'resync_required'}]});await flush();
  }
  const waitingSnapshot=epochResetStep!==null&&step>=epochResetStep&&step<epochResetStep+epochSnapshotDelaySteps;
  if(waitingSnapshot)packets.length=0;
  if(waiter&&!waitingSnapshot){const due=packets.filter(p=>p.at<=clock);if(due.length){
   packets.splice(0,due.length);const events=[];
   for(const p of due){let payload={serial:++serial,view:p.view};if(module.exports.PROTOCOL.version===2){const prepared=await wire.encode(payload);wire.sent(prepared);payload=prepared.envelope;}events.push({type:'message',message:{type:'brawl.view',payload}});}
   const r=waiter;waiter=null;r({cursor:++cursor,epoch,transportState:'connected',events});await flush(serial);
  }}
  for(const t of timers)if(!t.off&&clock+1e-6>=t.next){t.next+=t.ms;await t.fn();await flush();}
  const shown=n.present?n.present():n.live();if(shown)rows.push({t:clock,x:shown.fighters[0].x,truth:m.fighters[0].x,dir,cycle,projectiles:shown.projectiles.map(p=>({id:p.id,x:p.x,vx:p.vx,age:p.age})),...(capturePrediction?{predictedFrame:n.live().frame,authorityFrame:m.frame,localX:n.live().fighters[1].x,authorityLocalX:m.fighters[1].x,...n.diagnostics()}:{} )});
 }
 n.dispose();if(waiter)waiter({events:[],transportState:'closed',epoch:1,cursor});await flush();
 const speeds=[];let backwards=0,holds=0;
 for(let i=1;i<rows.length;i++){const p=rows[i-1],r=rows[i];
  if(projectiles){for(const k of r.projectiles){const old=p.projectiles.find(q=>q.id===k.id);if(!old||k.age<15||Math.abs(k.vx)<.01)continue;const dx=(k.x-old.x)*Math.sign(k.vx);backwards+=dx<-.05?1:0;holds+=Math.abs(dx)<.001?1:0;speeds.push(Math.abs(dx/k.vx));}}
  else{if(r.t<2000||r.cycle%50<20||r.cycle%50>45)continue;const dx=(r.x-p.x)*r.dir;backwards+=dx<-.05?1:0;holds+=Math.abs(dx)<.001?1:0;speeds.push(Math.abs(dx)/M.STYLES.hammer.attrs.walk);}}
 speeds.sort((a,b)=>a-b);return {stats:{frames:speeds.length,reverseRatio:backwards/speeds.length,holdRatio:holds/speeds.length,p95SpeedRatio:speeds[Math.floor(speeds.length*.95)],maxSpeedRatio:speeds.at(-1)},errors,rows,...(capturePrediction?{trace:observation.read(),sentInputs,reconciles}:{} )};
}
module.exports={replay};
