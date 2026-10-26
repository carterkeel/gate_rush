// Persistent progress: coins, owned/equipped cosmetics, high scores, tutorial flag. localStorage, fail-safe.
export interface ScoreEntry {
  score: number;
  distance: number; // metres run this round (not counting a head start)
  peak: number;
  kills: number;
  date: number;
}
export interface SaveData {
  coins: number;
  ownedSkins: string[];
  ownedTrails: string[];
  skin: string;
  trail: string;
  scores: ScoreEntry[];
  tutorialDone: boolean;
  speedUnlocked: boolean; // 2x speed button
  startLevel: number; // head-start upgrade level, 0..START_MAX_LEVEL
  startOn: boolean; // use the head start on the next run
}

export interface SkinDef {
  id: string;
  name: string;
  cost: number;
  body: number; // swatch colours in the skins menu
  accent: number;
  model: 'human' | 'orc';
  weapon: 'sword' | 'spear';
  shield?: boolean;
  tint: number; // multiplied with the model's own colours (0xffffff = natural)
}
export interface TrailDef {
  id: string;
  name: string;
  cost: number;
  colors: number[]; // particle palette; empty = use the gate colour
  rainbow?: boolean;
}

export const SKINS: SkinDef[] = [
  { id: 'trooper', name: 'Footman', cost: 0, body: 0x4fa3ff, accent: 0x6b7a99, model: 'human', weapon: 'sword', tint: 0x4fa3ff },
  { id: 'crimson', name: 'Crimson Guard', cost: 120, body: 0xff6b6b, accent: 0x7f0000, model: 'human', weapon: 'spear', tint: 0xff4d4d },
  { id: 'toxic', name: 'Orc Warband', cost: 300, body: 0x4caf6a, accent: 0x33691e, model: 'orc', weapon: 'sword', tint: 0xffffff },
  { id: 'gold', name: 'Gold Legion', cost: 700, body: 0xffd54f, accent: 0xff6f00, model: 'human', weapon: 'sword', shield: true, tint: 0xffc83a },
  { id: 'violet', name: 'Void Walkers', cost: 1200, body: 0xb388ff, accent: 0x311b92, model: 'orc', weapon: 'spear', tint: 0xb48cff },
  { id: 'ghost', name: 'Ghost Unit', cost: 2500, body: 0xeceff1, accent: 0x455a64, model: 'human', weapon: 'spear', shield: true, tint: 0xe4f1ff },
];

export const TRAILS: TrailDef[] = [
  { id: 'plain', name: 'Gate Glow', cost: 0, colors: [] },
  { id: 'sparks', name: 'Gold Sparks', cost: 150, colors: [0xffe082, 0xffca28, 0xffffff] },
  { id: 'ice', name: 'Frost Wake', cost: 400, colors: [0xb3e5fc, 0x4fc3f7, 0xffffff] },
  { id: 'fire', name: 'Inferno', cost: 900, colors: [0xff7043, 0xffab00, 0xff1744] },
  { id: 'rainbow', name: 'Prism', cost: 1800, colors: [], rainbow: true },
];

const KEY = 'gate-rush-save-v1';

const DEFAULTS = (): SaveData => ({
  coins: 0,
  ownedSkins: ['trooper'],
  ownedTrails: ['plain'],
  skin: 'trooper',
  trail: 'plain',
  scores: [],
  tutorialDone: false,
  speedUnlocked: false,
  startLevel: 0,
  startOn: false,
});

// ---- upgrades -----------------------------------------------------------------------------------------------
export const SPEED_COST = 1000;
export const START_MAX_LEVEL = 15;
/** Head-start distance at an upgrade level: 100 m at level 1, +50 m per level, 800 m at level 15. */
export function startMeters(level: number): number {
  return level <= 0 ? 0 : 100 + 50 * (Math.min(level, START_MAX_LEVEL) - 1);
}
/** Coins to buy upgrade `level` (1..15): 100 for the first, growing ~30 % per level (about 3.9K for the last). */
export function startCost(level: number): number {
  return Math.round((100 * Math.pow(1.3, level - 1)) / 10) * 10;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);

/** Old or damaged saves: keep every number finite (huge peaks survive: JSON writes 1e150 as 1e+150). */
export function sanitizeSave(d: SaveData): SaveData {
  d.coins = Math.floor(num(d.coins));
  d.scores = (Array.isArray(d.scores) ? d.scores : []).map((s) => ({
    score: num(s.score),
    distance: num(s.distance),
    peak: num(s.peak),
    kills: num(s.kills),
    date: num(s.date),
  }));
  return d;
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS();
    return sanitizeSave({ ...DEFAULTS(), ...(JSON.parse(raw) as Partial<SaveData>) });
  } catch {
    return DEFAULTS();
  }
}

export function save(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: progress simply is not persisted */
  }
}

export function addScore(d: SaveData, e: ScoreEntry): boolean {
  const best = d.scores.length ? d.scores[0].score : 0;
  d.scores.push(e);
  d.scores.sort((a, b) => b.score - a.score);
  d.scores = d.scores.slice(0, 10);
  return e.score > best;
}
