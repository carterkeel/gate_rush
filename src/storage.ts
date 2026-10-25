// Persistent progress: coins, owned/equipped cosmetics, high scores, tutorial flag. localStorage, fail-safe.
export interface ScoreEntry {
  score: number;
  distance: number;
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
}

export interface SkinDef {
  id: string;
  name: string;
  cost: number;
  body: number;
  accent: number;
}
export interface TrailDef {
  id: string;
  name: string;
  cost: number;
  colors: number[]; // particle palette; empty = use the gate colour
  rainbow?: boolean;
}

export const SKINS: SkinDef[] = [
  { id: 'trooper', name: 'Trooper', cost: 0, body: 0x4fc3f7, accent: 0x0d47a1 },
  { id: 'crimson', name: 'Crimson Guard', cost: 120, body: 0xff6b6b, accent: 0x7f0000 },
  { id: 'toxic', name: 'Toxic Squad', cost: 300, body: 0xb2ff59, accent: 0x33691e },
  { id: 'gold', name: 'Gold Legion', cost: 700, body: 0xffd54f, accent: 0xff6f00 },
  { id: 'violet', name: 'Void Walkers', cost: 1200, body: 0xb388ff, accent: 0x311b92 },
  { id: 'ghost', name: 'Ghost Unit', cost: 2500, body: 0xeceff1, accent: 0x455a64 },
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
});

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS();
    return { ...DEFAULTS(), ...(JSON.parse(raw) as Partial<SaveData>) };
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
