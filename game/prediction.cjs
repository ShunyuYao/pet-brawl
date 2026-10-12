'use strict';
// A receipt ACK is not a simulation clock. Keep pending input lifetime separate
// from its scheduled simulation frame and from the prediction target.
const M=require('./match.cjs'),I=require('./input.cjs');
const same=(a,b)=>a.x===b.x&&a.y===b.y&&a.run===b.run&&I.HELD.every(k=>a.h[k]===b.h[k])&&I.PRESSES.every(k=>a.c[k]===b.c[k]);
function create(){
 let predicted=null,matchNo=-1,history=[],wasPaused=false,lastReset=null,overflow=false,catchup=0,slowTick=0;
 function tick(input){
  if(!predicted||wasPaused||predicted.phase==='results')return;
  // Recover excess prediction lead without rewinding a simulated world. A new
  // control still predicts immediately; held input may yield one tick in six.
  if(catchup>0&&same(input,predicted.inputs[1])&&++slowTick%6===0){catchup--;return;}
  history.push({frame:predicted.frame+1,input:I.clone(input)});
  if(history.length>240){history.shift();overflow=true;}
  M.setInput(predicted,1,input);M.step(predicted);
 }
 function reconcile(view,{reset=null}={}){
  const previous=predicted;
  if(!view.match){predicted=null;history=[];matchNo=view.matchNo;wasPaused=false;overflow=false;lastReset='no-match';return;}
  const base=M.restore(view.match),paused=!!view.pause||!!base.paused;
  const reason=reset||(!previous?'initial':view.matchNo!==matchNo?'round':previous.stage!==base.stage?'stage':paused?'paused':wasPaused?'resume':base.phase==='results'?'results':overflow?'history-gap':null);
  history=reason?[]:history.filter(h=>h.input.seq>view.ack);
  // Repeated held samples already represented by the authority add no new
  // command. Keeping them would turn the 200ms heartbeat into artificial lead.
  while(history.length&&same(history[0].input,base.inputs[1]))history.shift();
  // An authority frame can overtake an input still in transit. Keep that
  // pending command and its successors in order, after the snapshot; dropping
  // it by frame alone would restart attacks at every arriving snapshot.
  let next=base.frame+1;
  for(const h of history){h.frame=Math.max(h.frame,next);next=h.frame+1;}
  const target=reason?base.frame:Math.max(previous.frame,base.frame,next-1);
  catchup=reason?0:Math.max(0,target-base.frame-Math.max(2,history.length));
  if(reason)slowTick=0;
  if(!reason){let index=0;
   while(base.frame<target&&base.phase!=='results'){
    const h=history[index];
    // Normalization preserves the authoritative counters, including commands
    // received but not consumed yet. Never reset the applied-counter baseline.
    if(h&&h.frame===base.frame+1){M.setInput(base,1,h.input);index++;}
    M.step(base);
   }
  }
  overflow=false;
  predicted=base;matchNo=view.matchNo;wasPaused=paused;lastReset=reason;
 }
 return {tick,reconcile,live:()=>predicted,diagnostics:()=>({history:history.length,predictionReset:lastReset,predictionCatchup:catchup})};
}
module.exports={create};
