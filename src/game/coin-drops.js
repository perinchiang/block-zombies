import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { COL } from '../render/palette.js';

export class CoinDrops {
  constructor(scene, capacity = 4) {
    this.scene = scene;
    const gold = toon(COL.gold, { hatch: false, mid: 0.86, shadeInk: 0.2 });
    const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.07, 12);
    this.items = Array.from({ length: capacity }, () => {
      const root = new THREE.Group();
      // A short stack with one coin standing on top and spinning.
      for (let i = 0; i < 3; i++) {
        const coin = new THREE.Mesh(disc, gold);
        coin.position.set((i - 1) * 0.05, -0.16 + i * 0.075, i === 1 ? 0.05 : 0);
        coin.castShadow = true;
        coin.userData.noBulletCollision = true;
        root.add(coin);
      }
      const mesh = new THREE.Mesh(disc, gold);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.3;
      mesh.castShadow = true;
      mesh.userData.noBulletCollision = true;
      root.add(mesh);
      root.visible = false;
      scene.add(root);
      return { root, mesh, value: 0, active: false, phase: 0 };
    });
  }

  get pendingValue() { return this.items.reduce((sum, item) => sum + (item.active ? item.value : 0), 0); }

  drop(position, value) {
    const item = this.items.find(candidate => !candidate.active);
    if (!item || !(value > 0)) return false;
    item.active = true;
    item.value = value;
    item.phase = 0;
    item.root.position.copy(position).setY(0.45);
    item.root.visible = true;
    item.root.scale.setScalar(value > 3 ? 1.25 : 0.85);
    return true;
  }

  update(dt, round) {
    if (dt <= 0 || round?.state !== 'play') return;
    const hero = round.hero.root.position;
    for (const item of this.items) {
      if (!item.active) continue;
      item.phase += dt;
      item.mesh.rotation.y += dt * 5;
      item.root.position.y = 0.42 + Math.sin(item.phase * 3) * 0.08;
      const distance = item.root.position.distanceTo(hero);
      if (distance <= 2.5) {
        const value = item.value;
        item.active = false;
        item.root.visible = false;
        item.value = 0;
        round.awardCoins('pickups', value, item.root.position);
      } else if (distance < 5) {
        item.root.position.lerp(hero.clone().setY(0.45), Math.min(1, dt * 2.5));
      }
    }
  }

  collectAll(round) {
    for (const item of this.items) {
      if (!item.active) continue;
      const value = item.value;
      item.active = false;
      item.root.visible = false;
      item.value = 0;
      round.awardCoins('pickups', value, item.root.position);
    }
  }

  clear() {
    for (const item of this.items) {
      item.active = false;
      item.value = 0;
      item.root.visible = false;
    }
  }
}
