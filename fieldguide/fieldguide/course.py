"""The teaching pipeline: digest every file, plan a course, write each chapter, then a capstone.

    scan ─► digests (cheap model, batched) ─► plan (syllabus + architecture)
                                               └─► chapters (strong model, in parallel) ─► capstone
"""
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import llm
from .scan import tree_text

VOICE = """You are a senior engineer walking a capable developer through a codebase they own but did \
not write by hand: an LLM wrote most of it for them. They can read code. What they lack is the mental \
model: how the parts fit, why it is built this way, what would break if they changed things.

How you write:
- Concrete beats general. Name the real functions, files, data shapes and values. Never say "various \
components" or "handles logic".
- Explain why, not just what. When a choice was made (a data structure, a library, a boundary), say what \
it buys and what it costs.
- Plain, direct sentences. No hype, no filler, no "delve", "robust", "seamless", "leverage", "crucial", \
"in summary", "it's worth noting". Do not start with "This chapter". Prefer commas and full stops to dashes.
- Markdown: short paragraphs, `inline code` for identifiers and paths, bullet lists only for real lists. \
No headings inside bodies (the page supplies them).
- Never invent code that isn't there. If something is unclear from the source, say so."""


def _num(text: str, start=1) -> str:
    return '\n'.join(f'{i:>4}  {ln}' for i, ln in enumerate(text.splitlines(), start))


def outline(f) -> str:
    syms = [s for s in f['symbols'] if s['kind'] not in ('selector', 'heading')][:60]
    return ', '.join(f"{s['parent'] + '.' if s['parent'] else ''}{s['name']} (L{s['line']})" for s in syms)


def source_block(f, text: str, limit: int) -> str:
    head = f"=== {f['path']} ({f['lang']}, {f['lines']} lines) ==="
    if len(text) <= limit:
        return f'{head}\n{_num(text)}'
    lines, kept, n = text.splitlines(), [], 0
    for ln in lines:
        n += len(ln) + 7
        if n > limit:
            break
        kept.append(ln)
    return (f"{head}\n{_num(chr(10).join(kept))}\n     ... [{len(lines) - len(kept)} more lines cut for length. "
            f"Outline of the whole file: {outline(f)}]")


# ---------- 1. digests ----------

DIGEST_SCHEMA = {
    'type': 'object', 'required': ['files'],
    'properties': {'files': {'type': 'array', 'items': {
        'type': 'object', 'required': ['path', 'purpose', 'summary', 'key_symbols'],
        'properties': {
            'path': {'type': 'string'},
            'purpose': {'type': 'string', 'description': 'One line, under 15 words: what this file is for.'},
            'summary': {'type': 'string', 'description': '2-4 sentences: how it works and how it connects to the rest.'},
            'key_symbols': {'type': 'array', 'items': {'type': 'object', 'required': ['name', 'what'],
                            'properties': {'name': {'type': 'string'}, 'what': {'type': 'string'}}}},
            'concepts': {'type': 'array', 'items': {'type': 'string'},
                         'description': 'Programming ideas this file uses that a learner should know (e.g. "debouncing", "AST walking").'},
        }}}}}


def digest(project, texts, cfg, log):
    todo = [f for f in project['files'] if f['path'] in texts]
    batches, cur, size = [], [], 0
    for f in todo:
        block = source_block(f, texts[f['path']], 9000 if not f['supporting'] else 2500)
        if cur and size + len(block) > 60000:
            batches.append(cur)
            cur, size = [], 0
        cur.append((f, block))
        size += len(block)
    if cur:
        batches.append(cur)
    system = VOICE + '\n\nRight now you are only taking notes: summarise each file you are given, accurately and briefly.'
    tree = tree_text(project['files'])

    def run(batch):
        prompt = (f"Project: {project['name']}\n\nFile tree:\n{tree}\n\nSummarise every one of these "
                  f"{len(batch)} files (return them all, same paths):\n\n" + '\n\n'.join(b for _, b in batch))
        return llm.ask(system, prompt, DIGEST_SCHEMA, model=cfg['fast_model'], cache=cfg['cache'])['files']

    out = {}
    log(f'Reading {len(todo)} files in {len(batches)} batches')
    with ThreadPoolExecutor(cfg['workers']) as pool:
        futs = [pool.submit(run, b) for b in batches]
        for i, fut in enumerate(as_completed(futs), 1):
            for d in fut.result():
                if d.get('path') in texts:
                    out[d['path']] = d
            log(f'  notes {i}/{len(batches)}', end=True)
    return out


# ---------- 2. plan ----------

PLAN_SCHEMA = {
    'type': 'object',
    'required': ['title', 'tagline', 'overview', 'how_it_runs', 'tech', 'components', 'component_edges', 'chapters'],
    'properties': {
        'title': {'type': 'string', 'description': 'Human name for the project (not the folder name if a better one exists).'},
        'tagline': {'type': 'string', 'description': 'One sentence, under 20 words, what it is and does.'},
        'overview': {'type': 'string', 'description': 'Markdown, 3-4 short paragraphs: what the program does, who it is for, the big idea of how it is built.'},
        'how_it_runs': {'type': 'string', 'description': 'Markdown: what happens, step by step, from launching it to it doing its main job. Name real files and functions.'},
        'how_to_run': {'type': 'string', 'description': 'The command(s) to run it and its tests, if knowable from the source/README. Markdown.'},
        'tech': {'type': 'array', 'items': {'type': 'object', 'required': ['name', 'role'],
                 'properties': {'name': {'type': 'string'}, 'role': {'type': 'string'}}}},
        'components': {'type': 'array', 'description': '3-9 architectural parts. Every code file belongs to exactly one.',
                       'items': {'type': 'object', 'required': ['id', 'name', 'summary', 'files', 'layer'],
                                 'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'},
                                                'summary': {'type': 'string'},
                                                'files': {'type': 'array', 'items': {'type': 'string'}},
                                                'layer': {'type': 'integer', 'description': '0 = what the user/outside world touches (UI, CLI, HTTP). Higher = deeper (core logic, then storage/IO/utilities).'}}}},
        'component_edges': {'type': 'array', 'items': {'type': 'object', 'required': ['from', 'to', 'label'],
                            'properties': {'from': {'type': 'string'}, 'to': {'type': 'string'},
                                           'label': {'type': 'string', 'description': '2-5 words: what flows or what is called.'}}}},
        'chapters': {'type': 'array', 'items': {
            'type': 'object', 'required': ['id', 'title', 'goal', 'files', 'cover'],
            'properties': {'id': {'type': 'string', 'description': 'short-kebab-slug'},
                           'title': {'type': 'string', 'description': 'Specific and plain, e.g. "How a move travels from click to server". Not "Core Logic".'},
                           'goal': {'type': 'string', 'description': 'One sentence: what the reader will understand after this chapter.'},
                           'files': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Files this chapter teaches, most important first.'},
                           'cover': {'type': 'string', 'description': 'Notes to the chapter writer: the specific mechanisms, functions and ideas to teach, and what to build on from earlier chapters.'}}}},
    }}


def plan(project, digests, cfg, log):
    code = [f for f in project['files'] if not f['supporting']]
    n = len(code)
    chapters = '5-6' if project['stats']['loc'] < 3000 else '7-10' if project['stats']['loc'] < 15000 else '10-14'
    notes = '\n'.join(f"- {p}: {d['purpose']} {d['summary']}" for p, d in digests.items())
    edges = '\n'.join(f"{f['path']} -> {', '.join(f['imports'])}" for f in project['files'] if f['imports'])
    prompt = f"""Design a course that teaches this whole project, start to finish.

Project folder: {project['name']}
Size: {project['stats']['loc']} lines of code in {n} files. Languages: {project['stats']['languages']}
Likely entry points: {project['entries']}
Third-party packages: {[e['name'] for e in project['external']]}

README:
{project['readme'] or '(none)'}

File tree:
{tree_text(project['files'])}

Import graph (file -> files it imports):
{edges or '(none found)'}

Notes on every file:
{notes}

Write the syllabus as {chapters} chapters. Order them the way you would teach a new teammate:
1. Start with a chapter that runs the program in your head end to end (entry point to main job), so later chapters have a frame.
2. Then the core data model and central mechanism, then each subsystem, roughly from the outside in.
3. Tests, tooling and build go late, unless the project is mostly tooling.
Every non-trivial code file must appear in at least one chapter's files. A file can appear in several.
Components are for an architecture diagram: keep them meaningful (e.g. "Game server", "Rendering", "Persistence"), not one per file."""
    log('Planning the course')
    return llm.ask(VOICE, prompt, PLAN_SCHEMA, model=cfg['model'], cache=cfg['cache'], effort=cfg['effort'])


# ---------- 3. chapters ----------

DIAGRAM = {
    'type': 'object', 'required': ['kind', 'title', 'nodes', 'edges'],
    'description': 'A diagram that makes this section click. "flow": boxes and arrows (data flow, pipeline, state machine, call tree). '
                   '"sequence": nodes are participants left to right, edges are messages in time order.',
    'properties': {
        'kind': {'type': 'string', 'enum': ['flow', 'sequence']},
        'title': {'type': 'string'},
        'nodes': {'type': 'array', 'items': {'type': 'object', 'required': ['id', 'label'],
                  'properties': {'id': {'type': 'string'}, 'label': {'type': 'string', 'description': 'Short, under 24 chars.'},
                                 'note': {'type': 'string', 'description': 'Optional tiny subtitle, e.g. a file or function name.'}}}},
        'edges': {'type': 'array', 'items': {'type': 'object', 'required': ['from', 'to'],
                  'properties': {'from': {'type': 'string'}, 'to': {'type': 'string'}, 'label': {'type': 'string'}}}},
    }}

CHAPTER_SCHEMA = {
    'type': 'object',
    'required': ['summary', 'sections', 'design_notes', 'improvements', 'quiz', 'exercises', 'takeaways', 'terms'],
    'properties': {
        'summary': {'type': 'string', 'description': 'Two sentences for the table of contents.'},
        'sections': {'type': 'array', 'description': '4-7 sections that build on each other.', 'items': {
            'type': 'object', 'required': ['heading', 'body', 'code'],
            'properties': {
                'heading': {'type': 'string'},
                'body': {'type': 'string', 'description': 'Markdown, 120-350 words. Teach, with reasons.'},
                'code': {'type': 'array', 'description': '0-3 excerpts to show next to the text. Use the real line numbers given. Keep each under ~40 lines.',
                         'items': {'type': 'object', 'required': ['file', 'start', 'end', 'caption'],
                                   'properties': {'file': {'type': 'string'}, 'start': {'type': 'integer'},
                                                  'end': {'type': 'integer'},
                                                  'caption': {'type': 'string', 'description': 'One sentence: what to look at in this excerpt.'}}}},
                'diagram': DIAGRAM,
            }}},
        'design_notes': {'type': 'array', 'description': '2-5 design decisions visible in this code.', 'items': {
            'type': 'object', 'required': ['decision', 'why', 'alternative'],
            'properties': {'decision': {'type': 'string'}, 'why': {'type': 'string'},
                           'alternative': {'type': 'string', 'description': 'What else could have been done, and when that would be better.'}}}},
        'improvements': {'type': 'array', 'description': '1-5 real, specific improvements: bugs, risks, missing tests, simplifications, performance. Only things you can point at in this code.', 'items': {
            'type': 'object', 'required': ['title', 'detail', 'file', 'impact', 'effort'],
            'properties': {'title': {'type': 'string'}, 'detail': {'type': 'string'}, 'file': {'type': 'string'},
                           'line': {'type': 'integer'},
                           'impact': {'type': 'string', 'enum': ['high', 'medium', 'low']},
                           'effort': {'type': 'string', 'enum': ['small', 'medium', 'large']}}}},
        'quiz': {'type': 'array', 'description': '3-5 questions that test understanding (why/what-if), not trivia recall.', 'items': {
            'type': 'object', 'required': ['question', 'choices', 'answer', 'explanation'],
            'properties': {'question': {'type': 'string'}, 'choices': {'type': 'array', 'items': {'type': 'string'}},
                           'answer': {'type': 'integer', 'description': '0-based index of the right choice.'},
                           'explanation': {'type': 'string'}}}},
        'exercises': {'type': 'array', 'description': '2-3 hands-on things to try in the real code to cement it (trace, tweak, break, extend).', 'items': {
            'type': 'object', 'required': ['task', 'hint'],
            'properties': {'task': {'type': 'string'}, 'hint': {'type': 'string'}}}},
        'takeaways': {'type': 'array', 'items': {'type': 'string'}, 'description': '3-5 one-line things to remember.'},
        'terms': {'type': 'array', 'description': 'Jargon used in this chapter, project-specific or general.', 'items': {
            'type': 'object', 'required': ['term', 'definition'],
            'properties': {'term': {'type': 'string'}, 'definition': {'type': 'string'}}}},
    }}


def chapter(project, course, ch, idx, digests, texts, cfg):
    budget, blocks, shown = 140000, [], set()
    by_path = {f['path']: f for f in project['files']}
    for p in ch['files']:
        f = by_path.get(p)
        if not f or p not in texts:
            continue
        b = source_block(f, texts[p], max(8000, min(60000, budget)))
        if budget - len(b) < 0 and blocks:
            break
        blocks.append(b)
        shown.add(p)
        budget -= len(b)
    # One hop out in the import graph, as notes only, so the writer can explain the seams.
    near = {q for p in shown for q in by_path[p]['imports'] + by_path[p]['imported_by']} - shown
    context = '\n'.join(f"- {q}: {digests[q]['purpose']}" for q in sorted(near) if q in digests)
    syllabus = '\n'.join(f"{i + 1}. {c['title']}: {c['goal']}" for i, c in enumerate(course['chapters']))
    prompt = f"""You are writing chapter {idx + 1} of a course on "{course['title']}": {course['tagline']}

The course so far (for context; don't re-teach other chapters, refer to them by number when useful):
{syllabus}

Architecture in one paragraph: {course['overview'][:1500]}

THIS CHAPTER: {ch['title']}
Goal: {ch['goal']}
What to cover: {ch['cover']}

Neighbouring files (imported by or importing this chapter's files):
{context or '(none)'}

Source code (line numbers on the left are real; cite them exactly in code excerpts):

{chr(10).join(blocks)}

Write the chapter. Lead with the idea, then show where it lives in the code. Put a diagram on the 1-3 \
sections where a picture explains it faster than words (a request's journey, a pipeline, a state machine, \
who-calls-whom), and leave it off elsewhere."""
    return llm.ask(VOICE, prompt, CHAPTER_SCHEMA, model=cfg['model'], cache=cfg['cache'], effort=cfg['effort'])


# ---------- 4. capstone ----------

CAPSTONE_SCHEMA = {
    'type': 'object', 'required': ['recap', 'mental_model', 'roadmap', 'final_quiz', 'next_steps'],
    'properties': {
        'recap': {'type': 'string', 'description': 'Markdown, 3-5 paragraphs tying the chapters together into one picture.'},
        'mental_model': {'type': 'array', 'items': {'type': 'object', 'required': ['idea', 'detail'],
                         'properties': {'idea': {'type': 'string'}, 'detail': {'type': 'string'}}},
                         'description': 'The 5-8 ideas that, if you hold them in your head, mean you understand this project.'},
        'roadmap': {'type': 'array', 'description': 'The 5-10 most worthwhile improvements across the project, in the order to do them.', 'items': {
            'type': 'object', 'required': ['title', 'why', 'how', 'impact', 'effort', 'files'],
            'properties': {'title': {'type': 'string'}, 'why': {'type': 'string'}, 'how': {'type': 'string'},
                           'impact': {'type': 'string', 'enum': ['high', 'medium', 'low']},
                           'effort': {'type': 'string', 'enum': ['small', 'medium', 'large']},
                           'files': {'type': 'array', 'items': {'type': 'string'}}}}},
        'final_quiz': CHAPTER_SCHEMA['properties']['quiz'] | {'description': '8 questions spanning the whole project, favouring how parts interact.'},
        'next_steps': {'type': 'array', 'items': {'type': 'string'}, 'description': '3-5 concrete ways to deepen understanding by working on the code.'},
    }}


def capstone(course, chapters, cfg):
    parts = []
    for c, body in zip(course['chapters'], chapters):
        if not body:
            continue
        imps = '; '.join(f"{i['title']} ({i['impact']}/{i['effort']}, {i['file']})" for i in body['improvements'])
        parts.append(f"## {c['title']}\n{body['summary']}\nTakeaways: {' | '.join(body['takeaways'])}\n"
                     f"Design notes: {' | '.join(d['decision'] for d in body['design_notes'])}\nImprovements found: {imps}")
    prompt = f"""The course on "{course['title']}" ({course['tagline']}) is written. Here is every chapter, condensed:

{chr(10).join(parts)}

Components: {', '.join(c['name'] + ': ' + c['summary'] for c in course['components'])}

Write the closing chapter: a recap that joins it all into one picture, the core mental model, a prioritised \
improvement roadmap (merge duplicates, rank by value for effort), a final quiz across chapters, and next steps."""
    return llm.ask(VOICE, prompt, CAPSTONE_SCHEMA, model=cfg['model'], cache=cfg['cache'], effort=cfg['effort'])


# ---------- glue ----------

def fix_refs(body, project, texts):
    """The model sometimes cites a path slightly wrong or a line past the end; repair or drop those."""
    by_path = {f['path']: f for f in project['files']}
    by_name = {}
    for p in by_path:
        by_name.setdefault(Path(p).name, []).append(p)

    def resolve(p):
        if p in by_path:
            return p
        p = p.lstrip('./')
        if p in by_path:
            return p
        hits = [q for q in by_path if q.endswith('/' + p)] or by_name.get(Path(p).name, [])
        return hits[0] if len(hits) == 1 else None

    for s in body.get('sections', []):
        kept = []
        for c in s.get('code', []):
            p = resolve(c['file'])
            if not p or p not in texts:
                continue
            n = by_path[p]['lines']
            start = max(1, min(c['start'], n))
            end = max(start, min(c['end'], n, start + 80))
            kept.append(c | {'file': p, 'start': start, 'end': end})
        s['code'] = kept
        d = s.get('diagram')
        if d:
            ids = {x['id'] for x in d.get('nodes', [])}
            d['edges'] = [e for e in d.get('edges', []) if e['from'] in ids and e['to'] in ids]
            if len(ids) < 2:
                s.pop('diagram')
    for i in body.get('improvements', []):
        i['file'] = resolve(i.get('file', '')) or i.get('file', '')
    for q in body.get('quiz', []) + body.get('final_quiz', []):
        q['answer'] = max(0, min(q['answer'], len(q['choices']) - 1))
    return body


def build(project, texts, cfg, log):
    t0 = time.time()
    digests = digest(project, texts, cfg, log)
    course = plan(project, digests, cfg, log)
    known = {f['path'] for f in project['files']}
    for c in course['chapters']:
        c['files'] = [p for p in c['files'] if p in known]
    for c in course['components']:
        c['files'] = [p for p in c['files'] if p in known]

    log(f"Writing {len(course['chapters'])} chapters")
    bodies = [None] * len(course['chapters'])
    with ThreadPoolExecutor(cfg['workers']) as pool:
        futs = {pool.submit(chapter, project, course, c, i, digests, texts, cfg): i
                for i, c in enumerate(course['chapters'])}
        for fut in as_completed(futs):
            i = futs[fut]
            try:
                bodies[i] = fix_refs(fut.result(), project, texts)
                log(f"  ✓ {i + 1}. {course['chapters'][i]['title']}")
            except llm.LLMError as e:
                log(f"  ✗ {i + 1}. {course['chapters'][i]['title']}: {e}")
    log('Writing the capstone')
    try:
        cap = fix_refs(capstone(course, bodies, cfg), project, texts)
    except llm.LLMError as e:
        log(f'  ✗ capstone: {e}')
        cap = None
    return {'digests': digests, 'course': course, 'chapters': bodies, 'capstone': cap,
            'built': time.strftime('%Y-%m-%d %H:%M'), 'seconds': round(time.time() - t0),
            'models': {'model': cfg['model'], 'fast_model': cfg['fast_model']}}
