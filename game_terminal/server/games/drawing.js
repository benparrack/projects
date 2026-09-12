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

    if (data.kind === 'clear') {
      room.state.history = [];
      ctx.broadcast({ type: 'game.event', v: 1, payload: { gameType: 'drawing', data: { kind: 'clear' } } }, ctx.senderId);
    }
  },
};
