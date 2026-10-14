'use strict';
const {Script}=require('node:vm');
// Locate the entire render call, including nested observation callbacks. A
// first-closing-brace regexp truncates modern bundles and produces invalid JS.
function instrument(html){
  let count=0;
  html=html.replace(/[\w$]+\.update\(\{match:/g,(prefix,index,source)=>{
    const open=index+prefix.indexOf('(');let depth=1,quote='',escaped=false,end=open+1;
    for(;end<source.length&&depth;end++){
      const c=source[end];
      if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
      if(c==='"'||c==="'"||c==='`')quote=c;else if(c==='(')depth++;else if(c===')')depth--;
    }
    if(depth)throw Error('Unclosed render call');
    const args=source.slice(open+1,end-1);if(!args.includes('events:'))return prefix;
    count++;return `globalThis.__brawlRenderProbe?.(${args}),${prefix}`;
  });
  if(count!==1)throw Error('Expected one actual world render call, got '+count);
  let polls=0,closings=0;
  html=html.replace(/await ([\w$]+)\.poll\(/g,(_,receiver)=>{polls++;return '(await globalThis.__brawlPollDelay?.(), await '+receiver+'.poll(';})
    .replace(/waitMs:1e3\}\);/g,()=>{closings++;return 'waitMs:1e3}));';});
  if(polls!==1||closings!==polls)throw Error('Expected exactly one real SDK poll delay seam');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if(!script)throw Error('Missing bundled executable');new Script(script);
  return html;
}
module.exports={instrument};
