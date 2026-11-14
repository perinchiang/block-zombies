import * as THREE from 'three';
import { toon, flat } from '../render/toon.js';
import { COL } from '../render/palette.js';

// A small-town street, built from boxes and cylinders only. The look comes
// from the ink pass, so geometry stays simple on purpose.
function mesh(geo, mat, x, y, z, { ry = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Street bounds the hero and zombies may stand in (building faces sit at |x|=7).
export const BOUNDS = { x: 6.6, zMin: -62, zMax: 9 };

export function buildArena(scene) {
  const g = new THREE.Group();
  const colliders = []; // circles on the ground plane: { x, z, r }
  const solid = (x, z, r) => colliders.push({ x, z, r });
  const M = {
    ground: toon(COL.paper, { hatch: false }),
    road: toon(COL.asphalt, { hatch: false }),
    curb: toon(COL.stone),
    wall: toon(COL.wall),
    wallAlt: toon(COL.wallAlt),
    ink: toon(COL.ink, { hatch: false }),
    rust: toon(COL.rust),
    stone: toon(COL.stone),
    paperShade: toon(COL.paperShade),
    zombie: toon(COL.zombie),
  };

  // ground and road (road runs along -Z, toward the horde)
  const ground = mesh(new THREE.PlaneGeometry(120, 120), M.ground, 0, 0, 0, { shadow: false });
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);
  const road = mesh(new THREE.PlaneGeometry(7, 120), M.road, 0, 0.005, -20, { shadow: false });
  road.rotation.x = -Math.PI / 2;
  g.add(road);
  for (let z = 6; z > -70; z -= 3.2) {
    const dash = mesh(new THREE.PlaneGeometry(0.16, 1.4), M.ground, 0, 0.01, z, { shadow: false });
    dash.rotation.x = -Math.PI / 2;
    g.add(dash);
  }
  for (const s of [-1, 1]) {
    g.add(mesh(B(0.3, 0.16, 120), M.curb, s * 3.65, 0.08, -20));
    g.add(mesh(B(3, 0.12, 120), M.paperShade, s * 5.3, 0.06, -20, { shadow: false }));
  }

  // buildings on both sides, with inked windows and doors
  const r = rand(7);
  for (const s of [-1, 1]) {
    let z = 8;
    while (z > -60) {
      const depth = 4 + r() * 4;
      const h = 3 + r() * 4.5;
      const w = 4 + r() * 2;
      const x = s * (7 + w / 2);
      const mat = r() > 0.5 ? M.wall : M.wallAlt;
      const cz = z - depth / 2;
      g.add(mesh(B(w, h, depth - 0.2), mat, x, h / 2, cz));
      // roof lip
      g.add(mesh(B(w + 0.3, 0.25, depth + 0.1), M.stone, x, h + 0.12, cz));
      // windows on the street face
      const face = x - s * (w / 2 + 0.02);
      const rows = Math.floor((h - 1) / 1.5);
      const cols = Math.max(1, Math.floor((depth - 1) / 1.6));
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const wz = cz + (j - (cols - 1) / 2) * 1.6;
          const wy = 1.9 + i * 1.5;
          if (i === 0 && j === 0) continue;
          const win = mesh(B(0.08, 0.8, 0.7), r() > 0.25 ? M.ink : M.paperShade, face, wy, wz);
          g.add(win);
        }
      }
      // door
      g.add(mesh(B(0.1, 1.5, 0.9), M.rust, face, 0.75, cz - (cols - 1) * 0.8));
      // awning on some shops
      if (r() > 0.55) {
        const aw = mesh(B(1.2, 0.08, depth * 0.7), M.stone, face - s * 0.6, 2.4, cz);
        aw.rotation.z = s * 0.25;
        g.add(aw);
      }
      z -= depth + 0.2 + r() * 1.5;
    }
  }

  // props: wrecked car, barrels, crates, barricade, lamp posts, bin
  const car = new THREE.Group();
  car.add(mesh(B(1.8, 0.7, 3.8), M.wallAlt, 0, 0.55, 0));
  car.add(mesh(B(1.6, 0.6, 2.0), M.wall, 0, 1.2, -0.2));
  car.add(mesh(B(1.62, 0.42, 0.06), M.ink, 0, 1.2, 0.82));
  for (const [x, z] of [[-0.9, 1.2], [0.9, 1.2], [-0.9, -1.2], [0.9, -1.2]]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), M.ink, x, 0.34, z);
    wheel.rotation.z = Math.PI / 2;
    car.add(wheel);
  }
  car.position.set(2.0, 0, -9);
  car.rotation.y = 0.35;
  g.add(car);
  for (const lz of [-1.3, 0, 1.3]) solid(2.0 + Math.sin(0.35) * lz, -9 + Math.cos(0.35) * lz, 1.0);

  const barrel = (x, z, tip = false) => {
    const b = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 16), M.rust, x, tip ? 0.32 : 0.45, z);
    if (tip) { b.rotation.z = Math.PI / 2; b.rotation.y = 0.6; }
    g.add(b);
    solid(x, z, tip ? 0.55 : 0.4);
    const band = mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.08, 16), M.ink, 0, 0.18, 0, { shadow: false });
    b.add(band);
  };
  barrel(-2.6, -4.5); barrel(-2.0, -5.1); barrel(-3.1, -13, true);

  const crate = (x, z, s = 0.8, ry = 0) => { g.add(mesh(B(s, s, s), M.wallAlt, x, s / 2, z, { ry })); solid(x, z, s * 0.7); };
  crate(2.9, -3.2, 0.8, 0.3); crate(3.1, -2.3, 0.6, -0.2); crate(2.95, -3.2 + 0.05, 0.5, 0.9);
  g.children.at(-1).position.y = 1.05;

  // road barricade: striped planks
  const bar = new THREE.Group();
  for (let i = 0; i < 5; i++) bar.add(mesh(B(0.5, 0.3, 0.1), i % 2 ? M.ink : M.ground, -1 + i * 0.5, 0.9, 0));
  bar.add(mesh(B(0.1, 1.0, 0.1), M.stone, -1.1, 0.5, 0));
  bar.add(mesh(B(0.1, 1.0, 0.1), M.stone, 1.1, 0.5, 0));
  bar.position.set(-1.6, 0, -16);
  bar.rotation.y = -0.2;
  g.add(bar);
  for (const lx of [-0.9, 0, 0.9]) solid(-1.6 + Math.cos(-0.2) * lx, -16 - Math.sin(-0.2) * lx, 0.35);

  for (const [x, z] of [[-4.2, -2], [4.2, -12], [-4.2, -24], [4.2, -36]]) {
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 8), M.ink, x, 2.1, z));
    solid(x, z, 0.15);
    const arm = mesh(B(1.0, 0.08, 0.08), M.ink, x - Math.sign(x) * 0.45, 4.15, z);
    g.add(arm);
    g.add(mesh(B(0.36, 0.14, 0.24), M.stone, x - Math.sign(x) * 0.9, 4.05, z));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.85, 12), M.stone, 4.4, 0.43, -6.5));
  solid(4.4, -6.5, 0.35);

  scene.add(g);
  return { group: g, colliders };
}

/** Irregular splat lying on the ground. */
export function splat(color, radius, seed = 1) {
  const r = rand(seed);
  const shape = new THREE.Shape();
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = radius * (0.65 + r() * 0.5 + (i % 3 === 0 ? r() * 0.4 : 0));
    const x = Math.cos(a) * k, y = Math.sin(a) * k;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  const grp = new THREE.Group();
  const main = new THREE.Mesh(new THREE.ShapeGeometry(shape), flat(color, { polygonOffset: true, polygonOffsetFactor: -2 }));
  main.rotation.x = -Math.PI / 2;
  grp.add(main);
  // satellite drops
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, d = radius * (1.3 + r() * 1.1);
    const drop = new THREE.Mesh(new THREE.CircleGeometry(radius * (0.07 + r() * 0.12), 10), main.material);
    drop.rotation.x = -Math.PI / 2;
    drop.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    grp.add(drop);
  }
  grp.position.y = 0.02;
  return grp;
}

/** Comic muzzle flash: a flat star facing the camera. */
export function muzzleFlash() {
  const shape = new THREE.Shape();
  const n = 7;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const k = i % 2 ? 0.08 : 0.26 + (i % 4 === 0 ? 0.08 : 0);
    const x = Math.cos(a) * k, y = Math.sin(a) * k;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  return new THREE.Mesh(new THREE.ShapeGeometry(shape), flat(COL.flash, { side: THREE.DoubleSide }));
}
