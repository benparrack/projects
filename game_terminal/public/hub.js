import { ClientMessage, ServerMessage, makeEnvelope, publicRoomCode } from './protocol.js';

// Games available in the hub menu, grouped into collapsible categories. Adding a new mini-game
// means one entry here (in whichever category fits, or a new category) plus a matching
// public/games/<type>/client.js module — nothing else in hub.js changes.
const CATEGORIES = [
  {
    name: 'CARD GAMES',
    games: [
      { type: 'war', label: 'WAR' },
      { type: 'crazyeights', label: 'CRAZY EIGHTS' },
      { type: 'bs', label: 'BS (CHEAT)' },
      { type: 'poker', label: 'POKER (TEXAS HOLD\'EM)' },
      { type: 'spades', label: 'SPADES' },
      { type: 'hearts', label: 'HEARTS' },
    ],
  },
  {
    name: 'BOARD GAMES',
    games: [
      { type: 'checkers', label: 'CHECKERS' },
      { type: 'chess', label: 'CHESS' },
      { type: 'connect4', label: 'CONNECT 4' },
      { type: 'backgammon', label: 'BACKGAMMON' },
    ],
  },
  {
    name: 'ARENA & REAL-TIME',
    games: [
      { type: 'slither', label: 'SLITHER' },
      { type: 'tron', label: 'TRON (LIGHT CYCLES)' },
      { type: 'shooter', label: 'ARENA DUEL (1V1 FPS)' },
      { type: 'slope', label: 'SLOPE (3D RUNNER)' },
      { type: 'mazedash', label: 'MAZE DASH (SPEEDRUN)' },
    ],
  },
  {
    name: 'PARTY & DRAWING',
    games: [
      { type: 'drawing', label: 'SHARED DRAWING CANVAS' },
      { type: 'hangman', label: 'HANGMAN' },
      { type: 'pictionary', label: 'PICTIONARY' },
      { type: 'garticphone', label: 'DRAWING PHONE' },
    ],
  },
];

// Flat list, derived from CATEGORIES — everything below that just needs "all games" (initial
// selection, session restore) keeps working unchanged without knowing about categories.
const GAMES = CATEGORIES.flatMap((cat) => cat.games);

const SESSION_KEY = 'game_terminal.session';

const els = {
  status: document.getElementById('status'),
  screenNickname: document.getElementById('screen-nickname'),
  screenMenu: document.getElementById('screen-menu'),
  screenRoom: document.getElementById('screen-room'),
  nicknameForm: document.getElementById('nickname-form'),
  nicknameInput: document.getElementById('nickname-input'),
  menuNickname: document.getElementById('menu-nickname'),
  gameList: document.getElementById('game-list'),
  btnJoinPublic: document.getElementById('btn-join-public'),
  btnCreatePrivate: document.getElementById('btn-create-private'),
  btnJoinCode: document.getElementById('btn-join-code'),
  joinCodeInput: document.getElementById('join-code-input'),
  menuError: document.getElementById('menu-error'),
  roomCodeLabel: document.getElementById('room-code-label'),
  btnLeaveRoom: document.getElementById('btn-leave-room'),
  gameMount: document.getElementById('game-mount'),
  rosterList: document.getElementById('roster-list'),
};

function categoryOf(gameType) {
  return CATEGORIES.find((cat) => cat.games.some((g) => g.type === gameType));
}

const state = {
  ws: null,
  reconnectDelay: 1000,
  nickname: null,
  clientId: null,
  selectedGameType: GAMES[0].type,
  currentRoom: null, // { code, gameType, isPublic }
  activeGameHandle: null, // returned by the mounted game module
  pendingJoin: null, // { kind: 'public'|'private'|'code', code? } — replayed once connected
  // Which category tabs are expanded — starts with just the selected game's category open so
  // the menu isn't an overwhelming 19-item wall on first load; toggled by clicking a tab header.
  expandedCategories: new Set([categoryOf(GAMES[0].type).name]),
};

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = `status status-${cls}`;
}

function showScreen(name) {
  els.screenNickname.hidden = name !== 'nickname';
  els.screenMenu.hidden = name !== 'menu';
  els.screenRoom.hidden = name !== 'room';
}

function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      nickname: state.nickname,
      roomCode: state.currentRoom ? state.currentRoom.code : null,
      gameType: state.selectedGameType,
    }));
  } catch {
    // sessionStorage unavailable (private browsing, etc.) — not critical, skip silently
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function send(type, payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(makeEnvelope(type, payload)));
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;

  ws.addEventListener('open', () => {
    state.reconnectDelay = 1000;
    setStatus('CONNECTED', 'connected');
    if (state.nickname) send(ClientMessage.HELLO, { nickname: state.nickname });
  });

  ws.addEventListener('message', (ev) => {
    let envelope;
    try {
      envelope = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleServerMessage(envelope.type, envelope.payload || {});
  });

  ws.addEventListener('close', () => {
    setStatus(`RECONNECTING (may take up to a minute if the server was idle)…`, 'error');
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 20000);
    setTimeout(connect, delay);
  });

  ws.addEventListener('error', () => {
    // 'close' fires right after; nothing extra to do here.
  });
}

function handleServerMessage(type, payload) {
  switch (type) {
    case ServerMessage.WELCOME: {
      state.clientId = payload.clientId;
      els.menuNickname.textContent = state.nickname;
      renderGameList();
      if (state.pendingJoin) {
        replayPendingJoin();
      } else if (!state.currentRoom) {
        showScreen('menu');
      }
      break;
    }

    case ServerMessage.ROOM_JOINED: {
      state.currentRoom = { code: payload.code, gameType: payload.gameType, isPublic: payload.isPublic };
      state.pendingJoin = null;
      saveSession();
      els.roomCodeLabel.textContent = payload.isPublic ? `${payload.code} (public)` : payload.code;
      renderRoster(payload.roster);
      showScreen('room');
      mountGame(payload.gameType, payload.stateSnapshot, payload.roster);
      break;
    }

    case ServerMessage.ROOM_ERROR: {
      state.pendingJoin = null;
      els.menuError.hidden = false;
      els.menuError.textContent = `ERROR: ${payload.reason}${payload.detail ? ' — ' + payload.detail : ''}`;
      showScreen('menu');
      break;
    }

    case ServerMessage.ROOM_PRESENCE: {
      renderRoster(payload.roster);
      if (state.activeGameHandle && typeof state.activeGameHandle.applyRoster === 'function') {
        state.activeGameHandle.applyRoster(payload.roster);
      }
      break;
    }

    case ServerMessage.GAME_EVENT: {
      if (state.activeGameHandle && typeof state.activeGameHandle.applyEvent === 'function') {
        state.activeGameHandle.applyEvent(payload.data);
      }
      break;
    }

    case ServerMessage.SYSTEM_ERROR: {
      console.warn('system.error', payload);
      break;
    }
  }
}

function replayPendingJoin() {
  const job = state.pendingJoin;
  if (!job) return;
  if (job.kind === 'public') {
    send(ClientMessage.ROOM_JOIN, { code: publicRoomCode(state.selectedGameType) });
  } else if (job.kind === 'code') {
    send(ClientMessage.ROOM_JOIN, { code: job.code });
  } else if (job.kind === 'private') {
    send(ClientMessage.ROOM_CREATE, { gameType: state.selectedGameType, isPublic: false });
  }
}

function renderGameList() {
  els.gameList.innerHTML = '';
  for (const cat of CATEGORIES) {
    const expanded = state.expandedCategories.has(cat.name);
    const catHasSelected = cat.games.some((g) => g.type === state.selectedGameType);

    const catLi = document.createElement('li');
    catLi.className = 'category';

    const header = document.createElement('div');
    header.className = 'category-header';
    if (catHasSelected) header.classList.add('has-selected');
    const arrow = document.createElement('span');
    arrow.className = 'category-arrow';
    arrow.textContent = expanded ? '▾' : '▸';
    header.appendChild(arrow);
    const name = document.createElement('span');
    name.textContent = `${cat.name} (${cat.games.length})`;
    header.appendChild(name);
    header.addEventListener('click', () => {
      if (expanded) state.expandedCategories.delete(cat.name);
      else state.expandedCategories.add(cat.name);
      renderGameList();
    });
    catLi.appendChild(header);

    if (expanded) {
      const subList = document.createElement('ul');
      subList.className = 'game-sublist';
      for (const game of cat.games) {
        const li = document.createElement('li');
        li.textContent = game.label;
        li.dataset.type = game.type;
        if (game.type === state.selectedGameType) li.classList.add('selected');
        li.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.selectedGameType = game.type;
          renderGameList();
        });
        subList.appendChild(li);
      }
      catLi.appendChild(subList);
    }

    els.gameList.appendChild(catLi);
  }
}

function renderRoster(roster) {
  els.rosterList.innerHTML = '';
  for (const entry of roster) {
    const li = document.createElement('li');
    li.textContent = entry.clientId === state.clientId ? `${entry.nickname} (you)` : entry.nickname;
    els.rosterList.appendChild(li);
  }
}

async function mountGame(gameType, snapshot, roster) {
  unmountGame();
  els.gameMount.innerHTML = '';
  try {
    const mod = await import(`./games/${gameType}/client.js`);
    const handle = mod.mount(els.gameMount, {
      sendAction: (data) => send(ClientMessage.GAME_ACTION, { gameType, data }),
      getClientId: () => state.clientId,
      leaveRoom,
    });
    if (snapshot && typeof handle.applySnapshot === 'function') handle.applySnapshot(snapshot);
    if (roster && typeof handle.applyRoster === 'function') handle.applyRoster(roster);
    state.activeGameHandle = handle;
  } catch (err) {
    console.error('Failed to load game module', gameType, err);
    els.gameMount.textContent = `Failed to load game "${gameType}".`;
  }
}

function unmountGame() {
  if (state.activeGameHandle && typeof state.activeGameHandle.unmount === 'function') {
    state.activeGameHandle.unmount();
  }
  state.activeGameHandle = null;
}

els.nicknameForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  state.nickname = els.nicknameInput.value.trim().slice(0, 24) || 'Anonymous';
  saveSession();
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    send(ClientMessage.HELLO, { nickname: state.nickname });
  }
});

els.btnJoinPublic.addEventListener('click', () => {
  els.menuError.hidden = true;
  send(ClientMessage.ROOM_JOIN, { code: publicRoomCode(state.selectedGameType) });
});

els.btnCreatePrivate.addEventListener('click', () => {
  els.menuError.hidden = true;
  send(ClientMessage.ROOM_CREATE, { gameType: state.selectedGameType, isPublic: false });
});

els.btnJoinCode.addEventListener('click', () => {
  const code = els.joinCodeInput.value.trim().toUpperCase();
  if (!code) return;
  els.menuError.hidden = true;
  send(ClientMessage.ROOM_JOIN, { code });
});

// Factored out (not just an inline listener) so game modules that take over the full viewport
// (hiding the normal LEAVE button) can still trigger it — passed into mount() as `api.leaveRoom`.
function leaveRoom() {
  send(ClientMessage.ROOM_LEAVE, {});
  unmountGame();
  state.currentRoom = null;
  saveSession();
  showScreen('menu');
}

els.btnLeaveRoom.addEventListener('click', leaveRoom);

// Bootstrap: restore a prior session (nickname/room) from this tab if present, so a
// reconnect after a Render free-tier cold start can silently rejoin.
(function init() {
  const saved = loadSession();
  if (saved && saved.nickname) {
    state.nickname = saved.nickname;
    if (saved.gameType) {
      state.selectedGameType = saved.gameType;
      const cat = categoryOf(saved.gameType);
      if (cat) state.expandedCategories = new Set([cat.name]);
    }
    els.nicknameInput.value = saved.nickname;
    if (saved.roomCode) {
      state.pendingJoin = { kind: 'code', code: saved.roomCode };
    }
  }
  connect();
})();
