import * as THREE from 'three';
import { toon, flat } from '../render/toon.js';
import { COL, HEX } from '../render/palette.js';
import { NO_INK_LAYER } from '../render/inkline.js';
import {
  asphaltTex, paverTex, plazaTex, stuccoTex, concreteTex, windowTex, signTex,
  stripeTex, hazardTex, doorTex, worldUV, planeUV,
} from '../render/textures.js';

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

// Collision, bullet-blocking and navigation geometry is exactly the
// central-square layout. Everything in `decor` is looks only: it is added
// to the scene but never to colliders or the bullet scenery list.
export function buildArena(scene) {
  const g = new THREE.Group();
  g.name = 'central-square-arena';
  const decor = new THREE.Group();
  decor.name = 'central-square-decor';
  const colliders = [];
  const T = (color, map, opts) => toon(color, { map, ...opts });
  const M = {
    pavers: T(0xffffff, paverTex()),
    road: T(0xffffff, asphaltTex()),
    plaza: T(0xffffff, plazaTex()),
    lane: toon(COL.lane),
    hazard: T(0xffffff, hazardTex()),
    concrete: T(COL.concrete, concreteTex()),
    stone: toon(COL.stone), plinth: toon(COL.plinth),
    rust: toon(COL.rust), ink: toon(COL.ink),
    doors: ['#3f6f68', '#8c3f35', '#3d5a8c', '#6b4a3a'].map((c) => T(0xffffff, doorTex(c))),
    frame: toon(COL.frame),
    windows: [0, 1, 2].map((v) => T(0xffffff, windowTex(v))),
    roller: T(0xffffff, stripeTex('#9aa1a8', '#7d848c', { across: true, n: 10 })),
    barrier: T(0xffffff, stripeTex('#e9e1cf', HEX.awningA, { n: 6 })),
    walls: [COL.wall, COL.wallAlt, COL.wallPink, COL.wallBlue].map((c) => T(c, stuccoTex())),
  };
  const paint = (x, z, w, d, mat = M.lane, y = 0.025, tile = 0) => {
    const geo = new THREE.PlaneGeometry(w, d);
    if (tile) planeUV(geo, w, d, tile, x, z);
    const p = mesh(geo, mat, x, y, z, { shadow: false });
    p.rotation.x = -Math.PI / 2; g.add(p);
  };
  const box = (x, z, w, d, h, mat, uv = false) => {
    const geo = B(w, h, d);
    if (uv) worldUV(geo, 4, new THREE.Vector3(x, h / 2, z));
    g.add(mesh(geo, mat, x, h / 2, z));
    colliders.push({ x, z, halfX: w / 2, halfZ: d / 2, height: h });
  };
  const add = (geo, mat, x, y, z, opts) => {
    const m = mesh(geo, mat, x, y, z, opts);
    decor.add(m);
    return m;
  };

  paint(0, 0, 44, 44, M.pavers, 0, 4);
  paint(0, 0, 40, 40, M.road, 0.005, 4);
  paint(0, 0, 12, 12, M.plaza, 0.012, 4);
  // Outer loop and cross streets, with unbroken walkable junctions.
  for (let n = -16; n <= 16; n += 4) {
    for (const side of [-16, 16]) {
      paint(n, side, 1.5, 0.12); paint(side, n, 0.12, 1.5);
    }
    if (Math.abs(n) > 6) { paint(n, 0, 1.5, 0.12); paint(0, n, 0.12, 1.5); }
  }

  // Four exact 6x6 islands, each a different shop in a different colour.
  const SHOPS = [
    { name: '药房', trim: HEX.awningB }, { name: '杂货', trim: HEX.awningA },
    { name: '修车', trim: '#3d5a8c' }, { name: '旅馆', trim: '#8c4a6a' },
  ];
  for (const [i, [x, z]] of [[-10, -9], [10, -9], [-10, 9], [10, 9]].entries()) {
    const h = [4.8, 6, 4, 5.2][i];
    box(x, z, 6, 6, h, M.walls[i], true);
    // dark plinth grounds the building; overhanging cornice gives it a lid.
    // The cornice stands 4 cm proud of the roof so the two tops never share a plane.
    add(B(6.08, 0.55, 6.08), M.plinth, x, 0.275, z);
    g.add(mesh(B(6.24, 0.28, 6.24), M.stone, x, h - 0.1, z));
    const rows = h >= 5.2 ? [2, 3.4, 4.6] : [2, 3.4];
    let wv = i;
    for (const side of [-1, 1]) {
      for (const offset of [-1.8, 0, 1.8]) {
        for (const y of rows) {
          // ±Z faces carry the shop front: sign and door instead of the middle low window.
          const front = offset === 0 && y === 2;
          if (!front) g.add(mesh(B(0.8, 0.75, 0.06), M.windows[wv++ % 3], x + offset, y, z + side * 3));
          if (!(i === 2 && side < 0 && y === 2)) g.add(mesh(B(0.06, 0.75, 0.8), M.windows[wv++ % 3], x + side * 3, y, z + offset));
        }
      }
      // Door: frame bars and panel stand proud of the plinth (face at 3.04),
      // the panel recessed 4 cm between the bars, with a step at the sill.
      for (const dx of [-0.61, 0.61]) g.add(mesh(B(0.12, 1.84, 0.2), M.frame, x + dx, 0.92, z + side * 3.02));
      g.add(mesh(B(1.34, 0.12, 0.2), M.frame, x, 1.78, z + side * 3.02));
      g.add(mesh(B(1.1, 1.72, 0.16), M.doors[i], x, 0.86, z + side * 3.0));
      add(B(1.5, 0.1, 0.36), M.stone, x, 0.05, z + side * 3.18);
      // Striped awning: hung from the wall above the door, sloping down and out.
      const shop = SHOPS[i];
      const awn = add(B(1.9, 0.08, 0.8), T(0xffffff, stripeTex('#f1e6cc', shop.trim)), x, 2.18, z + side * 3.37);
      awn.rotation.x = side * 0.38; // +X rotation lowers the +Z edge
      const board = new THREE.Mesh(B(1.7, 0.62, 0.08), [M.frame, M.frame, M.frame, M.frame, T(0xffffff, signTex(shop.name, shop.trim)), M.frame]);
      board.position.set(x, 2.68, z + side * 3.05);
      board.rotation.y = side > 0 ? 0 : Math.PI;
      board.castShadow = board.receiveShadow = true;
      decor.add(board);
    }
    // Southwest repair shop: broad roller door and hazard lintel.
    if (i === 2) {
      g.add(mesh(B(0.16, 2.2, 3.5), M.roller, x - 3.0, 1.1, z));
      g.add(mesh(B(0.2, 0.35, 3.7), M.hazard, x - 3.0, 2.4, z));
    }
    // rooftop clutter for the skyline silhouette
    const r = rand(100 + i);
    if (i % 2 === 0) {
      add(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 14), M.rust, x - 1.4, h + 1.2, z + 1.2);
      for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
        add(B(0.08, 0.6, 0.08), M.ink, x - 1.4 + dx, h + 0.3, z + 1.2 + dz);
      }
      add(new THREE.ConeGeometry(0.78, 0.45, 14), M.plinth, x - 1.4, h + 2.02, z + 1.2);
    } else {
      add(B(1.2, 0.7, 0.9), M.concrete, x + 1.3, h + 0.35, z - 1.4);
      add(B(0.8, 0.5, 0.8), M.stone, x - 1.2 + r(), h + 0.25, z + 1.1);
    }
    add(B(0.06, 1.8, 0.06), M.ink, x + 2.2, h + 0.9, z - 2.2);
    add(B(0.8, 0.05, 0.05), M.ink, x + 2.2, h + 1.5, z - 2.2);
  }

  // Inner wall faces sit exactly on bounds. Four-metre entrance gaps remain open.
  for (const z of [-20.25, 20.25]) box(0, z, 41, 0.5, 2.2, M.concrete, true);
  for (const [x, gateZ] of [[-20.25, -10], [20.25, 10]]) {
    const lowEnd = gateZ - 2, highStart = gateZ + 2;
    box(x, (-20 + lowEnd) / 2, 0.5, lowEnd + 20, 2.2, M.concrete, true);
    box(x, (20 + highStart) / 2, 0.5, 20 - highStart, 2.2, M.concrete, true);
    // Gate pillars sit on the wall line. Drawn 0.74 m square, wider than the
    // 0.5 m wall, so no face is coplanar with the wall (that z-fought and
    // flickered whenever the camera moved). The collider stays 0.5 m.
    for (const z of [gateZ - 2.3, gateZ + 2.3]) {
      g.add(mesh(B(0.74, 3.4, 0.74), M.hazard, x, 1.7, z));
      colliders.push({ x, z, halfX: 0.25, halfZ: 0.25, height: 3.4 });
      g.add(mesh(B(0.86, 0.22, 0.86), M.plinth, x, 3.35, z));
    }
    paint(Math.sign(x) * 19, gateZ, 1.8, 3.5, M.hazard);
  }
  // wall coping
  for (const z of [-20.25, 20.25]) add(B(41.2, 0.14, 0.66), M.stone, 0, 2.27, z);
  for (const [x, gateZ] of [[-20.25, -10], [20.25, 10]]) {
    // 2 cm higher than the north/south coping, so the corners do not z-fight
    add(B(0.66, 0.14, gateZ - 2 + 20), M.stone, x, 2.29, (-20 + gateZ - 2) / 2);
    add(B(0.66, 0.14, 20 - gateZ - 2), M.stone, x, 2.29, (20 + gateZ + 2) / 2);
  }
  // Posters pasted on the inner walls.
  const POSTERS = [['封锁区', HEX.awningA], ['小心', HEX.hazard], ['寻人', '#6b86ab'], ['撤离', HEX.awningB]];
  const pr = rand(7);
  for (let k = 0; k < 14; k++) {
    const [text, col] = POSTERS[k % POSTERS.length];
    const mat = T(0xffffff, signTex(text, col, 2));
    const along = -17 + pr() * 34, y = 1.05 + pr() * 0.3, sz = 0.7 + pr() * 0.3;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz * 0.5), mat);
    p.receiveShadow = true;
    p.rotation.z = (pr() - 0.5) * 0.12;
    if (k % 2) { p.position.set(along, y, k % 4 === 1 ? -19.99 : 19.99); if (k % 4 === 3) p.rotation.y = Math.PI; }
    else {
      const x = k % 4 === 0 ? -19.99 : 19.99;
      const gate = x < 0 ? -10 : 10;
      if (Math.abs(along - gate) < 3) continue;
      p.position.set(x, y, along); p.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    decor.add(p);
  }

  // Evacuation bay centered on the reserved car position (2.8, 0).
  for (const x of [1.35, 4.25]) paint(x, 0, 0.12, 5.4);
  for (const z of [-2.7, 2.7]) paint(2.8, z, 3, 0.12);
  // Painted P, no physical car until extraction supplies it.
  paint(2.4, 0, 0.14, 1.2); paint(2.75, -0.53, 0.8, 0.14);
  paint(3.1, -0.25, 0.14, 0.7); paint(2.75, 0.05, 0.8, 0.14);
  // Open northeast yard: warning paint only, accessible from west and south.
  for (const x of [13.8, 18.5]) paint(x, -16, 0.2, 6, M.hazard);
  paint(16.15, -18.9, 4.7, 0.2, M.hazard);
  // Low cover stays off the square, axes, outer loop and all seven crate sites.
  for (const [x, z] of [[-5, -10], [5, 10]]) box(x, z, 1.2, 2, 0.85, M.barrier);
  for (const [x, z] of [[-11, 14], [11, -14]]) {
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 16), M.rust, x, 0.45, z));
    for (const y of [0.25, 0.65]) add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16), M.plinth, x, y, z);
    colliders.push({ x, z, r: 0.4, height: 0.9 });
  }

  groundDetail(decor);
  outskirts(decor, M);
  scene.add(g, decor);
  return { group: g, decor, colliders };
}

/** Flat marks on the street: manholes, stains, litter. No height, no collision. */
function groundDetail(parent) {
  const r = rand(31);
  const decor = new THREE.Group();
  parent.add(decor);
  const lay = (geo, mat, x, z, y, rot = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    decor.add(m);
    return m;
  };
  const decal = (color) => toon(color);
  const manhole = decal('#4a4f5c'), ring = decal(HEX.ink);
  for (const [x, z] of [[-16, -4], [16, 5], [-4, 16], [6, -16], [-14, 18]]) {
    lay(new THREE.RingGeometry(0.42, 0.5, 20), ring, x, z, 0.03);
    lay(new THREE.CircleGeometry(0.42, 20), manhole, x, z, 0.028);
    for (let k = -1; k <= 1; k++) lay(new THREE.PlaneGeometry(0.6, 0.04), ring, x, z + k * 0.15, 0.031);
  }
  const stain = new THREE.MeshBasicMaterial({ color: '#2a2c3a', transparent: true, opacity: 0.22, depthWrite: false });
  for (let k = 0; k < 18; k++) {
    const x = (r() - 0.5) * 38, z = (r() - 0.5) * 38;
    if (Math.abs(x) < 6 && Math.abs(z) < 6) continue;
    lay(new THREE.CircleGeometry(0.4 + r() * 0.9, 12), stain, x, z, 0.02 + k * 0.0004).scale.set(1, 0.5 + r() * 0.6, 1);
  }
  const paper = decal('#f1e8d4');
  for (let k = 0; k < 26; k++) {
    const x = (r() - 0.5) * 38, z = (r() - 0.5) * 38;
    lay(new THREE.PlaneGeometry(0.22, 0.3), paper, x, z, 0.034, r() * 6.3);
  }
  for (const m of decor.children) m.layers.set(NO_INK_LAYER);
}

/** Beyond the walls: lamp posts, power lines, wrecked cars and a hazy skyline. */
function outskirts(decor, M) {
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = mesh(geo, mat, x, y, z, { ry });
    decor.add(m);
    return m;
  };
  add(new THREE.PlaneGeometry(240, 240), toon(COL.paver), 0, -0.02, 0).rotation.x = -Math.PI / 2;

  // Street lamps just outside the wall, leaning their heads over it.
  const pole = toon('#3d4152'), bulb = flat(COL.lamp);
  for (const s of [-1, 1]) {
    for (let t = -16; t <= 16; t += 8) {
      for (const [x, z, ry] of [[t, s * 21.2, s > 0 ? 0 : Math.PI], [s * 21.2, t, s > 0 ? Math.PI / 2 : -Math.PI / 2]]) {
        if (Math.abs(x) > 20 && Math.abs(Math.abs(z) - 10) < 3.5) continue; // keep the gates clear
        const lamp = new THREE.Group();
        lamp.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.2, 8), pole, 0, 2.6, 0));
        lamp.add(mesh(B(0.08, 0.08, 1.2), pole, 0, 5.15, -0.55));
        lamp.add(mesh(B(0.32, 0.12, 0.42), pole, 0, 5.08, -1.12));
        const glow = mesh(B(0.24, 0.04, 0.32), bulb, 0, 5.0, -1.12, { shadow: false });
        lamp.add(glow);
        lamp.position.set(x, 0, z);
        lamp.rotation.y = ry;
        decor.add(lamp);
      }
    }
  }

  // Utility poles with sagging cables along north and south.
  const wood = toon('#6b4e3a');
  const cable = new THREE.MeshBasicMaterial({ color: HEX.ink });
  for (const s of [-1, 1]) {
    const z = s * 23.5, xs = [-24, -12, 0, 12, 24];
    for (const x of xs) {
      add(new THREE.CylinderGeometry(0.11, 0.14, 8, 8), wood, x, 4, z);
      add(B(1.6, 0.12, 0.12), wood, x, 7.4, z);
    }
    for (let k = 0; k < xs.length - 1; k++) {
      for (const dx of [-0.65, 0.65]) {
        const a = new THREE.Vector3(xs[k] + dx, 7.45, z), b = new THREE.Vector3(xs[k + 1] + dx, 7.45, z);
        const mid = a.clone().lerp(b, 0.5); mid.y -= 0.9;
        const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 16, 0.025, 4), cable);
        wire.layers.set(NO_INK_LAYER);
        decor.add(wire);
      }
    }
  }

  // Wrecked cars parked outside, a little tilted.
  const CARS = [[-25, 4, 0.3, '#b4544a'], [24, -4, -0.2, '#5f86b3'], [6, 25, 1.4, '#d8b04a'], [-9, -25.5, 1.7, '#7aa07a'], [23.5, 16, 0.1, '#e1d9c8']];
  for (const [x, z, ry, color] of CARS) {
    const car = new THREE.Group();
    const body = toon(color), glass = toon(COL.glass), tyre = toon(HEX.ink);
    car.add(mesh(B(1.8, 0.7, 4), body, 0, 0.55, 0));
    car.add(mesh(B(1.6, 0.6, 2.1), body, 0, 1.2, -0.2));
    car.add(mesh(B(1.64, 0.42, 1.7), glass, 0, 1.22, -0.2));
    for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) {
      const w = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12), tyre, wx, 0.34, wz);
      w.rotation.z = Math.PI / 2;
      car.add(w);
    }
    car.position.set(x, 0, z);
    car.rotation.set(0, ry, (x * 7 % 3 - 1) * 0.04);
    decor.add(car);
  }

  // Hazy skyline: a ring of plain blocks that the fog turns mauve.
  const r = rand(77);
  const tints = ['#c9a3a6', '#b8a3b8', '#cfae9e', '#ad9fbb'].map((c) => toon(c));
  const sill = toon('#f0d6ae');
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2 + r() * 0.08, d = 40 + r() * 16;
    const w = 6 + r() * 6, dep = 6 + r() * 6, h = 5 + r() * 9 + (k % 7 === 0 ? 8 : 0);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    add(B(w, h, dep), tints[k % tints.length], x, h / 2, z, a);
    if (r() < 0.45) add(B(w * 1.04, 0.3, dep * 1.04), sill, x, h, z, a);
    if (r() < 0.3) add(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 10), tints[(k + 1) % tints.length], x, h + 0.7, z);
  }
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
