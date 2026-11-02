// Firebase Authentication (Google sign-in). Loaded from Google's CDN only when needed.
const V = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${V}/`;

let auth = null; let fb = null;

// Returns the user who is already signed in (or null).
export async function initFirebase(config) {
  if (!config?.apiKey) throw new Error('Firebase is not configured');
  const [appMod, authMod] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js')]);
  fb = authMod;
  auth = authMod.getAuth(appMod.initializeApp(config));
  return new Promise((resolve) => {
    const off = authMod.onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

export const googleReady = () => !!auth;

export async function googleSignIn() {
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await fb.signInWithPopup(auth, provider)).user;
}

export async function getIdToken(forceRefresh = false) {
  return auth?.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;
}

export async function signOutGoogle() {
  if (auth?.currentUser) await fb.signOut(auth);
}

export function googleErrorMessage(e) {
  switch (e?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'Sign-in was cancelled.';
    case 'auth/popup-blocked': return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/unauthorized-domain': return 'This website is not authorised in Firebase yet. Add it under Authentication, Settings, Authorized domains.';
    case 'auth/operation-not-allowed': return 'Google sign-in is not turned on in Firebase.';
    case 'auth/network-request-failed': return 'Network problem while signing in. Check your connection and try again.';
    default: return 'Google sign-in failed' + (e?.code ? ` (${e.code})` : '') + '. You can continue as a guest.';
  }
}
