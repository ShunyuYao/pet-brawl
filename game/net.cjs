'use strict';
// LAN session adapter over the host's `pet.sessions` bridge (HTML work, experimental).
// Host = seat 0 and runs the authoritative room; guest = seat 1 sends inputs only
// (SPEC §10). The guest predicts locally: on every host snapshot it rewinds to the
// snapshot and replays its own inputs the host has not acknowledged yet.
// Limits honoured (demo/core/peer-session/contracts.js): latest lane ≤ 30 calls/s,
// ≤ 60 KB per message, ≤ 8 latest keys; transfers ≤ 1 MB each, one at a time.
const R=require('./room.cjs'),M=require('./match.cjs'),I=require('./input.cjs');
const RemoteMotion=require('./remote-motion.cjs');

const PROTOCOL={id:'pet-brawl',version:1},PURPOSE='brawl.profile.v1';
const VIEW_MS=40,INPUT_MS=40,SIM_MS=1000/60,STALE_MS=1500;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const encode=value=>{const b=new TextEncoder().encode(JSON.stringify(value));let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
const decode=value=>{if(typeof value!=='string'||value.length>1400000)throw Error('invalid_profile');return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))));};

function create(sdk,{onView=()=>{},onConnection=()=>{},onError=()=>{},onAsset=()=>{},now=()=>Date.now(),pauseTimeoutMs}={}){
  let context=null,host=false,room=null,connection='waiting',closed=false,disposed=false,cursor=0,epoch=0;
  let profile=null,asset=null,sentSignature='',transferJob=null,lastHeard=0,lastHello=0,serial=0,applied=0;
  let pad=I.create(),readySeq=0,readyWant=false,guestReadySeq=0,sendingView=false,sendingInput=false,lastInputSent=0,lastSentKey='';
  // Guest prediction state
  let view=null,pred=null,predMatchNo=-1,seq=0,history=[],lastViewAt=0;
  const remoteMotion=RemoteMotion.create();
  const timers=[];
  const fail=e=>onError(e instanceof Error?e:Error(String(e)));
  const status=s=>{if(connection!==s){connection=s;onConnection(s);}};
  const send=(type,payload,key)=>closed||disposed?Promise.reject(Error('session_closed')):sdk.send({type,payload,lane:'latest',key});
  function end(reason='peer_left'){
    if(closed)return;closed=true;timers.forEach(clearInterval);status('closed');
    if(room){room.room.notice=reason;onView(room.view(0));}
    else if(view){view={...view,notice:reason};onView(view);}
  }
  async function upload(){
    if(transferJob||!asset||connection!=='connected'||closed||sentSignature===profile.signature)return;
    const signature=profile.signature,payload=encode({v:1,signature,asset});
    if(payload.length>Math.ceil(1024*1024/3)*4){fail(Error('asset_too_large'));sentSignature=signature;return;}
    transferJob=sdk.transfer({purpose:PURPOSE,contentType:'application/octet-stream',dataBase64:payload})
      .then(()=>{sentSignature=signature;}).catch(fail).finally(()=>{transferJob=null;});
  }
  // ---------- host ----------
  let hostLast=0,hostAcc=0;
  function hostTick(){
    const t=now();if(!hostLast)hostLast=t;hostAcc+=Math.min(2000,t-hostLast);hostLast=t;
    const guest=room.seat(1);
    if(guest){
      const online=connection==='connected'&&t-lastHeard<STALE_MS;
      if(guest.connected!==online)guest.connected=online;
      if(!online)room.pauseFor('peer_lost');else room.resume();
      room.checkPause();
    }
    while(hostAcc>=SIM_MS){room.tick();hostAcc-=SIM_MS;}
  }
  let lastLocalView=0;
  async function publish(){
    // The host's own screen reads the room directly; refresh its lobby view ~10×/s.
    if(now()-lastLocalView>=100){lastLocalView=now();onView(room.view(0));}
    if(connection!=='connected'||sendingView||closed)return;sendingView=true;
    try{await send('brawl.view',{serial:++serial,view:room.view(1)},'view');}catch(e){if(!/backpressure/.test(e.message))fail(e);}finally{sendingView=false;}
  }
  // ---------- guest ----------
  let guestLast=0,guestAcc=0;
  function guestTick(){
    const t=now();if(!guestLast)guestLast=t;guestAcc+=Math.min(500,t-guestLast);guestLast=t;
    while(guestAcc>=SIM_MS){
      guestAcc-=SIM_MS;
      if(!pred||view?.pause||pred.phase==='results')continue;
      pad.seq=++seq;history.push({seq,input:I.clone(pad)});if(history.length>240)history.shift();
      M.setInput(pred,1,pad);M.step(pred);
    }
  }
  function reconcile(v){
    if(!v.match){pred=null;history=[];return;}
    const base=M.restore(v.match);
    if(v.matchNo!==predMatchNo){predMatchNo=v.matchNo;history=history.filter(h=>h.seq>v.ack);}
    history=history.filter(h=>h.seq>v.ack);
    if(!v.pause)for(const h of history){M.setInput(base,1,h.input);M.step(base);if(base.phase==='results')break;}
    pred=base;
  }
  async function guestSend(force=false){
    if(connection!=='connected'||sendingInput||closed)return;
    const key=JSON.stringify([pad.x,pad.y,pad.run,pad.h,pad.c,readySeq]);
    if(!force&&key===lastSentKey&&now()-lastInputSent<200)return;
    if(!force&&now()-lastInputSent<34)return; // stay under 30 calls/s; the 25 Hz timer sends the rest
    sendingInput=true;
    try{
      if(profile&&now()-lastHello>1000){lastHello=now();await send('brawl.hello',{profile},'hello');}
      pad.seq=seq;lastSentKey=key;lastInputSent=now();
      await send('brawl.input',{input:I.clone(pad),readySeq,ready:readyWant},'input');
    }catch(e){if(!/backpressure/.test(e.message))fail(e);}finally{sendingInput=false;}
  }
  async function event(e){
    if(e.type==='closed'){end(e.reason||'peer_left');return;}
    if(e.type==='resync_required'){sentSignature='';return;}
    if(e.type==='transfer'&&e.purpose===PURPOSE){
      const data=await sdk.readTransfer({transferId:e.transferId});
      if(data.purpose!==PURPOSE||data.contentType!=='application/octet-stream')throw Error('invalid_profile');
      const value=decode(data.dataBase64);if(!value||value.v!==1||typeof value.signature!=='string')throw Error('invalid_profile');
      lastHeard=now();onAsset(host?1:0,value.signature,value.asset);return;
    }
    if(e.type!=='message')return;
    const {type,payload:p}=e.message;lastHeard=now();
    if(host){
      // The host only ever accepts a profile and controller input from the guest.
      if(type==='brawl.hello'){room.join(1,p?.profile);return;}
      if(type==='brawl.input'&&p&&typeof p==='object'){
        if(!room.seat(1))return;
        room.input(1,p.input);
        const s=Number(p.input?.seq);if(Number.isSafeInteger(s)&&s>room.room.ack)room.room.ack=s;
        if(Number.isSafeInteger(p.readySeq)&&p.readySeq>guestReadySeq){guestReadySeq=p.readySeq;try{room.ready(1,!!p.ready);}catch(err){fail(err);}}
      }
      return;
    }
    if(type!=='brawl.view'||!p||!Number.isSafeInteger(p.serial)||p.serial<=applied)return;
    if(!R.validView(p.view)||p.view.you!==1)throw Error('invalid_view');
    applied=p.serial;view=p.view;lastViewAt=now();remoteMotion.push(view,lastViewAt);reconcile(view);onView(view);
  }
  async function poll(){
    while(!disposed&&!closed){
      try{
        const b=await sdk.poll({cursor,waitMs:1000});if(disposed||closed)break;
        if(b.transportState==='closed'){for(const e of b.events)if(e.type==='closed'){end(e.reason);break;}end();break;}
        if(b.epoch!==epoch){epoch=b.epoch;sentSignature='';}
        status(b.transportState);if(b.transportState==='connected'&&b.events.length)lastHeard=now();
        for(const e of b.events){try{await event(e);}catch(err){fail(err);}}cursor=b.cursor;
      }catch(e){if(/session_closed|caller_disposed|permission_denied|permission_revoked|account_changed/.test(e.message)){end(e.message);break;}status('reconnecting');fail(e);await pause(350);}
    }
  }
  async function start(localProfile,localAsset){
    if(context)throw Error('already_started');
    context=await sdk.getContext();if(!context)throw Error('no_invitation');
    if(context.protocol?.id!==PROTOCOL.id||context.protocol?.version!==PROTOCOL.version)throw Error('protocol_mismatch');
    host=context.role==='host';profile=R.validateProfile(localProfile);asset=localAsset||null;
    if(host){room=R.create({seed:context.invitationId,now,pauseTimeoutMs});room.join(0,profile);onView(room.view(0));}
    const joined=await sdk.join();epoch=joined.epoch;lastHeard=now();status(joined.status==='connected'?'connected':'waiting');void poll();
    if(host){timers.push(setInterval(()=>{try{hostTick();}catch(e){fail(e);}},SIM_MS));timers.push(setInterval(()=>void publish(),VIEW_MS));}
    else{timers.push(setInterval(()=>{try{guestTick();}catch(e){fail(e);}},SIM_MS));timers.push(setInterval(()=>void guestSend(),INPUT_MS));}
    timers.push(setInterval(()=>void upload(),250));
    return context;
  }
  return {
    start,
    role:()=>context?.role||null,
    // Host: the authoritative room. Guest: the latest host view (lobby, players, events).
    peek:()=>room?room.view(0):view,
    // What to draw right now: the host's live match, or the guest's prediction.
    live:()=>room?room.room.match:pred,
    // Drawing the remote peer must not rewind when our input ack advances.
    // Local prediction stays immediate and retains its full collision world.
    present:()=>room?room.room.match:remoteMotion.sample(pred,now(),closed),
    hostStale:()=>!host&&!!view&&(connection!=='connected'||now()-lastViewAt>STALE_MS),
    setProfile(p,a){profile=R.validateProfile(p);asset=a||null;sentSignature='';lastHello=0;if(room)room.join(0,profile);},
    setInput(v){if(room)room.input(0,v);else{pad=I.normalize(v,pad);pad.seq=seq;void guestSend();}},
    ready(value){if(closed)throw Error('session_closed');if(room)room.ready(0,value);else{readySeq++;readyWant=!!value;lastHello=0;void guestSend(true);}},
    setTime(sec){if(!room)throw Error('host_only');room.setTime(sec);},
    setStage(id){if(!room)throw Error('host_only');room.setStage(id);},
    async leave(){try{await sdk.leave();}finally{end('peer_left');}},
    dispose(){disposed=true;timers.forEach(clearInterval);},
    diagnostics:()=>({role:context?.role,connection,closed,serial,applied,seq,ack:view?.ack??room?.room.ack,history:history.length,profile:profile?.signature,sentSignature}),
  };
}
module.exports={create,PROTOCOL,PURPOSE,STALE_MS};
