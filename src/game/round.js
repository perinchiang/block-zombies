import * as THREE from 'three';
import { BlockMan } from '../actor/blockman.js';
import { BOUNDS } from '../world/arena.js';
import { Extraction, EXTRACTION } from './extraction.js';
import { Buffs } from './buffs.js';
import { WEAPONS } from './weapons.js';
import { DemonEncounter } from './demon-encounter.js';
import { Ballistics } from './ballistics.js';

// Fixed-street extraction playtest. Combat tuning stays here.
export const TUNE = {
  length: EXTRACTION.deadline,
  hearts: 5,
  heroSpeed: 3.4,
  heroSpeedFiring: 2.6,
  fireRate: 9,           // shots per second
  mag: 24,
  reload: 1.25,
  range: 24,
  zombieHp: 3,
  runnerHp: 2,
  walkSpeed: [1.05, 1.45],
  runnerSpeed: 2.9,
  biteRange: 0.85,
  biteWindup: 0.38,
  biteCooldown: 1.0,
  invuln: 0.85,
  maxAlive: 24,
  // spawn interval eases from start to end across the round
  spawnStart: 1.3,
  spawnEnd: 0.4,
  spawnNear: 14,         // ahead spawns appear this far .. +spawnSpread away
  spawnSpread: 7,
  runnerFrom: 20,        // seconds elapsed before runners appear
  runnerChance: 0.3,
  behindFrom: 14,        // seconds elapsed before some come from behind
  behindChance: 0.3
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Round {
  constructor({ scene, colliders, scenery = [], fx, sfx, hooks, profile = null }) {
    this.scene = scene;
    this.colliders = colliders;
    this.fx = fx;
    this.sfx = sfx;
    this.hooks = hooks;
    this.hero = new BlockMan({ kind: 'hero' });
    scene.add(this.hero.root);
    this.pool = Array.from({ length: TUNE.maxAlive + 6 }, (_, i) => {
      const z = new BlockMan({ kind: 'zombie', variant: i });
      z.root.visible = false;
      z.active = false;
      z.vel = new THREE.Vector3();
      scene.add(z.root);
      return z;
    });
    this.encounter = new DemonEncounter(scene);
    this.pool.push(this.encounter.actor);
    this.weapon = WEAPONS.rifle;
    this.extraction = new Extraction(scene);
    this.crates = this.extraction.crates;
    this.evac = this.extraction.evac;
    this.profile = profile;
    this.bank = profile?.coins ?? 0;
    this.buffs = new Buffs(scene);
    this.buffTimers = this.buffs.timers;
    this.aimInfo = { zombie: null, point: new THREE.Vector3(), blocked: false };
    this.ballistics = new Ballistics(this, [...scenery, ...this.crates.map(c => c.root), this.extraction.vehicle]);
    this.state = 'idle';
    this.reset();
  }

  reset(weaponId = this.weapon.id, { trial = false } = {}) {
    this.trial = trial;
    if (this.profile) this.bank = this.profile.coins;
    this.weapon = WEAPONS[weaponId] ?? WEAPONS.rifle;
    const h = this.hero;
    h.setWeapon(this.weapon.id);
    h.root.position.set(0, 0, -14); // mid-street: room ahead and behind
    h.root.rotation.set(0, 0, 0);
    this.yaw = Math.PI;              // facing -Z, down the street
    this.pitch = -0.18;
    h.aimPitch = this.pitch;
    h.recoil = 0;
    h.pose(0);
    this.ballistics.clear();
    this.hp = TUNE.hearts;
    this.time = TUNE.length;
    this.elapsed = 0;
    this.kills = 0;
    this.loot = 0;
    this.opened = 0;
    this.pressure = 0;
    this.noise = 0;
    this.extracting = 0;
    this.evacOpen = this.missed = this.signaled = this.departed = false;
    this.nearbyCrate = null;
    this.notice = '靠近带十字标记的物资箱，自动拾取物资';
    this.noticeT = 7;
    this.extraction.reset();
    this.buffs.reset();
    this.shots = 0;
    this.hits = 0;
    this.ammo = this.weapon.mag;
    this.reloadT = 0;
    this.cool = 0;
    this.invuln = 0;
    this.spawnT = 0.6;
    this.groanT = 1.5;
    this.maxAlive = 0;
    this.heroFall = 0;
    this.aimInfo.zombie = null;
    this.heroKick = new THREE.Vector3();
    for (const z of this.pool) this.retire(z);
    this.encounter.reset();
    this.fx.clearDecals();
    // a few already shambling down the street so the first second has a target
    for (const [x, zz] of [[-1.2, -23], [1.6, -26], [0.2, -29]]) this.spawn(x, zz, false, false);
    this.resolveAim();
  }

  start() { this.state = 'play'; }

  get alive() { return this.pool.filter((z) => z.active && !z.dead).length; }

  // ---- spawning ------------------------------------------------------------
  retire(z) {
    z.active = false;
    z.dead = false;
    z.root.visible = false;
  }

  spawn(x, zPos, runner, rise = true) {
    const z = this.pool.find((p) => !p.active && !p.demon);
    if (!z) return null;
    z.active = true;
    z.dead = false;
    z.deadT = 0;
    z.fall = 0;
    z.root.visible = true;
    z.root.position.set(x, rise ? -1.3 : 0, zPos);
    z.root.rotation.set(0, 0, 0);
    z.rise = rise ? 0 : 1;
    z.runner = runner;
    z.hp = runner ? TUNE.runnerHp : TUNE.zombieHp;
    z.speed = (runner ? TUNE.runnerSpeed : THREE.MathUtils.lerp(TUNE.walkSpeed[0], TUNE.walkSpeed[1], Math.random())) * (this.missed ? 1.6 : 1);
    z.lean = runner ? 0.45 : 0.18;
    z.vel.set(0, 0, 0);
    z.biteT = 0;
    z.biteCool = 0.4;
    z.reach = 0;
    z.yaw = 0;
    return z;
  }

  spawnTick(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const k = this.pressure / 100;
    this.spawnT = THREE.MathUtils.lerp(TUNE.spawnStart, TUNE.spawnEnd, k * k * (3 - 2 * k)) * (0.7 + Math.random() * 0.6) * (this.missed ? 0.45 : 1);
    if (this.alive >= TUNE.maxAlive) return;
    const h = this.hero.root.position;
    const behind = this.elapsed > TUNE.behindFrom && Math.random() < TUNE.behindChance;
    const runner = this.elapsed > TUNE.runnerFrom && Math.random() < (this.missed ? 0.85 : TUNE.runnerChance * (0.4 + k));
    // 'ahead' and 'behind' are relative to where the hero is looking
    const fz = Math.cos(this.yaw) >= 0 ? 1 : -1;
    const dist = TUNE.spawnNear + Math.random() * TUNE.spawnSpread;
    let zPos = h.z + (behind ? -fz * (dist - 3) : fz * dist);
    zPos = THREE.MathUtils.clamp(zPos, BOUNDS.zMin + 2, BOUNDS.zMax - 0.5);
    const x = (Math.random() * 2 - 1) * (BOUNDS.x - 0.8);
    // never pop up on top of the hero
    if (Math.hypot(x - h.x, zPos - h.z) < 6) return;
    this.spawn(x, zPos, runner, true);
    // groups later in the round
    if (k > 0.45 && Math.random() < 0.4 && this.alive < TUNE.maxAlive) this.spawn(THREE.MathUtils.clamp(x + (Math.random() - 0.5) * 2, -BOUNDS.x + 0.5, BOUNDS.x - 0.5), zPos - 1, false, true);
  }

  // ---- movement --------------------------------------------------------------
  /** Push a ground position out of solid props and the street walls. */
  collide(p, r) {
    for (const c of this.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz), m = c.r + r;
      if (d < m && d > 1e-5) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
    }
    p.x = THREE.MathUtils.clamp(p.x, -BOUNDS.x + r, BOUNDS.x - r);
    p.z = THREE.MathUtils.clamp(p.z, BOUNDS.zMin + r, BOUNDS.zMax - r);
  }

  forward(out = _a) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = _b) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  // ---- shooting --------------------------------------------------------------
  chest(z, out) { return out.copy(z.root.position).setY(z.demon ? 1.4 : z.runner ? 0.85 : 0.95); }

  targetable(z) { return z.active && !z.dead && z.rise >= 0.6; }

  // Sight only describes the camera ray. Bullets independently collide along
  // their muzzle path; no target selection or homing changes their direction.
  resolveAim(camera) {
    this.scene.updateMatrixWorld(true);
    const origin = camera ? camera.position.clone() : this.hero.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = camera ? camera.getWorldDirection(new THREE.Vector3()) : this.forward(new THREE.Vector3()).multiplyScalar(Math.cos(this.pitch)).setY(Math.sin(this.pitch));
    const hit = this.ballistics.trace(origin, dir, this.weapon.range + (camera ? 5 : 0));
    this.aimInfo.point.copy(hit.point);
    this.aimInfo.zombie = hit.zombie;
    this.aimInfo.blocked = hit.blocked;
    return this.aimInfo;
  }

  fire(camera) {
    const h = this.hero;
    this.shots++;
    const weapon = this.weapon;
    this.noise = Math.min(45, this.noise + weapon.noise);
    if (!this.buffs.has('frenzy')) this.ammo--;
    this.cool = 1 / (weapon.fireRate * (this.buffs.has('frenzy') ? 1.6 : 1));
    h.recoil = 1;
    let muzzle = h.muzzle.getWorldPosition(new THREE.Vector3());
    const aim = this.resolveAim(camera);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const dir = aim.point.clone().sub(muzzle);
    if (dir.dot(forward) <= 0.05) dir.copy(forward); else dir.normalize();
    // A barrel may protrude beyond a nearby body or wall: inspect the path
    // from the grip first so it cannot spawn bullets on the far side.
    const grip = h.gun.getWorldPosition(new THREE.Vector3());
    const barrel = muzzle.clone().sub(grip);
    const obstruction = this.ballistics.trace(grip, barrel.clone().normalize(), barrel.length());
    if (obstruction.blocked || obstruction.zombie) muzzle = obstruction.point.addScaledVector(barrel.normalize(), 0.0001);
    const shot = { pierce: this.buffs.has('pierce'), blast: this.buffs.has('blast'), hit: false, exploded: false };
    // Spread is relative to the sight plane, including when looking up/down.
    const up = new THREE.Vector3().crossVectors(dir, this.right(new THREE.Vector3())).normalize();
    for (const angle of weapon.pellets) {
      this.ballistics.fire(muzzle, dir.clone().applyAxisAngle(up, angle), weapon, shot);
    }
    this.fx.muzzle(muzzle, camera);
    if (weapon.id === 'shotgun') this.fx.flash.scale.multiplyScalar(1.7);
    this.fx.shell(muzzle, this.right(new THREE.Vector3()));
    this.sfx.shot(weapon.id);
    this.hooks.shake(weapon.id === 'shotgun' ? 0.14 : 0.05);
  }

  damage(hitZ, dir, amount, knockback = 1) {
    if (!this.targetable(hitZ)) return;
    const h = this.hero;
    const end = this.chest(hitZ, new THREE.Vector3());
    hitZ.hp -= amount;
    hitZ.flash();
    if (hitZ.demon) this.encounter.takeHit();
    const push = dir.clone().setY(0);
    hitZ.vel.addScaledVector(push, (hitZ.demon ? 0.3 : hitZ.runner ? 2.2 : 1.6) * knockback);
    if (this.weapon.id === 'shotgun' && !hitZ.demon) { hitZ.biteT = 0; hitZ.biteCool = Math.max(hitZ.biteCool, 0.5); }
    this.fx.spray(end, dir, 5, Math.random() < 0.5 ? 'blood' : 'flesh', 2.4);
    const pan = THREE.MathUtils.clamp((end.x - h.root.position.x) * 0.1, -0.8, 0.8);
    if (hitZ.hp > 0) { this.sfx.hit(pan); return; }
    // kill
    hitZ.dead = true;
    hitZ.deadT = 0;
    hitZ.vel.addScaledVector(push, 2.5);
    this.kills++;
    if (hitZ.demon) this.encounter.defeated(this);
    else if (Math.random() < 0.2) this.buffs.drop(hitZ.root.position);
    this.fx.spray(end, dir, 12, 'blood', 3.2);
    this.fx.spray(end, dir, 5, 'flesh', 2.6);
    this.fx.decal(hitZ.root.position.x + dir.x * 0.8, hitZ.root.position.z + dir.z * 0.8);
    this.sfx.kill(pan);
    this.hooks.hitstop(0.035);
    this.hooks.shake(0.12);
    this.hooks.kill?.(this.kills);
  }

  // ---- per frame -------------------------------------------------------------
  update(dt, input, camera) {
    const h = this.hero, hp = h.root.position;
    const playing = this.state === 'play';
    let walk = 0;

    if (playing && dt > 0) {
      this.buffs.update(dt, hp, true);
      this.elapsed += dt;
      this.noticeT = Math.max(0, this.noticeT - dt);
      this.noise = Math.max(0, this.noise - dt * 0.06);
      this.pressure = Math.min(100, this.elapsed / TUNE.length * 75 + this.noise + (this.missed ? 100 : 0));
      this.time = Math.max(0, TUNE.length - this.elapsed);
      this.yaw += input.turn;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (input.pitch ?? 0), -1.05, 1.05);

      // move relative to facing
      const f = this.forward(_a).clone(), r = this.right(_b).clone();
      const sp = (input.firing ? this.weapon.movingSpeed : TUNE.heroSpeed) * (this.buffs.has('sprint') ? 1.4 : 1);
      const mv = r.multiplyScalar(input.move.x).addScaledVector(f, input.move.y);
      walk = Math.min(1, mv.length());
      hp.addScaledVector(mv, sp * dt);
      hp.addScaledVector(this.heroKick, dt);
      this.heroKick.multiplyScalar(Math.max(0, 1 - dt * 8));
      for (const z of this.pool) {
        if (!z.active || z.dead || z.rise < 0.8) continue;
        const dx = hp.x - z.root.position.x, dz = hp.z - z.root.position.z, d = Math.hypot(dx, dz);
        const spacing = z.demon ? 1.0 : 0.6;
        if (this.buffs.has('sprint') && !z.runner && !z.demon && d < 1.1 && d > 1e-4) {
          z.vel.set(-dx / d * 5, 0, -dz / d * 5);
          z.biteT = 0; z.biteCool = Math.max(z.biteCool, 0.4);
        } else if (d < spacing && d > 1e-4) { hp.x = z.root.position.x + (dx / d) * spacing; hp.z = z.root.position.z + (dz / d) * spacing; }
      }
      this.collide(hp, 0.3);
      h.root.rotation.y = this.yaw;
      h.aimPitch = this.pitch;
      h.pose(0, walk);
      this.hooks.camera?.();
      this.resolveAim(camera);

      // weapon
      this.cool -= dt;
      if (this.buffs.has('frenzy')) {
        this.reloadT = 0;
        this.ammo = this.weapon.mag;
      }
      if (this.reloadT > 0) {
        if ((this.reloadT -= dt) <= 0) { this.ammo = this.weapon.mag; this.reloadT = 0; }
      } else if (input.firing && this.cool <= 0) {
        if (this.ammo > 0) this.fire(camera);
        if (this.ammo <= 0) { this.reloadT = this.weapon.reload; this.sfx.reload(); }
      }
      this.invuln -= dt;
      this.spawnTick(dt);
      this.extraction.update(this, dt, input);
    }
    h.root.rotation.y = this.yaw;
    if (this.state === 'dead') {
      this.heroFall = Math.min(1, this.heroFall + dt * 2.5);
      h.root.rotation.x = -this.heroFall * Math.PI / 2;
      h.body.position.y = this.heroFall * 0.15;
    }
    h.pose(dt, walk);

    this.updateZombies(dt, this.state === 'play' && dt > 0);
    if (dt > 0) this.encounter.update(dt, this, camera);
    this.ballistics.update(dt);
    this.maxAlive = Math.max(this.maxAlive, this.alive);
  }

  updateZombies(dt, playing) {
    if (dt <= 0) return;
    const hp = this.hero.root.position;
    let groanFrom = null;
    for (const z of this.pool) {
      if (!z.active || z.demon) continue;
      const p = z.root.position;
      if (z.dead) {
        z.deadT += dt;
        z.fall = Math.min(1, z.fall + dt * (3 + z.deadT * 4));
        p.addScaledVector(z.vel, dt);
        z.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
        if (z.deadT > 2.6) p.y -= dt * 0.9;       // sink into the street
        if (z.deadT > 3.4) this.retire(z);
        z.pose(dt, 0);
        continue;
      }
      if (z.rise < 1) {
        z.rise = Math.min(1, z.rise + dt * 1.6);
        p.y = -1.3 * (1 - z.rise) ** 2;
        if (Math.random() < dt * 20) this.fx.spray(_c.set(p.x, 0.05, p.z), _a.set(0, 0, 0), 1, 'ink', 1.2);
      }
      const dx = hp.x - p.x, dz = hp.z - p.z, d = Math.hypot(dx, dz) || 1;
      // steer at the hero; runners lead a little
      const want = Math.atan2(dx, dz);
      let dy = want - z.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      z.yaw += dy * Math.min(1, dt * (z.runner ? 8 : 4));
      z.root.rotation.y = z.yaw;
      let walk = 1;
      if (playing && d > TUNE.biteRange * 0.9 && z.rise >= 1) {
        p.x += Math.sin(z.yaw) * z.speed * dt;
        p.z += Math.cos(z.yaw) * z.speed * dt;
      } else walk = z.rise >= 1 ? 0.2 : 0.6;
      p.addScaledVector(z.vel, dt);
      z.vel.multiplyScalar(Math.max(0, 1 - dt * 7));
      // keep the horde from stacking
      for (const o of this.pool) {
        if (o === z || !o.active || o.dead) continue;
        const ox = p.x - o.root.position.x, oz = p.z - o.root.position.z, od = ox * ox + oz * oz;
        if (od < 0.5 && od > 1e-6) { const k = (0.71 - Math.sqrt(od)) * 0.5; const s = Math.sqrt(od); p.x += (ox / s) * k; p.z += (oz / s) * k; }
      }
      if (z.rise >= 1) this.collide(p, 0.3);

      // bite: wind up, then land if still close
      z.biteCool -= dt;
      if (playing && z.rise >= 1) {
        if (z.biteT > 0) {
          z.biteT += dt;
          z.reach = Math.min(1, z.biteT / TUNE.biteWindup);
          if (z.biteT >= TUNE.biteWindup) {
            z.biteT = 0;
            z.biteCool = TUNE.biteCooldown;
            if (d < TUNE.biteRange + 0.25) this.bite(z, dx / d, dz / d);
          }
        } else {
          z.reach = Math.max(0, z.reach - dt * 3);
          if (d < TUNE.biteRange && z.biteCool <= 0) z.biteT = 1e-4;
        }
      }
      if (d < 12 && Math.random() < dt * 0.4) groanFrom = z;
      z.pose(dt, walk);
    }
    this.groanT -= dt;
    if (groanFrom && this.groanT <= 0 && playing) {
      this.groanT = 1.2 + Math.random() * 1.5;
      this.sfx.groan(THREE.MathUtils.clamp((groanFrom.root.position.x - hp.x) * 0.15, -0.8, 0.8), groanFrom.runner ? 1.4 : 1);
    }
  }

  bite(z, nx, nz) {
    if (this.invuln > 0 || this.state !== 'play') return;
    if (this.buffs.consume('shield')) {
      this.invuln = TUNE.invuln;
      z.vel.set(-nx * 5, 0, -nz * 5);
      this.notice = '墨盾挡住了一次扑咬'; this.noticeT = 2;
      this.sfx.hit(0);
      return;
    }
    this.hurtHero(nx, nz);
  }

  hurtHero(nx, nz) {
    if (this.invuln > 0 || this.state !== 'play') return;
    this.hp--;
    this.invuln = TUNE.invuln;
    this.heroKick.set(nx, 0, nz).multiplyScalar(5);
    this.hero.flash(0.1);
    this.sfx.hurt();
    this.hooks.shake(0.3);
    this.hooks.hurt?.(this.hp);
    this.fx.spray(_c.copy(this.hero.root.position).setY(1.0), _a.set(nx, 0, nz), 6, 'blood', 2);
    if (this.hp <= 0) this.finish(false);
  }

  finish(win) {
    if (this.state !== 'play') return;
    this.state = win ? 'win' : 'dead';
    this.encounter.cancelShots();
    this.ballistics.clear();
    if (win) {
      this.sfx.win();
    }
    const carried = this.trial ? 0 : win ? this.loot : Math.floor(this.loot * 0.25);
    if (this.profile) {
      if (!this.trial) this.profile.earn(carried);
      this.bank = this.profile.coins;
    } else this.bank += carried;
    this.hooks.end?.(win, { kills: this.kills, shots: this.shots, hits: this.hits, time: this.elapsed, hp: this.hp,
      loot: this.loot, carried, bank: this.bank, opened: this.opened, weapon: this.weapon.id, trial: this.trial,
      reason: win ? 'evacuated' : this.missed ? 'missed' : 'dead' });
  }
}

// HUD and older callers read round.target.
Object.defineProperty(Round.prototype, 'target', { get() { return this.aimInfo.zombie; } });
