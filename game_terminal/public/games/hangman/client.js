// Hangman — one player picks a word, everyone else guesses letters.
// Server plugin: ../../../server/games/hangman.js (authoritative word, per-recipient masked views).

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

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';
  root.style.alignItems = 'center';
  root.style.width = '100%';
  container.appendChild(root);

  function nicknameFor(clientId) {
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const gallows = document.createElement('pre');
    gallows.textContent = GALLOWS[Math.min(view.wrongGuesses, GALLOWS.length - 1)];
    gallows.style.margin = '0';
    root.appendChild(gallows);

    const wordLine = document.createElement('div');
    wordLine.style.fontSize = '1.4em';
    wordLine.style.letterSpacing = '4px';
    wordLine.textContent = view.wordLength
      ? view.mask.map((ch) => (ch === null ? '_' : ch)).join(' ')
      : '(no word yet)';
    root.appendChild(wordLine);

    const status = document.createElement('div');
    status.textContent = `Wrong guesses: ${view.wrongGuesses} / ${view.maxWrongGuesses}`;
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
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'SET WORD';
        form.appendChild(input);
        form.appendChild(submit);
        form.addEventListener('submit', (ev) => {
          ev.preventDefault();
          const word = input.value.trim();
          if (!word) return;
          api.sendAction({ kind: 'setWord', word });
        });
        root.appendChild(form);
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
        const hint = document.createElement('div');
        hint.textContent = 'Others are guessing your word.';
        root.appendChild(hint);
      } else {
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
          const used = guessed.has(letter);
          btn.disabled = used;
          if (used) btn.style.opacity = wrongLetters.has(letter) ? '0.4' : '0.8';
          btn.addEventListener('click', () => api.sendAction({ kind: 'guessLetter', letter }));
          grid.appendChild(btn);
        }
        root.appendChild(grid);
      }
    } else if (view.phase === 'round_over') {
      const result = document.createElement('div');
      result.style.fontSize = '1.2em';
      result.textContent = view.result === 'win' ? 'SOLVED! 🎉' : 'OUT OF GUESSES 💀';
      root.appendChild(result);

      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'NEXT ROUND';
      nextBtn.addEventListener('click', () => api.sendAction({ kind: 'nextRound' }));
      root.appendChild(nextBtn);
    }
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
      if (data && data.kind === 'state') {
        view = data.view;
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
