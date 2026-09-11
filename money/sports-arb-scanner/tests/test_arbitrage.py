import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from arbitrage import (
    OutcomeOdds,
    best_odds_per_outcome,
    calculate_stakes,
    detect_arbitrage,
    implied_probability,
)


def make_event(home_price, draw_price, away_price, home_book="A", draw_book="B", away_book="C"):
    return {
        "id": "evt1",
        "home_team": "Home FC",
        "away_team": "Away FC",
        "commence_time": "2026-09-14T15:00:00Z",
        "bookmakers": [
            {
                "key": home_book.lower(),
                "title": home_book,
                "markets": [
                    {
                        "key": "h2h",
                        "outcomes": [
                            {"name": "Home FC", "price": home_price},
                        ],
                    }
                ],
            },
            {
                "key": draw_book.lower(),
                "title": draw_book,
                "markets": [
                    {
                        "key": "h2h",
                        "outcomes": [
                            {"name": "Draw", "price": draw_price},
                        ],
                    }
                ],
            },
            {
                "key": away_book.lower(),
                "title": away_book,
                "markets": [
                    {
                        "key": "h2h",
                        "outcomes": [
                            {"name": "Away FC", "price": away_price},
                        ],
                    }
                ],
            },
        ],
    }


def test_known_arbitrage_opportunity():
    best_odds = {
        "home": OutcomeOdds("home", "Home FC", 2.10, "Bookie A"),
        "draw": OutcomeOdds("draw", "Draw", 3.60, "Bookie B"),
        "away": OutcomeOdds("away", "Away FC", 4.20, "Bookie C"),
    }
    is_arb, profit_margin, total_implied = detect_arbitrage(best_odds)

    assert is_arb is True
    assert abs(profit_margin - 0.00793) < 1e-4
    assert abs(total_implied - 0.99207) < 1e-4

    stakes, payout = calculate_stakes(best_odds, 100.0, total_implied)
    assert abs(sum(stakes.values()) - 100.0) < 0.01

    # payout should be equal (within a cent) regardless of outcome
    payouts = {key: stakes[key] * best_odds[key].price for key in stakes}
    values = list(payouts.values())
    assert max(values) - min(values) < 0.01
    assert abs(payout - values[0]) < 0.01


def test_known_non_arbitrage():
    best_odds = {
        "home": OutcomeOdds("home", "Home FC", 1.90, "Bookie A"),
        "draw": OutcomeOdds("draw", "Draw", 3.40, "Bookie A"),
        "away": OutcomeOdds("away", "Away FC", 4.00, "Bookie A"),
    }
    is_arb, profit_margin, _ = detect_arbitrage(best_odds)

    assert is_arb is False
    assert profit_margin < 0


def test_best_odds_per_outcome_picks_highest_price():
    event = make_event(2.10, 3.60, 4.20)
    # add a worse-priced second bookmaker on the home outcome
    event["bookmakers"].append(
        {
            "key": "d",
            "title": "Bookie D",
            "markets": [
                {"key": "h2h", "outcomes": [{"name": "Home FC", "price": 1.80}]}
            ],
        }
    )

    best = best_odds_per_outcome(event)

    assert best is not None
    assert best["home"].price == 2.10
    assert best["home"].bookmaker == "A"
    assert best["draw"].price == 3.60
    assert best["away"].price == 4.20


def test_malformed_event_returns_none():
    event = {
        "id": "evt2",
        "home_team": "Home FC",
        "away_team": "Away FC",
        "commence_time": "2026-09-14T15:00:00Z",
        "bookmakers": [
            {
                "key": "a",
                "title": "Bookie A",
                "markets": [
                    {
                        "key": "h2h",
                        "outcomes": [{"name": "Home FC", "price": 2.10}],
                    }
                ],
            }
        ],
    }

    assert best_odds_per_outcome(event) is None


def test_implied_probability():
    assert abs(implied_probability(2.0) - 0.5) < 1e-9


def test_exchange_commission_reduces_effective_price_and_can_erase_arbitrage():
    # Raw prices alone look like an arb (implied sum < 1), but the exchange
    # leg's real edge shrinks once its 2% commission on winnings is applied.
    raw_only = {
        "home": OutcomeOdds("home", "Home FC", 2.66, "Smarkets", "smarkets", commission=0.0),
        "draw": OutcomeOdds("draw", "Draw", 3.75, "Betfair", "betfair_ex_uk", commission=0.0),
        "away": OutcomeOdds("away", "Away FC", 2.82, "Matchbook", "matchbook", commission=0.0),
    }
    is_arb_raw, margin_raw, _ = detect_arbitrage(raw_only)
    assert is_arb_raw is True

    with_commission = {
        "home": OutcomeOdds("home", "Home FC", 2.66, "Smarkets", "smarkets", commission=0.02),
        "draw": OutcomeOdds("draw", "Draw", 3.75, "Betfair", "betfair_ex_uk", commission=0.02),
        "away": OutcomeOdds("away", "Away FC", 2.82, "Matchbook", "matchbook", commission=0.015),
    }
    is_arb_net, margin_net, _ = detect_arbitrage(with_commission)

    # Commission strictly reduces effective odds, so the net margin must be
    # smaller than the raw margin (and in this case flips to a loss).
    assert margin_net < margin_raw
    assert is_arb_net is False


def test_effective_price_matches_manual_formula():
    o = OutcomeOdds("home", "Home FC", 3.0, "Betfair", "betfair_ex_uk", commission=0.05)
    # effective = 1 + (price - 1) * (1 - commission)
    assert abs(o.effective_price - (1 + 2.0 * 0.95)) < 1e-9
