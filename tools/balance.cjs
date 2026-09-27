'use strict';
// Style balance check (SPEC §5A.4): level-3 computers play every style pair
// (mirrors included), N matches each with sides alternating. A pair whose win rate
// falls outside 25%–75% means one style is clearly stronger. Writes artifacts/balance.json.
// Usage: node tools/balance.cjs [matchesPerPair=16]
const fs=require('node:fs'),path=require('node:path');
const M=require('../game/match.cjs'),AI=require('../game/ai.cjs');
const N=Number(process.argv[2]||16),styles=Object.keys(M.STYLES);
function play(a,b,seed){
  const m=M.create({stocks:3,timeLimit:480,countdown:false,styles:[a,b]});
  const p=[AI.create({level:3,seed:seed*2+1}),AI.create({level:3,seed:seed*2+2})];let f=0;
  while(m.phase!=='results'&&f<480*60+5000){for(const s of [0,1])M.setInput(m,s,p[s].think(m,s));M.step(m);f++;}
  return {winner:m.result?.winner??null,reason:m.result?.reason,seconds:Math.round(f/60),kos:m.stats.map(s=>s.kos),dmg:m.stats.map(s=>Math.round(s.damageDealt))};
}
const pairs=[],out={N,generated:new Date().toISOString(),pairs:[]};
for(let i=0;i<styles.length;i++)for(let j=i;j<styles.length;j++)pairs.push([styles[i],styles[j]]);
for(const [a,b] of pairs){
  let wa=0,wb=0,draws=0,secs=0;
  for(let k=0;k<N;k++){
    const swap=k%2===1,r=swap?play(b,a,k):play(a,b,k);secs+=r.seconds;
    const w=r.winner==null?null:(swap?1-r.winner:r.winner);
    if(w===0)wa++;else if(w===1)wb++;else draws++;
  }
  const rate=wa/Math.max(1,wa+wb);
  out.pairs.push({a,b,winsA:wa,winsB:wb,draws,winRateA:+rate.toFixed(3),avgSeconds:Math.round(secs/N),ok:a===b||(rate>=0.25&&rate<=0.75)});
}
const file=path.join(__dirname,'../artifacts/balance.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(out,null,2));
console.table(out.pairs);
if(out.pairs.some(p=>!p.ok)){console.error('balance check failed');process.exitCode=1;}
