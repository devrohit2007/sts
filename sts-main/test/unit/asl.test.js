'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../..');
const load = (rel) => import(pathToFileURL(path.join(root, 'public/js', rel)).href);

test('ASL target vocabulary is 50 core + 50 extended unique signs with meanings', async () => {
  const v = await load('recognition/aslVocabulary.js');
  assert.equal(v.ASL_CORE.length, 50); assert.equal(v.ASL_EXTENDED.length, 50);
  assert.equal(new Set(v.ASL_TARGET.map((s) => s.gloss)).size, 100);
  assert.ok(v.ASL_TARGET.every((s) => s.gloss && s.meaning));
  const json = require(path.join(root, 'training/vocabulary.json'));
  assert.deepEqual(json, v.ASL_TARGET, 'training/vocabulary.json is in sync');
});

test('softmax sums to 1 and decide rejects low confidence and ambiguous signs', async () => {
  const { softmax, decide } = await load('recognition/decision.js');
  const labels = [{ gloss: 'A', meaning: 'a' }, { gloss: 'B', meaning: 'b' }, { gloss: 'C', meaning: 'c' }];
  assert.ok(Math.abs(softmax([1, 2, 3]).reduce((a, b) => a + b) - 1) < 1e-9);
  assert.equal(decide([0.9, 0.06, 0.04], labels).state, 'sign');
  assert.equal(decide([0.5, 0.3, 0.2], labels).state, 'unknown', 'below confidence');
  assert.equal(decide([0.72, 0.7 - 0.0, 0.0].map((x) => x / 1.42), labels).state, 'unknown', 'tied with runner-up');
  const d = decide([0.1, 0.8, 0.1], labels); assert.equal(d.gloss, 'B'); assert.equal(d.meaning, 'b'); assert.equal(d.alternatives.length, 3);
  assert.equal(decide([0.6, 0.3, 0.1], labels, { minConf: 0.55 }).state, 'sign', 'threshold is configurable');
});

test('Cooldown blocks the same word and rapid-fire words', async () => {
  const { Cooldown } = await load('recognition/decision.js');
  const c = new Cooldown({ sameMs: 2000, anyMs: 700 });
  assert.equal(c.accept('hello', 0), true);
  assert.equal(c.accept('thanks', 300), false, 'too soon after any word');
  assert.equal(c.accept('hello', 1000), false, 'same word again');
  assert.equal(c.accept('thanks', 1000), true);
  assert.equal(c.accept('hello', 2500), true, 'same word allowed after the cooldown');
});

test('SignSegmenter cuts one clip per sign and drops accidental blips', async () => {
  const { SignSegmenter } = await load('recognition/segmenter.js');
  const s = new SignSegmenter({ minFrames: 3, maxFrames: 6, endAbsent: 2 });
  const f = new Float32Array(4);
  assert.deepEqual(s.push(null), {});
  s.push(f); s.push(f); s.push(f);
  assert.deepEqual(s.push(null), {}); const r = s.push(null);
  assert.equal(r.clip.length, 3);
  s.push(f); s.push(null); assert.equal(s.push(null).tooShort, true);
  let got; for (let i = 0; i < 6; i++) got = s.push(f); assert.equal(got.clip.length, 6, 'long signs are cut at maxFrames');
});

function lm(seed) { return Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + i * 0.01 + seed, y: 0.5 - i * 0.015, z: Math.sin(i + seed) * 0.05 })); }

test('frameFeatures has fixed size, ignores hand distance and handles one or two hands', async () => {
  const { frameFeatures, handFeatures, FEATURE_DIM, HAND_DIM } = await load('recognition/features.js');
  assert.equal(frameFeatures({ landmarks: [] }), null);
  const one = frameFeatures({ landmarks: [lm(0)], handednesses: [[{ categoryName: 'Right' }]] });
  assert.equal(one.length, FEATURE_DIM); assert.equal(one[HAND_DIM - 1], 0, 'left slot empty'); assert.equal(one[2 * HAND_DIM - 1], 1, 'right slot present');
  const near = handFeatures(lm(0)); const far = handFeatures(lm(0).map((p) => ({ x: p.x * 0.5, y: p.y * 0.5, z: p.z * 0.5 })));
  for (let i = 0; i < 63; i++) assert.ok(Math.abs(near[i] - far[i]) < 1e-9, 'shape is scale-free');
  const two = frameFeatures({ landmarks: [lm(0), lm(0.2)], handednesses: [[{ categoryName: 'Left' }], [{ categoryName: 'Left' }]] });
  assert.equal(two[HAND_DIM - 1], 1); assert.equal(two[2 * HAND_DIM - 1], 1, 'same-side labels still fill both slots');
});

test('JS and Python compute identical features (training/serving parity)', async () => {
  const { frameFeatures, resample } = await load('recognition/features.js');
  const frames = [0, 0.05, 0.1, 0.2, 0.25].map((s, i) => ({ landmarks: i % 2 ? [lm(s), lm(s + 0.3)] : [lm(s)], handednesses: i % 2 ? [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]] : [[{ categoryName: 'Right' }]] }));
  const js = Array.from(resample(frames.map(frameFeatures)));
  const input = JSON.stringify(frames.map((f) => ({ hands: f.landmarks.map((h) => h.map((p) => [p.x, p.y, p.z])), sides: f.handednesses.map((h) => h[0].categoryName) })));
  const py = JSON.parse(execFileSync('python3', ['-I', '-c', `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(root, 'training'))})
from features import frame_features, resample
fr = [frame_features(f['hands'], f['sides']) for f in json.loads(sys.stdin.read())]
print(json.dumps([float(x) for x in resample(fr).flatten()]))`], { input }).toString());
  assert.equal(py.length, js.length);
  let worst = 0; for (let i = 0; i < js.length; i++) worst = Math.max(worst, Math.abs(js[i] - py[i]));
  assert.ok(worst < 1e-5, 'max difference ' + worst);
});

test('validateLabels and readMetrics refuse incomplete or invented data', async () => {
  const { validateLabels, readMetrics } = await load('recognition/modelRunner.js');
  const ok = { sequenceLength: 32, featureDim: 132, labels: [{ gloss: 'A', meaning: 'a' }, { gloss: 'B', meaning: 'b' }] };
  assert.equal(validateLabels(ok), ok);
  assert.throws(() => validateLabels({ ...ok, featureDim: 99 }));
  assert.throws(() => validateLabels({ ...ok, labels: [{ gloss: 'A' }, { gloss: 'B' }] }));
  assert.throws(() => validateLabels(null));
  assert.equal(readMetrics(null), null);
  assert.equal(readMetrics({ testTop1: 0.9, testClips: 100, split: 'random' }), null, 'not signer-disjoint: not shown');
  assert.equal(readMetrics({ testTop1: 0.9, split: 'signer-disjoint' }), null, 'no test size: not shown');
  assert.equal(readMetrics({ testTop1: 0.9, testClips: 100, split: 'signer-disjoint', dataset: 'X' }).top1, 0.9);
});

test('findModel reports nothing when no model is installed, and loadModel runs predict', async () => {
  const { findModel, loadModel } = await load('recognition/modelRunner.js');
  assert.equal(await findModel('/models/asl', async () => ({ ok: false, status: 404 })), null);
  assert.equal(await findModel('/models/asl', async () => { throw new Error('offline'); }), null);
  const meta = { sequenceLength: 32, featureDim: 132, labels: [{ gloss: 'A', meaning: 'a' }, { gloss: 'B', meaning: 'b' }] };
  let fed;
  const ort = { Tensor: class { constructor(t, d, s) { this.d = d; this.s = s; } }, InferenceSession: { create: async () => ({ inputNames: ['input'], outputNames: ['logits'], run: async (f) => { fed = f.input; return { logits: { data: [0, 3] } }; } }) } };
  const m = await loadModel('/models/asl', { meta, ortLoader: async () => ort });
  const probs = await m.predict(Array.from({ length: 10 }, () => new Float32Array(132)));
  assert.deepEqual(fed.s, [1, 32, 132]); assert.ok(probs[1] > 0.9);
  const bad = await loadModel('/m', { meta: { ...meta, labels: [meta.labels[0], meta.labels[1], { gloss: 'C', meaning: 'c' }] }, ortLoader: async () => ort });
  await assert.rejects(bad.predict([new Float32Array(132)]), /does not match/);
});

test('signer-disjoint split never shares a signer between sets', () => {
  const out = execFileSync('python3', ['-I', '-c', `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(root, 'training'))})
from split import split_rows
rows = [{'path': f'{s}_{g}.mp4', 'gloss': g, 'signer': f's{s}'} for s in range(20) for g in 'ab']
r = split_rows(rows)
print(json.dumps({k: sorted({x['signer'] for x in v}) for k, v in r.items()}))
try:
    split_rows(rows[:6])
    print('NOERR')
except SystemExit:
    print('REFUSED')`]).toString().trim().split('\n');
  const sets = JSON.parse(out[0]);
  const all = [...sets.train, ...sets.val, ...sets.test];
  assert.equal(new Set(all).size, all.length); assert.ok(sets.test.length >= 1 && sets.val.length >= 1);
  assert.equal(out[1], 'REFUSED', 'too few signers is refused');
});
