// Renders blocky voxel skulls (own design, public domain) to transparent PNG data URIs for the HUD route bar.
import * as THREE from 'three';
const w = window as any;
const FRONT = [
  '..XXXXX..',
  '.XXXXXXX.',
  'XXXXXXXXX',
  'XXoooXooo'.replace('XXoooXooo', 'XooXXXooX'),
  'XooXXXooX',
  'XXXXnXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '..X.X.X..',
];
w.render = (boss: boolean): string => {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(S, S, false);
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.5));
  const dl = new THREE.DirectionalLight(0xffffff, 1.5);
  dl.position.set(-3, 5, 4);
  scene.add(dl);
  const bone = new THREE.Color(boss ? 0xff7a6a : 0xf1ead6);
  const dark = new THREE.Color(0x1a1030);
  const horn = new THREE.Color(0xffc21a);
  const geo = new THREE.BoxGeometry(0.97, 0.97, 0.97);
  const group = new THREE.Group();
  const add = (x: number, y: number, z: number, c: THREE.Color, shade = 1) => {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(shade) }));
    m.position.set(x, y, z);
    group.add(m);
  };
  const D = 6;
  FRONT.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      const x = rx - 4;
      const y = -ry + 4;
      if (ch === '.') continue;
      for (let z = 0; z < D; z++) {
        const zz = -z; // front faces +z camera: z=0 is the front layer
        if ((ch === 'o' || ch === 'n') && z < 2) continue; // hollow eye sockets / nose
        if (ry >= 8 && z > 1) continue; // teeth are a thin row
        if (ry >= 6 && z > 4) continue;
        const dim = ch === 'o' || ch === 'n' ? dark : bone;
        add(x, y, zz, dim, ch === 'o' || ch === 'n' ? 1 : 1 - z * 0.04);
      }
    }
  });
  if (boss) {
    // horns
    [[-4, 5], [-5, 6], [4, 5], [5, 6]].forEach(([x, y]) => add(x, y, -2, horn));
    [[-3, 5], [3, 5]].forEach(([x, y]) => add(x, y, -2, horn));
  }
  group.position.z = 2.5;
  group.rotation.set(0.2, -0.32, 0);
  scene.add(group);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  cam.position.set(0, 3, 22);
  cam.lookAt(0, 1.0, 0);
  r.render(scene, cam);
  return canvas.toDataURL('image/png');
};
