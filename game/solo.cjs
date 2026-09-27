'use strict';
// Local driver: same room rules, seat 1 is the computer. No network needed.
const R=require('./room.cjs');
const RIVAL={name:'电脑 · 奶酪教头',signature:'builtin:cpu-cheddar',kind:'toy',color:'#6c7cff',style:'hammer'};
const FRAME=1000/60;
function create({onView=()=>{},onConnection=()=>{},now=()=>Date.now()}={}){
  let room=null,timer=null,last=0,acc=0,lastView=0;
  return {
    role:()=>'solo',
    // The solo player renders the authoritative room directly (no prediction needed).
    peek:()=>room?room.view(0):null,
    live:()=>room?.room.match||null,
    async start(profile){
      room=R.create({seed:'solo:'+now(),solo:true});room.join(0,profile);room.join(1,RIVAL,{isAI:true});onConnection('solo');
      last=now();
      timer=setInterval(()=>{const t=now();acc+=Math.min(2000,t-last);last=t;while(acc>=FRAME){room.tick();acc-=FRAME;}if(t-lastView>=100){lastView=t;onView(room.view(0));}},FRAME);
      onView(room.view(0));
    },
    setProfile(p){room?.join(0,p);},
    setInput(v){room?.input(0,v);},
    ready(v){room.ready(0,v);onView(room.view(0));},
    setTime(sec){room.setTime(sec);onView(room.view(0));},
    setStage(id){room.setStage(id);onView(room.view(0));},
    setCpuLevel(l){room.setCpuLevel(l);onView(room.view(0));},
    // Any look can use any style: the computer keeps its toy look and takes the given style.
    setCpuStyle(style){room.join(1,{...RIVAL,style},{isAI:true});onView(room.view(0));},
    async leave(){this.dispose();},
    dispose(){clearInterval(timer);timer=null;},
    diagnostics:()=>({role:'solo'}),
  };
}
module.exports={create,RIVAL};
