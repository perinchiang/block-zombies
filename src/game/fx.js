import * as THREE from 'three';
import { COL } from '../render/palette.js';
import { flat } from '../render/toon.js';
import { splat } from '../world/arena.js';
import { NO_INK_LAYER } from '../render/inkline.js';

const _to = new THREE.Vector3();

function starShape(outer, inner, points) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const k = i % 2 ? inner : outer * (i % 4 === 0 ? 1.25 : 1);
    const x = Math.cos(a) * k, y = Math.sin(a) * k;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(shape);
}

/** Two-tone comic star: fire rim, pale core. Faces +Z; the caller turns it to the camera. */
function burst(outer, inner, points) {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(starShape(outer, inner, points), flat(COL.fire, { side: THREE.DoubleSide }));
  const core = new THREE.Mesh(starShape(outer * 0.58, inner * 0.6, points), flat(COL.flash, { side: THREE.DoubleSide }));
  core.position.z = 0.02;
  g.add(rim, core);
  return g;
}

// Pooled combat effects. Everything is a flat-coloured mesh so the ink pass
// outlines it like the rest of the panel.
const UP = new THREE.Vector3(0, 1, 0);

export class Fx {
  constructor(scene) {
    this.scene = scene;

    this.camera = null; // set by the host; bursts turn to face it
    this.flash = burst(0.3, 0.1, 8);
    this.flash.visible = false;
    this.flashT = 0;
    scene.add(this.flash);

    // tracers: unit box stretched along each step of a bullet's flight. Pale on
    // pale paper vanished, so the streak is fire orange. It is kept out of the
    // ink pass: an outline around something this thin leaves only the outline.
    const trGeo = new THREE.BoxGeometry(1, 1, 1);
    trGeo.translate(0, 0, 0.5);
    const trMat = flat(COL.fire, { depthWrite: false });
    this.tracers = Array.from({ length: 48 }, () => {
      const m = new THREE.Mesh(trGeo, trMat);
      m.layers.set(NO_INK_LAYER);
      m.visible = false; m.userData.t = 0;
      scene.add(m);
      return m;
    });
    this.trI = 0;

    // impact bursts: the comic "POW" where a round lands
    this.bursts = Array.from({ length: 12 }, () => {
      const b = burst(0.26, 0.11, 6);
      b.visible = false; b.userData.t = 0;
      scene.add(b);
      return b;
    });
    this.buI = 0;

    // reward coins: pop out of the kill, then fly to the hero
    const coinGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 10);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = flat(COL.gold);
    this.coinPool = Array.from({ length: 40 }, () => {
      const m = new THREE.Mesh(coinGeo, coinMat);
      m.visible = false;
      m.userData = { v: new THREE.Vector3(), t: 0, target: null, done: null };
      scene.add(m);
      return m;
    });
    this.coI = 0;

    // flying chunks: blood, zombie flesh, ink, brass shells
    const chunkGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    // Chunks skip the ink pass too: outlined, a 7 cm cube is nothing but outline,
    // and blood, flesh and brass all turn into the same black dots.
    const chunk = (color) => flat(color, { depthWrite: false });
    this.chunkMats = { blood: chunk(COL.blood), flesh: chunk(COL.zombie), ink: chunk(COL.ink), brass: chunk(COL.hero) };
    this.chunks = Array.from({ length: 120 }, () => {
      const m = new THREE.Mesh(chunkGeo, this.chunkMats.blood);
      m.layers.set(NO_INK_LAYER);
      m.visible = false;
      m.userData = { v: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0 };
      scene.add(m);
      return m;
    });
    this.chI = 0;

    // ground decals: a few prebuilt shapes, recycled oldest-first
    this.splatShapes = [1, 2, 3, 5, 8, 13].map((s) => splat(COL.blood, 0.5, s));
    this.inkShapes = [4, 6, 9].map((s) => splat(COL.ink, 0.3, s));
    this.decals = [];
    this.maxDecals = 36;
  }

  muzzle(pos, camera) {
    this.flash.visible = true;
    this.flashT = 0.06;
    this.flash.position.copy(pos);
    this.flash.quaternion.copy(camera.quaternion);
    this.flash.rotateZ(Math.random() * Math.PI);
    this.flash.scale.setScalar(1 + Math.random() * 0.5);
  }

  tracer(from, to) {
    const m = this.tracers[this.trI++ % this.tracers.length];
    const len = from.distanceTo(to);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(0.07, 0.07, len);
    m.visible = true;
    m.userData.t = 0.075;
  }

  /** Star burst where a round lands. size ~1 for a hit, larger for a kill. */
  impact(pos, size = 1) {
    if (!this.camera) return;
    const b = this.bursts[this.buI++ % this.bursts.length];
    b.position.copy(pos);
    b.quaternion.copy(this.camera.quaternion);
    b.rotateZ(Math.random() * Math.PI);
    b.userData.size = size * (0.85 + Math.random() * 0.3);
    b.userData.t = b.userData.life = 0.07 + size * 0.03;
    b.scale.setScalar(b.userData.size * 0.6);
    b.visible = true;
  }

  /**
   * Throw `n` coins up from `from`; each then homes on `target` (a live
   * Vector3, normally the hero) and calls `done` as it lands.
   */
  coins(from, n, target, done = null) {
    for (let i = 0; i < n; i++) {
      const m = this.coinPool[this.coI++ % this.coinPool.length];
      const u = m.userData;
      const a = Math.random() * Math.PI * 2, k = 1 + Math.random() * 1.6;
      m.position.copy(from).setY(Math.max(0.5, from.y));
      u.v.set(Math.cos(a) * k, 3.2 + Math.random() * 1.8, Math.sin(a) * k);
      u.t = -i * 0.035; // staggered so the landing ticks are separate
      u.target = target;
      u.done = done;
      m.rotation.y = Math.random() * Math.PI;
      m.visible = true;
    }
  }

  clearCoins() {
    for (const m of this.coinPool) { m.visible = false; m.userData.done = null; }
  }

  spray(pos, dir, n, kind = 'blood', speed = 3) {
    for (let i = 0; i < n; i++) {
      const m = this.chunks[this.chI++ % this.chunks.length];
      m.material = this.chunkMats[kind];
      m.position.copy(pos);
      const u = m.userData;
      u.v.set(dir.x + (Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 1.2, dir.z + (Math.random() - 0.5) * 1.4).multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      u.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      u.t = 0.5 + Math.random() * 0.5;
      const s = kind === 'brass' ? 0.6 : 0.7 + Math.random() * 0.9;
      m.scale.set(s, kind === 'brass' ? 0.5 : s, kind === 'brass' ? 1.4 : s);
      m.visible = true;
    }
  }

  shell(from, right) {
    this.spray(from, right.clone().multiplyScalar(0.8), 1, 'brass', 1.6);
  }

  decal(x, z, ink = false) {
    const src = ink ? this.inkShapes : this.splatShapes;
    let d;
    if (this.decals.length >= this.maxDecals) d = this.decals.shift();
    else { d = src[Math.floor(Math.random() * src.length)].clone(); this.scene.add(d); }
    d.position.set(x, 0.02 + (this.decals.length % 6) * 0.002, z);
    d.rotation.y = Math.random() * Math.PI * 2;
    d.scale.setScalar(0.1);
    d.userData.grow = 0;
    d.userData.size = 0.7 + Math.random() * 0.6;
    this.decals.push(d);
  }

  clearDecals() {
    for (const d of this.decals) this.scene.remove(d);
    this.decals.length = 0;
  }

  update(dt) {
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flash.visible = false;
    for (const m of this.tracers) if (m.visible && (m.userData.t -= dt) <= 0) m.visible = false;
    for (const b of this.bursts) {
      if (!b.visible) continue;
      const u = b.userData;
      if ((u.t -= dt) <= 0) { b.visible = false; continue; }
      b.scale.setScalar(u.size * (0.6 + 0.6 * (1 - u.t / u.life))); // snaps open, then is gone
    }
    for (const m of this.coinPool) {
      if (!m.visible) continue;
      const u = m.userData;
      u.t += dt;
      m.rotation.y += dt * 14;
      if (u.t < 0.34) {
        // pop: a short toss so the reward is seen leaving the body
        if (u.t > 0) { u.v.y -= 15 * dt; m.position.addScaledVector(u.v, dt); }
        if (m.position.y < 0.12) { m.position.y = 0.12; u.v.y = Math.abs(u.v.y) * 0.4; }
        continue;
      }
      // home: accelerate into the hero's chest
      _to.copy(u.target).setY(u.target.y + 0.9).sub(m.position);
      const d = _to.length(), step = (9 + (u.t - 0.34) * 40) * dt;
      if (d <= Math.max(0.3, step)) { m.visible = false; u.done?.(); u.done = null; continue; }
      m.position.addScaledVector(_to, step / d);
    }
    for (const m of this.chunks) {
      if (!m.visible) continue;
      const u = m.userData;
      u.t -= dt;
      u.v.y -= 14 * dt;
      m.position.addScaledVector(u.v, dt);
      if (m.position.y < 0.035) { m.position.y = 0.035; u.v.multiplyScalar(0.35); u.v.y = Math.abs(u.v.y) * 0.3; u.spin.multiplyScalar(0.5); }
      m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt;
      if (u.t <= 0) m.visible = false;
    }
    for (const d of this.decals) {
      if (d.userData.grow < 1) {
        d.userData.grow = Math.min(1, d.userData.grow + dt * 6);
        const g = 1 - (1 - d.userData.grow) ** 3;
        d.scale.setScalar(d.userData.size * g);
      }
    }
  }
}
export { UP };
