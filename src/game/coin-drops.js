import * as THREE from 'three';

export class CoinDrops {
  constructor(scene, capacity = 4) {
    this.scene = scene;
    this.items = Array.from({ length: capacity }, () => {
      const root = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color: 0xe0ad35, roughness: 0.48, metalness: 0.45 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.28), material);
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
    item.mesh.material.color.setHex(value > 3 ? 0xf1c94b : 0xc69b45);
    item.root.scale.setScalar(value > 3 ? 1.2 : 0.8);
    return true;
  }

  update(dt, round) {
    if (dt <= 0 || round?.state !== 'play') return;
    const hero = round.hero.root.position;
    for (const item of this.items) {
      if (!item.active) continue;
      item.phase += dt;
      item.root.rotation.y += dt * 2.5;
      item.root.position.y = 0.42 + Math.sin(item.phase * 3) * 0.08;
      const distance = item.root.position.distanceTo(hero);
      if (distance <= 2.5) {
        const value = item.value;
        item.active = false;
        item.root.visible = false;
        item.value = 0;
        round.awardCoins('pickups', value);
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
      round.awardCoins('pickups', value);
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
