import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { COL, HEX } from '../render/palette.js';

// Hand-built block guns. Each one is designed to be told apart from behind the
// hero at phone size: by outline first (long and thin, short and fat), then by
// material (cold metal, warm wood). Barrels point along +Z.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function piece(mat, w, h, d, x = 0, y = 0, z = 0, tilt = 0) {
  const m = new THREE.Mesh(box(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = tilt;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

let mats;
function materials() {
  return (mats ??= {
    body: toon(COL.gunmetal, { mid: 0.85, shadeInk: 0.25 }),
    steel: toon(COL.steel, { mid: 0.8 }),
    wood: toon(COL.wood, { mid: 0.8 }),
    dark: toon(COL.gunDark, { mid: 0.82, shadeInk: 0.3 }),
    mark: toon(COL.hero),
  });
}

// Part rows: material, width, height, depth, x, y, z, tilt about X.
// The same rows build the 3D model and the flat side-view icon.
const SPECS = {
  /** Long, thin, cold: receiver, slim barrel with a brake, raked magazine, open stock. */
  rifle: {
    muzzle: 0.86, bands: [-0.14, 0.12], bandSize: 0.17,
    parts: [
      ['body', 0.06, 0.05, 0.28, 0, 0.03, -0.35],          // stock tube
      ['dark', 0.08, 0.17, 0.05, 0, -0.02, -0.5],          // butt plate
      ['dark', 0.06, 0.15, 0.08, 0, -0.13, -0.14, -0.25],  // grip
      ['dark', 0.075, 0.26, 0.1, 0, -0.17, 0.1, 0.32],     // magazine, raked forward
      ['steel', 0.045, 0.045, 0.26, 0, 0.02, 0.63],        // barrel
      ['dark', 0.075, 0.075, 0.09, 0, 0.02, 0.79],         // muzzle brake
      ['steel', 0.1, 0.1, 0.3, 0, 0.005, 0.36],            // handguard
      ['body', 0.11, 0.14, 0.44, 0, 0, 0],                 // receiver
      ['dark', 0.04, 0.035, 0.26, 0, 0.09, 0.02],          // top rail
      ['mark', 0.03, 0.06, 0.03, 0, 0.1, 0.46],            // front sight
    ],
  },
  /** Short, fat, warm: twin barrels over a wooden pump, heavy dropped stock, shells on the side. */
  shotgun: {
    muzzle: 0.66, bands: [-0.11, 0.07], bandSize: 0.21,
    parts: [
      ['wood', 0.13, 0.17, 0.32, 0, -0.035, -0.29, 0.12],  // stock, dropped
      ['dark', 0.14, 0.19, 0.04, 0, -0.055, -0.46, 0.12],  // butt pad
      ['dark', 0.06, 0.13, 0.07, 0, -0.14, -0.08, -0.25],  // grip
      ['steel', 0.075, 0.075, 0.5, 0.042, 0.035, 0.39],    // barrels, side by side
      ['steel', 0.075, 0.075, 0.5, -0.042, 0.035, 0.39],
      ['dark', 0.17, 0.035, 0.03, 0, 0.035, 0.635],        // muzzle band
      ['wood', 0.2, 0.12, 0.24, 0, -0.065, 0.32],          // pump
      ['body', 0.15, 0.17, 0.3, 0, 0, 0],                  // receiver
      ['mark', 0.035, 0.05, 0.05, -0.092, 0.02, -0.08],    // spare shells
      ['mark', 0.035, 0.05, 0.05, -0.092, 0.02, -0.005],
      ['mark', 0.035, 0.05, 0.05, -0.092, 0.02, 0.07],
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
