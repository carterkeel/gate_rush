import * as THREE from 'three';
import { unitGeometry } from './models';

const MAX = 160;

/** Spinning Kenney coins laid out between gate sets. Collected when the crowd passes over them. */
export class CoinField {
  readonly mesh: THREE.InstancedMesh;
  private x = new Float32Array(MAX);
  private s = new Float32Array(MAX); // distance along the track
  private phase = new Float32Array(MAX);
  private gone = new Float32Array(MAX); // 0 = alive, 0..1 = collect animation, 1 = removed
  private pull = new Float32Array(MAX); // seconds a coin has been flying to the player (0 = not pulled)
  private oy = new Float32Array(MAX); // offset from the player while pulled (lateral, height)
  private ox = new Float32Array(MAX);
  private os = new Float32Array(MAX);
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x6b4a00 });
    this.mesh = new THREE.InstancedMesh(unitGeometry(['coin']), mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  private add(x: number, s: number): void {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.x[i] = x;
    this.s[i] = s;
    this.phase[i] = Math.random() * 6.28;
    this.gone[i] = 0;
    this.pull[i] = 0;
  }

  /** A row of coins in [from, to] that sweeps from xStart to xEnd (the best gate). Returns false if too short. */
  spawnRow(from: number, to: number, xStart: number, xEnd: number): boolean {
    const span = to - from;
    if (span < 5) return false;
    const n = Math.min(10, Math.max(4, Math.floor(span / 1.6)));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const e = t * t * (3 - 2 * t); // ease so the row settles into the gate lane
      this.add(Math.max(-4.1, Math.min(4.1, xStart + (xEnd - xStart) * e)), from + 0.5 + t * (span - 1));
    }
    return true;
  }

  /** Spin, animate and collect. Returns how many coins were picked up this frame (and where, for effects). */
  update(dt: number, time: number, playerS: number, armyX: number, radius: number, onPick: (x: number, s: number) => void, magnet = false): number {
    let picked = 0;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (magnet && this.gone[i] === 0 && this.pull[i] === 0 && this.s[i] > playerS - 3 && this.s[i] < playerS + 20) {
        // the magnet grabs it: remember where it is relative to the crowd and start the spiral
        this.pull[i] = 0.001;
        this.ox[i] = this.x[i] - armyX;
        this.oy[i] = 1.0;
        this.os[i] = this.s[i] - playerS;
      }
      if (this.pull[i] > 0 && this.gone[i] === 0) {
        const t = (this.pull[i] += dt);
        // spiral around the line to the crowd, tightening and speeding up (ease-in suction)
        const len = Math.hypot(this.ox[i], this.oy[i] - 1.0, this.os[i]);
        const sp = 4 + t * t * 70;
        const nl = Math.max(0, len - sp * dt);
        const k = len > 1e-4 ? nl / len : 0;
        const a = (7 + 10 * t) * dt;
        const cx = this.ox[i] * k;
        const cy = (this.oy[i] - 1.0) * k;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        this.ox[i] = cx * ca - cy * sa;
        this.oy[i] = 1.0 + cx * sa + cy * ca;
        this.os[i] *= k;
        if (nl < 0.6) {
          this.x[i] = armyX;
          this.s[i] = playerS;
          this.gone[i] = 0.001;
          picked++;
          onPick(armyX, playerS);
        } else {
          this.x[i] = armyX + this.ox[i];
          this.s[i] = playerS + this.os[i];
        }
      }
      if (this.pull[i] === 0 && this.gone[i] === 0 && playerS >= this.s[i] - 0.4 && playerS <= this.s[i] + 1.6 && Math.abs(this.x[i] - armyX) <= radius) {
        this.gone[i] = 0.001;
        picked++;
        onPick(this.x[i], this.s[i]);
      }
      if (this.gone[i] > 0) this.gone[i] = Math.min(1, this.gone[i] + dt * 5);
      // drop what is behind the player or finished
      if (this.gone[i] >= 1 || this.s[i] < playerS - 8) continue;
      if (w !== i) {
        this.x[w] = this.x[i];
        this.s[w] = this.s[i];
        this.phase[w] = this.phase[i];
        this.gone[w] = this.gone[i];
        this.pull[w] = this.pull[i];
        this.ox[w] = this.ox[i];
        this.oy[w] = this.oy[i];
        this.os[w] = this.os[i];
      }
      w++;
    }
    this.n = w;
    for (let i = 0; i < w; i++) {
      const g = this.gone[i];
      const pl = this.pull[i] > 0 && g === 0;
      const y = pl ? this.oy[i] : 1.0 + Math.sin(time * 3 + this.phase[i]) * 0.12 + g * 1.6;
      const k = 1 - g;
      this.p.set(this.x[i], y, -this.s[i]);
      this.q.setFromAxisAngle(this.up, time * 3.2 + this.phase[i] + g * 10 + this.pull[i] * 14);
      this.sc.setScalar(Math.max(0.01, k));
      this.m.compose(this.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    return picked;
  }
}
