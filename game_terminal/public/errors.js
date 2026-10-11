// Sends uncaught browser errors to /api/client-error so they show up in the server log.
// Loaded before hub.js so errors during startup are caught too. At most 5 reports per page load.
let left = 5;
const seen = new Set();

function report(message, source, line, stack) {
  const key = `${message}|${source}|${line}`;
  if (left <= 0 || seen.has(key)) return;
  seen.add(key);
  left -= 1;
  const body = JSON.stringify({ message, source, line, stack, page: location.pathname, ua: navigator.userAgent });
  try { navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' })); } catch { /* reporting must never throw */ }
}

window.addEventListener('error', (e) => {
  if (!e.message) return; // failed <img>/<script> loads also fire 'error', with no message
  report(e.message, e.filename, e.lineno, e.error && e.error.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  report(r && r.message ? r.message : String(r), '', '', r && r.stack);
});
