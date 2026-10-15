'use strict';
// Exercise the actual presentation module with simulation-generated fighter states,
// including the snapshot/restore representation consumed by a network guest.
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../game/match.cjs'),I=require('../game/input.cjs');
const {computePose,finite}=require('./pose-assertions.cjs');
function runSpecial(style,x,y){
  const m=M.create({countdown:false,styles:[style,'grappler']});
  M.place(m,0,{x:0,y:0,facing:1});M.place(m,1,{x:-80,y:0,facing:1});
  const pad=I.create();pad.x=x;pad.y=y;I.press(pad,'special');
  const moves=new Set();let spawned=false,releasePose;
  for(let n=0;n<180;n++){
    M.setInput(m,0,pad);M.step(m);pad.x=0;pad.y=0;
    const f=m.fighters[0];if(f.move)moves.add(f.move.id);
    const pose=computePose(f,{style,t:n/60});finite(pose,style+' frame '+n);
    const guest=M.restore(M.snapshot(m));
    assert.deepEqual(computePose(guest.fighters[0],{style,t:n/60}),pose,'network snapshot has the same pose');
    if(m.projectiles.some(p=>p.type==='thread'))spawned=true;
    if(f.move?.id==='sideB'&&f.move.frame===18)releasePose=pose;
  }
  return {moves,spawned,releasePose};
}
test('mage thread casts without melee hitboxes and leans on the projectile release frame',()=>{
  const result=runSpecial('mage',1,0);
  assert(result.moves.has('sideB'));assert(result.spawned,'the thread really spawns');
  assert.equal(result.releasePose.lean,0.3);
});
test('swift neutral punch visibly winds up, strikes and recovers at its real hit frames',()=>{
  // Regression: K dealt damage but held the same arm angle and backward lean
  // throughout the entire attack, making a working special look frozen.
  const m=M.create({countdown:false,styles:['swift','grappler']});
  M.place(m,0,{x:0,y:0,facing:1});M.place(m,1,{x:-80,y:0,facing:1});
  const pad=I.create(),poses=new Map(),mv=M.STYLES.swift.moves.nspecial;
  const [start,end]=mv.hitboxes[0].frames,rest=computePose(m.fighters[0],{style:'swift'});
  I.press(pad,'special');
  for(let frame=1;frame<=mv.total+1;frame++){
    M.setInput(m,0,pad);M.step(m);
    const f=m.fighters[0],pose=computePose(f,{style:'swift',t:frame/60});
    const guest=M.restore(M.snapshot(m));
    assert.deepEqual(computePose(guest.fighters[0],{style:'swift',t:frame/60}),pose,'peer renders the same punch');
    assert.equal(f.x,0,'neutral punch stays in place');finite(pose,'swift punch');poses.set(frame,pose);
  }
  const windup=poses.get(start-1),strike=poses.get(start),recover=poses.get(mv.total-1);
  assert(Math.abs(windup.hammer.angle-rest.hammer.angle)>0.6,'arm visibly draws back before the punch');
  assert(windup.lean<0&&windup.fx.charge>0,'windup is visible during the long startup');
  assert(Math.abs(strike.hammer.angle-windup.hammer.angle)>0.8,'arm punches on the damage frame');
  assert(strike.lean>0&&strike.fx.trail>0,'body follows the punch forward');
  assert.equal(strike.fx.charge,0,'windup ends when damage starts');
  assert(poses.get(end).fx.trail>0,'strike stays visible for the active hit window');
  assert(Math.abs(recover.hammer.angle-rest.hammer.angle)<0.05&&Math.abs(recover.lean)<0.05,'recovers before the move ends');
  assert.equal(recover.fx.trail,0,'trail ends during recovery');
  assert.equal(m.fighters[0].state,'idle','control returns at the original end frame');
});
for(const style of Object.keys(M.STYLES))for(const [move,x,y] of [['nspecial',0,0],['sideB',1,0],['upB',0,1],['downB',0,-1]]){
  test(style+' '+move+' keeps local and network poses finite throughout the move',()=>{
    assert(runSpecial(style,x,y).moves.has(move),'the controller must enter '+move);
  });
}
