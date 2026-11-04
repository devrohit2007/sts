// Camera access with readable errors. Frames never leave the browser.
let stream = null;

export function explainCameraError(e) {
  if (!window.isSecureContext || !navigator.mediaDevices) return 'The camera needs a secure (HTTPS) page.';
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError': return 'Camera permission was denied. Allow the camera in your browser settings and try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError': return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError': return 'The camera is being used by another app. Close it and try again.';
    default: return 'Could not start the camera: ' + (e?.message || 'unknown error');
  }
}

export async function startCamera(video, facing = 'user') {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  const base = { width: { ideal: 640 }, height: { ideal: 480 } };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, facingMode: { ideal: facing } } });
  } catch (e) {
    if (e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: base });
    else throw e;
  }
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
