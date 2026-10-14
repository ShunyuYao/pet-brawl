'use strict';
// Rendering corrections never change the predicted collision world or its inputs.
// A snapshot may reconstruct the same frame at a different position: preserve
// the visible position, then retire that small error on the render clock.
const FRAME_MS=1000/60,SETTLE_MS=100,MAX_ERROR=12;
const DISCONTINUOUS=new Set(['dead','out','respawn','inhaled','grabbed']);
function create(){
 let simAt=null,errorAt=null,dx=0,dy=0,lastShown=null;
 function reset(at){dx=dy=0;lastShown=null;simAt=errorAt=at;}
 function error(at){const decay=Math.exp(-Math.max(0,at-(errorAt??at))/SETTLE_MS);dx*=decay;dy*=decay;errorAt=at;return {x:dx,y:dy};}
 function position(m,at){
  const f=m?.fighters[1];if(!f)return null;
  const alpha=m.paused||m.phase==='results'||f.hitlag||DISCONTINUOUS.has(f.state)?0:Math.max(0,Math.min(1,(at-(simAt??at))/FRAME_MS));
  return {x:f.x+(f.vx+(f.kbx||0))*alpha,y:f.y+(f.ground===null?f.vy+(f.kby||0):0)*alpha};
 }
 function reconcile(previous,current,at,{reset:reason=null,paused=false}={}){
  const before=previous?.fighters[1],after=current?.fighters[1];
  if(reason||paused||!before||!after||previous.stage!==current.stage||previous.phase!==current.phase||before.stocks!==after.stocks||DISCONTINUOUS.has(before.state)||DISCONTINUOUS.has(after.state)){reset(at);return;}
  const old=position(previous,at),next=position(current,at),e=error(at);
  dx=old.x+e.x-next.x;dy=old.y+e.y-next.y;
  if(Math.hypot(dx,dy)>MAX_ERROR)reset(at);
 }
 return {
  reconcile,
  advance(at){simAt=at;},
  sample(m,at,stopped=false){
   if(!m)return m;
   if(stopped||m.paused||m.phase==='results'){reset(at);return m;}
   const f=m.fighters[1],p=position(m,at),e=error(at);
   if(!f||!p||DISCONTINUOUS.has(f.state)){reset(at);return m;}
   let x=p.x+e.x;
   // Prediction deliberately yields occasional ticks while authority catches
   // up. Retiring an error while the projected walking position holds must not move
   // the picture backwards; continue retiring it on the next physics tick.
   if(lastShown&&(p.x-lastShown.rawX)*f.vx>=-.000001&&lastShown.state==='walk'&&f.state==='walk'&&f.ground!==null&&lastShown.ground===f.ground&&lastShown.vx*f.vx>0&&Math.abs(dx)>.0001){
    if((x-lastShown.x)*f.vx<0){x=lastShown.x;dx=x-p.x;}
   }
   lastShown={frame:m.frame,state:f.state,ground:f.ground,vx:f.vx,x,rawX:p.x};
   return {...m,fighters:m.fighters.map(k=>k.seat===1?{...k,x,y:p.y+e.y}:k)};
  },
 };
}
module.exports={create};
