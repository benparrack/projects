#!/bin/sh
# Install the morning-hello timers on this machine (idempotent).
set -e
cd "$(dirname "$0")"
mkdir -p ~/.config/systemd/user ~/.local/bin
cp systemd/* ~/.config/systemd/user/
cp bin/claude-hello-dst ~/.local/bin/ && chmod +x ~/.local/bin/claude-hello-dst
systemctl --user daemon-reload
systemctl --user enable --now claude-morning.timer claude-hello-dst.timer
systemctl --user list-timers 'claude-*'
