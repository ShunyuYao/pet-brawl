'use strict';
// Stages (SPEC §8). Ground ids: 0 = main stage (solid), 1..n = soft platforms
// (pass-through from below). A platform may move: its position is a pure function of
// the match frame, so host, guest prediction and snapshot replay all agree.
// Heights follow the hammer's jump: a full hop (26.5) reaches a side platform, a full
// hop + one air jump the highest one.
function makeStage({id,name,MAIN,PLATFORMS=[],BLAST,SPAWNS,RESPAWN,moving=null}){
  const LEDGES=[{x:MAIN.x0,y:MAIN.top,side:-1},{x:MAIN.x1,y:MAIN.top,side:1}];
  // moving: {index, half, y, from, to, speed, pause} — the platform's centre shuttles
  // between from and to, resting `pause` frames at each end.
  const travel=moving?Math.round((moving.to-moving.from)/moving.speed):0,period=moving?2*(travel+moving.pause):1;
  function movingCentre(frame){
    const t=((frame%period)+period)%period,{from,to,speed,pause}=moving;
    if(t<pause)return from;
    if(t<pause+travel)return from+(t-pause)*speed;
    if(t<2*pause+travel)return to;
    return to-(t-2*pause-travel)*speed;
  }
  function surface(id,frame=0){
    if(id===0)return {x0:MAIN.x0,x1:MAIN.x1,y:MAIN.top,solid:true,dx:0};
    const p=PLATFORMS[id-1];if(!p)return null;
    if(moving&&moving.index===id-1){const c=movingCentre(frame),c0=movingCentre(frame-1);return {x0:c-moving.half,x1:c+moving.half,y:moving.y,solid:false,dx:c-c0};}
    return {x0:p.x0,x1:p.x1,y:p.y,solid:false,dx:0};
  }
  const SURFACES=[0,...PLATFORMS.map((_,i)=>i+1)];
  const outOfBounds=(x,y)=>x<BLAST.left||x>BLAST.right||y>BLAST.top||y<BLAST.bottom;
  return {id,name,MAIN,PLATFORMS,BLAST,LEDGES,SPAWNS,RESPAWN,SURFACES,surface,outOfBounds,moving,period};
}

const STAGES={
  // 🧶 毛线篮球场 — three platforms (the stage every KO% target is calibrated on).
  court:makeStage({id:'court',name:'毛线篮球场',
    MAIN:{x0:-70,x1:70,top:0,bottom:-34},
    PLATFORMS:[{x0:-56,x1:-22,y:24},{x0:22,x1:56,y:24},{x0:-17,x1:17,y:46}],
    BLAST:{left:-230,right:230,top:190,bottom:-140},SPAWNS:[{x:-35,facing:1},{x:35,facing:-1}],RESPAWN:{x:0,y:78}}),
  // 🧀 奶酪月台 — one wide flat stage, nothing to hide on.
  moon:makeStage({id:'moon',name:'奶酪月台',
    MAIN:{x0:-85,x1:85,top:0,bottom:-30},
    BLAST:{left:-240,right:240,top:185,bottom:-140},SPAWNS:[{x:-42,facing:1},{x:42,facing:-1}],RESPAWN:{x:0,y:60}}),
  // 🐟 猫薄荷小镇 — bigger blast zones and one platform that carries you.
  town:makeStage({id:'town',name:'猫薄荷小镇',
    MAIN:{x0:-74,x1:74,top:0,bottom:-26},
    PLATFORMS:[{x0:-62,x1:-28,y:26}],
    moving:{index:0,half:17,y:26,from:-45,to:45,speed:0.3,pause:90},
    BLAST:{left:-240,right:240,top:195,bottom:-140},SPAWNS:[{x:-38,facing:1},{x:38,facing:-1}],RESPAWN:{x:0,y:70}}),
};
const DEFAULT='court';
const get=id=>STAGES[id]||STAGES[DEFAULT];
// The default stage's fields stay exported flat for older callers (and tests).
module.exports={...STAGES[DEFAULT],STAGES,STAGE_IDS:Object.keys(STAGES),DEFAULT,get};
