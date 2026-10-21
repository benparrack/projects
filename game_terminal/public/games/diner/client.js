// Your restaurant: home + upgrade shop between shifts, the kitchen during one, and a receipt after.
// Every press goes to the server, which keeps the clock, scores each order and owns the money.
// Server plugin: ../../../server/games/diner.js (catalog: ../../../server/casino/diner.js)

import { sfx } from '../sfx.js';
import { makeServerClock } from '../serverClock.js';
import { renderHome, renderReport, BUY_ERR } from './restaurant.js';
import { renderKitchen, makeCook, GRILL_KEYS, STATION_KEYS } from './kitchen.js';

const money = (n) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const REJECT = {
  ...BUY_ERR,
  wallet_loading: 'Opening your casino balance… try again in a second.',
  plate_full: 'Serve or trash the burger on the board first.',
  no_patty: 'Put a patty on the board first: click a cooking patty to plate it.',
  stack_full: 'That burger is tall enough.',
  on_shift: 'Finish the shift first.',
  tray_full: 'Serve (or ✕ dump) the one that\'s ready first.',
  station_busy: 'That one is already going.',
};

const CSS = `
.dn { width: 100%; --bg: #17140f; --panel: #1f1b16; --raise: #29241d; --line: rgba(236,226,208,.10); --line2: rgba(236,226,208,.2);
  --text: #ece4d6; --muted: #9d9384; --brass: #c9a45c; --brass2: #dcbc7c; --good: #8fb58e; --bad: #d26e54; --warn: #d9a446; --paper: #efe8da; --ink: #1c1814;
  --serif: Georgia, 'Times New Roman', serif; --sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  position: relative; font-family: var(--sans); font-size: 15px; color: var(--text); background: var(--bg);
  border-radius: 10px; padding: 16px; max-width: 860px; margin: 0 auto; user-select: none; border: 1px solid var(--line2); box-sizing: border-box; }
.dn * { box-sizing: border-box; }
.dn h2 { margin: 0; font-weight: 400; }
.dn button { font-family: inherit; color: var(--text); cursor: pointer; }
.dn .dn-btn { background: var(--raise); border: 1px solid var(--line2); border-radius: 6px; padding: 8px 16px; font-weight: 600; font-size: .82em; letter-spacing: .06em; color: var(--text); transition: border-color .15s, background .15s; }
.dn .dn-btn:hover:not(:disabled) { background: #332d24; border-color: var(--brass); color: var(--text); }
.dn .dn-btn:active:not(:disabled) { background: #3a3329; }
.dn .dn-btn:disabled { opacity: .4; cursor: not-allowed; }
.dn .dn-btn.go { background: var(--brass); border-color: var(--brass); color: var(--ink); }
.dn .dn-btn.go:hover:not(:disabled) { background: var(--brass2); border-color: var(--brass2); color: var(--ink); }
.dn .dn-btn.big { font-size: .95em; padding: 13px 36px; letter-spacing: .12em; }
.dn .dn-btn.small { padding: 4px 10px; font-size: .75em; }
.dn .dn-btn.buy { background: transparent; border-color: var(--brass); color: var(--brass); width: 100%; }
.dn .dn-btn.buy:hover:not(:disabled) { background: var(--brass); color: var(--ink); }
.dn .dn-link { background: none; border: none; color: var(--muted); text-decoration: underline; text-underline-offset: 2px; font-size: .8em; padding: 2px; }
.dn .dn-link:hover { background: none; color: var(--brass); }
.dn-msg { min-height: 1.2em; color: var(--bad); font-size: .9em; text-align: center; }
.dn-note { font-size: .8em; color: var(--muted); text-align: center; }

.dn-home { display: grid; gap: 18px; }
.dn-hero { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.dn-scene { width: 100%; max-width: 600px; border-radius: 6px; border: 1px solid var(--line); display: block; }
.dn-namerow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
.dn-name { font-family: var(--serif); font-size: 1.9em; letter-spacing: .01em; }
.dn-nameinput { font: inherit; font-family: var(--serif); font-size: 1.4em; padding: 4px 10px; background: var(--panel); color: var(--text); border: 1px solid var(--brass); border-radius: 4px; width: min(300px, 70vw); outline: none; }
.dn-tierpill { white-space: nowrap; color: var(--brass); border: 1px solid rgba(201,164,92,.5); border-radius: 3px; padding: 1px 8px; font-size: .68em; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
.dn-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; max-width: 600px; border: 1px solid var(--line); border-radius: 6px; }
.dn-stat { padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.dn-stat + .dn-stat { border-left: 1px solid var(--line); }
.dn-stat b { font-size: 1.15em; font-weight: 600; font-variant-numeric: tabular-nums; }
.dn-stat span { font-size: .7em; color: var(--muted); letter-spacing: .1em; text-transform: uppercase; order: -1; }

.dn-shop { border-top: 1px solid var(--line); padding-top: 14px; }
.dn-tabs { display: flex; gap: 22px; flex-wrap: wrap; margin-bottom: 14px; border-bottom: 1px solid var(--line); }
.dn .dn-tab { background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 6px 0 9px; margin-bottom: -1px; font-weight: 500; font-size: .85em; color: var(--muted); white-space: nowrap; }
.dn .dn-tab:hover { background: none; color: var(--text); }
.dn .dn-tab.on { color: var(--text); border-bottom-color: var(--brass); }
.dn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.dn-card { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.dn-card.has { border-color: rgba(201,164,92,.28); }
.dn-cardhead { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.dn-cardhead b { flex: 1; font-weight: 600; }
.dn-pips { display: flex; gap: 3px; } .dn-pips i { flex: 0 0 16px; height: 3px; border-radius: 1px; background: var(--line2); }
.dn-pips i.on { background: var(--brass); }
.dn-desc { font-size: .82em; color: var(--muted); line-height: 1.4; flex: 1; }
.dn-eff { font-size: .85em; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
.dn-eff b { font-weight: 600; }
.dn-arrow { color: var(--muted); }
.dn-owned { text-align: center; font-size: .72em; font-weight: 600; letter-spacing: .14em; color: var(--brass); padding: 7px 0; }
.dn-locked { text-align: center; font-size: .8em; color: var(--muted); padding: 7px 0; }
.dn-buywrap { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.dn-short { font-size: .75em; color: var(--muted); font-variant-numeric: tabular-nums; }
.dn-thumb { width: 100%; border-radius: 4px; display: block; }
.dn-tiercard { gap: 10px; }
.dn-wage { font-size: .78em; color: var(--muted); }

.dn-receipt { background: var(--paper); color: var(--ink); font-family: 'Courier New', ui-monospace, monospace; border-radius: 2px; max-width: 380px; margin: 12px auto; padding: 22px 22px 18px; display: flex; flex-direction: column; gap: 5px;
  box-shadow: 0 12px 30px rgba(0,0,0,.45); position: relative; animation: dn-slideup .35s ease-out; }
.dn-receipt-h { text-align: center; font-family: var(--serif); font-size: 1.3em; letter-spacing: .18em; } .dn-receipt-sub { text-align: center; color: #6b6255; margin-bottom: 8px; }
.dn-line { display: flex; justify-content: space-between; font-size: .95em; } .dn-line b { font-variant-numeric: tabular-nums; } .dn-line.bad b { color: #a3402a; }
.dn-line.total { font-size: 1.35em; font-weight: 700; }
.dn-rule { border-top: 1px dashed #8a8070; margin: 6px 0; }
.dn-stamp { align-self: center; margin-top: 8px; border: 2px solid #8a6a2a; color: #8a6a2a; padding: 2px 12px; font-weight: 700; font-size: .85em; letter-spacing: .14em; border-radius: 3px; transform: rotate(-3deg); animation: dn-stamp .4s .9s ease-out both; }
.dn-stamp.bad { border-color: #a3402a; color: #a3402a; }
.dn-stamp + .dn-stamp { margin-top: 4px; }
.dn-receipt .dn-btn { background: transparent; border-color: #8a8070; color: var(--ink); }
.dn-receipt .dn-btn:hover:not(:disabled) { background: rgba(0,0,0,.06); border-color: var(--ink); color: var(--ink); }
.dn-receipt .dn-btn.go { background: var(--ink); border-color: var(--ink); color: var(--paper); }
.dn-receipt .dn-btn.go:hover:not(:disabled) { background: #3a332b; color: var(--paper); }
.dn-row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 12px; }

.dn-shift { display: flex; flex-direction: column; gap: 12px; }
.dn-top { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.dn-pill { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 3px 12px; font-weight: 600; font-size: .9em; font-variant-numeric: tabular-nums; }
.dn-pill.money { color: var(--brass); border-color: rgba(201,164,92,.4); }
.dn-clock.low { color: var(--bad); border-color: var(--bad); }
.dn-pill.bad { color: var(--bad); }
.dn-counter { display: flex; gap: 12px; flex-wrap: wrap; min-height: 176px; padding: 12px 12px 0; border-radius: 6px 6px 0 0; align-items: flex-end; justify-content: center;
  background: linear-gradient(#26221c, #1f1b16); border: 1px solid var(--line); border-bottom: 8px solid #3a2e24; }
.dn-empty { align-self: center; color: var(--muted); font-size: .9em; }
.dn-cust { flex: 0 1 150px; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; border-radius: 6px; padding: 6px; border: 1px solid transparent; transition: border-color .15s, background .15s; animation: dn-in .3s ease-out; }
.dn-cust.can:hover, .dn-cust.next { border-color: rgba(201,164,92,.55); background: rgba(201,164,92,.06); }
.dn-ring { width: 72px; height: 72px; border-radius: 50%; padding: 3px; }
.dn-facesvg { width: 100%; height: 100%; display: block; background: #2e2822; border-radius: 50%; }
.dn-slip { background: var(--paper); color: var(--ink); border-radius: 2px; padding: 5px 7px; width: 100%; display: flex; flex-direction: column; gap: 4px; font-size: .8em; font-family: 'Courier New', ui-monospace, monospace; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
.dn-slip-h { display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
.dn-tag { padding: 0 5px; border-radius: 2px; color: #fff; font-size: .82em; font-family: var(--sans); font-weight: 600; letter-spacing: .06em; }
.dn-tag.rare { background: #a8483a; } .dn-tag.medium { background: #8e6240; } .dn-tag.well { background: #5a4334; }
.dn-tag.ok { box-shadow: 0 0 0 2px var(--good); }
.dn-want { display: flex; gap: 3px; flex-wrap: wrap; justify-content: center; }
.dn-want .dn-ico { width: 20px; height: 20px; display: block; }
.dn-want .ok { box-shadow: 0 2px 0 #4f7f4e; } .dn-want .bad { opacity: .3; }
.dn-serve { font-size: .78em; text-align: center; font-weight: 600; color: #7a5a1a; min-height: 1em; font-family: var(--sans); letter-spacing: .04em; }

.dn-kitchen { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 12px; }
.dn-griddle { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 8px; border-radius: 6px; border: 1px solid var(--line); background: #1b1916; }
.dn-burner { position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 6px; background: #22201c; border-radius: 4px; border: 1px solid var(--line); color: var(--text); }
.dn-spot { width: 84px; height: 84px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;
  background: radial-gradient(circle, #3a3631 0 55%, #2a2723 56%); border: 1px solid #45403a; box-shadow: inset 0 0 18px rgba(210,110,60,.28); transition: box-shadow .2s; }
.dn-spot.empty { color: var(--muted); font-weight: 600; font-size: .72em; letter-spacing: .1em; }
.dn-spot.empty:hover { color: var(--text); box-shadow: 0 0 0 1px var(--brass), inset 0 0 18px rgba(210,110,60,.4); }
.dn-spot.ready { box-shadow: 0 0 0 2px var(--good), 0 0 14px rgba(143,181,142,.45); animation: dn-glow 1s ease-in-out infinite; }
.dn-patty { position: relative; width: 64px; height: 64px; border-radius: 50%; box-shadow: inset -5px -6px 0 rgba(0,0,0,.22), inset 3px 3px 0 rgba(255,255,255,.06); }
.dn-steam { position: absolute; left: 0; right: 0; top: -20px; display: flex; justify-content: center; gap: 6px; }
.dn-steam i { width: 5px; height: 14px; border-radius: 4px; background: rgba(236,226,208,.35); animation: dn-steam 1.6s ease-out infinite; }
.dn-steam i:nth-child(2) { animation-delay: .5s; } .dn-steam i:nth-child(3) { animation-delay: 1s; }
.dn-steam.smoke i { background: rgba(120,114,106,.55); width: 9px; height: 18px; }
.dn-read { font-size: .78em; font-weight: 600; letter-spacing: .06em; min-height: 1.2em; font-variant-numeric: tabular-nums; }
.dn-bar { position: relative; width: 100%; height: 6px; background: #34302a; border-radius: 3px; overflow: hidden; }
.dn-bar span { position: absolute; top: 0; height: 100%; opacity: .85; }
.dn-bar i { position: absolute; top: 0; width: 2px; height: 100%; background: var(--text); }
.dn .dn-scrape { position: absolute; top: 4px; right: 4px; padding: 0 6px; background: transparent; color: var(--muted); border: 1px solid var(--line2); border-radius: 3px; font-size: .8em; }
.dn .dn-scrape:hover { color: var(--bad); border-color: var(--bad); background: transparent; }
.dn-key { font-size: .68em; color: var(--muted); }
.dn-boardcol { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.dn-h { font-size: .68em; font-weight: 600; letter-spacing: .16em; color: var(--muted); }
.dn-board { width: 100%; min-height: 160px; padding: 12px 6px; display: flex; flex-direction: column-reverse; align-items: center; border-radius: 6px; background: linear-gradient(135deg, #5a4330, #46342a); border: 1px solid var(--line); }
.dn-l { width: 120px; height: 12px; border-radius: 4px; margin-top: -1px; box-shadow: inset 0 -2px 0 rgba(0,0,0,.18); animation: dn-drop .18s ease-out; }
.dn-l.bun { background: #c98a45; height: 16px; border-radius: 4px 4px 12px 12px; }
.dn-l.bun.top { height: 30px; border-radius: 60px 60px 6px 6px; background: radial-gradient(ellipse at 50% 20%, #d9a05a, #c4843f 70%); }
.dn-l.meat { height: 18px; width: 112px; border-radius: 8px; }
.dn-l.lettuce { background: #8fae6a; height: 9px; width: 126px; border-radius: 10px; } .dn-l.tomato { background: #c8553d; height: 8px; width: 108px; }
.dn-l.cheese { background: #e2b04a; height: 6px; width: 124px; border-radius: 1px; } .dn-l.onion { background: #d8c8d4; height: 7px; width: 104px; }
.dn-l.pickles { background: #8a9a4a; height: 7px; width: 100px; } .dn-l.bacon { background: repeating-linear-gradient(90deg, #a8483a 0 10px, #d9a08a 10px 13px); height: 8px; width: 118px; }
.dn-l.jalapeno { background: #4f7a3a; height: 7px; width: 96px; } .dn-l.mushroom { background: #9c8573; height: 8px; width: 106px; }
.dn-l.egg { background: radial-gradient(circle, #e0a23a 30%, #f2ead8 32%); height: 11px; width: 110px; } .dn-l.avocado { background: #a8b86a; height: 8px; width: 112px; }
.dn-boardnote { font-size: .8em; color: var(--muted); }
.dn-pad { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; width: 100%; }
.dn .dn-bin { position: relative; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px 4px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.dn .dn-bin:hover { background: var(--raise); border-color: var(--line2); } .dn .dn-bin:active { background: #332d24; }
.dn-bin .dn-ico { width: 30px; height: 30px; display: block; }
.dn-bin b { font-size: 1.5em; line-height: 1.2; }
.dn-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.dn-help { font-size: .72em; color: var(--muted); text-align: center; line-height: 1.5; }

.dn-side { position: relative; } .dn-side::after { content: ''; position: absolute; right: -2px; bottom: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--fl); box-shadow: 0 0 0 1px var(--ink); }
.dn-side.ok { box-shadow: 0 2px 0 #4f7f4e; } .dn-side.bad { opacity: .4; }
.dn-badge { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); z-index: 2; white-space: nowrap; font-size: .6em; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
  background: var(--bg); color: var(--brass); border: 1px solid rgba(201,164,92,.5); border-radius: 3px; padding: 1px 7px; }
.dn-cust.sp { position: relative; } .dn-cust.critic .dn-slip { background: #e4e2dc; } .dn-cust.celebrity .dn-slip { box-shadow: 0 0 0 1px var(--brass), 0 2px 6px rgba(0,0,0,.35); }
.dn-cust.rush .dn-badge { color: var(--bad); border-color: rgba(210,110,84,.6); }
.dn-starsrow { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; font-size: .82em; color: var(--muted); }
.dn-starsrow .dn-stars { font-size: 1.25em; color: var(--brass); letter-spacing: 3px; }
.dn-repbar { width: 110px; height: 3px; border-radius: 2px; background: var(--line2); overflow: hidden; }
.dn-repbar i { display: block; height: 100%; background: var(--brass); }
.dn-crew { font-size: .68em; font-weight: 600; letter-spacing: .08em; color: var(--brass); border: 1px solid rgba(201,164,92,.45); border-radius: 3px; padding: 0 6px; }
.dn-stations { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.dn-station { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.dn-st-h { display: flex; justify-content: space-between; align-items: center; width: 100%; font-size: .9em; }
.dn-pot { position: relative; width: 70px; height: 62px; border: 1px solid #4a453e; border-radius: 4px 4px 10px 10px; overflow: hidden; background: #2a2723; display: flex; align-items: flex-end; }
.dn-pot.fryer { width: 96px; height: 50px; border-radius: 4px; background: #34302b; }
.dn-pot.fryer .dn-fill { background: #b08a3a; opacity: .45; }
.dn-pot.fryer.on .dn-fill, .dn-pot.fryer.done .dn-fill { opacity: 1; background: repeating-linear-gradient(90deg, #d9a446 0 6px, #b8862e 6px 9px); animation: dn-bubble .5s ease-in-out infinite alternate; }
.dn-pot.fryer.done .dn-fill { animation: none; }
.dn-pot.fountain { width: 52px; height: 72px; border-radius: 2px 2px 10px 10px; clip-path: polygon(0 0, 100% 0, 88% 100%, 12% 100%); background: rgba(236,226,208,.08); }
.dn-pot.shake { width: 58px; border-radius: 4px 4px 2px 2px; }
.dn-pot.shake.on .dn-fill { animation: dn-whirl .25s linear infinite; }
.dn-fill { width: 100%; height: 0; background: var(--fl, #555); transition: height .1s linear; }
.dn-pot.ruined .dn-fill { background: #1a1a1a !important; } .dn-pot.spill { box-shadow: 0 5px 0 -2px var(--fl); }
.dn-pot.good { outline: 2px solid var(--good); outline-offset: 2px; }
.dn-fillline { position: absolute; left: 0; right: 0; bottom: 86%; border-top: 1px dashed var(--text); opacity: .7; }
.dn-st-act { display: flex; gap: 6px; align-items: center; font-size: .8em; text-align: center; }
.dn-st-act .ok { color: var(--good); } .dn-st-act .bad { color: var(--bad); }
.dn-st-picks { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.dn .dn-flavor { border-left: 4px solid var(--fl); touch-action: none; }
.dn .dn-flavor.want { border-color: var(--brass); border-left-color: var(--fl); }
@keyframes dn-bubble { to { filter: brightness(1.12); } }
@keyframes dn-whirl { 50% { transform: translateX(2px); } }
@keyframes dn-glow { 50% { box-shadow: 0 0 0 2px var(--good), 0 0 22px rgba(143,181,142,.6); } }
.dn-fx { position: absolute; left: 0; right: 0; top: 60px; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 5; }
.dn-pop { padding: 6px 16px; border-radius: 4px; font-weight: 600; font-size: .95em; letter-spacing: .02em; background: var(--bg); color: var(--brass); border: 1px solid rgba(201,164,92,.6); box-shadow: 0 8px 24px rgba(0,0,0,.5); animation: dn-pop 1.8s ease-out forwards; }
.dn-pop.bad { color: var(--bad); border-color: rgba(210,110,84,.6); }
.dn-coin { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #e8cc8a, #b08a3a); pointer-events: none; z-index: 6; animation: dn-coin .9s cubic-bezier(.3,.7,.5,1) forwards; }
@keyframes dn-coin { from { transform: translate(0,0) scale(.6); opacity: 1; } to { transform: translate(var(--x), var(--y)) scale(1) rotate(var(--r)); opacity: 0; } }
@keyframes dn-pop { 0% { transform: translateY(8px); opacity: 0; } 12% { transform: none; opacity: 1; } 75% { opacity: 1; } 100% { transform: translateY(-24px); opacity: 0; } }
@keyframes dn-steam { 0% { transform: translateY(0) scaleX(1); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(-24px) scaleX(1.6); opacity: 0; } }
@keyframes dn-drop { from { transform: translateY(-10px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-in { from { transform: translateX(16px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-slideup { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-stamp { from { transform: rotate(-3deg) scale(1.3); opacity: 0; } to { transform: rotate(-3deg) scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dn *, .dn { animation: none !important; } }
@media (max-width: 640px) {
  .dn { padding: 10px; border-radius: 8px; }
  .dn-kitchen { grid-template-columns: 1fr 1fr; }
  .dn-griddle { grid-column: 1 / -1; }
  .dn-cust { flex-basis: 100px; } .dn-ring { width: 58px; height: 58px; }
  .dn-help { display: none; }
  .dn-grid { grid-template-columns: 1fr 1fr; }
  .dn-stats { grid-template-columns: 1fr 1fr; } .dn-stat:nth-child(3) { border-left: 0; } .dn-stat:nth-child(n+3) { border-top: 1px solid var(--line); }
  .dn-name { font-size: 1.5em; }
}
@media (max-width: 420px) { .dn-grid { grid-template-columns: 1fr; } }
`;

export function mount(container, api) {
  let view = null;
  let msg = '';
  const clock = makeServerClock();
  const live = []; // [fn] run every frame-ish to move timers without rebuilding the buttons
  const ui = { tab: 'kitchen', renaming: false, showReport: false, pouring: false };
  const rang = new Set(); // doneness-bell dings already played
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'dn';
  const stage = document.createElement('div');
  const fx = document.createElement('div');
  fx.className = 'dn-fx';
  root.append(stage, fx);
  container.append(style, root);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, onClick, cls) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b; };
  const send = (data) => api.sendAction(data);
  const pop = (text, bad) => { const p = el('div', `dn-pop${bad ? ' bad' : ''}`, text); fx.append(p); setTimeout(() => p.remove(), 1900); };
  function coins(n) {
    const w = root.clientWidth;
    for (let i = 0; i < n; i++) {
      const c = el('div', 'dn-coin');
      Object.assign(c.style, { left: `${w / 2}px`, top: '90px', animationDelay: `${i * 0.05}s` });
      c.style.setProperty('--x', `${(Math.random() - 0.5) * 220}px`);
      c.style.setProperty('--y', `${-40 - Math.random() * 80}px`);
      c.style.setProperty('--r', `${Math.round(Math.random() * 360)}deg`);
      root.append(c);
      setTimeout(() => c.remove(), 1100);
    }
  }

  const ctx = { el, btn, send, sfx, money, clock, live, ui, get view() { return view; }, get msg() { return msg; }, rerender: () => render(), leave: () => api.leaveRoom() };
  const cook = makeCook(ctx);

  function render() {
    live.length = 0;
    if (!view) { stage.replaceChildren(el('div', 'dn-note', 'Opening up…')); return; }
    if (view.phase === 'shift') stage.replaceChildren(renderKitchen(ctx, cook, rang));
    else if (view.phase === 'report' && ui.showReport && view.report) stage.replaceChildren(renderReport(ctx));
    else stage.replaceChildren(renderHome(ctx));
    for (const fn of live) fn();
  }

  const frame = setInterval(() => { for (const fn of live) fn(); }, 100);
  const onKey = (ev) => {
    if (!view || view.phase !== 'shift' || ev.target.closest('input, textarea')) return;
    const k = ev.key.toLowerCase();
    const n = k === '0' ? 10 : Number(k);
    const slot = GRILL_KEYS.indexOf(k);
    if (n >= 1 && n <= view.rules.TOPPINGS.length) send({ kind: 'top', item: view.rules.TOPPINGS[n - 1] });
    else if (slot !== -1 && slot < view.grills.length) send({ kind: ev.shiftKey ? 'scrape' : view.grills[slot] ? 'plate' : 'grill', slot });
    else if (k === 'x') send({ kind: 'trash' });
    else if (Object.values(STATION_KEYS).includes(k)) {
      const id = Object.keys(STATION_KEYS).find((s) => STATION_KEYS[s] === k);
      if (ev.repeat || !view.perks.stations.includes(id)) return;
      if (view.stations[id]) send({ kind: 'station_stop', id });
      else if (view.tray[id]) send({ kind: 'dump', id });
      else { ui.pouring = id === 'fountain'; sfx.play('whoosh'); send({ kind: 'station', id, flavor: cook.wantedFlavor(id) }); }
    }
    else if (k === 'backspace') send({ kind: 'untop' });
    else if (k === ' ' || k === 'enter') { const t = cook.bestTicket(); if (t) send({ kind: 'serve', ticket: t.id }); }
    else return;
    ev.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  // The fountain pours while the button or D is held.
  const stopPour = () => { if (ui.pouring) { ui.pouring = false; sfx.play('pop'); send({ kind: 'station_stop', id: 'fountain' }); } };
  const onKeyUp = (ev) => { if (ev.key.toLowerCase() === STATION_KEYS.fountain) stopPour(); };
  document.addEventListener('pointerup', stopPour);
  document.addEventListener('keyup', onKeyUp);

  function apply(data) {
    clock.sync(data.serverNow);
    const prev = view;
    view = data;
    if (!prev && data.phase === 'report') ui.showReport = true;
    if (prev && prev.phase === 'shift' && data.phase === 'report') { ui.showReport = true; sfx.play('win'); }
    if (prev && prev.phase !== 'shift' && data.phase === 'shift') rang.clear();
    if (prev && prev.phase === 'shift' && data.phase === 'shift') {
      if (data.tickets.length > prev.tickets.length) {
        sfx.play('chime');
        const fresh = data.tickets.filter((t) => !prev.tickets.some((p) => p.id === t.id));
        const sp = fresh.find((t) => t.special && t.special !== 'kid');
        if (sp) { sfx.play('go'); pop({ rush: 'Rush hour: ×1.5 pay', critic: 'A food critic sat down', celebrity: 'Celebrity order: big tip, short patience' }[sp.special]); }
      }
      if (data.served.length > prev.served.length) {
        const s = data.served[data.served.length - 1];
        sfx.play(s.score >= 60 ? 'chips' : 'point');
        pop(`${s.score}% · +${money(s.price + s.tip)}${s.combo ? ' · combo' : ''}`);
        coins(Math.max(1, Math.round(s.score / 20)));
        if (s.special === 'critic') setTimeout(() => pop(s.rep > 0 ? `Good review: +${s.rep} rep` : s.rep < 0 ? `Bad review: ${s.rep} rep` : 'The critic was unmoved', s.rep < 0), 700);
      }
      if (data.missed > prev.missed) { sfx.play('lose'); pop('Customer walked out · −5 rep', true); }
    }
    if (prev && prev.phase !== 'shift' && data.phase !== 'shift' && prev.restaurant && data.restaurant && data.restaurant.tier > prev.restaurant.tier) {
      sfx.play('win'); pop(`Upgraded to ${data.catalog.TIERS[data.restaurant.tier].name}`); coins(12);
    }
    msg = '';
    render();
  }

  render();
  return {
    applySnapshot: apply,
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') apply(data);
      else if (data.kind === 'moveRejected') { ui.pouring = false; sfx.play('error'); msg = REJECT[data.reason] || ''; render(); }
    },
    applyRoster() {},
    unmount() { clearInterval(frame); document.removeEventListener('keydown', onKey); document.removeEventListener('pointerup', stopPour); document.removeEventListener('keyup', onKeyUp); container.innerHTML = ''; },
  };
}
