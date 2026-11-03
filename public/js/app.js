// Translator page. Same recognition modules as the call page (js/recognition/signDetector.js).
import { startCamera, stopCamera, explainCameraError } from './camera.js';
import { drawHands, clearHands } from './vision/mediapipe.js';
import { MODELS, STARTER } from './recognition/modelRegistry.js';
import { findModel, loadModel, findAslNowModel, loadAslNowModel } from './recognition/modelRunner.js';
import { createSignDetector } from './recognition/signDetector.js';
import { appendWord, finishSentence } from './languages/sentenceBuilder.js';
import { $, toast } from './ui.js';

const video = $('video'); const canvas = $('overlay'); const out = $('out');
let lang = 'asl'; let facing = 'user'; let running = false; let idleT = 0;

// ---------- Language + engine ----------
// Engine = the trained model for this language if one is installed and loads, otherwise demo gestures.
let model = null;       // loaded trained model, or null (demo gestures)
let found = null;       // { meta, metrics } from findModel for the current language
let paintSeq = 0;

function chip(id, text, on) { const c = $(id); c.textContent = text; c.dataset.on = String(on); }

async function paintEngine() {
  const seq = ++paintSeq; const m = MODELS[lang];
  const f = lang === 'asl' ? await findAslNowModel(m.dir) : (m.dir ? await findModel(m.dir) : null);
  if (seq !== paintSeq) return;
  found = f; model = null;
  if (f) {
    const n = f.meta.labels.length; const mt = f.metrics;
    $('engineName').textContent = `${m.name}: ${n}-sign model installed`;
    $('engineMsg').textContent = lang === 'asl'
      ? ' Pretrained ASLNow! static fingerspelling model: A–Z. J and Z require movement and are not recognised by this static model. Accuracy has not been independently tested in STS.'
      : (mt ? ` Held-out test result from the training run: top-1 ${(mt.top1 * 100).toFixed(1)}% on ${mt.clips} clips from signers not used in training (${mt.dataset}). Real-world accuracy will be lower.` : ' No evaluation report is installed, so accuracy is unknown.');
    chip('chipEngine', `${lang.toUpperCase()} model, ${n} signs`, true);
  } else if (lang === 'asl') {
    $('engineName').textContent = 'ASL fingerspelling model unavailable';
    $('engineMsg').textContent = 'The ASLNow model files could not be verified. ASL recognition is stopped; demo gestures will not be substituted.';
    chip('chipEngine', 'ASL model unavailable', 'warn');
  } else {
    $('engineName').textContent = STARTER.name;
    $('engineMsg').textContent = `No trained ${lang.toUpperCase()} model is installed. Demo mode recognises 7 basic hand shapes, not real ${lang.toUpperCase()} signs. ${m.note}`;
    chip('chipEngine', 'Demo gestures only', 'warn');
  }
  $('kSign').textContent = f ? `Recognised ${lang.toUpperCase()} sign` : 'Detected hand shape';
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  if (running) stop(); // the engine changes, so restart cleanly
  lang = b.dataset.lang;
  document.querySelectorAll('[data-lang]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  paintEngine();
}));

// ---------- Prediction card ----------
const TEXT = {
  sign: 'Recognised',
  unknown: 'Unknown or unsupported sign. Not translated.',
  uncertain: 'Unknown or unsupported hand shape. Not translated.',
  collecting: 'Reading your sign. Lower your hands when finished.',
  thinking: 'Working it out...',
  nohand: 'Show a hand to the camera',
  error: 'Recognition error. Try again.',
};
function showPrediction(p) {
  const st = p?.state || 'idle';
  const isSign = st === 'sign';
  $('predWord').textContent = !p ? '-' : isSign ? (p.gloss || p.label) : st === 'unknown' || st === 'uncertain' ? 'Unknown sign' : st === 'collecting' || st === 'thinking' ? '...' : st === 'nohand' ? 'No hand' : '-';
  $('predMeaning').textContent = isSign ? (p.meaning || p.word) : '-';
  $('predState').textContent = p ? (TEXT[st] || '') : '';
  const score = typeof p?.score === 'number' ? p.score : 0;
  const pct = Math.round(score * 100);
  $('predPct').textContent = score ? pct + '%' : '';
  $('predBar').style.width = pct + '%';
  const tick = $('predTick'); const th = model ? model.threshold : STARTER.threshold;
  tick.hidden = !running; tick.style.left = th * 100 + '%'; tick.title = 'Minimum confidence ' + Math.round(th * 100) + '%';
  $('predAlts').textContent = p?.alternatives && st !== 'sign' ? 'Closest: ' + p.alternatives.map((a) => `${a.meaning} ${Math.round(a.score * 100)}%`).join(', ') : '';
  $('predCard').dataset.state = st === 'collecting' || st === 'thinking' ? 'idle' : st;
}

function showHands(r) {
  const n = r?.landmarks?.length || 0;
  chip('chipHands', n === 0 ? 'No hand' : n === 1 ? '1 hand detected' : '2 hands detected', n > 0);
}

const detector = createSignDetector({
  getVideo: () => video,
  getModel: () => model,
  onFrame: (r, v) => { drawHands(canvas, v, r); showHands(r); },
  onPrediction: showPrediction,
  onWord: (word) => {
    out.value = model?.kind === 'aslnow' ? (out.value + word) : appendWord(out.value, word);
    clearTimeout(idleT); idleT = setTimeout(() => { out.value = finishSentence(out.value); }, 2500);
  },
});

// ---------- Camera ----------
function setStatus(msg, kind = '') { const s = $('status'); s.textContent = msg; s.className = 'status ' + kind; }
function paintRunning() {
  $('startBtn').hidden = running; $('stopBtn').hidden = !running; $('flipBtn').disabled = !running;
  $('stage').classList.toggle('live', running);
  video.parentElement.classList.toggle('mirror', facing === 'user');
}

async function start() {
  if (running) return;
  $('startBtn').disabled = true; setStatus('Starting camera...', 'wait');
  try { await startCamera(video, facing); } catch (e) {
    $('startBtn').disabled = false; setStatus('Camera is off'); return toast(explainCameraError(e), 5000);
  }
  running = true; paintRunning(); chip('chipCam', 'Camera on', true);
  if (lang === 'asl') {
    setStatus('Loading ASL fingerspelling model...', 'wait');
    try {
      if (!found) throw new Error('ASL model files were not found under /models/asl');
      model = await loadAslNowModel(MODELS.asl.dir);
      if (model?.kind !== 'aslnow') throw new Error('Loaded model did not identify as ASLNow');
      chip('chipEngine', 'ASL A-Z model loaded', true);
    } catch (e) {
      console.error('ASL model load failed:', e);
      model = null; running = false; stopCamera(); video.srcObject = null;
      paintRunning(); chip('chipCam', 'Camera off', false);
      chip('chipEngine', 'ASL model failed to load', 'warn');
      $('engineName').textContent = 'ASL fingerspelling model failed to load';
      $('engineMsg').textContent = e?.message || 'TensorFlow.js could not load the model. Demo mode was not started.';
      setStatus('ASL model failed to load. Demo mode was not started.', 'wait');
      showPrediction({ state: 'error' });
      $('startBtn').disabled = false;
      return toast('ASL model failed to load. Check the model files and TensorFlow.js connection, then retry.', 6000);
    }
  } else if (found) {
    setStatus(`Loading ${lang.toUpperCase()} sign model...`, 'wait');
    try { model = await loadModel(MODELS[lang].dir, { meta: found.meta }); } catch (e) {
      console.error(e); model = null; chip('chipEngine', 'Model failed: demo gestures', 'warn');
      toast(`Could not load the ${lang.toUpperCase()} model. Using demo gestures instead.`, 5000);
    }
  }
  setStatus('Loading hand detection model...', 'wait');
  try { await detector.start(); } catch (e) {
    console.error(e); stop(); return toast('Could not load the hand detection model. Check your connection.', 5000);
  }
  if (!running) return;
  $('startBtn').disabled = false; setStatus(model ? 'Ready. Sign, then lower your hands.' : 'Ready. Show a hand shape.', 'ok');
}
function stop() {
  running = false; detector.stop(); stopCamera(); video.srcObject = null;
  clearHands(canvas); clearTimeout(idleT); paintRunning(); $('startBtn').disabled = false;
  setStatus('Camera is off'); chip('chipCam', 'Camera off', false); showHands(null); showPrediction(null);
  paintEngine(); // forget the loaded model; the next start reloads it
}
$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);
$('flipBtn').addEventListener('click', async () => {
  const next = facing === 'user' ? 'environment' : 'user';
  try { await startCamera(video, next); facing = next; } catch (e) {
    toast(explainCameraError(e), 5000);
    try { await startCamera(video, facing); } catch (e2) { stop(); } // phones cannot hold two cameras; restore the old one
  }
  paintRunning();
});

// ---------- Translation panel ----------
$('clearBtn').addEventListener('click', () => { out.value = ''; });
$('copyBtn').addEventListener('click', async () => {
  const text = out.value.trim(); if (!text) return toast('Nothing to copy yet');
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { out.select(); toast('Press copy in your browser menu'); }
});

// ---------- Speech ----------
const voiceSel = $('voice');
function loadVoices() {
  const vs = speechSynthesis.getVoices(); if (!vs.length) return;
  voiceSel.replaceChildren();
  vs.forEach((v, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${v.name} (${v.lang})`; voiceSel.appendChild(o); });
  const i = vs.findIndex((v) => v.lang === 'en-IN'); const j = vs.findIndex((v) => v.lang.startsWith('en'));
  voiceSel.value = String(i >= 0 ? i : j >= 0 ? j : 0);
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.addEventListener('voiceschanged', loadVoices); }
$('speakBtn').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) return toast('Speech is not supported in this browser');
  const text = out.value.trim(); if (!text) return toast('Nothing to read yet');
  const u = new SpeechSynthesisUtterance(text);
  const v = speechSynthesis.getVoices()[Number(voiceSel.value)]; if (v) { u.voice = v; u.lang = v.lang; }
  speechSynthesis.cancel(); speechSynthesis.speak(u);
});

window.addEventListener('beforeunload', () => stopCamera());
paintEngine(); paintRunning(); showPrediction(null);
