import * as THREE from 'three';
import { COL } from '../render/palette.js';
import { flat } from '../render/toon.js';
import { splat, muzzleFlash } from '../world/arena.js';

// Pooled combat effects. Everything is a flat-coloured mesh so the ink pass
// outlines it like the rest of the panel.
const UP = new THREE.Vector3(0, 1, 0);

export class Fx {
  constructor(scene) {
    this.scene = scene;

    this.flash = muzzleFlash();
    this.flash.visible = false;
    this.flashT = 0;
    scene.add(this.flash);

    // tracers: unit box stretched between muzzle and impact
    const trGeo = new THREE.BoxGeometry(1, 1, 1);
    trGeo.translate(0, 0, 0.5);
    const trMat = flat(COL.flash);
    this.tracers = Array.from({ length: 8 }, () => {
      const m = new THREE.Mesh(trGeo, trMat);
      m.visible = false; m.userData.t = 0;
      scene.add(m);
      return m;
    });
    this.trI = 0;

    // flying chunks: blood, zombie flesh, ink, brass shells
    const chunkGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    this.chunkMats = { blood: flat(COL.blood), flesh: flat(COL.zombie), ink: flat(COL.ink), brass: flat(COL.hero) };
    this.chunks = Array.from({ length: 120 }, () => {
      const m = new THREE.Mesh(chunkGeo, this.chunkMats.blood);
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
    this.flashT = 0.05;
    this.flash.position.copy(pos);
    this.flash.quaternion.copy(camera.quaternion);
    this.flash.rotateZ(Math.random() * Math.PI);
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
  }

  tracer(from, to) {
    const m = this.tracers[this.trI++ % this.tracers.length];
    const len = from.distanceTo(to);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(0.035, 0.035, len);
    m.visible = true;
    m.userData.t = 0.045;
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
