'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const source=process.env.BRAWL_BASELINE_HTML||path.resolve(__dirname,'../dist/桌宠大乱斗.html');
if(process.argv.includes('--artifact')){const r=spawnSync(process.execPath,[path.join(__dirname,'host-e2e.cjs')],{stdio:'inherit',env:{...process.env,BRAWL_HTML:source,BRAWL_FREEZE_ONLY:'1'}});process.exit(r.status??1);}
let html=fs.readFileSync(source,'utf8'),count=0;
html=html.replace(/([\w$]+)\.update\(\{match:([^}]+)\}\)/g,(all,w,fields)=>{if(!fields.includes('events:'))return all;count++;return `(globalThis.__brawlRenderProbe?.({match:${fields}}),${all})`;});
if(count!==1)throw Error('Expected one actual world render call, got '+count);
html=html.replace(/await ([\w$]+)\.poll\(/g,'(await globalThis.__brawlPollDelay?.(), await $1.poll(').replace(/waitMs:1e3\}\);/g,'waitMs:1e3}));');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brawl-motion-artifact-')),out=path.join(dir,'桌宠大乱斗.html');fs.writeFileSync(out,html);
const r=spawnSync(process.execPath,[path.join(__dirname,'host-e2e.cjs')],{stdio:'inherit',env:{...process.env,BRAWL_HTML:out,BRAWL_SMOOTHNESS:'1'}});process.exit(r.status??1);
