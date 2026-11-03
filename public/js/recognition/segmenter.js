// Cuts the camera stream into one clip per sign. A clip starts when a hand appears and
// ends when hands have been out of view for `endAbsent` frames (or the clip gets too long).
// Clips shorter than `minFrames` are dropped as accidental movement.
export class SignSegmenter {
  constructor({ minFrames = 8, maxFrames = 45, endAbsent = 6 } = {}) {
    Object.assign(this, { minFrames, maxFrames, endAbsent }); this.reset();
  }
  reset() { this.buf = []; this.absent = 0; }
  get frames() { return this.buf.length; }

  // feat: Float32Array for this frame, or null when no hand. Returns { clip?, tooShort? }.
  push(feat) {
    if (feat) {
      this.absent = 0; this.buf.push(feat);
      if (this.buf.length >= this.maxFrames) return this.#end();
      return {};
    }
    if (!this.buf.length) return {};
    if (++this.absent >= this.endAbsent) return this.#end();
    return {};
  }

  #end() {
    const clip = this.buf; this.reset();
    return clip.length >= this.minFrames ? { clip } : { tooShort: true };
  }
}
