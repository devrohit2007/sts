// Shared recognition loop for the call page and the translator page.
// Uses MediaPipe's generic gesture model (7 hand shapes). It does NOT recognise real ISL or ASL.
import { loadVision } from '../vision/mediapipe.js';
import { STARTER } from './modelRegistry.js';
import { HoldTracker } from './holdTracker.js';

// One MediaPipe result -> { state: 'nohand' | 'uncertain' | 'sign', word?, label?, score? }
export function classify(result, starter = STARTER) {
  if (!result?.landmarks?.length) return { state: 'nohand' };
  const g = result.gestures?.[0]?.[0];
  const entry = g ? starter.labels[g.categoryName] : null;
  if (!entry || g.score < starter.threshold) return { state: 'uncertain', score: g?.score ?? 0 };
  return { state: 'sign', label: entry[0], word: entry[1], score: g.score };
}

export function createSignDetector({ getVideo, onFrame, onPrediction, onWord, intervalMs = 80, holdFrames = 6 }) {
  const tracker = new HoldTracker({ holdFrames });
  let running = false; let raf = 0; let last = 0; let vision = null;

  function loop(t) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const video = getVideo();
    if (t - last < intervalMs || !video || video.readyState < 2 || !video.videoWidth) return;
    last = t;
    let result;
    try { result = vision.recognizer.recognizeForVideo(video, t); } catch (e) { return; }
    onFrame?.(result, video);
    const p = classify(result);
    onPrediction?.(p);
    if (p.state === 'sign') { const w = tracker.sign(p.word); if (w) onWord?.(w, p); }
    else tracker.miss(p.state === 'nohand');
  }

  return {
    get running() { return running; },
    // Loads the model on first use. Throws if it cannot be loaded.
    async start() {
      if (running) return;
      running = true;
      try { vision = await loadVision(); } catch (e) { running = false; throw e; }
      if (running) raf = requestAnimationFrame(loop);
    },
    stop() { running = false; cancelAnimationFrame(raf); tracker.reset(); },
  };
}
