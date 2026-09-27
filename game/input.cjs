'use strict';
// One player's controller state, as produced by the keyboard / gamepad layer and
// sent over the network. Held keys are booleans; every "press" is a monotonically
// increasing counter so presses survive a latest-value-only transport (SPEC §10).
const HELD=['jump','attack','special','smash','shield'];
const PRESSES=['jump','tap','attack','special','smash','shield','grab','left','right','up','down'];
function create(){
  const h={},c={};for(const k of HELD)h[k]=0;for(const k of PRESSES)c[k]=0;
  return {x:0,y:0,run:0,h,c,seq:0};
}
function press(pad,name){if(!PRESSES.includes(name))throw Error('unknown press '+name);pad.c[name]++;}
const clampDir=v=>v>0.5?1:v<-0.5?-1:0;
// Normalize an untrusted input against the previous one: clamp directions, keep
// counters monotonic (a replayed / forged lower counter never rewinds), cap bursts.
function normalize(raw,prev){
  const out=create();
  if(!raw||typeof raw!=='object')raw={};
  out.x=clampDir(Number(raw.x)||0);out.y=clampDir(Number(raw.y)||0);out.run=raw.run?1:0;
  for(const k of HELD)out.h[k]=raw.h&&raw.h[k]?1:0;
  for(const k of PRESSES){
    const v=Number(raw.c?.[k]),before=prev?prev.c[k]:0;
    out.c[k]=Number.isSafeInteger(v)&&v>before?Math.min(v,before+8):before;
  }
  out.seq=Number.isSafeInteger(raw.seq)&&raw.seq>=0?raw.seq:(prev?.seq||0);
  return out;
}
// New presses since the previous normalized input.
function diff(cur,prev){const d={};for(const k of PRESSES){const n=cur.c[k]-(prev?prev.c[k]:0);if(n>0)d[k]=n;}return d;}
function clone(p){return {x:p.x,y:p.y,run:p.run,h:{...p.h},c:{...p.c},seq:p.seq||0};}
module.exports={HELD,PRESSES,create,press,normalize,diff,clone};
