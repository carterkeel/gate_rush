// Runs inside headless Chromium (see tools/bake.py): loads Kenney GLBs, poses them and returns baked static geometry.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const w = window as any;
const loader = new GLTFLoader();

async function load(b64: string): Promise<any> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Promise((res, rej) => loader.parse(bin.buffer, '', res, rej));
}

/** Pose a character at animation `clip` time `t` and return world-space vertices of every mesh. */
w.pose = async (b64: string, clip: string, t: number) => {
  const gltf = await load(b64);
  const root = gltf.scene as THREE.Object3D;
  const mixer = new THREE.AnimationMixer(root);
  const a = gltf.animations.find((x: THREE.AnimationClip) => x.name === clip);
  if (a) {
    mixer.clipAction(a).play();
    mixer.setTime(t);
  }
  root.updateMatrixWorld(true);
  const nodes: Record<string, number[]> = {};
  root.traverse((o) => {
    const p = new THREE.Vector3();
    o.getWorldPosition(p);
    nodes[o.name] = [p.x, p.y, p.z];
  });
  const meshes: any[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!(m as any).isMesh) return;
    const g = m.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    const out = new Float32Array(pos.count * 3);
    const outN = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    nm.getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      if ((m as any).isSkinnedMesh) {
        m.getVertexPosition(i, v);
        // skinned positions come out in mesh space; bring to world
        v.applyMatrix4(m.matrixWorld);
      } else {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      }
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      out.set([v.x, v.y, v.z], i * 3);
      outN.set([n.x, n.y, n.z], i * 3);
    }
    meshes.push({
      name: m.name,
      pos: Array.from(out),
      nor: Array.from(outN),
      uv: Array.from(uv.array as Float32Array),
      idx: Array.from(g.index!.array as Uint16Array),
    });
  });
  return { meshes, nodes, clips: gltf.animations.map((x: THREE.AnimationClip) => [x.name, x.duration]) };
};
