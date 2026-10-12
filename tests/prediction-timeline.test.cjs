'use strict';
// Actual guest net + StateWire + Match with controlled ordered SDK delivery.
// This observes simulation reconciliation, not rendered/physical bounce.
const test=require('node:test'),assert=require('node:assert/strict'),{replay}=require('./helpers/motion-replay.cjs');
const I=require('../game/input.cjs');
const controls=step=>{const p=I.create();p.x=step%100<50?-1:1;return p;};
// Original failing assertion retained; pre-fix evidence is prediction-red.tap.
test('held local input must not rewind the predicted simulation timeline when receipt acknowledgements advance',async()=>{
 const result=await replay({guestControls:controls,capturePrediction:true,steps:360});
 if(process.env.MOTION_REPLAY_EVIDENCE_DIR){const fs=require('node:fs'),path=require('node:path'),dir=path.resolve(process.env.MOTION_REPLAY_EVIDENCE_DIR);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'prediction-timeline.json'),JSON.stringify(result,null,2)+'\n');}
 assert.deepEqual(result.errors,[]);assert.equal(result.trace.errors,0);assert.equal(result.trace.dropped,0);
 const corrections=result.trace.events.filter(e=>e.type==='correction'&&e.local&&e.kind==='continuous');
 const regressions=corrections.filter(e=>e.afterFrame<e.beforeFrame);
 const evidence=regressions.map(e=>{const applied=result.reconciles.find(r=>r.t===e.t);return {t:e.t,beforeFrame:e.beforeFrame,afterFrame:e.afterFrame,frameDelta:e.afterFrame-e.beforeFrame,distance:e.distance,ack:applied?.ack,history:applied?.history,authorityFrame:applied?.authorityFrame};});
 const intervals=result.sentInputs.slice(1).map((s,i)=>s.t-result.sentInputs[i].t).sort((a,b)=>a-b);
 console.log('PREDICTION_TIMELINE_REPRO '+JSON.stringify({inputs:result.sentInputs.length,inputIntervalP50Ms:intervals[Math.floor(intervals.length*.5)],inputIntervalP95Ms:intervals[Math.floor(intervals.length*.95)],reconciles:result.reconciles.length,regressions:regressions.length,evidence:evidence.slice(0,12)}));
 assert(corrections.length>80,'enough real decoded states');
 assert.equal(regressions.length,0,'receipt ACK pruning rewinds simulation: '+JSON.stringify(evidence.slice(0,3)));
});

test('300ms guest uplink delay keeps an unreceived attack advancing instead of restarting or fast-forwarding',async()=>{
 const pad=I.create();
 const result=await replay({inputDelayMs:300,capturePrediction:true,steps:120,guestControls:step=>{if(step===30)I.press(pad,'attack');return pad;}});
 assert.deepEqual(result.errors,[]);
 const beforeReceipt=result.reconciles.filter(r=>r.t>=1530&&r.t<1800);
 assert(beforeReceipt.length>=5);
 for(let i=0;i<beforeReceipt.length;i++){
  const r=beforeReceipt[i];assert.equal(r.localState,'move','pending attack remains active at '+r.t);assert.equal(r.localPresses.attack,1);
  if(i){const delta=r.localMoveFrame-beforeReceipt[i-1].localMoveFrame;assert(delta>=2&&delta<=4,'attack should advance with elapsed time, delta='+delta+' at '+r.t);}
 }
 assert.equal(result.reconciles.at(-1).localPresses.attack,1,'one authoritative press, no duplicate after receipt');
});

test('an epoch reset freezes the old prediction until the next authoritative keyframe arrives',async()=>{
 const result=await replay({capturePrediction:true,steps:180,guestControls:controls,epochResetStep:90,epochSnapshotDelaySteps:18});
 assert.deepEqual(result.errors,[]);
 const frozen=result.rows.filter(r=>r.t>=2500&&r.t<2800);
 assert(frozen.length>=17);assert.equal(new Set(frozen.map(r=>r.predictedFrame)).size,1,'no old timeline ticks while awaiting new epoch state');
 assert.equal(new Set(frozen.map(r=>r.localX)).size,1,'old local position remains frozen too');
 assert(result.reconciles.some(r=>r.t>=2800&&r.predictionReset==='epoch'));
 assert(result.rows.at(-1).predictedFrame>frozen[0].predictedFrame,'prediction resumes with new authority');
});

test('temporary uplink delay does not leave permanent excess prediction lead after recovery',async()=>{
 const result=await replay({capturePrediction:true,steps:1200,inputDelayMs:t=>t<11000?300:20,guestControls:controls});
 assert.deepEqual(result.errors,[]);assert.equal(result.trace.dropped,0);
 const peak=Math.max(...result.rows.map(r=>r.predictedFrame-r.authorityFrame));assert(peak>=10,'fixture really expanded the prediction horizon');
 const tail=result.rows.filter(r=>r.t>=19000);assert(tail.length>100);
 assert(Math.max(...tail.map(r=>r.predictedFrame-r.authorityFrame))<=5,'authority gradually catches up after the network recovers');
 assert.equal(result.trace.events.filter(e=>e.type==='correction'&&e.local&&e.kind==='continuous'&&e.afterFrame<e.beforeFrame).length,0,'catch-up never rewinds the world');
 assert.equal(result.reconciles.filter(r=>r.predictionReset&&r.predictionReset!=='initial').length,0,'catch-up cannot cheat by resetting the timeline');
});
