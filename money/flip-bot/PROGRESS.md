# Flip Bot — Progress

Resume here. The spec is `BUILD.md` and the verified findings are in `PLAN.md`.

## Done
- 2026-09-27: spec written (BUILD.md). Blocket and Tradera access verified (see PLAN.md).

## In progress / next
- [ ] Scaffold: venv, requirements.txt, config.yaml, .env.example, .gitignore
- [ ] sources/blocket.py + fixtures + parser test
- [ ] catalog.yaml seed + matcher.py + tests
- [ ] pricing.py, scorer.py + tests
- [ ] store.py (SQLite flips state machine), money controls + tests
- [ ] notify.py (ntfy alerts + reply subscription) + tests
- [ ] sources/tradera.py (zeep, WSDL-driven), `flip auth`, buy/list/reprice
- [ ] flip CLI, dry-run e2e, SETUP.md, README, systemd unit
