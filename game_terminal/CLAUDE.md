# game_terminal

## Use graphify first, to save tokens

This project has a graphify knowledge graph (`graphify-out/`, code-only, built
locally with no LLM cost). **Use it whenever you can instead of grep/Glob/reading
whole files.** Repeated Read/Grep round-trips are the main token cost in this
repo (see the root `CLAUDE.md` "Token/context discipline"). A scoped graph query
usually answers "where is X / what calls Y / how do A and B connect" in a
fraction of the tokens.

- Start codebase questions with `graphify query "<question>"`. Keep questions
  narrow (a specific game, function, or message type), because broad ones get
  truncated at about 2k tokens.
- Use `graphify explain "<symbol>"` for one function/module and its neighbours,
  and `graphify path "<A>" "<B>"` for how two things connect.
- Only fall back to Read/Grep once the graph has pointed you at specific files and
  lines. Then read just that range (`offset`/`limit`), not the whole file.
- `graphify-out/` is gitignored (root `.gitignore`). If it's missing, rebuild it with `graphify update .`
  (from `game_terminal/`, ~15s). After you change code, run `graphify update .` so
  the graph stays current. That is also free.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
