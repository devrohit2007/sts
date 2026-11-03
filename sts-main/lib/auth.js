'use strict';
const crypto = require('node:crypto');
const { isObj, clean, safeHttpsUrl } = require('./validate');

// Builds the function that turns a sign-in request into a verified identity.
//   Google: { idToken }   verified with Firebase Admin (verifyIdToken)
//   Guest:  { guestName } temporary identity, nothing is stored
// `verifyIdToken` is injected so tests can use a fake. It is null when the Admin SDK is unavailable.
function createAuthenticator({ verifyIdToken, log = console } = {}) {
  return async function authenticate(payload) {
    if (!isObj(payload)) return { error: 'Invalid sign-in request', code: 'bad-request' };

    if (payload.idToken !== undefined) {
      const token = payload.idToken;
      if (typeof token !== 'string' || !token || token.length > 8000) return { error: 'Invalid sign-in token', code: 'invalid-token' };
      if (!verifyIdToken) return { error: 'Google sign-in is not available on this server. Use guest access.', code: 'auth-unavailable' };
      try {
        const d = await verifyIdToken(token);
        if (!d || !d.uid) throw new Error('no uid');
        const name = clean(d.name, 40) || clean(String(d.email || '').split('@')[0], 40) || 'Google user';
        return { user: { uid: d.uid, name, photoURL: safeHttpsUrl(d.picture), isGuest: false } };
      } catch (e) {
        log.warn(`[auth] token rejected: ${e.code || e.message}`);
        return { error: 'Your sign-in expired or is invalid. Please sign in again.', code: 'invalid-token' };
      }
    }

    const name = clean(payload.guestName, 40) || `Guest ${crypto.randomInt(1000, 10000)}`;
    return { user: { uid: `guest_${crypto.randomBytes(6).toString('hex')}`, name, photoURL: null, isGuest: true } };
  };
}

// Only what the client needs to show "who am I".
function publicUser(u) {
  return { name: u.name, photoURL: u.photoURL, isGuest: u.isGuest };
}

module.exports = { createAuthenticator, publicUser };
