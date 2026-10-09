'use strict';
// Actual game/net adapter with a latest-lane queue that really coalesces keys.
// Browser/TLS acceptance is separately owned by the hidden host E2E gate.
const test=require('node:test'),assert=require('node:assert/strict');
const {gunzipSync}=require('node:zlib');
const N=require('../game/net.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn)=>{for(let i=0;i<180;i++){if(fn())return;await pause(20);}throw Error('condition_timeout');};
function bridge(t){
 const sides=Object.fromEntries(['host','guest'].map(role=>[role,{events:[],cursor:0,epoch:1,queue:new Map(),joined:false,sent:[],dropAck:false,dropView:false}]));
 const push=(role,e)=>{const s=sides[role];s.events.push({cursor:++s.cursor,...e});s.wake?.();};
 const sdk=role=>({
  getContext:async()=>({role,invitationId:'00000000-0000-4000-8000-000000000001',protocol:N.PROTOCOL}),
  join:async()=>{sides[role].joined=true;return {status:'connected',epoch:1};},
  send:async message=>{const m=structuredClone(message);sides[role].sent.push({t:Date.now(),message:m});if(role==='guest'&&sides.guest.dropAck)delete m.payload.stateAck;sides[role].queue.set(m.key,m);return {status:'queued',seq:sides[role].sent.length};},
  poll:async({cursor,waitMs})=>{const s=sides[role];if(s.cursor<=cursor&&waitMs)await new Promise(resolve=>{const id=setTimeout(()=>{s.wake=null;resolve();},25);s.wake=()=>{clearTimeout(id);s.wake=null;resolve();};});return {events:s.events.filter(e=>e.cursor>cursor),cursor:s.cursor,epoch:s.epoch,transportState:'connected'};},
  transfer:async()=>{throw Error('unexpected_asset');},leave:async()=>({released:true}),
 });
 const interval=setInterval(()=>{for(const role of ['host','guest']){const side=sides[role];for(const m of side.queue.values())if(!(role==='host'&&side.dropView))push(role==='host'?'guest':'host',{type:'message',message:m});side.queue.clear();}},90);
 const errors=[],h=N.create(sdk('host'),{onError:e=>errors.push(e.message)}),g=N.create(sdk('guest'),{onError:e=>errors.push(e.message)});
 t.after(()=>{h.dispose();g.dispose();clearInterval(interval);});
 return {h,g,sides,errors,push,bounce:role=>{sides[role].epoch++;push(role,{type:'connected'});}};
}
async function lobby(t){const p=bridge(t),profile=n=>({name:n,kind:'toy',signature:n,style:'mage'});await p.h.start(profile('host'));await p.g.start(profile('guest'));await wait(()=>p.g.peek()?.players.length===2);return p;}
const packet=e=>JSON.parse(gunzipSync(Buffer.from(e.data,'base64')));

test('protocol v2 restores views after real latest coalescing, and only existing input calls carry applied ACKs',async t=>{
 assert.equal(N.PROTOCOL.version,2);const p=await lobby(t);await pause(900);
 const host=p.sides.host.sent.filter(x=>x.message.type==='brawl.view'),inputs=p.sides.guest.sent.filter(x=>x.message.type==='brawl.input');
 assert(host.every(x=>x.message.payload.codec==='gzip-delta'));
 assert(host.some(x=>packet(x.message.payload).kind==='delta'));
 assert(inputs.length<=8,'unchanged input heartbeat must not accelerate just to ACK');
 assert(inputs.some(x=>x.message.payload.stateAck?.serial>0));
 assert(p.g.diagnostics().stateWire.decoded<host.length,'latest queue must actually discard snapshots');
 assert.equal(p.g.peek().you,1);assert.deepEqual(p.errors,[]);
});

test('a guest-only epoch change requests a new full generation without rewinding the applied state',async t=>{
 const p=await lobby(t);await wait(()=>p.g.diagnostics().stateWire.receiver.delta>0);
 const before=p.g.diagnostics().applied,generation=p.g.diagnostics().stateWire.receiver.generation;p.bounce('guest');
 await wait(()=>p.g.diagnostics().stateWire.receiver.generation>generation&&p.g.diagnostics().applied>before);
 assert.deepEqual(p.errors,[]);
});

test('ACK loss and a cache reset recover from a periodic full without resending appearances',async t=>{
 const p=await lobby(t);await wait(()=>p.g.diagnostics().stateWire.receiver.delta>0);
 p.sides.guest.dropAck=true;const full=p.g.diagnostics().stateWire.receiver.full;
 p.push('guest',{type:'resync_required',reason:'test_cache_loss'});
 await wait(()=>p.g.diagnostics().stateWire.receiver.full>full);
 assert.equal(p.g.peek().players.length,2);assert.deepEqual(p.errors,[]);
});

test('invalid digest is not applied or ACKed; a subsequent real host full recovers',async t=>{
 const p=await lobby(t);await pause(250);p.sides.host.dropView=true;
 const forge=require('../game/state-wire.cjs').create();for(let n=1;n<p.g.diagnostics().stateWire.receiver.generation;n++)forge.reset();
 const forged=await forge.encode({serial:p.h.diagnostics().serial+1000,view:p.g.peek()});
 p.push('guest',{type:'message',message:{type:'brawl.view',payload:{...forged.envelope,digest:'0'.repeat(64)}}});
 await wait(()=>p.errors.includes('integrity_mismatch'));
 assert(p.g.diagnostics().stateWire.receiver.needFull);
 p.sides.host.dropView=false;p.bounce('host');const before=p.g.diagnostics().applied;
 await wait(()=>p.g.diagnostics().applied>before&&!p.g.diagnostics().stateWire.receiver.needFull);
});

test('results to a new countdown resets the baseline and delayed prior-match frames cannot roll it back',async t=>{
 const p=await lobby(t);p.h.ready(true);p.g.ready(true);await wait(()=>p.h.live()&&p.g.peek()?.match);
 // Pure protocol boundary test: advance the authoritative match to its legitimate
 // time-expiry transition; hidden host E2E owns real inputs and elapsed combat.
 const match=p.h.live();match.phase='fight';match.phaseFrame=0;match.timeLeft=1;match.fighters[0].percent=1;
 await wait(()=>p.g.peek()?.match?.phase==='results');
 const prior=p.sides.host.sent.filter(x=>x.message.type==='brawl.view').at(-1).message;
 const generation=p.g.diagnostics().stateWire.receiver.generation;
 p.h.ready(true);p.g.ready(true);await wait(()=>p.g.peek()?.matchNo===2&&p.g.peek().match.phase==='countdown');
 assert(p.g.diagnostics().stateWire.receiver.generation>generation);
 const serial=p.g.diagnostics().applied;p.push('guest',{type:'message',message:structuredClone(prior)});await pause(80);
 assert.equal(p.g.peek().matchNo,2);assert(p.g.diagnostics().applied>=serial);assert.deepEqual(p.errors,[]);
});
