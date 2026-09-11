import os

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("ODDS_API_KEY")

DEFAULT_LEAGUES = [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_germany_bundesliga",
    "soccer_italy_serie_a",
    "soccer_uefa_champs_league",
]
DEFAULT_REGIONS = "uk,eu"
DEFAULT_MARKET = "h2h"
DEFAULT_BANKROLL = 100.0
DEFAULT_MIN_MARGIN = 0.0

# Betting exchanges charge commission on net winnings, unlike fixed-odds
# bookmakers. Keyed by the Odds API's bookmaker `key` field (visible in
# --debug output or the API docs), not the display title. These are typical
# published base rates as of writing — actual rates vary by exchange tier/
# volume and change over time, so verify against your own account before
# relying on them. Bookmakers not listed here are treated as zero-commission.
EXCHANGE_COMMISSIONS = {
    "betfair_ex_uk": 0.02,
    "betfair_ex_eu": 0.02,
    "smarkets": 0.02,
    "matchbook": 0.015,
}

LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "scanner.log")
