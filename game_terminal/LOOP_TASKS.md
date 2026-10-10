# Loop task list — 2026-10-02 batch (built autonomously in a /loop)

Ben's request: 11 new games, a new GAMEPIGEON tab replicating all the GamePigeon games, and 4 fixes.
Quality bar: every game must look as polished and clean as the existing ones, have no bugs, and
(where it is a turn-based or competitive game) offer a PLAY VS BOT seat with Easy/Medium/Hard/Expert
like every other game in the hub (`server/games/ai/levels.js`, `public/games/botLevel.js`).

Process: isolated build forks create ONLY `server/games/<type>.js` + `public/games/<type>/*` (+ a
`test/<type>.test.js` Node logic test). The coordinating session does all registry wiring
(`server/games/index.js`, `public/hub.js`), live browser verification and commits, one game at a
time. Shared word data: `server/games/words.js` (dictionary.txt ~174k words, common_words.txt ~8k).

Status legend: [ ] todo · [b] built by fork, awaiting wiring/verify · [x] wired, verified, committed

## Shared infrastructure
- [x] `server/games/words.js` + `data/dictionary.txt` + `data/common_words.txt`
- [x] Hub: new GAMEPIGEON category; allow one game type to appear in two categories
      (chess/checkers/connect4=Four in a Row/crazyeights=Crazy 8/pool/gomoku/dotsboxes/mancala)
- [x] Hub: new WORD GAMES category (wordsearch, crossword, scrabble, wordscapes, wordtrails, hangman...)

## Fixes
- [x] Tron — keep score (per-player round wins across rounds, shown in HUD/roster)
- [x] Slope — name toggle (show/hide racer name tags)
- [x] Hangman — use the new shared dictionary (old list rejected real words like "and"), count total wins per player
- [x] Chess — post-game recap: step through moves with ←/→, show engine best move per position

## New games (Ben's list)
- [x] blackjack — Blackjack (multi-seat vs dealer, chips, split/double)
- [x] wordsearch — Word Search (race to find words, shared grid)
- [ ] crossword — Crossword (generated mini crosswords with clues, co-op/race)
- [x] scrabble — Scrabble (2-4 players, full board/premiums/dictionary)
- [x] wordscapes — Wordscapes-style (letter wheel → fill crossword of words)
- [ ] pool — 8-Ball (+ 9-Ball mode) pool, physics
- [x] gomoku — Gomoku (15x15, five in a row)
- [x] dotsboxes — Dots and Boxes
- [x] mancala — Mancala (Kalah rules)
- [x] codemaster — Codemaster (Mastermind: 4-color code, exact/color-only feedback)
- [ ] wordtrails — Word Trails (next word starts with last letter of previous, timed)

## GamePigeon tab (new types beyond the above)
- [ ] cuppong — Cup Pong
- [ ] darts — Darts (501/cricket-lite)
- [ ] basketball — Basketball (shootout)
- [ ] archery — Archery
- [ ] minigolf — Mini Golf
- [ ] shuffleboard — Shuffleboard
- [ ] knockout — Knockout (push opponents off the ice)
- [ ] seabattle — Sea Battle (Battleship)
- [ ] tanks — Tanks (artillery)
- [ ] wordhunt — Word Hunt (Boggle-style grid swipe)
- [x] anagrams — Anagrams
- [ ] wordbites — Word Bites
- [x] reversi — Reversi
- [ ] paintball — Paintball (shooting gallery duel)
- [ ] filler — Filler (color flood)
- [ ] twentyq — 20 Questions
- [ ] bowling — Bowling
- [ ] skeeball — Skee-Ball
- (reused existing: chess, checkers, connect4 as "Four in a Row", crazyeights as "Crazy 8", pool, gomoku, dotsboxes, mancala)

## Final
- [ ] Full regression pass: every game type mounts without console errors, server loads all plugins, all tests pass
- [ ] README / TODO_FIRST / memory updated

## Notes (sudo-needing or deferred items)
- No sudo needed so far.
- Paused 2026-10-02 (usage limit). [b] games have files + passing Node tests but are NOT registered in
  server/games/index.js / public/hub.js yet. Gomoku also needs `gomoku: require('./gomokuEngine')` in
  server/games/ai/worker.js. Blackjack needs the room tick (`tickIntervalMs`).
- Forks that may have left partial files: mancala, wordsearch, crossword, scrabble, wordscapes (near done);
  pool, wordtrails, seabattle (stopped right after starting, so redo them).
- 2026-10-10: wired + browser-verified + committed blackjack, gomoku, dotsboxes, mancala, codemaster,
  reversi, wordsearch, wordscapes, scrabble (scrabble got its own test). Fixed a wordscapes answer leak
  (wheel shuffle could spell another target, e.g. board -> broad). Crossword has only
  data/crossword_clues.json so far.
