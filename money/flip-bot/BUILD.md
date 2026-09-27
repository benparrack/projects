# Flip Bot — Build Spec

New session: read this file, PLAN.md and PROGRESS.md, then build. Don't ask Ben questions. Chosen model: hybrid max-autonomy (Tradera auto-buy/sell via API; Blocket deals → phone alert; Ben only pays, picks up, ships, approves bigger buys).

### 0. Rules for the builder
- **Don't ask Ben questions.** Every decision has a default below. If something external is
  missing (a Tradera key, the user token, the ntfy topic), build the code path anyway, add the
  missing piece to `SETUP.md`, and make the bot degrade gracefully instead of blocking.
- Read `PLAN.md` first. Its verified findings override assumptions made here.
- Python 3 with `requests`, `beautifulsoup4`, `zeep` (SOAP) and `pyyaml`, plus sqlite3 from the
  stdlib. Use a venv in `money/flip-bot/.venv`. Match the style of `money/sports-arb-scanner/`.
- **Ship in `mode: dry_run`.** In dry run, every buy, bid and listing is logged and notified as
  "[DRY RUN] would …" and nothing real happens. Ben switches to `live` in `config.yaml` himself.
  Never flip it to live in code or tests.
- Commit per milestone with `git commit --only -- <paths>`, following the repo rule in
  `/home/ben/projects/CLAUDE.md`.

### 1. Loop
```
every 3–5 min (jitter):  scan sources → match catalog → price → score → decide
decide:  Tradera deal ≤ auto_buy_max        → auto buy/bid via API (live) + notify
         Tradera deal > auto_buy_max        → ntfy approval request (Approve/Skip buttons)
         Blocket deal (any price)           → ntfy alert w/ prefilled Swedish message + link
every 6 h: reprice active resale listings; refresh comps (daily)
```
Item state machine lives in SQLite (`flips` table):
`found → approved → bought → arrived → listed → sold → shipped → closed`, with `skipped` and
`lost` as exits. Every state change records a timestamp and amount in SEK.

### 2. Sources
- `sources/blocket.py`: GET `https://www.blocket.se/recommerce/forsale/search?q=<q>&sort=PUBLISHED_DESC`
  using a Firefox User-Agent. Decode the base64 `<script data-react-query-state>` tag and take
  the query whose `state.data` has `docs`. Normalize into
  `Listing(source, id, title, price_sek, location, lat, lon, posted_at, url, image_urls)`.
  Filter by distance: keep listings within `max_km` (default 25) of Stockholm T-Centralen
  (59.3313, 18.0598), or with location text naming a Stockholm-area town.
- `sources/tradera.py`: SOAP via zeep. Use the SearchService (Search/SearchAdvanced) for active
  items, and SearchAdvanced with `ItemStatus` for ended/sold comps. **Fetch each service WSDL
  first and adapt to the real signatures and ItemStatus values.** Needs `TRADERA_APP_ID` and
  `TRADERA_APP_KEY` from `.env`. Without them, skip Tradera and log it once.
- **Do not scrape tradera.com/search** (robots.txt). Use the API only.

### 3. Catalog (`catalog.yaml`), seeded by the builder
Start with about 10 cheap, portable, fast-selling models under ~800 SEK, mostly Nintendo Switch
games and accessories plus a few retail LEGO sets. Each entry has: `name`, `queries`
(Swedish/English search terms), `must` (regex), `exclude` (e.g. `switch 2`, `endast kartong`,
`fodral`, `tomt`), `fair_sek` (a seed value marked `unverified: true`), `min_profit_sek`
(default 100). Example: BotW original, `exclude: ["switch 2"]`, fair_sek 399 (verified sold
median 2026-09-27).

### 4. Pricing (`pricing.py`)
Use the first source that's available:
1. Tradera sold comps from the API: median of the last 30 days after trimming the top and bottom
   10%, needing at least 5 samples, cached daily in SQLite.
2. Blocket asking-price median for the model × 0.85 (asking prices run higher than sold prices).
   Needs at least 8 samples.
3. The catalog's `fair_sek`.

Record which source was used on each deal and show it in alerts.

### 5. Scoring (`scorer.py`)
- `profit = fair − price − buy_shipping − tradera_sell_fee_pct×fair − sell_shipping_cost`
- Defaults: sell fee 10% and PostNord ~70 SEK, both marked "verify" in the config. Buyer pays
  shipping on the resale, so `sell_shipping_cost` = packaging, about 15 SEK.
- Flag a deal when `profit ≥ min_profit` **and** `price ≤ bankroll_available`.
- Swedish red-flag words (trasig, defekt, reservdelar, "som den är", byte/bytes, endast kartong,
  låst, spärrad, "läs beskrivning", kopia/fake) → skip.
- `price < 0.3×fair` → still alert, but tag it ⚠ suspicious. Never auto-buy these.

### 6. Money controls (config.yaml)
```yaml
mode: dry_run            # dry_run | live
bankroll_sek: 1000       # total; available = bankroll − cost of unsold stock + realized profit
auto_buy_max_sek: 300    # above this → approval required
max_open_flips: 3
daily_spend_cap_sek: 600
approval_timeout_min: 30 # no answer = skip
```
Kill switch: a `STOP` file in the project dir, or an ntfy reply `stop`, pauses all buying.
`resume` undoes it.

### 7. Phone interaction via ntfy.sh (no server Ben has to expose)
- Two secret random topics in `.env`: `NTFY_ALERT_TOPIC` (bot → phone) and `NTFY_REPLY_TOPIC`
  (phone → bot). If they're missing, generate them on first run and print the subscribe
  instructions.
- Approval alerts carry ntfy **http action buttons** that POST `approve <flip_id>` or
  `skip <flip_id>` to `ntfy.sh/<reply topic>`. The bot subscribes to the reply topic (JSON stream
  or polling `?poll=1&since=`) and acts on it. This works from anywhere, with no port forwarding.
- Blocket alerts include the price, profit estimate, pricing source, distance, the listing link,
  and a copy-ready Swedish message, e.g. "Hej! Är den kvar? Jag kan hämta idag och swisha
  direkt. Skulle du ta X kr?" X is an offer about 10% below asking when the margin allows. Add a
  "Bought it" action button (`bought <id> <price>`) so Ben logs the purchase with one tap.
- Other replies the bot understands: `arrived <id>`, `shipped <id>`, `status`, `stop`, `resume`.

### 8. Tradera buy and sell (live mode)
- Buying: use the BuyerService (Buy for Buy-Now items, Bid capped at `fair − min_profit − fees`
  for auctions, placed near the end). This needs a **user token**: implement Tradera's
  token/consent flow as `flip auth`, and put the one-time browser consent step in `SETUP.md`.
  If there's no token, route Tradera deals as alerts like Blocket ones.
- Selling: once an item is `arrived`, create a fixed-price (Buy Now) listing through the
  RestrictedService: an auto-written Swedish title and description, the condition, and the price
  set to the comp median.
  - Photos: Ben drops them into `inbox/<flip_id>/`. The bot watches that folder, and once photos
    exist it lists automatically. **Never reuse the original seller's photos.**
- Repricing: every 3 days unsold, drop 5%, but never below `cost + min_profit/2`. After 21 days,
  notify Ben to decide.
- Sold: poll orders. Notify "Sold X for Y — ship to <address>". An ntfy `shipped` reply closes
  the flip and books the profit.

### 9. CLI (`flip`)
`flip run` (loop), `flip once`, `flip auth`, `flip status` (open flips, bankroll, realized P&L),
`flip catalog check` (prints current comps next to seed prices), `flip arrived|shipped <id>`.
Put a systemd `--user` unit file plus install instructions in `SETUP.md`. Don't install it
automatically.

### 10. Tests (offline, no live calls)
- Save 2 real Blocket search pages (1 request each) as fixtures and test the parser.
- Test the matcher: the BotW original vs the Switch 2 Edition, and exclude words.
- Test the scorer math, red flags and the suspicious tag.
- Test the money controls: auto-buy threshold, bankroll cap, daily cap, max open flips, the STOP
  file.
- Parse replies from recorded ntfy JSON lines.
- Run the Tradera client against a stub transport (mock zeep responses).
- End-to-end dry run: `flip once` against the fixtures, which must produce the expected
  "[DRY RUN] would buy" and alert payloads, written to the log instead of sent.

### 11. Done when
- All tests pass.
- One live `flip once` against real Blocket (just a few requests) finds and scores real listings
  and sends a real ntfy alert. It can't subscribe for Ben, so it prints the topic.
- Tradera paths work with keys and skip cleanly without them.
- `SETUP.md` lists every step Ben has to do himself, in order: install the ntfy app and subscribe;
  register a Tradera developer app → put the keys in `.env`; run `flip auth`; enable the systemd
  unit; review `catalog.yaml`; set `mode: live`.
- README covers what it does, the state machine and the money controls. Commit, and log it in
  `TODO_FIRST.md` Done and in `IDEAS.md` #38.

### 12. Honest caveats to keep in the README
- Sweden may treat systematic reselling as a business (Skatteverket), and Ben is on a student
  permit. Check this before scaling past a few flips.
- Tradera's fees and API capabilities (especially buying) are unverified until there's a key.
- Expected profit is 100–400 SEK per flip, so this is a learning run.

---
