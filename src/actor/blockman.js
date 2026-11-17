import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { COL, ZOMBIE_CLOTHES } from '../render/palette.js';
import { packTex } from '../render/textures.js';
import { heroFace, zombieFace, zombieShirt, heroJacket } from './faces.js';
import { buildGun, GUN_SCALE } from './guns.js';

// Big-headed block figure. Limbs are rigid boxes that swing from a pivot:
// the stiffness is the style, so there is no skinning or IK anywhere.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  leg: box(0.19, 0.42, 0.22),
  torso: box(0.46, 0.5, 0.28),
  arm: box(0.15, 0.46, 0.16),
  headZ: box(0.48, 0.48, 0.48),
  headH: box(0.5, 0.5, 0.5),
};
export const ZOMBIE_VARIANTS = 8;

// Materials are shared per look so a horde costs no extra shader setup.
const cache = new Map();
function looks(kind, variant) {
  const key = `${kind}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const zombie = kind === 'zombie';
  const [shirt, trousers] = zombie ? ZOMBIE_CLOTHES[variant % ZOMBIE_CLOTHES.length] : [COL.hero, COL.heroDark];
  const m = {
    skin: toon(zombie ? COL.zombie : COL.skin),
    cloth: toon(shirt),
    pants: toon(trousers, { shadeInk: 0.1 }),
    hair: toon(zombie ? COL.ink : COL.hair, { mid: 0.85 }),
    face: toon(0xffffff, { map: zombie ? zombieFace(variant) : heroFace() }),
    chest: toon(0xffffff, { map: zombie ? zombieShirt(variant, shirt) : heroJacket() }),
  };
  cache.set(key, m);
  return m;
}
const FLASH = toon(COL.paper, { mid: 1 });

function part(geo, mat, y = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.position.y = y;
  return m;
}
/** Box material array with one decorated face (+Z). */
const faced = (plain, front) => [plain, plain, plain, plain, front, plain];

export class BlockMan {
  constructor({ kind = 'zombie', variant = 0 } = {}) {
    this.kind = kind;
    this.t = Math.random() * 10;
    this.flashT = 0;
    this.hitReact = 0; // seconds remaining; parent sets 0.18 on a controlled hit
    this.recoil = 0;
    const zombie = kind === 'zombie';
    const M = looks(kind, zombie ? variant % ZOMBIE_VARIANTS : 0);

    this.root = new THREE.Group();     // world placement + facing
    this.root.rotation.order = 'YXZ';  // yaw first, then topple
    this.body = new THREE.Group();     // bob / lean
    this.root.add(this.body);

    // The model faces +Z, so its own left side is +X.
    this.legL = new THREE.Group(); this.legL.position.set(0.11, 0.42, 0);
    this.legR = new THREE.Group(); this.legR.position.set(-0.11, 0.42, 0);
    this.legL.add(part(GEO.leg, M.pants, -0.21));
    this.legR.add(part(GEO.leg, M.pants, -0.21));
    this.body.add(this.legL, this.legR);

    this.torso = new THREE.Group(); this.torso.position.y = 0.42;
    this.torso.add(part(GEO.torso, faced(M.cloth, M.chest), 0.25));
    this.body.add(this.torso);

    this.head = new THREE.Group(); this.head.position.y = 0.5;
    const hs = zombie ? 0.48 : 0.5;
    this.head.add(part(zombie ? GEO.headZ : GEO.headH, faced(M.skin, M.face), hs / 2));
    if (!zombie) {
      const cap = part(box(hs * 1.06, hs * 0.22, hs * 1.06), M.hair, hs + 0.02);
      const back = part(box(hs * 1.06, hs * 0.86, hs * 0.18), M.hair, hs * 0.57);
      back.position.z = -hs * 0.46;
      // Paper headband, knotted at the back: the mark you follow from behind.
      const cloth = toon(COL.paper, { mid: 0.86 });
      const band = part(box(hs * 1.1, hs * 0.16, hs * 1.1), cloth, hs * 0.74);
      this.head.add(cap, back, band);
    }
    this.torso.add(this.head);

    // arms pivot at the shoulder; rotation.x < 0 raises them forward
    this.armL = new THREE.Group(); this.armL.position.set(0.31, 0.46, 0);
    this.armR = new THREE.Group(); this.armR.position.set(-0.31, 0.46, 0);
    const sleeve = zombie ? M.skin : M.cloth;
    this.armL.add(part(GEO.arm, sleeve, -0.2));
    this.armR.add(part(GEO.arm, sleeve, -0.2));
    this.torso.add(this.armL, this.armR);

    if (!zombie) {
      // Backpack and bedroll: most of the game is spent looking at this side.
      // Two big shapes only; flap, straps and pocket are drawn on the pack so
      // the ink pass does not outline a cluster of tiny boxes.
      const leather = toon(COL.pack, { mid: 0.84 });
      const packBack = toon(0xffffff, { map: packTex(), mid: 0.84 });
      const pack = part(box(0.32, 0.34, 0.16), [leather, leather, leather, leather, leather, packBack], 0.26); pack.position.z = -0.21;
      const roll = part(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 12), toon(COL.blind, { mid: 0.86 }), 0.5);
      roll.rotation.z = Math.PI / 2; roll.position.z = -0.2;
      this.torso.add(pack, roll);

      this.gun = new THREE.Group();
      this.weaponBands = [];
      this.guns = {};
      for (const id of ['rifle', 'shotgun']) {
        const bands = [];
        const gun = this.guns[id] = buildGun(id, bands);
        gun.visible = id === 'rifle';
        this.gun.add(gun);
        for (const band of bands) this.weaponBands.push(band);
      }
      this.rifle = this.guns.rifle;
      this.shotgun = this.guns.shotgun;
      this.gun.scale.setScalar(GUN_SCALE);
      // Carried on the outside of the forearm so it is not hidden behind the arm
      // from the shoulder camera.
      this.gun.position.set(-0.1, -0.44, 0.13);
      this.gun.rotation.set(Math.PI / 2 - 0.37, 0, 0); // level the barrel despite the lowered arm
      this.armR.add(this.gun);
      this.muzzle = new THREE.Object3D();
      this.muzzle.position.set(0, 0.02, this.rifle.userData.muzzle);
      this.gun.add(this.muzzle);
    }

    this.meshes = [];
    this.root.traverse((o) => { if (o.isMesh) { o.userData.mat = o.material; this.meshes.push(o); } });
    this.speed = 1;
    this.lean = 0.18;
    this.fall = 0;          // 0 standing .. 1 flat on the ground
    this.pose(0);
  }

  setWeapon(id) {
    if (!this.gun) return;
    this.weaponId = id;
    const shown = Object.hasOwn(this.guns, id) ? id : 'rifle';
    for (const [key, gun] of Object.entries(this.guns)) gun.visible = key === shown;
    this.muzzle.position.z = this.guns[shown].userData.muzzle;
  }

  setWeaponLevel(level) {
    this.weaponLevel = Math.max(1, Math.floor(Number(level) || 1));
    for (const band of this.weaponBands ?? []) band.mesh.visible = this.weaponLevel >= band.level;
  }

  /** 0 = see-through, 1 = solid. Lets the street show when the camera is pushed in. */
  setGhost(alpha) {
    const a = Math.max(0.16, Math.min(1, alpha));
    if (a === this.ghost) return;
    this.ghost = a;
    for (const m of this.meshes) {
      for (const mat of [].concat(m.userData.mat)) { mat.transparent = a < 1; mat.opacity = a; }
    }
  }

  /** Brief paper-white flash, the comic "hit" frame. */
  flash(t = 0.07) {
    this.flashT = t;
    for (const m of this.meshes) m.material = FLASH;
  }

  pose(dt, walk = 0) {
    this.t += dt;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) {
      for (const m of this.meshes) m.material = m.userData.mat;
    }
    const hitLean = Math.min(1, Math.max(0, this.hitReact) / 0.18);
    this.hitReact = Math.max(0, this.hitReact - dt);
    this.body.rotation.x = -hitLean * 0.48;
    const t = this.t;
    if (this.kind === 'zombie') {
      const p = t * 4.2 * this.speed;
      const s = Math.sin(p) * walk;
      this.legL.rotation.x = s * 0.55;
      this.legR.rotation.x = -s * 0.55;
      // classic arms-out shamble: arms stay raised, only sway a little
      this.armL.rotation.x = -1.35 + Math.sin(p + 0.6) * 0.12 - this.reach * 0.3;
      this.armR.rotation.x = -1.45 + Math.sin(p + 2.0) * 0.12 - this.reach * 0.3;
      this.armL.rotation.z = -0.08;
      this.armR.rotation.z = 0.05;
      this.torso.rotation.x = this.lean + this.reach * 0.25;
      this.torso.rotation.z = Math.sin(p * 0.5) * 0.08;
      this.head.rotation.z = 0.22 + Math.sin(p * 0.5 + 1) * 0.06;
      this.head.rotation.x = 0.1;
      this.body.position.y = Math.abs(Math.cos(p)) * 0.05 * walk;
      // topple backwards from the feet
      this.root.rotation.x = -this.fall * Math.PI / 2;
      this.body.position.y += this.fall * 0.15;
    } else {
      const p = t * 9;
      const s = Math.sin(p) * walk;
      this.legL.rotation.x = s * 0.7;
      this.legR.rotation.x = -s * 0.7;
      this.recoil = Math.max(0, this.recoil - dt * (this.weaponId === 'shotgun' ? 5 : 12));
      // shouldered rifle: right arm points forward, left arm braces the barrel
      this.armR.rotation.set(-1.2 - this.recoil * 0.25, 0, 0.16);
      this.armL.rotation.set(-1.0 - this.recoil * 0.2, 0, -0.85);
      this.gun.position.z = 0.13 - this.recoil * 0.07;
      this.torso.rotation.y = -0.12;
      this.torso.rotation.x = -(this.aimPitch ?? 0) - this.recoil * 0.04;
      this.head.rotation.y = 0.12;
      this.body.position.y = Math.abs(Math.cos(p)) * 0.06 * walk + Math.sin(t * 2) * 0.008;
    }
  }
}
BlockMan.prototype.reach = 0;
