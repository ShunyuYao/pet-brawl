'use strict';
// Lobby + match lifecycle shared by solo and the LAN host (SPEC §9, §10). Seats only
// express intents (ready, input); the room decides everything else.
const M=require('./match.cjs'),St=require('./stage.cjs'),AI=require('./ai.cjs'),I=require('./input.cjs');

const KINDS=['sprite','doll3d','toy'];
const TIME_OPTIONS=[300,480,720];
const CPU_LEVELS=[0,1,2,3];
const PAUSE_TIMEOUT_MS=20000;
function validateProfile(p){
  if(!p||typeof p!=='object')throw Error('invalid_profile');
  const name=typeof p.name==='string'?[...p.name.replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,'')].slice(0,24).join('').trim():'';
  if(!name||typeof p.signature!=='string'||!/^[A-Za-z0-9:._-]{1,96}$/.test(p.signature)||!KINDS.includes(p.kind))throw Error('invalid_profile');
  const color=/^#[0-9a-f]{6}$/i.test(p.color||'')?p.color:'#ff7a59';
  const style=p.style==null?'hammer':p.style;if(!M.STYLES[style])throw Error('invalid_profile');
  return {name,signature:p.signature,kind:p.kind,color,style};
}
function create({seed='room',solo=false,now=()=>Date.now(),pauseTimeoutMs=PAUSE_TIMEOUT_MS}={}){
  const room={phase:'lobby',settings:{timeLimit:480,stocks:3,cpuLevel:2,stage:St.DEFAULT},players:[],matchNo:0,match:null,solo,notice:'',ack:0,pause:null};
  let ai=[];const lastInput=[null,null];
  const seat=n=>room.players.find(p=>p.seat===n);
  function join(n,profile,{isAI=false}={}){
    const p=validateProfile(profile);let s=seat(n);
    if(!s){s={seat:n,ready:false,connected:true,ai:isAI};room.players.push(s);room.players.sort((a,b)=>a.seat-b.seat);}
    Object.assign(s,p,{connected:true});if(isAI)s.ready=true;return s;
  }
  function leave(n){const s=seat(n);if(s){s.connected=false;s.ready=false;}}
  const inMatch=()=>room.match&&room.match.phase!=='results';
  function setStage(id){if(!St.STAGES[id])throw Error('invalid_stage');if(inMatch())throw Error('invalid_phase');room.settings.stage=id;for(const p of room.players)if(!p.ai)p.ready=false;}
  function setTime(sec){if(!TIME_OPTIONS.includes(sec))throw Error('invalid_time');if(inMatch())throw Error('invalid_phase');room.settings.timeLimit=sec;for(const p of room.players)if(!p.ai)p.ready=false;}
  function setCpuLevel(l){if(!CPU_LEVELS.includes(l))throw Error('invalid_level');if(inMatch())throw Error('invalid_phase');room.settings.cpuLevel=l;}
  function ready(n,value){
    const s=seat(n);if(!s)throw Error('invalid_seat');
    if(inMatch())return;
    s.ready=!!value;
    const humans=room.players.filter(p=>!p.ai&&p.connected);
    if(humans.length>=(room.solo?1:2)&&room.players.length===2&&humans.every(p=>p.ready))begin();
  }
  function begin(){
    room.matchNo++;room.phase='match';room.notice='';room.pause=null;
    const styles=[0,1].map(i=>seat(i)?.style||'hammer');
    const m=M.create({stocks:room.settings.stocks,timeLimit:room.settings.timeLimit,countdown:true,styles,stage:room.settings.stage});
    // Keep the current controller counters as the baseline: lobby presses are not moves.
    for(const i of [0,1])if(lastInput[i]){M.setInput(m,i,lastInput[i]);M.resetInputBaseline(m,i);}
    room.match=m;
    ai=room.players.filter(p=>p.ai).map(p=>({seat:p.seat,brain:AI.create({level:room.settings.cpuLevel,seed:room.matchNo*7+p.seat})}));
    for(const p of room.players)if(!p.ai)p.ready=false;
  }
  function input(n,value){lastInput[n]=I.normalize(value,lastInput[n]);if(room.match)M.setInput(room.match,n,value);}
  function tick(){
    if(!room.match||room.pause)return;
    for(const a of ai)M.setInput(room.match,a.seat,a.brain.think(room.match,a.seat));
    M.step(room.match);
  }
  // Disconnect handling: pause the fight and give the peer a grace period.
  function pauseFor(reason){if(!inMatch()||room.pause)return;room.pause={reason,since:now()};room.match.paused=true;}
  function resume(){if(!room.pause)return;room.pause=null;if(room.match)room.match.paused=false;}
  function checkPause(){
    if(room.pause&&now()-room.pause.since>=pauseTimeoutMs){
      room.pause=null;room.notice='peer_left';
      if(room.match&&room.match.phase!=='results'){room.match.paused=false;room.match.phase='results';room.match.result={winner:0,reason:'forfeit',frame:room.match.frame};}
    }
  }
  function view(you){
    return {v:1,you,solo:room.solo,phase:room.phase,settings:{...room.settings},matchNo:room.matchNo,notice:room.notice,ack:room.ack,
      pause:room.pause?{reason:room.pause.reason,remainingMs:Math.max(0,pauseTimeoutMs-(now()-room.pause.since))}:null,
      players:room.players.map(p=>({seat:p.seat,name:p.name,signature:p.signature,kind:p.kind,color:p.color,style:p.style,ready:p.ready,connected:p.connected,ai:p.ai})),
      match:room.match?M.snapshot(room.match):null};
  }
  return {room,join,leave,setTime,setStage,setCpuLevel,ready,input,tick,view,seat,pauseFor,resume,checkPause};
}
function validView(v){
  return !!v&&v.v===1&&[0,1].includes(v.you)&&['lobby','match'].includes(v.phase)&&Number.isSafeInteger(v.matchNo)&&
    v.settings&&TIME_OPTIONS.includes(v.settings.timeLimit)&&!!St.STAGES[v.settings.stage]&&
    Array.isArray(v.players)&&v.players.length<=2&&v.players.every(p=>{try{validateProfile(p);return [0,1].includes(p.seat);}catch{return false;}})&&
    (v.match===null||M.validSnapshot(v.match));
}
module.exports={create,validateProfile,validView,KINDS,TIME_OPTIONS,CPU_LEVELS,PAUSE_TIMEOUT_MS};
