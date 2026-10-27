import * as THREE from 'three';
import { CFG } from './config';
import { armyTier, clampArmy } from './logic';
import { unitGeometry } from './models';
import type { SkinDef } from './storage';

export interface SplitState {
  left: number; // units sent into the left lane
  right: number;
}

const MAXI = CFG.visualCap + 8;

/** Cheap integer hash in [0,1): decorrelated from the sunflower pattern (a multiplicative hash makes blobs). */
function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const GOLD = new THREE.Color(0xffd23f);
const AURA_COLORS = [0x4fa3ff, 0x4fa3ff, 0x4fa3ff, 0x39d2ff, 0xb06bff, 0xff7bd5, 0xffd23f];

export class Army {
  readonly mesh: THREE.InstancedMesh;
  /** Higher ranks that replace part of the crowd as the number climbs: knights, then golden colossi. Same instance budget. */
  private rank: THREE.InstancedMesh[] = [];
  private aura: THREE.Mesh;
  private auraRing: THREE.Mesh;
  private pulseT = 0;
  tier = 0;
  count: number = CFG.startArmy; // exact integer
  x = 0; // anchor (crowd centre) x
  private curX = new Float32Array(MAXI);
  private curZ = new Float32Array(MAXI); // offset along path, + = behind the anchor
  private phase = new Float32Array(MAXI);
  private inst = 0;
  private k = 1; // units represented per instance (elite collapse)
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private tmpC = new THREE.Color();
  split: SplitState | null = null;
  private splitInst: { l: number; r: number } | null = null;
  vx = 0; // lateral velocity, for leaning
  depth = 1; // current crowd depth along the path, for camera framing
  private skinTint = new THREE.Color(0xffffff);
  private skinParts: string[] = ['human', 'sword'];
  private dirty = true;
  /** The player: one big golden unit at the crowd centre, so it is always clear which gate you walked through. */
  private leader: THREE.Mesh;
  private leaderRing: THREE.Mesh;
  private leaderX = 0;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(unitGeometry(this.skinParts), mat, MAXI);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.leader = new THREE.Mesh(unitGeometry(this.skinParts), new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffd23f, emissive: 0x5a3c00 }));
    this.leader.frustumCulled = false;
    this.leader.renderOrder = 2;
    this.leaderRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.leaderRing.rotation.x = -Math.PI / 2;
    this.leaderRing.position.y = 0.06;
    this.mesh.add(this.leader, this.leaderRing);
    // rank meshes (knights, colossi), each with its own look; instances are split between the three by tier
    for (let r = 0; r < 2; r++) {
      const m = new THREE.InstancedMesh(unitGeometry(this.skinParts), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: r === 0 ? 0x1a1405 : 0x4a3500 }), MAXI);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      this.mesh.add(m);
      this.rank.push(m);
    }
    // the aura under a big crowd: colour and strength follow the tier
    this.aura = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x4fa3ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.04;
    this.auraRing = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 56), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
    this.auraRing.rotation.x = -Math.PI / 2;
    this.auraRing.position.y = 0.05;
    this.mesh.add(this.aura, this.auraRing);
    for (let i = 0; i < MAXI; i++) this.phase[i] = Math.random() * Math.PI * 2;
  }

  setSkin(skin: SkinDef): void {
    this.skinParts = [skin.model, skin.weapon, ...(skin.shield ? ['shield'] : [])];
    const g = unitGeometry(this.skinParts);
    this.mesh.geometry = g;
    this.leader.geometry = g;
    this.rank[0].geometry = unitGeometry([skin.model, skin.weapon, 'shield']);
    this.rank[1].geometry = unitGeometry([skin.model === 'human' ? 'orc' : 'human', 'spear', 'shield']);
    this.skinTint.set(skin.tint);
    this.dirty = true;
  }

  reset(): void {
    this.count = CFG.startArmy;
    this.x = 0;
    this.leaderX = 0;
    this.split = null;
    this.splitInst = null;
    this.curX.fill(0);
    this.curZ.fill(0);
    this.inst = 0;
    this.dirty = true;
  }

  /** Ring pulse through the aura (called when the army reaches a new tier). */
  pulse(): void {
    this.pulseT = 1;
  }

  setCount(n: number): void {
    this.count = clampArmy(n);
  }

  get unitsPerInstance(): number {
    return this.k;
  }

  /** Units represented by instance i (the last instance carries the remainder). */
  private unitsOf(i: number, total: number, k: number): number {
    return Math.min(k, total - i * k);
  }

  // ------------------------------------------------------------------ formation
  private spacing(n: number): number {
    return Math.max(0.22, 0.52 - 0.04 * Math.log2(Math.max(1, n)));
  }

  /**
   * Slot i of an n-instance crowd: a round sunflower (golden-angle) pattern centred on (cx, 0), with the player's
   * golden unit in the middle. When the circle would be wider than the lane it is squeezed into an ellipse that is
   * longer along the path, keeping the same area. Offsets are relative to the crowd centre (+z = behind).
   */
  private slot(i: number, n: number, cx: number, halfW: number, out: { x: number; z: number }): void {
    const s = this.spacing(n);
    const c = (s * 1.3) / 1.7; // 1.3 = extra breathing room between troops
    const R = c * Math.sqrt(n + 1.5);
    const maxHalf = Math.max(0.8, halfW - 0.1);
    const sx = R > maxHalf ? maxHalf / R : 1;
    const r = c * Math.sqrt(i + 1.5);
    const a = i * 2.399963229728653;
    out.x = cx + Math.cos(a) * r * sx;
    out.z = (Math.sin(a) * r) / sx;
  }

  /** Called when the crowd reaches the start of a split zone. Sorts units left/right by x and returns exact counts. */
  enterSplit(): SplitState {
    const k = this.k;
    const n = this.inst;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => this.curX[a] - this.curX[b]);
    const nx = new Float32Array(MAXI);
    const nz = new Float32Array(MAXI);
    const np = new Float32Array(MAXI);
    let leftUnits = 0;
    let leftInst = 0;
    for (let j = 0; j < n; j++) {
      const i = idx[j];
      nx[j] = this.curX[i];
      nz[j] = this.curZ[i];
      np[j] = this.phase[i];
      if (this.curX[i] < 0) {
        leftUnits += this.unitsOf(i, this.count, k);
        leftInst++;
      }
    }
    // The last instance (partial remainder) sorts anywhere; recompute exactly so L + R == count.
    leftUnits = Math.min(leftUnits, this.count);
    this.curX.set(nx);
    this.curZ.set(nz);
    this.phase.set(np);
    this.split = { left: leftUnits, right: this.count - leftUnits };
    this.splitInst = { l: leftInst, r: n - leftInst };
    return { ...this.split };
  }

  /** Apply the lane gate results and keep the lanes separated until exitSplit. */
  setSplitCounts(left: number, right: number): void {
    this.split = { left, right };
    this.count = clampArmy(left + right);
  }

  exitSplit(): void {
    this.split = null;
    this.splitInst = null;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number, time: number, speed: number, running: boolean): void {
    const total = this.count;
    const k = Math.max(1, Math.ceil(total / CFG.visualCap));
    this.k = k;
    let n = Math.ceil(total / k);
    if (n > CFG.visualCap) n = CFG.visualCap;
    const prev = this.inst;

    // when units appear, spawn them at the crowd centre so they visibly pour out
    for (let i = prev; i < n; i++) {
      this.curX[i] = this.x + (Math.random() - 0.5) * 0.4;
      this.curZ[i] = 0;
    }
    this.inst = n;

    const pos = { x: 0, z: 0 };
    const sc = this.tmpS;
    const lerp = 1 - Math.exp(-dt * 9);
    const sp = this.spacing(n);
    let unitScale = Math.min(1, Math.max(0.45, sp * 1.7));
    const elite = k > 1 ? Math.min(2.4, 1 + 0.32 * Math.log2(k)) : 1;
    unitScale *= elite * 0.74;
    let maxZ = 0;

    // lane layout in split mode: left instances first, then right instances
    let lInst = n;
    let lCount = 0;
    let rCount = 0;
    if (this.split) {
      lCount = Math.ceil(this.split.left / k);
      rCount = Math.ceil(this.split.right / k);
      lInst = lCount;
      // never exceed the instance budget
      if (lCount + rCount > n) lInst = Math.min(lCount, n);
    }

    for (let i = 0; i < n; i++) {
      let tx: number;
      let tz: number;
      if (this.split && this.splitInst) {
        const left = i < lInst;
        const idx = left ? i : i - lInst;
        const cnt = left ? lCount : Math.max(0, n - lInst);
        const cx = left ? -2.6 : 2.6;
        this.slot(idx, Math.max(1, cnt), cx, 1.9, pos);
        tx = pos.x;
        tz = pos.z;
      } else {
        this.slot(i, n, this.x, CFG.halfWidth - 0.3, pos);
        tx = pos.x;
        tz = pos.z;
      }
      this.curX[i] += (tx - this.curX[i]) * lerp;
      this.curZ[i] += (tz - this.curZ[i]) * lerp;
      if (Math.abs(tz) > maxZ) maxZ = Math.abs(tz);
    }
    this.depth = maxZ * 2;

    // write instance matrices
    const bobAmp = running ? 0.1 : 0.02;
    const freq = 9 + speed * 0.35;
    const lean = Math.max(-0.35, Math.min(0.35, -this.vx * 0.02));
    // tier look: from millions up, a growing share of the crowd becomes knights; from quintillions, golden colossi
    const g = armyTier(total);
    this.tier = g;
    const colossus = g >= 5 ? Math.min(0.3, (g - 4) * 0.05) : 0;
    const knights = g >= 2 ? Math.min(0.55, (g - 1) * 0.1) : 0;
    const cnt = [0, 0, 0];
    const meshes = [this.mesh, this.rank[0], this.rank[1]];
    const SCALE = [1, 1.3, 1.85];
    for (let i = 0; i < n; i++) {
      const ph = this.phase[i];
      const r = hash01(i + 911);
      const t = r < colossus ? 2 : r < colossus + knights ? 1 : 0;
      const us = unitScale * SCALE[t];
      // every unit bounces at its own pace and height, with the odd extra-high hop, so the crowd looks alive
      const fm = 0.78 + 0.5 * hash01(i + 313);
      const am = 0.6 + 1.1 * hash01(i + 577);
      const w = time * freq * fm + ph;
      const hop = Math.max(0, Math.sin(time * (0.9 + 1.3 * hash01(i + 71)) + ph * 3.1) - 0.72) * 2.6;
      const bob = Math.abs(Math.sin(w)) * bobAmp * am * us * (1 + hop * (running ? 1.4 : 0.3));
      const px = Math.max(-CFG.halfWidth + 0.25, Math.min(CFG.halfWidth - 0.25, this.curX[i]));
      this.tmpP.set(px, bob, this.curZ[i]); // slots are already centred on the anchor
      this.tmpE.set(Math.sin(w) * 0.05 * am, 0, lean + Math.sin(w * 0.5 + ph) * 0.04);
      this.tmpQ.setFromEuler(this.tmpE);
      sc.set(us, us, us);
      this.tmpM.compose(this.tmpP, this.tmpQ, sc);
      const k2 = cnt[t]++;
      meshes[t].setMatrixAt(k2, this.tmpM);
      // slight per-unit brightness variation so the crowd does not look cloned; higher ranks lean golden
      this.tmpC.copy(this.skinTint).multiplyScalar(0.88 + 0.24 * hash01(i));
      if (t > 0) this.tmpC.lerp(GOLD, t === 1 ? 0.18 : 0.45);
      meshes[t].setColorAt(k2, this.tmpC);
    }
    for (let t = 0; t < 3; t++) {
      meshes[t].count = cnt[t];
      meshes[t].instanceMatrix.needsUpdate = true;
      if (meshes[t].instanceColor) meshes[t].instanceColor!.needsUpdate = true;
    }
    this.dirty = false;
    this.updateAura(dt, time, g);

    // leader: sits at the crowd centre (where gates are actually resolved); in a split zone it follows the bigger lane
    const showLeader = total > 0;
    this.leader.visible = this.leaderRing.visible = showLeader;
    if (showLeader) {
      const tgt = this.split ? (this.split.left >= this.split.right ? -2.6 : 2.6) : this.x;
      this.leaderX += (tgt - this.leaderX) * Math.min(1, dt * 14);
      const ls = Math.max(1.55, unitScale * 1.75);
      const ph = Math.sin(time * freq) * 0.05;
      this.leader.position.set(this.leaderX, Math.abs(Math.sin(time * freq)) * bobAmp * ls, 0);
      this.leader.rotation.set(ph, 0, lean);
      this.leader.scale.setScalar(ls);
      this.leaderRing.position.x = this.leaderX;
      this.leaderRing.scale.setScalar(Math.max(1, ls * 0.6) * (1 + 0.06 * Math.sin(time * 6)));
    }
  }

  /** Glowing disc and ring under the crowd: appears at thousands, grows brighter and changes colour with each tier, rainbow from tier 9. */
  private updateAura(dt: number, time: number, g: number): void {
    this.pulseT = Math.max(0, this.pulseT - dt * 1.4);
    const on = g >= 2;
    this.aura.visible = this.auraRing.visible = on;
    if (!on) return;
    const col = g >= 9 ? new THREE.Color().setHSL((time * 0.25) % 1, 0.9, 0.6) : new THREE.Color(AURA_COLORS[Math.min(g, AURA_COLORS.length - 1)]);
    const R = Math.min(CFG.halfWidth, Math.max(2, this.depth * 0.5 + 1.2));
    const grow = 1 + this.pulseT * 0.9;
    const base = Math.min(0.36, 0.06 + 0.03 * g);
    const cx = this.split ? 0 : this.x;
    for (const m of [this.aura, this.auraRing]) {
      (m.material as THREE.MeshBasicMaterial).color.copy(col);
      m.position.x = cx;
    }
    this.aura.scale.setScalar(R * grow);
    (this.aura.material as THREE.MeshBasicMaterial).opacity = base * (0.8 + 0.2 * Math.sin(time * 3)) + this.pulseT * 0.3;
    this.auraRing.scale.setScalar(R * grow * (1.04 + 0.04 * Math.sin(time * 4)));
    (this.auraRing.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, base * 1.8 + this.pulseT * 0.5);
  }

  /** World-space offset (along +z = behind the anchor) of the rearmost row, used for camera framing. */
  get halfDepth(): number {
    return this.depth * 0.5;
  }
}
