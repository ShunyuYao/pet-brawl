'use strict';
// LAN protocol tests over an in-memory pet.sessions double (SPEC §10, §11-19/20/21).
const test=require('node:test'),assert=require('node:assert/strict');
const N=require('../game/net.cjs'),Solo=require('../game/solo.cjs'),I=require('../game/input.cjs'),R=require('../game/room.cjs');
// Mimics pet.sessions semantics: latest lane keeps only the newest value per key,
// poll long-waits, transfers are events. `cut()` silences one side (lost Wi-Fi).
function pair({latency=15}={}){
  const sides={host:{events:[],cursor:0,waiter:null,assets:new Map(),mute:false},guest:{events:[],cursor:0,waiter:null,assets:new Map(),mute:false}};
  let open=true;const joined={host:false,guest:false};const sent={host:[],guest:[]};
  const push=(side,e)=>{side.events.push({cursor:++side.cursor,...e});side.waiter?.();};
  const other=r=>r==='host'?sides.guest:sides.host;
  const make=role=>{const me=sides[role];let seq=0;return {
    getContext:async()=>({invitationId:'00000000-0000-4000-8000-000000000001',artifactHash:'a'.repeat(64),protocol:{id:'pet-brawl',version:1},role,peer:{sessionPeerId:'p',displayName:'peer'},expiresAt:Date.now()+1e6}),
    join:async()=>{joined[role]=true;if(joined.host&&joined.guest){push(sides.host,{type:'connected'});push(sides.guest,{type:'connected'});}return {status:joined.host&&joined.guest?'connected':'waiting',epoch:1,limits:{},peerStatus:'online'};},
    send:async m=>{if(!open)throw Error('session_closed');if(JSON.stringify(m).length>60*1024)throw Error('invalid_request');sent[role].push({t:Date.now(),type:m.type});const s=++seq;
      if(!me.mute)setTimeout(()=>push(other(role),{type:'message',seq:s,message:JSON.parse(JSON.stringify(m))}),latency);return {status:'queued',seq:s};},
    poll:async({cursor=0,waitMs=0})=>{if(me.cursor<=cursor&&waitMs&&open)await new Promise(r=>{const t=setTimeout(r,waitMs);me.waiter=()=>{clearTimeout(t);me.waiter=null;r();};});
      return {cursor:me.cursor,events:me.events.filter(e=>e.cursor>cursor),transportState:!open?'closed':joined.host&&joined.guest?'connected':'waiting',epoch:1};},
    transfer:async t=>{const id=crypto.randomUUID();other(role).assets.set(id,{...t,transferId:id});setTimeout(()=>push(other(role),{type:'transfer',transferId:id,purpose:t.purpose}),latency);return {transferId:id,sha256:'0'.repeat(64),byteLength:1};},
    readTransfer:async({transferId})=>me.assets.get(transferId),
    leave:async()=>{open=false;push(sides.host,{type:'closed',reason:'peer_left'});push(sides.guest,{type:'closed',reason:'peer_left'});return {released:true,peerAcknowledged:true};},
  };};
  return {host:make('host'),guest:make('guest'),cut:role=>{sides[role].mute=true;},sent};
}
const wait=async(fn,label,ms=8000)=>{const until=Date.now()+ms;while(Date.now()<until){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,15));}throw Error('timeout '+label);};
const P=(name,sig)=>({name,signature:sig,kind:'sprite',color:'#ff0000'});
// Every transport created by a test is disposed afterwards, pass or fail.
const live=[];test.afterEach(()=>{for(const t of live.splice(0))t.dispose();});
async function lobby(opts={}){
  const sdk=pair(opts),views={h:null,g:null},assets={h:[],g:[]},errors=[];
  const h=N.create(sdk.host,{onView:v=>views.h=v,onAsset:(s,sig,a)=>assets.h.push([s,sig,a]),onError:e=>errors.push(e.message),...opts.host});
  const g=N.create(sdk.guest,{onView:v=>views.g=v,onAsset:(s,sig,a)=>assets.g.push([s,sig,a]),onError:e=>errors.push(e.message)});
  live.push(h,g);
  await h.start(P('房主','sig-h'),{kind:'sprite',image:'data:image/png;base64,AAAA'});
  await g.start(P('客人','sig-g'),{kind:'sprite',image:'data:image/png;base64,BBBB'});
  await wait(()=>views.g?.players.length===2,'guest sees both players');
  return {sdk,h,g,views,assets,errors};
}
async function fight(L){
  L.h.ready(true);L.g.ready(true);
  await wait(()=>L.views.g?.match?.phase==='fight','fight starts',9000);
}

test('lobby: both players, time setting, assets exchanged, ready starts the fight',async()=>{
  const L=await lobby();
  assert.equal(L.views.g.you,1);assert.equal(L.views.g.players[1].name,'客人');
  await wait(()=>L.assets.h.length&&L.assets.g.length,'assets exchanged');
  assert.deepEqual(L.assets.h[0].slice(0,2),[1,'sig-g']);assert.deepEqual(L.assets.g[0].slice(0,2),[0,'sig-h']);
  L.h.setTime(720);await wait(()=>L.views.g.settings.timeLimit===720,'guest sees the time limit');
  assert.throws(()=>L.g.setTime(300),/host_only/);
  L.h.setStage('moon');await wait(()=>L.views.g.settings.stage==='moon','guest sees the host\'s stage');
  assert.throws(()=>L.g.setStage('town'),/host_only/,'only the host picks the stage');
  L.h.ready(true);await wait(()=>L.views.g.players[0].ready,'host ready visible');
  assert.equal(L.views.g.match,null,'no match until both are ready');
  L.g.ready(true);await wait(()=>L.views.g.match?.phase==='countdown','countdown');
  assert.equal(L.views.g.match.timeLimit,720*60);
  assert.equal(L.views.g.match.stage,'moon','the match is on the host\'s stage for both');
  assert.deepEqual(L.errors,[]);L.h.dispose();L.g.dispose();
});
test('guest input moves only the guest fighter; the guest sees its own move at once (prediction)',async()=>{
  const L=await lobby({latency:60});await fight(L);
  const hx=L.h.live().fighters[0].x,gx=L.h.live().fighters[1].x;
  const pad=I.create();pad.x=-1;L.g.setInput(pad);
  const t0=Date.now();
  await wait(()=>L.g.live().fighters[1].x<gx-1,'guest prediction moves first',2000);
  const predicted=Date.now()-t0;
  await wait(()=>L.h.live().fighters[1].x<gx-5,'host moves the guest fighter',3000);
  assert(Math.abs(L.h.live().fighters[0].x-hx)<1e-9,'host fighter untouched');
  assert(predicted<120,'prediction visible in '+predicted+' ms despite 60 ms latency');
  L.h.dispose();L.g.dispose();
});
test('five J presses from the guest are all processed by the host',async()=>{
  const L=await lobby();await fight(L);
  const pad=I.create();
  for(let i=0;i<5;i++){I.press(pad,'attack');L.g.setInput(pad);await new Promise(r=>setTimeout(r,150));}
  await wait(()=>L.h.live().stats[1].pressesSeen.attack===5,'host saw 5 presses',3000);
  assert(L.h.live().stats[1].attacksStarted>=3,'the presses became moves');
  L.h.dispose();L.g.dispose();
});
test('rate limit: the guest never sends more than 30 messages per second',async()=>{
  const L=await lobby();await fight(L);
  const pad=I.create();const t0=Date.now();
  while(Date.now()-t0<1200){I.press(pad,'attack');pad.x=pad.x?0:1;L.g.setInput(pad);await new Promise(r=>setTimeout(r,5));}
  const sends=L.sdk.sent.guest.filter(s=>s.t>=t0+100&&s.t<t0+1100);
  assert(sends.length<=30,'sent '+sends.length+' in 1 s');
  L.h.dispose();L.g.dispose();
});
test('forged data: host ignores guest views and damage fields; guest rejects invalid views',async()=>{
  const L=await lobby();await fight(L);
  const before=L.h.live().fighters[1].percent;
  const fake=JSON.parse(JSON.stringify(L.views.g));fake.match.fighters[0].percent=999;fake.match.fighters[0].stocks=0;
  await L.sdk.guest.send({type:'brawl.view',payload:{serial:1e9,view:{...fake,you:0}},lane:'latest',key:'view'});
  await L.sdk.guest.send({type:'brawl.input',payload:{input:{x:1e9,percent:999,stocks:0,c:{attack:'x'}},readySeq:'no'},lane:'latest',key:'input'});
  await new Promise(r=>setTimeout(r,150));
  assert.equal(L.h.live().fighters[0].percent,0,'host fighter percent untouched');
  assert.equal(L.h.live().fighters[0].stocks,3);assert.equal(L.h.live().fighters[1].percent,before);
  assert([-1,0,1].includes(L.h.live().inputs[1].x),'direction clamped');
  await L.sdk.host.send({type:'brawl.view',payload:{serial:2e9,view:{...L.views.g,match:{...L.views.g.match,fighters:[{x:'nan'}]}}},lane:'latest',key:'forged'});
  await wait(()=>L.errors.includes('invalid_view'),'forged view rejected');
  L.h.dispose();L.g.dispose();
});
test('guest drop: both sides pause with a countdown, the host then declares the guest gone',async()=>{
  const L=await lobby({host:{pauseTimeoutMs:1200}});await fight(L);
  L.sdk.cut('guest'); // the guest's messages stop reaching the host
  await wait(()=>L.h.peek().pause,'host pauses',4000);
  const frame=L.h.live().frame;await new Promise(r=>setTimeout(r,200));
  assert.equal(L.h.live().frame,frame,'match frozen while paused');
  assert(L.h.peek().pause.remainingMs>0&&L.h.peek().pause.remainingMs<=1200,'countdown shown');
  await wait(()=>L.views.g.pause,'guest sees the pause',3000);
  await wait(()=>L.h.peek().notice==='peer_left',"host declares the guest gone",4000);
  assert.equal(L.h.live().phase,'results');assert.equal(L.h.live().result.reason,'forfeit');
  L.h.dispose();L.g.dispose();
});
test('host gone: the guest notices stale views',async()=>{
  const L=await lobby();await fight(L);
  L.sdk.cut('host');
  await wait(()=>L.g.hostStale(),'guest notices',4000);
  L.h.dispose();L.g.dispose();
});
test('solo room fights the computer',async()=>{
  let v=null;const s=Solo.create({onView:x=>v=x});live.push(s);await s.start(P('我','sig-me'));
  assert.equal(v.players.length,2);assert(v.players[1].ai);s.setTime(300);s.ready(true);
  await wait(()=>v.match?.phase==='fight','fight',6000);
  const x0=s.live().fighters[1].x;await wait(()=>Math.abs(s.live().fighters[1].x-x0)>5,'computer moves',6000);
  s.dispose();
});
test('room view validation',()=>{
  const r=R.create();r.join(0,P('a','sig-a'));assert(R.validView(r.view(0)));
  assert(!R.validView({...r.view(0),settings:{timeLimit:5}}));
  assert.throws(()=>r.join(1,{name:'x',signature:'bad sig!',kind:'sprite'}),/invalid_profile/);
});
