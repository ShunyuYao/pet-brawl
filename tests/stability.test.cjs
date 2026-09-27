'use strict';
// Deterministic, bounded full matches: exercise simulation -> pose -> network
// snapshot together, rather than checking move tables without playing them.
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../game/match.cjs'),AI=require('../game/ai.cjs'),I=require('../game/input.cjs'),Stages=require('../game/stage.cjs');
const {assertPoses}=require('./pose-assertions.cjs');
const styles=Object.keys(M.STYLES);
for(const [stageIndex,stage] of Stages.STAGE_IDS.entries()){
  test(stage+': all 64 style matchups finish with finite poses and restorable snapshots',t=>{
    let frames=0;const states=new Set();
    for(const [aIndex,a] of styles.entries())for(const [bIndex,b] of styles.entries()){
      const seed=(stageIndex*64+aIndex*8+bIndex)*2+1;
      const m=M.create({timeLimit:60,styles:[a,b],stage,countdown:false});
      const bots=[AI.create({level:3,seed}),AI.create({level:3,seed:seed+1})];
      for(let n=0;n<8000&&m.phase!=='results';n++){
        for(let seat=0;seat<2;seat++)M.setInput(m,seat,bots[seat].think(m,seat));
        M.step(m);assertPoses(m,{snapshot:n%60===0});frames++;
        for(const f of m.fighters)states.add(`${f.style}/${f.state}/${f.move?.id||''}/${f.move?.phase||''}`);
      }
      assert.equal(m.phase,'results',stage+' '+a+' versus '+b+' must finish');
    }
    t.diagnostic(`${frames} simulated frames; ${states.size} observed style/state/move/phase combinations`);
  });
}
for(const shooter of ['hammer','cat','mage','ninja']){
  test('hammer swallows and spits '+shooter+' projectile without breaking either pose',()=>{
    const m=M.create({countdown:false,styles:['hammer',shooter]}),pads=[I.create(),I.create()];
    // The cheese wheel arcs upward: catch it near release, before it rises
    // above the mouth; the straight shots can start farther away.
    M.place(m,0,{x:shooter==='hammer'?-45:-20,facing:1});M.place(m,1,{x:shooter==='hammer'?0:50,facing:-1});
    I.press(pads[0],'special');I.press(pads[1],'special');
    if(shooter==='hammer')pads[1].x=-1;
    const phases=new Set();let star=false;
    for(let frame=0;frame<150;frame++){
      for(let seat=0;seat<2;seat++)M.setInput(m,seat,pads[seat]);
      M.step(m);pads[1].x=0;assertPoses(m,{snapshot:true});
      phases.add(m.fighters[0].move?.phase);
      if(m.projectiles.some(p=>p.type==='star'&&p.owner===0))star=true;
    }
    assert(phases.has('holdProj'),'incoming projectile actually swallowed');
    assert(phases.has('spitProj'),'spit animation actually entered');
    assert(star,'returned star actually spawned');
    assert.equal(m.fighters[0].state,'idle','swallow/spit finishes normally');
  });
}
