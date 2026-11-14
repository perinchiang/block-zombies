import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { COL } from '../render/palette.js';
import { heroFace, zombieFace, zombieShirt, heroJacket } from './faces.js';

// Big-headed block figure. Limbs are rigid boxes that swing from a pivot:
// the stiffness is the style, so there is no skinning or IK anywhere.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function part(geo, mat, y = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.position.y = y;
  return m;
}

/** Box with one decorated face (+Z) and plain sides. */
function faced(geo, plain, front) {
  return [plain, plain, plain, plain, front, plain];
}

export class BlockMan {
  constructor({ kind = 'zombie', seed = 0 } = {}) {
    this.kind = kind;
    this.seed = seed;
    this.t = Math.random() * 10;
    const zombie = kind === 'zombie';

    const skin = toon(zombie ? COL.zombie : COL.skin, { hatch: false });
    const cloth = toon(zombie ? COL.zombieCloth : COL.hero);
    const pants = toon(zombie ? COL.rust : COL.heroDark, { shadeInk: 0.35 });
    const hair = toon(COL.ink, { hatch: false });
    const face = toon(0xffffff, { map: zombie ? zombieFace(seed) : heroFace(), hatch: false });
    const chest = toon(0xffffff, { map: zombie ? zombieShirt(seed) : heroJacket() });

    this.root = new THREE.Group();     // world placement + facing
    this.body = new THREE.Group();     // bob / lean
    this.root.add(this.body);

    // legs (pivot at hip)
    this.legL = new THREE.Group(); this.legL.position.set(0.11, 0.42, 0);
    this.legR = new THREE.Group(); this.legR.position.set(-0.11, 0.42, 0);
    this.legL.add(part(box(0.19, 0.42, 0.22), pants, -0.21));
    this.legR.add(part(box(0.19, 0.42, 0.22), pants, -0.21));
    this.body.add(this.legL, this.legR);

    // torso
    this.torso = new THREE.Group(); this.torso.position.y = 0.42;
    const t = part(box(0.46, 0.5, 0.28), faced(null, cloth, chest), 0.25);
    this.torso.add(t);
    this.body.add(this.torso);

    // head (pivot at neck)
    this.head = new THREE.Group(); this.head.position.y = 0.5;
    const hs = zombie ? 0.48 : 0.5;
    this.head.add(part(box(hs, hs, hs), faced(null, skin, face), hs / 2));
    if (!zombie) {
      const cap = part(box(hs * 1.06, hs * 0.22, hs * 1.06), hair, hs + 0.02);
      const back = part(box(hs * 1.06, hs * 0.86, hs * 0.18), hair, hs * 0.57);
      back.position.z = -hs * 0.46;
      this.head.add(cap, back);
    }
    this.torso.add(this.head);

    // arms (pivot at shoulder); rotation.x < 0 raises them forward
    this.armL = new THREE.Group(); this.armL.position.set(0.31, 0.46, 0); // model faces +Z: its left is +X
    this.armR = new THREE.Group(); this.armR.position.set(-0.31, 0.46, 0);
    const sleeve = zombie ? skin : cloth;
    this.armL.add(part(box(0.15, 0.46, 0.16), sleeve, -0.2));
    this.armR.add(part(box(0.15, 0.46, 0.16), sleeve, -0.2));
    this.torso.add(this.armL, this.armR);

    if (!zombie) {
      // stubby rifle held at the right hand
      const gunMat = toon(COL.ink, { hatch: false });
      const metal = toon(COL.stone, { mid: 0.7 });
      this.gun = new THREE.Group();
      this.gun.add(part(box(0.1, 0.13, 0.62), gunMat, 0));
      const mag = part(box(0.07, 0.16, 0.08), gunMat, -0.12); mag.position.z = 0.06;
      const barrel = part(box(0.05, 0.05, 0.22), metal, 0.02); barrel.position.z = 0.42;
      const stock = part(box(0.08, 0.1, 0.16), metal, -0.03); stock.position.z = -0.3;
      this.gun.add(mag, barrel, stock);
      this.gun.position.set(0, -0.44, 0.1);
      this.gun.rotation.set(Math.PI / 2 - 0.37, 0, 0); // level the barrel despite the lowered arm
      this.armR.add(this.gun);
      this.muzzle = new THREE.Object3D();
      this.muzzle.position.set(0, 0.02, 0.55);
      this.gun.add(this.muzzle);
    }

    this.speed = zombie ? 0.9 + ((seed * 0.37) % 0.5) : 0;
    this.pose(0);
  }

  /** Advance the procedural pose. walk is 0..1 blend. */
  pose(dt, walk = 0) {
    this.t += dt;
    const t = this.t;
    if (this.kind === 'zombie') {
      const p = t * 4.2 * this.speed;
      const s = Math.sin(p) * walk;
      this.legL.rotation.x = s * 0.55;
      this.legR.rotation.x = -s * 0.55;
      // classic arms-out shamble: arms stay raised, only sway a little
      this.armL.rotation.x = -1.35 + Math.sin(p + 0.6) * 0.12;
      this.armR.rotation.x = -1.45 + Math.sin(p + 2.0) * 0.12;
      this.armL.rotation.z = -0.08;
      this.armR.rotation.z = 0.05;
      this.torso.rotation.x = 0.18;
      this.torso.rotation.z = Math.sin(p * 0.5) * 0.08;
      this.head.rotation.z = 0.22 + Math.sin(p * 0.5 + 1) * 0.06;
      this.head.rotation.x = 0.1;
      this.body.position.y = Math.abs(Math.cos(p)) * 0.05 * walk;
    } else {
      const p = t * 9;
      const s = Math.sin(p) * walk;
      this.legL.rotation.x = s * 0.7;
      this.legR.rotation.x = -s * 0.7;
      // shouldered rifle: right arm points forward, left arm braces the barrel
      this.armR.rotation.set(-1.2, 0, 0.08);
      this.armL.rotation.set(-1.0, 0, -0.85);
      this.torso.rotation.y = -0.12;
      this.head.rotation.y = 0.12;
      this.body.position.y = Math.abs(Math.cos(p)) * 0.06 * walk + Math.sin(t * 2) * 0.008;
    }
  }
}
