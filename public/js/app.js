// Translator page. Same recognition modules as the call page (js/recognition/signDetector.js).
import { startCamera, stopCamera, explainCameraError } from './camera.js';
import { drawHands, clearHands } from './vision/mediapipe.js';
import { MODELS, STARTER, modelInstalled } from './recognition/modelRegistry.js';
import { createSignDetector } from './recognition/signDetector.js';
import { appendWord, finishSentence } from './languages/sentenceBuilder.js';
import { $, toast } from './ui.js';

const video = $('video'); const canvas = $('overlay'); const out = $('out');
let lang = 'isl'; let facing = 'user'; let running = false; let idleT = 0;

// ---------- Language + mode ----------
async function paintEngine() {
  const m = MODELS[lang];
  const installed = await modelInstalled(lang);
  $('engineName').textContent = installed ? `${m.name}: model file found` : STARTER.name;
  $('engineMsg').textContent = installed
    ? 'A model file exists, but model inference is not connected yet. Showing starter gestures.'
    : `No trained ${lang.toUpperCase()} model is installed yet. Demo mode recognises 7 basic hand shapes, not real ${lang.toUpperCase()} signs. ${m.note}`;
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  lang = b.dataset.lang;
  document.querySelectorAll('[data-lang]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  paintEngine();
}));

// ---------- Prediction card ----------
function showPrediction(p) {
  $('predWord').textContent = !p ? '-' : p.state === 'sign' ? p.word : p.state === 'uncertain' ? 'Uncertain sign' : 'No hand';
  $('predState').textContent = !p ? '' : p.state === 'sign' ? 'Hold steady' : p.state === 'uncertain' ? 'Not confident enough to translate' : 'Show a hand to the camera';
  const pct = p?.score ? Math.round(p.score * 100) : 0;
  $('predPct').textContent = p?.score ? pct + '%' : '';
  $('predBar').style.width = pct + '%';
  $('predCard').dataset.state = p?.state || 'idle';
}

const detector = createSignDetector({
  getVideo: () => video,
  onFrame: (r, v) => drawHands(canvas, v, r),
  onPrediction: showPrediction,
  onWord: (word) => {
    out.value = appendWord(out.value, word);
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
  running = true; paintRunning(); setStatus('Loading hand detection model...', 'wait');
  try { await detector.start(); } catch (e) {
    console.error(e); stop(); return toast('Could not load the hand detection model. Check your connection.', 5000);
  }
  if (!running) return;
  $('startBtn').disabled = false; setStatus('Ready. Show a hand sign.', 'ok');
}
function stop() {
  running = false; detector.stop(); stopCamera(); video.srcObject = null;
  clearHands(canvas); clearTimeout(idleT); paintRunning(); $('startBtn').disabled = false;
  setStatus('Camera is off'); showPrediction(null);
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
