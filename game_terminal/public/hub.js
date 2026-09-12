import { ClientMessage, ServerMessage, makeEnvelope, publicRoomCode } from './protocol.js';

// Games available in the hub menu. Adding a new mini-game means one entry here
// plus a public/games/<type>/client.js module — nothing else in hub.js changes.
const GAMES = [
  { type: 'drawing', label: 'SHARED DRAWING CANVAS' },
  { type: 'hangman', label: 'HANGMAN' },
];

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

const state = {
  ws: null,
  reconnectDelay: 1000,
  nickname: null,
  clientId: null,
  selectedGameType: GAMES[0].type,
  currentRoom: null, // { code, gameType, isPublic }
  activeGameHandle: null, // returned by the mounted game module
  pendingJoin: null, // { kind: 'public'|'private'|'code', code? } — replayed once connected
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
  for (const game of GAMES) {
    const li = document.createElement('li');
    li.textContent = game.label;
    li.dataset.type = game.type;
    if (game.type === state.selectedGameType) li.classList.add('selected');
    li.addEventListener('click', () => {
      state.selectedGameType = game.type;
      renderGameList();
    });
    els.gameList.appendChild(li);
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

els.btnLeaveRoom.addEventListener('click', () => {
  send(ClientMessage.ROOM_LEAVE, {});
  unmountGame();
  state.currentRoom = null;
  saveSession();
  showScreen('menu');
});

// Bootstrap: restore a prior session (nickname/room) from this tab if present, so a
// reconnect after a Render free-tier cold start can silently rejoin.
(function init() {
  const saved = loadSession();
  if (saved && saved.nickname) {
    state.nickname = saved.nickname;
    if (saved.gameType) state.selectedGameType = saved.gameType;
    els.nicknameInput.value = saved.nickname;
    if (saved.roomCode) {
      state.pendingJoin = { kind: 'code', code: saved.roomCode };
    }
  }
  connect();
})();
