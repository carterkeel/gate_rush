// Renders blocky voxel skulls (own design, public domain) to transparent PNG data URIs for the HUD route bar.
import * as THREE from 'three';
import { unitGeometry } from '../src/models';
const w = window as any;
/** Top-down gold leader (the player marker on the route bar). */
w.renderPlayer = (): string => {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(S, S, false);
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x887744, 1.7));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(-2, 6, 3);
  scene.add(dl);
  const m = new THREE.Mesh(unitGeometry(['human', 'sword']), new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffc83a }));
  scene.add(m);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 40), new THREE.MeshBasicMaterial({ color: 0xffe27a, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(-0.07, 0.02, -0.08);
  scene.add(ring);
  const cam = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 20);
  cam.position.set(-0.07, 8, -0.08);
  cam.up.set(0, 0, -1);
  cam.lookAt(-0.07, 0, -0.08);
  r.render(scene, cam);
  return canvas.toDataURL('image/png');
};
