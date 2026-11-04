# Model research (checked 2026-11-01)

Goal: a real ISL and ASL isolated-sign model that runs in the browser.
Rule: no invented weights, accuracy or vocabulary. Anything not verified is marked.

## Honest status

| Feature | Status |
|---|---|
| Camera, hand landmarks (MediaPipe) | Implemented |
| Starter gestures (7 generic hand shapes) | Implemented, demo only, not real ISL/ASL |
| Model registry, uncertainty state, sentence builder | Implemented |
| Trained ISL model | Planned (Milestone 4) |
| ASL fingerspelling letters (ASLNow!, MIT) | Installed, runs in plain JS. Real-world accuracy not measured |
| Word-level ASL model | Planned (Milestone 3), blocked by licences below |
| ONNX Runtime Web inference | Planned, not connected |
| Continuous recognition | Planned, needs a sequence model |

## Findings

- **WLASL** (ASL): pretrained I3D and Pose-TGCN weights exist (Google Drive links). The repo says data is for academic use only and "No commercial usage is allowed" (C-UDA).
- **ASL Citizen** (ASL): licence is non-commercial research only, forbids redistributing the data and forbids offering the Materials as a hosted solution. It does not say whether trained models count. Do not ship a model trained on it without written permission from Microsoft.
- **INCLUDE** (ISL): dataset is CC BY 4.0 (Zenodo), 263 signs, about 4,292 videos, INCLUDE-50 subset exists. Code is MIT and the repo mentions pretrained models and MediaPipe keypoints, but I could not confirm the checkpoint contents, architecture or accuracy. This is the best starting point for ISL.
- **TanmayNanda/ishara** (Hugging Face): Apache 2.0 TFLite model, but for ASL fingerspelling (letters), not word signs. No ONNX file.
- I did not find a ready ONNX model for word-level ISL or ASL. Treat any published checkpoint as needing conversion and testing.

## Next steps

1. ISL: download INCLUDE-50, extract MediaPipe landmarks, train a small landmark sequence model, hold out the official test split, export to ONNX, measure speed on Android Chrome.
2. ASL: pick a dataset whose licence allows a hosted app (or get permission), same pipeline. Fingerspelling (alphabet) is a smaller first step.
3. Only then connect ONNX Runtime Web in `public/js/recognition/` and turn each registry entry from `planned` to a real model.
