'use strict';
// 🥷 纸箱忍者 — agile trickster (SPEC §5A.3).
let solved={};try{solved=require('./ninja-kb.generated.cjs');}catch{}
const {hb,applySolved}=require('./common.cjs');
const attrs={
  id:'ninja',name:'纸箱忍者',
  weight:88,height:20,radius:6,
  walk:1.502,run:2.288,dash:2.178,dashFrames:10,traction:0.1,
  airSpeed:1.239,airAccel:0.08,airFriction:0.015,
  gravity:0.18,fall:1.85,fastFall:2.96,
  airJumps:1,fullHopAirtime:49,shortHopAirtime:32,airJumpMult:1.0,
  landing:3,
  spotDodge:{intangible:[3,16],total:19},
  roll:{forward:{intangible:[4,14],total:28},back:{intangible:[4,15],total:33},distance:38},
  airDodge:{neutral:{intangible:[2,27],total:41,landing:10},
    directional:{intangible:[2,19],totals:{down:60,diagDown:67,side:71,diagUp:78,up:85},landing:[11,19],speed:2.8}},
  ledge:{getup:{total:28,intangible:[1,22]},attack:{total:36,intangible:[1,20]},roll:{total:36,intangible:[1,28],distance:40},jump:{intangible:[1,10]}},
  floorGetup:{getup:{total:28,intangible:[1,20]},attack:{total:36,intangible:[1,20]},roll:{total:32,intangible:[1,18],distance:30}},
};
const moves={
  jab1:{kind:'ground',total:21,chain:{to:'jab2',from:6},hitboxes:[hb({frames:[3,4],x:11,y:10,r:6,dmg:2,angle:80,bkb:20,kbg:20})]},
  jab2:{kind:'ground',total:21,chain:{to:'jabF',from:6},hitboxes:[hb({frames:[3,4],x:11,y:10,r:6,dmg:2,angle:80,bkb:20,kbg:20})]},
  jabF:{kind:'ground',total:35,hitboxes:[hb({frames:[5,6],x:13,y:10,r:7,dmg:4,angle:40,bkb:45,kbg:70})]},
  ftilt:{kind:'ground',total:32,hitboxes:[hb({frames:[10,12],x:16,y:9,r:8,dmg:8,angle:40,bkb:35,kbg:70})]},
  utilt:{kind:'ground',total:32,hitboxes:[hb({frames:[9,12],x:2,y:21,r:9,dmg:5,angle:88,bkb:40,kbg:60})]},
  dtilt:{kind:'ground',total:22,crouch:true,hitboxes:[hb({frames:[5,6],x:14,y:3,r:6,dmg:4,angle:70,bkb:35,kbg:40})]},
  dash:{kind:'ground',total:28,slide:{speed:2.4,from:1},hitboxes:[hb({frames:[7,9],x:12,y:9,r:8,dmg:8,angle:50,bkb:45,kbg:70})]},
  fsmash:{kind:'ground',total:49,smash:true,chargeFrame:7,hitboxes:[hb({frames:[13,14],x:18,y:10,r:9,dmg:14,angle:40,bkb:40,kbg:95})]},
  usmash:{kind:'ground',total:51,smash:true,chargeFrame:8,hitboxes:[hb({frames:[18,20],x:0,y:24,r:10,dmg:14,angle:88,bkb:35,kbg:95})]},
  dsmash:{kind:'ground',total:49,smash:true,chargeFrame:4,hitboxes:[hb({frames:[11,13],x:15,y:3,r:8,dmg:13,angle:30,away:true,bkb:35,kbg:95}),hb({frames:[11,13],x:-15,y:3,r:8,dmg:13,angle:30,away:true,bkb:35,kbg:95})]},
  nair:{kind:'air',total:52,landing:7,autocancel:[12,40],hitboxes:[hb({frames:[12,15],x:0,y:10,r:11,dmg:11,angle:45,away:true,bkb:35,kbg:70})]},
  fair:{kind:'air',total:54,landing:11,autocancel:[13,40],hitboxes:[hb({frames:[16,18],x:15,y:10,r:9,dmg:14,angle:40,bkb:30,kbg:90})]},
  uair:{kind:'air',total:41,landing:14,autocancel:[3,35],hitboxes:[hb({frames:[7,10],x:0,y:22,r:9,dmg:8,angle:85,bkb:30,kbg:80})]},
  // 下空 纸箱坠: stall, then straight down until landing; bounces off on hit.
  dair:{kind:'air',type:'dive',total:999,landing:30,dive:{from:17,vx:0,vy:-3.6},hitboxes:[hb({frames:[17,999],x:0,y:0,r:8,dmg:8,angle:60,away:true,bkb:40,kbg:50})]},
  grab:{kind:'ground',total:38,grab:{frames:[10,11],x:11,y:10,r:6}},
  pummel:{kind:'grab',total:18,hitFrame:2,dmg:1},
  fthrow:{kind:'throw',total:31,release:15,hit:hb({dmg:8,angle:45,bkb:55,kbg:55})},
  bthrow:{kind:'throw',total:44,release:18,back:true,hit:hb({dmg:9,angle:135,bkb:60,kbg:60})},
  // B 飞镖: hold up to 40 frames — a quick small star or a slow big one.
  nspecial:{kind:'special',type:'shot',total:30,charge:{enter:1,max:40,fireDelay:3,endTotal:27,airCharge:true},
    spawn:{x:12,y:11,type:'shuriken'},scale:{dmg:[3,11],r:[3,7],vx:[3.4,1.8],life:[45,75]}},
  // 侧B 瞬身斩: hold ≥5 frames, vanish (intangible), reappear 30–60 ahead and strike.
  sideB:{kind:'special',type:'sneak',total:90,sneak:{min:5,max:40,vanish:24,appear:18,dist:[30,60],strikeTotal:22},
    hitboxes:[hb({frames:[1,3],x:10,y:10,r:9,dmg:11,angle:40,bkb:40,kbg:80})]},
  // 上B 纸箱弹射: launch in the held direction (default up), then helpless.
  upB:{kind:'special',type:'launch',total:40,launch:{frame:10,speed:4.2,frames:14},helplessLanding:20,hitboxes:[hb({frames:[10,12],x:0,y:10,r:9,dmg:2,angle:80,bkb:40,kbg:20})]},
  // 下B 替身纸箱: counter window 8–34 (invulnerable on 7); swap behind the attacker and strike 12%.
  downB:{kind:'special',type:'counter',total:69,intangible:[7,7],window:[8,34],counter:{fixed:12,behind:true,delay:22,strikeTotal:30,hit:hb({x:12,y:10,r:11,angle:40,bkb:60,kbg:70})}},
  ledgeAttack:{kind:'ledge',total:36,hitboxes:[hb({frames:[20,23],x:12,y:7,r:9,dmg:8,angle:45,bkb:60,kbg:20})]},
  getupAttack:{kind:'getup',total:36,hitboxes:[hb({frames:[19,22],x:12,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20}),hb({frames:[19,22],x:-12,y:5,r:8,dmg:7,angle:45,away:true,bkb:60,kbg:20})]},
};
const projectiles={shuriken:{r:3,vx:3.4,life:45,hit:hb({dmg:3,angle:40,bkb:25,kbg:40})}};
applySolved(moves,projectiles,solved);
module.exports={attrs,moves,projectiles,ai:{zoning:{min:45,max:110,key:'neutral',hold:[0,20]},approach:'sideB',counter:true}};
