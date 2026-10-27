import { CFG, spacingAt, complexShareAt } from './config';
import { Rng } from './rng';
import { evalEffect, bestSplit, isSafe, opE, add, mul, niceRound } from './logic';
import type { Effect } from './logic';
import type { CombatZone, GateDef, GateSet, SetKind, TrackItem } from './types';
import { addGate, clamp, genSimple, genTypeA, genTypeB, hasNonDisastrous, targetFactor, tile } from './gateGen';
import type { SimpleCategory } from './gateGen';
import { genTypeC, genTypeD } from './gateGenSpecial';
import { balancedFight } from './fightGen';
import { simulateFight, formationDepth } from './combatModel';

/** Best achievable army size after crossing a set, assuming the player picks the best gate for `army`. */
export function bestResult(set: GateSet, army: number): { result: number; index: number } {
  if (set.split) {
    // Reachable result: commit the whole army to the better lane. A perfect mid-lane split can beat this,
    // but it needs pixel-precise steering, so fights are balanced against the single-lane result.
    const l = evalEffect(set.gates[0].effect, army);
    const r = evalEffect(set.gates[1].effect, army);
    return l >= r ? { result: l, index: 0 } : { result: r, index: 1 };
  }
  let best = -1;
  let idx = 0;
  set.gates.forEach((g, i) => {
    const r = evalEffect(g.effect, army);
    if (r > best) {
      best = r;
      idx = i;
    }
  });
  return { result: best, index: idx };
}

/** Project the army forward through queued (uncrossed) items assuming best play. */
export function projectArmy(items: TrackItem[], start: number): number {
  let a = start;
  for (const it of items) {
    if (it.type === 'gates') a = Math.max(1, bestResult(it, a).result);
    else a = Math.max(1, Math.round(a * (1 - it.lossFrac)));
  }
  return a;
}

export interface TrackStats {
  sets: number;
  complex: number;
  combat: number;
}

export class Track {
  private rng: Rng;
  private nextId = 1;
  cursor = 0; // s of the last placed item
  private setsSinceCombat = 0;
  fights = 0;
  private nextCombatAfter: number;
  private prevKind: SetKind | 'combat' | null = null;
  setsAfterComplexStart = 0;
  complexDebt = 0.5;
  private setsSinceBonus = 0;
  private bonusEvery = 0;
  complexAfterStart = 0;
  private minNextS = 0;
  stats: TrackStats = { sets: 0, complex: 0, combat: 0 };

  constructor(seed?: number, firstGateS = 30) {
    this.rng = new Rng(seed);
    this.cursor = firstGateS - spacingAt(0);
    this.nextCombatAfter = this.rng.int(CFG.combatEveryMin, CFG.combatEveryMax);
    this.bonusEvery = this.rng.int(4, 7);
  }

  /** After a head start jump: the first fight is always at least `minSets` gate sets away, wherever the jump landed. */
  restAfterJump(minSets = 5): void {
    this.setsSinceCombat = 0;
    this.nextCombatAfter = this.rng.int(minSets, minSets + 2);
  }

  next(ref: number): TrackItem {
    ref = Math.max(1, ref);
    if (this.setsSinceCombat >= this.nextCombatAfter) return this.makeCombat(ref);
    return this.makeSet(ref);
  }

  // ------------------------------------------------------------ combat
  private makeCombat(ref: number): CombatZone {
    const stop = this.cursor + 18;
    this.fights++;
    const f = balancedFight(ref, stop, this.fights, this.rng);
    // the next gate set starts beyond the whole enemy formation (plus a margin), so nothing clips into it
    // the next gate set sits just beyond the rearmost enemy (split zones need a little more room)
    const rear = stop + CFG.combatStopGap + formationDepth(f.enemies);
    this.minNextS = rear + 3;
    this.cursor = rear + 3 - spacingAt(rear);
    this.setsSinceCombat = 0;
    this.nextCombatAfter = this.rng.int(CFG.combatEveryMin, CFG.combatEveryMax);
    this.prevKind = 'combat';
    this.stats.combat++;
    return { type: 'combat', id: this.nextId++, s: stop, enemies: f.enemies, fightNo: this.fights, boss: f.boss, refArmy: ref, critical: f.critical, lossFrac: f.lossFrac };
  }

  // ------------------------------------------------------------ gate sets
  private pickSimpleCategory(dist: number): SimpleCategory | 'complex' {
    const r = this.rng;
    if (dist < 300) return r.weighted([['pos', 0.45], ['mixed', 0.55]] as const);
    if (dist < 1500) return r.weighted([['pos', 0.2], ['mixed', 0.55], ['neg', 0.25]] as const);
    const c = r.weighted([['pos', 0.1], ['mixed', 0.5], ['neg', 0.15], ['complex', 0.25]] as const);
    // complex sets are rationed by the ramp in makeSet, not by this table
    return c === 'complex' ? 'mixed' : c;
  }

  private makeSet(ref: number): GateSet {
    const rng = this.rng;
    let dist = this.cursor + spacingAt(this.cursor);
    let cat = this.pickSimpleCategory(dist);

    // Yellow (complex) sets start at 400 m with a small share that ramps up to the full share (>= 30 %)
    // by complexFullMeters. A running debt keeps them evenly spread, plus a little randomness.
    const share = complexShareAt(dist);
    if (share > 0) {
      this.complexDebt += share;
      if (this.complexDebt >= 1) {
        this.complexDebt -= 1;
        cat = 'complex';
      } else if (rng.chance(share * 0.1)) cat = 'complex';
    }
    if (ref < 6 && cat === 'complex') cat = 'pos';

    let kind: SetKind = 'simple';
    let gates: GateDef[] = [];
    let revealLead = 0;
    const risk = clamp((dist - 800) / 3000, 0, 1) * 0.7 + (dist >= 1500 ? 0.3 : 0);
    const ctx = { ref, dist };

    if (cat === 'complex') {
      kind = rng.weighted([['A', 0.3], ['B', 0.3], ['C', 0.2], ['D', 0.2]] as const);
      if (kind === 'A') gates = tile(genTypeA(ctx, rng, risk), rng);
      else if (kind === 'B') gates = tile(genTypeB(ctx, rng, risk), rng);
      else if (kind === 'C') gates = genTypeC(ctx, rng, risk);
      else {
        gates = genTypeD(ctx, rng, risk);
        revealLead = CFG.timePressureRevealSec;
      }
    } else {
      const n = dist < 1000 ? rng.weighted([[2, 0.4], [3, 0.45], [4, 0.15]] as const) : rng.weighted([[2, 0.2], [3, 0.45], [4, 0.35]] as const);
      let effs = genSimple(ctx, rng, cat, n);
      if (cat !== 'neg') effs = this.ensureGrowth(effs, ref, rng);
      gates = tile(effs, rng);
    }

    // spacing: split zones need room on both sides
    let gap = spacingAt(this.cursor);
    if (kind === 'C') gap = Math.max(gap, CFG.splitZoneLength + 2);
    if (this.prevKind === 'C') gap = Math.max(gap, CFG.splitZoneLength + 2);
    let s = this.cursor + gap;
    if (this.minNextS > 0) {
      s = Math.max(s, this.minNextS + (kind === 'C' ? 6 : 0));
      this.minNextS = 0;
    }
    dist = s;

    const set: GateSet = {
      type: 'gates',
      id: this.nextId++,
      kind,
      complex: kind !== 'simple',
      s,
      gates,
      split: kind === 'C',
      revealLead,
      category: cat,
    };

    // global safety net: a non-disastrous option must exist
    if (!hasNonDisastrous(gates.map((g) => g.effect), ref) && kind !== 'C') {
      gates[0].effect = opE(add(Math.max(2, niceRound(ref * 0.1))));
    }

    // rare bonus gate: swap the worst gate of a simple set for coins or a power-up, so taking it costs real army growth
    this.setsSinceBonus++;
    if (kind === 'simple' && dist >= 100 && this.setsSinceBonus >= this.bonusEvery && gates.length >= 2) {
      const vals = gates.map((g) => evalEffect(g.effect, ref));
      let best = 0;
      let worst = 0;
      vals.forEach((v, i) => {
        if (v > vals[best]) best = i;
        if (v < vals[worst]) worst = i;
      });
      if (best !== worst && vals[best] >= ref * 1.05 + 1) {
        const k = this.rng.weighted([['coins', 0.32], ['instakill', 0.4], ['double', 0.28]] as const);
        gates[worst].bonus = k === 'coins' ? { kind: 'coins', amount: 100 } : { kind: k };
        gates[worst].effect = opE(mul(1));
        this.setsSinceBonus = 0;
        this.bonusEvery = this.rng.int(4, 7);
      }
    }

    this.cursor = s;
    this.setsSinceCombat++;
    this.prevKind = kind;
    this.stats.sets++;
    if (kind !== 'simple') this.stats.complex++;
    if (dist >= CFG.complexFromMeters) {
      this.setsAfterComplexStart++;
      if (kind !== 'simple') this.complexAfterStart++;
    }
    return set;
  }

  /** Make sure the best option for the reference army is a real gain. */
  private ensureGrowth(effs: Effect[], ref: number, rng: Rng): Effect[] {
    const need = ref * 1.06 + 1;
    const best = Math.max(...effs.map((e) => evalEffect(e, ref)));
    if (best >= need) return effs;
    const out = effs.slice();
    // replace the worst gate with a safe, clearly growing one
    let worst = 0;
    for (let i = 1; i < out.length; i++) if (evalEffect(out[i], ref) < evalEffect(out[worst], ref)) worst = i;
    const g = addGate(ref, rng, targetFactor(ref));
    out[worst] = isSafe(g) ? g : opE(add(Math.max(2, niceRound(ref * 0.12))));
    return out;
  }
}

/**
 * Head start: play a fresh track with best-play decisions up to `meters` and hand back the track (positioned there)
 * plus the army a good run would have by then, so the content ahead is as hard as at that distance.
 * The army is 90 % of best play: a skilled but imperfect run, safely above the fight cliff.
 */
export function headStartTrack(meters: number): { track: Track; army: number } {
  // best-play armies vary a lot from seed to seed (multiplier streaks): take the median of three tracks
  const c = [0, 1, 2].map(() => oneHeadStart(meters)).sort((a, b) => a.army - b.army);
  return c[1];
}

function oneHeadStart(meters: number): { track: Track; army: number } {
  const t = new Track();
  let A = 1;
  for (let guard = 0; guard < 4000; guard++) {
    const it = t.next(A);
    if (it.s >= meters) {
      if (it.type === 'combat') t.fights--; // that fight is generated again later
      break;
    }
    if (it.type === 'combat') A = Math.max(1, simulateFight(A, it.enemies).finalArmy);
    else A = Math.max(1, bestResult(it, A).result);
  }
  t.cursor = meters;
  t.restAfterJump(5);
  return { track: t, army: Math.max(1, Math.floor(A * 0.9)) };
}
