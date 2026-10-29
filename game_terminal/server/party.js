// Parties: a leader plus up to 7 friends who follow the leader into rooms. In memory only:
// a party is a "for this play session" thing and is gone after a server restart.
const crypto = require('crypto');

const MAX_PARTY = 8;
const INVITE_TTL_MS = 2 * 60 * 1000;

class Parties {
  constructor() {
    this.byId = new Map(); // id -> { id, leader, members: [uid] } (members includes the leader, join order)
    this.ofUid = new Map(); // uid -> id
    this.invites = new Map(); // `${id}:${uid}` -> expiresAt
  }

  get(uid) {
    const id = this.ofUid.get(uid);
    return id ? this.byId.get(id) : null;
  }

  // Leader (or a lone player, who becomes leader) invites someone. Returns { party } or { error }.
  invite(from, to, now = Date.now()) {
    let party = this.get(from);
    if (party && party.leader !== from) return { error: 'Only the party leader can invite.' };
    if (party && party.members.includes(to)) return { error: 'They\'re already in your party.' };
    if (party && party.members.length >= MAX_PARTY) return { error: `Parties are limited to ${MAX_PARTY} players.` };
    if (!party) {
      party = { id: crypto.randomUUID().slice(0, 8), leader: from, members: [from] };
      this.byId.set(party.id, party);
      this.ofUid.set(from, party.id);
    }
    this.invites.set(`${party.id}:${to}`, now + INVITE_TTL_MS);
    return { party };
  }

  // Returns { party, left } (left: the party they had to leave, if any) or { error }.
  accept(uid, id, now = Date.now()) {
    const key = `${id}:${uid}`;
    const exp = this.invites.get(key);
    this.invites.delete(key);
    const party = this.byId.get(id);
    if (!party || !exp || exp < now) return { error: 'That party invite has expired.' };
    if (party.members.length >= MAX_PARTY) return { error: 'That party is full.' };
    const left = this.get(uid) && this.get(uid).id !== id ? this.leave(uid) : null;
    if (!party.members.includes(uid)) party.members.push(uid);
    this.ofUid.set(uid, id);
    return { party, left };
  }

  // Returns the party as it is afterwards (null if it disbanded), with `before` = members before.
  leave(uid) {
    const party = this.get(uid);
    if (!party) return null;
    const before = [...party.members];
    party.members = party.members.filter((u) => u !== uid);
    this.ofUid.delete(uid);
    if (party.members.length < 2) {
      for (const u of party.members) this.ofUid.delete(u);
      this.byId.delete(party.id);
      for (const k of this.invites.keys()) if (k.startsWith(`${party.id}:`)) this.invites.delete(k);
      return { party: null, before };
    }
    if (party.leader === uid) party.leader = party.members[0];
    return { party, before };
  }

  kick(leader, target) {
    const party = this.get(leader);
    if (!party || party.leader !== leader) return { error: 'Only the party leader can remove players.' };
    if (!party.members.includes(target) || target === leader) return { error: 'They\'re not in your party.' };
    return this.leave(target);
  }

  // Members (other than the leader) who should follow the leader into a room.
  followers(leader) {
    const party = this.get(leader);
    return party && party.leader === leader ? party.members.filter((u) => u !== leader) : [];
  }
}

module.exports = { Parties };
