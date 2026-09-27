'use strict';
// SPEC §8 / §11-23…26: the three stages. Everything is driven by the same input
// objects the keyboard produces; M.place only picks a starting spot, like training mode.
const test=require('node:test'),assert=require('node:assert/strict');
const {assertPoses}=require('./pose-assertions.cjs');
const M=require('../game/match.cjs'),I=require('../game/input.cjs'),AI=require('../game/ai.cjs'),St=require('../game/stage.cjs'),R=require('../game/room.cjs');

function rig(stage,styles=['hammer','hammer']){
  const m=M.create({stocks:3,timeLimit:480,countdown:false,styles,stage});
  const pads=[I.create(),I.create()];
  const run=(n=1)=>{for(let i=0;i<n;i++){M.setInput(m,0,pads[0]);M.setInput(m,1,pads[1]);M.step(m);assertPoses(m);}};
  return {m,pads,run,f:m.fighters};
}
function until(r,cond,max=600,label='condition'){for(let i=1;i<=max;i++){r.run(1);if(cond())return i;}assert.fail('timeout waiting for '+label);}
// Full hop, then the air jump at the top of the hop; returns the ground landed on.
function doubleJump(r){
  r.pads[0].h.jump=1;I.press(r.pads[0],'jump');r.run(12);r.pads[0].h.jump=0;
  until(r,()=>r.f[0].vy<=0,80,'apex');I.press(r.pads[0],'jump');r.run(2);
  until(r,()=>r.f[0].ground!=null,300,'landing');return r.f[0].ground;
}

test('three stages exist; a match remembers which one it is on',()=>{
  assert.deepEqual(Object.keys(St.STAGES),['court','moon','town']);
  assert.equal(M.create({countdown:false}).stage,'court','default stays the basket court');
  assert.equal(M.create({countdown:false,stage:'moon'}).stage,'moon');
  assert.throws(()=>M.create({stage:'mars'}),/unknown_stage/);
});

test('奶酪月台: no platforms — a full hop + air jump comes back down on the main stage',()=>{
  // Control: the same jump under the basket court's left platform lands on it.
  const bf=rig('court');M.place(bf.m,0,{x:-39,y:0,facing:1});M.place(bf.m,1,{x:60,y:0});
  assert.notEqual(doubleJump(bf),0,'court: lands on a platform');
  const fd=rig('moon');M.place(fd.m,0,{x:-39,y:0,facing:1});M.place(fd.m,1,{x:60,y:0});
  assert.equal(doubleJump(fd),0,'moon: back on the main stage');
  M.place(fd.m,0,{x:0,y:0});assert.equal(doubleJump(fd),0,'moon: nothing above the centre either');
});

test('奶酪月台 is wider: x=80 is still ground, walking on leaves at 85 and the ledge there catches',()=>{
  const fd=rig('moon');M.place(fd.m,0,{x:80,y:0,facing:1});M.place(fd.m,1,{x:-60,y:0});fd.run(10);
  assert.equal(fd.f[0].ground,0,'standing at x=80');
  const bf=rig('court');M.place(bf.m,0,{x:80,y:0,facing:1,air:true});M.place(bf.m,1,{x:-60,y:0});bf.run(10);
  assert.equal(bf.f[0].ground,null,'court: x=80 is past the edge');
  fd.pads[0].x=1;until(fd,()=>fd.f[0].ground==null,120,'walk off');fd.pads[0].x=0;
  assert(fd.f[0].x>85&&fd.f[0].x<90,'left the stage at its edge x='+fd.f[0].x);
  M.place(fd.m,0,{x:95,y:-12,facing:-1,air:true});fd.pads[0].x=-1;
  until(fd,()=>fd.f[0].state==='ledge',60,'ledge grab');fd.pads[0].x=0;
  assert.equal(St.STAGES.moon.LEDGES[fd.f[0].ledge].x,85);
});

test('猫薄荷小镇: the platform position depends only on the frame (pauses 90 at each end, 0.3 per frame)',()=>{
  const T=St.STAGES.town,c=f=>T.surface(1,f).x0+17,eq=(a,b,msg)=>assert(Math.abs(a-b)<1e-9,msg+': '+a+' vs '+b);
  eq(c(0),-45,'left end');eq(c(90),-45,'paused at the left end');
  eq(c(190),-45+30,'moving right at 0.3/frame');
  eq(c(390),45,'right end');eq(c(480),45,'paused at the right end');eq(c(580),45-30,'moving back left');
  eq(c(780),-45,'one round trip is 780 frames');
  assert.equal(T.surface(1,12345).y,26);
});

test('猫薄荷小镇: jump onto the moving platform, ride it without input, press S to drop through',()=>{
  const r=rig('town');M.place(r.m,1,{x:60,y:0});
  // Frame 0: the platform is resting at the left end (centre −45).
  M.place(r.m,0,{x:-45,y:0,facing:1});
  r.pads[0].h.jump=1;I.press(r.pads[0],'jump');r.run(14);r.pads[0].h.jump=0;
  until(r,()=>r.f[0].ground!=null,120,'land');assert.equal(r.f[0].ground,1,'landed on the moving platform');
  until(r,()=>r.m.frame>=150,300,'platform moving');
  const x0=r.f[0].x,p0=St.STAGES.town.surface(1,r.m.frame).x0;r.run(100);
  const moved=r.f[0].x-x0,pmoved=St.STAGES.town.surface(1,r.m.frame).x0-p0;
  assert(pmoved>20,'platform moved '+pmoved);
  assert(Math.abs(moved-pmoved)<1e-6&&r.f[0].ground===1,`rides along: fighter ${moved.toFixed(2)} vs platform ${pmoved.toFixed(2)}`);
  r.pads[0].y=-1;I.press(r.pads[0],'down');r.run(3);r.pads[0].y=0;
  until(r,()=>r.f[0].ground===0,200,'drop to the main stage');
});

test('猫薄荷小镇: snapshot / restore replays to the identical state (platform included)',()=>{
  const r=rig('town');const pads=()=>{const p=I.create();return p;};
  r.run(333);const snap=M.snapshot(r.m);
  const play=m=>{const a=AI.create({level:3,seed:4}),b=AI.create({level:3,seed:5});for(let i=0;i<900;i++){M.setInput(m,0,a.think(m,0));M.setInput(m,1,b.think(m,1));M.step(m);}return JSON.stringify(m);};
  assert.equal(play(M.restore(snap)),play(M.restore(snap)));void pads;
});

test('each stage has its own spawns and respawn point above its stage',()=>{
  for(const [id,S] of Object.entries(St.STAGES)){
    const m=M.create({countdown:false,stage:id});
    for(const f of m.fighters)assert(f.x>S.MAIN.x0&&f.x<S.MAIN.x1,id+' spawn on the stage');
    assert(S.RESPAWN.y>Math.max(0,...S.PLATFORMS.map(p=>p.y)),id+' respawn above every platform');
  }
});

test('the level-3 computer finishes matches on every stage without falling off much more than on the basket court',()=>{
  const sds={};
  for(const stage of Object.keys(St.STAGES)){
    let n=0,sd=0;
    for(const [sa,sb] of [['hammer','cat'],['ninja','swift'],['mage','grappler']]){
      const m=M.create({stocks:3,timeLimit:480,countdown:false,styles:[sa,sb],stage});
      const a=AI.create({level:3,seed:11}),b=AI.create({level:3,seed:12});let f=0;
      while(m.phase!=='results'&&f<480*60+4000){M.setInput(m,0,a.think(m,0));M.setInput(m,1,b.think(m,1));M.step(m);f++;}
      assert.equal(m.phase,'results',stage+' '+sa+' v '+sb+' finishes');n++;sd+=m.stats[0].sds+m.stats[1].sds;
    }
    sds[stage]=sd/n;
  }
  for(const s of ['moon','town'])assert(sds[s]<=sds.court*1.5+1,`${s}: ${sds[s]} self-destructs per match vs the basket court ${sds.court}`);
});

test('room: the host picks the stage; it is in the view and the next match uses it',()=>{
  const room=R.create({seed:'s',solo:true});
  room.join(0,{name:'我',signature:'a',kind:'toy',color:'#ff5a7a',style:'hammer'});
  room.join(1,{name:'电脑',signature:'b',kind:'toy',color:'#6c7cff',style:'cat'},{isAI:true});
  assert.equal(room.view(0).settings.stage,'court');
  room.setStage('town');assert.equal(room.view(0).settings.stage,'town');
  assert.throws(()=>room.setStage('mars'),/invalid_stage/);
  assert(R.validView(room.view(0)));
  room.ready(0,true);for(let i=0;i<5;i++)room.tick();
  assert.equal(room.view(0).match.stage,'town');
  assert.throws(()=>room.setStage('moon'),/invalid_phase/,'no switching mid-match');
});
