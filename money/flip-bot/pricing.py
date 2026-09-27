"""Fair resale value: Tradera sold comps > Blocket asking median x0.85 > catalog seed."""
import statistics

ASKING_DISCOUNT = 0.85


def trimmed_median(values, trim=0.10):
    v = sorted(values)
    k = int(len(v) * trim)
    return statistics.median(v[k:len(v) - k] if len(v) - 2 * k > 0 else v)


def fair_value(model, sold_comps=(), asking_prices=()):
    """Returns (fair_sek, source)."""
    if len(sold_comps) >= 5:
        return round(trimmed_median(sold_comps)), f"tradera sold (n={len(sold_comps)})"
    # Drop outliers relative to the seed (bundles/collector editions/typos) before trusting asks,
    # and never let asking prices move fair value more than +50% above the seed.
    asking_prices = [p for p in asking_prices if 0.4 * model.fair_sek <= p <= 2.5 * model.fair_sek]
    if len(asking_prices) >= 8:
        fair = min(trimmed_median(asking_prices) * ASKING_DISCOUNT, 1.5 * model.fair_sek)
        return round(fair), f"blocket asking x0.85 (n={len(asking_prices)})"
    return model.fair_sek, "catalog seed" + (" (unverified)" if model.unverified else "")
