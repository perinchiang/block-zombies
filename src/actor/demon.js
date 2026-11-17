import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { COL } from '../render/palette.js';

// One shared box and palette for every demon; posing allocates no resources.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const MAT = {
  red: toon(COL.blood, { shadeInk: 0.15 }),
  ink: toon(COL.ink),
  cream: toon(COL.paper),
};
const FLASH = toon(COL.paper, { mid: 1 });

function block(parent, material, w, h, d, x, y, z = 0) {
  const mesh = new THREE.Mesh(BOX, material);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A heavy, +Z-facing comic demon. Round owns AI, health and projectiles. */
export class Demon {
  constructor() {
    this.kind = 'demon';
    this.t = Math.random() * 10;
    this.speed = 0.8;
    this.fall = 0;
    this.cast = 0;
    this.flashT = 0;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.root.add(this.body);

    // Broad boots and short legs support a 2.2m silhouette, 1.1m at shoulders.
    for (const [name, side] of [['legL', 1], ['legR', -1]]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.23, 0.62, 0);
      block(leg, MAT.red, 0.3, 0.51, 0.34, 0, -0.255);
      block(leg, MAT.ink, 0.35, 0.2, 0.44, 0, -0.52, 0.04);
      this.body.add(leg);
      this[name] = leg;
    }

    this.torso = new THREE.Group();
    this.torso.position.y = 0.62;
    this.body.add(this.torso);
    block(this.torso, MAT.red, 0.76, 0.85, 0.46, 0, 0.425);
    block(this.torso, MAT.ink, 0.78, 0.12, 0.48, 0, 0.08);
    block(this.torso, MAT.cream, 0.16, 0.14, 0.04, 0, 0.08, 0.26);
    // Ink collar and sternum keep the red mass readable at game distance.
    block(this.torso, MAT.ink, 0.64, 0.12, 0.04, 0, 0.73, 0.25);
    block(this.torso, MAT.ink, 0.08, 0.33, 0.04, 0, 0.51, 0.25);

    for (const [name, side] of [['armL', 1], ['armR', -1]]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.4, 0.73, 0);
      block(arm, MAT.red, 0.3, 0.28, 0.48, 0, -0.02);
      block(arm, MAT.red, 0.26, 0.48, 0.3, 0, -0.29);
      block(arm, MAT.ink, 0.28, 0.12, 0.33, 0, -0.47);
      block(arm, MAT.red, 0.3, 0.25, 0.36, 0, -0.62, 0.02);
      this.torso.add(arm);
      this[name] = arm;
    }
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, -0.75, 0.1);
    this.armR.add(this.muzzle);

    this.head = new THREE.Group();
    this.head.position.y = 0.85;
    this.torso.add(this.head);
    block(this.head, MAT.red, 0.66, 0.53, 0.52, 0, 0.265);
    block(this.head, MAT.ink, 0.46, 0.14, 0.035, 0, 0.13, 0.275);
    for (const side of [-1, 1]) {
      block(this.head, MAT.cream, 0.085, 0.12, 0.045, side * 0.15, 0.14, 0.3);
      block(this.head, MAT.ink, 0.23, 0.13, 0.04, side * 0.17, 0.355, 0.275);
      block(this.head, MAT.cream, 0.13, 0.055, 0.045, side * 0.17, 0.345, 0.3);
      const brow = block(this.head, MAT.ink, 0.26, 0.065, 0.05, side * 0.17, 0.425, 0.3);
      brow.rotation.z = side * 0.18;
      // Short, stepped box horns, with dark roots and blunt cream tips.
      block(this.head, MAT.ink, 0.23, 0.13, 0.28, side * 0.25, 0.53, -0.025);
      block(this.head, MAT.cream, 0.19, 0.2, 0.23, side * 0.27, 0.63, -0.025);
    }
    block(this.head, MAT.red, 0.12, 0.14, 0.12, 0, 0.26, 0.3);

    this.meshes = [];
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.userData.mat = o.material;
        this.meshes.push(o);
      }
    });
    this.pose(0);
  }

  flash(t = 0.08) {
    this.flashT = Math.max(0, t);
    for (const mesh of this.meshes) {
      mesh.material = this.flashT > 0 ? FLASH : mesh.userData.mat;
    }
  }

  pose(dt, walk = 0) {
    this.t += dt;
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      if (this.flashT === 0) {
        for (const mesh of this.meshes) mesh.material = mesh.userData.mat;
      }
    }
    const fall = THREE.MathUtils.clamp(this.fall, 0, 1);
    const cast = THREE.MathUtils.clamp(this.cast, 0, 1) * (1 - fall);
    const stride = THREE.MathUtils.clamp(walk, 0, 1) * (1 - fall);
    const p = this.t * 4.2 * this.speed;
    const swing = Math.sin(p) * stride;
    this.legL.rotation.x = swing * 0.38;
    this.legR.rotation.x = -swing * 0.38;
    this.armL.rotation.x = -0.12 - swing * 0.2 - cast * 0.35;
    // Lift the throwing fist above the head and behind the shoulder at windup.
    this.armR.rotation.x = -0.12 + swing * 0.2 - cast * 3.2;
    this.armL.rotation.z = 0;
    this.armR.rotation.z = cast * 0.12;
    this.torso.rotation.x = -cast * 0.08;
    this.torso.rotation.y = cast * 0.15;
    this.torso.rotation.z = Math.sin(p) * stride * 0.025;
    this.head.rotation.y = -cast * 0.15;
    this.body.position.y = Math.abs(Math.sin(p)) * stride * 0.035 + fall * 0.27;
    this.root.rotation.x = -fall * Math.PI / 2;
  }
}
