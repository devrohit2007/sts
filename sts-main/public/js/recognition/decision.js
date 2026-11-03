// Turns model scores into a decision, and stops the same word flooding the output.
export function softmax(logits) {
  let max = -Infinity; for (const v of logits) if (v > max) max = v;
  const e = Array.from(logits, (v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

// A sign is accepted only if it is confident enough AND clearly ahead of the runner-up.
// Anything else is "unknown": the sign may be outside the vocabulary, or just unclear.
export function decide(probs, labels, { minConf = 0.7, minMargin = 0.15, topK = 3 } = {}) {
  const ranked = Array.from(probs, (p, i) => ({ i, p })).sort((a, b) => b.p - a.p).slice(0, topK)
    .map(({ i, p }) => ({ gloss: labels[i].gloss, meaning: labels[i].meaning, score: p }));
  const [top, second] = ranked;
  const margin = top.score - (second?.score ?? 0);
  if (top.score < minConf || margin < minMargin) return { state: 'unknown', score: top.score, margin, alternatives: ranked };
  return { state: 'sign', gloss: top.gloss, word: top.meaning, label: top.gloss, meaning: top.meaning, score: top.score, margin, alternatives: ranked };
}

// Same meaning is blocked for `sameMs`; any meaning is blocked for `anyMs` after the last one.
export class Cooldown {
  constructor({ sameMs = 2000, anyMs = 700 } = {}) { Object.assign(this, { sameMs, anyMs }); this.reset(); }
  reset() { this.lastAny = -Infinity; this.lastWord = null; this.lastAt = -Infinity; }
  accept(word, now) {
    if (now - this.lastAny < this.anyMs) return false;
    if (word === this.lastWord && now - this.lastAt < this.sameMs) return false;
    this.lastAny = now; this.lastWord = word; this.lastAt = now;
    return true;
  }
}
