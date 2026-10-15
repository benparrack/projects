#!/bin/sh
# Publishes the committed crux/ folder to github.com/benparrack/crux, served by GitHub Pages at
# https://benparrack.github.io/crux/. That repo is only a mirror, so it's force-pushed every time.
set -e
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
git push --force https://github.com/benparrack/crux.git "$(git subtree split -q --prefix crux HEAD)":refs/heads/main
