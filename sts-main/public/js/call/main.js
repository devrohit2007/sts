// STS call page: boot, sign-in, lobby, call controls. One socket, one mesh, listeners bound once.
import { $, toast, openModal, closeModal, closeTopModal, anyModalOpen, el, setIcon, store, avatar } from '../ui.js';
import { apiBase, waitForServer, fetchConfig, loadScript, createConnection, whenConnected } from '../net.js';
import { initFirebase, googleReady, googleSignIn, getIdToken, signOutGoogle, googleErrorMessage } from '../auth.js';
import { acquireMedia, getVideoTrack, stopStream } from './media.js';
import { createMesh } from './rtc.js';
import { createCaptionView, createSpeechCaptioner, createVoice, clampSize, SIZES, DEFAULT_SIZE } from './captions.js';
import { createSignDetector } from '../recognition/signDetector.js';
import { STARTER, MODELS } from '../recognition/modelRegistry.js';
import { findAslNowModel, loadAslNowModel } from '../recognition/modelRunner.js';
import { drawHands, clearHands } from '../vision/mediapipe.js';
import { APP_VERSION } from '../version.js';

const PHRASES = ['I need help', 'Please speak slowly', 'Can you repeat that?', 'Yes', 'No', 'Thank you', 'I cannot hear you', 'Please type in the chat'];
const SCREENS = ['wake', 'auth', 'lobby', 'app'];
const show = (name) => SCREENS.forEach((s) => { $(s).hidden = s !== name; });

// ---------- State ----------
const S = {
  cfg: null, conn: null, session: null, everConnected: false, resuming: false,
  roomId: null, myId: null, people: [], peerState: new Map(),
  local: null, mediaReady: Promise.resolve(), facing: 'user', micOn: true, camOn: true,
  words: [], flushTimer: 0, capSize: clampSize(store.get('sts.capSize', DEFAULT_SIZE)), unread: 0,
};
const lang = () => $('lang').value;

// ---------- Banner ----------
function banner(msg, kind = '', action) {
  const b = $('banner');
  b.hidden = !msg; b.className = kind; b.replaceChildren(document.createTextNode(msg || ''));
  if (msg && action) { const btn = el('button', '', action.label); btn.onclick = action.run; btn.type = 'button'; b.appendChild(btn); }
}

// ---------- 1. Boot and server wake-up ----------
let booting = false; let wakeTimer = 0;
function wakeStop() { clearInterval(wakeTimer); }
function wakeStart() {
  const t0 = Date.now(); const total = 90000;
  $('wakeTitle').textContent = 'Starting the server';
  $('wakeText').textContent = 'Free hosting puts the server to sleep when nobody is using it. Waking it up can take up to a minute.';
  $('wakeRetry').hidden = true;
  const tick = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    $('wakeBar').querySelector('i').style.width = Math.min(95, 3 + (s * 1000 / total) * 92) + '%';
    $('wakeBar').setAttribute('aria-valuenow', String(Math.min(95, Math.round(s / 0.9))));
    $('wakeMeta').textContent = `Waiting for the server... ${s}s`;
  };
  tick(); wakeStop(); wakeTimer = setInterval(tick, 1000);
}
function wakeFailed(err) {
  wakeStop();
  $('wakeBar').querySelector('i').style.width = '0%';
  const timeout = err?.message === 'timeout';
  $('wakeTitle').textContent = timeout ? 'The server did not wake up' : 'Could not connect';
  $('wakeText').textContent = timeout
    ? 'It took longer than 90 seconds. Check your internet connection, then try again.'
    : 'The call service could not be reached. Check your connection and try again.';
  $('wakeMeta').textContent = '';
  $('wakeRetry').hidden = false; $('wakeRetry').focus();
}

async function boot() {
  if (booting) return; booting = true;
  show('wake'); wakeStart();
  try {
    await waitForServer({}); // first thing on page load, before any sign-in
    $('wakeMeta').textContent = 'Server is awake. Connecting...';
    S.cfg = await fetchConfig();
    await loadScript(apiBase() + '/socket.io/socket.io.js');
    if (!S.conn) { S.conn = createConnection(); bindSocket(); }
    await whenConnected(S.conn);
    S.myId = S.conn.id;
    wakeStop();
    await startAuth();
  } catch (e) {
    console.error('boot failed', e); wakeFailed(e);
  } finally { booting = false; }
}
$('wakeRetry').addEventListener('click', boot);

// ---------- 2. Authentication ----------
function setAuthErr(msg) { $('authErr').hidden = !msg; $('authErr').textContent = msg || ''; }

async function startAuth() {
  $('guestName').value = store.get('sts.guestName', '');
  let signedIn = null; let note = '';
  if (!S.cfg.googleSignIn) note = 'Google sign-in is not available on this server. Use guest access.';
  else {
    try { signedIn = await initFirebase(S.cfg.firebase); } catch (e) { console.warn('firebase unavailable', e); note = 'Google sign-in could not load. Use guest access, or try again later.'; }
  }
  $('googleBtn').disabled = !googleReady();
  $('googleHint').hidden = !note; $('googleHint').textContent = note;
  setAuthErr('');
  if (signedIn && await establish({ kind: 'google' }, true)) return;
  show('auth');
}

async function authPayload(sess) {
  if (sess.kind === 'google') {
    const idToken = await getIdToken();
    return idToken ? { idToken } : null;
  }
  return { guestName: sess.name };
}

// Verifies identity on the server for this socket. Does not change the screen.
async function authenticate(sess) {
  const payload = await authPayload(sess);
  if (!payload) return { error: 'Please sign in again.', code: 'invalid-token' };
  return S.conn.emitAck('authenticate', payload);
}

async function establish(sess, silent = false) {
  try {
    const res = await authenticate(sess);
    if (res.error) {
      if (!silent) setAuthErr(res.error);
      if (res.code === 'invalid-token') await signOutGoogle().catch(() => {});
      return false;
    }
    S.session = { ...sess, user: res.user };
    paintUser(res.user);
    show('lobby'); history.replaceState(null, '', location.pathname);
    const pre = new URLSearchParams(location.search).get('room') || S.pendingRoom;
    if (pre) { $('joinCode').value = pre.toUpperCase(); $('joinCode').focus(); }
    return true;
  } catch (e) {
    if (!silent) setAuthErr(e.message === 'offline' ? 'You are offline. Reconnecting...' : 'The server did not answer. Please try again.');
    return false;
  }
}

function paintUser(u) {
  const slot = $('userAvatar'); slot.replaceChildren(avatar(u.name, u.photoURL, 36));
  $('userName').textContent = u.name;
  $('userKind').textContent = u.isGuest ? 'Guest (temporary)' : 'Signed in with Google';
}

$('googleBtn').addEventListener('click', async () => {
  setAuthErr(''); $('googleBtn').disabled = true; $('googleLabel').textContent = 'Opening Google...';
  try {
    await googleSignIn();
    await establish({ kind: 'google' });
  } catch (e) { setAuthErr(googleErrorMessage(e)); }
  finally { $('googleBtn').disabled = !googleReady(); $('googleLabel').textContent = 'Continue with Google'; }
});

$('guestForm').addEventListener('submit', async (e) => {
  e.preventDefault(); setAuthErr('');
  const name = $('guestName').value.trim();
  if (!name) { setAuthErr('Please type a name so others know who you are.'); $('guestName').focus(); return; }
  $('guestBtn').disabled = true;
  store.set('sts.guestName', name);
  try { await establish({ kind: 'guest', name }); } finally { $('guestBtn').disabled = false; }
});

$('signOutBtn').addEventListener('click', async () => {
  if (S.roomId) await leaveRoom();
  try { await S.conn.emitAck('sign-out', {}, 3000); } catch (e) { /* server will clean up on disconnect */ }
  await signOutGoogle().catch(() => {});
  S.session = null; setAuthErr(''); show('auth');
});

// ---------- 3. Lobby: create / join ----------
function lobbyErr(msg) { $('lobbyErr').hidden = !msg; $('lobbyErr').textContent = msg || ''; }
function lobbyBusy(b) { $('createBtn').disabled = b; $('joinBtn').disabled = b; }
$('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
$('createBtn').addEventListener('click', () => roomAction('create-room', { roomName: $('roomName').value }));
$('joinBtn').addEventListener('click', () => {
  const code = $('joinCode').value.trim();
  if (code.length < 8) return lobbyErr('Enter the 8-character room code.');
  roomAction('join-room', { roomId: code });
});
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

async function roomAction(event, payload) {
  lobbyErr(''); lobbyBusy(true);
  try {
    const res = await S.conn.emitAck(event, payload);
    if (res.error) return lobbyErr(res.code === 'auth' ? 'Your session ended. Please sign in again.' : res.error);
    await enterRoom(res, event === 'join-room');
  } catch (e) {
    lobbyErr(e.message === 'offline' ? 'You are offline. Wait for the connection to return.' : 'The server did not answer. Please try again.');
  } finally { lobbyBusy(false); }
}

// ---------- 4. Call ----------
const tiles = new Map(); // key ('me' or socket id) -> element
const me = () => S.people.find((p) => p.id === S.myId);
const keyOf = (id) => (id === S.myId ? 'me' : id);

function ensureTile(key, person) {
  let t = tiles.get(key);
  if (t) return t;
  t = el('div', 'tile' + (key === 'me' ? ' me' : '')); t.dataset.key = key;
  const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.muted = key === 'me';
  t.appendChild(v);
  if (key === 'me') { const c = document.createElement('canvas'); c.className = 'overlay'; t.appendChild(c); }
  const nocam = el('div', 'nocam'); nocam.append(avatar(person?.displayName || '?', person?.photoURL, 64), el('span', '', 'Camera is off'));
  const status = el('div', 'status'); status.setAttribute('role', 'status');
  const tag = el('div', 'tag'); tag.append(el('span', 'tagname', ''));
  t.append(nocam, status, tag);
  $('grid').appendChild(t); tiles.set(key, t);
  return t;
}

function paintTile(person) {
  const key = keyOf(person.id); const t = ensureTile(key, person);
  t.querySelector('.tagname').textContent = key === 'me' ? `${person.displayName} (you)` : person.displayName;
  const tag = t.querySelector('.tag'); tag.querySelector('.ic')?.remove();
  if (!person.mic) { const ic = svgIcon('mic-off'); tag.prepend(ic); }
  t.classList.toggle('nocam-on', !person.cam);
  const st = S.peerState.get(person.id); const badge = t.querySelector('.status');
  if (key === 'me' || !st || st === 'connected') { badge.className = 'status'; badge.replaceChildren(); }
  else {
    badge.className = 'status show' + (st === 'failed' ? ' failed' : '');
    badge.replaceChildren(document.createTextNode(st === 'connecting' ? 'Connecting...' : st === 'reconnecting' ? 'Reconnecting...' : 'Connection failed'));
    if (st === 'failed') { const b = el('button', '', 'Retry'); b.type = 'button'; b.onclick = () => S.mesh.retry(person.id); badge.appendChild(b); }
  }
}

function svgIcon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + name); s.appendChild(u);
  return s;
}

function renderPeople() {
  const box = $('people'); box.replaceChildren();
  for (const p of S.people) {
    const row = el('div', 'pe');
    const n = el('span', 'n', p.displayName);
    row.append(avatar(p.displayName, p.photoURL, 28), n);
    if (p.id === S.myId) row.append(el('small', '', 'you'));
    else { const st = S.peerState.get(p.id); if (st && st !== 'connected') row.append(el('small', '', st)); }
    if (!p.mic) row.append(svgIcon('mic-off'));
    box.appendChild(row);
  }
}

function syncPeople() {
  const ids = new Set(S.people.map((p) => p.id));
  for (const p of S.people) paintTile(p);
  for (const [key, t] of [...tiles]) {
    if (key !== 'me' && !ids.has(key)) { t.querySelector('video').srcObject = null; t.remove(); tiles.delete(key); S.peerState.delete(key); }
  }
  renderPeople();
}

function attachLocal() {
  const t = tiles.get('me'); if (!t) return;
  const v = t.querySelector('video');
  if (v.srcObject !== S.local?.stream) v.srcObject = S.local?.stream || null;
  t.classList.toggle('rear', S.facing === 'environment');
}

function paintControls() {
  const has = S.local || {};
  const set = (id, on, off) => { $(id).classList.toggle('on', !!on); $(id).classList.toggle('off', !!off); };
  $('micB').classList.toggle('off', !S.micOn); setIcon('micB', S.micOn ? 'mic' : 'mic-off'); $('micB').setAttribute('aria-pressed', String(S.micOn));
  $('camB').classList.toggle('off', !S.camOn); setIcon('camB', S.camOn ? 'cam' : 'cam-off'); $('camB').setAttribute('aria-pressed', String(S.camOn));
  $('flipB').disabled = !has.video;
  set('signB', detector.running); $('signB').setAttribute('aria-pressed', String(detector.running));
  set('listenB', speech.active); $('listenB').setAttribute('aria-pressed', String(speech.active));
  set('speakB', voice.on); $('speakB').setAttribute('aria-pressed', String(voice.on));
}

function announceMedia(m) {
  const problems = [m.errors.video, m.errors.audio].filter(Boolean);
  if (!problems.length) { banner(null); return; }
  banner(problems.join(' ') + ' You can still see and hear others.', '', { label: 'Try again', run: retryMedia });
}

async function retryMedia() {
  banner('Asking for camera and microphone...');
  const m = await acquireMedia();
  const old = S.local?.stream; const tracks = [...(old?.getTracks() || [])];
  for (const t of m.stream?.getTracks() || []) {
    const had = tracks.find((x) => x.kind === t.kind && x.readyState === 'live');
    if (had) { t.stop(); continue; }
    (S.local.stream ||= new MediaStream()).addTrack(t);
    await S.mesh.replaceTrack(t.kind, t);
  }
  if (!S.local.stream && m.stream) S.local.stream = m.stream;
  S.local.audio = !!S.local.stream?.getAudioTracks().length; S.local.video = !!S.local.stream?.getVideoTracks().length;
  S.micOn = S.local.audio; S.camOn = S.local.video;
  attachLocal(); paintControls(); announceMedia({ errors: { audio: S.local.audio ? '' : m.errors.audio, video: S.local.video ? '' : m.errors.video } });
  sendMedia();
}

function sendMedia() { S.conn.emit('media-state', { mic: S.micOn, cam: S.camOn }); }

async function enterRoom(res, joining) {
  S.roomId = res.roomId; S.myId = S.conn.id; S.people = res.roomState.participants;
  S.peerState.clear(); S.facing = 'user';
  const initial = joining ? S.people.map((p) => p.id).filter((id) => id !== S.myId) : [];
  $('roomTitle').textContent = res.roomState.name; $('codeTxt').textContent = res.roomId;
  show('app'); history.pushState({ sts: 'call' }, '');
  setConn(true); syncPeople(); paintControls();
  const myRoom = res.roomId;
  S.mediaReady = (async () => {
    banner('Waiting for camera and microphone permission...');
    const m = await acquireMedia();
    if (S.roomId !== myRoom) { stopStream(m.stream); return; } // left while the permission prompt was open
    S.local = m; S.micOn = m.audio; S.camOn = m.video;
    attachLocal(); announceMedia(m); paintControls();
  })();
  await S.mediaReady;
  if (S.roomId !== myRoom) return;
  const present = new Set(S.people.map((p) => p.id));
  initial.filter((id) => present.has(id)).forEach((id) => S.mesh.ensure(id)); // the newcomer calls everyone already here
  sendMedia();
}

// Safe to call twice.
async function leaveRoom() {
  closeModal('leaveModal');
  if (!S.roomId) return;
  const was = S.roomId; S.roomId = null;
  stopWords(); teardownSign(); speech.stop(); voice.set(false);
  S.mesh.closeAll(); stopStream(S.local?.stream); S.local = null;
  try { await S.conn.emitAck('leave-room', {}, 3000); } catch (e) { /* server cleans up on disconnect */ }
  tiles.forEach((t) => { t.querySelector('video').srcObject = null; t.remove(); }); tiles.clear();
  S.people = []; S.peerState.clear(); captionView.clear(); $('msgs').replaceChildren(); $('people').replaceChildren();
  S.unread = 0; $('unread').hidden = true; banner(null); closeSide();
  $('joinCode').value = was; lobbyErr('');
  show('lobby');
  if (history.state?.sts === 'call') history.back();
}
$('leaveB').addEventListener('click', () => openModal('leaveModal'));
$('leaveConfirm').addEventListener('click', leaveRoom);

// Back button / swipe-back closes things first, then asks before leaving.
window.addEventListener('popstate', () => {
  if (!S.roomId) return;
  history.pushState({ sts: 'call' }, '');
  if (anyModalOpen()) { closeTopModal(); return; }
  if ($('side').classList.contains('open')) { closeSide(); return; }
  openModal('leaveModal');
});
window.addEventListener('beforeunload', (e) => { if (S.roomId) { e.preventDefault(); e.returnValue = ''; } });

$('codeBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${S.roomId}`;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (e) { toast('Room code: ' + S.roomId, 5000); }
});

// ---------- Media controls ----------
$('micB').addEventListener('click', () => {
  const t = S.local?.stream?.getAudioTracks()[0];
  if (!t) return toast('No microphone. Use "Try again" in the banner above, or allow it in your browser settings.', 4500);
  S.micOn = !S.micOn; t.enabled = S.micOn; paintControls(); sendMedia();
});
$('camB').addEventListener('click', () => {
  const t = S.local?.stream?.getVideoTracks()[0];
  if (!t) return toast('No camera. Use "Try again" in the banner above, or allow it in your browser settings.', 4500);
  S.camOn = !S.camOn; t.enabled = S.camOn;
  if (!S.camOn && detector.running) stopSign();
  paintControls(); sendMedia();
});
$('flipB').addEventListener('click', async () => {
  const old = S.local?.stream?.getVideoTracks()[0]; if (!old) return;
  const next = S.facing === 'user' ? 'environment' : 'user';
  $('flipB').disabled = true;
  old.stop(); S.local.stream.removeTrack(old); // phones cannot open two cameras at once
  let track = null;
  try { track = await getVideoTrack(next); S.facing = next; }
  catch (e) {
    toast('Could not switch camera. Going back to the previous one.', 4000);
    try { track = await getVideoTrack(S.facing); } catch (e2) { track = null; }
  }
  if (track) {
    track.enabled = S.camOn; S.local.stream.addTrack(track);
    await S.mesh.replaceTrack('video', track);
    const v = tiles.get('me')?.querySelector('video'); if (v) v.srcObject = S.local.stream;
  } else { S.local.video = false; S.camOn = false; sendMedia(); announceMedia({ errors: { video: 'The camera stopped working.' } }); }
  attachLocal(); paintControls();
});

// ---------- Captions, voice, speech ----------
const captionView = createCaptionView({ box: $('caps'), transcript: $('transcript'), myId: () => S.myId });
const voice = createVoice({ getLang: () => (lang() === 'hi' ? 'hi-IN' : 'en-IN') });
const speech = createSpeechCaptioner({
  getLang: () => (lang() === 'hi' ? 'hi-IN' : 'en-IN'),
  onFinal: (text) => S.conn.emit('speech-caption', { text }),
  onStatus: (s) => {
    if (s === 'denied') toast('Microphone permission is needed for live captions.', 4500);
    if (s === 'no-mic') toast('No microphone found for live captions.', 4500);
    if (s === 'failed') toast('Live captions stopped. Tap Captions to start again.', 4500);
    if (s === 'retrying') toast('Caption service is having trouble. Retrying...', 2500);
    paintControls();
  },
});

function setCapSize(i) {
  S.capSize = clampSize(i); store.set('sts.capSize', String(S.capSize)); captionView.setSize(S.capSize);
  $('capMinus').disabled = S.capSize === 0; $('capPlus').disabled = S.capSize === SIZES.length - 1;
}
$('capMinus').addEventListener('click', () => setCapSize(S.capSize - 1));
$('capPlus').addEventListener('click', () => setCapSize(S.capSize + 1));

$('listenB').addEventListener('click', () => {
  if (!speech.supported) return toast('Live captions need Chrome or Edge.', 4000);
  if (speech.active) speech.stop(); else speech.start();
  paintControls();
});
$('speakB').addEventListener('click', () => {
  if (!voice.supported) return toast('Reading captions aloud is not supported in this browser.', 4000);
  voice.set(!voice.on); paintControls();
  toast(voice.on ? 'Signed messages will be read aloud' : 'Voice off'); if (voice.on) voice.speak(' ');
});
$('lang').value = store.get('sts.lang', 'en');
$('lang').addEventListener('change', () => { store.set('sts.lang', lang()); speech.refresh(); });

for (const t of PHRASES) {
  const b = el('button', 'q', t); b.type = 'button';
  b.addEventListener('click', () => S.conn.emit('say', { text: t }));
  $('quick').appendChild(b);
}

// ---------- Sign detection ----------
// Two engines: ASL fingerspelling letters (pretrained, see models/asl) and 7 generic demo gestures.
const MAX_LETTERS = 20;      // the server accepts at most 20 characters per word
const LETTER_FLUSH_MS = 4000; // pause between letters before the word is sent on its own
const WORD_FLUSH_MS = 2200;
let signModel = null;   // loaded ASL letters model, or null = demo gestures
let signBusy = false;   // true while the Sign button is loading models
const letters = () => signModel?.kind === 'aslnow';
const detector = createSignDetector({
  getModel: () => signModel,
  getVideo: () => tiles.get('me')?.querySelector('video'),
  onFrame: (r, v) => { const c = tiles.get('me')?.querySelector('canvas'); if (c) drawHands(c, v, r); },
  onPrediction: (p) => {
    const unsure = p.state === 'uncertain' || p.state === 'unknown';
    const best = unsure ? p.alternatives?.[0] : null; // what the model thinks even though it is not sure
    $('liveWord').textContent = p.state === 'sign' ? p.word : best ? best.gloss + '?' : unsure ? 'Uncertain sign' : '-';
    $('liveHint').textContent = p.state === 'sign' ? 'Hold steady'
      : unsure ? (best ? `Not sure (${Math.round(best.score * 100)}%). Hold the letter steady` : 'Not confident enough')
      : p.state === 'thinking' || p.state === 'collecting' ? 'Reading...' : 'Show a hand to the camera';
    const score = p.state === 'sign' ? p.score : best ? best.score : p.score;
    $('liveBar').style.width = score ? Math.round(score * 100) + '%' : '0%';
  },
  onWord: (w) => addWord(w),
});

function paintSignMode() {
  const on = letters();
  $('signNote').textContent = on
    ? 'ASL fingerspelling: sign one letter at a time and hold it. J and Z need movement and are not recognised. Press Send after a word.'
    : 'Demo gestures: 7 basic hand shapes, not real ISL or ASL.';
  $('guideTitle').textContent = on || $('signMode').value === 'asl' ? 'ASL letters' : 'Demo gestures';
  $('guideIntro').textContent = on || $('signMode').value === 'asl'
    ? 'Sign one fingerspelled letter at a time and hold it steady. Letters are joined into a word when you press Send. For a double letter (like LL), lower your hand between the two.'
    : 'These are 7 generic hand shapes from a ready-made model. They are not real ISL or ASL signs. Hold one steady for about half a second.';
  const rows = $('guideRows'); rows.replaceChildren();
  if ($('signMode').value === 'asl') {
    const row = el('div', 'row'); row.append(el('span', '', 'Letters recognised'), el('b', '', 'A-Y (not J, Z)')); rows.appendChild(row);
  } else for (const [name, word] of Object.values(STARTER.labels)) {
    const r = el('div', 'row'); r.append(el('span', '', name), el('b', '', word)); rows.appendChild(r);
  }
}

async function loadSignModel() {
  signModel = null;
  if ($('signMode').value !== 'asl') return;
  try {
    if (!(await findAslNowModel(MODELS.asl.dir))) throw new Error('model files not found');
    signModel = await loadAslNowModel(MODELS.asl.dir);
  } catch (e) {
    console.error('ASL model', e);
    $('signMode').value = 'demo';
    toast('The ASL letters model could not be loaded, so demo gestures are on instead.', 6000);
  }
}

async function toggleSign() {
  if (detector.running) return stopSign();
  if (signBusy) return;
  if (!S.local?.video || !S.camOn) return toast('Turn your camera on first.', 3500);
  signBusy = true;
  $('tray').hidden = false; $('liveWord').textContent = '...'; $('liveHint').textContent = 'Loading sign model';
  try {
    await loadSignModel();
    paintSignMode();
    $('liveHint').textContent = 'Loading hand detection model';
    await detector.start();
    tiles.get('me')?.classList.add('signing');
  } catch (e) {
    console.error(e); teardownSign();
    toast('Could not load the hand detection model. Check your connection.', 5000);
  } finally { signBusy = false; paintControls(); }
}
function teardownSign() {
  detector.stop(); signModel?.dispose?.(); signModel = null;
  const c = tiles.get('me')?.querySelector('canvas'); if (c) clearHands(c);
  tiles.get('me')?.classList.remove('signing'); $('tray').hidden = true;
}
function stopSign() { stopWords(true); teardownSign(); paintControls(); }
$('signB').addEventListener('click', toggleSign);
$('signMode').addEventListener('change', async () => {
  store.set('sts.signMode', $('signMode').value);
  paintSignMode();
  if (detector.running) { stopSign(); await toggleSign(); }
});

function drawChips() {
  const box = $('chips'); box.replaceChildren();
  for (const w of S.words) box.appendChild(el('span', 'chip', w));
}
function addWord(w) {
  if (letters() && S.words.length >= MAX_LETTERS) return toast('That is a long word. Press Send.', 2500);
  S.words.push(w); drawChips();
  clearTimeout(S.flushTimer); S.flushTimer = setTimeout(sendWords, letters() ? LETTER_FLUSH_MS : WORD_FLUSH_MS);
}
function sendWords() {
  clearTimeout(S.flushTimer);
  const words = letters() ? [S.words.join('')] : S.words;
  if (S.words.length && S.roomId) S.conn.emit('sign-words', { words, lang: lang() });
  S.words = []; drawChips();
}
function stopWords(flush) { clearTimeout(S.flushTimer); if (flush) sendWords(); else { S.words = []; drawChips(); } }
$('sendWords').addEventListener('click', sendWords);
$('clearWords').addEventListener('click', () => stopWords(false));

$('signMode').value = store.get('sts.signMode', 'asl') === 'demo' ? 'demo' : 'asl';
paintSignMode();

// ---------- Side panel ----------
const TABS = ['People', 'Chat', 'Transcript'];
function selectTab(name) {
  for (const t of TABS) {
    $('tab' + t).setAttribute('aria-selected', String(t === name));
    $('pane' + t).hidden = t !== name;
  }
  if (name === 'Chat') { S.unread = 0; $('unread').hidden = true; $('chatIn').focus({ preventScroll: true }); }
}
TABS.forEach((t) => $('tab' + t).addEventListener('click', () => selectTab(t)));
function closeSide() { $('side').classList.remove('open'); $('sideBtn').setAttribute('aria-expanded', 'false'); }
$('sideBtn').addEventListener('click', () => {
  const open = $('side').classList.toggle('open'); $('sideBtn').setAttribute('aria-expanded', String(open));
});

function addChat({ from, fromId, text }) {
  const d = el('div', 'msg'); d.append(el('b', '', fromId === S.myId ? 'You' : from), document.createTextNode(text));
  const box = $('msgs'); box.appendChild(d); box.scrollTop = box.scrollHeight;
  const overlay = getComputedStyle($('side')).position === 'fixed'; // narrow or landscape-phone layout: the panel slides in
  const chatVisible = !$('paneChat').hidden && (!overlay || $('side').classList.contains('open'));
  if (!chatVisible && fromId !== S.myId) { S.unread++; $('unread').hidden = false; }
}
function sendChat() { const i = $('chatIn'); const text = i.value.trim(); if (text) { S.conn.emit('chat-message', { text }); i.value = ''; } }
$('chatSend').addEventListener('click', sendChat);
$('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ---------- Connection status ----------
function setConn(ok, label) {
  const d = $('dot'); d.className = 'dot' + (ok ? '' : ' off');
  d.setAttribute('aria-label', label || (ok ? 'Connected' : 'Disconnected'));
}

// Browsers block autoplay with sound until a tap. Retry playing on the next tap.
function unlockAudio() {
  document.querySelectorAll('.tile:not(.me) video').forEach((v) => { if (v.paused && v.srcObject) v.play().catch(() => {}); });
  if (!$('banner').dataset.keep) banner(null);
}
document.addEventListener('pointerdown', () => { if (S.audioBlocked) { S.audioBlocked = false; unlockAudio(); } });

// ---------- Socket events (bound once) ----------
function bindSocket() {
  const c = S.conn;
  c.on('connect', async () => {
    S.myId = c.id; setConn(true);
    if (!S.everConnected) { S.everConnected = true; return; }
    await resume();
  });
  c.on('disconnect', () => {
    setConn(false, 'Disconnected');
    if (S.session) banner('Connection lost. Trying to reconnect...');
  });
  c.on('connect_error', () => { if (S.session) banner('Cannot reach the server. Retrying...'); });
  c.on('notice', ({ message }) => toast(message, 3500));

  c.on('room-state', (st) => { if (!S.roomId) return; S.people = st.participants; syncPeople(); });
  c.on('participant-joined', (p) => { if (S.roomId) toast(`${p.displayName} joined`); });
  c.on('participant-left', ({ id }) => {
    if (!S.roomId) return;
    const p = S.people.find((x) => x.id === id); if (p) toast(`${p.displayName} left`);
    S.mesh.close(id);
  });
  c.on('media-state', ({ id, mic, cam }) => {
    const p = S.people.find((x) => x.id === id); if (!p) return;
    p.mic = mic; p.cam = cam; paintTile(p); renderPeople();
  });

  c.on('offer', ({ from, description }) => { if (S.roomId) S.mediaReady.then(() => S.roomId && S.mesh.handleDescription(from, description)); });
  c.on('answer', ({ from, description }) => { if (S.roomId) S.mesh.handleDescription(from, description); });
  c.on('ice-candidate', ({ from, candidate }) => { if (S.roomId) S.mesh.handleCandidate(from, candidate); });

  c.on('chat-message', (m) => { if (S.roomId) addChat(m); });
  c.on('caption', (cap) => {
    if (!S.roomId) return;
    captionView.add(cap);
    if (cap.final && cap.source !== 'speech' && cap.fromId !== S.myId) voice.speak(cap.text);
  });
  c.on('caption-update', ({ id, text }) => {
    if (!S.roomId) return;
    const fromId = captionView.update(id, text);
    if (fromId && fromId !== S.myId) voice.speak(text);
  });
}

// After a network drop the server forgot us: sign in again and rejoin the same room.
async function resume() {
  if (S.resuming || !S.session) return;
  S.resuming = true;
  try {
    const res = await authenticate(S.session);
    if (res.error) {
      banner(null); toast('Your session ended. Please sign in again.', 5000);
      if (S.roomId) await leaveRoom();
      S.session = null; show('auth'); return;
    }
    if (!S.roomId) { banner(null); return; }
    const was = S.roomId;
    S.mesh.closeAll(); S.peerState.clear();
    const joined = await S.conn.emitAck('join-room', { roomId: was });
    if (joined.error) {
      banner(null); toast('The room ended while you were offline.', 5000); await leaveRoom(); return;
    }
    S.myId = S.conn.id; S.people = joined.roomState.participants; syncPeople();
    await S.mediaReady;
    S.people.filter((p) => p.id !== S.myId).forEach((p) => S.mesh.ensure(p.id));
    sendMedia(); banner(null); toast('Reconnected');
  } catch (e) {
    console.warn('resume failed', e); banner('Reconnecting...');
  } finally { S.resuming = false; }
}

// ---------- WebRTC mesh ----------
S.mesh = createMesh({
  getIce: () => S.cfg?.ice || [{ urls: 'stun:stun.l.google.com:19302' }],
  getLocalStream: () => S.local?.stream || null,
  getMyId: () => S.myId || '',
  sendSignal: (event, payload) => S.conn.emit(event, payload),
  onTrack: (id, stream) => {
    const p = S.people.find((x) => x.id === id);
    const t = ensureTile(id, p); const v = t.querySelector('video');
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => { S.audioBlocked = true; banner('Tap anywhere to turn on call audio.'); });
  },
  onState: (id, state) => {
    S.peerState.set(id, state);
    const p = S.people.find((x) => x.id === id); if (p) paintTile(p);
    renderPeople();
  },
});

// ---------- Go ----------
document.querySelectorAll('[data-ver]').forEach((n) => { n.textContent = 'v' + APP_VERSION; });
console.info('STS call page v' + APP_VERSION);
const pre = new URLSearchParams(location.search).get('room'); if (pre) S.pendingRoom = pre;
setCapSize(S.capSize);
boot();
