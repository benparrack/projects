import os

from dotenv import load_dotenv

load_dotenv()

ALPACA_API_KEY = os.getenv("ALPACA_API_KEY")
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY")
ALLOW_LIVE_TRADING = os.getenv("ALLOW_LIVE_TRADING", "false").strip().lower() == "true"

PAPER_BASE_URL = "https://paper-api.alpaca.markets"
LIVE_BASE_URL = "https://api.alpaca.markets"
DATA_BASE_URL = "https://data.alpaca.markets"
DEFAULT_DATA_FEED = "iex"  # free/paper accounts typically lack full SIP access
REQUEST_TIMEOUT = 15

# --- Strategy params (SMA(20)/SMA(50) golden/death cross) ---
SMA_SHORT_WINDOW = 20
SMA_LONG_WINDOW = 50
BARS_TIMEFRAME = "1Day"
BARS_LIMIT = 130  # sized with headroom above the ~105 actual bars/symbol BARS_LOOKBACK_DAYS produces
BARS_LOOKBACK_DAYS = 150  # calendar days back for the `start` param; ~140 calendar days per weekends,
# so this yields close to BARS_LIMIT (100) actual trading-day bars per symbol — keeping the two in sync
# matters because batch requests size their total `limit` as len(chunk) * BARS_LIMIT (see universe.py);
# if actual bars/symbol exceeds that assumption, symbols later in the batch get silently truncated.

# --- Universe params ---
UNIVERSE_SAMPLE_SIZE = 30
EXCHANGE_ALLOWLIST = ["NASDAQ", "NYSE", "ARCA"]
MIN_PRICE = 5.00
MIN_AVG_VOLUME = 500_000
LIQUIDITY_LOOKBACK_BARS = 20
MAX_CANDIDATES_EXAMINED = 4000  # safety ceiling on how many symbols one run will check before giving up
BARS_BATCH_SIZE = 50

# --- Position sizing / risk caps ---
NOTIONAL_PER_TRADE = 500.00
MAX_CONCURRENT_POSITIONS = 10  # implies a hard $5,000 max-deployed-capital cap at defaults

# --- Paths ---
STATE_FILE = "state.json"
LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "trader.log")
