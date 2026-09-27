'use strict';
// Universal system formulas shared by every style (SPEC §6): knockback, hitstun,
// hitlag, shields, stale moves, rage and ledge intangibility. 60 frames per second.

const FPS=60;
const ONE_V_ONE=1.2;          // damage taken in 1-on-1 matches
const SHORT_HOP=0.85;         // short-hop aerial damage
const FRESH_BONUS=1.05;       // move not in the stale queue
const STALE=[0.09,0.08545,0.07635,0.0679,0.05945,0.05035,0.04255,0.03345,0.025];
const STALE_SHIELD=0.85;      // hits on shield stale at 85 %
const STALE_KB=0.3;           // staleness only affects knockback at 30 %
const KB_SPEED=0.03;          // knockback units → launch speed
const KB_DECAY=0.051;         // launch speed lost per frame
const TUMBLE_KB=80;           // knockback at or above this tumbles
const HITSTUN_HOMOGENIZED_FALL=1.8; // fall speed for 70°–110° launches during hitstun
const HITSTUN_AIRDODGE=[40,2.5],HITSTUN_AERIAL=[45,2.0]; // [min frames, max launch speed]
const SMASH_CHARGE={frames:60,max:1.4};
const SHIELD={max:50,mult:1.19,decay:0.15,regen:0.08,drop:11,parry:5,afterBreak:30};
const JUMPSQUAT=3;
const LEDGE={maxGrabs:6,hangFrames:390,regrab:[1,0.8,0.5,0]};
const BUFFER=8;               // frames a press stays buffered
const RESPAWN_INVINCIBLE=120; // 2 s

function knockback({p,d,w,kbg,bkb,r=1}){
  // (((((p/10 + p·d/20) · 200/(w+100) · 1.4) + 18) · s) + b) · r
  return ((((p/10+p*d/20)*200/(w+100)*1.4)+18)*(kbg/100)+bkb)*r;
}
const launchSpeed=kb=>kb*KB_SPEED;
const hitstun=kb=>Math.max(0,Math.floor(kb*0.4)-1);
function hitlag(d,{shield=false,mult=1}={}){
  const base=Math.floor((d*0.65+6)*mult);
  return Math.min(30,shield?Math.floor(base*0.67):base);
}
const shieldstun=d=>Math.floor(d*0.8+2);
// Queue entries are {id, w}; w = 1 for hits, 0.85 for shield hits. Most recent first.
function staleMultiplier(queue,id){
  let sum=0,found=false;
  for(let i=0;i<queue.length&&i<STALE.length;i++)if(queue[i].id===id){sum+=STALE[i]*queue[i].w;found=true;}
  return found?1-sum:FRESH_BONUS;
}
// Rage: 1.0 at 35 % rising linearly to 1.1 at 150 %.
function rage(percent){return 1+Math.max(0,Math.min(1,(percent-35)/115))*0.1;}
// Ledge intangibility: the airtime / percent formula spans 0–104 frames, plus the
// 19-frame catch animation added explicitly, for a 123-frame maximum (SPEC §6).
// The regrab multiplier applies to the total.
const LEDGE_CATCH=19;
function ledgeIntangibility({airtime,percent,grabs}){
  const a=Math.min(300,Math.max(0,airtime)),p=Math.min(120,Math.max(0,percent));
  const base=60*(a/300)+(44-p/120*44)+LEDGE_CATCH;
  const mult=LEDGE.regrab[Math.min(LEDGE.regrab.length-1,Math.max(0,grabs-1))];
  return Math.floor(base*mult);
}
function smashChargeMultiplier(frames){return 1+(SMASH_CHARGE.max-1)*Math.min(1,Math.max(0,frames)/SMASH_CHARGE.frames);}

module.exports={FPS,ONE_V_ONE,SHORT_HOP,FRESH_BONUS,STALE,STALE_SHIELD,STALE_KB,KB_SPEED,KB_DECAY,TUMBLE_KB,HITSTUN_HOMOGENIZED_FALL,
  HITSTUN_AIRDODGE,HITSTUN_AERIAL,SMASH_CHARGE,SHIELD,JUMPSQUAT,LEDGE,BUFFER,RESPAWN_INVINCIBLE,
  knockback,launchSpeed,hitstun,hitlag,shieldstun,staleMultiplier,rage,ledgeIntangibility,smashChargeMultiplier};
