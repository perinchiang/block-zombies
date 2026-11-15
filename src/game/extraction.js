import * as THREE from 'three';
import { toon, flat } from '../render/toon.js';
import { COL } from '../render/palette.js';

export const EXTRACTION = { signal: 90, deadline: 240, hold: 5 };
const POSITIONS = [[0, -5], [-16, -4], [-16, 15], [0, 16], [16, 5], [0, -16], [15, -17]];

// Fixed supplies around the loop; evacuation is a shared central landmark.
export class Extraction {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    const paper = toon(COL.paper), ink = toon(COL.ink), wood = toon(COL.wallAlt), red = toon(COL.blood);
    const box = (w, h, d, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    this.crates = POSITIONS.map(([x, z], i) => {
      const root = new THREE.Group(); root.position.set(x, 0, z); this.root.add(root);
      const rare = i === POSITIONS.length - 1;
      box(0.95, 0.65, 0.85, rare ? red : wood, 0, 0.325, 0, root);
      const lid = box(1.05, 0.12, 0.95, rare ? red : paper, 0, 0.72, 0, root);
      box(0.15, 0.48, 0.02, ink, 0, 0.4, 0.436, root);
      box(0.48, 0.15, 0.02, ink, 0, 0.4, 0.437, root);
      const marker = box(0.24, 0.24, 0.24, paper, 0, 1.55, 0, root);
      marker.rotation.z = Math.PI / 4;
      marker.userData.noBulletCollision = true;
      const lock = new THREE.Group();
      if (rare) {
        box(0.45, 0.08, 0.9, ink, 0, 0.82, 0, lock);
        box(0.3, 0.3, 0.12, ink, 0, 0.56, 0.5, lock);
        root.add(lock);
      }
      return { x, z, root, lid, marker, lock, rare, locked: rare, value: rare ? 180 : 30 + i * 12, opened: false, progress: 0 };
    });
    this.evac = { x: 0.5, z: 0, radius: 1.25 };
    this.vehicle = new THREE.Group(); this.vehicle.position.set(2.8, 0, 0); this.root.add(this.vehicle);
    this.vehicleColliders = [{ x: 2.8, z: 0, halfX: 1.1, halfZ: 2, height: 2.35 }];
    box(1.8, 1.2, 3.8, paper, 0, 1, 0, this.vehicle);
    box(1.6, 0.7, 1.4, wood, 0, 1.85, -0.8, this.vehicle);
    box(1.62, 0.45, 0.05, ink, 0, 1.85, -1.52, this.vehicle);
    for (const x of [-0.95, 0.95]) for (const z of [-1.2, 1.2]) box(0.22, 0.55, 0.55, ink, x, 0.35, z, this.vehicle);
    box(0.6, 0.14, 0.6, ink, 0, 2.28, -0.8, this.vehicle);
    // Door on the west side, directly beside the boarding area.
    box(0.05, 0.95, 0.75, ink, -0.92, 1.05, 0, this.vehicle);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.25, 48), flat(COL.ink, { side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.set(this.evac.x, 0.035, this.evac.z); this.root.add(this.ring);
    this.recovery = new THREE.Group(); this.recovery.position.set(-4.5, 0, 3.5); this.root.add(this.recovery);
    box(0.7, 0.65, 0.65, paper, 0, 0.325, 0, this.recovery);
    box(0.12, 0.4, 0.05, red, 0, 0.4, 0.35, this.recovery);
    box(0.4, 0.12, 0.05, red, 0, 0.4, 0.35, this.recovery);
    this.reset();
  }
  reset() {
    for (const c of this.crates) {
      c.opened = false; c.progress = 0; c.locked = c.rare;
      c.lock.visible = c.rare; c.marker.visible = !c.rare; c.lid.rotation.x = 0;
    }
    this.vehicle.visible = this.ring.visible = false;
    this.recovered = false; this.recovery.visible = true;
  }
  unlockRare() {
    const c = this.crates.find(c => c.rare);
    c.locked = false; c.lock.visible = false; c.marker.visible = true;
  }

  update(round, dt) {
    const p = round.hero.root.position;
    round.evacOpen = round.elapsed >= EXTRACTION.signal && round.elapsed < EXTRACTION.deadline;
    round.missed = round.elapsed >= EXTRACTION.deadline;
    this.vehicle.visible = this.ring.visible = round.evacOpen;
    if (round.vehiclePresent !== round.evacOpen) {
      round.vehiclePresent = round.evacOpen;
      round.colliders = round.evacOpen ? [...round.staticColliders, ...this.vehicleColliders] : round.staticColliders;
      round.collide(p, 0.3);
    }
    if (!this.recovered && round.hp < 5 && p.distanceTo(this.recovery.position) < 1.5) {
      this.recovered = true; this.recovery.visible = false; round.hp++;
      round.notice = '急救补给：恢复一格生命'; round.noticeT = 3;
    }
    if (round.evacOpen && !round.signaled) {
      round.signaled = true; round.notice = '撤离车已到中央广场！在车门旁累计登车 5 秒'; round.noticeT = 6;
    }
    if (round.missed && !round.departed) {
      round.departed = true; round.notice = '末班车已离开！尸潮失控，倒下仍能保留 25% 金币'; round.noticeT = 8;
    }
    round.nearbyCrate = null;
    let nearest = 1.65;
    for (const c of this.crates) {
      c.marker.position.y = 1.55 + Math.sin(round.elapsed * 3) * 0.12;
      if (c.opened || c.locked) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < nearest) { nearest = d; round.nearbyCrate = c; }
    }
    for (const c of this.crates) {
      if (c.opened || c.locked) continue;
      if (c === round.nearbyCrate && dt > 0) {
        c.opened = true; c.marker.visible = false; c.lid.rotation.x = -1.1;
        round.loot += c.value; round.opened++;
        round.notice = `物资入袋 +${c.value} 金币 · 撤离才可全部带走`; round.noticeT = 3;
      }
    }
    if (round.evacOpen && Math.hypot(p.x - this.evac.x, p.z - this.evac.z) <= this.evac.radius) {
      round.extracting = Math.min(EXTRACTION.hold, round.extracting + dt);
      if (round.extracting >= EXTRACTION.hold) round.finish(true);
    }
    // Leaving the circle pauses (rather than resets) the five-second rescue.
  }
}
