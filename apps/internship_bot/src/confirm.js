// Clicks Workday "verify your email" links for accounts the bot created, then puts the jobs that were
// waiting on them back in line. Run hourly after mail.py (intern-mail.service); needs Gmail connected.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { db } from './db.js';
import { send } from './notify.js';

const ROOT = new URL('..', import.meta.url).pathname;
const CREDS = ROOT + 'data/workday.json';
if (!existsSync(ROOT + 'data/mail.json') || !existsSync(CREDS)) process.exit(0);

const r = spawnSync('python3', [ROOT + 'src/mail.py', '--links'], { encoding: 'utf8' });
if (r.status) { console.error(r.stderr); process.exit(1); }
const accounts = JSON.parse(readFileSync(CREDS, 'utf8'));
const todo = JSON.parse(r.stdout).filter(l => accounts[l.host] && !accounts[l.host].verified);

const browser = todo.length && await chromium.launch({ channel: 'chrome', headless: true });
const done = [];
for (const { host, link } of todo) {
  const page = await browser.newPage();
  try {
    await page.goto(link, { waitUntil: 'load', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const body = await page.locator('body').innerText().catch(() => '');
    // An expired link still counts as handled: the next sign-in asks Workday to send a fresh one.
    if (/expired|invalid|no longer valid/i.test(body)) console.log('expired', host);
    else { accounts[host].verified = Date.now(); done.push(host); console.log('verified', host); }
  } catch (e) { console.log('failed', host, e.message.split('\n')[0]); }
  await page.close();
}
if (browser) await browser.close();
writeFileSync(CREDS, JSON.stringify(accounts, null, 1), { mode: 0o600 });

let requeued = 0;
for (const host of done)
  requeued += db.prepare("UPDATE jobs SET status='new', reason=NULL, updated=? WHERE status='manual' AND reason LIKE 'Workday sent a verification%' AND url LIKE ?")
    .run(Date.now(), `https://${host}/%`).changes;
console.log(`${done.length} account(s) verified, ${requeued} job(s) back in line`);
if (done.length) await send('Workday accounts confirmed', `${done.length} verification email(s) clicked; ${requeued} job(s) back in line.`).catch(() => {});
