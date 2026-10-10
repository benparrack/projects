import os

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path=None):
    with open(path or os.path.join(ROOT, "config.yaml")) as f:
        cfg = yaml.safe_load(f)
    cfg["db_path"] = os.path.join(ROOT, cfg.get("db", "copytrader.sqlite"))
    env = {}
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v
    cfg["env"] = env
    return cfg
