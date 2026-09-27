# Marketplace Flip Bot — Plan

Status: planned 2026-09-27, not started. Canonical idea entry: `../money_ideas.md`
("Marketplace flip bot"), also `IDEAS.md` #38.

**Goal:** get a push notification within minutes when someone lists an item in
a category Ben knows for well under what it resells for, so he can buy it and
resell it for profit. This is an alerting tool for personal use only. It never
buys, messages sellers, or posts listings.

## Answer these first (they change the design)

1. **Which country/city?** This machine's clock is on CEST. If Ben is in
   Europe, Craigslist is nearly useless there and the right sources are local:
   Kleinanzeigen (DE), Marktplaats (NL), Leboncoin (FR), Wallapop (ES), Vinted
   (clothing, EU-wide), and Facebook Marketplace everywhere. In the US, use
   Craigslist, FB Marketplace, and OfferUp.
2. **Which 1–2 categories?** Pick ones Ben can judge condition in and actually
   resell: e.g. GPUs/consoles/phones (liquid, easy to price, lots of
   competition), or tools/instruments/camera lenses (less competition, but
   pricing needs more judgment). Start narrow. A handful of exact models is
   much easier than a whole category.
3. **How much time/cash?** Flipping needs capital tied up in inventory plus
   time for pickups. Set a max buy price per item (e.g. €300) as a config value.

## Architecture (same shape as `../sports-arb-scanner/`)

```
flip-bot/
  sources/        one module per marketplace -> normalized Listing(title, price,
                  url, location, posted_at, image_url, source)
  catalog.yaml    watched models: name, match keywords/regex, exclude words,
                  fair resale price (or "auto"), min profit, max buy
  matcher.py      listing title -> catalog model (keyword/regex first; fuzzy
                  scoring only if needed)
  pricing.py      fair-value estimate per model (see below)
  scorer.py       profit = fair_value - price - fees - shipping/travel;
                  flag red-flag words
  store.sqlite    seen listing IDs (dedupe) + price history per model
  notify.py       push alert (ntfy.sh: free, phone app, one HTTP POST)
  main.py         poll loop: each source every N min, with jitter
```

Python stdlib + `requests` + `beautifulsoup4`, matching the other money/ tools.
Store no credentials. Only read public search pages that need no login.

## Pricing: the hard part

- **MVP: set fair value by hand in `catalog.yaml`.** Ben looks up recent sold
  prices once per model (eBay "Sold items" filter) and types in a number. This
  is honest, it's quick for ~10 models, and it skips the hardest subproblem.
- **v2: automatic comps.** Take the median of eBay *sold* listings from the
  last 30 days per model, cached daily, dropping the top and bottom 10%. The
  eBay Browse API only shows active listings; sold data needs the Marketplace
  Insights API (restricted access) or light scraping of the sold-search page.
  Decide on this when v2 comes around.
- **v2 alternative:** keep a running median of listings the bot itself has
  seen per model. It's free and needs no eBay, but it tracks *asking* prices,
  which run higher than sold prices, so discount it by ~15%.

## Scoring and filtering

- Alert when `fair_value − price − fees ≥ min_profit` **and** `price ≤ max_buy`.
- Fees: the resale platform's cut (eBay ~13%) plus shipping, or €0 for
  local-pickup resale. Set these per model.
- Red-flag words cut the score or mark the alert: "defekt/broken/for parts/
  iCloud locked/read description/box only/tausch/swap". Handle multiple
  languages if the sources are in the EU.
- A price that's *too* good (under 30% of fair value) is more likely a scam or
  a typo than a deal. Still alert on it, but tag it "⚠ suspicious".
- Alert includes: title, price, estimated profit, distance/location, link,
  image, and how old the listing is (speed matters most, since good deals go
  in minutes).

## ToS and scraping stance

- Keep volume low: one search page per source per model every 3–5 min with
  jitter, a normal User-Agent, and backoff on 403/429.
- **Facebook Marketplace** needs login and actively fights automation. Leave it
  out of the MVP. If it's needed later, the realistic route is its saved-search
  email/push alerts fed into this bot, not scraping.
- Check each site's robots.txt and whether it has an official API or RSS feed
  before writing a scraper (e.g. Kleinanzeigen and Marktplaats pages; check
  whether Craigslist RSS still works).

## MVP: one session

1. One source (the easiest scrapable site where Ben lives).
2. `catalog.yaml` with 3–5 models and hand-set fair values.
3. Keyword matcher, profit scorer, red-flag list.
4. SQLite dedupe + ntfy.sh push.
5. `main.py --once` for testing and a loop mode. Tests: save 2–3 real search
   pages as fixtures and unit-test the parser, matcher, and scorer offline.
   Don't hit live sites in tests.

**Done when:** it runs for an hour against a live source, sends ≥1 real alert
to Ben's phone, and never sends the same listing twice.

## Later

- A second source; auto-comps (above); per-model price-history chart.
- Distance filter (geocode listing town → km from home).
- Track actual results: log what Ben bought, paid, and sold for, so the tool
  shows whether it's making money. That's the whole point, per
  `../money_ideas.md`.
