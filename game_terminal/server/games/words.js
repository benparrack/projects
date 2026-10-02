// Shared English word lists for every word game (Hangman, Scrabble, Word Search, Crossword,
// Wordscapes, Word Trails, Word Hunt, Anagrams, Word Bites, ...).
//   data/dictionary.txt   — ~174k lowercase words: the public-domain ENABLE list (all inflections:
//                           plurals, -ed/-ing, ...) ∪ the system american-english list ∪ a small
//                           modern supplement (email, selfie, wifi, ...). Use it to ACCEPT words.
//   data/common_words.txt — ~8k everyday words (google-10000 no-swears ∩ dictionary), in rough
//                           frequency order. Use it to GENERATE puzzles/answers people will know.
'use strict';

const fs = require('fs');
const path = require('path');

const load = (f) => fs.readFileSync(path.join(__dirname, 'data', f), 'utf8')
  .split('\n').map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]+$/.test(w));

const DICT_LIST = load('dictionary.txt');
const DICTIONARY = new Set(DICT_LIST);
const COMMON = load('common_words.txt');
const COMMON_SET = new Set(COMMON);

const isWord = (w) => typeof w === 'string' && DICTIONARY.has(w.toLowerCase());
const isCommon = (w) => typeof w === 'string' && COMMON_SET.has(w.toLowerCase());

// Letter-multiset helpers for anagram-style games.
function letterCounts(word) {
  const c = new Array(26).fill(0);
  for (const ch of word) c[ch.charCodeAt(0) - 97]++;
  return c;
}
function canSpell(word, counts) {
  const c = counts.slice();
  for (const ch of word) if (--c[ch.charCodeAt(0) - 97] < 0) return false;
  return true;
}
// Every dictionary word (length minLen..maxLen) spellable from `letters` (string), each letter
// used at most as often as it appears. `common` restricts to the everyday list.
function wordsFromLetters(letters, { minLen = 3, maxLen = letters.length, common = false } = {}) {
  const counts = letterCounts(letters.toLowerCase());
  const src = common ? COMMON : DICT_LIST;
  return src.filter((w) => w.length >= minLen && w.length <= maxLen && canSpell(w, counts));
}

module.exports = { DICTIONARY, DICT_LIST, COMMON, COMMON_SET, isWord, isCommon, letterCounts, canSpell, wordsFromLetters };
