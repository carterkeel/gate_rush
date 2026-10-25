import { CFG } from './config';
import { Rng } from './rng';
import { Effect, add, sub, mul, opE, seqE, evalEffect, isSafe, niceRound } from './logic';
import type { GateDef, GenCtx } from './types';
import { targetFactor, genSimple, tile } from './gateGen';

// ---------------------------------------------------------------- Type C: split & merge
/** Two lanes, one gate each. The risky lane pays an entry fee then multiplies; the safe lane never loses units. */
export function genTypeC(ctx: GenCtx, rng: Rng, risk: number): GateDef[] {
  const A = Math.max(4, ctx.ref);
  const tf = targetFactor(A);
  const M = rng.pick(A < 60 ? [3, 4, 5] : [3, 3, 4]);
  const tfBest = Math.max(tf * (1.5 + 0.5 * risk), 1.4);
  const K = Math.max(1, niceRound(A * (1 - tfBest / M)));
  const risky = seqE(sub(K), mul(M));
  const safe: Effect =
    A < 60 && rng.chance(0.4) ? opE(mul(2)) : opE(add(Math.max(2, niceRound(A * Math.max(0.08, tf - 1) * rng.range(0.9, 1.4)))));
  const riskyLeft = rng.chance(0.5);
  const hw = CFG.halfWidth;
  const gap = 0.35;
  const L: GateDef = { effect: riskyLeft ? risky : safe, x0: -hw, x1: -gap };
  const R: GateDef = { effect: riskyLeft ? safe : risky, x0: gap, x1: hw };
  return [L, R];
}

// ---------------------------------------------------------------- Type D: time-pressure multi-gate
export function genTypeD(ctx: GenCtx, rng: Rng, risk: number): GateDef[] {
  const A = Math.max(1, ctx.ref);
  const n = rng.chance(0.5) ? 3 : 4;
  const effs = genSimple(ctx, rng, A >= 4 && rng.chance(0.8 + 0.15 * risk) ? 'mixed' : 'pos', n);
  const gates = tile(effs, rng);

  // rank by result for the reference army; the juiciest gates are the ones that fade
  const order = gates.map((g, i) => i).sort((a, b) => evalEffect(gates[b].effect, A) - evalEffect(gates[a].effect, A));
  const fadeCount = n === 4 && rng.chance(0.5) ? 2 : 1;
  for (let k = 0; k < fadeCount; k++) gates[order[k]].fade = rng.chance(0.5) ? 'shrink' : 'fade';

  // keep a non-fading, safe, growing fallback
  const hasFallback = gates.some((g) => !g.fade && isSafe(g.effect) && evalEffect(g.effect, A) > A);
  if (!hasFallback) {
    const target = order.slice().reverse().find((i) => !gates[i].fade) ?? order[order.length - 1];
    gates[target].effect = opE(add(Math.max(2, niceRound(A * Math.max(0.06, targetFactor(A) - 1) * 0.6))));
    gates[target].fade = undefined;
  }
  return gates;
}
