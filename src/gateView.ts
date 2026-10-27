import * as THREE from 'three';
import { CFG } from './config';
import { effectLines, effectTone } from './logic';
import type { Tone } from './logic';
import type { Bonus, GateSet } from './types';

export const BONUS_COLOR = { coins: 0xff9f1a, instakill: 0xa56bff, double: 0xff4f9a } as const;
export function bonusLines(b: Bonus): string[] {
  if (b.kind === 'coins') return [`+${b.amount}`, 'GOLD'];
  if (b.kind === 'instakill') return ['⚡', 'KILL'];
  if (b.kind === 'double') return ['×2', 'ARMY'];
  return ['', ''];
}

export const TONE_COLOR: Record<Tone, number> = { green: 0x1fe06c, red: 0xff3d4d, yellow: 0xffc21a };
export const FACE_H = 3.9;
export const FACE_BOTTOM = 0.5;
const PX_PER_UNIT = 110;

function drawGateText(lines: string[], wPx: number, hPx: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(64, Math.round(wPx));
  c.height = Math.max(64, Math.round(hPx));
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const family = "Impact, 'Arial Black', 'Helvetica Neue', system-ui, sans-serif";
  const sizes: number[] = [];
  const big = lines[0];
  const bigPx = Math.min(c.height * (lines.length === 1 ? 0.64 : 0.36), (c.width * 0.8) / (Math.max(2, big.length) * 0.58));
  sizes.push(bigPx);
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i];
    sizes.push(Math.min(bigPx * 0.5, (c.width * 0.9) / (Math.max(3, t.length) * 0.56)));
  }
  const total = sizes.reduce((a, b) => a + b * 1.12, 0);
  let y = (c.height - total) / 2;
  for (let i = 0; i < lines.length; i++) {
    const px = sizes[i];
    y += (px * 1.12) / 2;
    g.font = `900 ${px}px ${family}`;
    g.lineWidth = Math.max(5, px * 0.2);
    g.strokeStyle = '#05070d';
    g.strokeText(lines[i], c.width / 2, y);
    g.fillStyle = i === 0 ? '#ffffff' : '#fff6cf';
    g.fillText(lines[i], c.width / 2, y);
    y += (px * 1.12) / 2;
  }
  return c;
}

interface GateObj {
  group: THREE.Group;
  face: THREE.Mesh;
  label: THREE.Mesh;
  frame: THREE.Mesh[];
  mats: THREE.Material[];
  tex: THREE.Texture;
  baseHalf: number;
  cx: number;
  fade?: 'shrink' | 'fade';
  bar?: THREE.Mesh;
  bonus?: boolean;
}

export class SetView {
  readonly root = new THREE.Group();
  gates: GateObj[] = [];
  extras: THREE.Object3D[] = [];
  revealed: boolean;
  revealTime = 0;
  elapsed = 0;
  opacity = 0;

  constructor(readonly set: GateSet) {
    this.revealed = set.revealLead <= 0;
    this.root.position.set(0, 0, -set.s);
    this.root.visible = this.revealed;
    this.build();
  }

  private build(): void {
    const set = this.set;
    set.gates.forEach((def) => {
      const tone = effectTone(def.effect);
      const color = def.bonus ? BONUS_COLOR[def.bonus.kind] : TONE_COLOR[tone];
      // leave a clear gap between neighbouring gates (frames are 0.2 wide) so their edges never overlap or z-fight
      const w = def.x1 - def.x0 - 0.46;
      const cx = (def.x0 + def.x1) / 2;
      const group = new THREE.Group();
      group.position.set(cx, 0, 0.012 * (this.gates.length % 2));
      const mats: THREE.Material[] = [];

      const faceMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, FACE_H), faceMat);
      face.position.y = FACE_BOTTOM + FACE_H / 2;
      group.add(face);
      mats.push(faceMat);

      const frameMat = new THREE.MeshBasicMaterial({ color, transparent: true, fog: false });
      mats.push(frameMat);
      const t = 0.2;
      const frame: THREE.Mesh[] = [];
      const addBar = (bw: number, bh: number, x: number, y: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.26), frameMat);
        m.position.set(x, y, 0);
        group.add(m);
        frame.push(m);
      };
      addBar(t, FACE_H + t, -w / 2, FACE_BOTTOM + FACE_H / 2);
      addBar(t, FACE_H + t, w / 2, FACE_BOTTOM + FACE_H / 2);
      addBar(w + t, t, 0, FACE_BOTTOM + FACE_H);
      addBar(w + t, t, 0, FACE_BOTTOM);

      const canvas = drawGateText(def.bonus ? bonusLines(def.bonus) : effectLines(def.effect), w * PX_PER_UNIT, FACE_H * PX_PER_UNIT);
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = 4;
      tex.colorSpace = THREE.SRGBColorSpace;
      const labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
      mats.push(labelMat);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(w, FACE_H), labelMat);
      label.position.set(0, FACE_BOTTOM + FACE_H / 2, 0.05);
      group.add(label);

      const obj: GateObj = { group, face, label, frame, mats, tex, baseHalf: (def.x1 - def.x0) / 2, cx, fade: def.fade, bonus: !!def.bonus };
      if (def.fade) {
        const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false });
        mats.push(barMat);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, 0.3), barMat);
        bar.position.set(0, FACE_BOTTOM + FACE_H + 0.45, 0);
        group.add(bar);
        obj.bar = bar;
      }
      this.root.add(group);
      this.gates.push(obj);
    });

    if (set.split) this.buildSplitZone();
  }

  private buildSplitZone(): void {
    const L = CFG.splitZoneLength;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.9, fog: false });
    const div = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.1, L), mat);
    div.position.set(0, 0.55, 0);
    const lanes = new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.1, depthWrite: false, fog: false });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CFG.pathWidth, L), lanes);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.03, 0);
    this.root.add(div, floor);
    this.extras.push(div, floor);
  }

  /** Current active x-range of gate i in world space, or null when it has vanished. */
  range(i: number): { x0: number; x1: number } | null {
    const def = this.set.gates[i];
    const g = this.gates[i];
    if (!g.fade) return { x0: def.x0, x1: def.x1 };
    // the gate narrows (never fully closes) so the army centre must be under the shrinking frame at the plane
    const p = this.fadeProgress(g);
    const half = g.baseHalf * (1 - 0.8 * p);
    return { x0: g.cx - half, x1: g.cx + half };
  }

  private fadeProgress(g: GateObj): number {
    if (!this.revealed) return 0;
    return Math.min(1, Math.max(0, (this.elapsed - CFG.timePressureFadeStartSec) / CFG.timePressureFadeDurSec));
  }

  reveal(): void {
    this.revealed = true;
    this.root.visible = true;
    this.elapsed = 0;
  }

  update(dt: number, camDist: number, time: number): void {
    // fade in as the set enters the world, so spawning never pops
    this.opacity = Math.min(1, this.opacity + dt * 3.5);
    if (this.revealed) this.elapsed += dt;
    const pop = this.set.revealLead > 0 ? Math.min(1, this.elapsed / 0.25) : 1;
    for (const g of this.gates) {
      let sx = 1;
      let op = this.opacity;
      if (g.fade) {
        const p = this.fadeProgress(g);
        sx = 1 - 0.8 * p;
        if (g.fade === 'fade') op *= 1 - 0.55 * p;
        if (g.bar) {
          const before = Math.max(0, 1 - this.elapsed / CFG.timePressureFadeStartSec);
          g.bar.scale.x = Math.max(0.001, before);
          const flash = this.elapsed > CFG.timePressureFadeStartSec ? 0.5 + 0.5 * Math.sin(time * 30) : 1;
          (g.bar.material as THREE.MeshBasicMaterial).color.setHex(before > 0.35 ? 0xffffff : 0xff4a4a);
          (g.bar.material as THREE.MeshBasicMaterial).opacity = op * flash;
        }
      }
      g.group.scale.set(sx * pop, pop, 1);
      for (const m of g.mats) {
        if (m === g.mats[0]) (m as THREE.MeshBasicMaterial).opacity = (g.bonus ? 0.3 + 0.16 * Math.sin(time * 4.5) : 0.24) * op;
        else if (m !== g.bar?.material) (m as THREE.MeshBasicMaterial).opacity = op;
      }
    }
    void camDist;
  }

  dispose(): void {
    for (const g of this.gates) {
      g.tex.dispose();
      g.mats.forEach((m) => m.dispose());
      g.face.geometry.dispose();
      g.label.geometry.dispose();
      g.frame.forEach((f) => f.geometry.dispose());
      g.bar?.geometry.dispose();
    }
    for (const e of this.extras) {
      const m = e as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
}
