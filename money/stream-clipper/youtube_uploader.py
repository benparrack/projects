"""Uploads a rendered clip to YouTube as a Short via the official YouTube
Data API v3 — no special app review needed (unlike Instagram/TikTok below),
just a one-time OAuth consent in a browser. A video is placed in the Shorts
shelf automatically when it's vertical, <=60s, and has #Shorts in its
title/description; nothing in the upload call itself is Shorts-specific.

Not unit-tested (network + OAuth) — same convention as downloader.py.
"""

import os

import config

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


class YouTubeUploadError(RuntimeError):
    pass


def _get_credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if os.path.exists(config.YOUTUBE_TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(config.YOUTUBE_TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(config.YOUTUBE_CLIENT_SECRETS_FILE):
                raise YouTubeUploadError(
                    f"{config.YOUTUBE_CLIENT_SECRETS_FILE} not found — download an OAuth client "
                    "secrets JSON from Google Cloud Console (Desktop app type) and place it there. "
                    "See README.md's YouTube setup section."
                )
            flow = InstalledAppFlow.from_client_secrets_file(config.YOUTUBE_CLIENT_SECRETS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(config.YOUTUBE_TOKEN_FILE, "w") as f:
            f.write(creds.to_json())

    return creds


def upload_short(video_path: str, title: str, description: str, tags: list = None) -> str:
    """Uploads video_path as an unlisted-by-default YouTube video (bump to
    public once you trust the pipeline) and returns the resulting video ID.
    `title`/`description` should already include "#Shorts" per YouTube's own
    Shorts-eligibility convention — this function doesn't add it for you, so
    callers stay in full control of the exact caption text."""
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    creds = _get_credentials()
    youtube = build("youtube", "v3", credentials=creds)

    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags or [],
            "categoryId": "24",  # Entertainment
        },
        "status": {
            "privacyStatus": "unlisted",
            "selfDeclaredMadeForKids": False,
        },
    }
    media = MediaFileUpload(video_path, chunksize=-1, resumable=True, mimetype="video/mp4")

    try:
        request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
        response = request.execute()
    except HttpError as e:
        raise YouTubeUploadError(f"YouTube upload failed for {video_path}: {e}") from e

    return response["id"]
