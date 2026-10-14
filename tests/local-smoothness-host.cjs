'use strict';
// Real guest keyboard, production LAN/SDK/codec/prediction and actual render submissions.
// Pixel clicks and synthetic DOM input are not used. Both windows stay hidden.
const assert=require('node:assert/strict'),path=require('node:path'),CDP=require('./cdp.cjs');
function stats(frames,run){
 const rows=[],speed=[];let reverse=0,holds=0;
 for(let i=1;i<frames.length;i++){
  const a=frames[i-1],b=frames[i],dt=(b.t-a.t)/1000,p=a.fighters[1],f=b.fighters[1];
  if(b.run!==run||a.run!==run||b.since<270||b.since>510||a.dir!==b.dir||dt<.005||dt>.05||p.ground!==0||f.ground!==0||p.state!=='walk')continue;
  const dx=(f.x-p.x)*b.dir;rows.push({t:b.t,dx,dt,frames:[a.frame,b.frame],states:[p.state,f.state]});speed.push(Math.abs(dx)/(1.03*60*dt));reverse+=dx<-.05?1:0;holds+=Math.abs(dx)<.0001?1:0;
 }
 assert(rows.length>35,'enough guest-driven steady movement: '+rows.length);speed.sort((a,b)=>a-b);
 const turnReversals=frames.slice(1).filter((b,i)=>{const a=frames[i],p=a.fighters[1],f=b.fighters[1];return a.run===run&&b.run===run&&a.dir===b.dir&&b.since>=60&&b.since<=510&&p.state==='walk'&&f.state==='walk'&&p.ground===0&&f.ground===0&&p.vx*b.dir>.9&&f.vx*b.dir>.9&&(f.x-p.x)*b.dir<-.05;});
 return {turnReversals:turnReversals.length,run,samples:rows.length,reverseRatio:reverse/rows.length,holdRatio:holds/rows.length,p95SpeedRatio:speed[Math.floor(speed.length*.95)],maxSpeedRatio:speed.at(-1),reversals:rows.filter(x=>x.dx<-.05).slice(0,12)};
}
exports.run=async({a,b,H,wait,state,activateButton,check,screenshot,json,evidence,report,k})=>{
 const casts=[];
 try{
  for(const app of [a,b]){const c=await CDP.connect(app.game);casts.push(c);c.on(m=>{if(m.method==='Page.screencastFrame')void c.send('Page.screencastFrameAck',{sessionId:m.params.sessionId});});await c.send('Page.startScreencast',{format:'jpeg',quality:1,maxWidth:160,maxHeight:100,everyNthFrame:1});}
  if(process.env.BRAWL_LOCAL_APPEARANCE==='doll3d')for(const app of [a,b])await wait(()=>H.evalIn(app.game,'window.__brawl.world().fighters.length===2&&window.__brawl.world().fighters.every(f=>f.kind==="doll3d"&&f.visible)'), 'both real 3D fighters loaded '+app.label,130000);
  await activateButton(a.game,'#lobby-stage [data-value="moon"]');await activateButton(a.game,'#ready');await activateButton(b.game,'#ready');
  await wait(async()=>(await state(a)).match?.phase==='fight','guest motion fight starts');
  for(const app of [a,b])await H.evalIn(app.game,`(()=>{document.activeElement?.blur();window.__motion=[];window.__motionRun='normal';window.__motionDir=0;window.__motionChanged=performance.now();window.__brawl.observe.start({capacity:32768});window.__brawlRenderProbe=p=>{if(p.match?.phase==='fight'&&window.__motion.length<5000)window.__motion.push({t:performance.now(),since:performance.now()-window.__motionChanged,run:window.__motionRun,dir:window.__motionDir,frame:p.match.frame,fighters:p.match.fighters.map(f=>({seat:f.seat,x:f.x,y:f.y,vx:f.vx,vy:f.vy,state:f.state,ground:f.ground}))});};return true;})()`);
  for(const run of ['normal','batched']){
   for(const app of [a,b])await H.evalIn(app.game,`window.__motionRun=${JSON.stringify(run)};true`);
   if(run==='batched')await H.evalIn(b.game,'window.__brawlDelayedPolls=0;window.__brawlPollDelay=()=>{window.__brawlDelayedPolls++;return new Promise(r=>setTimeout(r,180));};true');
   for(let i=0;i<8;i++){
    const dir=i%2?-1:1,code=dir===1?'KeyD':'KeyA';
    for(const app of [a,b])await H.evalIn(app.game,`window.__motionDir=${dir};window.__motionChanged=performance.now();true`);
    await k(b.game,code);await H.sleep(520);await k(b.game,code,'keyUp');await H.sleep(300);
   }
  }
  const samples=[];
  for(const app of [a,b]){
   const frames=await H.evalIn(app.game,'window.__motion');json(path.join(evidence,app.label+'-local-motion.json'),frames);
   json(path.join(evidence,app.label+'-local-observation.json'),await H.evalIn(app.game,'window.__brawl.observe.stop()'));
   for(const run of ['normal','batched'])samples.push({side:app.label,...stats(frames,run)});
   await screenshot(app.game,app.label+'-local-smoothness');
  }
  report.localSmoothness=samples;console.log('LOCAL_MOTION',JSON.stringify(samples));
  for(const s of samples.filter(s=>s.side==='b')){assert.equal(s.turnReversals,0,'no visible pullback after a guest direction key '+JSON.stringify(s));assert(s.reverseRatio<.03,'guest own fighter must not rewind '+JSON.stringify(s));assert(s.p95SpeedRatio<1.7,'guest own speed stable '+JSON.stringify(s));assert(s.holdRatio<.15,'guest own movement continuous '+JSON.stringify(s));}
  check('guest own real-key motion continuous on normal and batched LAN',samples);
  await H.evalIn(b.game,'window.__brawlPollDelay=null;true');await H.sleep(850);
  await wait(async()=>Math.abs((await state(a)).match.fighters[1].x-(await state(b)).match.fighters[1].x)<3,'guest settles on authority after release',8000);
  const authority=(await state(a)).match.fighters[1].x,shown=await H.evalIn(b.game,'window.__brawl.world().fighters.find(f=>f.seat===1).x/.1');
  assert(Math.abs(shown-authority)<.3,'the actual rendered root settles, not only the predicted world');
  const jumps=(await state(a)).match.stats[1].pressesSeen.jump;await k(b.game,'Space');await H.sleep(30);await k(b.game,'Space','keyUp');
  await wait(async()=>(await state(a)).match.stats[1].pressesSeen.jump===jumps+1&&(await state(b)).match.fighters[1].y>0,'guest jump remains immediate and authoritative');
  await wait(async()=>(await state(a)).match.fighters[1].ground!==null,'guest lands normally',8000);
  const attacks=(await state(a)).match.stats[1].pressesSeen.attack;
  for(let i=0;i<5;i++){await k(b.game,'KeyJ');await k(b.game,'KeyJ','keyUp');await H.sleep(200);}
  await wait(async()=>(await state(a)).match.stats[1].pressesSeen.attack===attacks+5,'five guest attacks reach authority once each');
  check('rendered stop converges; guest jump, landing and five exact attacks survive the correction',{authority,shown});
  await activateButton(b.game,'#leave');await wait(async()=>(await state(a)).connection==='closed','host observes guest leave');
 }finally{for(const c of casts){await c.send('Page.stopScreencast').catch(()=>{});c.close();}}
};
