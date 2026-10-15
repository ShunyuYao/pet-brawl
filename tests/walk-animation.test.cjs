'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const esbuild=require(process.env.PET_BRAWL_ESBUILD||path.resolve(__dirname,'../../../demo/node_modules/esbuild'));
function bundle(file){const out=esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../src',file)],bundle:true,format:'cjs',platform:'node',write:false});const m={exports:{}};new Function('module','exports',out.outputFiles[0].text)(m,m.exports);return m.exports;}
const A=bundle('walk-animation.js'),C=bundle('characters.js');
test('only ground locomotion uses native walk; timing preserves fps/loop',()=>{
 for(const s of ['walk','run'])assert.equal(A.walkState(s),true);
 for(const s of ['idle','air','attack','stun','dead','crouch'])assert.equal(A.walkState(s),false);
 const clip={frames:Array(20),fps:12,loop:true};assert.equal(A.animationFrame(clip,.25),3);assert.equal(A.animationFrame(clip,2),4);
 assert.equal(A.animationFrame({...clip,loop:false},2),19);
});
test('portable appearance accepts complete walk and rejects unsafe metadata',()=>{
 const image='data:image/webp;base64,AAAA';const a={kind:'sprite',frames:[image],fps:0,aspect:1,face:-1,walk:{frames:Array(20).fill(image),fps:12,loop:true,face:-1}};
 assert(C.checkAsset(a));assert(C.checkAsset({...a,walk:undefined}));
 for(const walk of [{...a.walk,fps:Infinity},{...a.walk,face:0},{...a.walk,frames:[]},{...a.walk,frames:Array(121).fill(image)},{...a.walk,frames:['https://example.org/x.png']}])assert.equal(C.checkAsset({...a,walk}),false);
});
test('missing walk keeps existing same-pet fallback; changed snapshot rejects before decoding',async()=>{
 assert.equal(await A.readWalkAsset({getAnimationCatalog:async()=>({states:[]})},()=>assert.fail()),null);
 const signature='a'.repeat(64),catalog={key:'pet',signature,states:['idle','walk'].map(id=>({id,variants:[{available:true,index:0,frameCount:2}]}))};
 await assert.rejects(()=>A.readWalkAsset({getAnimationCatalog:async()=>catalog,getAnimation:async({state})=>state==='idle'?{frames:[{dataUrl:'unused'}]}:{signature:'b',key:'pet'}},()=>assert.fail()),/CHANGED/);
});
