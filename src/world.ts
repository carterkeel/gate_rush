import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from './config';
import { biomeWeights, emptyPalette, paletteAt } from './biomes';

function gridTexture(): THREE.CanvasTexture {
  // neutral light texture: each biome tints it through the material colour
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d4d8e6';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(30,40,70,0.28)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(30,40,70,0.12)';
  g.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, 256);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function paint(g: THREE.BufferGeometry, fn: (y: number) => THREE.Color): THREE.BufferGeometry {
  const ng = g.toNonIndexed();
  const pos = ng.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const col = fn(pos.getY(i));
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return ng;
}
const flat = (hex: number) => {
  const col = new THREE.Color(hex);
  return () => col;
};

function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6);
  trunk.translate(0, 0.7, 0);
  const c1 = new THREE.ConeGeometry(1.5, 2.6, 7);
  c1.translate(0, 2.5, 0);
  const c2 = new THREE.ConeGeometry(1.1, 2.2, 7);
  c2.translate(0, 3.9, 0);
  const c3 = new THREE.ConeGeometry(0.7, 1.6, 7);
  c3.translate(0, 5.0, 0);
  const g = mergeGeometries([paint(trunk, flat(0x5a3b22)), paint(c1, flat(0x1f6b3a)), paint(c2, flat(0x2a8a47)), paint(c3, flat(0x3aa65a))])!;
  g.computeVertexNormals();
  return g;
}

function rockGeometry(): THREE.BufferGeometry {
  const dark = new THREE.Color(0x2a1816);
  const hot = new THREE.Color(0xff6a1a);
  const glow = (top: number) => (y: number) => dark.clone().lerp(hot, Math.min(1, Math.max(0, (y - top * 0.45) / (top * 0.55))));
  const a = new THREE.ConeGeometry(0.9, 3.4, 5);
  a.translate(0, 1.7, 0);
  const b = new THREE.ConeGeometry(0.6, 2.1, 5);
  b.translate(-0.9, 1.05, 0.3);
  const c = new THREE.ConeGeometry(0.5, 1.6, 5);
  c.translate(0.8, 0.8, -0.4);
  const g = mergeGeometries([paint(a, glow(3.4)), paint(b, glow(2.1)), paint(c, glow(1.6))])!;
  g.computeVertexNormals();
  return g;
}

function cloudGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const puffs: [number, number, number, number][] = [[0, 0, 0, 1.2], [1.2, -0.15, 0.2, 0.9], [-1.2, -0.2, -0.1, 0.85], [0.4, 0.55, 0, 0.8], [-0.5, 0.35, 0.4, 0.7]];
  for (const [x, y, z, r] of puffs) {
    const g = new THREE.SphereGeometry(r, 9, 7);
    g.translate(x, y, z);
    parts.push(paint(g, (yy) => new THREE.Color(0xdde8ff).lerp(new THREE.Color(0xffffff), Math.min(1, Math.max(0, (yy + 0.5) / 2)))));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

function coralGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: number) => parts.push(paint(g, flat(col)));
  const stem = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 6);
  stem.translate(0, 1.1, 0);
  add(stem, 0xff6f91);
  const b1 = new THREE.CylinderGeometry(0.1, 0.17, 1.5, 6);
  b1.rotateZ(0.7);
  b1.translate(0.6, 1.9, 0);
  add(b1, 0xff8fab);
  const b2 = new THREE.CylinderGeometry(0.1, 0.16, 1.3, 6);
  b2.rotateZ(-0.7);
  b2.translate(-0.55, 1.6, 0.1);
  add(b2, 0xff5d8f);
  const kelp = new THREE.ConeGeometry(0.2, 4.4, 5);
  kelp.translate(1.3, 2.2, -0.3);
  add(kelp, 0x2fd18b);
  const kelp2 = new THREE.ConeGeometry(0.16, 3.2, 5);
  kelp2.translate(-1.2, 1.6, 0.3);
  add(kelp2, 0x1fae7a);
  const shell = new THREE.SphereGeometry(0.55, 8, 6);
  shell.scale(1, 0.6, 1);
  shell.translate(0.2, 0.2, 0.9);
  add(shell, 0xffd166);
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

const PROPS = 72;
const EMBERS = 150;
type PropType = 0 | 1 | 2 | 3 | 4; // one per biome: pillar, tree, lava spire, cloud, coral
const NTYPES = 5;

interface Prop {
  type: PropType;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  rot: number;
  tone: number;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private ground: THREE.Mesh;
  private groundTex: THREE.CanvasTexture;
  private side: THREE.Mesh;
  private edges: THREE.Mesh[] = [];
  private rivers: THREE.Mesh[] = [];
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private meshes: THREE.InstancedMesh[] = [];
  private props: Prop[] = [];
  private embers: THREE.Points;
  private emberPos = new Float32Array(EMBERS * 3);
  private emberSeed = new Float32Array(EMBERS);
  private pal = emptyPalette();
  private w = [1, 0, 0, 0, 0];
  private tmp = new THREE.Matrix4();
  private tq = new THREE.Quaternion();
  private te = new THREE.Euler();
  private ts = new THREE.Vector3();
  private tp = new THREE.Vector3();
  private tc = new THREE.Color();
  private lastDirty = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x0a0f1c);
    this.scene.fog = new THREE.Fog(0x0a0f1c, 40, 120);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 300);

    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x1a2036, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(-6, 14, 8);
    this.scene.add(this.sun);

    this.groundTex = gridTexture();
    const L = 260;
    this.groundTex.repeat.set(1, L / CFG.pathWidth);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(CFG.pathWidth, L), new THREE.MeshLambertMaterial({ map: this.groundTex }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    this.side = new THREE.Mesh(new THREE.PlaneGeometry(220, L), new THREE.MeshLambertMaterial({ color: 0x0d1424 }));
    this.side.rotation.x = -Math.PI / 2;
    this.side.position.y = -0.04;
    this.scene.add(this.side);

    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, L), new THREE.MeshBasicMaterial({ color: 0x38d6ff }));
      m.position.set(sx * (CFG.halfWidth + 0.11), 0.08, 0);
      this.scene.add(m);
      this.edges.push(m);
      // lava rivers hug the path in the lava biome
      const r = new THREE.Mesh(new THREE.PlaneGeometry(2.6, L), new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.position.set(sx * (CFG.halfWidth + 2.3), -0.01, 0);
      this.scene.add(r);
      this.rivers.push(r);
    }

    // three prop families share one pool; each family is its own instanced mesh
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const vc = () => new THREE.MeshLambertMaterial({ vertexColors: true });
    const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x7f93b8 });
    const mats = [pillarMat, vc(), vc(), cloudMat, vc()];
    const geos = [new THREE.BoxGeometry(1, 1, 1), treeGeometry(), rockGeometry(), cloudGeometry(), coralGeometry()];
    for (let t = 0; t < NTYPES; t++) {
      const m = new THREE.InstancedMesh(geos[t], mats[t], PROPS);
      m.frustumCulled = false;
      m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PROPS * 3), 3);
      this.scene.add(m);
      this.meshes.push(m);
    }
    for (let i = 0; i < PROPS; i++) {
      this.props.push({ type: 0, x: 0, y: 0, z: 0, sx: 1, sy: 1, rot: 0, tone: 0 });
      this.respawn(i, 0, true);
    }
    this.writeProps();

    // ambient particles: neon sparks / fireflies / embers
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ size: 0.22, color: 0x57e6ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.embers.frustumCulled = false;
    this.scene.add(this.embers);
    for (let i = 0; i < EMBERS; i++) {
      this.emberSeed[i] = Math.random() * 100;
      this.emberPos[i * 3] = (Math.random() - 0.5) * 30;
      this.emberPos[i * 3 + 1] = Math.random() * 9;
      this.emberPos[i * 3 + 2] = -Math.random() * 70 + 8;
    }
  }

  private pickType(distAhead: number): PropType {
    biomeWeights(distAhead, this.w);
    let r = Math.random();
    for (let t = 0; t < NTYPES - 1; t++) {
      if (r < this.w[t]) return t as PropType;
      r -= this.w[t];
    }
    return (NTYPES - 1) as PropType;
  }

  private respawn(i: number, playerS: number, init: boolean): void {
    const p = this.props[i];
    const side = Math.random() < 0.5 ? -1 : 1;
    const zWorld = init ? -playerS - Math.random() * 200 + 40 : -playerS - 170 - Math.random() * 30;
    p.type = this.pickType(-zWorld);
    p.z = zWorld;
    p.rot = Math.random() * Math.PI * 2;
    p.tone = Math.random();
    if (p.type === 0) {
      p.x = side * (CFG.halfWidth + 3 + Math.random() * 26);
      p.sx = 1.4 + Math.random() * 3.2;
      p.sy = 2 + Math.random() * 14;
    } else if (p.type === 1) {
      p.x = side * (CFG.halfWidth + 2.2 + Math.random() * 24);
      p.sx = 0.9 + Math.random() * 1.1;
      p.sy = 0.9 + Math.random() * 1.2;
    } else if (p.type === 2) {
      p.x = side * (CFG.halfWidth + 4.6 + Math.random() * 22);
      p.sx = 0.9 + Math.random() * 1.5;
      p.sy = 0.8 + Math.random() * 1.4;
    } else if (p.type === 3) {
      // clouds float all around the path: below, beside and high above
      p.x = side * (CFG.halfWidth + 2 + Math.random() * 30);
      p.y = -7 + Math.random() * 15;
      if (Math.abs(p.x) < CFG.halfWidth + 6 && p.y > -1) p.y = -2 - Math.random() * 5;
      p.sx = 1.6 + Math.random() * 2.8;
      p.sy = 0.8 + Math.random() * 0.8;
    } else {
      p.x = side * (CFG.halfWidth + 2.4 + Math.random() * 22);
      p.sx = 0.8 + Math.random() * 1.2;
      p.sy = 0.8 + Math.random() * 1.3;
    }
  }

  private writeProps(): void {
    const n = [0, 0, 0, 0, 0];
    for (const p of this.props) {
      const mesh = this.meshes[p.type];
      const k = n[p.type]++;
      this.tp.set(p.x, p.type === 0 ? p.sy / 2 - 0.05 : p.type === 3 ? p.y : -0.05, p.z);
      if (p.type === 0) {
        this.tq.identity();
        this.ts.set(p.sx, p.sy, p.sx);
        this.tc.setHSL(0.55 + p.tone * 0.15, 0.4, 0.22 + p.tone * 0.12);
      } else {
        this.te.set(0, p.rot, 0);
        this.tq.setFromEuler(this.te);
        this.ts.set(p.sx, p.sy, p.sx);
        const v = 0.8 + p.tone * 0.4;
        this.tc.setRGB(v, v, v);
      }
      this.tmp.compose(this.tp, this.tq, this.ts);
      mesh.setMatrixAt(k, this.tmp);
      mesh.setColorAt(k, this.tc);
    }
    for (let t = 0; t < NTYPES; t++) {
      this.meshes[t].count = n[t];
      this.meshes[t].instanceMatrix.needsUpdate = true;
      if (this.meshes[t].instanceColor) this.meshes[t].instanceColor!.needsUpdate = true;
    }
  }

  /** Re-scatter the scenery for the biome at `playerS` (used on restart and by the test warp). */
  reset(playerS: number): void {
    for (let i = 0; i < PROPS; i++) this.respawn(i, playerS, true);
    this.writeProps();
    for (let i = 0; i < EMBERS; i++) this.emberPos[i * 3 + 2] = -playerS - Math.random() * 70;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // keep the full path visible at the decision distance on any aspect ratio
    const focus = 20;
    const needHalfWidth = CFG.halfWidth * 1.12;
    const hfov = 2 * Math.atan(needHalfWidth / focus);
    const vfovFromWidth = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vfovFromWidth), 58, 78); // 58 = a typical phone's vertical view, so wide screens see as far ahead
    this.camera.updateProjectionMatrix();
  }

  update(playerS: number, time: number, dt: number): void {
    const z = -playerS;
    this.ground.position.z = z;
    this.side.position.z = z;
    for (const e of this.edges) e.position.z = z;
    for (const r of this.rivers) r.position.z = z;
    this.groundTex.offset.y = (playerS / CFG.pathWidth) % 1;

    // biome palette at the player's position
    paletteAt(playerS + 25, this.pal);
    biomeWeights(playerS + 25, this.w);
    const p = this.pal;
    (this.scene.background as THREE.Color).copy(p.bg);
    (this.scene.fog as THREE.Fog).color.copy(p.bg);
    (this.ground.material as THREE.MeshLambertMaterial).color.copy(p.ground);
    (this.side.material as THREE.MeshLambertMaterial).color.copy(p.side);
    for (const e of this.edges) (e.material as THREE.MeshBasicMaterial).color.copy(p.rail);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.sun.color.copy(p.sun);
    const sideMat = this.side.material as THREE.MeshLambertMaterial;
    sideMat.transparent = false; // must stay opaque: a transparent plane would be drawn over the see-through gate faces
    this.side.position.y = -0.04 - 9 * this.w[3]; // in the sky the ground drops away so clouds can float below the path
    const fog = this.scene.fog as THREE.Fog;
    fog.near = 40 - 16 * this.w[4] - 6 * this.w[3];
    fog.far = 120 - 34 * this.w[4];
    const lava = this.w[2];
    for (const r of this.rivers) {
      (r.material as THREE.MeshBasicMaterial).opacity = lava * (0.8 + 0.2 * Math.sin(time * 3));
      r.visible = lava > 0.02;
    }
    (this.embers.material as THREE.PointsMaterial).color.copy(p.particle);

    // recycle props that fell behind the camera
    let moved = false;
    for (let i = 0; i < PROPS; i++) {
      if (this.props[i].z > z + 40) {
        this.respawn(i, playerS, false);
        moved = true;
      }
    }
    if (moved) this.writeProps();

    // drifting particles: rise fast over lava, wander over the forest, hang over the city
    const rise = 0.35 + 2.6 * this.w[2] + 1.5 * this.w[4];
    const wob = 0.5 + 1.6 * this.w[1] + 0.9 * this.w[4] + 0.6 * this.w[3];
    for (let i = 0; i < EMBERS; i++) {
      const o = i * 3;
      const sd = this.emberSeed[i];
      this.emberPos[o] += Math.sin(time * 0.9 + sd) * wob * dt;
      this.emberPos[o + 1] += (rise * (0.6 + (sd % 1))) * dt;
      this.emberPos[o + 2] += Math.cos(time * 0.7 + sd) * wob * 0.4 * dt;
      if (this.emberPos[o + 1] > 10 || this.emberPos[o + 2] > z + 14) {
        this.emberPos[o] = (Math.random() - 0.5) * 32;
        this.emberPos[o + 1] = Math.random() * 1.5;
        this.emberPos[o + 2] = z - Math.random() * 70;
      }
    }
    (this.embers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    void this.lastDirty;
  }
}
