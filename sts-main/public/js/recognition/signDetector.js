// Shared recognition loop for the call page and the translator page.
// Two engines:
//   demo  - MediaPipe's generic 7-gesture model. NOT real ISL or ASL.
//   model - a trained sign model (see modelRunner.js), used only when one is installed.
import { loadVision } from '../vision/mediapipe.js';
import { STARTER } from './modelRegistry.js';
import { HoldTracker } from './holdTracker.js';
import { frameFeatures } from './features.js';
import { SignSegmenter } from './segmenter.js';
import { decide, Cooldown } from './decision.js';

// One MediaPipe result -> { state: 'nohand' | 'uncertain' | 'sign', word?, label?, score? }
export function classify(result, starter = STARTER) {
  if (!result?.landmarks?.length) return { state: 'nohand' };
  const g = result.gestures?.[0]?.[0];
  const entry = g ? starter.labels[g.categoryName] : null;
  if (!entry || g.score < starter.threshold) return { state: 'uncertain', score: g?.score ?? 0 };
  return { state: 'sign', label: entry[0], word: entry[1], score: g.score };
}

// getModel() may return { labels, threshold, predict(clip) } to switch to the trained engine.
export function createSignDetector({ getVideo, getModel = () => null, onFrame, onPrediction, onWord, intervalMs = 80, holdFrames = 6, now = () => performance.now() }) {
  const tracker = new HoldTracker({ holdFrames });
  const segmenter = new SignSegmenter();
  const cooldown = new Cooldown();
  let running = false; let raf = 0; let last = 0; let vision = null; let inferring = false;

  async function infer(model, clip) {
    inferring = true; onPrediction?.({ state: 'thinking' });
    try {
      const d = decide(await model.predict(clip), model.labels, { minConf: model.threshold });
      if (!running) return;
      onPrediction?.(d);
      if (d.state === 'sign' && cooldown.accept(d.word, now())) onWord?.(d.word, d);
    } catch (e) { console.error(e); onPrediction?.({ state: 'error' }); } finally { inferring = false; }
  }

  function modelFrame(model, result) {
    const feat = frameFeatures(result);
    const { clip, tooShort } = segmenter.push(feat);
    if (clip && !inferring) return infer(model, clip);
    if (tooShort) return onPrediction?.({ state: 'nohand' });
    if (!inferring) onPrediction?.(feat ? { state: 'collecting', frames: segmenter.frames } : segmenter.frames ? { state: 'collecting', frames: segmenter.frames } : { state: 'nohand' });
  }

  function loop(t) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const video = getVideo();
    if (t - last < intervalMs || !video || video.readyState < 2 || !video.videoWidth) return;
    last = t;
    let result;
    try { result = vision.recognizer.recognizeForVideo(video, t); } catch (e) { return; }
    onFrame?.(result, video);
    const model = getModel();
    if (model?.kind === 'aslnow') {
      const hand = result?.landmarks?.[0];
      if (!hand) { tracker.miss(true); onPrediction?.({ state: 'nohand' }); return; }
      if (inferring) return;
      inferring = true;
      Promise.resolve(model.predictLandmarks(hand)).then((scores) => {
        if (!running) return;
        const d = decide(scores, model.labels, { minConf: model.threshold, minMargin: 0.10 });
        onPrediction?.(d);
        if (d.state === 'sign') { const w = tracker.sign(d.word); if (w) onWord?.(w, d); }
        else tracker.miss(false);
      }).catch((e) => { console.error(e); onPrediction?.({ state: 'error' }); })
        .finally(() => { inferring = false; });
      return;
    }
    if (model) return modelFrame(model, result);
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
    stop() { running = false; cancelAnimationFrame(raf); tracker.reset(); segmenter.reset(); cooldown.reset(); },
  };
}
