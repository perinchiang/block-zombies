import * as THREE from 'three';
import { HEX } from './palette.js';

// Hand-drawn surface textures, painted on canvases at load time. They carry the
// small detail (cracks, tiles, brickwork) so the geometry can stay as plain
// boxes: detail drawn in a thin pen, silhouettes in the thick ink line pass.

const cache = new Map();

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function tex(key, size, draw, { repeat = true, height = size } = {}) {
  if (cache.has(key)) return cache.get(key);
  // Headless tools (navigation tests) build the arena without a DOM: looks only, so skip.
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = height;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  draw(g, size, height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}

/** A wobbly pen stroke through the given points, so lines never look ruled. */
function pen(g, pts, r, wobble = 1.2) {
  g.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = (r() - 0.5) * wobble, jy = (r() - 0.5) * wobble;
    i ? g.lineTo(x + jx, y + jy) : g.moveTo(x + jx, y + jy);
  });
  g.stroke();
}

/** Branching hairline crack starting at (x, y). */
function crack(g, r, x, y, len, angle) {
  const pts = [[x, y]];
  for (let i = 0; i < 5; i++) {
    angle += (r() - 0.5) * 1.1;
    x += Math.cos(angle) * len / 5; y += Math.sin(angle) * len / 5;
    pts.push([x, y]);
    if (r() < 0.25) pen(g, [[x, y], [x + Math.cos(angle + 1) * len / 6, y + Math.sin(angle + 1) * len / 6]], r, 0);
  }
  pen(g, pts, r, 0);
}

/** Wrap-safe draw: repeats a mark across the tile seams. */
function wrap(s, x, y, f) {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) f(x + dx, y + dy);
}

/** Road surface, one tile = 4 m. */
export function asphaltTex() {
  return tex('asphalt', 512, (g, s) => {
    const r = rng(11);
    g.fillStyle = HEX.asphalt; g.fillRect(0, 0, s, s);
    // repaired patches, slightly darker and lighter than the road
    for (let i = 0; i < 6; i++) {
      const x = r() * s, y = r() * s, w = 40 + r() * 90, h = 30 + r() * 60;
      g.fillStyle = r() < 0.5 ? 'rgba(20,24,40,0.10)' : 'rgba(255,240,220,0.07)';
      wrap(s, x, y, (px, py) => g.fillRect(px, py, w, h));
    }
    // aggregate speckle
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(20,20,35,0.18)' : 'rgba(255,250,235,0.14)';
      g.fillRect(r() * s, r() * s, 2, 2);
    }
    g.strokeStyle = 'rgba(29,27,33,0.55)';
    g.lineWidth = 2;
    for (let i = 0; i < 5; i++) crack(g, r, 40 + r() * (s - 80), 40 + r() * (s - 80), 60 + r() * 70, r() * 6.3);
  });
}

/** Sidewalk flags, one tile = 4 m, 1 m slabs. */
export function paverTex() {
  return tex('pavers', 512, (g, s) => {
    const r = rng(23), n = 4, q = s / n;
    g.fillStyle = HEX.paver; g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '90,60,40' : '255,245,225'},${0.04 + r() * 0.08})`;
      g.fillRect(i * q, j * q, q, q);
    }
    g.strokeStyle = 'rgba(29,27,33,0.45)';
    g.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      pen(g, [[i * q, 0], [i * q, s * 0.5], [i * q, s]], r, 1.5);
      pen(g, [[0, i * q], [s * 0.5, i * q], [s, i * q]], r, 1.5);
    }
    g.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) crack(g, r, r() * s, r() * s, 40 + r() * 40, r() * 6.3);
  });
}

/** Plaza: warm terracotta squares with an inset border tile. 1 tile = 4 m. */
export function plazaTex() {
  return tex('plaza', 512, (g, s) => {
    const r = rng(37), n = 4, q = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? HEX.plaza : HEX.plazaAlt;
      g.fillRect(i * q, j * q, q, q);
      g.fillStyle = `rgba(60,20,10,${r() * 0.08})`;
      g.fillRect(i * q, j * q, q, q);
    }
    g.strokeStyle = 'rgba(29,27,33,0.4)';
    g.lineWidth = 2.4;
    for (let i = 0; i <= n; i++) {
      pen(g, [[i * q, 0], [i * q, s]], r, 1);
      pen(g, [[0, i * q], [s, i * q]], r, 1);
    }
    g.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) crack(g, r, r() * s, r() * s, 30 + r() * 30, r() * 6.3);
  });
}

/** Painted render over brick, one tile = 4 m. Tinted per building by material colour. */
export function stuccoTex() {
  return tex('stucco', 512, (g, s) => {
    const r = rng(51);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    // soft paint strokes
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '120,95,80' : '255,255,255'},${0.05 + r() * 0.06})`;
      g.lineWidth = 8 + r() * 18;
      const x = r() * s, y = r() * s, l = 30 + r() * 60;
      wrap(s, x, y, (px, py) => pen(g, [[px, py], [px + l, py + (r() - 0.5) * 8]], r, 2));
    }
    // plaster fallen away to show brick
    for (let k = 0; k < 2; k++) {
      const cx = 80 + r() * (s - 160), cy = 80 + r() * (s - 160), bw = 22, bh = 11;
      g.save();
      g.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, d = 34 + r() * 22;
        const x = cx + Math.cos(a) * d * 1.4, y = cy + Math.sin(a) * d;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = '#c98f74'; g.fill();
      g.clip();
      g.strokeStyle = 'rgba(29,27,33,0.55)';
      g.lineWidth = 1.6;
      for (let row = 0; row * bh < s; row++) {
        const y = row * bh;
        pen(g, [[0, y], [s, y]], r, 0.6);
        for (let x = (row % 2) * bw / 2; x < s; x += bw) pen(g, [[x, y], [x, y + bh]], r, 0.4);
      }
      g.restore();
      g.strokeStyle = 'rgba(29,27,33,0.7)';
      g.lineWidth = 2.2;
      g.stroke();
    }
    g.strokeStyle = 'rgba(29,27,33,0.5)';
    g.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) crack(g, r, r() * s, r() * s, 40 + r() * 50, 1 + r());
  });
}

/** Precast concrete panels with seams and rust streaks, one tile = 4 m. */
export function concreteTex() {
  return tex('concrete', 512, (g, s) => {
    const r = rng(67);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(90,80,70,${r() * 0.12})`;
      g.fillRect(r() * s, r() * s, 2, 2);
    }
    // rust tears running down from bolts
    for (let i = 0; i < 6; i++) {
      const x = r() * s, y = r() * s * 0.6, len = 40 + r() * 80;
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, 'rgba(150,80,40,0.35)'); grad.addColorStop(1, 'rgba(150,80,40,0)');
      g.fillStyle = grad;
      wrap(s, x, y, (px, py) => g.fillRect(px, py, 4 + r() * 6, len));
    }
    g.strokeStyle = 'rgba(29,27,33,0.5)';
    g.lineWidth = 2.6;
    for (let i = 0; i <= 2; i++) pen(g, [[i * s / 2, 0], [i * s / 2, s]], r, 1);
    g.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) crack(g, r, r() * s, r() * s, 40 + r() * 40, 1.2 + r());
  });
}

/** One window: light frame, deep blue glass with a glint, some with a blind half down. */
export function windowTex(variant = 0) {
  return tex(`window:${variant}`, 128, (g, s) => {
    const r = rng(91 + variant * 7);
    g.fillStyle = HEX.frame; g.fillRect(0, 0, s, s);
    const m = s * 0.12;
    g.fillStyle = HEX.glass; g.fillRect(m, m, s - 2 * m, s - 2 * m);
    if (variant % 3 === 1) { // blind
      g.fillStyle = HEX.blind;
      g.fillRect(m, m, s - 2 * m, (s - 2 * m) * (0.3 + r() * 0.3));
    }
    if (variant % 3 === 2) { // a warm lit room
      g.fillStyle = HEX.lamp;
      g.fillRect(m, m + (s - 2 * m) * 0.45, s - 2 * m, (s - 2 * m) * 0.55);
    }
    // glint: two short parallel strokes
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = s * 0.05;
    pen(g, [[s * 0.28, s * 0.62], [s * 0.5, s * 0.36]], r, 0);
    pen(g, [[s * 0.36, s * 0.7], [s * 0.6, s * 0.42]], r, 0);
    // mullion + ink frame
    g.strokeStyle = HEX.ink;
    g.lineWidth = s * 0.05;
    pen(g, [[s / 2, m], [s / 2, s - m]], r, 0);
    g.strokeRect(m, m, s - 2 * m, s - 2 * m);
    g.lineWidth = s * 0.07;
    g.strokeRect(2, 2, s - 4, s - 4);
  }, { repeat: false });
}

/** Shop sign or poster: cream board, bold ink lettering, coloured border. `aspect` = width / height. */
export function signTex(text, color, aspect = 2.75) {
  return tex(`sign:${text}:${color}:${aspect}`, 512, (g, w, h) => {
    const b = h * 0.12;
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = HEX.signBoard; g.fillRect(b, b, w - 2 * b, h - 2 * b);
    g.fillStyle = HEX.ink;
    g.font = `900 ${Math.round(h * 0.56)}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h * 0.54, w - 4 * b);
    g.strokeStyle = HEX.ink; g.lineWidth = h * 0.05;
    g.strokeRect(b, b, w - 2 * b, h - 2 * b);
  }, { repeat: false, height: Math.round(512 / aspect) });
}

/** Striped cloth or slats; `across` runs the stripes horizontally. */
export function stripeTex(a, b, { across = false, n = 8 } = {}) {
  return tex(`stripe:${a}:${b}:${across}:${n}`, 128, (g, s) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      across ? g.fillRect(0, i * s / n, s, s / n) : g.fillRect(i * s / n, 0, s / n, s);
    }
  });
}

/** Black-and-yellow hazard chevrons. */
export function hazardTex() {
  return tex('hazard', 128, (g, s) => {
    g.fillStyle = HEX.hazard; g.fillRect(0, 0, s, s);
    g.fillStyle = HEX.ink;
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * s / 2, s); g.lineTo(i * s / 2 + s / 4, s); g.lineTo(i * s / 2 + s / 4 + s, 0); g.lineTo(i * s / 2 + s, 0);
      g.closePath(); g.fill();
    }
  });
}

/** Back of the hero's pack: flap, buckles and straps drawn, not modelled. */
export function packTex() {
  return tex('pack', 128, (g, s) => {
    const r = rng(5);
    g.fillStyle = HEX.pack; g.fillRect(0, 0, s, s);
    g.fillStyle = HEX.packDark; g.fillRect(0, 0, s, s * 0.34); // flap
    g.strokeStyle = HEX.ink; g.lineWidth = s * 0.035;
    pen(g, [[0, s * 0.34], [s, s * 0.34]], r, 0.8);
    g.fillStyle = HEX.strap;
    for (const x of [0.24, 0.68]) g.fillRect(s * x, s * 0.2, s * 0.09, s * 0.36);
    // pocket
    g.strokeRect(s * 0.25, s * 0.58, s * 0.5, s * 0.28);
    pen(g, [[s * 0.25, s * 0.66], [s * 0.75, s * 0.66]], r, 0.8);
  }, { repeat: false });
}

/** Plane UVs in metres / tile, so big and small patches share one density. */
export function planeUV(geo, w, d, tile = 4, x = 0, z = 0) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + (uv.getX(i) - 0.5) * w) / tile, (-z + (uv.getY(i) - 0.5) * d) / tile);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Rewrites a box's UVs so each face is mapped in metres / tile. Neighbouring
 * walls then share the same texture density instead of stretching it.
 */
export function worldUV(geo, tile = 4, offset = new THREE.Vector3()) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + offset.x, y = p.getY(i) + offset.y, z = p.getZ(i) + offset.z;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, x / tile, z / tile);
    else if (ax > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geo;
}
