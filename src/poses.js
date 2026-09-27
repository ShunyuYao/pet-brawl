// Presentation only: turns a fighter's simulation state into pose parameters that
// every avatar kind (3D doll, 2D sprite, toy) renders its own way. Never feeds back
// into the simulation — 2D and 3D fighters share one rule set (SPEC §2).
//
// hammer.angle: radians in the fighter's side plane, 0 = pointing forward,
// π/2 = straight up, π = backward, −π/2 = straight down.

import M from '../game/match.cjs';
import {REST as WEAPON_REST} from './weapons.js';

// Linear keyframe interpolation over [[frame, value], ...].
function kf(frame,keys){
  if(frame<=keys[0][0])return keys[0][1];
  for(let i=1;i<keys.length;i++){const [f1,v1]=keys[i],[f0,v0]=keys[i-1];if(frame<=f1)return v0+(v1-v0)*(frame-f0)/Math.max(1e-6,f1-f0);}
  return keys[keys.length-1][1];
}
const REST=1.9;
// Hammer angle keyframes per move (frames match game/styles/hammer.cjs).
const SWING={
  jab1:[[0,1.2],[6,0.9],[8,0],[12,0.1],[28,REST]],
  jab2:[[0,0.2],[7,0.7],[9,-0.1],[14,0.1],[26,REST]],
  jabF:[[0,1],[8,2.3],[10,-0.3],[16,-0.2],[40,REST]],
  ftilt:[[0,REST],[9,2.7],[11,-0.1],[15,-0.3],[40,REST]],
  utilt:[[0,-0.4],[6,-0.7],[7,0.6],[10,1.57],[13,2.3],[38,REST]],
  dtilt:[[0,1],[5,0.3],[6,-0.6],[9,-0.7],[34,REST]],
  dash:[[0,REST],[16,2.6],[20,0.1],[26,-0.2],[60,REST]],
  fsmash:[[0,REST],[20,2.9],[29,3.05],[30,0.5],[31,-0.5],[42,-0.6],[70,REST]],
  usmash:[[0,-0.3],[12,-0.9],[15,0.3],[17,1.57],[20,2.6],[60,REST]],
  dsmash:[[0,1.2],[11,0.2],[13,-0.5],[16,-2.6],[30,-2.7],[50,REST]],
  nair:[[0,0.2],[39,0.2]],
  fair:[[0,1.6],[10,2.7],[13,0.3],[15,-0.6],[41,1.5]],
  uair:[[0,0],[9,-0.4],[11,1],[14,2.4],[44,1.6]],
  dair:[[0,1.3],[16,1.9],[20,-1.57],[26,-1.57],[47,1.2]],
  grab:[[0,2.4],[36,2.4]],
  fthrow:[[0,2.3],[8,2.6],[10,0.4],[30,REST]],
  bthrow:[[0,2.3],[36,2.3]],
  nspecial:[[0,REST],[10,2.4],[60,2.4]],
  sideB:[[0,1.5],[18,-1.3],[24,0.7],[28,1.1],[54,REST]],
  upBLand:[[0,-1.2],[10,-1],[45,REST]],
  ledgeAttack:[[0,2],[20,2.4],[22,-0.2],[40,REST]],
  getupAttack:[[0,-0.4],[21,-0.3],[24,-2.8],[40,REST]],
};
// Generic swing arcs for the other styles: [windup, strike start, strike end]. The
// frames come from each style's own hitbox data, so faster styles swing faster.
const ARC={jab1:[0.6,0.1,0],jab2:[0.5,-0.1,0.1],jabF:[1.2,-0.2,-0.3],ftilt:[1.8,0.2,-0.3],utilt:[-0.5,0.8,2.2],dtilt:[0.4,-0.5,-0.7],
  dash:[2.0,0.2,-0.2],fsmash:[2.8,0.4,-0.6],usmash:[-0.8,0.6,2.6],dsmash:[0.3,-0.5,-2.6],nair:[0.2,0.2,0.2],fair:[2.4,0.3,-0.6],
  uair:[-0.3,1.2,2.4],dair:[1.8,-1.57,-1.57],ledgeAttack:[2,-0.2,-0.3],getupAttack:[-0.4,-0.3,-2.8],sideB:[1.2,0.1,-0.3],sideB2:[-0.6,0.9,1.3],sideB3:[1.6,-0.2,-0.5],sideB4:[2.4,0.3,-0.8],koPunch:[-0.9,0.8,1.57],upB:[0.5,1.4,1.57],fthrow:[2.3,0.4,0.3],bthrow:[2.3,2.3,2.3]};
function arcKeys(mv,arc,rest){
  const b=mv.hitboxes?.[0];if(!b)return [[0,rest]];
  const s=b.frames[0],e=Math.min(b.frames[1],s+8),total=Math.min(mv.total||60,s+40);
  return [[0,rest],[Math.max(1,Math.round(s*0.7)),arc[0]],[s,arc[1]],[e+2,arc[2]],[Math.max(e+3,total),rest]];
}
const SPIN={nair:[[0,0],[5,0],[13,Math.PI*2],[39,Math.PI*2]],getupAttack:[[0,0],[20,0],[25,Math.PI*2],[40,Math.PI*2]],bthrow:[[0,0],[6,0],[12,Math.PI],[36,Math.PI]],dsmash:[[0,0],[12,0],[17,Math.PI*0.35],[50,0]]};
const LEAN={dash:[[0,0.25],[20,0.45],[60,0]],fsmash:[[0,0],[28,-0.25],[31,0.35],[70,0]],ftilt:[[0,0],[10,-0.1],[12,0.25],[40,0]],fair:[[0,0],[12,-0.15],[14,0.25],[41,0]],sideB:[[0,0],[18,0.1],[24,-0.15],[54,0]],jabF:[[0,0],[9,-0.1],[11,0.2],[40,0]],fthrow:[[0,0],[10,0.35],[30,0]],nspecial:[[0,0],[12,-0.25],[60,-0.25]]};
const CROUCH={dtilt:[[0,0.3],[6,0.8],[34,0.2]],usmash:[[0,0.2],[12,0.6],[16,0],[60,0]],upBLand:[[0,1],[20,0.6],[45,0]],dsmash:[[0,0.3],[13,0.6],[50,0.2]]};

export function computePose(f,{t=0,style='hammer'}={}){
  const REST=WEAPON_REST[style]??1.9;
  const P={visible:true,alpha:1,flash:0,tint:0,lean:0,crouch:0,stretch:1,squash:1,spin:0,roll:0,lie:0,offY:0,
    hammer:{angle:REST,visible:true,scale:1},arms:'hammer',grabReach:0,run:0,runPhase:t*10,tuck:0,shake:0,
    fx:{charge:0,shield:0,dizzy:false,inhale:false,helpless:false,platform:false,armor:false,parry:false,trail:0,counter:false,box:false,slow:f.slow>0}};
  const s=f.state,mo=f.move;
  if(s==='dead'||s==='out'||(s==='inhaled'&&f.hiddenInMouth)){P.visible=false;return P;}
  if(f.invincible>0||s==='respawn')P.alpha=0.55+0.35*Math.abs(Math.sin(t*14));
  if(f.iw&&f.sf>=f.iw[0]&&f.sf<=f.iw[1])P.alpha=Math.min(P.alpha,0.55);
  if(f.intangible>0)P.alpha=Math.min(P.alpha,0.7);
  P.fx.platform=s==='respawn';
  switch(s){
    case 'idle':P.offY=Math.sin(t*3)*0.02;break;
    case 'walk':P.run=0.5;P.runPhase=t*9;P.lean=0.05;break;
    case 'run':P.run=1;P.runPhase=t*14;P.lean=0.22;P.hammer.angle=2.3;break;
    case 'crouch':P.crouch=0.7;P.hammer.angle=0.3;break;
    case 'jumpsquat':P.crouch=0.5;P.squash=1.1;P.stretch=0.88;break;
    case 'landing':P.crouch=Math.max(0,0.6-f.sf*0.06);break;
    case 'air':P.tuck=f.vy>0?0.6:0.2;P.stretch=f.vy>1.5?1.08:1;if(f.tumbling){P.roll=t*6;}break;
    case 'shield':case 'shielddrop':P.fx.shield=s==='shield'?Math.max(0.15,f.shieldHP/50):0;P.crouch=0.2;P.hammer.angle=0.2;if(f.shieldstun>0)P.shake=0.04;break;
    case 'spotdodge':P.crouch=0.4;P.lean=-0.25;break;
    case 'roll':P.roll=(f.sf/(f.act?.total||30))*Math.PI*2*(f.act?.dir===f.facing?1:-1);P.crouch=0.5;break;
    case 'airdodge':P.roll=Math.sin(f.sf*0.3)*0.3;P.tuck=0.5;break;
    case 'hitstun':
      if(f.tumble&&f.ground==null){P.roll=t*9;P.tuck=0.3;P.fx.trail=Math.min(1,Math.hypot(f.kbx,f.kby)/4);}
      else{P.lean=-0.3;P.shake=f.hitlag>0?0.08:0;}
      P.flash=f.hitlag>0?0.6:0;break;
    case 'down':P.lie=1;P.hammer.angle=0;break;
    case 'act':
      if(f.act?.kind==='getroll'||f.act?.kind==='ledgeroll'){P.roll=(f.sf/(f.act.total||30))*Math.PI*2;P.crouch=0.5;}
      else P.crouch=Math.max(0,0.5-f.sf*0.03);
      break;
    case 'ledge':P.arms='up';P.hammer.angle=-1.3;P.offY=0;P.tuck=0.3;break;
    case 'helpless':P.fx.helpless=true;P.tint=0.35;P.roll=Math.sin(t*4)*0.15;P.tuck=0.3;break;
    case 'shieldbreak':P.roll=t*5;P.fx.dizzy=true;break;
    case 'dizzy':P.fx.dizzy=true;P.lean=Math.sin(t*3)*0.2;P.hammer.angle=-0.8;break;
    case 'lag':P.lean=-0.1;break;
    case 'holding':P.arms='grab';P.grabReach=0.6;P.hammer.angle=2.4;break;
    case 'grabbed':P.shake=0.05;P.lean=-0.15;break;
    case 'move':poseMove(P,f,mo,t,style,REST);break;
  }
  if(f.hitlag>0&&s!=='hitstun')P.shake=Math.max(P.shake,0.03);
  // On the ground the hammer head may touch the floor but never sink into it.
  if(f.ground!=null&&!P.lie){const a=P.hammer.angle,floor=-0.32+0.1*(P.crouch||0);if(Math.sin(a)<floor){const c=Math.sqrt(1-floor*floor)*(Math.cos(a)>=0?1:-1);P.hammer.angle=Math.atan2(floor,c);}}
  return P;
}

function poseMove(P,f,mo,t,style,REST){
  const id=mo.id,fr=mo.frame,mv=M.STYLES[style]?.moves[id],type=mv?.type;
  if(style==='hammer'&&SWING[id])P.hammer.angle=kf(fr,SWING[id]);
  else if(ARC[id]&&mv)P.hammer.angle=kf(fr,arcKeys(mv,ARC[id],REST));
  else P.hammer.angle=REST;
  if(SPIN[id]&&style==='hammer')P.spin=kf(fr,SPIN[id]);
  else if(id==='nair'||id==='getupAttack'){const b=mv?.hitboxes?.[0];if(b)P.spin=kf(fr,[[0,0],[b.frames[0]-1,0],[b.frames[0]+6,Math.PI*2],[99,Math.PI*2]]);}
  if(LEAN[id])P.lean=kf(fr,LEAN[id]);
  if(CROUCH[id])P.crouch=kf(fr,CROUCH[id]);
  if(mv?.armor&&mv.kind!=='special'&&fr>=mv.armor.frames[0]&&fr<=mv.armor.frames[1])P.fx.armor=true;
  if(mo.charging){P.fx.charge=Math.min(1,mo.chargeFrames/60);P.shake=0.02+0.03*P.fx.charge;}
  if(style!=='hammer'&&mv?.kind==='special'){
    switch(type){
      case 'shot':{const c=mv.charge;P.hammer.angle=0.05;P.lean=-0.08;
        if(mo.phase==='charge'&&c){P.fx.charge=Math.min(1,mo.chargeFrames/c.max);P.shake=0.01+0.02*P.fx.charge;}
        if(style==='cat')P.hammer.angle=kf(fr,[[0,1.2],[mv.spawn.frame,0],[mv.total,REST]]);break;}
      case 'lunge':{const L=mv.lunge;P.lean=fr>=L.from&&fr<=L.to?0.5:kf(fr,[[0,-0.2],[L.from,0.5],[mv.total,0]]);P.hammer.angle=fr<L.from?1.4:0.1;P.fx.trail=fr>=L.from&&fr<=L.to?0.8:0;P.tuck=0.3;break;}
      case 'rise':{P.hammer.angle=1.57;P.stretch=fr>=mv.rise.from&&fr<=mv.rise.to?1.2:1;P.squash=P.stretch>1?0.88:1;P.fx.trail=fr>=mv.rise.from&&fr<=mv.rise.to?0.7:0;break;}
      case 'counter':{
        if(mo.phase!=='counterHit'){P.hammer.angle=1.3;P.crouch=0.25;P.lean=-0.12;P.fx.counter=fr>=mv.window[0]&&fr<=mv.window[1];}
        else{const d=mv.counter.delay;P.hammer.angle=kf(mo.pf,[[0,2.4],[d,2.6],[d+2,-0.4],[d+mv.counter.strikeTotal,REST]]);P.lean=kf(mo.pf,[[0,0],[d,0.3],[d+12,0]]);
          if(mv.counter.behind)P.fx.box=mo.pf<d-4;}
        break;}
      case 'tether':P.hammer.angle=0.9;P.fx.tether=fr>=mv.tether.frame&&fr<mv.tether.frame+12;break;
      case 'sneak':
        if(mo.phase==='ready'){P.crouch=0.45;P.hammer.angle=-0.3;P.lean=0.2;}
        else if(mo.phase==='vanish')P.visible=false;
        else P.hammer.angle=kf(mo.pf,[[0,2.4],[1,0.1],[4,-0.4],[20,REST]]);
        break;
      case 'chargeSwing':{const h=mv.hitboxes?.[0]?.frames?.[0]??4;
        if(mo.phase==='windup'){P.hammer.angle=kf(mo.pf,[[0,REST],[mv.windup,2.4]]);P.lean=-0.12;}
        else if(mo.phase==='charge'){P.hammer.angle=2.4+Math.sin(t*30)*0.04;P.fx.charge=mo.chargeFrames/mv.chargeMax;P.shake=0.01+0.04*P.fx.charge;P.crouch=0.25;P.lean=-0.2;}
        else{P.hammer.angle=kf(mo.pf,[[0,2.4],[h-1,2.5],[h,0.05],[h+3,-0.1],[mv.swingTotal,REST]]);P.lean=kf(mo.pf,[[0,-0.2],[h,0.45],[mv.swingTotal,0]]);P.fx.trail=mo.pf>=h&&mo.pf<=h+3?0.8:0;P.hammer.scale=1+0.3*(mo.charge||0);}
        P.fx.armor=!!mv.armor&&mo.phase==='swing'&&mo.pf<=mv.armor.frames[1]&&f.ground!=null;break;}
      case 'inhale':{const g=mv.inhale.frames;P.arms='grab';
        if(!mo.phase){P.grabReach=kf(fr,[[0,0],[g[0],1],[g[1]+2,1],[mv.total,0]]);P.lean=kf(fr,[[0,0],[g[0],0.3],[mv.total,0]]);P.hammer.angle=0.3;}
        else if(mo.phase==='hold'){P.grabReach=0.6;P.hammer.angle=2.4;P.lean=-0.1;}
        else{P.grabReach=0;P.spin=kf(mo.pf,[[0,0],[mv.spit.release,Math.PI*2]]);P.hammer.angle=kf(mo.pf,[[0,0.1],[mv.spit.release,0],[mv.spit.total,REST]]);}
        break;}
      case 'superjump':
        if(mo.phase==='squat'){P.crouch=0.9;P.squash=1.15;P.stretch=0.85;P.hammer.angle=-0.8;P.fx.armor=!!mv.armor&&fr>=mv.armor.frames[0];}
        else if(mo.phase==='rise'){P.stretch=1.2;P.squash=0.88;P.hammer.angle=1.57;P.fx.armor=!!mv.armor&&fr<=mv.armor.frames[1];P.fx.trail=0.6;}
        else if(mo.phase==='hang'){P.hammer.angle=2.2;P.tuck=0.7;}
        else{P.hammer.angle=-1.57;P.stretch=1.3;P.squash=0.8;P.fx.trail=1;}
        break;
      case 'launch':P.tuck=0.8;P.fx.box=true;if(fr>=mv.launch.frame)P.roll=(fr-mv.launch.frame)*0.5;break;
      case 'dive':P.hammer.angle=style==='cat'?-0.9:-1.57;P.lean=style==='cat'?0.55:0;P.stretch=fr>=mv.dive.from?1.15:1;P.tuck=fr<mv.dive.from?0.6:0;break;
    }
    if(id==='koPunch'){P.crouch=kf(fr,[[0,0.6],[8,0.7],[10,0],[40,0]]);P.stretch=kf(fr,[[0,0.9],[9,0.9],[11,1.25],[30,1]]);P.fx.armor=fr>=8&&fr<=9&&f.ground!=null;P.fx.trail=fr>=9&&fr<=14?1:0;P.fx.charge=fr<9?1:0;}
    if(/^sideB\d$/.test(id)||(id==='sideB'&&!type))P.lean=kf(fr,[[0,-0.05],[mv.hitboxes[0].frames[0],0.3],[mv.total,0]]);
    if(id==='downB'&&mv.spawn?.type==='trap'){P.crouch=0.6;P.hammer.angle=-1.2;}
    return;
  }
  switch(id){
    case 'grab':P.arms='grab';P.grabReach=kf(fr,[[0,0],[8,1],[12,1],[36,0]]);break;
    case 'fthrow':case 'bthrow':P.arms='grab';P.grabReach=0.6;break;
    case 'nspecial':
      P.fx.inhale=!mo.phase&&fr>=10&&fr<=42||mo.phase==='hold'||mo.phase==='holdProj';
      if(mo.phase==='hold'||mo.phase==='holdProj'){P.squash=1.25;P.stretch=0.9;P.shake=0.02;}
      if(mo.phase==='spit'||mo.phase==='spitProj'){P.squash=kf(mo.pf,[[0,1.25],[6,0.85],[24,1]]);P.lean=kf(mo.pf,[[0,-0.1],[6,0.3],[24,0]]);}
      break;
    case 'upB':
      if(mo.phase==='squat'){P.crouch=0.9;P.squash=1.15;P.stretch=0.85;P.hammer.angle=-0.8;P.fx.armor=fr>=8;}
      else if(mo.phase==='rise'){P.stretch=1.25;P.squash=0.85;P.hammer.angle=1.57;P.fx.armor=fr<=24;P.fx.trail=0.6;}
      else if(mo.phase==='hang'){P.spin=Math.sin(mo.pf)*0.2;P.hammer.angle=2.2;P.tuck=0.7;}
      else{P.hammer.angle=-1.57;P.stretch=1.3;P.squash=0.8;P.fx.trail=1;}
      break;
    case 'upBLand':P.squash=kf(fr,[[0,1.35],[8,1.05],[45,1]]);P.stretch=kf(fr,[[0,0.7],[8,0.95],[45,1]]);break;
    case 'downB':
      if(mo.phase==='windup')P.hammer.angle=kf(mo.pf,[[0,REST],[15,2.8]]);
      else if(mo.phase==='charge'){P.hammer.angle=2.8+Math.sin(t*30)*0.04;P.fx.charge=mo.chargeFrames/120;P.shake=0.01+0.04*P.fx.charge;P.crouch=0.3;}
      else{P.hammer.angle=kf(mo.pf,[[0,2.8],[9,2.95],[10,0.2],[12,-0.3],[44,REST]]);P.lean=kf(mo.pf,[[0,-0.2],[10,0.35],[44,0]]);P.fx.armor=mo.pf<=14&&f.ground!=null;P.hammer.scale=1+0.35*(mo.charge||0);}
      break;
    case 'dash':P.run=kf(fr,[[0,1],[20,0.3],[60,0]]);P.runPhase=t*14;break;
    case 'dair':P.stretch=kf(fr,[[0,1],[20,1.12],[30,1]]);break;
    case 'nair':P.tuck=0.7;break;
    case 'fair':case 'uair':P.tuck=0.4;break;
  }
}
