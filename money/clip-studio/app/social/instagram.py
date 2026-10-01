"""Instagram Reels via the Graph API, using a resumable upload so the video goes
straight from this machine (no public URL needed).

Connect with a long-lived access token for your own professional (Business or
Creator) account. Meta's developer dashboard can generate one for an app you
admin, in development mode, without App Review:
- tokens starting "IG…" (Instagram API with Instagram Login) talk to
  graph.instagram.com and are refreshed automatically before their 60 days run out;
- other tokens (Facebook Login, Page-linked accounts) talk to graph.facebook.com
  and need the Instagram business account id."""

import os
import time

import requests

KEY = "instagram"
NAME = "Instagram Reels"
KIND = "token"
PRIVACY = []
CONNECT_FIELDS = [{"name": "token", "label": "Long-lived access token"},
                  {"name": "user_id", "label": "Instagram account id (only needed for Facebook-Login tokens)"}]
HELP = ("developers.facebook.com → Create app → use case “Manage messaging & content on Instagram” → "
        "API setup with Instagram login → add your Instagram professional account (switch it to Creator/Business "
        "in the Instagram app first) → Generate token → paste it here. Needs instagram_business_basic + "
        "instagram_business_content_publish (granted automatically for your own account in development mode).")
V = "v21.0"


def _host(token):
    return "https://graph.instagram.com" if token.startswith("IG") else "https://graph.facebook.com"


def _get(a, path, **params):
    tok = a["creds"]["token"]
    r = requests.get(f"{_host(tok)}/{V}/{path}", params={**params, "access_token": tok}, timeout=30)
    d = r.json()
    if "error" in d:
        raise RuntimeError(f"Instagram: {d['error'].get('message')}")
    return d


def _post(a, path, **data):
    tok = a["creds"]["token"]
    r = requests.post(f"{_host(tok)}/{V}/{path}", data={**data, "access_token": tok}, timeout=60)
    d = r.json()
    if "error" in d:
        raise RuntimeError(f"Instagram: {d['error'].get('error_user_msg') or d['error'].get('message')}")
    return d


def connect(fields):
    tok = (fields.get("token") or "").strip()
    if not tok:
        raise ValueError("Paste an access token")
    a = {"creds": {"token": tok, "refreshed": time.time()}}
    if tok.startswith("IG"):
        me = _get(a, "me", fields="user_id,username")
        uid = str(me.get("user_id") or me["id"])
    else:
        uid = (fields.get("user_id") or "").strip()
        if not uid:
            raise ValueError("Facebook-Login tokens need the Instagram account id too")
        me = _get(a, uid, fields="username")
    a["creds"]["user_id"] = uid
    return {"name": "@" + me.get("username", uid), "uid": uid, "creds": a["creds"]}


def _refresh(a):
    c = a["creds"]
    if c["token"].startswith("IG") and time.time() - c.get("refreshed", 0) > 7 * 86400:
        r = requests.get("https://graph.instagram.com/refresh_access_token",
                         params={"grant_type": "ig_refresh_token", "access_token": c["token"]}, timeout=30).json()
        if r.get("access_token"):
            c.update(token=r["access_token"], refreshed=time.time())


def check(a):
    _refresh(a)
    me = _get(a, a["creds"]["user_id"], fields="username")
    return {"name": "@" + me.get("username", "")}


def publish(a, path, post):
    _refresh(a)
    uid = a["creds"]["user_id"]
    tags = " ".join("#" + t.lstrip("#") for t in post.get("hashtags", []))
    caption = "\n\n".join(x for x in [post.get("text") or post.get("title", ""), tags] if x.strip())[:2200]
    c = _post(a, f"{uid}/media", media_type="REELS", upload_type="resumable", caption=caption, share_to_feed="true")
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        r = requests.post(c["uri"], data=f, timeout=600, headers={
            "Authorization": f"OAuth {a['creds']['token']}", "offset": "0", "file_size": str(size)})
    if not r.ok:
        raise RuntimeError(f"Instagram upload failed: {r.text[:200]}")
    for _ in range(120):
        time.sleep(5)
        st = _get(a, c["id"], fields="status_code,status")
        if st.get("status_code") == "FINISHED":
            break
        if st.get("status_code") in ("ERROR", "EXPIRED"):
            raise RuntimeError(f"Instagram couldn't process the video: {st.get('status')}")
    else:
        raise RuntimeError("Instagram took too long processing the video")
    mid = _post(a, f"{uid}/media_publish", creation_id=c["id"])["id"]
    try:
        link = _get(a, mid, fields="permalink").get("permalink")
    except Exception:  # noqa: BLE001
        link = None
    return {"id": mid, "url": link}
