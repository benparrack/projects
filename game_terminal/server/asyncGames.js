// Turn-based games against a friend, played across visits (correspondence style). The game is an
// ordinary private room running the normal plugin, saved to `async/{code}` after every move, so it
// survives both players leaving and server restarts.
//
// Plugins seat players by connection clientId. At rest the saved state holds a stable placeholder
// `uid:<uid>` instead; joining swaps the placeholder for that connection's clientId and leaving
// swaps it back (clientIds are UUIDs, so a plain string swap over the JSON state is unambiguous).
// room.seen gets the placeholders too, so a result still credits a player who isn't connected.
// The state is saved as a JSON string because Firestore rejects nested arrays (every board here).
'use strict';

const { Room } = require('./roomManager');

// gameType -> its two seats. Each of these has players: { [seat]: id }, st.turn = seat,
// st.phase === 'game_over' when finished, and a { kind: 'sit', seat } message.
const ASYNC_GAMES = {
  chess: ['white', 'black'],
  checkers: ['red', 'black'],
  connect4: ['red', 'yellow'],
  reversi: ['black', 'white'],
  gomoku: ['black', 'white'],
  mancala: ['gold', 'jade'],
  backgammon: ['white', 'black'],
};
// Seats are fixed and there are no bots or clocks in a game that can sit for days.
const ALLOWED = new Set(['move', 'resign', 'resetGame', 'rollDice', 'reviewRequest', 'reviewClose']);
const MAX_ACTIVE = 20;
const PREFIX = 'ASYNC-';

const ph = (uid) => `uid:${uid}`;
const swap = (state, from, to) => JSON.parse(JSON.stringify(state).split(from).join(to));
const isAsyncCode = (code) => typeof code === 'string' && code.startsWith(PREFIX);

function createAsyncGames({ db, roomManager, registry, now = () => Date.now() }) {
  const saving = new Map(); // code -> promise chain, so saves land in order

  // The uid whose move it is (null when the game is over), from a placeholder-form state.
  function turnOf(state) {
    if (!state || state.phase === 'game_over' || !state.players) return null;
    const id = state.players[state.turn];
    return typeof id === 'string' && id.startsWith('uid:') ? id.slice(4) : null;
  }

  // State with every connected player's clientId swapped back to their placeholder.
  function restingState(room) {
    let s = room.state;
    for (const [cid, c] of room.clients) if (c.uid && room.async.uids.includes(c.uid)) s = swap(s, cid, ph(c.uid));
    return s;
  }

  function hydrate(code, doc) {
    const plugin = registry[doc.gameType];
    const room = roomManager.makeRoom(code, doc.gameType, false, plugin);
    room.state = JSON.parse(doc.state);
    room.async = { uids: doc.uids, names: doc.names };
    for (const uid of doc.uids) room.seen.set(ph(uid), { nickname: doc.names[uid], uid });
    return room;
  }

  async function list(uid) {
    const rows = await db.list('async', { where: [['uids', 'array-contains', uid]] });
    return rows.map((r) => {
      const opp = r.uids.find((u) => u !== uid);
      return { code: r.id, gameType: r.gameType, opponent: r.names[opp], yourTurn: r.turn === uid, over: !r.turn, updatedAt: r.updatedAt };
    }).sort((a, b) => (b.yourTurn - a.yourTurn) || (a.over - b.over) || (b.updatedAt - a.updatedAt));
  }

  return {
    ASYNC_GAMES,
    isAsyncCode,

    // Seats both players (in random order) on a fresh board and saves it. Returns { code } or { error }.
    async create(from, to, gameType) {
      const seats = ASYNC_GAMES[gameType];
      if (!seats) return { error: 'That game can\'t be played by turns.' };
      const mine = await list(from.uid);
      if (mine.filter((g) => !g.over).length >= MAX_ACTIVE) return { error: `You have ${MAX_ACTIVE} games going. Finish or remove one first.` };
      const plugin = registry[gameType];
      let code;
      do code = PREFIX + Math.random().toString(36).slice(2, 8).toUpperCase(); while (await db.get(`async/${code}`));
      const room = new Room(code, gameType, false, plugin);
      room.destroy(); // never registered or ticked; it only builds the starting state
      const order = Math.random() < 0.5 ? [from, to] : [to, from];
      seats.forEach((seat, i) => {
        const id = ph(order[i].uid);
        plugin.onMessage(room, { clientId: id, nickname: order[i].username }, { kind: 'sit', seat }, { senderId: id, sendTo() {}, broadcast() {} });
      });
      const t = now();
      await db.set(`async/${code}`, {
        gameType, uids: [from.uid, to.uid], names: { [from.uid]: from.username, [to.uid]: to.username },
        state: JSON.stringify(room.state), turn: turnOf(room.state), createdAt: t, updatedAt: t,
      });
      return { code };
    },

    // The live room for a code (loading it if needed), or { error } if this user can't open it.
    async open(code, uid) {
      let room = roomManager.getRoom(code);
      if (!room) {
        await saving.get(code); // the room may have just been dropped with its last save in flight
        const doc = await db.get(`async/${code}`);
        if (!doc) return { error: 'That game was removed.' };
        room = roomManager.getRoom(code) || hydrate(code, doc); // another join may have loaded it meanwhile
      }
      if (!room.async.uids.includes(uid)) return { error: 'This game is between two other players.' };
      return { room };
    },

    // Call right before joinAndAck: the joining connection takes over its player's seat.
    seat(room, uid, clientId) {
      room.state = swap(room.state, ph(uid), clientId);
    },

    // Call after the connection has left room.clients: hand the seat to another tab of the same
    // player if one is still in the room, else back to the placeholder.
    unseat(room, uid, clientId) {
      const other = [...room.clients].find(([, c]) => c.uid === uid);
      room.state = swap(room.state, clientId, other ? other[0] : ph(uid));
    },

    allowed: (data) => !!data && ALLOWED.has(data.kind) && !data.bot,

    // Persist after a move. Resolves to { turn, changed } so the caller can nudge the next player.
    save(room) {
      if (room.async.removed) return Promise.resolve({ turn: null, changed: false });
      const state = restingState(room);
      const turn = turnOf(state);
      const changed = turn !== room.async.lastTurn;
      room.async.lastTurn = turn;
      const prev = saving.get(room.code) || Promise.resolve();
      const p = prev.then(() => db.merge(`async/${room.code}`, { state: JSON.stringify(state), turn, updatedAt: now() })).catch((err) => console.error('async: save failed', err));
      saving.set(room.code, p);
      p.then(() => { if (saving.get(room.code) === p) saving.delete(room.code); });
      return p.then(() => ({ turn, changed }));
    },

    list,

    async remove(code, uid) {
      const doc = await db.get(`async/${code}`);
      if (!doc || !doc.uids.includes(uid)) return false;
      const room = roomManager.getRoom(code);
      if (room && room.async) room.async.removed = true;
      await saving.get(code);
      await db.del(`async/${code}`);
      return true;
    },
  };
}

module.exports = { createAsyncGames, ASYNC_GAMES, isAsyncCode };
