import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import downloader


def test_canonical_url_youtube():
    url = downloader._canonical_url("youtube", {"id": "abc123"})
    assert url == "https://www.youtube.com/watch?v=abc123"


def test_canonical_url_twitch_strips_v_prefix():
    # Regression test: yt-dlp's flat-playlist Twitch VOD IDs are "v"-prefixed
    # (e.g. "v2872697283"), but the real public URL takes the bare numeric ID
    # — confirmed live against twitch.tv/kaicenat, a "v"-prefixed URL 404s
    # via the wrong extractor path ("[twitch:stream] videos: videos does not
    # exist").
    url = downloader._canonical_url("twitch", {"id": "v2872697283"})
    assert url == "https://www.twitch.tv/videos/2872697283"


def test_canonical_url_twitch_no_v_prefix_passthrough():
    url = downloader._canonical_url("twitch", {"id": "2872697283"})
    assert url == "https://www.twitch.tv/videos/2872697283"


def test_canonical_url_falls_back_for_unknown_platform():
    url = downloader._canonical_url("kick", {"id": "xyz", "webpage_url": "https://kick.com/x/videos/xyz"})
    assert url == "https://kick.com/x/videos/xyz"
