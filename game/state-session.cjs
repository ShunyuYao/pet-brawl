'use strict';
// Application-level state acknowledgements; SDK queue receipts are not an ACK.
const C = require('./state-codec.cjs');
const utf8 = new TextEncoder(), clone = v => JSON.parse(C.canonical(v));
const positive = n => Number.isSafeInteger(n) && n > 0;
const hashOK = h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h);
const fail = code => { throw Object.assign(Error(code), { code }); };
function cache({ maxEntries = 128, maxBytes = 512 * 1024 } = {}) {
  if (!positive(maxEntries) || maxEntries > 128 || !positive(maxBytes) || maxBytes > 512 * 1024) fail('invalid_cache_limit');
  const entries = new Map(); let bytes = 0;
  return {
    get: key => entries.get(key),
    put(key, state, digest) {
      const text = C.canonical(state), size = utf8.encode(text).length;
      if (size > maxBytes) fail('cache_entry_limit');
      if (entries.has(key)) bytes -= entries.get(key).size;
      entries.set(key, { state: JSON.parse(text), digest, size }); bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) { const k = entries.keys().next().value; bytes -= entries.get(k).size; entries.delete(k); }
    },
    clear() { entries.clear(); bytes = 0; },
    diagnostics: () => ({ entries: entries.size, bytes }),
  };
}
function createSender(options = {}) {
  const history = cache(options), now = options.now || Date.now, keyframeMs = options.keyframeMs ?? 1000;
  if (!Number.isFinite(keyframeMs) || keyframeMs < 100 || keyframeMs > 5000) fail('invalid_keyframe_interval');
  let generation = 1, matchNo = null, lastSerial = 0, acknowledged = 0, forceFull = true, lastFull = -Infinity;
  const counts = { resets: 0, acknowledged: 0, ignoredAck: 0, fullRequests: 0, full: 0, delta: 0, diffFallback: 0 };
  function reset() { generation++; history.clear(); lastSerial = 0; acknowledged = 0; forceFull = true; lastFull = -Infinity; counts.resets++; }
  function prepare(payload, digest) {
    if (!positive(payload?.serial) || !Number.isSafeInteger(payload?.view?.matchNo) || payload.view.matchNo < 0 || !hashOK(digest)) fail('invalid_state');
    const currentMatch = payload.view.matchNo;
    if (matchNo !== null && currentMatch !== matchNo) reset();
    matchNo = currentMatch;
    if (payload.serial <= lastSerial) fail('stale_source_state');
    const prior = history.get(acknowledged);
    const full = { v: 1, generation, matchNo, serial: payload.serial, base: 0, kind: 'full', data: clone(payload) };
    let delta = null;
    if (!forceFull && prior && now() - lastFull < keyframeMs) {
      try { delta = { ...full, kind: 'delta', base: acknowledged, data: C.diff(prior.state, payload) }; }
      catch (e) { if (!/limit|large|budget/i.test(e.code || e.message)) throw e; counts.diffFallback++; }
    }
    history.put(payload.serial, payload, digest); lastSerial = payload.serial;
    return { full, delta };
  }
  return {
    prepare, reset,
    sent(packet) { if (packet.generation !== generation) return; counts[packet.kind]++; if (packet.kind === 'full') { lastFull = now(); forceFull = false; } },
    acknowledge(a) {
      if (!a || a.v !== 1 || a.generation !== generation || !Number.isSafeInteger(a.serial) || a.serial < 0 || typeof a.needFull !== 'boolean' || !Number.isSafeInteger(a.minGeneration) || a.minGeneration < 0 || a.minGeneration > generation + 1 || Object.keys(a).some(k => !['v','generation','serial','digest','needFull','minGeneration'].includes(k))) { counts.ignoredAck++; return false; }
      if (a.needFull) { if (a.minGeneration > generation) reset(); forceFull = true; acknowledged = 0; counts.fullRequests++; return true; }
      if (a.minGeneration > generation) { counts.ignoredAck++; return false; }
      const p = history.get(a.serial);
      if (!p || a.serial <= acknowledged || !hashOK(a.digest) || p.digest !== a.digest) { counts.ignoredAck++; return false; }
      acknowledged = a.serial; counts.acknowledged++; return true;
    },
    diagnostics: () => ({ ...counts, ...history.diagnostics(), generation, matchNo, lastSerial, acknowledged, forceFull }),
  };
}
function createReceiver(options = {}) {
  const history = cache(options);
  let generation = 0, minGeneration = 0, lastSerial = 0, lastDigest = '', matchNo = null, needFull = true, requestGeneration = 0, revision = 0;
  const counts = { full: 0, delta: 0, missing: 0, ignored: 0, resets: 0 };
  const forget = () => { history.clear(); revision++; needFull = true; };
  return {
    forget,
    reset() { forget(); minGeneration = generation + 1; counts.resets++; },
    feedback: () => ({ v: 1, generation: requestGeneration || generation, minGeneration, serial: needFull ? 0 : lastSerial, digest: needFull ? '' : lastDigest, needFull }),
    async receive(p, digest, verify, apply = () => {}) {
      if (!p || Object.keys(p).length !== 7 || Object.keys(p).some(k => !['v','generation','matchNo','serial','base','kind','data'].includes(k)) || p.v !== 1 || !positive(p.generation) || !positive(p.serial) || !Number.isSafeInteger(p.matchNo) || p.matchNo < 0 || !hashOK(digest) || !['full','delta'].includes(p.kind) || p.kind === 'full' && p.base !== 0 || p.kind === 'delta' && (!positive(p.base) || p.base >= p.serial)) fail('invalid_packet');
      if (p.generation < minGeneration || p.generation < generation || p.generation === generation && p.serial <= lastSerial) { counts.ignored++; return { ignored: 'stale' }; }
      const version = revision;
      let state;
      if (p.kind === 'full') state = clone(p.data);
      else {
        const baseline = p.generation === generation && p.matchNo === matchNo && history.get(p.base);
        if (!baseline) { needFull = true; requestGeneration = p.generation; counts.missing++; fail('baseline_missing'); }
        state = C.apply(baseline.state, p.data);
      }
      if (state?.serial !== p.serial || state?.view?.matchNo !== p.matchNo) fail('invalid_packet');
      if (!await verify(state, digest)) fail('integrity_mismatch');
      if (version !== revision) { counts.ignored++; return { ignored: 'reset' }; }
      if (p.generation < generation || p.generation === generation && p.serial <= lastSerial) { counts.ignored++; return { ignored: 'stale' }; }
      // Application must finish synchronously before feedback can acknowledge it.
      // Give rendering/prediction its own copy so it cannot mutate cached bases.
      apply(clone(state));
      if (version !== revision) { counts.ignored++; return { ignored: 'reset' }; }
      if (p.generation !== generation) history.clear();
      history.put(p.serial, state, digest);
      generation = p.generation; requestGeneration = 0; matchNo = p.matchNo; lastSerial = p.serial; lastDigest = digest; needFull = false;
      counts[p.kind]++;
      return { state, kind: p.kind, base: p.base, serial: p.serial, generation };
    },
    diagnostics: () => ({ ...counts, ...history.diagnostics(), generation, minGeneration, lastSerial, matchNo, needFull }),
  };
}
module.exports = { createSender, createReceiver };
