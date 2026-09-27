"""API-equivalent pricing per model.

Rates are USD per million tokens, first-party Claude API list prices (from the
claude-api reference, cached 2026-06-24). Cache writes use the standard
multipliers (1.25x input for the 5-minute TTL, 2x for the 1-hour TTL); cache
reads are 0.1x input except where a model has its own discounted read rate.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Rate:
    input: float
    output: float
    read_mult: float = 0.1

    @property
    def cache_read(self):
        return self.input * self.read_mult

    @property
    def cache_write_5m(self):
        return self.input * 1.25

    @property
    def cache_write_1h(self):
        return self.input * 2.0


RATES = {
    "claude-fable-5-1": Rate(10.0, 50.0, 0.025),
    "claude-mythos-5-1": Rate(10.0, 50.0, 0.025),
    "claude-fable-5": Rate(10.0, 50.0),
    "claude-mythos-5": Rate(10.0, 50.0),
    "claude-opus-5-5": Rate(4.0, 20.0, 0.05),
    "claude-opus-5": Rate(5.0, 25.0),
    "claude-opus-4-8": Rate(5.0, 25.0),
    "claude-opus-4-7": Rate(5.0, 25.0),
    "claude-opus-4-6": Rate(5.0, 25.0),
    "claude-opus-4-5": Rate(5.0, 25.0),
    "claude-sonnet-5": Rate(2.0, 10.0),
    "claude-sonnet-4-6": Rate(3.0, 15.0),
    "claude-sonnet-4-5": Rate(3.0, 15.0),
    "claude-haiku-4-5": Rate(1.0, 5.0),
}

# Fallbacks by family for model ids not in the table (older snapshots, new releases).
FAMILY_FALLBACK = [
    ("fable", RATES["claude-fable-5"]),
    ("mythos", RATES["claude-mythos-5"]),
    ("opus", RATES["claude-opus-5"]),
    ("sonnet", RATES["claude-sonnet-5"]),
    ("haiku", RATES["claude-haiku-4-5"]),
]

ZERO = Rate(0.0, 0.0)


def rate_for(model):
    if not model or model == "<synthetic>":
        return ZERO
    if model in RATES:
        return RATES[model]
    base = re.sub(r"-\d{8}$", "", model)
    if base in RATES:
        return RATES[base]
    for key, rate in FAMILY_FALLBACK:
        if key in model:
            return rate
    return RATES["claude-sonnet-5"]


def cost_parts(model, inp, cw5, cw1, cr, out, speed=None):
    """Return (input, cache_write, cache_read, output) cost in USD."""
    r = rate_for(model)
    mult = 2.0 if speed == "fast" else 1.0
    m = 1e-6 * mult
    return (
        inp * r.input * m,
        (cw5 * r.cache_write_5m + cw1 * r.cache_write_1h) * m,
        cr * r.cache_read * m,
        out * r.output * m,
    )


def read_price_per_token(model):
    return rate_for(model).cache_read * 1e-6


def write_price_per_token(model, one_hour=True):
    r = rate_for(model)
    return (r.cache_write_1h if one_hour else r.cache_write_5m) * 1e-6
