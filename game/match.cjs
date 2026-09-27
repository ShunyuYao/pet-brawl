'use strict';
// Authoritative fight simulation (SPEC §5–§9). Pure and deterministic: the whole
// state is plain JSON (snapshot / restore for the network), one call = one frame
// at 60 fps, and players only influence it through normalized input objects.
const F=require('./formulas.cjs'),St=require('./stage.cjs'),I=require('./input.cjs');
const STYLES={hammer:require('./styles/hammer.cjs'),cat:require('./styles/cat.cjs'),mage:require('./styles/mage.cjs'),ninja:require('./styles/ninja.cjs'),
  sword:require('./styles/sword.cjs'),grappler:require('./styles/grappler.cjs'),boxer:require('./styles/boxer.cjs'),swift:require('./styles/swift.cjs')};

// ---------- derived physics per style ----------
function airtimeFor(v,g,fall){let y=0,vy=v,n=0;do{vy=Math.max(-fall,vy-g);y+=vy;n++;}while(y>0&&n<400);return n;}
function solveJump(frames,g,fall){let lo=0.1,hi=10;for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(airtimeFor(mid,g,fall)<frames)lo=mid;else hi=mid;}return hi;}
const DERIVED={};
for(const [id,s] of Object.entries(STYLES)){const a=s.attrs;DERIVED[id]={fullHop:solveJump(a.fullHopAirtime,a.gravity,a.fall),shortHop:solveJump(a.shortHopAirtime,a.gravity,a.fall)};}
const styleOf=f=>STYLES[f.style];
const A=f=>STYLES[f.style].attrs;
const MV=(f,id)=>STYLES[f.style].moves[id];
// Type of the special currently running ('superjump', 'counter', ...), or null.
const moveType=f=>f.state==='move'&&f.move?MV(f,f.move.id)?.type||null:null;

const COUNTDOWN=180,GAME_FREEZE=90,RESPAWN_DELAY=60,PLATFORM_FRAMES=300,SUDDEN_LIMIT=60*60;
const HOLD_STATES=new Set(['grabbed','inhaled']);
// Stage of this match (SPEC §8); surfaces are read at the current frame (moving platforms).
const ST=m=>St.get(m.stage),SURF=(m,id)=>ST(m).surface(id,m.frame);

// ---------- creation ----------
function newFighter(seat,style,stocks,stage){
  const sp=St.get(stage).SPAWNS[seat];
  return {seat,style,x:sp.x,y:0,vx:0,vy:0,kbx:0,kby:0,facing:sp.facing,ground:0,percent:0,stocks,
    state:'idle',sf:0,move:null,act:null,hitlag:0,hitstun:0,tumble:false,tumbling:false,homog:false,
    jumpsLeft:STYLES[style].attrs.airJumps,airdodgeUsed:false,upBUsed:false,fastFalling:false,shortHop:false,airtime:0,
    ledge:null,ledgeGrabs:0,ledgeIntangible:0,ledgeCooldown:0,intangible:0,invincible:0,iw:null,
    shieldHP:F.SHIELD.max,shieldstun:0,dodgeStale:0,dodgeIdle:0,stale:[],buffer:[],
    holding:null,grabbedBy:null,grabTimer:0,jsq:null,pendingAirJump:0,lag:0,landingLag:0,helplessLanding:20,
    dizzy:0,respawnTimer:0,platformTimer:0,through:0,dashFrames:0,wasRunning:false,slow:0,tethers:0,meter:0,revengeMult:1,revengeLeft:0,revengeTimer:0,hiddenInMouth:false,in:I.create()};
}
function create({stocks=3,timeLimit=480,countdown=true,styles=['hammer','hammer'],stage=St.DEFAULT}={}){
  for(const s of styles)if(!STYLES[s])throw Error('unknown_style');
  if(!St.STAGES[stage])throw Error('unknown_stage');
  const lim=Math.max(1,Math.min(3600,Math.round(timeLimit)))*60;
  return {v:1,stage,frame:0,phase:countdown?'countdown':'fight',phaseFrame:0,timeLimit:lim,timeLeft:lim,stocks,
    fighters:[newFighter(0,styles[0],stocks,stage),newFighter(1,styles[1],stocks,stage)],
    projectiles:[],nextId:1,events:[],eventSeq:0,inputs:[I.create(),I.create()],applied:[I.create(),I.create()],
    lastHits:[null,null],stats:[newStats(),newStats()],result:null,sudden:false,paused:false};
}
function newStats(){return {attacksStarted:0,pressesSeen:Object.fromEntries(I.PRESSES.map(k=>[k,0])),damageDealt:0,kos:0,falls:0,sds:0};}

// ---------- events ----------
function emit(m,type,data={}){m.events.push({seq:++m.eventSeq,frame:m.frame,type,...data});if(m.events.length>64)m.events.shift();}

// ---------- input & buffer ----------
function setInput(m,seat,raw){m.inputs[seat]=I.normalize(raw,m.inputs[seat]);}
// Take the latest input as the new baseline without turning its counters into presses.
function resetInputBaseline(m,seat){m.applied[seat]=I.clone(m.inputs[seat]);}
function pullInput(m,f){
  const cur=m.inputs[f.seat],d=I.diff(cur,m.applied[f.seat]);
  m.applied[f.seat]=I.clone(cur);f.in=I.clone(cur);
  for(const [k,n] of Object.entries(d)){m.stats[f.seat].pressesSeen[k]+=n;for(let i=0;i<n;i++)f.buffer.push({k,age:0});}
  if(f.buffer.length>24)f.buffer.splice(0,f.buffer.length-24);
}
function take(f,k){const i=f.buffer.findIndex(b=>b.k===k);if(i<0)return false;f.buffer.splice(i,1);return true;}
const has=(f,k)=>f.buffer.some(b=>b.k===k);
function takeAny(f){const n=f.buffer.length;f.buffer.length=0;return n;}
function ageBuffer(f){for(const b of f.buffer)b.age++;f.buffer=f.buffer.filter(b=>b.age<F.BUFFER);}

// ---------- geometry ----------
function bodyHeight(f){const h=A(f).height;return f.state==='crouch'||(f.state==='move'&&MV(f,f.move.id)?.crouch)?h*0.7:f.state==='down'?h*0.4:h;}
function hurtbox(f){const r=A(f).radius,h=bodyHeight(f);return {x:f.x,y0:f.y+Math.min(r,h/2),y1:f.y+Math.max(h-r,h/2),r,top:f.y+h};}
function circleHits(c,f){const hb=hurtbox(f),cy=Math.max(hb.y0,Math.min(hb.y1,c.y));const d=Math.hypot(c.x-hb.x,c.y-cy);return d<=c.r+hb.r?{contactY:cy}:null;}
function worldBox(f,b){return {x:f.x+b.x*f.facing,y:f.y+b.y,r:b.r};}

// ---------- intangibility ----------
function isIntangible(m,seat){const f=m.fighters[seat];return intangibleAt(f,null);}
function intangibleAt(f,contactY){
  if(['dead','out','respawn','inhaled'].includes(f.state))return true;
  if(f.invincible>0||f.intangible>0)return true;
  if(f.iw&&f.sf>=f.iw[0]&&f.sf<=f.iw[1])return true;
  if(f.state==='move'&&f.move){const iv=MV(f,f.move.id)?.intangible;if(iv&&f.move.frame>=iv[0]&&f.move.frame<=iv[1])return true;}
  if(contactY!=null&&f.state==='move'){const mv=MV(f,f.move.id);if(mv?.headIntangible&&f.move.frame>=mv.headIntangible[0]&&f.move.frame<=mv.headIntangible[1]&&contactY>f.y+A(f).height*0.62)return true;}
  return false;
}

// ---------- state helpers ----------
function setState(f,s){f.state=s;f.sf=0;f.iw=null;if(s!=='move')f.move=null;}
function toIdleOrAir(f){setState(f,f.ground!=null?'idle':'air');}
function landReset(f){f.tethers=0;f.jumpsLeft=A(f).airJumps;f.airdodgeUsed=false;f.upBUsed=false;f.fastFalling=false;f.shortHop=false;f.airtime=0;f.ledgeGrabs=0;f.tumbling=false;f.pendingAirJump=0;}
function startMove(m,f,id,extra={}){
  const mv=MV(f,id);if(!mv)throw Error('no move '+id);
  f.state='move';f.sf=0;f.iw=null;
  f.move={id,frame:0,phase:null,pf:0,hit:[false,false],charging:false,chargeFrames:0,chargeMult:1,shortHop:f.ground==null&&f.shortHop,charge:0,...extra};
  if(f.ground==null)f.tumbling=false;
  m.stats[f.seat].attacksStarted++;
}
function dirOf(f){return {x:f.in.x,y:f.in.y};}

// ---------- action selection ----------
const START_PHASE={superjump:'squat',chargeSwing:'windup',sneak:'ready'};
function startSpecialMove(m,f,id){
  const mv=MV(f,id);let phase=START_PHASE[mv.type]||null;
  if(mv.type==='shot'&&mv.charge)phase=f.ground!=null||mv.charge.airCharge?'windup':'airfire';
  startMove(m,f,id,{phase});
  if(id==='upB'&&f.ground==null&&!['superjump','tether'].includes(mv.type))f.upBUsed=true;
}
function startSpecial(m,f){
  const {x,y}=dirOf(f);
  if(y>0){if(f.ground==null&&f.upBUsed&&MV(f,'upB').type!=='tether')return false;startSpecialMove(m,f,'upB');return true;}
  if(y<0){startSpecialMove(m,f,'downB');return true;}
  if(x!==0){f.facing=x;startSpecialMove(m,f,'sideB');return true;}
  if(A(f).meter&&f.meter>=100&&MV(f,'koPunch')){f.meter=0;startMove(m,f,'koPunch');emit(m,'kopunch',{seat:f.seat});return true;}
  startSpecialMove(m,f,'nspecial');return true;
}
function aerialFor(f,{smash=false}={}){
  const {x,y}=dirOf(f);
  if(y>0)return 'uair';if(y<0)return 'dair';
  if(x!==0){if(x!==f.facing)f.facing=x;return 'fair';}
  return smash?'fair':'nair';
}
function groundActions(m,f){
  const {x,y}=dirOf(f);
  if(take(f,'special')){startSpecial(m,f);return;}
  if(take(f,'smash')){
    if(y>0)startMove(m,f,'usmash');else if(y<0)startMove(m,f,'dsmash');else{if(x!==0)f.facing=x;startMove(m,f,'fsmash');}
    return;
  }
  if(take(f,'grab')||(f.in.h.shield&&has(f,'attack')&&take(f,'attack'))){startMove(m,f,'grab');return;}
  if(take(f,'attack')){
    if(f.state==='run'&&x!==0)startMove(m,f,'dash');
    else if(y>0)startMove(m,f,'utilt');
    else if(y<0)startMove(m,f,'dtilt');
    else if(x!==0){f.facing=x;startMove(m,f,'ftilt');}
    else startMove(m,f,'jab1');
    return;
  }
  if(take(f,'tap')){setState(f,'jumpsquat');f.jsq='tap';return;}
  if(take(f,'jump')){setState(f,'jumpsquat');f.jsq='space';return;}
  if(f.in.h.shield){setState(f,'shield');return;}
  if(f.ground>0&&take(f,'down')){f.ground=null;f.through=12;f.y-=0.5;setState(f,'air');return;}
  // movement
  if(y<0){if(f.state!=='crouch')setState(f,'crouch');return;}
  if(x!==0){
    const running=f.in.run||f.state==='run';
    if(running){if(f.state!=='run'){setState(f,'run');f.dashFrames=A(f).dashFrames;}}
    else if(f.state!=='walk')setState(f,'walk');
    f.facing=x;return;
  }
  if(f.state!=='idle')setState(f,'idle');
}
function airActions(m,f){
  const {x,y}=dirOf(f);
  if(f.pendingAirJump>0){
    if(take(f,'special')){f.pendingAirJump=0;startSpecial(m,f);return;}
    if(take(f,'attack')||take(f,'smash')){f.pendingAirJump=0;startMove(m,f,y<0?'dair':'uair');return;}
    if(--f.pendingAirJump===0)airJump(m,f);
    return;
  }
  if(take(f,'special')){if(startSpecial(m,f))return;}
  if(take(f,'smash')){startMove(m,f,aerialFor(f,{smash:true}));return;}
  if(take(f,'attack')){startMove(m,f,aerialFor(f));return;}
  if(take(f,'shield')){if(!f.airdodgeUsed){startAirDodge(m,f);return;}}
  if(take(f,'tap')){if(f.jumpsLeft>0){f.pendingAirJump=F.JUMPSQUAT;return;}}
  if(take(f,'jump')){if(f.jumpsLeft>0){airJump(m,f);return;}}
  if(take(f,'down')&&f.vy<=0.5&&!f.fastFalling){f.fastFalling=true;f.vy=-A(f).fastFall;}
}
function airJump(m,f){
  if(f.jumpsLeft<=0)return;f.jumpsLeft--;f.shortHop=false;f.tumbling=false;
  f.vy=DERIVED[f.style].fullHop*A(f).airJumpMult;f.vx=f.in.x*A(f).airSpeed;f.fastFalling=false;emit(m,'jump',{seat:f.seat,air:true});
}
function startAirDodge(m,f){
  const {x,y}=dirOf(f),a=A(f).airDodge,L=f.dodgeStale;
  setState(f,'airdodge');f.airdodgeUsed=true;f.tumbling=false;bumpDodge(f);
  if(x===0&&y===0){f.act={kind:'neutral',total:a.neutral.total+3*L,landing:a.neutral.landing};f.iw=[a.neutral.intangible[0],a.neutral.intangible[1]-L];}
  else{
    const n=Math.hypot(x,y),dx=x/n,dy=y/n;
    const key=dy<-0.9?'down':dy<-0.3?'diagDown':dy<0.3?'side':dy<0.9?'diagUp':'up';
    f.act={kind:'dir',dx,dy,total:a.directional.totals[key]+3*L,landing:a.directional.landing};
    f.iw=[a.directional.intangible[0],a.directional.intangible[1]-L];
    f.vx=dx*a.directional.speed;f.vy=dy*a.directional.speed;
  }
  emit(m,'dodge',{seat:f.seat,air:true});
}
function bumpDodge(f){f.dodgeStale=Math.min(5,f.dodgeStale+1);f.dodgeIdle=0;}
function startGroundDodge(m,f,kind,dir=0){
  const a=A(f),L=f.dodgeStale;
  if(kind==='spot'){setState(f,'spotdodge');f.act={total:a.spotDodge.total+3*L};f.iw=[a.spotDodge.intangible[0],a.spotDodge.intangible[1]-L];}
  else{const fwd=dir===f.facing,d=fwd?a.roll.forward:a.roll.back;setState(f,'roll');
    f.act={dir,total:d.total+3*L,from:d.intangible[0],to:d.intangible[1],dist:a.roll.distance,turn:fwd};f.iw=[d.intangible[0],d.intangible[1]-L];}
  bumpDodge(f);emit(m,'dodge',{seat:f.seat});
}

// ---------- per-state logic ----------
function stepState(m,f,canAct){
  const a=A(f);
  switch(f.state){
    case 'idle':case 'walk':case 'run':case 'crouch':
      if(canAct)groundActions(m,f);else if(f.state!=='idle')setState(f,'idle');
      break;
    case 'jumpsquat':
      if(f.jsq==='tap'){
        if(take(f,'attack')){startMove(m,f,'utilt');break;}
        if(take(f,'smash')){startMove(m,f,'usmash');break;}
        if(take(f,'special')){startSpecialMove(m,f,'upB');break;}
      }else if(f.in.y>0&&take(f,'special')){startSpecialMove(m,f,'upB');break;}
      if(f.sf>=F.JUMPSQUAT){
        const full=f.jsq==='tap'?f.in.y>0:!!f.in.h.jump;
        f.ground=null;f.vy=full?DERIVED[f.style].fullHop:DERIVED[f.style].shortHop;f.shortHop=!full;
        f.vx=Math.max(-a.run,Math.min(a.run,f.vx));setState(f,'air');emit(m,'jump',{seat:f.seat,short:!full});
      }
      break;
    case 'air':
      if(canAct)airActions(m,f);
      break;
    case 'landing':
      if(f.sf>=f.landingLag)setState(f,'idle');
      break;
    case 'move':stepMove(m,f);break;
    case 'shield':{
      f.shieldHP-=F.SHIELD.decay;
      if(f.shieldHP<=0){shieldBreak(m,f);break;}
      if(f.shieldstun>0){f.shieldstun--;break;}
      if(!f.in.h.shield){setState(f,'shielddrop');break;}
      if(take(f,'tap')){setState(f,'jumpsquat');f.jsq='tap';break;}
      if(take(f,'jump')){setState(f,'jumpsquat');f.jsq='space';break;}
      if(f.in.y>0&&take(f,'special')){startSpecialMove(m,f,'upB');break;}
      if(f.in.y>0&&take(f,'smash')){startMove(m,f,'usmash');break;}
      if(take(f,'grab')||take(f,'attack')){startMove(m,f,'grab');break;}
      if(take(f,'left')){startGroundDodge(m,f,'roll',-1);break;}
      if(take(f,'right')){startGroundDodge(m,f,'roll',1);break;}
      if(take(f,'down')){startGroundDodge(m,f,'spot');break;}
      break;
    }
    case 'shielddrop':
      if(f.sf>=F.SHIELD.drop)setState(f,'idle');
      break;
    case 'spotdodge':
      if(f.sf>=f.act.total)setState(f,'idle');
      break;
    case 'roll':{
      const r=f.act;
      f.vx=f.sf>=r.from&&f.sf<=r.to?r.dir*r.dist/(r.to-r.from+1):0;
      if(f.sf>=r.total){if(r.turn)f.facing=-r.dir;setState(f,'idle');}
      break;
    }
    case 'airdodge':{
      const r=f.act;
      if(r.kind==='dir'&&f.sf<=20){f.vx*=0.9;f.vy*=0.9;}
      if(f.sf>=r.total)setState(f,'air');
      break;
    }
    case 'hitstun':{
      if(f.hitstun>0)f.hitstun--;
      const speed=Math.hypot(f.kbx,f.kby);
      if(f.ground==null&&canAct){
        if(f.sf>=F.HITSTUN_AIRDODGE[0]&&speed<F.HITSTUN_AIRDODGE[1]&&!f.airdodgeUsed&&take(f,'shield')){startAirDodge(m,f);break;}
        if(f.sf>=F.HITSTUN_AERIAL[0]&&speed<F.HITSTUN_AERIAL[1]&&take(f,'attack')){startMove(m,f,aerialFor(f));break;}
      }
      if(f.hitstun<=0){f.homog=false;if(f.ground!=null)setState(f,'idle');else{f.tumbling=f.tumble;setState(f,'air');}}
      break;
    }
    case 'down':
      if(canAct&&f.sf>=20){
        if(take(f,'attack')||take(f,'smash')){startMove(m,f,'getupAttack');f.iw=[...a.floorGetup.attack.intangible];break;}
        if(take(f,'left')||take(f,'right')){const dir=f.in.x||f.facing;startAct(f,'getroll',{...a.floorGetup.roll,dir});break;}
        if(take(f,'jump')||take(f,'tap')||take(f,'up')){startAct(f,'getup',a.floorGetup.getup);break;}
      }
      if(f.sf>=60)startAct(f,'getup',a.floorGetup.getup);
      break;
    case 'act':stepAct(m,f);break;
    case 'ledge':stepLedge(m,f,canAct);break;
    case 'helpless':break;
    case 'shieldbreak':break;
    case 'dizzy':
      f.dizzy-=1+4*takeAny(f);
      if(f.dizzy<=0)setState(f,'idle');
      break;
    case 'lag':
      if(f.sf>=f.lag)toIdleOrAir(f);
      break;
    case 'holding':stepHolding(m,f);break;
    case 'grabbed':{
      f.grabTimer-=1+3*takeAny(f);
      if(f.grabTimer<=0)grabRelease(m,m.fighters[f.grabbedBy],f);
      break;
    }
    case 'inhaled':takeAny(f);break;
    case 'respawn':{
      f.platformTimer--;
      const moved=f.in.x!==0||f.in.y<0||f.buffer.length>0;
      if(moved||f.platformTimer<=0){f.buffer.length=0;f.ground=null;setState(f,'air');f.invincible=F.RESPAWN_INVINCIBLE+1;}
      break;
    }
  }
}
function startAct(f,kind,data){setState(f,'act');f.act={kind,...data,fromX:f.x,fromY:f.y};f.iw=data.intangible?[...data.intangible]:null;}
function stepAct(m,f){
  const r=f.act;
  if(r.kind==='getroll'){f.vx=f.sf<=r.intangible[1]?r.dir*r.distance/r.intangible[1]:0;}
  if(r.kind==='ledgeget'||r.kind==='ledgeroll'){
    const t=Math.min(1,f.sf/Math.min(r.total,r.kind==='ledgeroll'?r.total:20));
    f.x=r.fromX+(r.toX-r.fromX)*t;f.y=r.fromY+(r.toY-r.fromY)*Math.min(1,f.sf/12);
    if(f.sf>=12){f.y=r.toY;f.ground=0;}
  }
  if(f.sf>=r.total){if(r.kind==='ledgeget'||r.kind==='ledgeroll'){f.x=r.toX;f.y=r.toY;f.ground=0;}setState(f,'idle');}
}

// ---------- moves ----------
function stepMove(m,f){
  const mv=MV(f,f.move.id),mo=f.move;
  const handler=TYPE_STEP[mv.type];if(handler)return handler(m,f,mv);
  if(mv.kind==='throw')return stepThrow(m,f,mv);
  if(mv.kind==='ledge')return stepLedgeAttack(m,f,mv);
  if(mo.charging){
    if(f.in.h.smash&&mo.chargeFrames<F.SMASH_CHARGE.frames){mo.chargeFrames++;mo.chargeMult=F.smashChargeMultiplier(mo.chargeFrames);return;}
    mo.charging=false;
  }
  mo.frame++;
  if(mv.smash&&mo.frame===mv.chargeFrame&&f.in.h.smash){mo.charging=true;emit(m,'charge',{seat:f.seat});}
  if(mv.chain&&mo.frame>=mv.chain.from&&take(f,mv.chain.key||'attack')){startMove(m,f,mv.chain.to);return;}
  if(mv.slide&&mo.frame===mv.slide.from)f.vx=f.facing*mv.slide.speed;
  if(mv.spawn&&mo.frame===mv.spawn.frame)spawnFromMove(m,f,mv.spawn,mo.id);
  if(mv.kind==='air'&&f.ground==null){if(take(f,'down')&&f.vy<=0.5&&!f.fastFalling){f.fastFalling=true;f.vy=-A(f).fastFall;}}
  if(mo.frame>=mv.total){if(mo.id==='upBLand'){setState(f,'idle');return;}toIdleOrAir(f);}
}
function stepLedgeAttack(m,f,mv){
  const mo=f.move;mo.frame++;
  if(mo.frame<=20){const t=mo.frame/20;f.x=mo.fromX+(mo.toX-mo.fromX)*t;f.y=mo.fromY+(0-mo.fromY)*Math.min(1,mo.frame/12);}
  if(mo.frame===12){f.y=0;f.ground=0;}
  if(mo.frame>=mv.total)setState(f,'idle');
}
function stepUpB(m,f,mv){
  const mo=f.move;mo.frame++;mo.pf++;
  const a=A(f);
  if(mo.phase==='squat'){
    f.vx*=0.8;if(f.ground==null){f.vy=0;}
    if(mo.pf>=mv.squat){mo.phase='rise';mo.pf=0;f.ground=null;f.vy=mv.rise;f.vx=f.in.x*a.airSpeed*1.2;f.upBUsed=true;emit(m,'upb',{seat:f.seat});}
    return;
  }
  if(mo.phase==='rise'||mo.phase==='hang'){
    if(take(f,'down')){setState(f,'helpless');f.helplessLanding=mv.cancelLanding;return;}
    if(mo.phase==='rise'&&f.vy<=0){mo.phase='hang';mo.pf=0;}
    if(mo.phase==='hang'&&mo.pf>=mv.hangFrames){mo.phase='plunge';mo.pf=0;f.vy=-mv.plunge;f.vx=0;}
    return;
  }
  // plunge: fixed downward speed until landing / ledge / blast zone
}
function stepDownB(m,f,mv){
  const mo=f.move;mo.frame++;mo.pf++;
  if(mo.phase==='windup'){
    if(mo.pf>=mv.windup){if(f.in.h.special){mo.phase='charge';mo.pf=0;mo.chargeFrames=0;emit(m,'charge',{seat:f.seat});}else{mo.phase='swing';mo.pf=0;mo.charge=0;}}
    return;
  }
  if(mo.phase==='charge'){
    if(!f.in.h.special){mo.phase='swing';mo.pf=1;mo.charge=mo.chargeFrames/mv.chargeMax;return;}
    mo.chargeFrames=Math.min(mv.chargeMax,mo.chargeFrames+1);
    if(f.ground!=null&&mv.chargeWalk){if(f.in.x!==0)f.facing=f.in.x;f.vx=f.in.x*mv.chargeWalk;}
    return;
  }
  if(mo.pf>=mv.swingTotal)toIdleOrAir(f);
}
function stepInhale(m,f,mv){
  const mo=f.move;mo.frame++;mo.pf++;
  const off=mv.inhale.holdOffset||6;
  if(mo.phase==='hold'){
    const v=m.fighters[mo.victim];v.x=f.x+f.facing*off;v.y=f.y;
    if(mo.pf>=mv.hold){mo.phase='spit';mo.pf=0;}
    return;
  }
  if(mo.phase==='holdProj'){if(mo.pf>=15){mo.phase='spitProj';mo.pf=0;}return;}
  if(mo.phase==='spit'){
    const v=m.fighters[mo.victim];
    if(mo.pf<mv.spit.release){v.x=f.x+f.facing*off;v.y=f.y;}
    if(mo.pf===mv.spit.release){
      v.x=f.x+f.facing*(A(f).radius+A(v).radius+2);v.y=f.y;v.grabbedBy=null;setState(v,f.ground!=null?'idle':'air');
      v.ground=f.ground;v.hiddenInMouth=false;applyHit(m,{attacker:f,target:v,box:mv.spit.hit,staleId:mo.id,dir:f.facing,noAttackerLag:true,throwHit:true});
    }
    if(mo.pf>=mv.spit.total)toIdleOrAir(f);
    return;
  }
  if(mo.phase==='spitProj'){
    if(mo.pf===4)spawnProjectile(m,f,'star',{x:14,y:11},{dmgMult:mo.projMult});
    if(mo.pf>=20)toIdleOrAir(f);
    return;
  }
  if(mo.frame>=mv.total)toIdleOrAir(f);
}
function stepHolding(m,f){
  const v=m.fighters[f.holding],a=A(f);
  if(!v||v.state!=='grabbed'){f.holding=null;setState(f,'idle');return;}
  v.x=f.x+f.facing*(a.radius+A(v).radius+1);v.y=f.y;v.facing=-f.facing;
  if(f.move?.id==='pummel'){
    const mo=f.move,mv=MV(f,'pummel');mo.frame++;
    if(mo.frame===mv.hitFrame){const d=mv.dmg*F.ONE_V_ONE;v.percent=Math.min(999,v.percent+d);v.hitlag=4;f.hitlag=4;m.lastHits[v.seat]={damage:d,kb:0,box:0,move:'pummel',kx:0,ky:0};m.stats[f.seat].damageDealt+=d;emit(m,'hit',{seat:v.seat,by:f.seat,dmg:d,kb:0,x:v.x,y:v.y+10,move:'pummel'});}
    if(mo.frame>=mv.total)f.move=null;
    return;
  }
  if(f.sf<3)return;
  let dir=0;if(take(f,'right'))dir=1;else if(take(f,'left'))dir=-1;else if(f.in.x!==0)dir=f.in.x;
  if(dir!==0){const id=dir===f.facing?'fthrow':'bthrow';startMove(m,f,id);f.holding=v.seat;return;}
  if(take(f,'attack')){f.move={id:'pummel',frame:0,hit:[false,false]};}
}
function stepThrow(m,f,mv){
  const mo=f.move,v=m.fighters[f.holding];mo.frame++;
  if(v&&v.state==='grabbed'){
    const side=mv.back&&mo.frame>=mv.release/2?-1:1;
    v.x=f.x+f.facing*side*(A(f).radius+A(v).radius+1);v.y=f.y;
    if(mo.frame===mv.release){
      v.grabbedBy=null;f.holding=null;setState(v,'idle');v.ground=f.ground;
      applyHit(m,{attacker:f,target:v,box:mv.hit,staleId:mo.id,dir:f.facing,noAttackerLag:true,throwHit:true});
    }
  }else f.holding=null;
  if(mo.frame>=mv.total)toIdleOrAir(f);
}
// ---------- specials added with the new styles (SPEC §5A) ----------
const lerp=(a,b,t)=>a+(b-a)*t;
function fireShot(m,f,mv,c){
  const P=styleOf(f).projectiles[mv.spawn.type],S=mv.scale||{};
  const o={staleId:'nspecial'};
  if(S.dmg)o.hit={...P.hit,dmg:lerp(S.dmg[0],S.dmg[1],c)};
  if(S.r)o.r=lerp(S.r[0],S.r[1],c);if(S.vx)o.vx=lerp(S.vx[0],S.vx[1],c);if(S.life)o.life=Math.round(lerp(S.life[0],S.life[1],c));
  spawnProjectile(m,f,mv.spawn.type,mv.spawn,o);
}
function stepShot(m,f,mv){
  const mo=f.move,c=mv.charge;mo.frame++;mo.pf++;
  if(!c){if(mo.frame===mv.spawn.frame)fireShot(m,f,mv,0);if(mo.frame>=mv.total)toIdleOrAir(f);return;}
  if(mo.phase==='airfire'||mo.phase==='windup'){
    if(mo.pf>=c.enter){if(mo.phase==='windup'&&f.in.h.special){mo.phase='charge';mo.pf=0;mo.chargeFrames=0;emit(m,'charge',{seat:f.seat});}else{mo.phase='fire';mo.pf=0;mo.charge=0;}}
    return;
  }
  if(mo.phase==='charge'){
    if(!f.in.h.special){mo.phase='fire';mo.pf=0;mo.charge=Math.min(1,mo.chargeFrames/c.max);return;}
    mo.chargeFrames=Math.min(c.max,mo.chargeFrames+1);return;
  }
  if(mo.pf===c.fireDelay)fireShot(m,f,mv,mo.charge);
  if(mo.pf>=c.endTotal)toIdleOrAir(f);
}
function endInAir(f,mv){if(f.ground==null){setState(f,'helpless');f.helplessLanding=mv.helplessLanding||20;}else setState(f,'idle');}
function stepLunge(m,f,mv){
  const mo=f.move,L=mv.lunge;mo.frame++;
  if(mo.frame<L.from)f.vx*=0.8;
  else if(mo.frame<=L.to){f.vx=f.facing*L.speed;if(f.ground==null&&L.airVy)f.vy=L.airVy;}
  else f.vx*=0.85;
  if(mo.frame>=mv.total){if(mv.helplessInAir)endInAir(f,mv);else toIdleOrAir(f);}
}
function stepRise(m,f,mv){
  const mo=f.move,R=mv.rise;mo.frame++;
  if(mo.frame===R.from){f.ground=null;f.y+=0.1;emit(m,'upb',{seat:f.seat});}
  if(mo.frame>=R.from&&mo.frame<=R.to)f.vy=R.speed;
  if((mo.frame>R.to&&f.vy<=0)||mo.frame>=mv.total)endInAir(f,mv);
}
function stepTether(m,f,mv){
  const mo=f.move,T=mv.tether;mo.frame++;
  if(mo.frame===T.frame){
    emit(m,'tether',{seat:f.seat});
    if(f.ground==null&&f.tethers<T.max&&f.ledgeGrabs<F.LEDGE.maxGrabs){
      const hx=f.x,hy=f.y+A(f).height*0.7;
      for(let i=0;i<ST(m).LEDGES.length;i++){
        const L=ST(m).LEDGES[i];
        if((f.x-L.x)*L.side<-15||Math.hypot(L.x-hx,L.y-hy)>T.reach)continue;
        f.tethers++;grabLedge(m,f,i);return;
      }
    }
    if(f.ground==null)f.vy=Math.max(f.vy,T.rise);
  }
  if(mo.frame>=mv.total){if(f.ground==null)endInAir(f,mv);else setState(f,'idle');}
}
function stepCounter(m,f,mv){
  const mo=f.move,c=mv.counter;mo.frame++;mo.pf++;
  if(mo.phase==='counterHit'){if(mo.pf>=c.delay+c.strikeTotal)toIdleOrAir(f);return;}
  if(mo.frame>=mv.total)toIdleOrAir(f);
}
function stepSneak(m,f,mv){
  const mo=f.move,S=mv.sneak;mo.frame++;mo.pf++;
  if(mo.phase==='ready'){
    if((!f.in.h.special&&mo.pf>=S.min)||mo.pf>=S.max){mo.charge=Math.max(0,Math.min(1,(mo.pf-S.min)/(S.max-S.min)));mo.phase='vanish';mo.pf=0;emit(m,'vanish',{seat:f.seat,x:f.x,y:f.y+10});}
    return;
  }
  if(mo.phase==='vanish'){
    f.intangible=Math.max(f.intangible,2);
    if(mo.pf===S.appear){
      let nx=f.x+f.facing*lerp(S.dist[0],S.dist[1],mo.charge);
      if(f.ground!=null){const sf=SURF(m,f.ground);nx=Math.max(sf.x0,Math.min(sf.x1,nx));}
      f.x=nx;emit(m,'appear',{seat:f.seat,x:f.x,y:f.y+10});
    }
    if(mo.pf>=S.vanish){mo.phase='strike';mo.pf=0;}
    return;
  }
  if(mo.pf>=S.strikeTotal)toIdleOrAir(f);
}
function stepLaunch(m,f,mv){
  const mo=f.move,L=mv.launch;mo.frame++;
  if(mo.frame===L.frame){
    let dx=f.in.x,dy=f.in.y;if(!dx&&!dy)dy=1;const n=Math.hypot(dx,dy);mo.lx=dx/n;mo.ly=dy/n;
    if(dx)f.facing=Math.sign(dx);if(mo.ly>0){f.ground=null;f.y+=0.1;}emit(m,'upb',{seat:f.seat});
  }
  if(mo.frame>=L.frame&&mo.frame<L.frame+L.frames){f.vx=mo.lx*L.speed;f.vy=mo.ly*L.speed;}
  if(mo.frame>=L.frame+L.frames){f.vx*=0.5;f.vy=Math.min(f.vy,1);endInAir(f,mv);}
}
function stepDive(m,f,mv){
  const mo=f.move,D=mv.dive;mo.frame++;
  if(mo.frame<D.from){f.vx*=0.9;f.vy=0;}
  else{f.vx=f.facing*D.vx;f.vy=D.vy;}
}
const TYPE_STEP={superjump:stepUpB,chargeSwing:stepDownB,inhale:stepInhale,shot:stepShot,lunge:stepLunge,rise:stepRise,tether:stepTether,counter:stepCounter,sneak:stepSneak,launch:stepLaunch,dive:stepDive};

function grabRelease(m,g,v){
  if(g){g.holding=null;if(g.state==='holding'||(g.state==='move'&&MV(g,g.move.id)?.kind==='throw')){setState(g,'lag');g.lag=20;}}
  v.grabbedBy=null;setState(v,'lag');v.lag=16;v.ground=null;v.vx=(g?g.facing:v.facing)*1.2;v.vy=1.4;
  emit(m,'release',{seat:v.seat});
}

// ---------- ledge ----------
function stepLedge(m,f,canAct){
  const L=ST(m).LEDGES[f.ledge],a=A(f);
  f.x=L.x+L.side*(a.radius+1);f.y=L.y-a.height*0.8;f.vx=f.vy=f.kbx=f.kby=0;f.facing=-L.side;
  if(f.sf>=F.LEDGE.hangFrames){ledgeDrop(f);return;}
  if(!canAct||f.sf<6)return;
  const toward=-L.side,stageX=L.x-L.side*(a.radius+2);
  if(take(f,'attack')||take(f,'smash')||take(f,'special')){
    f.ledge=null;startMove(m,f,'ledgeAttack',{fromX:f.x,fromY:f.y,toX:stageX});f.iw=[...a.ledge.attack.intangible];return;
  }
  if(take(f,'shield')){f.ledge=null;startAct(f,'ledgeroll',{...a.ledge.roll,toX:L.x-L.side*(a.radius+2+a.ledge.roll.distance),toY:0});return;}
  if(take(f,'jump')){f.ledge=null;f.ground=null;setState(f,'air');f.vy=DERIVED[f.style].fullHop;f.vx=toward*0.6;f.intangible=a.ledge.jump.intangible[1];emit(m,'jump',{seat:f.seat,ledge:true});return;}
  const towardKey=toward>0?'right':'left',awayKey=toward>0?'left':'right';
  if(take(f,'up')||take(f,towardKey)){f.ledge=null;startAct(f,'ledgeget',{...a.ledge.getup,toX:stageX,toY:0});return;}
  if(take(f,'down')||take(f,awayKey)){ledgeDrop(f);return;}
}
function ledgeDrop(f){f.ledge=null;f.ground=null;setState(f,'air');f.ledgeCooldown=20;f.vy=0;f.y-=1;}
function tryLedge(m,f){
  if(f.ground!=null||f.ledgeCooldown>0||f.in.y<0)return false;
  const ok=f.state==='air'||f.state==='helpless'||(moveType(f)==='superjump'&&f.move.phase==='plunge')||(f.state==='airdodge'&&f.sf>20);
  if(!ok||(f.vy+f.kby>0.3&&f.state!=='helpless'))return false;
  if(f.ledgeGrabs>=F.LEDGE.maxGrabs)return false;
  const a=A(f);
  for(let i=0;i<ST(m).LEDGES.length;i++){
    const L=ST(m).LEDGES[i],out=(f.x-L.x)*L.side,hands=f.y+a.height*0.85;
    if(out<-6||out>16||hands<L.y-12||hands>L.y+6)continue;
    grabLedge(m,f,i);return true;
  }
  return false;
}
function grabLedge(m,f,i){
  const L=ST(m).LEDGES[i],a=A(f);
    const other=m.fighters.find(o=>o!==f&&o.state==='ledge'&&o.ledge===i);
    if(other){ledgeDrop(other);setState(other,'lag');other.lag=24;other.vx=L.side*1.0;other.vy=0.6;other.ledgeCooldown=30;emit(m,'trump',{seat:other.seat,by:f.seat});}
    setState(f,'ledge');f.ledge=i;f.ground=null;f.vx=f.vy=f.kbx=f.kby=0;f.move=null;
    f.jumpsLeft=a.airJumps;f.airdodgeUsed=false;f.upBUsed=false;f.fastFalling=false;f.tumbling=false;
    f.ledgeGrabs++;f.ledgeIntangible=F.ledgeIntangibility({airtime:f.airtime,percent:f.percent,grabs:f.ledgeGrabs});f.intangible=f.ledgeIntangible;
  emit(m,'ledge',{seat:f.seat,grabs:f.ledgeGrabs});
}

// ---------- shield ----------
function shieldBreak(m,f){
  setState(f,'shieldbreak');f.ground=null;f.vy=2.8;f.vx=0;f.shieldHP=0;f.dizzy=Math.max(150,Math.min(400,400-2*f.percent));
  emit(m,'shieldbreak',{seat:f.seat,x:f.x,y:f.y+11});
}

// ---------- projectiles ----------
function spawnProjectile(m,f,type,at,{dmgMult=1,r,vx,life,hit,staleId}={}){
  const P=styleOf(f).projectiles[type];
  const speed=vx??P.vx;
  const p={id:m.nextId++,type,owner:f.seat,x:f.x+f.facing*at.x,y:f.y+at.y,vx:f.facing*speed,vy:P.vy||0,life:life??P.life,bounces:P.bounces||0,dmgMult,dir:f.facing,style:f.style,age:0};
  if(r!=null)p.r=r;if(hit)p.hit=hit;if(staleId)p.staleId=staleId;
  if(P.stationary){p.grounded=f.ground!=null;p.vy=0;}
  m.projectiles.push(p);emit(m,'spawn',{seat:f.seat,type});return p;
}
function spawnFromMove(m,f,sp,moveId){
  const mine=m.projectiles.filter(p=>p.owner===f.seat&&p.type===sp.type);
  if(sp.max&&mine.length>=sp.max){if(!sp.replace)return null;for(const p of mine)p.dead=true;m.projectiles=m.projectiles.filter(p=>!p.dead);}
  return spawnProjectile(m,f,sp.type,sp,{staleId:moveId});
}
function stepProjectiles(m){
  for(const p of m.projectiles){
    const P=STYLES[p.style].projectiles[p.type];
    p.life--;p.age=(p.age||0)+1;const py=p.y;
    if(P.stationary){
      // Traps drop to the floor and stay there.
      if(!p.grounded){p.vy-=P.gravity||0.2;p.y+=p.vy;
        for(const id of ST(m).SURFACES){const sf=SURF(m,id);if(py>=sf.y&&p.y<=sf.y&&p.x>=sf.x0&&p.x<=sf.x1){p.y=sf.y;p.vy=0;p.grounded=true;break;}}}
      if(p.life<=0||ST(m).outOfBounds(p.x,p.y))p.dead=true;
      continue;
    }
    if(P.gravity){p.vy-=P.gravity;}
    p.x+=p.vx;p.y+=p.vy;
    if(P.gravity&&p.vy<0){
      for(const id of ST(m).SURFACES){const s=SURF(m,id);if(py>=s.y&&p.y<=s.y&&p.x>=s.x0&&p.x<=s.x1){p.y=s.y;p.vy=P.bounceVy;p.bounces--;break;}}
    }
    if(p.bounces<0||p.life<=0||ST(m).outOfBounds(p.x,p.y))p.dead=true;
  }
  m.projectiles=m.projectiles.filter(p=>!p.dead);
}

// ---------- hitboxes ----------
function activeBoxes(f){
  const out=[];
  if(f.state!=='move'||!f.move)return out;
  const mo=f.move,mv=MV(f,mo.id);
  if(mv.type==='superjump'){if(mo.phase==='plunge')out.push({box:mv.plungeHit,index:'plungeHit',staleId:'upB'});return out;}
  if(mv.type==='counter'){
    const c=mv.counter;if(mo.phase==='counterHit'&&mo.pf>=c.delay&&mo.pf<=c.delay+2)out.push({box:c.hit,index:'counter',staleId:mo.id,dmg:mo.counterDmg,fixed:true});
    return out;
  }
  if(mv.type==='sneak'){if(mo.phase==='strike'){const b=mv.hitboxes[0];if(mo.pf>=b.frames[0]&&mo.pf<=b.frames[1])out.push({box:b,index:0,staleId:mo.id});}return out;}
  if(mv.type==='chargeSwing'){
    if(mo.phase==='swing'){const b=mv.hitboxes[0];if(mo.pf>=b.frames[0]&&mo.pf<=b.frames[1])out.push({box:b,index:0,staleId:'downB',dmg:b.dmg+(b.dmgFull-b.dmg)*mo.charge,shieldBonus:mo.charge>=1?mv.fullShieldBonus:0});}
    return out;
  }
  if(!mv.hitboxes)return out;
  mv.hitboxes.forEach((b,i)=>{if(mo.frame>=b.frames[0]&&mo.frame<=b.frames[1])out.push({box:b,index:i,staleId:mo.id});});
  return out;
}
function armorOf(f){
  if(f.state!=='move'||!f.move)return null;
  const mv=MV(f,f.move.id),ar=mv?.armor;if(!ar)return null;
  const fr=mv.type==='chargeSwing'?(f.move.phase==='swing'?f.move.pf:-1):f.move.frame;
  if(fr<ar.frames[0]||fr>ar.frames[1])return null;
  if(ar.groundOnly&&f.ground==null)return null;
  return ar;
}
function applyHit(m,{attacker:a,target:t,box,staleId,dir,dmg,shieldBonus=0,noAttackerLag=false,projectile=null,index=0,throwHit=false,moveId,mo=projectile?null:a?.move,fixed=false}){
  const base=dmg??box.dmg;
  const charge=fixed?1:mo?.chargeMult||1,sh=!fixed&&mo?.shortHop?F.SHORT_HOP:1,pm=projectile?.dmgMult||1;
  const stale=fixed?1:F.staleMultiplier(a.stale,staleId);
  // Revenge boost (摔角手): the next real hit is multiplied, then the boost is spent.
  const rv=!fixed&&!projectile&&a.revengeMult>1?a.revengeMult:1;
  const dEff=base*charge*sh*stale*pm*rv;
  // Counters (看破 / 替身纸箱): a hit inside the window is absorbed and answered.
  if(!throwHit&&t.state==='move'&&t.move&&!t.move.phase){
    const tm=MV(t,t.move.id);
    if(tm.type==='counter'&&t.move.frame>=tm.window[0]&&t.move.frame<=tm.window[1]){
      const c=tm.counter;t.move.phase='counterHit';t.move.pf=0;t.move.hit=[false,false];
      t.move.counterDmg=c.fixed??Math.max(c.min,dEff*c.mult);
      if(c.revenge){
        // 蓄怒: take 0.4× and store a multiplier for the next hit (SPEC §5B.2).
        t.percent=Math.min(999,t.percent+dEff*0.4*F.ONE_V_ONE);
        const mm=t.revengeMult>1?t.revengeMult+(dEff*0.075+0.5)*(1-0.25*(t.revengeMult-1)):1.5+0.075*dEff;
        t.revengeMult=Math.min(3,mm);t.revengeLeft=36;t.revengeTimer=3600;emit(m,'revenge',{seat:t.seat,mult:t.revengeMult});
      }
      const src=projectile?null:a;
      if(src){
        if(c.behind){const side=Math.sign(src.x-t.x)||-src.facing;let nx=src.x+side*(A(src).radius+A(t).radius+2);
          if(t.ground!=null){const sf=SURF(m,t.ground);nx=Math.max(sf.x0,Math.min(sf.x1,nx));}t.x=nx;t.facing=-side;}
        else t.facing=Math.sign(src.x-t.x)||t.facing;
        src.hitlag=Math.max(F.hitlag(dEff),c.delay+1);
      }
      t.intangible=c.delay+4;
      emit(m,'counter',{seat:t.seat,by:a.seat,x:t.x,y:t.y+11});
      return 'countered';
    }
  }
  // Shield / parry
  if(!throwHit&&t.state==='shield'&&!(box.unblockable&&t.ground!=null)){
    t.shieldHP-=dEff*F.SHIELD.mult+shieldBonus;t.shieldstun=F.shieldstun(dEff);
    const hl=F.hitlag(dEff,{shield:true});t.hitlag=hl;if(!noAttackerLag&&!projectile)a.hitlag=hl;
    t.vx=(Math.sign(t.x-(projectile?projectile.x:a.x))||-a.facing)*Math.min(1.6,0.08*dEff+0.3);
    if(rv>1)a.revengeMult=1;
    pushStale(a,staleId,F.STALE_SHIELD);emit(m,'shield',{seat:t.seat,by:a.seat,dmg:dEff,x:t.x,y:t.y+11});
    if(t.shieldHP<=0)shieldBreak(m,t);
    return 'shield';
  }
  if(!throwHit&&t.state==='shielddrop'&&t.sf<=F.SHIELD.parry){
    const hl=F.hitlag(dEff);t.hitlag=hl;if(!noAttackerLag&&!projectile)a.hitlag=hl+4;setState(t,'idle');
    emit(m,'parry',{seat:t.seat,by:a.seat,x:t.x,y:t.y+11});return 'parry';
  }
  const add=dEff*F.ONE_V_ONE;
  t.percent=Math.min(999,t.percent+add);
  if(rv>1)a.revengeMult=1;
  if(t.revengeMult>1){t.revengeLeft-=add;if(t.revengeLeft<=0||throwHit)t.revengeMult=1;}
  // Power meter (拳击喵): 1:1 from damage taken, 0.3× from damage dealt.
  if(A(t).meter)t.meter=Math.min(100,t.meter+add);
  if(A(a).meter&&!fixed)a.meter=Math.min(100,a.meter+add*0.3);
  const dKb=base*charge*sh*pm*rv*(1+F.STALE_KB*(stale-1));
  const kb=F.knockback({p:t.percent,d:dKb,w:A(t).weight,kbg:box.kbg,bkb:box.bkb,r:F.rage(a.percent)});
  pushStale(a,staleId,1);
  m.stats[a.seat].damageDealt+=add;t.lastHitBy=a.seat;
  const hl=F.hitlag(dEff);t.hitlag=hl;if(!noAttackerLag&&!projectile)a.hitlag=hl;
  const sx=box.away?(Math.sign(t.x-(projectile?projectile.x:a.x))||dir):dir;
  const ang=box.angle*Math.PI/180;let ux=Math.cos(ang)*sx,uy=Math.sin(ang);
  const armor=armorOf(t);
  const rec={damage:add,kb,box:index,move:moveId||staleId,kx:0,ky:0,armor:!!armor};
  m.lastHits[t.seat]=rec;
  emit(m,'hit',{seat:t.seat,by:a.seat,dmg:add,kb,x:t.x,y:t.y+11,move:staleId,projectile:!!projectile});
  if(armor&&(armor.type==='super'||dEff<=armor.threshold)){emit(m,'armor',{seat:t.seat});return 'armor';}
  // Launch
  let speed=F.launchSpeed(kb);
  if(t.ground!=null){
    // Grounded targets: below tumble knockback they flinch in place; a meteor that
    // tumbles bounces them up off the floor.
    if(kb<F.TUMBLE_KB)uy=0;
    else if(uy<0){uy=-uy;speed*=0.8;}
  }
  if(uy===0&&t.ground!=null){t.kbx=ux*speed;t.kby=0;}
  else{t.ground=null;t.kbx=ux*speed;t.kby=uy*speed;t.y+=0.1;}
  rec.kx=t.kbx;rec.ky=t.kby;
  if(t.holding!=null){const v=m.fighters[t.holding];if(v&&v.state==='grabbed')grabRelease(m,null,v);t.holding=null;}
  if(t.state==='inhaled'||t.state==='grabbed'){t.grabbedBy=null;}
  setState(t,'hitstun');t.vx=0;t.vy=0;t.hitstun=F.hitstun(kb);t.tumble=kb>=F.TUMBLE_KB;t.tumbling=false;
  const deg=((box.angle%360)+360)%360;t.homog=deg>=70&&deg<=110;
  t.fastFalling=false;t.airdodgeUsed=false;t.upBUsed=false;t.ledgeGrabs=0;t.pendingAirJump=0;
  if(sx!==0)t.facing=-sx;
  return 'hit';
}
function pushStale(a,id,w){a.stale.unshift({id,w});if(a.stale.length>F.STALE.length)a.stale.length=F.STALE.length;}

// A trap trips: damage and straight to the floor, no launch.
function tripFighter(m,a,t,box,staleId){
  const stale=F.staleMultiplier(a.stale,staleId),add=box.dmg*stale*F.ONE_V_ONE;
  t.percent=Math.min(999,t.percent+add);pushStale(a,staleId,1);m.stats[a.seat].damageDealt+=add;t.lastHitBy=a.seat;
  if(t.holding!=null){const v=m.fighters[t.holding];if(v&&v.state==='grabbed')grabRelease(m,null,v);t.holding=null;}
  setState(t,'down');t.vx=0;t.kbx=0;t.kby=0;t.hitlag=6;
  m.lastHits[t.seat]={damage:add,kb:0,box:0,move:'trap',kx:0,ky:0};
  emit(m,'trip',{seat:t.seat,by:a.seat,dmg:add,x:t.x,y:t.y+5});emit(m,'hit',{seat:t.seat,by:a.seat,dmg:add,kb:0,x:t.x,y:t.y+5,move:staleId,projectile:true});
}
function resolveCombat(m){
  const [f0,f1]=m.fighters,pairs=[[f0,f1],[f1,f0]],hits=[],grabs=[],inhales=[];
  for(const [a,t] of pairs){
    if(a.hitlag>0||!a.move||a.state!=='move')continue;
    if(['dead','out','respawn','inhaled'].includes(t.state))continue;
    if(!a.move.hit[t.seat]){
      for(const b of activeBoxes(a)){
        const c=circleHits(worldBox(a,b.box),t);
        if(c){if(intangibleAt(t,c.contactY))break;hits.push({a,t,b,mo:a.move});break;}
      }
    }
    const mv=MV(a,a.move.id);
    if(mv.grab&&a.move.frame>=mv.grab.frames[0]&&a.move.frame<=mv.grab.frames[1]&&t.ground!=null&&!HOLD_STATES.has(t.state)){
      if(circleHits(worldBox(a,mv.grab),t)&&!intangibleAt(t,null))grabs.push({a,t});
    }
    if(mv.inhale&&!a.move.phase&&a.move.frame>=mv.inhale.frames[0]&&a.move.frame<=mv.inhale.frames[1]){
      if(circleHits(worldBox(a,mv.inhale),t)&&!intangibleAt(t,null)&&!HOLD_STATES.has(t.state))inhales.push({a,t});
    }
  }
  const struck=new Set();
  // Trades: both hits were detected on the same frame, so both apply even if the
  // first one knocks the other attacker out of its move.
  for(const {a,t,b,mo} of hits){
    mo.hit[t.seat]=true;
    const res=applyHit(m,{attacker:a,target:t,box:b.box,staleId:b.staleId,dir:a.facing,dmg:b.dmg,shieldBonus:b.shieldBonus,index:b.index,mo,fixed:b.fixed});
    if(res==='hit')struck.add(t.seat);
    // Dive kicks bounce off whatever they hit.
    if((res==='hit'||res==='shield'||res==='armor')&&a.state==='move'&&MV(a,a.move.id).type==='dive'){setState(a,'lag');a.lag=18;a.vy=2.4;a.vx=-a.facing*0.8;a.ground=null;}
  }
  // Attacks beat grabs: a grabber that got hit this frame loses the grab.
  for(const {a,t} of grabs){
    if(struck.has(a.seat)||a.state!=='move'||HOLD_STATES.has(t.state))continue;
    if(t.holding!=null)continue;
    setState(a,'holding');a.holding=t.seat;setState(t,'grabbed');t.grabbedBy=a.seat;t.ground=a.ground;t.kbx=t.kby=t.vx=t.vy=0;
    t.grabTimer=Math.min(240,60+t.percent);emit(m,'grab',{seat:t.seat,by:a.seat});
  }
  for(const {a,t} of inhales){
    if(struck.has(a.seat)||moveType(a)!=='inhale'||HOLD_STATES.has(t.state))continue;
    a.move.phase='hold';a.move.pf=0;a.move.victim=t.seat;setState(t,'inhaled');t.grabbedBy=a.seat;t.kbx=t.kby=t.vx=t.vy=0;t.hiddenInMouth=MV(a,a.move.id).inhale.hide!==false;
    emit(m,'inhale',{seat:t.seat,by:a.seat});
  }
  // Projectiles: hit fighters, get reflected by hitboxes, get swallowed by inhale.
  for(const p of m.projectiles){
    const P=STYLES[p.style].projectiles[p.type],ph=p.hit||P.hit,pr=p.r||P.r;
    for(const f of m.fighters){
      if(p.dead||f.seat===p.owner)continue;
      if(moveType(f)==='inhale'&&!f.move.phase&&MV(f,f.move.id).inhale.projectiles!==false){const iv=MV(f,f.move.id).inhale;if(f.move.frame>=iv.frames[0]&&f.move.frame<=iv.frames[1]){
        const box=worldBox(f,iv);
        if(Math.hypot(box.x-p.x,box.y-p.y)<=box.r+pr){p.dead=true;f.move.phase='holdProj';f.move.pf=0;f.move.projMult=p.dmgMult*1.5*(ph.dmg/styleOf(f).projectiles.star.hit.dmg);emit(m,'inhale',{seat:f.seat,projectile:true});continue;}
      }}
      if(f.hitlag===0){
        for(const b of activeBoxes(f)){const w=worldBox(f,b.box);
          if(Math.hypot(w.x-p.x,w.y-p.y)<=w.r+pr&&P.stationary){p.dead=true;emit(m,'break',{seat:f.seat,x:p.x,y:p.y});break;}
          if(Math.hypot(w.x-p.x,w.y-p.y)<=w.r+pr){p.owner=f.seat;p.dir=f.facing;p.vx=f.facing*Math.min(3,Math.abs(p.vx)*1.2);p.vy=P.gravity?2:0;p.dmgMult=Math.min(1.7,p.dmgMult*1.2);p.life=Math.max(p.life,150);emit(m,'reflect',{seat:f.seat,x:p.x,y:p.y});break;}}
        if(p.owner===f.seat)continue;
      }
      if(['dead','out','respawn','inhaled'].includes(f.state))continue;
      if(p.dead)continue;
      if(p.age<(P.arm||3))continue; // freshly spawned projectiles arm after a few frames
      if(circleHits({x:p.x,y:p.y,r:pr},f)&&!intangibleAt(f,null)){
        const owner=m.fighters[p.owner];
        if(P.trip){if(f.ground!=null&&f.state!=='down'){tripFighter(m,owner,f,ph,p.staleId||'downB');p.dead=true;}continue;}
        const res=applyHit(m,{attacker:owner,target:f,box:ph,staleId:p.staleId||'nspecial',dir:p.dir,projectile:p,moveId:p.type});
        if(res==='hit'&&P.status?.slow){f.slow=P.status.slow;emit(m,'slow',{seat:f.seat});}
        p.dead=true;
      }
    }
  }
  m.projectiles=m.projectiles.filter(p=>!p.dead);
}

// ---------- physics ----------
const GROUND_CONTROL=new Set(['idle','walk','run','crouch']);
function physics(m,f){
  const a=A(f);
  if(['dead','out','grabbed','inhaled','ledge','respawn'].includes(f.state))return;
  if(f.state==='act'&&(f.act.kind==='ledgeget'||f.act.kind==='ledgeroll'))return;
  if(f.state==='move'&&MV(f,f.move.id).kind==='ledge')return;
  const px=f.x,py=f.y;
  if(f.ground!=null){
    // Ground movement
    if(GROUND_CONTROL.has(f.state)&&f.state!=='crouch'&&f.in.x!==0){
      let target=f.state==='run'?(f.dashFrames>0?a.dash:a.run):a.walk;if(f.dashFrames>0)f.dashFrames--;
      target*=f.in.x*(f.slow>0?0.6:1);f.vx+=Math.sign(target-f.vx)*Math.min(Math.abs(target-f.vx),0.3);
    }else if(!(moveType(f)==='chargeSwing'&&f.move.phase==='charge')&&!['lunge','sneak'].includes(moveType(f))&&f.state!=='roll'&&f.state!=='act'){
      f.vx-=Math.sign(f.vx)*Math.min(Math.abs(f.vx),a.traction);
    }
    // grounded knockback slide
    if(f.kbx!==0){const s=Math.abs(f.kbx);const n=Math.max(0,s-F.KB_DECAY-a.traction*0.5);f.kbx=Math.sign(f.kbx)*n;}
    // A moving platform carries whoever stands on it (SPEC §8).
    const s=SURF(m,f.ground);
    f.x+=f.vx+f.kbx+s.dx;f.vy=0;f.kby=0;
    if(f.x<s.x0||f.x>s.x1){
      const walkOff=GROUND_CONTROL.has(f.state)||f.state==='hitstun'||f.state==='lag';
      if(walkOff){f.ground=null;if(GROUND_CONTROL.has(f.state))setState(f,'air');}
      else{f.x=Math.max(s.x0,Math.min(s.x1,f.x));f.vx=0;}
    }
    if(f.ground!=null)f.y=s.y;
    return;
  }
  // Airborne
  const t=moveType(f),mo=f.move,mvx=t?MV(f,mo.id):null;
  const plunging=t==='superjump'&&mo.phase==='plunge';
  const hanging=t==='superjump'&&(mo.phase==='hang'||mo.phase==='squat');
  const dodgeFloat=f.state==='airdodge'&&f.act.kind==='dir'&&f.sf<=20;
  // Specials that fix their own velocity: no gravity, no drift.
  const fixedV=(t==='lunge'&&mo.frame<=mvx.lunge.to)||(t==='rise'&&mo.frame>=mvx.rise.from&&mo.frame<=mvx.rise.to)||
    (t==='launch'&&mo.frame<mvx.launch.frame+mvx.launch.frames)||t==='dive'||(t==='sneak'&&mo.phase!=='strike');
  if(fixedV&&((t==='lunge'&&!(mvx.lunge.airVy&&mo.frame>=mvx.lunge.from))||t==='sneak'||(t==='launch'&&mo.frame<mvx.launch.frame)))f.vy=0;
  if(!plunging&&!hanging&&!dodgeFloat&&!fixedV){
    const cap=f.state==='hitstun'&&f.homog?F.HITSTUN_HOMOGENIZED_FALL:f.fastFalling?a.fastFall:a.fall;
    f.vy=Math.max(-cap,f.vy-a.gravity);if(f.fastFalling&&f.state!=='hitstun')f.vy=-a.fastFall;
  }
  const drift=f.state==='air'||(f.state==='move'&&!fixedV&&(MV(f,f.move.id).kind==='air'||MV(f,f.move.id).kind==='special')&&!(t==='superjump'&&mo.phase==='squat'))||f.state==='helpless'||(f.state==='hitstun'&&f.hitstun<=0);
  if(drift&&!plunging){
    const mult=(f.state==='helpless'?0.8:t==='superjump'?1.2:1)*(f.slow>0?0.6:1),max=a.airSpeed*mult;
    if(f.in.x!==0){const t=f.in.x*max;f.vx+=Math.sign(t-f.vx)*Math.min(Math.abs(t-f.vx),a.airAccel);}
    else f.vx-=Math.sign(f.vx)*Math.min(Math.abs(f.vx),a.airFriction);
  }else if(f.state==='hitstun'){f.vx*=0.98;}
  if(f.kbx!==0||f.kby!==0){const s=Math.hypot(f.kbx,f.kby),n=Math.max(0,s-F.KB_DECAY);if(n===0){f.kbx=0;f.kby=0;}else{f.kbx*=n/s;f.kby*=n/s;}}
  f.x+=f.vx+f.kbx;f.y+=f.vy+f.kby;
  if(f.through>0)f.through--;
  collide(m,f,px,py);
}
function collide(m,f,px,py){
  const a=A(f),r=a.radius,h=a.height,M=ST(m).MAIN;
  const falling=f.vy+f.kby<=0;
  // Landing on surfaces
  if(falling){
    for(const id of ST(m).SURFACES){
      const s=SURF(m,id);
      if(!s.solid&&(f.through>0||f.in.y<0&&f.state!=='hitstun'))continue;
      if(!s.solid&&((moveType(f)==='superjump'&&f.move.phase!=='plunge')||((moveType(f)==='rise'||moveType(f)==='launch')&&f.vy>0)))continue;
      if(py>=s.y-0.001&&f.y<=s.y&&f.x>=s.x0&&f.x<=s.x1){land(m,f,id,s);return;}
    }
  }
  // Main stage walls / ceiling
  if(f.x+r>M.x0&&f.x-r<M.x1&&f.y<M.top&&f.y+h>M.bottom){
    if(py+h<=M.bottom+0.5){f.y=M.bottom-h;if(f.vy>0)f.vy=0;if(f.kby>0)f.kby=f.state==='hitstun'?-f.kby*0.8:0;}
    else{
      const left=px<=M.x0?true:px>=M.x1?false:f.x<0;
      f.x=left?M.x0-r:M.x1+r;
      if(f.state==='hitstun'&&Math.abs(f.kbx)>1){f.kbx=-f.kbx*0.8;emit(m,'wall',{seat:f.seat});}
      else{f.kbx=0;f.vx=0;}
    }
  }
}
function land(m,f,id,s){
  f.y=s.y;f.ground=id;
  const speed=Math.hypot(f.kbx,f.kby);
  if(f.state==='hitstun'){
    if(f.tumble&&speed>2.0){f.kby=-f.kby*0.8;f.kbx*=0.8;f.ground=null;f.y=s.y+0.1;emit(m,'bounce',{seat:f.seat});return;}
    f.kby=0;f.vy=0;
    if(f.tumble){f.kbx=0;landReset(f);setState(f,'down');emit(m,'knockdown',{seat:f.seat});return;}
    landReset(f);return; // keep counting hitstun on the ground
  }
  f.vy=0;f.kby=0;
  const st=f.state;
  if(st==='air'){const tumble=f.tumbling;landReset(f);if(tumble){setState(f,'down');emit(m,'knockdown',{seat:f.seat});return;}f.landingLag=A(f).landing;setState(f,'landing');emit(m,'land',{seat:f.seat});return;}
  if(st==='move'){
    const mo=f.move,mv=MV(f,mo.id);landReset(f);
    if(mv.type==='dive'){f.landingLag=mv.landing;setState(f,'landing');emit(m,'land',{seat:f.seat,lag:mv.landing});return;}
    if(mv.type==='launch'||(mv.type==='lunge'&&mo.frame>mv.lunge.to)){f.landingLag=mv.helplessLanding||12;setState(f,'landing');return;}
    if(mv.type==='superjump'){if(mo.phase==='plunge'){startMove(m,f,'upBLand');m.stats[f.seat].attacksStarted--;emit(m,'slam',{seat:f.seat,x:f.x});return;}f.landingLag=mv.cancelLanding;setState(f,'landing');return;}
    if(mv.kind==='air'){const ac=mv.autocancel;const lag=mo.frame<ac[0]||mo.frame>=ac[1]?A(f).landing:mv.landing;f.landingLag=lag;setState(f,'landing');emit(m,'land',{seat:f.seat,lag});return;}
    return; // specials keep going on the ground
  }
  if(st==='helpless'){landReset(f);f.landingLag=f.helplessLanding;setState(f,'landing');return;}
  if(st==='airdodge'){const r=f.act;landReset(f);f.landingLag=r.kind==='neutral'?r.landing:(f.sf>30?r.landing[0]:r.landing[1]);setState(f,'landing');return;}
  if(st==='shieldbreak'){landReset(f);setState(f,'dizzy');return;}
  if(st==='lag'){landReset(f);return;}
  landReset(f);
}

// ---------- body pushing ----------
// Overlapping fighters are pushed apart until their hurtboxes just touch, firmly
// enough that walking or dashing never clips one body into the other.
// A fighter pinned at the stage edge is never shoved off; the other one takes the
// whole correction instead. Rolls / dodges / grabs are exempt (intangible cross-ups).
const NO_PUSH=new Set(['dead','out','respawn','grabbed','inhaled','holding','ledge','roll','spotdodge','airdodge']);
function pushApart(m){
  const [a,b]=m.fighters;
  if(NO_PUSH.has(a.state)||NO_PUSH.has(b.state))return;
  if([a,b].some(f=>moveType(f)==='sneak'&&f.move.phase==='vanish'))return;
  if(a.state==='act'&&a.act?.kind!=='getup'||b.state==='act'&&b.act?.kind!=='getup')return;
  const min=A(a).radius+A(b).radius;
  const ya0=a.y,ya1=a.y+bodyHeight(a),yb0=b.y,yb1=b.y+bodyHeight(b);
  if(ya1<=yb0||yb1<=ya0)return;
  const dx=b.x-a.x,gap=Math.abs(dx);if(gap>=min)return;
  const dir=dx!==0?Math.sign(dx):(a.facing>0?1:-1);
  const bounds=f=>{if(f.ground==null)return [-Infinity,Infinity];const s=SURF(m,f.ground);return [s.x0,s.x1];};
  const move=(f,d)=>{const [lo,hi]=bounds(f),x=Math.max(lo,Math.min(hi,f.x+d)),done=x-f.x;f.x=x;return done;};
  // Split the overlap; whatever one side cannot take (edge) goes to the other.
  // On the ground the correction is immediate; with someone in the air it eases in
  // (at most 1 unit each per frame) so landing on a head does not snap sideways.
  const cap=a.ground!=null&&b.ground!=null?Infinity:2;
  const need=Math.min(min-gap,cap),half=need/2;
  const movedA=Math.abs(move(a,-dir*half)),movedB=Math.abs(move(b,dir*half));
  let left=need-movedA-movedB;
  if(left>1e-9){left-=Math.abs(move(a,-dir*left));}
  if(left>1e-9){move(b,dir*left);}
}

// ---------- KO / respawn ----------
function ko(m,f){
  const by=f.lastHitBy;
  f.stocks=Math.max(0,f.stocks-1);m.stats[f.seat].falls++;
  if(by!=null&&by!==f.seat)m.stats[by].kos++;else m.stats[f.seat].sds++;
  emit(m,'ko',{seat:f.seat,x:f.x,y:f.y,stocks:f.stocks});
  const keep={seat:f.seat,style:f.style,stocks:f.stocks,stale:f.stale,dodgeStale:0};
  Object.assign(f,newFighter(f.seat,f.style,f.stocks,m.stage),keep,{state:f.stocks>0?'dead':'out',respawnTimer:RESPAWN_DELAY,ground:null,x:f.x,y:f.y,lastHitBy:null});
  if(m.holdClean!==false)for(const o of m.fighters)if(o!==f&&(o.holding===f.seat)){o.holding=null;setState(o,'idle');}
}
function respawn(m,f){
  Object.assign(f,{x:ST(m).RESPAWN.x,y:ST(m).RESPAWN.y,vx:0,vy:0,kbx:0,kby:0,percent:m.phase==='sudden'?300:0,ground:null,facing:1,platformTimer:PLATFORM_FRAMES});
  landReset(f);setState(f,'respawn');emit(m,'respawn',{seat:f.seat});
}

// ---------- main step ----------
function stepFighter(m,f,canAct){
  if(f.state==='out')return;
  if(f.state==='dead'){if(--f.respawnTimer<=0)respawn(m,f);return;}
  pullInput(m,f);
  if(f.hitlag>0){f.hitlag--;return;} // presses stay buffered through hitlag
  f.sf++;
  if(f.intangible>0)f.intangible--;if(f.slow>0)f.slow--;
  if(f.revengeTimer>0&&--f.revengeTimer===0)f.revengeMult=1;if(f.invincible>0)f.invincible--;if(f.ledgeCooldown>0)f.ledgeCooldown--;
  if(!['spotdodge','roll','airdodge'].includes(f.state)){if(++f.dodgeIdle>=60){f.dodgeIdle=0;f.dodgeStale=Math.max(0,f.dodgeStale-1);}}
  if(f.state!=='shield'&&f.state!=='shieldbreak'&&f.state!=='dizzy')f.shieldHP=Math.min(F.SHIELD.max,f.shieldHP+F.SHIELD.regen);
  stepState(m,f,canAct);
  // A move plays its first frame on the frame its input is consumed.
  if(f.state==='move'&&f.move&&f.move.frame===0)stepMove(m,f);
  if(f.state==='move'&&f.move&&f.move.frame===0)stepMove(m,f); // chained move started inside the first step
  if(f.state==='landing'&&f.sf===0&&f.landingLag<=0)setState(f,'idle');
  physics(m,f);
  if(f.ground==null&&!['dead','out','ledge','respawn'].includes(f.state))f.airtime++;
  tryLedge(m,f);
  ageBuffer(f);
  if(!['dead','out'].includes(f.state)&&ST(m).outOfBounds(f.x,f.y+A(f).height/2))ko(m,f);
}
function step(m){
  if(m.paused||m.phase==='results')return;
  m.frame++;m.phaseFrame++;
  if(m.phase==='countdown'){
    for(const f of m.fighters){pullInput(m,f);f.buffer.length=0;}
    if(m.phaseFrame%60===1&&m.phaseFrame<COUNTDOWN)emit(m,'countdown',{n:3-Math.floor(m.phaseFrame/60)});
    if(m.phaseFrame>=COUNTDOWN){m.phase='fight';m.phaseFrame=0;emit(m,'go');}
    return;
  }
  if(m.phase==='game'){if(m.phaseFrame>=GAME_FREEZE)finish(m);return;}
  const canAct=m.phase==='fight'||m.phase==='sudden';
  for(const f of m.fighters)stepFighter(m,f,canAct);
  pushApart(m);
  stepProjectiles(m);
  resolveCombat(m);
  if(m.phase==='fight'){
    if(--m.timeLeft<=0){m.timeLeft=0;emit(m,'time');toGame(m,'time');return;}
    if(m.fighters.some(f=>f.state==='out'))toGame(m,'stocks');
  }else if(m.phase==='sudden'){
    if(m.fighters.some(f=>f.state==='out'||f.state==='dead'))toGame(m,'sudden');
    else if(m.phaseFrame>=SUDDEN_LIMIT)toGame(m,'draw');
  }
}
function toGame(m,reason){m.phase='game';m.phaseFrame=0;m.pending=reason;emit(m,'game',{reason});}
function finish(m){
  const [a,b]=m.fighters,reason=m.pending;
  let winner=null;
  if(reason==='stocks'||reason==='sudden'){const alive=m.fighters.filter(f=>f.state!=='out'&&f.state!=='dead');winner=alive.length===1?alive[0].seat:null;}
  else if(reason==='time'){
    if(a.stocks!==b.stocks)winner=a.stocks>b.stocks?0:1;
    else if(Math.abs(a.percent-b.percent)>1e-9)winner=a.percent<b.percent?0:1;
    else return startSudden(m);
  }
  m.phase='results';m.phaseFrame=0;m.result={winner,reason:reason==='draw'?'draw':reason,frame:m.frame};emit(m,'results',{winner});
}
function startSudden(m){
  m.phase='sudden';m.phaseFrame=0;m.sudden=true;m.projectiles=[];
  m.fighters.forEach((f,i)=>{Object.assign(f,newFighter(i,f.style,1,m.stage),{percent:300,stale:f.stale});});
  emit(m,'sudden');
}

// ---------- test / tool helpers ----------
function place(m,seat,{x=0,y=0,facing=1,percent,meter,air=false,keepCounters=false}={}){
  const f=m.fighters[seat];
  const keep=keepCounters?{ledgeGrabs:f.ledgeGrabs,airtime:f.airtime,dodgeStale:f.dodgeStale,stale:f.stale,tethers:f.tethers}:{};
  Object.assign(f,{x,y,vx:0,vy:0,kbx:0,kby:0,facing,hitlag:0,hitstun:0,move:null,act:null,holding:null,grabbedBy:null,ledge:null,intangible:0,invincible:0,ledgeCooldown:0,through:0,fastFalling:false,pendingAirJump:0});
  if(percent!=null)f.percent=percent;
  if(meter!=null)f.meter=meter;
  f.ground=null;
  if(!air)for(const id of ST(m).SURFACES){const s=SURF(m,id);if(Math.abs(y-s.y)<0.01&&x>=s.x0&&x<=s.x1){f.ground=id;break;}}
  if(!keepCounters)landReset(f);
  Object.assign(f,keep);
  setState(f,f.ground!=null?'idle':'air');
}
const events=m=>m.events;
const lastHit=(m,seat)=>m.lastHits[seat];
const stats=(m,seat)=>m.stats[seat];

// ---------- snapshot ----------
function snapshot(m){return JSON.parse(JSON.stringify(m));}
function restore(s){return JSON.parse(JSON.stringify(s));}
const PHASES=['countdown','fight','game','sudden','results'];
const STATES=new Set(['idle','walk','run','crouch','jumpsquat','air','landing','move','shield','shielddrop','spotdodge','roll','airdodge','hitstun','down','act','ledge','helpless','shieldbreak','dizzy','lag','holding','grabbed','inhaled','respawn','dead','out']);
function validSnapshot(s){
  const num=v=>typeof v==='number'&&Number.isFinite(v);
  if(!s||s.v!==1||!St.STAGES[s.stage]||!PHASES.includes(s.phase)||!num(s.frame)||!num(s.timeLeft)||!Array.isArray(s.fighters)||s.fighters.length!==2)return false;
  for(const f of s.fighters){
    if(!f||!STYLES[f.style]||!STATES.has(f.state))return false;
    for(const k of ['x','y','vx','vy','kbx','kby','percent','stocks','sf','shieldHP'])if(!num(f[k]))return false;
    if(Math.abs(f.x)>1e4||Math.abs(f.y)>1e4||f.percent<0||f.percent>999||f.stocks<0||f.stocks>99)return false;
    if(f.move&&!STYLES[f.style].moves[f.move.id])return false;
  }
  if(!Array.isArray(s.projectiles)||s.projectiles.length>8)return false;
  for(const p of s.projectiles)if(!p||!num(p.x)||!num(p.y)||!STYLES[p.style]?.projectiles[p.type])return false;
  return Array.isArray(s.events)&&s.events.length<=64;
}

module.exports={create,step,setInput,resetInputBaseline,place,events,lastHit,stats,isIntangible,snapshot,restore,validSnapshot,
  STYLES,DERIVED,activeBoxes,hurtbox,COUNTDOWN};
