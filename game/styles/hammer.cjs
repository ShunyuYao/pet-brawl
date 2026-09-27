'use strict';
// 🧀 奶酪大锤 — heavy power style (SPEC §5).
// Frame numbers: "frames:[s,e]" are the active frames counted from 1; "total" is the
// full animation length. Hitbox x/y are offsets from the fighter's feet (x = forward).
// Angles are degrees relative to the attacker's facing (0 = forward, 90 = up,
// negative = downward). "away:true" launches away from the attacker instead.
// bkb / kbg for moves with a KO target are solved by tools/calibrate.cjs and read
// from hammer-kb.generated.cjs; the values written here are only the fallbacks.
let solved={};try{solved=require('./hammer-kb.generated.cjs');}catch{}
const {applySolved}=require('./common.cjs');

const attrs={
  id:'hammer',name:'奶酪大锤',
  weight:127,height:22,radius:7,
  walk:1.03,run:1.5,dash:1.82,dashFrames:10,traction:0.1,
  airSpeed:0.74,airAccel:0.05,airFriction:0.01,
  gravity:0.097,fall:1.95,fastFall:3.12,
  airJumps:4,fullHopAirtime:48,shortHopAirtime:36,airJumpMult:0.92,
  landing:4,
  spotDodge:{intangible:[3,18],total:23},
  roll:{forward:{intangible:[4,16],total:32},back:{intangible:[5,17],total:37},distance:38},
  airDodge:{neutral:{intangible:[4,32],total:43,landing:10},
    directional:{intangible:[4,23],totals:{down:58,diagDown:66,side:72,diagUp:86,up:96},landing:[11,19],speed:2.8}},
  ledge:{getup:{total:30,intangible:[1,24]},attack:{total:40,intangible:[1,20]},roll:{total:40,intangible:[1,30],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:30,intangible:[1,22]},attack:{total:40,intangible:[1,20]},roll:{total:35,intangible:[1,20],distance:30}},
};

const hb=(o)=>({r:8,angle:45,bkb:40,kbg:60,...o});
const moves={
  jab1:{kind:'ground',total:28,chain:{to:'jab2',from:12},hitboxes:[hb({frames:[8,9],x:12,y:11,r:7,dmg:3,angle:80,bkb:25,kbg:25})]},
  jab2:{kind:'ground',total:26,chain:{to:'jabF',from:13},hitboxes:[hb({frames:[9,10],x:13,y:11,r:7,dmg:3,angle:80,bkb:25,kbg:25})]},
  jabF:{kind:'ground',total:40,hitboxes:[hb({frames:[10,11],x:14,y:12,r:8,dmg:5,angle:40,bkb:50,kbg:80})]},
  ftilt:{kind:'ground',total:40,hitboxes:[hb({frames:[11,13],x:20,y:10,r:8,dmg:10,angle:40,bkb:30,kbg:100})]},
  utilt:{kind:'ground',total:38,headIntangible:[7,13],hitboxes:[hb({frames:[7,13],x:4,y:26,r:9,dmg:10,angle:88,bkb:30,kbg:100})]},
  dtilt:{kind:'ground',total:34,crouch:true,hitboxes:[hb({frames:[6,7],x:16,y:3,r:7,dmg:9,angle:25,bkb:40,kbg:50})]},
  dash:{kind:'ground',total:60,slide:{speed:1.9,from:1},hitboxes:[hb({frames:[20,22],x:14,y:10,r:9,dmg:15,angle:45,bkb:40,kbg:90})]},
  fsmash:{kind:'ground',total:66,smash:true,chargeFrame:20,hitboxes:[hb({frames:[26,27],x:22,y:8,r:10,dmg:22,angle:40,bkb:40,kbg:95})]},
  usmash:{kind:'ground',total:60,smash:true,chargeFrame:6,hitboxes:[hb({frames:[15,20],x:2,y:28,r:11,dmg:16,angle:88,bkb:35,kbg:100})]},
  dsmash:{kind:'ground',total:50,smash:true,chargeFrame:3,hitboxes:[hb({frames:[13,16],x:16,y:4,r:8,dmg:13,angle:30,away:true,bkb:35,kbg:100}),hb({frames:[13,16],x:-16,y:4,r:8,dmg:13,angle:30,away:true,bkb:35,kbg:100})]},
  nair:{kind:'air',total:39,landing:9,autocancel:[3,34],hitboxes:[hb({frames:[7,12],x:0,y:11,r:13,dmg:12,angle:45,away:true,bkb:40,kbg:80})]},
  fair:{kind:'air',total:41,landing:16,autocancel:[5,40],hitboxes:[hb({frames:[13,15],x:18,y:10,r:9,dmg:13,angle:45,bkb:30,kbg:100})]},
  uair:{kind:'air',total:44,landing:13,autocancel:[5,42],hitboxes:[hb({frames:[11,14],x:2,y:28,r:10,dmg:11,angle:85,bkb:30,kbg:100})]},
  dair:{kind:'air',total:47,landing:18,autocancel:[7,44],hitboxes:[
    hb({frames:[20,22],x:4,y:-2,r:8,dmg:14,angle:-80,bkb:30,kbg:70,meteor:true}),
    hb({frames:[20,22],x:10,y:9,r:6,dmg:8,angle:45,bkb:30,kbg:70})]},
  grab:{kind:'ground',total:36,grab:{frames:[8,10],x:12,y:11,r:6}},
  pummel:{kind:'grab',total:20,hitFrame:2,dmg:1.6},
  fthrow:{kind:'throw',total:30,release:10,hit:hb({dmg:10,angle:45,bkb:60,kbg:50})},
  bthrow:{kind:'throw',total:36,release:12,back:true,hit:hb({dmg:12,angle:135,bkb:60,kbg:70})},
  // B 一口吞: command grab that ignores shields; also swallows enemy projectiles.
  nspecial:{kind:'special',type:'inhale',total:60,inhale:{frames:[14,40],x:16,y:11,r:12},hold:25,spit:{total:24,release:6,hit:hb({dmg:10,angle:30,bkb:60,kbg:50})}},
  // 侧B 奶酪轮: hammer swing + bouncing projectile (one per player on stage).
  sideB:{kind:'special',total:54,spawn:{frame:24,x:18,y:10,type:'wheel',max:1},hitboxes:[hb({frames:[24,26],x:16,y:12,r:8,dmg:8,angle:45,bkb:40,kbg:60})]},
  // 上B 奶酪大跳: squat, super-armored rise, plunge; S cancels into helpless fall.
  upB:{kind:'special',type:'superjump',squat:9,rise:3.8,armor:{frames:[8,24],type:'super'},hangFrames:6,plunge:5,cancelLanding:30,
    plungeHit:hb({x:0,y:6,r:10,dmg:15,angle:-80,bkb:40,kbg:70,meteor:true})},
  upBLand:{kind:'ground',total:45,hitboxes:[hb({frames:[1,3],x:0,y:6,r:18,dmg:12,angle:80,away:true,bkb:50,kbg:70})]},
  // 下B 蓄力大锤: 15-frame windup, hold to charge (120 frames max), swing 10 frames after release.
  downB:{kind:'special',type:'chargeSwing',windup:15,chargeMax:120,chargeWalk:0.35,swingTotal:44,
    armor:{frames:[1,14],type:'heavy',threshold:14,groundOnly:true},fullShieldBonus:40,
    hitboxes:[hb({frames:[10,12],x:18,y:10,r:10,dmg:11,dmgFull:35,angle:40,bkb:30,kbg:80})]},
  ledgeAttack:{kind:'ledge',total:40,hitboxes:[hb({frames:[22,25],x:14,y:8,r:10,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:40,hitboxes:[hb({frames:[21,24],x:14,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[21,24],x:-14,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
const projectiles={wheel:{r:6,vx:1.7,vy:2.2,gravity:0.09,bounces:3,bounceVy:2.2,life:180,hit:hb({dmg:12,angle:40,bkb:45,kbg:65})},
  star:{r:7,vx:2.4,life:70,hit:hb({dmg:10,angle:35,bkb:50,kbg:60})}};

applySolved(moves,projectiles,solved);
module.exports={attrs,moves,projectiles,ai:{zoning:null,counter:false}};
