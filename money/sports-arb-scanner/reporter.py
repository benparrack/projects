"""Formats ArbitrageOpportunity objects into human-readable log output."""

import logging

from arbitrage import ArbitrageOpportunity, OUTCOME_KEYS

OUTCOME_LABELS = {"home": "Home Win", "draw": "Draw", "away": "Away Win"}
BOOKMAKER_COL_WIDTH = 22


def _fit(name: str, width: int = BOOKMAKER_COL_WIDTH) -> str:
    """Truncate long bookmaker names so columns never collide, regardless
    of how long a name The Odds API returns."""
    if len(name) >= width:
        return name[: width - 2] + "… "
    return f"{name:<{width}}"


def format_opportunity(opp: ArbitrageOpportunity) -> str:
    lines = []
    lines.append("=" * 60)
    lines.append("ARBITRAGE OPPORTUNITY FOUND")
    lines.append("=" * 60)
    lines.append(f"League:        {opp.league_title} ({opp.league_key})")
    lines.append(f"Match:         {opp.home_team} vs {opp.away_team}")
    kickoff = opp.commence_time
    kickoff_str = kickoff.strftime("%Y-%m-%d %H:%M UTC") if kickoff else "unknown"
    lines.append(f"Kickoff:       {kickoff_str}")
    lines.append("-" * 60)
    lines.append(
        f"{'Outcome':<12}{'Bookmaker':<{BOOKMAKER_COL_WIDTH}}{'Odds':<9}{'Net Odds':<10}{'Implied Prob'}"
    )
    any_commission = any(o.commission > 0 for o in opp.best_odds.values())
    for key in OUTCOME_KEYS:
        o = opp.best_odds.get(key)
        if o is None:
            continue
        implied = 1.0 / o.effective_price
        net_odds = f"{o.effective_price:.2f}" if o.commission > 0 else "-"
        lines.append(
            f"{OUTCOME_LABELS[key]:<12}{_fit(o.bookmaker)}{o.price:<9.2f}{net_odds:<10}{implied * 100:.2f}%"
        )
    if any_commission:
        lines.append(
            "(Net Odds = odds after exchange commission; all math below uses net odds.)"
        )
    lines.append("-" * 60)
    lines.append(f"Total implied probability: {opp.total_implied_prob * 100:.2f}% (net of commission)")
    lines.append(f"Profit margin:              {opp.profit_margin * 100:.2f}% (net of commission)")
    lines.append("-" * 60)
    bankroll = sum(opp.stakes.values())
    lines.append(
        f"Suggested stakes for ${bankroll:.2f} bankroll "
        f"(guaranteed payout ${opp.guaranteed_payout:.2f}):"
    )
    for key in OUTCOME_KEYS:
        o = opp.best_odds.get(key)
        stake = opp.stakes.get(key)
        if o is None or stake is None:
            continue
        lines.append(f"  {OUTCOME_LABELS[key]:<10}-> ${stake:.2f} @ {o.bookmaker}")
    lines.append("=" * 60)
    return "\n".join(lines)


def report(opportunities: list, logger: logging.Logger) -> None:
    if not opportunities:
        logger.info("No arbitrage opportunities found in this scan.")
        return

    for opp in opportunities:
        logger.info("\n" + format_opportunity(opp))
