'use strict';

// Lossless bounded game-state codec; transport and acknowledgements live separately.
// Wire operations: ['set', path, value], ['delete', path],
// ['events', ['view','match','events'], expectedLastSeq, newlyAppendedEvents].
// Paths use string object keys and numeric array indices. No path creation,
// array holes, array splicing, accessors, custom instances or prototype keys.
// -0 follows JSON's 0 semantics; all other finite JS numbers retain precision.
// Failure is an Error with code and a fixed diagnostic message. The transport
// wrapper may fall back to a full state on a diff budget failure, but must never
// accept or partially deliver a rejected external patch.
const LIMITS = Object.freeze({
  MAX_STATE_BYTES: 60 * 1024,
  MAX_PATCH_BYTES: 120 * 1024,
  MAX_DEPTH: 32,
  MAX_NODES: 8192,
  MAX_PATCH_NODES: 32768,
  MAX_OPS: 2048,
  MAX_EVENTS: 64,
});
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EVENT_PATH = ['view', 'match', 'events'];
const OWN = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const MESSAGES = Object.freeze({
  DELTA_INVALID_JSON: 'State must contain only dense, plain JSON data',
  DELTA_UNSAFE_KEY: 'Prototype-related object keys and path segments are forbidden',
  DELTA_LIMIT_BYTES: 'Encoded JSON exceeds the byte budget',
  DELTA_LIMIT_DEPTH: 'JSON or patch path exceeds the depth budget',
  DELTA_LIMIT_NODES: 'JSON exceeds the node budget',
  DELTA_LIMIT_OPS: 'Patch exceeds the operation budget',
  DELTA_INVALID_OP: 'Patch operation has an invalid shape or operation name',
  DELTA_INVALID_PATH: 'Patch path is missing, invalid or cannot be deleted',
  DELTA_INVALID_EVENTS: 'Event append does not match the event history contract',
});
function fail(code) { const error = new Error(MESSAGES[code]); error.code = code; throw error; }

// JSON.stringify escapes lone surrogates. Valid surrogate pairs take four
// UTF-8 bytes; this counter keeps browser bundles free of Node dependencies.
function utf8Bytes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n++;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

function inspect(value, { bytes = LIMITS.MAX_STATE_BYTES, depth = LIMITS.MAX_DEPTH, nodes = LIMITS.MAX_NODES } = {}) {
  let size = 0, count = 0;
  const active = new WeakSet(), pieces = [];
  function write(text) {
    size += utf8Bytes(text);
    if (size > bytes) fail('DELTA_LIMIT_BYTES');
    pieces.push(text);
  }
  function string(text) {
    if (text.length > bytes) fail('DELTA_LIMIT_BYTES');
    write(JSON.stringify(text));
  }
  function visit(v, level) {
    if (level > depth) fail('DELTA_LIMIT_DEPTH');
    if (++count > nodes) fail('DELTA_LIMIT_NODES');
    if (v === null) return write('null');
    if (typeof v === 'string') return string(v);
    if (typeof v === 'boolean') return write(v ? 'true' : 'false');
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('DELTA_INVALID_JSON');
      return write(JSON.stringify(v));
    }
    if (typeof v !== 'object' || active.has(v)) fail('DELTA_INVALID_JSON');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('DELTA_INVALID_JSON');
    if (Object.getOwnPropertySymbols(v).length) fail('DELTA_INVALID_JSON');
    const names = Object.getOwnPropertyNames(v);
    if (names.length > nodes) fail('DELTA_LIMIT_NODES');
    active.add(v);
    if (array) {
      if (names.length !== v.length + 1) fail('DELTA_INVALID_JSON');
      write('[');
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !d.enumerable || !OWN(d, 'value')) fail('DELTA_INVALID_JSON');
        if (i) write(',');
        visit(d.value, level + 1);
      }
      write(']');
    } else {
      names.sort(); write('{');
      for (let i = 0; i < names.length; i++) {
        const key = names[i];
        if (BAD_KEYS.has(key)) fail('DELTA_UNSAFE_KEY');
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d.enumerable || !OWN(d, 'value')) fail('DELTA_INVALID_JSON');
        if (i) write(',');
        string(key); write(':'); visit(d.value, level + 1);
      }
      write('}');
    }
    active.delete(v);
  }
  visit(value, 0);
  return pieces.join('');
}
function canonical(value) { return inspect(value); }
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(key => OWN(b, key) && equal(a[key], b[key]));
}
function eventPath(path) { return path.length === EVENT_PATH.length && path.every((part, i) => part === EVENT_PATH[i]); }
function eventSequence(events, after = 0) {
  if (!Array.isArray(events) || events.length > LIMITS.MAX_EVENTS) return false;
  let last = after;
  for (const event of events) {
    if (!event || Array.isArray(event) || typeof event !== 'object' || !Number.isSafeInteger(event.seq) || event.seq <= last) return false;
    last = event.seq;
  }
  return true;
}
function appendCandidate(before, after) {
  if (!eventSequence(before) || !eventSequence(after)) return null;
  const last = before.length ? before[before.length - 1].seq : 0;
  const appended = after.filter(event => event.seq > last);
  return appended.length && equal(before.concat(appended).slice(-LIMITS.MAX_EVENTS), after) ? { last, appended } : null;
}

function diff(base, next, { events = true } = {}) {
  // Normalize through the strict validator so emitted values are independently
  // owned and all comparisons use exactly the same semantics as wire JSON.
  const before = JSON.parse(canonical(base)), after = JSON.parse(canonical(next));
  const ops = [];
  function push(op) { if (ops.length >= LIMITS.MAX_OPS) fail('DELTA_LIMIT_OPS'); ops.push(op); }
  function walk(a, b, path) {
    if (equal(a, b)) return;
    if (events && eventPath(path) && Array.isArray(a) && Array.isArray(b)) {
      const candidate = appendCandidate(a, b);
      if (candidate) { push(['events', path, candidate.last, candidate.appended]); return; }
    }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) { push(['set', path, b]); return; }
    if (Array.isArray(a)) {
      if (a.length !== b.length) { push(['set', path, b]); return; }
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], path.concat(i));
    } else {
      for (const key of Object.keys(a)) if (!OWN(b, key)) push(['delete', path.concat(key)]);
      for (const key of Object.keys(b)) {
        if (!OWN(a, key)) push(['set', path.concat(key), b[key]]);
        else walk(a[key], b[key], path.concat(key));
      }
    }
  }
  walk(before, after, []);
  inspect(ops, { bytes: LIMITS.MAX_PATCH_BYTES, nodes: LIMITS.MAX_PATCH_NODES, depth: LIMITS.MAX_DEPTH + 4 });
  return ops;
}

function validatePath(path) {
  if (!Array.isArray(path)) fail('DELTA_INVALID_PATH');
  if (path.length > LIMITS.MAX_DEPTH) fail('DELTA_LIMIT_DEPTH');
  for (const key of path) {
    if (typeof key === 'string') { if (BAD_KEYS.has(key)) fail('DELTA_UNSAFE_KEY'); }
    else if (!Number.isSafeInteger(key) || key < 0) fail('DELTA_INVALID_PATH');
  }
}
function parentAt(root, path) {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    if (!node || typeof node !== 'object') fail('DELTA_INVALID_PATH');
    const key = path[i];
    if (Array.isArray(node)) {
      if (!Number.isInteger(key) || key < 0 || key >= node.length) fail('DELTA_INVALID_PATH');
    } else if (typeof key !== 'string') fail('DELTA_INVALID_PATH');
    if (i === path.length - 1) return { node, key };
    if (!OWN(node, key)) fail('DELTA_INVALID_PATH');
    node = node[key];
  }
  fail('DELTA_INVALID_PATH');
}

function apply(base, operations) {
  let result = JSON.parse(canonical(base));
  if (!Array.isArray(operations)) fail('DELTA_INVALID_OP');
  if (operations.length > LIMITS.MAX_OPS) fail('DELTA_LIMIT_OPS');
  const ops = JSON.parse(inspect(operations, { bytes: LIMITS.MAX_PATCH_BYTES, nodes: LIMITS.MAX_PATCH_NODES, depth: LIMITS.MAX_DEPTH + 4 }));
  for (const op of ops) {
    if (!Array.isArray(op) || !['set', 'delete', 'events'].includes(op[0]) || op.length !== ({ set: 3, delete: 2, events: 4 })[op[0]]) fail('DELTA_INVALID_OP');
    const [kind, path] = op;
    validatePath(path);
    if (kind === 'events' && !eventPath(path)) fail('DELTA_INVALID_EVENTS');
    if (!path.length) {
      if (kind !== 'set') fail('DELTA_INVALID_PATH');
      result = op[2];
      continue;
    }
    const { node, key } = parentAt(result, path);
    if (kind === 'set') node[key] = op[2];
    else if (kind === 'delete') {
      if (Array.isArray(node) || !OWN(node, key)) fail('DELTA_INVALID_PATH');
      delete node[key];
    } else {
      const history = node[key], expected = op[2], added = op[3];
      if (!OWN(node, key) || !eventSequence(history) || !Number.isSafeInteger(expected) || expected < 0 ||
        expected !== (history.length ? history[history.length - 1].seq : 0) || !Array.isArray(added) || !added.length || !eventSequence(added, expected)) fail('DELTA_INVALID_EVENTS');
      node[key] = history.concat(added).slice(-LIMITS.MAX_EVENTS);
    }
  }
  canonical(result); // Enforce final size/depth/node bounds before it can escape.
  return result;
}

module.exports = { diff, apply, canonical, LIMITS };
