'use strict';
// pet-kit owns the invitation, poll loop, send budgets, reliable events and looks.
// Brawl keeps its lossless state codec, authoritative rules and frame-indexed prediction.
const R=require('./room.cjs'),I=require('./input.cjs');
const {Room}=require('../vendor/pet-kit/index.js');
const LocalMotion=require('./local-motion.cjs'),RemoteMotion=require('./remote-motion.cjs'),StateWire=require('./state-wire.cjs'),Prediction=require('./prediction.cjs');
const PROTOCOL=Object.freeze({id:'pet-brawl',version:3}),PURPOSE='brawl.profile.v2';
const VIEW_MS=40,SIM_MS=1000/60,STALE_MS=1500;
function create(sdk,{onView=()=>{},onConnection=()=>{},onError=()=>{},onAsset=()=>{},now=()=>Date.now(),pauseTimeoutMs,observation=null}={}){
  let context=null,host=false,room=null,connection='waiting',closed=false,disposed=false,epoch=0,profile=null;
  let lastHeard=0,serial=0,applied=0,peerOnline=false,lastLocalView=0,prepared=null,preparedView=null;
  let pad=I.create(),readySeq=0,readyWant=false,guestReadySeq=0,lastInputSent=0,lastSentKey='';
  let view=null,pred=null,predMatchNo=-1,seq=0,lastViewAt=0,predictionReset=null,inMatch=false;
  const prediction=Prediction.create(),localMotion=LocalMotion.create(),remoteMotion=RemoteMotion.create(),stateWire=StateWire.create({now}),timers=[];
  const fail=e=>{if(!disposed)onError(e instanceof Error?e:Error(String(e)));};
  function initHost(){host=kit.isHost();if(host&&!room){room=R.create({now,pauseTimeoutMs});room.join(0,profile);onView(room.view(0));}}
  function status(s){
    if(disposed||closed&&s!=='closed')return;
    initHost();if(connection!==s){connection=s;onConnection(s);if(observation?.enabled)observation.network('state',{state:s,epoch});}
  }
  function end(reason='peer_left'){
    if(closed)return;closed=true;stateWire.close();timers.forEach(clearInterval);kit.dispose();status('closed');
    if(room){room.room.notice=reason;onView(room.view(0));}else if(view){view={...view,notice:reason};onView(view);}
  }
  let hostLast=0,hostAcc=0;
  function hostTick(){
    const t=now();if(!hostLast)hostLast=t;hostAcc+=Math.min(2000,t-hostLast);hostLast=t;
    const guest=room.seat(1);
    if(now()-lastLocalView>=100){lastLocalView=now();onView(room.view(0));}
    if(guest){
      const online=connection==='connected'&&peerOnline&&t-lastHeard<STALE_MS;
      if(guest.connected!==online)guest.connected=online;
      // A retained ready intent may arrive before this tick restores the seat's
      // online flag. Re-evaluate once both seats are ready instead of requiring
      // another click (or a new ready sequence) after recovery.
      if(online&&guest.ready&&room.seat(0)?.ready)room.ready(1,true);
      if(!online)room.pauseFor('peer_lost');else room.resume();
      room.checkPause();
    }
    while(hostAcc>=SIM_MS){const before=observation?.enabled?observation.beforeTick(room.room.matchNo,room.room.match):null;room.tick();if(observation?.enabled)observation.afterTick(before,room.room.matchNo,room.room.match);hostAcc-=SIM_MS;}
  }
  let guestLast=0,guestAcc=0;
  function guestTick(){
    const t=now();if(!guestLast)guestLast=t;guestAcc+=Math.min(500,t-guestLast);guestLast=t;
    while(guestAcc>=SIM_MS){
      guestAcc-=SIM_MS;
      if(!pred||view?.pause||pred.phase==='results'||predictionReset||connection!=='connected'||t-lastViewAt>STALE_MS)continue;
      const previousFrame=pred.frame;pad.seq=++seq;prediction.tick(pad);pred=prediction.live();
      if(pred.frame!==previousFrame)localMotion.advance(t-guestAcc);
    }
  }
  function reconcile(v){
    const previous=pred;
    prediction.reconcile(v,{reset:predictionReset||(lastViewAt&&now()-lastViewAt>STALE_MS?'stale':null)});
    predictionReset=null;pred=prediction.live();predMatchNo=v.matchNo;
    localMotion.reconcile(previous,pred,now(),{reset:prediction.diagnostics().predictionReset,paused:!!v.pause});
  }

  const kit=Room.create(sdk,{
    protocol:PROTOCOL,purpose:PURPOSE,maxPlayers:2,appearancePolicy:'continuous',now,compress:false,pollGapMs:0,
    rates:{match:25,lobby:25,up:25},budget:{callsPerSecond:28},
    prefs:{defaults:{},validate:p=>p.profile?{profile:R.validateProfile(p.profile)}:{}},
    async hostState(){
      if(!room||closed||disposed)return null;
      preparedView=room.view(1);prepared=await stateWire.encode({serial:++serial,view:preparedView});
      return stateWire.current(prepared)&&!closed&&!disposed?prepared.envelope:null;
    },
    onStateSent(state){
      if(host&&prepared&&state===prepared.envelope&&stateWire.sent(prepared)&&observation?.enabled)observation.published(prepared.packet.serial,preparedView);
    },
    guestState(){
      const key=JSON.stringify([pad.x,pad.y,pad.run,pad.h,pad.c,readySeq]);
      if(key===lastSentKey&&now()-lastInputSent<200)return undefined;
      lastSentKey=key;lastInputSent=now();pad.seq=seq;
      return {input:I.clone(pad),readySeq,ready:readyWant,stateAck:stateWire.feedback()};
    },
    onConnection:status,onError:fail,onClosed:()=>end('peer_left'),onPeerLeft:()=>end('peer_left'),
    onReset(e){
      epoch=e.epoch;
      if(e.reason==='epoch'){stateWire.reset();predictionReset='epoch';}else stateWire.resync();
      if(observation?.enabled)observation.network('reset',{reason:e.reason,epoch});
    },
    onLobby(lobby){
      if(closed||disposed)return;initHost();if(!host)return;
      const p=lobby.players.find(p=>p.slot===1);peerOnline=!!p?.online;
      if(p?.prefs?.profile){room.join(1,p.prefs.profile);lastHeard=now();}
    },
    onAsset(signature,asset,seat){if(!closed&&!disposed)onAsset(seat??(host?1:0),signature,asset);},
    async onState(p,seat){
      if(closed||disposed)return;lastHeard=now();
      if(host){
        if(seat!==1||!p||typeof p!=='object')return;
        stateWire.acknowledge(p.stateAck);if(!room.seat(1))return;
        room.input(1,p.input);
        const s=Number(p.input?.seq);if(Number.isSafeInteger(s)&&s>room.room.ack)room.room.ack=s;
        if(Number.isSafeInteger(p.readySeq)&&p.readySeq>guestReadySeq){guestReadySeq=p.readySeq;room.ready(1,!!p.ready);}
        return;
      }
      if(seat!==0)return;
      await stateWire.decode(p,decoded=>{
        if(closed||disposed)throw Error('session_closed');
        if(!R.validView(decoded.view)||decoded.view.you!==1||decoded.serial<=applied)throw Error('invalid_view');
        const previous=pred,previousMatchNo=predMatchNo;
        reconcile(decoded.view);view=decoded.view;lastViewAt=now();remoteMotion.push(view,lastViewAt,decoded.serial);onView(view);applied=decoded.serial;
        if(observation?.enabled)observation.applied({serial:decoded.serial,view,previous,pred,previousMatchNo,predictionReset:prediction.diagnostics().predictionReset});
      });
    },
  });
  async function start(localProfile,localAsset){
    if(context)throw Error('already_started');if(closed||disposed)throw Error('session_closed');
    profile=R.validateProfile(localProfile);
    context=await kit.start(profile,localAsset,{profile});
    if(closed||disposed)throw Error('session_closed');initHost();epoch=kit.stats().epoch;lastHeard=now();
    timers.push(setInterval(()=>{try{
      if(host){hostTick();const active=!!room.room.match&&room.room.match.phase!=='results';if(active!==inMatch){inMatch=active;kit.setMatch(active);}}
      else guestTick();
    }catch(e){fail(e);}},SIM_MS));
    return context;
  }
  return {
    start,role:()=>context?.role||null,
    peek:()=>room?room.view(0):view,
    // What to draw right now: the host's live match, or the guest's prediction.
    live:()=>room?room.room.match:pred,
    // Drawing the remote peer must not rewind when our input ack advances.
    // Local prediction stays immediate and retains its full collision world.
    present:()=>{
      if(room){if(observation?.enabled)observation.presentation({mode:'authority-live',localSeat:0});return room.room.match;}
      return remoteMotion.sample(localMotion.sample(pred,now(),closed||!!view?.pause),now(),closed,observation?.enabled?value=>observation.presentation(value):null);
    },
    hostStale:()=>!host&&!closed&&!disposed&&!!view&&(connection!=='connected'||now()-lastViewAt>STALE_MS),

    setProfile(p,a){profile=R.validateProfile(p);kit.setProfile(profile,a);kit.setPrefs({profile});if(room)room.join(0,profile);},
    setInput(v){if(room)room.input(0,v);else{pad=I.normalize(v,pad);pad.seq=seq;void kit.flushState().catch(fail);}},
    ready(value){if(closed)throw Error('session_closed');if(room)room.ready(0,value);else{readySeq++;readyWant=!!value;void kit.flushState().catch(fail);}},
    setTime(sec){if(!room)throw Error('host_only');room.setTime(sec);},
    setStage(id){if(!room)throw Error('host_only');room.setStage(id);},
    async leave(){await kit.leave();end('peer_left');},
    dispose(){disposed=true;stateWire.close();kit.dispose();timers.forEach(clearInterval);},
    diagnostics:()=>({role:context?.role,connection,closed,serial,applied,seq,ack:view?.ack??room?.room.ack,...prediction.diagnostics(),profile:profile?.signature,sentSignature:kit.stats().ownSentSignature,stateWire:stateWire.diagnostics(),kit:kit.stats()}),
  };
}
module.exports={create,PROTOCOL,PURPOSE,STALE_MS};
