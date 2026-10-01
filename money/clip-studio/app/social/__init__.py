"""Connected social accounts. Each platform module exposes the same small
interface (see PLATFORMS); this module stores the developer-app credentials
(data/social/apps.json) and the connected accounts with their tokens
(data/social/accounts.json). Both stay on this machine; data/ is gitignored."""

import os
import secrets
import threading
import time

from .. import store
from . import folder, instagram, tiktok, youtube

SOCIAL = os.path.join(store.DATA, "social")
os.makedirs(SOCIAL, exist_ok=True)
APPS = os.path.join(SOCIAL, "apps.json")
ACCOUNTS = os.path.join(SOCIAL, "accounts.json")
STREAM_CLIPPER = os.path.join(os.path.dirname(store.ROOT), "stream-clipper")

PLATFORMS = {m.KEY: m for m in (youtube, tiktok, instagram, folder)}
_lock = threading.RLock()
_pending = {}  # oauth state -> {platform, redirect, extra, at}


def get_apps():
    apps = store.read_json(APPS, {})
    # reuse stream-clipper's Google OAuth client if this app has none yet
    sc = os.path.join(STREAM_CLIPPER, "youtube_client_secret.json")
    if not apps.get("youtube") and os.path.exists(sc):
        apps["youtube"] = {"client": store.read_json(sc), "from": "stream-clipper"}
    return apps


def set_app(platform, cfg):
    with _lock:
        apps = store.read_json(APPS, {})
        if cfg:
            apps[platform] = cfg
        else:
            apps.pop(platform, None)
        store.write_json(APPS, apps)


def accounts():
    return store.read_json(ACCOUNTS, [])


def account(aid):
    return next((a for a in accounts() if a["id"] == aid), None)


def public(a):
    return {k: v for k, v in a.items() if k != "creds"}


def save_account(a):
    with _lock:
        lst = accounts()
        for i, x in enumerate(lst):
            if x["id"] == a["id"]:
                lst[i] = a
                break
        else:
            lst.append(a)
        store.write_json(ACCOUNTS, lst)
    return a


def add_account(platform, info):
    """info: {name, creds, ...} from a platform's connect step. Reconnecting
    the same remote account replaces its old entry instead of duplicating it."""
    with _lock:
        lst = accounts()
        uid = info.get("uid")
        old = next((a for a in lst if uid and a["platform"] == platform and a.get("uid") == uid), None)
        a = {"id": old["id"] if old else store.new_id(4), "platform": platform, "created": time.time(), **info}
        return save_account(a)


def remove_account(aid):
    with _lock:
        store.write_json(ACCOUNTS, [a for a in accounts() if a["id"] != aid])


def oauth_start(platform, redirect):
    mod = PLATFORMS[platform]
    app = get_apps().get(platform)
    if not app:
        raise ValueError(f"Add your {mod.NAME} developer app credentials first")
    state = secrets.token_urlsafe(16)
    url, extra = mod.auth_url(app, redirect, state)
    now = time.time()
    for k in [k for k, v in _pending.items() if now - v["at"] > 3600]:
        _pending.pop(k)
    _pending[state] = {"platform": platform, "redirect": redirect, "extra": extra, "at": now}
    return url


def oauth_finish(url, params):
    """Completes an OAuth login from the redirect URL (either our own callback
    or one Ben pasted from the browser's address bar)."""
    if params.get("error"):
        raise ValueError(params.get("error_description") or params["error"])
    st = _pending.pop(params.get("state", ""), None)
    if not st:
        raise ValueError("This login link expired or was already used — click Connect again")
    mod = PLATFORMS[st["platform"]]
    info = mod.finish(get_apps()[st["platform"]], st["redirect"], url, params, st["extra"])
    return add_account(st["platform"], info)


def connect_direct(platform, fields):
    """Platforms connected by pasting a token / choosing a folder."""
    return add_account(platform, PLATFORMS[platform].connect(fields))


def import_stream_clipper_youtube():
    tok = store.read_json(os.path.join(STREAM_CLIPPER, "youtube_token.json"))
    if not tok:
        raise ValueError("No stream-clipper YouTube login found")
    return add_account("youtube", youtube.from_token(tok))


def check(aid):
    a = account(aid)
    info = PLATFORMS[a["platform"]].check(a)
    a.update(info, checked=time.time())
    a.pop("error", None)
    return save_account(a)


def publish(aid, path, post):
    """Uploads one file to one account. Returns {id, url, note}. Token refreshes
    done by the platform module are written back to accounts.json."""
    a = account(aid)
    if not a:
        raise ValueError("That account was disconnected")
    res = PLATFORMS[a["platform"]].publish(a, path, post)
    save_account(a)
    return res


def platform_info():
    apps = get_apps()
    out = {}
    for k, m in PLATFORMS.items():
        app = apps.get(k)
        out[k] = {"name": m.NAME, "kind": m.KIND, "app": bool(app) if m.KIND == "oauth" else None,
                  "appFrom": (app or {}).get("from"), "appFields": getattr(m, "APP_FIELDS", []),
                  "connectFields": getattr(m, "CONNECT_FIELDS", []), "help": m.HELP,
                  "privacy": m.PRIVACY}
    out["youtube"]["streamClipperToken"] = os.path.exists(os.path.join(STREAM_CLIPPER, "youtube_token.json"))
    return out
