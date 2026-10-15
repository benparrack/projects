# internship_bot

Applies to Summer 2027 internships for Ben. It pulls new postings from daily-updated GitHub lists
(SimplifyJobs, speedyapply), drops the ones he can't apply to, fills each application in a real
Chrome, and answers every question from his profile. If it doesn't know something, it asks him once
and remembers the answer. Nothing is submitted until Ben approves it in the dashboard, unless he
turns on auto-submit.

## Daily use

- **Dashboard:** http://127.0.0.1:8377 (always running as a systemd service; `npm run dashboard` to run by hand).
  - **Needs you:** questions to answer, filled applications to approve (edit any answer first), and jobs to apply to yourself.
    Filter Easy (approve, maybe paste a code) / Hard (send it yourself). Greenhouse: the emailed security code is read
    from Gmail onto the clipboard (`mail.py --code`) with the cursor in the code box: Ctrl+V, Submit. Ashby flags the
    bot's browser as spam, so those are Ben's: Open form tiles the form left / dashboard right (`src/tile.py` un-maximizes it first), Copy buttons per answer
    (resume path first: Ctrl+L, Ctrl+V in the file dialog), Applied → next form opens the next (Mark as applied closes the form and re-maximizes). Their confirmation emails
    also mark them applied (`mail.py`, only when it's the sole pending job at that company).
  - **Applications:** history, outcomes (set by hand or from email), notes.
  - **Pipeline:** what's next, failures, what isn't automated yet.
  - **Insights:** what got responses: answers, resume version, speed after posting.
  - **Profile:** edit the profile files.
  - **Settings:** auto-submit, daily cap, Workday, Gmail, Appearance (palette, light/dark, type, density,
    corners, accent; saved per browser).
- **Phone (ntfy app):** subscribe to the two topics shown in Settings. Alerts arrive on the first.
  To answer, reply on the second with `<number> <answer>` (or `skip <number>`), or tap a button.
- Answers you give or edit are saved to `profile/answers.yaml` and reused. Edits to written answers
  and essays that got interviews feed back into future drafts.

## How it runs

| unit | what |
|---|---|
| `intern-run.timer` | every 30 min: fetch lists, submit approved jobs, dry-run up to 5 new ones (newest first) |
| `intern-mail.timer` | hourly, only once Gmail is set up: reads replies, sets confirmed/oa/interview/offer/rejected, then `src/confirm.js` clicks Workday verification links (last 3 weeks, only for hosts in `data/workday.json`) and puts those jobs back in line |
| `intern-dashboard.service` | the dashboard |

Unit files live in `systemd/`. Install or update them with:
`cp systemd/* ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now intern-run.timer intern-mail.timer intern-dashboard.service`.
Logs: `journalctl --user -u intern-run -n 50`.

By hand:
```
node src/run.js --list            # next jobs in line
node src/run.js --apply 3         # 3 dry runs (fill + screenshot, wait for approval)
node src/run.js --id <job id>     # one job
node src/queue.js                 # answer open questions in the terminal
python3 src/mail.py               # check mail now
npm test && python3 src/mail.py --selftest
NO_NOTIFY=1 ...                   # print notifications instead of sending them
INTERN_NO_SUBMIT=1 ...            # run the live path but stop before the submit click
```

## Files

- `profile/` (git-ignored, personal): `profile.yaml` hard facts, `stories.md` essay material,
  `answers.yaml` learned answers, `resume.html` → `resume-swe.pdf` / `resume-emb.pdf`. To rebuild
  the PDFs after editing: `cd profile && for v in swe emb; do google-chrome --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=resume-$v.pdf "file://$PWD/resume.html#$v"; done`.
- `data/` (git-ignored): `jobs.sqlite`, screenshots, `mail.json` (Gmail app password, mode 600).
- `src/ats/`: one adapter per application system: Greenhouse, Ashby, Lever, Workday.
- `data/workday.json` (mode 600): the Workday account per company (email, generated password).

## Rules the bot follows

- It never makes up facts. Unknown facts go to Ben; written answers use only the resume and `stories.md`.
- It never solves CAPTCHAs, never signs "no AI was used" statements, never automates LinkedIn, and never
  does outside work like assessments or take-home tasks. Those jobs go to "apply yourself".
- Daily cap (default 25), counting dry runs and applications.

## Workday

Off until Ben turns it on in Settings, because it creates a candidate account in his name at each
company. When it's on, `src/ats/workday.js`:
1. reads the posting from Workday's public job API (closed postings are skipped),
2. signs in, or creates the account (random password saved to `data/workday.json` first). A verification
   email is read from Gmail with `mail.py --verify <host>`; without Gmail the job goes to "apply yourself"
   (and the hourly `confirm.js` sweep clicks the link later and re-queues it once Gmail is connected),
3. walks the wizard one page at a time. It reads every field from Workday's `data-automation-id` markup
   (text, dropdowns, search pickers, radios, checkboxes, dates), answers it with the same engine as the
   other forms, fills it, and clicks Save and Continue. On My Experience it uploads the resume and keeps
   whatever Workday parses from it. Search pickers can be nested ("Career Websites → Corporate
   Website"): a one-item sub-list is taken automatically, otherwise the sub-choice is asked like any
   question (key `sub|<label>`); if a sub-list has no honest choice, it backs out and picks again.
   Country and phone code are pinned to the US. Fields that appear after another is set (State and
   County after Country) are filled on a second pass,
4. stops at Review with a screenshot and waits for approval. Assessments, CAPTCHAs and pages it can't get
   past go to "apply yourself".

Tested against the live job API (30/30 postings) and a fixture of Workday's markup, and dry-run live on
Copart: sign-in, My Information and My Experience go through, and it stops at Application Questions to ask
Ben what only he knows. Debug a stuck job with a dry run: `node src/run.js --id <id>`; the screenshot is
`data/shots/<id>.png`.

## Not automated yet

iCIMS, Oracle, TikTok/ByteDance, SmartRecruiters (and Workday while it's off). Those postings show in
Pipeline under "Not automated yet", with an "I applied" button.
