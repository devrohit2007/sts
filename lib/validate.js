'use strict';
// Input validation helpers. Everything that arrives over a socket is untrusted.

const ROOM_ID_RE = /^[A-Z0-9]{8}$/;
// Control characters plus the Unicode line/paragraph separators.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]', 'g');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Trim, drop control characters, collapse whitespace, cap length.
function clean(value, max) {
  return String(value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeRoomId(value) {
  const id = clean(value, 16).toUpperCase();
  return ROOM_ID_RE.test(id) ? id : null;
}

function isDescription(d, type) {
  return isObj(d) && d.type === type && typeof d.sdp === 'string' && d.sdp.length > 0 && d.sdp.length <= 60000;
}

// Returns a sanitized RTCIceCandidateInit, or undefined if the input is not valid.
function cleanCandidate(c) {
  if (!isObj(c) || typeof c.candidate !== 'string' || c.candidate.length > 2000) return undefined;
  const out = { candidate: c.candidate };
  if (typeof c.sdpMid === 'string' && c.sdpMid.length <= 64) out.sdpMid = c.sdpMid;
  if (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 256) out.sdpMLineIndex = c.sdpMLineIndex;
  if (typeof c.usernameFragment === 'string' && c.usernameFragment.length <= 64) out.usernameFragment = c.usernameFragment;
  return out;
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch (e) {
    return null;
  }
}

// Sign keywords: up to 12 short non-empty strings.
function cleanWords(words) {
  if (!Array.isArray(words)) return [];
  return words.slice(0, 12).map((w) => clean(w, 20)).filter(Boolean);
}

module.exports = { ROOM_ID_RE, isObj, clean, normalizeRoomId, isDescription, cleanCandidate, safeHttpsUrl, cleanWords };
