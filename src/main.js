// Entry: UI flow, keyboard / gamepad input, and wiring of world + transport.
import {createWorld} from './scene.js';
import {createAudio} from './audio.js';
import * as C from './characters.js';
import I from '../game/input.cjs';
import R from '../game/room.cjs';
import Net from '../game/net.cjs';
import Solo from '../game/solo.cjs';
import M from '../game/match.cjs';
import Stages from '../game/stage.cjs';

const $=id=>document.getElementById(id);
const world=createWorld($('stage'));
const KIND_LABEL={doll3d:'3D 布偶',sprite:'2D 立绘',toy:'内置形象'};
// The computer's look changes every match; its style is the same choice space as yours.
const CPU_LOOKS=['cat','bunny','mouse'];
const cpuAsset=()=>({kind:'toy',species:CPU_LOOKS[(view?.matchNo||0)%3],color:'#6c7cff'});
const TIME_LABEL={300:'5 分钟',480:'8 分钟',720:'12 分钟'};
const LEVEL_LABEL={0:'木桩',1:'轻松',2:'普通',3:'高手'};
const STAGE_ICON={court:'🧶',moon:'🧀',town:'🐟'};
const STAGE_LABEL=Object.fromEntries(Stages.STAGE_IDS.map(id=>[id,STAGE_ICON[id]+' '+Stages.STAGES[id].name]));

let driver=null,transport=null,mode='title',view=null,connection='idle',sdk=window.pet||null,petDriver=null,realtimeNote='';
let lastMatchNo=-1,lastEventSeq=0,resultsAt=0,errorTimer=null,toastTimer=null,lastFrame=performance.now();
const peerAssets=new Map();
const DEFAULT_PREFS={cpuLevel:2,timeLimit:480,stage:'court',tapJump:true,style:'hammer',cpuStyle:'random',music:true,sfx:true};
const prefs=loadPrefs();
function loadPrefs(){try{return {...DEFAULT_PREFS,...JSON.parse(localStorage.getItem('pet-brawl-prefs')||'{}')};}catch{return {...DEFAULT_PREFS};}}
function savePrefs(){try{localStorage.setItem('pet-brawl-prefs',JSON.stringify(prefs));}catch{}}
// Music and sound effects start ON; audio begins on the first click or key press
// (browsers block sound before a user gesture).
const audio=createAudio({music:prefs.music,sfx:prefs.sfx});
const unlockAudio=()=>audio.unlock();
addEventListener('pointerdown',unlockAudio,{capture:true});addEventListener('keydown',unlockAudio,{capture:true});

// ---------- UI helpers ----------
function show(panel){for(const id of ['title-panel','lobby-panel','results-panel'])$(id).hidden=id!==panel;$('menu').hidden=!panel;}
function error(text){$('error').textContent=text||'';$('error').hidden=!text;clearTimeout(errorTimer);if(text)errorTimer=setTimeout(()=>{$('error').hidden=true;},7000);}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;$('toast').classList.remove('pop');void $('toast').offsetWidth;$('toast').classList.add('pop');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},1600);}
let announceTimer=null;
function announce(text,{small=false,ms=900}={}){const a=$('announce');a.textContent=text;a.classList.toggle('small',small);a.hidden=false;a.classList.remove('pop');void a.offsetWidth;a.classList.add('pop');clearTimeout(announceTimer);announceTimer=setTimeout(()=>{a.hidden=true;},ms);}
function describe(e){const m=e?.message||String(e);const map={no_invitation:'这份 HTML 还没有联机邀请。',protocol_mismatch:'双方的游戏版本不一致，请用同一份 HTML。',session_closed:'本次邀请已结束。',zip_invalid:'这个 ZIP 读不出来，请确认是完整的角色包。',zip64_unsupported:'ZIP 太大（ZIP64），请重新打包后再导入。',pack_no_character:'包里没有 character.json，不像是桌宠角色包。',pack_no_frames:'角色包里没有找到 idle 动作图。',pack_realtime_invalid:'角色包里的 3D 布偶数据不完整。',image_decode_failed:'图片解码失败，换一张 PNG / WebP / JPG 试试。',file_too_large:'文件太大了（超过 12 MB）。',asset_too_large:'形象素材超过 1 MB，搭子那边会显示为内置形象。',CHARACTER_IMAGE_UNAVAILABLE:'暂时读不到当前桌宠形象。',invalid_view:'收到了一份无效的对局数据，已忽略。',host_only:'只有房主可以修改。',invalid_stage:'没有这张地图。'};
  return map[m]||(/permission|denied|revoked/i.test(m)?'能力未授权：请重新打开 HTML 并允许读取形象 / 联机。':/zip_entry_missing/.test(m)?'角色包缺少文件：'+m.split(':').slice(1).join(':'):'出了点问题：'+m);}
function portraitInto(el,src,fallback='🐭'){el.replaceChildren();if(src){const img=new Image();img.src=src;img.alt='';el.append(img);}else el.textContent=fallback;}
function assetPortrait(a){return a?.kind==='sprite'?a.frames[0]:a?.kind==='doll3d'?a.head:null;}
// Appearance and fighting style are independent choices: any pet can pick any style.
const STYLE_INFO={hammer:{icon:'🧀',name:'奶酪大锤',tips:'K 一口吞 · 方向+K 奶酪轮 · W+K 奶酪大跳（复活，霸体）· S+K 蓄力大锤（按住蓄力）'},
  cat:{icon:'🐾',name:'猫爪拳',tips:'K 爪风 · 方向+K 猫扑突进 · W+K 猫跃（复活，无敌）· S+K 看破（反击）· 空中 S+J 俯冲'},
  mage:{icon:'🧶',name:'毛线球法师',tips:'K 毛线球（按住蓄力）· 方向+K 缠线（减速）· W+K 毛线钩（钩台边）· S+K 毛线陷阱'},
  ninja:{icon:'🥷',name:'纸箱忍者',tips:'K 飞镖（按住蓄力）· 方向+K 瞬身斩（按住走更远）· W+K 纸箱弹射（按方向）· S+K 替身纸箱（反击）'},
  sword:{icon:'🪶',name:'逗猫棒剑士',tips:'剑尖（最远端）打中才最痛 · K 蓄力突刺（按住蓄力，蓄满破盾）· 方向+K 逗猫连击（再按 K 接四段）· W+K 跃空斩（复活）· S+K 反击'},
  grappler:{icon:'💪',name:'肉垫摔角手',tips:'K 旋风臂 · 方向+K 绳索摔（无视盾的指令投）· W+K 肉垫下劈（复活，重霸体）· S+K 蓄怒（接住攻击，下一击加倍）'},
  boxer:{icon:'🥊',name:'拳击喵',tips:'能量满时 K = 必杀拳（无视盾）· K 直拳（按住蓄力）· 方向+K 大摆拳 · W+K 上勾拳（复活）· S+K 闪避反击 · 空中攻击很弱'},
  swift:{icon:'⚡',name:'疾风猫',tips:'前空膝撞只有第一帧最强 · K 疾风重拳（很慢很痛）· 方向+K 疾风冲 · W+K 疾风飞扑（复活）· S+K 疾风踢'}};
const STYLE_IDS=Object.keys(STYLE_INFO);
const styleLabel=id=>{const s=STYLE_INFO[id]||STYLE_INFO.hammer;return s.icon+' '+s.name;};
const profileOf=d=>({...d.profile,style:STYLE_INFO[prefs.style]?prefs.style:'hammer'});
function renderFighterCard(){
  portraitInto($('fighter-portrait'),driver?.portrait,driver?.asset?.species==='cat'?'🐱':driver?.asset?.species==='bunny'?'🐰':'🐭');
  $('fighter-name').textContent=driver?.profile.name||'…';
  $('fighter-kind').textContent=driver?KIND_LABEL[driver.profile.kind]+(driver.profile.kind==='doll3d'?' · 实时骨骼':''):'';
  $('fighter-kind').dataset.kind=driver?.profile.kind||'';
  $('use-pet').hidden=!sdk?.character;$('use-pet').disabled=!petDriver;
  const usingPet=driver&&petDriver&&(driver.source==='pet'||driver.characterKey===petDriver.characterKey);
  $('pet-auto').hidden=!usingPet;
  $('pet-auto').textContent='🐾 已自动带入你的桌宠形象，换装后会自动跟随。'+(driver?.profile.kind==='sprite'&&realtimeNote?' '+realtimeNote:'');
}
async function setDriver(next,{remember=true}={}){
  driver=next;renderFighterCard();
  await world.setFighter(mySeat(),{profile:profileOf(driver),asset:driver.asset,fallback:driver.fallback,label:transport?(view?.you===1?'2P':'1P'):''});
  if(transport&&transport.role()!=='solo')transport.setProfile(profileOf(driver),driver.asset);
  else if(transport)transport.setProfile(profileOf(driver));
  if(remember)void C.saveDriver('last',driver);
}
function mySeat(){return view?.you??0;}

// ---------- character import ----------
async function importFiles(files){
  const list=[...files];if(!list.length)return;
  $('import-status').textContent='正在读取 '+(list[0].webkitRelativePath?.split('/')[0]||list[0].name)+' …';$('import-status').dataset.state='busy';
  try{
    let d;
    if(list.length>1||list[0].webkitRelativePath)d=await C.packDriver(list);
    else if(/\.zip$/i.test(list[0].name)||list[0].type==='application/zip')d=await C.packDriver(list[0]);
    else if(/^image\//.test(list[0].type)||/\.(png|webp|jpe?g|gif)$/i.test(list[0].name))d=await C.imageDriver(list[0]);
    else throw Error('请导入角色包 ZIP / 文件夹，或 PNG / WebP / JPG 图片。');
    if(d.characterKey)void C.saveDriver('pack:'+d.characterKey,d);
    await setDriver(d);
    $('import-status').textContent='已导入「'+d.profile.name+'」 · '+KIND_LABEL[d.profile.kind];$('import-status').dataset.state='ok';
  }catch(e){console.error(e);$('import-status').textContent=describe(e);$('import-status').dataset.state='error';}
}
$('import-file').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
$('import-folder').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
addEventListener('dragover',e=>{e.preventDefault();document.body.classList.add('dragging');});
addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});
addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragging');if(mode==='fight')return;void importFiles(e.dataTransfer.files);});
for(const t of C.TOYS){const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.toy=t.id;b.textContent=(t.id==='cat'?'🐱 ':t.id==='bunny'?'🐰 ':'🐭 ')+t.name;b.addEventListener('click',async()=>{await setDriver(await C.toyDriver(t.id));$('import-status').textContent='';});$('toy-row').append(b);}
$('use-pet').addEventListener('click',async()=>{if(petDriver)await setDriver(await preferPack(petDriver));});
async function preferPack(d){
  // Newer hosts expose the pet's realtime (3D rag-doll) data directly: no import needed.
  if(d?.source==='pet'&&sdk?.character?.getRealtime){
    try{const raw=await sdk.character.getRealtime(),rt=await C.realtimeDriver(raw,d);if(rt){realtimeNote='';return rt;}
      realtimeNote=raw?'这个形象的 3D 数据格式本游戏不认识，先以 2D 出战。':'这个形象的角色包没有 3D 布偶数据，以 2D 出战。';}
    catch(e){console.warn('realtime unavailable',e);realtimeNote='读取 3D 布偶数据失败（'+describe(e)+'），先以 2D 出战。';}
  }
  if(d?.characterKey){const cached=await C.loadDriver('pack:'+d.characterKey);if(cached?.asset.kind==='doll3d'){$('import-status').textContent='当前桌宠「'+cached.profile.name+'」已导入过 3D 布偶包，自动用 3D 出战。';$('import-status').dataset.state='ok';return cached;}}
  return d;
}

// ---------- consent & invitation ----------
function grantState(text){$('grant-box').hidden=!text;$('grant-text').textContent=text||'';}
async function readPet(){
  grantState('正在请求读取你的桌宠形象：请在桌宠弹出的授权窗口里点「允许」。');
  let grant;try{grant=await sdk.capabilities.request({});}catch(e){grantState('授权请求没有完成（'+describe(e)+'），可以再试一次。');return false;}
  if(grant?.status!=='granted'||!grant.permissions?.includes('character:read')){grantState('还没有允许读取桌宠形象，现在先用内置形象。想用自己的桌宠，点下面的按钮重新授权。');return false;}
  try{petDriver=await C.currentPetDriver(sdk.character);}catch(e){grantState('已授权，但暂时读不到当前桌宠形象：'+describe(e));return false;}
  grantState('');await setDriver(await preferPack(petDriver),{remember:false});void followPet();return true;
}
$('grant-retry').addEventListener('click',async()=>{if(await readPet()){error('');await joinInvitation();}});
async function joinInvitation(){
  if(transport||!sdk?.sessions?.getContext)return;
  let context=null;try{context=await sdk.sessions.getContext();}catch(e){if(!/permission|denied|revoked/i.test(e.message))error(describe(e));return;}
  if(context)await startLan().catch(e=>{error(describe(e));transport=null;});renderMenus();
}
// Follow outfit/character changes of the desktop pet (subscribe first, then read).
let following=false;
async function followPet(){
  const ch=sdk?.character;if(!ch?.watch||following)return;following=true;
  let sub;try{sub=await ch.watch();}catch{return;}
  addEventListener('beforeunload',()=>void ch.unwatch(sub).catch(()=>{}));
  let lastSig=petDriver?.profile.signature;
  while(true){
    try{
      const rev=await ch.next(sub);if(!rev)continue;
      const next=await C.currentPetDriver(ch);if(next.profile.signature===lastSig)continue;lastSig=next.profile.signature;
      const usingPet=!driver||driver.source==='pet'||driver.characterKey===petDriver?.characterKey;petDriver=next;
      if(usingPet){await setDriver(await preferPack(next),{remember:false});toast('已换上新的桌宠形象');}else renderFighterCard();
    }catch(e){if(/revoked|denied|disposed|inactive/i.test(e.message))return;await new Promise(r=>setTimeout(r,1000));}
  }
}

// ---------- transport ----------
function onView(v){
  view=v;
  if(v.matchNo!==lastMatchNo){lastMatchNo=v.matchNo;lastEventSeq=0;world.resetEvents(0);resultsAt=0;}
  syncFighters(v);renderMenus();
}
function syncFighters(v){
  if(driver)void world.setFighter(v.you,{profile:profileOf(driver),asset:driver.asset,fallback:driver.fallback,label:v.solo?'1P':v.you===0?'1P':'2P'});
  for(const p of v.players){
    if(p.seat===v.you)continue;
    const label=p.ai?'CPU':p.seat===0?'1P':'2P';
    const asset=p.ai?cpuAsset():peerAssets.get(p.signature);
    if(asset)void world.setFighter(p.seat,{profile:p,asset,label});
    else void world.setFighter(p.seat,{profile:{...p,signature:'pending:'+p.signature},asset:{kind:'toy',species:'mouse',color:p.color},label});
  }
}
function onAsset(seat,signature,asset){
  if(!C.checkAsset(asset)){error('搭子的形象数据无效，已改用内置形象显示。');return;}
  peerAssets.set(signature,asset);if(view)syncFighters(view);
}
function onConnection(s){connection=s;renderMenus();if(s==='closed'&&mode!=='title')toast('联机已结束');}
async function startSolo(){
  if(transport)return;
  transport=Solo.create({onView,onConnection});
  await transport.start(profileOf(driver));
  transport.setTime(prefs.timeLimit);transport.setStage(Stages.STAGES[prefs.stage]?prefs.stage:Stages.DEFAULT);transport.setCpuLevel(prefs.cpuLevel);applyCpuStyle();transport.ready(true);
}
function applyCpuStyle(){if(transport?.role()!=='solo')return;const s=prefs.cpuStyle==='random'?STYLE_IDS[Math.floor(Math.random()*STYLE_IDS.length)]:prefs.cpuStyle;transport.setCpuStyle(s);}
async function startLan(){
  // Recoverable transport gaps already have the pause/reconnect banner. Do not
  // leave an IPC error over the arena after the same connection has recovered.
  transport=Net.create(sdk.sessions,{onView,onConnection,onAsset,onError:e=>{if(!/\b(backpressure|peer_offline|not_connected)\b/.test(e.message))error(describe(e));}});
  const ctx=await transport.start(profileOf(driver),driver.asset);
  view={you:ctx.role==='host'?0:1,players:[],matchNo:0};
  // The host starts the lobby on its remembered stage; it can still change it there.
  if(ctx.role==='host'&&Stages.STAGES[prefs.stage]&&prefs.stage!==Stages.DEFAULT)try{transport.setStage(prefs.stage);}catch{}
}
async function leave(){
  const t=transport;transport=null;view=null;lastMatchNo=-1;
  renderMenus(); // show the title right away; the fighter below rebuilds in the background
  try{await t?.leave();}catch{}t?.dispose();
  world.removeFighter(1);await world.setFighter(0,{profile:profileOf(driver),asset:driver.asset,fallback:driver.fallback});
  renderMenus();
}

// ---------- menus ----------
function currentMatch(){return transport?.live?.()||null;}
function computeMode(){
  if(!transport)return 'title';
  const m=currentMatch();
  if(!m||!view||view.phase==='lobby')return 'lobby';
  if(m.phase==='results'){if(!resultsAt)resultsAt=performance.now();return performance.now()-resultsAt>1400?'results':'fight';}
  return 'fight';
}
let renderedMode='title';
function renderMenus(){
  mode=computeMode();const entered=mode!==renderedMode;renderedMode=mode;
  const solo=view?.solo,host=transport?.role()!=='guest';
  $('hud').hidden=mode!=='fight'&&mode!=='results';
  // Drop focus from the menu button that started the fight once, when the fight begins —
  // not on every view, or a keyboard player could never reach 回到首页 mid-fight.
  if(entered&&mode==='fight'&&document.activeElement?.matches?.('button'))document.activeElement.blur();
  show(mode==='title'?'title-panel':mode==='lobby'?'lobby-panel':mode==='results'?'results-panel':null);
  const labels={idle:'',solo:'单人 · 挑战电脑',waiting:'等待搭子加入…',connected:'已连接搭子',reconnecting:'正在重连…',closed:'邀请已结束'};
  $('conn').textContent=labels[connection]||connection;$('conn').dataset.state=connection;$('conn').hidden=!transport;
  $('leave').hidden=!transport;$('leave').textContent=solo?'回到首页':'离开本局';
  if(mode==='lobby'&&view?.players){
    const me=view.players.find(p=>p.seat===view.you);
    $('lobby-players').replaceChildren(...[0,1].map(seat=>playerRow(view.players.find(p=>p.seat===seat))));
    renderChips($('lobby-time'),R.TIME_OPTIONS,view.settings?.timeLimit,TIME_LABEL,sec=>{try{transport.setTime(sec);onView(transport.peek());}catch(e){error(describe(e));}},!host);
    renderChips($('lobby-stage'),Stages.STAGE_IDS,view.settings?.stage,STAGE_LABEL,id=>{try{transport.setStage(id);prefs.stage=id;savePrefs();onView(transport.peek());}catch(e){error(describe(e));}},!host);
    $('stage-hint').textContent=host?'（房主决定）':'（房主决定：'+(STAGE_LABEL[view.settings?.stage]||'')+'）';
    const styleLabels=Object.fromEntries(STYLE_IDS.map(id=>[id,STYLE_INFO[id].icon+' '+STYLE_INFO[id].name]));
    renderChips($('lobby-style'),STYLE_IDS,prefs.style,styleLabels,v=>void pickStyle(v),!!me?.ready);
    $('time-hint').textContent=host?'（房主决定）':'（房主决定：'+TIME_LABEL[view.settings?.timeLimit]+'）';
    const ended=connection==='closed';
    $('ready').disabled=ended||!me;$('ready').textContent=me?.ready?'已准备 · 点此取消':'我准备好了';
    $('lobby-note').textContent=ended?'对方已离开。通过桌宠重新发送这份 HTML，就能再打一场。':view.players.length<2?'把这个 HTML 通过桌宠「发送并一起玩」给搭子，对方接受后会出现在这里。':'两人都准备好就开打。';
    $('lobby-title').textContent='双人对战 · 局域网';
  }
  if(mode==='results')renderResults();
}
// Views arrive up to 25 times a second: update chips in place instead of rebuilding
// them, or a click that starts on a button can end on its replacement and be lost.
function renderChips(box,options,current,labels,onPick,disabled=false){
  const sig=options.join('|');
  if(box.dataset.sig!==sig){
    box.dataset.sig=sig;box._pick=onPick;
    box.replaceChildren(...options.map(v=>{const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.value=v;b.textContent=labels[v];b.addEventListener('click',()=>box._pick(typeof v==='number'?v:b.dataset.value));return b;}));
  }
  box._pick=onPick;
  for(const b of box.children){const v=b.dataset.value;b.setAttribute('aria-pressed',String(String(current)===v));b.disabled=disabled;}
}
function renderTitleOptions(){
  renderChips($('cpu-list'),R.CPU_LEVELS,prefs.cpuLevel,LEVEL_LABEL,l=>{prefs.cpuLevel=l;savePrefs();renderTitleOptions();});
  renderChips($('time-list'),R.TIME_OPTIONS,prefs.timeLimit,TIME_LABEL,s=>{prefs.timeLimit=s;savePrefs();renderTitleOptions();});
  renderChips($('stage-list'),Stages.STAGE_IDS,prefs.stage,STAGE_LABEL,id=>{prefs.stage=id;savePrefs();renderTitleOptions();});
  const cpuLabels={random:'🎲 随机',...Object.fromEntries(STYLE_IDS.map(id=>[id,STYLE_INFO[id].icon+' '+STYLE_INFO[id].name]))};
  renderChips($('cpu-style-list'),['random',...STYLE_IDS],prefs.cpuStyle,cpuLabels,v=>{prefs.cpuStyle=v;savePrefs();renderTitleOptions();});
}
function playerRow(p){
  const row=document.createElement('div');row.className='player-row'+(p&&p.seat===view.you?' is-you':'');
  const dot=document.createElement('span');dot.className='dot';dot.style.background=p?.color||'#ccc';
  const name=document.createElement('strong');name.textContent=p?p.name+(p.seat===view.you?'（你）':''):'等待搭子…';
  const kind=document.createElement('small');kind.textContent=p?(p.ai?'电脑':KIND_LABEL[p.kind])+' · '+styleLabel(p.style):'';
  const st=document.createElement('span');st.className='state';st.textContent=!p?'':p.ai?'就位':!p.connected?'掉线中':p.ready?'✓ 已准备':'未准备';
  row.append(dot,name,kind,st);return row;
}
function portraitFor(seat){
  if(seat===view?.you)return driver?.portrait||null;
  const p=view?.players.find(x=>x.seat===seat);if(!p||p.ai)return null;
  return assetPortrait(peerAssets.get(p.signature));
}
function renderResults(){
  const m=currentMatch();if(!m?.result)return;
  const {winner,reason}=m.result,you=view.you,solo=view.solo;
  $('results-title').textContent=winner==null?'平局！':winner===you?'你赢了！🏆':solo?'电脑获胜，再来！':'搭子获胜！';
  const R2={stocks:'击飞了对方全部的命',time:m.fighters[0].stocks!==m.fighters[1].stocks?'时间到 · 剩余命数更多':'时间到 · 百分比更低',sudden:'决胜局一击定胜负',draw:'决胜局也没分出胜负',forfeit:'对方离开了本局'};
  $('results-reason').textContent=R2[reason]||'';
  const rows=[0,1].map(seat=>{
    const p=view.players.find(x=>x.seat===seat),st=m.stats[seat],row=document.createElement('div');row.className='result-row'+(seat===you?' is-you':'');
    const crown=document.createElement('span');crown.className='crown';crown.textContent=winner===seat?'👑':'';
    const mini=document.createElement('span');mini.className='mini';portraitInto(mini,portraitFor(seat),p?.ai?'🐱':'🐭');
    const name=document.createElement('strong');name.textContent=(p?.name||'选手')+(seat===you?'（你）':'');
    const stat=document.createElement('span');stat.className='stat';stat.textContent=`击飞 ${st.kos} · 坠落 ${st.falls}\n造成伤害 ${Math.round(st.damageDealt)}%`;stat.style.whiteSpace='pre-line';
    row.append(crown,mini,name,stat);return row;});
  $('results-players').replaceChildren(...rows);
  const me=view.players.find(p=>p.seat===you),other=view.players.find(p=>p.seat!==you);
  $('again').disabled=connection==='closed'&&!solo;
  $('again').textContent=solo?'再来一局':me?.ready?'已准备 · 等搭子':'再来一局';
  $('results-note').textContent=solo?'':connection==='closed'?'对方已离开。':other?.ready?'搭子想再来一局！':'两人都点「再来一局」就重新开打。';
}
$('solo').addEventListener('click',()=>void startSolo().catch(e=>error(describe(e))));
$('ready').addEventListener('click',()=>{const me=view?.players.find(p=>p.seat===view.you);try{transport.ready(!me?.ready);}catch(e){error(describe(e));}});
$('again').addEventListener('click',()=>{try{resultsAt=0;applyCpuStyle();transport.ready(true);if(transport.role()==='solo')onView(transport.peek());}catch(e){error(describe(e));}});
$('leave').addEventListener('click',()=>void leave());
function renderAudioButtons(){
  $('sfx').setAttribute('aria-pressed',String(audio.sfx));$('sfx').textContent='音效 '+(audio.sfx?'开':'关');
  $('music').setAttribute('aria-pressed',String(audio.music));$('music').textContent='音乐 '+(audio.music?'开':'关');
}
$('sfx').addEventListener('click',()=>{audio.setSfx(!audio.sfx);prefs.sfx=audio.sfx;savePrefs();renderAudioButtons();});
$('music').addEventListener('click',()=>{audio.setMusic(!audio.music);prefs.music=audio.music;savePrefs();renderAudioButtons();});
$('keys-btn').addEventListener('click',()=>{const open=$('keys-panel').hidden;$('keys-panel').hidden=!open;$('keys-btn').setAttribute('aria-expanded',String(open));});
function renderStyles(){
  for(const c of document.querySelectorAll('.style-card[data-style]'))c.setAttribute('aria-checked',String(c.dataset.style===prefs.style));
  $('keys-tips').textContent='W+J 上强 · W+U 上重击 · '+STYLE_INFO[prefs.style].icon+' '+STYLE_INFO[prefs.style].tips;
}
async function pickStyle(style){if(!STYLE_INFO[style])return;prefs.style=style;savePrefs();renderStyles();renderMenus();if(driver)await setDriver(driver,{remember:false});}
for(const c of document.querySelectorAll('.style-card[data-style]'))c.addEventListener('click',()=>void pickStyle(c.dataset.style));
function renderTapJump(){$('tapjump').setAttribute('aria-pressed',String(prefs.tapJump));$('tapjump').textContent='W 键跳跃：'+(prefs.tapJump?'开':'关');}
$('tapjump').addEventListener('click',()=>{prefs.tapJump=!prefs.tapJump;savePrefs();renderTapJump();});

// ---------- input ----------
const KEYMAP={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',Space:'jump',KeyJ:'attack',KeyK:'special',KeyU:'smash',KeyL:'shield',KeyI:'grab'};
const pad=I.create(),held=new Set(),dirOrder=[];
let running=0,lastTap={dir:0,t:0},debugOn=false;
function pressAction(a){
  if(a==='left'||a==='right'){
    const dir=a==='left'?-1:1,t=performance.now();
    if(lastTap.dir===dir&&t-lastTap.t<260)running=dir;lastTap={dir,t};
    I.press(pad,a);dirOrder.push(a);
  }else if(a==='up'){I.press(pad,'up');if(prefs.tapJump)I.press(pad,'tap');}
  else I.press(pad,a);
}
addEventListener('keydown',e=>{
  if(e.target.closest?.('input,textarea,select'))return;
  if(e.code==='Backquote'){debugOn=!debugOn;world.setDebug(debugOn);return;}
  const a=KEYMAP[e.code];if(!a)return;
  if(mode!=='fight')return;
  e.preventDefault();if(e.repeat)return;
  held.add(a);pressAction(a);pushInput();
});
addEventListener('keyup',e=>{
  const a=KEYMAP[e.code];if(!a)return;held.delete(a);
  const i=dirOrder.lastIndexOf(a);if(i>=0&&!held.has(a))dirOrder.splice(i,1);
  if((a==='left'&&running===-1)||(a==='right'&&running===1))running=0;
  pushInput();
});
addEventListener('blur',()=>{held.clear();dirOrder.length=0;running=0;});
// Gamepad (standard mapping): stick moves, Ⓐ jump, Ⓧ attack, Ⓨ special, RB smash, LB shield, RT grab.
const padPrev={};
function readGamepad(){
  const gp=[...(navigator.getGamepads?.()||[])].find(Boolean);if(!gp)return null;
  const b=i=>!!gp.buttons[i]?.pressed,ax=gp.axes[0]||0,ay=gp.axes[1]||0;
  const edge=(k,now,fn)=>{if(now&&!padPrev[k])fn();padPrev[k]=now;};
  if(mode==='fight'){
    edge('a',b(0),()=>I.press(pad,'jump'));edge('x',b(2),()=>I.press(pad,'attack'));edge('y',b(3),()=>I.press(pad,'special'));
    edge('rb',b(5),()=>I.press(pad,'smash'));edge('lb',b(4),()=>I.press(pad,'shield'));edge('rt',b(7),()=>I.press(pad,'grab'));
    edge('l',ax<-0.6,()=>I.press(pad,'left'));edge('r',ax>0.6,()=>I.press(pad,'right'));edge('d',ay>0.6,()=>I.press(pad,'down'));edge('u',ay<-0.6,()=>I.press(pad,'up'));
  }
  return {x:Math.abs(ax)>0.35?Math.sign(ax):0,y:Math.abs(ay)>0.45?-Math.sign(ay):0,run:Math.abs(ax)>0.85,h:{jump:b(0),attack:b(2),special:b(3),smash:b(5),shield:b(4)}};
}
function composeInput(){
  const lastH=[...dirOrder].reverse().find(d=>held.has(d));
  pad.x=lastH==='left'?-1:lastH==='right'?1:0;
  pad.y=held.has('up')&&!held.has('down')?1:held.has('down')&&!held.has('up')?-1:0;
  pad.run=running&&running===pad.x?1:0;
  pad.h.jump=held.has('jump')||(prefs.tapJump&&held.has('up'))?1:0;
  for(const k of ['attack','special','smash','shield'])pad.h[k]=held.has(k)?1:0;
  const g=readGamepad();
  if(g){if(g.x)pad.x=g.x;if(g.y)pad.y=g.y;if(g.run)pad.run=1;for(const k of Object.keys(g.h))if(g.h[k])pad.h[k]=1;}
  return pad;
}
function pushInput(){if(transport&&mode==='fight')transport.setInput(I.clone(composeInput()));}

// ---------- HUD + events ----------
const heat=p=>p<35?'#ffffff':p<70?'#ffe36e':p<110?'#ffab4a':p<150?'#ff6a4a':'#ff3355';
function hud(m){
  const t=Math.max(0,Math.ceil(m.timeLeft/60));
  $('timer').textContent=m.phase==='sudden'?'决胜！':Math.floor(t/60)+':'+String(t%60).padStart(2,'0');
  $('timer').dataset.low=String(m.phase==='fight'&&t<=30);
  for(const f of m.fighters){
    const plate=$('plate-'+f.seat),p=view?.players.find(x=>x.seat===f.seat);
    plate.style.setProperty('--pc',p?.color||'#ff5a7a');
    const name=(STYLE_INFO[p?.style]?.icon||'🧀')+' '+(p?.name||'选手')+(f.seat===view?.you?'（你）':p?.ai?'（电脑）':'');
    const nameEl=plate.querySelector('.plate-name');if(nameEl.textContent!==name)nameEl.textContent=name;
    const portrait=plate.querySelector('.plate-portrait'),src=portraitFor(f.seat)||'';
    if(portrait.dataset.src!==src){portrait.dataset.src=src;portraitInto(portrait,src||null,p?.ai?'🐱':'🐭');}
    const pct=plate.querySelector('.plate-pct strong'),val=String(Math.floor(f.percent));
    if(pct.textContent!==val){pct.textContent=val;plate.querySelector('.plate-pct').classList.remove('hit');void pct.offsetWidth;plate.querySelector('.plate-pct').classList.add('hit');}
    plate.style.setProperty('--heat',heat(f.percent));
    const stocks=plate.querySelector('.plate-stocks');if(stocks.childElementCount!==f.stocks)stocks.replaceChildren(...Array.from({length:f.stocks},()=>document.createElement('i')));
    plate.dataset.out=String(f.state==='out');
    // 能量条（拳击喵）/ 蓄怒倍率（摔角手）: both matter to the opponent too, so both plates show them.
    const extra=plate.querySelector('.plate-extra'),meter=M.STYLES[f.style]?.attrs.meter;
    const txt=f.revengeMult>1?'🔥 蓄怒 ×'+f.revengeMult.toFixed(1):meter?(f.meter>=100?'⚡ 必杀拳就绪':'能量 '+Math.floor(f.meter||0)):'';
    if(extra.textContent!==txt)extra.textContent=txt;extra.hidden=!txt;
    extra.style.setProperty('--fill',meter?Math.min(100,f.meter||0)+'%':'0%');extra.dataset.full=String(f.meter>=100||f.revengeMult>1);
  }
  const stale=transport?.hostStale?.(),pause=view?.pause;
  $('banner').hidden=!(pause||stale||(connection==='closed'&&transport?.role()!=='solo'&&m.phase!=='results'));
  if(pause)$('banner').textContent='⏸ '+(transport.role()==='host'?'搭子':'房主')+'掉线了，等待重连… '+Math.ceil(pause.remainingMs/1000)+' 秒';
  else if(stale)$('banner').textContent='⏸ 和房主的连接中断，等待重连…';
  else if(connection==='closed')$('banner').textContent='联机已结束';
}
function eventsFor(m){return transport?.role()==='guest'?(view?.match?.events||[]):m.events;}
function processEvents(m){
  for(const e of eventsFor(m)){
    if(e.seq<=lastEventSeq)continue;lastEventSeq=e.seq;
    if(e.type==='countdown'){announce(String(e.n));audio.play('countdown');}
    else if(e.type==='go'){announce('GO!');audio.play('go');}
    else if(e.type==='hit')audio.play('hit',e);
    else if(e.type==='shield')audio.play('shield');
    else if(e.type==='parry'){audio.play('parry');if(e.seat===view?.you)toast('✨ 完美防御！');}
    else if(e.type==='ko'){audio.play('ko');}
    else if(e.type==='jump')audio.play('jump');
    else if(e.type==='grab')audio.play('grab');
    else if(e.type==='spawn')audio.play('spawn');
    else if(e.type==='reflect')audio.play('reflect');
    else if(e.type==='shieldbreak'){audio.play('shieldbreak');toast(e.seat===view?.you?'💥 盾被打爆了！':'💥 打爆了对方的盾！');}
    else if(e.type==='slam')audio.play('slam');
    else if(e.type==='charge')audio.play('charge');
    else if(e.type==='armor')audio.play('armor');
    else if(e.type==='revenge'){audio.play('revenge');toast(e.seat===view?.you?'🔥 蓄怒！下一击 ×'+e.mult.toFixed(1):'🔥 对方蓄满了蓄怒，小心下一击');}
    else if(e.type==='kopunch')audio.play('kopunch');
    else if(e.type==='game'){announce(e.reason==='time'?'TIME!':'GAME!',{ms:1400});audio.play('game');}
    else if(e.type==='sudden'){announce('决胜局！',{small:true,ms:1400});audio.play('go');}
    else if(e.type==='results'&&e.winner===view?.you)audio.play('win');
  }
}

// ---------- frame loop ----------
function frame(now){
  window.__rafCount=(window.__rafCount||0)+1;
  const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
  const before=mode;mode=computeMode();if(mode!==before)renderMenus();
  audio.setMode(mode==='fight'?'fight':'menu');
  if(transport&&mode==='fight')transport.setInput(I.clone(composeInput()));
  const m=currentMatch();
  if(m&&transport){processEvents(m);hud(m);}
  // Menus show the stage that will be fought on (title: my pick; lobby: the host's).
  if(!(m&&transport))world.setStage(view?.settings?.stage||prefs.stage);
  world.update({match:transport?(transport.present?.()||m):null,dt,events:m&&transport?eventsFor(m):[]});
  requestAnimationFrame(frame);
}

// ---------- boot ----------
function matchSummary(m){return m&&{stage:m.stage,phase:m.phase,frame:m.frame,timeLeft:m.timeLeft,timeLimit:m.timeLimit,paused:m.paused,result:m.result,projectiles:m.projectiles.length,
  stats:m.stats.map(s=>({kos:s.kos,falls:s.falls,damageDealt:s.damageDealt,attacksStarted:s.attacksStarted,pressesSeen:{...s.pressesSeen}})),
  fighters:m.fighters.map(f=>({seat:f.seat,x:f.x,y:f.y,vx:f.vx,vy:f.vy,state:f.state,move:f.move?.id||null,phase:f.move?.phase||null,percent:f.percent,stocks:f.stocks,facing:f.facing,ground:f.ground,jumpsLeft:f.jumpsLeft,shieldHP:f.shieldHP,invincible:f.invincible}))};}
Object.defineProperty(window,'__brawl',{value:{
  get state(){const v=view?{...view,match:undefined}:null;return {audio:{music:audio.music,sfx:audio.sfx,unlocked:audio.unlocked,...audio.diagnostics()},mode,connection,view:v?structuredClone(v):null,match:matchSummary(currentMatch()),driver:driver&&{...driver.profile},input:I.clone(pad),prefs:{...prefs}};},
  world:()=>world.diagnostics(),transport:()=>transport?.diagnostics()||null,
}});
async function boot(){
  show('title-panel');$('swap').open=!sdk?.character;renderFighterCard();renderTitleOptions();renderTapJump();renderStyles();renderAudioButtons();
  const cached=await C.loadDriver('last');
  await setDriver(cached||await C.toyDriver('mouse'),{remember:false});
  if(sdk?.character?.getCurrent)await readPet();
  $('env-note').textContent=sdk?.sessions?'从桌宠打开：可以读取当前形象，也可以通过桌宠「发送并一起玩」双人对战。':'普通浏览器：可单人挑战电脑、导入形象；双人对战需通过桌宠发送并一起玩。';
  await joinInvitation();
  renderMenus();
}
requestAnimationFrame(frame);
addEventListener('beforeunload',()=>{transport?.dispose();audio.dispose();world.destroy();});
void boot();
