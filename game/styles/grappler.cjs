'use strict';
// 💪 肉垫摔角手 — grappler (SPEC §5B.2).
let solved={};try{solved=require('./grappler-kb.generated.cjs');}catch{}
const {hb,applySolved}=require('./common.cjs');
const attrs={
  id:'grappler',name:'肉垫摔角手',
  weight:116,height:23,radius:7.5,
  walk:0.62,run:1.18,dash:1.76,dashFrames:10,traction:0.1,
  airSpeed:0.88,airAccel:0.07,airFriction:0.01,
  gravity:0.126,fall:1.76,fastFall:2.816,
  airJumps:1,fullHopAirtime:43,shortHopAirtime:30,airJumpMult:1.0,
  landing:4,
  spotDodge:{intangible:[3,17],total:21},
  roll:{forward:{intangible:[4,15],total:30},back:{intangible:[5,16],total:35},distance:36},
  airDodge:{neutral:{intangible:[3,29],total:44,landing:10},
    directional:{intangible:[3,21],totals:{down:62,diagDown:69,side:76,diagUp:88,up:98},landing:[11,19],speed:2.6}},
  ledge:{getup:{total:32,intangible:[1,24]},attack:{total:42,intangible:[1,20]},roll:{total:42,intangible:[1,30],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:32,intangible:[1,22]},attack:{total:42,intangible:[1,20]},roll:{total:36,intangible:[1,20],distance:30}},
  revenge:true,
};
const moves={
  jab1:{kind:'ground',total:23,chain:{to:'jab2',from:8},hitboxes:[hb({frames:[5,6],x:13,y:12,r:7,dmg:2.5,angle:80,bkb:25,kbg:20})]},
  jab2:{kind:'ground',total:31,chain:{to:'jabF',from:13},hitboxes:[hb({frames:[4,5],x:13,y:12,r:7,dmg:2.8,angle:80,bkb:25,kbg:20})]},
  jabF:{kind:'ground',total:37,hitboxes:[hb({frames:[4,5],x:15,y:12,r:8,dmg:6.7,angle:40,bkb:50,kbg:80})]},
  ftilt:{kind:'ground',total:36,hitboxes:[hb({frames:[12,14],x:18,y:11,r:9,dmg:13,angle:40,bkb:35,kbg:85})]},
  utilt:{kind:'ground',total:34,headIntangible:[6,11],hitboxes:[hb({frames:[6,9],x:4,y:28,r:10,dmg:9,angle:88,bkb:40,kbg:80})]},
  dtilt:{kind:'ground',total:29,crouch:true,hitboxes:[hb({frames:[9,10],x:16,y:3,r:8,dmg:9,angle:30,bkb:40,kbg:55})]},
  dash:{kind:'ground',total:41,slide:{speed:1.7,from:1},hitboxes:[hb({frames:[8,10],x:15,y:11,r:10,dmg:13,angle:45,bkb:45,kbg:75})]},
  fsmash:{kind:'ground',total:62,smash:true,chargeFrame:4,hitboxes:[hb({frames:[21,22],x:19,y:11,r:10,dmg:18,angle:40,bkb:40,kbg:90})]},
  usmash:{kind:'ground',total:47,smash:true,chargeFrame:5,headIntangible:[13,18],hitboxes:[hb({frames:[13,16],x:3,y:28,r:11,dmg:17,angle:88,bkb:35,kbg:95})]},
  dsmash:{kind:'ground',total:57,smash:true,chargeFrame:1,hitboxes:[hb({frames:[18,20],x:16,y:4,r:9,dmg:17,angle:30,away:true,bkb:35,kbg:95}),hb({frames:[18,20],x:-16,y:4,r:9,dmg:17,angle:30,away:true,bkb:35,kbg:95})]},
  nair:{kind:'air',total:41,landing:11,autocancel:[3,36],hitboxes:[hb({frames:[5,8],x:0,y:12,r:13,dmg:13,angle:45,away:true,bkb:35,kbg:80})]},
  fair:{kind:'air',total:44,landing:14,autocancel:[6,46],hitboxes:[hb({frames:[8,10],x:16,y:12,r:10,dmg:12,angle:40,bkb:35,kbg:85})]},
  uair:{kind:'air',total:31,landing:8,autocancel:[5,26],hitboxes:[hb({frames:[7,9],x:2,y:27,r:10,dmg:8,angle:85,bkb:35,kbg:70})]},
  dair:{kind:'air',total:44,landing:16,autocancel:[3,45],hitboxes:[hb({frames:[16,18],x:2,y:-2,r:8,dmg:15,angle:-80,bkb:30,kbg:70,meteor:true}),hb({frames:[16,18],x:8,y:9,r:7,dmg:9,angle:45,bkb:30,kbg:70})]},
  grab:{kind:'ground',total:37,grab:{frames:[7,8],x:13,y:11,r:7}},
  pummel:{kind:'grab',total:20,hitFrame:1,dmg:1.6},
  fthrow:{kind:'throw',total:50,release:30,hit:hb({dmg:12,angle:45,bkb:60,kbg:60})},
  bthrow:{kind:'throw',total:51,release:28,back:true,hit:hb({dmg:14,angle:135,bkb:60,kbg:70})},
  // B 旋风臂: spins, intangible on frames 5–6, hits both sides.
  nspecial:{kind:'special',total:60,intangible:[5,6],hitboxes:[hb({frames:[5,12],x:12,y:12,r:10,dmg:14,angle:40,away:true,bkb:45,kbg:75}),hb({frames:[5,12],x:-12,y:12,r:10,dmg:14,angle:40,away:true,bkb:45,kbg:75})]},
  // 侧B 绳索摔: a command grab (ignores shields), then a lariat.
  sideB:{kind:'special',type:'inhale',total:57,inhale:{frames:[16,18],x:15,y:11,r:9,projectiles:false,hide:false,holdOffset:20},hold:20,
    spit:{total:32,release:8,hit:hb({dmg:16,angle:40,bkb:60,kbg:70})}},
  // 上B 肉垫下劈: short rise, heavy armor, plunge.
  upB:{kind:'special',type:'superjump',squat:10,rise:3.0,armor:{frames:[4,15],type:'heavy',threshold:12},hangFrames:4,plunge:4.5,cancelLanding:35,
    plungeHit:hb({x:4,y:8,r:10,dmg:11,angle:45,bkb:45,kbg:70})},
  upBLand:{kind:'ground',total:35,hitboxes:[hb({frames:[1,2],x:0,y:6,r:14,dmg:6,angle:80,away:true,bkb:45,kbg:50})]},
  // 下B 蓄怒: absorb (take 0.4×), small flame, next hit ×(1.5 + 0.075·d) up to 3.
  downB:{kind:'special',type:'counter',total:49,window:[3,27],counter:{revenge:true,fixed:2.4,delay:8,strikeTotal:25,hit:hb({x:10,y:12,r:13,angle:45,bkb:60,kbg:0})}},
  ledgeAttack:{kind:'ledge',total:42,hitboxes:[hb({frames:[22,25],x:15,y:8,r:10,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:42,hitboxes:[hb({frames:[21,24],x:15,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[21,24],x:-15,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
applySolved(moves,{},solved);
module.exports={attrs,moves,projectiles:{},ai:{counter:true,commandGrab:'sideB',lariat:true}};
