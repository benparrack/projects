# Flip Bot — Progress

Resume here. The spec is `BUILD.md`, the verified findings are in `PLAN.md`, and usage is in
`README.md`/`SETUP.md`.
Tests: `.venv/bin/python -m unittest discover -s tests -t .` (26 passing, 2026-09-27).

## Status: feature-complete, runs in dry_run. Blocked on Ben's setup (SETUP.md steps 1–3).
Built in session 1 (2026-09-27): Blocket source, catalog/matcher, pricing, scorer, SQLite
store and money controls, ntfy alerts/replies, Tradera SOAP client (vendored WSDLs in
`sources/wsdl/`), auto-buy/approval routing, sell loop (list from inbox photos, reprice,
order poll), `flip auth`, `flip catalog check`, SETUP.md, README, `flipbot.service`. Live
Blocket smoke test passed. A live Tradera call with fake keys reaches the server and fails
only on "Invalid application key", so the envelope is valid.

## Verified from Tradera's docs (session 1, no keys needed)
Sources: `https://api.tradera.com/v4/swagger/v4/swagger.json` and
`https://api.tradera.com/v3/api/docs/<Service>/<Operation>` (JSON).
- ItemType 1 = auction, 3 = fixed price. AcceptedBidderId 1 = Sweden. ImageFormat Gif/Jpeg/Png.
- BuyStatus enum: Bought (the only success), Ended, NotAllowed, PriceChanged,
  BuyItNowNoLongerAvailable, … `Buy` = purchase only, never bids, so auction sniping is dropped.
- Restricted/new sellers may only list plain auctions of at least 7 days. Handled with an auction
  fallback (`list_kind` column).
- A **v4 REST/JSON API (beta)** exists with the same features: header auth `X-App-Id`,
  `X-App-Key`, `X-User-Id` (+ token), `POST /v4/search/advanced`, `/v4/buyer/buy`,
  `/v4/listings/items`, `PUT /v4/listings/items/{id}/price`, `GET /v4/orders`,
  `POST /v4/auth/token`. If the v3 SOAP calls give trouble, switching `sources/tradera.py`
  to v4 is a contained change.
- The token login URL `tokenlogin.aspx` now redirects to `/token-login`. Update
  `TOKEN_LOGIN_URL` if the old one breaks.

## Next session (once Ben has Tradera keys in .env)
- [ ] `flip catalog check`: confirm the `ItemStatus` strings ("Active"/"Ended" are assumed in
      `sources/tradera.py::_search`) and fix the catalog seeds.
- [ ] `flip auth`: confirm the token-login URL format (`TOKEN_LOGIN_URL`) and that the
      FetchToken result fields are `AuthToken`/`HardExpirationTime`.
- [ ] One real Buy-Now purchase of something cheap in live mode.
- [ ] One real listing (fixed price, or the auction fallback on a new account): the required
      AddItem shipping/payment fields (`PaymentOptionIds`, a real `ShippingOptionId`/provider
      via PublicService.GetShippingOptions).
- [ ] `poll_orders`: check the real GetSellerOrders response shape.

## Later ideas
- More catalog categories (LEGO via BrickLink comps), a P&L page, auto-relisting after 21 days.
