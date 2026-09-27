# Marketplace Flip Bot — Plan

Status: planned 2026-09-27, not started. Canonical idea entry: `../money_ideas.md`
("Marketplace flip bot"), also `IDEAS.md` #38.

**Goal:** get a push notification within minutes when someone lists an item in
a category Ben knows for well under what it resells for, so he can buy it and
resell it for profit. This is an alerting tool for personal use only. It never
buys, messages sellers, or posts listings.

## Decisions (2026-09-27)

- **Where:** Stockholm, Sweden. Ben is studying abroad there for about 3 more
  months, until roughly the end of December 2026. The whole buy → resell loop
  has to finish in Stockholm before he leaves, so no slow-moving stock and
  nothing bulky he can't carry on the T-bana.
- **Budget:** about $100, roughly 1,000 SEK in total. That covers one or two
  items at a time. Set `max_buy` around 800 SEK. Realistic profit is about
  100–400 SEK per flip, so this is a learning run worth maybe a few hundred
  dollars, not real income yet. It gets his first profitable flips done, and
  the pipeline can be reused at home.
- **Categories:** Ben doesn't have strong ones yet and is willing to research.
  Pick **cheap, fast-selling, easy-to-check, portable** items. Candidates:
  Nintendo Switch games and accessories (Pro controllers, Joy-Cons, docks),
  retail LEGO sets (BrickLink price guide gives free sold data), and older
  AirPods/Kindles (watch for fakes). Choose 5–10 exact models after checking
  sold prices.
- **Sources:**
  - **Blocket.se** is Sweden's main classifieds site and the source to scrape.
    It has no official public API, but its web frontend uses an internal JSON
    search API, and a community `blocket_api` Python package exists. Check at
    build time whether it still works without login.
  - **Tradera.com** is Sweden's eBay-style auction site. It has an **official
    developer API** (free registration, rate-limited) with *ended* auctions,
    so it can supply real sold-price comps. That solves the auto-pricing
    problem below, maybe as early as the MVP. It's also the easiest place to
    resell.
  - Facebook Marketplace stays out, as below.
- **Swedish red-flag words:** trasig/trasiga (broken), defekt, reservdelar (for
  parts), "säljes som den är" (sold as-is), byte/bytes (swap), endast kartong
  (box only), låst/spärrad (locked), "läs beskrivning" (read description).
- **Tax/visa note:** selling your own used stuff occasionally is fine in
  Sweden. Buying specifically to resell at a profit can count as business
  activity to Skatteverket, and the student residence permit may matter too.
  At a few flips over 3 months this is very unlikely to be an issue, but Ben
  should look it up before scaling.

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
