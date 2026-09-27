'use strict';
// Quick headless match report: node tools/sim-match.cjs [levelA] [levelB] [seed]
const M=require('../game/match.cjs'),AI=require('../game/ai.cjs'),I=require('../game/input.cjs');
const [la=3,lb=3,seed=1]=process.argv.slice(2).map(Number);
const m=M.create({stocks:3,timeLimit:480,countdown:false});
const a=la?AI.create({level:la,seed}):null,b=AI.create({level:lb,seed:seed+1}),idle=I.create();
const counts={};let f=0;
while(m.phase!=='results'&&f<480*60+4000){M.setInput(m,0,a?a.think(m,0):idle);M.setInput(m,1,b.think(m,1));M.step(m);f++;
  for(const e of m.events)if(e.frame===m.frame)counts[e.type]=(counts[e.type]||0)+1;}
console.log({frames:f,seconds:(f/60).toFixed(1),phase:m.phase,result:m.result,stocks:m.fighters.map(x=>x.stocks),percent:m.fighters.map(x=>x.percent.toFixed(0)),stats:m.stats.map(s=>({kos:s.kos,sds:s.sds,dmg:s.damageDealt.toFixed(0),moves:s.attacksStarted}))});
console.log(counts);
