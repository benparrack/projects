# Stream Clipper

Finds interesting ~15s moments in YouTube/Twitch VODs (chat spikes, audio
energy, transcript signal), renders them into vertical clips with burned-in
captions, and — once you've reviewed and approved them — posts to YouTube
Shorts and (after a one-time Meta app-review process) Instagram Reels.

**Disclaimer:** downloading VODs with `yt-dlp` technically violates
YouTube's/Twitch's ToS (risk: account suspension of whatever account does
the downloading, not legal action, for personal-scale use). Reposting
someone else's copyrighted stream footage without permission risks DMCA
strikes against **your posting account** — the durable, low-risk way to run
this is against your own content or channels that have explicitly said clips
are welcome (an official clip-and-earn program, a public clipping policy, or
just asking). This tool is source-agnostic and doesn't enforce that for you —
see `config.py`'s `SOURCE_CHANNELS`. Not legal advice.

## Setup

```bash
cd money/stream-clipper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Also needs a system `ffmpeg`/`ffprobe` install (not pip-installable):
`sudo apt install ffmpeg` (Debian/Ubuntu) or your distro's equivalent.

Edit `config.py`'s `SOURCE_CHANNELS` with the channel(s) you're actually
allowed to clip, e.g.:

```python
SOURCE_CHANNELS = [
    {"platform": "youtube", "channel_url": "https://www.youtube.com/@somechannel/videos"},
    {"platform": "twitch", "channel_url": "https://www.twitch.tv/somechannel/videos"},
]
```

### YouTube Shorts setup (needed before `main.py post` can post anywhere)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project, enable the **YouTube Data API v3**, and create an OAuth Client ID
   of type **Desktop app**.
2. Download its JSON and save it as `youtube_client_secret.json` in this
   directory (or point `YOUTUBE_CLIENT_SECRETS_FILE` in `.env` elsewhere).
3. First time you post, a browser window opens for one-time consent; the
   resulting token is cached to `youtube_token.json` and auto-refreshed after
   that. No further setup needed — no app review required for your own
   channel's uploads.

### Instagram Reels setup (one-time, Ben-only — needs your identity/business verification)

This can't be completed by an agent on your behalf; budget 2-4 weeks of
calendar time (not engineering time) for the review step, and it's worth
starting in parallel with everything else:

1. Convert your Instagram account to a **Business** account and link it to a
   **Facebook Page** (Instagram app -> Settings -> Account type).
2. Create an app at [developers.facebook.com](https://developers.facebook.com/),
   add the Instagram Graph API product.
3. Submit `instagram_business_basic` and `instagram_business_content_publish`
   for **App Review** — each needs a short screencast demonstrating the
   publish flow end-to-end.
4. Once approved, generate a long-lived access token for the Page/IG user and
   put `IG_USER_ID` + `IG_ACCESS_TOKEN` (+ `IG_APP_ID`/`IG_APP_SECRET`) in `.env`.
5. **One remaining gap this project doesn't solve for you**: Instagram's
   publish API needs a *publicly reachable HTTPS URL* for the clip, not a
   direct file upload — it fetches the video itself. You'll need to briefly
   host an approved clip somewhere reachable (any object store with signed
   URLs, or a tunnel to this machine) before calling
   `instagram_uploader.publish_reel(video_url, caption)`. `poster.py`
   currently raises a clear error here rather than guessing an approach,
   since it depends on what hosting you already have.

## How it works

1. **`main.py run`** — for each configured source, lists recent VODs, skips
   any already processed (`state.json`), and for each new one: downloads it,
   fetches its chat replay (`chat_client.py`, via the `chat-downloader`
   library — works for both platforms, no auth needed for public VODs),
   extracts an audio-loudness signal (`audio_signal.py`), transcribes it
   locally with `faster-whisper` (`transcribe.py`), scores every ~5s bucket
   of the VOD on a composite of chat-spike + audio-spike + transcript-density
   z-scores (`highlights.py`), picks the top few non-overlapping ~15s windows,
   snaps their edges to the nearest transcript sentence boundary so cuts
   land cleanly, and renders each to a vertical 9:16 clip with burned-in
   word-by-word captions (`clipper.py`). Output lands in
   `staging/<date>/pending/`, plus a `manifest.json` with each clip's
   metadata. **Nothing is posted at this stage.**
2. **Review** — look at what's in `staging/<date>/pending/`, and **move**
   (not copy) any clip you're happy with into `staging/<date>/approved/`.
   This is a deliberately plain filesystem convention rather than a UI —
   both because the highlight-detection heuristics haven't been proven
   reliable yet, and because posting someone's clipped content carries real
   legal/reputational weight that's worth a human glance first.
3. **`main.py post`** — walks every `approved/` clip, and for each of its
   `target_platforms` not yet posted, posts it — but only if **both**
   `--post` on the command line **and** `ALLOW_AUTO_POST=true` in `.env` are
   set (same double-gate pattern as this repo's `alpaca-paper-trader` uses
   for live trading). Without `--post`, it always dry-runs and just logs
   what it *would* post. Also respects `config.MAX_POSTS_PER_DAY` /
   `MIN_SECONDS_BETWEEN_POSTS` per platform so a burst of approvals doesn't
   all post at once and read as spam.

## Safety rails

- **Posting requires both `--post` and `ALLOW_AUTO_POST=true`** — checked
  twice (`main.py` refuses before even calling `poster.py` if only one is
  set).
- **Nothing posts without a human moving it to `approved/` first** — the
  pipeline never posts straight from `pending/`.
- **Idempotent**: a clip already posted to a platform (tracked in both
  `manifest.json` and `state.json`) is skipped on a re-run, not re-posted.
- **Daily caps + minimum spacing per platform**, enforced in `state.py`
  before every post attempt.
- **One bad VOD doesn't abort a whole run** — `pipeline.run_cycle` catches
  per-video errors and keeps going; a bad *source* (e.g. a dead channel URL)
  is logged and skipped too.

## Known limitations (v1)

- VOD-based only — doesn't clip a stream while it's still live.
- Vertical reframe is a static center crop, not face-tracking (a natural v2:
  see `IDEAS.md`/plan notes on MediaPipe-based dynamic crop).
- Highlight scoring is a heuristic, not a quality judgment — expect false
  positives (hype-chat over nothing, a loud noise breaking silence); this is
  exactly why the review-before-post gate exists.
- Instagram posting needs a hosting step for the video URL this project
  doesn't provide (see Setup above).

## CLI reference

```bash
# Check sources for new VODs, score, render clips to staging/. Never posts.
python main.py run

# Only check the 1 most recent video per source (faster first test)
python main.py run --limit-per-source 1

# Dry-run: log what WOULD post, without posting anything
python main.py post

# Actually post approved clips (also needs ALLOW_AUTO_POST=true in .env)
python main.py post --post

# Show config + staging/review counts. Read-only.
python main.py status
```

## Testing

```bash
pytest
```

Unit tests cover `highlights.py` (scoring/window-selection), `state.py`
(processed-video tracking, daily caps, spacing), `clipper.py` (ffmpeg command
construction), and `transcribe.py` (`.ass` caption building) — all pure
functions, no network, no real ffmpeg/whisper/yt-dlp invocation.

## Manual end-to-end verification

1. Point `config.SOURCE_CHANNELS` at one real, permitted source.
2. `python main.py run --limit-per-source 1` — confirms a real VOD produces
   clips in `staging/<date>/pending/` with correct 9:16 aspect ratio, clean
   cut points, and readable captions.
3. `python main.py post` (no `--post`) — confirms it refuses to post and
   only logs dry-run lines, proving the gate before trusting it live.
4. Move one clip to `staging/<date>/approved/`, set `ALLOW_AUTO_POST=true`,
   run `python main.py post --post` — confirms a real gated post completes
   and `python main.py status` reflects it.
