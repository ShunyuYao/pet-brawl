'use strict';
// Opt-in local evidence only. No counters or timestamps enter the wire protocol.
// All times use this renderer's performance.now(); consumers must calibrate clocks.
const I=require('./input.cjs');
const LIMITS=Object.freeze({defaultCapacity:8192,maxCapacity:32768});
const copy=v=>JSON.parse(JSON.stringify(v));
const countList=list=>Array.from({length:2},(_,seat)=>Object.fromEntries(I.PRESSES.map(k=>[k,Number.isSafeInteger(list?.[seat]?.[k])?list[seat][k]:null])));
const counters=m=>m?countList(m.applied?.map(p=>p.c)):null;
const fighter=f=>f?{x:f.x,y:f.y,state:f.state,stocks:f.stocks}:null;
function create({now=()=>performance.now()}={}){
 let enabled=false,capacity=LIMITS.defaultCapacity,ring=[],head=0,size=0,recorded=0,dropped=0,errors=0,lastApply=null,authority=null,presentation=null;
 function guard(fn){if(!enabled)return null;try{return fn();}catch{errors++;return null;}}
 function write(type,data,t=now()){
  if(!Number.isFinite(t))throw Error('invalid_observation_clock');
  const e={id:++recorded,type,t,...data};
  if(size===capacity){ring[head]=e;head=(head+1)%capacity;dropped++;}
  else{ring[(head+size)%capacity]=e;size++;}return e;
 }
 function read(){return {v:1,enabled,capacity,recorded,dropped,errors,clock:'performance.now',events:copy(Array.from({length:size},(_,i)=>ring[(head+i)%capacity]))};}
 return {
  get enabled(){return enabled;},
  start(options={}){const n=options.capacity??LIMITS.defaultCapacity;if(!Number.isSafeInteger(n)||n<1||n>LIMITS.maxCapacity)throw Error('invalid_observation_capacity');capacity=n;ring=new Array(n);head=0;size=0;recorded=0;dropped=0;errors=0;lastApply=null;authority=null;presentation=null;enabled=true;return read();},
  stop(){enabled=false;return read();},read,
  drain(){const result=read();ring=enabled?new Array(capacity):[];head=0;size=0;return result;},
  key(data){return guard(()=>write('input.key',{seat:data.seat,matchNo:data.matchNo,action:data.action,counter:data.counter,code:data.code,trusted:!!data.trusted},data.t));},
  beforeTick(matchNo,m){return guard(()=>m?{matchNo,consumed:counters(m)}:null);},
  afterTick(before,matchNo,m){return guard(()=>{
   if(!m)return;const consumed=counters(m);authority={serial:null,matchNo,consumed};
   if(!before||before.matchNo!==matchNo)return;
   for(let seat=0;seat<2;seat++)for(const action of I.PRESSES){const previousCounter=before.consumed[seat][action],counter=consumed[seat][action];
    if(Number.isSafeInteger(previousCounter)&&counter>previousCounter)write('authority.consume',{seat,matchNo,action,previousCounter,counter,delta:counter-previousCounter,frame:m.frame,phase:m.phase});}
  });},
  published(serial,v){return guard(()=>write('state.publish',{serial,matchNo:v.matchNo,frame:v.match?.frame??null,phase:v.match?.phase??v.phase,consumed:counters(v.match)}));},
  applied({serial,view:v,previous,pred,previousMatchNo,predictionReset=null}){return guard(()=>{
   const t=now(),consumed=counters(v.match),gapMs=lastApply===null?null:t-lastApply;lastApply=t;authority={serial,matchNo:v.matchNo,consumed};
   write('state.apply',{serial,matchNo:v.matchNo,frame:v.match?.frame??null,phase:v.match?.phase??v.phase,paused:!!v.pause||!!v.match?.paused,gapMs,consumed},t);
   if(!pred)return;
   for(const f of pred.fighters){const b=previous?.fighters.find(x=>x.seat===f.seat);let kind='continuous';
    if(!b)kind='initial';else if(previousMatchNo!==v.matchNo||previous.stage!==pred.stage)kind='round';
    else if(previous.phase!==pred.phase)kind='phase';else if(b.state==='respawn'||f.state==='respawn')kind='respawn';
    else if(b.stocks!==f.stocks||['dead','out'].includes(b.state)||['dead','out'].includes(f.state))kind='death';
    const dx=b?f.x-b.x:null,dy=b?f.y-b.y:null;
    write('correction',{serial,matchNo:v.matchNo,previousMatchNo,seat:f.seat,local:f.seat===v.you,kind,predictionReset,dx,dy,distance:b?Math.hypot(dx,dy):null,before:fighter(b),after:fighter(f),beforeFrame:previous?.frame??null,afterFrame:pred.frame},t);
   }
  });},
  presentation(value){return guard(()=>{presentation={localSeat:value.localSeat??null,mode:String(value.mode).slice(0,32),lowerSerial:value.lowerSerial??null,upperSerial:value.upperSerial??null,
   lowerFrame:value.lowerFrame??null,upperFrame:value.upperFrame??null,alpha:value.alpha??null,lowerConsumed:value.lowerConsumed?countList(value.lowerConsumed):null,upperConsumed:value.upperConsumed?countList(value.upperConsumed):null,
   fighters:(value.fighters||[]).slice(0,2).map(f=>({seat:f.seat,sourceMode:String(f.sourceMode).slice(0,32)}))};});},
  scene({matchNo,match:m,fighters}){return guard(()=>{
   const sources=presentation?.fighters||[];
   write('scene.submit',{matchNo,frame:m?.frame??null,phase:m?.phase??null,
    authoritySerial:authority?.serial??null,authorityMatchNo:authority?.matchNo??null,authorityConsumed:authority?.consumed??null,
    presentation, fighters:fighters.slice(0,2).map(f=>({...f,sourceMode:sources.find(s=>s.seat===f.seat)?.sourceMode??(presentation?.mode==='authority-live'?'authority-live':'unknown')}))});
  });},
  network(kind,data){return guard(()=>write('network.'+kind,{state:data.state==null?null:String(data.state).slice(0,32),reason:data.reason==null?null:String(data.reason).slice(0,96),epoch:data.epoch??null}));},
 };
}
module.exports={create,LIMITS};
