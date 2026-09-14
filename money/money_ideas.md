# Money-Making Program Ideas

A working list of programs/tools worth considering, beyond what's already built.
Grouped by category, with a note on why each could work and what the real risk
or difficulty is — not just the pitch.

## Already built
- **`sports-arb-scanner/`** — cross-book soccer odds arbitrage scanner. Works,
  but hard to capitalize on without accounts/banking in the right countries.
- **`alpaca-paper-trader/`** — SMA-crossover paper trading bot on Alpaca,
  running on a schedule. Track record still TBD.
- **`stream-clipper/`** — automated highlight-clip pipeline: finds ~15s
  moments in YouTube/Twitch VODs (chat-spike + audio-energy + transcript
  scoring), renders vertical clips with burned-in captions, posts to YouTube
  Shorts once a human approves them (Instagram Reels needs a one-time Meta
  app-review process first — not yet cleared). The real risk here isn't
  technical, it's legal/ToS: reposting someone else's stream footage without
  permission risks DMCA strikes against the posting account, so this is only
  as durable as whichever source channels it's pointed at have actually
  agreed to being clipped.

---

## Scan-and-alert tools
The pattern that's worked best so far: mechanical rules over a data feed,
alert on a mispricing or opportunity, no prediction involved.

- **Marketplace flip bot** — scan Facebook Marketplace/Craigslist/eBay for
  listings priced well under typical resale value in a category you know
  (electronics, tools, instruments, etc.), alert you to underpriced finds.
  No banking/geography issue like sports betting had. Main risk: these sites'
  ToS often restrict scraping — keep it low-volume/personal-use rather than
  a commercial scraping operation.
- **Domain expiry/drop sniper** — watch expiring or newly-dropped domains
  matching patterns you define (short, brandable, keyword-relevant), flag
  ones worth registering before they're gone.
- **Crypto exchange arbitrage** — same mechanic as the sports scanner, but
  crypto exchanges have public APIs and don't typically require a
  country-specific bank account tied to the exchange itself. Caveat:
  transfer times/fees between exchanges often eat the edge — the real
  engineering problem is speed and capital pre-positioning, not detection.
- **Flight/hotel price-drop tracker** — watch specific routes/dates, alert
  on price drops or rebooking opportunities (airline price-drop refund
  policies exist for some fare classes).
- **Restock/price-drop alert bot** — watch specific product pages for
  back-in-stock or price drops (e.g. hard-to-find hardware). Keep this to
  *alerting*, not auto-purchasing — automated purchasing bots for
  limited-drop items (sneakers, event tickets, etc.) are legally restricted
  in many places (e.g. the US BOTS Act for tickets) and against most
  retailers' ToS. Not recommending building an actual purchase-automation
  bot for this reason.

## Finance-adjacent (complementing what's built)
- **Portfolio dashboard / rebalancer** — import Fidelity holdings, show real
  diversification/correlation, tell you exactly what to buy/sell to hit
  target allocations.
- **DCF/valuation calculator** — plug in your own growth/discount
  assumptions, sanity-check a stock's price against your own model instead
  of trusting a headline "fair value."
- **Dividend/ex-dividend calendar** — alerts ahead of ex-div dates and
  earnings for a watchlist.
- **Tax-loss harvesting scanner** — flags unrealized losses worth harvesting
  before year-end, respecting wash-sale rules.
- **DeFi yield aggregator** — scans staking/lending rates across protocols
  for the best risk-adjusted yield. Real risk: smart contract/protocol risk
  is not something a scanner can price in — this is a research tool, not a
  safety guarantee.

## Content & media (ad/affiliate revenue)
- **Niche newsletter pipeline** — auto-aggregates and summarizes news/data
  for a topic you actually know well, publishes on a schedule. Works best
  when you'd curate it well yourself — generic AI content in a crowded
  niche doesn't rank or retain readers.
- **SEO content site** — slower payoff, compounds over time; success hinges
  entirely on picking a niche with real search demand and low competition,
  which is a research problem, not a coding one.
- **Local business directory/review aggregator** — ad revenue via local SEO
  in an underserved geographic/category niche.

## SaaS / productized tools
- **Sell a cleaned-up version of the arb scanner** — package it for other
  sports bettors as a subscription, rather than only running it yourself.
- **Sell the trading bot's screening logic** — a hosted version of the
  universe-scanning/signal logic as a screener tool for other retail
  investors.
- **A browser extension solving one of your own recurring annoyances** —
  historically the best-performing category for solo devs, because you
  dogfood it and actually finish it.
- **An API wrapper/utility with a free + paid tier** — solves one tedious
  developer problem well.

## Developer tools / open-source adjacent
- **A Claude Code plugin or MCP server** for a specific integration —
  you're already deep in this tooling, natural fit; sell it or take
  donations/sponsorship.
- **An open-core CLI tool** — free core, paid hosted/pro tier.
- **Starter kits/templates** sold on a marketplace (SaaS boilerplate,
  design system, etc.).

## Freelance/gig automation
- **Freelance job-board scanner** — watches Upwork-style boards for gigs
  matching your actual skills, drafts a tailored proposal for you to review
  and send. Keeps you in the loop for the actual pitch, automates the
  tedious scanning part.
- **Invoice/proposal generator** — small SaaS for freelancers, low
  complexity, real recurring pain point.

## E-commerce / physical goods
- **Dropshipping trend scanner** — find trending, low-competition products
  worth listing. Caveat: this market is heavily saturated and margins are
  thin; the scanner is the easy part, sourcing/logistics is the hard part.
- **Print-on-demand design automation** — generate and list designs
  programmatically for a niche audience. Needs real creative
  differentiation to not get lost in a flooded marketplace.

## Real estate / local data
- **Undervalued-listing scanner** — flag below-market rental/sale listings
  using public real estate data. Useful research tool; actually acting on
  a lead (financing, inspection, closing) is still entirely manual and
  capital-intensive.

## Games / interactive
- **Browser puzzle or idle game** monetized via ads — low art requirements,
  code-heavy, fits a solo dev; slow/uncertain payoff, crowded space.

---

## Honest take
The strongest pattern across everything that's worked in this conversation
so far is **mechanical scan-and-alert on a niche you already understand** —
the arb scanner and the marketplace flip bot both fit this shape, and it
avoids the two failure modes that killed the earlier ideas: needing to beat
an efficient market (stocks/sports prediction) and needing infrastructure
you don't have (banking in the right country). The **marketplace flip bot**
is probably the best next build if you want another concrete project —
no legal/banking complications, and individual sellers routinely misprice
things in a way that regulated markets don't allow.
