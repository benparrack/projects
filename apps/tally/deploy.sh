#!/bin/sh
# Publishes the committed tally/ folder to github.com/benparrack/tally, served by GitHub Pages at
# https://benparrack.github.io/tally/. That repo is only a mirror, so it's force-pushed every time.
set -e
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
git push --force https://github.com/benparrack/tally.git "$(git subtree split -q --prefix apps/tally HEAD)":refs/heads/main
