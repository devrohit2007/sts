'use strict';
// Public configuration the browser needs. Nothing in here is a secret:
// the Firebase web config only identifies the project, and TURN credentials must reach the client to work.

const DEFAULT_FIREBASE_WEB = {
  apiKey: 'AIzaSyDq2pFFfvBcHe8T57cUhHLPkG2VsrKglqs',
  authDomain: 'secret-keeper-8.firebaseapp.com',
  projectId: 'secret-keeper-8',
  storageBucket: 'secret-keeper-8.firebasestorage.app',
  messagingSenderId: '237581373337',
  appId: '1:237581373337:web:3cb8ad1662aacc9909cd08',
};

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function buildIceServers(env) {
  const stun = list(env.STUN_URLS);
  const servers = [{ urls: stun.length ? stun : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turn = list(env.TURN_URLS);
  if (turn.length) {
    servers.push({ urls: turn, username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' });
  } else if (env.PUBLIC_TURN !== 'off') {
    // Free public relay: best effort only. Set TURN_URLS for a reliable one, or PUBLIC_TURN=off to disable.
    servers.push({
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject', credential: 'openrelayproject',
    });
  }
  return servers;
}

function firebaseWebConfig(env) {
  if (env.FIREBASE_WEB_CONFIG) {
    try {
      const c = JSON.parse(env.FIREBASE_WEB_CONFIG);
      if (c && typeof c.apiKey === 'string' && typeof c.projectId === 'string') return c;
    } catch (e) { /* fall through to default */ }
  }
  return DEFAULT_FIREBASE_WEB;
}

function publicConfig(env, { googleSignIn }) {
  return { firebase: firebaseWebConfig(env), ice: buildIceServers(env), maxRoom: 8, googleSignIn: !!googleSignIn };
}

module.exports = { publicConfig, buildIceServers, firebaseWebConfig, DEFAULT_FIREBASE_WEB };
