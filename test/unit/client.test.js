'use strict';
// Tests for browser modules that need no DOM. They are ES modules, so load them with import().
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '../../public/js', rel)).href);

test('HoldTracker needs a steady hold and does not repeat a word', async () => {
  const { HoldTracker } = await load('recognition/holdTracker.js');
  const t = new HoldTracker({ holdFrames: 3, lostFrames: 2 });
  assert.equal(t.sign('hello'), null);
  assert.equal(t.sign('hello'), null);
  assert.equal(t.sign('hello'), 'hello', 'committed on the third frame');
  assert.equal(t.sign('hello'), null, 'same word is not repeated');
  t.miss(false); // an uncertain frame
  for (let i = 0; i < 5; i++) assert.equal(t.sign('hello'), null, 'still no repeat after an uncertain frame');
  t.miss(true); t.miss(true); // hand left the picture
  t.sign('hello'); t.sign('hello');
  assert.equal(t.sign('hello'), 'hello', 'allowed again after the hand was gone');
});

test('HoldTracker restarts the count when the sign changes', async () => {
  const { HoldTracker } = await load('recognition/holdTracker.js');
  const t = new HoldTracker({ holdFrames: 3 });
  t.sign('a'); t.sign('a'); t.sign('b');
  assert.equal(t.sign('b'), null);
  assert.equal(t.sign('b'), 'b');
});

test('classify separates no hand, uncertain and confident signs', async () => {
  const { classify } = await load('recognition/signDetector.js');
  const { STARTER } = await load('recognition/modelRegistry.js');
  assert.deepEqual(classify({ landmarks: [] }), { state: 'nohand' });
  assert.deepEqual(classify(null), { state: 'nohand' });
  const hand = [[{}]];
  assert.equal(classify({ landmarks: hand, gestures: [[{ categoryName: 'Thumb_Up', score: 0.3 }]] }).state, 'uncertain', 'below threshold');
  assert.equal(classify({ landmarks: hand, gestures: [[{ categoryName: 'None', score: 0.99 }]] }).state, 'uncertain', 'unknown gesture is never translated');
  assert.equal(classify({ landmarks: hand, gestures: [] }).state, 'uncertain');
  const ok = classify({ landmarks: hand, gestures: [[{ categoryName: 'Thumb_Up', score: 0.9 }]] });
  assert.deepEqual(ok, { state: 'sign', label: 'Thumbs up', word: 'good', score: 0.9 });
  assert.ok(Object.keys(STARTER.labels).length === 7);
});

test('model registry distinguishes the installed ASL fingerspelling model from planned ISL', async () => {
  const { MODELS, STARTER } = await load('recognition/modelRegistry.js');
  assert.equal(MODELS.isl.status, 'planned');
  assert.equal(MODELS.asl.status, 'pretrained-static-letters');
  assert.equal(STARTER.status, 'demo');
});

test('ASLNow model discovery requires both TensorFlow.js files', async () => {
  const { findAslNowModel } = await load('recognition/modelRunner.js');
  const fetchFn = async (url) => ({ ok: !url.endsWith('missing.bin') });
  const found = await findAslNowModel('/models/asl', fetchFn);
  assert.equal(found.meta.labels.length, 26);
  assert.equal(found.meta.labels[0].gloss, 'A');
  const missing = await findAslNowModel('/models/asl', async (url) => ({ ok: !url.endsWith('group1-shard1of1.bin') }));
  assert.equal(missing, null);
});

test('sentence builder only joins recognised words', async () => {
  const { appendWord, finishSentence } = await load('languages/sentenceBuilder.js');
  let s = appendWord('', 'hello');
  s = appendWord(s, 'friend');
  assert.equal(s, 'Hello friend');
  assert.equal(finishSentence(s), 'Hello friend.');
  assert.equal(finishSentence('Done.'), 'Done.');
  assert.equal(finishSentence(''), '');
  assert.equal(appendWord('Done.', 'yes'), 'Done. Yes');
});

// ---------- waitForServer (Render cold start) ----------
const okRes = { ok: true, json: async () => ({ status: 'ok' }) };

test('waitForServer returns at once when the server is awake (one health request)', async () => {
  const { waitForServer } = await load('net.js');
  let calls = 0; const seen = [];
  const r = await waitForServer({ base: '', fetchFn: async (u) => { calls++; seen.push(u); return okRes; } });
  assert.equal(calls, 1); assert.equal(r.attempts, 1); assert.deepEqual(seen, ['/health']);
});

test('waitForServer keeps retrying while the server wakes, then succeeds', async () => {
  const { waitForServer } = await load('net.js');
  let calls = 0; const progress = [];
  const r = await waitForServer({
    base: 'https://x.example',
    fetchFn: async (u) => {
      calls++;
      if (calls === 1) throw new TypeError('network');
      if (calls === 2) return { ok: false, status: 503, json: async () => ({}) };
      if (calls === 3) return { ok: true, json: async () => { throw new Error('html page, not json'); } };
      return okRes;
    },
    wait: async () => {}, onProgress: (p) => progress.push(p.attempt),
  });
  assert.equal(r.attempts, 4);
  assert.deepEqual(progress, [1, 2, 3, 4]);
});

test('waitForServer times out and can be aborted', async () => {
  const { waitForServer } = await load('net.js');
  let t = 0;
  await assert.rejects(
    waitForServer({ fetchFn: async () => { throw new Error('down'); }, now: () => t, wait: async () => { t += 30000; }, timeoutMs: 90000 }),
    /timeout/,
  );
  const ac = new AbortController(); ac.abort();
  await assert.rejects(waitForServer({ fetchFn: async () => okRes, signal: ac.signal }), /aborted/);
});

test('waitForServer gives up on a hung request instead of waiting forever', async () => {
  const { waitForServer } = await load('net.js');
  let calls = 0;
  const r = await waitForServer({
    attemptMs: 20, wait: async () => {},
    fetchFn: (u, { signal }) => {
      calls++;
      if (calls > 1) return Promise.resolve(okRes);
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted by timeout'))));
    },
  });
  assert.equal(r.attempts, 2);
});

test('createConnection keeps one handler per event and fails fast when offline', async () => {
  const { createConnection } = await load('net.js');
  const listeners = {};
  const socket = {
    connected: false,
    on(e, f) { (listeners[e] ||= []).push(f); }, off(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
    emit(e, p, cb) { cb?.({ echoed: e }); }, disconnect() {},
  };
  const conn = createConnection({ base: '', io: () => socket });
  conn.on('x', () => {}); conn.on('x', () => {}); conn.on('x', () => {});
  assert.equal(listeners.x.length, 1, 'rebinding never stacks listeners');
  await assert.rejects(conn.emitAck('ping'), /offline/);
  socket.connected = true;
  assert.deepEqual(await conn.emitAck('ping'), { echoed: 'ping' });
});

// ---------- captions ----------
test('caption size is clamped to the available steps', async () => {
  const { clampSize, SIZES } = await load('call/captions.js');
  assert.equal(clampSize(-5), 0); assert.equal(clampSize(99), SIZES.length - 1);
  assert.equal(clampSize('3'), 3); assert.equal(clampSize('junk'), 2); assert.equal(clampSize(undefined), 2);
  assert.ok(SIZES.every((s, i) => i === 0 || s > SIZES[i - 1]), 'sizes grow');
});

function fakeSR() {
  const instances = [];
  class SR {
    constructor() { this.started = 0; instances.push(this); }
    start() { this.started++; this.onstart?.(); }
    abort() { this.aborted = true; }
  }
  return { SR, instances };
}

test('speech captioner restarts after Chrome stops it, without dropping results', async () => {
  const { createSpeechCaptioner } = await load('call/captions.js');
  const { SR, instances } = fakeSR();
  const timers = []; let clock = 0; const finals = []; const status = [];
  const cap = createSpeechCaptioner({ SR, getLang: () => 'en-IN', onFinal: (t) => finals.push(t), onStatus: (s) => status.push(s), wait: (fn) => timers.push(fn), now: () => clock });
  cap.start();
  assert.equal(instances.length, 1); assert.equal(instances[0].lang, 'en-IN');
  instances[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: ' hello there ' }], { isFinal: true })] });
  assert.deepEqual(finals, ['hello there']);
  clock = 5000; instances[0].onend(); // Chrome ended the session after silence
  assert.equal(timers.length, 1); timers.shift()();
  assert.equal(instances.length, 2, 'a new session was started');
  assert.equal(cap.active, true);
  instances[1].onerror({ error: 'no-speech' }); clock = 9000; instances[1].onend(); timers.shift()();
  assert.equal(instances.length, 3, 'no-speech is normal and does not stop captions');
  cap.stop();
  assert.equal(cap.active, false); assert.ok(instances[2].aborted);
  instances[2].onend?.();
  assert.equal(timers.length, 0, 'no restart after stop');
});

test('speech captioner stops on denied permission and gives up on endless instant failures', async () => {
  const { createSpeechCaptioner } = await load('call/captions.js');
  let { SR, instances } = fakeSR();
  let status = []; let timers = [];
  let cap = createSpeechCaptioner({ SR, getLang: () => 'en-IN', onFinal() {}, onStatus: (s) => status.push(s), wait: (fn) => timers.push(fn), now: () => 0 });
  cap.start(); instances[0].onerror({ error: 'not-allowed' }); instances[0].onend();
  assert.ok(status.includes('denied')); assert.equal(cap.active, false); assert.equal(timers.length, 0);

  ({ SR, instances } = fakeSR()); status = []; timers = [];
  cap = createSpeechCaptioner({ SR, getLang: () => 'en-IN', onFinal() {}, onStatus: (s) => status.push(s), wait: (fn) => timers.push(fn), now: () => 0 });
  cap.start();
  for (let i = 0; i < 20 && timers.length + 1 > 0; i++) { instances.at(-1).onend(); if (!timers.length) break; timers.shift()(); }
  assert.ok(status.includes('failed'), 'stops instead of looping forever');
  assert.ok(instances.length <= 9);
});

test('speech captioner restarts with the new language', async () => {
  const { createSpeechCaptioner } = await load('call/captions.js');
  const { SR, instances } = fakeSR(); let lang = 'en-IN';
  const cap = createSpeechCaptioner({ SR, getLang: () => lang, onFinal() {}, onStatus() {}, wait: () => {}, now: () => 0 });
  cap.start(); lang = 'hi-IN'; cap.refresh();
  assert.equal(instances.length, 2); assert.equal(instances[1].lang, 'hi-IN'); assert.ok(instances[0].aborted);
});

test('voice reads aloud only when on and drops a backlog', async () => {
  const { createVoice } = await load('call/captions.js');
  const spoken = []; let cancelled = 0;
  const synth = { getVoices: () => [{ lang: 'hi-IN', name: 'H' }, { lang: 'en-IN', name: 'E' }], speak: (u) => spoken.push(u), cancel: () => { cancelled++; } };
  class Utter { constructor(text) { this.text = text; } }
  const v = createVoice({ synth, Utter, getLang: () => 'en-IN' });
  v.speak('ignored while off'); assert.equal(spoken.length, 0);
  v.set(true); v.speak('one'); v.speak('   ');
  assert.equal(spoken.length, 1); assert.equal(spoken[0].voice.name, 'E'); assert.equal(spoken[0].lang, 'en-IN');
  v.speak('two'); v.speak('three'); v.speak('four');
  assert.ok(cancelled >= 1, 'backlog dropped');
  assert.equal(createVoice({ synth: undefined, Utter: undefined, getLang: () => 'en' }).supported, false);
});
