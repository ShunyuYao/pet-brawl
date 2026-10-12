'use strict';
// Controlled presentation replay, not a network/Electron benchmark. Each delay
// receives the same immutable M.step snapshots over an ordered synthetic link.
const crypto=require('node:crypto'),M=require('../../game/match.cjs'),I=require('../../game/input.cjs'),Motion=require('../../game/remote-motion.cjs');
const DT=1000/60,TOTAL=1440,WALK=M.STYLES.hammer.attrs.walk;
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const pct=(xs,p)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]:null;
const summary=xs=>({samples:xs.length,p50Ms:pct(xs,.5),p95Ms:pct(xs,.95),maxMs:xs.length?Math.max(...xs):null});
function direction(frame){const f=frame%240;return f<30?0:f<75?1:f<105?0:f<165?-1:f<180?1:0;}
function fixture(profile){
 if(!['stable','jitter','gap300'].includes(profile))throw Error('unknown_arrival_profile');
 const m=M.create({countdown:false,stage:'moon',styles:['hammer','hammer']});M.place(m,0,{x:-30});M.place(m,1,{x:75});
 const pad=I.create(),truth=[],packets=[],jitter=[0,35,0,75,15,100,0,30];let nextSend=0,previousArrival=0,discontinuities=0;
 for(let step=0;step<TOTAL;step++){
  pad.x=direction(step);M.setInput(m,0,pad);M.step(m);const t=step*DT,snapshot=M.snapshot(m);
  truth.push({t,x:m.fighters[0].x,dir:pad.x,frame:m.frame,snapshot});
  if(m.fighters.some(f=>f.stocks!==3||['dead','out','respawn'].includes(f.state)))discontinuities++;
  if(t+1e-6>=nextSend){nextSend+=40;let at=t+20;
   if(profile==='jitter')at+=jitter[packets.length%jitter.length];
   if(profile==='gap300'){const block=Math.floor(at/2000),cycle=at%2000,start=[900,450,1200,50,1500,650][block%6];if(cycle>=start&&cycle<start+300)at+=start+300-cycle;}
   // TLS preserves order; a delayed packet holds all later packets until due.
   at=Math.max(at,previousArrival);previousArrival=at;
   packets.push({at,serial:packets.length+1,view:{matchNo:1,you:1,pause:null,match:snapshot}});
  }
 }
 return {truth,packets,discontinuities};
}
function calculate(rows,truth){
 const speeds=[];let reverse=0,holds=0,projection=0,projectionHeld=0;
 for(let i=1;i<rows.length;i++){
  const r=rows[i],dx=r.x-rows[i-1].x;
  if(r.sourceMode==='remote-projection'){projection++;if(Math.abs(dx)<.001)projectionHeld++;}
  // Use the existing motion gate only well inside a constant-direction segment.
  const k=r.step,dir=truth[k].dir;
  if(k<60||!dir||k<15||k+15>=TOTAL||truth[k-15].dir!==dir||truth[k+15].dir!==dir)continue;
  reverse+=dx*dir<-.05?1:0;holds+=Math.abs(dx)<.001?1:0;speeds.push(Math.abs(dx)/WALK);
 }
 function truthAt(t){const f=Math.max(0,Math.min(TOTAL-1,t/DT)),a=Math.floor(f),b=Math.min(a+1,TOTAL-1);return truth[a].x+(truth[b].x-truth[a].x)*(f-a);}
 let best=null;
 for(let lag=0;lag<=500;lag+=5){let sum=0,max=0,samples=0;
  for(const r of rows){if(r.t<1000)continue;const e=r.x-truthAt(r.t-lag);sum+=e*e;max=Math.max(max,Math.abs(e));samples++;}
  const candidate={effectiveLagMs:lag,rms:Math.sqrt(sum/samples),max,samples};if(!best||candidate.rms<best.rms)best=candidate;
 }
 const moves=[],turns=[],stops=[],overshoots=[],stopBacktracks=[],allSpeeds=rows.slice(1).map((r,i)=>Math.abs(r.x-rows[i].x)/WALK);let misses=0,stopReverseFrames=0;
 for(let k=1;k<TOTAL-40;k++){
  const current=truth[k],previous=truth[k-1];if(current.dir===previous.dir)continue;
  let next=k+1;while(next<TOTAL&&truth[next].dir===current.dir)next++;
  if(current.dir){
   // A turn has acceleration too. Compare the first authoritative displacement
   // in the new direction, not the earlier controller-change timestamp.
   let authority=k;while(authority<next&&(truth[authority].x-truth[authority-1].x)*current.dir<=.01)authority++;
   const first=rows.findIndex(r=>r.step>=k);
   // A delayed short turn can first appear during the subsequent true stop.
   // Retain that tail for matching; do not silently discard slow responses.
   let onset=null;for(let j=Math.max(1,first);j<rows.length&&rows[j].step<next+36;j++)if((rows[j].x-rows[j-1].x)*current.dir>.01){onset=rows[j].t-current.t;break;}
   if(onset===null||authority===next){misses++;continue;}onset-=truth[authority].t-current.t;moves.push(onset);if(previous.dir)turns.push(onset);
  }else{
   // The simulation brakes for several ticks after release. Locate its settled
   // position first, so deceleration is not mislabeled as presentation error.
   const target=truth[next-1].x;let authority=k,settled=null,maxOvershoot=0,backtrack=0;
   while(authority<next&&Math.abs(truth[authority].x-target)>=.001)authority++;
   for(let j=1;j+5<rows.length;j++){
    const r=rows[j];if(r.step<k||r.step>=next+36)continue;
    if(settled===null)maxOvershoot=Math.max(maxOvershoot,(r.x-target)*previous.dir);
    const backwards=(r.x-rows[j-1].x)*previous.dir;if(r.step<next&&backwards<-.001){backtrack-=backwards;stopReverseFrames++;}
    if(settled===null&&Math.abs(r.x-target)<.01&&rows.slice(j,j+6).every((q,z)=>q.step<next+36&&Math.abs(q.x-target)<.01&&(z===0||Math.abs(q.x-rows[j+z-1].x)<.001)))settled=r.t-current.t;
   }
   overshoots.push(maxOvershoot);stopBacktracks.push(backtrack);if(settled===null||authority===next)misses++;else stops.push(settled-(truth[authority].t-current.t));
  }
 }
 const stats={steady:{frames:speeds.length,reverseRatio:reverse/speeds.length,holdRatio:holds/speeds.length,p95SpeedRatio:pct(speeds,.95),maxSpeedRatio:Math.max(...speeds)},
  trajectory:{...best,p95SpeedRatio:pct(allSpeeds,.95),maxSpeedRatio:Math.max(...allSpeeds)},transitions:{moves:summary(moves),turns:summary(turns),stops:{...summary(stops),p95Overshoot:pct(overshoots,.95),maxOvershoot:Math.max(...overshoots),reverseFrames:stopReverseFrames,maxBacktrack:Math.max(...stopBacktracks)},misses},projection:{frames:projection,heldFrames:projectionHeld}};
 stats.allFinite=rows.every(r=>Number.isFinite(r.x))&&JSON.stringify(stats,(_,v)=>typeof v==='number'&&!Number.isFinite(v)?'INVALID':v).indexOf('INVALID')===-1;return stats;
}
function replay({delayMs=150,profile='stable'}={}){
 if(![150,100,75].includes(delayMs))throw Error('unknown_delay_candidate');
 const {truth,packets,discontinuities}=fixture(profile),sourceHash=sha({truth,packets}),motion=Motion.create({delayMs}),rows=[];let packet=0;
 for(let step=0;step<TOTAL;step++){
  const tr=truth[step];while(packet<packets.length&&packets[packet].at<=tr.t+1e-6){const p=packets[packet++];motion.push(p.view,tr.t,p.serial);}
  if(!packet)continue;let source;
  const shown=motion.sample(tr.snapshot,tr.t,false,value=>{source=value;});
  rows.push({step,t:tr.t,x:shown.fighters[0].x,truth:tr.x,dir:tr.dir,sourceMode:source.fighters.find(f=>f.seat===0)?.sourceMode,lowerFrame:source.lowerFrame,upperFrame:source.upperFrame,alpha:source.alpha});
 }
 return {delayMs,profile,totalFrames:TOTAL,truthSha256:sha(truth),scheduleSha256:sha(packets.map(p=>({at:p.at,frame:p.view.match.frame}))),discontinuities,sourceMutations:sha({truth,packets})===sourceHash?0:1,stats:calculate(rows,truth),rows};
}
function matrix(){return ['stable','jitter','gap300'].flatMap(profile=>[150,100,75].map(delayMs=>{const {rows,...result}=replay({delayMs,profile});return result;}));}
if(require.main===module)process.stdout.write(JSON.stringify(matrix(),null,2)+'\n');
module.exports={replay,matrix};
