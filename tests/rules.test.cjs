'use strict';
// Rule-layer acceptance tests for SPEC §11. Every scenario is driven through the
// same input objects the keyboard / network produce (held keys + press counters);
// nothing sets an internal state flag to fake a precondition. Test-only helpers
// (M.place) only position fighters on the stage, like picking a spot in training mode.
const test=require('node:test'),assert=require('node:assert/strict');
const {assertPoses}=require('./pose-assertions.cjs');
const F=require('../game/formulas.cjs'),M=require('../game/match.cjs'),I=require('../game/input.cjs');
const H=require('../game/styles/hammer.cjs'),KO=require('../game/ko.cjs'),AI=require('../game/ai.cjs'),St=require('../game/stage.cjs');

const FRESH=F.FRESH_BONUS,ONE=F.ONE_V_ONE;
function rig(opts={}){
  const m=M.create({stocks:3,timeLimit:480,countdown:false,...opts});
  const pads=[I.create(),I.create()];
  const run=(n=1,each)=>{for(let i=0;i<n;i++){each?.(i);M.setInput(m,0,pads[0]);M.setInput(m,1,pads[1]);M.step(m);assertPoses(m);}};
  return {m,pads,run,f:m.fighters};
}
// Step until cond() is true; returns the number of steps taken (fails after max).
function until(r,cond,max=600,label='condition'){for(let i=1;i<=max;i++){r.run(1);if(cond())return i;}assert.fail('timeout waiting for '+label);}
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<=eps;

// ---------- formulas (SPEC §6) ----------
test('knockback / hitstun / hitlag / stale / rage follow the system formulas',()=>{
  // Worked example: p=50 (after hit), d=10, w=100, kbg=100, bkb=30, r=1.
  const expect=((((50/10+50*10/20)*200/(100+100)*1.4)+18)*1+30)*1;
  assert(near(F.knockback({p:50,d:10,w:100,kbg:100,bkb:30,r:1}),expect));
  assert.equal(F.hitstun(100),39);assert.equal(F.hitstun(1),0);
  assert.equal(F.hitlag(10),12);assert.equal(F.hitlag(100),30,'hitlag capped at 30');
  assert.equal(F.hitlag(10,{shield:true}),Math.floor(12*0.67));
  assert.equal(F.launchSpeed(100),3);
  assert.deepEqual(F.STALE,[0.09,0.08545,0.07635,0.0679,0.05945,0.05035,0.04255,0.03345,0.025]);
  assert.equal(F.staleMultiplier([],'jab'),1.05);
  assert(near(F.staleMultiplier([{id:'jab',w:1},{id:'x',w:1},{id:'jab',w:1}],'jab'),1-0.09-0.07635));
  assert(near(F.staleMultiplier([{id:'jab',w:0.85}],'jab'),1-0.09*0.85),'shield hits stale at 0.85');
  assert.equal(F.rage(0),1);assert.equal(F.rage(35),1);assert(near(F.rage(150),1.1));assert(near(F.rage(300),1.1));
  assert(near(F.rage(92.5),1.05));
  assert.equal(F.shieldstun(10),10);
  assert.equal(F.ledgeIntangibility({airtime:300,percent:0,grabs:1}),123,'maximum 123 frames');
  assert.equal(F.ledgeIntangibility({airtime:0,percent:120,grabs:1}),19,'only the catch animation');
  assert.equal(F.ledgeIntangibility({airtime:300,percent:0,grabs:2}),Math.floor(123*0.8));
  assert.equal(F.ledgeIntangibility({airtime:300,percent:0,grabs:3}),Math.floor(123*0.5));
  assert.equal(F.ledgeIntangibility({airtime:300,percent:0,grabs:4}),0);
});

// ---------- per-move startup & damage (SPEC §5.2, §11-7) ----------
// Dummy placement uses the move's own hitbox so the probe lands on the first
// active frame; the assertion is about *when* and *how much*, taken from the spec table.
const TABLE=[
  // [label, move id, startup, damage, how to trigger, air?]
  ['普攻1','jab1',8,3,p=>I.press(p,'attack'),false],
  ['侧强','ftilt',11,10,p=>{p.x=1;I.press(p,'attack');},false],
  ['上强','utilt',7,10,p=>{p.y=1;I.press(p,'attack');},false],
  ['下强','dtilt',6,9,p=>{p.y=-1;I.press(p,'attack');},false],
  ['侧重击','fsmash',26,22,p=>{p.x=1;I.press(p,'smash');},false],
  ['上重击','usmash',15,16,p=>{p.y=1;I.press(p,'smash');},false],
  ['下重击','dsmash',13,13,p=>{p.y=-1;I.press(p,'smash');},false],
  ['空中普攻','nair',7,12,p=>I.press(p,'attack'),true],
  ['前空','fair',13,13,p=>{p.x=1;I.press(p,'attack');},true],
  ['上空','uair',11,11,p=>{p.y=1;I.press(p,'attack');},true],
  ['下空','dair',20,14,p=>{p.y=-1;I.press(p,'attack');},true],
  ['侧B 锤','sideB',24,8,p=>{p.x=1;I.press(p,'special');},false],
];
for(const [label,id,startup,dmg,trigger,air] of TABLE){
  test(`${label} (${id}) hits on frame ${startup} for ${dmg}%`,()=>{
    const r=rig(),mv=H.moves[id],hb=mv.hitboxes[0];
    const y=air?100:0; // high above the top platform (y 46)
    M.place(r.m,0,{x:0,y,facing:1,air});
    M.place(r.m,1,{x:hb.x,y:y+Math.max(0,hb.y-H.attrs.height/2),facing:-1,air});
    r.pads[0].smashHold=false;
    trigger(r.pads[0]);
    const n=until(r,()=>r.f[1].percent>0,120,label+' hit');
    assert.equal(n,startup,label+' startup');
    assert(near(r.f[1].percent,dmg*FRESH*ONE,1e-9),label+' damage '+r.f[1].percent);
    // Smash inputs release immediately so the move is uncharged.
  });
}
test('普攻 1 → 2 → 终结 chain on repeated J',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves.jab1.hitboxes[0].x,y:0,facing:-1});
  I.press(r.pads[0],'attack');until(r,()=>r.f[1].percent>0,40,'jab1');
  const p1=r.f[1].percent;I.press(r.pads[0],'attack');
  const n2=until(r,()=>r.f[1].percent>p1,60,'jab2');
  assert.equal(r.f[0].move?.id,'jab2');assert(near(r.f[1].percent-p1,3*FRESH*ONE));
  const p2=r.f[1].percent;I.press(r.pads[0],'attack');until(r,()=>r.f[1].percent>p2,60,'finisher');
  assert.equal(r.f[0].move?.id,'jabF');assert(near(r.f[1].percent-p2,5*FRESH*ONE));
  assert(n2>0);
});
test('grab (I) catches on frame 8; throws deal 10 / 12',()=>{
  for(const [dir,expect] of [[1,10],[-1,12]]){
    const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:14,y:0,facing:-1});
    I.press(r.pads[0],'grab');const n=until(r,()=>r.f[1].state==='grabbed',30,'grabbed');assert.equal(n,8);
    r.run(4);r.pads[0].x=dir;I.press(r.pads[0],dir>0?'right':'left');
    until(r,()=>r.f[1].percent>0,60,'thrown');r.pads[0].x=0;
    assert(near(r.f[1].percent,expect*FRESH*ONE),'throw damage '+r.f[1].percent);
  }
});
test('蓄力大锤: 15 frames to charge, hits 10 frames after release; 11% uncharged, 35% full',()=>{
  for(const [hold,expect] of [[0,11],[120,35]]){
    const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves.downB.hitboxes[0].x,y:0,facing:-1});
    r.pads[0].y=-1;I.press(r.pads[0],'special');r.pads[0].h.special=1;r.run(1);r.pads[0].y=0;
    r.run(14+hold);r.pads[0].h.special=0;
    const n=until(r,()=>r.f[1].percent>0,40,'jet hammer hit');
    assert.equal(n,10,'hits 10 frames after release');
    assert(near(r.f[1].percent,expect*FRESH*ONE,1e-6),'damage '+r.f[1].percent);
  }
});

// ---------- knockback growth & KO targets (SPEC §5.2, §11-8) ----------
test('same move launches farther at higher percent',()=>{
  const dist=p=>{const r=rig();M.place(r.m,0,{x:-20,y:0,facing:1});M.place(r.m,1,{x:-20+H.moves.ftilt.hitboxes[0].x,y:0,facing:-1,percent:p});
    r.pads[0].x=1;I.press(r.pads[0],'attack');r.run(1);r.pads[0].x=0;until(r,()=>r.f[1].percent>p,40,'hit');
    const x0=r.f[1].x;r.run(40);return r.f[1].x-x0;};
  const a=dist(10),b=dist(60),c=dist(110);assert(a<b&&b<c,`distances ${a} ${b} ${c}`);
});
for(const t of KO.TARGETS){
  test(`击杀目标 ${t.label}: ${t.percent}% (±10)`,()=>{
    const got=KO.measure(t);
    assert(got!==null,'never KOs');
    assert(Math.abs(got-t.percent)<=10,`measured ${got}% vs target ${t.percent}%`);
  });
}

// ---------- staleness (SPEC §6, §11-9) ----------
test('repeating a move weakens it; using nine other moves refreshes it',()=>{
  const r=rig();const hit=(id,trigger)=>{M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves[id].hitboxes[0].x,y:0,facing:-1,percent:0});
    trigger(r.pads[0]);until(r,()=>r.f[1].percent>0,80,id);r.pads[0].x=0;r.pads[0].y=0;r.run(80);return M.lastHit(r.m,1).damage;};
  const jab=p=>I.press(p,'attack');
  const d1=hit('jab1',jab),d2=hit('jab1',jab),d3=hit('jab1',jab);
  assert(near(d1,3*FRESH*ONE));assert(d2<d1&&d3<d2,`stale ${d1} ${d2} ${d3}`);
  assert(near(d2,3*(1-0.09)*ONE));
  for(let i=0;i<9;i++)hit('dtilt',p=>{p.y=-1;I.press(p,'attack');});
  assert(near(hit('jab1',jab),3*FRESH*ONE),'fresh again after nine other moves');
});

// ---------- shield (SPEC §6, §11-10) ----------
test('holding L blocks: no damage, shield shrinks under hits and while held; breaks into dizzy',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves.fsmash.hitboxes[0].x,y:0,facing:-1});
  r.pads[1].h.shield=1;r.run(5);assert.equal(r.f[1].state,'shield');
  const hp0=r.f[1].shieldHP;r.run(10);assert(near(hp0-r.f[1].shieldHP,10*F.SHIELD.decay,1e-6),'shield decays while held');
  r.pads[0].x=1;I.press(r.pads[0],'smash');r.run(1);r.pads[0].x=0;
  const before=r.f[1].shieldHP;until(r,()=>r.f[1].shieldHP<before-5,60,'shield hit');
  assert.equal(r.f[1].percent,0,'blocked hit deals no damage');
  // Keep pressure (fsmash again whenever the attacker can act) until the shield breaks.
  let broke=false;
  for(let i=0;i<1400&&!broke;i++){
    if(r.f[0].state==='idle'&&!r.f[0].move){M.place(r.m,0,{x:r.f[1].x-H.moves.fsmash.hitboxes[0].x,y:0,facing:1,keepCounters:true});r.pads[0].x=1;I.press(r.pads[0],'smash');}
    r.run(1);r.pads[0].x=0;broke=r.f[1].state==='shieldbreak'||r.f[1].state==='dizzy';
  }
  assert(broke,'shield broke');r.pads[1].h.shield=0;until(r,()=>r.f[1].state==='dizzy',200,'dizzy');
});
test('perfect shield: releasing L just before the hit takes no shield damage and no drop lag',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves.ftilt.hitboxes[0].x,y:0,facing:-1});
  r.pads[1].h.shield=1;r.run(3);
  r.pads[0].x=1;I.press(r.pads[0],'attack');r.run(1);r.pads[0].x=0;
  r.run(H.moves.ftilt.hitboxes[0].frames[0]-4);r.pads[1].h.shield=0; // released 3 frames before the hit
  const hp=r.f[1].shieldHP;until(r,()=>M.events(r.m).some(e=>e.type==='parry'),10,'parry');
  assert.equal(r.f[1].percent,0);assert(r.f[1].shieldHP>=hp-1e-9,'no shield damage');
});

// ---------- grab / inhale vs shield (SPEC §11-11) ----------
test('grab and 一口吞 both beat a raised shield',()=>{
  const g=rig();M.place(g.m,0,{x:0,y:0,facing:1});M.place(g.m,1,{x:14,y:0,facing:-1});g.pads[1].h.shield=1;g.run(3);
  I.press(g.pads[0],'grab');until(g,()=>g.f[1].state==='grabbed',30,'grab through shield');
  const n=rig();M.place(n.m,0,{x:0,y:0,facing:1});M.place(n.m,1,{x:18,y:0,facing:-1});n.pads[1].h.shield=1;n.run(3);
  I.press(n.pads[0],'special');until(n,()=>n.f[1].state==='inhaled',40,'inhale through shield');
  until(n,()=>n.f[1].percent>0,120,'spat out');assert(near(n.f[1].percent,10*FRESH*ONE));
});
test('attack beats grab: a jab landing first cancels the grab',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:14,y:0,facing:-1});
  I.press(r.pads[1],'attack');r.run(2);I.press(r.pads[0],'grab');r.run(30); // jab lands on frame 8, grab would on frame 10
  assert.notEqual(r.f[1].state,'grabbed');assert(r.f[0].percent>0,'grabber was hit');
});

// ---------- dodges (SPEC §5.3, §11-12) ----------
function dodgeWindow(r){ // frames a spot dodge is intangible, measured by probing each frame
  let frames=0;for(let i=0;i<40;i++){r.run(1);if(M.isIntangible(r.m,1))frames++;}return frames;
}
test('spot dodge is intangible 3–18 and dodging an attack takes no damage; repeated dodges shrink the window',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves.utilt.hitboxes[0].x,y:0,facing:-1});
  r.pads[1].h.shield=1;r.run(2);r.pads[1].y=-1;I.press(r.pads[1],'down');
  const w1=dodgeWindow(r);assert.equal(w1,16);
  r.pads[1].y=0;r.run(30);
  // Dodge again immediately, and meanwhile the attacker throws an up tilt into the dodge.
  r.pads[1].y=-1;I.press(r.pads[1],'down');r.pads[0].y=1;I.press(r.pads[0],'attack');
  const w2=dodgeWindow(r);assert.equal(w2,15,'one stale level = one frame less');
  assert.equal(r.f[1].percent,0,'no damage while intangible');
});
test('one air dodge per airtime',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:80,facing:1,air:true});
  I.press(r.pads[0],'shield');r.run(1);assert.equal(r.f[0].state,'airdodge');r.run(60);
  I.press(r.pads[0],'shield');r.run(1);assert.notEqual(r.f[0].state,'airdodge');
});

// ---------- armor (SPEC §11-13) ----------
test('蓄力大锤 heavy armor: a jab does not interrupt, a smash does',()=>{
  for(const [id,trigger,interrupted] of [['jab1',p=>I.press(p,'attack'),false],['fsmash',p=>{p.x=-1;I.press(p,'smash');},true]]){
    const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves[id].hitboxes[0].x,y:0,facing:-1});
    // Charge fully, then release so that the opponent's hit lands inside the 14 armored frames.
    r.pads[0].y=-1;I.press(r.pads[0],'special');r.pads[0].h.special=1;r.run(1);r.pads[0].y=0;r.run(14+120);
    trigger(r.pads[1]);r.pads[1].x=0;
    r.run(Math.max(1,H.moves[id].hitboxes[0].frames[0]-3));r.pads[0].h.special=0;
    until(r,()=>r.f[0].percent>0,40,'opponent hit lands');
    const swung=(()=>{for(let i=0;i<30;i++){r.run(1);if(r.f[1].percent>0)return true;}return false;})();
    assert.equal(!swung,interrupted,id+(interrupted?' should interrupt':' should not interrupt'));
  }
});

// ---------- up special (SPEC §11-14) ----------
test('上B: rises with W+K, S cancels into helpless fall where J/K do nothing until landing',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});
  r.pads[0].y=1;I.press(r.pads[0],'up');I.press(r.pads[0],'tap');I.press(r.pads[0],'special');r.run(1);
  assert.equal(r.f[0].move?.id,'upB','W+K on the same frame is up special, not a jump');
  r.run(20);assert(r.f[0].y>20,'rose '+r.f[0].y);r.pads[0].y=0;
  r.pads[0].y=-1;I.press(r.pads[0],'down');r.run(1);r.pads[0].y=0;
  assert.equal(r.f[0].state,'helpless');
  I.press(r.pads[0],'attack');I.press(r.pads[0],'special');r.run(3);assert.equal(r.f[0].state,'helpless','no attack while helpless');
  until(r,()=>r.f[0].ground!=null,400,'landing');
  r.run(40);I.press(r.pads[0],'attack');r.run(1);assert.equal(r.f[0].move?.id,'jab1','acts again after landing');
});

// ---------- meteor (SPEC §11-15) ----------
test('下空 sweet spot sends an airborne opponent downward; sour spot does not',()=>{
  for(const [box,down] of [[0,true],[1,false]]){
    const r=rig(),hb=H.moves.dair.hitboxes[box];
    // The sour-spot probe sits further out and higher so only the handle reaches it.
    const ox=box===1?8:0,oy=box===1?6:0;
    M.place(r.m,0,{x:0,y:100,facing:1,air:true});M.place(r.m,1,{x:hb.x+ox,y:100+hb.y-H.attrs.height/2+oy,facing:-1,air:true,percent:60});
    r.pads[0].y=-1;I.press(r.pads[0],'attack');r.run(1);r.pads[0].y=0;
    until(r,()=>r.f[1].percent>60,40,'dair hit');const hit=M.lastHit(r.m,1);
    assert.equal(hit.box,box);assert.equal(hit.ky<0,down,'vertical launch '+hit.ky);
  }
});

// ---------- stocks, respawn, game end (SPEC §11-16) ----------
test('KO costs a stock, respawn is invincible for 2 s, last stock ends the game',()=>{
  const r=rig({stocks:3});M.place(r.m,1,{x:0,y:0,facing:1});
  // Self-destruct: run off the right edge and hold S in the air so the ledge is not grabbed.
  const sd=()=>{r.pads[1].x=1;r.pads[1].run=1;until(r,()=>{r.pads[1].y=r.f[1].ground==null&&r.f[1].state!=='respawn'?-1:0;return r.f[1].state==='dead'||r.f[1].state==='out';},900,'self-destruct');r.pads[1].x=0;r.pads[1].run=0;r.pads[1].y=0;};
  sd();assert.equal(r.f[1].stocks,2);
  until(r,()=>r.f[1].state==='respawn',200,'respawn platform');
  I.press(r.pads[1],'left');r.pads[1].x=-1;r.run(2);r.pads[1].x=0;
  assert(M.isIntangible(r.m,1),'invincible after leaving the platform');r.run(119);assert(M.isIntangible(r.m,1));r.run(2);assert(!M.isIntangible(r.m,1),'invincibility lasts 120 frames');
  sd();M.place(r.m,1,{x:0,y:0,facing:1});sd();
  assert.equal(r.f[1].stocks,0);until(r,()=>r.m.phase==='results',400,'results');
  assert.equal(r.m.result.winner,0);
});

// ---------- ledge (SPEC §6, §11-17) ----------
test('ledge regrabs lose intangibility and the 7th grab before landing fails',()=>{
  const r=rig(),L=St.LEDGES[1];const got=[];
  for(let i=1;i<=7;i++){
    M.place(r.m,0,{x:L.x+10,y:-12,facing:-1,air:true,keepCounters:true});
    const n=(()=>{for(let k=0;k<30;k++){r.run(1);if(r.f[0].state==='ledge')return k;}return -1;})();
    if(i<=6){assert(n>=0,'grab '+i);got.push(r.f[0].ledgeIntangible);r.pads[0].y=-1;I.press(r.pads[0],'down');r.run(2);r.pads[0].y=0;r.run(3);}
    else assert.equal(n,-1,'7th grab refused');
  }
  assert(got[1]<got[0]&&got[2]<got[1]&&got[3]===0,'intangibility '+got);
});
test('trumping steals the ledge and pops the hanging fighter off',()=>{
  const r=rig(),L=St.LEDGES[1];
  M.place(r.m,0,{x:L.x+10,y:-12,facing:-1,air:true});until(r,()=>r.f[0].state==='ledge',40,'p0 hang');
  M.place(r.m,1,{x:L.x+10,y:-12,facing:-1,air:true});until(r,()=>r.f[1].state==='ledge',40,'p1 trump');
  assert.notEqual(r.f[0].state,'ledge');
});

// ---------- time limit & sudden death (SPEC §9, §11-18) ----------
test('time out: more stocks wins, then lower percent, full tie goes to 300% sudden death',()=>{
  const short={timeLimit:2};
  const a=rig(short);M.place(a.m,1,{x:0,y:0,facing:1,percent:10});a.f[0].stocks=3;a.f[1].stocks=2;
  until(a,()=>a.m.phase==='results'||a.m.phase==='game',200,'timeout');until(a,()=>a.m.phase==='results',200,'results');assert.equal(a.m.result.winner,0);assert.equal(a.m.result.reason,'time');
  const b=rig(short);M.place(b.m,0,{x:-30,y:0,facing:1,percent:80});M.place(b.m,1,{x:30,y:0,facing:-1,percent:20});
  until(b,()=>b.m.phase==='results',400,'results');assert.equal(b.m.result.winner,1,'lower percent wins');
  const c=rig(short);M.place(c.m,0,{x:-30,y:0,facing:1,percent:40});M.place(c.m,1,{x:30,y:0,facing:-1,percent:40});
  until(c,()=>c.m.phase==='sudden',400,'sudden death');
  assert.equal(c.f[0].percent,300);assert.equal(c.f[1].percent,300);assert.equal(c.f[0].stocks,1);
});

// ---------- controls (SPEC §3, §11-5/6) ----------
test('short hop vs full hop, four air jumps',()=>{
  const peak=holdFrames=>{const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});I.press(r.pads[0],'jump');r.pads[0].h.jump=1;
    let top=0;for(let i=0;i<90;i++){if(i>=holdFrames)r.pads[0].h.jump=0;r.run(1);top=Math.max(top,r.f[0].y);}return top;};
  const sh=peak(1),fh=peak(10);assert(fh>sh*1.4,`full ${fh} vs short ${sh}`);
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});I.press(r.pads[0],'jump');r.run(10);
  let jumps=0;for(let i=0;i<6;i++){const vy=r.f[0].vy;I.press(r.pads[0],'jump');r.run(2);if(r.f[0].vy>vy+0.5)jumps++;r.run(6);}
  assert.equal(jumps,4,'exactly four mid-air jumps');
});
test('W tap-jump: W+J is up tilt, W+U up smash; Space then J is an aerial',()=>{
  const go=(first,second)=>{const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});r.pads[0].y=first==='w'?1:0;
    if(first==='w'){I.press(r.pads[0],'up');I.press(r.pads[0],'tap');}else{I.press(r.pads[0],'jump');r.pads[0].h.jump=1;}
    r.run(1);r.pads[0].y=1;I.press(r.pads[0],second);r.run(4);return r.f[0];};
  assert.equal(go('w','attack').move?.id,'utilt');
  assert.equal(go('w','smash').move?.id,'usmash');
  const air=go('space','attack');assert.equal(air.ground,null);assert.equal(air.move?.id,'uair');
});
test('S drops through a soft platform but not through the main stage',()=>{
  const r=rig();const P=St.PLATFORMS[0];M.place(r.m,0,{x:(P.x0+P.x1)/2,y:P.y,facing:1});r.run(2);assert.equal(r.f[0].ground,0+1,'standing on platform 0');
  r.pads[0].y=-1;I.press(r.pads[0],'down');r.run(20);r.pads[0].y=0;assert(r.f[0].y<P.y-3,'fell through');
  until(r,()=>r.f[0].ground===0,200,'lands on main stage');
  r.pads[0].y=-1;I.press(r.pads[0],'down');r.run(20);assert.equal(r.f[0].ground,0,'main stage is solid');assert.equal(r.f[0].state,'crouch');
});

// ---------- network-facing input semantics (SPEC §10, §11-19) ----------
test('five J presses delivered in 20 Hz bursts are all seen and drive the jab chain',()=>{
  // A player taps J every 12 frames; the input only reaches the match every 3 frames
  // (20 Hz), so several presses can arrive in one update. Counters lose none of them.
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves.jab1.hitboxes[0].x,y:0,facing:-1});
  const local=I.create(),seen=new Set();
  for(let t=0;t<120;t++){
    if(t%12===0&&t<60)I.press(local,'attack');
    if(t%3===0)M.setInput(r.m,0,local);
    M.setInput(r.m,1,r.pads[1]);M.step(r.m);
    if(r.f[0].move)seen.add(r.f[0].move.id);
  }
  assert.equal(M.stats(r.m,0).pressesSeen.attack,5);
  assert(seen.has('jab2')&&seen.has('jabF'),'chain reached the finisher: '+[...seen]);
});
test('counters never rewind and absurd values are clamped',()=>{
  const r=rig();const p=I.create();p.c.attack=5;M.setInput(r.m,0,p);M.step(r.m);
  const q=I.create();q.c.attack=2;M.setInput(r.m,0,q);M.step(r.m);
  assert.equal(M.stats(r.m,0).pressesSeen.attack,5,'lower counter ignored');
  const z=I.create();z.c.attack=1e9;z.x=99;M.setInput(r.m,0,z);assert.equal(r.m.inputs[0].x,1);
});

// ---------- 2D / 3D fairness (SPEC §2, §11-3) ----------
test('avatar kind never changes the simulation',()=>{
  const trace=kind=>{const r=rig({profiles:[{kind},{kind:kind==='doll3d'?'sprite':'doll3d'}]});
    M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:H.moves.fsmash.hitboxes[0].x,y:0,facing:-1,percent:70});
    r.pads[0].x=1;I.press(r.pads[0],'smash');r.run(1);r.pads[0].x=0;r.run(90);return JSON.stringify([r.f[1].x,r.f[1].y,r.f[1].percent]);};
  assert.equal(trace('doll3d'),trace('sprite'));
});

// ---------- CPU (SPEC §9, §11-22) ----------
test('computer player finishes a match against an idle opponent',()=>{
  const m=M.create({stocks:3,timeLimit:480,countdown:false});const cpu=AI.create({level:3,seed:7});const idle=I.create();
  let frames=0;while(m.phase!=='results'&&frames<480*60+600){M.setInput(m,1,cpu.think(m,1));M.setInput(m,0,idle);M.step(m);frames++;}
  assert.equal(m.phase,'results');assert.equal(m.result.winner,1,'CPU wins');assert.equal(m.fighters[0].stocks,0,'by taking all stocks');
});
test('two computer players can play a full match to a result',()=>{
  const m=M.create({stocks:3,timeLimit:480,countdown:false});const a=AI.create({level:2,seed:1}),b=AI.create({level:3,seed:2});
  let frames=0;while(m.phase!=='results'&&frames<480*60+3000){M.setInput(m,0,a.think(m,0));M.setInput(m,1,b.think(m,1));M.step(m);frames++;}
  assert.equal(m.phase,'results');assert(m.fighters.some(f=>f.stocks<3),'somebody got KOed');
});
test('snapshot / restore reproduces the simulation exactly',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:20,y:0,facing:-1});
  r.pads[0].x=1;I.press(r.pads[0],'smash');r.run(5);
  const snap=M.snapshot(r.m),copy=M.restore(JSON.parse(JSON.stringify(snap)));
  for(let i=0;i<60;i++){M.setInput(r.m,0,r.pads[0]);M.setInput(r.m,1,r.pads[1]);M.step(r.m);M.setInput(copy,0,r.pads[0]);M.setInput(copy,1,r.pads[1]);M.step(copy);}
  assert.equal(JSON.stringify(M.snapshot(copy)),JSON.stringify(M.snapshot(r.m)));
  assert(M.validSnapshot(snap));assert(!M.validSnapshot({...snap,fighters:[{x:'nan'}]}));
});

// ---------- body pushing (no walking through each other) ----------
test('walking into the opponent pushes them instead of passing through',()=>{
  const r=rig();M.place(r.m,0,{x:-30,y:0,facing:1});M.place(r.m,1,{x:0,y:0,facing:-1});
  r.pads[0].x=1;let minGap=Infinity;
  for(let i=0;i<150;i++){r.run(1);minGap=Math.min(minGap,r.f[1].x-r.f[0].x);}
  assert(minGap>=13.9,'bodies kept apart (hurtboxes touch, never overlap), min gap '+minGap.toFixed(2));
  assert(r.f[1].x>5,'the idle opponent was pushed along: '+r.f[1].x.toFixed(2));
});
test('pushing never shoves a grounded fighter off the stage',()=>{
  const r=rig();M.place(r.m,0,{x:40,y:0,facing:1});M.place(r.m,1,{x:60,y:0,facing:-1});
  r.pads[0].x=1;r.run(200);
  assert.equal(r.f[1].ground,0,'still on the stage');assert(r.f[1].x<=70);
});
test('pinned against the edge, the opponent still cannot be walked or dashed through',()=>{
  for(const run of [0,1]){
    const r=rig();M.place(r.m,0,{x:20,y:0,facing:1});M.place(r.m,1,{x:60,y:0,facing:-1});
    r.pads[0].x=1;r.pads[0].run=run;let minGap=Infinity;
    for(let i=0;i<300;i++){r.run(1);minGap=Math.min(minGap,r.f[1].x-r.f[0].x);}
    assert(minGap>=13.9,(run?'dash':'walk')+' min gap '+minGap.toFixed(2));
    assert.equal(r.f[1].ground,0,'opponent still on the stage');
  }
});
test('rolls still pass through the opponent (intangible cross-up)',()=>{
  const r=rig();M.place(r.m,0,{x:0,y:0,facing:1});M.place(r.m,1,{x:14,y:0,facing:-1});
  r.pads[0].h.shield=1;r.run(2);I.press(r.pads[0],'right');r.run(40);r.pads[0].h.shield=0;
  assert(r.f[0].x>r.f[1].x,'rolled behind the opponent');
});
test('pushing works the same from either side',()=>{
  const r=rig();M.place(r.m,0,{x:30,y:0,facing:-1});M.place(r.m,1,{x:0,y:0,facing:1});
  r.pads[0].x=-1;let minGap=Infinity;
  for(let i=0;i<150;i++){r.run(1);minGap=Math.min(minGap,r.f[0].x-r.f[1].x);}
  assert(minGap>=13.9,'min gap from the right '+minGap.toFixed(2));
  const e=rig();M.place(e.m,0,{x:-20,y:0,facing:-1});M.place(e.m,1,{x:-60,y:0,facing:1});
  e.pads[0].x=-1;e.pads[0].run=1;let g=Infinity;for(let i=0;i<300;i++){e.run(1);g=Math.min(g,e.f[0].x-e.f[1].x);}
  assert(g>=13.9,'left edge dash min gap '+g.toFixed(2));assert.equal(e.f[1].ground,0);
});
test('landing on top of the opponent eases apart instead of snapping',()=>{
  const r=rig();M.place(r.m,1,{x:0,y:0,facing:1});M.place(r.m,0,{x:1,y:30,facing:1,air:true});
  let maxJump=0,prev=r.f[0].x;
  for(let i=0;i<60;i++){r.run(1);maxJump=Math.max(maxJump,Math.abs(r.f[0].x-prev));prev=r.f[0].x;}
  assert(maxJump<=1.5,'largest sideways step '+maxJump.toFixed(2));
  assert(Math.abs(r.f[0].x-r.f[1].x)>=13.9,'apart once both stand');
});
