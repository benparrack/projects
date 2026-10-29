"""Copies your Instagram login from Firefox into an instaloader session file.
Run this yourself (it reads browser cookies), after logging into instagram.com in Firefox.
Adapted from instaloader's docs/codesnippets/615_import_firefox_session.py."""

import glob
import os
import shutil
import sqlite3
import sys
import tempfile

import instaloader

PROFILE_GLOBS = ["~/snap/firefox/common/.mozilla/firefox/*/cookies.sqlite",
                 "~/.mozilla/firefox/*/cookies.sqlite"]


def instagram_cookies():
    found = []
    for pattern in PROFILE_GLOBS:
        for path in glob.glob(os.path.expanduser(pattern)):
            tmp = os.path.join(tempfile.mkdtemp(), "c.sqlite")
            shutil.copy(path, tmp)  # Firefox keeps the live file locked
            rows = sqlite3.connect(tmp).execute(
                "SELECT name, value FROM moz_cookies WHERE host LIKE '%instagram.com'").fetchall()
            os.remove(tmp)
            if any(n == "sessionid" for n, _ in rows):
                found.append((path, dict(rows)))
    return found


def main():
    found = instagram_cookies()
    if not found:
        sys.exit("No Instagram login found in Firefox. Log into instagram.com in Firefox, then rerun.")
    L = instaloader.Instaloader(max_connection_attempts=1)
    for path, cookies in found:
        L.context._session.cookies.update(cookies)
        user = L.test_login()
        if user:
            L.context.username = user
            L.save_session_to_file()
            print(f"Logged in as {user} (from {path}). Session saved; now run: .venv/bin/python fetch.py")
            return
    sys.exit("Found Firefox cookies but Instagram rejected them. Log in again in Firefox and rerun.")


if __name__ == "__main__":
    main()
