"""Run MediaPipe Hand Landmarker over your video clips and save features.
Usage: python extract_landmarks.py split.json VIDEO_ROOT out_dir
Needs: pip install mediapipe opencv-python numpy
Download hand_landmarker.task from the MediaPipe models page and put it next to this file.
Uses the SAME 80 ms frame spacing as the browser so motion speed matches at inference time."""
import json, os, sys
import cv2, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
from features import frame_features, resample

STEP_MS = 80


def clip_features(landmarker, path):
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames, t, next_t, i = [], 0.0, 0.0, 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        t = i * 1000.0 / fps; i += 1
        if t < next_t:
            continue
        next_t += STEP_MS
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(t))
        hands = [[(p.x, p.y, p.z) for p in h] for h in res.hand_landmarks]
        sides = [h[0].category_name for h in res.handedness]
        f = frame_features(hands, sides)
        if f is not None:
            frames.append(f)
    cap.release()
    return frames


def main(split_path, root, out):
    os.makedirs(out, exist_ok=True)
    split = json.load(open(split_path))
    opts = vision.HandLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path='hand_landmarker.task'),
                                        running_mode=vision.RunningMode.VIDEO, num_hands=2)
    for name, rows in split.items():
        X, y, kept = [], [], 0
        for r in rows:
            with vision.HandLandmarker.create_from_options(opts) as lm:  # fresh timestamps per clip
                frames = clip_features(lm, os.path.join(root, r['path']))
            if len(frames) < 8:
                continue  # same minimum clip length as the browser segmenter
            X.append(resample(frames)); y.append(r['gloss']); kept += 1
        np.savez_compressed(os.path.join(out, f'{name}.npz'), X=np.stack(X), y=np.array(y))
        print(name, 'clips kept', kept, 'of', len(rows))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
