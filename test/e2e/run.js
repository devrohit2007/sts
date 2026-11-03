'use strict';
/**
 * Browser end-to-end test: real Chromium, real WebRTC between two browser contexts, the real
 * client code and the real server handlers (lib/handlers.js).
 *
 * Stand-ins (so it runs without internet or Firebase/Socket.IO packages):
 *   - Socket.IO transport  -> in-memory bridge (test/helpers/fakeIO.js)
 *   - Firebase Auth        -> fake module; the server accepts the token "FAKE_TOKEN"
 *   - MediaPipe            -> fake recognizer that reads window.__gesture
 *   - Camera / microphone  -> Chromium's built-in fake devices
 * It does NOT test: real Socket.IO networking, real Google sign-in, Render, NVIDIA.
 *
 * Run: npm run test:e2e   (needs `playwright` with Chromium installed)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

let playwright;
try { playwright = require('playwright'); } catch (e) {
  try { playwright = require(require.resolve('playwright', { paths: [process.cwd(), require('node:child_process').execSync('npm root -g').toString().trim()] })); } catch (e2) {
    console.log('SKIPPED: playwright is not installed (npm i -g playwright && npx playwright install chromium)'); process.exit(0);
  }
}
const { FakeIO } = require('../helpers/fakeIO');
const { registerHandlers } = require('../../lib/handlers');
const { RoomStore } = require('../../lib/rooms');
const { createAuthenticator } = require('../../lib/auth');
const { publicConfig } = require('../../lib/config');

const PUBLIC = path.join(__dirname, '../../public');
const quiet = { log() {}, warn() {}, error: console.error };

// ---------------- server side ----------------
const io = new FakeIO();
const store = new RoomStore();
const authenticate = createAuthenticator({
  verifyIdToken: async (t) => {
    if (t !== 'FAKE_TOKEN') throw new Error('bad token');
    return { uid: 'google-1', name: 'Google Tester', picture: 'https://lh3.googleusercontent.com/a/tester' };
  },
  log: quiet,
});
const refine = async (words) => ({ text: `AI:${words.join(' ')}`, ai: true });
const config = { ...publicConfig({}, { googleSignIn: true }), ice: [] };

let healthFailures = 0; let healthHits = 0;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

const FAKE_IO_JS = `
window.io = function () {
  const handlers = {}, acks = {}; let n = 0;
  const sock = {
    connected: false, id: null,
    on(e, f) { (handlers[e] ||= []).push(f); return sock; },
    off(e, f) { handlers[e] = (handlers[e] || []).filter((x) => x !== f); return sock; },
    once(e, f) { const w = (...x) => { sock.off(e, w); f(...x); }; return sock.on(e, w); },
    emit(e, p, cb) { const id = typeof cb === 'function' ? ++n : 0; if (id) acks[id] = cb; window.__emit(e, JSON.stringify(p === undefined ? null : p), id); return sock; },
    disconnect() { window.__disc(); },
  };
  const fire = (e, p) => (handlers[e] || []).slice().forEach((f) => f(p));
  window.__deliver = (e, p) => fire(e, p);
  window.__ack = (id, v) => { const f = acks[id]; delete acks[id]; if (f) f(v); };
  window.__connect = (id) => { sock.id = id; sock.connected = true; fire('connect'); };
  window.__drop = () => { sock.connected = false; fire('disconnect', 'transport close'); };
  window.__hello().then((id) => setTimeout(() => window.__connect(id), 0));
  return sock;
};`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    healthHits++;
    if (healthFailures > 0) { healthFailures--; res.writeHead(503); return res.end('waking'); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}');
  }
  if (url.pathname === '/config') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(config)); }
  if (url.pathname === '/socket.io/socket.io.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(FAKE_IO_JS); }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  if (path.extname(file) === '.html') { // production points sts-api at Render; the test talks to this server instead
    return res.end(fs.readFileSync(file, 'utf8').replace(/(<meta name="sts-api" content=")[^"]*"/, '$1"'));
  }
  fs.createReadStream(file).pipe(res);
});

// ---------------- browser side stand-ins ----------------
const CORS = { 'access-control-allow-origin': '*', 'content-type': 'text/javascript' };
const FAKE_FIREBASE_APP = 'export const initializeApp = () => ({});';
const FAKE_FIREBASE_AUTH = `
let user = null; const subs = [];
export const getAuth = () => ({ get currentUser() { return user; } });
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export class GoogleAuthProvider { setCustomParameters() {} }
export const signInWithPopup = async () => {
  user = { uid: 'google-1', displayName: 'Google Tester', photoURL: 'https://lh3.googleusercontent.com/a/tester', getIdToken: async () => 'FAKE_TOKEN' };
  return { user };
};
export const signOut = async () => { user = null; };`;
const FAKE_MEDIAPIPE = `
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export class DrawingUtils { drawConnectors() {} drawLandmarks() {} }
export const GestureRecognizer = {
  HAND_CONNECTIONS: [],
  createFromOptions: async () => ({
    recognizeForVideo() {
      const g = window.__gesture;
      return g ? { landmarks: [[{ x: .5, y: .5 }]], gestures: [[{ categoryName: g, score: .95 }]] } : { landmarks: [], gestures: [] };
    },
  }),
};`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const controllers = new Map(); // page -> { page, fs, queue, errors }
function newServerSocket(c) {
  const s = io.connect();
  registerHandlers(io, s, { store, authenticate, refine, log: quiet });
  s.onReceive = (ev, payload) => c.push('__deliver', [ev, payload]);
  return s;
}

async function newContext(browser, port, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'] });
  await ctx.exposeBinding('__hello', async ({ page }) => {
    const c = controllers.get(page); c.fs = newServerSocket(c); return c.fs.id;
  });
  await ctx.exposeBinding('__emit', async ({ page }, ev, json, ackId) => {
    const c = controllers.get(page); const h = c.fs.handlers.get(ev); if (!h) return;
    await h(JSON.parse(json), ackId ? (v) => c.push('__ack', [ackId, v]) : undefined);
  });
  await ctx.exposeBinding('__disc', async ({ page }) => { await controllers.get(page).fs.disconnect(); });
  await ctx.route('**/firebasejs/**/firebase-app.js', (r) => r.fulfill({ headers: CORS, body: FAKE_FIREBASE_APP }));
  await ctx.route('**/firebasejs/**/firebase-auth.js', (r) => r.fulfill({ headers: CORS, body: FAKE_FIREBASE_AUTH }));
  await ctx.route(/tasks-vision@0\.10\.14\/\+esm/, (r) => r.fulfill({ headers: CORS, body: FAKE_MEDIAPIPE }));
  await ctx.route('**/lh3.googleusercontent.com/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  return ctx;
}

async function openPage(ctx, port, urlPath = '/') {
  const page = await ctx.newPage();
  const c = {
    page, fs: null, errors: [], queue: Promise.resolve(),
    push(fn, args) { this.queue = this.queue.then(() => page.evaluate(([f, a]) => window[f](...a), [fn, args]).catch(() => {})); return this.queue; },
  };
  controllers.set(page, c);
  page.on('pageerror', (e) => c.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) c.errors.push('console.error: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}${urlPath}`);
  return c;
}

// ---------------- tiny test runner ----------------
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, e }); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const T = 30000;
const SHOTS = process.env.SHOTS;
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const visible = (page, sel) => page.waitForSelector(sel, { state: 'visible', timeout: T });
const text = (page, sel) => page.locator(sel).first().innerText();
const remoteVideoPlaying = (page) => page.waitForFunction(
  () => { const v = [...document.querySelectorAll('.tile:not(.me) video')]; return v.length === 1 && v[0].videoWidth > 0 && !v[0].paused; }, null, { timeout: 45000 });

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await playwright.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctxA = await newContext(browser, port); const ctxB = await newContext(browser, port);
  let A; let B; let code;

  console.log('STS end-to-end');

  await step('cold start: waking screen shows, /health is retried, then sign-in appears', async () => {
    healthFailures = 2; healthHits = 0;
    A = await openPage(ctxA, port);
    await A.page.waitForSelector('#wake:not([hidden])', { timeout: 5000 });
    assert.match(await text(A.page, '#wakeTitle'), /Starting the server/);
    await visible(A.page, '#auth');
    assert.equal(healthHits, 3, 'two failed + one successful health request');
    await A.page.waitForTimeout(2500);
    assert.equal(healthHits, 3, 'no repeated health polling after the server is up');
    assert.equal(await A.page.locator('#wake').isHidden(), true);
  });

  await step('guest sign-in shows a temporary identity', async () => {
    await A.page.fill('#guestName', 'Asha'); await A.page.click('#guestBtn');
    await visible(A.page, '#lobby');
    assert.equal(await text(A.page, '#userName'), 'Asha');
    assert.match(await text(A.page, '#userKind'), /Guest/);
    await shot(A.page, '2-lobby');
  });

  await step('guest must type a name', async () => {
    const c = await openPage(await newContext(browser, port), port);
    await visible(c.page, '#auth'); await c.page.click('#guestBtn');
    assert.match(await text(c.page, '#authErr'), /type a name/i);
    await c.page.context().close();
  });

  await step('Google sign-in shows profile name and avatar', async () => {
    B = await openPage(ctxB, port);
    await visible(B.page, '#auth');
    assert.equal(await B.page.locator('#googleBtn').isEnabled(), true);
    await B.page.click('#googleBtn');
    await visible(B.page, '#lobby');
    assert.equal(await text(B.page, '#userName'), 'Google Tester');
    assert.match(await text(B.page, '#userKind'), /Google/);
    assert.equal(await B.page.locator('#userAvatar img').count(), 1);
  });

  await step('invalid and unknown room codes show clear errors', async () => {
    await B.page.fill('#joinCode', 'ABC'); await B.page.click('#joinBtn');
    assert.match(await text(B.page, '#lobbyErr'), /8-character/);
    await B.page.fill('#joinCode', 'ZZZZ2222'); await B.page.click('#joinBtn');
    await B.page.waitForFunction(() => /Room not found/.test(document.getElementById('lobbyErr').textContent), null, { timeout: T });
    assert.equal(await B.page.locator('#app').isHidden(), true);
  });

  await step('create a room (guest) and join it (Google); both see each other', async () => {
    await A.page.fill('#roomName', 'Clinic'); await A.page.click('#createBtn');
    await visible(A.page, '#app');
    code = await text(A.page, '#codeTxt');
    assert.match(code, /^[A-Z2-9]{8}$/);
    assert.equal(await text(A.page, '#roomTitle'), 'Clinic');
    await B.page.fill('#joinCode', code.toLowerCase()); await B.page.click('#joinBtn');
    await visible(B.page, '#app');
    for (const c of [A, B]) await c.page.waitForFunction(() => document.querySelectorAll('#grid .tile').length === 2, null, { timeout: T });
    assert.match(await text(A.page, '#people'), /Google Tester/);
    assert.match(await text(B.page, '#people'), /Asha/);
  });

  await step('WebRTC: video flows both ways and status badges clear', async () => {
    await Promise.all([remoteVideoPlaying(A.page), remoteVideoPlaying(B.page)]);
    for (const c of [A, B]) await c.page.waitForFunction(() => ![...document.querySelectorAll('.status')].some((s) => s.classList.contains('show')), null, { timeout: T });
  });

  await step('mic and camera switches reach the other person', async () => {
    await A.page.click('#micB');
    await B.page.waitForFunction(() => document.querySelectorAll('.tile:not(.me) .tag svg').length === 1, null, { timeout: T });
    await A.page.click('#micB');
    await B.page.waitForFunction(() => document.querySelectorAll('.tile:not(.me) .tag svg').length === 0, null, { timeout: T });
    await A.page.click('#camB');
    await B.page.waitForFunction(() => document.querySelector('.tile:not(.me)').classList.contains('nocam-on'), null, { timeout: T });
    assert.equal(await A.page.locator('#tile-me, .tile.me').first().evaluate((t) => t.classList.contains('nocam-on')), true);
    await A.page.click('#camB');
    await B.page.waitForFunction(() => !document.querySelector('.tile:not(.me)').classList.contains('nocam-on'), null, { timeout: T });
  });

  await step('quick phrases appear as captions for everyone', async () => {
    await A.page.click('.q >> text=I need help');
    for (const c of [A, B]) await c.page.waitForFunction(() => [...document.querySelectorAll('#caps .cap p')].some((p) => p.textContent === 'I need help'), null, { timeout: T });
    assert.match(await text(B.page, '#caps .cap small'), /Asha says/);
  });

  await step('sign detection: words are captioned, then replaced by the AI sentence', async () => {
    await A.page.click('#signB');
    await visible(A.page, '#tray');
    await A.page.waitForFunction(() => document.getElementById('liveHint').textContent !== 'Loading hand detection model', null, { timeout: T });
    await A.page.evaluate(() => { window.__gesture = 'Thumb_Up'; });
    await A.page.waitForFunction(() => [...document.querySelectorAll('#chips .chip')].some((c) => c.textContent === 'good'), null, { timeout: T });
    await A.page.evaluate(() => { window.__gesture = null; });
    await A.page.click('#sendWords');
    await B.page.waitForFunction(() => [...document.querySelectorAll('#caps .cap p')].some((p) => p.textContent === 'AI:good'), null, { timeout: T });
    assert.match(await text(B.page, '#transcript'), /AI:good/);
    await A.page.click('#signB');
    await A.page.waitForSelector('#tray', { state: 'hidden', timeout: T });
  });

  await step('chat works and is shown as plain text', async () => {
    await A.page.click('#tabChat'); await B.page.click('#tabChat');
    await A.page.fill('#chatIn', 'hello <b>there</b>'); await A.page.press('#chatIn', 'Enter');
    await B.page.waitForFunction(() => document.getElementById('msgs').textContent.includes('hello <b>there</b>'), null, { timeout: T });
    assert.equal(await B.page.locator('#msgs b b').count(), 0, 'html in messages is not rendered');
  });

  await step('captions can be made larger and the size is remembered', async () => {
    const before = await B.page.locator('#caps').evaluate((e) => getComputedStyle(e).getPropertyValue('--cap-size'));
    await B.page.click('#capPlus');
    const after = await B.page.locator('#caps').evaluate((e) => getComputedStyle(e).getPropertyValue('--cap-size'));
    assert.notEqual(before.trim(), after.trim());
    assert.equal(await B.page.evaluate(() => localStorage.getItem('sts.capSize')), '3');
  });

  await step('back button asks before leaving, Escape closes the dialog', async () => {
    await A.page.goBack();
    await visible(A.page, '#leaveModal.open .modal');
    await A.page.keyboard.press('Escape');
    await A.page.waitForSelector('#leaveModal.open', { state: 'detached', timeout: T });
    assert.equal(await A.page.locator('#app').isVisible(), true, 'still in the call');
  });

  await step('network drop: banner, then automatic sign-in + rejoin + video again', async () => {
    await B.push('__drop', []); await B.fs.disconnect();
    await visible(B.page, '#banner');
    assert.match(await text(B.page, '#banner'), /Connection lost/);
    await A.page.waitForFunction(() => document.querySelectorAll('#grid .tile').length === 1, null, { timeout: T });
    B.fs = newServerSocket(B); await B.push('__connect', [B.fs.id]);
    await B.page.waitForSelector('#banner', { state: 'hidden', timeout: T });
    for (const c of [A, B]) await c.page.waitForFunction(() => document.querySelectorAll('#grid .tile').length === 2, null, { timeout: T });
    await Promise.all([remoteVideoPlaying(A.page), remoteVideoPlaying(B.page)]);
  });

  await step('leaving cleans up for the other person and returns to the lobby', async () => {
    await B.page.click('#leaveB'); await B.page.click('#leaveConfirm');
    await visible(B.page, '#lobby');
    assert.equal(await B.page.inputValue('#joinCode'), code, 'room code is kept for easy rejoin');
    await A.page.waitForFunction(() => document.querySelectorAll('#grid .tile').length === 1, null, { timeout: T });
    assert.equal(store.state(store.roomIdOf(A.fs.id)).participants.length, 1);
    assert.equal(await B.page.evaluate(() => history.state?.sts ?? null), null, 'the call history entry was removed on leave');
  });

  await step('rejoin after leaving works (room still exists)', async () => {
    await B.page.click('#joinBtn'); await visible(B.page, '#app');
    await Promise.all([remoteVideoPlaying(A.page), remoteVideoPlaying(B.page)]);
  });

  await step('group call: a third person joins and all three see and hear each other', async () => {
    const ctxC = await newContext(browser, port);
    const C = await openPage(ctxC, port);
    await visible(C.page, '#auth'); await C.page.fill('#guestName', 'Meera'); await C.page.click('#guestBtn');
    await visible(C.page, '#lobby'); await C.page.fill('#joinCode', code); await C.page.click('#joinBtn');
    await visible(C.page, '#app');
    const twoRemotes = (pg) => pg.waitForFunction(() => {
      const v = [...document.querySelectorAll('.tile:not(.me) video')];
      return v.length === 2 && v.every((x) => x.videoWidth > 0 && !x.paused);
    }, null, { timeout: 60000 });
    await Promise.all([twoRemotes(A.page), twoRemotes(B.page), twoRemotes(C.page)]);
    await shot(A.page, '3-call-desktop');
    await C.page.click('#leaveB'); await C.page.click('#leaveConfirm'); await visible(C.page, '#lobby');
    await A.page.waitForFunction(() => document.querySelectorAll('#grid .tile').length === 2, null, { timeout: T });
    assert.deepEqual(C.errors, []);
    await ctxC.close();
  });

  await step('sign out returns to the sign-in screen', async () => {
    await B.page.click('#leaveB'); await B.page.click('#leaveConfirm'); await visible(B.page, '#lobby');
    await B.page.click('#signOutBtn'); await visible(B.page, '#auth');
  });

  await step('translator page: camera starts, gestures become words, no real-model claims', async () => {
    const c = await openPage(ctxA, port, '/translate.html');
    assert.match(await text(c.page, '#engineName'), /Starter gestures \(demo\)/);
    assert.match(await text(c.page, '#engineMsg'), /not real ISL/);
    assert.equal(await c.page.locator('[data-mode=continuous]').isDisabled(), true);
    await c.page.click('#startBtn');
    await c.page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Ready'), null, { timeout: T });
    await c.page.evaluate(() => { window.__gesture = 'Victory'; });
    await c.page.waitForFunction(() => document.getElementById('out').value.includes('Thank you'), null, { timeout: T });
    await c.page.evaluate(() => { window.__gesture = 'None'; });
    await c.page.waitForFunction(() => document.getElementById('predWord').textContent === 'Unknown sign', null, { timeout: T });
    await c.page.click('#stopBtn');
    assert.equal(await c.page.locator('#startBtn').isVisible(), true);
    assert.deepEqual(c.errors, []);
  });

  await step('ASL model mode: meaning, confidence, unknown signs, no duplicates (stubbed ONNX runtime)', async () => {
    const ctx = await newContext(browser, port);
    const labels = { sequenceLength: 32, featureDim: 132, threshold: 0.7, labels: [{ gloss: 'HELLO', meaning: 'Hello' }, { gloss: 'THANK-YOU', meaning: 'Thank you' }, { gloss: 'YES', meaning: 'Yes' }] };
    await ctx.route('**/models/asl/labels.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(labels) }));
    await ctx.route('**/models/asl/metrics.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ split: 'signer-disjoint', dataset: 'STUB (test only)', testClips: 50, testTop1: 0.9 }) }));
    await ctx.route('**/models/asl/model.onnx', (r) => r.fulfill({ contentType: 'application/octet-stream', body: 'stub' }));
    await ctx.addInitScript(() => {
      window.__logits = [5, 0, 0];
      window.ort = { env: { wasm: {} }, Tensor: class { constructor(t, d, s) { this.data = d; this.dims = s; } },
        InferenceSession: { create: async () => ({ inputNames: ['input'], outputNames: ['logits'], run: async () => ({ logits: { data: window.__logits } }) }) } };
    });
    const c = await openPage(ctx, port, '/translate.html');
    await c.page.click('[data-lang=asl]');
    await c.page.waitForFunction(() => document.getElementById('engineName').textContent.includes('3-sign model installed'), null, { timeout: T });
    assert.match(await text(c.page, '#engineMsg'), /top-1 90\.0%.*not used in training/);
    await c.page.click('#startBtn');
    await c.page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Ready'), null, { timeout: T });
    const sign = async (ms) => { await c.page.evaluate(() => { window.__gesture = 'Open_Palm'; }); await c.page.waitForTimeout(ms); await c.page.evaluate(() => { window.__gesture = null; }); };
    await sign(1000);
    await c.page.waitForFunction(() => document.getElementById('out').value === 'Hello', null, { timeout: T });
    assert.equal(await text(c.page, '#predWord'), 'HELLO'); assert.equal(await text(c.page, '#predMeaning'), 'Hello');
    assert.match(await text(c.page, '#predPct'), /^99%$/);
    await sign(800); // the same sign straight away is a duplicate
    await c.page.waitForTimeout(1500);
    assert.match(await c.page.inputValue('#out'), /^Hello\.?$/, 'cooldown stops the repeat');
    await c.page.evaluate(() => { window.__logits = [1, 1, 1]; });
    await sign(1000);
    await c.page.waitForFunction(() => document.getElementById('predWord').textContent === 'Unknown sign', null, { timeout: T });
    assert.match(await text(c.page, '#predState'), /Unknown or unsupported/);
    assert.match(await c.page.inputValue('#out'), /^Hello\.?$/, 'unknown signs are never translated');
    await c.page.click('#stopBtn');
    assert.deepEqual(c.errors, []);
  });

  await step('mobile layout: no sideways scrolling, side panel opens and closes', async () => {
    const ctx = await newContext(browser, port, { width: 390, height: 780 });
    const c = await openPage(ctx, port);
    const noOverflow = () => c.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await visible(c.page, '#auth'); assert.equal(await noOverflow(), true, 'auth');
    await c.page.fill('#guestName', 'Mobile'); await c.page.click('#guestBtn');
    await visible(c.page, '#lobby'); assert.equal(await noOverflow(), true, 'lobby');
    await c.page.click('#createBtn'); await visible(c.page, '#app');
    await c.page.waitForFunction(() => document.querySelectorAll('#grid .tile').length === 1);
    assert.equal(await noOverflow(), true, 'call');
    await shot(c.page, '4-call-mobile');
    assert.equal(await c.page.locator('#side').isVisible(), false);
    await c.page.click('#sideBtn'); await visible(c.page, '#side');
    await c.page.goBack(); // back closes the panel first
    await c.page.waitForSelector('#side', { state: 'hidden', timeout: T });
    assert.equal(await c.page.locator('#leaveModal.open').count(), 0);
    assert.equal(await c.page.locator('#quick .q').first().isVisible(), true, 'quick phrases visible on phones');
    for (const id of ['micB', 'camB', 'signB', 'leaveB']) assert.equal(await c.page.locator('#' + id).isVisible(), true, id);
    assert.deepEqual(c.errors, []);
    await ctx.close();
  });

  await step('no browser console errors on the call page', async () => {
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
  });

  await browser.close(); server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
