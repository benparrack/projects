"""YouTube Shorts via the YouTube Data API v3. A vertical video ≤3 min lands in
the Shorts feed automatically; "#Shorts" is added to the title when it fits.

Setup: a Google Cloud OAuth client (Desktop app type) — the same one
stream-clipper uses is picked up automatically. Unverified apps work for your
own channel; uploads from unverified API projects may be locked to private
until the project passes Google's audit (see README)."""

import os

KEY = "youtube"
NAME = "YouTube Shorts"
KIND = "oauth"
PRIVACY = ["public", "unlisted", "private"]
APP_FIELDS = [{"name": "client", "label": "OAuth client JSON (Desktop app) from Google Cloud Console", "type": "file"}]
HELP = ("Google Cloud Console → new project → enable “YouTube Data API v3” → OAuth consent screen "
        "(External, add yourself as a test user) → Credentials → Create OAuth client ID → Desktop app → "
        "download the JSON and upload it here.")
SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]

os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")  # localhost redirect is plain http
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")


def _flow(app, redirect, **kw):
    from google_auth_oauthlib.flow import Flow
    return Flow.from_client_config(app["client"], scopes=SCOPES, redirect_uri=redirect, **kw)


def auth_url(app, redirect, state):
    flow = _flow(app, redirect, state=state, autogenerate_code_verifier=True)
    url, _ = flow.authorization_url(access_type="offline", prompt="consent")
    return url, {"code_verifier": flow.code_verifier}


def finish(app, redirect, url, params, extra):
    flow = _flow(app, redirect, state=params.get("state"), code_verifier=extra.get("code_verifier"))
    flow.fetch_token(code=params["code"])
    import json
    return {**_channel(flow.credentials), "creds": json.loads(flow.credentials.to_json())}


def from_token(tok):
    """An existing authorized-user token (e.g. stream-clipper's)."""
    a = {"creds": tok}
    try:
        c = _creds(a)
    except Exception as e:  # noqa: BLE001
        raise ValueError("That saved login has expired — use Connect instead (and see the README tip about "
                         "publishing the consent screen so logins stop expiring after 7 days)") from e
    try:
        info = _channel(c)
    except Exception:  # noqa: BLE001 - upload-only tokens can't read the channel name
        info = {"name": "YouTube (stream-clipper login)", "uid": "stream-clipper"}
    return {**info, "creds": a["creds"]}


def _creds(a):
    import json

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    c = Credentials.from_authorized_user_info(a["creds"])
    if not c.valid:
        c.refresh(Request())
        a["creds"] = json.loads(c.to_json())
    return c


def _channel(creds):
    from googleapiclient.discovery import build
    yt = build("youtube", "v3", credentials=creds, cache_discovery=False)
    items = yt.channels().list(part="snippet", mine=True).execute().get("items", [])
    if not items:
        return {"name": "YouTube channel", "uid": None}
    ch = items[0]
    return {"name": ch["snippet"]["title"], "uid": ch["id"], "avatar": ch["snippet"]["thumbnails"]["default"]["url"]}


def check(a):
    c = _creds(a)
    try:
        return _channel(c)
    except Exception:  # noqa: BLE001
        return {}


def title_for(post):
    t = (post.get("title") or "").strip()[:100]
    return t if len(t) + 8 > 100 or "#shorts" in t.lower() else f"{t} #Shorts"


def publish(a, path, post):
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload
    yt = build("youtube", "v3", credentials=_creds(a), cache_discovery=False)
    tags = [t.lstrip("#") for t in post.get("hashtags", [])]
    desc = "\n\n".join(x for x in [post.get("text", ""), " ".join("#" + t for t in tags)] if x.strip())
    body = {
        "snippet": {"title": title_for(post), "description": desc[:5000], "tags": tags[:30], "categoryId": "24"},
        "status": {"privacyStatus": post.get("privacy", "public") if post.get("privacy") in PRIVACY else "public",
                   "selfDeclaredMadeForKids": False},
    }
    media = MediaFileUpload(path, chunksize=8 * 1024 * 1024, resumable=True, mimetype="video/mp4")
    try:
        req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
        resp = None
        while resp is None:
            _, resp = req.next_chunk()
    except HttpError as e:
        raise RuntimeError(f"YouTube: {e.reason if hasattr(e, 'reason') else e}") from e
    vid = resp["id"]
    return {"id": vid, "url": f"https://youtube.com/shorts/{vid}"}
