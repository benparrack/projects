# notify-when

Watch any page or API and get an ntfy push on your phone when a condition becomes true:
a price drops below X, something comes back in stock, a page changes. (`USEFULL_IDEAS.md` U14.)

## Use

1. Add a `[[watch]]` block to `watches.toml` (all fields are documented at the top of that file).
2. Try it: `python3 watch.py check "My watch"` prints the extracted value and whether the condition holds.
3. `python3 watch.py list` shows every watch's last value, and HIT / ok / ERROR.

Pushes go to `NTFY_ALERT_TOPIC`, read from `./.env` or else `../money/flip-bot/.env` (the same phone topic as
the other bots). A push only fires when a condition *turns* true; a watch that fails 3 times in a row
sends one "watch broken" push.

## Install the timer (checks every 10 min, each watch at its own `every`)

    ln -sf ~/projects/apps/notify_when/notify-when.{service,timer} ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now notify-when.timer

Logs: `journalctl --user -u notify-when -n 50`.

## Limits

- Plain HTTP fetch only. Pages that build their content with JavaScript show nothing to `css`;
  look for the JSON API the page calls (browser devtools → Network) and watch that with `json` instead.
- Tests: `python3 tests/test_watch.py`.
