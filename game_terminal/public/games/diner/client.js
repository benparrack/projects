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

const FONT = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap';
const CSS = `
.dn { width: 100%; --ink: #2b1d14; --cream: #fff6e5; --red: #e63946; --yellow: #ffd23f; --green: #2ecc71; --teal: #2bb5a3;
  position: relative; font-family: 'Fredoka', 'Nunito', system-ui, sans-serif; color: var(--ink); background: linear-gradient(#ffe9c7, #ffd9a0);
  border-radius: 18px; padding: 12px; max-width: 860px; margin: 0 auto; user-select: none; border: 3px solid var(--ink); box-shadow: 0 6px 0 var(--ink); box-sizing: border-box; }
.dn * { box-sizing: border-box; }
.dn h2 { margin: 0; font-weight: 700; }
.dn button { font-family: inherit; color: var(--ink); cursor: pointer; }
.dn-btn { background: #fff; border: 3px solid var(--ink); border-radius: 14px; padding: 8px 16px; font-weight: 700; font-size: 1em; box-shadow: 0 4px 0 var(--ink); transition: transform .08s, box-shadow .08s; }
.dn .dn-btn:hover:not(:disabled) { background: #fff3c4; color: var(--ink); transform: translateY(-1px); }
.dn .dn-btn:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
.dn .dn-btn:disabled { opacity: .5; cursor: not-allowed; }
.dn .dn-btn.go { background: var(--green); color: #fff; text-shadow: 0 2px 0 rgba(0,0,0,.25); }
.dn .dn-btn.go:hover:not(:disabled) { background: #27ae60; color: #fff; }
.dn .dn-btn.big { font-size: 1.35em; padding: 12px 28px; border-radius: 18px; animation: dn-throb 1.6s ease-in-out infinite; }
.dn .dn-btn.small { padding: 4px 10px; font-size: .9em; border-radius: 10px; box-shadow: 0 3px 0 var(--ink); }
.dn .dn-btn.buy { background: var(--yellow); width: 100%; }
.dn .dn-btn.buy:hover:not(:disabled) { background: #ffc800; }
.dn-link { background: none; border: none; text-decoration: underline; font-size: .85em; padding: 2px; }
.dn .dn-link:hover { background: none; color: var(--red); }
.dn-msg { min-height: 1.2em; color: var(--red); font-weight: 600; text-align: center; }
.dn-note { font-size: .85em; opacity: .75; text-align: center; }

.dn-home { display: grid; gap: 14px; }
.dn-hero { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.dn-scene { width: 100%; max-width: 560px; border-radius: 14px; border: 3px solid var(--ink); background: #8fd3ff; display: block; }
.dn-namerow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.dn-name { font-size: 1.6em; }
.dn-nameinput { font: inherit; font-size: 1.2em; padding: 4px 10px; border: 3px solid var(--ink); border-radius: 10px; width: min(280px, 70vw); }
.dn-tierpill { white-space: nowrap; background: var(--teal); color: #fff; border: 2px solid var(--ink); border-radius: 999px; padding: 1px 10px; font-size: .8em; font-weight: 700; }
.dn-stats { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.dn-stat { background: #fff; border: 3px solid var(--ink); border-radius: 12px; padding: 4px 12px; display: flex; flex-direction: column; align-items: center; min-width: 96px; }
.dn-stat b { font-size: 1.1em; } .dn-stat span { font-size: .75em; opacity: .7; }

.dn-shop { background: var(--cream); border: 3px solid var(--ink); border-radius: 16px; padding: 10px; }
.dn-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.dn-tab { background: #fff; border: 3px solid var(--ink); border-radius: 12px 12px 4px 4px; padding: 5px 9px; font-weight: 600; font-size: .88em; white-space: nowrap; }
.dn .dn-tab:hover { background: #fff3c4; color: var(--ink); }
.dn .dn-tab.on { background: var(--red); color: #fff; }
.dn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 10px; }
.dn-card { background: #fff; border: 3px solid var(--ink); border-radius: 14px; padding: 10px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 4px 0 rgba(43,29,20,.25); }
.dn-card.has { background: #f2fff4; }
.dn-cardhead { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.dn-cardhead b { flex: 1; }
.dn-pips { display: flex; gap: 4px; } .dn-pips i { width: 18px; height: 8px; border-radius: 4px; border: 2px solid var(--ink); background: #eee; }
.dn-pips i.on { background: var(--green); }
.dn-desc { font-size: .85em; opacity: .8; flex: 1; }
.dn-eff { font-size: .9em; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dn-arrow { color: var(--red); font-weight: 700; }
.dn-owned { text-align: center; font-weight: 700; color: #1e8449; }
.dn-locked { text-align: center; font-weight: 600; opacity: .6; }
.dn-buywrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.dn-short { font-size: .8em; color: var(--red); font-weight: 600; }
.dn-thumb { width: 100%; border-radius: 10px; border: 2px solid var(--ink); display: block; }
.dn-tiercard { gap: 8px; }

.dn-receipt { background: #fffdf7; border: 3px solid var(--ink); border-radius: 6px; max-width: 380px; margin: 10px auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 4px;
  box-shadow: 0 6px 0 var(--ink); position: relative; animation: dn-slideup .4s cubic-bezier(.2,1.4,.4,1); }
.dn-receipt-h { text-align: center; font-size: 1.4em; font-weight: 700; } .dn-receipt-sub { text-align: center; opacity: .7; margin-bottom: 6px; }
.dn-line { display: flex; justify-content: space-between; } .dn-line.bad b { color: var(--red); }
.dn-line.total { font-size: 1.5em; color: #1e8449; }
.dn-rule { border-top: 2px dashed var(--ink); margin: 4px 0; opacity: .5; }
.dn-stamp { align-self: center; margin-top: 6px; border: 3px solid var(--red); color: var(--red); padding: 2px 12px; font-weight: 700; border-radius: 8px; transform: rotate(-6deg); animation: dn-stamp .5s .9s cubic-bezier(.2,1.6,.4,1) both; }
.dn-stamp + .dn-stamp { margin-top: 2px; }
.dn-row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 10px; }

.dn-shift { display: flex; flex-direction: column; gap: 10px; }
.dn-top { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.dn-pill { background: #fff; border: 3px solid var(--ink); border-radius: 999px; padding: 2px 14px; font-weight: 700; font-size: 1.05em; }
.dn-pill.money { background: var(--yellow); }
.dn-clock.low { background: var(--red); color: #fff; animation: dn-throb .6s ease-in-out infinite; }
.dn-counter { display: flex; gap: 10px; flex-wrap: wrap; min-height: 170px; padding: 10px 10px 0; border-radius: 14px 14px 0 0; align-items: flex-end; justify-content: center;
  background: linear-gradient(#ffe0e0, #fff 70%); border: 3px solid var(--ink); border-bottom: 16px solid #c0392b; }
.dn-empty { align-self: center; opacity: .6; font-weight: 600; }
.dn-cust { flex: 0 1 150px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; border-radius: 12px; padding: 4px; border: 3px solid transparent; transition: transform .12s; animation: dn-in .4s cubic-bezier(.2,1.4,.4,1); }
.dn-cust:hover { transform: translateY(-4px); }
.dn-cust.can:hover, .dn-cust.next { border-color: var(--yellow); background: rgba(255,210,63,.25); }
.dn-ring { width: 76px; height: 76px; border-radius: 50%; padding: 5px; }
.dn-facesvg { width: 100%; height: 100%; display: block; background: #fff; border-radius: 50%; }
.dn-slip { background: #fffdf2; border: 2px solid var(--ink); border-radius: 6px; padding: 4px 6px; width: 100%; display: flex; flex-direction: column; gap: 3px; font-size: .85em; transform: rotate(-1deg); }
.dn-slip-h { display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
.dn-tag { padding: 0 6px; border-radius: 6px; color: #fff; font-size: .85em; border: 2px solid var(--ink); }
.dn-tag.rare { background: #e05050; } .dn-tag.medium { background: #c07a40; } .dn-tag.well { background: #7a5236; }
.dn-tag.ok { box-shadow: 0 0 0 3px var(--green); }
.dn-want { display: flex; gap: 2px; font-size: 1.25em; flex-wrap: wrap; justify-content: center; }
.dn-want .ok { filter: drop-shadow(0 0 3px var(--green)); } .dn-want .bad { opacity: .35; text-decoration: line-through; }
.dn-serve { font-size: .75em; text-align: center; font-weight: 700; color: #b9770e; min-height: 1em; }

.dn-kitchen { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 10px; }
.dn-griddle { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 8px; border-radius: 14px; border: 3px solid var(--ink);
  background: linear-gradient(#5d6d7e, #34495e); }
.dn-burner { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; background: #2c3e50; border-radius: 10px; border: 2px solid var(--ink); color: #fff; }
.dn-spot { width: 86px; height: 86px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;
  background: repeating-linear-gradient(90deg, #444 0 6px, #333 6px 10px); border: 3px solid var(--ink); box-shadow: 0 0 0 4px #ff8c1a55, inset 0 0 16px #ff8c1a88; transition: box-shadow .2s; }
.dn-spot.empty { color: #ffd23f; font-weight: 700; font-size: .8em; }
.dn-spot.empty:hover { box-shadow: 0 0 0 4px #ffd23f, inset 0 0 16px #ff8c1a; }
.dn-spot.ready { box-shadow: 0 0 0 5px var(--green), 0 0 18px var(--green); animation: dn-throb .5s ease-in-out infinite; }
.dn-patty { position: relative; width: 66px; height: 66px; border-radius: 50%; border: 3px solid var(--ink); box-shadow: inset -6px -6px 0 rgba(0,0,0,.2); }
.dn-steam { position: absolute; left: 0; right: 0; top: -22px; display: flex; justify-content: center; gap: 6px; }
.dn-steam i { width: 7px; height: 16px; border-radius: 6px; background: rgba(255,255,255,.75); animation: dn-steam 1.4s ease-out infinite; }
.dn-steam i:nth-child(2) { animation-delay: .45s; } .dn-steam i:nth-child(3) { animation-delay: .9s; }
.dn-steam.smoke i { background: rgba(40,40,40,.85); width: 12px; height: 22px; }
.dn-read { font-size: .85em; font-weight: 700; background: #fff; border-radius: 6px; padding: 0 6px; min-height: 1.2em; }
.dn-bar { position: relative; width: 100%; height: 10px; background: #ddd; border-radius: 5px; border: 2px solid var(--ink); overflow: hidden; }
.dn-bar span { position: absolute; top: 0; height: 100%; }
.dn-bar i { position: absolute; top: 0; width: 3px; height: 100%; background: #fff; box-shadow: 0 0 0 1px var(--ink); }
.dn-scrape { position: absolute; top: 4px; right: 4px; padding: 0 6px; background: var(--red); color: #fff !important; border: 2px solid var(--ink); border-radius: 8px; font-weight: 700; }
.dn-key { font-size: .7em; opacity: .7; }
.dn-boardcol { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.dn-h { font-size: .8em; font-weight: 700; letter-spacing: .12em; opacity: .7; }
.dn-board { width: 100%; min-height: 160px; padding: 10px 6px; display: flex; flex-direction: column-reverse; align-items: center; border-radius: 14px; background: linear-gradient(135deg, #d9a066, #b07840); border: 3px solid var(--ink); }
.dn-l { width: 120px; height: 12px; border-radius: 6px; margin-top: -2px; border: 2px solid var(--ink); animation: dn-drop .2s cubic-bezier(.2,1.6,.4,1); }
.dn-l.bun { background: #f4a63a; height: 18px; border-radius: 6px 6px 14px 14px; }
.dn-l.bun.top { height: 32px; border-radius: 60px 60px 8px 8px; background: radial-gradient(circle at 30% 30%, #fff6dc 2px, transparent 2.5px) 0 0/14px 10px, #f4a63a; }
.dn-l.meat { height: 20px; width: 112px; border-radius: 10px; }
.dn-l.lettuce { background: #6ab04c; height: 10px; width: 128px; border-radius: 12px; } .dn-l.tomato { background: #e74c3c; height: 9px; width: 108px; }
.dn-l.cheese { background: #ffd23f; height: 7px; width: 126px; border-radius: 2px; } .dn-l.onion { background: #d7b8e6; height: 8px; width: 104px; }
.dn-l.pickles { background: #7d9a2b; height: 8px; width: 100px; } .dn-l.bacon { background: repeating-linear-gradient(90deg, #b03a2e 0 10px, #f0a080 10px 14px); height: 9px; width: 118px; }
.dn-l.jalapeno { background: #27ae60; height: 8px; width: 96px; } .dn-l.mushroom { background: #a1887f; height: 9px; width: 106px; }
.dn-l.egg { background: radial-gradient(circle, #ffc107 30%, #fff 32%); height: 12px; width: 110px; } .dn-l.avocado { background: #a5d66f; height: 9px; width: 112px; }
.dn-boardnote { font-size: .85em; font-weight: 600; }
.dn-pad { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; width: 100%; }
.dn-bin { background: #fff; border: 3px solid var(--ink); border-radius: 12px; padding: 4px; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 3px 0 var(--ink); }
.dn .dn-bin:hover { background: #fff3c4; } .dn .dn-bin:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }
.dn-bin b { font-size: 1.5em; line-height: 1.2; }
.dn-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.dn-help { font-size: .75em; opacity: .6; text-align: center; }

.dn-side { position: relative; } .dn-side::after { content: ''; position: absolute; right: -2px; bottom: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--fl); border: 1.5px solid var(--ink); }
.dn-side.ok { filter: drop-shadow(0 0 3px var(--green)); } .dn-side.bad { opacity: .45; }
.dn-badge { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); z-index: 2; white-space: nowrap; font-size: .62em; font-weight: 700; letter-spacing: .04em;
  background: var(--ink); color: var(--yellow); border-radius: 99px; padding: 1px 8px; }
.dn-cust.sp { position: relative; } .dn-cust.critic .dn-slip { background: #eef0ff; } .dn-cust.celebrity .dn-slip { background: #fff6d6; box-shadow: 0 0 0 3px var(--yellow); }
.dn-cust.rush .dn-badge { background: var(--red); color: #fff; }
.dn-pill.bad { background: #ffd6d6; }
.dn-starsrow { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; font-weight: 600; font-size: .9em; }
.dn-starsrow .dn-stars { font-size: 1.35em; color: #f4b400; letter-spacing: 2px; -webkit-text-stroke: 1px var(--ink); }
.dn-repbar { width: 110px; height: 10px; border: 2px solid var(--ink); border-radius: 99px; background: #fff; overflow: hidden; }
.dn-repbar i { display: block; height: 100%; background: var(--yellow); }
.dn-crew { font-size: .75em; font-weight: 600; background: var(--yellow); border: 2px solid var(--ink); border-radius: 99px; padding: 0 6px; }
.dn-wage { font-size: .8em; font-weight: 600; color: #8a5a00; }
.dn-stations { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.dn-station { background: #fff; border: 3px solid var(--ink); border-radius: 14px; padding: 8px; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.dn-st-h { display: flex; justify-content: space-between; width: 100%; }
.dn-pot { position: relative; width: 70px; height: 62px; border: 3px solid var(--ink); border-radius: 6px 6px 14px 14px; overflow: hidden; background: #f4f4f4; display: flex; align-items: flex-end; }
.dn-pot.fryer { width: 96px; height: 50px; border-radius: 8px; background: #6b6b6b; }
.dn-pot.fryer .dn-fill { background: #e8b23a; opacity: .5; }
.dn-pot.fryer.on .dn-fill, .dn-pot.fryer.done .dn-fill { opacity: 1; background: repeating-linear-gradient(90deg, #f4c430 0 6px, #e0a020 6px 9px); animation: dn-bubble .5s ease-in-out infinite alternate; }
.dn-pot.fryer.done .dn-fill { animation: none; }
.dn-pot.fountain { width: 52px; height: 72px; border-radius: 4px 4px 12px 12px; clip-path: polygon(0 0, 100% 0, 88% 100%, 12% 100%); }
.dn-pot.shake { width: 58px; border-radius: 8px 8px 4px 4px; }
.dn-pot.shake.on .dn-fill { animation: dn-whirl .25s linear infinite; }
.dn-fill { width: 100%; height: 0; background: var(--fl, #ddd); transition: height .1s linear; }
.dn-pot.ruined .dn-fill { background: #2b2b2b !important; } .dn-pot.spill { box-shadow: 0 6px 0 -2px var(--fl); }
.dn-pot.good { outline: 3px solid var(--green); }
.dn-fillline { position: absolute; left: 0; right: 0; bottom: 86%; border-top: 2px dashed var(--red); }
.dn-st-act { display: flex; gap: 6px; align-items: center; font-size: .85em; font-weight: 600; text-align: center; }
.dn-st-act .ok { color: #1e8449; } .dn-st-act .bad { color: var(--red); }
.dn-st-picks { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.dn .dn-flavor { border-left: 10px solid var(--fl); touch-action: none; }
.dn .dn-flavor.want { box-shadow: 0 3px 0 var(--ink), 0 0 0 3px var(--yellow); }
@keyframes dn-bubble { to { filter: brightness(1.15); } }
@keyframes dn-whirl { 50% { transform: translateX(2px); } }
.dn-fx { position: absolute; left: 0; right: 0; top: 60px; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 5; }
.dn-pop { padding: 6px 16px; border-radius: 999px; font-weight: 700; font-size: 1.2em; background: var(--yellow); border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--ink); animation: dn-pop 1.8s ease-out forwards; }
.dn-pop.bad { background: var(--red); color: #fff; }
.dn-coin { position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #f5c542; border: 2px solid #b8860b; pointer-events: none; z-index: 6; animation: dn-coin .9s cubic-bezier(.3,.7,.5,1) forwards; }
@keyframes dn-coin { from { transform: translate(0,0) scale(.6); opacity: 1; } to { transform: translate(var(--x), var(--y)) scale(1.1) rotate(var(--r)); opacity: 0; } }
@keyframes dn-pop { 0% { transform: scale(.4); opacity: 0; } 12% { transform: scale(1.15); opacity: 1; } 25% { transform: scale(1); } 75% { opacity: 1; } 100% { transform: translateY(-40px); opacity: 0; } }
@keyframes dn-steam { 0% { transform: translateY(0) scaleX(1); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(-26px) scaleX(1.8); opacity: 0; } }
@keyframes dn-drop { from { transform: translateY(-18px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-in { from { transform: translateX(40px) scale(.8); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-throb { 50% { transform: scale(1.04); } }
@keyframes dn-slideup { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-stamp { from { transform: rotate(-6deg) scale(2.5); opacity: 0; } to { transform: rotate(-6deg) scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dn *, .dn { animation: none !important; } }
@media (max-width: 640px) {
  .dn { padding: 8px; border-radius: 12px; }
  .dn-kitchen { grid-template-columns: 1fr 1fr; }
  .dn-griddle { grid-column: 1 / -1; }
  .dn-cust { flex-basis: 100px; } .dn-ring { width: 60px; height: 60px; }
  .dn-help { display: none; }
  .dn-grid { grid-template-columns: 1fr 1fr; }
  .dn-stat { min-width: 76px; padding: 3px 8px; }
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
  if (!document.querySelector(`link[href="${FONT}"]`)) {
    const font = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT });
    document.head.append(font);
  }
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
