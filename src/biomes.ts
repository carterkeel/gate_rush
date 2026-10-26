import * as THREE from 'three';

export const BIOME_LEN = 600; // meters per biome
export const BIOME_BLEND = 90; // meters over which one biome melts into the next

export interface Palette {
  bg: THREE.Color; // sky + fog
  ground: THREE.Color; // tint on the path texture
  side: THREE.Color; // terrain beside the path
  rail: THREE.Color; // glowing path edges
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sun: THREE.Color;
  particle: THREE.Color;
}

const c = (n: number) => new THREE.Color(n);
const pal = (bg: number, ground: number, side: number, rail: number, hs: number, hg: number, sun: number, particle: number): Palette => ({
  bg: c(bg),
  ground: c(ground),
  side: c(side),
  rail: c(rail),
  hemiSky: c(hs),
  hemiGround: c(hg),
  sun: c(sun),
  particle: c(particle),
});

export const BIOMES: { name: string; pal: Palette }[] = [
  { name: 'NEO CITY', pal: pal(0x0a0f1c, 0x1c2745, 0x0d1424, 0x38d6ff, 0xbcd2ff, 0x1a2036, 0xffffff, 0x57e6ff) },
  { name: 'WHISPERING FOREST', pal: pal(0x0c1f17, 0x4a3b2a, 0x14301c, 0xb6ff5c, 0xd2f0c0, 0x1c2e1a, 0xffe9b0, 0xe4ff7a) },
  { name: 'LAVA FIELDS', pal: pal(0x1d0c09, 0x3a2b31, 0x1a0e0e, 0xff6a1a, 0xffc9a0, 0x2c1210, 0xffa060, 0xff7a2a) },
  { name: 'CLOUD KINGDOM', pal: pal(0x78b9ff, 0xd5dcf0, 0x9cccff, 0xffffff, 0xffffff, 0x9ec4ff, 0xfff2c8, 0xffffff) },
  { name: 'SUNKEN REEF', pal: pal(0x0a5578, 0x3a8fae, 0x126682, 0x5cffd9, 0xa6ecff, 0x145064, 0xbff6ff, 0xd6fbff) },
];

export const biomeIndex = (d: number): number => Math.floor(Math.max(0, d) / BIOME_LEN) % BIOMES.length;

const smooth = (t: number) => {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
};

/** Weights of every biome at distance d (they only overlap inside a blend zone). */
export function biomeWeights(d: number, out: number[] = []): number[] {
  const idx = Math.floor(Math.max(0, d) / BIOME_LEN);
  const cur = idx % BIOMES.length;
  const nxt = (idx + 1) % BIOMES.length;
  const t = smooth((d - ((idx + 1) * BIOME_LEN - BIOME_BLEND)) / BIOME_BLEND);
  for (let i = 0; i < BIOMES.length; i++) out[i] = 0;
  out[cur] += 1 - t;
  out[nxt] += t;
  return out;
}

export function paletteAt(d: number, out: Palette): void {
  const idx = Math.floor(Math.max(0, d) / BIOME_LEN);
  const a = BIOMES[idx % BIOMES.length].pal;
  const b = BIOMES[(idx + 1) % BIOMES.length].pal;
  const t = smooth((d - ((idx + 1) * BIOME_LEN - BIOME_BLEND)) / BIOME_BLEND);
  (Object.keys(out) as (keyof Palette)[]).forEach((k) => out[k].copy(a[k]).lerp(b[k], t));
}

export const emptyPalette = (): Palette => pal(0, 0, 0, 0, 0, 0, 0, 0);
