// Runs the ASLNow! fingerspelling model (a small TensorFlow.js "layers-model" MLP) in plain JavaScript.
// Why not TensorFlow.js: the network is only 63 -> 128 (relu) -> 26, so ~12k multiplications per frame.
// Loading a 1 MB+ library from a CDN gave one more thing that could fail, for no benefit.
//
// Input: the 21 MediaPipe hand landmarks as raw [x, y, z] (x,y normalised to the image, z relative to
// the wrist), exactly as the upstream dataset was recorded. No other normalisation is applied.
export const LANDMARKS = 21;
export const INPUT_DIM = LANDMARKS * 3;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const ACTIVATIONS = {
  linear: (v) => v,
  relu: (v) => (v > 0 ? v : 0),
};

// Reads model.json and returns the dense layers in order: [{ units, activation, kernel, bias }] (shapes only).
// Throws on anything this runner does not understand, so a wrong model is never run silently.
export function readTopology(modelJson) {
  const layers = modelJson?.modelTopology?.model_config?.config?.layers;
  if (!Array.isArray(layers) || !layers.length) throw new Error('model.json has no layers');
  const dense = []; let inputShape = null;
  for (const l of layers) {
    const c = l.config || {};
    if (l.class_name === 'InputLayer') inputShape = c.batch_input_shape;
    else if (l.class_name === 'Flatten') continue;
    else if (l.class_name === 'Dense') {
      if (!ACTIVATIONS[c.activation]) throw new Error(`unsupported activation "${c.activation}"`);
      if (c.use_bias === false) throw new Error('Dense layers without bias are not supported');
      dense.push({ units: c.units, activation: c.activation });
    } else throw new Error(`unsupported layer "${l.class_name}"`);
  }
  if (!dense.length) throw new Error('model.json has no Dense layers');
  const flat = Array.isArray(inputShape) ? inputShape.slice(1).reduce((a, b) => a * b, 1) : NaN;
  if (flat !== INPUT_DIM) throw new Error(`model input must be ${LANDMARKS}x3 landmarks, got ${JSON.stringify(inputShape)}`);
  if (dense.at(-1).units !== LETTERS.length) throw new Error(`model must output ${LETTERS.length} letters, got ${dense.at(-1).units}`);
  return dense;
}

// Builds the network from model.json plus the weight file (ArrayBuffer of little-endian float32).
export function buildNet(modelJson, buffer) {
  const dense = readTopology(modelJson);
  const specs = (modelJson.weightsManifest || []).flatMap((g) => g.weights || []);
  const view = new DataView(buffer);
  let offset = 0; let inDim = INPUT_DIM;
  const read = (shape) => {
    const n = shape.reduce((a, b) => a * b, 1);
    if (offset + n * 4 > view.byteLength) throw new Error('weight file is shorter than model.json says');
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getFloat32(offset + i * 4, true);
    offset += n * 4;
    return out;
  };
  const layers = dense.map((d, i) => {
    const k = specs[i * 2]; const b = specs[i * 2 + 1];
    if (!k?.name?.endsWith('kernel') || !b?.name?.endsWith('bias')) throw new Error('unexpected weight order in model.json');
    if (k.dtype !== 'float32' || b.dtype !== 'float32') throw new Error('only float32 weights are supported');
    if (k.shape?.length !== 2 || k.shape[0] !== inDim || k.shape[1] !== d.units || b.shape?.[0] !== d.units) {
      throw new Error(`layer ${i + 1} weight shape does not fit the network`);
    }
    const layer = { inDim, units: d.units, act: ACTIVATIONS[d.activation], kernel: read(k.shape), bias: read(b.shape) };
    inDim = d.units;
    return layer;
  });
  if (offset !== view.byteLength) throw new Error('weight file is longer than model.json says');
  for (const l of layers) for (const w of [l.kernel, l.bias]) for (let i = 0; i < w.length; i++) if (!Number.isFinite(w[i])) throw new Error('weight file contains invalid numbers');

  // x: Float32Array(63) -> logits Float32Array(26)
  return function forward(x) {
    let cur = x;
    for (const l of layers) {
      const out = new Float32Array(l.units);
      for (let j = 0; j < l.units; j++) out[j] = l.bias[j];
      for (let i = 0; i < l.inDim; i++) {
        const v = cur[i]; if (v === 0) continue;
        const row = i * l.units;
        for (let j = 0; j < l.units; j++) out[j] += v * l.kernel[row + j];
      }
      for (let j = 0; j < l.units; j++) out[j] = l.act(out[j]);
      cur = out;
    }
    return cur;
  };
}

export function softmax(logits) {
  let max = -Infinity; for (const v of logits) if (v > max) max = v;
  const e = Array.from(logits, (v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

// 21 landmarks -> Float32Array(63). mirror=true flips left/right (x -> 1 - x) so a left hand can be read
// as a right hand and the other way round. Returns null for anything that is not a full, finite hand.
export function landmarksToInput(landmarks, { mirror = false } = {}) {
  if (!Array.isArray(landmarks) || landmarks.length !== LANDMARKS) return null;
  const v = new Float32Array(INPUT_DIM);
  for (let i = 0; i < LANDMARKS; i++) {
    const p = landmarks[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
    v[i * 3] = mirror ? 1 - p.x : p.x; v[i * 3 + 1] = p.y; v[i * 3 + 2] = p.z;
  }
  return v;
}

// Reads the hand as seen and also mirrored, and keeps whichever the model is more sure about.
// Training data came from a few signers on one camera, so this makes it work for either hand and for
// a camera that mirrors or not. Returns { probs, mirrored } or null for an unusable hand.
export function classifyHand(forward, landmarks) {
  const a = landmarksToInput(landmarks); const b = landmarksToInput(landmarks, { mirror: true });
  if (!a || !b) return null;
  const pa = softmax(forward(a)); const pb = softmax(forward(b));
  return Math.max(...pb) > Math.max(...pa) ? { probs: pb, mirrored: true } : { probs: pa, mirrored: false };
}
