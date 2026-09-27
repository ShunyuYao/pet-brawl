'use strict';
// Real hidden Chromium, real built HTML, real CDP keyboard + file-chooser input (SPEC §11).
// Nothing is driven through internal flags: every action is a key press or a file pick,
// and every check reads what the game shows or the state it exposes for inspection.
// Private character packs come from the sibling rat-doll-lab (local only).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),REPO=path.resolve(ROOT,'../..');
const {connect}=require('./cdp.cjs');
const DOLL=process.env.BRAWL_DOLL_ZIP||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-female.zip');
const IMAGE=process.env.BRAWL_IMAGE||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-male/frames/idle/frame_00.png');
const out=path.join(ROOT,'artifacts/browser-e2e');fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],screenshots:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(ok,label,detail)=>{assert.ok(ok,label+(detail!==undefined?' '+JSON.stringify(detail):''));report.checks.push({label,detail});console.log('PASS',label);};
async function wait(p,expr,label,ms=20000){const until=Date.now()+ms;let last;while(Date.now()<until){last=await p.evaluate(expr).catch(e=>e.message);if(last)return last;await sleep(60);}throw Error('timeout: '+label+' last='+JSON.stringify(last));}
(async()=>{
  assert(fs.existsSync(DOLL),'3D doll pack missing: '+DOLL);assert(fs.existsSync(IMAGE),'image missing: '+IMAGE);
  const port=19000+Math.floor(Math.random()*900),profile=fs.mkdtempSync(path.join(os.tmpdir(),'pet-brawl-e2e-'));
  const child=spawn(require(path.join(REPO,'demo/node_modules/electron')),[path.join(__dirname,'browser-shell.cjs'),'--remote-debugging-port='+port,'--use-mock-keychain','--mute-audio'],{detached:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'',BRAWL_E2E_PROFILE:profile,BRAWL_HTML:path.join(ROOT,'dist/桌宠大乱斗.html')}});
  let p;const shot=async n=>{report.screenshots.push(await p.screenshot(path.join(out,n+'.png')));};
  try{
    let t;for(let i=0;i<60&&!t;i++){try{t=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.type==='page'&&x.url.includes('.html'));}catch{}await sleep(250);}
    p=await connect(t);await p.send('Runtime.enable');
    p.on(m=>{if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
    await wait(p,'window.__brawl?.state.driver?.kind','boot');
    const st=()=>p.evaluate('window.__brawl.state'),me=async()=>(await st()).match?.fighters[0],w=()=>p.evaluate('window.__brawl.world()');
    check(await p.evaluate('typeof window.pet==="undefined"'),'plain browser: no pet SDK injected');
    check((await st()).driver.kind==='toy','default fighter is a built-in toy (no fake desktop pet)');
    // Music and sound effects default to ON; sound starts on the first user gesture.
    check(await p.evaluate('document.querySelector("#music").textContent==="音乐 开"&&document.querySelector("#sfx").textContent==="音效 开"'),'music and sound effects are on by default');
    check(!(await st()).audio.unlocked,'no sound before any user gesture (autoplay policy)');
    await p.press('KeyM');await wait(p,'window.__brawl.state.audio.unlocked&&window.__brawl.state.audio.running','audio unlocked by the first key press',5000);
    const s0=(await st()).audio.steps;await sleep(1200); // 16th note = 0.1 s at 150 BPM
    check((await st()).audio.steps>s0+8,'background music is playing (menu layer)',{steps:(await st()).audio.steps});
    // Appearance and style are separate choices.
    check(await p.evaluate('document.querySelector(\'.style-card[data-style="hammer"]\').getAttribute("aria-checked")==="true"'),'奶酪大锤 selected as the style');
    // ---------- 2D / 3D fighters through the real file chooser ----------
    await p.setFiles('#import-file',[IMAGE]);
    await wait(p,'window.__brawl.state.driver.kind==="sprite"&&document.querySelector("#import-status").dataset.state==="ok"','2D import');
    await wait(p,'window.__brawl.world().fighters.find(f=>f.seat===0)?.kind==="sprite"','2D avatar built');
    check(true,'2D picture becomes a 2D standee fighter');
    await p.setFiles('#import-file',[DOLL]);
    await wait(p,'window.__brawl.state.driver.kind==="doll3d"','3D import',60000);
    await wait(p,'window.__brawl.world().fighters.find(f=>f.seat===0)?.kind==="doll3d"','3D avatar built',30000);
    check(await p.evaluate('document.querySelector("#fighter-kind").textContent.includes("3D")'),'card labels the fighter as a 3D rag doll');
    await shot('01-title-3d');
    // ---------- solo options by keyboard: training dummy, 5 minutes ----------
    await p.activate('#cpu-list [data-value="0"]');await p.activate('#time-list [data-value="300"]');
    check(await p.evaluate('document.querySelector("#cpu-list [data-value=\\"0\\"]").getAttribute("aria-pressed")==="true"'),'CPU level picked with the keyboard');
    await p.activate('#solo');
    await wait(p,'window.__brawl.state.match?.phase==="countdown"','countdown');
    check((await st()).match.timeLimit===300*60,'5-minute limit applied',(await st()).match.timeLimit);
    // Keys during the countdown do nothing.
    const x0=(await me()).x;await p.key('KeyD');await sleep(500);await p.key('KeyD','keyUp');
    check((await me()).x===x0,'countdown blocks movement');
    await wait(p,'window.__brawl.state.match.phase==="fight"','GO',6000);
    await wait(p,'window.__brawl.world().fighters.every(f=>f.visible)','both fighters drawn');
    check((await w()).fighters.find(f=>f.seat===0).kind==='doll3d','our 3D doll fights');
    await wait(p,'window.__brawl.state.audio.mode==="fight"&&window.__brawl.state.audio.drums>0.5','fight music layer (drums + lead) fades in',3000);
    check(true,'fight music adds drums and the lead');
    check(await p.evaluate('document.querySelector("#plate-0 .plate-name").textContent.startsWith("🧀")'),'the 3D pet fights with the hammer style (HUD shows 🧀)');
    await shot('02-fight-3d');
    // ---------- movement (SPEC §11-4) ----------
    const a=await me();await p.key('KeyD');await sleep(400);let b=await me();await p.key('KeyD','keyUp');
    check(b.x>a.x+5&&b.state==='walk'||b.state==='idle'&&b.x>a.x+5,'holding D walks right',{from:a.x,to:b.x,state:b.state});
    await sleep(300);
    await p.press('KeyA');await sleep(40);await p.key('KeyA');await sleep(250);
    b=await me();check(b.state==='run'&&b.facing===-1,'double-tapping A dashes left',b);
    await p.key('KeyA','keyUp');await sleep(500);
    // Stand under the left platform (x −56…−22), full-hop onto it, then S drops through.
    const goTo=async x=>{for(let i=0;i<60;i++){const f=await me();if(Math.abs(f.x-x)<3)break;const k=f.x<x?'KeyD':'KeyA';await p.key(k);await sleep(60);await p.key(k,'keyUp');await sleep(20);}};
    await goTo(-38);await sleep(300);
    await p.key('Space');await sleep(300);await p.key('Space','keyUp');
    await wait(p,'window.__brawl.state.match.fighters[0].ground===1','landed on the left platform',4000);
    check(true,'full hop reaches the side platform');
    await p.press('KeyS');await wait(p,'window.__brawl.state.match.fighters[0].ground===0','dropped through to the main stage',4000);
    check(true,'S drops through a soft platform');
    // ---------- short hop vs full hop (SPEC §11-5) ----------
    const peak=async hold=>{await sleep(400);const y0=(await me()).y;await p.key('Space');if(hold)await sleep(hold);await p.key('Space','keyUp');let top=y0;
      for(let i=0;i<40;i++){top=Math.max(top,(await me()).y);await sleep(25);}await wait(p,'window.__brawl.state.match.fighters[0].ground!=null','landed',4000);return top-y0;};
    const short=await peak(0),full=await peak(250);
    check(full>short*1.4&&short>5,'tap Space = short hop, hold = full hop',{short,full});
    // ---------- W+K is up special, not a jump (SPEC §11-6) ----------
    await sleep(500);await p.key('KeyW');await p.key('KeyK');
    await wait(p,'window.__brawl.state.match.fighters[0].move==="upB"','W+K starts up special',1500);
    await p.key('KeyW','keyUp');await p.key('KeyK','keyUp');
    check(true,'W+K on the ground is up special (奶酪大跳)');
    await wait(p,'window.__brawl.state.match.fighters[0].ground!=null&&window.__brawl.state.match.fighters[0].state==="idle"','back on the ground',6000);
    // ---------- attacks on the training dummy ----------
    const dummyX=(await st()).match.fighters[1].x;await goTo(dummyX-22);
    const face=(await me()).x<dummyX?'KeyD':'KeyA';
    await p.key(face);await sleep(30);await p.key(face,'keyUp');
    await p.press('KeyJ');await wait(p,'window.__brawl.state.match.fighters[0].move==="jab1"','J = jab',1000);
    await sleep(700);await p.key(face);await p.key('KeyU');await sleep(30);await p.key(face,'keyUp');
    await wait(p,'window.__brawl.state.match.fighters[0].move==="fsmash"','direction+U = side smash',1000);
    await sleep(500);await shot('03-smash-charge');await p.key('KeyU','keyUp');
    await wait(p,'window.__brawl.state.match.fighters[1].percent>0','the dummy takes damage',3000);
    check(true,'charged side smash lands on the dummy',(await st()).match.fighters[1].percent);
    await sleep(400);await shot('04-hit');
    // ---------- lose all stocks → results → rematch (SPEC §11-16) ----------
    for(let s=3;s>0;s--){
      await wait(p,'["idle","walk","run","air","landing","crouch"].includes(window.__brawl.state.match.fighters[0].state)','ready to walk',8000);
      // Walk off the edge away from the dummy (bodies cannot pass through each other);
      // hold S once airborne so the ledge is not grabbed.
      const m=(await st()).match,away=m.fighters[1].x>m.fighters[0].x?-1:1,dirKey=away>0?'KeyD':'KeyA';
      await p.key(dirKey);
      await wait(p,`window.__brawl.state.match.fighters[0].ground==null&&window.__brawl.state.match.fighters[0].x*${away}>60`,'walked off the edge',15000);
      await p.key('KeyS');
      await wait(p,'["dead","out"].includes(window.__brawl.state.match.fighters[0].state)','fell off the stage',15000);
      await p.key(dirKey,'keyUp');await p.key('KeyS','keyUp');
      check((await me()).stocks===s-1,'falling off costs a stock ('+(s-1)+' left)');
      if(s>1){await wait(p,'window.__brawl.state.match.fighters[0].state==="respawn"','respawn platform',4000);await p.press('KeyS');
        await wait(p,'window.__brawl.state.match.fighters[0].ground!=null','landed after respawn',6000);}
    }
    await wait(p,'window.__brawl.state.mode==="results"&&!document.querySelector("#results-panel").hidden','results panel',10000);
    const title=await p.evaluate('document.querySelector("#results-title").textContent');
    check(/电脑获胜/.test(title),'results name the winner',title);
    const rows=await p.evaluate('[...document.querySelectorAll("#results-players .result-row")].map(r=>r.textContent)');
    check(rows.length===2&&rows.some(r=>r.includes('坠落 3')),'results list falls and damage',rows);
    await shot('05-results');
    await p.activate('#again');
    await wait(p,'window.__brawl.state.match?.phase==="countdown"&&window.__brawl.state.match.fighters[0].stocks===3','rematch',6000);
    check(true,'再来一局 starts a fresh match');
    // The computer's look changes each match; its style stays the hammer.
    const looks=await p.evaluate('window.__brawl.world().fighters.find(f=>f.seat===1)?.kind');
    check(looks==='toy','computer fighter drawn as a built-in look');
    await p.activate('#music');
    check((await st()).audio.music===false&&!(await st()).audio.running,'music can be switched off');
    await p.evaluate('window.__beforeReload=1');await p.send('Page.reload');await wait(p,'!window.__beforeReload&&document.querySelector("#music")&&window.__brawl?.state.driver','reloaded');
    check(await p.evaluate('document.querySelector("#music").textContent==="音乐 关"&&document.querySelector("#sfx").textContent==="音效 开"'),'audio choices are remembered after reopening');
    await p.activate('#music');
    await p.activate('#solo');await wait(p,'window.__brawl.state.match?.phase==="countdown"','second solo');
    await p.activate('#leave');await wait(p,'window.__brawl.state.mode==="title"','title again');
    check((await st()).driver.kind==='doll3d','leaving keeps the chosen 3D fighter');
    // ---------- stages (SPEC §8, §11-23) ----------
    await p.activate('#cpu-list [data-value="0"]');
    await p.activate('#stage-list [data-value="moon"]');
    check(await p.evaluate('document.querySelector(\'#stage-list [data-value="moon"]\').getAttribute("aria-pressed")==="true"'),'奶酪月台 picked with the keyboard');
    await wait(p,'window.__brawl.world().stage==="moon"','title shows the chosen stage',2000);
    await p.activate('#solo');await wait(p,'window.__brawl.state.match?.phase==="fight"','final fight',8000);
    check((await st()).match.stage==='moon'&&(await w()).stage==='moon','the match and the picture are both on 奶酪月台');
    await sleep(300);await shot('07-stage-final');
    await p.activate('#leave');await wait(p,'window.__brawl.state.mode==="title"','title after final');
    await p.evaluate('window.__beforeReload=1');await p.send('Page.reload');await wait(p,'!window.__beforeReload&&document.querySelector("#stage-list button")&&window.__brawl?.state.driver','reloaded');
    await wait(p,'document.querySelector(\'#stage-list [data-value="moon"]\')?.getAttribute("aria-pressed")==="true"','remembered stage chip',3000);
    check(true,'the stage choice is remembered after reopening');
    await p.evaluate('window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__long.push({ms:Math.round(e.duration),at:Math.round(e.startTime)});}).observe({type:"longtask",buffered:true});true');
    const tStep=async(label,fn)=>{const t=Date.now();await fn();report.timings=(report.timings||[]);report.timings.push({label,ms:Date.now()-t});};
    await tStep('pick town',()=>p.activate('#stage-list [data-value="town"]'));
    await tStep('start solo',()=>p.activate('#solo'));
    report.probe=await p.evaluate('({long:window.__long,builds:window.__stageBuilds})').catch(e=>String(e));
    await wait(p,'window.__brawl.state.match?.phase==="fight"','town fight',8000);
    check((await st()).match.stage==='town'&&(await w()).stage==='town','the match and the picture are both on 猫薄荷小镇');
    await wait(p,'window.__brawl.state.match.frame>120','platform starts moving',6000);
    const mx0=(await w()).movingX;await sleep(800);const mx1=(await w()).movingX;
    check(typeof mx0==='number'&&mx1!==mx0,'猫薄荷小镇: the drawn platform moves ('+mx0+' → '+mx1+')');
    await shot('07-stage-town');
    // A keyboard player can Tab to 回到首页 mid-fight: views arriving 10×/s must not steal its focus.
    await p.focus('#leave');await sleep(400);
    check(await p.evaluate('document.activeElement?.id==="leave"'),'回到首页 keeps keyboard focus during a fight');
    await p.activate('#leave');await wait(p,'window.__brawl.state.mode==="title"','title after town');
    await p.activate('#stage-list [data-value="court"]');
    await wait(p,'window.__brawl.world().stage==="court"','back to the basket court',2000);
    check(true,'back to 毛线篮球场');
    // ---------- every style, any look (SPEC §5A) ----------
    const SPECIAL={hammer:['nspecial',null],cat:['nspecial','claw'],mage:['nspecial','yarnball'],ninja:['nspecial','shuriken'],
      sword:['nspecial',null],grappler:['nspecial',null],boxer:['nspecial',null],swift:['nspecial',null]};
    for(const style of ['cat','mage','ninja','sword','grappler','boxer','swift','hammer']){
      await p.activate(`.style-card[data-style="${style}"]`);
      check(await p.evaluate(`document.querySelector('.style-card[data-style="${style}"]').getAttribute("aria-checked")==="true"`),style+' picked with the keyboard');
      await p.activate('#cpu-list [data-value="0"]');await p.activate(`#cpu-style-list [data-value="${style}"]`);
      await p.activate('#solo');await wait(p,'window.__brawl.state.match?.phase==="fight"',style+' fight',8000);
      check(await p.evaluate(`window.__brawl.state.view.players.every(p=>p.style==="${style}")`),style+': both fighters use the chosen style (the computer too)');
      check((await w()).fighters.find(f=>f.seat===0).kind==='doll3d',style+': the 3D doll look is kept');
      await p.press('KeyK');
      const [mv,proj]=SPECIAL[style];
      await wait(p,`window.__brawl.state.match.fighters[0].move==="${mv}"`,style+' neutral special',2000);
      if(proj)await wait(p,'window.__brawl.state.match.projectiles>0',style+' projectile',3000);
      if(style==='boxer')check(await p.evaluate('(e=>!e.hidden&&/能量 \\d+/.test(e.textContent))(document.querySelector("#plate-0 .plate-extra"))'),'boxer: the HUD shows the power meter');
      else check(await p.evaluate('document.querySelector("#plate-0 .plate-extra").hidden'),style+': no meter pill on the HUD');
      await sleep(300);await shot('06-style-'+style);
      check(true,style+': K performs its own neutral special'+(proj?' ('+proj+')':''));
      await p.activate('#leave');await wait(p,'window.__brawl.state.mode==="title"&&!document.querySelector("#title-panel").hidden',style+' title visible again',1500);
    }
    check((await st()).audio.music===true,'music back on');
    check(report.errors.length===0,'no uncaught page exceptions',report.errors);
    report.ok=true;
  }catch(e){report.ok=false;report.failure=e.stack;console.error(e.stack);if(p)await shot('failure').catch(()=>{});process.exitCode=1;}
  finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));try{process.kill(-child.pid,'SIGKILL');}catch{}fs.rmSync(profile,{recursive:true,force:true});p?.close();}
})().then(()=>process.exit(process.exitCode||0));
