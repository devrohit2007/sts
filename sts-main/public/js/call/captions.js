// Caption display, speech-to-text and text-to-speech.
import { el } from '../ui.js';

export const SIZES = [18, 22, 28, 36, 46]; // px
export const DEFAULT_SIZE = 2;
export function clampSize(i) {
  const n = Math.round(Number(i));
  return Number.isFinite(n) ? Math.min(SIZES.length - 1, Math.max(0, n)) : DEFAULT_SIZE;
}

const VERB = { sign: 'signed', phrase: 'says', speech: 'said' };
const MAX_LIVE = 3; const LIVE_MS = 20000; const MAX_TRANSCRIPT = 300;

// Live captions (a few at a time, large) plus a transcript that keeps everything.
export function createCaptionView({ box, transcript, myId }) {
  const items = new Map(); // id -> { live, line, fromId }
  const who = (c) => (c.fromId === myId() ? 'You' : c.from);
  const time = (ts) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return {
    setSize(i) { box.style.setProperty('--cap-size', SIZES[clampSize(i)] + 'px'); },
    add(c) {
      if (items.has(c.id)) return;
      const live = el('div', `cap ${c.source}${c.final ? '' : ' pending'}`);
      live.append(el('small', '', `${who(c)} ${VERB[c.source] || 'said'}`), el('p', '', c.text));
      box.appendChild(live);
      while (box.children.length > MAX_LIVE) box.firstChild.remove();
      setTimeout(() => live.remove(), LIVE_MS);

      const line = el('div', 'tline');
      line.append(el('span', 'tmeta', `${time(c.ts)}  ${who(c)}`), el('span', 'ttext', c.text));
      transcript.appendChild(line);
      while (transcript.children.length > MAX_TRANSCRIPT) transcript.firstChild.remove();
      transcript.scrollTop = transcript.scrollHeight;
      items.set(c.id, { live, line, fromId: c.fromId });
      if (items.size > MAX_TRANSCRIPT) items.delete(items.keys().next().value);
    },
    // The AI sentence replaces the raw keywords. Returns the caption's author, or null if unknown.
    update(id, text) {
      const it = items.get(id);
      if (!it) return null;
      it.live.classList.remove('pending');
      it.live.querySelector('p').textContent = text;
      it.line.querySelector('.ttext').textContent = text;
      return it.fromId;
    },
    clear() { box.replaceChildren(); transcript.replaceChildren(); items.clear(); },
  };
}

// Browser speech recognition that survives Chrome's automatic stops.
// Restarts with a growing delay, never in a tight loop, and gives up after repeated instant failures.
export function createSpeechCaptioner({ SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition, getLang, onFinal, onStatus, wait = setTimeout, now = Date.now }) {
  let rec = null; let want = false; let failures = 0; let startedAt = 0; let timer = null;

  function spawn() {
    if (!want || rec) return;
    const r = new SR();
    rec = r;
    r.lang = getLang(); r.continuous = true; r.interimResults = false; r.maxAlternatives = 1;
    r.onstart = () => { startedAt = now(); onStatus('listening'); };
    r.onresult = (e) => {
      failures = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { const t = e.results[i][0].transcript.trim(); if (t) onFinal(t); }
      }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { want = false; onStatus('denied'); }
      else if (e.error === 'audio-capture') { want = false; onStatus('no-mic'); }
      else if (e.error === 'network') { failures++; onStatus('retrying'); }
      // 'no-speech' and 'aborted' are normal: the end handler restarts quietly
    };
    r.onend = () => {
      if (rec === r) rec = null;
      if (!want) return;
      failures = now() - startedAt < 1000 ? failures + 1 : 0;
      if (failures >= 8) { want = false; onStatus('failed'); return; }
      timer = wait(spawn, Math.min(300 * 2 ** Math.min(failures, 4), 5000));
    };
    try { r.start(); } catch (e) {
      rec = null; failures++;
      if (failures >= 8) { want = false; onStatus('failed'); } else timer = wait(spawn, 500);
    }
  }

  function halt() {
    clearTimeout(timer);
    if (rec) { const r = rec; rec = null; r.onend = null; try { r.abort(); } catch (e) { /* not running */ } }
  }

  return {
    supported: !!SR,
    get active() { return want; },
    start() { if (!SR || want) return !!SR; want = true; failures = 0; spawn(); return true; },
    stop() { want = false; halt(); onStatus('off'); },
    // Language change: restart with the new language.
    refresh() { if (!want) return; halt(); failures = 0; spawn(); },
  };
}

// Reads captions aloud. Drops the backlog instead of falling far behind.
export function createVoice({ synth = globalThis.speechSynthesis, Utter = globalThis.SpeechSynthesisUtterance, getLang }) {
  const supported = !!synth && !!Utter;
  let on = false; let queued = 0;
  const pick = (lang) => {
    const vs = synth.getVoices();
    return vs.find((v) => v.lang === lang) || vs.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  };
  return {
    supported,
    get on() { return on; },
    set(value) { on = supported && !!value; if (!on && supported) { synth.cancel(); queued = 0; } },
    speak(text) {
      if (!on || !String(text).trim()) return;
      if (queued >= 3) { synth.cancel(); queued = 0; }
      const u = new Utter(text);
      const lang = getLang(); u.lang = lang;
      const v = pick(lang); if (v) u.voice = v;
      queued++;
      u.onend = u.onerror = () => { queued = Math.max(0, queued - 1); };
      synth.speak(u);
    },
  };
}
