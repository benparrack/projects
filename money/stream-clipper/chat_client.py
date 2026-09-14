"""Fetches chat-replay timestamps for a VOD, for both Twitch and YouTube,
via the `chat-downloader` library (github.com/xenova/chat-downloader) rather
than hand-rolling Twitch's undocumented GraphQL API directly — that API's
persisted-query hash is unversioned and known to rotate when Twitch updates
its web client, which `chat-downloader` tracks upstream so this project
doesn't have to. No auth needed for public VODs on either platform.

Not unit-tested (network) — see downloader.py's docstring for why.
"""

import config


class ChatFetchError(RuntimeError):
    pass


def fetch_message_timestamps(video_url: str, timeout: int = config.REQUEST_TIMEOUT) -> list:
    """Returns a list of message offsets, in seconds from the start of the
    VOD, for every chat message in the replay. Returns an empty list (not an
    error) if the VOD has no chat replay available — that's a normal case
    (e.g. chat replay disabled, or a plain YouTube upload with no live chat),
    and highlights.py already treats an empty chat signal as "no data" rather
    than "no highlights"."""
    from chat_downloader import ChatDownloader
    from chat_downloader.errors import ChatDownloaderError

    try:
        chat = ChatDownloader().get_chat(video_url)
    except ChatDownloaderError:
        return []

    timestamps = []
    try:
        for message in chat:
            offset = message.get("time_in_seconds")
            if offset is not None:
                timestamps.append(float(offset))
    except ChatDownloaderError as e:
        raise ChatFetchError(f"chat-downloader failed mid-stream for {video_url}: {e}") from e

    return timestamps
