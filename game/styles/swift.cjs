'use strict';
// ⚡ 疾风猫 — speed brawler (SPEC §5B.4).
// Knee: the forward air's first hitbox is live on frame 14 only (22 %); frames 15–17 are the weak 6 %.
let solved={};try{solved=require('./swift-kb.generated.cjs');}catch{}
const {hb,applySolved}=require('./common.cjs');
const attrs={
  id:'swift',name:'疾风猫',
  weight:104,height:21,radius:6.5,
  walk:0.987,run:2.552,dash:1.98,dashFrames:10,traction:0.08,
  airSpeed:1.218,airAccel:0.075,airFriction:0.01,
  gravity:0.12,fall:1.865,fastFall:2.98,
  airJumps:1,fullHopAirtime:48,shortHopAirtime:34,airJumpMult:1.0,
  landing:4,
  spotDodge:{intangible:[3,17],total:21},
  roll:{forward:{intangible:[4,15],total:30},back:{intangible:[5,16],total:35},distance:38},
  airDodge:{neutral:{intangible:[3,30],total:42,landing:10},
    directional:{intangible:[3,21],totals:{down:60,diagDown:67,side:73,diagUp:82,up:92},landing:[11,19],speed:2.8}},
  ledge:{getup:{total:30,intangible:[1,24]},attack:{total:38,intangible:[1,20]},roll:{total:38,intangible:[1,30],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:30,intangible:[1,22]},attack:{total:38,intangible:[1,20]},roll:{total:35,intangible:[1,20],distance:30}},
};
const moves={
  jab1:{kind:'ground',total:17,chain:{to:'jab2',from:5},hitboxes:[hb({frames:[3,4],x:11,y:11,r:6,dmg:1.5,angle:80,bkb:20,kbg:20})]},
  jab2:{kind:'ground',total:18,chain:{to:'jabF',from:8},hitboxes:[hb({frames:[5,6],x:11,y:11,r:6,dmg:1.5,angle:80,bkb:20,kbg:20})]},
  jabF:{kind:'ground',total:32,hitboxes:[hb({frames:[6,7],x:13,y:11,r:7,dmg:5,angle:40,bkb:50,kbg:80})]},
  ftilt:{kind:'ground',total:29,hitboxes:[hb({frames:[7,9],x:15,y:10,r:8,dmg:9,angle:40,bkb:35,kbg:75})]},
  utilt:{kind:'ground',total:36,hitboxes:[hb({frames:[14,16],x:8,y:22,r:9,dmg:11,angle:80,bkb:35,kbg:85})]},
  dtilt:{kind:'ground',total:34,crouch:true,hitboxes:[hb({frames:[11,13],x:15,y:3,r:7,dmg:10,angle:70,bkb:40,kbg:60})]},
  dash:{kind:'ground',total:34,slide:{speed:2.6,from:1},hitboxes:[hb({frames:[7,9],x:13,y:10,r:8,dmg:10,angle:45,bkb:45,kbg:75})]},
  fsmash:{kind:'ground',total:62,smash:true,chargeFrame:12,hitboxes:[hb({frames:[20,21],x:17,y:11,r:9,dmg:20,angle:38,bkb:40,kbg:90})]},
  usmash:{kind:'ground',total:45,smash:true,chargeFrame:8,hitboxes:[hb({frames:[22,24],x:4,y:25,r:10,dmg:14,angle:88,bkb:35,kbg:95})]},
  dsmash:{kind:'ground',total:48,smash:true,chargeFrame:11,hitboxes:[hb({frames:[19,21],x:14,y:3,r:8,dmg:16,angle:30,away:true,bkb:35,kbg:95}),hb({frames:[19,21],x:-14,y:3,r:8,dmg:16,angle:30,away:true,bkb:35,kbg:95})]},
  nair:{kind:'air',total:39,landing:7,autocancel:[3,32],hitboxes:[hb({frames:[7,10],x:0,y:10,r:11,dmg:6,angle:50,away:true,bkb:30,kbg:60})]},
  fair:{kind:'air',total:45,landing:18,autocancel:[4,42],hitboxes:[hb({frames:[14,14],x:12,y:8,r:6,dmg:22,angle:40,bkb:30,kbg:90}),hb({frames:[15,17],x:12,y:8,r:7,dmg:6,angle:70,bkb:30,kbg:40})]},
  uair:{kind:'air',total:31,landing:10,autocancel:[7,24],hitboxes:[hb({frames:[7,9],x:2,y:24,r:9,dmg:10,angle:85,bkb:30,kbg:80})]},
  dair:{kind:'air',total:44,landing:12,autocancel:[3,39],hitboxes:[hb({frames:[16,18],x:2,y:-2,r:8,dmg:14,angle:-80,bkb:30,kbg:70,meteor:true})]},
  grab:{kind:'ground',total:35,grab:{frames:[6,7],x:11,y:10,r:6}},
  pummel:{kind:'grab',total:19,hitFrame:1,dmg:1.3},
  fthrow:{kind:'throw',total:32,release:11,hit:hb({dmg:7.5,angle:45,bkb:60,kbg:55})},
  bthrow:{kind:'throw',total:45,release:12,back:true,hit:hb({dmg:7.5,angle:135,bkb:60,kbg:55})},
  // B 疾风重拳: very slow, huge.
  nspecial:{kind:'special',total:103,hitboxes:[hb({frames:[53,55],x:15,y:11,r:9,dmg:25,angle:40,bkb:40,kbg:80})]},
  // 侧B 疾风冲: rush ~48 forward, pops the target up; helpless if it ends in the air.
  sideB:{kind:'special',type:'lunge',total:44,lunge:{from:5,to:20,speed:3},helplessInAir:true,hitboxes:[hb({frames:[5,20],x:8,y:11,r:8,dmg:10,angle:80,bkb:50,kbg:40})]},
  // 上B 疾风飞扑: rises from frame 14, hits on the way up, then helpless.
  upB:{kind:'special',type:'rise',total:80,rise:{from:14,to:26,speed:3.2},helplessLanding:24,hitboxes:[hb({frames:[14,24],x:6,y:14,r:10,dmg:13,angle:60,bkb:50,kbg:60})]},
  // 下B 疾风踢: ground slide kick; in the air it dives down-forward.
  downB:{kind:'special',type:'lunge',total:68,lunge:{from:13,to:30,speed:3,airVy:-3.4},helplessInAir:false,hitboxes:[hb({frames:[13,30],x:10,y:4,r:8,dmg:15,angle:40,bkb:40,kbg:80})]},
  ledgeAttack:{kind:'ledge',total:38,hitboxes:[hb({frames:[20,23],x:13,y:7,r:9,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:38,hitboxes:[hb({frames:[19,22],x:13,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[19,22],x:-13,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
applySolved(moves,{},solved);
module.exports={attrs,moves,projectiles:{},ai:{approach:'sideB',punch:true,kick:true}};
