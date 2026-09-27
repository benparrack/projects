// Chess engine for the chess bot. A 10x12 mailbox with make/unmake, Zobrist hashing and a
// transposition table; iterative-deepening PVS with null-move pruning, late-move reductions,
// check extensions, killer/history move ordering and a capture-only quiescence search. The
// evaluation is tapered (middlegame -> endgame): material + piece-square tables, pawn structure
// (passed/doubled/isolated), bishop pair, rooks on open files, king pawn shield, and a "mop-up"
// term that drives a lone king to the edge so won endgames actually get converted.
// Board format matches server/games/chess.js: board[r][c] = { color, type } | null, r = 0 is
// Black's back rank (rank 8).

'use strict';

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6, OFF = 7;
const TYPE_CODE = { pawn: P, knight: N, bishop: B, rook: R, queen: Q, king: K };
const CODE_TYPE = [null, 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const VALUE = [0, 100, 320, 330, 500, 900, 0];
const PHASE_W = [0, 0, 1, 1, 2, 4, 0];
const MATE = 30000;
const INF = 32000;

const KNIGHT_D = [-21, -19, -12, -8, 8, 12, 19, 21];
const BISHOP_D = [-11, -9, 9, 11];
const ROOK_D = [-10, -1, 1, 10];
const KING_D = [-11, -10, -9, -1, 1, 9, 10, 11];

const SQ64 = [];
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) SQ64.push(21 + r * 10 + c);
const rowOf = (sq) => ((sq / 10) | 0) - 2;
const colOf = (sq) => (sq % 10) - 1;

// Piece-square tables, White's point of view, index 0 = a8 (row 0) ... 63 = h1.
const PST = [null,
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
];
const KING_EG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
const PASSED = [0, 10, 20, 35, 60, 100, 150, 0]; // by ranks advanced from the pawn's start row

// Castling-rights masks: moving from/to these squares clears the matching rights.
// Bits: 1 = white king-side, 2 = white queen-side, 4 = black king-side, 8 = black queen-side.
const CASTLE_MASK = new Int8Array(120).fill(15);
CASTLE_MASK[95] = 15 & ~3; CASTLE_MASK[98] = 15 & ~1; CASTLE_MASK[91] = 15 & ~2;
CASTLE_MASK[25] = 15 & ~12; CASTLE_MASK[28] = 15 & ~4; CASTLE_MASK[21] = 15 & ~8;

let zseed = 0x2545f491;
function rnd32() {
  zseed ^= zseed << 13; zseed ^= zseed >>> 17; zseed ^= zseed << 5;
  return zseed | 0;
}
const ZP_LO = new Int32Array(13 * 120); const ZP_HI = new Int32Array(13 * 120);
const ZC_LO = new Int32Array(16); const ZC_HI = new Int32Array(16);
const ZE_LO = new Int32Array(120); const ZE_HI = new Int32Array(120);
for (let i = 0; i < ZP_LO.length; i++) { ZP_LO[i] = rnd32(); ZP_HI[i] = rnd32(); }
for (let i = 0; i < 16; i++) { ZC_LO[i] = rnd32(); ZC_HI[i] = rnd32(); }
for (let i = 0; i < 120; i++) { ZE_LO[i] = rnd32(); ZE_HI[i] = rnd32(); }
const ZS_LO = rnd32(); const ZS_HI = rnd32();

const TT_SIZE = 1 << 20;
const TT_MASK = TT_SIZE - 1;
const ttKey = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE);
const ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Int8Array(TT_SIZE); // 0 empty, 1 exact, 2 lower bound, 3 upper bound

const MAX_PLY = 64;
const MOVE_BUF = new Int32Array(MAX_PLY * 256);
const SCORE_BUF = new Int32Array(MAX_PLY * 256);
const UNDO = 1024;

// Move encoding: from | to << 7 | promo << 14 | flags << 17 (1 = en passant, 2 = castle, 4 = double push).
const mFrom = (m) => m & 127;
const mTo = (m) => (m >> 7) & 127;
const mPromo = (m) => (m >> 14) & 7;
const mFlag = (m) => m >> 17;

class Position {
  constructor() {
    this.b = new Int8Array(120).fill(OFF);
    for (const sq of SQ64) this.b[sq] = 0;
    this.side = 1;
    this.castle = 0;
    this.ep = 0;
    this.lo = 0; this.hi = 0;
    this.kingSq = [0, 0];
    this.hp = 0;
    this.uCap = new Int8Array(UNDO); this.uCastle = new Int8Array(UNDO); this.uEp = new Int8Array(UNDO);
    this.uLo = new Int32Array(UNDO); this.uHi = new Int32Array(UNDO);
  }

  xorPiece(pc, sq) {
    const i = (pc + 6) * 120 + sq;
    this.lo ^= ZP_LO[i]; this.hi ^= ZP_HI[i];
  }

  computeHash() {
    this.lo = 0; this.hi = 0;
    for (const sq of SQ64) if (this.b[sq]) this.xorPiece(this.b[sq], sq);
    this.lo ^= ZC_LO[this.castle]; this.hi ^= ZC_HI[this.castle];
    if (this.ep) { this.lo ^= ZE_LO[this.ep]; this.hi ^= ZE_HI[this.ep]; }
    if (this.side === -1) { this.lo ^= ZS_LO; this.hi ^= ZS_HI; }
  }

  attacked(sq, by) {
    const b = this.b;
    if (by === 1) { if (b[sq + 9] === P || b[sq + 11] === P) return true; }
    else if (b[sq - 9] === -P || b[sq - 11] === -P) return true;
    const n = N * by; const k = K * by; const bi = B * by; const r = R * by; const q = Q * by;
    for (let i = 0; i < 8; i++) {
      if (b[sq + KNIGHT_D[i]] === n) return true;
      if (b[sq + KING_D[i]] === k) return true;
    }
    for (let i = 0; i < 4; i++) {
      let d = BISHOP_D[i]; let t = sq + d;
      while (b[t] === 0) t += d;
      if (b[t] === bi || b[t] === q) return true;
      d = ROOK_D[i]; t = sq + d;
      while (b[t] === 0) t += d;
      if (b[t] === r || b[t] === q) return true;
    }
    return false;
  }

  inCheck(side = this.side) {
    return this.attacked(this.kingSq[side === 1 ? 0 : 1], -side);
  }

  // Pseudo-legal moves into buf starting at off; returns the new end offset.
  gen(buf, off, capsOnly) {
    const b = this.b; const s = this.side;
    const fwd = s === 1 ? -10 : 10;
    const startRow = s === 1 ? 6 : 1;
    const promoRow = s === 1 ? 0 : 7;
    for (let i = 0; i < 64; i++) {
      const sq = SQ64[i];
      const pc = b[sq] * s;
      if (pc <= 0) continue;
      if (pc === P) {
        const one = sq + fwd;
        const promo = rowOf(one) === promoRow;
        if (b[one] === 0) {
          if (promo) {
            buf[off++] = sq | one << 7 | Q << 14;
            if (!capsOnly) { buf[off++] = sq | one << 7 | N << 14; buf[off++] = sq | one << 7 | R << 14; buf[off++] = sq | one << 7 | B << 14; }
          } else if (!capsOnly) {
            buf[off++] = sq | one << 7;
            if (rowOf(sq) === startRow && b[one + fwd] === 0) buf[off++] = sq | (one + fwd) << 7 | 4 << 17;
          }
        }
        for (const t of [one - 1, one + 1]) {
          const tp = b[t];
          if (tp !== OFF && tp * s < 0) {
            if (promo) {
              buf[off++] = sq | t << 7 | Q << 14;
              if (!capsOnly) { buf[off++] = sq | t << 7 | N << 14; buf[off++] = sq | t << 7 | R << 14; buf[off++] = sq | t << 7 | B << 14; }
            } else buf[off++] = sq | t << 7;
          } else if (t === this.ep && tp === 0) buf[off++] = sq | t << 7 | 1 << 17;
        }
        continue;
      }
      if (pc === N || pc === K) {
        const D = pc === N ? KNIGHT_D : KING_D;
        for (let j = 0; j < 8; j++) {
          const t = sq + D[j]; const tp = b[t];
          if (tp === OFF) continue;
          if (tp === 0) { if (!capsOnly) buf[off++] = sq | t << 7; }
          else if (tp * s < 0) buf[off++] = sq | t << 7;
        }
        continue;
      }
      const D = pc === B ? BISHOP_D : pc === R ? ROOK_D : KING_D;
      for (let j = 0; j < D.length; j++) {
        const d = D[j]; let t = sq + d;
        while (b[t] === 0) { if (!capsOnly) buf[off++] = sq | t << 7; t += d; }
        if (b[t] !== OFF && b[t] * s < 0) buf[off++] = sq | t << 7;
      }
    }
    if (!capsOnly) {
      if (s === 1) {
        if ((this.castle & 1) && b[96] === 0 && b[97] === 0 && !this.attacked(95, -1) && !this.attacked(96, -1) && !this.attacked(97, -1)) buf[off++] = 95 | 97 << 7 | 2 << 17;
        if ((this.castle & 2) && b[94] === 0 && b[93] === 0 && b[92] === 0 && !this.attacked(95, -1) && !this.attacked(94, -1) && !this.attacked(93, -1)) buf[off++] = 95 | 93 << 7 | 2 << 17;
      } else {
        if ((this.castle & 4) && b[26] === 0 && b[27] === 0 && !this.attacked(25, 1) && !this.attacked(26, 1) && !this.attacked(27, 1)) buf[off++] = 25 | 27 << 7 | 2 << 17;
        if ((this.castle & 8) && b[24] === 0 && b[23] === 0 && b[22] === 0 && !this.attacked(25, 1) && !this.attacked(24, 1) && !this.attacked(23, 1)) buf[off++] = 25 | 23 << 7 | 2 << 17;
      }
    }
    return off;
  }

  make(m) {
    const b = this.b; const s = this.side;
    const from = mFrom(m); const to = mTo(m); const promo = mPromo(m); const flag = mFlag(m);
    const pc = b[from];
    const h = this.hp++;
    this.uCap[h] = b[to]; this.uCastle[h] = this.castle; this.uEp[h] = this.ep;
    this.uLo[h] = this.lo; this.uHi[h] = this.hi;
    this.xorPiece(pc, from);
    if (b[to]) this.xorPiece(b[to], to);
    b[from] = 0;
    if (flag & 1) {
      const cs = to + 10 * s;
      this.uCap[h] = b[cs];
      this.xorPiece(b[cs], cs);
      b[cs] = 0;
    }
    const placed = promo ? promo * s : pc;
    b[to] = placed;
    this.xorPiece(placed, to);
    if (pc === K * s) this.kingSq[s === 1 ? 0 : 1] = to;
    if (flag & 2) {
      let rf; let rt;
      if (to === 97) { rf = 98; rt = 96; } else if (to === 93) { rf = 91; rt = 94; } else if (to === 27) { rf = 28; rt = 26; } else { rf = 21; rt = 24; }
      this.xorPiece(b[rf], rf); b[rt] = b[rf]; b[rf] = 0; this.xorPiece(b[rt], rt);
    }
    this.lo ^= ZC_LO[this.castle]; this.hi ^= ZC_HI[this.castle];
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.lo ^= ZC_LO[this.castle]; this.hi ^= ZC_HI[this.castle];
    if (this.ep) { this.lo ^= ZE_LO[this.ep]; this.hi ^= ZE_HI[this.ep]; }
    this.ep = (flag & 4) ? (from + to) >> 1 : 0;
    if (this.ep) { this.lo ^= ZE_LO[this.ep]; this.hi ^= ZE_HI[this.ep]; }
    this.side = -s;
    this.lo ^= ZS_LO; this.hi ^= ZS_HI;
  }

  unmake(m) {
    const b = this.b;
    const s = (this.side = -this.side);
    const h = --this.hp;
    const from = mFrom(m); const to = mTo(m); const promo = mPromo(m); const flag = mFlag(m);
    const orig = promo ? P * s : b[to];
    b[from] = orig;
    if (flag & 1) { b[to] = 0; b[to + 10 * s] = this.uCap[h]; } else b[to] = this.uCap[h];
    if (orig === K * s) this.kingSq[s === 1 ? 0 : 1] = from;
    if (flag & 2) {
      let rf; let rt;
      if (to === 97) { rf = 98; rt = 96; } else if (to === 93) { rf = 91; rt = 94; } else if (to === 27) { rf = 28; rt = 26; } else { rf = 21; rt = 24; }
      b[rf] = b[rt]; b[rt] = 0;
    }
    this.castle = this.uCastle[h]; this.ep = this.uEp[h];
    this.lo = this.uLo[h]; this.hi = this.uHi[h];
  }

  makeNull() {
    const h = this.hp++;
    this.uEp[h] = this.ep; this.uLo[h] = this.lo; this.uHi[h] = this.hi; this.uCastle[h] = this.castle;
    if (this.ep) { this.lo ^= ZE_LO[this.ep]; this.hi ^= ZE_HI[this.ep]; }
    this.ep = 0;
    this.side = -this.side;
    this.lo ^= ZS_LO; this.hi ^= ZS_HI;
  }

  unmakeNull() {
    const h = --this.hp;
    this.side = -this.side;
    this.ep = this.uEp[h]; this.lo = this.uLo[h]; this.hi = this.uHi[h];
  }

  isRepetition() {
    for (let i = this.hp - 2; i >= 0; i -= 2) {
      if (this.uLo[i] === this.lo && this.uHi[i] === this.hi) return true;
    }
    return false;
  }

  // Static evaluation from the side to move's point of view.
  evaluate() {
    const b = this.b;
    let mg = 0; let eg = 0; let phase = 0;
    const wMax = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1]; // per file (+1 offset): most-backward white pawn row
    const bMin = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8]; // most-backward black pawn row
    const wCnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; const bCnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let wB = 0; let bB = 0; let wMat = 0; let bMat = 0;
    for (let i = 0; i < 64; i++) {
      const pc = b[SQ64[i]];
      if (pc !== P && pc !== -P) continue;
      const f = (i & 7) + 1; const r = i >> 3;
      if (pc === P) { wCnt[f]++; if (r > wMax[f]) wMax[f] = r; } else { bCnt[f]++; if (r < bMin[f]) bMin[f] = r; }
    }
    for (let i = 0; i < 64; i++) {
      const pc = b[SQ64[i]];
      if (!pc) continue;
      const t = pc > 0 ? pc : -pc;
      const r = i >> 3; const f = (i & 7) + 1;
      const idx = pc > 0 ? i : ((7 - r) << 3) | (i & 7);
      phase += PHASE_W[t];
      let vm = VALUE[t]; let ve = VALUE[t];
      if (t === K) { vm += PST[K][idx]; ve += KING_EG[idx]; } else { vm += PST[t][idx]; ve += PST[t][idx]; }
      if (t === P) {
        if (pc > 0) {
          if (bMin[f - 1] >= r && bMin[f] >= r && bMin[f + 1] >= r) { const adv = 6 - r; vm += PASSED[adv] >> 1; ve += PASSED[adv]; }
          if (!wCnt[f - 1] && !wCnt[f + 1]) { vm -= 12; ve -= 16; }
          if (wCnt[f] > 1) { vm -= 8; ve -= 14; }
        } else {
          if (wMax[f - 1] <= r && wMax[f] <= r && wMax[f + 1] <= r) { const adv = r - 1; vm += PASSED[adv] >> 1; ve += PASSED[adv]; }
          if (!bCnt[f - 1] && !bCnt[f + 1]) { vm -= 12; ve -= 16; }
          if (bCnt[f] > 1) { vm -= 8; ve -= 14; }
        }
      } else if (t === B) {
        if (pc > 0) wB++; else bB++;
      } else if (t === R) {
        const own = pc > 0 ? wCnt[f] : bCnt[f]; const opp = pc > 0 ? bCnt[f] : wCnt[f];
        if (!own) { vm += opp ? 10 : 20; ve += opp ? 5 : 10; }
      } else if (t === K) {
        // Pawn shield in front of a castled king.
        const dir = pc > 0 ? -10 : 10; const sq = SQ64[i]; const own = pc > 0 ? P : -P;
        let shield = 0;
        for (const d of [dir - 1, dir, dir + 1]) {
          if (b[sq + d] === own) shield += 12; else if (b[sq + d + dir] === own) shield += 6;
        }
        vm += shield;
      }
      if (t !== K && t !== P) { if (pc > 0) wMat += VALUE[t]; else bMat += VALUE[t]; }
      if (pc > 0) { mg += vm; eg += ve; } else { mg -= vm; eg -= ve; }
    }
    if (wB >= 2) { mg += 30; eg += 50; }
    if (bB >= 2) { mg -= 30; eg -= 50; }
    // Mop-up: with a clear material edge, herd the losing king to the edge and walk ours closer.
    const diff = wMat - bMat;
    if (Math.abs(diff) >= 300) {
      const win = diff > 0 ? 0 : 1;
      const wk = this.kingSq[win]; const lk = this.kingSq[1 - win];
      const lr = rowOf(lk); const lc = colOf(lk);
      const edge = Math.max(3 - lr, lr - 4) + Math.max(3 - lc, lc - 4);
      const dist = Math.abs(rowOf(wk) - lr) + Math.abs(colOf(wk) - lc);
      const mop = edge * 12 + (14 - dist) * 5;
      eg += win === 0 ? mop : -mop;
    }
    if (phase > 24) phase = 24;
    const score = ((mg * phase + eg * (24 - phase)) / 24) | 0;
    return this.side === 1 ? score : -score;
  }

  hasPieces(side) {
    for (let i = 0; i < 64; i++) {
      const v = this.b[SQ64[i]] * side;
      if (v >= N && v <= Q) return true;
    }
    return false;
  }
}

function fromGame({ board, turn, castlingRights, enPassantTarget }) {
  const pos = new Position();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const sq = 21 + r * 10 + c;
      const v = TYPE_CODE[cell.type] * (cell.color === 'white' ? 1 : -1);
      pos.b[sq] = v;
      if (v === K) pos.kingSq[0] = sq;
      if (v === -K) pos.kingSq[1] = sq;
    }
  }
  pos.side = turn === 'white' ? 1 : -1;
  const cr = castlingRights || {};
  if (cr.white && cr.white.kingSide && pos.b[95] === K && pos.b[98] === R) pos.castle |= 1;
  if (cr.white && cr.white.queenSide && pos.b[95] === K && pos.b[91] === R) pos.castle |= 2;
  if (cr.black && cr.black.kingSide && pos.b[25] === -K && pos.b[28] === -R) pos.castle |= 4;
  if (cr.black && cr.black.queenSide && pos.b[25] === -K && pos.b[21] === -R) pos.castle |= 8;
  if (enPassantTarget) pos.ep = 21 + enPassantTarget.r * 10 + enPassantTarget.c;
  pos.computeHash();
  return pos;
}

function search(pos, timeMs) {
  const deadline = Date.now() + timeMs;
  let nodes = 0;
  let stop = false;
  const killers = new Int32Array(MAX_PLY * 2);
  const history = new Int32Array(13 * 120);
  ttFlag.fill(0);

  function scoreMoves(ply, start, end, ttM) {
    const b = pos.b;
    for (let i = start; i < end; i++) {
      const m = MOVE_BUF[i];
      let sc;
      const victim = b[mTo(m)];
      if (m === ttM) sc = 10000000;
      else if (victim || (mFlag(m) & 1)) {
        const v = victim ? Math.abs(victim) : P;
        sc = 1000000 + v * 100 - Math.abs(b[mFrom(m)]);
      } else if (mPromo(m)) sc = 900000 + mPromo(m);
      else if (m === killers[ply * 2]) sc = 800000;
      else if (m === killers[ply * 2 + 1]) sc = 700000;
      else sc = history[(b[mFrom(m)] + 6) * 120 + mTo(m)];
      SCORE_BUF[i] = sc;
    }
  }

  function pickNext(i, end) {
    let best = i;
    for (let j = i + 1; j < end; j++) if (SCORE_BUF[j] > SCORE_BUF[best]) best = j;
    if (best !== i) {
      const tm = MOVE_BUF[i]; MOVE_BUF[i] = MOVE_BUF[best]; MOVE_BUF[best] = tm;
      const ts = SCORE_BUF[i]; SCORE_BUF[i] = SCORE_BUF[best]; SCORE_BUF[best] = ts;
    }
    return MOVE_BUF[i];
  }

  function checkTime() {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true;
  }

  function quiesce(alpha, beta, ply) {
    checkTime();
    if (stop) return 0;
    const stand = pos.evaluate();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply >= MAX_PLY - 1) return stand;
    const start = ply * 256;
    const end = pos.gen(MOVE_BUF, start, true);
    scoreMoves(ply, start, end, 0);
    const us = pos.side;
    for (let i = start; i < end; i++) {
      const m = pickNext(i, end);
      const victim = pos.b[mTo(m)];
      // Delta pruning: even winning this piece can't lift us back to alpha.
      if (!mPromo(m) && stand + VALUE[victim ? Math.abs(victim) : P] + 200 < alpha) continue;
      pos.make(m);
      if (pos.inCheck(us)) { pos.unmake(m); continue; }
      const score = -quiesce(-beta, -alpha, ply + 1);
      pos.unmake(m);
      if (stop) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, ply, allowNull) {
    checkTime();
    if (stop) return 0;
    if (ply > 0 && pos.isRepetition()) return 0;
    const us = pos.side;
    const check = pos.inCheck(us);
    if (check) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply);
    if (ply >= MAX_PLY - 1) return pos.evaluate();

    const pv = beta - alpha > 1;
    const slot = pos.lo & TT_MASK;
    let ttM = 0;
    if (ttFlag[slot] && ttKey[slot] === pos.hi) {
      ttM = ttMove[slot];
      if (!pv && ttDepth[slot] >= depth && ply > 0) {
        let s = ttScore[slot];
        if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
        const f = ttFlag[slot];
        if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
      }
    }

    if (!pv && !check && allowNull && depth >= 3 && ply > 0 && pos.hasPieces(us) && pos.evaluate() >= beta) {
      pos.makeNull();
      const s = -negamax(depth - 1 - (depth >= 6 ? 3 : 2), -beta, -beta + 1, ply + 1, false);
      pos.unmakeNull();
      if (stop) return 0;
      if (s >= beta) return beta;
    }

    const start = ply * 256;
    const end = pos.gen(MOVE_BUF, start, false);
    scoreMoves(ply, start, end, ttM);
    let legal = 0;
    let best = -INF;
    let bestM = 0;
    const alpha0 = alpha;
    for (let i = start; i < end; i++) {
      const m = pickNext(i, end);
      const quiet = !pos.b[mTo(m)] && !mPromo(m) && !(mFlag(m) & 1);
      pos.make(m);
      if (pos.inCheck(us)) { pos.unmake(m); continue; }
      legal++;
      let score;
      if (legal === 1) {
        score = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        let red = 0;
        if (depth >= 3 && legal > 3 && quiet && !check && !pos.inCheck(pos.side)) red = legal > 8 ? 2 : 1;
        score = -negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && red) score = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.unmake(m);
      if (stop) return 0;
      if (score > best) {
        best = score; bestM = m;
        if (ply === 0) rootBest = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (quiet) {
          if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
          history[(pos.b[mFrom(m)] + 6) * 120 + mTo(m)] += depth * depth;
        }
        break;
      }
    }
    if (legal === 0) return check ? -MATE + ply : 0;

    let stored = best;
    if (stored > MATE - 200) stored += ply; else if (stored < -MATE + 200) stored -= ply;
    ttKey[slot] = pos.hi; ttMove[slot] = bestM; ttScore[slot] = stored; ttDepth[slot] = depth;
    ttFlag[slot] = best <= alpha0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }

  let rootBest = 0;
  let bestMove = 0;
  let bestScore = 0;
  let depthDone = 0;
  const startTime = Date.now();
  for (let depth = 1; depth < MAX_PLY - 4; depth++) {
    rootBest = 0;
    const score = negamax(depth, -INF, INF, 0, false);
    if (rootBest && (!stop || rootBest)) {
      // A partial iteration's best is still searched at least as deep as the last full one's.
      bestMove = rootBest;
      if (!stop) { bestScore = score; depthDone = depth; }
    }
    if (stop) break;
    if (Math.abs(score) > MATE - 200) break;
    if (Date.now() - startTime > timeMs * 0.45) break;
  }
  return { move: bestMove, score: bestScore, depth: depthDone, nodes };
}

function bestMove(input) {
  const pos = fromGame(input);
  const { move, score, depth, nodes } = search(pos, input.timeMs || 1500);
  if (!move) return null;
  const from = mFrom(move); const to = mTo(move);
  return {
    from: { r: rowOf(from), c: colOf(from) },
    to: { r: rowOf(to), c: colOf(to) },
    promotion: mPromo(move) ? CODE_TYPE[mPromo(move)] : null,
    score, depth, nodes,
  };
}

// perft is exported for move-generator testing.
function perft(input, depth) {
  const pos = fromGame(input);
  const count = (d, ply) => {
    if (d === 0) return 1;
    const start = ply * 256;
    const end = pos.gen(MOVE_BUF, start, false);
    let n = 0;
    const us = pos.side;
    for (let i = start; i < end; i++) {
      const m = MOVE_BUF[i];
      pos.make(m);
      if (!pos.inCheck(us)) n += count(d - 1, ply + 1);
      pos.unmake(m);
    }
    return n;
  };
  return count(depth, 0);
}

module.exports = { bestMove, perft };
