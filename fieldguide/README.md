# Field Guide

Point it at a project folder and it writes a course about that code, then serves the course as a book
you read in the browser. It's for code you own but didn't type yourself: the goal is to rebuild the
mental model. How the parts fit, why they're built this way, what breaks if you change them, and what
you'd improve.

```
python3 -m fieldguide build ~/projects/some-project      # ~5–15 min, cached after
python3 -m fieldguide serve                              # bookshelf at http://127.0.0.1:8770
```

It needs Python 3.10+ and a logged-in `claude` CLI. There's nothing to install: the backend uses only
the standard library, and the viewer is plain ES modules with no build step.

## What you get

- **An overview.** What the project is, the architecture map, and a reading order.
- **Chapters.** Each one follows a single thread through the code, for example "a request from socket
  to response". You get prose, the real source excerpts with line numbers, generated diagrams (flows,
  sequences, state machines), the design decisions and the alternatives that were rejected, concrete
  improvements, and a short quiz.
- **Putting it together.** A closing chapter with the whole system on one page and a prioritised
  improvement roadmap.
- **Reference.** An architecture map (component layers, an import graph and a size treemap), a file
  explorer where every file has notes and highlighted source, a glossary, and a list of every
  suggested improvement.
- **Ask.** On any page you can ask a follow-up question. Claude answers from the actual source, citing
  `file:line`, and the answers are kept under *Your questions*.

The viewer remembers which chapters you've marked as understood and how you answered each quiz.
Press `/` to search chapters, files, functions and terms, and use the arrow keys to move between
chapters.

## How a build works

```
scan ─► notes on every file (sonnet, batched) ─► course plan (opus)
                                                  └─► chapters (opus, 3 in parallel) ─► closing chapter
```

1. `scan.py` reads the project with no model calls. It skips vendored and generated directories, then
   collects files, line counts, languages, symbols, import edges (Python, JS/TS, HTML and Lua; other
   languages get symbols only) and likely entry points.
2. Each file gets a short structured note from the fast model.
3. The writing model plans the course: the chapters, the architecture components and layers, and which
   files each chapter covers.
4. The chapters are written in parallel, each from the real source of its files. `fix_refs` repairs
   the model's file paths, clamps line ranges to the real file, and drops diagram edges that point to
   nodes that don't exist.

Every Claude call is cached by its input hash in `.cache/`, so after you edit a project a rebuild only
redoes the files and chapters that changed. `fieldguide scan <path>` gives you the free static view
first.

Options: `--model`, `--fast-model`, `--effort low..max`, `--workers N`, `--name`, `--open`. Guides are
written to `guides/<slug>/guide.json`, and Q&A history goes to `qa.json` next to it.

## Layout

| Path | What it is |
|---|---|
| `fieldguide/scan.py` | Static analysis: files, symbols, imports, entry points |
| `fieldguide/course.py` | The teaching pipeline, its prompts and JSON schemas, and reference repair |
| `fieldguide/llm.py` | Headless `claude -p` calls with schema output and a disk cache |
| `fieldguide/server.py` | Bookshelf, guide JSON, and the `/api/ask` endpoint |
| `fieldguide/web/` | The reader: `app.js` (views and routing), `diagrams.js` (layered flow and architecture layouts, force graph, treemap), `md.js` (markdown and highlighting) |
| `tools/shoot.mjs` | Screenshots of a running server, used for visual review |

## Tests

```
python3 -m unittest discover -s tests     # scanner, source blocks, reference repair
node tests/test_web.mjs                   # markdown, highlighter, diagram layouts
```
