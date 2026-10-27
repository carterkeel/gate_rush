// Composes an in-engine app-icon scene: forest, crowd, golden leader and two gates (x4 / ÷2). Output is an opaque PNG.
import * as THREE from 'three';
import { World } from '../src/world';
import { Army } from '../src/army';
import { SetView } from '../src/gateView';
import { opE } from '../src/logic';
import { SKINS } from '../src/storage';
const w = window as any;

w.renderIcon = (opts: { size: number; camY: number; camBack: number; lookY: number; lookAhead: number; gateAhead: number; army: number; fov: number; s: number }): string => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const world = new World(canvas);
  world.renderer.setPixelRatio(1);
  world.resize(opts.size, opts.size);
  world.camera.fov = opts.fov;
  world.camera.updateProjectionMatrix();
  const S = opts.s;
  world.reset(S);
  for (let i = 0; i < 120; i++) world.update(S, i * 0.05, 0.05);
  const army = new Army(world.scene);
  army.setSkin(SKINS[0]);
  army.setCount(opts.army);
  army.mesh.position.set(0, 0, -S);
  for (let i = 0; i < 80; i++) army.update(0.05, i * 0.05, 1, false);
  const mkSet = (x0: number, x1: number, kind: 'mul' | 'div', n: number) =>
    new SetView({ type: 'gates', id: 1, kind: 'simple', complex: false, s: S + opts.gateAhead, split: false, revealLead: 0, category: 'art', gates: [{ effect: opE({ kind, n } as any), x0, x1 }] } as any);
  for (const v of [mkSet(-5.2, 0, 'mul', 4), mkSet(0, 5.2, 'div', 2)]) {
    v.update(2, 0, 1);
    world.scene.add(v.root);
  }
  const cam = world.camera;
  cam.position.set(0, opts.camY, -S + opts.camBack);
  cam.lookAt(0, opts.lookY, -S - opts.lookAhead);
  world.renderer.render(world.scene, cam);
  return canvas.toDataURL('image/png');
};
