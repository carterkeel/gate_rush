// All fixed starting values from the spec live here.
export const CFG = {
  // path
  pathWidth: 10,
  halfWidth: 5,
  // army
  startArmy: 1,
  armyCap: 1e24, // numeric safety ceiling; far past exact integers, but only the suffix on the number matters up there
  visualCap: 700, // max rendered instances; beyond this units collapse into "elite" models
  // speed (units/second)
  baseSpeed: 8,
  speedStep: 0.15,
  speedStepEverySec: 30,
  maxSpeed: 16,
  // gate set spacing (meters between consecutive gate planes)
  spacingStart: 18,
  spacingMin: 9,
  spacingDropPerMeter: 0.0025, // reaches the 9 m floor at 3600 m
  // fairness
  minReactionSec: 1.4,
  spawnLeadSec: 3.2, // gate sets materialise at least this many seconds ahead
  spawnLeadMinDist: 60,
  timePressureRevealSec: 2.0,
  timePressureFadeStartSec: 1.2,
  timePressureFadeDurSec: 1.2,
  // complex sets
  complexFromMeters: 400, // yellow (complex) gates first appear here
  complexRampStartShare: 0.06, // share of sets at complexFromMeters
  complexFullMeters: 1500, // ramp reaches the full share here
  complexMinShare: 0.34, // full share once the ramp ends (>= 30 % required)
  splitZoneLength: 12,
  // combat
  combatEveryMin: 4,
  combatEveryMax: 7,
  combatMaxSec: 8,
  shotIntervalSec: 0.6,
  combatStopGap: 16, // army halts this far before the enemy group
  // scoring
  scoreDistMul: 1,
  scorePeakMul: 3,
  scoreKillMul: 5,
  metersPerCoin: 10,
  // lateral movement
  lateralMaxSpeed: 26,
  keyboardLateralSpeed: 18,
} as const;

export function speedAt(runSeconds: number): number {
  const steps = Math.floor(runSeconds / CFG.speedStepEverySec);
  return Math.min(CFG.maxSpeed, CFG.baseSpeed + steps * CFG.speedStep);
}

export function spacingAt(distance: number): number {
  return Math.max(CFG.spacingMin, CFG.spacingStart - distance * CFG.spacingDropPerMeter);
}

/** How far ahead (meters) a gate set must materialise so the player always has >= minReactionSec. */
export function spawnAheadDist(speed: number): number {
  return Math.max(CFG.spawnLeadMinDist, speed * CFG.spawnLeadSec);
}

/** Target share of complex (yellow) sets at a distance: ramps up slowly from complexFromMeters. */
export function complexShareAt(m: number): number {
  if (m < CFG.complexFromMeters) return 0;
  const t = Math.min(1, (m - CFG.complexFromMeters) / (CFG.complexFullMeters - CFG.complexFromMeters));
  return CFG.complexRampStartShare + (CFG.complexMinShare - CFG.complexRampStartShare) * t;
}
