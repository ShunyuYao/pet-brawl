'use strict';
// 🧶 毛线球法师 — zoner (SPEC §5A.2).
let solved={};try{solved=require('./mage-kb.generated.cjs');}catch{}
const {hb,applySolved}=require('./common.cjs');
const attrs={
  id:'mage',name:'毛线球法师',
  weight:108,height:22,radius:6.5,
  walk:1.115,run:1.654,dash:1.87,dashFrames:10,traction:0.08,
  airSpeed:1.103,airAccel:0.09,airFriction:0.01,
  gravity:0.075,fall:1.33,fastFall:2.128,
  airJumps:1,fullHopAirtime:61,shortHopAirtime:44,airJumpMult:1.0,
  landing:4,
  spotDodge:{intangible:[3,17],total:21},
  roll:{forward:{intangible:[4,18],total:34},back:{intangible:[5,20],total:39},distance:38},
  airDodge:{neutral:{intangible:[3,29],total:56,landing:10},
    directional:{intangible:[3,21],totals:{down:80,diagDown:86,side:96,diagUp:113,up:130},landing:[11,19],speed:2.6}},
  ledge:{getup:{total:30,intangible:[1,24]},attack:{total:40,intangible:[1,20]},roll:{total:40,intangible:[1,30],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:30,intangible:[1,22]},attack:{total:40,intangible:[1,20]},roll:{total:35,intangible:[1,20],distance:30}},
};
const moves={
  jab1:{kind:'ground',total:17,chain:{to:'jab2',from:12},hitboxes:[hb({frames:[3,4],x:11,y:12,r:6,dmg:3,angle:70,bkb:25,kbg:25})]},
  jab2:{kind:'ground',total:29,hitboxes:[hb({frames:[6,8],x:13,y:12,r:8,dmg:8,angle:40,bkb:45,kbg:60})]},
  ftilt:{kind:'ground',total:33,hitboxes:[hb({frames:[8,10],x:17,y:10,r:8,dmg:9,angle:40,bkb:35,kbg:70})]},
  utilt:{kind:'ground',total:39,hitboxes:[hb({frames:[15,17],x:10,y:14,r:9,dmg:13,angle:70,bkb:30,kbg:90})]},
  dtilt:{kind:'ground',total:44,crouch:true,hitboxes:[hb({frames:[8,10],x:16,y:3,r:8,dmg:9,angle:80,bkb:50,kbg:50})]},
  dash:{kind:'ground',total:41,slide:{speed:1.9,from:1},hitboxes:[hb({frames:[8,11],x:13,y:10,r:9,dmg:10,angle:45,bkb:45,kbg:70})]},
  fsmash:{kind:'ground',total:52,smash:true,chargeFrame:5,hitboxes:[hb({frames:[14,16],x:18,y:11,r:9,dmg:13,angle:40,bkb:40,kbg:95})]},
  usmash:{kind:'ground',total:56,smash:true,chargeFrame:6,hitboxes:[hb({frames:[11,17],x:0,y:26,r:11,dmg:13,angle:88,bkb:35,kbg:95})]},
  dsmash:{kind:'ground',total:44,smash:true,chargeFrame:3,hitboxes:[hb({frames:[9,11],x:15,y:3,r:8,dmg:11,angle:30,away:true,bkb:35,kbg:95}),hb({frames:[9,11],x:-15,y:3,r:8,dmg:11,angle:30,away:true,bkb:35,kbg:95})]},
  nair:{kind:'air',total:45,landing:9,autocancel:[8,35],hitboxes:[hb({frames:[8,14],x:0,y:11,r:12,dmg:10,angle:45,away:true,bkb:35,kbg:70})]},
  fair:{kind:'air',total:50,landing:14,autocancel:[6,47],hitboxes:[hb({frames:[6,10],x:16,y:12,r:9,dmg:10,angle:45,bkb:35,kbg:70})]},
  uair:{kind:'air',total:39,landing:12,autocancel:[5,34],hitboxes:[hb({frames:[5,9],x:0,y:26,r:9,dmg:9,angle:85,bkb:30,kbg:80})]},
  dair:{kind:'air',total:48,landing:12,autocancel:[3,34],hitboxes:[
    hb({frames:[17,19],x:2,y:-2,r:7,dmg:14,angle:-80,bkb:30,kbg:70,meteor:true}),
    hb({frames:[17,19],x:8,y:8,r:6,dmg:10,angle:45,bkb:30,kbg:70})]},
  grab:{kind:'ground',total:59,grab:{frames:[15,17],x:18,y:11,r:8}},
  pummel:{kind:'grab',total:19,hitFrame:1,dmg:1.3},
  fthrow:{kind:'throw',total:41,release:16,hit:hb({dmg:10,angle:45,bkb:60,kbg:50})},
  bthrow:{kind:'throw',total:45,release:12,back:true,hit:hb({dmg:10,angle:135,bkb:60,kbg:55})},
  // B 毛线球: charge shot — 13 frames to charge, 125 to full, fires 3 frames after release.
  nspecial:{kind:'special',type:'shot',total:44,charge:{enter:13,max:125,fireDelay:3,endTotal:30,airCharge:false},
    spawn:{x:14,y:12,type:'yarnball'},scale:{dmg:[5,28],r:[3,9],vx:[2.0,2.8]}},
  // 侧B 缠线: slow thread that tangles (slow status).
  sideB:{kind:'special',total:54,spawn:{frame:18,x:14,y:12,type:'thread',max:1}},
  // 上B 毛线钩: tether to a ledge within reach; 3 per airtime; else a small rise.
  upB:{kind:'special',type:'tether',total:40,tether:{frame:8,reach:45,max:3,rise:2.4},helplessLanding:20,hitboxes:[hb({frames:[8,12],x:14,y:18,r:6,dmg:4,angle:70,bkb:40,kbg:30})]},
  // 下B 毛线陷阱: a yarn web at the feet (one on stage; a new one replaces it).
  downB:{kind:'special',total:40,spawn:{frame:11,x:0,y:0,type:'trap',max:1,replace:true}},
  ledgeAttack:{kind:'ledge',total:40,hitboxes:[hb({frames:[22,25],x:14,y:8,r:10,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:40,hitboxes:[hb({frames:[21,24],x:14,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[21,24],x:-14,y:5,r:9,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
const projectiles={
  yarnball:{r:3,vx:2.2,life:100,hit:hb({dmg:5,angle:40,bkb:40,kbg:70})},
  thread:{r:5,vx:1.6,life:75,hit:hb({dmg:6,angle:45,bkb:25,kbg:30}),status:{slow:60}},
  trap:{r:7,vx:0,stationary:true,gravity:0.2,life:600,arm:30,trip:true,hit:hb({dmg:6,angle:0,bkb:0,kbg:0})},
};
applySolved(moves,projectiles,solved);
module.exports={attrs,moves,projectiles,ai:{zoning:{min:50,max:140,key:'neutral',hold:[20,125]},counter:false,trap:true,thread:true}};
