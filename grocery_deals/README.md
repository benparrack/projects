# grocery-deals

Matches this week's offers at your Willys and Hemköp stores against a standing shopping list, and pushes the
matches to your phone every Monday morning, with the best store to go to. (`USEFULL_IDEAS.md` U1.)

## Set up

1. Find your stores: `python3 grocery.py stores södermalm` (any part of a name, street or town). Paste the
   printed lines into `stores` in `list.toml`, replacing the two placeholders.
2. Edit `items` in `list.toml` to what you actually buy (the matching rules are explained there).
3. Check it: `python3 grocery.py deals`. To see everything on offer: `python3 grocery.py browse [word]`.
   This is also how you find good words for your list.

Pushes go to `NTFY_ALERT_TOPIC` from `./.env`, else `../money/flip-bot/.env`.

## Weekly push (Mondays 08:00, or at next boot if the computer was off)

    ln -sf ~/projects/grocery_deals/grocery-deals.{service,timer} ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now grocery-deals.timer

## Notes

- "Other good deals": the biggest "Spara X kr" offers not on your list (`extras` per store, minus `skip`).
- A second store of the same chain only lists offers the first one did not.
- Data: Willys/Hemköp's own public site API (`/search/campaigns/offline?q=<storeId>`), no key needed.
  Both are Axfood, so one code path serves both.
- `*` marks member prices (Willys Plus / Hemköp Klubb, free to join). Set `member = false` to hide them.
- "save" comes from the store's own "Spara X kr" label; offers without one are listed but count 0.
- Not yet supported: ICA, Coop, Lidl. Coop has an offers API (`external.api.coop.se/dke/offers/`) but it
  returned empty lists for store ids tried 2026-10-11; ICA and Lidl need reverse engineering.
- Tests: `python3 tests/test_grocery.py`.
