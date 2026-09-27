// One held weapon per style (presentation only). Every weapon is built along +Y from
// the grip, so avatars aim it with the same pose angle whatever the style; each has
// setGlow(0..1) for charge / armor feedback.
import * as THREE from '../vendor/lib/three.module.js';

const tex=(w,h,draw)=>{const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;};
const cached=f=>{let v=null;return ()=>v??=f();};
const cheeseTex=cached(()=>tex(128,128,(g)=>{g.fillStyle='#ffd23f';g.fillRect(0,0,128,128);g.fillStyle='rgba(255,255,255,.25)';g.fillRect(0,0,128,18);
  for(const [x,y,r] of [[28,40,11],[80,30,8],[98,78,13],[46,92,9],[70,62,6],[16,100,6],[112,20,5]]){g.fillStyle='#e8a92a';g.beginPath();g.arc(x,y,r,0,7);g.fill();g.fillStyle='rgba(120,60,0,.25)';g.beginPath();g.arc(x+2,y+2,r*0.7,0,7);g.fill();}}));
const yarnTex=cached(()=>tex(128,64,(g,w,h)=>{g.fillStyle='#b48cff';g.fillRect(0,0,w,h);g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=3;for(let k=-4;k<14;k++){g.beginPath();g.moveTo(k*10,0);g.bezierCurveTo(k*10+18,20,k*10-8,44,k*10+14,h);g.stroke();}}));
const cardTex=cached(()=>tex(64,256,(g,w,h)=>{g.fillStyle='#c9965b';g.fillRect(0,0,w,h);g.strokeStyle='rgba(120,80,40,.35)';g.lineWidth=2;for(let y=0;y<h;y+=8){g.beginPath();g.moveTo(0,y);g.lineTo(w,y+4);g.stroke();}
  g.fillStyle='rgba(255,255,255,.18)';g.fillRect(4,0,6,h);g.fillStyle='#e9d9b5';g.fillRect(0,h*0.42,w,18);}));
const glowable=(...mats)=>v=>{for(const m of mats)m.emissiveIntensity=v*0.9;};

function hammer(L){
  const g=new THREE.Group();
  const wood=new THREE.MeshStandardMaterial({color:'#9b6a3f',roughness:.75});
  const cheese=new THREE.MeshStandardMaterial({map:cheeseTex(),roughness:.55,emissive:'#ffb000',emissiveIntensity:0});
  const rind=new THREE.MeshStandardMaterial({color:'#f2b61f',roughness:.5,emissive:'#ff8a00',emissiveIntensity:0});
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(L*0.035,L*0.04,L,10),wood);handle.position.y=L/2;handle.castShadow=true;g.add(handle);
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(L*0.05,L*0.05,L*0.22,10),new THREE.MeshStandardMaterial({color:'#e24a4a',roughness:.6}));grip.position.y=L*0.12;g.add(grip);
  const r=L*0.27,h=L*0.6,head=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24,1),[rind,cheese,cheese]);
  head.rotation.x=Math.PI/2;head.position.y=L;head.castShadow=true;g.add(head);
  for(const s of [-1,1]){const hole=new THREE.Mesh(new THREE.CircleGeometry(r*0.28,16),new THREE.MeshStandardMaterial({color:'#d8951f'}));hole.position.set(r*0.25,L+r*0.2,s*(h/2+0.002));if(s<0)hole.rotation.y=Math.PI;g.add(hole);}
  g.setGlow=glowable(cheese,rind);return g;
}
// 猫爪手套: a big padded paw on a short cuff, claws out.
function paw(L){
  const g=new THREE.Group(),fur=new THREE.MeshStandardMaterial({color:'#fff4e8',roughness:.9,emissive:'#ff9ecb',emissiveIntensity:0});
  const bean=new THREE.MeshStandardMaterial({color:'#ff8fb1',roughness:.6}),claw=new THREE.MeshStandardMaterial({color:'#f5f0ff',roughness:.3,metalness:.2});
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(L*0.2,L*0.22,L*0.35,14),new THREE.MeshStandardMaterial({color:'#ff7aa8',roughness:.7}));cuff.position.y=L*0.18;g.add(cuff);
  const palm=new THREE.Mesh(new THREE.SphereGeometry(L*0.34,20,14),fur);palm.scale.set(1,0.9,0.75);palm.position.y=L*0.62;palm.castShadow=true;g.add(palm);
  const pad=new THREE.Mesh(new THREE.SphereGeometry(L*0.15,14,10),bean);pad.scale.set(1.1,0.8,0.4);pad.position.set(0,L*0.56,L*0.24);g.add(pad);
  for(const [x,i] of [[-0.18,0],[0,1],[0.18,2]]){
    const toe=new THREE.Mesh(new THREE.SphereGeometry(L*0.09,10,8),bean);toe.scale.set(1,1,0.5);toe.position.set(x*L,L*0.84+(i===1?L*0.03:0),L*0.2);g.add(toe);
    const c=new THREE.Mesh(new THREE.ConeGeometry(L*0.04,L*0.2,8),claw);c.position.set(x*L,L*0.98+(i===1?L*0.03:0),L*0.05);g.add(c);
  }
  g.setGlow=glowable(fur);return g;
}
// 毛线球法杖: a knitting-needle wand topped with a yarn ball.
function wand(L){
  const g=new THREE.Group(),metal=new THREE.MeshStandardMaterial({color:'#d8dce8',metalness:.5,roughness:.3});
  const yarn=new THREE.MeshStandardMaterial({map:yarnTex(),roughness:.95,emissive:'#c9a6ff',emissiveIntensity:0});
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(L*0.025,L*0.03,L,10),metal);rod.position.y=L/2;rod.castShadow=true;g.add(rod);
  const knob=new THREE.Mesh(new THREE.SphereGeometry(L*0.05,10,8),new THREE.MeshStandardMaterial({color:'#ff7aa8'}));knob.position.y=0;g.add(knob);
  const ball=new THREE.Mesh(new THREE.SphereGeometry(L*0.2,20,14),yarn);ball.position.y=L*0.98;ball.castShadow=true;g.add(ball);
  const loop=new THREE.Mesh(new THREE.TorusGeometry(L*0.21,L*0.015,6,30),new THREE.MeshStandardMaterial({color:'#ffffff'}));loop.position.y=L*0.98;loop.rotation.x=1.1;g.add(loop);
  g.setGlow=glowable(yarn);return g;
}
// 纸板刀: a cardboard katana with a taped handle and a cardboard guard.
function katana(L){
  const g=new THREE.Group(),card=new THREE.MeshStandardMaterial({map:cardTex(),roughness:.95,emissive:'#7fd3ff',emissiveIntensity:0});
  const tape=new THREE.MeshStandardMaterial({color:'#3b3f55',roughness:.7});
  const handle=new THREE.Mesh(new THREE.BoxGeometry(L*0.07,L*0.26,L*0.07),tape);handle.position.y=L*0.13;g.add(handle);
  const guard=new THREE.Mesh(new THREE.BoxGeometry(L*0.22,L*0.04,L*0.14),new THREE.MeshStandardMaterial({color:'#a8753f'}));guard.position.y=L*0.27;g.add(guard);
  const blade=new THREE.Mesh(new THREE.BoxGeometry(L*0.1,L*0.72,L*0.025),card);blade.position.y=L*0.64;blade.castShadow=true;g.add(blade);
  const tip=new THREE.Mesh(new THREE.ConeGeometry(L*0.07,L*0.12,4),card);tip.scale.set(1,1,0.25);tip.position.y=L*1.06;g.add(tip);
  g.setGlow=glowable(card);return g;
}
// 逗猫棒: a slim rod with a string and a feather tuft at the tip (the "sword tip").
function teaser(L){
  const g=new THREE.Group(),rod=new THREE.MeshStandardMaterial({color:'#f2e6c9',roughness:.6});
  const feather=new THREE.MeshStandardMaterial({color:'#7fd3ff',roughness:.8,emissive:'#7fd3ff',emissiveIntensity:0});
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(L*0.035,L*0.035,L*0.22,10),new THREE.MeshStandardMaterial({color:'#5a6cff',roughness:.6}));grip.position.y=L*0.11;g.add(grip);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(L*0.014,L*0.022,L*0.84,8),rod);shaft.position.y=L*0.62;shaft.castShadow=true;g.add(shaft);
  const bell=new THREE.Mesh(new THREE.SphereGeometry(L*0.035,10,8),new THREE.MeshStandardMaterial({color:'#ffd23f',metalness:.6,roughness:.3}));bell.position.y=L*1.04;g.add(bell);
  for(let i=0;i<5;i++){const f=new THREE.Mesh(new THREE.ConeGeometry(L*0.035,L*0.2,6),feather);const a=(i-2)*0.35;f.position.set(Math.sin(a)*L*0.08,L*1.1+Math.cos(a)*L*0.08,0);f.rotation.z=-a;g.add(f);}
  g.setGlow=glowable(feather);return g;
}
// 肉垫护腕: a chunky wrestling wrist wrap with a big paw-pad fist.
function wrap(L){
  const g=new THREE.Group(),skin=new THREE.MeshStandardMaterial({color:'#ffb38a',roughness:.8,emissive:'#ff5a3d',emissiveIntensity:0});
  const band=new THREE.MeshStandardMaterial({color:'#e8453c',roughness:.6}),stripe=new THREE.MeshStandardMaterial({color:'#ffd23f',roughness:.6});
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(L*0.24,L*0.26,L*0.45,14),band);cuff.position.y=L*0.24;g.add(cuff);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(L*0.25,L*0.035,8,20),stripe);ring.rotation.x=Math.PI/2;ring.position.y=L*0.3;g.add(ring);
  const fist=new THREE.Mesh(new THREE.SphereGeometry(L*0.34,18,12),skin);fist.scale.set(1.05,0.95,0.85);fist.position.y=L*0.72;fist.castShadow=true;g.add(fist);
  const pad=new THREE.Mesh(new THREE.SphereGeometry(L*0.14,12,8),new THREE.MeshStandardMaterial({color:'#8a3b2a',roughness:.7}));pad.scale.set(1.2,.8,.4);pad.position.set(0,L*0.72,L*0.27);g.add(pad);
  g.setGlow=glowable(skin);return g;
}
// 拳击手套: a glossy red boxing glove.
function glove(L){
  const g=new THREE.Group(),red=new THREE.MeshStandardMaterial({color:'#e8323c',roughness:.3,metalness:.1,emissive:'#ffcc33',emissiveIntensity:0});
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(L*0.2,L*0.22,L*0.35,14),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.5}));cuff.position.y=L*0.18;g.add(cuff);
  const main=new THREE.Mesh(new THREE.SphereGeometry(L*0.36,20,14),red);main.scale.set(1,1.15,0.9);main.position.y=L*0.68;main.castShadow=true;g.add(main);
  const thumb=new THREE.Mesh(new THREE.SphereGeometry(L*0.13,12,8),red);thumb.position.set(L*0.26,L*0.56,L*0.12);g.add(thumb);
  const lace=new THREE.Mesh(new THREE.BoxGeometry(L*0.05,L*0.3,L*0.04),new THREE.MeshStandardMaterial({color:'#ffffff'}));lace.position.set(0,L*0.42,-L*0.2);g.add(lace);
  g.setGlow=glowable(red);return g;
}
// 疾风拳套: a dark fist with an orange flame wing that glows when charged.
function flame(L){
  const g=new THREE.Group(),fist=new THREE.MeshStandardMaterial({color:'#2c3350',roughness:.5,metalness:.2});
  const fire=new THREE.MeshStandardMaterial({color:'#ff8a1f',roughness:.4,emissive:'#ff5a00',emissiveIntensity:0,transparent:true,opacity:.9});
  const arm=new THREE.Mesh(new THREE.CylinderGeometry(L*0.16,L*0.18,L*0.4,12),new THREE.MeshStandardMaterial({color:'#e8453c',roughness:.6}));arm.position.y=L*0.2;g.add(arm);
  const f=new THREE.Mesh(new THREE.SphereGeometry(L*0.28,16,12),fist);f.scale.set(1,1.1,0.9);f.position.y=L*0.62;f.castShadow=true;g.add(f);
  for(const [x,h,a] of [[-0.12,0.5,0.35],[0,0.62,0],[0.12,0.5,-0.35]]){const c=new THREE.Mesh(new THREE.ConeGeometry(L*0.1,L*h,8),fire);c.position.set(x*L,L*0.62+L*h*0.35,-L*0.18);c.rotation.z=a;c.rotation.x=-0.5;g.add(c);}
  g.setGlow=glowable(fire);return g;
}
const BUILDERS={hammer:[hammer,1],cat:[paw,0.42],mage:[wand,0.95],ninja:[katana,1.05],sword:[teaser,1.2],grappler:[wrap,0.5],boxer:[glove,0.45],swift:[flame,0.42]};
// Rest angle while idle (pose.hammer.angle convention: 0 forward, π/2 up, π back).
export const REST={hammer:1.9,cat:0.35,mage:1.25,ninja:2.3,sword:1.1,grappler:0.5,boxer:0.6,swift:0.4};
export function makeWeapon(style,length){const [build,scale]=BUILDERS[style]||BUILDERS.hammer;const w=build(length*scale);w.userData.style=style;return w;}
export function makeHammer(length){return hammer(length);}
