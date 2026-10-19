// How-to-play text for every hub game type, shown in the "i" info popover. Plain data only:
// facts come from each game's server/games/<type>.js rules and its client hint text.
export const HOWTO = {
  anagrams: {
    about: 'Everyone gets the same six letters and 60 seconds to make as many words as they can.',
    rules: [
      'Make words of 3-6 letters from the six letters; each player keeps their own list.',
      'Scoring by length: 3 letters = 100, 4 = 400, 5 = 1200, 6 = 2000.',
      'Two players can both score the same word; there is always at least one 6-letter answer.',
      'Highest total when the clock runs out wins; all answers are revealed at the end.',
    ],
    controls: [
      'Tap the tiles or type letters to spell a word; ENTER submits.',
      'SPACE shuffles the letters, BACKSPACE undoes a letter, ESC clears.',
    ],
  },
  archery: {
    about: 'Two archers shoot at a 122 cm target 70 m away, fighting sway and wind.',
    rules: [
      '5 ends of 3 arrows each; the end\'s opener shoots all three first, and the opener alternates.',
      'Rings score 10 down to 1; an X (inner ten) scores 10; a miss scores 0.',
      'Wind changes every arrow; each mph of wind moves the arrow about half a ring.',
      'Highest total after five ends wins; a tie goes to a one-arrow shoot-off, closest to centre.',
    ],
    controls: [
      'Press and hold anywhere on the range to draw; drag to move the sight.',
      'Release when the sight is steady (green) — sway is calmest after ~1.3 s, then the arm tires.',
      'ESC cancels a shot while drawing.',
    ],
  },
  backgammon: {
    about: 'Classic backgammon for two: race all 15 of your checkers around the board and off.',
    rules: [
      'Roll the dice and move checkers by each die; a point held by 2+ enemy checkers is blocked.',
      'Landing on a lone enemy checker sends it to the bar; it must re-enter before anything else moves.',
      'Once all your checkers are in your home board you can bear them off.',
      'First to bear off all 15 checkers wins; no doubling cube or gammon scoring.',
    ],
    controls: [
      'Click a die to arm it (auto-armed if only one value is left).',
      'Then click the point (or bar pile) to move a checker from there by that die.',
    ],
  },
  basketball: {
    about: 'A 2-player shootout: each player gets a 30-second run at a hoop, shooting as fast as balls roll in.',
    rules: [
      'A make scores 2, a swish 3; every 5th ball of the rack is a money ball (x2).',
      'Three makes in a row sets you ON FIRE: x2 until you miss.',
      'After 5 makes the hoop starts sliding side to side; after 12 it speeds up.',
      'Highest total after both runs wins; ties go to 15 s overtime runs (up to 3, then a draw).',
      'Red shoots first; a rematch swaps colours.',
    ],
    controls: [
      'Flick up from anywhere on the court and let go: sideways aims, a longer flick shoots harder.',
      'You can have several balls in the air at once.',
    ],
  },
  blackjack: {
    about: 'Casino blackjack for 1-6 seats against the house dealer.',
    rules: [
      'Get closer to 21 than the dealer without going over; blackjack pays 3:2.',
      '6-deck shoe; the dealer stands on soft 17 and peeks for blackjack.',
      'Double on any first two cards, split pairs up to 4 hands, insurance 2:1 vs a dealer ace.',
      'Everyone starts with 1000 chips; a free rebuy is offered when you go broke.',
    ],
    controls: [
      'Bet with the chip buttons, then DEAL (Space/Enter).',
      'HIT / STAND / DOUBLE / SPLIT buttons, or keys H, S, D, P.',
      'HINTS toggles basic-strategy advice.',
    ],
  },
  bowling: {
    about: 'Ten-pin bowling for two players, ten frames each with real pin physics.',
    rules: [
      'Players alternate whole frames; p1 bowls first and a rematch swaps who opens.',
      'Standard scoring: strike = 10 + next two balls, spare = 10 + next ball.',
      'The 10th frame gives bonus balls for a spare (one) or strike (two).',
      'Highest total after ten frames wins; a tie is a draw.',
    ],
    controls: [
      'Press and slide sideways: the ball follows your finger along the foul line.',
      'Flick up toward the pins and let go: the ball rolls where you flicked; a faster flick rolls faster.',
      'Curve the flick to hook it (bow out left, sweep back right = hooks right). A faint dotted line previews the path.',
    ],
  },
  bs: {
    about: 'BS (Cheat) for 2-6 players: get rid of your cards by bluffing about what you play.',
    rules: [
      'The whole deck is dealt; ranks must be played in order A, 2, 3 ... K, then cycling.',
      'On your turn play 1-4 cards face down, claiming they are the required rank.',
      'Anyone can CALL BS: if it was a lie the player takes the pile, otherwise the caller does.',
      'First to empty their hand with a play that stands (unchallenged or defended) wins.',
    ],
    controls: [
      'Click cards to select them, then PLAY to claim them as the required rank.',
      'CALL BS! to challenge, or LET IT RIDE to accept the play.',
    ],
  },
  checkers: {
    about: 'American checkers (draughts) for two players on an 8x8 board.',
    rules: [
      'Men move and capture diagonally forward only; kings move and capture both ways.',
      'Captures are mandatory, and multi-jumps must be continued to the end.',
      'A man reaching the far row becomes a king.',
      'You win by capturing or blocking all of your opponent\'s pieces.',
    ],
    controls: [
      'Click a piece to see its legal moves, then click the destination square.',
    ],
  },
  chess: {
    about: 'Full-rules chess for two players, with an optional game clock.',
    rules: [
      'Standard moves including castling, en passant and promotion.',
      'Games end by checkmate, stalemate (a draw), resignation or running out of time.',
      'No 50-move or repetition draws.',
      'An optional time control can be set for the room before the game.',
    ],
    controls: [
      'Click a piece, then click its destination square.',
      'You can queue a premove while it\'s the opponent\'s turn; FLIP BOARD changes the view.',
    ],
  },
  codemaster: {
    about: 'Codebreaker: crack a hidden code of 4 pegs in 6 colours within 10 guesses.',
    rules: [
      'Each guess gets GREEN pegs (right colour, right spot) and YELLOW pegs (right colour, wrong spot).',
      'DUEL: each seat sets a code for the other; solving beats not solving, then fewer guesses, then speed.',
      'RACE: the computer sets one code and everyone cracks it on their own board.',
      'CO-OP: the computer sets a code and everyone shares one board.',
    ],
    controls: [
      'Pick colours from the palette (or keys 1-6); tap a filled slot to clear it.',
      'Enter submits the guess.',
    ],
  },
  connect4: {
    about: 'Four in a Row for two players on a 7-wide, 6-tall grid.',
    rules: [
      'Players take turns dropping a disc into a column; it falls to the lowest empty row.',
      'First to get 4 in a row — across, down or diagonally — wins.',
      'A full board with no four is a draw.',
    ],
    controls: [
      'Click the drop button above a column to play there.',
    ],
  },
  crazyeights: {
    about: 'Crazy Eights for 2-6 players: shed your hand by matching the discard pile.',
    rules: [
      'Everyone is dealt 5 cards; turns go in seat order.',
      'Play a card matching the top discard by rank or suit.',
      'Eights are wild: play one any time and choose the next suit.',
      'Nothing playable? Draw until you can play, or pass. First to empty their hand wins.',
    ],
    controls: [
      'Click a card in your hand to play it (an 8 asks for a suit).',
      'DRAW when stuck, then PLAY the drawn card or PASS.',
    ],
  },
  crossword: {
    about: 'Generated crosswords with real clues, solved together or as a race.',
    rules: [
      'Pick MINI, MEDIUM or LARGE; answers are everyday 3-7 letter words.',
      'CO-OP: one shared grid; finishing a word credits it to you, +1 point per letter.',
      'RACE: everyone solves their own copy of the same puzzle; first to finish wins.',
      'A word locks once every letter is right; a wrong full word is flagged but not which letter.',
      'Up to 3 hints per puzzle, each reveals a letter and costs 1 point.',
    ],
    controls: [
      'Click a cell and type; click it again or press Space to switch direction.',
      'Tab / Shift+Tab: next / previous clue; arrows move; Backspace erases.',
    ],
  },
  cuppong: {
    about: 'Cup Pong for two: throw balls into your opponent\'s 10-cup triangle.',
    rules: [
      'You get two throws a turn; each sunk cup is removed.',
      'Sink both throws and you get BALLS BACK — two more throws.',
      'Optional re-racks tighten the formation at 6, 3, 2 or 1 cups left.',
      'Clear all of the opponent\'s cups to win. Red throws first; a rematch swaps colours.',
    ],
    controls: [
      'Pull down from anywhere on the table and let go, like a slingshot: pull left to aim right (and vice versa), a longer pull throws harder.',
    ],
  },
  darts: {
    about: 'Two-player darts: 501 double-out, 301 straight-out, or Cricket.',
    rules: [
      'Three darts a turn; p1 throws first and a rematch swaps who opens.',
      '501: finish exactly on zero with a double. 301: any exact finish.',
      'Busting (below zero, or 1 left / no double in 501) cancels the turn\'s score.',
      'Cricket: three marks closes 15-20 or bull; extra marks score while the opponent has it open.',
      'Game stops after 20 rounds: lowest remaining (01) or most points (Cricket) wins.',
    ],
    controls: [
      'Grab below the board, line up under your target and flick UP; let go while still moving.',
      'Where you let go sets left/right. Flick speed sets height: too slow drops low, too fast flies high.',
      'Lean or curve in the flick pushes the dart wide. After each dart you see its speed/lean/curve.',
    ],
  },
  dotsboxes: {
    about: 'Dots and Boxes for 2-4 players on a 4x4, 5x5 or 6x6 box grid.',
    rules: [
      'Take turns drawing one line between two adjacent dots.',
      'Draw the fourth side of a box to claim it — then you must move again.',
      'When every box is claimed, the most boxes wins (ties share the win).',
    ],
    controls: [
      'Tap or click between two dots to draw that line.',
      'Pick the board size while waiting to start.',
    ],
  },
  drawing: {
    about: 'A shared canvas everyone in the room can draw on together — no score, just doodling.',
    rules: [
      'Everything drawn appears live for everyone in the room.',
      'UNDO and CLEAR MINE only affect your own strokes.',
    ],
    controls: [
      'Drag on the canvas to draw; pick a colour swatch and a SIZE.',
      'ERASER and FILL (flood fill) tools, plus UNDO and CLEAR MINE.',
    ],
  },
  filler: {
    about: 'Filler for two: grow your corner region by switching colours to swallow the board.',
    rules: [
      'P1 starts bottom-left, P2 top-right on an 8x7 board of six colours.',
      'On your turn pick a colour; your region turns that colour and absorbs every touching cell of it.',
      'Both players\' current colours are locked and can\'t be picked.',
      'Own more than half the board to win.',
    ],
    controls: [
      'Click a colour button under the board; hovering one previews how many cells (+N) it captures.',
    ],
  },
  gameboy: {
    about: 'A retro handheld emulator room (Game Boy and Game Boy Color compatible): play bundled homebrew or your own ROM.',
    rules: [
      'Pick a game from the bundled library, or OPEN ROM FILE to load your own .gb/.gbc.',
      'Everyone plays locally; the room list shows who is playing what.',
      'WATCH anyone playing a bundled game to spectate it live (custom ROMs stay private).',
      'LINK with another player for a 2-player link-cable game (e.g. Link Cycles); they must ACCEPT.',
      'Battery saves are kept in your browser; SAVE ST / LOAD ST handle save states.',
    ],
    controls: [
      'Arrows/WASD move · X or K = A · Z or J = B · ENTER = Start · SHIFT = Select.',
      'Hold SPACE to fast-forward, hold R to rewind, P pauses, F5/F8 save/load state.',
    ],
  },
  garticphone: {
    about: 'Drawing telephone for 3-8 players: prompts turn into drawings and back into guesses.',
    rules: [
      'Round 1: everyone writes a secret prompt that starts their own book.',
      'Each round every book passes one seat over; you draw or describe only the previous entry.',
      'Rounds alternate drawing and guessing until every book has visited every player.',
      'Then all the chains are revealed to everyone — no points, just the laughs.',
    ],
    controls: [
      'Type your prompt or guess and press SUBMIT.',
      'Draw on the canvas, then DONE — SUBMIT DRAWING.',
    ],
  },
  gomoku: {
    about: 'Gomoku (five in a row) on a 15x15 board.',
    rules: [
      'Players place stones on the intersections in turn; black moves first.',
      'Five or more in a row — across, down or diagonally — wins.',
      'A full board with no five is a draw.',
    ],
    controls: [
      'Click an intersection to place a stone (a ghost stone shows where it will go).',
    ],
  },
  hangman: {
    about: 'One player picks a secret word or phrase; everyone else guesses it letter by letter.',
    rules: [
      'The picker enters a real word or phrase; bots can pick so you can play solo.',
      'Guessers call letters; 6 wrong guesses and the guessers lose.',
      'Solved: the guesser who revealed the final letter gets the win.',
      'Out of guesses: the picker gets the win. The picker role rotates each round.',
    ],
    controls: [
      'Picker: type the word and press SET WORD.',
      'Guessers: click a letter button or type a letter.',
    ],
  },
  hearts: {
    about: 'Hearts for 4 players: avoid taking hearts and the queen of spades.',
    rules: [
      'Each hand pass 3 cards (left, right, across, then no pass, repeating).',
      'Follow suit; hearts can\'t be led until broken; no points on the first trick.',
      'Each heart = 1 point, queen of spades = 13; take all 26 to shoot the moon (others +26).',
      'Game ends when someone passes 100; the lowest score wins.',
    ],
    controls: [
      'Sit down, then START GAME once all 4 seats are full.',
      'Click 3 cards to pass, then click a legal card to play it on your turn.',
    ],
  },
  knockout: {
    about: 'Penguin sumo for two: shove the other side\'s penguins off a shrinking ice floe.',
    rules: [
      'Both players plan at the same time (20 s): set an arrow for each of your penguins.',
      'Arrows stay secret until both lock in; then every penguin slides at once.',
      'Penguins knocked into the water are out; the floe shrinks every 2nd round.',
      'Last side with penguins wins; both wiped out = draw; after 24 rounds more penguins wins.',
    ],
    controls: [
      'Drag out from a penguin to aim it — longer arrow = harder shove; drag back onto it to clear.',
      'Press LOCK IN when ready (unlocked arrows still count at the buzzer).',
    ],
  },
  mancala: {
    about: 'Mancala (Kalah) for two: 6 pits a side with 4 stones each.',
    rules: [
      'Pick one of your pits and sow its stones counter-clockwise, one per pit, skipping their store.',
      'Last stone in your store = another turn.',
      'CAPTURE mode: last stone in your own empty pit takes it plus the opposite pit.',
      'AVALANCHE mode: last stone in a non-empty pit picks that pit up and keeps sowing (no captures).',
      'When either row runs empty, each side banks its row; most stones wins.',
    ],
    controls: [
      'Click one of your pits (or press 1-6); hovering previews where the last stone lands.',
    ],
  },
  mazedash: {
    about: 'A maze speedrun: everyone races the same randomly generated 15x15 maze.',
    rules: [
      'Start in the top-left; the exit is in the bottom-right.',
      'You move one cell at a time and walls block you.',
      'First to reach the exit wins; rounds are capped at 3 minutes.',
    ],
    controls: [
      'Arrow keys or WASD move one cell.',
    ],
  },
  minigolf: {
    about: 'Mini golf for two over 9 handcrafted holes with bumpers, water, slopes and windmills.',
    rules: [
      'Both balls play the same hole; putts alternate stroke by stroke.',
      'Water = +1 stroke and a retry from where you hit.',
      'Windmills and sliders knock resting balls too — no stroke for that (knocked into water: dropped nearby, no penalty).',
      '6 strokes max per hole — miss the 6th and you score 7.',
      'Lowest total after 9 holes wins; the lower score on the last hole tees off first.',
    ],
    controls: [
      'Press anywhere on the course and drag BACK like a slingshot; the dotted line shows aim and power.',
      'Let go to putt; drag back to the start to cancel.',
    ],
  },
  paintball: {
    about: 'A shooting-gallery duel: each player gets one 45-second run at the same pop-up targets.',
    rules: [
      'Bandits score — more for far rows, moving targets and head shots; gold stars are 500.',
      'Hitting a civilian costs 300.',
      '8 paintballs per hopper, and you must reload manually.',
      'Highest score after both runs wins.',
    ],
    controls: [
      'Click or tap to fire.',
      'Reload with R, right-click, or the RELOAD button.',
    ],
  },
  pictionary: {
    about: 'Sketch & Guess: one player draws a secret word while everyone else races to guess it.',
    rules: [
      'The drawer rotates each round and picks a word (15 s, or one is picked for them).',
      'Rounds last 80 seconds; guesses go into the chat log.',
      'First correct guess scores 3, later correct guesses 1.',
      'The drawer gets 2 bonus points when someone first guesses it.',
    ],
    controls: [
      'Drawer: click a word choice, then drag on the canvas to draw.',
      'Guessers: type a guess and press GUESS (or Enter).',
    ],
  },
  poker: {
    about: 'Texas Hold\'em for 2-6 players with fixed 10/20 blinds.',
    rules: [
      'Everyone starts with 1000 chips; stacks carry over hand to hand.',
      'Two hole cards each plus five shared cards; best 5-card hand wins the pot.',
      'Minimum raise is the current bet plus one big blind; side pots handle all-ins.',
      'The game ends when only one player still has chips.',
    ],
    controls: [
      'Sit down, then START GAME with 2+ players.',
      'FOLD, CHECK / CALL, RAISE TO (set the amount) or ALL IN on your turn.',
    ],
  },
  pool: {
    about: 'Pool for two: 8-Ball (solids/stripes) or 9-Ball.',
    rules: [
      '8-Ball: groups are set by the first ball legally potted; pot your group, then the 8.',
      'Potting the 8 early or on a foul loses.',
      '9-Ball: always hit the lowest ball first; whoever legally pots the 9 wins.',
      'Any foul (scratch, no hit, wrong ball first, no cushion) gives the opponent ball in hand.',
      'No called pockets, push-outs or three-foul rule.',
    ],
    controls: [
      'Click/drag on the table to aim; ←/→ fine-tune (Shift = finer).',
      'Drag along the power bar (below the table) and release to shoot (or ↑/↓ then Space); set spin on the cue-ball widget.',
      'With ball in hand, drag the cue ball to place it.',
    ],
  },
  reversi: {
    about: 'Reversi for two on an 8x8 board.',
    rules: [
      'Black moves first; each move must outflank at least one line of enemy discs, which flip.',
      'A player with no legal move passes automatically.',
      'When neither side can move, the most discs wins (empty squares go to the winner).',
      'A rematch swaps colours.',
    ],
    controls: [
      'Click a square with a dot to place a disc; hover previews which discs flip.',
    ],
  },
  scrabble: {
    about: 'Word Tiles for 2-4 players: build crossing words on a 15x15 board with bonus squares.',
    rules: [
      'Place tiles in one line to form words; every cross-word formed also scores.',
      'Premium squares count only for newly placed tiles; using all 7 tiles is a 50-point bingo.',
      'You can exchange (needs 7+ tiles in the bag) or pass instead of playing.',
      'Ends when someone goes out with the bag empty, or after six scoreless turns in a row.',
      'Leftover rack values are subtracted (and added to whoever went out). Highest score wins.',
    ],
    controls: [
      'Drag tiles from your rack to the board, or tap a tile then tap a square.',
      'Tap a pending tile to take it back; blanks ask for a letter; SUBMIT plays the word.',
    ],
  },
  seabattle: {
    about: 'Battleship for two: hide your fleet and sink the enemy\'s first.',
    rules: [
      'Each admiral hides five ships (5, 4, 3, 3, 2) on a private 10x10 grid; ships may touch.',
      'Take turns firing at the enemy grid.',
      'A hit lets you fire again; a miss passes the turn. Sunk ships are revealed.',
      'First to sink the whole enemy fleet wins.',
      'Optional POWERS (either player can switch them on before the battle; off by default): Barrage fires at every unshot cell of one row or column (first on your 10th turn, then every 12 turns); Radar shows which cells of a 2x2 area hold a ship, without hitting them (first on your 5th turn, then every 9). Using a power ends your turn. Only you see your radar readings; your opponent sees where you scanned.',
    ],
    controls: [
      'Placing: drag ships to move them; tap a ship then tap again (or R / ROTATE) to rotate.',
      'RANDOMIZE for a random layout, then READY. Tap POWERS: ON/OFF to change the rule (both players must re-ready).',
      'Battle: click a cell on the enemy grid to fire. Your own fleet shows every incoming shot live, and the ship they hit.',
      'Powers: press BARRAGE or RADAR, hover to preview the target, click to use it (touch: tap to preview, tap again to fire). R flips Barrage between row and column; Esc cancels.',
    ],
  },
  shooter: {
    about: 'A round-based 1v1 first-person arena duel.',
    rules: [
      'Each player has 100 health and there are no respawns mid-round.',
      'Eliminate your opponent to win the round.',
      'First to 3 round wins takes the match.',
      'Three weapons: pistol, shotgun and sniper.',
    ],
    controls: [
      'Click to lock the mouse and aim; WASD to move; left-click fires, hold right-click to scope.',
      'Space jump · C crouch · Left Shift slide · R reload · V third person · 1-3 weapons.',
      'Keys and mouse sensitivity can be rebound in the settings.',
    ],
  },
  shuffleboard: {
    about: 'Table shuffleboard for two: slide pucks to the far end without falling off.',
    rules: [
      'Each round both players alternate sliding 4 pucks; the leader shoots first, the other has the hammer.',
      'Pucks resting short of the red foul line are removed.',
      'Only the player with the furthest puck scores: 1/2/3 by zone, 4 for a hanger over the edge.',
      'They score each of their pucks beyond the opponent\'s best one.',
      'First to the target (15 or 21) wins; the round\'s scorer leads the next round.',
    ],
    controls: [
      'Drag sideways to place your puck, then FLICK UP and let go while still moving: tilt aims, flick speed is power.',
      'Stop before letting go to cancel the shot.',
    ],
  },
  skeeball: {
    about: 'Alley Ball for two on one shared arcade lane.',
    rules: [
      'Each player rolls 9 balls in three rounds of three, alternating red then blue.',
      'Rings score 10-50, the two corner pockets 100, anything else 0.',
      'Highest total wins; a tie goes to sudden death (one ball each, up to 3 times, then a draw).',
      'Red rolls first; a rematch swaps colours.',
    ],
    controls: [
      'Drag up from anywhere on the lane and let go: sideways aims, a longer drag rolls harder.',
    ],
  },
  slither: {
    about: 'A Slither.io-style arena: steer your snake, eat orbs and grow.',
    rules: [
      'Eat orbs to grow longer and thicker.',
      'Hitting a wall or another snake\'s body ends your snake.',
      'Boosting is faster but costs length.',
      'Play continues as long as you like — try to become the biggest snake.',
    ],
    controls: [
      'Steer with the mouse (or drag on touch).',
      'Boost: click, hold Space, or the boost button.',
    ],
  },
  slope: {
    about: 'A downhill ball run: everyone races the same seeded neon track, which gets harder and faster.',
    rules: [
      'Roll as far as you can, dodging blocks and jumping gaps; boost pads speed you up.',
      'Falling off the track ends your run.',
      'Your score is the distance travelled; the room keeps a board of best runs.',
      'Other riders appear as ghosts on the same track.',
    ],
    controls: [
      '← → or A / D to steer; on touch, tap the left or right side.',
      'N toggles player names.',
    ],
  },
  spades: {
    about: 'Spades for 4 players in fixed partnerships (North/South vs East/West).',
    rules: [
      'Each player bids 0-13 tricks (0 = NIL); spades are always trump.',
      'Follow suit; spades can\'t be led until broken.',
      'Made bid = 10 x bid + 1 per overtrick (bag); a failed bid loses 10 x bid.',
      'Nil made = +100, failed = -100; every 10 bags costs 100.',
      'First team to 500 wins.',
    ],
    controls: [
      'Pick your bid when it\'s your turn to bid.',
      'Click a legal card in your hand to play it.',
    ],
  },
  tanks: {
    about: 'A side-view artillery duel on a destructible hillside.',
    rules: [
      'Each turn you may drive with that turn\'s fuel, aim, choose a weapon and fire.',
      'Shell is unlimited; Big Shot, Triple and Bouncer have 2 rounds each. Wind changes every turn.',
      'Triple flies as one shell and splits into three at the top of its arc, so it spreads right over the target.',
      'Blasts carve craters, and tanks that fall a long way take damage.',
      'First tank to 0 HP loses; after 30 shots in total the healthier tank wins.',
    ],
    controls: [
      'Tap or drag on the battlefield to aim (direction = angle, distance = power).',
      '←/→ angle, ↑/↓ power, hold A/D or ◀ ▶ to drive, 1-4 weapon, SPACE fires.',
    ],
  },
  tron: {
    about: 'Light cycles: your cycle leaves a solid trail — be the last one riding.',
    rules: [
      'A round starts once 2+ players are here.',
      'Cycles move constantly; crashing into a wall, any trail (yours too) or a player knocks you out.',
      'Last cycle alive wins the round.',
    ],
    controls: [
      'Steer with the arrow keys or WASD; touchscreens get an on-screen pad.',
    ],
  },
  twentyq: {
    about: '20 Questions for two: one picks a secret word, the other asks yes/no questions to find it.',
    rules: [
      'The picker chooses one of three suggested words (or their own); its category is shown as a hint.',
      'The guesser asks free-text questions, answered YES / NO / SOMETIMES / DON\'T KNOW.',
      'A guess can be made any time but counts as a question; 20 questions max.',
      'Solving on question n scores 21 - n; stumping the guesser scores the picker 10.',
      'A match is two rounds — roles swap.',
    ],
    controls: [
      'Guesser: type a question or a guess and send it.',
      'Picker: tap YES, NO, SOMETIMES or DON\'T KNOW to answer.',
    ],
  },
  war: {
    about: 'The card game War for exactly 2 players — pure luck, no decisions.',
    rules: [
      'The deck is split evenly; each round both flip their top card and the higher rank takes both.',
      'A tie is a war: each burns one card face down and flips again until it resolves.',
      'Running out of cards (even mid-war) loses.',
    ],
    controls: [
      'Click FLIP each round.',
    ],
  },
  wordbites: {
    about: 'Word Bites: slide letter pieces around your own board to build words in 80 seconds.',
    rules: [
      'Everyone gets the same pieces on a private 8x9 board: single letters and horizontal/vertical pairs.',
      'Pieces don\'t rotate; words read left-to-right or top-to-bottom.',
      'Each new word of 3+ letters scores: 3=100, 4=400, 5=800, 6=1400, 7=1800, 8+=2200.',
      'Highest total after 80 seconds wins.',
    ],
    controls: [
      'Drag pieces to new spots on the board; words score as soon as you drop them.',
    ],
  },
  wordhunt: {
    about: 'Word Hunt: find words in the same 4x4 letter grid as everyone else in 80 seconds.',
    rules: [
      'Chain touching letters in any direction, each tile once per word, for words of 3+ letters.',
      'Scoring: 3=100, 4=400, 5=800, 6=1400, 7=1800, 8+=2200.',
      'Everyone keeps their own list; highest score wins.',
      'At the end every word in the grid is revealed.',
    ],
    controls: [
      'Swipe (mouse or finger) through the letters and let go to submit the word.',
    ],
  },
  wordscapes: {
    about: 'Word Wheel: spell words from a letter wheel to fill a small crossword.',
    rules: [
      'The wheel has 5-7 letters; the crossword holds 5-12 target words made from them.',
      'Target words fill the crossword and score their length; other real words are bonus words (+1).',
      'CO-OP: one shared crossword, each word credited to its finder. RACE: first to fill your own wins.',
      'Hints reveal a letter for 2 points; every 5 bonus words earns another hint.',
      'The room moves through levels together and the wheel grows from 5 to 7 letters.',
    ],
    controls: [
      'Drag across the wheel letters, tap them, or type; Enter submits, Backspace undoes.',
    ],
  },
  wordsearch: {
    about: 'Word Search race: everyone hunts the same hidden words in one shared grid.',
    rules: [
      'Grids are 10x10 (9 words, 4 min), 12x12 (12 words, 5 min) or 15x15 (15 words, 7 min).',
      'Words run in any of 8 directions, forwards or backwards.',
      'The first player to find a word claims it; longer words score more.',
      'The round ends when every word is found or time runs out; highest score wins.',
    ],
    controls: [
      'Drag from a word\'s first letter to its last.',
    ],
  },
  wordtrails: {
    about: 'Word Trails: a last-letter word chain — keep the trail going before your clock runs out.',
    rules: [
      'Each word must start with the last letter of the previous word; no repeats.',
      'Words must be real and at least the room\'s minimum length (3, 4 or 5).',
      'Running out of time costs a life. Any number of players (and bots) can join.',
      'A wrong word costs no life, just 2 seconds off your clock.',
      'Last player with lives left wins; solo, it\'s a survival run.',
    ],
    controls: [
      'Type your word and press Enter on your turn.',
    ],
  },
  minesweeper: {
    about: 'Minesweeper as a head-to-head race: both players sweep the same hidden minefield at the same time.',
    rules: [
      'Both boards have the same mines and start from the same opened patch. Clear every safe cell before your opponent does.',
      'Numbers count the mines touching that cell (including diagonals).',
      'Opening a mine doesn\'t end your game, but it freezes you for 5 seconds and marks the mine.',
      'You only see your opponent\'s progress bar (cleared %, mines hit, flags), not their board.',
      'Pick Small (9×9, 10 mines), Medium (16×16, 40) or Large (30×16, 99) between races, or any time vs a bot (restarts).',
    ],
    controls: [
      'Click a cell to open it. Click a number whose mines are all flagged to open all of its other neighbours at once.',
      'Right-click (or long-press on touch, or turn on FLAG MODE) to place or remove a flag.',
    ],
  },
  blockade: {
    about: 'Blockade, the 1975 board game: race your pawns into the enemy base while walling off theirs.',
    rules: [
      'Each player has two pawns starting on their two home squares (★). Your goal is to reach EITHER of the opponent\'s home squares with either pawn.',
      'On your turn, move one pawn 1 or 2 squares up/down/left/right (it can turn a corner and pass over pawns, but not cross walls or stop on a pawn).',
      'Then place one wall (2 squares long) in the grooves between squares. You have 9 horizontal and 9 vertical walls. Once you run out, you just move.',
      'Walls can\'t overlap or cross, and can never completely cut any pawn off from its goals. Detours are fine; dead ends aren\'t.',
    ],
    controls: [
      'Click one of your pawns, then a highlighted square (or just click a square only one pawn can reach).',
      'Wall step: hover a groove to preview; the wall follows the groove under the pointer. Right-click or R rotates it; click to place.',
      'Touch: tap a groove to preview, then tap again or press PLACE WALL (ROTATE flips it).',
    ],
  },
};
