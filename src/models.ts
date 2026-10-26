import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARTS } from './modelData';

/**
 * Character models are Kenney "Mini Dungeon" (CC0, https://kenney.nl), baked offline by tools/build_models.py into
 * static, vertex-coloured parts. A unit is the merge of a body plus optional weapon parts, drawn as one instance.
 */
const cache = new Map<string, THREE.BufferGeometry>();

function decode(b64: string): ArrayBuffer {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

function partGeometry(name: string): THREE.BufferGeometry {
  const d = PARTS[name];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(decode(d.pos)), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(decode(d.nor)), 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(decode(d.col)), 3, true));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(decode(d.idx)), 1));
  return g;
}

/** Merged geometry for e.g. ['human', 'sword'] (cached; do not dispose). */
export function unitGeometry(parts: string[]): THREE.BufferGeometry {
  const key = parts.join('+');
  let g = cache.get(key);
  if (!g) {
    g = mergeGeometries(parts.map(partGeometry), false)!;
    cache.set(key, g);
  }
  return g;
}
