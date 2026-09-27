// Fighters' bodies. Three kinds share one interface (SPEC §2):
//   const a = await buildAvatar(asset, fallback, {height});
//   a.object — THREE.Group, feet at the origin, y up, drawn facing +X;
//   a.update(dt, pose, facing) — apply a pose from poses.js.
// - doll3d: the pet-ragdoll-renderer rig (photo head + skinned garments), posed
//   kinematically per move; hard hits hand it to cannon-es physics (a real rag doll).
// - sprite: the desktop pet's idle picture as a flat standee.
// - toy: a small procedural mascot for the computer rival and plain browsers.
// Every kind holds its style's weapon (hammer, paw, wand, katana). Presentation only: the simulation never
// reads anything from here.
import * as THREE from '../vendor/lib/three.module.js';
import * as CANNON from '../vendor/lib/cannon-es.js';
import {createRagdoll} from '../vendor/doll/ragdoll-adapter.js';
import {createWardrobe,dressPart} from '../vendor/doll/doll-appearance.js';
import {createGarments} from '../vendor/doll/garment-rig.js';
import {makeWeapon} from './weapons.js';

const V=(x=0,y=0,z=0)=>new CANNON.Vec3(x,y,z);
const axisQ=(axis,angle)=>{const q=new CANNON.Quaternion();q.setFromAxisAngle(axis,angle);return q;};
const X=V(1,0,0);
const add=(a,b)=>{const r=new CANNON.Vec3();a.vadd(b,r);return r;};
const sub=(a,b)=>{const r=new CANNON.Vec3();a.vsub(b,r);return r;};
const scale=(a,s)=>{const r=new CANNON.Vec3();a.scale(s,r);return r;};
const norm=v=>{const r=v.clone();const l=r.length();if(l>1e-9)r.scale(1/l,r);return r;};
const between=(from,to)=>{const q=new CANNON.Quaternion();q.setFromVectors(norm(from),norm(to));return q;};
async function loadTexture(url){const t=await new THREE.TextureLoader().loadAsync(url);t.colorSpace=THREE.SRGBColorSpace;return t;}

// Weapons live in weapons.js; every style's weapon is built along +Y from the grip.
// Orient a +Y-built hammer along `dir` inside a plane whose side axis is `side`.
const _m=new THREE.Matrix4(),_d=new THREE.Vector3(),_s=new THREE.Vector3(),_z=new THREE.Vector3();
function aimHammer(h,dir,side){_d.copy(dir).normalize();_s.copy(side).normalize();_z.crossVectors(_s,_d).normalize();_s.crossVectors(_d,_z);_m.makeBasis(_s,_d,_z);h.quaternion.setFromRotationMatrix(_m);}

// ---------- 3D doll ----------
// Rig frame: z up, facing −Y (see pet-kart/src/avatars.js). Returns grip + hammer direction.
function fightPose(doll,P){
  const B=doll.parts,place=(name,p,r)=>{B[name].position.copy(p);B[name].quaternion.copy(r);};
  const q=axisQ(X,P.lean||0);
  const pelvis=V(0,0,1.86-(P.crouch||0)*0.5-(P.tuck||0)*0.15+(P.offY||0));
  place('pelvis',pelvis,q);
  const upper=add(pelvis,q.vmult(V(0,0,.49)));place('upperBody',upper,q);
  const shoulder=add(upper,q.vmult(V(0,0,.35))),head=add(shoulder,q.vmult(V(0,0,.35)));
  place('head',head,q.mult(axisQ(X,-0.1)));
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    const swing=(P.run||0)*Math.sin((P.runPhase||0)+(sign>0?0:Math.PI))*0.75;
    const thigh=-(P.crouch||0)*0.95-(P.tuck||0)*1.1+swing,bend=(P.crouch||0)*1.7+(P.tuck||0)*1.6+Math.max(0,-swing)*0.8;
    const hip=add(pelvis,q.vmult(V(sign*.18,0,-.14))),lq=q.mult(axisQ(X,thigh)),kq=q.mult(axisQ(X,thigh+bend));
    place('upper'+side+'Leg',add(hip,lq.vmult(V(0,0,-.42))),lq);
    const knee=add(hip,lq.vmult(V(0,0,-.84)));place('lower'+side+'Leg',add(knee,kq.vmult(V(0,0,-.39))),kq);
  }
  // Both hands on the hammer handle (or reaching / hanging).
  const a=P.hammer.angle,dir=V(0,-Math.cos(a),Math.sin(a));
  let grip;
  if(P.arms==='grab')grip=add(shoulder,V(0,-(0.55+0.55*(P.grabReach||0)),-0.1));
  else if(P.arms==='up')grip=add(shoulder,V(0,-0.15,0.95));
  else grip=add(shoulder,add(V(0,-0.32,-0.25),scale(dir,0.35)));
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    const hand=add(grip,V(sign*0.08,0,0));
    const joint=add(shoulder,q.vmult(V(sign*.36,-.10,0)));
    const reach=sub(hand,joint),elbowDir=norm(add(norm(reach),V(sign*0.5,0,-0.4)));
    place('upper'+side+'Arm',add(joint,scale(elbowDir,.31)),between(V(sign,0,0),elbowDir));
    const elbow=add(joint,scale(elbowDir,.62)),lowerDir=norm(sub(hand,elbow));
    place('lower'+side+'Arm',add(elbow,scale(lowerDir,.29)),between(V(sign,0,0),lowerDir));
  }
  return {grip,dir};
}
async function dollAvatar(asset,{height,style='hammer'}){
  const holder=new THREE.Group(),rig=new THREE.Group(),spinner=new THREE.Group();
  const texture=await loadTexture(asset.head);
  const garments={};
  for(const slot of ['top','bottom']){const g=asset.garments[slot];garments[slot]={kind:g.kind,assets:{front:g.front,back:g.back,frontBump:g.frontBump,backBump:g.backBump,shape:g.shape}};}
  const doll={id:asset.person,x:0,texture,garmentInputs:garments,wardrobe:createWardrobe(asset.person),...createRagdoll({angle:Math.PI*.62,angleShoulders:Math.PI*.8,twistAngle:Math.PI/3})};
  const picks=[];
  for(const b of doll.bodies){b.visual=dressPart(b,doll,picks);rig.add(b.visual);}
  doll.garments=await createGarments(doll,rig,picks);
  const photo=doll.parts.head.visual.children.find(o=>o.userData.photoHead);
  if(photo&&asset.headScale!==1){
    const pos=photo.geometry.attributes.position,half=(photo.geometry.boundingBox.max.x-photo.geometry.boundingBox.min.x)*.025;let chin=Infinity;
    for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i))<half)chin=Math.min(chin,pos.getY(i));
    const c=new THREE.Vector3(0,chin,0),anchor=c.clone().applyQuaternion(photo.quaternion).add(photo.position);
    photo.scale.setScalar(asset.headScale);photo.position.copy(anchor).sub(c.clone().multiplyScalar(asset.headScale).applyQuaternion(photo.quaternion));
  }
  const hammer=makeWeapon(style,2.0);rig.add(hammer);
  rig.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=false;}});
  rig.rotation.x=-Math.PI/2;
  const s=height/2.75;rig.scale.setScalar(s);
  // Spin pivot at mid-body so rolls/tumbles rotate around the torso, not the feet.
  spinner.position.y=height*0.5;rig.position.y=-height*0.5;spinner.add(rig);holder.add(spinner);
  // Physics rag doll for tumbles (bodies already carry the cone-twist joints).
  const world=new CANNON.World({gravity:V(0,0,-3)});
  for(const b of doll.bodies)world.addBody(b);for(const c of doll.constraints||[])world.addConstraint(c);
  let ragdoll=false;const dirV=new THREE.Vector3(),sideV=new THREE.Vector3(1,0,0);
  const materials=[];holder.traverse(o=>{if(o.isMesh)for(const m of [].concat(o.material))if(!materials.includes(m))materials.push(m);});
  for(const m of materials){m.transparent=true;}
  return {kind:'doll3d',object:holder,hammer,height,
    update(dt,P,facing){
      holder.rotation.y=facing>0?Math.PI/2-0.38:-Math.PI/2+0.38;
      spinner.rotation.set(0,0,0);
      spinner.rotation.x=(P.spin||0)+(P.roll||0);spinner.rotation.z=(P.lie||0)*Math.PI/2*-1;
      spinner.scale.set(P.squash||1,P.stretch||1,P.squash||1);
      const tumbling=(P.fx.trail>0.2&&P.roll!==0);
      if(tumbling){
        if(!ragdoll){ragdoll=true;for(const b of doll.bodies){b.velocity.set((Math.random()-.5)*4,(Math.random()-.5)*4,(Math.random()-.5)*4);b.angularVelocity.set((Math.random()-.5)*10,(Math.random()-.5)*10,(Math.random()-.5)*10);}}
        world.step(1/60,dt,3);
        const p=doll.parts.pelvis.position,shift=V(-p.x,-p.y,1.2-p.z);
        for(const b of doll.bodies){b.position.vadd(shift,b.position);b.visual.position.copy(b.position);b.visual.quaternion.copy(b.quaternion);}
        doll.garments.update();hammer.visible=false;
      }else{
        ragdoll=false;hammer.visible=P.hammer.visible&&P.visible;
        const {grip,dir}=fightPose(doll,P);
        for(const b of doll.bodies){b.velocity.set(0,0,0);b.angularVelocity.set(0,0,0);b.visual.position.copy(b.position);b.visual.quaternion.copy(b.quaternion);}
        doll.garments.update();
        hammer.position.set(grip.x,grip.y,grip.z);dirV.set(dir.x,dir.y,dir.z);aimHammer(hammer,dirV,sideV);
        hammer.scale.setScalar(P.hammer.scale||1);
      }
      for(const m of materials)m.opacity=P.alpha;
      holder.visible=P.visible;
    },
    isRagdoll:()=>ragdoll,
    dispose(){texture.dispose();}};
}

// ---------- 2D standee ----------
async function spriteAvatar(asset,{height,style='hammer'}){
  const textures=await Promise.all(asset.frames.map(loadTexture));
  const h=height*1.08,w=Math.min(h*2.2,h*asset.aspect);
  const mat=new THREE.MeshStandardMaterial({map:textures[0],transparent:true,alphaTest:.05,side:THREE.DoubleSide,roughness:.9});
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);plane.castShadow=true;
  const holder=new THREE.Group(),spinner=new THREE.Group(),body=new THREE.Group();
  spinner.position.y=h/2;body.add(plane);spinner.add(body);holder.add(spinner);
  const hammer=makeWeapon(style,height*0.62);spinner.add(hammer);
  let clock=0;
  return {kind:'sprite',object:holder,hammer,height,
    update(dt,P,facing){
      clock+=dt;if(asset.fps>0&&textures.length>1){const f=Math.floor(clock*asset.fps)%textures.length;if(mat.map!==textures[f])mat.map=textures[f];}
      holder.visible=P.visible;mat.opacity=P.alpha;
      body.scale.set((P.squash||1)*facing,(P.stretch||1)*(1-(P.crouch||0)*0.22),1);
      body.position.y=-(P.crouch||0)*h*0.11;
      spinner.rotation.z=-(P.lean||0)*facing*0.9-((P.spin||0)+(P.roll||0))*facing-(P.lie||0)*Math.PI/2*facing;
      spinner.position.y=h/2-(P.lie||0)*h*0.32+(P.offY||0);
      mat.color.setScalar(1-(P.tint||0)).lerp(new THREE.Color('#ffffff'),0);
      if(P.flash)mat.emissive?.setRGB(P.flash,P.flash,P.flash);else mat.emissive?.setRGB(0,0,0);
      // Hammer in front of the standee, held at the shoulder.
      const a=P.hammer.angle,th=Math.atan2(Math.sin(a),Math.cos(a)*facing);
      hammer.visible=P.hammer.visible&&P.visible;
      hammer.position.set(facing*w*0.18,h*0.05,Math.sin(a)>0.75&&Math.cos(a)<0.35?-0.3:0.22);hammer.rotation.set(0,0,th-Math.PI/2);hammer.scale.setScalar(P.hammer.scale||1);
      hammer.position.x+=P.arms==='grab'?facing*w*0.1*(P.grabReach||0):0;
    },
    dispose(){textures.forEach(t=>t.dispose());mat.dispose();}};
}

// ---------- toy mascot ----------
function toyAvatar(asset,{height,style='hammer'}){
  const holder=new THREE.Group(),spinner=new THREE.Group(),inner=new THREE.Group();
  const color=new THREE.Color(asset.color||'#ffc93c'),mat=c=>new THREE.MeshStandardMaterial({color:c,roughness:.7,transparent:true});
  const fur=mat(color),light=mat(color.clone().lerp(new THREE.Color('#ffffff'),.55)),dark=mat('#2a2230'),pink=mat('#ff9fb8');
  const mats=[fur,light,dark,pink];
  const ball=(r,m,p,s=[1,1,1],parent=inner)=>{const o=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),m);o.position.set(...p);o.scale.set(...s);o.castShadow=true;parent.add(o);return o;};
  ball(.42,fur,[0,.62,0],[1,1.1,.9]);ball(.3,light,[0,.58,.25],[1,1.1,.5]);
  const head=new THREE.Group();head.position.set(0,1.28,0);inner.add(head);
  ball(.42,fur,[0,0,0],[1.08,.95,1],head);ball(.07,dark,[-.15,.05,.37],undefined,head);ball(.07,dark,[.15,.05,.37],undefined,head);ball(.045,pink,[0,-.06,.41],undefined,head);
  const sp=asset.species||'mouse';
  if(sp==='mouse'){ball(.2,fur,[-.3,.34,0],[1,1,.35],head);ball(.2,fur,[.3,.34,0],[1,1,.35],head);}
  if(sp==='cat')for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.ConeGeometry(.14,.28,4),fur);e.position.set(s*.24,.38,0);e.rotation.z=-s*.35;head.add(e);}
  if(sp==='bunny')for(const s of [-1,1]){const e=ball(.1,fur,[s*.14,.55,-.02],[.9,2.6,.6],head);e.rotation.z=-s*.15;}
  const feet=[-1,1].map(s=>ball(.13,fur,[s*.18,.1,.05],[1,.7,1.3]));
  const k=height/1.75;inner.scale.setScalar(k);
  spinner.position.y=height*0.5;inner.position.y=-height*0.5;spinner.add(inner);holder.add(spinner);
  const hammer=makeWeapon(style,height*0.62);spinner.add(hammer);
  return {kind:'toy',object:holder,hammer,height,update(dt,P,facing){
    holder.visible=P.visible;for(const m of mats)m.opacity=P.alpha;
    inner.rotation.y=facing>0?0.9:-0.9;
    spinner.rotation.z=-(P.lean||0)*facing*0.9-((P.spin||0)+(P.roll||0))*facing-(P.lie||0)*Math.PI/2*facing;
    inner.scale.set(k*(P.squash||1),k*(P.stretch||1)*(1-(P.crouch||0)*0.2),k*(P.squash||1));
    feet.forEach((f,i)=>{f.position.z=.05+Math.sin((P.runPhase||0)+i*Math.PI)*.18*(P.run||0);});
    const a=P.hammer.angle,th=Math.atan2(Math.sin(a),Math.cos(a)*facing);
    hammer.visible=P.hammer.visible&&P.visible;hammer.position.set(facing*height*0.22,height*0.02,Math.sin(a)>0.75&&Math.cos(a)<0.35?-0.45:0.4);hammer.rotation.set(0,0,th-Math.PI/2);hammer.scale.setScalar(P.hammer.scale||1);
  },dispose(){}};
}

export async function buildAvatar(asset,fallback,opts={height:2.3}){
  try{
    if(asset?.kind==='doll3d')return await dollAvatar(asset,opts);
    if(asset?.kind==='sprite')return await spriteAvatar(asset,opts);
  }catch(e){
    console.warn('avatar fallback',e);
    if(fallback)return buildAvatar(fallback,null,opts);
  }
  return toyAvatar(asset?.kind==='toy'?asset:{species:'mouse',color:'#ffc93c'},opts);
}
