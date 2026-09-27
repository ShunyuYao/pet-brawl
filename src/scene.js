// Three.js world for the fight: stage, fighters, projectiles, effects and the camera.
// Pure presentation — it draws whatever the match state says (SPEC §2).
import * as THREE from '../vendor/lib/three.module.js';
import Stages from '../game/stage.cjs';
import M from '../game/match.cjs';
import {buildAvatar} from './avatars.js';
import {computePose} from './poses.js';

export const S=0.1; // world units per game unit
const canvasTex=(w,h,draw,{repeat,srgb=true}={})=>{const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);if(srgb)t.colorSpace=THREE.SRGBColorSpace;if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat);}t.anisotropy=4;return t;};

function wicker(g,w,h,a,b){g.fillStyle=a;g.fillRect(0,0,w,h);const n=8,cw=w/n,ch=h/n;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const over=(x+y)%2===0;g.fillStyle=over?b:a;g.beginPath();g.roundRect(x*cw+2,y*ch+2,cw-4,ch-4,cw*0.35);g.fill();
    g.fillStyle='rgba(255,255,255,.18)';g.fillRect(x*cw+4,y*ch+4,over?cw-8:4,over?4:ch-8);g.fillStyle='rgba(80,40,10,.18)';g.fillRect(x*cw+2,y*ch+ch-5,cw-4,3);}}
function knit(g,w,h,a,b){g.fillStyle=a;g.fillRect(0,0,w,h);const cw=w/8;for(let y=0;y<h;y+=cw*0.7)for(let x=0;x<w;x+=cw){g.fillStyle=(Math.floor(y/(cw*0.7))%4<2)?b:a;
  g.beginPath();g.ellipse(x+cw*0.28,y+cw*0.35,cw*0.22,cw*0.36,-0.5,0,7);g.fill();g.beginPath();g.ellipse(x+cw*0.72,y+cw*0.35,cw*0.22,cw*0.36,0.5,0,7);g.fill();}}

export function createWorld(canvas){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,400);
  scene.add(new THREE.HemisphereLight('#fff8ef','#b98fd8',1.35));
  const sun=new THREE.DirectionalLight('#fff1dc',2.0);sun.position.set(-8,20,14);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-14,right:14,top:12,bottom:-8,near:1,far:60});sun.shadow.bias=-.0008;scene.add(sun,sun.target);
  const rim=new THREE.DirectionalLight('#ffd1f0',0.7);rim.position.set(10,6,-10);scene.add(rim);
  let stage=buildStage(scene,Stages.DEFAULT);
  function setStage(id){id=Stages.get(id).id;if(stage.id===id)return;const t0=performance.now();stage.dispose();stage=buildStage(scene,id);cam.init=false;(window.__stageBuilds||=[]).push({id,ms:Math.round(performance.now()-t0),at:Math.round(t0)});}
  const fighters=new Map(),projectiles=new Map(),fx=makeFx(scene);
  const tagCache=new Map();
  const debug={on:false,group:new THREE.Group()};scene.add(debug.group);

  function nameTag(text,color){
    const key=text+color;if(tagCache.has(key))return tagCache.get(key).clone();
    const t=canvasTex(512,140,(c,w,h)=>{c.font='900 56px system-ui,"PingFang SC",sans-serif';const tw=Math.min(w-20,c.measureText(text).width+60);
      c.fillStyle='rgba(28,20,48,.78)';c.beginPath();c.roundRect((w-tw)/2,10,tw,74,37);c.fill();
      c.fillStyle=color;c.beginPath();c.moveTo(w/2-18,84);c.lineTo(w/2+18,84);c.lineTo(w/2,112);c.closePath();c.fill();
      c.fillStyle='#fff';c.textAlign='center';c.textBaseline='middle';c.fillText(text,w/2,49,w-60);});
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false,transparent:true,sizeAttenuation:false}));s.scale.set(.11,.03,1);s.center.set(.5,0);s.renderOrder=10;tagCache.set(key,s);return s.clone();
  }
  async function setFighter(seat,{profile,asset,fallback,label}){
    let k=fighters.get(seat);
    // Views arrive many times a second; a 3D doll takes longer than that to build.
    // Skip requests for what is already shown *or already loading*, otherwise every new
    // view would restart the build and it would never finish.
    const key=[profile.signature,profile.color,profile.name,label||'',profile.style||'hammer'].join('|');
    if(k&&(k.key===key||k.pendingKey===key))return;
    if(!k){k={seat};fighters.set(seat,k);}
    const token=Symbol();k.token=token;k.pendingKey=key;
    const height=M.STYLES[profile.style||'hammer'].attrs.height*S*1.05;
    const style=profile.style||'hammer';
    const avatar=await buildAvatar(asset,fallback,{height,style});
    if(k.token!==token){avatar.dispose?.();return;}
    if(k.root)scene.remove(k.root);k.avatar?.dispose?.();
    const root=new THREE.Group();root.add(avatar.object);scene.add(root);
    // Short indicator (1P / 2P / CPU); full names live on the HUD plates.
    const tag=nameTag(label||profile.name.slice(0,6),profile.color);tag.position.y=height+0.35;root.add(tag);
    const shield=new THREE.Mesh(new THREE.SphereGeometry(1,28,18),new THREE.MeshBasicMaterial({color:profile.color,transparent:true,opacity:.32,depthWrite:false,blending:THREE.AdditiveBlending}));shield.position.y=height*0.5;shield.visible=false;root.add(shield);
    const halo=new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.9,0.12,32),new THREE.MeshStandardMaterial({color:'#bff4ff',emissive:'#7fe7ff',emissiveIntensity:.9,transparent:true,opacity:.85}));halo.position.y=-0.06;halo.visible=false;root.add(halo);
    const swirl=new THREE.Mesh(new THREE.TorusGeometry(0.55,0.04,6,32),new THREE.MeshStandardMaterial({color:'#c9a6ff',emissive:'#8f6bff',emissiveIntensity:.5}));swirl.rotation.x=Math.PI/2;swirl.position.y=height*0.35;swirl.visible=false;root.add(swirl);
    const box=new THREE.Mesh(new THREE.BoxGeometry(height*0.62,height*0.55,height*0.5),new THREE.MeshStandardMaterial({color:'#c9965b',roughness:.95}));box.position.y=height*0.27;box.visible=false;box.castShadow=true;root.add(box);
    const tether=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:'#e0cfff'}));tether.visible=false;tether.frustumCulled=false;scene.add(tether);
    const stars=new THREE.Group();for(let i=0;i<3;i++){const s=new THREE.Mesh(new THREE.OctahedronGeometry(.12),new THREE.MeshBasicMaterial({color:'#ffe066'}));s.position.set(Math.cos(i*2.1)*.45,0,Math.sin(i*2.1)*.45);stars.add(s);}stars.position.y=height+0.1;stars.visible=false;root.add(stars);
    k.pendingKey=null;
    Object.assign(k,{key,label:label||'',root,avatar,tag,shield,halo,stars,swirl,box,tether,height,signature:profile.signature,color:profile.color,name:profile.name,kind:avatar.kind});
  }
  function removeFighter(seat){const k=fighters.get(seat);if(k?.root)scene.remove(k.root);fighters.delete(seat);}

  // ---------- camera ----------
  const cam={x:0,y:3,w:26,shake:0,init:false};
  function frameCamera(m,dt){
    const pts=[];if(m)for(const f of m.fighters)if(!['dead','out'].includes(f.state))pts.push([f.x*S,(f.y+11)*S]);
    let x0=-7,x1=7,y0=-1,y1=5;
    if(pts.length){x0=Math.min(...pts.map(p=>p[0]))-3;x1=Math.max(...pts.map(p=>p[0]))+3;y0=Math.min(-1,Math.min(...pts.map(p=>p[1]))-2.5);y1=Math.max(...pts.map(p=>p[1]))+3;
      // Always keep part of the stage in view.
      x0=Math.min(x0,stage.St.MAIN.x0*S*0.6);x1=Math.max(x1,stage.St.MAIN.x1*S*0.6);y1+=1.5;}
    // Reserve the bottom ~20 % of the screen for the HUD plates.
    const aspect=camera.aspect,span=Math.max((x1-x0)*1.08,(y1-y0)*1.28*aspect),w=Math.min(48,Math.max(19,span));
    const viewH=w/aspect,cx=Math.max(-12,Math.min(12,(x0+x1)/2)),cy=Math.max(1.2,Math.min(12,y1-viewH*0.46));
    const k=cam.init?Math.min(1,dt*3.5):1;cam.x+=(cx-cam.x)*k;cam.y+=(cy-cam.y)*k;cam.w+=(w-cam.w)*k;cam.init=true;
    const vf=camera.fov*Math.PI/180,hf=2*Math.atan(Math.tan(vf/2)*aspect),dist=(cam.w/2)/Math.tan(hf/2);
    cam.shake*=Math.pow(0.004,dt);const sx=(Math.random()-.5)*cam.shake,sy=(Math.random()-.5)*cam.shake;
    camera.position.set(cam.x+sx,cam.y+dist*0.14+sy,dist);camera.lookAt(cam.x+sx*0.5,cam.y-0.4,0);
  }

  // ---------- per frame ----------
  let clock=0,lastSeq=0;
  function update({match:m,dt,events=[]}){
    clock+=dt;
    if(m){setStage(m.stage);stage.update(m.frame);}
    for(const e of events){if(e.seq<=lastSeq)continue;lastSeq=e.seq;onEvent(e,m);}
    if(m)for(const f of m.fighters){
      const k=fighters.get(f.seat);if(!k?.root)continue;
      const P=computePose(f,{t:clock,style:f.style});
      k.root.visible=P.visible;
      const sh=P.shake?(Math.random()-.5)*P.shake*4:0;
      k.root.position.set(f.x*S+sh,f.y*S+(f.state==='ledge'?0:0),0);
      k.avatar.update(dt,P,f.facing);
      k.shield.visible=P.fx.shield>0;if(k.shield.visible){const r=(0.45+0.95*P.fx.shield)*k.height*0.55;k.shield.scale.setScalar(r);k.shield.material.opacity=0.18+0.25*P.fx.shield;}
      k.halo.visible=P.fx.platform;
      k.stars.visible=P.fx.dizzy;k.stars.rotation.y+=dt*6;
      k.swirl.visible=P.visible&&P.fx.slow;k.swirl.rotation.z+=dt*5;k.swirl.position.y=k.height*(0.35+0.15*Math.sin(clock*6));
      k.box.visible=P.fx.box;if(P.fx.box)k.box.rotation.z=(P.roll||0)*-f.facing;
      k.tether.visible=!!P.fx.tether;if(P.fx.tether){const L=stage.St.LEDGES[f.x>0?1:0],pos=k.tether.geometry.attributes.position;pos.setXYZ(0,f.x*S,(f.y+15)*S,0.2);pos.setXYZ(1,L.x*S,L.y*S,0.2);pos.needsUpdate=true;}
      const powered=f.revengeMult>1||f.meter>=100;
      k.avatar.hammer?.setGlow?.(Math.max(P.fx.charge*(0.55+0.45*Math.sin(clock*20)),P.fx.armor?0.35:0,P.fx.counter?0.6+0.4*Math.sin(clock*25):0,powered?0.45+0.3*Math.sin(clock*8):0));
      // 蓄怒 stored (flames) / 能量满 (gold sparks): visible to both players so the threat is readable.
      if(P.visible&&f.revengeMult>1&&Math.random()<0.25+0.2*(f.revengeMult-1))fx.sparks.emit(f.x*S+(Math.random()-.5)*1.4,(f.y+4+Math.random()*16)*S,0.3,(Math.random()-.5),2+Math.random()*2,0,'#ff5a2a',.45);
      if(P.visible&&f.meter>=100&&Math.random()<0.35)fx.sparks.emit(f.x*S+(Math.random()-.5)*1.4,(f.y+4+Math.random()*16)*S,0.3,(Math.random()-.5),1.5+Math.random()*2,0,'#ffd23f',.4);
      k.tag.visible=P.visible&&f.state!=='respawn';
      if(P.fx.charge>0&&Math.random()<P.fx.charge)fx.sparks.emit(f.x*S+(Math.random()-.5),(f.y+18)*S+(Math.random()-.5),0.4,(Math.random()-.5)*2,2+Math.random()*2,0,'#ffd23f',.35);
      if(P.fx.trail>0.2&&Math.random()<P.fx.trail)fx.sparks.emit(f.x*S,(f.y+11)*S,0,(Math.random()-.5),(Math.random()-.5),0,'#ffffff',.5);
      if(P.fx.inhale&&Math.random()<.8){const a=Math.random()*6.28,r=1.6;fx.sparks.emit(f.x*S+f.facing*1.2+Math.cos(a)*r,(f.y+11)*S+Math.sin(a)*r,0.2,-Math.cos(a)*4,-Math.sin(a)*4,0,'#c9f1ff',.3);}
    }
    syncProjectiles(m?m.projectiles:[],dt);
    fx.update(dt);
    drawDebug(m);
    frameCamera(m,dt);
    renderer.render(scene,camera);
  }
  function onEvent(e,m){
    const at=(x,y)=>new THREE.Vector3(x*S,y*S,0.4);
    switch(e.type){
      case 'hit':{const p=at(e.x,e.y),big=Math.min(1,(e.kb||0)/140);fx.burst(p,6+Math.round(e.dmg*1.5),big>0.6?'#ff6a3d':'#ffd23f',2+big*6);fx.ring(p,big>0.6?'#ffffff':'#fff3b0',0.6+big*1.4);cam.shake=Math.max(cam.shake,0.08+big*0.5);break;}
      case 'shield':fx.burst(at(e.x,e.y),8,'#8fd3ff',3);break;
      case 'parry':fx.ring(at(e.x,e.y),'#ffffff',2.2);fx.burst(at(e.x,e.y),20,'#ffffff',6);break;
      case 'ko':fx.koBlast(e.x*S,e.y*S);cam.shake=Math.max(cam.shake,1.1);break;
      case 'slam':fx.dust(e.x*S,0,24,'#f3e1c2');cam.shake=Math.max(cam.shake,0.3);break;
      case 'land':case 'knockdown':case 'bounce':break;
      case 'shieldbreak':fx.ring(at(e.x??0,11),'#8fd3ff',2.5);cam.shake=0.4;break;
      case 'reflect':fx.burst(at(e.x,e.y),14,'#ffffff',4);break;
      case 'counter':fx.ring(at(e.x,e.y),'#9ee7ff',2.6);fx.burst(at(e.x,e.y),24,'#ffffff',6);cam.shake=Math.max(cam.shake,0.35);break;
      case 'vanish':case 'appear':fx.smoke(e.x*S,e.y*S);break;
      case 'trip':fx.burst(at(e.x,e.y),12,'#c9a6ff',3);break;
      case 'slow':{const k=fighters.get(e.seat);if(k)k.slowT=1;break;}
      case 'break':fx.burst(at(e.x,e.y),14,'#c9a6ff',4);break;
      case 'armor':{const f=m?.fighters[e.seat];if(f)fx.burst(at(f.x,f.y+11),10,'#ffe8a3',3);break;}
      case 'revenge':{const f=m?.fighters[e.seat];if(f){fx.ring(at(f.x,f.y+11),'#ff5a2a',2.2);fx.burst(at(f.x,f.y+11),18,'#ff8a3d',5);}break;}
      case 'kopunch':{const f=m?.fighters[e.seat];if(f){fx.ring(at(f.x,f.y+11),'#ffd23f',2.8);cam.shake=Math.max(cam.shake,0.3);}break;}
    }
  }
  const wheelMat=new THREE.MeshStandardMaterial({color:'#ffd23f',roughness:.5}),starMat=new THREE.MeshStandardMaterial({color:'#fff3a0',emissive:'#ffb400',emissiveIntensity:.8});
  const yarnMat=new THREE.MeshStandardMaterial({color:'#b48cff',roughness:.95,emissive:'#8f6bff',emissiveIntensity:.35});
  const clawMat=new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.85,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false});
  const steelMat=new THREE.MeshStandardMaterial({color:'#dfe6f2',metalness:.6,roughness:.25,emissive:'#7fd3ff',emissiveIntensity:.25});
  function starShape(inner,outer,points=5){const sh=new THREE.Shape();for(let i=0;i<points*2;i++){const r=i%2?inner:outer,a=i/(points*2)*Math.PI*2+Math.PI/2;i?sh.lineTo(Math.cos(a)*r,Math.sin(a)*r):sh.moveTo(Math.cos(a)*r,Math.sin(a)*r);}return sh;}
  function makeProjectile(p){
    switch(p.type){
      case 'wheel':{const o=new THREE.Group();const c=new THREE.Mesh(new THREE.CylinderGeometry(.62,.62,.42,26),wheelMat);c.rotation.x=Math.PI/2;c.castShadow=true;o.add(c);
        for(let i=0;i<5;i++){const h=new THREE.Mesh(new THREE.CircleGeometry(.1+Math.random()*.06,12),new THREE.MeshStandardMaterial({color:'#e3a324'}));const a=i*1.26;h.position.set(Math.cos(a)*.35,Math.sin(a)*.35,.215);o.add(h);}return o;}
      case 'star':return new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(.3,.7),{depth:.2,bevelEnabled:false}),starMat);
      case 'claw':{const o=new THREE.Group();for(let i=0;i<3;i++){const arc=new THREE.Mesh(new THREE.RingGeometry(.5,.6,20,1,-0.9,1.8),clawMat);arc.position.x=-i*.18;arc.position.y=(i-1)*.22;o.add(arc);}return o;}
      case 'yarnball':{const o=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),yarnMat);o.userData.scaleR=true;return o;}
      case 'thread':{const o=new THREE.Group();const b=new THREE.Mesh(new THREE.SphereGeometry(.28,14,10),yarnMat);o.add(b);
        const tail=new THREE.Mesh(new THREE.TorusGeometry(.5,.035,6,24,Math.PI*1.4),new THREE.MeshStandardMaterial({color:'#e0cfff'}));tail.position.x=-.4;o.add(tail);return o;}
      case 'trap':{const o=new THREE.Group();const web=new THREE.Mesh(new THREE.CircleGeometry(.8,6),new THREE.MeshStandardMaterial({color:'#c9a6ff',transparent:true,opacity:.75,side:THREE.DoubleSide}));web.rotation.x=-Math.PI/2;web.position.y=.03;o.add(web);
        for(let i=0;i<3;i++){const r=new THREE.Mesh(new THREE.TorusGeometry(.25+i*.2,.02,4,6),new THREE.MeshStandardMaterial({color:'#ffffff'}));r.rotation.x=-Math.PI/2;r.position.y=.05;o.add(r);}return o;}
      case 'shuriken':{const o=new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(.25,1,4),{depth:.12,bevelEnabled:false}),steelMat);o.userData.scaleR=true;return o;}
    }
    return new THREE.Mesh(new THREE.SphereGeometry(.4),starMat);
  }
  function syncProjectiles(list,dt){
    const seen=new Set();
    for(const p of list){
      seen.add(p.id);let o=projectiles.get(p.id);
      if(!o){o=makeProjectile(p);projectiles.set(p.id,o);scene.add(o);}
      o.position.set(p.x*S,p.y*S,0.1);
      if(o.userData.scaleR){const r=(p.r||4)*S;o.scale.setScalar(p.type==='shuriken'?r:r);}
      if(p.type==='trap'){o.visible=true;o.children[0].material.opacity=(p.age||0)>=30?0.8:0.35;}
      else if(p.type==='claw')o.scale.x=p.vx>0?1:-1;
      else o.rotation.z-=dt*(p.vx>0?8:-8)*(p.type==='shuriken'?2:1);
    }
    for(const [id,o] of projectiles)if(!seen.has(id)){scene.remove(o);projectiles.delete(id);fx.burst(o.position,8,'#ffd23f',3);}
  }
  function drawDebug(m){
    debug.group.visible=debug.on;if(!debug.on||!m)return;
    debug.group.clear();
    const circ=(x,y,r,color)=>{const g=new THREE.BufferGeometry().setFromPoints(Array.from({length:33},(_,i)=>new THREE.Vector3((x+Math.cos(i/32*6.283)*r)*S,(y+Math.sin(i/32*6.283)*r)*S,0.6)));debug.group.add(new THREE.Line(g,new THREE.LineBasicMaterial({color,depthTest:false})));};
    for(const f of m.fighters){if(['dead','out'].includes(f.state))continue;const h=M.hurtbox(f);circ(h.x,h.y0,h.r,'#4ade80');circ(h.x,h.y1,h.r,'#4ade80');
      for(const b of M.activeBoxes(f))circ(f.x+b.box.x*f.facing,f.y+b.box.y,b.box.r,'#ff3b3b');}
  }
  function resize(){const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  resize();addEventListener('resize',resize);
  return {setFighter,removeFighter,update,resize,renderer,setStage,stageId:()=>stage.id,
    setDebug:v=>{debug.on=!!v;},
    resetEvents:(seq=0)=>{lastSeq=seq;},
    diagnostics:()=>({stage:stage.id,stageObjects:stage.group.children.length,movingX:stage.moving?.position.x??null,fighters:[...fighters].map(([seat,k])=>({seat,kind:k.kind,name:k.name,visible:!!k.root?.visible,ragdoll:k.avatar?.isRagdoll?.()||false,x:k.root?.position.x})),
      projectiles:projectiles.size,camera:{x:cam.x,y:cam.y,w:cam.w},particles:fx.alive(),calls:renderer.info.render.calls}),
    destroy(){removeEventListener('resize',resize);renderer.dispose();}};
}

// ---------- stages (SPEC §8) ----------
// Each builder puts everything into its own group so the world can swap stages
// between matches; a moving platform is returned as `moving` and positioned per frame.
function buildCourt(scene,g,St){
  const sky=canvasTex(16,512,(c,w,h)=>{const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#8ec5ff');g.addColorStop(.45,'#ffc9e5');g.addColorStop(.8,'#ffe8c2');g.addColorStop(1,'#fff6e6');c.fillStyle=g;c.fillRect(0,0,w,h);});
  scene.background=sky;scene.fog=new THREE.Fog('#ffd9ec',60,140);
  const M0=St.MAIN,w=(M0.x1-M0.x0)*S,depth=4.2;
  // Main stage: a woven basket slab with a tapered wicker underside.
  const top=canvasTex(256,256,(g,W,H)=>wicker(g,W,H,'#e8b777','#d49a55'),{repeat:[w/2.5,depth/2.5]});
  const side=canvasTex(256,256,(g,W,H)=>wicker(g,W,H,'#d9a25f','#c1843f'),{repeat:[w/2.5,1]});
  const slab=new THREE.Mesh(new THREE.BoxGeometry(w,0.7,depth),[new THREE.MeshStandardMaterial({map:side,roughness:.9}),new THREE.MeshStandardMaterial({map:side,roughness:.9}),new THREE.MeshStandardMaterial({map:top,roughness:.85}),new THREE.MeshStandardMaterial({color:'#b77a3a'}),new THREE.MeshStandardMaterial({map:side,roughness:.9}),new THREE.MeshStandardMaterial({map:side,roughness:.9})]);
  slab.position.set(0,-0.35,0);slab.receiveShadow=true;slab.castShadow=true;g.add(slab);
  const under=new THREE.Mesh(new THREE.CylinderGeometry(w*0.62,w*0.28,Math.abs(M0.bottom)*S-0.7,4,1,false,Math.PI/4),new THREE.MeshStandardMaterial({map:side,roughness:.95}));
  under.scale.set(1,1,depth/(w*0.62*1.41));under.position.set(0,-0.7-(Math.abs(M0.bottom)*S-0.7)/2,0);under.receiveShadow=true;g.add(under);
  const trim=new THREE.Mesh(new THREE.TorusGeometry(1,.05,8,48),new THREE.MeshStandardMaterial({color:'#ff7aa8',roughness:.6}));trim.scale.set(w/2+0.02,0.4,depth/2+0.02);trim.rotation.x=Math.PI/2;trim.position.y=-0.02;g.add(trim);
  // Ledge tassels
  for(const L of St.LEDGES){const t=new THREE.Mesh(new THREE.ConeGeometry(.18,.6,10),new THREE.MeshStandardMaterial({color:'#ff7aa8'}));t.rotation.z=Math.PI;t.position.set(L.x*S,-0.55,depth/2);g.add(t);}
  // Soft platforms: knitted scarves on wooden boards with buttons.
  const knitTex=canvasTex(256,64,(g,W,H)=>knit(g,W,H,'#9b7bff','#ffcf4a'),{repeat:[2,1]});
  for(const p of St.PLATFORMS){
    const pw=(p.x1-p.x0)*S,cx=(p.x0+p.x1)/2*S;
    const board=new THREE.Mesh(new THREE.BoxGeometry(pw,0.18,depth*0.7),new THREE.MeshStandardMaterial({map:knitTex,roughness:.95}));board.position.set(cx,p.y*S-0.09,0);board.castShadow=true;board.receiveShadow=true;g.add(board);
    for(const s of [-1,1]){const b=new THREE.Mesh(new THREE.CylinderGeometry(.14,.14,.06,16),new THREE.MeshStandardMaterial({color:'#ff5a6a'}));b.rotation.x=Math.PI/2;b.position.set(cx+s*pw*0.4,p.y*S-0.09,depth*0.35+0.03);g.add(b);}
  }
  // Backdrop: giant yarn balls with knitting needles, clouds and a crochet sun.
  const yarnCols=['#ff7fb0','#8f6bff','#50c8ff','#ffd166','#6ee7b7'];
  let seed=7;const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
  for(let i=0;i<9;i++){
    const r=2+rnd()*3.5,x=(i-4)*9+(rnd()-.5)*4,y=-6+rnd()*7,z=-18-rnd()*16;
    const t=canvasTex(128,64,(c,W,H)=>{c.fillStyle=yarnCols[i%5];c.fillRect(0,0,W,H);c.strokeStyle='rgba(255,255,255,.45)';c.lineWidth=3;for(let k=-4;k<14;k++){c.beginPath();c.moveTo(k*10,0);c.bezierCurveTo(k*10+18,20,k*10-8,44,k*10+14,H);c.stroke();}});
    const ball=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),new THREE.MeshStandardMaterial({map:t,roughness:1}));ball.position.set(x,y,z);ball.rotation.set(rnd()*3,rnd()*3,rnd()*3);g.add(ball);
    if(i%3===0)for(const s of [-1,1]){const n=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,r*3.2,8),new THREE.MeshStandardMaterial({color:'#dcdce6',metalness:.4,roughness:.3}));n.position.set(x,y+r*0.4,z+0.5);n.rotation.z=s*0.5;g.add(n);}
  }
  const cloudM=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,transparent:true,opacity:.9});
  for(let i=0;i<10;i++){const c=new THREE.Group();for(let k=0;k<4;k++){const b=new THREE.Mesh(new THREE.SphereGeometry(1.6+rnd()*1.6,12,10),cloudM);b.position.set(k*2-3,rnd(),rnd());c.add(b);}c.position.set((rnd()-.5)*90,10+rnd()*14,-40-rnd()*20);g.add(c);}
  const sunT=canvasTex(256,256,(c,W,H)=>{c.fillStyle='#ffe07a';c.beginPath();c.arc(W/2,H/2,W*0.42,0,7);c.fill();c.strokeStyle='#ffb84a';c.lineWidth=8;for(let r=30;r<W*0.42;r+=22){c.beginPath();c.arc(W/2,H/2,r,0,7);c.stroke();}});
  const sunM=new THREE.Mesh(new THREE.CircleGeometry(6,48),new THREE.MeshBasicMaterial({map:sunT,transparent:true}));sunM.position.set(-26,22,-70);g.add(sunM);
}


const seeded=seed=>()=>((seed=(seed*16807)%2147483647)/2147483647);
function skyTex(stops){return canvasTex(16,512,(c,w,h)=>{const g=c.createLinearGradient(0,0,0,h);stops.forEach(([t,col])=>g.addColorStop(t,col));c.fillStyle=g;c.fillRect(0,0,w,h);});}
function cheese(g,w,h,base,hole){g.fillStyle=base;g.fillRect(0,0,w,h);g.fillStyle='rgba(255,255,255,.22)';g.fillRect(0,0,w,h*0.08);
  const r=seeded(3);for(let i=0;i<14;i++){const x=r()*w,y=r()*h,rr=4+r()*12;g.fillStyle=hole;g.beginPath();g.arc(x,y,rr,0,7);g.fill();g.fillStyle='rgba(120,60,0,.22)';g.beginPath();g.arc(x+2,y+2,rr*0.7,0,7);g.fill();}}

// 🧀 奶酪月台: one wide cheese slab floating in a starry dusk, a cheese moon behind.
function buildMoon(scene,g,St){
  scene.background=skyTex([[0,'#1b1440'],[.45,'#4a2d7a'],[.8,'#c46bb0'],[1,'#ffb38a']]);scene.fog=new THREE.Fog('#5a3a86',70,160);
  const M0=St.MAIN,w=(M0.x1-M0.x0)*S,depth=4.6;
  const top=canvasTex(256,256,(c,W,H)=>cheese(c,W,H,'#ffd23f','#f0a92a'),{repeat:[w/3,depth/3]});
  const side=canvasTex(256,256,(c,W,H)=>cheese(c,W,H,'#f5b92b','#d98c1e'),{repeat:[w/3,1]});
  const mat=new THREE.MeshStandardMaterial({map:side,roughness:.7}),topM=new THREE.MeshStandardMaterial({map:top,roughness:.6});
  const slab=new THREE.Mesh(new THREE.BoxGeometry(w,0.8,depth),[mat,mat,topM,mat,mat,mat]);slab.position.y=-0.4;slab.receiveShadow=slab.castShadow=true;g.add(slab);
  const hgt=Math.abs(M0.bottom)*S-0.8;
  const wedge=new THREE.Mesh(new THREE.CylinderGeometry(w*0.5,w*0.08,hgt,4,1,false,Math.PI/4),new THREE.MeshStandardMaterial({map:side,roughness:.75}));
  wedge.scale.set(1,1,depth/(w*0.5*1.41));wedge.position.y=-0.8-hgt/2;g.add(wedge);
  const rim=new THREE.Mesh(new THREE.BoxGeometry(w+0.06,0.1,depth+0.06),new THREE.MeshStandardMaterial({color:'#8f6bff',emissive:'#6a4bff',emissiveIntensity:.6}));rim.position.y=-0.78;g.add(rim);
  for(const L of St.LEDGES){const t=new THREE.Mesh(new THREE.OctahedronGeometry(.22),new THREE.MeshStandardMaterial({color:'#bff4ff',emissive:'#7fe7ff',emissiveIntensity:.8}));t.position.set(L.x*S,-0.5,depth/2);g.add(t);}
  const moon=new THREE.Mesh(new THREE.SphereGeometry(9,40,28),new THREE.MeshStandardMaterial({map:canvasTex(256,128,(c,W,H)=>cheese(c,W,H,'#ffe07a','#e8b04a')),roughness:1,emissive:'#ffcf6a',emissiveIntensity:.25}));moon.position.set(22,14,-80);g.add(moon);
  const rnd=seeded(11),starG=new THREE.BufferGeometry(),pts=[];for(let i=0;i<500;i++)pts.push((rnd()-.5)*260,-10+rnd()*90,-60-rnd()*60);
  starG.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));g.add(new THREE.Points(starG,new THREE.PointsMaterial({color:'#fff6d8',size:.35})));
  for(let i=0;i<6;i++){const r=1+rnd()*2.5,c=new THREE.Mesh(new THREE.SphereGeometry(r,20,14),new THREE.MeshStandardMaterial({color:['#ff9ecb','#8fd3ff','#ffd166','#b48cff'][i%4],roughness:.9}));c.position.set((rnd()-.5)*120,-8+rnd()*40,-40-rnd()*40);g.add(c);
    if(i%2===0){const ring=new THREE.Mesh(new THREE.TorusGeometry(r*1.6,r*0.08,6,40),new THREE.MeshStandardMaterial({color:'#fff3c4'}));ring.position.copy(c.position);ring.rotation.x=1.2;g.add(ring);}}
  return {};
}

// 🐟 猫薄荷小镇: a grassy town square; the fish-sign plank shuttles side to side.
function buildTown(scene,g,St){
  scene.background=skyTex([[0,'#6ec3ff'],[.55,'#bfe8ff'],[.85,'#f4ffe0'],[1,'#fffbe8']]);scene.fog=new THREE.Fog('#d8f1ff',70,160);
  const M0=St.MAIN,w=(M0.x1-M0.x0)*S,depth=4.4;
  const grass=canvasTex(128,128,(c,W,H)=>{c.fillStyle='#7ccf5a';c.fillRect(0,0,W,H);const r=seeded(5);for(let i=0;i<260;i++){c.fillStyle=r()<.5?'#6bbb4a':'#94dd6d';c.fillRect(r()*W,r()*H,2,5);}},{repeat:[w/2,depth/2]});
  const dirt=canvasTex(128,128,(c,W,H)=>{c.fillStyle='#b9855a';c.fillRect(0,0,W,H);const r=seeded(6);for(let i=0;i<60;i++){c.fillStyle='rgba(90,50,20,.35)';c.beginPath();c.arc(r()*W,r()*H,2+r()*5,0,7);c.fill();}},{repeat:[w/3,1]});
  const dm=new THREE.MeshStandardMaterial({map:dirt,roughness:1});
  const slab=new THREE.Mesh(new THREE.BoxGeometry(w,0.9,depth),[dm,dm,new THREE.MeshStandardMaterial({map:grass,roughness:.95}),dm,dm,dm]);slab.position.y=-0.45;slab.receiveShadow=slab.castShadow=true;g.add(slab);
  const hgt=Math.abs(M0.bottom)*S-0.9,rock=new THREE.Mesh(new THREE.CylinderGeometry(w*0.52,w*0.2,hgt,7),dm);rock.scale.z=depth/(w*1.04)*1.2;rock.position.y=-0.9-hgt/2;g.add(rock);
  for(const L of St.LEDGES){const f=new THREE.Mesh(new THREE.SphereGeometry(.2,10,8),new THREE.MeshStandardMaterial({color:'#ff7aa8'}));f.position.set(L.x*S,0.1,depth/2-0.2);g.add(f);}
  // Moving plank: wood with a little fish sign on each end.
  const p=St.moving,pw=p.half*2*S,plank=new THREE.Group();
  const wood=new THREE.Mesh(new THREE.BoxGeometry(pw,0.22,depth*0.6),new THREE.MeshStandardMaterial({color:'#c98a4b',roughness:.85}));wood.position.y=-0.11;wood.castShadow=wood.receiveShadow=true;plank.add(wood);
  for(const s of [-1,1]){const fish=new THREE.Mesh(new THREE.SphereGeometry(.28,14,10),new THREE.MeshStandardMaterial({color:'#50c8ff'}));fish.scale.set(1.5,0.8,0.4);fish.position.set(s*pw*0.38,-0.35,depth*0.3+0.05);plank.add(fish);
    const tail=new THREE.Mesh(new THREE.ConeGeometry(.2,.3,4),fish.material);tail.rotation.z=Math.PI/2*s;tail.position.set(s*pw*0.38+s*0.5,-0.35,depth*0.3+0.05);plank.add(tail);}
  plank.position.y=p.y*S;g.add(plank);
  // Town backdrop: hills, cat houses with ear roofs, catnip bushes, clouds.
  const rnd=seeded(9);
  for(let i=0;i<5;i++){const h=new THREE.Mesh(new THREE.SphereGeometry(14+rnd()*10,24,16),new THREE.MeshStandardMaterial({color:['#8fdc6e','#6fc95a','#a6e37f'][i%3],roughness:1}));h.position.set((i-2)*26+(rnd()-.5)*8,-16,-60-rnd()*20);g.add(h);}
  const wallCols=['#fff1d6','#ffd9e8','#dff3ff','#fff7b8'],roofCols=['#ff7a6a','#8f6bff','#50b0ff','#ff9f43'];
  for(let i=0;i<7;i++){
    const x=(i-3)*9+(rnd()-.5)*3,z=-26-rnd()*10,hs=2+rnd()*1.2,house=new THREE.Group();
    const body=new THREE.Mesh(new THREE.BoxGeometry(hs*1.3,hs,hs),new THREE.MeshStandardMaterial({color:wallCols[i%4],roughness:.9}));body.position.y=hs/2;house.add(body);
    const roofM=new THREE.MeshStandardMaterial({color:roofCols[i%4],roughness:.8});
    const roof=new THREE.Mesh(new THREE.ConeGeometry(hs*0.95,hs*0.8,4),roofM);roof.rotation.y=Math.PI/4;roof.position.y=hs+hs*0.4;house.add(roof);
    for(const s of [-1,1]){const ear=new THREE.Mesh(new THREE.ConeGeometry(hs*0.22,hs*0.45,4),roofM);ear.position.set(s*hs*0.4,hs*1.75,0);house.add(ear);}
    const win=new THREE.Mesh(new THREE.CircleGeometry(hs*0.18,16),new THREE.MeshStandardMaterial({color:'#ffe98a',emissive:'#ffd23f',emissiveIntensity:.4}));win.position.set(0,hs*0.55,hs/2+0.01);house.add(win);
    house.position.set(x,-6+rnd()*2,z);g.add(house);
  }
  for(let i=0;i<12;i++){const b=new THREE.Mesh(new THREE.SphereGeometry(1+rnd()*1.2,12,10),new THREE.MeshStandardMaterial({color:'#4fb06a',roughness:1}));b.position.set((rnd()-.5)*90,-5+rnd()*2,-18-rnd()*14);g.add(b);}
  const cloudM=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,transparent:true,opacity:.95});
  for(let i=0;i<8;i++){const c=new THREE.Group();for(let k=0;k<4;k++){const b=new THREE.Mesh(new THREE.SphereGeometry(1.6+rnd()*1.6,12,10),cloudM);b.position.set(k*2-3,rnd(),rnd());c.add(b);}c.position.set((rnd()-.5)*90,12+rnd()*12,-45-rnd()*20);g.add(c);}
  return {moving:plank};
}
const BUILD={court:buildCourt,moon:buildMoon,town:buildTown};
function buildStage(scene,id){
  const St=Stages.get(id),g=new THREE.Group();g.name='stage:'+St.id;
  const extra=BUILD[St.id](scene,g,St)||{};scene.add(g);
  return {id:St.id,St,group:g,moving:extra.moving||null,
    update(frame){if(this.moving){const s=St.surface(St.moving.index+1,frame);this.moving.position.x=(s.x0+s.x1)/2*S;}},
    dispose(){scene.remove(g);g.traverse(o=>{o.geometry?.dispose?.();});}};
}

// ---------- effects ----------
function makeFx(scene){
  const N=900,geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3);
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  const points=new THREE.Points(geo,new THREE.PointsMaterial({size:.16,vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));points.frustumCulled=false;scene.add(points);
  const parts=Array.from({length:N},()=>({life:0,x:0,y:-999,z:0,vx:0,vy:0,vz:0,c:new THREE.Color(),g:9}));let next=0;
  const sparks={emit(x,y,z,vx,vy,vz,color,life=.35,g=6){const p=parts[next];next=(next+1)%N;Object.assign(p,{x,y,z,vx,vy,vz,life,g});p.c.set(color);}};
  const rings=[],beams=[];
  return {sparks,
    burst(p,n,color,speed){for(let i=0;i<n;i++){const a=Math.random()*6.283,s=speed*(0.4+Math.random()*0.8);sparks.emit(p.x,p.y,p.z,Math.cos(a)*s,Math.sin(a)*s,(Math.random()-.5)*2,color,.25+Math.random()*.3,4);}},
    dust(x,y,n,color){for(let i=0;i<n;i++){const s=(Math.random()<.5?-1:1)*(2+Math.random()*5);sparks.emit(x,y+0.1,(Math.random()-.5),s,Math.random()*1.5,(Math.random()-.5),color,.5,1);}},
    smoke(x,y){for(let i=0;i<26;i++){const a=Math.random()*6.283,s=1+Math.random()*2.5;sparks.emit(x+(Math.random()-.5)*.6,y+(Math.random()-.5)*.8,0.3,Math.cos(a)*s,Math.sin(a)*s+1,0,['#e9e4f5','#cfc6e8','#ffffff'][i%3],.5,-1);}},
    ring(p,color,size){const m=new THREE.Mesh(new THREE.RingGeometry(.2,.32,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));m.position.copy(p);scene.add(m);rings.push({m,t:0,size});},
    koBlast(x,y){
      // A column of light shooting back from where the fighter left the stage.
      const cx=Math.max(-20,Math.min(20,x)),cy=Math.max(-10,Math.min(16,y)),dir=Math.atan2(cy-2,cx);
      const g=new THREE.Mesh(new THREE.ConeGeometry(2.2,26,24,1,true),new THREE.MeshBasicMaterial({color:'#ffe7a8',transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
      g.position.set(cx,cy,-1);g.rotation.z=dir+Math.PI/2;scene.add(g);beams.push({m:g,t:0});
      for(let i=0;i<70;i++){const a=dir+Math.PI+(Math.random()-.5)*1.2,s=6+Math.random()*14;sparks.emit(cx,cy,0,Math.cos(a)*s,Math.sin(a)*s,(Math.random()-.5)*4,['#ffffff','#ffd23f','#ff7aa8','#8fd3ff'][i%4],.8,2);}
    },
    update(dt){
      parts.forEach((p,i)=>{if(p.life>0){p.life-=dt;p.vy-=p.g*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;}const alive=p.life>0;pos[i*3]=p.x;pos[i*3+1]=alive?p.y:-999;pos[i*3+2]=p.z;col[i*3]=p.c.r;col[i*3+1]=p.c.g;col[i*3+2]=p.c.b;});
      geo.attributes.position.needsUpdate=true;geo.attributes.color.needsUpdate=true;
      for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.t+=dt;const k=r.t/0.28;r.m.scale.setScalar(1+k*r.size*4);r.m.material.opacity=Math.max(0,.95*(1-k));if(k>=1){scene.remove(r.m);rings.splice(i,1);}}
      for(let i=beams.length-1;i>=0;i--){const b=beams[i];b.t+=dt;b.m.material.opacity=Math.max(0,.9*(1-b.t/0.9));b.m.scale.set(1+b.t,1,1+b.t);if(b.t>0.9){scene.remove(b.m);beams.splice(i,1);}}
    },
    alive:()=>parts.filter(p=>p.life>0).length};
}
