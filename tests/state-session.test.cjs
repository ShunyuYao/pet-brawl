'use strict';
// Protocol boundary tests. Real SDK/TLS/renderer acceptance is the host E2E gate.
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const C = require('../game/state-codec.cjs');
const { createSender, createReceiver } = require('../game/state-session.cjs');
const digest = state => createHash('sha256').update(C.canonical(state)).digest('hex');
const state = (serial, matchNo = 1) => ({ serial, view: { matchNo, match: { frame: serial * 3, events: [], fighters: [{ x: serial / 7, stocks: 3 }] } } });
const verify = (s, d) => digest(s) === d;
const receive = (r, packet) => r.receive(packet, packetDigest.get(packet), verify);
const packetDigest = new WeakMap();
function prepare(s, value, preferDelta = true) {
  const d = digest(value), p = s.prepare(value, d), packet = preferDelta && p.delta || p.full;
  packetDigest.set(packet, d); s.sent(packet); return packet;
}
test('queued or unsent snapshots never become an acknowledged baseline; skipped deltas are independent', async () => {
  const s = createSender(), r = createReceiver();
  const one = prepare(s, state(1)); assert.equal(one.kind, 'full');
  const two = prepare(s, state(2)); assert.equal(two.kind, 'full'); // Neither delivered.
  await receive(r, two); assert(s.acknowledge(r.feedback()));
  const three = prepare(s, state(3)), four = prepare(s, state(4));
  assert.equal(three.kind, 'delta'); assert.equal(four.base, 2);
  assert.deepEqual((await receive(r, four)).state, state(4)); // Drop 3 entirely.
  assert(s.acknowledge(r.feedback()));
  assert.equal(prepare(s, state(5)).base, 4);
});
test('digest failure cannot commit a snapshot or produce an acknowledgement', async () => {
  const s = createSender(), r = createReceiver(), p = prepare(s, state(1));
  await assert.rejects(r.receive(p, '0'.repeat(64), verify), /integrity_mismatch/);
  assert.equal(r.feedback().serial, 0); assert.equal(r.diagnostics().entries, 0);
  assert.deepEqual((await receive(r, p)).state, state(1));
});
test('old and invented acknowledgements cannot rewind or select a nonexistent baseline', async () => {
  const s = createSender(), r = createReceiver();
  const one = prepare(s, state(1)); await receive(r, one); const old = r.feedback(); s.acknowledge(old);
  const two = prepare(s, state(2)); await receive(r, two); const latest = r.feedback(); s.acknowledge(latest);
  assert.equal(s.acknowledge(old), false);
  assert.equal(s.acknowledge({ ...latest, serial: 999 }), false);
  assert.equal(s.acknowledge({ ...latest, digest: 'f'.repeat(64) }), false);
  assert.equal(prepare(s, state(3)).base, 2);
});
test('cache loss requests full state; a decoded full resumes deltas without changing match state', async () => {
  const s = createSender(), r = createReceiver();
  await receive(r, prepare(s, state(1))); s.acknowledge(r.feedback());
  r.forget(); const delta = prepare(s, state(2));
  await assert.rejects(receive(r, delta), /baseline_missing/);
  assert(r.feedback().needFull); s.acknowledge(r.feedback());
  const full = prepare(s, state(3)); assert.equal(full.kind, 'full'); await receive(r, full); s.acknowledge(r.feedback());
  const next = prepare(s, state(4)); assert.equal(next.kind, 'delta'); assert.deepEqual((await receive(r, next)).state, state(4));
});
test('periodic full snapshots recover even when all new acknowledgements are dropped', async () => {
  let now = 0; const s = createSender({ now: () => now }), r = createReceiver();
  await receive(r, prepare(s, state(1))); s.acknowledge(r.feedback());
  now = 500; const p = prepare(s, state(2)); assert.equal(p.kind, 'delta'); await receive(r, p);
  now = 1001; assert.equal(prepare(s, state(3)).kind, 'full');
});
test('match changes and transport epochs require full state; stale generation and serial cannot replace it', async () => {
  const s = createSender(), r = createReceiver();
  const old = prepare(s, state(1)); await receive(r, old); s.acknowledge(r.feedback());
  const newMatch = prepare(s, state(2, 2)); assert.equal(newMatch.kind, 'full'); assert(newMatch.generation > old.generation);
  await receive(r, newMatch); assert.equal((await receive(r, old)).ignored, 'stale');
  s.acknowledge(r.feedback()); const delayed = prepare(s, state(3, 2));
  s.reset('transport_epoch'); r.reset();
  assert.equal((await receive(r, delayed)).ignored, 'stale');
  const fresh = prepare(s, state(4, 2)); assert.equal(fresh.kind, 'full'); await receive(r, fresh); s.acknowledge(r.feedback());
  const p = prepare(s, state(5, 2)); assert.equal(p.kind, 'delta'); await receive(r, p);
  assert.equal((await receive(r, fresh)).ignored, 'stale');
});
test('entry and byte limits hold when acknowledgements remain delayed', async () => {
  const s = createSender({ maxEntries: 4, maxBytes: 2000 }), r = createReceiver({ maxEntries: 4, maxBytes: 2000 });
  const one = prepare(s, state(1)); await receive(r, one); s.acknowledge(r.feedback());
  for (let n = 2; n < 70; n++) {
    const p = prepare(s, { ...state(n), padding: 'x'.repeat(500) }); await receive(r, p);
    for (const x of [s.diagnostics(), r.diagnostics()]) { assert(x.entries <= 4); assert(x.bytes <= 2000); }
  }
  assert.equal(prepare(s, state(70)).kind, 'full');
});
test('reset during asynchronous verification invalidates the in-flight reconstruction', async () => {
  const s = createSender(), r = createReceiver(), p = prepare(s, state(1));
  let finish; const task = r.receive(p, packetDigest.get(p), () => new Promise(resolve => { finish = resolve; }));
  r.reset(); finish(true);
  assert.equal((await task).ignored, 'reset'); assert.equal(r.diagnostics().entries, 0);
});
test('out-of-order verification completion cannot rewind a committed serial', async () => {
  const s = createSender(), r = createReceiver(), one = prepare(s, state(1)), two = prepare(s, state(2));
  let finish; const old = r.receive(one, packetDigest.get(one), () => new Promise(resolve => { finish = resolve; }));
  await receive(r, two); finish(true);
  assert.equal((await old).ignored, 'stale'); assert.equal(r.feedback().serial, 2);
});
test('receiver-only reset explicitly requests a new generation and recovers', async () => {
  const s = createSender(), r = createReceiver(); await receive(r, prepare(s, state(1))); s.acknowledge(r.feedback());
  r.reset(); assert(s.acknowledge(r.feedback()));
  const full = prepare(s, state(2)); assert.equal(full.kind, 'full');
  assert.deepEqual((await receive(r, full)).state, state(2));
  s.acknowledge(r.feedback()); assert.equal(prepare(s, state(3)).kind, 'delta');
});
test('invalid packet metadata, generation, shape and acknowledgements are rejected', async () => {
  const s = createSender(), r = createReceiver(), p = prepare(s, state(1));
  for (const bad of [{ ...p, v: 2 }, { ...p, base: 2 }, { ...p, extra: true }, { ...p, generation: -1 }, { ...p, serial: 2 }, { ...p, matchNo: 6 }]) {
    await assert.rejects(r.receive(bad, packetDigest.get(p), verify), /invalid_packet/);
  }
  for (const bad of [null, {}, { v: 1, generation: 1, serial: Infinity, digest: 'a'.repeat(64) }]) assert.equal(s.acknowledge(bad), false);
});

 test('application failure does not publish an ACK or cache the otherwise valid state', async()=>{
  const sender=createSender(),receiver=createReceiver(),packet=prepare(sender,state(1));
  await assert.rejects(receiver.receive(packet,packetDigest.get(packet),verify,()=>{throw Error('apply_failed');}),/apply_failed/);
  assert.equal(receiver.feedback().serial,0);assert.equal(receiver.diagnostics().entries,0);
  let applied;await receiver.receive(packet,packetDigest.get(packet),verify,value=>{applied=value;});
  assert.deepEqual(applied,state(1));assert.equal(receiver.feedback().serial,1);
 });

test('reset synchronously triggered by application cannot resurrect an old cache or ACK',async()=>{
 const s=createSender(),r=createReceiver(),packet=prepare(s,state(1));
 const result=await r.receive(packet,packetDigest.get(packet),verify,()=>r.reset());
 assert.equal(result.ignored,'reset');assert.equal(r.diagnostics().entries,0);assert.equal(r.feedback().serial,0);
});
