// One entry per recognition engine. A language gets its own model file, labels,
// threshold and rules. Nothing here is a trained sign-language model yet.
//
// status values:
//   planned  - no trained model exists in this project yet
//   demo     - works today, but only recognises a few basic hand shapes
export const MODELS = {
  isl: {
    name: 'Indian Sign Language (ISL)',
    status: 'planned',
    dir: '/models/isl',
    file: '/models/isl/model.onnx',
    labelsFile: '/models/isl/labels.json',
    threshold: 0.7,
    note: 'Planned: train on INCLUDE-50 (CC BY 4.0), then export to ONNX.',
  },
  asl: {
    name: 'American Sign Language (ASL) fingerspelling',
    status: 'pretrained-static-letters',
    dir: '/models/asl',
    threshold: 0.5,
    note: 'Pretrained ASLNow! model recognises static fingerspelled letters. J and Z need movement, so this static model cannot read them reliably.',
  },
};

// Works today. These are 7 generic hand shapes from MediaPipe's gesture model,
// mapped to words. They are NOT real ISL or ASL signs.
export const STARTER = {
  name: 'Starter gestures (demo)',
  status: 'demo',
  threshold: 0.6,
  labels: {
    Open_Palm:   ['Open palm', 'hello'],
    Closed_Fist: ['Closed fist', 'yes'],
    Thumb_Up:    ['Thumbs up', 'good'],
    Thumb_Down:  ['Thumbs down', 'no'],
    Pointing_Up: ['Index finger up', 'wait'],
    Victory:     ['Peace sign (V)', 'thank you'],
    ILoveYou:    ['Thumb, index and pinky out', 'I love you'],
  },
};

// Is a trained model file actually installed for this language?
export async function modelInstalled(lang) {
  const m = MODELS[lang];
  try {
    const r = await fetch(m.file, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch (e) { return false; }
}
