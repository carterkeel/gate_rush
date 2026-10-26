import { Rng } from './rng';
import { simulateFight } from './combatModel';
import type { EnemySpec } from './types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Build one fight's roster from a total hit-point budget H and a total attack budget D0 (units killed per second
 * while everything is alive). Every fight has a titan; every tenth fight is a boss fight with escorts.
 */
export function composeFight(H: number, D0: number, boss: boolean, titans: number): EnemySpec[] {
  const titanShare = boss ? 0.24 : titans === 2 ? 0.4 : 0.34;
  const bruteShare = boss ? 0.12 : 0.14;
  const bossShare = boss ? 0.4 : 0;
  const gruntShare = 1 - titanShare - bruteShare - bossShare;

  const out: Omit<EnemySpec, 'atk'>[] = [];
  const Eg = clamp(Math.round(Math.sqrt(gruntShare * H) * 2.3), 8, 46);
  for (let i = 0; i < Eg; i++) out.push({ kind: 'grunt', hp: Math.max(1, Math.round((gruntShare * H) / Eg)) });
  const Eb = clamp(Math.round(Math.sqrt(bruteShare * H) * 0.9), 2, 8);
  for (let i = 0; i < Eb; i++) out.push({ kind: 'brute', hp: Math.max(3, Math.round((bruteShare * H) / Eb)) });
  const nT = boss ? 2 : titans;
  for (let i = 0; i < nT; i++) out.push({ kind: 'titan', hp: Math.max(12, Math.round((titanShare * H) / nT)) });
  if (boss) out.push({ kind: 'boss', hp: Math.max(40, Math.round(bossShare * H)) });

  // attack is shared out by hp^0.6: big enemies hit harder, but not in direct proportion
  let wSum = 0;
  const w = out.map((e) => Math.pow(e.hp, 0.6));
  for (const x of w) wSum += x;
  return out.map((e, i) => ({ ...e, atk: D0 * (w[i] / wSum) }));
}

export interface BalancedFight {
  enemies: EnemySpec[];
  boss: boolean;
  lossFrac: number;
  critical: number; // smallest army (as a share of ref) that still clears the fight
}

/** Smallest army, as a fraction of `ref`, that clears the roster inside the time limit. */
export function criticalFraction(enemies: EnemySpec[], ref: number): number {
  let lo = 0.05;
  let hi = 2.5;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (simulateFight(Math.max(1, Math.round(mid * ref)), enemies).cleared) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Scale a fight so it has a cliff: the army a best-play run should have (ref) wins, but an army that made a couple
 * of bad decisions (roughly 70 % of ref or less) loses units until it dies or runs out the clock.
 * Late normal fights put the cliff at ~78 % of ref, boss fights at ~86 % (see `target`: earlier fights are softer).
 */
export function balancedFight(ref: number, dist: number, fightNo: number, rng: Rng): BalancedFight {
  const boss = fightNo % 10 === 0;
  const titans = boss ? 2 : fightNo >= 4 && rng.chance(0.4) ? 2 : 1;
  // Forgiveness fades with distance: early fights tolerate a much smaller army (about 45 % of the expected size),
  // from 800 m on the cliff sits at 72 % (boss 80 %): a run that makes every correct decision always arrives above it, with room for rounding and imperfect lane splits.
  const t = clamp((dist - 300) / 500, 0, 1);
  const target = boss ? 0.55 + 0.25 * t : 0.45 + 0.27 * t;
  const H0 = 7 * ref + 16 + dist * 0.05;
  const D0 = Math.max(0.14 * ref, 0.7);
  let lo = 0.05;
  let hi = 40;
  for (let i = 0; i < 22; i++) {
    const m = Math.sqrt(lo * hi);
    const c = criticalFraction(composeFight(H0 * m, D0 * m, boss, titans), ref);
    if (c > target) hi = m;
    else lo = m;
  }
  const enemies = composeFight(H0 * lo, D0 * lo, boss, titans);
  const r = simulateFight(ref, enemies);
  const left = r.cleared ? r.finalArmy / ref : 0;
  return { enemies, boss, lossFrac: Math.min(0.95, Math.max(0, 1 - left)), critical: criticalFraction(enemies, ref) };
}
