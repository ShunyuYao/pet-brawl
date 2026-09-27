'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{replay}=require('./helpers/motion-replay.cjs');
const Motion=require('../game/remote-motion.cjs'),M=require('../game/match.cjs');
for(const batched of [false,true])test('remote movement does not rewind with guest input acknowledgements; batched='+batched,async()=>{
 const {stats,errors}=await replay({batched});console.log(JSON.stringify({batched,...stats}));assert.deepEqual(errors,[]);
 assert(stats.reverseRatio<.01,'remote reversal '+JSON.stringify(stats));assert(stats.p95SpeedRatio<1.6,'remote speed spikes '+JSON.stringify(stats));assert(stats.holdRatio<.12,'remote held '+JSON.stringify(stats));
});
for(const batched of [false,true])test('real mage shots do not rewind with guest acknowledgements; batched='+batched,async()=>{
 const {stats,errors}=await replay({batched,projectiles:true});console.log(JSON.stringify({projectiles:true,batched,...stats}));assert.deepEqual(errors,[]);assert(stats.frames>50);
 assert(stats.reverseRatio<.01,JSON.stringify(stats));assert(stats.p95SpeedRatio<1.6,JSON.stringify(stats));
});
test('the complete walking trajectory includes turns with bounded presentation delay and error',async()=>{
 for(const batched of [false,true]){const {rows}=await replay({batched}),lag=batched?12:11;let sum=0,max=0,count=0;
  // These arrivals quantize 20ms transit to the next 60Hz frame; batching adds
  // one frame. Include every turn and acceleration, not only the steady samples.
  for(let i=30;i<rows.length;i++){const error=Math.abs(rows[i].x-rows[i-lag].truth);sum+=error*error;max=Math.max(max,error);count++;}
  assert(Math.sqrt(sum/count)<.3,'full trajectory RMS');assert(max<2,'turn error remains below two game units');
 }
});
function view(frame,{matchNo=1,paused=false,phase='fight',x=frame,stocks=3,state='walk'}={}){
 const match=M.create({countdown:false});Object.assign(match,{frame,paused,phase});Object.assign(match.fighters[0],{x,vx:1,stocks,state});
 return {matchNo,you:1,pause:paused?{reason:'peer_lost'}:null,match};
}
test('remote fighters and projectiles use host motion; own prediction and every source remain intact',()=>{
 const b=Motion.create(),a=view(0),v=view(3),pred=M.restore(v.match);
 a.match.projectiles=[{id:1,owner:0,x:0,y:10,vx:1,vy:0}];v.match.projectiles=[{id:1,owner:0,x:3,y:10,vx:1,vy:0}];
 pred.fighters[0].x=999;pred.fighters[1].x=111;pred.projectiles=[{id:1,owner:0,x:999,y:10},{id:2,owner:1,x:222,y:10}];
 const before=JSON.stringify([a,v,pred]);b.push(a,20);b.push(v,70);const shown=b.sample(pred,200);
 assert(Math.abs(shown.fighters[0].x-1.8)<1e-9);assert.equal(shown.fighters[1],pred.fighters[1]);
 assert(Math.abs(shown.projectiles.find(p=>p.id===1).x-1.8)<1e-9);assert.equal(shown.projectiles.find(p=>p.id===2),pred.projectiles[1]);
 assert.equal(JSON.stringify([a,v,pred]),before);
});
test('bounded projection, old and duplicate frame rejection, explicit pause and closed freeze',()=>{
 const b=Motion.create();b.push(view(0),20);b.push(view(3),70);const p=view(3).match;
 const stop=b.sample(p,1000).fighters[0].x;assert.equal(stop,9);b.push(view(3),1500);b.push(view(1),1600);assert.equal(b.sample(p,2000).fighters[0].x,stop);
 b.push(view(3,{paused:true}),2100);assert.equal(b.sample(p,3000).fighters[0].x,3);
 b.push(view(6),3100);b.push(view(9),3150);assert.equal(b.sample(p,5000,true).fighters[0].x,9);
});
test('new match, phase, absent match, stocks and teleport do not blend old fighters',()=>{
 const b=Motion.create();b.push(view(60),1020);b.push(view(63),1070);b.push(view(0,{matchNo:2,phase:'countdown',x:-35}),1100);
 assert.equal(b.sample(view(0).match,1300).fighters[0].x,-35);b.push(view(0,{matchNo:2,x:0}),1400);b.push(view(3,{matchNo:2,x:50}),1450);
 assert.equal(b.sample(view(3).match,1580).fighters[0].x,50);
 b.push(view(6,{matchNo:2,x:0,stocks:2,state:'respawn'}),1500);assert.equal(b.sample(view(6).match,1700).fighters[0].x,0);
 b.push({match:null},1800);const own=view(0).match;assert.equal(b.sample(own,2000),own);
});
test('host long suspend re-establishes presentation clock after bounded simulation catch-up',()=>{
 const b=Motion.create();for(let frame=0;frame<=60;frame+=3){b.push(view(frame),20+frame*1000/60);b.sample(view(frame).match,20+frame*1000/60);}
 b.sample(view(60).match,5000);let previous=null;const d=[];
 for(let i=0;i<150;i++){const t=6000+i*1000/60,frame=180+i;if(i%3===0)b.push(view(frame),t);const x=b.sample(view(frame).match,t).fighters[0].x;if(i>30)d.push(x-previous);previous=x;}
 assert(d.every(dx=>dx>.99&&dx<1.01));
});
test('remote standing on the town moving platform keeps its platform-relative position',()=>{
 const St=require('../game/stage.cjs'),m=M.create({countdown:false,stage:'town'});m.frame=160;
 const center=frame=>{const s=St.get('town').surface(1,frame);return(s.x0+s.x1)/2;};
 M.place(m,0,{x:center(m.frame),y:26});M.place(m,1,{x:65,y:0});const b=Motion.create();let checked=0;
 for(let i=0;i<120;i++){M.step(m);const wall=1000+i*1000/60;if(i%3===0)b.push({matchNo:1,you:1,match:M.snapshot(m)},wall);
  const pred=M.restore(m);for(let j=0;j<10;j++)M.step(pred);const shown=b.sample(pred,wall);
  if(i>20){assert.equal(shown.fighters[0].ground,1);assert(Math.abs(shown.fighters[0].x-center(pred.frame))<.01,'fighter must be attached to the drawn platform');checked++;}}
 assert(checked>50);
});
test('projectile ownership changes do not mix trajectories or duplicate predicted local projectiles',()=>{
 const b=Motion.create(),a=view(0),v=view(3);a.match.projectiles=[{id:4,owner:0,x:0,y:10,vx:1,vy:0}];v.match.projectiles=[{id:4,owner:1,x:50,y:10,vx:-1,vy:0}];
 const pred=M.restore(v.match);b.push(a,20);b.push(v,70);assert.deepEqual(b.sample(pred,200).projectiles,pred.projectiles);
 const next=view(6);next.match.projectiles=[];b.push(next,120);assert.equal(b.sample(next.match,400).projectiles.length,0);
 const fresh=view(0,{matchNo:2});fresh.match.projectiles=[{id:4,owner:0,x:-55,y:8,vx:1,vy:0}];b.push(fresh,500);assert.equal(b.sample(fresh.match,600).projectiles[0].x,-55);
});
