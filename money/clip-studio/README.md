# Clip Studio

A local, single-user take on ssemble.com: it turns long videos into vertical
shorts. You paste a link or drop a file, and it:

1. downloads the video (yt-dlp) and transcribes it locally with faster-whisper,
   using word-level timestamps;
2. finds the most clip-worthy moments, giving each a score, title, hook line and
   reasons;
3. reframes each moment to 9:16 with face tracking (MediaPipe), or uses split
   screen for two speakers or a blurred-background "fit";
4. adds animated word-by-word captions (8 presets: pop, bounce, reveal, highlight
   box…) and a hook title;
5. exports 1080×1920 H.264 MP4s through ffmpeg/libass.

## Run

```bash
./run.sh            # first run creates .venv and installs requirements
# → http://localhost:5055   (PORT=xxxx ./run.sh to change)
```

You need `ffmpeg` on PATH with libass, which the Ubuntu package has. Whisper runs
on the CPU (int8). The `small` model takes about 1–3 min per 10 min of video, and
`base` is roughly 3× faster.

**Clip finder engines**
- **Local** (default): free and offline. It scores sentence windows by hook
  strength, questions, emotion words, energy, speech rate and dead air.
- **Claude**: smarter picks. Set `ANTHROPIC_API_KEY` before `./run.sh`. If the
  call fails, it falls back to Local and shows a note on the project.

## Editor

| Area | What it does |
|---|---|
| Preview | A canvas preview that mirrors the export: crop and face track, captions, hook, watermark and progress bar. Space plays and pauses, ←/→ step. |
| Trim timeline | Drag the purple handles or the whole selection. Edges snap to word boundaries. |
| Captions | Presets, font, size, words per caption, lines, position, animation, colours, outline, shadow and highlight box. |
| Transcript | Click a word to seek, shift-click to select a range, and press Del to cut it. Double-click fixes a word. Auto-removes filler words and silences. Start here / End here. |
| Layout | Auto-reframe, Fit + blur, Split or Center; zoom and nudge; 9:16, 1:1, 4:5 or 16:9. |
| Hook | Opening title over the first N seconds, in 4 styles. The AI suggests the text. |
| Extras | Progress bar, watermark, and background music (upload your own). |
| Export | Queued renders. The ⬇ Exports drawer in the top bar shows progress and downloads. |

## Publishing

Connect accounts under **Accounts**, then use 🚀 **Publish** on any clip (or in
the editor). Each post can go to several accounts, now or at a scheduled time.
Clip Studio re-renders the clip with your latest edits and generates a title,
caption and hashtags (with Claude if the key is set, otherwise locally). Every
post shows up under **Publish**, with retries (3×, 10 min apart) and links to
the live posts. The app has to stay running for scheduled posts to go out.

| Platform | Setup | Limits |
|---|---|---|
| **YouTube Shorts** | Google Cloud → enable *YouTube Data API v3* → OAuth consent screen (External) → Credentials → OAuth client (**Desktop app**) → upload the JSON in Accounts → Connect. stream-clipper's `youtube_client_secret.json` is picked up automatically. | While the consent screen is in *Testing*, logins expire after **7 days**. Click **Publish app** ("In production"; unverified is fine for your own channel) so they stop expiring. Uploads from unaudited API projects can be forced to *private*: if that happens, request the audit or flip them public by hand. |
| **TikTok** | developers.tiktok.com → create an app → add *Login Kit* + *Content Posting API* (with Direct Post) → scopes `video.upload`, `video.publish`, `user.info.basic` → set the redirect URI shown in Accounts → paste the client key and secret → Connect. | Until TikTok audits the app, direct posts are **only visible to you**. Pick "Send to TikTok drafts" instead and finish the post in the app (one tap), or apply for the audit. If TikTok won't accept a `localhost` redirect, set any https URL you own, then paste the URL you land on into the "paste link" box. |
| **Instagram Reels** | Professional (Business/Creator) account → Meta developer app (type Business) with the *Instagram API* → generate a token for your account → paste it. The token is refreshed weekly by itself. | Dev mode without App Review works for your own account. |
| **Folder** | Pick any folder. The MP4 plus a `.txt` caption are dropped there (Dropbox/Drive sync, or a manual posting backlog). | — |

X and Facebook aren't included (the X API is paid).

## Autopilot

**Autopilot** in the top bar makes the whole loop hands-off:

1. **Watch**: add YouTube channels, playlists or Twitch channels. They're
   checked every N minutes, and new uploads (2 min to 4 h long, no live streams)
   are imported automatically. On the first check it only imports the "import
   latest" count, so it doesn't pull the whole back catalogue.
2. **Pick**: once a project is processed, the best N clips above a minimum
   score are rendered.
3. **Post**: they're queued into the next free daily time slots (default
   12:00 / 17:00 / 20:30) on the accounts you tick, with generated captions.
   With **Ask me before posting** on, they wait under Publish → *Needs
   approval* (approve / post now / edit / reject).
4. **Notify**: set an ntfy.sh topic and install the ntfy app to get a ping on
   your phone for new videos, approvals, posts and failures.

You can also tick "Autopilot" when importing a single video, or press
🤖 **Auto-post best** on any project.

## Layout

```
app/server.py     Flask API + static files
app/jobs.py       background queues: process (download → transcribe → find → faces) and export
app/transcribe.py faster-whisper wrapper
app/finder.py     local + Claude clip finders
app/faces.py      MediaPipe face tracks per clip (cached in data/projects/<id>/faces/)
app/edit.py       edit model, cut timeline, caption/hook layout, ASS subtitle writer
app/render.py     ffmpeg filtergraph for crop/fit/split + subtitles + music
app/publish.py    posts queue + scheduler (time slots, approval, retries) + autopilot settings
app/autopilot.py  watched sources → auto import → auto render/post best clips
app/notify.py     ntfy.sh phone notifications
app/social/       one module per platform (youtube, tiktok, instagram, folder) + caption writer
app/static/       vanilla JS single-page app (social.js = Publish/Accounts/Autopilot pages)
fonts/            caption fonts (OFL, from Google Fonts)
models/           MediaPipe BlazeFace models
data/             projects, exports, music, accounts/tokens, posts (gitignored)
```

Caption layout is computed once in Python (`edit.layout`) and used by both the
browser preview and the libass export, so the two match. libass sizes fonts by
the OS/2 win ascent + descent, which `edit._win_metrics` accounts for.

Notes:
- Pin `av<19`, because av 19 breaks faster-whisper 1.2.1.
- Reposting other people's content can break platform ToS and copyright. Stick
  to creators who run clipping programmes, or to content you have rights to.
