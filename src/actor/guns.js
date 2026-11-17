import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { COL, HEX } from '../render/palette.js';
import { setInkWeight } from '../render/inkline.js';

// Hand-built block guns. Each one is designed to be told apart from behind the
// hero at phone size: by outline first (long and thin, short and fat), then by
// material (cold metal, warm wood). Barrels point along +Z.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function piece(mat, w, h, d, x = 0, y = 0, z = 0, tilt = 0) {
  const m = new THREE.Mesh(setInkWeight(box(w, h, d), 0.5), mat);
  m.position.set(x, y, z);
  m.rotation.x = tilt;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

let mats;
function materials() {
  return (mats ??= {
    body: toon(COL.gunmetal, { mid: 0.95, shadeInk: 0.04 }),
    steel: toon(COL.steel, { mid: 0.8 }),
    wood: toon(COL.wood, { mid: 0.8 }),
    dark: toon(COL.gunDark, { mid: 0.9, shadeInk: 0.06 }),
    mark: toon(COL.hero),
  });
}

// Part rows: material, width, height, depth, x, y, z, tilt about X.
// The same rows build the 3D model and the flat side-view icon.
const SPECS = {
  // Broad light handguard and barrel; a compact stock never hides the receiver.
  rifle: {
    muzzle: 0.755, grip: [0, -0.13, -0.12], support: [0, -0.11, 0.25],
    bands: [-0.08, 0.1], bandSize: 0.215,
    parts: [
      ['body', 0.12, 0.10, 0.21, 0, 0.015, -0.27],
      ['dark', 0.14, 0.14, 0.035, 0, 0, -0.385],
      ['dark', 0.085, 0.18, 0.10, 0, -0.13, -0.12, -0.12],
      ['body', 0.11, 0.22, 0.12, 0, -0.17, 0.07, 0.24],
      ['steel', 0.09, 0.09, 0.24, 0, 0.02, 0.59],
      ['body', 0.12, 0.12, 0.06, 0, 0.02, 0.72],
      ['steel', 0.17, 0.15, 0.3, 0, 0.005, 0.32],
      ['body', 0.18, 0.19, 0.36, 0, 0, 0],
      ['mark', 0.09, 0.035, 0.16, 0, 0.113, 0.02],
    ],
  },
  // Wide twin barrels and a single warm wooden pump: no tiny shell clutter.
  shotgun: {
    muzzle: 0.63, grip: [0, -0.13, -0.10], support: [0, -0.135, 0.25],
    bands: [-0.09, 0.09], bandSize: 0.245,
    parts: [
      ['wood', 0.16, 0.16, 0.25, 0, -0.025, -0.245, 0.08],
      ['dark', 0.175, 0.18, 0.035, 0, -0.035, -0.38, 0.08],
      ['dark', 0.09, 0.17, 0.1, 0, -0.13, -0.1, -0.12],
      ['steel', 0.105, 0.105, 0.46, 0.06, 0.035, 0.39],
      ['steel', 0.105, 0.105, 0.46, -0.06, 0.035, 0.39],
      ['body', 0.24, 0.15, 0.045, 0, 0.025, 0.6],
      ['wood', 0.23, 0.16, 0.26, 0, -0.065, 0.28],
      ['body', 0.21, 0.2, 0.3, 0, 0, 0],
    ],
  },
};

export const GUN_SCALE = 1.2;

/**
 * Build one gun. `bands` collects the upgrade rings (levels 2-4) so the
 * owner can reveal them; muzzle distance is in the gun's own space.
 */
export function buildGun(id, bands = []) {
  const M = materials();
  const spec = SPECS[id] ?? SPECS.rifle;
  const g = new THREE.Group();
  for (const [mat, ...rest] of spec.parts) g.add(piece(M[mat], ...rest));
  const [from, to] = spec.bands;
  for (let level = 2; level <= 4; level++) {
    const band = piece(M.mark, spec.bandSize, spec.bandSize, 0.03, 0, 0, from + (to - from) * ((level - 2) / 2));
    band.visible = false;
    g.add(band);
    bands.push({ mesh: band, level });
  }
  g.userData.muzzle = spec.muzzle;
  g.userData.grip = spec.grip;
  g.userData.support = spec.support;
  return g;
}

const FILL = { body: HEX.gunmetal, steel: HEX.steel, wood: HEX.wood, dark: HEX.gunDark, mark: HEX.hero };

/** Flat side view of a gun as inline SVG, barrel to the right, for the HUD and shop. */
export function gunIcon(id, level = 1) {
  const spec = SPECS[id] ?? SPECS.rifle;
  const rows = spec.parts.map(([mat, , h, d, , y, z, tilt = 0]) => ({ fill: FILL[mat], h, d, y, z, tilt }));
  const [from, to] = spec.bands;
  for (let l = 2; l <= Math.min(4, level); l++) {
    rows.push({ fill: FILL.mark, h: spec.bandSize, d: 0.03, y: 0, z: from + (to - from) * ((l - 2) / 2), tilt: 0 });
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const r of rows) {
    const reach = Math.hypot(r.d, r.h) / 2;
    x0 = Math.min(x0, r.z - reach); x1 = Math.max(x1, r.z + reach);
    y0 = Math.min(y0, -r.y - reach); y1 = Math.max(y1, -r.y + reach);
  }
  const f = (n) => +n.toFixed(3);
  const rects = rows.map((r) => `<rect x="${f(r.z - r.d / 2)}" y="${f(-r.y - r.h / 2)}" width="${f(r.d)}" height="${f(r.h)}" fill="${r.fill}"${
    r.tilt ? ` transform="rotate(${f(THREE.MathUtils.radToDeg(r.tilt))} ${f(r.z)} ${f(-r.y)})"` : ''}/>`).join('');
  return `<svg class="gun-icon" viewBox="${f(x0 - 0.03)} ${f(y0 - 0.03)} ${f(x1 - x0 + 0.06)} ${f(y1 - y0 + 0.06)}" aria-hidden="true"><g stroke="${HEX.ink}" stroke-width="0.024" stroke-linejoin="round">${rects}</g></svg>`;
}
