// Extra hand shapes read straight from MediaPipe's 21 hand landmarks. No model, no training data: each shape is a
// simple rule about which fingers are straight or bent. They are generic gestures, NOT real ISL or ASL signs.
//
// How a finger is judged: the angle at its middle joint (straight is about 180 degrees, a bent finger is much
// less). That does not change when the hand is rotated, tilted, mirrored (left or right hand) or moved
// nearer to the camera. The image width and height are used so a 16:9 camera does not squash the angles.
// The thresholds were tuned on geometry, not on a large set of real hands: try them in good light.

// id -> [name shown in the guide, word that is captioned]
export const CUSTOM_SHAPES = {
  ok:         ['OK sign (thumb and index circle)', 'okay'],
  pinch:      ['Pinch (all fingertips together)', 'more'],
  call_me:    ['Call me (thumb and pinky out)', 'call me'],
  rock:       ['Rock on (index and pinky up)', 'cool'],
  three:      ['Three fingers (index, middle, ring)', 'three'],
  four:       ['Four fingers (thumb tucked in)', 'four'],
  l_shape:    ['L shape (thumb and index out)', 'look'],
  pinky:      ['Pinky up (other fingers closed)', 'bathroom'],
  point_side: ['Index finger pointing sideways', 'there'],
};

const FINGERS = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
const EXT_DEG = 155; const CURL_DEG = 125;   // straight at or above, bent at or below, in between = unsure
const THUMB_OUT = 0.65; const THUMB_IN = 0.45; // thumb tip to index knuckle, as a share of the palm length
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function angle(a, b, c) { // degrees at b
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const m = Math.hypot(...u) * Math.hypot(...v);
  if (!m) return 180;
  return (Math.acos(clamp((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / m, -1, 1)) * 180) / Math.PI;
}

// 21 normalised landmarks -> pixel-shaped points, or null if this is not a usable hand.
function toPoints(landmarks, width, height) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const pts = [];
  for (const p of landmarks) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    pts.push([p.x * width, p.y * height, (Number.isFinite(p.z) ? p.z : 0) * width]); // z uses the same scale as x
  }
  return pts;
}

function fingerState(p, [mcp, pip, , tip], wrist) {
  const ang = angle(p[mcp], p[pip], p[tip]);
  if (ang >= EXT_DEG && dist(p[tip], p[wrist]) > dist(p[pip], p[wrist])) return { s: 'ext', m: clamp((ang - EXT_DEG) / 20, 0, 1) };
  if (ang <= CURL_DEG) return { s: 'curl', m: clamp((CURL_DEG - ang) / 40, 0, 1) };
  return { s: 'mid', m: 0 };
}

// Returns { id, label, word, score } or null. `score` is how clear-cut the finger positions are (0.6 to 0.95).
// It is a rule margin, not a probability.
export function classifyShape(landmarks, { width = 1, height = 1 } = {}) {
  const p = toPoints(landmarks, width, height);
  if (!p) return null;
  const palm = Math.hypot(p[9][0] - p[0][0], p[9][1] - p[0][1]);
  if (!(palm > 0.03 * Math.max(width, height))) return null; // hand too small or all points on top of each other

  const f = {}; for (const [n, idx] of Object.entries(FINGERS)) f[n] = fingerState(p, idx, 0);
  const dOut = dist(p[4], p[5]) / (palm || 1);
  const thumbOut = dOut >= THUMB_OUT && angle(p[2], p[3], p[4]) >= 135;
  const thumbIn = dOut <= THUMB_IN;
  const tm = (out) => (out ? clamp((dOut - THUMB_OUT) / 0.25, 0, 1) : thumbIn ? clamp((THUMB_IN - dOut) / 0.25, 0, 1) : 0.3);
  const done = (id, margins) => ({ id, label: CUSTOM_SHAPES[id][0], word: CUSTOM_SHAPES[id][1], score: 0.6 + 0.35 * clamp(Math.min(...margins), 0, 1) });
  const all = (names, state) => names.every((n) => f[n].s === state);
  const mg = (...names) => names.map((n) => f[n].m);

  const near = (i) => dist(p[4], p[i]) / palm;
  // Pinch: all five fingertips gathered in one small cluster. The cluster test keeps a closed fist (tips spread
  // across the palm) from being read as a pinch.
  const tips = [4, 8, 12, 16, 20]; let spread = 0;
  for (const a of tips) for (const b of tips) spread = Math.max(spread, dist(p[a], p[b]) / palm);
  if (spread <= 0.5 && near(8) <= 0.45 && near(12) <= 0.45 && near(16) <= 0.55 && near(20) <= 0.65) {
    return done('pinch', [(0.5 - spread) / 0.25, (0.45 - Math.max(near(8), near(12))) / 0.2]);
  }
  // OK: thumb and index touch, the other three fingers are straight.
  if (near(8) <= 0.3 && all(['middle', 'ring', 'pinky'], 'ext')) return done('ok', [(0.3 - near(8)) / 0.2, ...mg('middle', 'ring', 'pinky')]);

  if (thumbOut) {
    if (all(['index', 'middle', 'ring'], 'curl') && f.pinky.s === 'ext') return done('call_me', [tm(true), ...mg('index', 'middle', 'ring', 'pinky')]);
    if (f.index.s === 'ext' && all(['middle', 'ring', 'pinky'], 'curl')) return done('l_shape', [tm(true), ...mg('index', 'middle', 'ring', 'pinky')]);
    return null; // thumb out with anything else is left to the built-in gestures (thumbs up, I love you, open palm)
  }
  if (all(['index', 'middle', 'ring', 'pinky'], 'ext') && thumbIn) return done('four', [tm(false), ...mg('index', 'middle', 'ring', 'pinky')]);
  if (all(['index', 'middle', 'ring'], 'ext') && f.pinky.s === 'curl') return done('three', [tm(false), ...mg('index', 'middle', 'ring', 'pinky')]);
  if (f.index.s === 'ext' && f.pinky.s === 'ext' && all(['middle', 'ring'], 'curl')) return done('rock', [tm(false), ...mg('index', 'middle', 'ring', 'pinky')]);
  if (f.pinky.s === 'ext' && all(['index', 'middle', 'ring'], 'curl')) return done('pinky', [tm(false), ...mg('index', 'middle', 'ring', 'pinky')]);
  if (f.index.s === 'ext' && all(['middle', 'ring', 'pinky'], 'curl')) {
    const dx = Math.abs(p[8][0] - p[5][0]); const dy = Math.abs(p[8][1] - p[5][1]);
    if (dx >= 1.7 * dy) return done('point_side', [tm(false), ...mg('index', 'middle', 'ring', 'pinky')]); // upward pointing is the built-in gesture
  }
  return null;
}
