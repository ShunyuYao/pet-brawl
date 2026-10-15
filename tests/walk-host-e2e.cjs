'use strict';
// Real SDK + permission dialog + Chromium keyboard; no game-state injection.
// Only tests the local animation preview, not two-device delivery.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),HOST=process.env.BRAWL_HOST_ROOT;
assert(HOST,'BRAWL_HOST_ROOT must point to an animation-capable host');
const H=require(path.join(HOST,'tests/e2e-helpers')),F=require(path.join(HOST,'tests/helpers/lan-appearance-fixture'));
const {connect}=require('./cdp.cjs');
const {activateClosingButton}=require(path.join(HOST,'tests/e2e/html-card-input'));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'pet-plugin-appearance-brawl-walk-'));
const evidence=path.join(ROOT,'artifacts/walk-host',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(evidence,{recursive:true});
const report={checks:[],profile};let app,account,p;
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2));
const check=label=>{report.checks.push(label);console.log('PASS',label);};
async function wait(fn,label,ms=45000){let last;const end=Date.now()+ms;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await H.sleep(90);}throw Error('Timeout '+label+': '+JSON.stringify(last));}
let cleanup;function stop(){return cleanup||=(async()=>{p?.close();if(app)await H.stopOwned(app);await account?.close();})();}
(async()=>{try{
 account=await require(path.join(HOST,'tests/helpers/mandatory-login-fixture')).createMandatoryLoginFixture();
 const port=await F.freePort();save(path.join(profile,'config.json'),{character:'qiqi',onboarding:{completed:true},behavior:{idleStroll:false,autoSleep:false},general:{autoCheckUpdates:false},relay:{url:''},tts:{enabled:false},plugins:{registrySources:[]}});
 save(path.join(profile,'settings-privacy.json'),{usageStatsEnabled:false});
 app=H.launch({userData:profile,cdpPort:port,bootstrap:path.join(__dirname,'walk-host-bootstrap.cjs'),args:['--mute-audio'],env:{...account.env,BRAWL_HOST_ROOT:HOST,BRAWL_WALK_PREVIEW:process.env.BRAWL_WALK_PREVIEW||'0',PET_E2E_TEST:'1',PET_E2E_HIDDEN:'1',PET_E2E_BACKGROUND:'1',PET_PUBLIC_NATIVE_LOG:path.join(evidence,'native.jsonl')}});
 await account.login(port);const pet=await H.findTarget(port,'/index.html');if(process.env.PET_E2E_ELECTRON_BINARY)assert(pet.url.includes('app.asar/'),'must exercise the packaged runtime');await wait(()=>H.evalIn(pet,'typeof runCommand==="function"'),'pet kernel');
 await H.evalIn(pet,'runCommand("voice");true');const chat=await H.findTarget(port,'/chat.html');await wait(()=>H.evalIn(chat,'!!window.chatAPI'),'chat preload');
 const file=process.env.BRAWL_HTML||path.join(ROOT,'dist/桌宠大乱斗.html'),point=await H.evalIn(pet,'({x:LX+SIZE/2,y:LY+SIZE/2})');
 const data={items:[{mimeType:'text/html',data:'',title:path.basename(file),baseURL:''}],files:[file],dragOperationsMask:1};
 for(const type of ['dragEnter','dragOver','drop'])await H.cdp(pet,'Input.dispatchDragEvent',{type,...point,data});
 await wait(()=>H.evalIn(chat,'chatAPI.getCarriedFile().then(c=>!!c?.htmlWork)'),'real imported game');
 assert.equal((await H.evalIn(chat,'chatAPI.e2eOpenReceivedHtmlWork("fixture-sender-a")')).ok,true);
 const game=await H.findReadyTarget(port,'pet-work://','pet');p=await connect(game);
 const dialog=await H.findReadyTarget(port,'/dialog.html','dialogAPI');await activateClosingButton(port,dialog,'.btn-primary');
 await wait(()=>p.evaluate('document.querySelector("#use-pet")?.disabled===false'),'current pet loaded');
 await p.activate('#cpu-list [data-value="0"]');await p.activate('#solo');
 await wait(()=>p.evaluate('window.__brawl.state.match?.phase==="fight"'),'training fight');
 await p.evaluate('document.activeElement?.blur();true');
 const visual=()=>p.evaluate('window.__brawl.world().fighters.find(f=>f.seat===0)');
 await wait(async()=>(await visual())?.animation?.state==='idle','actual idle sprite');
 for(const [code,flip] of [['KeyD',-1],['KeyA',1]]){
  const samples=[];await p.key(code);
  try{for(let i=0;i<5;i++){await H.sleep(95);samples.push(await visual());}
   assert(samples.every(v=>v.animation.state==='walk'),'ground movement selects walk');
   assert(samples.every(v=>v.animation.frames===20),'complete Qiqi walk, no dropped frames');
   assert(new Set(samples.map(v=>v.animation.texture)).size>1,'actual material texture advances');
   assert(samples.every(v=>v.animation.flip===flip),'native facing');
   await p.screenshot(path.join(evidence,code+'.png'));
  }finally{await p.key(code,'keyUp');}
  await wait(async()=>(await visual()).animation.state==='idle','release restores idle');
 }
 check('full native walk: changing material, both facings, stop to idle');
 await p.press('Space');await wait(()=>p.evaluate('window.__brawl.state.match.fighters[0].state==="air"'),'jump');assert.equal((await visual()).animation.state,'idle');
 await wait(()=>p.evaluate('window.__brawl.state.match.fighters[0].state==="idle"'),'land');
 await p.press('KeyJ');await wait(()=>p.evaluate('!!window.__brawl.state.match.fighters[0].move'),'attack');assert.equal((await visual()).animation.state,'idle');check('jump and attack interrupt walk and keep original combat poses');
 const rows=fs.readFileSync(path.join(evidence,'native.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(rows.length&&rows.every(r=>!r.isVisible&&!r.isFocused));check('all automatic acceptance windows hidden before first paint');
 const works=await H.evalIn(chat,'chatAPI.e2eInspectHtmlWork()');assert(works.every(w=>!w.visible),'game BaseWindow remains hidden');
 report.ok=true;report.port=port;report.pid=app.pid;save(path.join(evidence,'report.json'),report);console.log('EVIDENCE',evidence);
 if(process.env.BRAWL_WALK_PREVIEW==='1'){
  fs.writeFileSync(path.join(profile,'show-game'),'');await wait(()=>fs.existsSync(path.join(profile,'shown.json')),'visible game preview');assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'shown.json'))).visible,true);p.close();p=null;console.log('PREVIEW_READY',JSON.stringify({port,pid:app.pid,profile}));
  process.on('SIGINT',()=>{void stop().then(()=>process.exit());});process.on('SIGTERM',()=>{void stop().then(()=>process.exit());});
  await new Promise(r=>app.once('exit',r));await stop();
 }else await stop();
 }catch(error){report.error=error.stack;save(path.join(evidence,'report.json'),report);console.error(error);if(p)await p.screenshot(path.join(evidence,'failure.png')).catch(()=>{});await stop();process.exitCode=1;}
})();
