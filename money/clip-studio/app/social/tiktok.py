"""TikTok via the Content Posting API (developers.tiktok.com).

Two modes:
- direct: posts straight to the profile (scope video.publish). Until TikTok
  audits the app, direct posts are forced to "only me" (SELF_ONLY).
- draft: sends the video to the TikTok app's inbox (scope video.upload), where
  you tap Post. This works for unaudited apps and lets you add trending sounds.
"""

import math
import os
import time
from urllib.parse import urlencode

import requests

KEY = "tiktok"
NAME = "TikTok"
KIND = "oauth"
PRIVACY = ["public", "friends", "private"]
APP_FIELDS = [{"name": "client_key", "label": "Client key"}, {"name": "client_secret", "label": "Client secret"},
              {"name": "redirect_uri", "label": "Redirect URI registered on the app (optional — defaults to this app's callback)"}]
HELP = ("developers.tiktok.com → Manage apps → Create app → add products “Login Kit” and “Content Posting API” "
        "(turn on Direct Post) → scopes user.info.basic, video.upload, video.publish → add the redirect URI shown "
        "below → paste the client key/secret here. If TikTok rejects a localhost redirect, register any https URL "
        "you own, then paste the address you land on after logging in.")
API = "https://open.tiktokapis.com/v2"
PRIV = {"public": "PUBLIC_TO_EVERYONE", "friends": "MUTUAL_FOLLOW_FRIENDS", "private": "SELF_ONLY"}


def _redirect(app, redirect):
    return (app.get("redirect_uri") or "").strip() or redirect


def auth_url(app, redirect, state):
    q = {"client_key": app["client_key"], "scope": "user.info.basic,video.upload,video.publish",
         "response_type": "code", "redirect_uri": _redirect(app, redirect), "state": state}
    return "https://www.tiktok.com/v2/auth/authorize/?" + urlencode(q), {}


def _token(app, **form):
    r = requests.post(f"{API}/oauth/token/", data={"client_key": app["client_key"], "client_secret": app["client_secret"], **form},
                      headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=30)
    d = r.json()
    if "access_token" not in d:
        raise RuntimeError(f"TikTok login failed: {d.get('error_description') or d.get('error') or r.text[:200]}")
    d["expires_at"] = time.time() + d.get("expires_in", 86400) - 120
    return d


def finish(app, redirect, url, params, extra):
    tok = _token(app, code=params["code"], grant_type="authorization_code", redirect_uri=_redirect(app, redirect))
    a = {"creds": tok, "app": {k: app[k] for k in ("client_key", "client_secret")}}
    return {**check(a), "uid": tok.get("open_id"), "creds": tok, "app": a["app"]}


def _access(a):
    c = a["creds"]
    if time.time() > c.get("expires_at", 0):
        a["creds"] = {**c, **_token(a["app"], grant_type="refresh_token", refresh_token=c["refresh_token"])}
    return a["creds"]["access_token"]


def _call(a, method, path, **kw):
    r = requests.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {_access(a)}",
                                                          "Content-Type": "application/json; charset=UTF-8"},
                         timeout=60, **kw)
    d = r.json() if r.content else {}
    err = d.get("error") or {}
    if err.get("code") not in (None, "ok") or not r.ok:
        raise RuntimeError(f"TikTok: {err.get('message') or err.get('code') or r.text[:200]}")
    return d.get("data") or {}


def check(a):
    u = _call(a, "GET", "/user/info/", params={"fields": "open_id,display_name,avatar_url"}).get("user", {})
    return {"name": u.get("display_name") or "TikTok account", "avatar": u.get("avatar_url")}


def publish(a, path, post):
    size = os.path.getsize(path)
    if size <= 64 * 1024 ** 2:
        chunk, n = size, 1
    else:
        chunk = 10 * 1024 ** 2
        n = size // chunk  # last chunk absorbs the remainder (TikTok's rule)
    src = {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk, "total_chunk_count": n}
    tags = " ".join("#" + t.lstrip("#") for t in post.get("hashtags", []))
    text = " ".join(x for x in [post.get("text") or post.get("title", ""), tags] if x.strip())[:2200]
    draft = post.get("tiktok_mode") == "draft"
    if draft:
        init = _call(a, "POST", "/post/publish/inbox/video/init/", json={"source_info": src})
    else:
        opts = _call(a, "POST", "/post/publish/creator_info/query/").get("privacy_level_options") or ["SELF_ONLY"]
        want = PRIV.get(post.get("privacy"), "PUBLIC_TO_EVERYONE")
        level = want if want in opts else ("SELF_ONLY" if "SELF_ONLY" in opts else opts[0])
        init = _call(a, "POST", "/post/publish/video/init/", json={
            "post_info": {"title": text, "privacy_level": level, "disable_comment": False, "disable_duet": False,
                          "disable_stitch": False, "video_cover_timestamp_ms": 500},
            "source_info": src})
    with open(path, "rb") as f:
        for i in range(n):
            a0 = i * chunk
            b0 = size - 1 if i == n - 1 else a0 + chunk - 1
            f.seek(a0)
            body = f.read(b0 - a0 + 1)
            r = requests.put(init["upload_url"], data=body, timeout=300, headers={
                "Content-Type": "video/mp4", "Content-Length": str(len(body)),
                "Content-Range": f"bytes {a0}-{b0}/{size}"})
            if r.status_code not in (200, 201, 206):
                raise RuntimeError(f"TikTok upload failed ({r.status_code}): {r.text[:200]}")
    pid = init["publish_id"]
    for _ in range(120):
        time.sleep(5)
        st = _call(a, "POST", "/post/publish/status/fetch/", json={"publish_id": pid})
        s = st.get("status")
        if s == "FAILED":
            raise RuntimeError(f"TikTok rejected the video: {st.get('fail_reason')}")
        if s == "SEND_TO_USER_INBOX":
            return {"id": pid, "url": None, "note": "Sent to your TikTok inbox — open the app to post it"}
        if s == "PUBLISH_COMPLETE":
            ids = st.get("publicaly_available_post_id") or []
            note = None if level == want else "Posted as “only me” — TikTok restricts unaudited apps"
            return {"id": str(ids[0]) if ids else pid,
                    "url": f"https://www.tiktok.com/@/video/{ids[0]}" if ids else None, "note": note}
    if draft:
        return {"id": pid, "url": None, "note": "Upload sent — check your TikTok inbox"}
    return {"id": pid, "url": None, "note": "Uploaded; TikTok is still processing it"}


connect = None  # oauth only
