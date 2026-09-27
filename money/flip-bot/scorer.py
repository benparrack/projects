"""Deal scoring: estimated profit after fees, red flags, suspicious-price tagging."""
from dataclasses import dataclass

RED_FLAGS = ["trasig", "defekt", "reservdel", "som den är", "byte", "bytes", "endast kartong",
             "bara kartong", "låst", "spärrad", "läs beskrivning", "kopia", "fake", "replika",
             "broken", "for parts", "drift", "söker", "köpes"]


@dataclass
class Deal:
    listing: object
    model: object
    fair_sek: int
    fair_source: str
    profit_sek: int
    suspicious: bool
    red_flag: str | None

    @property
    def actionable(self):
        return self.red_flag is None


def red_flag(text: str) -> str | None:
    t = f" {text.lower()} "
    return next((w for w in RED_FLAGS if f" {w}" in t), None)


def score(listing, model, fair_sek, fair_source, cfg) -> Deal:
    ship_in = cfg["buy_shipping_sek"] if listing.source == "tradera" else 0  # Blocket = pickup
    profit = (fair_sek - listing.price_sek - ship_in
              - cfg["tradera_sell_fee_pct"] * fair_sek - cfg["sell_packaging_sek"])
    return Deal(listing, model, fair_sek, fair_source, round(profit),
                suspicious=listing.price_sek < 0.3 * fair_sek,
                red_flag=red_flag(listing.title))


def is_deal(deal: Deal, cfg) -> bool:
    min_profit = deal.model.min_profit_sek or cfg["min_profit_sek"]
    return deal.actionable and deal.profit_sek >= min_profit
