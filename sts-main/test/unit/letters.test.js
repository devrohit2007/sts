'use strict';
// ASL fingerspelling (ASLNow! model) running in plain JavaScript.
// NOTE: the "prototype" hands in test/fixtures are synthetic: they were generated FROM the model so that each
// one is the model's own idea of a letter. These tests prove the plumbing (files, maths, mirror, smoothing, labels)
// is correct. They do NOT measure accuracy on real webcam hands, which has not been tested.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const load = (rel) => import(pathToFileURL(path.join(root, 'public/js', rel)).href);
const modelDir = path.join(root, 'public/models/asl');
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures', n), 'utf8'));
const asObj = (arr) => arr.map(([x, y, z]) => ({ x, y, z }));

// A fetch that serves the real model files from disk.
const diskFetch = async (url) => {
  const file = path.join(modelDir, path.basename(url));
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

test('the pure-JS network matches the reference maths of the real model file', async () => {
  const { buildNet } = await load('recognition/aslnow.js');
  const g = fixture('asl-golden.json');
  const json = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(modelDir, 'group1-shard1of1.bin'));
  const forward = buildNet(json, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const out = forward(Float32Array.from(g.input));
  assert.equal(out.length, 26);
  let worst = 0; for (let i = 0; i < 26; i++) worst = Math.max(worst, Math.abs(out[i] - g.logits[i]));
  assert.ok(worst < 1e-3, 'max logit difference ' + worst);
});

test('every letter prototype is read as that letter, for either hand (mirror)', async () => {
  const { loadAslNowModel } = await load('recognition/modelRunner.js');
  const model = await loadAslNowModel('/models/asl', { fetchFn: diskFetch });
  assert.equal(model.kind, 'aslnow'); assert.equal(model.labels.length, 26);
  const protos = fixture('asl-prototypes.json');
  const letters = Object.keys(protos);
  assert.equal(letters.length, 26);
  for (const letter of letters) {
    for (const flip of [false, true]) {
      const hand = asObj(protos[letter]).map((p) => ({ ...p, x: flip ? 1 - p.x : p.x }));
      const probs = model.predictLandmarks(hand);
      const best = probs.indexOf(Math.max(...probs));
      assert.equal(model.labels[best].gloss, letter, `${letter}${flip ? ' (mirrored hand)' : ''}`);
      assert.ok(probs[best] > 0.9, `${letter} confidence ${probs[best]}`);
      assert.ok(Math.abs(probs.reduce((a, b) => a + b) - 1) < 1e-6);
    }
  }
});

test('the ASL threshold is not so strict that a clear letter is rejected', async () => {
  const { MODELS } = await load('recognition/modelRegistry.js');
  const { decide } = await load('recognition/decision.js');
  const { loadAslNowModel } = await load('recognition/modelRunner.js');
  const model = await loadAslNowModel('/models/asl', { fetchFn: diskFetch });
  assert.ok(MODELS.asl.threshold <= 0.6 && model.threshold === MODELS.asl.threshold);
  const protos = fixture('asl-prototypes.json');
  for (const letter of ['A', 'B', 'L', 'Y']) {
    const d = decide(model.predictLandmarks(asObj(protos[letter])), model.labels, { minConf: model.threshold, minMargin: 0.10 });
    assert.equal(d.state, 'sign'); assert.equal(d.word, letter);
  }
});

test('landmarksToInput accepts only a full finite hand and can mirror it', async () => {
  const { landmarksToInput } = await load('recognition/aslnow.js');
  const hand = asObj(fixture('asl-prototypes.json').A);
  const v = landmarksToInput(hand); assert.equal(v.length, 63);
  assert.equal(v[0], Math.fround(hand[0].x)); assert.equal(v[2], Math.fround(hand[0].z));
  const m = landmarksToInput(hand, { mirror: true });
  assert.ok(Math.abs(m[0] - (1 - hand[0].x)) < 1e-6 && m[1] === v[1] && m[2] === v[2], 'only x is flipped');
  assert.equal(landmarksToInput(hand.slice(0, 20)), null);
  assert.equal(landmarksToInput(null), null);
  assert.equal(landmarksToInput(hand.map((p, i) => (i === 3 ? { x: NaN, y: 0, z: 0 } : p))), null);
  assert.equal(landmarksToInput([{ x: 0.5, y: 0.5 }]), null, 'a single point (not a hand) is rejected');
});

test('predictLandmarks throws on a bad hand instead of guessing', async () => {
  const { loadAslNowModel } = await load('recognition/modelRunner.js');
  const model = await loadAslNowModel('/models/asl', { fetchFn: diskFetch });
  assert.throws(() => model.predictLandmarks([{ x: 0.5, y: 0.5, z: 0 }]), /21 hand landmarks/);
});

test('a wrong or damaged model file is refused', async () => {
  const { readTopology, buildNet } = await load('recognition/aslnow.js');
  const json = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(modelDir, 'group1-shard1of1.bin'));
  const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  assert.equal(readTopology(json).length, 2);
  const clone = () => JSON.parse(JSON.stringify(json));
  const wrongOut = clone(); wrongOut.modelTopology.model_config.config.layers.at(-1).config.units = 10;
  assert.throws(() => readTopology(wrongOut), /26 letters/);
  const wrongIn = clone(); wrongIn.modelTopology.model_config.config.layers[0].config.batch_input_shape = [null, 10, 3];
  assert.throws(() => readTopology(wrongIn), /21x3/);
  const conv = clone(); conv.modelTopology.model_config.config.layers.splice(1, 0, { class_name: 'Conv1D', config: {} });
  assert.throws(() => readTopology(conv), /unsupported layer/);
  assert.throws(() => buildNet(json, ab(bin).slice(0, 1000)), /shorter/);
  assert.throws(() => buildNet(json, ab(Buffer.concat([bin, Buffer.alloc(8)]))), /longer/);
  const nan = Buffer.from(bin); nan.writeFloatLE(NaN, 40);
  assert.throws(() => buildNet(json, ab(nan)), /invalid numbers/);
  assert.throws(() => readTopology({}), /no layers/);
});

test('loadAslNowModel reports missing files and unsafe weight paths', async () => {
  const { loadAslNowModel } = await load('recognition/modelRunner.js');
  await assert.rejects(loadAslNowModel('/models/asl', { fetchFn: async () => ({ ok: false, status: 404 }) }), /404/);
  const json = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
  json.weightsManifest[0].paths = ['../../secret.bin'];
  await assert.rejects(loadAslNowModel('/models/asl', { fetchFn: async () => ({ ok: true, json: async () => json }) }), /usable weight file/);
});

test('ProbSmoother averages the last frames so one noisy frame cannot flip a letter', async () => {
  const { ProbSmoother } = await load('recognition/decision.js');
  const s = new ProbSmoother(3);
  s.push([0.9, 0.1]); s.push([0.9, 0.1]);
  const out = s.push([0.1, 0.9]); // a single bad frame
  assert.ok(out[0] > out[1], 'still reads the first class');
  assert.ok(Math.abs(out[0] - (0.9 + 0.9 + 0.1) / 3) < 1e-9);
  s.push([0.1, 0.9]); const flipped = s.push([0.1, 0.9]);
  assert.ok(flipped[1] > flipped[0], 'a lasting change does win');
  s.reset(); assert.deepEqual(s.push([1, 0]), [1, 0], 'reset forgets the past');
});
