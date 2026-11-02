'use strict';
// Firebase Admin is loaded lazily so the rest of the server (and the tests) work without it.
// Verifying an ID token needs only the project id. A service account is optional.

const DEFAULT_PROJECT_ID = 'secret-keeper-8';

function createVerifier(env = process.env, log = console) {
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  try {
    const admin = require('firebase-admin');
    const options = { projectId };
    if (env.FIREBASE_SERVICE_ACCOUNT) {
      options.credential = admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT));
    }
    const app = admin.apps.length ? admin.app() : admin.initializeApp(options);
    log.log(`[auth] Firebase Admin ready (project ${projectId}${env.FIREBASE_SERVICE_ACCOUNT ? ', service account' : ''})`);
    return (idToken) => admin.auth(app).verifyIdToken(idToken);
  } catch (e) {
    log.warn(`[auth] Firebase Admin unavailable: ${e.message}. Google sign-in is disabled, guests still work.`);
    return null;
  }
}

module.exports = { createVerifier, DEFAULT_PROJECT_ID };
