'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),CDP=require('./cdp.cjs');
function motionStats(frames,side,run){
 const ratios=[],gaps=[];let backwards=0,holds=0;
 for(let i=1;i<frames.length;i++){const p=frames[i-1],f=frames[i],dt=(f.t-p.t)/1000;if(f.run!==run||f.since<270||f.since>510||f.dir!==p.dir||dt<.005||dt>.05)continue;const x=f.fighters[0],old=p.fighters[0];
  // Select steady authoritative velocity independently of displacement sign:
  // real braking/acceleration after a turn is not a constant-speed segment.
  if(x.state!=='walk'||old.state!=='walk'||Math.abs(x.vx-f.dir*1.03)>.01||Math.abs(old.vx-f.dir*1.03)>.01)continue;
  const d=(x.x-old.x)*f.dir;ratios.push(Math.abs(d)/(1.03*60*dt));gaps.push(dt);backwards+=d<-.05?1:0;holds+=Math.abs(d)<.0001?1:0;}
 assert(ratios.length>35,'moving frames '+side+' '+run);ratios.sort((x,y)=>x-y);return {side,run,frames:ratios.length,reverseRatio:backwards/ratios.length,holdRatio:holds/ratios.length,p95SpeedRatio:ratios[Math.floor(ratios.length*.95)],maxSpeedRatio:ratios.at(-1),meanFrameMs:1000*gaps.reduce((x,y)=>x+y,0)/gaps.length};
}
exports.motionStats=motionStats;
exports.run=async({a,b,H,wait,state,activateButton,check,screenshot,json,evidence,report,k})=>{
 const casts=[];
 try{
  for(const app of [a,b]){const c=await CDP.connect(app.game);casts.push(c);c.on(m=>{if(m.method==='Page.screencastFrame')void c.send('Page.screencastFrameAck',{sessionId:m.params.sessionId});});await c.send('Page.startScreencast',{format:'jpeg',quality:1,maxWidth:160,maxHeight:100,everyNthFrame:1});}
  await activateButton(a.game,'#lobby-stage [data-value="moon"]');
  await activateButton(a.game,'#ready');await activateButton(b.game,'#ready');
  await wait(async()=>(await state(a)).match?.phase==='fight','real fight starts');
  for(const app of [a,b])await H.evalIn(app.game,`(()=>{document.activeElement?.blur();window.__motion=[];window.__motionRun='normal';window.__motionDir=0;window.__motionChanged=performance.now();window.__brawlRenderProbe=p=>{if(p.match?.phase==='fight'&&window.__motion.length<4000)window.__motion.push({t:performance.now(),since:performance.now()-window.__motionChanged,run:window.__motionRun,dir:window.__motionDir,frame:p.match.frame,fighters:p.match.fighters.map(f=>({seat:f.seat,x:f.x,y:f.y,vx:f.vx,vy:f.vy,state:f.state}))});};return true;})()`);
  for(const run of ['normal','batched']){
   for(const app of [a,b])await H.evalIn(app.game,`window.__motionRun=${JSON.stringify(run)};true`);
   if(run==='batched')await H.evalIn(b.game,'window.__brawlPollDelay=()=>new Promise(r=>setTimeout(r,180));true');
   for(let i=0;i<8;i++){
    const dir=i%2?-1:1,code=dir===1?'KeyD':'KeyA';
    for(const app of [a,b])await H.evalIn(app.game,`window.__motionDir=${dir};window.__motionChanged=performance.now();true`);
    await k(a.game,code);await H.sleep(520);await k(a.game,code,'keyUp');
   }
  }
  for(const app of [a,b])await H.evalIn(app.game,'window.__brawlRenderProbe=null;true');
  const stats=[];
  for(const app of [a,b]){
   const frames=await H.evalIn(app.game,'window.__motion');json(path.join(evidence,app.label+'-motion.json'),frames);assert(frames.length>250,'natural animation frames sampled');
   for(const run of ['normal','batched'])stats.push(motionStats(frames,app.label,run));
   await screenshot(app.game,app.label+'-smoothness');
  }
  report.smoothness=stats;console.log('MOTION',JSON.stringify(stats));
  if(process.env.BRAWL_EXPECT_STUTTER==='1')assert(stats.some(s=>s.side==='b'&&(s.reverseRatio>.03||s.p95SpeedRatio>3)),'baseline reproduces remote rewind');
  else for(const s of stats.filter(s=>s.side==='b')){assert(s.reverseRatio<.03,'remote does not rewind '+JSON.stringify(s));assert(s.p95SpeedRatio<1.7,'remote speed stable '+JSON.stringify(s));assert(s.holdRatio<.15,'remote continuous '+JSON.stringify(s));}
  check(process.env.BRAWL_EXPECT_STUTTER==='1'?'actual guest remote rewind reproduced':'guest remote fighter continuous under normal and batched delivery',stats);
  await H.sleep(300);const stopped=await state(a);await H.sleep(250);assert(Math.abs((await state(a)).match.fighters[0].x-stopped.match.fighters[0].x)<.01,'host stops after key release');
  await activateButton(b.game,'#leave');await wait(async()=>(await state(a)).connection==='closed','host observes peer leaving');check('real key release and peer exit still work');
 }finally{for(const c of casts){await c.send('Page.stopScreencast').catch(()=>{});c.close();}}
};
