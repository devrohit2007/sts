# Training the ASL sign model

No trained WORD-level model ships with STS (only the pretrained ASL fingerspelling letters in `public/models/asl/`). Follow these steps to add word signs. Follow these steps once.

## 1. Pick data you are allowed to use (do this first)
- **WLASL** is academic-use only and **ASL Citizen** is non-commercial research and forbids hosted services. Do not use them for the live site.
- **Kaggle "Google - Isolated Sign Language Recognition"** (250 signs): its licence was not confirmed. Read the Data > License box on the Kaggle page before use.
- **Your own recordings** with written consent from each signer are always an option. Aim for 20+ clips per sign from 5+ different signers (more is better).
- Put the dataset name and licence in the `--dataset` argument so it is saved with the results.

## 2. Make a manifest
CSV with columns `path,gloss,signer`. `gloss` must match `vocabulary.json` (the 100 target signs). `signer` identifies the person.

## 3. Run (Colab or Kaggle notebook, free GPU not required)
```bash
pip install mediapipe opencv-python numpy torch onnx
# download hand_landmarker.task (MediaPipe Hand Landmarker model) into this folder
python split.py manifest.csv split.json            # signer-disjoint train/val/test
python extract_landmarks.py split.json VIDEOS feats
python train.py feats ../public/models/asl --dataset "NAME (LICENCE)"
```
`split.py` refuses to run with fewer than 5 signers and asserts that no signer appears in two sets.
`train.py` picks the best epoch on val, then looks at test **once** and writes `metrics.json`.
Signs with fewer than 20 training clips are left out, so `labels.json` lists only what was learned.
Start with the 50 core signs; add the extended 50 when you have data for them.

## 4. Ship it
Commit `public/models/asl/{model.onnx,labels.json,metrics.json}`. Select ASL on the Translator page.
The page shows the test accuracy only if `metrics.json` says the split was signer-disjoint.

## Rules that keep it honest
- Never edit `metrics.json` by hand. Never tune on the test set.
- If you change `features.js`, change `features.py` too and retrain (`npm test` checks they match).
- Webcam accuracy will be lower than the test score. Say so.

## Path from 50 to 100 signs
Same code, more data: add clips for `ASL_EXTENDED`, retrain, ship the new three files.
Signs that depend on face or body location (MOTHER vs FATHER) will confuse a hands-only model.
If they do, add MediaPipe Pose/Face Landmarker features (new `FEATURE_DIM`, update both feature files, retrain).
