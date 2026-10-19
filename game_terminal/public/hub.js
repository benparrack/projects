import { ClientMessage, ServerMessage, makeEnvelope, publicRoomCode, dailyRoomCode, RoomErrorReason } from './protocol.js';
import { sfx } from './games/sfx.js';
import { HOWTO } from './games/howto.js';
import { initAuth } from './auth.js';
import { avatarEl, nameColor, setRoomRoster } from './avatars.js';
import { h, toast, modal } from './ui.js';
import { INFO_PAGES, footerLinks } from './pages.js';
import { renderProfile } from './profile.js';
import { renderReplay } from './replay.js';
import { renderLeaderboards } from './leaderboards.js';
import { renderDailyCard, renderDaily } from './daily.js';
import { renderWeeklyCard } from './weekly.js';
import { renderTurns } from './turns.js';
import { showModNotices, showSuspended } from './notices.js';
import { renderLive, renderActivity, renderSoloCard } from './home.js';
import { initFriends, setSignedIn, handleSocialState, handleSocialNotice, handleOnline, openOnline, openConversation, getSocial } from './friends.js';
import { initChat, initGlobalDock, setDockAvailable, chatBox, reopenChats, handleChatHistory, handleChatMessage, handleChatDeleted, handleChatError } from './chat.js';
import { renderAdmin, handleAdminData } from './admin.js';
import { renderSettings, applyPrefs, currentPrefs, initPrefs, downloadJson } from './settings.js';
import { openSignIn, openUsernameSetup, openTermsUpdate, renderAccountChip, openAvatarChange } from './account-ui.js';

const muteBtn = document.getElementById('btn-mute');
const renderMute = (m) => { muteBtn.textContent = m ? 'SFX: OFF' : 'SFX: ON'; };
renderMute(sfx.muted);

// Installable app. Chrome/Edge (desktop and Android) fire an install prompt we surface as a button.
// Firefox and iOS have no prompt a page can trigger, so there the button opens the steps instead.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const installBtn = document.getElementById('btn-install');
let installPrompt = null;
const ua = navigator.userAgent;
const manualInstall = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Firefox\//.test(ua) ? (/Android/.test(ua) ? 'ff-android' : /Windows/.test(ua) ? 'ff-windows' : 'ff-desktop') : null;
if (manualInstall && !matchMedia('(display-mode: standalone)').matches && !navigator.standalone) installBtn.hidden = false;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; installBtn.hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; installBtn.hidden = true; });
const INSTALL_STEPS = {
  ios: ['Tap the Share button (the square with an arrow).', 'Choose "Add to Home Screen", then "Add".'],
  'ff-android': ['Open the ⋮ menu.', 'Tap "Add app to Home screen" (or "Install").'],
  'ff-windows': ['Click the "Add to taskbar" icon at the right end of the address bar (Firefox 143+).', 'Game Terminal opens in its own window, pinned to your taskbar.'],
  'ff-desktop': ['Open about:config, set browser.taskbarTabs.enabled to true and restart Firefox.',
    'Then click the "Add to taskbar" icon at the right end of the address bar. On Linux this opens Game Terminal in its own window but doesn\'t add a launcher yet.',
    'If that icon doesn\'t appear, the "PWAs for Firefox" add-on does the same job. Or pin this tab (right-click it → Pin Tab).'],
};
installBtn.addEventListener('click', async () => {
  if (!installPrompt) {
    const m = modal('INSTALL GAME TERMINAL');
    if (manualInstall === 'ff-desktop' || !manualInstall) m.body.append(h('p', 'Firefox on Linux and Mac can\'t install sites as apps by default yet, but newer versions have it behind a setting:'));
    m.body.append(h('ol.install-steps', ...INSTALL_STEPS[manualInstall || 'ff-desktop'].map((t) => h('li', t))));
    if (manualInstall === 'ff-desktop') m.body.append(h('p', h('a', { href: 'https://addons.mozilla.org/firefox/addon/pwas-for-firefox/', target: '_blank', rel: 'noopener' }, 'Get "PWAs for Firefox" →')));
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  installBtn.hidden = true;
});
sfx.onChange(renderMute);
muteBtn.addEventListener('click', () => { sfx.setMuted(!sfx.muted); sfx.play('click'); });

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
      { type: 'blackjack', label: 'BLACKJACK' },
    ],
  },
  {
    name: 'BOARD GAMES',
    games: [
      { type: 'checkers', label: 'CHECKERS' },
      { type: 'chess', label: 'CHESS' },
      { type: 'connect4', label: 'FOUR IN A ROW' },
      { type: 'backgammon', label: 'BACKGAMMON' },
      { type: 'reversi', label: 'REVERSI' },
      { type: 'gomoku', label: 'GOMOKU (FIVE IN A ROW)' },
      { type: 'mancala', label: 'MANCALA' },
      { type: 'dotsboxes', label: 'DOTS AND BOXES' },
      { type: 'codemaster', label: 'CODEBREAKER' },
      { type: 'minesweeper', label: 'MINESWEEPER (RACE)' },
      { type: 'blockade', label: 'BLOCKADE (BARRICADE)' },
    ],
  },
  {
    name: 'ARENA & REAL-TIME',
    games: [
      { type: 'slither', label: 'SLITHER' },
      { type: 'tron', label: 'LIGHT CYCLES' },
      { type: 'shooter', label: 'ARENA DUEL (1V1 FPS)' },
      { type: 'slope', label: 'SLOPE (3D RUNNER)' },
      { type: 'mazedash', label: 'MAZE DASH (SPEEDRUN)' },
    ],
  },
  {
    name: 'WORD GAMES',
    games: [
      { type: 'wordle', label: 'WORDLE' },
      { type: 'framed', label: 'FRAMED (MOVIES)' },
      { type: 'scrabble', label: 'WORD TILES' },
      { type: 'wordscapes', label: 'WORD WHEEL' },
      { type: 'wordsearch', label: 'WORD SEARCH' },
      { type: 'hangman', label: 'HANGMAN' },
      { type: 'anagrams', label: 'ANAGRAMS' },
      { type: 'wordbites', label: 'WORD BITES' },
      { type: 'wordhunt', label: 'WORD HUNT' },
      { type: 'wordtrails', label: 'WORD TRAILS' },
      { type: 'crossword', label: 'CROSSWORD' },
      { type: 'twentyq', label: '20 QUESTIONS' },
    ],
  },
  {
    name: 'POCKET CLASSICS',
    games: [
      { type: 'chess', label: 'CHESS' },
      { type: 'checkers', label: 'CHECKERS' },
      { type: 'connect4', label: 'FOUR IN A ROW' },
      { type: 'crazyeights', label: 'CRAZY 8' },
      { type: 'reversi', label: 'REVERSI' },
      { type: 'gomoku', label: 'GOMOKU' },
      { type: 'dotsboxes', label: 'DOTS & BOXES' },
      { type: 'mancala', label: 'MANCALA' },
      { type: 'anagrams', label: 'ANAGRAMS' },
      { type: 'wordbites', label: 'WORD BITES' },
      { type: 'wordhunt', label: 'WORD HUNT' },
      { type: 'filler', label: 'FILLER' },
      { type: 'seabattle', label: 'SEA BATTLE' },
      { type: 'pool', label: 'POOL' },
      { type: 'darts', label: 'DARTS' },
      { type: 'cuppong', label: 'CUP PONG' },
      { type: 'basketball', label: 'BASKETBALL' },
      { type: 'twentyq', label: '20 QUESTIONS' },
      { type: 'tanks', label: 'TANKS' },
      { type: 'minigolf', label: 'MINI GOLF' },
      { type: 'archery', label: 'ARCHERY' },
      { type: 'shuffleboard', label: 'SHUFFLEBOARD' },
      { type: 'bowling', label: 'BOWLING' },
      { type: 'knockout', label: 'KNOCKOUT' },
      { type: 'paintball', label: 'PAINTBALL' },
      { type: 'skeeball', label: 'ALLEY BALL' },
    ],
  },
  {
    name: 'PARTY & DRAWING',
    games: [
      { type: 'drawing', label: 'SHARED DRAWING CANVAS' },
      { type: 'hangman', label: 'HANGMAN' },
      { type: 'pictionary', label: 'SKETCH & GUESS' },
      { type: 'garticphone', label: 'DRAWING PHONE' },
    ],
  },
  {
    name: 'RETRO',
    games: [
      { type: 'gameboy', label: 'RETRO HANDHELD (EMULATOR)' },
    ],
  },
];

// Flat list, derived from CATEGORIES — everything below that just needs "all games" (initial
// selection, session restore) keeps working unchanged without knowing about categories.
// A game may be listed in more than one category (e.g. GAMEPIGEON reuses chess), so dedupe by type.
const GAMES = [...new Map(CATEGORIES.flatMap((cat) => cat.games).map((g) => [g.type, g])).values()];

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
  btnJoinRanked: document.getElementById('btn-join-ranked'),
  btnCreatePrivate: document.getElementById('btn-create-private'),
  btnJoinCode: document.getElementById('btn-join-code'),
  joinCodeInput: document.getElementById('join-code-input'),
  menuError: document.getElementById('menu-error'),
  roomCodeLabel: document.getElementById('room-code-label'),
  btnLeaveRoom: document.getElementById('btn-leave-room'),
  gameMount: document.getElementById('game-mount'),
  infoWrap: document.getElementById('info-wrap'),
  btnInfo: document.getElementById('btn-info'),
  infoPop: document.getElementById('info-pop'),
  rosterList: document.getElementById('roster-list'),
  screenPage: document.getElementById('screen-page'),
  accountSlot: document.getElementById('account-slot'),
  btnLandingSignin: document.getElementById('btn-landing-signin'),
  btnCopyLink: document.getElementById('btn-copy-link'),
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
  auth: null, // from initAuth(): mode, user, getToken()…
  account: null, // own account from account.state (null for guests)
  setup: null, // open username-setup dialog, if any
};

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = `status status-${cls}`;
}

function showScreen(name) {
  // A new screen starts at its top (joining a room from the bottom of the menu landed on the footer).
  if (state.screen !== name) { state.screen = name; window.scrollTo(0, 0); }
  els.screenNickname.hidden = name !== 'nickname';
  els.screenMenu.hidden = name !== 'menu';
  if (name === 'menu') refreshHome();
  els.screenRoom.hidden = name !== 'room';
  els.screenPage.hidden = name !== 'page';
  // Global chat lives on the menu and pages; rooms have their own chat. Accounts-off deploys have none.
  setDockAvailable((name === 'menu' || name === 'page') && !!state.auth && state.auth.mode !== 'off');
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
    sendHello();
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

// Signed-in users greet with their Firebase ID token (the server looks up their account);
// guests with a nickname. A signed-in hello also carries the guest nickname, if any, as fallback.
async function sendHello() {
  const token = state.auth && state.auth.user ? await state.auth.getToken() : null;
  if (!token && !state.nickname) return; // landing screen: wait for a choice
  send(ClientMessage.HELLO, { token: token || undefined, nickname: state.nickname || undefined });
}

// Sign-in state changed: start a fresh connection so the server sees the new identity.
function reconnectAs() {
  if (state.currentRoom) leaveRoom();
  state.clientId = null;
  state.account = null;
  renderChip();
  if (!state.nickname && !state.auth.user) showScreen('nickname');
  if (state.ws) {
    state.reconnectDelay = 100;
    state.ws.close();
  }
}

function renderChip() {
  const a = state.auth;
  renderAccountChip(els.accountSlot, {
    mode: a ? a.mode : 'off',
    user: state.account,
    onSignIn: () => openSignIn(a),
    onSignOut: () => a.signOut(),
    onChangeAvatar: () => openAvatarChange(state.account.avatar, (avatar) => send(ClientMessage.ACCOUNT_UPDATE, { avatar })),
  });
  els.btnLandingSignin.closest('.panel').hidden = !a || a.mode === 'off';
  renderFooter();
}

// The daily challenge needs accounts, so accounts-off deploys don't advertise it.
function renderFooter() {
  const accounts = !!state.auth && state.auth.mode !== 'off';
  document.querySelector('.mainnav a[data-nav="daily"]').hidden = !accounts;
  document.getElementById('footer-links').replaceChildren(h('a', { href: '/leaderboards', 'data-link': true }, 'Leaderboards'), ' · ', ...(accounts ? [h('a', { href: '/daily', 'data-link': true }, 'Daily'), ' · '] : []), ...footerLinks(), ' · ', h('a', { href: '/settings', 'data-link': true }, 'Settings'));
}

function renderSettingsPage() {
  const a = state.auth;
  renderSettings(els.screenPage, {
    account: state.account,
    authUser: a && a.user,
    mode: a ? a.mode : 'off',
    saveSettings: (settings) => send(ClientMessage.ACCOUNT_UPDATE, { settings }),
    rename: (username) => { state.renaming = true; send(ClientMessage.ACCOUNT_CLAIM, { username }); },
    changeAvatar: () => openAvatarChange(state.account.avatar, (avatar) => send(ClientMessage.ACCOUNT_UPDATE, { avatar })),
    exportData: () => send(ClientMessage.ACCOUNT_EXPORT, {}),
    deleteAccount: (confirm, close) => { state.closeDelete = close; send(ClientMessage.ACCOUNT_DELETE, { confirm }); },
    signIn: () => openSignIn(a),
    signOut: () => a.signOut(),
  });
  state.settingsKey = settingsKey();
}

// Only re-render /settings when something it shows changed (not on every saved preference,
// which would steal focus from the control being used).
const settingsKey = () => JSON.stringify(state.account && [state.account.username, state.account.avatar, state.account.renamedAt]);

function handleAccountState(p) {
  const prev = state.account;
  state.account = p.user;
  renderChip();
  setSignedIn(!!p.user);
  if (p.user && (!prev || prev.username !== p.user.username) && !state.renaming) {
    // Signed in: the account's saved preferences win; a fresh account adopts this device's.
    if (Object.keys(p.user.settings || {}).length) applyPrefs(p.user.settings);
    else send(ClientMessage.ACCOUNT_UPDATE, { settings: currentPrefs() });
  }
  if (state.renaming && p.user && prev && prev.username !== p.user.username) toast(`You're now ${p.user.username}.`, { kind: 'ok' });
  state.renaming = false;
  if (p.user && p.user.modNotices && p.user.modNotices.length) showModNotices(p.user.modNotices, (ids) => send(ClientMessage.ACCOUNT_NOTICES_SEEN, { ids }));
  if (location.pathname === '/settings' && state.settingsKey !== settingsKey()) renderSettingsPage();
  // Profiles show friend buttons and head-to-head only for a signed-in viewer.
  if (location.pathname.startsWith('/u/') && (prev && prev.username) !== (p.user && p.user.username)) onRoute();
  // Leaderboards highlight your row and offer a FRIENDS tab only when signed in.
  if (location.pathname.startsWith('/leaderboards') && (prev && prev.username) !== (p.user && p.user.username)) onRoute();
  // The daily card shows your runs and streak; refresh it whenever the account changes.
  const homeKey = (u) => u && JSON.stringify([u.username, u.daily]);
  if (!els.screenMenu.hidden && homeKey(prev) !== homeKey(p.user)) refreshHome();
  if (location.pathname === '/daily' && JSON.stringify(prev && prev.daily) !== JSON.stringify(p.user && p.user.daily)) onRoute();
  if (location.pathname === '/admin' && !!(prev && prev.admin) !== !!(p.user && p.user.admin)) onRoute();
  if (p.user && state.setup) {
    state.setup.close();
    state.setup = null;
    toast(`Welcome, ${p.user.username}! Your stats are now saved.`, { kind: 'ok' });
  }
  if (p.needsUsername && !state.setup) {
    state.setup = openUsernameSetup({
      suggested: p.suggested,
      onSubmit: (claim) => send(ClientMessage.ACCOUNT_CLAIM, claim),
      onSignOut: () => { state.setup.close(); state.setup = null; state.auth.signOut(); },
    });
  }
  if (p.needsTerms) {
    openTermsUpdate({ onAccept: () => send(ClientMessage.ACCOUNT_ACCEPT_TERMS, {}), onSignOut: () => state.auth.signOut() });
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Menu extras: live strip, daily card, friends' activity (fetched fresh each time the menu shows).
function refreshHome() {
  renderLive(document.getElementById('live-slot'), { gameLabel, pick: pickGame, openOnline: state.account ? openOnline : null });
  renderDailyCard(document.getElementById('daily-slot'), dailyOpts());
  renderWeeklyCard(document.getElementById('weekly-slot'), { auth: state.auth, account: state.account, gameLabel, play: (type) => { pickGame(type); els.btnJoinPublic.click(); } });
  renderSoloCard(document.getElementById('solo-slot'), { account: state.account, gameLabel, play: (type) => { pickGame(type); els.btnCreatePrivate.click(); } });
  if (state.account) { send(ClientMessage.ACTIVITY_GET, {}); send(ClientMessage.ASYNC_LIST, {}); }
  else { document.getElementById('activity-slot').replaceChildren(); document.getElementById('turns-slot').replaceChildren(); }
}

function joinCode(code) {
  if (location.pathname !== '/') history.pushState(null, '', '/');
  send(ClientMessage.ROOM_JOIN, { code });
}

// Select a game in the menu list (expanding its category) and bring it into view.
function pickGame(type) {
  const cat = CATEGORIES.find((c) => c.games.some((g) => g.type === type));
  if (!cat) return;
  state.selectedGameType = type;
  state.expandedCategories.add(cat.name);
  renderGameList();
  const li = els.gameList.querySelector(`li[data-type="${type}"]`);
  if (li) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const playDaily = (type) => send(ClientMessage.ROOM_JOIN, { code: dailyRoomCode(type) });
const dailyOpts = () => ({ account: state.account, auth: state.auth, play: playDaily, signIn: () => openSignIn(state.auth) });

function handleResultRecorded(p) {
  if (p.daily) {
    const d = p.daily;
    toast(d.rank ? `◆ DAILY: #${d.rank} of ${d.of} today. 🔥 ${d.streak}-day streak.` : `◆ DAILY: no score today, but your streak is ${d.streak}.`,
      { kind: 'ok', ms: 8000, action: { label: 'BOARD', run: () => navigate('/daily') } });
  }
  const outcome = p.kind === 'solo' ? 'Run complete'
    : p.draw ? 'It\'s a draw' : p.place === 0 ? 'You won' : `You placed ${ordinal(p.place + 1)}`; // place is 0-based
  if (p.rating) {
    const d = p.rating.delta;
    toast(`${outcome}. Rating ${p.rating.rating} (${d >= 0 ? '+' : '−'}${Math.abs(d)}) · ${p.rating.tier}.${p.progress && p.progress.gained ? ` +${p.progress.gained} XP${p.progress.double ? ' (2× game of the week)' : ''}.` : ''}`, { kind: d >= 0 ? 'ok' : undefined, ms: 7000 });
  } else if (p.saved) toast(`${outcome}. ${p.ranked && p.kind === 'pvp' ? 'Unrated: everyone needs an account. ' : ''}${p.progress && p.progress.gained ? `+${p.progress.gained} XP${p.progress.double ? ' (2× game of the week)' : ''}.` : 'Result saved to your profile.'}`, { kind: 'ok' });
  const pr = p.progress;
  if (pr && pr.levelUp) toast(`▲ LEVEL UP! You're now level ${pr.level}.`, { kind: 'ok', ms: 7000 });
  if (pr) for (const b of pr.badges || []) toast(`★ ACHIEVEMENT UNLOCKED: ${b.name}. ${b.desc}.`, { kind: 'ok', ms: 8000, action: state.account ? { label: 'VIEW', run: () => window.open(`/u/${encodeURIComponent(state.account.username)}`, '_blank', 'noopener') } : undefined });
  if (!p.saved && state.auth && state.auth.mode !== 'off') {
    toast(`${outcome}. Guests' results aren't saved.`, { action: { label: 'SIGN IN', run: () => openSignIn(state.auth) } });
  }
}

function handleServerMessage(type, payload) {
  switch (type) {
    case ServerMessage.WELCOME: {
      state.clientId = payload.clientId;
      els.menuNickname.textContent = payload.nickname;
      renderGameList();
      // The old room chat box would ask for history before the rejoin below lands; ROOM_JOINED rebuilds it.
      if (state.currentRoom && !state.pendingJoin) document.getElementById('room-chat').replaceChildren();
      reopenChats();
      if (state.pendingJoin) {
        replayPendingJoin();
      } else if (state.currentRoom) {
        // Reconnected mid-room: the server dropped us from it with the old socket, so join again
        // (or hear that it closed, e.g. after a deploy) instead of sitting on a dead screen.
        state.rejoining = true;
        send(ClientMessage.ROOM_JOIN, { code: state.currentRoom.code });
      } else if (!state.onPage) {
        showScreen('menu');
      }
      break;
    }

    case ServerMessage.ROOM_JOINED: {
      state.currentRoom = { code: payload.code, gameType: payload.gameType, isPublic: payload.isPublic, ranked: !!payload.ranked, daily: payload.daily || null };
      state.pendingJoin = null;
      state.rejoining = false;
      if (state.inviteAfterJoin && !payload.isPublic) send(ClientMessage.ROOM_INVITE, { username: state.inviteAfterJoin });
      state.inviteAfterJoin = null;
      saveSession();
      els.roomCodeLabel.textContent = payload.daily ? `◆ DAILY ${payload.daily}` : payload.byTurns ? `${gameLabel(payload.gameType)} · BY TURNS vs ${payload.byTurns.opponent}` : payload.isPublic ? publicRoomLabel(payload) : payload.code;
      els.btnCopyLink.hidden = payload.isPublic || !!payload.daily || !!payload.byTurns;
      document.body.classList.toggle('gt-byturns', !!payload.byTurns);
      renderRoster(payload.roster);
      // Chat needs accounts (to post, report and moderate), so accounts-off deploys have none.
      document.getElementById('room-chat').replaceChildren(...(state.auth && state.auth.mode !== 'off'
        ? [chatBox({ channel: 'room', title: 'Room chat', placeholder: 'Message the room', emptyText: 'Room chat. Say good luck!', className: 'chat-room' }).el] : []));
      showScreen('room');
      mountGame(payload.gameType, payload.stateSnapshot, payload.roster);
      break;
    }

    case ServerMessage.ROOM_ERROR: {
      if (state.rejoining && !payload.soft) {
        // A toast, since the menu error line sits below the fold on phones.
        state.rejoining = false;
        leaveRoom({ notify: false }); // the server already dropped us; just clean up locally
        toast(payload.reason === RoomErrorReason.NOT_FOUND ? 'That room closed while you were disconnected.' : `Couldn't rejoin: ${payload.detail || payload.reason}`, { kind: 'error' });
        break;
      }
      if (payload.soft || payload.reason === RoomErrorReason.DAILY) { if (!payload.soft) state.pendingJoin = null; toast(payload.detail || payload.reason, { kind: 'error' }); break; }
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

    case ServerMessage.ROOM_SNAPSHOT: {
      if (state.activeGameHandle && typeof state.activeGameHandle.applySnapshot === 'function') state.activeGameHandle.applySnapshot(payload.stateSnapshot);
      break;
    }

    case ServerMessage.GAME_EVENT: {
      if (state.activeGameHandle && typeof state.activeGameHandle.applyEvent === 'function') {
        state.activeGameHandle.applyEvent(payload.data);
      }
      break;
    }

    case ServerMessage.ACCOUNT_STATE: {
      handleAccountState(payload);
      break;
    }

    case ServerMessage.ONLINE:
      handleOnline(payload);
      break;

    case ServerMessage.ACTIVITY: {
      if (state.account) renderActivity(document.getElementById('activity-slot'), payload, { gameLabel, openFriends: () => document.getElementById('btn-friends').click() });
      break;
    }

    case ServerMessage.ASYNC_GAMES: {
      state.asyncGames = payload.games;
      if (state.account) renderTurns(document.getElementById('turns-slot'), payload.games, { gameLabel, join: joinCode, remove: (code) => send(ClientMessage.ASYNC_REMOVE, { code }) });
      break;
    }

    case ServerMessage.SOCIAL_STATE: {
      handleSocialState(payload);
      break;
    }

    case ServerMessage.CHAT_HISTORY: handleChatHistory(payload); break;
    case ServerMessage.CHAT_MESSAGE: handleChatMessage(payload); break;
    case ServerMessage.CHAT_DELETED: handleChatDeleted(payload); break;
    case ServerMessage.CHAT_ERROR: handleChatError(payload); break;
    case ServerMessage.ADMIN_DATA: handleAdminData(payload); break;

    case ServerMessage.SOCIAL_NOTICE: {
      handleSocialNotice(payload);
      break;
    }

    case ServerMessage.ACCOUNT_EXPORT_DATA: {
      if (payload.data) downloadJson(payload.data, `game-terminal-${payload.data.account.username}.json`);
      break;
    }

    case ServerMessage.ACCOUNT_DELETED: {
      if (state.closeDelete) state.closeDelete();
      state.closeDelete = null;
      state.account = null;
      state.auth.signOut();
      toast('Your account has been deleted.', { kind: 'ok', ms: 8000 });
      navigate('/');
      break;
    }

    case ServerMessage.ACCOUNT_ERROR: {
      if (payload.for === 'delete' && state.closeDelete) { state.closeDelete(); state.closeDelete = null; }
      if (payload.for === 'claim') state.renaming = false;
      if (payload.for === 'claim' && state.setup) state.setup.showError(payload.message);
      else if (payload.banned) showSuspended(payload);
      else toast(payload.message, { kind: 'error', ms: 6000 });
      if (payload.for === 'auth' && !state.nickname) showScreen('nickname');
      break;
    }

    case ServerMessage.RESULT_RECORDED: {
      handleResultRecorded(payload);
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
  if (job.kind === 'public' || job.kind === 'ranked') {
    send(ClientMessage.ROOM_JOIN, { code: publicRoomCode(state.selectedGameType, job.kind === 'ranked') });
  } else if (job.kind === 'code') {
    send(ClientMessage.ROOM_JOIN, { code: job.code });
  } else if (job.kind === 'private') {
    send(ClientMessage.ROOM_CREATE, { gameType: state.selectedGameType, isPublic: false });
  }
}

function renderGameList() {
  updateRankedButton();
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
        if (game.type === state.selectedGameType) {
          li.classList.add('selected');
          // Join right from the row: the room buttons sit below a long list.
          const go = h('button.row-join', { type: 'button' }, '▶ JOIN');
          go.addEventListener('click', (ev) => { ev.stopPropagation(); els.btnJoinPublic.click(); });
          const more = h('button.row-join.row-more', { type: 'button', title: 'Ranked, private room, join by code' }, 'MORE ▾');
          more.addEventListener('click', (ev) => { ev.stopPropagation(); els.btnJoinPublic.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
          li.append(go, more);
        }
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
  setRoomRoster(roster);
  els.rosterList.innerHTML = '';
  for (const entry of roster) {
    const li = document.createElement('li');
    const name = entry.clientId === state.clientId ? `${entry.nickname} (you)` : entry.nickname;
    if (entry.away) {
      li.append(h('span.avatar.avatar-guest', { 'aria-hidden': 'true' }, 'z'), h('span.muted', `${entry.nickname} (away)`));
      li.title = 'Not here right now. Their seat is kept until they\'re back.';
    } else if (entry.account) {
      li.append(avatarEl(entry.account.avatar, 20, entry.account.cosmetics), h('a', { href: `/u/${encodeURIComponent(entry.account.username)}`, 'data-link': true, target: '_blank', class: nameColor(entry.account.cosmetics) }, name));
    } else {
      li.append(h('span.avatar.avatar-guest', { 'aria-hidden': 'true' }, '?'), h('span.guest', name));
      li.title = 'Guest';
    }
    els.rosterList.appendChild(li);
  }
}

async function mountGame(gameType, snapshot, roster) {
  unmountGame();
  showHowTo(gameType);
  els.gameMount.innerHTML = '';
  try {
    const mod = await import(`./games/${gameType}/client.js`);
    const handle = mod.mount(els.gameMount, {
      sendAction: (data) => send(ClientMessage.GAME_ACTION, { gameType, data }),
      getClientId: () => state.clientId,
      leaveRoom,
      daily: !!(state.currentRoom && state.currentRoom.daily), // daily runs are solo with a fixed setup
      ranked: !!(state.currentRoom && state.currentRoom.ranked),
    });
    if (snapshot && typeof handle.applySnapshot === 'function') handle.applySnapshot(snapshot);
    if (roster && typeof handle.applyRoster === 'function') handle.applyRoster(roster);
    state.activeGameHandle = handle;
  } catch (err) {
    console.error('Failed to load game module', gameType, err);
    els.gameMount.textContent = `Failed to load game "${gameType}".`;
  }
}

// The "i" button in the room header: hover previews the how-to card, click pins it open.
function showHowTo(gameType) {
  const info = HOWTO[gameType];
  setInfoOpen(false);
  els.infoWrap.hidden = !info;
  if (!info) return;
  const label = (GAMES.find((g) => g.type === gameType) || {}).label || gameType;
  const h = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
  const list = (items) => {
    const ul = document.createElement('ul');
    for (const t of items) ul.appendChild(h('li', t));
    return ul;
  };
  els.infoPop.replaceChildren(h('h3', `HOW TO PLAY — ${label}`), h('p', info.about),
    h('h4', 'RULES'), list(info.rules), h('h4', 'CONTROLS'), list(info.controls));
}

function setInfoOpen(open) {
  els.infoWrap.classList.toggle('open', open);
  els.btnInfo.setAttribute('aria-expanded', String(open));
}

els.btnInfo.addEventListener('click', (ev) => {
  ev.stopPropagation();
  setInfoOpen(!els.infoWrap.classList.contains('open'));
});
document.addEventListener('click', (ev) => { if (!els.infoWrap.contains(ev.target)) setInfoOpen(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') setInfoOpen(false); });

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

els.btnJoinRanked.addEventListener('click', () => {
  els.menuError.hidden = true;
  if (!state.account) { openSignIn(state.auth); return; }
  send(ClientMessage.ROOM_JOIN, { code: publicRoomCode(state.selectedGameType, true) });
});

// RANKED only for games with a ladder, and only where accounts exist.
function updateRankedButton() {
  const g = state.auth && state.auth.games && state.auth.games[state.selectedGameType];
  els.btnJoinRanked.hidden = !(g && g.rated && state.auth.mode !== 'off');
}

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
function leaveRoom({ notify = true } = {}) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (notify) send(ClientMessage.ROOM_LEAVE, {});
  unmountGame();
  document.getElementById('room-chat').replaceChildren();
  state.currentRoom = null;
  document.body.classList.remove('gt-byturns');
  saveSession();
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  showScreen('menu');
}

els.btnCopyLink.addEventListener('click', async () => {
  const link = `${location.origin}/r/${state.currentRoom.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied. Anyone with it can join this room.', { kind: 'ok' });
  } catch {
    toast(`Invite link: ${link}`, { ms: 12000 });
  }
});

els.btnLandingSignin.addEventListener('click', () => openSignIn(state.auth));

// Landing showcase: the whole catalog up front. Picking a game drops you into its public room once you connect.
document.getElementById('landing-games').append(
  h('h2.panel-title', `> ${CATEGORIES.reduce((n, c) => n + c.games.length, 0)} GAMES, ONE CLICK AWAY`),
  ...CATEGORIES.map((cat) => h('div.landing-cat',
    h('h3.landing-cat-name', cat.name),
    h('div.landing-chips', ...cat.games.map((g) => h('button.landing-chip', {
      type: 'button',
      'aria-pressed': 'false',
      onclick: (ev) => {
        state.selectedGameType = g.type;
        state.expandedCategories.add(cat.name);
        state.pendingJoin = { kind: 'public' };
        for (const b of document.querySelectorAll('.landing-chip[aria-pressed=true]')) b.setAttribute('aria-pressed', 'false');
        ev.currentTarget.setAttribute('aria-pressed', 'true');
        document.querySelector('.landing-guest .muted').textContent = `Pick a nickname and jump into ${g.label}. Nothing is saved.`;
        els.nicknameInput.focus({ preventScroll: true });
        els.nicknameInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
    }, g.label))))),
);

// Client-side routes. Links marked data-link navigate without a page load.
function route() {
  const path = location.pathname;
  const invite = /^\/r\/([A-Za-z0-9-]{3,12})\/?$/.exec(path);
  if (invite) {
    state.pendingJoin = { kind: 'code', code: invite[1].toUpperCase() };
    if (state.clientId) replayPendingJoin();
    return 'app';
  }
  if (path === '/' || path === '/index.html') return 'app';
  const rep = /^\/replay\/([a-z0-9]{8,40})\/?$/.exec(path);
  if (rep) {
    renderReplay(els.screenPage, rep[1], { gameLabel }).then((r) => {
      if (location.pathname !== path) return r.cleanup();
      state.pageCleanup = r.cleanup;
      document.title = `${r.title} — Game Terminal`;
    });
    showScreen('page');
    return 'page';
  }
  const prof = /^\/u\/([A-Za-z0-9_]{1,24})\/?$/.exec(path);
  if (prof) {
    renderProfile(els.screenPage, prof[1], { gameLabel, me: state.account, equip: (cosmetics) => send(ClientMessage.ACCOUNT_UPDATE, { cosmetics }) })
      .then((title) => { if (location.pathname === path) document.title = `${title} — Game Terminal`; });
    showScreen('page');
    return 'page';
  }
  if (path.replace(/\/$/, '') === '/admin') {
    renderAdmin(els.screenPage, { send, account: state.account });
    document.title = 'Moderation — Game Terminal';
    showScreen('page');
    return 'page';
  }
  if (path.replace(/\/$/, '') === '/settings') {
    renderSettingsPage();
    document.title = 'Settings — Game Terminal';
    showScreen('page');
    return 'page';
  }
  const lb = /^\/leaderboards(?:\/([a-z0-9]{1,24}))?\/?$/.exec(path);
  if (lb) {
    renderLeaderboards(els.screenPage, lb[1] || null, { gameLabel, games: GAMES, auth: state.auth, me: state.account, friends: friendNames });
    document.title = 'Leaderboards — Game Terminal';
    showScreen('page');
    return 'page';
  }
  if (path.replace(/\/$/, '') === '/daily') {
    renderDaily(els.screenPage, dailyOpts());
    document.title = 'Daily challenge — Game Terminal';
    showScreen('page');
    return 'page';
  }
  const info = INFO_PAGES[path.replace(/\/$/, '')];
  if (info) {
    els.screenPage.replaceChildren(info.render());
    document.title = `${info.title} — Game Terminal`;
    showScreen('page');
    return 'page';
  }
  renderNotFound();
  return 'page';
}

const friendNames = () => { const s = getSocial(); return s ? s.friends.map((f) => f.username) : []; };

// Public codes embed the internal type id (PUBLIC-SCRABBLE-2); show the game's display name instead.
function publicRoomLabel({ code, gameType, ranked }) {
  const n = (code.match(/-(\d+)$/) || [])[1];
  return `${gameLabel(gameType)} · ${ranked ? 'RANKED ★' : 'PUBLIC'}${n ? ` #${n}` : ''}`;
}
function gameLabel(t) { return (GAMES.find((g) => g.type === t) || {}).label || t; }

function renderNotFound() {
  els.screenPage.replaceChildren(h('div.notfound',
    h('p.notfound-code', '404'),
    h('h1', 'PAGE NOT FOUND'),
    h('p.muted', `Nothing lives at ${location.pathname}.`),
    h('a.btn-primary', { href: '/', 'data-link': true }, 'BACK TO GAMES')));
  document.title = 'Not found — Game Terminal';
  showScreen('page');
}

function navigate(href) {
  history.pushState(null, '', href);
  onRoute();
}

function onRoute() {
  if (state.pageCleanup) { state.pageCleanup(); state.pageCleanup = null; }
  document.title = 'Game Terminal — free multiplayer games in your browser';
  state.onPage = route() === 'page';
  for (const a of document.querySelectorAll('.mainnav a')) {
    const on = a.dataset.nav === 'play' ? !state.onPage : location.pathname.startsWith(a.getAttribute('href'));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!state.onPage) {
    if (state.currentRoom) showScreen('room');
    else if (state.clientId) showScreen('menu');
    else if (!state.nickname && !(state.auth && state.auth.user)) showScreen('nickname');
  }
  // In-page anchors (/privacy#storage) once the page is rendered.
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', onRoute);

els.btnLeaveRoom.addEventListener('click', leaveRoom);

// Fullscreen the whole page rather than the game box, so overlays games attach to <body>
// (toasts, modals, results) stay visible; CSS hides the site chrome while it's on.
if (document.fullscreenEnabled) {
  const fs = document.getElementById('btn-fullscreen');
  fs.hidden = false;
  fs.addEventListener('click', () => {
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('gt-fullscreen', !!document.fullscreenElement);
    const on = !!document.fullscreenElement;
    fs.replaceChildren(on ? '✕' : '⛶', h('span.btn-label', on ? ' EXIT FULLSCREEN' : ' FULLSCREEN'));
    fs.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  });
}

// Bootstrap: restore a prior session (nickname/room) from this tab if present, so a
// reconnect after a Render free-tier cold start can silently rejoin.
(async function init() {
  initPrefs();
  renderFooter();
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
  initFriends({
    send,
    gameLabel,
    games: CATEGORIES,
    selectedGame: () => state.selectedGameType,
    currentRoom: () => state.currentRoom,
    navigate,
    challenge(username, gameType) {
      if (location.pathname !== '/') history.pushState(null, '', '/');
      state.selectedGameType = gameType;
      state.inviteAfterJoin = username;
      send(ClientMessage.ROOM_CREATE, { gameType, isPublic: false });
    },
    challengeByTurns(username, gameType) {
      if (location.pathname !== '/') history.pushState(null, '', '/');
      state.selectedGameType = gameType;
      send(ClientMessage.ASYNC_CREATE, { username, gameType });
    },
    join: joinCode,
  });
  initChat({
    send,
    navigate,
    openConversation,
    signIn: () => openSignIn(state.auth),
    signedIn: () => !!state.account,
    isAdmin: () => !!(state.account && state.account.admin),
    me: () => state.account && state.account.username,
  });
  initGlobalDock();
  state.auth = await initAuth();
  updateRankedButton();
  await state.auth.ready;
  state.auth.onChange(reconnectAs);
  renderChip();
  onRoute();
  if (!state.nickname && !state.auth.user && location.pathname === '/') showScreen('nickname');
  connect();
})();
