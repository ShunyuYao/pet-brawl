'use strict';
// 🥊 拳击喵 — ground boxer (SPEC §5B.3).
// Power meter: fills 1:1 from damage taken and 0.3× from damage dealt; at 100 the next
// K is the KO punch (super armor, unblockable on the ground).
let solved={};try{solved=require('./boxer-kb.generated.cjs');}catch{}
const {hb,applySolved}=require('./common.cjs');
const attrs={
  id:'boxer',name:'拳击喵',
  weight:87,height:19,radius:6,
  walk:1.386,run:2.464,dash:2.365,dashFrames:10,traction:0.11,
  airSpeed:1.208,airAccel:0.04,airFriction:0.01,
  gravity:0.09,fall:1.95,fastFall:3.1,
  airJumps:1,fullHopAirtime:44,shortHopAirtime:33,airJumpMult:0.85,
  landing:4,
  spotDodge:{intangible:[3,14],total:18},
  roll:{forward:{intangible:[4,12],total:26},back:{intangible:[4,14],total:32},distance:36},
  airDodge:{neutral:{intangible:[2,26],total:49,landing:10},
    directional:{intangible:[2,19],totals:{down:66,diagDown:72,side:80,diagUp:92,up:104},landing:[11,19],speed:2.6}},
  ledge:{getup:{total:28,intangible:[1,22]},attack:{total:36,intangible:[1,20]},roll:{total:36,intangible:[1,28],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:28,intangible:[1,20]},attack:{total:36,intangible:[1,20]},roll:{total:32,intangible:[1,18],distance:30}},
  meter:true,
};
const moves={
  jab1:{kind:'ground',total:16,chain:{to:'jab2',from:5},hitboxes:[hb({frames:[1,2],x:10,y:10,r:6,dmg:1.5,angle:80,bkb:20,kbg:20})]},
  jab2:{kind:'ground',total:16,chain:{to:'jabF',from:5},hitboxes:[hb({frames:[1,2],x:10,y:10,r:6,dmg:1.5,angle:80,bkb:20,kbg:20})]},
  jabF:{kind:'ground',total:29,hitboxes:[hb({frames:[4,5],x:12,y:10,r:7,dmg:5,angle:40,bkb:50,kbg:80})]},
  ftilt:{kind:'ground',total:30,hitboxes:[hb({frames:[4,5],x:13,y:10,r:7,dmg:8,angle:40,bkb:35,kbg:75})]},
  utilt:{kind:'ground',total:29,hitboxes:[hb({frames:[4,6],x:5,y:20,r:8,dmg:6.5,angle:88,bkb:40,kbg:70})]},
  dtilt:{kind:'ground',total:25,crouch:true,hitboxes:[hb({frames:[3,4],x:13,y:3,r:7,dmg:8,angle:75,bkb:40,kbg:55})]},
  dash:{kind:'ground',total:33,slide:{speed:2.4,from:1},hitboxes:[hb({frames:[7,9],x:12,y:9,r:8,dmg:10,angle:45,bkb:45,kbg:75})]},
  fsmash:{kind:'ground',total:48,smash:true,chargeFrame:4,armor:{frames:[10,16],type:'heavy',threshold:10},hitboxes:[hb({frames:[16,17],x:15,y:10,r:8,dmg:20,angle:40,bkb:40,kbg:90})]},
  usmash:{kind:'ground',total:47,smash:true,chargeFrame:6,armor:{frames:[8,13],type:'heavy',threshold:10},hitboxes:[hb({frames:[10,12],x:3,y:22,r:9,dmg:21,angle:88,bkb:35,kbg:95})]},
  dsmash:{kind:'ground',total:42,smash:true,chargeFrame:5,armor:{frames:[7,10],type:'heavy',threshold:10},hitboxes:[hb({frames:[10,11],x:13,y:3,r:7,dmg:13,angle:30,away:true,bkb:35,kbg:95}),hb({frames:[10,11],x:-13,y:3,r:7,dmg:13,angle:30,away:true,bkb:35,kbg:95})]},
  // Weak in the air (SPEC §5B.3).
  nair:{kind:'air',total:15,landing:10,autocancel:[2,16],hitboxes:[hb({frames:[2,4],x:0,y:9,r:9,dmg:2,angle:70,away:true,bkb:20,kbg:30})]},
  fair:{kind:'air',total:36,landing:13,autocancel:[10,35],hitboxes:[hb({frames:[10,12],x:12,y:9,r:7,dmg:5,angle:45,bkb:25,kbg:45})]},
  uair:{kind:'air',total:41,landing:13,autocancel:[5,40],hitboxes:[hb({frames:[5,8],x:1,y:20,r:8,dmg:5,angle:85,bkb:25,kbg:45})]},
  dair:{kind:'air',total:27,landing:18,autocancel:[7,25],hitboxes:[hb({frames:[7,9],x:2,y:-2,r:7,dmg:5,angle:-60,bkb:20,kbg:40,meteor:true})]},
  grab:{kind:'ground',total:38,grab:{frames:[9,10],x:11,y:10,r:6}},
  pummel:{kind:'grab',total:15,hitFrame:1,dmg:1},
  fthrow:{kind:'throw',total:44,release:16,hit:hb({dmg:8,angle:45,bkb:55,kbg:50})},
  bthrow:{kind:'throw',total:47,release:19,back:true,hit:hb({dmg:9,angle:135,bkb:55,kbg:55})},
  // B 直拳: at least 32 frames of wind-up, up to 90 more of charge.
  nspecial:{kind:'special',type:'chargeSwing',windup:32,chargeMax:90,chargeWalk:0,swingTotal:49,armor:{frames:[1,4],type:'heavy',threshold:10,groundOnly:true},
    hitboxes:[hb({frames:[4,6],x:15,y:10,r:9,dmg:12,dmgFull:30,angle:40,bkb:40,kbg:80})]},
  // B with a full meter: the KO punch.
  koPunch:{kind:'special',total:76,armor:{frames:[8,9],type:'super',groundOnly:true},hitboxes:[hb({frames:[9,10],x:12,y:16,r:10,dmg:35,angle:75,bkb:60,kbg:90,unblockable:true})]},
  // 侧B 大摆拳: intangible 1–3, leap ~42 forward; helpless if it ends in the air.
  sideB:{kind:'special',type:'lunge',total:60,intangible:[1,3],lunge:{from:8,to:20,speed:3.5},helplessInAir:true,hitboxes:[hb({frames:[8,20],x:8,y:12,r:8,dmg:14,angle:40,bkb:40,kbg:80})]},
  // 上B 上勾拳: intangible 1–3, short rise, helpless.
  upB:{kind:'special',type:'rise',total:60,intangible:[1,3],rise:{from:3,to:12,speed:2.4},helplessLanding:30,hitboxes:[hb({frames:[3,10],x:4,y:18,r:9,dmg:3,angle:85,bkb:50,kbg:30})]},
  downB:{kind:'special',type:'counter',total:56,window:[5,27],counter:{mult:1.2,min:8,delay:12,strikeTotal:30,hit:hb({x:12,y:14,r:12,angle:70,bkb:60,kbg:70})}},
  ledgeAttack:{kind:'ledge',total:36,hitboxes:[hb({frames:[20,23],x:12,y:7,r:9,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:36,hitboxes:[hb({frames:[19,22],x:12,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[19,22],x:-12,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
applySolved(moves,{},solved);
module.exports={attrs,moves,projectiles:{},ai:{counter:true,approach:'sideB',koPunch:true}};
