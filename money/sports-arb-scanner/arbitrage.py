"""Pure arbitrage math — no network calls, fully unit-testable.

Betting exchanges (Betfair, Smarkets, Matchbook, ...) charge commission on
net winnings, unlike fixed-odds bookmakers. All math here works in terms of
each outcome's *effective* price — the quoted decimal odds adjusted for
commission — so that implied probabilities, margins, and stakes reflect real
money after commission rather than the raw quoted price.
"""

from dataclasses import dataclass
from datetime import datetime

OUTCOME_KEYS = ("home", "draw", "away")


@dataclass(frozen=True)
class OutcomeOdds:
    outcome: str  # "home" | "draw" | "away"
    label: str  # team name or "Draw"
    price: float  # raw quoted decimal odds
    bookmaker: str  # display name
    bookmaker_key: str = ""  # Odds API bookmaker key, used for commission lookup
    commission: float = 0.0  # fraction, e.g. 0.02 for 2%

    @property
    def effective_price(self) -> float:
        """Decimal odds adjusted for commission on net winnings."""
        if self.commission <= 0:
            return self.price
        return 1.0 + (self.price - 1.0) * (1.0 - self.commission)


@dataclass(frozen=True)
class ArbitrageOpportunity:
    event_id: str
    league_key: str
    league_title: str
    home_team: str
    away_team: str
    commence_time: datetime
    best_odds: dict  # outcome key -> OutcomeOdds
    total_implied_prob: float  # net of commission
    profit_margin: float  # net of commission
    stakes: dict  # outcome key -> float
    guaranteed_payout: float  # net of commission


def implied_probability(decimal_odds: float) -> float:
    return 1.0 / decimal_odds


def best_odds_per_outcome(event: dict, market_key: str = "h2h", commissions: dict = None):
    """Returns the best (highest effective, i.e. commission-adjusted) price
    per outcome across all bookmakers, or None if fewer than 3 outcomes
    (home/draw/away) have any price at all.

    `commissions` maps Odds API bookmaker key -> commission fraction (e.g.
    {"betfair_ex_uk": 0.02}). Bookmakers not in the map are treated as
    zero-commission fixed-odds books.
    """
    commissions = commissions or {}
    home_team = event.get("home_team")
    away_team = event.get("away_team")
    best: dict = {}

    for bookmaker in event.get("bookmakers", []):
        book_key = bookmaker.get("key", "")
        book_title = bookmaker.get("title", book_key or "unknown")
        commission = commissions.get(book_key, 0.0)
        market = next(
            (m for m in bookmaker.get("markets", []) if m.get("key") == market_key),
            None,
        )
        if market is None:
            continue

        for outcome in market.get("outcomes", []):
            name = outcome.get("name")
            price = outcome.get("price")
            if name is None or price is None:
                continue

            if name == home_team:
                key = "home"
            elif name == away_team:
                key = "away"
            elif name.lower() == "draw":
                key = "draw"
            else:
                continue

            candidate = OutcomeOdds(
                outcome=key,
                label=name,
                price=price,
                bookmaker=book_title,
                bookmaker_key=book_key,
                commission=commission,
            )
            current = best.get(key)
            if current is None or candidate.effective_price > current.effective_price:
                best[key] = candidate

    if len(best) < 3:
        return None
    return best


def detect_arbitrage(best_odds: dict):
    total_implied = sum(implied_probability(o.effective_price) for o in best_odds.values())
    is_arbitrage = total_implied < 1.0
    profit_margin = 1.0 - total_implied
    return is_arbitrage, profit_margin, total_implied


def calculate_stakes(best_odds: dict, bankroll: float, total_implied: float | None = None):
    if total_implied is None:
        total_implied = sum(implied_probability(o.effective_price) for o in best_odds.values())

    stakes = {
        key: bankroll * implied_probability(o.effective_price) / total_implied
        for key, o in best_odds.items()
    }
    guaranteed_payout = bankroll / total_implied
    return stakes, guaranteed_payout


def analyze_event(
    event: dict,
    league_key: str,
    league_title: str,
    bankroll: float,
    commissions: dict = None,
):
    best_odds = best_odds_per_outcome(event, commissions=commissions)
    if best_odds is None:
        return None

    is_arb, profit_margin, total_implied = detect_arbitrage(best_odds)
    if not is_arb:
        return None

    stakes, guaranteed_payout = calculate_stakes(best_odds, bankroll, total_implied)

    commence_time = event.get("commence_time")
    if isinstance(commence_time, str):
        commence_time = datetime.fromisoformat(commence_time.replace("Z", "+00:00"))

    return ArbitrageOpportunity(
        event_id=event.get("id", ""),
        league_key=league_key,
        league_title=league_title,
        home_team=event.get("home_team", ""),
        away_team=event.get("away_team", ""),
        commence_time=commence_time,
        best_odds=best_odds,
        total_implied_prob=total_implied,
        profit_margin=profit_margin,
        stakes=stakes,
        guaranteed_payout=guaranteed_payout,
    )
