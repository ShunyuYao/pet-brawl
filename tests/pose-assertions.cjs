'use strict';
// Run the real presentation code against controller-generated states. A rule can
// be correct while its pose throws (the mage side-special regression).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../game/match.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-brawl-poses-'));
const esbuild=require(process.env.PET_BRAWL_ESBUILD||path.resolve(__dirname,'../../../demo/node_modules/esbuild'));
esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../src/poses.js')],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'poses.cjs'),logLevel:'silent'});
const {computePose}=require(path.join(dir,'poses.cjs'));
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
function finite(value,label){
  if(typeof value==='number')assert(Number.isFinite(value),label+' must be finite');
  else if(value&&typeof value==='object')for(const [key,v] of Object.entries(value))finite(v,label+'.'+key);
}
function assertPoses(m,{snapshot=false}={}){
  for(const f of m.fighters){
    const label=`${f.style} ${f.state} ${f.move?.id||''}/${f.move?.phase||''} frame ${m.frame}`;
    finite(f,label);
    const pose=computePose(f,{style:f.style,t:m.frame/60});finite(pose,label+' pose');
    if(snapshot){
      const s=M.snapshot(m);assert(M.validSnapshot(s),label+' snapshot accepted');
      const guest=M.restore(s);
      assert.deepEqual(computePose(guest.fighters[f.seat],{style:f.style,t:m.frame/60}),pose,label+' guest pose');
    }
  }
}
module.exports={computePose,finite,assertPoses};
