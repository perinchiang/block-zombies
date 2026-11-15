import * as THREE from 'three';
import { toon, flat } from '../render/toon.js';
import { COL } from '../render/palette.js';

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

export const BOUNDS = { x: 20, zMin: -20, zMax: 20 };

export function buildArena(scene) {
  const g = new THREE.Group();
  g.name = 'central-square-arena';
  const colliders = [];
  const M = {
    ground: toon(COL.paper, { hatch: false }),
    road: toon(COL.asphalt, { hatch: false }),
    wall: toon(COL.wall), wallAlt: toon(COL.wallAlt),
    ink: toon(COL.ink, { hatch: false }), rust: toon(COL.rust),
    stone: toon(COL.stone), shade: toon(COL.paperShade),
  };
  const paint = (x, z, w, d, mat = M.ground, y = 0.025) => {
    const p = mesh(new THREE.PlaneGeometry(w, d), mat, x, y, z, { shadow: false });
    p.rotation.x = -Math.PI / 2; g.add(p);
  };
  const box = (x, z, w, d, h, mat) => {
    g.add(mesh(B(w, h, d), mat, x, h / 2, z));
    colliders.push({ x, z, halfX: w / 2, halfZ: d / 2, height: h });
  };
  paint(0, 0, 44, 44, M.ground, 0);
  paint(0, 0, 40, 40, M.road, 0.005);
  paint(0, 0, 12, 12, M.shade, 0.012);
  // Outer loop and cross streets, with unbroken walkable junctions.
  for (let n = -16; n <= 16; n += 4) {
    for (const side of [-16, 16]) {
      paint(n, side, 1.5, 0.12); paint(side, n, 0.12, 1.5);
    }
    if (Math.abs(n) > 6) { paint(n, 0, 1.5, 0.12); paint(0, n, 0.12, 1.5); }
  }
  // Four exact 6x6 islands. Details are inset into the collision footprint.
  for (const [i, [x, z]] of [[-10, -9], [10, -9], [-10, 9], [10, 9]].entries()) {
    const h = [4.8, 6, 4, 5.2][i];
    box(x, z, 6, 6, h, i % 2 ? M.wallAlt : M.wall);
    g.add(mesh(B(5.9, 0.2, 5.9), M.stone, x, h - 0.1, z));
    for (const side of [-1, 1]) {
      for (const offset of [-1.8, 0, 1.8]) {
        for (const y of [2, 3.4]) {
          g.add(mesh(B(0.035, 0.75, 0.8), M.ink, x + side * 2.99, y, z + offset));
          g.add(mesh(B(0.8, 0.75, 0.035), M.ink, x + offset, y, z + side * 2.99));
        }
      }
      g.add(mesh(B(1.1, 1.6, 0.035), M.rust, x, 0.8, z + side * 2.99));
    }
    // Southwest repair shop: broad roller door and striped lintel.
    if (i === 2) {
      g.add(mesh(B(0.04, 2.2, 3.5), M.stone, x - 2.99, 1.1, z));
      for (let stripe = 0; stripe < 7; stripe++) {
        g.add(mesh(B(0.04, 0.35, 0.5), stripe % 2 ? M.ink : M.rust, x - 2.99, 2.5, z - 1.5 + stripe * 0.5));
      }
    }
  }
  // Inner wall faces sit exactly on bounds. Four-metre entrance gaps remain open.
  for (const z of [-20.25, 20.25]) box(0, z, 41, 0.5, 2.2, M.stone);
  for (const [x, gateZ] of [[-20.25, -10], [20.25, 10]]) {
    const lowEnd = gateZ - 2, highStart = gateZ + 2;
    box(x, (-20 + lowEnd) / 2, 0.5, lowEnd + 20, 2.2, M.stone);
    box(x, (20 + highStart) / 2, 0.5, 20 - highStart, 2.2, M.stone);
    for (const z of [gateZ - 2.3, gateZ + 2.3]) {
      box(x, z, 0.5, 0.5, 3.4, M.rust);
      g.add(mesh(B(0.48, 0.25, 0.48), M.ground, x, 3.1, z));
    }
    paint(Math.sign(x) * 19, gateZ, 1.8, 3.5, M.rust);
    for (const z of [gateZ - 1, gateZ, gateZ + 1]) paint(Math.sign(x) * 19, z, 1.4, 0.15);
  }
  // Evacuation bay centered on the reserved car position (2.8, 0).
  for (const x of [1.35, 4.25]) paint(x, 0, 0.12, 5.4);
  for (const z of [-2.7, 2.7]) paint(2.8, z, 3, 0.12);
  // Painted P, no physical car until extraction supplies it.
  paint(2.4, 0, 0.14, 1.2); paint(2.75, -0.53, 0.8, 0.14);
  paint(3.1, -0.25, 0.14, 0.7); paint(2.75, 0.05, 0.8, 0.14);
  // Open northeast yard: warning paint only, accessible from west and south.
  for (const x of [13.8, 18.5]) paint(x, -16, 0.12, 6, M.rust);
  paint(16.15, -18.9, 4.7, 0.12, M.rust);
  // Low cover stays off the square, axes, outer loop and all seven crate sites.
  for (const [x, z] of [[-5, -10], [5, 10]]) box(x, z, 1.2, 2, 0.85, M.stone);
  for (const [x, z] of [[-11, 14], [11, -14]]) {
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 16), M.rust, x, 0.45, z));
    colliders.push({ x, z, r: 0.4, height: 0.9 });
  }
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
