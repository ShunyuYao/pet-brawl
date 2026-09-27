'use strict';
// 🪶 逗猫棒剑士 — swordfighter (SPEC §5B.1).
// Tipper: the first hitbox of a sword move is the tip (farther, stronger) and wins
// when both would connect; the second is the base.
let solved={};try{solved=require('./sword-kb.generated.cjs');}catch{}
const {hb,applySolved}=require('./common.cjs');
const attrs={
  id:'sword',name:'逗猫棒剑士',
  weight:90,height:20,radius:6,
  walk:1.575,run:1.964,dash:2.255,dashFrames:10,traction:0.09,
  airSpeed:1.071,airAccel:0.08,airFriction:0.01,
  gravity:0.075,fall:1.58,fastFall:2.5,
  airJumps:1,fullHopAirtime:55,shortHopAirtime:41,airJumpMult:1.0,
  landing:4,
  spotDodge:{intangible:[3,17],total:20},
  roll:{forward:{intangible:[4,15],total:29},back:{intangible:[5,16],total:34},distance:38},
  airDodge:{neutral:{intangible:[3,29],total:52,landing:10},
    directional:{intangible:[3,21],totals:{down:66,diagDown:72,side:80,diagUp:92,up:104},landing:[11,19],speed:2.6}},
  ledge:{getup:{total:30,intangible:[1,24]},attack:{total:40,intangible:[1,20]},roll:{total:40,intangible:[1,30],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:30,intangible:[1,22]},attack:{total:40,intangible:[1,20]},roll:{total:35,intangible:[1,20],distance:30}},
};
const tip=(o)=>hb({r:2,...o}),base=(o)=>hb({r:8,...o});
const moves={
  jab1:{kind:'ground',total:25,chain:{to:'jab2',from:11},tipper:true,hitboxes:[tip({frames:[5,6],x:23,y:11,dmg:4,angle:70,bkb:30,kbg:30}),base({frames:[5,6],x:11,y:11,dmg:3,angle:70,bkb:25,kbg:25})]},
  jab2:{kind:'ground',total:28,tipper:true,hitboxes:[tip({frames:[4,5],x:23,y:11,dmg:6,angle:40,bkb:45,kbg:60}),base({frames:[4,5],x:11,y:11,dmg:4,angle:40,bkb:40,kbg:50})]},
  ftilt:{kind:'ground',total:35,tipper:true,hitboxes:[tip({frames:[9,11],x:25,y:12,dmg:11,angle:40,bkb:35,kbg:80}),base({frames:[9,11],x:12,y:12,dmg:9,angle:40,bkb:35,kbg:70})]},
  utilt:{kind:'ground',total:33,hitboxes:[hb({frames:[6,10],x:6,y:24,r:10,dmg:10,angle:88,bkb:35,kbg:80})]},
  dtilt:{kind:'ground',total:23,crouch:true,tipper:true,hitboxes:[tip({frames:[7,8],x:25,y:3,dmg:9,angle:30,bkb:40,kbg:60}),base({frames:[7,8],x:12,y:3,dmg:7,angle:30,bkb:35,kbg:50})]},
  dash:{kind:'ground',total:49,slide:{speed:2.0,from:1},hitboxes:[hb({frames:[13,15],x:16,y:10,r:9,dmg:10,angle:45,bkb:45,kbg:70})]},
  fsmash:{kind:'ground',total:56,smash:true,chargeFrame:3,tipper:true,hitboxes:[tip({frames:[10,12],x:25,y:10,dmg:17,angle:38,bkb:40,kbg:90}),base({frames:[10,12],x:12,y:10,dmg:13,angle:38,bkb:40,kbg:90})]},
  usmash:{kind:'ground',total:58,smash:true,chargeFrame:5,hitboxes:[hb({frames:[13,16],x:6,y:26,r:12,dmg:17,angle:88,bkb:35,kbg:95})]},
  dsmash:{kind:'ground',total:55,smash:true,chargeFrame:4,tipper:true,hitboxes:[tip({frames:[6,8],x:23,y:3,dmg:17,angle:30,away:true,bkb:35,kbg:90}),base({frames:[6,8],x:11,y:3,dmg:12,angle:30,away:true,bkb:35,kbg:90}),
    tip({frames:[21,23],x:-23,y:3,dmg:17,angle:30,away:true,bkb:35,kbg:90}),base({frames:[21,23],x:-11,y:3,dmg:12,angle:30,away:true,bkb:35,kbg:90})]},
  nair:{kind:'air',total:49,landing:7,autocancel:[6,47],tipper:true,hitboxes:[tip({frames:[6,9],x:22,y:12,dmg:9.5,angle:45,bkb:35,kbg:70}),base({frames:[6,9],x:8,y:12,dmg:7,angle:45,bkb:30,kbg:60})]},
  fair:{kind:'air',total:37,landing:12,autocancel:[6,36],tipper:true,hitboxes:[tip({frames:[6,8],x:23,y:12,dmg:11.5,angle:40,bkb:30,kbg:90}),base({frames:[6,8],x:10,y:12,dmg:8,angle:40,bkb:30,kbg:80})]},
  uair:{kind:'air',total:45,landing:8,autocancel:[5,38],tipper:true,hitboxes:[tip({frames:[5,8],x:4,y:34,dmg:13,angle:85,bkb:30,kbg:85}),base({frames:[5,8],x:4,y:22,dmg:9.5,angle:85,bkb:30,kbg:80})]},
  dair:{kind:'air',total:59,landing:14,autocancel:[3,55],tipper:true,hitboxes:[tip({frames:[9,11],x:4,y:-6,dmg:15,angle:-80,bkb:30,kbg:70,meteor:true}),base({frames:[9,11],x:4,y:4,dmg:12,angle:60,bkb:30,kbg:60})]},
  grab:{kind:'ground',total:34,grab:{frames:[6,7],x:11,y:10,r:6}},
  pummel:{kind:'grab',total:19,hitFrame:1,dmg:1.3},
  fthrow:{kind:'throw',total:34,release:18,hit:hb({dmg:4,angle:45,bkb:60,kbg:60})},
  bthrow:{kind:'throw',total:44,release:19,back:true,hit:hb({dmg:4,angle:135,bkb:60,kbg:60})},
  // B 蓄力突刺: charge up to 60 frames, thrust 8 frames after release; full charge breaks shields.
  nspecial:{kind:'special',type:'chargeSwing',windup:11,chargeMax:60,chargeWalk:0,swingTotal:39,fullShieldBonus:55,
    hitboxes:[hb({frames:[8,9],x:24,y:11,r:7,dmg:8,dmgFull:24,angle:40,bkb:40,kbg:80})]},
  // 侧B 逗猫连击: K again inside each window chains the next slash.
  sideB:{kind:'special',total:39,chain:{to:'sideB2',from:12,key:'special'},hitboxes:[hb({frames:[9,10],x:16,y:11,r:9,dmg:3,angle:70,bkb:30,kbg:10})]},
  sideB2:{kind:'special',total:38,chain:{to:'sideB3',from:8,key:'special'},hitboxes:[hb({frames:[5,6],x:16,y:11,r:9,dmg:3,angle:70,bkb:30,kbg:10})]},
  sideB3:{kind:'special',total:43,chain:{to:'sideB4',from:7,key:'special'},hitboxes:[hb({frames:[4,5],x:16,y:11,r:9,dmg:4,angle:70,bkb:30,kbg:10})]},
  sideB4:{kind:'special',total:55,hitboxes:[hb({frames:[7,8],x:17,y:11,r:10,dmg:6,angle:40,bkb:50,kbg:80})]},
  // 上B 跃空斩: intangible 4–5, fast rise, then helpless.
  upB:{kind:'special',type:'rise',total:70,intangible:[4,5],rise:{from:5,to:9,speed:2.6},helplessLanding:24,hitboxes:[hb({frames:[5,8],x:6,y:14,r:10,dmg:11,angle:80,bkb:50,kbg:60})]},
  downB:{kind:'special',type:'counter',total:64,window:[6,27],counter:{mult:1.2,min:8,delay:4,strikeTotal:36,hit:hb({x:16,y:11,r:12,angle:38,bkb:60,kbg:70})}},
  ledgeAttack:{kind:'ledge',total:40,hitboxes:[hb({frames:[22,25],x:16,y:8,r:10,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:40,hitboxes:[hb({frames:[21,24],x:16,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[21,24],x:-16,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
applySolved(moves,{},solved);
module.exports={attrs,moves,projectiles:{},ai:{counter:true,approach:null,chainSide:true}};
