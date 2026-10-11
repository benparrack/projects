// Registry of game plugins. Adding a new mini-game means adding one require + one entry here,
// plus a matching public/games/<name>/client.js and a menu entry in public/hub.js — nothing else
// in server/ needs to change.
const drawing = require('./drawing');
const hangman = require('./hangman');
const checkers = require('./checkers');
const chess = require('./chess');
const slither = require('./slither');
const connect4 = require('./connect4');
const shooter = require('./shooter');
const war = require('./war');
const crazyeights = require('./crazyeights');
const bs = require('./bs');
const poker = require('./poker');
const garticphone = require('./garticphone');
const spades = require('./spades');
const hearts = require('./hearts');
const backgammon = require('./backgammon');
const tron = require('./tron');
const pictionary = require('./pictionary');
const slope = require('./slope');
const mazedash = require('./mazedash');
const gameboy = require('./gameboy');
const blackjack = require('./blackjack');
const gomoku = require('./gomoku');
const dotsboxes = require('./dotsboxes');
const mancala = require('./mancala');
const codemaster = require('./codemaster');
const reversi = require('./reversi');
const wordsearch = require('./wordsearch');
const wordscapes = require('./wordscapes');
const scrabble = require('./scrabble');
const anagrams = require('./anagrams');
const wordbites = require('./wordbites');
const wordhunt = require('./wordhunt');
const filler = require('./filler');
const seabattle = require('./seabattle');
const wordtrails = require('./wordtrails');
const crossword = require('./crossword');
const pool = require('./pool');
const darts = require('./darts');
const cuppong = require('./cuppong');
const basketball = require('./basketball');
const twentyq = require('./twentyq');
const tanks = require('./tanks');
const minigolf = require('./minigolf');
const archery = require('./archery');
const shuffleboard = require('./shuffleboard');
const bowling = require('./bowling');
const knockout = require('./knockout');
const paintball = require('./paintball');
const skeeball = require('./skeeball');
const minesweeper = require('./minesweeper');
const blockade = require('./blockade');

const registry = {
  [drawing.type]: drawing,
  [hangman.type]: hangman,
  [checkers.type]: checkers,
  [chess.type]: chess,
  [slither.type]: slither,
  [connect4.type]: connect4,
  [shooter.type]: shooter,
  [war.type]: war,
  [crazyeights.type]: crazyeights,
  [bs.type]: bs,
  [poker.type]: poker,
  [garticphone.type]: garticphone,
  [spades.type]: spades,
  [hearts.type]: hearts,
  [backgammon.type]: backgammon,
  [tron.type]: tron,
  [pictionary.type]: pictionary,
  [slope.type]: slope,
  [mazedash.type]: mazedash,
  [gameboy.type]: gameboy,
  [blackjack.type]: blackjack,
  [gomoku.type]: gomoku,
  [dotsboxes.type]: dotsboxes,
  [mancala.type]: mancala,
  [codemaster.type]: codemaster,
  [reversi.type]: reversi,
  [wordsearch.type]: wordsearch,
  [wordscapes.type]: wordscapes,
  [scrabble.type]: scrabble,
  [anagrams.type]: anagrams,
  [wordbites.type]: wordbites,
  [wordhunt.type]: wordhunt,
  [filler.type]: filler,
  [seabattle.type]: seabattle,
  [wordtrails.type]: wordtrails,
  [crossword.type]: crossword,
  [pool.type]: pool,
  [darts.type]: darts,
  [cuppong.type]: cuppong,
  [basketball.type]: basketball,
  [twentyq.type]: twentyq,
  [tanks.type]: tanks,
  [minigolf.type]: minigolf,
  [archery.type]: archery,
  [shuffleboard.type]: shuffleboard,
  [bowling.type]: bowling,
  [knockout.type]: knockout,
  [paintball.type]: paintball,
  [skeeball.type]: skeeball,
  [minesweeper.type]: minesweeper,
  [blockade.type]: blockade,
};

// CPU players for the card games — patches those plugins' onMessage in place (see cardBots.js).
require('./cardBots').installCardBots(registry);

module.exports = registry;
