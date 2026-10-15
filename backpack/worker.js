// Cloudflare Worker: serves public/ and fetches calendar feeds for the browser
// (school servers don't send CORS headers, so the page can't fetch them directly).
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/feed') return feed(url.searchParams.get('url'));
    return env.ASSETS.fetch(req);
  },
};

const text = (msg, status) => new Response(msg, { status, headers: { 'content-type': 'text/plain' } });

export async function feed(raw) {
  let target;
  try { target = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch { return text('That is not a valid link.', 400); }
  const local = ['localhost', '127.0.0.1'].includes(target.hostname);
  if (target.protocol !== 'https:' && !(local && target.protocol === 'http:')) return text('The link must start with https:// or webcal://', 400);
  let res;
  try { res = await fetch(target, { redirect: 'follow', headers: { 'user-agent': 'Backpack homework planner' } }); }
  catch { return text('Could not reach that link.', 502); }
  if (!res.ok) return text(`The school site answered ${res.status}. Check the link is the full feed URL.`, 502);
  const body = await res.text();
  if (body.length > 5e6) return text('That feed is too large.', 413);
  // Only ever pass calendars through, so this can't be used as a general proxy.
  if (!body.trimStart().startsWith('BEGIN:VCALENDAR')) return text("That link isn't a calendar feed.", 422);
  return new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' } });
}
