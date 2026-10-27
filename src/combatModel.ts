import { CFG } from './config';
import type { EnemyKind, EnemySpec } from './types';

/** Shooting priority: weak enemies fall first, the big ones soak the rest of the volley. */
export const KIND_ORDER: Record<EnemyKind, number> = { grunt: 0, brute: 1, titan: 2, boss: 3 };

export interface FightResult {
  finalArmy: number;
  remainingHp: number;
  cleared: boolean;
  seconds: number;
}

/**
 * Deterministic fight model shared by the level generator (for balancing) and mirrored by the runtime:
 * every friendly unit fires 1 shot per 0.6 s (1 damage), every living enemy kills `atk` units per second.
 */
export function simulateFight(army: number, enemies: EnemySpec[], maxSec: number = CFG.combatMaxSec, dt = 0.05): FightResult {
  const order = enemies.map((e, i) => i).sort((a, b) => KIND_ORDER[enemies[a].kind] - KIND_ORDER[enemies[b].kind] || a - b);
  const hp = order.map((i) => enemies[i].hp);
  const atk = order.map((i) => enemies[i].atk);
  let A = army;
  let shotAcc = 0;
  let lossAcc = 0;
  let head = 0;
  let t = 0;
  while (t < maxSec && head < hp.length && A > 0) {
    shotAcc += (A / CFG.shotIntervalSec) * dt;
    let shots = Math.floor(shotAcc);
    shotAcc -= shots;
    while (shots > 0 && head < hp.length) {
      const d = Math.min(shots, hp[head]);
      hp[head] -= d;
      shots -= d;
      if (hp[head] <= 0) head++;
    }
    let dps = 0;
    for (let i = head; i < hp.length; i++) dps += atk[i];
    lossAcc += dps * dt;
    const loss = Math.floor(lossAcc);
    lossAcc -= loss;
    A -= loss;
    t += dt;
  }
  let rem = 0;
  for (let i = head; i < hp.length; i++) rem += hp[i];
  return { finalArmy: Math.max(0, A), remainingHp: rem, cleared: rem <= 0 && A > 0, seconds: t };
}

/**
 * How far behind the front rank the enemy formation extends (metres), matching the layout in CombatSim.place:
 * grunts, then brutes, titans and the boss, each group laid out in rows. The next gate set is placed beyond it,
 * so enemies never poke into the gates behind them.
 */
export function formationDepth(enemies: { kind: string }[]): number {
  const n = { grunt: 0, brute: 0, titan: 0, boss: 0 } as Record<string, number>;
  for (const e of enemies) n[e.kind] = (n[e.kind] ?? 0) + 1;
  const group = (count: number, maxCols: number, dz: number) => {
    if (count <= 0) return 0;
    const cols = Math.max(1, Math.min(maxCols, count));
    return Math.ceil(count / cols) * dz + dz * 0.4 + Math.min(dz, 1.4) * 0.6;
  };
  const gruntCols = Math.min(9, Math.max(4, Math.ceil(Math.sqrt(n.grunt) * 1.6)));
  return group(n.grunt, gruntCols, 1.15) + group(n.brute, 6, 1.9) + group(n.titan, 3, 3.4) + group(n.boss, 1, 5.5) + (n.boss > 0 ? 3 : n.titan > 0 ? 2 : 1);
}
