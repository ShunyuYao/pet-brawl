// Full registered walk clip, read once through the existing experimental SDK.
// All frames share one crop: no per-frame rescaling or foot jitter.
export async function readWalkAsset(sdk,loadImage){
 const catalog=await sdk.getAnimationCatalog();
 const idle=catalog.states.find(s=>s.id==='idle')?.variants.find(v=>v.available);
 const walk=catalog.states.find(s=>s.id==='walk')?.variants.find(v=>v.available);
 if(!idle||!walk||walk.frameCount>120)return null;
 const still=await sdk.getAnimation({state:'idle',variant:idle.index,offset:0,limit:1,signature:catalog.signature});
 const frames=[];let offset=0;
 do{
  const page=await sdk.getAnimation({state:'walk',variant:walk.index,offset,signature:catalog.signature});
  if(page.signature!==catalog.signature||page.key!==catalog.key)throw Error('CHARACTER_ANIMATION_CHANGED');
  for(const f of page.frames){if(f.index!==frames.length)throw Error('CHARACTER_ANIMATION_INVALID');frames.push(f.dataUrl);}
  if(!page.frames.length||(page.nextOffset!==null&&page.nextOffset!==frames.length))throw Error('CHARACTER_ANIMATION_INVALID');offset=page.nextOffset;
 }while(offset!==null);
 if(frames.length!==walk.frameCount)throw Error('CHARACTER_ANIMATION_INVALID');
 if((await sdk.getAnimationCatalog()).signature!==catalog.signature)throw Error('CHARACTER_ANIMATION_CHANGED');
 const urls=[still.frames[0].dataUrl,...frames];if(urls.reduce((n,s)=>n+s.length,0)>32*1024*1024)throw Error('asset_too_large');
 const images=[];let pixels=0;
 for(const url of urls){const img=await loadImage(url);pixels+=img.naturalWidth*img.naturalHeight;if(pixels>32*1024*1024)throw Error('asset_too_large');images.push(img);}
 const W=images[0].naturalWidth,H=images[0].naturalHeight;
 if(images.some(i=>i.naturalWidth!==W||i.naturalHeight!==H))throw Error('CHARACTER_ANIMATION_INVALID');
 const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d',{willReadFrequently:true});
 let x0=W,y0=H,x1=0,y1=0;
 for(const img of images){g.clearRect(0,0,W,H);g.drawImage(img,0,0);const data=g.getImageData(0,0,W,H).data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(data[(y*W+x)*4+3]>16){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
 if(x1<=x0||y1<=y0)throw Error('CHARACTER_ANIMATION_INVALID');
 x0=Math.max(0,x0-4);y0=Math.max(0,y0-4);x1=Math.min(W,x1+5);y1=Math.min(H,y1+5);
 const w=x1-x0,h=y1-y0;
 // Spatial detail is a quality floor, not a knob for satisfying a network
 // budget. Preserve every registered frame; vary codec quality only. The host
 // sends bounded, paced frames concurrently with realtime game input.
 const scale=Math.min(1,384/Math.max(w,h));c.width=Math.round(w*scale);c.height=Math.round(h*scale);
 for(const quality of [.86,.78,.7]){
  const encoded=images.map(img=>{g.clearRect(0,0,c.width,c.height);g.drawImage(img,x0,y0,w,h,0,0,c.width,c.height);return c.toDataURL('image/webp',quality);});
  const asset={kind:'sprite',frames:[encoded[0]],fps:0,face:idle.face??1,aspect:c.width/c.height,walk:{frames:encoded.slice(1),fps:walk.fps,loop:walk.loop,face:walk.face??1}};
  if(JSON.stringify(asset).length<=900*1024)return {asset,key:catalog.key,name:catalog.name};
 }
 throw Error('asset_too_large');
}
export function walkState(state){return state==='walk'||state==='run';}
export function animationFrame(clip,seconds){const n=Math.floor(Math.max(0,seconds)*(clip.fps||0));return clip.loop===false?Math.min(n,clip.frames.length-1):n%clip.frames.length;}
