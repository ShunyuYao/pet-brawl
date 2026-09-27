'use strict';
// Exercise the actual presentation module with simulation-generated fighter states,
// including the snapshot/restore representation consumed by a network guest.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../game/match.cjs'),I=require('../game/input.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-brawl-poses-'));
const esbuild=require(process.env.PET_BRAWL_ESBUILD||path.resolve(__dirname,'../../../demo/node_modules/esbuild'));
esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../src/poses.js')],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'poses.cjs'),logLevel:'silent'});
const {computePose}=require(path.join(dir,'poses.cjs'));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
function finite(value,label){
  if(typeof value==='number')assert(Number.isFinite(value),label+' must be finite');
  else if(value&&typeof value==='object')for(const [key,v] of Object.entries(value))finite(v,label+'.'+key);
}
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
for(const style of Object.keys(M.STYLES))for(const [move,x,y] of [['nspecial',0,0],['sideB',1,0],['upB',0,1],['downB',0,-1]]){
  test(style+' '+move+' keeps local and network poses finite throughout the move',()=>{
    assert(runSpecial(style,x,y).moves.has(move),'the controller must enter '+move);
  });
}
