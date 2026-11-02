// Turns a stream of per-frame results into discrete words: a sign must be held for
// `holdFrames` frames, and the same word is not repeated until the hand goes away.
export class HoldTracker {
  constructor({ holdFrames = 6, lostFrames = 6 } = {}) {
    this.holdFrames = holdFrames; this.lostFrames = lostFrames; this.reset();
  }
  reset() { this.cand = null; this.n = 0; this.lost = 0; this.committed = null; }

  // A confident sign this frame. Returns the word once it has been held long enough.
  sign(word) {
    this.lost = 0;
    if (word === this.cand) this.n++; else { this.cand = word; this.n = 1; }
    if (this.n >= this.holdFrames && word !== this.committed) { this.committed = word; return word; }
    return null;
  }

  // No usable sign this frame. A missing hand for a while allows the same word again.
  miss(handMissing) {
    this.cand = null; this.n = 0;
    if (handMissing && ++this.lost >= this.lostFrames) this.committed = null;
    else if (!handMissing) this.lost = 0;
  }
}
