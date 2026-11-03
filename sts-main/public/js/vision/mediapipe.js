// MediaPipe Tasks Vision: finds hands and landmarks in video frames.
// This is landmark detection only. It does NOT translate sign language.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

let mp = null;
let loading = null; // shared promise: concurrent callers never load the model twice

export function loadVision() {
  if (!loading) {
    loading = (async () => {
      mp = await import(MP + '/+esm');
      const fileset = await mp.FilesetResolver.forVisionTasks(MP + '/wasm');
      const make = (delegate) => mp.GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2,
      });
      let recognizer;
      try { recognizer = await make('GPU'); } catch (e) { recognizer = await make('CPU'); }
      return { recognizer, mp };
    })().catch((e) => { loading = null; throw e; }); // allow a retry after a failure
  }
  return loading;
}

export function drawHands(canvas, video, result) {
  if (!mp) return;
  const ctx = canvas.getContext('2d');
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!result?.landmarks?.length) return;
  const du = new mp.DrawingUtils(ctx);
  for (const hand of result.landmarks) {
    du.drawConnectors(hand, mp.GestureRecognizer.HAND_CONNECTIONS, { color: '#8B9BFF', lineWidth: 3 });
    du.drawLandmarks(hand, { color: '#FFFFFF', fillColor: '#6573F2', lineWidth: 1, radius: 3 });
  }
}

export function clearHands(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}
