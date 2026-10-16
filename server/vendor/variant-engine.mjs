import { Chess, DEFAULT_POSITION } from "chess.js";
//#region src/lib/chess/squares.ts
var FILES = [
	"a",
	"b",
	"c",
	"d",
	"e",
	"f",
	"g",
	"h"
];
var RANKS = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8"
];
function toSquare(file, rank) {
	if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
	return `${FILES[file]}${RANKS[rank]}`;
}
Array.from({ length: 64 }, (_, i) => toSquare(i % 8, Math.floor(i / 8)));
//#endregion
//#region src/lib/chess/types.ts
var opposite = (c) => c === "w" ? "b" : "w";
//#endregion
//#region src/variants/board.ts
var WHITE = "w";
var BLACK = "b";
var KNIGHT_DELTAS = [
	[1, 2],
	[2, 1],
	[2, -1],
	[1, -2],
	[-1, -2],
	[-2, -1],
	[-2, 1],
	[-1, 2]
];
var KING_DELTAS = [
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
	[0, -1],
	[1, -1]
];
var ROOK_DIRS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
];
var BISHOP_DIRS = [
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1]
];
var PROMOTIONS = [
	"q",
	"r",
	"b",
	"n"
];
var idx = (file, rank) => rank * 8 + file;
var fileOfIdx = (i) => i % 8;
var rankOfIdx = (i) => (i - i % 8) / 8;
var idxToSquare = (i) => `${FILES[fileOfIdx(i)]}${rankOfIdx(i) + 1}`;
var squareToIdx = (s) => idx(s.charCodeAt(0) - 97, s.charCodeAt(1) - 49);
var VariantBoard = class VariantBoard {
	variant;
	s;
	/** Repetition keys (placement + turn + rights + ep) for every position reached. */
	history = [];
	/** Set in Fog of War when a king has been taken. */
	kingCapturedBy = null;
	constructor(fen, variant) {
		this.variant = variant;
		this.s = VariantBoard.parse(fen);
		this.history.push(this.repetitionKey());
	}
	static parse(fen) {
		const [placement, turnField = "w", castleField = "-", epField = "-", half = "0", full = "1"] = fen.trim().split(/\s+/);
		const board = Array(64).fill(null);
		const rows = (placement ?? "").split("/");
		if (rows.length !== 8) throw new Error(`bad FEN placement: ${fen}`);
		rows.forEach((row, i) => {
			const rank = 7 - i;
			let file = 0;
			for (const ch of row) {
				const n = Number(ch);
				if (Number.isInteger(n) && n > 0) {
					file += n;
					continue;
				}
				const lower = ch.toLowerCase();
				if (!"pnbrqk".includes(lower)) throw new Error(`bad FEN piece '${ch}'`);
				board[idx(file, rank)] = {
					color: ch === lower ? BLACK : WHITE,
					type: lower
				};
				file += 1;
			}
		});
		const rights = {
			w: /* @__PURE__ */ new Set(),
			b: /* @__PURE__ */ new Set()
		};
		if (castleField !== "-") for (const ch of castleField) {
			const color = ch === ch.toUpperCase() ? WHITE : BLACK;
			const rank = color === WHITE ? 0 : 7;
			const lower = ch.toLowerCase();
			if (lower === "k" || lower === "q") {
				const kingFile = board.findIndex((p, i) => p?.type === "k" && p.color === color && rankOfIdx(i) === rank);
				const kf = kingFile >= 0 ? fileOfIdx(kingFile) : 4;
				const files = [...Array(8).keys()].filter((f) => {
					const p = board[idx(f, rank)];
					return p?.type === "r" && p.color === color;
				});
				const side = lower === "k" ? files.filter((f) => f > kf).at(-1) : files.filter((f) => f < kf)[0];
				if (side !== void 0) rights[color].add(side);
			} else {
				const f = lower.charCodeAt(0) - 97;
				if (f >= 0 && f < 8) rights[color].add(f);
			}
		}
		return {
			board,
			turn: turnField === "b" ? BLACK : WHITE,
			rights,
			ep: epField !== "-" ? squareToIdx(epField) : null,
			halfMoves: Number(half) || 0,
			fullMoves: Number(full) || 1
		};
	}
	fen() {
		const rows = [];
		for (let rank = 7; rank >= 0; rank--) {
			let row = "";
			let empty = 0;
			for (let file = 0; file < 8; file++) {
				const p = this.s.board[idx(file, rank)];
				if (!p) {
					empty++;
					continue;
				}
				if (empty) {
					row += String(empty);
					empty = 0;
				}
				row += p.color === WHITE ? p.type.toUpperCase() : p.type;
			}
			if (empty) row += String(empty);
			rows.push(row);
		}
		return `${rows.join("/")} ${this.s.turn} ${this.castlingField()} ${this.s.ep === null ? "-" : idxToSquare(this.s.ep)} ${this.s.halfMoves} ${this.s.fullMoves}`;
	}
	/**
	* Shredder-FEN rights (rook files) for Chess960, classic KQkq when the
	* layout is standard so the FEN stays interoperable.
	*/
	castlingField() {
		const out = [];
		for (const color of [WHITE, BLACK]) {
			const rank = color === WHITE ? 0 : 7;
			const kingFile = this.kingFileOf(color, rank);
			const files = [...this.s.rights[color]].sort((a, b) => b - a);
			for (const f of files) {
				const letter = kingFile === 4 && (f === 7 || f === 0) ? f === 7 ? "k" : "q" : FILES[f];
				out.push(color === WHITE ? letter.toUpperCase() : letter);
			}
		}
		return out.length ? out.join("") : "-";
	}
	kingFileOf(color, rank) {
		for (let f = 0; f < 8; f++) {
			const p = this.s.board[idx(f, rank)];
			if (p?.type === "k" && p.color === color) return f;
		}
		return -1;
	}
	repetitionKey() {
		return this.fen().split(" ").slice(0, 4).join(" ");
	}
	get turn() {
		return this.s.turn;
	}
	get moveNumber() {
		return this.s.fullMoves;
	}
	pieceAt(sq) {
		return this.s.board[squareToIdx(sq)] ?? null;
	}
	board() {
		return this.s.board;
	}
	kingSquare(color) {
		for (let i = 0; i < 64; i++) {
			const p = this.s.board[i];
			if (p?.type === "k" && p.color === color) return i;
		}
		return null;
	}
	/** True if `color` attacks `square` (pawn pushes don't count as attacks). */
	isAttacked(square, color) {
		const f = fileOfIdx(square);
		const r = rankOfIdx(square);
		const pawnRank = r - (color === WHITE ? 1 : -1);
		if (pawnRank >= 0 && pawnRank < 8) for (const df of [-1, 1]) {
			const pf = f + df;
			if (pf < 0 || pf > 7) continue;
			const p = this.s.board[idx(pf, pawnRank)];
			if (p?.type === "p" && p.color === color) return true;
		}
		for (const [df, dr] of KNIGHT_DELTAS) {
			const nf = f + df;
			const nr = r + dr;
			if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
			const p = this.s.board[idx(nf, nr)];
			if (p?.type === "n" && p.color === color) return true;
		}
		for (const [df, dr] of KING_DELTAS) {
			const nf = f + df;
			const nr = r + dr;
			if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
			const p = this.s.board[idx(nf, nr)];
			if (p?.type === "k" && p.color === color) return true;
		}
		const slide = (dirs, types) => {
			for (const [df, dr] of dirs) for (let i = 1; i < 8; i++) {
				const nf = f + df * i;
				const nr = r + dr * i;
				if (nf < 0 || nf > 7 || nr < 0 || nr > 7) break;
				const p = this.s.board[idx(nf, nr)];
				if (!p) continue;
				if (p.color === color && types.includes(p.type)) return true;
				break;
			}
			return false;
		};
		return slide(ROOK_DIRS, "rq") || slide(BISHOP_DIRS, "bq");
	}
	inCheck(color = this.s.turn) {
		if (this.variant === "fog") return false;
		const k = this.kingSquare(color);
		return k !== null && this.isAttacked(k, opposite(color));
	}
	/**
	* Fog of War vision for `color`: its own squares, every square its pieces can
	* move to, and the squares its pawns attack (even when empty). Everything
	* else stays hidden, so enemy pieces there are invisible.
	*/
	vision(color) {
		const seen = /* @__PURE__ */ new Set();
		for (let i = 0; i < 64; i++) {
			const p = this.s.board[i];
			if (!p || p.color !== color) continue;
			seen.add(i);
			if (p.type !== "p") continue;
			const dir = color === WHITE ? 1 : -1;
			const r = rankOfIdx(i) + dir;
			if (r < 0 || r > 7) continue;
			for (const df of [-1, 1]) {
				const f = fileOfIdx(i) + df;
				if (f >= 0 && f <= 7) seen.add(idx(f, r));
			}
		}
		for (const m of this.pseudoMoves(color)) seen.add(m.to);
		return seen;
	}
	pseudoMoves(color) {
		const out = [];
		const fog = this.variant === "fog";
		for (let from = 0; from < 64; from++) {
			const piece = this.s.board[from];
			if (!piece || piece.color !== color) continue;
			const f = fileOfIdx(from);
			const r = rankOfIdx(from);
			const push = (to, extra = {}) => {
				const target = this.s.board[to];
				if (target && (target.color === color || target.type === "k" && !fog)) return false;
				out.push({
					from,
					to,
					piece: piece.type,
					color,
					...target ? {
						captured: target.type,
						capturedAt: to
					} : {},
					...extra
				});
				return !target;
			};
			switch (piece.type) {
				case "p": {
					const dir = color === WHITE ? 1 : -1;
					const startRank = color === WHITE ? 1 : 6;
					const lastRank = color === WHITE ? 7 : 0;
					const one = r + dir;
					if (one >= 0 && one < 8 && !this.s.board[idx(f, one)]) {
						if (one === lastRank) for (const promotion of PROMOTIONS) out.push({
							from,
							to: idx(f, one),
							piece: "p",
							color,
							promotion
						});
						else {
							out.push({
								from,
								to: idx(f, one),
								piece: "p",
								color
							});
							const two = r + dir * 2;
							if (r === startRank && !this.s.board[idx(f, two)]) out.push({
								from,
								to: idx(f, two),
								piece: "p",
								color,
								doublePush: true
							});
						}
					}
					if (one < 0 || one > 7) break;
					for (const df of [-1, 1]) {
						const cf = f + df;
						if (cf < 0 || cf > 7) continue;
						const to = idx(cf, one);
						const target = this.s.board[to];
						if (target && target.color !== color && (target.type !== "k" || fog)) {
							if (one === lastRank) for (const promotion of PROMOTIONS) out.push({
								from,
								to,
								piece: "p",
								color,
								captured: target.type,
								capturedAt: to,
								promotion
							});
							else out.push({
								from,
								to,
								piece: "p",
								color,
								captured: target.type,
								capturedAt: to
							});
						} else if (!target && this.s.ep === to) out.push({
							from,
							to,
							piece: "p",
							color,
							captured: "p",
							capturedAt: idx(cf, r),
							epCapture: true
						});
					}
					break;
				}
				case "n":
					for (const [df, dr] of KNIGHT_DELTAS) {
						const nf = f + df;
						const nr = r + dr;
						if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
						push(idx(nf, nr));
					}
					break;
				case "k":
					for (const [df, dr] of KING_DELTAS) {
						const nf = f + df;
						const nr = r + dr;
						if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
						push(idx(nf, nr));
					}
					this.addCastles(color, from, out);
					break;
				default: {
					const dirs = piece.type === "r" ? ROOK_DIRS : piece.type === "b" ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
					for (const [df, dr] of dirs) for (let i = 1; i < 8; i++) {
						const nf = f + df * i;
						const nr = r + dr * i;
						if (nf < 0 || nf > 7 || nr < 0 || nr > 7) break;
						if (!push(idx(nf, nr))) break;
					}
				}
			}
		}
		return out;
	}
	/**
	* Chess960-aware castling. The king always ends on the c- or g-file and the
	* rook on the d- or f-file, which matches standard chess when the pieces
	* start on e1/a1/h1.
	*/
	addCastles(color, kingFrom, out) {
		const rights = this.s.rights[color];
		if (!rights.size) return;
		const rank = color === WHITE ? 0 : 7;
		if (rankOfIdx(kingFrom) !== rank) return;
		const fog = this.variant === "fog";
		const enemy = opposite(color);
		if (!fog && this.isAttacked(kingFrom, enemy)) return;
		const kingFile = fileOfIdx(kingFrom);
		for (const rookFile of rights) {
			const rookFrom = idx(rookFile, rank);
			const rook = this.s.board[rookFrom];
			if (rook?.type !== "r" || rook.color !== color) continue;
			const kingside = rookFile > kingFile;
			const kingTo = idx(kingside ? 6 : 2, rank);
			const rookTo = idx(kingside ? 5 : 3, rank);
			const lo = Math.min(kingFile, fileOfIdx(kingTo), rookFile, fileOfIdx(rookTo));
			const hi = Math.max(kingFile, fileOfIdx(kingTo), rookFile, fileOfIdx(rookTo));
			let blocked = false;
			for (let f = lo; f <= hi && !blocked; f++) {
				const sq = idx(f, rank);
				if (sq === kingFrom || sq === rookFrom) continue;
				if (this.s.board[sq]) blocked = true;
			}
			if (blocked) continue;
			if (!fog) {
				const step = fileOfIdx(kingTo) >= kingFile ? 1 : -1;
				let attacked = false;
				for (let f = kingFile; f !== fileOfIdx(kingTo) + step && !attacked; f += step) if (this.isAttacked(idx(f, rank), enemy)) attacked = true;
				if (attacked) continue;
			}
			out.push({
				from: kingFrom,
				to: kingTo,
				piece: "k",
				color,
				castle: kingside ? "k" : "q",
				rookFrom,
				rookTo
			});
		}
	}
	/** Legal moves for the side to move (Fog of War skips the self-check filter). */
	legalRaw() {
		const pseudo = this.pseudoMoves(this.s.turn);
		if (this.variant === "fog") return pseudo;
		const color = this.s.turn;
		return pseudo.filter((m) => {
			const undo = this.applyRaw(m);
			const king = this.kingSquare(color);
			const ok = king === null || !this.isAttacked(king, opposite(color));
			undo();
			return ok;
		});
	}
	moves() {
		return this.legalRaw().map((m) => this.describe(m));
	}
	movesFrom(square) {
		const from = squareToIdx(square);
		return this.legalRaw().filter((m) => m.from === from).map((m) => this.describe(m));
	}
	/** Count of legal moves without building descriptions. */
	moveCount() {
		return this.legalRaw().length;
	}
	/** Applies a raw move and returns a function that reverts it exactly. */
	applyRaw(m) {
		const b = this.s.board;
		const prev = {
			turn: this.s.turn,
			ep: this.s.ep,
			halfMoves: this.s.halfMoves,
			fullMoves: this.s.fullMoves,
			rightsW: new Set(this.s.rights.w),
			rightsB: new Set(this.s.rights.b),
			kingCapturedBy: this.kingCapturedBy
		};
		const moving = b[m.from];
		const capturedPiece = m.capturedAt !== void 0 ? b[m.capturedAt] : null;
		const rookPrev = m.castle !== void 0 ? b[m.rookFrom] : null;
		if (m.castle !== void 0) {
			b[m.from] = null;
			b[m.rookFrom] = null;
			b[m.to] = moving;
			b[m.rookTo] = rookPrev;
		} else {
			b[m.from] = null;
			if (m.capturedAt !== void 0) b[m.capturedAt] = null;
			b[m.to] = m.promotion ? {
				color: m.color,
				type: m.promotion
			} : moving;
		}
		if (m.captured === "k") this.kingCapturedBy = m.color;
		const rights = this.s.rights[m.color];
		if (m.piece === "k") rights.clear();
		else if (m.piece === "r" && rankOfIdx(m.from) === (m.color === WHITE ? 0 : 7)) rights.delete(fileOfIdx(m.from));
		if (m.captured === "r" && m.capturedAt !== void 0) {
			const victim = opposite(m.color);
			if (rankOfIdx(m.capturedAt) === (victim === WHITE ? 0 : 7)) this.s.rights[victim].delete(fileOfIdx(m.capturedAt));
		}
		this.s.ep = null;
		if (m.doublePush) {
			const enemy = opposite(m.color);
			const destRank = rankOfIdx(m.to);
			for (const df of [-1, 1]) {
				const nf = fileOfIdx(m.to) + df;
				if (nf < 0 || nf > 7) continue;
				const neighbour = b[idx(nf, destRank)];
				if (neighbour?.type === "p" && neighbour.color === enemy) {
					this.s.ep = idx(fileOfIdx(m.from), (rankOfIdx(m.from) + destRank) / 2);
					break;
				}
			}
		}
		this.s.halfMoves = m.piece === "p" || m.captured ? 0 : this.s.halfMoves + 1;
		if (m.color === BLACK) this.s.fullMoves += 1;
		this.s.turn = opposite(m.color);
		return () => {
			if (m.castle !== void 0) {
				b[m.to] = null;
				b[m.rookTo] = null;
				b[m.from] = moving;
				b[m.rookFrom] = rookPrev;
			} else {
				b[m.to] = null;
				b[m.from] = moving;
				if (m.capturedAt !== void 0) b[m.capturedAt] = capturedPiece;
			}
			this.s.turn = prev.turn;
			this.s.ep = prev.ep;
			this.s.halfMoves = prev.halfMoves;
			this.s.fullMoves = prev.fullMoves;
			this.s.rights.w = prev.rightsW;
			this.s.rights.b = prev.rightsB;
			this.kingCapturedBy = prev.kingCapturedBy;
		};
	}
	/** Builds the public description of a move (SAN included) without keeping it applied. */
	describe(m) {
		const before = this.fen();
		const san = this.sanOf(m);
		const undo = this.applyRaw(m);
		const after = this.fen();
		undo();
		return {
			color: m.color,
			from: idxToSquare(m.from),
			to: idxToSquare(m.to),
			piece: m.piece,
			...m.captured ? { captured: m.captured } : {},
			...m.promotion ? { promotion: m.promotion } : {},
			san,
			lan: m.castle !== void 0 && this.variant === "chess960" ? `${idxToSquare(m.from)}${idxToSquare(m.rookFrom)}` : `${idxToSquare(m.from)}${idxToSquare(m.to)}${m.promotion ?? ""}`,
			before,
			after,
			isCapture: !!m.captured,
			isCastle: m.castle !== void 0,
			...m.castle !== void 0 ? { castleRook: {
				from: idxToSquare(m.rookFrom),
				to: idxToSquare(m.rookTo)
			} } : {},
			isEnPassant: !!m.epCapture,
			isKingCapture: m.captured === "k"
		};
	}
	sanOf(m) {
		if (m.castle) return m.castle === "k" ? "O-O" : "O-O-O";
		const to = idxToSquare(m.to);
		let san;
		if (m.piece === "p") {
			san = m.captured ? `${FILES[fileOfIdx(m.from)]}x${to}` : to;
			if (m.promotion) san += `=${m.promotion.toUpperCase()}`;
		} else {
			const rivals = this.legalRaw().filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from && !o.castle);
			let suffix = "";
			if (rivals.length) {
				const sameFile = rivals.some((o) => fileOfIdx(o.from) === fileOfIdx(m.from));
				const sameRank = rivals.some((o) => rankOfIdx(o.from) === rankOfIdx(m.from));
				if (!sameFile) suffix = FILES[fileOfIdx(m.from)];
				else if (!sameRank) suffix = String(rankOfIdx(m.from) + 1);
				else suffix = `${FILES[fileOfIdx(m.from)]}${rankOfIdx(m.from) + 1}`;
			}
			san = `${m.piece.toUpperCase()}${suffix}${m.captured ? "x" : ""}${to}`;
		}
		if (this.variant === "fog") return san;
		const undo = this.applyRaw(m);
		const enemy = opposite(m.color);
		const check = this.inCheck(enemy);
		const mate = check && this.legalRaw().length === 0;
		undo();
		return san + (mate ? "#" : check ? "+" : "");
	}
	/** Plays a move. Returns null when it isn't legal in this position. */
	move(req) {
		const from = squareToIdx(req.from);
		const to = squareToIdx(req.to);
		const legal = this.legalRaw().filter((m) => m.from === from);
		const ontoRook = legal.find((m) => m.castle !== void 0 && m.rookFrom === to);
		const plain = legal.filter((m) => m.to === to && m.castle === void 0);
		const castleTo = legal.find((m) => m.castle !== void 0 && m.to === to);
		const candidates = ontoRook ? [ontoRook] : plain.length ? plain : castleTo ? [castleTo] : [];
		if (!candidates.length) return null;
		const raw = (req.promotion ? candidates.find((m) => m.promotion === req.promotion) : candidates.find((m) => !m.promotion) ?? candidates.find((m) => m.promotion === "q")) ?? candidates[0];
		const described = this.describe(raw);
		this.applyRaw(raw);
		this.history.push(this.repetitionKey());
		return described;
	}
	/** Needed for Chess960: castling by dropping the king on its own rook. */
	castleTargetForRook(kingSquare, rookSquare) {
		const from = squareToIdx(kingSquare);
		const rookIdx = squareToIdx(rookSquare);
		const match = this.legalRaw().find((m) => m.from === from && m.castle && m.rookFrom === rookIdx);
		return match ? idxToSquare(match.to) : null;
	}
	outcome() {
		if (this.variant === "fog") {
			if (this.kingCapturedBy) return {
				result: this.kingCapturedBy === WHITE ? "1-0" : "0-1",
				reason: "king-captured",
				winner: this.kingCapturedBy
			};
			if (!this.legalRaw().length) return {
				result: "1/2-1/2",
				reason: "stalemate",
				winner: null
			};
		} else if (!this.legalRaw().length) {
			if (this.inCheck()) {
				const winner = opposite(this.s.turn);
				return {
					result: winner === WHITE ? "1-0" : "0-1",
					reason: "checkmate",
					winner
				};
			}
			return {
				result: "1/2-1/2",
				reason: "stalemate",
				winner: null
			};
		}
		if (this.s.halfMoves >= 100) return {
			result: "1/2-1/2",
			reason: "fifty-move",
			winner: null
		};
		const key = this.history.at(-1);
		if (this.history.filter((k) => k === key).length >= 3) return {
			result: "1/2-1/2",
			reason: "threefold",
			winner: null
		};
		if (this.insufficientMaterial()) return {
			result: "1/2-1/2",
			reason: "insufficient",
			winner: null
		};
		return null;
	}
	insufficientMaterial() {
		const pieces = [];
		this.s.board.forEach((p, i) => p && pieces.push({
			...p,
			sq: i
		}));
		if (pieces.some((p) => p.type === "p" || p.type === "r" || p.type === "q")) return false;
		const minors = pieces.filter((p) => p.type === "n" || p.type === "b");
		if (minors.length <= 1) return true;
		if (minors.length === 2 && minors.every((m) => m.type === "b")) {
			const colorOf = (sq) => (fileOfIdx(sq) + rankOfIdx(sq)) % 2;
			return minors[0].color !== minors[1].color && colorOf(minors[0].sq) === colorOf(minors[1].sq);
		}
		return false;
	}
	clone() {
		const copy = new VariantBoard(this.fen(), this.variant);
		copy.history = [...this.history];
		copy.kingCapturedBy = this.kingCapturedBy;
		return copy;
	}
	/** Move-generation node count, used to verify this generator against chess.js. */
	perft(depth) {
		if (depth === 0) return 1;
		const moves = this.legalRaw();
		if (depth === 1) return moves.length;
		let nodes = 0;
		for (const m of moves) {
			const undo = this.applyRaw(m);
			nodes += this.perft(depth - 1);
			undo();
		}
		return nodes;
	}
};
//#endregion
//#region src/variants/engine.ts
var toMoveLike = (m) => ({
	color: m.color,
	from: m.from,
	to: m.to,
	piece: m.piece,
	...m.captured ? { captured: m.captured } : {},
	...m.promotion ? { promotion: m.promotion } : {},
	san: m.san,
	lan: m.lan,
	before: m.before,
	after: m.after,
	isCapture: m.isCapture() || m.isEnPassant(),
	isCastle: m.isKingsideCastle() || m.isQueensideCastle(),
	...m.isKingsideCastle() || m.isQueensideCastle() ? { castleRook: {
		from: (m.isKingsideCastle() ? "h" : "a") + m.from[1],
		to: (m.isKingsideCastle() ? "f" : "d") + m.from[1]
	} } : {},
	isEnPassant: m.isEnPassant(),
	isKingCapture: false
});
var StandardEngine = class {
	variant = "standard";
	chess;
	constructor(fen) {
		this.chess = new Chess(fen);
	}
	fen() {
		return this.chess.fen();
	}
	turn() {
		return this.chess.turn();
	}
	moves() {
		return this.chess.moves({ verbose: true }).map(toMoveLike);
	}
	targets() {
		const map = /* @__PURE__ */ new Map();
		for (const m of this.chess.moves({ verbose: true })) {
			let set = map.get(m.from);
			if (!set) map.set(m.from, set = /* @__PURE__ */ new Set());
			set.add(m.to);
		}
		return map;
	}
	move(req) {
		try {
			return toMoveLike(this.chess.move({
				from: req.from,
				to: req.to,
				promotion: req.promotion
			}));
		} catch {
			return null;
		}
	}
	moveCount() {
		return this.chess.moves().length;
	}
	inCheck() {
		return this.chess.inCheck();
	}
	outcome() {
		const c = this.chess;
		if (c.isCheckmate()) {
			const winner = c.turn() === "w" ? "b" : "w";
			return {
				result: winner === "w" ? "1-0" : "0-1",
				reason: "checkmate",
				winner
			};
		}
		const draw = (reason) => ({
			result: "1/2-1/2",
			reason,
			winner: null
		});
		if (c.isStalemate()) return draw("stalemate");
		if (c.isInsufficientMaterial()) return draw("insufficient");
		if (c.isThreefoldRepetition()) return draw("threefold");
		if (c.isDrawByFiftyMoves()) return draw("fifty-move");
		return null;
	}
	vision() {
		return null;
	}
};
var VariantEngine = class {
	variant;
	board;
	constructor(variant, fen) {
		this.variant = variant;
		this.board = new VariantBoard(fen, variant);
	}
	fen() {
		return this.board.fen();
	}
	turn() {
		return this.board.turn;
	}
	moves() {
		return this.board.moves();
	}
	targets() {
		const map = /* @__PURE__ */ new Map();
		for (const m of this.board.moves()) {
			let set = map.get(m.from);
			if (!set) map.set(m.from, set = /* @__PURE__ */ new Set());
			set.add(m.to);
			if (m.castleRook) set.add(m.castleRook.from);
		}
		return map;
	}
	move(req) {
		return this.board.move(req);
	}
	moveCount() {
		return this.board.moveCount();
	}
	inCheck() {
		return this.board.inCheck();
	}
	outcome() {
		return this.board.outcome();
	}
	vision(color) {
		if (this.variant !== "fog") return null;
		const out = /* @__PURE__ */ new Set();
		for (const i of this.board.vision(color)) out.add(idxToSquare(i));
		return out;
	}
	/** Raw board access for the Fog of War bot heuristics. */
	raw() {
		return this.board;
	}
};
var createEngine = (variant, fen = DEFAULT_POSITION) => variant === "standard" ? new StandardEngine(fen) : new VariantEngine(variant, fen);
/** Rebuilds an engine by replaying moves, used for takebacks and resyncs. */
function replayEngine(variant, startFen, moves) {
	const engine = createEngine(variant, startFen);
	for (const m of moves) engine.move(m);
	return engine;
}
//#endregion
//#region src/variants/chess960.ts
/**
* Chess960 start-position generator using Scharnagl's numbering (0–959),
* the same scheme the FIDE/SP-ID tables and Stockfish's UCI_Chess960 use.
*
* Decoding a position id N:
*   N / 4  remainder → light-square bishop file (b1, d1, f1, h1)
*   N / 4, then % 4  → dark-square bishop file  (a1, c1, e1, g1)
*   next  % 6        → queen's index among the remaining empty squares
*   final quotient   → one of 10 knight placements (KRN table)
* Rooks and the king then fill the last three squares left-to-right, which
* automatically puts the king between the rooks.
*/
var KRN = [
	"NNRKR",
	"NRNKR",
	"NRKNR",
	"NRKRN",
	"RNNKR",
	"RNKNR",
	"RNKRN",
	"RKNNR",
	"RKNRN",
	"RKRNN"
];
var CHESS960_POSITIONS = 960;
/** Back rank for position `id`, as 8 uppercase piece letters (file a → h). */
function backRankFor(id) {
	const n = (id % 960 + 960) % 960;
	const rank = Array(8).fill(null);
	const q1 = Math.floor(n / 4);
	rank[n % 4 * 2 + 1] = "B";
	const q2 = Math.floor(q1 / 4);
	rank[q1 % 4 * 2] = "B";
	const empty = () => rank.reduce((acc, p, i) => p === null ? (acc.push(i), acc) : acc, []);
	const free = empty();
	rank[free[q2 % 6]] = "Q";
	const krn = KRN[Math.floor(q2 / 6)];
	const rest = empty();
	krn.split("").forEach((piece, i) => rank[rest[i]] = piece);
	return rank.join("");
}
function chess960Setup(id) {
	const backRank = backRankFor(id);
	const kingFile = backRank.indexOf("K");
	const rooks = [...backRank].reduce((acc, p, i) => p === "R" ? (acc.push(i), acc) : acc, []);
	const [qs, ks] = [rooks[0], rooks[1]];
	const castling = kingFile === 4 && qs === 0 && ks === 7 ? "KQkq" : `${FILES[ks].toUpperCase()}${FILES[qs].toUpperCase()}${FILES[ks]}${FILES[qs]}`;
	return {
		id,
		backRank,
		fen: `${backRank.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${backRank} w ${castling} - 0 1`,
		kingFile,
		rookFiles: [qs, ks]
	};
}
var randomChess960Id = (rng = Math.random) => Math.floor(rng() * 960);
//#endregion
//#region src/variants/types.ts
var VARIANTS = {
	standard: {
		id: "standard",
		name: "Standard",
		blurb: "Classical chess."
	},
	chess960: {
		id: "chess960",
		name: "Chess960",
		blurb: "Randomised back rank, 960 start positions."
	},
	fog: {
		id: "fog",
		name: "Fog of War",
		blurb: "You only see what your pieces see. Capture the king to win."
	}
};
//#endregion
export { CHESS960_POSITIONS, VARIANTS, VariantBoard, chess960Setup, createEngine, randomChess960Id, replayEngine };
