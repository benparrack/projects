# Flip Bot — Progress

Resume here. The spec is `BUILD.md`, the verified findings are in `PLAN.md`, and usage is in
`README.md`/`SETUP.md`.
Tests: `.venv/bin/python -m unittest discover -s tests -t .` (20 passing, 2026-09-27).

## Status: feature-complete, runs in dry_run. Blocked on Ben's setup (SETUP.md steps 1–3).
Built in session 1 (2026-09-27): Blocket source, catalog/matcher, pricing, scorer, SQLite
store and money controls, ntfy alerts/replies, Tradera SOAP client (vendored WSDLs in
`sources/wsdl/`), auto-buy/approval routing, sell loop (list from inbox photos, reprice,
order poll), `flip auth`, `flip catalog check`, SETUP.md, README, `flipbot.service`. Live
Blocket smoke test passed. A live Tradera call with fake keys reaches the server and fails
only on "Invalid application key", so the envelope is valid.

## Next session (once Ben has Tradera keys in .env)
- [ ] `flip catalog check`: confirm the `ItemStatus` strings ("Active"/"Ended" are assumed in
      `sources/tradera.py::_search`) and fix the catalog seeds.
- [ ] `flip auth`: confirm the token-login URL format (`TOKEN_LOGIN_URL`) and that the
      FetchToken result fields are `AuthToken`/`HardExpirationTime`.
- [ ] One real Buy-Now purchase of something cheap in live mode: check the BuyStatus strings
      (`execute_buy` treats "success"/"bought" as OK).
- [ ] One real listing: `fixed_price_item_type()` keyword match, and the required
      AddItem shipping/payment fields (`PaymentOptionIds`, a real `ShippingOptionId`/provider
      via PublicService.GetShippingOptions).
- [ ] `poll_orders`: check the real GetSellerOrders response shape.

## Later ideas
- Auction sniping (a bid scheduled just before EndDate, capped at fair − min profit − fees).
- More catalog categories (LEGO via BrickLink comps), a P&L page, auto-relisting after 21 days.
