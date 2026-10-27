// Renders single gates and the golden leader (from behind) to transparent PNG data URIs, for icon / art work.
import * as THREE from 'three';
import { unitGeometry } from '../src/models';
import { SetView } from '../src/gateView';
import { opE } from '../src/logic';
import type { GateSet } from '../src/types';
const w = window as any;

function mk(W: number, H: number) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x000000, 0);
  return { canvas, r };
}

/** One gate, straight on. op: ['mul', 4] or ['div', 2]. */
w.renderGate = (kind: string, n: number): string => {
  const W = 900, H = 1200;
  const { canvas, r } = mk(W, H);
  const scene = new THREE.Scene();
  const set: GateSet = {
    type: 'gates', id: 1, kind: 'simple', complex: false, s: 0, split: false, revealLead: 0, category: 'art',
    gates: [{ effect: opE({ kind, n } as any), x0: -2.4, x1: 2.4 }],
  } as any;
  const v = new SetView(set);
  v.update(2, 0, 1);
  scene.add(v.root);
  const cam = new THREE.PerspectiveCamera(20, W / H, 0.1, 100);
  cam.position.set(0, 2.45, 20);
  cam.lookAt(0, 2.45, 0);
  r.render(scene, cam);
  return canvas.toDataURL('image/png');
};

/** The golden leader seen from behind (the way the player sees it in a run). */
w.renderPlayer = (): string => {
  const S = 1024;
  const { canvas, r } = mk(S, S);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x887744, 1.9));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4);
  dl.position.set(-3, 6, 6);
  scene.add(dl);
  const m = new THREE.Mesh(unitGeometry(['human', 'sword']), new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffd23f, emissive: 0x5a3c00 }));
  scene.add(m);
  const box = new THREE.Box3().setFromObject(m);
  const c = box.getCenter(new THREE.Vector3());
  const h = box.max.y - box.min.y;
  const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
  cam.position.set(c.x + h * 0.55, c.y + h * 0.35, c.z + h * 3.1);
  cam.lookAt(c.x, c.y, c.z);
  r.render(scene, cam);
  return canvas.toDataURL('image/png');
};
