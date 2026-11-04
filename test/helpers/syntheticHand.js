'use strict';
// Builds 21 MediaPipe-style landmarks for a hand with chosen finger positions. Used only by tests.
// Hand frame: x to the right, u up the fingers, depth away from the camera. A bent finger curls toward the camera.
const LEN = [0.45, 0.30, 0.25];
const MCP = { index: [-0.30, 1.00], middle: [-0.08, 1.05], ring: [0.14, 1.00], pinky: [0.34, 0.88] };
const IDX = { index: 5, middle: 9, ring: 13, pinky: 17 };
const FLEX = { ext: [0, 0, 0], mid: [0.4, 0.7, 0.4], curl: [1.3, 1.5, 0.9] };

function finger(name, state) {
  const pts = []; let [x, u] = MCP[name]; let d = 0; let A = 0;
  pts.push([x, u, d]);
  for (let k = 0; k < 3; k++) { A += FLEX[state][k]; u += LEN[k] * Math.cos(A); d -= LEN[k] * Math.sin(A); pts.push([x, u, d]); }
  return pts; // mcp, pip, dip, tip
}

// spec: { thumb: 'out'|'tucked'|'mid', index, middle, ring, pinky: 'ext'|'mid'|'curl', touch?: 'index'|'pinch' }
function makeHand(spec, { rotate = 0, mirror = false, W = 640, H = 480, size = 0.38, cx = 0.5, cy = 0.62 } = {}) {
  const pts = new Array(21);
  pts[0] = [0, 0, 0];
  const mcp4 = [-0.42, 0.52, 0];
  pts[1] = [-0.2, 0.25, 0]; pts[2] = mcp4;
  const th = { out: [[-0.75, 0.625, 0], [-1.035, 0.715, 0]], tucked: [[-0.25, 0.65, -0.15], [-0.1, 0.85, -0.2]], mid: [[-0.62, 0.72, -0.05], [-0.62, 0.98, -0.1]] }[spec.thumb];
  pts[3] = th[0]; pts[4] = th[1];
  for (const n of Object.keys(IDX)) { const f = finger(n, spec[n]); for (let k = 0; k < 4; k++) pts[IDX[n] + k] = f[k]; }
  if (spec.touch === 'index') { // thumb tip meets the index tip
    const t = pts[8]; pts[4] = [t[0] + 0.02, t[1] + 0.02, t[2]]; pts[3] = [(mcp4[0] + t[0]) / 2, (mcp4[1] + t[1]) / 2, t[2] / 2];
  }
  if (spec.touch === 'pinch') { // every fingertip gathers at one point
    const P = [-0.12, 0.8, -0.5];
    pts[4] = [P[0], P[1], P[2]]; pts[3] = [-0.3, 0.65, -0.3];
    ['index', 'middle', 'ring', 'pinky'].forEach((n, i) => {
      const m = pts[IDX[n]]; const tip = [P[0] + 0.03 * (i - 1.5), P[1] + 0.02 * i, P[2]];
      pts[IDX[n] + 3] = tip; pts[IDX[n] + 1] = [(m[0] + tip[0]) / 2, (m[1] + tip[1]) / 2 + 0.1, -0.3]; pts[IDX[n] + 2] = [(m[0] + tip[0]) / 2 * 0.3 + tip[0] * 0.7, (m[1] + tip[1]) / 2 * 0.3 + tip[1] * 0.7, -0.45];
    });
  }
  const c = Math.cos(rotate); const s = Math.sin(rotate);
  return pts.map(([x, u, d]) => {
    const mx = mirror ? -x : x; const rx = mx * c - u * s; const ru = mx * s + u * c;
    const px = cx * W + rx * size * H; const py = cy * H - ru * size * H;
    return { x: px / W, y: py / H, z: (d * size * H) / W };
  });
}
const ALL = (s) => ({ index: s, middle: s, ring: s, pinky: s });
const SHAPES = {
  ok:         { thumb: 'out', ...ALL('ext'), index: 'mid', touch: 'index' },
  pinch:      { thumb: 'out', ...ALL('mid'), touch: 'pinch' },
  call_me:    { thumb: 'out', index: 'curl', middle: 'curl', ring: 'curl', pinky: 'ext' },
  rock:       { thumb: 'tucked', index: 'ext', middle: 'curl', ring: 'curl', pinky: 'ext' },
  three:      { thumb: 'tucked', index: 'ext', middle: 'ext', ring: 'ext', pinky: 'curl' },
  four:       { thumb: 'tucked', ...ALL('ext') },
  l_shape:    { thumb: 'out', index: 'ext', middle: 'curl', ring: 'curl', pinky: 'curl' },
  pinky:      { thumb: 'tucked', index: 'curl', middle: 'curl', ring: 'curl', pinky: 'ext' },
  point_side: { thumb: 'tucked', index: 'ext', middle: 'curl', ring: 'curl', pinky: 'curl' },
};
module.exports = { makeHand, SHAPES, ALL };
