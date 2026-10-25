import { CFG } from './config';
import { Rng } from './rng';
import {
  Effect,
  Op,
  add,
  sub,
  mul,
  div,
  opE,
  seqE,
  condE,
  evalEffect,
  isSafe,
  niceRound,
  effectText,
  effectTone,
} from './logic';
import type { GateDef, GenCtx } from './types';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Minimum best-gate growth factor the generator aims for at army size A (fast early, gentle later). */
export function targetFactor(A: number): number {
  return 1.18 + 0.82 / (1 + Math.pow(A / 40, 1.1));
}

export function tile(effs: Effect[], rng: Rng): GateDef[] {
  const order = rng.shuffle(effs.slice());
  const w = CFG.pathWidth / order.length;
  return order.map((e, i) => ({ effect: e, x0: -CFG.halfWidth + i * w, x1: -CFG.halfWidth + (i + 1) * w }));
}

export function lethalChance(dist: number): number {
  return clamp((dist - 150) / 2000, 0, 0.6);
}

// ---------------------------------------------------------------- single-gate builders
export function addGate(A: number, rng: Rng, maxFactor: number): Effect {
  const f = rng.range(1.03, Math.max(1.06, maxFactor));
  return opE(add(Math.max(2, niceRound(A * (f - 1)))));
}

export function jackpotChance(A: number): number {
  return clamp((Math.log(targetFactor(A)) - 0.03) / 0.66, 0.03, 0.9);
}

export function mulGate(A: number, rng: Rng): Effect {
  const M =
    A < 10
      ? rng.weighted([[2, 0.6], [3, 0.35], [4, 0.05]] as const)
      : A < 300
        ? rng.weighted([[2, 0.75], [3, 0.22], [4, 0.03]] as const)
        : rng.weighted([[2, 0.9], [3, 0.1]] as const);
  return opE(mul(M));
}

export function subGate(A: number, rng: Rng, dist: number): Effect {
  const lethal = rng.chance(lethalChance(dist));
  const r = lethal ? rng.range(1.0, 1.6) : rng.range(0.3, 0.9);
  return opE(sub(Math.max(1, niceRound(A * r))));
}

export function divGate(rng: Rng): Effect {
  return opE(div(rng.weighted([[2, 0.45], [3, 0.35], [4, 0.2]] as const)));
}

function redGate(A: number, rng: Rng, dist: number): Effect {
  return rng.chance(0.45) ? divGate(rng) : subGate(A, rng, dist);
}

/** One green gate; the "jackpot" is a multiplier. */
function greenGate(A: number, rng: Rng, jackpot: boolean): Effect {
  if (jackpot) return mulGate(A, rng);
  return addGate(A, rng, targetFactor(A));
}

function dedupe(effs: Effect[], make: () => Effect): Effect[] {
  const seen = new Set<string>();
  return effs.map((e) => {
    let tries = 0;
    while (seen.has(effectText(e)) && tries++ < 12) e = make();
    seen.add(effectText(e));
    return e;
  });
}

// ---------------------------------------------------------------- simple sets
export type SimpleCategory = 'pos' | 'mixed' | 'neg';

export function genSimple(ctx: GenCtx, rng: Rng, cat: SimpleCategory, n: number): Effect[] {
  const A = Math.max(1, ctx.ref);
  const pj = jackpotChance(A);
  let effs: Effect[] = [];

  if (cat === 'neg' && A < 8) cat = 'mixed';
  if (cat === 'mixed' && A < 4) cat = 'pos';

  if (cat === 'pos') {
    const jackIdx = rng.chance(pj) ? rng.int(0, n - 1) : -1;
    for (let i = 0; i < n; i++) effs.push(greenGate(A, rng, i === jackIdx));
    effs = dedupe(effs, () => addGate(A, rng, targetFactor(A)));
  } else if (cat === 'mixed') {
    const reds = rng.chance(0.5) ? n - 1 : rng.int(1, n - 1);
    const greens = n - reds;
    const jackIdx = rng.chance(pj) ? rng.int(0, greens - 1) : -1;
    for (let i = 0; i < greens; i++) effs.push(greenGate(A, rng, i === jackIdx));
    for (let i = 0; i < reds; i++) effs.push(redGate(A, rng, ctx.dist));
    effs = dedupe(effs, () => redGate(A, rng, ctx.dist));
  } else {
    // negative pressure: every gate is red, exactly one is a mild, survivable loss
    const mild = Math.max(1, niceRound(A * rng.range(0.04, 0.09)));
    effs.push(opE(sub(mild)));
    for (let i = 1; i < n; i++) effs.push(rng.chance(0.55) ? divGate(rng) : opE(sub(Math.max(mild + 1, niceRound(A * rng.range(0.25, 1.3))))));
    effs = dedupe(effs, () => divGate(rng));
  }
  return effs;
}

/** Worst-case guarantee used by every set: at least one non-disastrous option exists. */
export function hasNonDisastrous(effs: Effect[], A: number): boolean {
  return effs.some((e) => evalEffect(e, A) >= Math.floor(A * 0.85) && evalEffect(e, A) >= 1);
}

// ---------------------------------------------------------------- Type A: dual math gates
function seqSafeHigh(A: number, rng: Rng): Effect {
  // factor comfortably > 1; includes at least one growth op
  const tf = targetFactor(A);
  const r = rng.int(0, 2);
  if (r === 0) {
    // (add N) then (add M)
    const f = rng.range(1.05, Math.max(1.1, tf));
    const tot = Math.max(4, niceRound(A * (f - 1)));
    const a = Math.max(2, niceRound(tot * rng.range(0.35, 0.65)));
    return seqE(add(a), add(Math.max(2, tot - a)));
  }
  if (r === 1) {
    const p = rng.pick([[3, 2], [4, 3], [5, 4], [3, 2]] as const);
    return seqE(mul(p[0]), div(p[1]));
  }
  // "+N then x2" only while the army is small enough that doubling is in budget
  if (A < 60) return seqE(add(Math.max(2, niceRound(A * rng.range(0.1, 0.5)))), mul(2));
  return seqE(mul(3), div(2));
}

function seqRisky(A: number, rng: Rng, tfBest: number): Effect {
  const r = rng.int(0, 3);
  if (r === 0 || r === 1) {
    // "-K then xM" with a net factor ~ tfBest
    const M = rng.pick([2, 3, 3, 4]);
    const K = Math.max(1, niceRound(A * (1 - tfBest / M)));
    return seqE(sub(K), mul(M));
  }
  if (r === 2) {
    const M = rng.pick([2, 3]);
    const K = Math.max(1, niceRound(A * (M - tfBest)));
    return seqE(mul(M), sub(K));
  }
  const D = rng.pick([2, 3]);
  const N = Math.max(2, niceRound(A * (tfBest * D - 1)));
  return seqE(add(N), div(D));
}

export function genTypeA(ctx: GenCtx, rng: Rng, risk: number): Effect[] {
  const A = Math.max(1, ctx.ref);
  const tf = targetFactor(A);
  const safe = seqSafeHigh(A, rng);
  let other: Effect;
  const roll = rng.next();
  if (roll < 0.4 + 0.2 * risk) {
    // risky gate is the better one for the reference army, the safe one is the fallback
    other = seqRisky(A, rng, Math.max(tf * rng.range(1.1, 1.45), 1.15));
  } else if (roll < 0.85) {
    // trap: looks clever, nets a loss for the reference army
    other = seqRisky(A, rng, rng.range(0.5, 0.92));
  } else {
    other = seqSafeHigh(A, rng);
  }
  let tries = 0;
  while (effectText(other) === effectText(safe) && tries++ < 8) other = seqSafeHigh(A, rng);
  return [safe, other];
}

// ---------------------------------------------------------------- Type B: conditional gates
function condGate(A: number, rng: Rng, risk: number): Effect {
  const tf = targetFactor(A);
  const p = rng.weighted([[1, 0.3], [2, 0.35 + 0.15 * risk], [3, 0.35]] as const);
  const T = Math.max(2, niceRound(A * rng.range(0.55, 1.5)));
  if (p === 1) {
    // reward big armies
    const M = A < 40 ? rng.pick([2, 3]) : 2;
    const N = Math.max(2, niceRound(A * Math.max(0.06, (tf - 1) * rng.range(0.6, 1.1))));
    return condE('gte', T, mul(M), add(N));
  }
  if (p === 2) {
    // punish big armies
    return condE('gte', T, div(rng.pick([2, 2, 3])), add(Math.max(2, niceRound(A * rng.range(0.3, 1.2)))));
  }
  // punish small armies
  const K = Math.max(1, niceRound(A * rng.range(0.15, 0.6)));
  return condE('lt', T, sub(K), mul(2));
}

export function genTypeB(ctx: GenCtx, rng: Rng, risk: number): Effect[] {
  const A = Math.max(1, ctx.ref);
  const n = rng.chance(0.65) ? 3 : 2;
  const effs: Effect[] = [];
  for (let i = 0; i < n; i++) effs.push(condGate(A, rng, risk));
  // guarantee a safe, positive-growth option
  if (!effs.some((e) => isSafe(e) && evalEffect(e, A) > A)) {
    effs[0] = rng.chance(0.5) ? opE(add(Math.max(2, niceRound(A * Math.max(0.06, targetFactor(A) - 1))))) : condE('gte', Math.max(2, niceRound(A * 0.7)), add(Math.max(2, niceRound(A * 0.25))), add(Math.max(2, niceRound(A * 0.2))));
  }
  return effs;
}

export { effectTone };
export type { Op };
