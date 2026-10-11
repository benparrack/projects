// Verifies the identity token a client sends in `hello`.
//
// - Firebase configured (FIREBASE_SERVICE_ACCOUNT): a Firebase ID token, checked with firebase-admin.
// - Not configured and not production: dev tokens of the form 'dev:<name>' are accepted, so the
//   whole account system can be exercised locally and in tests without a Firebase project.
// - Neither: accounts are unavailable and everyone plays as a guest (today's behaviour).

function createAuth(env = process.env) {
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    return {
      mode: 'firebase',
      async verify(token) {
        try {
          const t = await admin.auth().verifyIdToken(String(token), true);
          return { uid: t.uid, email: t.email || null, displayName: t.name || null };
        } catch {
          return null;
        }
      },
    };
  }
  if (env.NODE_ENV !== 'production' && !env.RENDER) { // RENDER is set on every Render service: never dev-auth there
    return {
      mode: 'dev',
      async verify(token) {
        const m = /^dev:([a-z0-9_]{1,24})$/i.exec(String(token || ''));
        return m ? { uid: `dev_${m[1].toLowerCase()}`, email: `${m[1].toLowerCase()}@dev.local`, displayName: m[1] } : null;
      },
    };
  }
  return { mode: 'off', async verify() { return null; } };
}

// The public Firebase web config the browser needs to sign in. It isn't secret (it ships to every
// visitor), but it comes from an env var so the repo stays project-agnostic.
function webConfig(env = process.env) {
  try {
    return env.FIREBASE_WEB_CONFIG ? JSON.parse(env.FIREBASE_WEB_CONFIG) : null;
  } catch {
    return null;
  }
}

module.exports = { createAuth, webConfig };
