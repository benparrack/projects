const MAX_HISTORY = 5000;
const TRIM_TO = 4000; // when history exceeds MAX_HISTORY, cut back to this many most-recent segments

module.exports = {
  type: 'drawing',

  createInitialState() {
    return { history: [] };
  },

  serializeSnapshot(room) {
    return { segments: room.state.history };
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;

    if (data.kind === 'segment') {
      const seg = data.segment;
      if (!seg || [seg.x0, seg.y0, seg.x1, seg.y1].some((n) => typeof n !== 'number')) return;
      const record = {
        strokeId: String(seg.strokeId || ''),
        clientId: ctx.senderId,
        x0: seg.x0,
        y0: seg.y0,
        x1: seg.x1,
        y1: seg.y1,
        color: typeof seg.color === 'string' ? seg.color.slice(0, 20) : '#39ff14',
        size: typeof seg.size === 'number' ? Math.min(Math.max(seg.size, 1), 50) : 3,
      };
      room.state.history.push(record);
      if (room.state.history.length > MAX_HISTORY) {
        room.state.history = room.state.history.slice(-TRIM_TO);
      }
      ctx.broadcast({ type: 'game.event', v: 1, payload: { gameType: 'drawing', data: { kind: 'segment', segment: record } } }, ctx.senderId);
      return;
    }

    // A flood fill is stored as a compact command (point + color), not raw pixels — every client
    // replays it by running the same flood-fill algorithm against its own canvas, which stays
    // consistent across clients because everyone applies history in the same order onto the same
    // starting blank canvas. Shares the strokeId/clientId shape with 'segment' records on purpose
    // so it rides along unchanged through the existing undoStroke/clearMine ownership filters below.
    if (data.kind === 'fill') {
      const f = data.fill;
      if (!f || typeof f.x !== 'number' || typeof f.y !== 'number') return;
      const record = {
        type: 'fill',
        strokeId: String(f.strokeId || ''),
        clientId: ctx.senderId,
        x: f.x,
        y: f.y,
        color: typeof f.color === 'string' ? f.color.slice(0, 20) : '#39ff14',
      };
      room.state.history.push(record);
      if (room.state.history.length > MAX_HISTORY) {
        room.state.history = room.state.history.slice(-TRIM_TO);
      }
      ctx.broadcast({ type: 'game.event', v: 1, payload: { gameType: 'drawing', data: { kind: 'fill', fill: record } } }, ctx.senderId);
      return;
    }

    if (data.kind === 'clear') {
      room.state.history = [];
      ctx.broadcast({ type: 'game.event', v: 1, payload: { gameType: 'drawing', data: { kind: 'clear' } } }, ctx.senderId);
      return;
    }

    // Scoped to the sender's own segments only — a shared canvas where one player's CLEAR wiped
    // everyone's work was a real playtest complaint ("clear should only clear the work each
    // individual has done"). Broadcast to everyone (sender included, unlike the other handlers
    // here) since every client needs to replay its own local segment history minus this client's
    // strokes to reproduce the same result.
    if (data.kind === 'clearMine') {
      room.state.history = room.state.history.filter((s) => s.clientId !== ctx.senderId);
      ctx.broadcast({ type: 'game.event', v: 1, payload: { gameType: 'drawing', data: { kind: 'clearMine', clientId: ctx.senderId } } });
      return;
    }

    if (data.kind === 'undoStroke') {
      const strokeId = String(data.strokeId || '');
      if (!strokeId) return;
      const before = room.state.history.length;
      // Ownership check: a client can only undo strokes it drew itself, even though strokeIds are
      // visible to everyone via broadcast 'segment' events — otherwise anyone could undo anyone's
      // stroke just by having seen its id go by.
      room.state.history = room.state.history.filter((s) => !(s.strokeId === strokeId && s.clientId === ctx.senderId));
      if (room.state.history.length === before) return;
      ctx.broadcast({ type: 'game.event', v: 1, payload: { gameType: 'drawing', data: { kind: 'undoStroke', strokeId } } });
    }
  },
};
