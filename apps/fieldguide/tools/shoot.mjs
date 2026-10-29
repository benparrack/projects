// Screenshot pages of a running `fieldguide serve` for visual review.
// usage: node tools/shoot.mjs <outdir> <url>[|name|width|height|colorScheme|full|selector[@index]] ...
import { firefox } from '/home/ben/projects/apps/internship_bot/node_modules/playwright-core/index.mjs';
const [out, ...specs] = process.argv.slice(2);
const browser = await firefox.launch({ executablePath: process.env.FG_FIREFOX || '/home/ben/.cache/ms-playwright/firefox-1553/firefox/firefox', env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } });
const errors = [];
for (const spec of specs) {
  const [url, name = 'shot', w = '1440', h = '1000', scheme = 'light', full = '', sel = ''] = spec.split('|');
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (sel) { await page.evaluate(q => { const el = document.querySelectorAll(q.split('@')[0])[+(q.split('@')[1] || 0)]; window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 40); }, sel); await page.waitForTimeout(200); }
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full === 'full' });
  await page.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no page errors');
