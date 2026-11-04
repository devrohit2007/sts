// Turns MediaPipe hand landmarks into the numbers the sign model reads.
// training/features.py computes the SAME numbers; test/unit/parity keeps them identical.
// Change one and you must change the other, then retrain.
export const SEQ_LEN = 32;          // every sign is resampled to this many frames
export const HAND_DIM = 66;         // 21 landmarks x (x,y,z) shape + wrist x,y + present flag
export const FEATURE_DIM = HAND_DIM * 2;

const ZERO_HAND = () => new Array(HAND_DIM).fill(0);

// lm: 21 points {x,y,z}. Shape is relative to the wrist and scaled by hand size, so it does
// not depend on how far the hand is from the camera. Wrist x,y keep where the hand is.
export function handFeatures(lm) {
  const w = lm[0];
  let scale = 1e-6;
  for (const p of lm) scale = Math.max(scale, Math.hypot(p.x - w.x, p.y - w.y));
  const f = [];
  for (const p of lm) f.push((p.x - w.x) / scale, (p.y - w.y) / scale, (p.z - w.z) / scale);
  f.push(w.x, w.y, 1);
  return f;
}

// Left hand fills the first slot, right hand the second. If MediaPipe gives both the same side,
// fall back to image position so the two hands never overwrite each other.
export function frameFeatures(result) {
  const hands = result?.landmarks;
  if (!hands?.length) return null;
  const sides = result.handednesses || result.handedness || [];
  let slots = hands.slice(0, 2).map((_, i) => (sides[i]?.[0]?.categoryName === 'Right' ? 1 : 0));
  if (hands.length === 2 && slots[0] === slots[1]) slots = hands[0][0].x <= hands[1][0].x ? [0, 1] : [1, 0];
  const out = [ZERO_HAND(), ZERO_HAND()];
  hands.slice(0, 2).forEach((lm, i) => { out[slots[i]] = handFeatures(lm); });
  return Float32Array.from([...out[0], ...out[1]]);
}

// Nearest-frame resampling to exactly n frames (same rule as training/features.py).
export function resample(frames, n = SEQ_LEN) {
  const out = new Float32Array(n * FEATURE_DIM);
  const last = frames.length - 1;
  for (let i = 0; i < n; i++) {
    const idx = n === 1 ? 0 : Math.round((i * last) / (n - 1));
    out.set(frames[idx], i * FEATURE_DIM);
  }
  return out;
}
