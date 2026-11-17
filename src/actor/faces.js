import * as THREE from 'three';
import { HEX } from '../render/palette.js';

// Faces are drawn with a few ink marks on a flat skin tone, like a comic
// panel. Everything is generated here; there are no image files.
function canvasTex(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function ink(g) {
  g.fillStyle = HEX.ink;
  g.strokeStyle = HEX.ink;
  g.lineCap = 'round';
  g.lineJoin = 'round';
}

export function heroFace() {
  return canvasTex((g, s) => {
    g.fillStyle = HEX.skin;
    g.fillRect(0, 0, s, s);
    ink(g);
    // fringe
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(s, 0); g.lineTo(s, s * 0.3);
    g.lineTo(s * 0.78, s * 0.22); g.lineTo(s * 0.62, s * 0.34); g.lineTo(s * 0.46, s * 0.2);
    g.lineTo(s * 0.26, s * 0.32); g.lineTo(s * 0.12, s * 0.2); g.lineTo(0, s * 0.3);
    g.closePath(); g.fill();
    // brows + eyes: determined, slightly narrowed
    g.lineWidth = s * 0.05;
    g.beginPath(); g.moveTo(s * 0.2, s * 0.43); g.lineTo(s * 0.4, s * 0.47); g.stroke();
    g.beginPath(); g.moveTo(s * 0.8, s * 0.43); g.lineTo(s * 0.6, s * 0.47); g.stroke();
    g.fillRect(s * 0.27, s * 0.52, s * 0.09, s * 0.12);
    g.fillRect(s * 0.64, s * 0.52, s * 0.09, s * 0.12);
    // mouth
    g.lineWidth = s * 0.04;
    g.beginPath(); g.moveTo(s * 0.42, s * 0.8); g.lineTo(s * 0.6, s * 0.78); g.stroke();
  });
}

export function zombieFace(seed = 0) {
  return canvasTex((g, s) => {
    g.fillStyle = HEX.zombie;
    g.fillRect(0, 0, s, s);
    ink(g);
    const r = (i) => { const x = Math.sin((seed + 1) * 91.7 + i * 12.9) * 43758.5; return x - Math.floor(x); };
    // uneven hollow eyes
    g.lineWidth = s * 0.045;
    const eye = (cx, cy, rr) => { g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke(); g.fillRect(cx - rr * 0.25, cy - rr * 0.25, rr * 0.5, rr * 0.5); };
    eye(s * 0.3, s * (0.44 + r(1) * 0.06), s * (0.08 + r(2) * 0.04));
    if (r(3) > 0.4) eye(s * 0.7, s * (0.42 + r(4) * 0.06), s * (0.07 + r(5) * 0.04));
    else { // X eye
      g.beginPath(); g.moveTo(s * 0.62, s * 0.36); g.lineTo(s * 0.78, s * 0.52);
      g.moveTo(s * 0.78, s * 0.36); g.lineTo(s * 0.62, s * 0.52); g.stroke();
    }
    // stitched, sagging mouth
    g.lineWidth = s * 0.04;
    g.beginPath(); g.moveTo(s * 0.22, s * 0.76); g.quadraticCurveTo(s * 0.5, s * (0.68 + r(6) * 0.08), s * 0.8, s * 0.78); g.stroke();
    g.lineWidth = s * 0.025;
    for (let i = 0; i < 5; i++) {
      const x = s * (0.3 + i * 0.11);
      g.beginPath(); g.moveTo(x, s * 0.68); g.lineTo(x, s * 0.82); g.stroke();
    }
    // a scar
    g.lineWidth = s * 0.03;
    g.beginPath(); g.moveTo(s * 0.12, s * 0.12); g.lineTo(s * 0.36, s * 0.26); g.stroke();
  });
}

/** Torn shirt front with a blood mark, for zombie torsos. */
export function zombieShirt(seed = 0, cloth = HEX.zombieCloth) {
  return canvasTex((g, s) => {
    g.fillStyle = cloth;
    g.fillRect(0, 0, s, s);
    ink(g);
    const r = (i) => { const x = Math.sin((seed + 3) * 51.3 + i * 7.1) * 43758.5; return x - Math.floor(x); };
    // ragged hem
    g.fillStyle = HEX.zombie;
    g.beginPath(); g.moveTo(0, s);
    for (let i = 0; i <= 8; i++) g.lineTo((i / 8) * s, s * (0.78 + (i % 2 ? 0.12 : 0) + r(i) * 0.06));
    g.lineTo(s, s); g.closePath(); g.fill();
    g.fillStyle = HEX.blood;
    g.beginPath(); g.ellipse(s * (0.3 + r(9) * 0.4), s * 0.4, s * 0.14, s * 0.18, r(10), 0, Math.PI * 2); g.fill();
    ink(g);
    g.lineWidth = s * 0.03;
    g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(s * 0.5, s * 0.25); g.stroke();
  }, 64);
}

/** Jacket front: zip and a pocket, for the hero. */
export function heroJacket() {
  return canvasTex((g, s) => {
    g.fillStyle = HEX.hero;
    g.fillRect(0, 0, s, s);
    ink(g);
    g.lineWidth = s * 0.04;
    g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(s * 0.5, s); g.stroke();
    g.beginPath(); g.moveTo(s * 0.18, s * 0.62); g.lineTo(s * 0.38, s * 0.62); g.stroke();
    g.fillRect(0, s * 0.88, s, s * 0.12);
  }, 64);
}
