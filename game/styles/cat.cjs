'use strict';
// 🐾 猫爪拳 — light rushdown (SPEC §5A.1).
let solved={};try{solved=require('./cat-kb.generated.cjs');}catch{}
const {hb,applySolved}=require('./common.cjs');
const attrs={
  id:'cat',name:'猫爪拳',
  weight:78,height:18,radius:6,
  walk:1.47,run:2.42,dash:2.178,dashFrames:10,traction:0.1,
  airSpeed:1.155,airAccel:0.09,airFriction:0.02,
  gravity:0.15,fall:1.75,fastFall:2.8,
  airJumps:1,fullHopAirtime:47,shortHopAirtime:32,airJumpMult:1.0,
  landing:3,
  spotDodge:{intangible:[3,14],total:18},
  roll:{forward:{intangible:[4,12],total:26},back:{intangible:[4,14],total:32},distance:36},
  airDodge:{neutral:{intangible:[2,26],total:44,landing:10},
    directional:{intangible:[2,19],totals:{down:63,diagDown:67,side:74,diagUp:85,up:93},landing:[11,19],speed:2.8}},
  ledge:{getup:{total:28,intangible:[1,22]},attack:{total:36,intangible:[1,20]},roll:{total:36,intangible:[1,28],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:28,intangible:[1,20]},attack:{total:36,intangible:[1,20]},roll:{total:32,intangible:[1,18],distance:30}},
};
const moves={
  jab1:{kind:'ground',total:17,chain:{to:'jab2',from:5},hitboxes:[hb({frames:[2,3],x:10,y:10,r:6,dmg:2,angle:80,bkb:20,kbg:20})]},
  jab2:{kind:'ground',total:17,chain:{to:'jabF',from:6},hitboxes:[hb({frames:[3,4],x:10,y:10,r:6,dmg:2,angle:80,bkb:20,kbg:20})]},
  jabF:{kind:'ground',total:32,hitboxes:[hb({frames:[5,6],x:12,y:10,r:7,dmg:3,angle:40,bkb:45,kbg:70})]},
  ftilt:{kind:'ground',total:24,hitboxes:[hb({frames:[5,7],x:14,y:9,r:7,dmg:4,angle:70,bkb:35,kbg:60})]},
  utilt:{kind:'ground',total:30,hitboxes:[hb({frames:[5,8],x:3,y:20,r:8,dmg:5,angle:88,bkb:35,kbg:70})]},
  dtilt:{kind:'ground',total:26,crouch:true,hitboxes:[hb({frames:[5,6],x:13,y:3,r:6,dmg:4.5,angle:80,bkb:40,kbg:45})]},
  dash:{kind:'ground',total:34,slide:{speed:2.2,from:1},hitboxes:[hb({frames:[5,8],x:12,y:9,r:8,dmg:7,angle:50,bkb:50,kbg:70})]},
  fsmash:{kind:'ground',total:44,smash:true,chargeFrame:3,hitboxes:[hb({frames:[12,13],x:16,y:9,r:8,dmg:12,angle:40,bkb:40,kbg:95})]},
  usmash:{kind:'ground',total:50,smash:true,chargeFrame:6,headIntangible:[8,15],hitboxes:[hb({frames:[11,14],x:2,y:22,r:9,dmg:15,angle:88,bkb:35,kbg:90})]},
  dsmash:{kind:'ground',total:46,smash:true,chargeFrame:1,hitboxes:[hb({frames:[8,10],x:13,y:3,r:7,dmg:10,angle:30,away:true,bkb:35,kbg:90}),hb({frames:[8,10],x:-13,y:3,r:7,dmg:10,angle:30,away:true,bkb:35,kbg:90})]},
  nair:{kind:'air',total:45,landing:6,autocancel:[3,31],hitboxes:[hb({frames:[3,6],x:0,y:9,r:10,dmg:6,angle:45,away:true,bkb:30,kbg:60})]},
  fair:{kind:'air',total:34,landing:5,autocancel:[5,11],hitboxes:[hb({frames:[5,7],x:12,y:9,r:7,dmg:5,angle:50,bkb:30,kbg:50})]},
  uair:{kind:'air',total:40,landing:7,autocancel:[4,30],hitboxes:[hb({frames:[4,8],x:1,y:20,r:8,dmg:5,angle:85,bkb:30,kbg:60})]},
  // 下空 猫落: brief hover, then a diagonal dive kick until landing; bounces off on hit.
  dair:{kind:'air',type:'dive',total:999,landing:22,dive:{from:15,vx:2.4,vy:-3.4},hitboxes:[hb({frames:[15,999],x:4,y:2,r:7,dmg:10,angle:60,bkb:40,kbg:50})]},
  grab:{kind:'ground',total:36,grab:{frames:[6,7],x:10,y:9,r:6}},
  pummel:{kind:'grab',total:15,hitFrame:1,dmg:1},
  fthrow:{kind:'throw',total:36,release:14,hit:hb({dmg:7,angle:45,bkb:55,kbg:50})},
  bthrow:{kind:'throw',total:35,release:15,back:true,hit:hb({dmg:8,angle:135,bkb:55,kbg:55})},
  // B 爪风: short straight projectile.
  nspecial:{kind:'special',type:'shot',total:30,spawn:{frame:9,x:10,y:10,type:'claw'}},
  // 侧B 猫扑: lunge ~60 forward; helpless if it ends in the air.
  sideB:{kind:'special',type:'lunge',total:44,lunge:{from:12,to:23,speed:5},helplessInAir:true,hitboxes:[hb({frames:[12,23],x:8,y:9,r:8,dmg:9,angle:40,bkb:40,kbg:80})]},
  // 上B 猫跃: intangible frames 8–14, fast rise, then helpless.
  upB:{kind:'special',type:'rise',total:70,intangible:[8,14],rise:{from:8,to:20,speed:3.4},helplessLanding:20,hitboxes:[hb({frames:[8,10],x:0,y:9,r:9,dmg:6,angle:80,bkb:50,kbg:50})]},
  // 下B 看破: counter window 6–27; counterattack deals max(8, incoming × 1.2).
  downB:{kind:'special',type:'counter',total:50,window:[6,27],counter:{mult:1.2,min:8,delay:6,strikeTotal:34,hit:hb({x:12,y:10,r:11,angle:35,bkb:60,kbg:70})}},
  ledgeAttack:{kind:'ledge',total:36,hitboxes:[hb({frames:[20,23],x:12,y:7,r:9,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:36,hitboxes:[hb({frames:[19,22],x:12,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[19,22],x:-12,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
const projectiles={claw:{r:5,vx:3.2,life:22,hit:hb({dmg:4,angle:50,bkb:20,kbg:30})}};
applySolved(moves,projectiles,solved);
module.exports={attrs,moves,projectiles,ai:{zoning:{min:35,max:75,key:'neutral'},approach:'sideB',counter:true}};
