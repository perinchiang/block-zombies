import * as THREE from 'three';
import { isWalkable } from '../world/navigation.js';

export const ENTRANCES = Object.freeze([{ x: -19, z: -10, name: '西侧巷口' }, { x: 19, z: 10, name: '东侧巷口' }]);
export const GRAVES = Object.freeze([{ x: -16, z: 1 }, { x: 16, z: -1 }, { x: 0, z: -15 }, { x: 0, z: 15 }]);
export const GRAVE_WARNING = 2.2;

// Quiet intervals stop new arrivals; enemies already on the map still pursue.
export function encounterPhase(time) {
  if (time < 20) return { gate: 0, interval: 4.2, cap: 7, runners: 0, quiet: false };
  if (time < 45) return { gate: 0, interval: 2.1, cap: 12, runners: 0, quiet: false };
  if (time < 60) return { gate: 0, interval: 99, cap: 12, runners: 0, quiet: true };
  if (time < 90) return { gate: 1, interval: 2.5, cap: 14, runners: 0.12, quiet: false };
  const cycle = Math.floor((time - 90) / 35);
  const quiet = (time - 90) % 35 >= 25;
  return { gate: cycle % 2, interval: Math.max(1.3, 2.2 - cycle * 0.15), cap: Math.min(22, 15 + cycle), runners: 0.18, quiet };
}

export class SpawnDirector {
  constructor(scene) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.warning = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 20), new THREE.MeshBasicMaterial({ color: 0xc43932, side: THREE.DoubleSide, transparent: true }));
    this.warning.rotation.x = -Math.PI / 2;
    this.warning.userData.noBulletCollision = true;
    this.root.add(this.warning);
    this.cracks = new THREE.Group(); this.root.add(this.cracks);
    const mat = new THREE.MeshBasicMaterial({ color: 0x29232c });
    for (let i = 0; i < 5; i++) {
      const crack = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.8), mat);
      const a = i * Math.PI * 2 / 5;
      crack.rotation.y = a; crack.position.set(Math.sin(a) * 0.25, 0.025, Math.cos(a) * 0.25);
      this.cracks.add(crack);
    }
    this.reset();
  }
  reset() {
    this.timer = 1; this.graveTimer = 48; this.pending = null; this.gate = 0;
    this.warning.visible = this.cracks.visible = false;
  }
  clear() { this.pending = null; this.warning.visible = this.cracks.visible = false; }
  update(dt, round) {
    if (dt <= 0 || round.state !== 'play') return;
    const phase = encounterPhase(round.elapsed);
    if (phase.gate !== this.gate) {
      this.gate = phase.gate; this.timer = Math.min(this.timer, 1);
      round.notice = `${ENTRANCES[this.gate].name}传来尸群声`; round.noticeT = 3;
      round.sfx.groan(this.gate ? 0.7 : -0.7, 0.8);
    }
    this.timer -= dt;
    if (!phase.quiet && this.timer <= 0) {
      this.timer = phase.interval * (round.missed ? 0.55 : 1);
      const gate = ENTRANCES[phase.gate];
      const p = round.hero.root.position;
      if (round.alive < phase.cap && Math.hypot(gate.x - p.x, gate.z - p.z) > 3 &&
          !round.pool.some(z => z.active && !z.dead && z.root.position.distanceTo(new THREE.Vector3(gate.x, 0, gate.z)) < 1)) {
        round.spawn(gate.x, gate.z, Math.random() < phase.runners, false);
      }
    }
    this.graveTimer -= dt;
    if (this.pending) {
      this.pending.remaining -= dt;
      this.warning.material.opacity = 0.5 + Math.sin(this.pending.remaining * 16) * 0.25;
      const { x, z } = this.pending;
      if (this.pending.remaining <= 0) {
        // Never spawn directly under someone who stepped onto the warning.
        const p = round.hero.root.position;
        if (Math.hypot(p.x - x, p.z - z) >= 2.2 && round.alive < phase.cap && isWalkable(x, z, 0.45, round.colliders)) round.spawn(x, z, false, true);
        this.clear();
      }
    } else if (this.graveTimer <= 0) {
      this.graveTimer = round.elapsed < 90 ? 27 : 23;
      const p = round.hero.root.position;
      const candidates = GRAVES.map(g => ({ ...g, d: Math.hypot(g.x - p.x, g.z - p.z) }))
        .filter(g => g.d >= 3.5 && g.d <= 12 && isWalkable(g.x, g.z, 0.5, round.colliders)).sort((a, b) => a.d - b.d);
      if (candidates.length && round.alive < phase.cap) {
        const { x, z } = candidates[0];
        this.pending = { x, z, remaining: GRAVE_WARNING };
        this.warning.position.set(x, 0.04, z); this.cracks.position.set(x, 0, z);
        this.warning.visible = this.cracks.visible = true;
        round.notice = '地面裂开了——留意碎土，准备换位'; round.noticeT = GRAVE_WARNING;
        round.sfx.groan(THREE.MathUtils.clamp((x - p.x) / 10, -1, 1), 0.6);
      }
    }
  }
}
