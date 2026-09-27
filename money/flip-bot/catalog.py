"""Catalog of watched models and title matching."""
import re
from dataclasses import dataclass, field

import yaml


@dataclass
class Model:
    name: str
    queries: list
    must: str
    exclude: list = field(default_factory=list)
    fair_sek: int = 0
    unverified: bool = True
    min_profit_sek: int | None = None

    def matches(self, title: str) -> bool:
        t = title.lower()
        if not re.search(self.must, t):
            return False
        return not any(x.lower() in t for x in self.exclude)


def load(path="catalog.yaml") -> list[Model]:
    with open(path, encoding="utf-8") as f:
        return [Model(**m) for m in yaml.safe_load(f)["models"]]


def match(title: str, models: list[Model]) -> Model | None:
    hits = [m for m in models if m.matches(title)]
    return hits[0] if len(hits) == 1 else None  # ambiguous titles (bundles) are skipped
