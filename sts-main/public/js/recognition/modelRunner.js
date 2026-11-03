// Loads a trained sign model (ONNX) and runs it in the browser with ONNX Runtime Web.
// It only works if a real model has been added under /models/<lang>/. Nothing is bundled.
import { SEQ_LEN, FEATURE_DIM, resample } from './features.js';
import { softmax } from './decision.js';

const ORT_VERSION = '1.20.1';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

// labels.json is written by training/train.py. Reject anything that does not match this build.
export function validateLabels(meta) {
  if (!meta || typeof meta !== 'object') throw new Error('labels.json is not an object');
  if (meta.sequenceLength !== SEQ_LEN) throw new Error(`sequenceLength ${meta.sequenceLength} != ${SEQ_LEN}`);
  if (meta.featureDim !== FEATURE_DIM) throw new Error(`featureDim ${meta.featureDim} != ${FEATURE_DIM}`);
  if (!Array.isArray(meta.labels) || meta.labels.length < 2) throw new Error('labels.json needs at least 2 labels');
  for (const l of meta.labels) if (!l || typeof l.gloss !== 'string' || typeof l.meaning !== 'string') throw new Error('every label needs gloss and meaning');
  return meta;
}

// metrics.json is written by the evaluation step on the held-out TEST set. Optional.
// Returns null unless it is complete, so the UI never shows a made-up number.
export function readMetrics(m) {
  if (!m || typeof m.testTop1 !== 'number' || !(m.testClips > 0) || m.split !== 'signer-disjoint') return null;
  return { top1: m.testTop1, top5: typeof m.testTop5 === 'number' ? m.testTop5 : null, clips: m.testClips, dataset: m.dataset || 'unspecified' };
}

async function loadOrt() {
  if (!globalThis.ort) {
    const { loadScript } = await import('../net.js');
    await loadScript(ORT_BASE + 'ort.min.js');
  }
  globalThis.ort.env.wasm.wasmPaths = ORT_BASE;
  return globalThis.ort;
}

async function getJson(fetchFn, url) {
  const r = await fetchFn(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// Is a complete model installed? (cheap: two small requests, no runtime download)
export async function findModel(dir, fetchFn = globalThis.fetch) {
  try {
    const meta = validateLabels(await getJson(fetchFn, dir + '/labels.json'));
    const head = await fetchFn(dir + '/model.onnx', { method: 'HEAD', cache: 'no-store' });
    if (!head.ok) return null;
    let metrics = null;
    try { metrics = readMetrics(await getJson(fetchFn, dir + '/metrics.json')); } catch (e) { /* optional */ }
    return { meta, metrics };
  } catch (e) { return null; }
}

// Returns { labels, threshold, predict(clip) -> probabilities }.
export async function loadModel(dir, { fetchFn = globalThis.fetch, ortLoader = loadOrt, meta } = {}) {
  meta ||= validateLabels(await getJson(fetchFn, dir + '/labels.json'));
  const ort = await ortLoader();
  const session = await ort.InferenceSession.create(dir + '/model.onnx', { executionProviders: ['wasm'] });
  const inName = session.inputNames[0]; const outName = session.outputNames[0];
  return {
    labels: meta.labels,
    threshold: typeof meta.threshold === 'number' ? meta.threshold : 0.7,
    async predict(clip) {
      const x = new ort.Tensor('float32', resample(clip), [1, SEQ_LEN, FEATURE_DIM]);
      const out = await session.run({ [inName]: x });
      const logits = out[outName].data;
      if (logits.length !== meta.labels.length) throw new Error('model output does not match labels.json');
      return softmax(logits);
    },
  };
}


// ASLNow! static fingerspelling model. Input is one MediaPipe hand: [1, 21, 3].
// This is deliberately separate from the project's temporal ONNX sign-model path.
const ASLNOW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => ({
  gloss: letter, meaning: letter,
}));
let tfLoading;
async function loadTensorFlow() {
  if (!globalThis.tf) {
    if (!tfLoading) tfLoading = import('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/+esm')
      .then((mod) => { globalThis.tf = mod; return mod; })
      .catch((err) => { tfLoading = null; throw err; });
  }
  return globalThis.tf || tfLoading;
}

export async function findAslNowModel(dir = '/models/asl', fetchFn = globalThis.fetch) {
  try {
    const [json, bin] = await Promise.all([
      fetchFn(dir + '/model.json', { method: 'HEAD', cache: 'no-store' }),
      fetchFn(dir + '/group1-shard1of1.bin', { method: 'HEAD', cache: 'no-store' }),
    ]);
    if (!json.ok || !bin.ok) return null;
    return { meta: { labels: ASLNOW_LABELS, threshold: 0.65 }, metrics: null };
  } catch (e) { return null; }
}

export async function loadAslNowModel(dir = '/models/asl') {
  const tf = await loadTensorFlow();
  const model = await tf.loadLayersModel(dir + '/model.json');
  const shape = model.inputs?.[0]?.shape;
  if (!shape || shape.length !== 3 || shape[1] !== 21 || shape[2] !== 3) {
    model.dispose();
    throw new Error('ASLNow model input must be [batch, 21, 3]');
  }
  if (model.outputs?.[0]?.shape?.at(-1) !== 26) {
    model.dispose();
    throw new Error('ASLNow model must return 26 letter scores');
  }
  return {
    kind: 'aslnow', labels: ASLNOW_LABELS, threshold: 0.65,
    async predictLandmarks(landmarks) {
      if (!Array.isArray(landmarks) || landmarks.length !== 21) throw new Error('Expected 21 hand landmarks');
      const values = new Float32Array(63);
      landmarks.forEach((point, i) => {
        values[i * 3] = point.x;
        values[i * 3 + 1] = point.y;
        values[i * 3 + 2] = point.z;
      });
      const input = tf.tensor3d(values, [1, 21, 3]);
      let output;
      try {
        output = model.predict(input);
        const scores = await output.data();
        // Model has a linear output layer; convert logits to probabilities.
        const max = Math.max(...scores);
        const exps = Array.from(scores, (v) => Math.exp(v - max));
        const total = exps.reduce((a, b) => a + b, 0);
        return exps.map((v) => v / total);
      } finally {
        input.dispose();
        if (Array.isArray(output)) output.forEach((t) => t.dispose());
        else output?.dispose();
      }
    },
    dispose() { model.dispose(); },
  };
}
