// Game Boy arcade room. Emulation runs entirely client-side (public/games/gameboy/); the server
// only tracks who's playing what and relays spectator streams.
//
// Spectating is lockstep replay, not video: the emulator is deterministic, so a watcher loads
// the same bundled ROM, receives one gzipped save state ("key", ~10-20 KB) and then just the
// streamer's button changes tagged with frame numbers ("inp", a few bytes each). Only games from
// the bundled homebrew library can be watched — custom ROMs a player opened locally never leave
// their browser.

const LIBRARY = new Set([ // must match client.js LIBRARY ids
  'ucity', 'libbet', 'big2small', 'tobudx', 'porklike', 'shocklobster', 'geometrix', 'adjustris', '2048', 'linktron',
]);
const MAX_LMSG = 4000;       // JSON chars per relayed link message
const MAX_KEY_LEN = 60000;   // base64 chars; stays under the 64 KB WS maxPayload with the envelope
const MAX_INPUTS = 256;      // per 'inp' batch

function event(data) {
  return { v: 1, type: 'game.event', payload: { gameType: 'gameboy', data } };
}

function buildView(st) {
  const watchers = new Map();
  for (const p of st.players.values()) if (p.watching) watchers.set(p.watching, (watchers.get(p.watching) || 0) + 1);
  return {
    kind: 'roster',
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      lib: p.lib,
      title: p.title,
      watching: p.watching,
      watchers: watchers.get(p.clientId) || 0,
      link: p.link,       // partner's clientId while linked
      invite: p.invite,   // clientId this player has invited to link
    })),
  };
}

function broadcastRoster(room, excludeId) {
  room.broadcast(event(buildView(room.state)), excludeId);
}

function watchersOf(st, clientId) {
  const out = [];
  for (const p of st.players.values()) if (p.watching === clientId) out.push(p.clientId);
  return out;
}

// Unlinks `p` and tells its partner (if any) why. Caller broadcasts the roster.
function endLink(room, p, reason) {
  const partner = p.link ? room.state.players.get(p.link) : null;
  p.link = null;
  if (partner && partner.link === p.clientId) {
    partner.link = null;
    partner.lib = null;
    partner.title = null;
    room.sendTo(partner.clientId, event({ kind: 'linkEnd', reason }));
  }
}

module.exports = {
  type: 'gameboy',

  createInitialState() {
    return { players: new Map() };
  },

  serializeSnapshot(room) {
    return buildView(room.state);
  },

  onJoin(room, client) {
    room.state.players.set(client.clientId, {
      clientId: client.clientId, nickname: client.nickname, lib: null, title: null, watching: null,
      link: null, invite: null,
    });
    broadcastRoster(room, client.clientId); // the joiner gets the same view as its join snapshot
  },

  onLeave(room, client) {
    const st = room.state;
    const me = st.players.get(client.clientId);
    if (me) endLink(room, me, 'left');
    st.players.delete(client.clientId);
    for (const p of st.players.values()) {
      if (p.watching === client.clientId) p.watching = null;
      if (p.invite === client.clientId) p.invite = null;
    }
    broadcastRoster(room);
  },

  onMessage(room, client, data, ctx) {
    const st = room.state;
    const me = st.players.get(ctx.senderId);
    if (!me || !data || typeof data.kind !== 'string') return;

    switch (data.kind) {
      // What this player has loaded. lib = bundled library id (watchable) or null (custom ROM / nothing).
      case 'playing': {
        const lib = LIBRARY.has(data.lib) ? data.lib : null;
        const title = typeof data.title === 'string' ? data.title.slice(0, 40) : null;
        if (me.link) endLink(room, me, 'quit'); // loading something else unplugs the cable
        me.lib = lib;
        me.title = title;
        if (me.watching && (lib || title)) me.watching = null; // started playing yourself
        broadcastRoster(room);
        return;
      }

      case 'watch': {
        const target = typeof data.target === 'string' ? st.players.get(data.target) : null;
        // Linked sessions can't be watched: their inputs never go through the spectator stream.
        me.watching = target && target.clientId !== me.clientId && !target.link && !me.link ? target.clientId : null;
        broadcastRoster(room);
        if (me.watching && target.lib) ctx.sendTo(target.clientId, event({ kind: 'needKey' }));
        return;
      }

      // Streamer -> its watchers: keyframe.
      case 'key': {
        if (!me.lib || typeof data.state !== 'string' || data.state.length > MAX_KEY_LEN) return;
        const frame = Number(data.frame), mask = Number(data.mask);
        if (!Number.isInteger(frame) || frame < 0 || !Number.isInteger(mask)) return;
        const msg = event({ kind: 'key', from: me.clientId, lib: me.lib, state: data.state, frame, mask: mask & 0xff });
        for (const id of watchersOf(st, me.clientId)) ctx.sendTo(id, msg);
        return;
      }

      // Streamer -> its watchers: input log batch + how far the streamer has emulated.
      case 'inp': {
        if (!me.lib || !Array.isArray(data.i) || data.i.length > MAX_INPUTS) return;
        const upTo = Number(data.upTo);
        if (!Number.isInteger(upTo)) return;
        const inputs = [];
        for (const e of data.i) {
          if (!Array.isArray(e) || !Number.isInteger(e[0]) || !Number.isInteger(e[1])) return;
          inputs.push([e[0], e[1] & 0xff]);
        }
        const watchers = watchersOf(st, me.clientId);
        if (!watchers.length) return;
        const msg = event({ kind: 'inp', from: me.clientId, i: inputs, upTo });
        for (const id of watchers) ctx.sendTo(id, msg);
        return;
      }

      // Link cable. Invite someone (or cancel with target=null); the invite shows in the roster.
      case 'linkInvite': {
        const target = typeof data.target === 'string' ? st.players.get(data.target) : null;
        me.invite = target && target.clientId !== me.clientId && !target.link && !me.link ? target.clientId : null;
        broadcastRoster(room);
        return;
      }

      // Accept an invite from `from`: both sides get linkStart with their side (0 = P1 = inviter).
      case 'linkAccept': {
        const from = typeof data.from === 'string' ? st.players.get(data.from) : null;
        if (!from || from.invite !== me.clientId || from.link || me.link) return;
        const lib = 'linktron';
        from.invite = me.invite = null;
        from.link = me.clientId;
        me.link = from.clientId;
        for (const p of [from, me]) {
          p.lib = null; // not watchable while linked
          p.title = 'LINK TRON (LINK)';
          p.watching = null;
        }
        for (const p of st.players.values()) if (p.watching === from.clientId || p.watching === me.clientId) p.watching = null;
        const names = [from.nickname, me.nickname];
        ctx.sendTo(from.clientId, event({ kind: 'linkStart', side: 0, partner: me.clientId, lib, names }));
        ctx.sendTo(me.clientId, event({ kind: 'linkStart', side: 1, partner: from.clientId, lib, names }));
        broadcastRoster(room);
        return;
      }

      case 'linkEnd': {
        if (!me.link) return;
        endLink(room, me, 'quit');
        me.lib = null;
        me.title = null;
        broadcastRoster(room);
        return;
      }

      // Peer-to-peer link traffic (inputs, hashes, pings) relayed verbatim to the partner.
      case 'lmsg': {
        if (!me.link || !data.m || typeof data.m !== 'object') return;
        if (JSON.stringify(data.m).length > MAX_LMSG) return;
        ctx.sendTo(me.link, event({ kind: 'lmsg', m: data.m }));
        return;
      }
    }
  },
};
