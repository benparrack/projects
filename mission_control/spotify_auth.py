"""One-time Spotify OAuth setup for the Now Playing panel.

Create an app at https://developer.spotify.com/dashboard first, with
redirect URI set to exactly http://127.0.0.1:8888/callback (see
README.md). Then run:

    .venv/bin/python spotify_auth.py

It opens your browser to authorize this dashboard to read your Spotify
playback state, catches the redirect locally, exchanges it for a
refresh token, and writes that into config.toml.
"""

from __future__ import annotations

import http.server
import re
import urllib.parse
import webbrowser
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPE = "user-read-playback-state"


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    code: str | None = None

    def do_GET(self) -> None:
        query = urllib.parse.urlparse(self.path).query
        _CallbackHandler.code = urllib.parse.parse_qs(query).get("code", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<html><body>Authorized - you can close this tab.</body></html>")

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - silence default logging
        pass


def main() -> None:
    client_id = input("Spotify Client ID: ").strip()
    client_secret = input("Spotify Client Secret: ").strip()

    auth_url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPE,
        }
    )
    print(f"\nOpening your browser to authorize. If it doesn't open, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    server = http.server.HTTPServer(("127.0.0.1", 8888), _CallbackHandler)
    print("Waiting for authorization...")
    while _CallbackHandler.code is None:
        server.handle_request()
    code = _CallbackHandler.code

    print("Got authorization code, exchanging for a refresh token...")
    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=10,
    )
    resp.raise_for_status()
    refresh_token = resp.json()["refresh_token"]

    _write_spotify_section(client_id, client_secret, refresh_token)
    print("\nDone. Saved Spotify credentials to config.toml.")


def _write_spotify_section(client_id: str, client_secret: str, refresh_token: str) -> None:
    config_path = HERE / "config.toml"
    text = config_path.read_text() if config_path.exists() else ""

    # Drop any existing [spotify] section (up to the next "[section]" or EOF)
    # so re-running this script cleanly replaces stale credentials, then
    # append the fresh one. Leaves every other section untouched.
    text = re.sub(r"\n?\[spotify\].*?(?=\n\[|\Z)", "", text, flags=re.DOTALL).rstrip("\n")

    block = (
        "\n\n[spotify]\n"
        f'client_id = "{client_id}"\n'
        f'client_secret = "{client_secret}"\n'
        f'refresh_token = "{refresh_token}"\n'
    )
    config_path.write_text(text + block)


if __name__ == "__main__":
    main()
