'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),protocol=require('../game/net.cjs').PROTOCOL;
test('built internet and LAN files declare the real protocol and pinned pet-kit, with exact receipts',()=>{
 assert.deepEqual(protocol,{id:'pet-brawl',version:3});
 for(const lane of ['auto','lan']){
  const info=JSON.parse(fs.readFileSync(path.join(root,'dist',lane==='auto'?'build.json':'build-lan.json')));
  const html=fs.readFileSync(path.join(root,info.file));
  const sdk=JSON.parse(html.toString().match(/<script type="application\/json" id="pet-sdk">([^<]+)<\/script>/)[1]);
  assert.equal(sdk.version,2);assert.equal(sdk.interaction.transport,lane);assert.equal(sdk.interaction.players,2);
  assert.deepEqual(sdk.interaction.protocol,protocol);assert.deepEqual(info.protocol,protocol);assert.equal(info.transport,lane);
  assert.equal(info.petKit,'0.2.1');assert.equal(info.petKit,require('../vendor/pet-kit/verify.cjs').check(root));
  assert.equal(info.bytes,html.length);assert.equal(info.sha256,crypto.createHash('sha256').update(html).digest('hex'));
  assert(!/__STYLE__|__SCRIPT__/.test(html.toString()));
 }
});
test('motion probe handles nested observation callbacks and the real bundled SDK poll',()=>{
 const html=fs.readFileSync(path.join(root,'dist/桌宠大乱斗.html'),'utf8');
 const old=html.replace(/([\w$]+)\.update\(\{match:([^}]+)\}\)/g,(all,w,fields)=>fields.includes('events:')?`(globalThis.__brawlRenderProbe?.({match:${fields}}),${all})`:all);
 const script=x=>x.match(/<script>([\s\S]*?)<\/script>/)[1];
 const {Script}=require('node:vm');assert.throws(()=>new Script(script(old)),SyntaxError,'old first-brace probe reproduces the invalid executable');
 const patched=require('./motion-artifact.cjs').instrument(html);
 assert.equal((patched.match(/globalThis\.__brawlRenderProbe\?\./g)||[]).length,1);
 assert.equal((patched.match(/await globalThis\.__brawlPollDelay\?\./g)||[]).length,1);
 assert.doesNotThrow(()=>new Script(script(patched)));
});
