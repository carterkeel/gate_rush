import { CFG } from './config';
import { add, sub, mul, div, opE, seqE, condE } from './logic';
import type { Effect } from './logic';
import type { CombatZone, GateDef, GateSet, ItemSource, TrackItem } from './types';

type Factory = (s: number, id: number) => TrackItem;

function tileFixed(effs: Effect[], fades: Array<'shrink' | 'fade' | undefined> = []): GateDef[] {
  const w = CFG.pathWidth / effs.length;
  return effs.map((e, i) => ({ effect: e, x0: -CFG.halfWidth + i * w, x1: -CFG.halfWidth + (i + 1) * w, fade: fades[i] }));
}

function gateSet(
  s: number,
  id: number,
  kind: GateSet['kind'],
  gates: GateDef[],
  hint: string,
  required: GateSet['tutorialRequired'],
  extra: Partial<GateSet> = {},
): GateSet {
  return { type: 'gates', id, kind, complex: kind !== 'simple', s, gates, split: kind === 'C', revealLead: 0, category: 'tutorial', hint, tutorialRequired: required, ...extra };
}

/**
 * Scripted tutorial: one of every gate type, in a fixed order. Each step must be answered correctly to move on;
 * a wrong gate restores the army and replays the same step (see Game.resolveSet).
 * Army trace with correct play: 1 -> 6 -> 12 -> 18 -> 56 -> 168 -> 232 -> ~900 -> combat.
 */
const STEPS: Factory[] = [
  // 1. addition
  (s, id) =>
    gateSet(s, id, 'simple', tileFixed([opE(add(2)), opE(add(5))]), 'Slide left or right. Green gates add units. Take the +5!', (_a, r) => r >= 6),
  // 2. multiplication
  (s, id) =>
    gateSet(s, id, 'simple', tileFixed([opE(add(3)), opE(mul(2))]), '× multiplies your whole army. Take the ×2!', (a, r) => r >= a * 2),
  // 3. subtraction + division (red)
  (s, id) =>
    gateSet(
      s,
      id,
      'simple',
      tileFixed([opE(sub(5)), opE(div(2)), opE(add(6))]),
      'Red gates (− and ÷) shrink your army. Dodge them!',
      (a, r) => r >= a,
    ),
  // 4. Type A: two chained operations
  (s, id) =>
    gateSet(
      s,
      id,
      'A',
      tileFixed([seqE(mul(2), add(5)), seqE(add(10), mul(2))]),
      'Yellow gates chain two steps. Do the math and pick the bigger result!',
      (a, r) => r >= (a + 10) * 2,
    ),
  // 5. Type B: conditional
  (s, id) =>
    gateSet(
      s,
      id,
      'B',
      tileFixed([condE('gte', 40, mul(3), add(8)), opE(add(20))]),
      'Conditional gates check your army size as you cross. You have 56, so ×3 applies!',
      (a, r) => r >= a * 3,
    ),
  // 6. Type C: split & merge
  (s, id) =>
    gateSet(
      s,
      id,
      'C',
      [
        { effect: seqE(sub(100), mul(3)), x0: -CFG.halfWidth, x1: -0.35 },
        { effect: opE(add(30)), x0: 0.35, x1: CFG.halfWidth },
      ],
      'The path splits! Your army divides between the lanes. Left pays 100 then ×3. Stay left!',
      (_a, r) => r >= 200,
    ),
  // 7. Type D: time pressure
  (s, id) =>
    gateSet(s, id, 'D', tileFixed([opE(add(30)), opE(mul(4)), opE(div(2))], [undefined, 'shrink', undefined]), 'Some gates shrink or vanish. Dive for the ×4 before it is gone!', (a, r) => r >= a * 3.5, {
      revealLead: CFG.timePressureRevealSec,
    }),
  // 8. combat
  (s, id): CombatZone => ({
    type: 'combat',
    id,
    s,
    enemies: [
      ...Array.from({ length: 8 }, () => ({ kind: 'grunt' as const, hp: 3, atk: 0.08 })),
      { kind: 'titan' as const, hp: 30, atk: 0.3 },
    ],
    fightNo: 0,
    boss: false,
    refArmy: 0,
    critical: 0,
    lossFrac: 0,
    hint: 'Enemies shoot back and a titan guards them! Your units fire on their own. Hold the line!',
  }),
];

export class TutorialSource implements ItemSource {
  cursor = 0;
  private i = 0;
  private nextId = 1000;
  private stepOf = new Map<number, number>();
  lastId = -1;

  next(): TrackItem | null {
    if (this.i >= STEPS.length) {
      this.cursor = Infinity;
      return null;
    }
    const s = this.cursor === 0 ? 42 : this.cursor + 36;
    const id = this.nextId++;
    const item = STEPS[this.i](s, id);
    this.stepOf.set(id, this.i);
    if (this.i === STEPS.length - 1) this.lastId = id;
    this.i++;
    this.cursor = s;
    return item;
  }

  stepIndex(id: number): number {
    return this.stepOf.get(id) ?? 0;
  }

  /** Replay step `idx` so that it next appears about 40 m ahead of `fromS`. */
  rewind(idx: number, fromS: number): void {
    this.i = idx;
    this.cursor = fromS + 4;
  }
}
