# Flip Bot — Progress

Resume here. The spec is `BUILD.md` and the verified findings are in `PLAN.md`.

## Done
- 2026-09-27: spec written (BUILD.md). Blocket and Tradera access verified (see PLAN.md).

## Notes
- Run tests: `.venv/bin/python -m unittest discover -s tests -t .` (from money/flip-bot)
- Matcher lives in `catalog.py` (not matcher.py); ambiguous titles matching >1 model are skipped.
- Catalog fair_sek seeds are guesses except BotW (399, verified).

## In progress / next
- [x] Scaffold: venv, requirements.txt, config.yaml, .env.example, .gitignore
- [x] sources/blocket.py + fixtures + parser test
- [x] catalog.yaml seed + matcher.py + tests
- [x] pricing.py, scorer.py + tests
- [ ] store.py (SQLite flips state machine), money controls + tests
- [ ] notify.py (ntfy alerts + reply subscription) + tests
- [ ] sources/tradera.py (zeep, WSDL-driven), `flip auth`, buy/list/reprice
- [ ] flip CLI, dry-run e2e, SETUP.md, README, systemd unit
