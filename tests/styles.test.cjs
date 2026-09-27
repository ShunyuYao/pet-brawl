'use strict';
// Acceptance tests for the three new styles (SPEC §5A). Same rules as rules.test.cjs:
// everything is driven through controller inputs; M.place only positions fighters.
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../game/formulas.cjs'),M=require('../game/match.cjs'),I=require('../game/input.cjs');
const KO=require('../game/ko.cjs'),St=require('../game/stage.cjs'),R=require('../game/room.cjs'),AI=require('../game/ai.cjs');
const FRESH=F.FRESH_BONUS,ONE=F.ONE_V_ONE;
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<=eps;
function rig(styles,opts={}){
  const m=M.create({stocks:3,timeLimit:480,countdown:false,styles,...opts});
  const pads=[I.create(),I.create()];
  const run=(n=1)=>{for(let i=0;i<n;i++){M.setInput(m,0,pads[0]);M.setInput(m,1,pads[1]);M.step(m);}};
  return {m,pads,run,f:m.fighters};
}
function until(r,cond,max=600,label='condition'){for(let i=1;i<=max;i++){r.run(1);if(cond())return i;}assert.fail('timeout waiting for '+label);}
const H=s=>M.STYLES[s];

test('all four styles exist and appearance is independent of style',()=>{
  for(const s of ['cat','hammer','mage','ninja'])assert(M.STYLES[s],s);
  for(const style of Object.keys(M.STYLES))for(const kind of R.KINDS)
    assert.equal(R.validateProfile({name:'x',signature:'sig',kind,style}).style,style);
  assert.throws(()=>R.validateProfile({name:'x',signature:'sig',kind:'toy',style:'nope'}),/invalid_profile/);
  // The style, not the look, decides the body: the cat is smaller than the hammer.
  assert(H('cat').attrs.height<H('hammer').attrs.height&&H('cat').attrs.weight<H('hammer').attrs.weight);
});

// ---------- startup & damage per style (SPEC §5A tables) ----------
const T={
  cat:[['jab1',2,2,p=>I.press(p,'attack')],['ftilt',5,4,p=>{p.x=1;I.press(p,'attack');}],['utilt',5,5,p=>{p.y=1;I.press(p,'attack');}],['dtilt',5,4.5,p=>{p.y=-1;I.press(p,'attack');}],
    ['fsmash',12,12,p=>{p.x=1;I.press(p,'smash');}],['usmash',11,15,p=>{p.y=1;I.press(p,'smash');}],['dsmash',8,10,p=>{p.y=-1;I.press(p,'smash');}],
    ['nair',3,6,p=>I.press(p,'attack'),true],['fair',5,5,p=>{p.x=1;I.press(p,'attack');},true],['uair',4,5,p=>{p.y=1;I.press(p,'attack');},true],['sideB',12,9,p=>{p.x=1;I.press(p,'special');}]],
  mage:[['jab1',3,3,p=>I.press(p,'attack')],['ftilt',8,9,p=>{p.x=1;I.press(p,'attack');}],['utilt',15,13,p=>{p.y=1;I.press(p,'attack');}],['dtilt',8,9,p=>{p.y=-1;I.press(p,'attack');}],
    ['fsmash',14,13,p=>{p.x=1;I.press(p,'smash');}],['usmash',11,13,p=>{p.y=1;I.press(p,'smash');}],['dsmash',9,11,p=>{p.y=-1;I.press(p,'smash');}],
    ['nair',8,10,p=>I.press(p,'attack'),true],['fair',6,10,p=>{p.x=1;I.press(p,'attack');},true],['uair',5,9,p=>{p.y=1;I.press(p,'attack');},true],['dair',17,14,p=>{p.y=-1;I.press(p,'attack');},true]],
  ninja:[['jab1',3,2,p=>I.press(p,'attack')],['ftilt',10,8,p=>{p.x=1;I.press(p,'attack');}],['utilt',9,5,p=>{p.y=1;I.press(p,'attack');}],['dtilt',5,4,p=>{p.y=-1;I.press(p,'attack');}],
    ['fsmash',13,14,p=>{p.x=1;I.press(p,'smash');}],['usmash',18,14,p=>{p.y=1;I.press(p,'smash');}],['dsmash',11,13,p=>{p.y=-1;I.press(p,'smash');}],
    ['nair',12,11,p=>I.press(p,'attack'),true],['fair',16,14,p=>{p.x=1;I.press(p,'attack');},true],['uair',7,8,p=>{p.y=1;I.press(p,'attack');},true]],
};
for(const [style,rows] of Object.entries(T))for(const [id,startup,dmg,trigger,air] of rows){
  test(`${style} ${id}: frame ${startup}, ${dmg}%`,()=>{
    const r=rig([style,style]),hb=H(style).moves[id].hitboxes[0],y=air?100:0,h=H(style).attrs.height;
    // Downward hitboxes: the probe hangs just below the feet (bodies must not overlap, or they push apart).
    const ty=hb.y<0?y+hb.y-h:y+Math.max(0,hb.y-h/2);
    M.place(r.m,0,{x:0,y,facing:1,air});M.place(r.m,1,{x:hb.x,y:ty,facing:-1,air});
    trigger(r.pads[0]);
    const n=until(r,()=>r.f[1].percent>0,120,style+' '+id);
    assert.equal(n,startup,'startup');assert(near(r.f[1].percent,dmg*FRESH*ONE,1e-9),'damage '+r.f[1].percent);
  });
}
test('grab speed differs by style: cat 6, ninja 10, mage 15 (long reach)',()=>{
  for(const [style,frame,dist] of [['cat',6,12],['ninja',10,13],['mage',15,20]]){
    const r=rig([style,style]);M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:dist,y:0,facing:-1});
    I.press(r.pads[0],'grab');assert.equal(until(r,()=>r.f[1].state==='grabbed',40,style+' grab'),frame,style);
  }
});

// ---------- KO targets (SPEC §5A) ----------
for(const t of KO.TARGETS.filter(t=>t.style&&t.style!=='hammer')){
  test(`击杀目标 ${t.style} ${t.label}: ${t.percent}% (±10)`,()=>{
    const got=KO.measure(t);assert(got!==null,'never KOs');
    assert(Math.abs(got-t.percent)<=10,`measured ${got}% vs target ${t.percent}%`);
  });
}

// ---------- 猫爪拳 specials ----------
test('猫爪拳 B 爪风: a short-range projectile',()=>{
  const r=rig(['cat','cat']);M.place(r.m,0,{x:-40,y:0,facing:1});M.place(r.m,1,{x:10,y:0,facing:-1});
  I.press(r.pads[0],'special');until(r,()=>r.m.projectiles.length>0,20,'claw spawned');
  until(r,()=>r.f[1].percent>0,60,'claw hits at 50 units');assert(near(r.f[1].percent,4*FRESH*ONE));
  const far=rig(['cat','cat']);M.place(far.m,0,{x:-60,y:0,facing:1});M.place(far.m,1,{x:60,y:0,facing:-1});
  I.press(far.pads[0],'special');far.run(80);assert.equal(far.f[1].percent,0,'does not reach 120 units');
});
test('猫爪拳 侧B 猫扑: lunges ~60 forward; in the air it ends helpless',()=>{
  const r=rig(['cat','cat']);M.place(r.m,0,{x:-20,y:100,facing:1,air:true});
  r.pads[0].x=1;I.press(r.pads[0],'special');r.run(1);r.pads[0].x=0;
  const x0=-20;until(r,()=>r.f[0].state==='helpless',80,'helpless after lunge');
  assert(r.f[0].x-x0>=50,'lunged '+(r.f[0].x-x0));
});
test('猫爪拳 上B 猫跃: intangible frames 8–14, rises, then helpless',()=>{
  const r=rig(['cat','cat']);M.place(r.m,0,{x:0,y:0,facing:1});
  r.pads[0].y=1;I.press(r.pads[0],'special');const inv=[];
  for(let i=1;i<=30;i++){r.run(1);if(M.isIntangible(r.m,0))inv.push(i);}
  assert.deepEqual([inv[0],inv[inv.length-1]],[8,14]);
  r.pads[0].y=0;let top=0,helpless=false;for(let i=0;i<60;i++){r.run(1);top=Math.max(top,r.f[0].y);if(r.f[0].state==='helpless')helpless=true;}
  assert(top>=60,'rose '+top);assert(helpless,'fell helpless after the rise');
});
test('猫爪拳 下B 看破: a hit in the window is countered for max(8, ×1.2)',()=>{
  const r=rig(['cat','cat']),fs=H('cat').moves.fsmash.hitboxes[0];
  M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:fs.x,y:0,facing:-1});
  r.pads[1].x=-1;I.press(r.pads[1],'smash');r.run(1);r.pads[1].x=0;
  r.run(12-1-10);r.pads[0].y=-1;I.press(r.pads[0],'special');r.run(1);r.pads[0].y=0; // counter window opens on frame 6
  until(r,()=>r.f[1].percent>0,60,'counterattack');
  assert.equal(r.f[0].percent,0,'the cat took no damage');
  assert(near(r.f[1].percent,Math.max(8,12*FRESH*1.2)*ONE,1e-6),'counter damage '+r.f[1].percent);
});
test('猫爪拳 下空 猫落: dives down-forward until landing, bounces up on hit',()=>{
  const r=rig(['cat','cat']);M.place(r.m,0,{x:-30,y:60,facing:1,air:true});
  r.pads[0].y=-1;I.press(r.pads[0],'attack');r.run(1);r.pads[0].y=0;
  until(r,()=>r.f[0].ground!=null,120,'lands');assert(r.f[0].x>-30+15,'moved forward '+r.f[0].x);assert.equal(r.f[0].state,'landing');
  const h=rig(['cat','cat']);M.place(h.m,0,{x:-20,y:40,facing:1,air:true});M.place(h.m,1,{x:0,y:0,facing:-1});
  h.pads[0].y=-1;I.press(h.pads[0],'attack');h.run(1);h.pads[0].y=0;
  until(h,()=>h.f[1].percent>0,120,'dive hits');h.run(12);assert(h.f[0].vy>0||h.f[0].y>h.f[1].y+10,'bounced up');
});

// ---------- 毛线球法师 specials ----------
test('毛线球法师 B 毛线球: damage grows with charge (tap ≈5, full 28)',()=>{
  for(const [hold,expect] of [[0,5],[125,28]]){
    const r=rig(['mage','mage']);M.place(r.m,0,{x:-50,y:0,facing:1});M.place(r.m,1,{x:0,y:0,facing:-1});
    I.press(r.pads[0],'special');r.pads[0].h.special=1;r.run(13+hold);r.pads[0].h.special=0;
    until(r,()=>r.f[1].percent>0,120,'shot lands');
    assert(near(r.f[1].percent,expect*FRESH*ONE,0.05),`hold ${hold}: ${r.f[1].percent}`);
  }
});
test('毛线球法师 侧B 缠线: slows the target for 60 frames',()=>{
  const r=rig(['mage','mage']);M.place(r.m,0,{x:-50,y:0,facing:1});M.place(r.m,1,{x:0,y:0,facing:-1});
  r.pads[0].x=1;I.press(r.pads[0],'special');r.run(1);r.pads[0].x=0;
  until(r,()=>r.f[1].percent>0,120,'thread hits');until(r,()=>r.f[1].state==='idle'||r.f[1].state==='walk',120,'can act');
  assert(r.f[1].slow>0,'slowed');
  const x0=r.f[1].x;r.pads[1].x=1;r.run(20);const slowD=r.f[1].x-x0;r.pads[1].x=0;
  r.run(80);const x1=r.f[1].x;r.pads[1].x=1;r.run(20);const normD=r.f[1].x-x1;
  assert(slowD<normD*0.75,`slowed ${slowD.toFixed(1)} vs normal ${normD.toFixed(1)}`);
});
test('毛线球法师 上B 毛线钩: tethers to a ledge out of normal reach; 3 per airtime; counts toward the grab limit',()=>{
  const r=rig(['mage','mage']),L=St.LEDGES[1];
  const tether=()=>{r.pads[0].y=1;I.press(r.pads[0],'special');r.run(1);r.pads[0].y=0;for(let i=0;i<40;i++){r.run(1);if(r.f[0].state==='ledge')return true;}return false;};
  for(let i=1;i<=3;i++){M.place(r.m,0,{x:L.x+38,y:-30,facing:-1,air:true,keepCounters:true});assert(tether(),'tether '+i);assert.equal(r.f[0].ledgeGrabs,i);
    r.pads[0].y=-1;I.press(r.pads[0],'down');r.run(2);r.pads[0].y=0;}
  M.place(r.m,0,{x:L.x+38,y:-30,facing:-1,air:true,keepCounters:true});assert(!tether(),'fourth tether in one airtime fails');
});
test('毛线球法师 下B 毛线陷阱: arms after 30 frames and trips a grounded opponent',()=>{
  const r=rig(['mage','mage']);M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:45,y:0,facing:-1});
  r.pads[0].y=-1;I.press(r.pads[0],'special');r.run(1);r.pads[0].y=0;
  until(r,()=>r.m.projectiles.some(p=>p.type==='trap'),30,'trap placed');
  // Mage steps back out of the way; the opponent walks onto the trap.
  r.pads[0].x=-1;r.run(40);r.pads[0].x=0;r.pads[1].x=-1;
  until(r,()=>r.f[1].state==='down',200,'tripped');
  assert(near(r.f[1].percent,6*FRESH*ONE,1e-6),'trap damage '+r.f[1].percent);
  assert(!r.m.projectiles.some(p=>p.type==='trap'),'trap used up');
});

// ---------- 纸箱忍者 specials ----------
test('纸箱忍者 B 飞镖: tap is a quick 3%, full charge an 11% star',()=>{
  for(const [hold,expect] of [[0,3],[40,11]]){
    const r=rig(['ninja','ninja']);M.place(r.m,0,{x:-50,y:0,facing:1});M.place(r.m,1,{x:0,y:0,facing:-1});
    I.press(r.pads[0],'special');r.pads[0].h.special=1;r.run(1+hold);r.pads[0].h.special=0;
    until(r,()=>r.f[1].percent>0,120,'shuriken lands');assert(near(r.f[1].percent,expect*FRESH*ONE,0.05),`hold ${hold}: ${r.f[1].percent}`);
  }
});
test('纸箱忍者 侧B 瞬身斩: vanishes (intangible), reappears ahead and strikes',()=>{
  const r=rig(['ninja','ninja']);M.place(r.m,0,{x:-40,y:0,facing:1});M.place(r.m,1,{x:30,y:0,facing:-1});
  r.pads[0].x=1;I.press(r.pads[0],'special');r.pads[0].h.special=1;r.run(1);r.pads[0].x=0;r.run(30);r.pads[0].h.special=0;
  let vanished=false;for(let i=0;i<40&&r.f[1].percent===0;i++){r.run(1);if(M.isIntangible(r.m,0))vanished=true;}
  assert(vanished,'intangible while vanished');assert(r.f[1].percent>0,'struck');assert(r.f[0].x>-10,'teleported forward to '+r.f[0].x);
});
test('纸箱忍者 上B 纸箱弹射: launches in the held direction, then helpless',()=>{
  const r=rig(['ninja','ninja']);M.place(r.m,0,{x:0,y:40,facing:1,air:true});
  r.pads[0].y=1;r.pads[0].x=-1;I.press(r.pads[0],'special');r.run(24);r.pads[0].x=0;r.pads[0].y=0;
  assert(r.f[0].x<-25&&r.f[0].y>55,'went up-left to '+[r.f[0].x.toFixed(1),r.f[0].y.toFixed(1)]);
  until(r,()=>r.f[0].state==='helpless',60,'helpless');
});
test('纸箱忍者 下B 替身纸箱: a hit in the window swaps behind the attacker for 12%',()=>{
  const r=rig(['ninja','ninja']),fs=H('ninja').moves.fsmash.hitboxes[0];
  M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:fs.x,y:0,facing:-1});
  r.pads[1].x=-1;I.press(r.pads[1],'smash');r.run(1);r.pads[1].x=0;r.run(13-1-10);
  r.pads[0].y=-1;I.press(r.pads[0],'special');r.run(1);r.pads[0].y=0;
  until(r,()=>r.f[1].percent>0,90,'substitute strike');
  assert.equal(r.f[0].percent,0);assert(near(r.f[1].percent,12*ONE,1e-6),'damage '+r.f[1].percent);
  assert(r.f[0].x>r.f[1].x,'came out behind the attacker');
});
test('纸箱忍者 下空 纸箱坠: straight down until landing',()=>{
  const r=rig(['ninja','ninja']);M.place(r.m,0,{x:-30,y:60,facing:1,air:true});
  r.pads[0].y=-1;I.press(r.pads[0],'attack');r.run(1);r.pads[0].y=0;
  until(r,()=>r.f[0].ground!=null,120,'lands');assert(Math.abs(r.f[0].x+30)<3,'vertical');
});

// ---------- every style fights (AI uses each style's kit) ----------
for(const style of ['cat','mage','ninja']){
  test(`computer with ${style} finishes a match and uses its specials`,()=>{
    const m=M.create({stocks:3,timeLimit:480,countdown:false,styles:['hammer',style]});const a=AI.create({level:3,seed:3}),b=AI.create({level:3,seed:4});
    let frames=0;const specials=new Set();
    while(m.phase!=='results'&&frames<480*60+3000){M.setInput(m,0,a.think(m,0));M.setInput(m,1,b.think(m,1));M.step(m);frames++;const mv=m.fighters[1].move?.id;if(mv&&/B$|nspecial/.test(mv))specials.add(mv);}
    assert.equal(m.phase,'results');assert(m.fighters.some(f=>f.stocks<3),'KOs happened');
    assert(specials.size>=2,'used specials: '+[...specials]);
  });
}
test('snapshots of mixed-style matches validate and replay',()=>{
  const r=rig(['cat','ninja']);M.place(r.m,0,{x:-20,y:0,facing:1});M.place(r.m,1,{x:20,y:0,facing:-1});
  I.press(r.pads[1],'special');r.run(20);
  const snap=M.snapshot(r.m);assert(M.validSnapshot(snap));const copy=M.restore(snap);
  for(let i=0;i<60;i++){for(const x of [r.m,copy]){M.setInput(x,0,r.pads[0]);M.setInput(x,1,r.pads[1]);M.step(x);}}
  assert.equal(JSON.stringify(M.snapshot(copy)),JSON.stringify(M.snapshot(r.m)));
});
