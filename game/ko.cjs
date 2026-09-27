'use strict';
// KO-percent measurement (SPEC §5.2): the smallest pre-hit percent at which a move's
// launch trajectory crosses a blast zone before the launch speed decays to zero.
// Target: same style, passive (no input). Move: fresh, attacker at 0 %, uncharged
// unless the scenario says otherwise. Moves are started through real inputs.
const M=require('./match.cjs'),I=require('./input.cjs'),St=require('./stage.cjs');

const LEDGE_X=St.MAIN.x1-5;
const T=(style,label,move,percent,extra={})=>({style,label,move,percent,...extra});
const TARGETS=[
  // 🧀 奶酪大锤 (SPEC §5.2)
  T('hammer','侧强','ftilt',160),T('hammer','上强','utilt',130),T('hammer','冲刺攻击','dash',110),
  T('hammer','侧重击（中央）','fsmash',86),T('hammer','侧重击（台边）','fsmash',62,{spot:'ledge'}),
  T('hammer','上重击','usmash',105),T('hammer','下重击','dsmash',110),T('hammer','前空','fair',140),
  T('hammer','上空（对手在正上方空中）','uair',125),T('hammer','后投（台边）','bthrow',150,{spot:'ledge'}),
  T('hammer','蓄力大锤（蓄满）','downB',60,{full:true}),
  // 🐾 猫爪拳 (SPEC §5A.1)
  T('cat','侧重击（中央）','fsmash',125),T('cat','侧重击（台边）','fsmash',95,{spot:'ledge'}),
  T('cat','上重击','usmash',110),T('cat','下重击','dsmash',135),T('cat','侧B 猫扑','sideB',160),
  // 🧶 毛线球法师 (SPEC §5A.2)
  T('mage','上强','utilt',140),T('mage','侧重击（中央）','fsmash',115),T('mage','侧重击（台边）','fsmash',88,{spot:'ledge'}),
  T('mage','上重击','usmash',120),T('mage','下重击','dsmash',125),T('mage','毛线球（蓄满）','nspecial',100,{full:true}),
  // 🥷 纸箱忍者 (SPEC §5A.3)
  T('ninja','侧重击（中央）','fsmash',100),T('ninja','侧重击（台边）','fsmash',78,{spot:'ledge'}),
  T('ninja','上重击','usmash',102),T('ninja','下重击','dsmash',112),T('ninja','前空','fair',150),
  T('ninja','后投（台边）','bthrow',160,{spot:'ledge'}),T('ninja','侧B 瞬身斩','sideB',140),T('ninja','下B 替身纸箱','downB',115,{counter:true}),
  // 🪶 逗猫棒剑士 (SPEC §5B.1) — sword moves measured on the tip
  T('sword','侧重击剑尖（中央）','fsmash',100),T('sword','侧重击剑尖（台边）','fsmash',72,{spot:'ledge'}),T('sword','上重击','usmash',115),
  T('sword','下重击剑尖','dsmash',125),T('sword','前空剑尖','fair',155),T('sword','蓄力突刺（蓄满）','nspecial',115,{full:true}),
  // 💪 肉垫摔角手 (SPEC §5B.2)
  T('grappler','侧重击（中央）','fsmash',108),T('grappler','侧重击（台边）','fsmash',80,{spot:'ledge'}),T('grappler','上重击','usmash',110),
  T('grappler','下重击','dsmash',112),T('grappler','侧B 绳索摔','sideB',125),T('grappler','后投（台边）','bthrow',135,{spot:'ledge'}),
  // 🥊 拳击喵 (SPEC §5B.3)
  T('boxer','侧重击（中央）','fsmash',106),T('boxer','侧重击（台边）','fsmash',80,{spot:'ledge'}),T('boxer','上重击','usmash',108),
  T('boxer','下重击','dsmash',125),T('boxer','侧B 大摆拳','sideB',150),T('boxer','必杀拳','koPunch',45),
  // ⚡ 疾风猫 (SPEC §5B.4)
  T('swift','侧重击（中央）','fsmash',98),T('swift','侧重击（台边）','fsmash',73,{spot:'ledge'}),T('swift','上重击','usmash',115),
  T('swift','下重击','dsmash',115),T('swift','前空膝撞甜点','fair',115),T('swift','疾风重拳','nspecial',65),T('swift','下B 疾风踢','downB',135),
];
// Returns true if the target is KOed by the launch.
function launches(t,percent,{trace=false}={}){
  const style=t.style||'hammer';
  const m=M.create({countdown:false,timeLimit:600,styles:[style,style]});
  const H=M.STYLES[style].moves,h=M.STYLES[style].attrs.height;
  const pa=I.create(),pb=I.create();
  const run=n=>{for(let i=0;i<n;i++){M.setInput(m,0,pa);M.setInput(m,1,pb);M.step(m);}};
  const tx=t.spot==='ledge'?LEDGE_X:0;
  const f=m.fighters,atk=f[0],tgt=f[1];
  switch(t.move){
    case 'fair':{
      // Start high enough that the attacker is still airborne (just above the floor) on the first active frame.
      const b=H.fair.hitboxes[0],A=M.STYLES[style].attrs;let drop=0;for(let k=1;k<=b.frames[0];k++)drop+=Math.min(A.fall,k*A.gravity);
      M.place(m,1,{x:tx,y:0,facing:-1,percent});M.place(m,0,{x:tx-b.x,y:drop+2,facing:1,air:true});pa.x=1;I.press(pa,'attack');run(1);pa.x=0;break;
    }
    case 'uair':{const b=H.uair.hitboxes[0];M.place(m,0,{x:tx-b.x,y:40,facing:1,air:true});M.place(m,1,{x:tx,y:40+b.y-h/2,facing:-1,air:true,percent});pa.y=1;I.press(pa,'attack');run(1);pa.y=0;break;}
    case 'dash':{
      // Run in from the left and press J at a distance that connects.
      M.place(m,1,{x:tx,y:0,facing:-1,percent});M.place(m,0,{x:tx-60,y:0,facing:1});
      pa.x=1;pa.run=1;let pressed=false;
      for(let i=0;i<200&&tgt.percent===percent;i++){
        if(!pressed&&atk.state==='run'&&tx-atk.x<=t.pressAt){I.press(pa,'attack');pressed=true;}
        if(pressed&&atk.state==='move'){pa.x=0;pa.run=0;}
        run(1);
      }
      break;
    }
    case 'bthrow':{
      // Thrower stands at the ledge with its back to the blast zone.
      M.place(m,0,{x:LEDGE_X,y:0,facing:-1});M.place(m,1,{x:LEDGE_X-14,y:0,facing:1,percent});
      I.press(pa,'grab');for(let i=0;i<30&&tgt.state!=='grabbed';i++)run(1);
      if(tgt.state!=='grabbed')throw Error('bthrow setup: no grab');
      run(4);pa.x=1;I.press(pa,'right');run(1);pa.x=0;break;
    }
    case 'downB':{
      if(t.counter){
        // The target attacks into the counter: it stands at the spot and swings a side tilt.
        const b=H.ftilt.hitboxes[0];M.place(m,1,{x:tx,y:0,facing:-1,percent});M.place(m,0,{x:tx-b.x,y:0,facing:1});
        pb.x=-1;I.press(pb,'attack');run(1);pb.x=0;pa.y=-1;I.press(pa,'special');run(1);pa.y=0;break;
      }
      const b=H.downB.hitboxes[0];M.place(m,0,{x:tx-b.x,y:0,facing:1});M.place(m,1,{x:tx,y:0,facing:-1,percent});
      if(H.downB.type==='lunge'){pa.y=-1;I.press(pa,'special');run(1);pa.y=0;break;}
      pa.y=-1;I.press(pa,'special');pa.h.special=1;run(1);pa.y=0;run(14+(t.full?H.downB.chargeMax:0));pa.h.special=0;break;
    }
    case 'koPunch':{
      const b=H.koPunch.hitboxes[0];M.place(m,0,{x:tx-b.x,y:0,facing:1,meter:100});M.place(m,1,{x:tx,y:0,facing:-1,percent});
      I.press(pa,'special');run(1);break;
    }
    case 'nspecial':{
      const mv=H.nspecial;
      if(mv.type==='chargeSwing'){const b=mv.hitboxes[0];M.place(m,0,{x:tx-b.x,y:0,facing:1});M.place(m,1,{x:tx,y:0,facing:-1,percent});
        I.press(pa,'special');pa.h.special=1;run(mv.windup+(t.full?mv.chargeMax:0));pa.h.special=0;break;}
      if(mv.type!=='shot'){const b=mv.hitboxes[0];M.place(m,0,{x:tx-b.x,y:0,facing:1});M.place(m,1,{x:tx,y:0,facing:-1,percent});I.press(pa,'special');run(1);break;}
      // Full charge shot from 40 units away.
      M.place(m,0,{x:tx-40,y:0,facing:1});M.place(m,1,{x:tx,y:0,facing:-1,percent});
      const c=H.nspecial.charge;I.press(pa,'special');pa.h.special=1;run(c.enter+(t.full?c.max:0));pa.h.special=0;break;
    }
    case 'sideB':{
      const mv=H.sideB,b=mv.hitboxes?.[0];
      if(mv.type==='inhale'){M.place(m,1,{x:tx,y:0,facing:-1,percent});M.place(m,0,{x:tx-mv.inhale.x,y:0,facing:1});pa.x=1;I.press(pa,'special');run(1);pa.x=0;break;}
      if(mv.type==='sneak'){M.place(m,0,{x:tx-(mv.sneak.dist[0]+b.x),y:0,facing:1});M.place(m,1,{x:tx,y:0,facing:-1,percent});pa.x=1;I.press(pa,'special');pa.h.special=1;run(1);pa.x=0;pa.h.special=0;break;}
      M.place(m,1,{x:tx,y:0,facing:-1,percent});M.place(m,0,{x:tx-b.x,y:0,facing:1});pa.x=1;I.press(pa,'special');run(1);pa.x=0;break;
    }
    default:{
      // Bodies can't overlap (they push apart), so start no closer than touching.
      const mv=H[t.move],b=mv.hitboxes[0],touch=2*M.STYLES[style].attrs.radius;
      M.place(m,1,{x:tx,y:0,facing:-1,percent});M.place(m,0,{x:tx-Math.max(b.x,touch),y:0,facing:1});
      if(t.move==='utilt'){pa.y=1;I.press(pa,'attack');}
      else if(t.move==='usmash'){pa.y=1;I.press(pa,'smash');}
      else if(t.move==='dsmash'){pa.y=-1;I.press(pa,'smash');}
      else if(t.move==='fsmash'){pa.x=1;I.press(pa,'smash');}
      else if(t.move==='ftilt'){pa.x=1;I.press(pa,'attack');}
      else throw Error('no scenario for '+t.move);
      run(1);pa.x=0;pa.y=0;
    }
  }
  // Wait for the hit, then follow the launch.
  let hit=false;
  for(let i=0;i<600;i++){
    if(!hit&&tgt.percent>percent+1e-9)hit=true;
    if(tgt.state==='dead'||tgt.state==='out')return hit;
    if(hit&&tgt.hitlag===0&&tgt.state!=='hitstun'&&tgt.kbx===0&&tgt.kby===0)return false;
    if(hit&&tgt.kbx===0&&tgt.kby===0&&tgt.hitstun===0)return false;
    run(1);
  }
  if(!hit)throw Error('scenario never hit: '+t.label);
  return false;
}
function measure(t,{lo=0,hi=400}={}){
  if(t.move==='dash'&&t.pressAt==null){
    // Find a press distance that connects (does not affect knockback).
    for(let d=16;d<=60;d+=2){try{launches({...t,pressAt:d},0);t={...t,pressAt:d};break;}catch{}}
  }
  if(!launches(t,hi))return null;
  if(launches(t,lo))return lo;
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(launches(t,mid))hi=mid;else lo=mid;}
  return hi;
}
module.exports={TARGETS,measure,launches,LEDGE_X};
