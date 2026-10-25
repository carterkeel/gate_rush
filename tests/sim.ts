import { CFG, speedAt, spacingAt, spawnAheadDist } from '../src/config';
import { Track, bestResult } from '../src/track';
import { evalEffect, isSafe } from '../src/logic';
import { simulateFight } from '../src/combatModel';
import type { GateSet } from '../src/types';

declare const process: { exit(code: number): never };
let failures = 0;
const fail = (m: string) => {
  failures++;
  if (failures < 25) console.log('  FAIL:', m);
};

// ---- timing guarantees --------------------------------------------------
for (let t = 0; t < 4000; t += 10) {
  const v = speedAt(t);
  const lead = spawnAheadDist(v) / v;
  if (lead < CFG.minReactionSec) fail(`reaction window ${lead.toFixed(2)}s < 1.4 at speed ${v}`);
}
if (CFG.timePressureRevealSec < CFG.minReactionSec) fail('time-pressure reveal lead < 1.4s');
if (speedAt(0) !== 8 || speedAt(30) !== 8.15 || speedAt(1e6) !== 16) fail('speed curve');
if (spacingAt(0) !== 18 || spacingAt(1e6) !== 9) fail('spacing curve');

// ---- generator, optimal player -----------------------------------------
const SEEDS = 40;
const MAX_DIST = 9000;
let sets = 0;
let complexAfter = 0;
let setsAfter = 0;
let minWindowLogGrowth = Infinity;
let windowSum = 0;
let windowN = 0;
let worst = { seed: 0, s: 0, a0: 0, a1: 0 };
const kinds: Record<string, number> = {};
const cats: Record<string, number> = { '0-500': 0, '500-1500': 0, '1500+': 0 };
const catPos: Record<string, number> = {};
let safeMissing = 0;
let fightsSeen = 0;
let bossFights = 0;
let lossSum = 0;
let lossN = 0;
let bossLossSum = 0;
let weakTotal = 0;
let cliffTotal = 0;
let twoBadLose = 0;
let slipWins = 0;
let critSum = 0;
let weakFail = 0;
let maxEnemies = 0;
let enemyCountSum = 0;

for (let seed = 1; seed <= SEEDS; seed++) {
  const track = new Track(seed * 7919);
  let A = 1;
  const marks: Array<{ s: number; logA: number }> = [{ s: 0, logA: 0 }];
  for (;;) {
    const it = track.next(A);
    if (it.type === 'combat') {
      fightsSeen++;
      const kinds = it.enemies.map((e) => e.kind);
      if (!kinds.includes('titan')) fail(`fight ${it.fightNo} has no titan`);
      const isBoss = it.fightNo % 10 === 0;
      if (isBoss !== it.boss) fail(`fight ${it.fightNo}: boss flag wrong`);
      if (isBoss && !kinds.includes('boss')) fail(`fight ${it.fightNo} should have a boss`);
      if (!isBoss && kinds.includes('boss')) fail(`fight ${it.fightNo} has a boss off-cycle`);
      if (isBoss) bossFights++;
      const hpTotal = it.enemies.reduce((a, e) => a + e.hp, 0);
      const r = simulateFight(A, it.enemies);
      if (!r.cleared) fail(`best-play army ${A} cannot clear fight ${it.fightNo} (hp ${hpTotal}) at ${it.s.toFixed(0)}m`);
      else {
        lossSum += 1 - r.finalArmy / A;
        lossN++;
        if (isBoss) bossLossSum += 1 - r.finalArmy / A;
      }
      // fights must be able to kill: an under-sized army (a third of ref) must lose units or die
      const weak = simulateFight(Math.max(1, Math.floor(A / 3)), it.enemies);
      if (A >= 30) {
        weakTotal++;
        if (!weak.cleared) weakFail++;
        // two bad decisions (about 60 % of the expected army) must lose; a small slip (88 %) must still win
        cliffTotal++;
        if (!simulateFight(Math.round(A * 0.6), it.enemies).cleared) twoBadLose++;
        if (simulateFight(Math.round(A * (isBoss ? 0.95 : 0.9)), it.enemies).cleared) slipWins++;
        critSum += it.critical;
      }
      maxEnemies = Math.max(maxEnemies, it.enemies.length);
      enemyCountSum += it.enemies.length;
      A = Math.max(1, r.finalArmy);
      continue;
    }
    const set = it as GateSet;
    if (set.s > MAX_DIST || A > 1e8) break;
    sets++;
    kinds[set.kind] = (kinds[set.kind] || 0) + 1;
    const band = set.s < 500 ? '0-500' : set.s < 1500 ? '500-1500' : '1500+';
    cats[band]++;
    catPos[band + ':' + set.category] = (catPos[band + ':' + set.category] || 0) + 1;

    // structure checks
    if (set.gates.length < 2 || set.gates.length > 4) fail(`gate count ${set.gates.length}`);
    if (set.kind === 'C' && set.gates.length !== 2) fail('type C needs two lanes');
    if (set.s >= CFG.complexFromMeters) {
      setsAfter++;
      if (set.complex) complexAfter++;
    } else if (set.complex) fail(`complex set before ${CFG.complexFromMeters} m at ${set.s}`);
    for (const g of set.gates) {
      const e = g.effect;
      if (e.t === 'cond' && set.kind !== 'B' && set.kind !== 'D') fail('conditional outside type B');
    }

    // fairness: at least one option that does not shrink a reasonably sized army
    const results = set.split
      ? [bestResult(set, A).result]
      : set.gates.map((g) => evalEffect(g.effect, A));
    const best = Math.max(...results);
    if (best < A) {
      if (set.category !== 'neg') fail(`no non-losing option at ${set.s.toFixed(0)}m (A=${A}, kind ${set.kind})`);
    }
    if (set.category === 'neg') {
      if (best < Math.floor(A * 0.85) || best < 1) fail(`neg set has no survivable option (A=${A}, best=${best})`);
    }
    if (!set.split && set.kind !== 'simple' || set.category !== 'neg') {
      // a guaranteed safe gate for every army size (not just the reference)
      const anySafe = set.gates.some((g) => isSafe(g.effect)) || set.split && set.gates.some((g) => isSafe(g.effect));
      if (set.category !== 'neg' && !anySafe) safeMissing++;
    }
    // pure all-lethal sets forbidden
    if (!set.split && set.gates.every((g) => evalEffect(g.effect, A) <= 0)) fail('all gates lethal');

    A = Math.max(1, best);
    marks.push({ s: set.s, logA: Math.log(A) });
  }
  // growth over every 500 m window (only while far from the numeric cap)
  for (let i = 0; i < marks.length; i++) {
    const j = marks.findIndex((m) => m.s >= marks[i].s + 500);
    if (j < 0) break;
    if (marks[j].logA > Math.log(1e8)) break;
    const g = marks[j].logA - marks[i].logA;
    windowSum += g;
    windowN++;
    if (g < minWindowLogGrowth) worst = { seed, s: marks[i].s, a0: Math.exp(marks[i].logA), a1: Math.exp(marks[j].logA) };
    minWindowLogGrowth = Math.min(minWindowLogGrowth, g);
  }
}

const share = setsAfter ? complexAfter / setsAfter : 0;
console.log(`sets generated: ${sets}`);
console.log('kinds:', kinds);
console.log('category by band:', catPos);
console.log(`complex share after ${CFG.complexFromMeters} m: ${(share * 100).toFixed(1)}%`);
console.log(`min log-growth over any 500 m window: ${minWindowLogGrowth.toFixed(3)} (x${Math.exp(minWindowLogGrowth).toFixed(2)})`);
console.log(`mean log-growth per 500 m: ${(windowSum / Math.max(1, windowN)).toFixed(3)}; worst window seed ${worst.seed} at ${worst.s.toFixed(0)}m: ${worst.a0.toFixed(0)} -> ${worst.a1.toFixed(0)}`);
console.log(`non-neg sets without a universally safe gate: ${safeMissing}`);
console.log(`fights: ${fightsSeen} (bosses ${bossFights}), avg enemies ${(enemyCountSum / Math.max(1, fightsSeen)).toFixed(1)}, max ${maxEnemies}`);
console.log(`best-play army lost on average ${((lossSum / Math.max(1, lossN)) * 100).toFixed(0)}% per fight (bosses ${((bossLossSum / Math.max(1, bossFights)) * 100).toFixed(0)}%)`);
console.log(`an army a third of the expected size fails ${weakFail}/${weakTotal} fights`);
console.log(`army at 60% of expected loses ${twoBadLose}/${cliffTotal} fights; at 90% (boss 95%) still wins ${slipWins}/${cliffTotal}; mean cliff ${(critSum / Math.max(1, cliffTotal) * 100).toFixed(0)}% of expected`);
if (cliffTotal && twoBadLose / cliffTotal < 0.9) fail('two bad decisions do not lose enough fights');
if (cliffTotal && slipWins / cliffTotal < 0.8) fail('a small slip loses too many fights');
if (weakTotal && weakFail / weakTotal < 0.5) fail('fights are too soft for an undersized army');
if (share < 0.3) fail('complex share below 30%');
if (!(minWindowLogGrowth > 0)) fail('non-positive growth window');
if (safeMissing > 0) fail('sets without a universally safe gate');

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
