import os

from dotenv import load_dotenv

load_dotenv()

# --- Platform credentials (all optional until that platform's feature is used) ---
YOUTUBE_CLIENT_SECRETS_FILE = os.getenv("YOUTUBE_CLIENT_SECRETS_FILE", "youtube_client_secret.json")
YOUTUBE_TOKEN_FILE = os.getenv("YOUTUBE_TOKEN_FILE", "youtube_token.json")

IG_APP_ID = os.getenv("IG_APP_ID")
IG_APP_SECRET = os.getenv("IG_APP_SECRET")
IG_USER_ID = os.getenv("IG_USER_ID")  # the Instagram Business account's IG user id
IG_ACCESS_TOKEN = os.getenv("IG_ACCESS_TOKEN")  # long-lived page/user token with content-publish scope

TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID")  # only needed if hitting the official Helix API (not the chat-replay path)

# --- The single most important safety rail: posting requires BOTH of these ---
# (checked twice in code, same double-gate pattern as alpaca-paper-trader's
# ALLOW_LIVE_TRADING) so no single flag or env var flip alone can post publicly.
ALLOW_AUTO_POST = os.getenv("ALLOW_AUTO_POST", "false").strip().lower() == "true"

# --- Sources to pull VODs from. Fill in with channels you have the right to
# clip (your own content, or a channel that has explicitly OK'd clipping) ---
# Each entry: {"platform": "youtube"|"twitch", "channel_url": "..."}
#
# NOTE: Kai Cenat and Speed have not given any known general clipping
# permission — see this project's README Disclaimer. Ben chose to point this
# at them anyway (2026-09-14), fully aware of the DMCA/strike risk against
# the posting account; nothing here should be read as implying they've
# consented.
SOURCE_CHANNELS = [
    {"platform": "twitch", "channel_url": "https://www.twitch.tv/kaicenat/videos"},
    {"platform": "youtube", "channel_url": "https://www.youtube.com/@KaiCenatLive/videos"},
    {"platform": "twitch", "channel_url": "https://www.twitch.tv/ishowspeed/videos"},
    {"platform": "youtube", "channel_url": "https://www.youtube.com/@IShowSpeed/videos"},
]

REQUEST_TIMEOUT = 15

# --- Highlight scoring ---
BIN_SECONDS = 5.0  # width of each scoring bucket along the VOD timeline
WINDOW_SECONDS = 15.0  # target clip length
MIN_GAP_SECONDS = 30.0  # minimum spacing between two selected windows in one VOD
TOP_N_CLIPS_PER_VOD = 5
SPIKE_MIN_ZSCORE = 1.5  # how many std-devs above the mean counts as a "spike" bin
SIGNAL_WEIGHTS = {
    "chat": 1.0,
    "audio": 1.0,
    "transcript": 0.5,
}
SNAP_MAX_SHIFT_SECONDS = 3.0  # how far a window edge may move to land on a clean sentence boundary

# --- Whisper transcription ---
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

# --- Clip rendering ---
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
TARGET_ASPECT = (9, 16)

# --- Posting caps (per platform, enforced via state.py) ---
MAX_POSTS_PER_DAY = {
    "youtube": 3,
    "instagram": 3,
}
MIN_SECONDS_BETWEEN_POSTS = {
    "youtube": 4 * 3600,
    "instagram": 4 * 3600,
}

# --- Paths ---
STAGING_DIR = "staging"
STATE_FILE = "state.json"
LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "clipper.log")
WORK_DIR = "work"  # scratch space for downloaded source video/audio, gitignored
