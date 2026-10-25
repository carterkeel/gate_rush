import * as THREE from 'three';
import type { TrailDef } from './storage';

const MAXP = 900;

export class Fx {
  private pts: THREE.Points;
  private pos = new Float32Array(MAXP * 3);
  private col = new Float32Array(MAXP * 3);
  private vel = new Float32Array(MAXP * 3);
  private life = new Float32Array(MAXP);
  private maxLife = new Float32Array(MAXP);
  private head = 0;
  private c = new THREE.Color();
  shakeAmt = 0;
  trail: TrailDef = { id: 'plain', name: '', cost: 0, colors: [] };
  private hue = 0;

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private overlay: HTMLElement) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size: 0.34, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true });
    this.pts = new THREE.Points(g, m);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    for (let i = 0; i < MAXP; i++) this.pos[i * 3 + 1] = -999;
  }

  private colorFor(base: number): THREE.Color {
    const t = this.trail;
    if (t.rainbow) {
      this.hue = (this.hue + 0.07) % 1;
      return this.c.setHSL(this.hue, 1, 0.6);
    }
    if (t.colors.length) return this.c.setHex(t.colors[Math.floor(Math.random() * t.colors.length)]);
    return this.c.setHex(base);
  }

  burst(at: THREE.Vector3, baseColor: number, count: number, power: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.head;
      this.head = (this.head + 1) % MAXP;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      const sp = power * (0.35 + u);
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 1.5;
      this.pos[i * 3 + 1] = at.y + Math.random() * 1.5;
      this.pos[i * 3 + 2] = at.z;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = 2 + Math.random() * power * 0.9;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      const c = this.colorFor(baseColor);
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.maxLife[i] = this.life[i] = 0.6 + Math.random() * 0.6;
    }
  }

  /** A short ribbon of particles dragged behind the army after a gate (cosmetic trail). */
  trailPuff(at: THREE.Vector3, baseColor: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.head;
      this.head = (this.head + 1) % MAXP;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 6;
      this.pos[i * 3 + 1] = 0.3 + Math.random() * 1.6;
      this.pos[i * 3 + 2] = at.z + Math.random() * 4;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.8;
      this.vel[i * 3 + 1] = 0.5 + Math.random();
      this.vel[i * 3 + 2] = 2 + Math.random() * 2;
      const c = this.colorFor(baseColor);
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.maxLife[i] = this.life[i] = 0.5 + Math.random() * 0.5;
    }
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, amount));
  }

  /** Floating "+47!" style text, projected from a world position to the screen. */
  popup(world: THREE.Vector3, text: string, cls: string): void {
    const v = world.clone().project(this.camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.textContent = text;
    el.style.left = `${((v.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - v.y) / 2) * 100}%`;
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  update(dt: number): void {
    for (let i = 0; i < MAXP; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= 11 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) {
        this.pos[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] *= -0.3;
      }
      const f = this.life[i] / this.maxLife[i];
      // fade by darkening (additive blending)
      const k = Math.min(1, f * 1.6);
      this.col[i * 3] *= 1 - dt * 1.2 * (1 - k);
      this.col[i * 3 + 1] *= 1 - dt * 1.2 * (1 - k);
      this.col[i * 3 + 2] *= 1 - dt * 1.2 * (1 - k);
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pts.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.6);
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < MAXP; i++) this.pos[i * 3 + 1] = -999;
    this.overlay.innerHTML = '';
    this.shakeAmt = 0;
  }
}
