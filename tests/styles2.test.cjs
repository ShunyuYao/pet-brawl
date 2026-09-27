'use strict';
// Acceptance tests for the four v0.4 styles (SPEC §5B). Everything is driven through
// controller inputs; M.place only positions fighters (and, like percent, sets a meter).
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../game/formulas.cjs'),M=require('../game/match.cjs'),I=require('../game/input.cjs');
const KO=require('../game/ko.cjs'),AI=require('../game/ai.cjs'),R=require('../game/room.cjs');
const FRESH=F.FRESH_BONUS,ONE=F.ONE_V_ONE;
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<=eps;
function rig(styles){
  const m=M.create({stocks:3,timeLimit:480,countdown:false,styles});
  const pads=[I.create(),I.create()];
  const run=(n=1)=>{for(let i=0;i<n;i++){M.setInput(m,0,pads[0]);M.setInput(m,1,pads[1]);M.step(m);}};
  return {m,pads,run,f:m.fighters};
}
function until(r,cond,max=600,label='condition'){for(let i=1;i<=max;i++){r.run(1);if(cond())return i;}assert.fail('timeout waiting for '+label);}
const H=s=>M.STYLES[s];
const NEW=['sword','grappler','boxer','swift'];

test('eight styles; appearance still independent of style',()=>{
  assert.deepEqual(Object.keys(M.STYLES).sort(),['boxer','cat','grappler','hammer','mage','ninja','swift','sword']);
  for(const style of NEW)assert.equal(R.validateProfile({name:'x',signature:'s',kind:'doll3d',style}).style,style);
});

// ---------- startup & damage (first listed hitbox = tip / sweet spot) ----------
const J=p=>I.press(p,'attack'),FT=p=>{p.x=1;I.press(p,'attack');},UT=p=>{p.y=1;I.press(p,'attack');},DT=p=>{p.y=-1;I.press(p,'attack');};
const FS=p=>{p.x=1;I.press(p,'smash');},US=p=>{p.y=1;I.press(p,'smash');},DS=p=>{p.y=-1;I.press(p,'smash');};
const T={
  sword:[['jab1',5,4,J],['ftilt',9,11,FT],['utilt',6,10,UT],['dtilt',7,9,DT],['fsmash',10,17,FS],['usmash',13,17,US],['dsmash',6,17,DS],['nair',6,9.5,J,true],['fair',6,11.5,FT,true],['uair',5,13,UT,true],['dair',9,15,DT,true]],
  grappler:[['jab1',5,2.5,J],['ftilt',12,13,FT],['utilt',6,9,UT],['dtilt',9,9,DT],['fsmash',21,18,FS],['usmash',13,17,US],['dsmash',18,17,DS],['nair',5,13,J,true],['fair',8,12,FT,true],['uair',7,8,UT,true],['dair',16,15,DT,true]],
  boxer:[['jab1',1,1.5,J],['ftilt',4,8,FT],['utilt',4,6.5,UT],['dtilt',3,8,DT],['fsmash',16,20,FS],['usmash',10,21,US],['dsmash',10,13,DS],['nair',2,2,J,true],['fair',10,5,FT,true],['uair',5,5,UT,true],['dair',7,5,DT,true]],
  swift:[['jab1',3,1.5,J],['ftilt',7,9,FT],['utilt',14,11,UT],['dtilt',11,10,DT],['fsmash',20,20,FS],['usmash',22,14,US],['dsmash',19,16,DS],['nair',7,6,J,true],['fair',14,22,FT,true],['uair',7,10,UT,true],['dair',16,14,DT,true],['nspecial',53,25,p=>I.press(p,'special')]],
};
for(const [style,rows] of Object.entries(T))for(const [id,startup,dmg,trigger,air] of rows){
  test(`${style} ${id}: frame ${startup}, ${dmg}%`,()=>{
    const r=rig([style,style]),hb=H(style).moves[id].hitboxes[0],y=air?100:0,h=H(style).attrs.height;
    const ty=hb.y<0?y+hb.y-h:y+Math.max(0,hb.y-h/2);
    M.place(r.m,0,{x:0,y,facing:1,air});M.place(r.m,1,{x:hb.x,y:ty,facing:-1,air});
    trigger(r.pads[0]);
    const n=until(r,()=>r.f[1].percent>0,120,style+' '+id);
    assert.equal(n,startup,'startup');assert(near(r.f[1].percent,dmg*FRESH*ONE,1e-9),'damage '+r.f[1].percent);
  });
}

// ---------- KO targets ----------
for(const t of KO.TARGETS.filter(t=>NEW.includes(t.style))){
  test(`击杀目标 ${t.style} ${t.label}: ${t.percent}% (±10)`,()=>{
    const got=KO.measure(t);assert(got!==null,'never KOs');
    assert(Math.abs(got-t.percent)<=10,`measured ${got}% vs target ${t.percent}%`);
  });
}

// ---------- 逗猫棒剑士 ----------
test('剑士 tipper: the sword tip hits far harder than the base',()=>{
  const hit=x=>{const r=rig(['sword','sword']);M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x,y:0,facing:-1});
    r.pads[0].x=1;I.press(r.pads[0],'smash');r.run(1);r.pads[0].x=0;until(r,()=>r.f[1].percent>0,40,'fsmash');return r.f[1].percent;};
  const fs=H('sword').moves.fsmash;
  assert(near(hit(fs.hitboxes[0].x),17*FRESH*ONE),'tip');assert(near(hit(fs.hitboxes[1].x-6),13*FRESH*ONE),'base');
});
test('剑士 侧B 逗猫连击: four K presses chain four slashes (3 + 3 + 4 + 6)',()=>{
  const r=rig(['sword','sword']);M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:16,y:0,facing:-1});
  r.pads[0].x=1;I.press(r.pads[0],'special');r.run(1);r.pads[0].x=0;const seen=new Set();
  for(let i=0;i<150;i++){if(i%14===13)I.press(r.pads[0],'special');r.run(1);if(r.f[0].move)seen.add(r.f[0].move.id);}
  assert(['sideB','sideB2','sideB3','sideB4'].every(id=>seen.has(id)),'chained '+[...seen]);
  const expect=[3,3,4,6].map((d,i)=>d*FRESH*ONE).reduce((a,b)=>a+b,0);
  assert(r.f[1].percent>=expect-0.5,'total '+r.f[1].percent.toFixed(2)+' (≥ '+expect.toFixed(2)+')');
});
test('剑士 B 蓄力突刺: 8% tap, 24% full charge, and a full charge breaks a shield',()=>{
  const mv=H('sword').moves.nspecial,b=mv.hitboxes[0];
  for(const [hold,expect] of [[0,8],[mv.chargeMax,24]]){
    const r=rig(['sword','sword']);M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:b.x,y:0,facing:-1});
    I.press(r.pads[0],'special');r.pads[0].h.special=1;r.run(mv.windup+hold);r.pads[0].h.special=0;
    until(r,()=>r.f[1].percent>0,40,'thrust');assert(near(r.f[1].percent,expect*FRESH*ONE,1e-6),'hold '+hold+': '+r.f[1].percent);
  }
  const s=rig(['sword','sword']);M.place(s.m,0,{x:0,y:0,facing:1});M.place(s.m,1,{x:b.x,y:0,facing:-1});
  s.pads[1].h.shield=1;s.run(2);I.press(s.pads[0],'special');s.pads[0].h.special=1;s.run(mv.windup+mv.chargeMax);s.pads[0].h.special=0;
  until(s,()=>s.f[1].state==='shieldbreak'||s.f[1].state==='dizzy',60,'shield break');
});
test('剑士 上B 跃空斩: intangible on frames 4–5, rises, then helpless',()=>{
  const r=rig(['sword','sword']);M.place(r.m,0,{x:0,y:0,facing:1});
  r.pads[0].y=1;I.press(r.pads[0],'special');const inv=[];let top=0,helpless=false;
  for(let i=1;i<=90;i++){r.run(1);if(M.isIntangible(r.m,0))inv.push(i);top=Math.max(top,r.f[0].y);if(r.f[0].state==='helpless')helpless=true;r.pads[0].y=0;}
  assert.deepEqual([inv[0],inv[inv.length-1]],[4,5]);assert(top>=50,'rose '+top);assert(helpless);
});

// ---------- 肉垫摔角手 ----------
test('摔角手 下B 蓄怒: takes 0.4×, then the next hit is ×(1.5 + 0.075×d), used up after one hit',()=>{
  const r=rig(['grappler','grappler']),fs=H('grappler').moves.fsmash.hitboxes[0];
  M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:fs.x,y:0,facing:-1});
  r.pads[1].x=-1;I.press(r.pads[1],'smash');r.run(1);r.pads[1].x=0;r.run(fs.frames[0]-1-6);
  r.pads[0].y=-1;I.press(r.pads[0],'special');r.run(1);r.pads[0].y=0;
  until(r,()=>r.f[0].revengeMult>1,40,'revenge stored');
  const d=fs.dmg*FRESH;assert(near(r.f[0].percent,d*0.4*ONE,1e-6),'absorbed 0.4× '+r.f[0].percent);
  const mult=Math.min(3,1.5+0.075*d);assert(near(r.f[0].revengeMult,mult,1e-9),'multiplier '+r.f[0].revengeMult);
  r.run(80);M.place(r.m,0,{x:0,y:0,facing:1,keepCounters:true});M.place(r.m,1,{x:H('grappler').moves.jab1.hitboxes[0].x,y:0,facing:-1,percent:0});
  I.press(r.pads[0],'attack');until(r,()=>r.f[1].percent>0,40,'boosted jab');
  assert(near(r.f[1].percent,2.5*FRESH*mult*ONE,1e-6),'boosted '+r.f[1].percent);assert.equal(r.f[0].revengeMult,1,'used up');
});
test('摔角手 侧B 绳索摔: a command grab that goes through shields and lariats for 16%',()=>{
  const r=rig(['grappler','grappler']),g=H('grappler').moves.sideB.inhale;
  M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:g.x,y:0,facing:-1});r.pads[1].h.shield=1;r.run(3);
  r.pads[0].x=1;I.press(r.pads[0],'special');r.run(1);r.pads[0].x=0;
  until(r,()=>r.f[1].state==='inhaled',30,'caught');
  until(r,()=>r.f[1].percent>0,90,'lariat');assert(near(r.f[1].percent,16*FRESH*ONE,1e-6),'damage '+r.f[1].percent);
});
test('摔角手 上B 肉垫下劈: a short recovery (much lower than the hammer\'s)',()=>{
  const height=style=>{const r=rig([style,style]);M.place(r.m,0,{x:0,y:0,facing:1});r.pads[0].y=1;I.press(r.pads[0],'special');let top=0;for(let i=0;i<80;i++){r.run(1);r.pads[0].y=0;top=Math.max(top,r.f[0].y);}return top;};
  const g=height('grappler'),h=height('hammer');assert(g<45&&g<h*0.7,`grappler ${g.toFixed(1)} vs hammer ${h.toFixed(1)}`);
});

// ---------- 拳击喵 ----------
test('拳击喵 能量条: taking 100% fills it; K becomes the KO punch, which goes through shields and empties it',()=>{
  const r=rig(['boxer','boxer']);M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:20,y:0,facing:-1});
  // Fill the meter the honest way: get hit by the opponent until 100 %.
  const fs=H('boxer').moves.fsmash.hitboxes[0];
  while(r.f[0].meter<100){M.place(r.m,0,{x:0,y:0,facing:1,keepCounters:true});M.place(r.m,1,{x:fs.x,y:0,facing:-1});r.pads[1].x=-1;I.press(r.pads[1],'smash');r.run(1);r.pads[1].x=0;r.run(70);}
  assert.equal(r.f[0].meter,100);
  const ko=H('boxer').moves.koPunch.hitboxes[0];
  M.place(r.m,0,{x:0,y:0,facing:1,keepCounters:true});M.place(r.m,1,{x:ko.x,y:0,facing:-1,percent:0});r.pads[1].h.shield=1;r.run(3);
  I.press(r.pads[0],'special');r.run(1);assert.equal(r.f[0].move?.id,'koPunch');assert.equal(r.f[0].meter,0,'meter used');
  until(r,()=>r.f[1].percent>0,30,'KO punch through shield');assert(near(r.f[1].percent,35*FRESH*ONE,1e-6),'damage '+r.f[1].percent);
});
test('拳击喵 dealing damage fills the meter at 0.3×',()=>{
  const r=rig(['boxer','boxer']);M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H('boxer').moves.dtilt.hitboxes[0].x,y:0,facing:-1});
  r.pads[0].y=-1;I.press(r.pads[0],'attack');r.run(1);r.pads[0].y=0;until(r,()=>r.f[1].percent>0,20,'dtilt');
  assert(near(r.f[0].meter,r.f[1].percent*0.3,1e-9),'meter '+r.f[0].meter);
});
test('拳击喵 侧B 大摆拳: leaps forward; helpless if it ends in the air',()=>{
  const r=rig(['boxer','boxer']);M.place(r.m,0,{x:-20,y:100,facing:1,air:true});
  r.pads[0].x=1;I.press(r.pads[0],'special');r.run(1);r.pads[0].x=0;
  until(r,()=>r.f[0].state==='helpless',90,'helpless');assert(r.f[0].x+20>=35,'moved '+(r.f[0].x+20));
});

// ---------- 疾风猫 ----------
test('疾风猫 膝撞: 22% only on its first active frame, 6% afterwards',()=>{
  const fair=H('swift').moves.fair,sweet=fair.hitboxes[0];const seen={};
  for(let off=-6;off<=40;off+=1){
    const r=rig(['swift','swift']);M.place(r.m,0,{x:0,y:100,facing:1,air:true});M.place(r.m,1,{x:sweet.x+off,y:100+Math.max(0,sweet.y-10.5),facing:-1,air:true});
    // The dummy drifts in as well, so farther starts make contact on later frames.
    r.pads[0].x=1;r.pads[1].x=-1;I.press(r.pads[0],'attack');let n=0;for(;n<40&&r.f[1].percent===0;n++)r.run(1);
    if(r.f[1].percent>0)seen[n]=r.f[1].percent;
  }
  assert(near(seen[14],22*FRESH*ONE,1e-6),'frame 14 = sweet '+JSON.stringify(seen));
  const late=Object.entries(seen).find(([n])=>Number(n)>14);assert(late&&near(late[1],6*FRESH*ONE,1e-6),'later frames = sour '+JSON.stringify(seen));
});
test('疾风猫 侧B 疾风冲 & 下B 疾风踢: dash forward and hit',()=>{
  for(const [id,press,dist] of [['sideB',p=>{p.x=1;I.press(p,'special');},30],['downB',p=>{p.y=-1;I.press(p,'special');},30]]){
    const r=rig(['swift','swift']);M.place(r.m,0,{x:-50,y:0,facing:1});M.place(r.m,1,{x:10,y:0,facing:-1});
    press(r.pads[0]);r.run(1);r.pads[0].x=0;r.pads[0].y=0;
    until(r,()=>r.f[1].percent>0,80,id+' hits');assert(r.f[0].x+50>=dist,id+' travelled '+(r.f[0].x+50));
  }
});

// ---------- computers use each kit ----------
for(const style of NEW){
  test(`computer with ${style} finishes a match and uses its specials`,()=>{
    // Across up to three matches (one match can go by without a given special).
    const specials=new Set();
    for(let seed=5;seed<11&&specials.size<2;seed+=2){
      const m=M.create({stocks:3,timeLimit:480,countdown:false,styles:['hammer',style]});const a=AI.create({level:3,seed}),b=AI.create({level:3,seed:seed+1});
      let frames=0;
      while(m.phase!=='results'&&frames<480*60+3000){M.setInput(m,0,a.think(m,0));M.setInput(m,1,b.think(m,1));M.step(m);frames++;const mv=m.fighters[1].move?.id;if(mv&&/B\d?$|nspecial|koPunch/.test(mv))specials.add(mv);}
      assert.equal(m.phase,'results');assert(m.fighters.some(f=>f.stocks<3));
    }
    assert(specials.size>=2,'used '+[...specials]);
  });
}
