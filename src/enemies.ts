import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from './config';
import { KIND_ORDER } from './combatModel';
import { angryUnitGeometry } from './models';
import type { CombatZone, EnemyKind } from './types';

interface Enemy {
  kind: EnemyKind;
  hp: number;
  max: number;
  atk: number;
  x: number;
  z: number; // world z
  scale: number;
  flash: number;
  gone: number; // death animation 0..1
  yaw: number; // small random facing offset
  hop: number; // 0..1 while mid-hop, -1 when standing
  hopT: number; // seconds until the next hop
  hopH: number; // height of the current hop
}

const SCALE: Record<EnemyKind, number> = { grunt: 1, brute: 1.45, titan: 2.5, boss: 4.4 };
// instance tint, multiplied with the model's red vertex colours
const TINT: Record<EnemyKind, [number, number, number]> = {
  grunt: [1, 1, 1],
  brute: [1, 0.75, 0.35],
  titan: [0.75, 0.45, 1.9],
  boss: [1, 2.0, 0.3],
};

/** Kenney orc models (red-skinned) per enemy kind. */
const PARTS_OF: Record<EnemyKind, string[]> = {
  grunt: ['orcRed', 'sword'],
  brute: ['orcRed', 'sword', 'shield'],
  titan: ['orcRed', 'spear'],
  boss: ['orcRed', 'spear', 'shield'],
};
const KINDS: EnemyKind[] = ['grunt', 'brute', 'titan', 'boss'];
/** Model height is 1.2; the old block enemy was 1.7, so enemy sizes keep their scale with this factor. */
const MODEL_K = 1.2;

const MAX_ENEMY = 72;
const MAX_BULLET = 220;
const MAX_EBULLET = 160;

export interface CombatStep {
  killedNow: number;
  titansKilled: number;
  bossKilled: number;
  armyLoss: number;
  done: boolean;
  remainingHp: number;
  timeLeft: number;
}

export class CombatSim {
  private meshes = {} as Record<EnemyKind, THREE.InstancedMesh>;
  private bullets: THREE.InstancedMesh;
  private ebullets: THREE.InstancedMesh;
  private enemies: Enemy[] = [];
  private bx = new Float32Array(MAX_BULLET * 4); // x,y,z,life
  private tx = new Float32Array(MAX_BULLET * 3);
  private bhead = 0;
  private ex = new Float32Array(MAX_EBULLET * 4);
  private etx = new Float32Array(MAX_EBULLET * 3);
  private ehead = 0;
  private eAcc = 0;
  private lossAcc = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private eu = new THREE.Euler();
  active = false;
  timeLeft = 0;
  totalHp = 0;
  kills = 0;
  titanKills = 0;
  bossKills = 0;
  private shotAcc = 0;
  /** 0 -> 1 fade/scale-in after the roster is placed, so enemies never pop out of thin air. */
  private appear = 1;

  constructor(scene: THREE.Scene) {
    for (const k of KINDS) {
      const m = new THREE.InstancedMesh(angryUnitGeometry(PARTS_OF[k]), new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_ENEMY);
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ENEMY * 3), 3);
      m.count = 0;
      scene.add(m);
      this.meshes[k] = m;
    }
    this.bullets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), new THREE.MeshBasicMaterial({ color: 0xfff2a8, fog: false }), MAX_BULLET);
    this.bullets.frustumCulled = false;
    this.bullets.count = 0;
    scene.add(this.bullets);
    this.ebullets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.8), new THREE.MeshBasicMaterial({ color: 0xff5a36, fog: false }), MAX_EBULLET);
    this.ebullets.frustumCulled = false;
    this.ebullets.count = 0;
    scene.add(this.ebullets);
  }

  /** Lay the roster out: grunts in front, brutes behind them, titans behind those, the boss at the very back. */
  place(zone: CombatZone): void {
    const byKind: Record<EnemyKind, Enemy[]> = { grunt: [], brute: [], titan: [], boss: [] };
    for (const e of zone.enemies) {
      byKind[e.kind].push({ kind: e.kind, hp: e.hp, max: e.hp, atk: e.atk, x: 0, z: 0, scale: SCALE[e.kind], flash: 0, gone: 0, yaw: (Math.random() - 0.5) * 0.9, hop: -1, hopT: Math.random() * 2.4, hopH: 0.3 });
    }
    let z = -(zone.s + CFG.combatStopGap);
    const rows = (list: Enemy[], maxCols: number, dx: number, dz: number) => {
      const cols = Math.max(1, Math.min(maxCols, list.length));
      list.forEach((e, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const inRow = Math.min(cols, list.length - row * cols);
        e.x = (col - (inRow - 1) / 2) * dx;
        // loose, uneven ranks instead of a parade-ground grid
        const jx = Math.min(dx, 1.4) * 0.55;
        const jz = Math.min(dz, 1.4) * 0.6;
        e.x += (Math.random() - 0.5) * 2 * jx + (row % 2 ? dx * 0.25 : -dx * 0.25);
        e.z = z - row * dz + (Math.random() - 0.5) * 2 * jz;
      });
      z -= Math.ceil(list.length / cols) * dz + dz * 0.4;
    };
    const gruntCols = Math.min(9, Math.max(4, Math.ceil(Math.sqrt(byKind.grunt.length) * 1.6)));
    rows(byKind.grunt, gruntCols, 1.05, 1.15);
    rows(byKind.brute, 6, 1.5, 1.9);
    rows(byKind.titan, 3, 3.4, 3.4);
    rows(byKind.boss, 1, 0, 5.5);
    this.enemies = [...byKind.grunt, ...byKind.brute, ...byKind.titan, ...byKind.boss];
    this.totalHp = zone.enemies.reduce((a, e) => a + e.hp, 0);
    this.active = false;
    this.appear = 0;
    this.render(0);
  }

  /** Advance the fade-in while the army is still approaching (step() does it during the fight). */
  idle(dt: number): void {
    if (this.enemies.length) this.render(dt); // keeps them hopping and glaring while they wait
  }

  /** Enemies scale with the army that actually arrives: a bigger army meets proportionally bigger enemies. */
  rescale(k: number): void {
    k = Math.min(60, Math.max(1, k));
    for (const e of this.enemies) {
      e.hp = Math.max(1, Math.round(e.hp * k));
      e.max = e.hp;
      e.atk *= k;
    }
    this.totalHp = this.enemies.reduce((a, e) => a + e.hp, 0);
  }

  begin(): void {
    this.active = true;
    this.timeLeft = CFG.combatMaxSec;
    this.shotAcc = 0;
    this.lossAcc = 0;
    this.eAcc = 0;
  }

  get remainingHp(): number {
    let r = 0;
    for (const e of this.enemies) r += Math.max(0, e.hp);
    return r;
  }
  get hasBoss(): boolean {
    return this.enemies.some((e) => e.kind === 'boss' && e.hp > 0);
  }

  clear(): void {
    this.enemies = [];
    this.active = false;
    for (const k of KINDS) this.meshes[k].count = 0;
    this.bullets.count = 0;
    this.ebullets.count = 0;
    this.bx.fill(0);
    this.ex.fill(0);
  }

  /** Power-up: every living enemy dies at once. Returns what was killed. */
  annihilate(): { killed: number; titans: number; boss: number } {
    let killed = 0;
    let titans = 0;
    let boss = 0;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      e.hp = 0;
      e.flash = 1;
      killed++;
      if (e.kind === 'titan') titans++;
      if (e.kind === 'boss') boss++;
    }
    this.kills += killed;
    this.titanKills += titans;
    this.bossKills += boss;
    return { killed, titans, boss };
  }

  /** One frame of fighting. Friendly units shoot 1 dmg per 0.6 s; every living enemy kills `atk` units per second. */
  step(dt: number, armyCount: number, armyX: number, armyZ: number): CombatStep {
    let killedNow = 0;
    let titansKilled = 0;
    let bossKilled = 0;
    let armyLoss = 0;
    if (this.active) {
      this.timeLeft -= dt;
      this.shotAcc += (armyCount / CFG.shotIntervalSec) * dt;
      let shots = Math.floor(this.shotAcc);
      this.shotAcc -= shots;
      const alive = this.enemies
        .filter((e) => e.hp > 0)
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Math.abs(a.x - armyX) + 0.4 * (armyZ - a.z) - (Math.abs(b.x - armyX) + 0.4 * (armyZ - b.z)));
      let visual = Math.min(shots, 14);
      for (const e of alive) {
        if (shots <= 0) break;
        const dmg = Math.min(shots, e.hp);
        e.hp -= dmg;
        shots -= dmg;
        e.flash = 1;
        if (visual > 0) {
          this.fire(armyX, armyZ, e);
          visual--;
        }
        if (e.hp <= 0) {
          killedNow++;
          if (e.kind === 'titan') titansKilled++;
          if (e.kind === 'boss') bossKilled++;
        }
      }
      this.kills += killedNow;
      this.titanKills += titansKilled;
      this.bossKills += bossKilled;

      // the survivors shoot back
      let dps = 0;
      for (const e of this.enemies) if (e.hp > 0) dps += e.atk;
      this.lossAcc += dps * dt;
      armyLoss = Math.min(armyCount, Math.floor(this.lossAcc));
      this.lossAcc -= Math.floor(this.lossAcc);
      this.eAcc += Math.min(45, Math.max(4, dps * 1.6)) * dt;
      const stillAlive = this.enemies.filter((e) => e.hp > 0);
      while (this.eAcc >= 1 && stillAlive.length) {
        this.eAcc -= 1;
        this.enemyFire(stillAlive[Math.floor(Math.random() * stillAlive.length)], armyX, armyZ);
      }
    }
    this.updateBullets(dt);
    this.updateEnemyBullets(dt);
    this.render(dt);
    const rem = this.remainingHp;
    const done = this.active && (rem <= 0 || this.timeLeft <= 0);
    return { killedNow, titansKilled, bossKilled, armyLoss, done, remainingHp: rem, timeLeft: Math.max(0, this.timeLeft) };
  }

  private fire(ax: number, az: number, e: Enemy): void {
    const i = this.bhead;
    this.bhead = (this.bhead + 1) % MAX_BULLET;
    this.bx[i * 4] = ax + (Math.random() - 0.5) * 4;
    this.bx[i * 4 + 1] = 0.8 + Math.random() * 0.4;
    this.bx[i * 4 + 2] = az - 1;
    this.bx[i * 4 + 3] = 1;
    this.tx[i * 3] = e.x;
    this.tx[i * 3 + 1] = 1 * e.scale * 0.7;
    this.tx[i * 3 + 2] = e.z;
  }

  private enemyFire(e: Enemy, ax: number, az: number): void {
    const i = this.ehead;
    this.ehead = (this.ehead + 1) % MAX_EBULLET;
    this.ex[i * 4] = e.x;
    this.ex[i * 4 + 1] = 0.9 * e.scale;
    this.ex[i * 4 + 2] = e.z + 0.5;
    this.ex[i * 4 + 3] = 1;
    this.etx[i * 3] = ax + (Math.random() - 0.5) * 4;
    this.etx[i * 3 + 1] = 0.8;
    this.etx[i * 3 + 2] = az + (Math.random() - 0.5) * 2;
  }

  private updateBullets(dt: number): void {
    let n = 0;
    for (let i = 0; i < MAX_BULLET; i++) {
      if (this.bx[i * 4 + 3] <= 0) continue;
      const dx = this.tx[i * 3] - this.bx[i * 4];
      const dz = this.tx[i * 3 + 2] - this.bx[i * 4 + 2];
      const d = Math.hypot(dx, dz);
      const step = 60 * dt;
      if (d <= step) {
        this.bx[i * 4 + 3] = 0;
        continue;
      }
      this.bx[i * 4] += (dx / d) * step;
      this.bx[i * 4 + 2] += (dz / d) * step;
      this.p.set(this.bx[i * 4], this.bx[i * 4 + 1], this.bx[i * 4 + 2]);
      this.q.setFromAxisAngle(this.up, Math.atan2(-dx, -dz));
      this.s.set(1, 1, 1);
      this.m.compose(this.p, this.q, this.s);
      this.bullets.setMatrixAt(n++, this.m);
    }
    this.bullets.count = n;
    this.bullets.instanceMatrix.needsUpdate = true;
  }

  private updateEnemyBullets(dt: number): void {
    let n = 0;
    for (let i = 0; i < MAX_EBULLET; i++) {
      if (this.ex[i * 4 + 3] <= 0) continue;
      const dx = this.etx[i * 3] - this.ex[i * 4];
      const dz = this.etx[i * 3 + 2] - this.ex[i * 4 + 2];
      const d = Math.hypot(dx, dz);
      const step = 34 * dt;
      if (d <= step) {
        this.ex[i * 4 + 3] = 0;
        continue;
      }
      this.ex[i * 4] += (dx / d) * step;
      this.ex[i * 4 + 2] += (dz / d) * step;
      this.p.set(this.ex[i * 4], this.ex[i * 4 + 1], this.ex[i * 4 + 2]);
      this.q.setFromAxisAngle(this.up, Math.atan2(-dx, -dz));
      this.s.set(1, 1, 1);
      this.m.compose(this.p, this.q, this.s);
      this.ebullets.setMatrixAt(n++, this.m);
    }
    this.ebullets.count = n;
    this.ebullets.instanceMatrix.needsUpdate = true;
  }

  private render(dt: number): void {
    this.appear = Math.min(1, this.appear + dt / 1.1);
    const ease = this.appear * this.appear * (3 - 2 * this.appear);
    const used: Record<EnemyKind, number> = { grunt: 0, brute: 0, titan: 0, boss: 0 };
    for (const k of KINDS) {
      const mat = this.meshes[k].material as THREE.MeshLambertMaterial;
      mat.transparent = true;
      mat.opacity = ease;
    }
    for (const e of this.enemies) {
      if (e.hp <= 0) e.gone = Math.min(1, e.gone + dt * (e.kind === 'grunt' ? 5 : 2));
      if (e.gone >= 1) continue;
      e.flash = Math.max(0, e.flash - dt * 6);
      const sc = e.scale * MODEL_K * (e.kind === 'grunt' ? 0.85 + 0.35 * Math.min(1, e.max / 12) : 1) * (1 - e.gone) * (0.7 + 0.3 * ease);
      // impatient hopping: every now and then an enemy jumps (squashing on take-off and landing)
      let hy = 0;
      let sy = 1;
      if (e.gone <= 0 && this.appear >= 1) {
        e.hopT -= dt;
        if (e.hop < 0 && e.hopT <= 0) {
          e.hop = 0;
          e.hopH = (0.25 + Math.random() * 0.55) * (e.kind === 'boss' ? 0.5 : e.kind === 'titan' ? 0.6 : 1);
        }
        if (e.hop >= 0) {
          e.hop += dt / (e.kind === 'grunt' ? 0.42 : 0.6);
          if (e.hop >= 1) {
            e.hop = -1;
            e.hopT = 0.3 + Math.random() * 2.2;
          } else {
            hy = Math.sin(Math.PI * e.hop) * e.hopH * Math.pow(e.scale, 0.45);
            sy = 1 - 0.13 * Math.cos(2 * Math.PI * e.hop);
          }
        }
      }
      const sxz = 1 / Math.sqrt(sy);
      this.p.set(e.x, e.gone * 0.4 + hy, e.z);
      // face the oncoming army (+z), a little off-axis, leaning forward aggressively
      this.q.setFromEuler(this.eu.set(-0.2, Math.PI + e.yaw, 0, 'YXZ'));
      this.s.set(sc * sxz, sc * sy, sc * sxz);
      this.m.compose(this.p, this.q, this.s);
      const mesh = this.meshes[e.kind];
      const n = used[e.kind]++;
      mesh.setMatrixAt(n, this.m);
      const k = Math.max(0.45, e.hp / e.max);
      const t = TINT[e.kind];
      this.c.setRGB(t[0] * (0.55 + 0.45 * k) + e.flash * 0.6, t[1] * (0.55 + 0.45 * k) + e.flash * 0.8, t[2] * (0.55 + 0.45 * k) + e.flash * 0.8);
      mesh.setColorAt(n, this.c);
    }
    for (const k of KINDS) {
      const mesh = this.meshes[k];
      mesh.count = used[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
