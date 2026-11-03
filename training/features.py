"""Landmark -> feature maths. Must stay identical to public/js/recognition/features.js.
test/parity/check.js + test/unit/parity.test.js fail if the two ever disagree."""
import math
import numpy as np

SEQ_LEN = 32
HAND_DIM = 66
FEATURE_DIM = HAND_DIM * 2


def hand_features(lm):
    """lm: 21 (x, y, z) points."""
    w = lm[0]
    scale = max(1e-6, max(math.hypot(p[0] - w[0], p[1] - w[1]) for p in lm))
    f = []
    for p in lm:
        f += [(p[0] - w[0]) / scale, (p[1] - w[1]) / scale, (p[2] - w[2]) / scale]
    f += [w[0], w[1], 1.0]
    return f


def frame_features(hands, sides):
    """hands: list of 21-point lists (max 2 used). sides: 'Left'/'Right'/None per hand."""
    if not hands:
        return None
    hands = hands[:2]
    slots = [1 if (i < len(sides) and sides[i] == 'Right') else 0 for i in range(len(hands))]
    if len(hands) == 2 and slots[0] == slots[1]:
        slots = [0, 1] if hands[0][0][0] <= hands[1][0][0] else [1, 0]
    out = [[0.0] * HAND_DIM, [0.0] * HAND_DIM]
    for lm, s in zip(hands, slots):
        out[s] = hand_features(lm)
    return np.array(out[0] + out[1], dtype=np.float32)


def resample(frames, n=SEQ_LEN):
    """Nearest-frame resampling. Same rule as resample() in features.js (round half up)."""
    last = len(frames) - 1
    idx = [0 if n == 1 else int(math.floor(i * last / (n - 1) + 0.5)) for i in range(n)]
    return np.stack([frames[i] for i in idx]).astype(np.float32)
