// Camera and microphone access that degrades gracefully: video+audio, then each alone.
const VIDEO = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 24, max: 30 } };

export function explainMediaError(e, kind) {
  if (!window.isSecureContext || !navigator.mediaDevices) return `The ${kind} needs a secure (HTTPS) page.`;
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError': return `${cap(kind)} permission was denied. Allow it in your browser's site settings to be seen or heard.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError': return `No ${kind} was found on this device.`;
    case 'NotReadableError':
    case 'TrackStartError': return `The ${kind} is being used by another app.`;
    case 'OverconstrainedError': return `The ${kind} could not start with the requested settings.`;
    default: return `Could not start the ${kind}: ${e?.message || 'unknown error'}`;
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function tryGet(constraints) {
  try { return { stream: await navigator.mediaDevices.getUserMedia(constraints) }; } catch (e) { return { error: e }; }
}

// Always resolves. stream is null when nothing could be opened (the user can still join and watch).
export async function acquireMedia() {
  const errors = {};
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error('unsupported');
    return { stream: null, audio: false, video: false, errors: { audio: explainMediaError(e, 'microphone'), video: explainMediaError(e, 'camera') } };
  }
  const both = await tryGet({ audio: true, video: VIDEO });
  if (both.stream) return { stream: both.stream, audio: true, video: true, errors };

  const [a, v] = [await tryGet({ audio: true }), await tryGet({ video: VIDEO })];
  const tracks = [...(a.stream?.getTracks() || []), ...(v.stream?.getTracks() || [])];
  if (a.error) errors.audio = explainMediaError(a.error, 'microphone');
  if (v.error) errors.video = explainMediaError(v.error, 'camera');
  return { stream: tracks.length ? new MediaStream(tracks) : null, audio: !!a.stream, video: !!v.stream, errors };
}

export async function getVideoTrack(facing) {
  const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...VIDEO, facingMode: { ideal: facing } } });
  return s.getVideoTracks()[0];
}

export function stopStream(stream) { stream?.getTracks().forEach((t) => t.stop()); }
