'use strict';
// Guest presentation is independent of the number of locally unacknowledged
// inputs. Never feed these interpolated positions back into the match simulation.
const FRAME_MS=1000/60,DISCONTINUOUS=new Set(['dead','out','respawn','inhaled']);
const St=require('./stage.cjs');
function create({delayMs=150,maxProjectionMs=100}={}){
 let frames=[],identity=null,offset=null,lastTime=-Infinity,lastReceived=-Infinity;
 function reset(){frames=[];offset=null;lastTime=-Infinity;lastReceived=-Infinity;}
 function push(view,receivedAt){
  const m=view?.match;if(!m){reset();identity=null;return;}
  const key=[view.matchNo,m.stage,m.phase,view.you,!!view.pause||!!m.paused].join(':');
  if(key!==identity){reset();identity=key;}
  const t=m.frame*FRAME_MS;
  if(frames.length&&t<=frames.at(-1).t)return;
  if(receivedAt-lastReceived>1000)reset();
  lastReceived=receivedAt;offset=Math.min(offset??Infinity,receivedAt-t);
  frames.push({t,match:m,paused:!!view.pause||!!m.paused,you:view.you});if(frames.length>32)frames.shift();
 }
 function sample(pred,now,stopped=false){
  if(!pred||!frames.length)return pred;
  const first=frames[0],last=frames.at(-1);let a=last,b=last,f=1;
  if(!stopped&&!last.paused&&['fight','sudden'].includes(last.match.phase)&&frames.length>1){
   const t=Math.max(lastTime,now-offset-delayMs);lastTime=t;
   if(t<=first.t){a=first;b=first;}else{
    a=frames.at(-2);b=last;
    for(let i=1;i<frames.length;i++)if(frames[i].t>=t){a=frames[i-1];b=frames[i];break;}
    f=(Math.min(t,b.t+maxProjectionMs)-a.t)/(b.t-a.t);
   }
  }
  function position(before,after,isFighter){
   let k={...after},blend=false;
   if(before&&a!==b){
    const discontinuous=isFighter&&(before.stocks!==after.stocks||DISCONTINUOUS.has(before.state)||DISCONTINUOUS.has(after.state));
    const travel=Math.hypot(after.x-before.x,after.y-before.y),speed=Math.hypot(after.vx||0,after.vy||0)+Math.hypot(after.kbx||0,after.kby||0);
    if(!discontinuous&&travel<=Math.max(8,speed*(b.t-a.t)/FRAME_MS*3)){blend=true;k.x=before.x+(after.x-before.x)*f;k.y=before.y+(after.y-before.y)*f;}
   }
   // The scene draws moving platforms at pred.frame. Interpolate a grounded
   // peer's position relative to that same platform so its feet stay attached.
   if(isFighter&&after.ground>0){
    const stage=St.get(pred.stage),sb=stage.surface(after.ground,b.match.frame),sn=stage.surface(after.ground,pred.frame);
    if(sb&&sn){const sa=blend&&before.ground===after.ground?stage.surface(after.ground,a.match.frame):null;
     const center=s=>(s.x0+s.x1)/2,oldX=sa?center(sa)+(center(sb)-center(sa))*f:center(sb),oldY=sa?sa.y+(sb.y-sa.y)*f:sb.y;
     if(blend&&!sa){k.x=after.x;k.y=after.y;}k.x+=center(sn)-oldX;k.y+=sn.y-oldY;}
   }
   return k;
  }
  const remote=new Map(b.match.fighters.filter(k=>k.seat!==last.you).map(k=>[k.seat,position(a.match.fighters.find(p=>p.seat===k.seat),k,true)]));
  const ownProjectiles=pred.projectiles.filter(p=>p.owner===last.you),ownIds=new Set(ownProjectiles.map(p=>p.id));
  return {...pred,fighters:pred.fighters.map(k=>remote.get(k.seat)||k),projectiles:[...ownProjectiles,...b.match.projectiles.filter(p=>p.owner!==last.you&&!ownIds.has(p.id)).map(p=>position(a.match.projectiles.find(q=>q.id===p.id&&q.owner===p.owner),p,false))]};
 }
 return {push,sample};
}
module.exports={create};
