import type { Effect } from './logic';

export type SetKind = 'simple' | 'A' | 'B' | 'C' | 'D';

/** A gate that pays out something other than army: it leaves the army unchanged (effect is ×1). */
export type Bonus = { kind: 'coins'; amount: number } | { kind: 'instakill' } | { kind: 'double' };

export interface GateDef {
  bonus?: Bonus;
  effect: Effect;
  x0: number; // lane extents in world x
  x1: number;
  fade?: 'shrink' | 'fade'; // Type D time-pressure behaviour
}

export interface GateSet {
  type: 'gates';
  id: number;
  kind: SetKind;
  complex: boolean;
  s: number; // distance (m) of the gate plane along the path
  gates: GateDef[];
  split: boolean; // Type C: two lanes with a divider
  revealLead: number; // seconds before crossing at which the set pops in (0 = normal far spawn)
  category: string;
  tutorialRequired?: (army: number, result: number, chosenIdx: number) => boolean;
  hint?: string;
}

export type EnemyKind = 'grunt' | 'brute' | 'titan' | 'boss';

export interface EnemySpec {
  kind: EnemyKind;
  hp: number;
  atk: number; // friendly units this enemy kills per second while alive
}

export interface CombatZone {
  type: 'combat';
  id: number;
  s: number; // where the army halts
  enemies: EnemySpec[];
  fightNo: number;
  boss: boolean;
  refArmy: number; // army the fight was balanced for
  critical: number; // smallest army (share of refArmy) that still clears it
  lossFrac: number; // expected share of the army lost by a best-play army (used to size later gates)
  hint?: string;
}

export type TrackItem = GateSet | CombatZone;

/** Anything that can feed the track: the endless generator or the scripted tutorial. */
export interface ItemSource {
  cursor: number;
  next(ref: number): TrackItem | null;
}

export interface GenCtx {
  ref: number; // reference army size the numbers are scaled to
  dist: number; // meters travelled when the set will be crossed (approx)
}
