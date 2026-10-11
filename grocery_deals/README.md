# grocery-deals

This week's offers at your ICA, Willys and Hemköp stores, matched against a standing shopping list. A desktop
app shows the live deals at any time, and a weekly push to your phone every Monday morning names the best
store to go to. (`USEFULL_IDEAS.md` U1.)

## The app

**Grocery Deals** in the app menu (or run `./grocery-deals-app`). It starts a local server on
`127.0.0.1:5077` if one isn't already running, then opens it in a Chrome app window. The server exits on its
own after 2 h without use.

- **My list**: per list item, every matching offer across your stores, biggest saving first. The cards at the
  top show each store's total saving on your list; the best store is highlighted.
- **All deals**: every offer, searchable. Sort by kr or % off, filter by category or store, member prices
  on or off. Offers that are identical at two stores of one chain are shown once.
- **Trip**: press **+** on any deal to put it on this week's trip, grouped by store, with what you'll save.
  Add anything else (toilet paper, …) as free text. Tick things off as they go in the basket, then
  "Clear ticked". Saved in `trip.json`; entries whose offer has ended are flagged.
- **Edit**: shopping list, skip list and stores (search any ICA/Willys/Hemköp by name or area). Saves
  automatically to `settings.json`, which the weekly push reads too. Each line shows how many offers it
  matches as you type.
- **Price history**: every fetch records the week's offers in `history.db`. From the second week on, cards
  say whether a deal is actually good: "Best price in 6 wks", "Was 89 kr/kg in W39", "on offer 5 of 6 wks"
  (so you can skip deals that come back every other week). Prices compare per kg/st, so "2 för 40" = 20 kr/st.
  The Monday push refetches, so a week gets recorded even if you never open the app.
- **↻ Refresh** refetches from the stores. Otherwise offers are cached for 3 h in `cache/`.

Install the menu entry (`.desktop` files don't expand `~`):

    sed "s|%h|$HOME|g" grocery-deals.desktop > ~/.local/share/applications/grocery-deals.desktop

## Command line

    python3 grocery.py deals          # the text report the push sends
    python3 grocery.py browse [word]  # every offer at your stores
    python3 grocery.py stores kvantum # find store ids

Pushes go to `NTFY_ALERT_TOPIC` from `./.env`, else `../money/flip-bot/.env`.

## Weekly push (Mondays 08:00, or at next boot if the computer was off)

    ln -sf ~/projects/grocery_deals/grocery-deals.{service,timer} ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now grocery-deals.timer

## Matching

A list line matches when any `|`-alternative starts or ends a word in the offer's name or brand (this suits
Swedish compounds: `kyckling` finds Kycklingbröstfilé, `bröd` finds Lantbröd, `ris` does not find Krispiga).
`-word` excludes when it appears anywhere; put exclusions at the end of the line.

## Data sources

- **Willys / Hemköp** (both Axfood): the sites' public API, `/search/campaigns/offline?q=<storeId>`. The saving
  comes from the store's "Spara X kr" label; offers without one count 0.
- **ICA**: no API. Each store's page `ica.se/erbjudanden/<slug>/` embeds its offers as JS data
  (`weeklyOffers`); the store id *is* that slug (the URL needs the name part). The saving is computed:
  quantity × regular price − deal price. Store list: the JSON embedded in `ica.se/butiker/`.
- Member prices (ICA Stammis / Willys Plus / Hemköp Klubb, free to join) are tagged; untick "member prices"
  to hide them.
- Not supported: Coop (its offers API `external.api.coop.se/dke/offers/` returned empty lists 2026-10-11),
  Lidl.
- If a site changes its layout, that store's card shows the error and the others keep working.

Tests: `python3 tests/test_grocery.py`.
