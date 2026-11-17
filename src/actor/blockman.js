import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { COL, ZOMBIE_CLOTHES } from '../render/palette.js';
import { heroFace, heroHairFace, heroJacketBack, zombieFace, zombieShirt, heroJacket } from './faces.js';
import { buildGun, GUN_SCALE } from './guns.js';

// Big-headed block figure. Limbs are rigid boxes that swing from a pivot:
// the stiffness is the style, so there is no skinning or IK anywhere.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  leg: box(0.19, 0.42, 0.22),
  torso: box(0.46, 0.5, 0.28),
  arm: box(0.15, 0.46, 0.16),
  headZ: box(0.48, 0.48, 0.48),
  headH: box(0.62, 0.62, 0.62),
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
const UP = new THREE.Vector3(0, 1, 0);
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
    for (const leg of [this.legL, this.legR]) {
      leg.add(part(zombie ? GEO.leg : box(0.19, 0.31, 0.22), M.pants, zombie ? -0.21 : -0.155));
      if (!zombie) {
        const boot = part(box(0.205, 0.13, 0.29), toon(COL.gunDark), -0.355);
        boot.position.z = 0.025;
        leg.add(boot);
      }
    }
    this.body.add(this.legL, this.legR);

    this.torso = new THREE.Group(); this.torso.position.y = 0.42;
    const jacket = faced(M.cloth, M.chest);
    if (!zombie) jacket[5] = toon(0xffffff, { map: heroJacketBack() });
    this.torso.add(part(GEO.torso, jacket, 0.25));
    this.body.add(this.torso);

    this.head = new THREE.Group(); this.head.position.y = 0.5;
    const hs = zombie ? 0.48 : 0.62;
    const headMaterials = faced(M.skin, M.face);
    if (!zombie) {
      headMaterials[0] = toon(0xffffff, { map: heroHairFace(true, false) });
      headMaterials[1] = toon(0xffffff, { map: heroHairFace(true, true) });
      headMaterials[2] = M.hair;
      headMaterials[5] = toon(0xffffff, { map: heroHairFace() });
    }
    this.head.add(part(zombie ? GEO.headZ : GEO.headH, headMaterials, hs / 2));
    if (!zombie) {
      const cap = part(box(0.65, 0.12, 0.65), M.hair, 0.61);
      cap.name = 'hair-cap';
      // The band stands 3 cm beyond the head on every side; no rear hair shell.
      const band = part(box(0.68, 0.085, 0.68), toon(COL.paper, { mid: 0.92 }), 0.455);
      band.name = 'headband';
      this.head.add(cap, band);
    }
    this.torso.add(this.head);

    // arms pivot at the shoulder; rotation.x < 0 raises them forward
    this.armL = new THREE.Group(); this.armL.position.set(0.31, 0.46, 0);
    this.armR = new THREE.Group(); this.armR.position.set(-0.31, 0.46, 0);
    if (zombie) {
      this.armL.add(part(GEO.arm, M.skin, -0.2));
      this.armR.add(part(GEO.arm, M.skin, -0.2));
      this.torso.add(this.armL, this.armR);
    } else {
      // Two rigid, authored segments per arm. Hands belong to the weapon;
      // sleeves bridge shoulder -> elbow -> wrist, without skinning or an IK solver.
      this.armL.position.set(0, 0, 0); this.armR.position.set(0, 0, 0);
      for (const arm of [this.armL, this.armR]) {
        arm.add(part(box(0.15, 1, 0.15), M.cloth));
        arm.add(part(box(0.135, 1, 0.135), M.cloth));
      }
      this.body.add(this.armL, this.armR);
      this.weaponRig = new THREE.Group();
      this.weaponRig.position.set(0, 0.85, 0);
      this.body.add(this.weaponRig);
      this.armMatrix = new THREE.Matrix4();
      this.shoulderPoint = new THREE.Vector3();
      this.elbowPoint = new THREE.Vector3();
      this.wristPoint = new THREE.Vector3();
      this.segmentDirection = new THREE.Vector3();

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
      // Leave room for the wider headband and level-four weapon rings even
      // when the barrel is raised past the cheek.
      this.gun.position.set(-0.51, -0.015, 0.3);
      this.weaponRig.add(this.gun);
      const glove = toon(COL.gunmetal, { mid: 0.95 });
      this.handR = part(box(0.125, 0.135, 0.14), glove);
      this.handL = part(box(0.14, 0.12, 0.15), glove);
      this.handR.name = 'grip-hand'; this.handL.name = 'support-hand';
      this.gun.add(this.handR, this.handL);
      this.muzzle = new THREE.Object3D();
      this.muzzle.position.set(0, 0.02, this.rifle.userData.muzzle);
      this.gun.add(this.muzzle);
      this.setWeapon('rifle');
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
    const spec = this.guns[shown].userData;
    this.muzzle.position.set(0, 0.02, spec.muzzle);
    this.handR.position.fromArray(spec.grip);
    this.handL.position.fromArray(spec.support);
  }

  poseArms() {
    this.torso.updateMatrix();
    this.weaponRig.updateMatrix();
    this.gun.updateMatrix();
    this.armMatrix.multiplyMatrices(this.weaponRig.matrix, this.gun.matrix);
    for (const [arm, hand, side] of [[this.armL, this.handL, 1], [this.armR, this.handR, -1]]) {
      const shoulder = this.shoulderPoint.set(side * 0.275, 0.43, 0).applyMatrix4(this.torso.matrix);
      const wrist = this.wristPoint.copy(hand.position).applyMatrix4(this.armMatrix);
      const elbow = this.elbowPoint.copy(shoulder).lerp(wrist, 0.46);
      elbow.x += side * 0.11;
      elbow.y -= 0.13;
      elbow.z -= 0.04;
      this.poseSegment(arm.children[0], shoulder, elbow);
      this.poseSegment(arm.children[1], elbow, wrist);
    }
  }

  poseSegment(mesh, from, to) {
    const direction = this.segmentDirection.subVectors(to, from);
    const length = direction.length();
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.y = length;
    mesh.quaternion.setFromUnitVectors(UP, direction.divideScalar(length));
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
      const pitch = this.aimPitch ?? 0;
      this.torso.rotation.set(-pitch * 0.18 - this.recoil * 0.025, -0.07, 0);
      this.head.rotation.set(-pitch * 0.22, 0.07, 0);
      // The weapon takes the aim angle; the torso only follows a little.
      this.weaponRig.rotation.x = -pitch - this.recoil * 0.1;
      this.gun.position.z = 0.3 - this.recoil * 0.065;
      this.poseArms();
      this.body.position.y = Math.abs(Math.cos(p)) * 0.06 * walk + Math.sin(t * 2) * 0.008;
    }
  }
}
BlockMan.prototype.reach = 0;
