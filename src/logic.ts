import { CFG } from './config';

// ---------------------------------------------------------------- operations
export type OpKind = 'add' | 'sub' | 'mul' | 'div';
export interface Op {
  kind: OpKind;
  n: number;
}
export type Cmp = 'gte' | 'lt';
export type Effect =
  | { t: 'op'; op: Op }
  | { t: 'seq'; a: Op; b: Op }
  | { t: 'cond'; cmp: Cmp; k: number; yes: Op; no: Op };

export const add = (n: number): Op => ({ kind: 'add', n });
export const sub = (n: number): Op => ({ kind: 'sub', n });
export const mul = (n: number): Op => ({ kind: 'mul', n });
export const div = (n: number): Op => ({ kind: 'div', n });
export const opE = (op: Op): Effect => ({ t: 'op', op });
export const seqE = (a: Op, b: Op): Effect => ({ t: 'seq', a, b });
export const condE = (cmp: Cmp, k: number, yes: Op, no: Op): Effect => ({ t: 'cond', cmp, k, yes, no });

/** Keep a troop count a finite whole number in [0, armyCap]. NaN and infinities never leak into the game. */
export function clampArmy(n: number): number {
  if (!(n > 0)) return 0; // also catches NaN
  return n >= CFG.armyCap ? CFG.armyCap : Math.floor(n);
}

export function applyOp(a: number, op: Op): number {
  switch (op.kind) {
    case 'add':
      return clampArmy(a + op.n);
    case 'sub':
      return Math.max(0, a - op.n);
    case 'mul':
      return clampArmy(a * op.n);
    case 'div':
      return op.n > 0 ? clampArmy(a / op.n) : a; // dividing by zero leaves the army alone
  }
}

/** Resulting army size when a group of `army` units passes through the effect. An empty group passes nothing. */
export function evalEffect(e: Effect, army: number): number {
  if (army <= 0) return 0;
  switch (e.t) {
    case 'op':
      return applyOp(army, e.op);
    case 'seq': {
      const mid = applyOp(army, e.a);
      if (mid <= 0) return 0; // reaching zero ends the run immediately
      return applyOp(mid, e.b);
    }
    case 'cond': {
      const yes = e.cmp === 'gte' ? army >= e.k : army < e.k;
      return applyOp(army, yes ? e.yes : e.no);
    }
  }
}

// ---------------------------------------------------------------- labels
const SYM: Record<OpKind, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

/** Names for each power of a thousand: K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc, then Ud … Vg (up to 1e63). */
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];

/** About three significant digits, trailing zeros dropped: 1.25, 12.5, 125. */
const sig3 = (x: number): string => {
  const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

const sci = (n: number): string => n.toExponential(2).replace('e+', 'e').replace(/\.?0+e/, 'e');

/**
 * The one number formatter for the whole UI.
 *  - below 10,000 the exact whole number (gate thresholds must stay exact)
 *  - then 12.5K, 1.5M, 2.5B, 1T, 1.5Qa, … up to Vg (1e63)
 *  - beyond that scientific notation, e.g. 1.5e66, so the label never runs out of names
 * NaN shows as 0 and a runaway Infinity as MAX, never as raw text.
 */
export function formatLargeNumber(n: number): string {
  if (Number.isNaN(n)) return '0';
  if (n < 0) return '-' + formatLargeNumber(-n);
  if (!Number.isFinite(n)) return 'MAX';
  if (n < 10000) return String(Math.round(n));
  const e = Math.floor(Math.log10(n));
  let g = Math.floor(e / 3);
  if (g >= SUFFIX.length) return sci(n);
  let x = n / Math.pow(10, g * 3);
  let str = sig3(x);
  if (Number(str) >= 1000) {
    // rounding carried over (999.6K -> 1M): move up one name
    g++;
    if (g >= SUFFIX.length) return sci(n);
    x = n / Math.pow(10, g * 3);
    str = sig3(x);
  }
  return str + SUFFIX[g];
}
export const fmt = formatLargeNumber;

/** Round to 3 significant digits so the abbreviated label (e.g. "12.3K") is exactly the number used. */
export function niceRound(n: number): number {
  n = Math.round(n);
  if (n < 1000) return n;
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 2);
  return Math.round(n / p) * p;
}

export const opLabel = (op: Op): string => SYM[op.kind] + fmt(op.n);

/** Lines drawn on the gate face (first line is the big one). */
export function effectLines(e: Effect): string[] {
  switch (e.t) {
    case 'op':
      return [opLabel(e.op)];
    case 'seq':
      return [opLabel(e.a), 'then ' + opLabel(e.b)];
    case 'cond':
      return [opLabel(e.yes), `if ${e.cmp === 'gte' ? '≥' : '<'} ${fmt(e.k)}`, 'else ' + opLabel(e.no)];
  }
}
export const effectText = (e: Effect): string => effectLines(e).join(' ');

export type Tone = 'green' | 'red' | 'yellow';
export function effectTone(e: Effect): Tone {
  if (e.t !== 'op') return 'yellow';
  return e.op.kind === 'add' || e.op.kind === 'mul' ? 'green' : 'red';
}

const SAFE_PROBES = [1, 2, 3, 4, 5, 7, 10, 16, 25, 50, 100, 1000, 10000, 1e6];
/** A gate is "safe" when it never reduces the army for any army size >= 1 (sampled across scales). */
export function isSafe(e: Effect): boolean {
  for (const a of SAFE_PROBES) if (evalEffect(e, a) < a) return false;
  return true;
}

// ---------------------------------------------------------------- split lane optimum
/** Best total army after a split gate, trying every integer split of the army between the two lanes. */
export function bestSplit(left: Effect, right: Effect, army: number): { total: number; toLeft: number } {
  let best = -1;
  let bestL = 0;
  const step = army > 4000 ? Math.ceil(army / 4000) : 1;
  const cand: number[] = [];
  for (let l = 0; l <= army; l += step) cand.push(l);
  cand.push(army, army - 1, 1, 0);
  for (const l of cand) {
    if (l < 0 || l > army) continue;
    const t = evalEffect(left, l) + evalEffect(right, army - l);
    if (t > best) {
      best = t;
      bestL = l;
    }
  }
  return { total: clampArmy(best), toLeft: bestL };
}
