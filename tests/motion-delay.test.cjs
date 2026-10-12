'use strict';
// Parameter study only: production delay remains unchanged. Real keyboard,
// renderer submission and cloud delivery belong to the host acceptance test.
const test=require('node:test'),assert=require('node:assert/strict');
const {matrix,replay}=require('./helpers/motion-delay-replay.cjs');
const {replay:networkReplay}=require('./helpers/motion-replay.cjs');
test('delay candidates replay identical real authoritative trajectories through stable, jittered and gapped arrivals',()=>{
 const rows=matrix();assert.equal(rows.length,9);
 for(const profile of ['stable','jitter','gap300']){
  const candidates=rows.filter(x=>x.profile===profile);assert.equal(new Set(candidates.map(x=>x.truthSha256)).size,1);assert.equal(new Set(candidates.map(x=>x.scheduleSha256)).size,1);
  for(const r of candidates){assert.equal(r.totalFrames,1440);assert(r.stats.steady.frames>150);assert(r.stats.transitions.moves.samples>=15);assert(r.stats.transitions.turns.samples>=5);assert(r.stats.transitions.stops.samples>=10);assert(r.stats.trajectory.samples>1000);assert(r.stats.allFinite);}
 }
 const stable=rows.filter(x=>x.profile==='stable');for(const r of stable){assert(r.stats.steady.reverseRatio<.01);assert(r.stats.steady.p95SpeedRatio<1.6);assert(r.stats.steady.holdRatio<.12);assert.equal(r.stats.transitions.stops.maxOvershoot,0,'a later deliberate movement is not stop overshoot');}
 assert(stable.find(x=>x.delayMs===100).stats.trajectory.effectiveLagMs<stable.find(x=>x.delayMs===150).stats.trajectory.effectiveLagMs);
 assert(stable.find(x=>x.delayMs===75).stats.trajectory.effectiveLagMs<stable.find(x=>x.delayMs===100).stats.trajectory.effectiveLagMs);
 console.log('MOTION_DELAY_MATRIX '+JSON.stringify(rows));
});
test('the replay and projection tail are deterministic, source inputs stay immutable, no death or respawn contaminates the comparison',()=>{
 const a=replay({delayMs:100,profile:'gap300'}),b=replay({delayMs:100,profile:'gap300'});
 assert.deepEqual(a,b);assert(a.stats.projection.frames>0);assert(a.stats.projection.heldFrames>0);assert.equal(a.discontinuities,0);assert.equal(a.sourceMutations,0);
});
for(const delayMs of [150,100,75])for(const batched of [false,true])test('real net/state-wire pipeline reports existing motion gates at delay '+delayMs+'; batched='+batched,async()=>{
 const result=await networkReplay({delayMs,batched});assert.deepEqual(result.errors,[]);assert(result.stats.frames>200);
 console.log('MOTION_DELAY_NET '+JSON.stringify({delayMs,batched,...result.stats}));
 // Candidate delays are measurements, not relaxed acceptance thresholds. The
 // current 150ms baseline must retain all existing gates under this exact path.
 if(delayMs===150){assert(result.stats.reverseRatio<.01);assert(result.stats.p95SpeedRatio<1.6);assert(result.stats.holdRatio<.12);}
});
