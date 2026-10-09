'use strict';

// State codec contracts. Real-app delivery is owned by the separate hidden
// Electron host gate; this replay does not claim a live network path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { diff, apply, canonical, LIMITS } = require('../game/state-codec.cjs');

const wire = value => JSON.parse(JSON.stringify(value));
const eventPath = ['view', 'match', 'events'];
const withEvents = events => ({ view: { match: { events } } });
const events = (start, count) => Array.from({ length: count }, (_, i) => ({ seq: start + i, type: 'hit', data: { x: i / 7 } }));
const check = (base, next, options) => {
  const before = canonical(base), nextBefore = canonical(next);
  const ops = diff(base, next, options);
  const rebuilt = apply(base, wire(ops));
  assert.equal(canonical(rebuilt), nextBefore);
  assert.equal(canonical(base), before, 'base was mutated');
  assert.equal(canonical(next), nextBefore, 'next was mutated');
  return { ops, rebuilt };
};
const rejects = (fn, code) => assert.throws(fn, error => error.code === code && typeof error.message === 'string');

test('canonical sorts every object key and retains JSON number/string semantics', () => {
  assert.equal(canonical({ z: [3, { b: true, a: null }], a: 'constructor', '10': 1, '2': 2 }), '{"10":1,"2":2,"a":"constructor","z":[3,{"a":null,"b":true}]}');
  const numbers = [Number.MIN_VALUE, Number.MAX_VALUE, Math.PI, 1 / 3, 2 ** 53 - 1, -1e-300, -0];
  assert.deepEqual(JSON.parse(canonical(numbers)), wire(numbers));
  assert.equal(canonical('\ud800🐈\n'), JSON.stringify('\ud800🐈\n'));
});

test('null, root/type changes, deletions and re-additions reconstruct without aliasing', () => {
  let previous = null;
  for (const next of [false, 3.5, 'constructor', [], [1, null], { a: [1, 2], b: { c: 1 } }, { a: [1, 3], b: {} }, { a: null, b: { c: 1 } }]) {
    const { rebuilt } = check(previous, next);
    if (next && typeof next === 'object') assert.notEqual(rebuilt, next);
    previous = next;
  }
  const base = { a: { b: 1 }, c: [2] }, rebuilt = apply(base, []);
  rebuilt.a.b = 2; rebuilt.c[0] = 9;
  assert.deepEqual(base, { a: { b: 1 }, c: [2] });
});

test('same-length arrays use valid indices; changed length uses whole-array replacement', () => {
  assert.deepEqual(check({ a: [1, 2] }, { a: [1, 3] }).ops, [['set', ['a', 1], 3]]);
  assert.deepEqual(check({ a: [1, 2] }, { a: [1] }).ops, [['set', ['a'], [1]]]);
  assert.deepEqual(check({ a: 1, b: 2 }, { a: 1 }).ops, [['delete', ['b']]]);
  assert.deepEqual(check({ a: 1 }, { a: 1 }).ops, []);
});

test('event history appends and rolls at 64 without duplicating old events', () => {
  const before = events(1, 64), appended = events(65, 4);
  const next = before.concat(appended).slice(-64);
  const { ops } = check(withEvents(before), withEvents(next));
  assert.deepEqual(ops, [['events', eventPath, 64, appended]]);
  assert.deepEqual(check(withEvents([]), withEvents(events(1, 3))).ops, [['events', eventPath, 0, events(1, 3)]]);
  assert.ok(check(withEvents(before), withEvents(next), { events: false }).ops.every(op => op[0] !== 'events'));
});

test('event reset, empty result, changed old values and non-event paths safely fall back', () => {
  const before = events(20, 3);
  for (const next of [[], events(1, 2), [{ ...before[0], type: 'changed' }, ...before.slice(1)], events(90, 2), [{ seq: 2 }, { seq: 2 }]]) {
    assert.ok(check(withEvents(before), withEvents(next)).ops.every(op => op[0] !== 'events'));
  }
  assert.ok(check({ events: before }, { events: before.concat(events(23, 1)) }).ops.every(op => op[0] !== 'events'));
});

test('event sequence gaps are preserved and append is used only for exact retained tail', () => {
  const before = [{ seq: 2, type: 'hit' }, { seq: 8, type: 'ko' }];
  const next = before.concat([{ seq: 14, type: 'new' }]);
  assert.equal(check(withEvents(before), withEvents(next)).ops[0][0], 'events');
  const many = events(80, 64);
  assert.equal(check(withEvents(events(1, 64)), withEvents(many)).ops[0][0], 'events');
});

test('non-JSON data and unsafe keys are rejected without executing accessors', () => {
  let invoked = false;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1; } });
  const cycle = {}; cycle.self = cycle;
  const hidden = Object.defineProperty({}, 'x', { value: 1 });
  const sparse = []; sparse.length = 3;
  const arrayExtra = [1]; arrayExtra.extra = true;
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => {}, Symbol('x'), new Date(), new Map(), /x/, cycle, getter, hidden, sparse, arrayExtra, { x: undefined }, { [Symbol('x')]: 1 }]) {
    rejects(() => canonical(value), 'DELTA_INVALID_JSON');
  }
  assert.equal(invoked, false);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const malicious = JSON.parse('{"' + key + '":{"polluted":true}}');
    rejects(() => canonical(malicious), 'DELTA_UNSAFE_KEY');
    rejects(() => diff({}, malicious), 'DELTA_UNSAFE_KEY');
    rejects(() => apply({}, [['set', [key], 1]]), 'DELTA_UNSAFE_KEY');
  }
  assert.equal({}.polluted, undefined);
  assert.equal(canonical({ value: 'constructor' }), '{"value":"constructor"}');
});

test('external operations reject invalid shape, type, paths and implicit creation', () => {
  for (const ops of [{}, [null], [['unknown', []]], [['set', ['a']]], [['delete', [], 1]], [['set', [true], 1]], [['set', ['a'], 1, 2]], [['set', [], undefined]]]) {
    assert.throws(() => apply({}, ops));
  }
  for (const ops of [[['set', ['missing', 'x'], 1]], [['delete', ['missing']]], [['delete', []]], [['set', ['a', 'x'], 1]]]) {
    rejects(() => apply({ a: null }, ops), 'DELTA_INVALID_PATH');
  }
  for (const key of [-1, 1, '0', 0.5, 'length', '01']) {
    rejects(() => apply([1], [['set', [key], 2]]), 'DELTA_INVALID_PATH');
  }
  rejects(() => apply([1], [['delete', [0]]]), 'DELTA_INVALID_PATH');
  rejects(() => apply({ '0': 1 }, [['set', [0], 2]]), 'DELTA_INVALID_PATH');
  rejects(() => apply({}, [['set', ['toString', 'polluted'], 1]]), 'DELTA_INVALID_PATH');
});

test('external event operations verify base sequence, ordering, shape and target', () => {
  const base = withEvents(events(1, 2));
  for (const op of [
    ['events', ['events'], 2, events(3, 1)],
    ['events', eventPath, 1, events(3, 1)],
    ['events', eventPath, 2, []],
    ['events', eventPath, 2, [{ seq: 2 }]],
    ['events', eventPath, 2, [{ seq: 5 }, { seq: 4 }]],
    ['events', eventPath, 2, [{ seq: 3.1 }]],
    ['events', eventPath, 2, events(3, 65)],
  ]) rejects(() => apply(base, [op]), 'DELTA_INVALID_EVENTS');
  assert.equal(canonical(base), canonical(withEvents(events(1, 2))));
});

test('late invalid operation leaves base untouched and inserted values are independently owned', () => {
  const base = { a: { b: 1 } }, before = canonical(base);
  rejects(() => apply(base, [['set', ['a', 'b'], 2], ['delete', ['missing']]]), 'DELTA_INVALID_PATH');
  assert.equal(canonical(base), before);
  const value = { nested: [3] }, op = [['set', ['value'], value]];
  const rebuilt = apply(base, op); rebuilt.value.nested.push(4);
  assert.deepEqual(value, { nested: [3] });
});

test('UTF-8 state bytes, depth, nodes, operations and patch bytes have hard budgets', () => {
  assert.equal(Buffer.byteLength(canonical('x'.repeat(LIMITS.MAX_STATE_BYTES - 2))), LIMITS.MAX_STATE_BYTES);
  rejects(() => canonical('x'.repeat(LIMITS.MAX_STATE_BYTES - 1)), 'DELTA_LIMIT_BYTES');
  rejects(() => canonical('猫'.repeat(Math.floor(LIMITS.MAX_STATE_BYTES / 3))), 'DELTA_LIMIT_BYTES');
  let deep = 0; for (let i = 0; i <= LIMITS.MAX_DEPTH; i++) deep = [deep];
  rejects(() => canonical(deep), 'DELTA_LIMIT_DEPTH');
  rejects(() => canonical(Array(LIMITS.MAX_NODES).fill(0)), 'DELTA_LIMIT_NODES');
  rejects(() => apply({}, Array.from({ length: LIMITS.MAX_OPS + 1 }, () => ['set', ['a'], 1])), 'DELTA_LIMIT_OPS');
  rejects(() => apply({}, [['set', Array(LIMITS.MAX_DEPTH + 1).fill('a'), 1]]), 'DELTA_LIMIT_DEPTH');
  rejects(() => apply({}, [['set', ['a'], 'x'.repeat(LIMITS.MAX_PATCH_BYTES)]]), 'DELTA_LIMIT_BYTES');
  rejects(() => apply({ a: 'x'.repeat(31000) }, [['set', ['b'], 'x'.repeat(31000)]]), 'DELTA_LIMIT_BYTES');
});

test('finite numeric precision survives wire JSON, diff and apply with no quantization', () => {
  const numbers = [Math.PI, Math.E, 0.1 + 0.2, Number.MIN_VALUE, Number.MAX_VALUE, 2 ** 53 - 1, -1.2345678901234567, 1e-200];
  const { rebuilt } = check({ numbers: numbers.map(() => 0) }, { numbers });
  numbers.forEach((n, i) => assert.ok(Object.is(rebuilt.numbers[i], n)));
});

test('diff itself rejects unbounded operation counts and repeated long paths', () => {
  const before = {}, after = {};
  for (let i = 0; i <= LIMITS.MAX_OPS; i++) { before['k' + i] = 0; after['k' + i] = 1; }
  rejects(() => diff(before, after), 'DELTA_LIMIT_OPS');
  const key = 'k'.repeat(200), a = {}, b = {};
  for (let i = 0; i < 500; i++) { a['v' + i] = 0; b['v' + i] = 1; }
  rejects(() => diff({ [key]: { [key]: a } }, { [key]: { [key]: b } }), 'DELTA_LIMIT_BYTES');
});

test('codec runs in a browser-like realm without require, Buffer or Node globals', () => {
  const source = fs.readFileSync(path.join(__dirname, '../game/state-codec.cjs'), 'utf8');
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(source, context);
  const result = vm.runInContext(`(() => {
    const { diff, apply, canonical } = module.exports;
    const a = { text: '猫🐈', values: [0, Math.PI] };
    const b = { text: 'constructor', values: [1 / 3, Number.MIN_VALUE] };
    return canonical(apply(a, JSON.parse(JSON.stringify(diff(a, b))))) === canonical(b);
  })()`, context);
  assert.equal(result, true);
});

test('seeded legal JSON property replay is exact for 1200 independently generated pairs', () => {
  let state = 0x7e57;
  const random = n => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % n; };
  function value(depth = 0) {
    const kind = depth > 3 ? random(4) : random(6);
    if (kind === 0) return null;
    if (kind === 1) return random(2) === 1;
    if (kind === 2) return (random(200000) - 100000) / 7;
    if (kind === 3) return ['constructor', '猫🐈', '\ud800', '', 'a/b~c'][random(5)];
    if (kind === 4) return Array.from({ length: random(6) }, () => value(depth + 1));
    const object = {}; for (let i = 0, n = random(6); i < n; i++) object['k' + random(12)] = value(depth + 1);
    return object;
  }
  for (let i = 0; i < 1200; i++) check(value(), value());
});

test('current game replay restores delayed-base combat snapshots', t => {
  const source = path.resolve(__dirname, '..');
  const M = require(path.join(source, 'game/match.cjs'));
  const AI = require(path.join(source, 'game/ai.cjs'));
  const R = require(path.join(source, 'game/room.cjs'));
  let snapshots = 0, appends = 0, sawFullEvents = false, sawProjectile = false;
  for (const styles of [['mage', 'mage'], ['grappler', 'ninja'], ['hammer', 'cat'], ['sword', 'boxer'], ['swift', 'mage']]) {
    const room = R.create({ now: () => 0 });
    styles.forEach((style, seat) => room.join(seat, { name: '实验' + seat, signature: 'lab:' + seat, kind: 'sprite', style }));
    room.ready(0, true); room.ready(1, true);
    const brains = [AI.create({ level: 3, seed: 11 }), AI.create({ level: 3, seed: 27 })];
    const cache = [];
    for (let frame = 0; frame < 3600; frame++) {
      for (let seat = 0; seat < 2; seat++) room.input(seat, brains[seat].think(room.room.match, seat));
      room.tick();
      if (frame % 3) continue;
      const next = { serial: ++snapshots, view: room.view(1) };
      assert.ok(M.validSnapshot(next.view.match));
      sawFullEvents ||= next.view.match.events.length === 64;
      sawProjectile ||= next.view.match.projectiles.length > 0;
      if (cache.length) {
        // A state sent 120–150 ms before the new one models an acknowledged
        // baseline instead of incorrectly relying on the most recent send.
        const { ops } = check(cache[Math.max(0, cache.length - 3)], next);
        appends += ops.filter(op => op[0] === 'events').length;
      }
      cache.push(next); if (cache.length > 5) cache.shift();
    }
  }
  assert.ok(sawFullEvents, 'actual combat must reach the 64-event rolling boundary');
  assert.ok(sawProjectile, 'actual combat must exercise projectile creation/removal');
  assert.ok(appends > 50, 'actual combat must exercise event appends repeatedly');
  assert.equal(snapshots, 6000);
  t.diagnostic(JSON.stringify({ snapshots, comparisons: snapshots - 5, appends, sawFullEvents, sawProjectile }));
});
