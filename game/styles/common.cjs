'use strict';
// Shared helpers for style data files.
const hb=o=>({r:8,angle:45,bkb:40,kbg:60,...o});
// Apply knockback parameters solved by tools/calibrate.cjs. Keys: move id →
// { hitbox index | 'hit' | 'plungeHit' | 'counter' | 'proj:<type>' → {bkb,kbg} }.
function applySolved(moves,projectiles,solved){
  for(const [id,list] of Object.entries(solved||{})){
    for(const [k,v] of Object.entries(list)){
      let box=null;
      if(k.startsWith('proj:'))box=projectiles[k.slice(5)]?.hit;
      else{const mv=moves[id];if(!mv)continue;box=k==='hit'?mv.hit:k==='plungeHit'?mv.plungeHit:k==='counter'?mv.counter?.hit:k==='spit'?mv.spit?.hit:mv.hitboxes?.[Number(k)];}
      if(box){box.bkb=v.bkb;box.kbg=v.kbg;
        // Both-side smashes and tipper moves share one set of knockback parameters.
        if(k==='0'&&(id==='dsmash'||moves[id]?.tipper))for(const b of moves[id].hitboxes){b.bkb=v.bkb;b.kbg=v.kbg;}}
    }
  }
  for(const [id,m] of Object.entries(moves))m.id=id;
}
module.exports={hb,applySolved};
