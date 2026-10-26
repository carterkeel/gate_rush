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

/** Little boxes in the same encoding as the baked parts (Int8 normals, Uint8 colours). */
function boxPart(size: [number, number, number], pos: [number, number, number], rotZ: number, rgb: [number, number, number]): THREE.BufferGeometry {
  const b = new THREE.BoxGeometry(...size);
  b.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ), new THREE.Vector3(1, 1, 1)));
  const p = b.attributes.position;
  const n = b.attributes.normal;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.array), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(Array.from(n.array, (v) => Math.round(v * 127))), 3, true));
  const col = new Uint8Array(p.count * 3);
  for (let i = 0; i < p.count; i++) col.set([rgb[0], rgb[1], rgb[2]], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(b.index!.array), 1));
  return g;
}

/** An angry orc face: glowing eyes under slanted dark brows, plus two tusks. The orc head sits at y 0.84..1.17 and looks towards -z. */
function angryFace(): THREE.BufferGeometry[] {
  const FZ = -0.255;
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    out.push(boxPart([0.1, 0.055, 0.04], [sx * 0.09, 0.985, FZ], 0, [255, 214, 40])); // eye
    out.push(boxPart([0.17, 0.045, 0.06], [sx * 0.095, 1.055, FZ - 0.005], sx * 0.5, [40, 6, 6])); // brow, inner end lower
    out.push(boxPart([0.04, 0.09, 0.04], [sx * 0.075, 0.875, FZ], 0, [244, 240, 220])); // tusk
  }
  return out;
}

const faceCache = new Map<string, THREE.BufferGeometry>();
/** Like unitGeometry, with the angry orc face added (for enemies). */
export function angryUnitGeometry(parts: string[]): THREE.BufferGeometry {
  const key = parts.join('+');
  let g = faceCache.get(key);
  if (!g) {
    g = mergeGeometries([...parts.map(partGeometry), ...angryFace()], false)!;
    faceCache.set(key, g);
  }
  return g;
}
