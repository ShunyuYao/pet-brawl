'use strict';
// Actual production UDP discovery, real file-send control and byte delivery,
// first-use invitation consent + matching TLS pairing codes, hosted game/SDK.
// No invitation fixture, trust seeding, mock broker or synthesized game results.
// Hidden windows/real CDP keys prove business behavior, not native OS focus or
// physical two-computer networking. Only OS keystore is a disposable AES fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const GAME = path.resolve(__dirname, '..');
// Local fixture: a directory with rat-doll-{female,male}.zip character packs (not published).
const PACKS = process.env.BRAWL_PACKS_DIR || path.resolve(GAME, '../rat-doll-lab/dist');
const HOST = process.env.BRAWL_HOST_ROOT || path.resolve(GAME, '../..');
assert(fs.existsSync(path.join(HOST,'demo/core/peer-session/contracts.js')), 'Set BRAWL_HOST_ROOT to the host checkout containing pet.sessions');
const H = require(path.join(HOST, 'tests/e2e-helpers'));
const electron = require(path.join(HOST, 'demo/node_modules/electron'));
const charIds = ['rat-doll-female', 'rat-doll-male'];
const F = require(path.join(HOST, 'tests/helpers/lan-appearance-fixture'));
const { activateButton, activateClosingButton } = require(path.join(HOST, 'tests/e2e/html-card-input'));
const source = path.join(GAME, 'dist/桌宠大乱斗.html');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-plugin-appearance-peer-delivery-'));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(GAME, 'artifacts/host-e2e', runId);
const bootstrap = path.join(H.REPO, 'tests/helpers/peer-session-delivery-bootstrap.js');
const report = { runId, root, scope: 'Actual two hidden production hosts over loopback UDP/TCP/TLS. OS keystore is test AES-GCM only; native Keychain and two physical machines are not covered.', checks: [], failures: [], screenshots: [], dialogs: [], sdkGrants: [], exceptions: [] };
const apps = [], sockets = [];
let runtime;
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(label, detail) { report.checks.push({ label, pass: true, ...(detail === undefined ? {} : { detail }) }); console.log('PASS', label); }
async function wait(fn, label, ms = 30000) { const until = Date.now() + ms; let last; while (Date.now() < until) { try { const value = await fn(); if (value) return value; last = value; } catch (e) { last = e.message; } await H.sleep(100); } throw Error('Timeout: ' + label + '; last=' + JSON.stringify(last)); }
const targets = app => fetch(`http://127.0.0.1:${app.cdp}/json`).then(r => r.json());
const activity = app => { const file = path.join(app.profile, 'activity-hub.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { records: [] }; };
const state = app => H.evalIn(app.game, 'window.__brawl.state');
const world = app => H.evalIn(app.game, 'window.__brawl.world()');
async function screenshot(page, name) { await H.cdp(page, 'Page.captureScreenshot', {format:'png'}); await H.evalIn(page, 'document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); const result = await H.cdp(page, 'Page.captureScreenshot', { format: 'png' }); const file = path.join(evidence, name + '.png'); fs.writeFileSync(file, Buffer.from(result.data, 'base64')); report.screenshots.push(file); }
async function watch(page, label) { const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ label, details: m.params.exceptionDetails }); }; ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' })); sockets.push(ws); }
async function key(page, code, type = 'keyDown') { const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code; await H.cdp(page, 'Input.dispatchKeyEvent', { type, key, code, ...(code === 'ArrowDown' ? { windowsVirtualKeyCode: 40 } : code === 'Space' ? { windowsVirtualKeyCode: 32 } : code === 'Enter' ? { text: '\r', windowsVirtualKeyCode: 13 } : {}) }); }
async function focus(page, selector) { await H.cdp(page, 'Emulation.setFocusEmulationEnabled', { enabled: true }); assert.equal(await H.evalIn(page, `document.querySelector(${JSON.stringify(selector)}).focus();document.activeElement.matches(${JSON.stringify(selector)})`), true); }
async function input(page, selector, text) { await focus(page, selector); await H.cdp(page, 'Input.insertText', { text }); assert.equal(await H.evalIn(page, `document.querySelector(${JSON.stringify(selector)}).value`), text); }
async function boot(label, discovery, peerDiscovery) {
  const app = { label, profile: path.join(root, label), deviceId: crypto.randomUUID(), name: 'Peer delivery ' + label, cdp: await F.freePort() };
  apps.push(app); fs.mkdirSync(app.profile);
  json(path.join(app.profile, 'device.json'), { deviceId: app.deviceId, name: app.name });
  json(path.join(app.profile, 'friends.json'), { friends: [], pending: [], outgoing: [] });
  json(path.join(app.profile, 'settings-privacy.json'), { version: 1, usageStatsEnabled: false, doNotDisturb: false, verboseLogging: false });
  json(path.join(app.profile, 'config.json'), { character: label === 'a' ? 'qiqi' : 'nienie', petName: app.name,
    me: { petId: 'peer_delivery_' + label }, onboarding: { completed: true },
    behavior: { idleStroll: false, autoSleep: false, edgeSnap: false, petSize: 220 },
    crossScreen: { allowDirectVisits: true, requireVisitConfirmation: false },
    relay: { url: 'ws://127.0.0.1:1', paired: {} }, general: { autoCheckUpdates: false }, tts: { enabled: false },
    plugins: { developerMode: false, registrySources: ['http://127.0.0.1:1/registry.json'] } });
  app.env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PET_USERDATA_DIR: app.profile,
    PET_E2E_TEST: '1', PET_E2E_HIDDEN: '1', PET_E2E_BACKGROUND: '1', PET_DND_TRIGGER_COUNT: '999',
    PET_ACCOUNT_API_BASE: 'http://127.0.0.1:1', PET_ACTIVITY_BRIDGE_PORT: '0',
    PET_LAN_DISCOVERY_PORT: String(discovery), PET_LAN_DISCOVERY_TARGETS: `127.0.0.1:${peerDiscovery}`,
    PET_E2E_LAN_TCP_PORT: String(await F.freePort()), PET_E2E_TF_PORT: String(await F.freePort()) };
  return launch(app);
}
async function launch(app) {
  app.run = { label: app.label + '-run-' + ((app.runs?.length || 0) + 1) }; (app.runs ||= []).push(app.run);
  app.run.native = path.join(evidence, app.run.label + '-native.jsonl'); fs.writeFileSync(app.run.native, '');
  app.child = spawn(electron, ['--require', bootstrap, runtime.demo, `--remote-debugging-port=${app.cdp}`, '--use-mock-keychain', '--mute-audio'], { cwd: runtime.demo, env: { ...app.env, PET_PUBLIC_NATIVE_LOG: app.run.native }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  app.run.pid = app.child.pid; app.child.log = ''; app.child.stdout.on('data', x => { app.child.log += x; }); app.child.stderr.on('data', x => { app.child.log += x; });
  app.pet = await H.findTarget(app.cdp, '/index.html');
  await wait(() => H.evalIn(app.pet, 'typeof currentCharKey==="string" && !!frames.idle?.[0]?.[0]?.naturalWidth'), 'real pet decoded ' + app.label);
  await wait(async () => (await H.evalIn(app.pet, H.CANVAS_PIXELS)) > 100, 'real pet painted ' + app.label);
  await watch(app.pet, app.run.label + '-pet');
  app.overlay = await H.findTarget(app.cdp, '/pet-overlay.html'); await wait(() => H.evalIn(app.overlay, 'typeof petOverlayAPI === "object"'), 'overlay preload ready');
  await screenshot(app.pet, app.run.label + '-pet'); return app;
}
async function stop(app) {
  if (!app.child) return;
  const child = app.child; H.kill(child);
  await wait(() => { try { process.kill(child.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } }, 'owned host stopped ' + app.label, 10000);
  fs.writeFileSync(path.join(evidence, app.run.label + '-host.log'), child.log); app.run.exited = true; app.child = null;
}
async function nearby(a, b) { return wait(async () => { const rows = await H.evalIn(a.pet, 'petAPI.lanGetDevices()'); return rows.find(r => r.deviceId === b.deviceId); }, 'actual UDP discovered receiver'); }
async function sendGame(a, b, {share = false} = {}) {
  const previous = new Set(activity(b).records.map(r => r.id));
  const peer = await nearby(a, b); report.discovery = peer;
  await H.evalIn(a.pet, 'petAPI.openDashboard();true'); a.dashboard = await H.findReadyTarget(a.cdp, '/dashboard.html', 'dashboard');
  await wait(() => H.evalIn(a.dashboard, '!!document.querySelector("[data-action=resident-errand], .lan-row[data-via=lan] .lan-errand")'), 'real send entry ready');
  if(await H.evalIn(a.dashboard,'!!document.querySelector("[data-action=resident-errand]")')) {
    await activateButton(a.dashboard,'[data-action=resident-errand]');
    const recipient='[data-friend="'+b.deviceId+'"]';
    await wait(()=>H.evalIn(a.overlay,'!!document.querySelector('+JSON.stringify(recipient)+')'),'real discovered recipient');
    if(!await H.evalIn(a.overlay,'document.querySelector('+JSON.stringify(recipient)+').getAttribute("aria-pressed")==="true"'))await activateButton(a.overlay,recipient);
  } else {
    await activateClosingButton(a.cdp, a.dashboard, '.lan-row[data-via="lan"] .lan-errand');
  }
  await wait(() => H.evalIn(a.overlay, '!!document.querySelector("#errand-card")'), 'real send card');
  await activateButton(a.overlay, '#errand-card [data-tab="file"]');
  const point = await wait(() => H.evalIn(a.overlay, '(()=>{const e=document.querySelector("#ec-dropzone");if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()'), 'file tab dropzone painted');
  // CDP drag uses actual OS file paths. These are drag target coordinates, never
  // synthesized mouse clicks or pet-window hit-testing.
  const data = { items: [{ mimeType: 'text/html', data: '', title: path.basename(source), baseURL: '' }], files: [source], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await H.cdp(a.overlay, 'Input.dispatchDragEvent', { type, ...point, data });
  await wait(() => H.evalIn(a.overlay, `document.querySelector('#ec-dropzone .ec-attachment strong')?.textContent===${JSON.stringify(path.basename(source))}`), 'real file selected');
  await input(a.overlay, '#ec-input', '来打一架'); await activateButton(a.overlay, '#ec-go');
  const sendDialog = await wait(async () => { for(const page of (await targets(a)).filter(t=>t.url.includes('/dialog.html'))){const init=await H.evalIn(page,'dialogAPI.getInit()',3000).catch(()=>null);if(init?.peerSessionKind==='send'&&await H.evalIn(page,'!!document.querySelector(".btn-primary") && document.body.innerText.length>10'))return page;}return null; }, 'real send versus share choice');
  await screenshot(sendDialog, share?'send-share-only':'send-and-play'); await activateClosingButton(a.cdp,sendDialog,share?'.btn-secondary':'.btn-primary');
  const incoming = await wait(async () => {
    const record=activity(b).records.find(r => !previous.has(r.id) && r.direction === 'incoming' && r.file?.name === path.basename(source) && r.file.savedPath && fs.existsSync(r.file.savedPath));
    if(record)return record;
    const text=await H.evalIn(a.overlay,'document.querySelector("#errand-card")?.innerText||""');
    return text.includes('发送失败')?{deliveryFailure:text}:null;
  }, 'real received HTML saved', 45000);
  assert(!incoming.deliveryFailure,incoming.deliveryFailure);
  assert.equal(hash(incoming.file.savedPath), hash(source)); assert(incoming.file.htmlWork?.id); report.incoming = incoming;
  check('real send controls deliver identical HTML bytes and persist the received work', { id: incoming.id, artifactHash: incoming.file.htmlWork.id });
  const receipt = await wait(async () => { for (const page of (await targets(b)).filter(t => t.url.includes('/dialog.html'))) if (await H.evalIn(page, '!!document.querySelector("[data-work-open]")').catch(() => false)) return page; return null; }, 'real work receipt');
  assert(!(await targets(b)).some(t => t.url.startsWith('pet-work:') && !t.url.includes('thumbnail=1')), 'receipt must not execute before opening');
  await screenshot(receipt, 'received-game-before-open');
  await activateClosingButton(b.cdp, receipt, '[data-work-open]');
}
function classifyDialog(init, text) {
  if (['pair', 'accept'].includes(init.peerSessionKind)) return init.peerSessionKind;
  if (text.includes('请求桌宠能力')) return 'sdk';
  if (/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i.test(text)) return 'pair';
  if (/加入.*(?:对局|游戏)|接受.*邀请|邀请.*联机|一起.*玩|联机邀请/.test(init.title || text)) return 'accept';
  return null;
}
async function approvals(a, b, expectPair = true) {
  const seen = new Set(), pairing = new Map(); let accepted = 0, sdk = 0, paired = false;
  await wait(async () => {
    for (const app of [a, b]) for (const page of (await targets(app)).filter(t => t.url.includes('/dialog.html') && !seen.has(t.id))) {
      const init = await H.evalIn(page, 'dialogAPI.getInit()', 3000).catch(() => null); if (!init) continue;
      const text = await H.evalIn(page, 'document.body.innerText'); if(!text.trim())continue; const kind = classifyDialog(init, text); if (!kind || kind==='pair'&&!/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i.test(text)) continue;
      seen.add(page.id); report.dialogs.push({ app: app.label, kind, title: init.title, text }); await screenshot(page, app.label + '-' + kind + '-' + seen.size);
      if (kind === 'pair') { assert(expectPair, 'trusted peers must not pair again'); pairing.set(app.label, { app, page, code: text.match(/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i)[0].replaceAll(' ', '').replaceAll('-', '').toLowerCase() }); }
      else { if (kind === 'sdk') {sdk++;report.sdkGrants.push(app.label);} else accepted++; await activateClosingButton(app.cdp, page, '.btn-primary'); }
    }
    if (pairing.size === 2 && !paired) { const [left, right] = [...pairing.values()]; assert.equal(left.code, right.code); assert.equal(left.code.length, 16); await activateClosingButton(left.app.cdp, left.page, '.btn-primary'); await activateClosingButton(right.app.cdp, right.page, '.btn-primary'); paired = true; check('both independently presented TLS pairing codes match before explicit confirmations'); }
    const pages = await Promise.all([a, b].map(async app => { const page = (await targets(app)).find(t => t.url.startsWith('pet-work:') && !t.url.includes('thumbnail=1')); if (!page) return null; if(app.game?.id!==page.id){app.game=page;await H.cdp(page,'Emulation.setFocusEmulationEnabled',{enabled:true});await H.cdp(page,'Page.captureScreenshot',{format:'png'});} const ready = await H.evalIn(page, 'window.__brawl?.state.view?.players?.length === 2 && !document.querySelector("#ready").disabled', 3000).catch(() => false); if (ready) { app.game = page; return page; } return null; }));
    return pages.every(Boolean);
  }, 'invitation, first pairing, SDK permission and current pets', 65000);
  assert(accepted >= 1, 'recipient must accept each game invitation'); assert(!expectPair || paired); if(expectPair)assert([a.label,b.label].every(label=>report.sdkGrants.includes(label)), 'both fresh hosts require explicit SDK consent, including initial share-only approval');
  for (const app of [a, b]) { await watch(app.game, app.label + '-game'); assert.equal(await H.evalIn(app.game, '!document.querySelector("#server-address,#room-code") && document.querySelector("#title-panel").hidden'), true); const context = await H.evalIn(app.game, 'pet.sessions.getContext()'); assert.equal(context.role, app === a ? 'host' : 'guest'); assert.equal(context.artifactHash, hash(source)); app.context = context; }
  assert.equal(a.context.invitationId, b.context.invitationId);
  check('real invite binds both current pets and exact artifact to sender referee and receiver guest');
}
async function installAppearances(app) {
  await H.evalIn(app.pet, 'petAPI.openSettings("plugins");true');
  app.settings = await H.findReadyTarget(app.cdp, '/settings.html', 'settings');
  for (const id of charIds) {
    const archive = path.join(PACKS, id + '.zip');
    await H.evalIn(app.settings, `window.goldInstall=null;settings.pluginsInstallZip(${JSON.stringify(archive)}).then(r=>window.goldInstall=r);true`);
    await wait(async () => {
      const result = await H.evalIn(app.settings, 'window.goldInstall');
      if (result) { assert(result.ok, JSON.stringify(result)); return true; }
      for (const page of (await targets(app)).filter(t => t.url.includes('/dialog.html'))) {
        if (await H.evalIn(page, '!!document.querySelector(".btn-primary")').catch(() => false)) await activateClosingButton(app.cdp, page, '.btn-primary');
      }
      return false;
    }, 'appearance ZIP install ' + id);
  }
  const installed = await H.evalIn(app.settings, 'settings.pluginsList()');
  assert.deepEqual(installed.map(p => p.id).sort(), charIds.slice().sort());
  assert(installed.every(p => p.version === JSON.parse(fs.readFileSync(path.join(PACKS, '../exports/plugins', p.id, 'manifest.json'))).version));
  check(app.label + ' installs both current appearance packages; game is not installed', installed.map(p => ({ id:p.id, version:p.version })));
}
async function applyMain(app, id) {
  await H.evalIn(app.settings, `settings.pluginsTogglePanel(${JSON.stringify(id)});true`);
  const page = await H.findReadyTarget(app.cdp, '/' + id + '/panel.html', 'pet');
  await wait(() => H.evalIn(page, 'document.querySelector("#actor").naturalWidth>0 && document.querySelector("#companion").textContent!=="—"'), 'appearance ready');
  if (await H.evalIn(app.pet, `currentCharKey!==${JSON.stringify(id)}`)) await activateButton(page, '#apply');
  await wait(() => H.evalIn(app.pet, `currentCharKey===${JSON.stringify(id)} && !!frames.idle?.[0]?.[0]?.naturalWidth`), 'main pet applied');
  assert(await H.evalIn(app.pet, H.CANVAS_PIXELS) > 100);
  await screenshot(app.pet, 'main-' + app.label + '-' + id);
  await activateClosingButton(app.cdp, page, '#close');
}
async function closeWork(app) {
  const controls = await H.findTarget(app.cdp, '/work-player.html');
  await activateClosingButton(app.cdp, controls, '[data-work-exit]');
}
// ---------------- brawl-specific ----------------
const VK={KeyA:65,KeyD:68,KeyS:83,KeyW:87,KeyJ:74,KeyK:75,KeyU:85,KeyL:76,Space:32};
async function k(page,code,type='keyDown'){await H.cdp(page,'Input.dispatchKeyEvent',{type,code,key:code==='Space'?' ':code.slice(3).toLowerCase(),windowsVirtualKeyCode:VK[code]});}
async function tap(page,code){await k(page,code);await H.sleep(40);await k(page,code,'keyUp');}
const fighters=async app=>(await state(app)).match?.fighters;
async function importDoll(app){
  // The optional swap: real file chooser inside the received HTML work.
  const file=path.join(PACKS,'rat-doll-female.zip');
  await H.evalIn(app.game,'document.querySelector("#swap").open=true;true');
  const ws=new WebSocket(app.game.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let n=0;const call=(method,params)=>new Promise((res,rej)=>{const id=++n;ws.addEventListener('message',function f(e){const m=JSON.parse(e.data);if(m.id===id){ws.removeEventListener('message',f);m.error?rej(Error(JSON.stringify(m.error))):res(m.result);}});ws.send(JSON.stringify({id,method,params}));});
  const {result}=await call('Runtime.evaluate',{expression:'document.querySelector("#import-file")'});await call('DOM.setFileInputFiles',{files:[file],objectId:result.objectId});ws.close();
}
async function brawlPlay(a,b){
  // Both hosts read their current desktop pet; newer hosts hand over the 3D rag doll.
  const kinds={};
  for(const [app,id] of [[a,'rat-doll-male'],[b,'rat-doll-female']]){
    const s=await wait(async()=>{const x=await state(app);return ['sprite','doll3d'].includes(x.driver?.kind)&&x.view?.players?.length===2?x:null;},'fighter + lobby '+app.label);
    assert.equal(s.view.you,app===a?0:1);kinds[app.label]=s.driver.kind;
    const packName=JSON.parse(fs.readFileSync(path.join(PACKS,'../exports/plugins',id,'character.json'))).name;
    assert.equal(s.driver.name,[...packName].slice(0,16).join(''),'fighter name comes from the current desktop pet');
    assert.equal(await H.evalIn(app.game,'document.querySelector("#pet-auto").hidden'),false);
  }
  for(const app of [a,b])await wait(async()=>{const f=(await world(app)).fighters;return f.length===2&&f.every(x=>['sprite','doll3d'].includes(x.kind));},'both pets drawn as fighters on '+app.label,30000);
  const names=[(await state(a)).driver.name,(await state(b)).driver.name];
  assert.deepEqual((await state(b)).view.players.map(p=>p.name),names);
  check('both hosts auto-import their current desktop pets (no manual import)',{names,kinds});
  await screenshot(a.game,'01-lobby-host');await screenshot(b.game,'02-lobby-guest');
  // Optional 3D swap on the guest travels to the host as one transfer.
  await importDoll(b);
  await wait(async()=>(await state(b)).driver.kind==='doll3d','guest imported 3D doll',60000);
  await wait(async()=>(await world(a)).fighters.find(f=>f.seat===1)?.kind==='doll3d','host renders guest as 3D doll',60000);
  check('guest 3D rag-doll pack crosses the LAN transfer and the host draws it in 3D');
  // Each player picks their own style in the lobby; any look can use any style.
  await activateButton(a.game,'#lobby-style [data-value="cat"]');await activateButton(b.game,'#lobby-style [data-value="ninja"]');
  for(const app of [a,b])await wait(async()=>{const p=(await state(app)).view.players;return p.find(x=>x.seat===0)?.style==='cat'&&p.find(x=>x.seat===1)?.style==='ninja';},'both see cat vs ninja on '+app.label,15000);
  check('each player picks a style in the lobby; both peers see cat (host) vs ninja (guest)');
  // Host-only time limit.
  assert.equal(await H.evalIn(b.game,'document.querySelector(\'#lobby-time [data-value="720"]\').disabled'),true);
  await activateButton(a.game,'#lobby-time [data-value="720"]');
  await wait(async()=>(await state(b)).view.settings?.timeLimit===720,'guest sees the host time limit');
  await activateButton(a.game,'#ready');await H.sleep(400);assert.equal((await state(b)).match,null);
  check('host-only time limit; one ready does not start the fight');
  // Host-only stage (SPEC §8, §11-23): the guest's chips are disabled and it sees the host's pick.
  assert.equal(await H.evalIn(b.game,'document.querySelector(\'#lobby-stage [data-value="town"]\').disabled'),true);
  await activateButton(a.game,'#lobby-stage [data-value="town"]');
  await wait(async()=>(await state(b)).view.settings?.stage==='town'&&await H.evalIn(b.game,'window.__brawl.world().stage==="town"'),'guest sees and previews the host stage');
  check('host-only stage: the host picks 猫薄荷小镇, the guest sees and previews the same map');
  if(!(await state(a)).view.players.find(p=>p.seat===0).ready)await activateButton(a.game,'#ready');
  await activateButton(b.game,'#ready');
  await wait(async()=>(await state(a)).match?.phase==='countdown'&&(await state(b)).match?.phase==='countdown','both count down');
  assert.equal((await state(a)).match.timeLimit,720*60);
  for(const app of [a,b])assert.equal((await state(app)).match.stage,'town','match on 猫薄荷小镇 for '+app.label);
  for(const app of [a,b])await H.evalIn(app.game,'document.activeElement?.blur();true');
  await wait(async()=>(await state(a)).match.phase==='fight','GO',8000);
  await screenshot(a.game,'03-fight-host');await screenshot(b.game,'04-fight-guest');
  const hm=await H.evalIn(a.game,'window.__brawl.state.view.players.map(p=>p.style)');
  assert.deepEqual(hm,['cat','ninja']);check('the fight runs with the chosen styles',hm);
  for(const app of [a,b])assert.equal(await H.evalIn(app.game,'window.__brawl.world().stage'),'town');
  check('both peers fight on 猫薄荷小镇 and draw it');
  // Real keyboards: each walks toward the other.
  const f0=await fighters(a);
  await k(a.game,'KeyD');await k(b.game,'KeyA');await H.sleep(900);await k(a.game,'KeyD','keyUp');await k(b.game,'KeyA','keyUp');
  const f1=await fighters(a);
  assert(f1[0].x>f0[0].x+10&&f1[1].x<f0[1].x-10,'both fighters walked by their own keyboards '+JSON.stringify([f0.map(f=>f.x),f1.map(f=>f.x)]));
  check('each real keyboard drives its own fighter; the host moves the guest from guest input',f1.map(f=>Math.round(f.x)));
  // Once both have stopped, the guest's prediction must converge on the host's result.
  // (Hidden test windows throttle timers, so the host catches up in bursts: compare
  // settled states, not one instant mid-walk.)
  const settled=await wait(async()=>{const h=await fighters(a),g=await fighters(b);
    if(!['idle'].includes(h[1].state)||!['idle'].includes(g[1].state))return null;
    const d=Math.abs(h[1].x-g[1].x);return d<3?{host:h[1].x,guest:g[1].x,d}:null;},'guest prediction converges on the host',5000);
  check('guest local prediction converges on the authoritative fighter',settled);
  // Five J taps on the guest reach the host (SPEC §11-19).
  const before=(await state(a)).match.stats[1].pressesSeen.attack;
  for(let i=0;i<5;i++){await tap(b.game,'KeyJ');await H.sleep(160);}
  await wait(async()=>(await state(a)).match.stats[1].pressesSeen.attack===before+5,'host saw five guest J presses',5000);
  check('five guest J presses all reach the host');
  // Trade some blows until someone takes damage.
  await wait(async()=>{
    const f=await fighters(a);if(!f)return false;
    const dx=f[1].x-f[0].x;
    if(Math.abs(dx)>18){await tap(a.game,dx>0?'KeyD':'KeyA');await tap(b.game,dx>0?'KeyA':'KeyD');}
    else{await tap(a.game,'KeyJ');await tap(b.game,'KeyJ');}
    return f[0].percent>0&&f[1].percent>0;
  },'both fighters take damage from real attacks',40000);
  check('both players land real attacks',(await fighters(a)).map(f=>Math.round(f.percent)));
  await screenshot(a.game,'05-trading-host');await screenshot(b.game,'06-trading-guest');
  // Main pet change mid-fight propagates to the peer.
  await applyMain(a,'rat-doll-female');
  await wait(async()=>(await state(b)).view.players[0].name!==names[0],'host pet change reaches guest',30000);
  check('host changes desktop pet mid-fight; the guest sees the new fighter without leaving',(await state(b)).view.players[0].name);
  // The guest walks off the left edge three times (hold S in the air to skip the ledge).
  for(let s=3;s>0;s--){
    await wait(async()=>{const f=(await fighters(a))[1];return f&&['idle','walk','run','air','landing','crouch'].includes(f.state);},'guest can act',10000);
    // Away from the host fighter: bodies push each other and cannot pass through.
    const fs2=await fighters(a),away=fs2[0].x>fs2[1].x?-1:1,dirKey=away>0?'KeyD':'KeyA';
    await k(b.game,dirKey);
    await wait(async()=>{const f=(await fighters(a))[1];return f.ground==null&&f.x*away>60;},'guest off the edge',15000);
    await k(b.game,'KeyS');
    await wait(async()=>['dead','out'].includes((await fighters(a))[1].state),'guest fell',15000);
    await k(b.game,dirKey,'keyUp');await k(b.game,'KeyS','keyUp');
    if(s>1){await wait(async()=>(await fighters(a))[1].state==='respawn','guest respawn',5000);await tap(b.game,'KeyS');
      await wait(async()=>(await fighters(a))[1].ground!=null,'guest landed',8000);}
  }
  for(const app of [a,b])await wait(async()=>(await state(app)).mode==='results','results '+app.label,15000);
  const ra=(await state(a)).match.result,rb=(await state(b)).match.result;
  assert.deepEqual(ra,rb);assert.equal(ra.winner,0);
  assert.match(await H.evalIn(a.game,'document.querySelector("#results-title").textContent'),/你赢了/);
  assert.match(await H.evalIn(b.game,'document.querySelector("#results-title").textContent'),/搭子获胜/);
  check('both peers show the same result: the host wins on stocks',ra);
  await screenshot(a.game,'07-results-host');await screenshot(b.game,'08-results-guest');
  await activateButton(a.game,'#again');await activateButton(b.game,'#again');
  await wait(async()=>(await state(b)).match?.phase==='countdown'&&(await state(b)).match.fighters.every(f=>f.stocks===3),'rematch');
  check('mutual rematch');
  await activateButton(b.game,'#leave');
  await wait(async()=>(await state(a)).connection==='closed','host sees guest leave',15000);
  await screenshot(a.game,'09-guest-left');check('guest leave gives the host an explicit ended state');
  await closeWork(a);
}
(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  try{
    H.requireNode22();assert(fs.existsSync(source),'build first');report.gameSha256=hash(source);
    runtime=F.freeze(H.REPO,root,false);report.source=runtime.source;
    const ap=await F.freePort(),bp=await F.freePort(),a=await boot('a',ap,bp),b=await boot('b',bp,ap);
    for(const app of [a,b])await installAppearances(app);
    await applyMain(a,'rat-doll-male');await applyMain(b,'rat-doll-female');
    await sendGame(a,b);await approvals(a,b);await brawlPlay(a,b);
  }catch(error){
    report.failures.push(error.message);report.error=error.stack;console.error(error);
    for(const app of apps){const list=await targets(app).catch(()=>[]);json(path.join(evidence,app.label+'-targets.json'),list.map(t=>({type:t.type,url:t.url,title:t.title})));
      for(const c of list.filter(t=>t.url.includes('/work-player.html')))json(path.join(evidence,app.label+'-work-player.json'),await H.evalIn(c,'({text:document.body.innerText,state:window.__state||null})',3000).catch(e=>({error:e.message})));
      json(path.join(evidence,app.label+'-work-inspect.json'),await (async()=>{const chat=list.find(t=>t.url.includes('/chat.html'));return chat?await H.evalIn(chat,'chatAPI.e2eInspectHtmlWork?.()',3000).catch(e=>({error:e.message})):'no chat';})());}
    for(const app of apps)for(const page of await targets(app).catch(()=>[]))if(page.type==='page'&&page.url.startsWith('pet-work:')){
      json(path.join(evidence,app.label+'-failure.json'),await H.evalIn(page,'({text:document.body.innerText.slice(0,3000),brawl:window.__brawl?.state,world:window.__brawl?.world(),transport:window.__brawl?.transport()})',3000).catch(e=>({error:e.message})));
      await screenshot(page,app.label+'-failure').catch(()=>{});
    }
  }finally{
    for(const ws of sockets)ws.close();
    for(const app of apps)await stop(app).catch(e=>report.failures.push('cleanup: '+e.message));
    if(report.exceptions.length)report.failures.push('uncaught renderer exceptions');
    report.ok=!report.failures.length;json(path.join(evidence,'report.json'),report);
    console.log('REPORT',path.join(evidence,'report.json'),report.ok?'OK':'FAIL');process.exitCode=report.ok?0:1;
  }
})().then(()=>process.exit(process.exitCode||0));
