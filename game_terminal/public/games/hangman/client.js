// Hangman — one player picks a word, everyone else guesses letters.
// Server plugin: ../../../server/games/hangman.js (authoritative word, per-recipient masked views).
import { sfx } from '../sfx.js';
import { createBotBar } from '../tickBots.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const GALLOWS = [
  '  +---+\n      |\n      |\n      |\n      |\n      |\n=========',
  '  +---+\n  O   |\n      |\n      |\n      |\n      |\n=========',
  '  +---+\n  O   |\n  |   |\n      |\n      |\n      |\n=========',
  '  +---+\n  O   |\n /|   |\n      |\n      |\n      |\n=========',
  '  +---+\n  O   |\n /|\\  |\n      |\n      |\n      |\n=========',
  '  +---+\n  O   |\n /|\\  |\n /    |\n      |\n      |\n=========',
  '  +---+\n  O   |\n /|\\  |\n / \\  |\n      |\n      |\n=========',
];

export function mount(container, api) {
  let view = null;
  let roster = [];
  let wordRejected = null; // { unknown: [...] } after the server refuses the picker's word
  let draftWord = ''; // the picker's input survives re-renders (roster updates etc.)
  let pickerRevealWord = false;

  function renderLetterGrid(interactive) {
    const guessed = new Set(view.guessedLetters);
    const wrongLetters = new Set(view.guessedLetters.filter((l) => !view.mask.includes(l)));
    const grid = document.createElement('div');
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.gap = '4px';
    grid.style.maxWidth = '420px';
    grid.style.justifyContent = 'center';
    for (const letter of LETTERS) {
      const btn = document.createElement('button');
      btn.textContent = letter;
      btn.style.width = '32px';
      btn.style.fontWeight = 'bold';
      const used = guessed.has(letter);
      btn.disabled = used || !interactive;
      // Strong color-coded state instead of the previous subtle opacity-only dimming (playtest
      // feedback: correct guesses "don't stand out ... needs to be a lot more obvious").
      if (used) {
        const wrong = wrongLetters.has(letter);
        btn.style.background = wrong ? '#4a1414' : '#0f4d1a';
        btn.style.color = wrong ? '#ff6b6b' : '#39ff14';
        btn.style.borderColor = wrong ? '#ff4d4d' : '#39ff14';
        btn.style.opacity = '1';
      }
      if (interactive) btn.addEventListener('click', () => api.sendAction({ kind: 'guessLetter', letter }));
      grid.appendChild(btn);
    }
    return grid;
  }

  // Scoped styles for the scoreboard (kept in this module, not the shared stylesheet).
  const style = document.createElement('style');
  style.textContent = `
    .hm-board { border: 1px solid #1f6b2a; padding: 6px 10px; margin: 4px 0 12px; min-width: 220px; max-width: 420px; width: 100%; box-sizing: border-box; }
    .hm-board h4 { margin: 0 0 4px; font-size: 0.85em; letter-spacing: 2px; opacity: 0.75; font-weight: normal; }
    .hm-row { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
    .hm-row.me { color: #b6ff9e; font-weight: bold; }
    .hm-row .hm-tag { opacity: 0.6; font-size: 0.8em; margin-left: 6px; }
    .hm-row .hm-wins { font-variant-numeric: tabular-nums; }
    .hm-row.lead .hm-wins::before { content: '★ '; color: #ffd84d; }
    .hm-row.flash { animation: hm-flash 1.2s ease-out; }
    @keyframes hm-flash { 0% { background: rgba(57,255,20,0.35); } 100% { background: transparent; } }
    .hm-err { color: #ff4d4d; text-align: center; max-width: 420px; }
  `;
  container.appendChild(style);

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';
  root.style.alignItems = 'center';
  root.style.padding = '12px 8px';
  root.style.width = '100%';
  // Bots can pick the word (solo play) or help guess.
  const botBar = createBotBar(api);
  container.appendChild(botBar.el);
  container.appendChild(root);

  function nicknameFor(clientId) {
    const bot = view && view.bots && view.bots.find((b) => b.clientId === clientId);
    if (bot) return bot.nickname;
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  let lastScores = {};
  function renderScoreboard() {
    const scores = view.scores || [];
    if (!scores.length) return null;
    const board = document.createElement('div');
    board.className = 'hm-board';
    const h = document.createElement('h4');
    h.textContent = 'WINS';
    board.appendChild(h);
    const top = scores[0].wins;
    for (const s of scores) {
      const row = document.createElement('div');
      row.className = 'hm-row';
      if (s.clientId === api.getClientId()) row.classList.add('me');
      if (top > 0 && s.wins === top) row.classList.add('lead');
      if (lastScores[s.clientId] !== undefined && s.wins > lastScores[s.clientId]) row.classList.add('flash');
      const name = document.createElement('span');
      name.textContent = nicknameFor(s.clientId);
      if (s.clientId === view.pickerClientId) {
        const tag = document.createElement('span');
        tag.className = 'hm-tag';
        tag.textContent = 'picking';
        name.appendChild(tag);
      }
      const wins = document.createElement('span');
      wins.className = 'hm-wins';
      wins.textContent = String(s.wins);
      row.appendChild(name);
      row.appendChild(wins);
      board.appendChild(row);
    }
    lastScores = Object.fromEntries(scores.map((s) => [s.clientId, s.wins]));
    return board;
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }
    botBar.update(view.bots || []);

    const gallows = document.createElement('pre');
    gallows.textContent = GALLOWS[Math.min(view.wrongGuesses, GALLOWS.length - 1)];
    gallows.style.margin = '0';
    root.appendChild(gallows);

    const wordLine = document.createElement('div');
    wordLine.style.display = 'flex';
    wordLine.style.alignItems = 'center';
    wordLine.style.flexWrap = 'wrap';
    wordLine.style.justifyContent = 'center';
    wordLine.style.gap = '14px';
    wordLine.style.fontSize = '1.4em';
    if (view.letterCount) {
      // Group blanks per word (splitting on the mask's literal space entries) with a visible
      // divider between groups, instead of one long run of underscores — playtest feedback: a
      // multi-word answer didn't make it obvious there even was a space, let alone where.
      let group = document.createElement('span');
      group.style.letterSpacing = '4px';
      wordLine.appendChild(group);
      for (const ch of view.mask) {
        if (ch === ' ') {
          const divider = document.createElement('span');
          divider.textContent = '/';
          divider.style.opacity = '0.5';
          divider.style.fontSize = '0.8em';
          wordLine.appendChild(divider);
          group = document.createElement('span');
          group.style.letterSpacing = '4px';
          wordLine.appendChild(group);
        } else {
          group.textContent += (ch === null ? '_' : ch) + ' ';
        }
      }
    } else {
      wordLine.textContent = '(no word yet)';
    }
    root.appendChild(wordLine);

    const status = document.createElement('div');
    const countLabel = view.wordCounts.length > 1
      ? `${view.letterCount} letters across ${view.wordCounts.length} words (${view.wordCounts.join(', ')})`
      : `${view.letterCount} letters`;
    status.textContent = view.letterCount
      ? `Wrong guesses: ${view.wrongGuesses} / ${view.maxWrongGuesses} · ${countLabel}`
      : `Wrong guesses: ${view.wrongGuesses} / ${view.maxWrongGuesses}`;
    root.appendChild(status);

    if (view.phase === 'waiting') {
      if (view.isPicker) {
        const form = document.createElement('form');
        form.style.display = 'flex';
        form.style.gap = '8px';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'secret word';
        input.maxLength = 40;
        input.autocomplete = 'off';
        input.spellcheck = true;
        input.lang = 'en';
        input.value = draftWord;
        input.addEventListener('input', () => { draftWord = input.value; wordRejected = null; errEl.hidden = true; });
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'SET WORD';
        form.appendChild(input);
        form.appendChild(submit);
        const errEl = document.createElement('div');
        errEl.className = 'hm-err';
        errEl.hidden = !wordRejected;
        if (wordRejected) {
          const bad = (wordRejected.unknown || []).map((w) => `"${w.toUpperCase()}"`).join(', ');
          errEl.textContent = bad
            ? `${bad} isn't in the dictionary — try another word (multi-word phrases are OK, e.g. "STAR WARS").`
            : 'Not a real word/phrase — try again (multi-word phrases are OK, e.g. "STAR WARS").';
        }
        form.addEventListener('submit', (ev) => {
          ev.preventDefault();
          const word = input.value.trim();
          if (!word) return;
          api.sendAction({ kind: 'setWord', word });
        });
        root.appendChild(form);
        root.appendChild(errEl);
        // Keep focus in the box across re-renders so typing isn't interrupted.
        setTimeout(() => { if (input.isConnected && document.activeElement !== input && !document.activeElement?.matches('input,textarea')) input.focus(); }, 0);
        const hint = document.createElement('div');
        hint.textContent = 'You are picking this round — enter a word for everyone else to guess.';
        root.appendChild(hint);
      } else {
        const waiting = document.createElement('div');
        waiting.textContent = `Waiting for ${nicknameFor(view.pickerClientId)} to pick a word...`;
        root.appendChild(waiting);
      }
    } else if (view.phase === 'guessing') {
      if (view.isPicker) {
        // The picker used to only see "Others are guessing your word" with no letter feedback at
        // all — playtest report: "can't see other person's guesses as word-maker". Now shows the
        // same letter grid the guessers see (read-only: pickers can't click to guess).
        const hint = document.createElement('div');
        hint.textContent = 'Others are guessing your word:';
        root.appendChild(hint);
        root.appendChild(renderLetterGrid(false));

        // The word line above now only shows guess progress (blanks), same as everyone else's
        // screen — both to mirror the live state for the picker and to avoid it being a
        // shoulder-surfing giveaway. This toggle lets the picker peek their own word if they
        // forget it, without leaving it exposed by default.
        const revealBtn = document.createElement('button');
        revealBtn.textContent = pickerRevealWord ? 'HIDE MY WORD' : 'SHOW MY WORD';
        revealBtn.addEventListener('click', () => {
          pickerRevealWord = !pickerRevealWord;
          render();
        });
        root.appendChild(revealBtn);
        if (pickerRevealWord && view.pickerWord) {
          const reveal = document.createElement('div');
          reveal.textContent = view.pickerWord;
          reveal.style.letterSpacing = '4px';
          reveal.style.opacity = '0.85';
          root.appendChild(reveal);
        }
      } else {
        root.appendChild(renderLetterGrid(true));
      }
    } else if (view.phase === 'round_over') {
      const result = document.createElement('div');
      result.style.fontSize = '1.2em';
      result.textContent = view.result === 'win' ? 'SOLVED! 🎉' : 'OUT OF GUESSES 💀';
      root.appendChild(result);
      if (view.roundWinner) {
        const who = document.createElement('div');
        const me = view.roundWinner === api.getClientId();
        who.textContent = view.result === 'win'
          ? `${me ? 'You' : nicknameFor(view.roundWinner)} solved it — +1 win`
          : `${me ? 'You' : nicknameFor(view.roundWinner)} stumped the room — +1 win`;
        who.style.color = me ? '#b6ff9e' : '';
        root.appendChild(who);
      }

      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'NEXT ROUND';
      nextBtn.addEventListener('click', () => api.sendAction({ kind: 'nextRound' }));
      root.appendChild(nextBtn);
    }

    const board = renderScoreboard();
    if (board) root.appendChild(board);
  }

  function onKeydown(ev) {
    if (!view || view.phase !== 'guessing' || view.isPicker) return;
    const letter = ev.key.toUpperCase();
    if (LETTERS.includes(letter)) api.sendAction({ kind: 'guessLetter', letter });
  }
  document.addEventListener('keydown', onKeydown);

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prevView = view;
        view = data.view;
        if (prevView && view) {
          if (view.result && !prevView.result) sfx.play(view.isPicker ? (view.result === 'win' ? 'lose' : 'win') : view.result);
          else if (view.wrongGuesses > prevView.wrongGuesses) sfx.play('error');
          else if (view.mask !== prevView.mask && JSON.stringify(view.mask) !== JSON.stringify(prevView.mask)) sfx.play('point');
        }
        if (view && view.phase !== 'waiting') { wordRejected = null; draftWord = ''; }
        render();
      } else if (data.kind === 'wordRejected') {
        wordRejected = { unknown: Array.isArray(data.unknown) ? data.unknown : [] };
        sfx.play('error');
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      document.removeEventListener('keydown', onKeydown);
      container.innerHTML = '';
    },
  };
}
