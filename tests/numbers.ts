import { formatLargeNumber as f, applyOp, evalEffect, clampArmy, mul, add, sub, div, opE, condE } from '../src/logic';
import { CFG } from '../src/config';
import { Track, bestResult } from '../src/track';
import { simulateFight } from '../src/combatModel';
import { sanitizeSave } from '../src/storage';
import type { SaveData } from '../src/storage';

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (got !== want) {
    fails++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};
const ok = (name: string, c: boolean) => eq(name, c, true);

// 1. small values
for (const [n, s] of [[0, '0'], [1, '1'], [10, '10'], [999, '999'], [9999, '9,999']] as const) eq(`small ${n}`, f(n), s);
// 2. suffix boundaries
eq('1,000 exact', f(1000), '1,000');
eq('10,000', f(10000), '10K');
eq('999,999 carries', f(999_999), '1M');
eq('1,000,000', f(1e6), '1M');
eq('999.5K', f(999_500), '1M');
eq('999,400', f(999_400), '999K');
eq('1.25K-ish', f(12_500), '12.5K');
// 3. big values
eq('1.5M', f(1.5e6), '1.5M');
eq('2.5B', f(2.5e9), '2.5B');
eq('1T', f(1e12), '1T');
eq('1.5Qa', f(1.5e15), '1.5Qa');
eq('1Qi', f(1e18), '1Qi');
eq('7.77Sx', f(7.77e21), '7.77Sx');
eq('Sp', f(3e24), '3Sp');
eq('Oc', f(4.5e27), '4.5Oc');
eq('No', f(6e30), '6No');
eq('Dc', f(1e33), '1Dc');
eq('Vg', f(2e63), '2Vg');
// 4/5. beyond the safe-integer limit and into scientific notation
eq('2^60', f(2 ** 60), '1.15Qi');
eq('1e66', f(1e66), '1e66');
eq('1.5e100', f(1.5e100), '1.5e100');
eq('1e300', f(1e300), '1e300');
// invalid values never leak
eq('NaN', f(NaN), '0');
eq('Infinity', f(Infinity), 'MAX');
eq('negative', f(-1500000), '-1.5M');

// 6. repeated multiplication saturates at the cap instead of overflowing
let a = 1;
for (let i = 0; i < 400; i++) a = applyOp(a, mul(10));
eq('cap', a, CFG.armyCap);
ok('cap finite', Number.isFinite(a));
ok('x2 of the cap stays capped', clampArmy(CFG.armyCap * 2) === CFG.armyCap);
eq('cap label', f(a), '1e300');
// growth is monotone and exact where doubles are exact
eq('x1000 chain', [1, 2, 3, 4, 5].reduce((s) => applyOp(s, mul(1000)), 1), 1e15);
// 7. comparisons between very large values
ok('1e100 > 1e99', 1e100 > 1e99);
eq('cond gate big', evalEffect(condE('gte', 1e40, add(5), div(2)), 1e41), 1e41 + 5);
eq('cond gate small', evalEffect(condE('gte', 1e40, add(5), div(2)), 1e39), 5e38);
// 8. negatives and division by zero
eq('sub below zero', applyOp(5, sub(10)), 0);
eq('sub huge', applyOp(1e50, sub(1e50)), 0);
eq('div by zero', applyOp(7, div(0)), 7);
eq('NaN army', clampArmy(NaN), 0);
eq('Infinity army', clampArmy(Infinity), CFG.armyCap);
eq('seq to zero', evalEffect({ t: 'seq', a: { kind: 'sub', n: 9 }, b: { kind: 'mul', n: 5 } }, 9), 0);
void opE;

// 9. saving and loading large values
const big: SaveData = {
  coins: 12345,
  ownedSkins: [], ownedTrails: [], skin: 'trooper', trail: 'plain', tutorialDone: true, speedUnlocked: false, startLevel: 0, startOn: false,
  scores: [{ score: 1.5e299, distance: 1234, peak: 1e300, kills: 99, date: 1 }],
};
const back = sanitizeSave(JSON.parse(JSON.stringify(big)));
eq('peak survives save/load', back.scores[0].peak, 1e300);
eq('score survives save/load', back.scores[0].score, 1.5e299);
const bad = sanitizeSave({ ...big, coins: NaN, scores: [{ score: Infinity, distance: -4, peak: NaN, kills: 1, date: 1 }] } as SaveData);
eq('bad coins', bad.coins, 0);
eq('bad score', bad.scores[0].score, 0);
eq('bad peak', bad.scores[0].peak, 0);

// 10. a long best-play run (gates, fights, boss fights) stays finite and keeps growing far past the old billion limit
{
  const t = new Track();
  let A = 1;
  let s = 0;
  for (let g = 0; g < 4000 && s < 15000; g++) {
    const it = t.next(A);
    A = Math.max(1, it.type === 'combat' ? simulateFight(A, it.enemies).finalArmy : bestResult(it, A).result);
    s = it.s;
    if (!Number.isFinite(A)) break;
  }
  ok('long run finite', Number.isFinite(A));
  ok('long run passes 1e60', A > 1e60);
}

console.log(fails === 0 ? 'ALL NUMBER CHECKS PASSED' : `${fails} NUMBER CHECK(S) FAILED`);
if (fails) throw new Error('number checks failed');
