'use strict';
// Real built HTML, hidden before first paint, isolated profile, real CDP keys.
// No internal fighter/move flags are written. This reproduces the renderer failure
// offline; test:host:freeze additionally exercises both production LAN peers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{connect}=require('./cdp.cjs');
const ROOT=path.resolve(__dirname,'..'),HOST=process.env.BRAWL_HOST_ROOT||path.resolve(ROOT,'../..');
const {freePort}=require(path.join(HOST,'tests/helpers/lan-appearance-fixture'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const port=await freePort(),profile=fs.mkdtempSync(path.join(os.tmpdir(),'pet-brawl-e2e-freeze-'));
  const out=path.join(ROOT,'artifacts/mage-freeze',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});
  const report={checks:[],errors:[],html:process.env.BRAWL_HTML||path.join(ROOT,'dist/桌宠大乱斗.html')};
  const child=spawn(require(path.join(HOST,'demo/node_modules/electron')),[path.join(__dirname,'browser-shell.cjs'),'--remote-debugging-port='+port,'--use-mock-keychain','--mute-audio'],{
    detached:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'',PET_USERDATA_DIR:profile,PET_E2E_TEST:'1',PET_E2E_HIDDEN:'1',PET_E2E_BACKGROUND:'1',BRAWL_E2E_PROFILE:profile,BRAWL_HTML:report.html}});
  let p;
  try{
    let target;for(let n=0;n<100&&!target;n++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page'&&t.url.includes('.html'));}catch{}await sleep(100);}
    p=await connect(target);p.on(m=>{if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});await p.send('Runtime.enable');
    const wait=async(expr,label)=>{for(let n=0;n<100;n++){if(await p.evaluate(expr))return;await sleep(100);}throw Error('timeout: '+label);};
    const check=(ok,label)=>{assert(ok,label);report.checks.push(label);console.log('PASS',label);};
    const sample=()=>p.evaluate('({raf:window.__rafCount,timer:document.querySelector("#timer").textContent,frame:window.__brawl.state.match.frame,world:window.__brawl.world()})');
    await wait('!!window.__brawl?.state.driver','boot');
    await p.activate('.style-card[data-style="mage"]');await p.activate('#cpu-list [data-value="0"]');await p.activate('#cpu-style-list [data-value="grappler"]');await p.activate('#solo');
    await wait('window.__brawl.state.match?.phase==="fight"','fight');
    await p.evaluate('window.__seenThread=false;window.__moveProbe=setInterval(()=>{if(window.__brawl.state.match?.projectiles>0)window.__seenThread=true;},10);true');
    await p.key('KeyD');await sleep(80);await p.key('KeyK');await sleep(120);await p.key('KeyK','keyUp');await p.key('KeyD','keyUp');
    await sleep(250);report.before=await sample();await sleep(1250);report.after=await sample();
    await p.screenshot(path.join(out,'after-side-special.png'));
    check(report.errors.length===0,'mage side special has no uncaught renderer exception: '+report.errors.join('; '));
    check(await p.evaluate('window.__seenThread'),'real side special spawns a projectile');
    check(report.after.raf>report.before.raf+10,'animation keeps rendering after the special');
    check(report.after.timer!==report.before.timer,'visible timer keeps counting down');
    check(report.after.world.fighters.length===2&&report.after.world.fighters.every(f=>f.visible),'both fighters stay visible');
    await p.key('KeyA');await sleep(200);await p.key('KeyA','keyUp');await sleep(100);
    await p.activate('#leave');await wait('window.__brawl.state.mode==="title"','return to title');check(true,'leave works after casting');
    report.ok=true;
  }catch(e){report.ok=false;report.failure=e.stack;console.error(e.stack);await p?.screenshot(path.join(out,'failure.png')).catch(()=>{});process.exitCode=1;}
  finally{
    p?.close();const exited=new Promise(r=>child.once('exit',r));try{process.kill(-child.pid,'SIGTERM');}catch{}
    await Promise.race([exited,sleep(3000)]);if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}await exited;}
    fs.rmSync(profile,{recursive:true,force:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(out,'report.json'));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;}).then(()=>process.exit(process.exitCode||0));
