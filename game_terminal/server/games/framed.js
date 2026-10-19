// Framed: guess the movie from its stills. Everyone gets the same hidden movie (all released 2000 or
// later) and six tries. You start with one frame; each wrong guess or skip shows the next one.
// Guesses must be picked from the movie list, so a typo never costs a try. Fewest frames wins; a
// tie goes to whoever got it first. Rules engine: ./guessRace.js.
// Movie data: data/framed.json, built by scripts/build-framed.js (image paths on TMDB's CDN).

'use strict';

const fs = require('fs');
const path = require('path');
const { createGuessGame } = require('./guessRace');

const IMG = 'https://image.tmdb.org/t/p/w780';
const MOVIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'framed.json'), 'utf8'));
const BY_TITLE = new Map(MOVIES.map((m) => [m.title.toLowerCase(), m]));
const TITLES = MOVIES.map((m) => m.title).sort((a, b) => a.localeCompare(b));

module.exports = createGuessGame({
  type: 'framed',
  makePuzzle(rand) {
    const m = MOVIES[Math.floor(rand() * MOVIES.length)];
    return { answer: `${m.title} (${m.year})`, movie: m };
  },
  check(puzzle, raw) {
    if (raw == null || raw === '') return { guess: null, mark: 'skip', solved: false };
    const m = typeof raw === 'string' && BY_TITLE.get(raw.trim().toLowerCase());
    if (!m) return { error: 'Pick a movie from the list' };
    const solved = m === puzzle.movie;
    return { guess: m.title, mark: solved ? 'hit' : 'miss', solved };
  },
  // Frames so far: one plus one per guess; all six once you're done or the round is over.
  view({ movie }, me, over) {
    const n = over || (me && (me.solved || me.guesses.length >= 6)) ? 6 : (me ? me.guesses.length : 0) + 1;
    return { frames: movie.frames.slice(0, n).map((f) => IMG + f) };
  },
  peek: (e) => ({ mark: e.mark }),
  extraSnapshot: () => ({ titles: TITLES }),
});
module.exports._internals = { ...module.exports._internals, MOVIES, TITLES };
