# Flip Bot — Progress

Resume here. The spec is `BUILD.md` and the verified findings are in `PLAN.md`. Run everything from `money/flip-bot/`.
- Tests: `.venv/bin/python -m unittest discover -s tests -t .` (14 passing as of 2026-09-27)
- Live dry-run scan: `.venv/bin/python flip.py once` (about 11 Blocket requests). `flip.py status`.

## Done (2026-09-27, session 1)
- Scaffold: venv, requirements.txt, config.yaml (mode: dry_run), .env.example, .gitignore
- `sources/blocket.py`: parser plus a real-page fixture test
- `catalog.yaml` (9 Switch models) plus `catalog.py` matcher. There's no separate matcher.py.
  Titles matching more than one model are skipped as bundles. `GLOBAL_EXCLUDE` drops
  accessories/parts/merch, and `MIN_PRICE_SEK`=20 drops free/placeholder listings.
- `pricing.py`: Tradera comps (from the store cache) > Blocket asking ×0.85 > catalog seed.
  Asking prices outside 0.4–2.5× the seed are dropped, and the Blocket-based fair value is
  capped at 1.5× the seed.
- `scorer.py`: profit math, Swedish red flags, ⚠ suspicious under 0.3× fair
- `store.py`: SQLite (seen, flips state machine, comps cache) plus `can_spend` (STOP file,
  bankroll, max open, daily cap) and `needs_approval`
- `notify.py`: ntfy payloads with http reply buttons, `parse_command`, `poll_replies`
- `flip.py`: `Bot.scan_blocket` → Blocket alerts with a Swedish offer message and
  Bought/Skip buttons. `handle()` processes replies (bought/skip/approve/arrived/shipped/
  status/stop/resume). The `run` loop polls replies every 20 s between scans. On first run it
  generates the ntfy topics into `.env` (already done on Ben's machine; the topic is printed
  by `grep NTFY .env`).
- The live smoke test worked: it found real deals, and the first run exposed accessory and
  outlier problems, which are now fixed and covered by tests.

## Next (in order)
- [ ] `sources/tradera.py`: zeep client. Fetch the WSDLs (Search/Public/Restricted/Buyer/Order
      services) and adapt. Active search → `Listing(source="tradera")`, and sold comps →
      `store.save_comps` daily. Skip cleanly when there are no `TRADERA_APP_ID`/`KEY` values in `.env`.
- [ ] Tradera deal routing in `Bot`: `can_spend` → `needs_approval` ? ntfy Approve/Skip :
      auto-buy. In dry_run, only log "[DRY RUN] would buy". Expire approvals after
      `approval_timeout_min`. Without a user token → alert like Blocket.
- [ ] `flip auth` (Tradera user token/consent flow), BuyerService buy/bid
- [ ] Selling: watch `inbox/<id>/` photos → RestrictedService fixed-price listing (Swedish
      title/description), repricing every 3 days −5% down to a floor of cost+min_profit/2,
      notify after 21 days, poll orders → "sold, ship to …" → `shipped` closes the flip.
      `handle('shipped')` currently needs `sold_sek` set by that order poller.
- [ ] `flip catalog check` (comps next to seeds)
- [ ] Tests for the Tradera client with a stubbed transport
- [ ] SETUP.md (ntfy app subscribe, Tradera dev app keys, `flip auth`, systemd --user unit,
      review the catalog, set mode: live), README, `flipbot.service` file (don't install it)
- [ ] When done: log in TODO_FIRST.md Done and IDEAS.md #38
