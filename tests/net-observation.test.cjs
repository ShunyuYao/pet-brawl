'use strict';
// Actual net/room/state-wire adapters, native compression, deterministic timer
// callbacks and an in-memory SDK. Real keyboard and WebGL submission use host E2E.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const esbuild=require(process.env.PET_BRAWL_ESBUILD||path.resolve(__dirname,'../../../demo/node_modules/esbuild'));
const root=path.resolve(__dirname,'..');
const bundle=esbuild.buildSync({stdin:{contents:"module.exports={N:require('./game/net.cjs'),O:require('./game/observation.cjs'),I:require('./game/input.cjs')}",resolveDir:root},bundle:true,platform:'browser',format:'cjs',write:false}).outputFiles[0].text;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function replay(enabled){
 let clock=1000,id=0;const timers=new Map();
 const sandbox={module:{exports:{}},TextEncoder,TextDecoder,CompressionStream,DecompressionStream,ReadableStream,Response,Blob,crypto:globalThis.crypto,btoa,atob,performance:{now:()=>clock},setTimeout,clearTimeout,
  setInterval(fn,ms){const key=++id;timers.set(key,{fn,ms,next:clock+ms});return key;},clearInterval(key){timers.delete(key);}};
 vm.runInNewContext(bundle,sandbox);const {N,O,I}=sandbox.module.exports;
 const sides=Object.fromEntries(['host','guest'].map(role=>[role,{events:[],cursor:0,sent:[],wake:null}]));
 const sdk=role=>({getContext:async()=>({role,invitationId:'00000000-0000-4000-8000-000000000001',protocol:N.PROTOCOL}),join:async()=>({status:'connected',epoch:1}),
  send:async message=>{const own=sides[role],other=sides[role==='host'?'guest':'host'];own.sent.push(JSON.stringify(message));other.events.push({cursor:++other.cursor,type:'message',message});other.wake?.();return {status:'queued',seq:own.sent.length};},
  poll:async({cursor})=>{const side=sides[role];if(side.cursor<=cursor)await new Promise(r=>{side.wake=()=>{side.wake=null;r();};});return {cursor:side.cursor,events:side.events.filter(e=>e.cursor>cursor),epoch:1,transportState:'connected'};},leave:async()=>({released:true})});
 const ho=O.create(),go=O.create();if(enabled){ho.start();go.start();}const errors=[];
 const h=N.create(sdk('host'),{now:()=>clock,observation:ho,onError:e=>errors.push(e.message)}),g=N.create(sdk('guest'),{now:()=>clock,observation:go,onError:e=>errors.push(e.message)});
 const settled=async()=>{for(let n=0;n<1000;n++){await sleep(1);if(h.diagnostics().serial===g.diagnostics().applied)return;}throw Error('decode_not_settled '+JSON.stringify({errors,host:h.diagnostics(),guest:g.diagnostics()}));};
 async function advance(ms){const until=clock+ms;for(;;){const entry=[...timers.entries()].sort((a,b)=>a[1].next-b[1].next||a[0]-b[0])[0];if(!entry||entry[1].next>until)break;clock=entry[1].next;entry[1].next+=entry[1].ms;entry[1].fn();}clock=until;await settled();}
 try{
  const profile=name=>({name,kind:'toy',signature:name,style:'hammer'});await h.start(profile('host'));await g.start(profile('guest'));await advance(100);h.ready(true);g.ready(true);
  const p=I.create();for(let n=0;n<220;n++){if(n===170||n===190){I.press(p,'attack');g.setInput(p);}if(n===180){I.press(p,'left');p.x=-1;g.setInput(p);}if(n===195){p.x=0;g.setInput(p);}await advance(20);}
  const clean=v=>JSON.parse(JSON.stringify(v));return {wire:sides.host.sent.concat(sides.guest.sent),host:clean(h.live()),guest:clean(g.live()),present:clean(g.present()),errors,hostEvents:clean(ho.read()),guestEvents:clean(go.read())};
 }finally{h.dispose();g.dispose();for(const s of Object.values(sides))s.wake?.();}
}
test('enabling observation leaves real net wire bytes, simulation and remote presentation unchanged',async()=>{
 const off=await replay(false),on=await replay(true);assert.deepEqual(on.errors,[]);assert.deepEqual(off.errors,[]);
 assert.deepEqual(on.wire,off.wire);assert.deepEqual(on.host,off.host);assert.deepEqual(on.guest,off.guest);assert.deepEqual(on.present,off.present);
 assert.equal(off.hostEvents.recorded,0);assert.equal(off.guestEvents.recorded,0);
 const consume=on.hostEvents.events.filter(e=>e.type==='authority.consume'&&e.seat===1&&e.action==='attack');assert.equal(consume.length,2);assert.deepEqual(consume.map(e=>e.counter),[1,2]);
 assert(on.guestEvents.events.some(e=>e.type==='state.apply'&&e.consumed?.[1]?.attack===2));assert(on.hostEvents.events.some(e=>e.type==='state.publish'));
 assert.equal(on.hostEvents.errors,0);assert.equal(on.guestEvents.errors,0);assert.equal(on.hostEvents.dropped,0);assert.equal(on.guestEvents.dropped,0);
});
