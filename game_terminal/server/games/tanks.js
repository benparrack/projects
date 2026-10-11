// Tanks (GamePigeon style) — 2 seats, red (left) vs blue (right), a side-view artillery duel on a
// random destructible hillside. On your turn you may drive left/right with this turn's fuel, set
// the barrel angle and power, pick a weapon (Shell is unlimited; Big Shot, Triple and Bouncer have
// 2 rounds each) and FIRE. Wind changes every turn. Blasts carve craters, tanks drop onto the new
// ground (a long fall hurts), and the first tank to 0 HP loses. After MAX_TURNS shots in total the
// healthier tank wins. Red fires first; a rematch swaps seats so the opener alternates.
//
// Physics live in public/games/tanks/sim.js, shared with the browser: the client sends the input
// { angle, power, weapon }, the server simulates the whole shot (projectile frames, explosions,
// terrain carving, damage, falls) and broadcasts it. Live aiming and driving go out as small `tank`
// events (no terrain) so spectators see the barrel move; shots go out with the full state.

'use strict';

const Sim = require('../../public/games/tanks/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'tanks';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const FRAME_MS = 1000 / Sim.FPS;
const SETTLE_FRAMES = 36; // tanks drop / smoke clears after the last blast
// Bot pacing (tests shrink these via _internal.timing).
const timing = { min: 900, max: 1600, aim: 750, drive: 600, after: 650 };

const opponent = (c) => (c === 'red' ? 'blue' : 'red');
const randWind = () => Math.round(Math.random() * 20 - 10);

function newTank(x, facingRight) {
  const ammo = {};
  for (const k of Sim.WEAPON_KEYS) if (Sim.WEAPONS[k].ammo != null) ammo[k] = Sim.WEAPONS[k].ammo;
  return { x, hp: Sim.MAX_HP, fuel: Sim.FUEL, angle: facingRight ? 45 : 135, power: 60, weapon: 'shell', ammo };
}

function resetGame(st) {
  st.seed = (Math.random() * 0x7fffffff) >>> 0;
  const g = Sim.generate(st.seed);
  st.terrain = g.terrain;
  st.tanks = { red: newTank(g.xs.red, true), blue: newTank(g.xs.blue, false) };
  st.turn = 'red';
  st.turnNo = 0;
  st.wind = randWind();
  st.winner = null;
  st.endReason = null;
  st.lastShot = null;
  st.shotSeq = 0;
  st.busyUntil = 0;
  st.stats = { red: { shots: 0, hits: 0, dmg: 0 }, blue: { shots: 0, hits: 0, dmg: 0 } };
  st.gameId = (st.gameId || 0) + 1;
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    terrain: st.terrain,
    tanks: st.tanks,
    turn: st.turn,
    turnNo: st.turnNo,
    maxTurns: Sim.MAX_TURNS,
    wind: st.wind,
    winner: st.winner,
    endReason: st.endReason,
    lastShot: st.lastShot,
    shotSeq: st.shotSeq,
    busyUntil: st.busyUntil,
    stats: st.stats,
    gameId: st.gameId,
    serverNow: Date.now(),
  };
}

function event(room, data) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data } });
}
const broadcastState = (room) => event(room, { kind: 'state', ...buildPublicState(room) });
function broadcastTank(room, seat, ack) {
  const t = room.state.tanks[seat];
  event(room, {
    kind: 'tank', gameId: room.state.gameId, shotSeq: room.state.shotSeq, seat,
    x: t.x, fuel: t.fuel, angle: t.angle, power: t.power, weapon: t.weapon, ack: ack == null ? null : ack,
  });
}

function seatOf(st, clientId) {
  return st.players.red === clientId ? 'red' : st.players.blue === clientId ? 'blue' : null;
}

const hasAmmo = (tank, weapon) => Sim.isWeapon(weapon) && (Sim.WEAPONS[weapon].ammo == null || (tank.ammo[weapon] || 0) > 0);

// Aim / weapon change (no state change other than the barrel). Returns true when applied.
function applyAim(st, seat, data) {
  const t = st.tanks[seat];
  const angle = Number(data.angle);
  const power = Number(data.power);
  if (!Number.isFinite(angle) || !Number.isFinite(power)) return false;
  t.angle = Math.round(Math.max(0, Math.min(180, angle)));
  t.power = Math.round(Math.max(0, Math.min(100, power)));
  if (typeof data.weapon === 'string' && hasAmmo(t, data.weapon)) t.weapon = data.weapon;
  return true;
}

function applyDrive(st, seat, dir, steps) {
  const t = st.tanks[seat];
  const d = Sim.drive(st.terrain, t.x, dir, steps, t.fuel, st.tanks[opponent(seat)].x);
  t.x = d.x;
  t.fuel = d.fuel;
  return d.moved;
}

// Validated shot by `seat`. Returns the shot record or null.
function applyFire(st, seat, raw, now) {
  const tank = st.tanks[seat];
  const input = Sim.normInput(raw);
  if (!input || !hasAmmo(tank, input.weapon)) return null;
  const tanks = { red: { x: st.tanks.red.x, hp: st.tanks.red.hp }, blue: { x: st.tanks.blue.x, hp: st.tanks.blue.hp } };
  const res = Sim.simulate(st.terrain, tanks, seat, input, st.wind);
  if (!res) return null;
  const opp = opponent(seat);
  const hpBefore = { red: tanks.red.hp, blue: tanks.blue.hp };
  st.shotSeq++;
  tank.angle = input.angle;
  tank.power = input.power;
  if (Sim.WEAPONS[input.weapon].ammo != null) tank.ammo[input.weapon]--;
  tank.weapon = hasAmmo(tank, input.weapon) ? input.weapon : 'shell';
  st.terrain = res.terrain;
  for (const c of COLORS) st.tanks[c].hp = res.hp[c];
  const dealt = hpBefore[opp] - res.hp[opp];
  st.stats[seat].shots++;
  if (dealt > 0) { st.stats[seat].hits++; st.stats[seat].dmg += dealt; }
  st.turnNo++;
  const rec = {
    seq: st.shotSeq,
    by: seat,
    input: res.input,
    wind: res.wind,
    projectiles: res.projectiles,
    explosions: res.explosions,
    falls: res.falls,
    fallDmg: res.fallDmg,
    frames: res.frames,
    hpBefore,
    hpAfter: { ...res.hp },
    tankXs: { red: st.tanks.red.x, blue: st.tanks.blue.x },
  };
  const deadMe = res.hp[seat] <= 0;
  const deadOpp = res.hp[opp] <= 0;
  if (deadMe || deadOpp) {
    st.phase = 'game_over';
    st.winner = deadMe && deadOpp ? 'draw' : deadOpp ? seat : opp;
    st.endReason = 'destroyed';
  } else if (st.turnNo >= Sim.MAX_TURNS) {
    st.phase = 'game_over';
    st.winner = res.hp.red === res.hp.blue ? 'draw' : res.hp.red > res.hp.blue ? 'red' : 'blue';
    st.endReason = 'turns';
  } else {
    st.turn = opp;
    st.wind = randWind();
    st.tanks[opp].fuel = Sim.FUEL;
    if (!hasAmmo(st.tanks[opp], st.tanks[opp].weapon)) st.tanks[opp].weapon = 'shell';
  }
  rec.windNext = st.wind;
  st.lastShot = rec;
  st.busyUntil = now + Math.round((res.frames + SETTLE_FRAMES) * FRAME_MS) + timing.after;
  return rec;
}

function fallbackPlan(st, seat) {
  const right = st.tanks[opponent(seat)].x > st.tanks[seat].x;
  const a = 35 + Math.floor(Math.random() * 30);
  return { angle: right ? a : 180 - a, power: 50 + Math.floor(Math.random() * 30), weapon: 'shell', drive: null };
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const { gameId, shotSeq, turn } = st;
  const stillValid = () => {
    const s = room.state;
    return s === st && s.phase === 'playing' && s.gameId === gameId && s.shotSeq === shotSeq
      && s.turn === turn && s.players[turn] === BOT;
  };
  const wait = Math.max(0, st.busyUntil - Date.now()) + timing.min + Math.random() * (timing.max - timing.min);
  setTimeout(() => {
    if (!stillValid()) return;
    let plan;
    try {
      plan = Sim.botPlan({ terrain: st.terrain, tanks: st.tanks, wind: st.wind, turnNo: st.turnNo }, turn, botLevelOf(st, turn));
    } catch (e) {
      plan = null;
    }
    if (!plan || !Sim.normInput(plan)) plan = fallbackPlan(st, turn);
    if (!hasAmmo(st.tanks[turn], plan.weapon)) plan.weapon = 'shell';
    const aimThenFire = () => {
      if (!stillValid()) return;
      applyAim(st, turn, plan);
      broadcastTank(room, turn);
      setTimeout(() => {
        if (!stillValid()) return;
        if (!applyFire(st, turn, plan, Date.now()) && !applyFire(st, turn, fallbackPlan(st, turn), Date.now())) return;
        broadcastState(room);
        maybeScheduleBot(room);
      }, timing.aim);
    };
    if (plan.drive && plan.drive.steps > 0) {
      applyDrive(st, turn, plan.drive.dir, plan.drive.steps);
      broadcastTank(room, turn);
      setTimeout(aimThenFire, timing.drive);
    } else aimThenFire();
  }, wait);
}

function startIfReady(st) {
  if (st.players.red && st.players.blue) {
    resetGame(st);
    st.phase = 'playing';
  }
}

function vacate(st, seat) {
  st.players[seat] = null;
  st.phase = 'waiting';
  resetGame(st);
}

module.exports = {
  type: TYPE,

  createInitialState() {
    const st = { phase: 'waiting', players: { red: null, blue: null }, botLevels: {} };
    resetGame(st);
    return st;
  },

  isRoomFull() {
    return false; // spectators welcome
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client.clientId);
    if (!seat) return;
    vacate(st, seat);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data !== 'object' || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const reject = (reason) => ctx.sendTo(me, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const seatArg = COLORS.includes(data.seat) ? data.seat : null;

    if (data.kind === 'sit') {
      if (!seatArg || st.players[seatArg]) return;
      if (data.bot) {
        st.players[seatArg] = BOT;
        setBotLevel(st, seatArg, data.level);
      } else {
        if (seatOf(st, me)) return;
        st.players[seatArg] = me;
      }
      startIfReady(st);
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const seat = seatOf(st, me);
      if (!seat) return;
      vacate(st, seat);
      broadcastState(room);
      return;
    }

    if (data.kind === 'setBotLevel') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      setBotLevel(st, seatArg, data.level);
      broadcastState(room);
      return;
    }

    if (data.kind === 'removeBot') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      vacate(st, seatArg);
      broadcastState(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over' || !seatOf(st, me)) return;
      st.players = { red: st.players.blue, blue: st.players.red };
      st.botLevels = { red: (st.botLevels || {}).blue, blue: (st.botLevels || {}).red };
      resetGame(st);
      st.phase = st.players.red && st.players.blue ? 'playing' : 'waiting';
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    // ---- turn actions ----
    if (data.kind !== 'aim' && data.kind !== 'drive' && data.kind !== 'fire') return;
    const quiet = data.kind !== 'fire'; // aim/drive spam is ignored silently when out of turn
    if (st.phase !== 'playing') return quiet ? undefined : reject('not_playing');
    const seat = seatOf(st, me);
    if (!seat || seat !== st.turn) return quiet ? undefined : reject('not_your_turn');
    const now = Date.now();
    if (now < st.busyUntil - 150) return quiet ? undefined : reject('busy'); // small grace for clock jitter

    if (data.kind === 'aim') {
      if (applyAim(st, seat, data)) broadcastTank(room, seat);
      return;
    }
    if (data.kind === 'drive') {
      const dir = data.dir === -1 || data.dir === 1 ? data.dir : 0;
      const steps = Number.isInteger(data.steps) ? data.steps : 0;
      const ack = Number.isInteger(data.seq) ? data.seq : null;
      if (!dir || steps < 1 || steps > 60) return;
      applyDrive(st, seat, dir, steps);
      broadcastTank(room, seat, ack);
      return;
    }
    // fire
    if (!Sim.isWeapon(data.weapon)) return reject('invalid');
    if (!hasAmmo(st.tanks[seat], data.weapon)) return reject('no_ammo');
    if (!applyFire(st, seat, { angle: data.angle, power: data.power, weapon: data.weapon }, now)) return reject('invalid');
    broadcastState(room);
    maybeScheduleBot(room);
  },

  _internal: { timing, applyFire, applyDrive, resetGame, FRAME_MS },
};
