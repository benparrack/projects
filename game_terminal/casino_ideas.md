# Casino ideas

Backlog for the CASINO tab. Money moves only through the room wallet (`plugin.casino` → `room.wallet`) and the server decides every outcome; the client just animates it.

## Quick bet-then-reveal games
1. **Crash / Rocket** — multiplier climbs from 1.00x, cash out before it crashes. Everyone in the room rides the same rocket. *(built)*
2. **Plinko** — ball down a pegboard into multiplier slots; rows and low/med/high risk. *(built)*
3. **Mines** — 5×5 grid with N bombs, each safe tile raises the multiplier, cash out any time. *(built)*
4. **Scratch cards** — $2/$5/$20 cards scratched with the mouse; maybe a free daily scratcher with the stipend.

## Table games
5. **Craps** — the whole table bets on one shooter's dice; shooter rotates. Start with pass line + odds.
6. **Baccarat** — Player/Banker/Tie, no decisions, dramatic card squeeze. Reuses blackjack's card rendering; fits the high-roller room.
7. **Casino War** — `war` plus a bet and a "go to war" raise on ties.
8. **Three Card Poker / Let It Ride** — poker against the house with a Pair Plus side bet; reuses poker.js's hand evaluator.

## Spectacle / room events
9. **Big Wheel** — one shared wheel in the CASINO lobby every ~30s, bets on 1/2/5/10/20/40x segments. Reuses the roulette wheel canvas.
10. **Horse / hamster racing** — a race every couple of minutes, odds board, photo-finish slow-mo.
11. **Keno / Bingo night** — scheduled live draw where everyone's cards fill at once; hook into weekly.js.

## Economy hooks
12. **Double-or-nothing** — after a big win, offer a coin flip to double it.
13. **Tournaments** — poker sit-and-go, or a timed slots race (most profit in 5 minutes from equal chips); feeds casino leaderboards.
14. **More jobs** besides Diner — bartender drink-mixing, or a croupier job paying out roulette bets against a timer.
