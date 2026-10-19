// Wordle: everyone gets the same hidden five-letter word and six guesses. Each guess must be a real
// five-letter word; tiles come back green (right letter, right spot), yellow (in the word, wrong
// spot) or grey. Fewest guesses wins; a tie goes to whoever solved it first. Mid-round you see the
// other players' colours but not their letters. Rules engine: ./guessRace.js.

'use strict';

const { COMMON, DICT_LIST } = require('./words');
const { createGuessGame } = require('./guessRace');

const LEN = 5;
const VALID = new Set(DICT_LIST.filter((w) => w.length === LEN));
// Answers: everyday words, skipping simple plurals (Wordle-style) — "glass" stays, "cards" goes.
const ANSWERS = COMMON.filter((w) => w.length === LEN && !(w.endsWith('s') && !w.endsWith('ss')));

// Two passes so repeated letters are marked correctly: greens claim their letter first, then
// yellows only use up letters the answer still has spare. g = green, y = yellow, x = grey.
function markGuess(guess, answer) {
  const mark = Array(LEN).fill('x');
  const spare = {};
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) mark[i] = 'g';
    else spare[answer[i]] = (spare[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < LEN; i++) {
    if (mark[i] !== 'g' && spare[guess[i]] > 0) { mark[i] = 'y'; spare[guess[i]] -= 1; }
  }
  return mark.join('');
}

module.exports = createGuessGame({
  type: 'wordle',
  makePuzzle: (rand) => ({ answer: ANSWERS[Math.floor(rand() * ANSWERS.length)] }),
  check(puzzle, raw) {
    const guess = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
    if (!/^[a-z]+$/.test(guess) || guess.length !== LEN) return { error: 'Five letters, please' };
    if (!VALID.has(guess)) return { error: `${guess.toUpperCase()} isn't in the word list` };
    const mark = markGuess(guess, puzzle.answer);
    return { guess, mark, solved: mark === 'g'.repeat(LEN) };
  },
  peek: (e) => ({ mark: e.mark }),
});
module.exports._internals = { ...module.exports._internals, markGuess, ANSWERS, VALID };
