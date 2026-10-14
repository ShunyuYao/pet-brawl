'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Motion=require('../game/local-motion.cjs'),M=require('../game/match.cjs');
const frame=1000/60;
function world(x=20){const m=M.create({countdown:false,stage:'moon'});m.frame=100;m.fighters[1].x=x;m.fighters[1].vx=1.03;m.fighters[1].state='walk';return m;}
test('the actual LAN same-frame three-unit correction cannot pull the guest picture backwards and never changes physics',()=>{
 const p=Motion.create(),before=world(),after=world(16.91);p.reconcile(null,before,1000,{reset:'initial'});p.advance(1000);
 const first=p.sample(before,1000);p.reconcile(before,after,1000);assert.equal(p.sample(after,1000).fighters[1].x,first.fighters[1].x);
 let last=first.fighters[1].x;
 for(let i=1;i<=12;i++){after.frame++;after.fighters[1].x+=1.03;p.advance(1000+i*frame);const frozen=M.snapshot(after),shown=p.sample(after,1000+i*frame);assert(shown.fighters[1].x>last);last=shown.fighters[1].x;assert.deepEqual(M.snapshot(after),frozen);}
 after.fighters[1].vx=0;after.fighters[1].state='idle';const shown=p.sample(after,1800);assert(Math.abs(shown.fighters[1].x-after.fighters[1].x)<.01,'display converges after key release');
});
test('fractional rendering follows a newly pressed movement immediately; a catch-up yielded tick cannot retire its offset backwards',()=>{
 const p=Motion.create(),m=world();p.reconcile(null,m,1000,{reset:'initial'});p.advance(1000);
 assert(Math.abs(p.sample(m,1000+frame/2).fighters[1].x-20.515)<1e-9);
 const corrected=world(17);p.reconcile(m,corrected,1000+frame/2);
 const a=p.sample(corrected,1000+frame),b=p.sample(corrected,1000+2*frame);
 assert(b.fighters[1].x>=a.fighters[1].x,'a yielded simulation frame holds instead of reversing');
 corrected.frame++;corrected.fighters[1].x+=1.03;p.advance(1000+2.5*frame);
 assert(p.sample(corrected,1000+2.5*frame).fighters[1].x>=b.fighters[1].x,'next walking tick resumes forward motion');
});
test('turning, jumping and authoritative discontinuities remain immediate',()=>{
 const p=Motion.create(),m=world();p.reconcile(null,m,1000,{reset:'initial'});p.sample(m,1000);
 m.frame++;m.fighters[1].vx=-1.03;m.fighters[1].x-=1.03;p.advance(1000+frame);assert.equal(p.sample(m,1000+frame).fighters[1].x,m.fighters[1].x);
 m.frame++;m.fighters[1].ground=null;m.fighters[1].y=2;m.fighters[1].vy=2;m.fighters[1].state='air';p.advance(1000+2*frame);
 assert(p.sample(m,1000+2.5*frame).fighters[1].y>m.fighters[1].y,'jump draws without an interpolation buffer');
 for(const reason of ['epoch','round','paused','resume','results']){const n=world(30);p.reconcile(m,n,1200,{reset:reason});assert.equal(p.sample(n,1200).fighters[1].x,30);}
 for(const state of ['dead','respawn','inhaled','grabbed']){const n=world(-20);n.fighters[1].state=state;p.reconcile(m,n,1300);assert.equal(p.sample(n,1300).fighters[1].x,-20);}
 const distant=world(70);p.reconcile(m,distant,1400);assert.equal(p.sample(distant,1400).fighters[1].x,70,'large corrections snap to authority');
});
