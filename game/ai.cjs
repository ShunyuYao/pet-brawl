'use strict';
// Computer player (SPEC §9). It only produces the same input objects a keyboard does:
// held directions/buttons plus press counters. Three levels differ in reaction time,
// defense and aggression. Deterministic for a given seed.
const I=require('./input.cjs'),St=require('./stage.cjs'),M=require('./match.cjs');

const LEVELS={
  0:null, // 木桩: stands still (training dummy)
  1:{react:22,shield:0.15,aggro:0.35,smashAt:110,edgeguard:0},
  2:{react:12,shield:0.35,aggro:0.6,smashAt:95,edgeguard:0.4},
  3:{react:6,shield:0.55,aggro:0.85,smashAt:85,edgeguard:0.8},
};
function create({level=2,seed=1}={}){
  if(level===0){const idle=I.create();return {think:()=>idle,level};}
  const L=LEVELS[level]||LEVELS[2];
  let s=(seed*2654435761)>>>0||1;
  const rnd=()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};
  const pad=I.create();
  let wait=0,plan=null,shieldFor=0,lastState='',ledgeWait=0,respawnWait=0,mash=0;
  const press=k=>I.press(pad,k);
  const release=()=>{pad.x=0;pad.y=0;pad.run=0;for(const k of I.HELD)pad.h[k]=0;};

  function think(m,seat){
    const ST=St.get(m.stage);
    const me=m.fighters[seat],op=m.fighters[1-seat],H=M.STYLES[me.style].moves;
    if(m.phase!=='fight'&&m.phase!=='sudden'){release();plan=null;return pad;}
    if(me.state==='dead'||me.state==='out'){release();return pad;}
    // Multi-frame plans (charge, jump → aerial, shield hold) run to completion.
    if(plan){if(plan(me,op)!==false)return pad;plan=null;}
    release();
    // Super jump rising outside the stage: cancel (S) into a helpless drift toward the ledge
    // instead of plunging straight into the pit.
    if(me.state==='move'&&me.move?.id==='upB'&&H.upB.type==='superjump'&&['rise','hang'].includes(me.move.phase)){
      // Project where the plunge will start: keep drifting home until the apex.
      const A=M.STYLES[me.style].attrs,left=Math.max(0,me.vy)/A.gravity+H.upB.hangFrames,projX=Math.abs(me.x)-A.airSpeed*1.2*left;
      pad.x=-Math.sign(me.x);
      if(projX>ST.MAIN.x1+6&&me.y>-5){pad.y=-1;press('down');}
      return pad;
    }
    if(me.state==='helpless'){pad.x=Math.abs(me.x)>ST.MAIN.x1-10?-Math.sign(me.x):0;return pad;}
    const dx=op.x-me.x,dy=op.y-me.y,dist=Math.abs(dx),face=Math.sign(dx)||me.facing;
    const opActive=op.state==='move'&&op.move&&M.activeBoxes(op).length>0;
    const opThreat=op.state==='move'&&op.move&&op.move.frame<20;
    const offstage=f=>f.ground==null&&(Math.abs(f.x)>ST.MAIN.x1+2||f.y<-4);

    switch(me.state){
      case 'respawn':if(++respawnWait>20+rnd()*40){respawnWait=0;pad.x=face;}return pad;
      case 'grabbed':case 'inhaled':case 'dizzy':if(++mash%3===0)press('attack');return pad;
      case 'holding':{
        // Throw toward the nearer blast zone.
        const toward=Math.sign(me.x)||1;
        if(wait++>6){wait=0;press(toward===me.facing?(me.facing>0?'right':'left'):(me.facing>0?'left':'right'));pad.x=toward;}
        return pad;
      }
      case 'ledge':{
        if(++ledgeWait<10+rnd()*30)return pad;ledgeWait=0;
        const r=rnd(),toward=-Math.sign(me.x);
        if(r<0.4){press(toward>0?'right':'left');pad.x=toward;}
        else if(r<0.6)press('attack');else if(r<0.8)press('shield');else press('jump');
        return pad;
      }
      case 'hitstun':return pad;
    }
    // ---------- recovery ----------
    if(offstage(me)){
      const home=-Math.sign(me.x)||1;pad.x=home;
      if(me.state==='air'){
        if(me.y<8&&me.vy<0.4&&me.jumpsLeft>0&&wait--<=0){press('jump');wait=10;}
        else if(me.jumpsLeft===0&&(!me.upBUsed||H.upB.type==='tether')){
          const L=ST.LEDGES[me.x>0?1:0],type=H.upB.type;
          if(type==='tether'){if(me.y<-8&&Math.hypot(L.x-me.x,L.y-me.y-15)<44){pad.y=1;press('special');}}
          else if(type==='launch'){
            // Aim the launch at a point just above the ledge; pick the closest of 8 directions.
            const tx=L.x-L.side*4-me.x,ty=8-me.y,dist=Math.hypot(tx,ty),reach=H.upB.launch.speed*H.upB.launch.frames;
            if((dist<=reach+6&&me.vy<=0.5)||me.y<-45){
              let best=[0,1],bd=-2;for(const [dx,dy] of [[1,0],[1,1],[0,1],[-1,1],[-1,0]]){const n=Math.hypot(dx,dy),d=(dx*tx+dy*ty)/(n*dist);if(d>bd){bd=d;best=[dx,dy];}}
              pad.x=best[0];pad.y=best[1];press('special');
            }
          }
          else if(me.y<-8){pad.y=1;press('special');}
        }
      }
      return pad;
    }
    if(wait>0){wait--;// keep drifting toward the opponent while waiting
      if(me.ground==null&&me.state==='air')pad.x=Math.abs(me.x)>ST.MAIN.x1-8?-Math.sign(me.x):face;
      return pad;}
    // ---------- defense ----------
    if(me.ground!=null&&(opActive||opThreat)&&dist<34&&rnd()<L.shield){
      shieldFor=8+Math.floor(rnd()*14);
      plan=()=>{pad.h.shield=1;if(--shieldFor<=0){pad.h.shield=0;wait=2;if(rnd()<0.5){press('grab');}return false;}};
      pad.h.shield=1;return pad;
    }
    const idleLike=['idle','walk','run','crouch','air','landing','shield'].includes(me.state);
    if(!idleLike)return pad;
    wait=Math.floor(L.react*(0.6+rnd()*0.8));
    // ---------- edgeguard ----------
    if(offstage(op)&&me.ground===0&&rnd()<L.edgeguard){
      const edge=Math.sign(op.x)*(ST.MAIN.x1-12);
      if(Math.abs(me.x-edge)>6){pad.x=Math.sign(edge-me.x);pad.run=1;wait=2;return pad;}
      me.facing!==Math.sign(op.x)&&(pad.x=Math.sign(op.x));
      if(op.y>-10&&op.y<30&&Math.abs(op.x-me.x)<34){pad.x=Math.sign(op.x);press('smash');}
      return pad;
    }
    // ---------- offense ----------
    if(op.state==='respawn'||op.invincible>0){ // nothing to hit: hold the center
      if(Math.abs(me.x)>20&&me.ground!=null){pad.x=-Math.sign(me.x);}wait=4;return pad;}
    if(me.ground==null){
      if(dist<22&&Math.abs(dy)<18){if(dy>8){pad.y=1;}else if(dy<-8)pad.y=-1;else pad.x=face;press('attack');}
      else pad.x=face;
      return pad;
    }
    if(op.state==='shield'&&dist<20){press('grab');return pad;}
    // Style kit (SPEC §5A): counters, zoning projectiles, approach specials, traps.
    const kit=M.STYLES[me.style].ai||{};
    // Counter only on a read: the opponent's hit must land after our window opens
    // (a fast jab would beat a slow counter and leave us wide open).
    if(kit.counter&&op.state==='move'&&op.move&&dist<32&&Math.abs(dy)<16){
      const om=M.STYLES[op.style].moves[op.move.id],first=om?.hitboxes?.[0]?.frames?.[0],win=H.downB.window;
      const until=first!=null?first-op.move.frame:-1;
      if(until>=win[0]&&until<=win[1]&&rnd()<0.3*L.aggro){pad.y=-1;press('special');return pad;}
    }
    const z=kit.zoning;
    if(z&&dist>=z.min&&dist<=z.max&&Math.abs(dy)<18&&rnd()<0.12*L.aggro){
      if(me.facing!==face)pad.x=face;
      press('special');
      if(z.hold){const hold=z.hold[0]+Math.floor(rnd()*(z.hold[1]-z.hold[0]+1));pad.h.special=1;let t=0;plan=()=>{pad.h.special=++t<hold+14?1:0;return t<hold+16;};}
      return pad;
    }
    if(kit.approach==='sideB'&&dist>32&&dist<80&&Math.abs(dy)<12&&rnd()<0.05*L.aggro){
      pad.x=face;press('special');
      if(H.sideB.type==='sneak'){pad.h.special=1;let t=0;const hold=5+Math.floor(rnd()*25);plan=()=>{pad.x=0;pad.h.special=++t<hold?1:0;return t<hold+2;};}
      return pad;
    }
    // v0.4 kits: sword chain, command grab, KO punch, swift punch / kick.
    if(kit.koPunch&&me.meter>=100&&dist<24&&Math.abs(dy)<12){if(me.facing!==face)pad.x=face;press('special');return pad;}
    if(kit.commandGrab&&dist<22&&Math.abs(dy)<10&&rnd()<(op.state==='shield'?0.7:0.35)*L.aggro){pad.x=face;press('special');return pad;}
    // Lariat (intangible on its first active frames) to beat an attack that is coming out.
    if(kit.lariat&&(opActive||opThreat)&&dist<20&&Math.abs(dy)<12&&rnd()<0.35*L.aggro){press('special');return pad;}
    if(kit.chainSide&&dist<22&&Math.abs(dy)<12&&rnd()<0.1*L.aggro){pad.x=face;press('special');let t=0;plan=()=>{pad.x=0;if(++t%12===0)press('special');return t<40;};return pad;}
    if(kit.punch&&dist>10&&dist<26&&Math.abs(dy)<12&&(['hitstun','down','landing','lag','dizzy','shieldbreak'].includes(op.state)||rnd()<0.01)){if(me.facing!==face)pad.x=face;press('special');return pad;}
    if(kit.kick&&dist>25&&dist<55&&Math.abs(dy)<10&&rnd()<0.04*L.aggro){if(me.facing!==face)pad.x=face;pad.y=-1;press('special');return pad;}
    if(kit.trap&&dist>55&&!m.projectiles.some(p=>p.owner===seat&&p.type==='trap')&&rnd()<0.03){pad.y=-1;press('special');return pad;}
    if(kit.thread&&dist>40&&dist<110&&Math.abs(dy)<14&&!m.projectiles.some(p=>p.owner===seat&&p.type==='thread')&&rnd()<0.03){pad.x=face;press('special');return pad;}
    // Platforms: climb to an opponent standing above, drop to one below.
    if(op.ground>0&&me.ground!==op.ground&&dy>20){
      const P=ST.surface(op.ground,m.frame),cx=Math.max(P.x0+6,Math.min(P.x1-6,op.x));
      if(Math.abs(me.x-cx)>10){pad.x=Math.sign(cx-me.x);pad.run=Math.abs(me.x-cx)>30?1:0;wait=2;return pad;}
      press('jump');pad.h.jump=1;let t=0;const target=op.ground;
      plan=(me2)=>{t++;pad.h.jump=t<8?1:0;pad.x=Math.sign(cx-me2.x)||0;
        if(t===22&&me2.y<P.y+4)press('jump');
        if(me2.ground===target||t>80||(t>6&&me2.ground===0))return false;};
      return pad;
    }
    if(me.ground>0&&dy<-20&&(op.ground===0||op.ground==null)){pad.y=-1;press('down');wait=10;return pad;}
    if(dy>16&&dist<22){
      if(rnd()<0.5){pad.y=1;press(rnd()<0.5?'attack':'smash');}
      else{press('jump');pad.h.jump=1;let t=0;plan=()=>{pad.h.jump=1;pad.x=face;if(++t===10){pad.y=1;press('attack');return false;}};}
      return pad;
    }
    // Pick among ground moves whose first hitbox reaches the opponent at this spacing.
    const reach=(id,i=0)=>{const b=H[id]?.hitboxes?.[i]||H[id]?.grab;if(!b)return false;const tx=dist,ty=dy+11;return Math.abs(tx-b.x)<=b.r+6&&Math.abs(ty-b.y)<=b.r+10;};
    const killRange=op.percent>=L.smashAt;
    const options=[];
    if(reach('jab1'))options.push(['jab',killRange?0.5:3]);
    if(reach('dtilt'))options.push(['dtilt',2]);
    if(reach('ftilt'))options.push(['ftilt',killRange?1:2.5]);
    if(reach('fsmash'))options.push(['fsmash',killRange?6:0.6]);
    if(reach('dsmash'))options.push(['dsmash',killRange?3:0.8]);
    if(reach('grab'))options.push(['grab',1.5]);
    if(H.downB.type==='chargeSwing'&&reach('downB')&&killRange)options.push(['downB',1.5]);
    if(options.length&&rnd()<L.aggro){
      let total=options.reduce((a,o)=>a+o[1],0),r=rnd()*total,pick=options[0][0];
      for(const [k,w] of options){if((r-=w)<=0){pick=k;break;}}
      if(me.facing!==face)pad.x=face;
      switch(pick){
        case 'jab':press('attack');break;
        case 'dtilt':pad.y=-1;press('attack');break;
        case 'ftilt':pad.x=face;press('attack');break;
        case 'fsmash':pad.x=face;press('smash');break;
        case 'dsmash':pad.y=-1;press('smash');break;
        case 'grab':press('grab');break;
        case 'downB':{pad.y=-1;press('special');pad.h.special=1;let t=0;const hold=10+Math.floor(rnd()*60);plan=()=>{pad.h.special=++t<hold?1:0;return t<hold+2;};break;}
      }
      return pad;
    }
    if(dist<8){pad.x=-face;wait=3;return pad;} // too close: step back to spacing
    // Approach, or throw a cheese wheel from afar.
    if(H.sideB.spawn?.type==='wheel'&&dist>70&&rnd()<0.08&&!m.projectiles.some(p=>p.owner===seat)){pad.x=face;press('special');return pad;}
    const edgeAhead=Math.abs(me.x+face*20)>ST.MAIN.x1-4;
    if(!edgeAhead){pad.x=face;pad.run=dist>40?1:0;}
    if(dist>30&&dist<45&&rnd()<L.aggro*0.3){pad.x=face;pad.run=1;let t=0;plan=()=>{pad.x=face;pad.run=1;if(++t===6){press('attack');return false;}};}
    wait=2;return pad;
  }
  return {think,level};
}
module.exports={create,LEVELS};
