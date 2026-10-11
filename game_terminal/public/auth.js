// Browser side of sign-in. The server tells us which mode it runs in (/api/config):
//   'firebase' — Firebase Auth (Google + email/password), SDK loaded from gstatic on demand
//   'dev'      — local development without a Firebase project: any name signs in as dev:<name>
//   'off'      — accounts unavailable; guest play only
// Either way the rest of the app only sees: current user (or null), onChange, getToken().

const FIREBASE_VERSION = '10.12.2';
const DEV_KEY = 'game_terminal.devUser';

const FRIENDLY = {
  'auth/invalid-email': 'That email address doesn\'t look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Passwords need at least 6 characters.',
  'auth/email-already-in-use': 'There\'s already an account with that email. Try signing in.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/popup-closed-by-user': null, // user changed their mind — not an error
  'auth/cancelled-popup-request': null,
  'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/user-disabled': 'This account has been disabled.',
};

function friendly(err) {
  const code = err && err.code;
  if (code in FRIENDLY) return FRIENDLY[code];
  return (err && err.message) || 'Something went wrong. Please try again.';
}

const listeners = new Set();
const auth = {
  mode: 'off',
  ready: null, // Promise resolving once the initial signed-in state is known
  user: null, // { email, name, provider } — display info only; identity is the token
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  async getToken() { return null; },
  async signInGoogle() {},
  async signInEmail() {},
  async signUpEmail() {},
  async resetPassword() {},
  async signInDev() {},
  async signOut() {},
  friendly,
};

function setUser(u) {
  auth.user = u;
  for (const cb of listeners) cb(u);
}

async function initFirebase(config) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, fa] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`)]);
  const app = initializeApp(config);
  const fbAuth = fa.getAuth(app);
  let resolveReady;
  auth.ready = new Promise((r) => { resolveReady = r; });
  fa.onAuthStateChanged(fbAuth, (u) => {
    setUser(u ? { email: u.email, name: u.displayName, provider: (u.providerData[0] || {}).providerId || 'password', verified: u.emailVerified } : null);
    resolveReady();
  });
  Object.assign(auth, {
    async getToken(force = false) { return fbAuth.currentUser ? fbAuth.currentUser.getIdToken(force) : null; },
    async signInGoogle() { await fa.signInWithPopup(fbAuth, new fa.GoogleAuthProvider()); },
    async signInEmail(email, password) { await fa.signInWithEmailAndPassword(fbAuth, email, password); },
    async signUpEmail(email, password) {
      const cred = await fa.createUserWithEmailAndPassword(fbAuth, email, password);
      fa.sendEmailVerification(cred.user).catch(() => {});
    },
    async resetPassword(email) { await fa.sendPasswordResetEmail(fbAuth, email); },
    async signOut() { await fa.signOut(fbAuth); },
  });
}

function initDev() {
  const read = () => { try { return localStorage.getItem(DEV_KEY); } catch { return null; } };
  const write = (v) => { try { v ? localStorage.setItem(DEV_KEY, v) : localStorage.removeItem(DEV_KEY); } catch { /* storage blocked */ } };
  const toUser = (name) => (name ? { email: `${name}@dev.local`, name, provider: 'dev' } : null);
  auth.user = toUser(read());
  auth.ready = Promise.resolve();
  Object.assign(auth, {
    async getToken() { const n = read(); return n ? `dev:${n}` : null; },
    async signInDev(name) {
      const n = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
      if (!n) throw Object.assign(new Error('Enter a name to sign in with.'), { code: 'dev' });
      write(n);
      setUser(toUser(n));
    },
    async signOut() { write(null); setUser(null); },
  });
}

export async function initAuth() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    auth.mode = cfg.authMode === 'firebase' && cfg.firebase ? 'firebase' : cfg.authMode === 'dev' ? 'dev' : 'off';
    if (auth.mode === 'firebase') await initFirebase(cfg.firebase);
    else if (auth.mode === 'dev') initDev();
  } catch (err) {
    console.warn('auth unavailable, guest mode only', err);
    auth.mode = 'off';
  }
  if (!auth.ready) auth.ready = Promise.resolve();
  return auth;
}

export { auth };
