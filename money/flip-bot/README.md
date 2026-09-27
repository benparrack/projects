# Flip Bot (Stockholm)

Finds underpriced second-hand items on **Blocket** and **Tradera**, buys cheap Tradera
Buy-Now deals by itself, resells them on Tradera, and lowers the price until they sell.
Blocket deals come to your phone with a ready-to-send Swedish message. You only pay, pick up
or receive, take photos and ship. Setup: **[SETUP.md](SETUP.md)**. Design and findings:
[BUILD.md](BUILD.md), [PLAN.md](PLAN.md), [PROGRESS.md](PROGRESS.md).

```
.venv/bin/python flip.py once|run|status|auth|catalog check
.venv/bin/python -m unittest discover -s tests -t .
```

## How it works
- **Scan** (every 3–5 min): Blocket's search page (base64 JSON embedded in the HTML) and the
  Tradera SOAP API → match against `catalog.yaml` (with exclude words and global
  accessory/part filters) → fair value (Tradera sold comps > Blocket asking prices × 0.85 >
  catalog seed) → profit after fees and shipping → Swedish red-flag filter.
- **Decide**: Tradera Buy-Now ≤ `auto_buy_max_sek` → buy. Above that, or suspiciously cheap
  (< 0.3× fair) → phone Approve/Skip, which expires after 30 min. Blocket → phone alert.
- **Sell**: photos in `inbox/<id>/` → fixed-price Tradera listing at fair value → −5% every 3
  days down to cost + half the minimum profit → nudges you at 21 days → order poll → "SOLD,
  ship to …".
- **State machine** (SQLite `flipbot.sqlite`): found → approved → bought → arrived → listed →
  sold → shipped/closed (exits: skipped, lost).
- **Money controls**: bankroll (unsold stock counts against it), daily spend cap, max open
  flips, `STOP` file or `stop` reply. Ships in `mode: dry_run`: nothing real happens until you
  change it.

## Honest caveats
- Tradera API behaviour beyond the WSDLs is **unverified until there are keys**: ItemStatus
  strings, the fixed-price ItemType, required shipping/payment fields on AddItem, BuyStatus
  values, and the token-login URL. Every failure path notifies you instead of crashing. Expect
  a short fix-up session after step 2 of SETUP.
- Auctions are skipped (only Buy-Now), since bidding at the end of an auction isn't built.
- Catalog seeds are guesses except BotW. Run `flip catalog check` once there are keys.
- Sweden may treat systematic reselling as a business (Skatteverket), and you're on a student
  permit. Check before doing more than a handful of flips.
- Realistic profit is 100–400 SEK per flip on a 1,000 SEK bankroll: a learning run.
