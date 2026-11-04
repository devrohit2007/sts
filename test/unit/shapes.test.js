'use strict';
// Custom hand shapes (OK, call me, rock on, ...). The hands are synthetic (test/helpers/syntheticHand.js), built from
// finger angles, so these tests check the rules, rotation, left/right hand and camera shape. They do not prove how
// well the rules work on real hands in real light.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeHand, SHAPES, ALL } = require('../helpers/syntheticHand');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '../../public/js', rel)).href);
const CAMERAS = [[640, 480], [1280, 720], [480, 640]]; // 4:3, 16:9 and a portrait phone camera

test('every custom shape is recognised for either hand, tilted, and on any camera shape', async () => {
  const { classifyShape, CUSTOM_SHAPES } = await load('recognition/handShapes.js');
  assert.deepEqual(Object.keys(SHAPES).sort(), Object.keys(CUSTOM_SHAPES).sort(), 'every shape has a test hand');
  for (const [id, spec] of Object.entries(SHAPES)) {
    const turns = id === 'point_side' ? [Math.PI / 2, -Math.PI / 2, Math.PI / 2 + 0.3] : [0, 0.5, -0.5];
    for (const [W, H] of CAMERAS) for (const mirror of [false, true]) for (const rotate of turns) {
      const r = classifyShape(makeHand(spec, { rotate, mirror, W, H }), { width: W, height: H });
      assert.equal(r?.id, id, `${id} (${W}x${H}, mirror=${mirror}, rotate=${rotate.toFixed(2)}) read as ${r?.id}`);
      assert.equal(r.word, CUSTOM_SHAPES[id][1]); assert.equal(r.label, CUSTOM_SHAPES[id][0]);
      assert.ok(r.score >= 0.6 && r.score <= 0.95);
    }
  }
});

test('size and position do not matter (near, far, off to one side)', async () => {
  const { classifyShape } = await load('recognition/handShapes.js');
  for (const opts of [{ size: 0.15 }, { size: 0.5, cy: 0.7 }, { cx: 0.15 }, { cx: 0.85, cy: 0.4 }]) {
    assert.equal(classifyShape(makeHand(SHAPES.three, opts), { width: 640, height: 480 })?.id, 'three', JSON.stringify(opts));
  }
});

test('hands that are not one of the custom shapes are left to the built-in gestures', async () => {
  const { classifyShape } = await load('recognition/handShapes.js');
  const none = {
    'open palm': { thumb: 'out', ...ALL('ext') },
    'closed fist': { thumb: 'tucked', ...ALL('curl') },
    'thumbs up': { thumb: 'out', ...ALL('curl') },
    'peace sign': { thumb: 'tucked', index: 'ext', middle: 'ext', ring: 'curl', pinky: 'curl' },
    'I love you': { thumb: 'out', index: 'ext', middle: 'curl', ring: 'curl', pinky: 'ext' },
    'half-bent fingers': { thumb: 'tucked', ...ALL('mid') },
    'index finger up': SHAPES.point_side, // upright: the built-in Pointing_Up gesture
  };
  for (const [name, spec] of Object.entries(none)) {
    assert.equal(classifyShape(makeHand(spec), { width: 640, height: 480 }), null, name);
  }
});

test('unusable input gives no shape instead of a guess', async () => {
  const { classifyShape } = await load('recognition/handShapes.js');
  const hand = makeHand(SHAPES.four);
  assert.equal(classifyShape(null), null);
  assert.equal(classifyShape([]), null);
  assert.equal(classifyShape([{ x: 0.5, y: 0.5 }]), null, 'one point is not a hand');
  assert.equal(classifyShape(hand.slice(0, 20)), null);
  assert.equal(classifyShape(hand.map((p, i) => (i === 7 ? { x: NaN, y: 0, z: 0 } : p))), null);
  assert.equal(classifyShape(Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))), null, 'all points on one spot');
  assert.equal(classifyShape(Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.5, z: 0 }))), null, 'a tiny dot of a hand');
  assert.ok(classifyShape(hand.map((p) => ({ x: p.x, y: p.y }))) !== undefined, 'missing z is tolerated');
});

test('the camera shape matters: ignoring it would squash a 16:9 hand', async () => {
  const { classifyShape } = await load('recognition/handShapes.js');
  const hand = makeHand(SHAPES.l_shape, { W: 1280, H: 720 });
  assert.equal(classifyShape(hand, { width: 1280, height: 720 })?.id, 'l_shape');
});

test('classify tries custom shapes first and falls back to the 7 built-in gestures', async () => {
  const { classify } = await load('recognition/signDetector.js');
  const dims = { width: 640, height: 480 };
  const four = makeHand(SHAPES.four);
  const r = classify({ landmarks: [four], gestures: [[{ categoryName: 'Open_Palm', score: 0.99 }]] }, undefined, dims);
  assert.equal(r.state, 'sign'); assert.equal(r.word, 'four'); assert.match(r.label, /Four fingers/);
  const fist = makeHand({ thumb: 'tucked', ...ALL('curl') });
  const b = classify({ landmarks: [fist], gestures: [[{ categoryName: 'Closed_Fist', score: 0.9 }]] }, undefined, dims);
  assert.equal(b.word, 'yes', 'a closed fist is still the built-in gesture');
  assert.equal(classify({ landmarks: [fist], gestures: [[{ categoryName: 'Closed_Fist', score: 0.2 }]] }, undefined, dims).state, 'uncertain');
  assert.equal(classify({ landmarks: [] }).state, 'nohand');
});

test('custom words never collide with the built-in ones and are all unique', async () => {
  const { CUSTOM_SHAPES } = await load('recognition/handShapes.js');
  const { STARTER } = await load('recognition/modelRegistry.js');
  const words = [...Object.values(CUSTOM_SHAPES), ...Object.values(STARTER.labels)].map((x) => x[1]);
  const names = [...Object.values(CUSTOM_SHAPES), ...Object.values(STARTER.labels)].map((x) => x[0]);
  assert.equal(new Set(words).size, words.length, 'two gestures share a word');
  assert.equal(new Set(names).size, names.length, 'two gestures share a name');
  assert.ok(Object.keys(CUSTOM_SHAPES).length >= 8);
  assert.equal(Object.keys(STARTER.labels).length, 7);
});
