import * as THREE from 'three';
import { BlockMan } from '../actor/blockman.js';
import { resolvePosition, nextWaypoint } from '../world/navigation.js';
import { CampaignDirector, getDay } from './campaign.js';
import { CoinDrops } from './coin-drops.js';
import { Buffs } from './buffs.js';
import { WEAPONS, buildWeapon } from './weapons.js';
import { DemonEncounter } from './demon-encounter.js';
import { Ballistics } from './ballistics.js';

// Day campaign foundation: fixed waves, immediate rewards and durable progression.
export const TUNE = {
  length: 180, // target duration, never a survival timer or win condition
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
  maxAlive: 24
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Round {
  constructor({ scene, colliders, scenery = [], fx, sfx, hooks, profile = null }) {
    this.scene = scene;
    this.staticColliders = colliders;
    this.colliders = [...colliders];
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
    this.director = new CampaignDirector();
    this.coinDrops = new CoinDrops(scene);
    this.profile = profile;
    this.bank = profile?.coins ?? 0;
    this.buffs = new Buffs(scene);
    this.buffTimers = this.buffs.timers;
    this.aimInfo = { zombie: null, point: new THREE.Vector3(), blocked: false };
    this.ballistics = new Ballistics(this, scenery);
    this.state = 'idle';
    this.reset();
  }

  reset(weaponId = this.weapon.id, { trial = false, mode = 'campaign' } = {}) {
    this.trial = trial;
    this.mode = mode === 'challenge' ? 'challenge' : 'campaign';
    this.profile?.refresh();
    this.day = this.mode === 'challenge' ? 2 : (this.profile?.currentDay ?? 1);
    this.dayConfig = getDay(this.day);
    if (this.profile) this.bank = this.profile.coins;
    this.weapon = buildWeapon(Object.hasOwn(WEAPONS, weaponId) ? weaponId : 'rifle', trial ? 1 : Math.max(1, this.profile?.weaponLevel(weaponId) ?? 1));
    const h = this.hero;
    h.setWeapon(this.weapon.id);
    h.setWeaponLevel(this.weapon.level);
    h.root.position.set(0, 0, 5);
    h.root.rotation.set(0, 0, 0);
    this.yaw = Math.PI;              // facing the central plaza
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
    this.income = { kills: 0, pickups: 0, completion: 0 };
    this.coinPulse = { serial: 0, amount: 0, kind: '' };
    this.pressure = 0;
    this.noise = 0;
    this.notice = `${this.mode === 'challenge' ? '金币挑战' : `Day ${this.day}`}：清理所有波次，击杀金币直接到账`;
    this.noticeT = 5;
    this.colliders = this.staticColliders;
    this.director.reset(this.day);
    this.coinDrops.clear();
    this.buffs.reset();
    this.shots = 0;
    this.hits = 0;
    this.ammo = this.weapon.mag;
    this.reloadT = 0;
    this.cool = 0;
    this.invuln = 0;
    this.groanT = 1.5;
    this.maxAlive = 0;
    this.heroFall = 0;
    this.aimInfo.zombie = null;
    this.heroKick = new THREE.Vector3();
    for (const z of this.pool) this.retire(z);
    this.encounter.cancelShots();
    this.fx.clearDecals();
    this.fx.clearCoins?.();
    this.resolveAim();
  }

  start() {
    if (!this.trial && this.mode === 'campaign' && this.profile?.campaignComplete) { this.state = 'shop'; return false; }
    this.state = 'play'; return true;
  }

  get waveIndex() { return this.director.waveIndex; }
  get waveCount() { return this.director.waveCount; }
  get remainingEnemies() { return this.director.remaining(this); }

  /** `at` is where the reward came from; it only drives feedback, never the amount. */
  awardCoins(kind, amount, at = null) {
    if (this.state !== 'play' || this.trial || !['kills', 'pickups'].includes(kind) || !Number.isSafeInteger(amount) || amount <= 0) return 0;
    const credited = this.profile ? this.profile.earn(amount) : amount;
    this.bank = this.profile ? this.profile.coins : this.bank + credited;
    this.income[kind] += credited;
    this.loot += credited;
    this.coinPulse = { serial: this.coinPulse.serial + 1, amount: credited, kind };
    if (credited > 0 && at) this.hooks.reward?.({ kind, amount: credited, at });
    return credited;
  }

  get alive() { return this.pool.filter((z) => z.active && !z.dead).length; }

  // ---- spawning ------------------------------------------------------------
  retire(z) {
    z.active = false;
    z.dead = false;
    z.root.visible = false;
    if (z.bountyMarker) z.bountyMarker.visible = false;
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
    z.speed = runner ? TUNE.runnerSpeed : 1.25;
    z.coinValue = 0; z.coinPackValue = 0;
    if (!z.bountyMarker) {
      z.bountyMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xe6ab32 }));
      z.bountyMarker.position.y = 1.9;
      z.bountyMarker.userData.noBulletCollision = true;
      z.root.add(z.bountyMarker);
    }
    z.bountyMarker.visible = false;
    z.lean = runner ? 0.45 : 0.18;
    z.vel.set(0, 0, 0);
    z.biteT = 0;
    z.stunT = 0; z.stunCool = 0; z.hitReact = 0; z.navT = 0; z.waypoint = null;
    z.biteCool = 0.4;
    z.reach = 0;
    z.yaw = 0;
    return z;
  }

  spawnTick(dt) { this.director.update(dt, this); }

  // ---- movement --------------------------------------------------------------
  /** Shared map collision for movement, recoil and pathfinding. */
  collide(p, r) { resolvePosition(p, r, this.colliders); }

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

  damage(hitZ, dir, amount, knockback = 1, { weaponId = this.weapon.id, control = true } = {}) {
    if (!this.targetable(hitZ)) return;
    const h = this.hero;
    const end = this.chest(hitZ, new THREE.Vector3());
    hitZ.hp -= amount;
    hitZ.flash();
    if (hitZ.demon) this.encounter.takeHit(this, control);
    const push = dir.clone().setY(0).normalize();
    hitZ.hitReact = 0.18;
    if (control && !hitZ.demon) {
      const heavy = weaponId === 'shotgun';
      hitZ.vel.addScaledVector(push, heavy ? 5 : 2.8);
      hitZ.vel.clampLength(0, heavy ? 5 : 3.5);
      if (hitZ.stunCool <= 0) {
        hitZ.stunT = heavy ? 0.28 : 0.12;
        hitZ.stunCool = hitZ.runner ? 0.42 : heavy ? 0.38 : 0.17;
        hitZ.biteT = 0; hitZ.reach = 0;
        hitZ.biteCool = Math.max(hitZ.biteCool, hitZ.stunT + 0.1);
      }
    }
    this.fx.spray(end, dir, 5, Math.random() < 0.5 ? 'blood' : 'flesh', 2.4);
    const pan = THREE.MathUtils.clamp((end.x - h.root.position.x) * 0.1, -0.8, 0.8);
    if (hitZ.hp > 0) { this.sfx.hit(pan); return; }
    // kill
    hitZ.dead = true;
    hitZ.deadT = 0;
    hitZ.vel.addScaledVector(push, 2.5);
    this.kills++;
    this.awardCoins('kills', hitZ.coinValue ?? 0, end);
    if (hitZ.coinPackValue > 0) this.coinDrops.drop(hitZ.root.position, hitZ.coinPackValue);
    if (hitZ.demon) { this.encounter.cancelShots(); this.encounter.health.visible = false; }
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
    if (this.state === 'paused') return;
    const h = this.hero, hp = h.root.position;
    const playing = this.state === 'play';
    let walk = 0;

    if (playing && dt > 0) {
      this.buffs.update(dt, hp, true);
      this.elapsed += dt;
      this.noticeT = Math.max(0, this.noticeT - dt);
      this.noise = Math.max(0, this.noise - dt * 0.06);
      this.time = this.elapsed;
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
      this.coinDrops.update(dt, this);
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
    if (this.state === 'play' && this.director.readyToComplete && this.alive === 0) {
      this.coinDrops.collectAll(this);
      this.finish(true);
    }
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
      z.stunT = Math.max(0, z.stunT - dt); z.stunCool = Math.max(0, z.stunCool - dt);
      if (z.rise >= 1) this.collide(p, 0.38);
      z.navT -= dt;
      if (z.navT <= 0 || !z.waypoint) {
        z.waypoint = nextWaypoint(p, hp, this.colliders, 0.38);
        z.navT = 0.3;
      }
      const target = z.waypoint ?? p;
      const want = Math.atan2(target.x - p.x, target.z - p.z);
      let dy = want - z.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      z.yaw += dy * Math.min(1, dt * (z.runner ? 8 : 4));
      z.root.rotation.y = z.yaw;
      let walk = 1;
      if (playing && z.stunT <= 0 && d > TUNE.biteRange * 0.9 && z.rise >= 1 && Math.hypot(target.x - p.x, target.z - p.z) > 0.12) {
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
      if (z.rise >= 1) this.collide(p, 0.38);

      // bite: wind up, then land if still close
      z.biteCool -= dt;
      const biteDx = hp.x - p.x, biteDz = hp.z - p.z, biteDistance = Math.hypot(biteDx, biteDz) || 1;
      if (playing && z.rise >= 1 && z.stunT <= 0) {
        if (z.biteT > 0) {
          z.biteT += dt;
          z.reach = Math.min(1, z.biteT / TUNE.biteWindup);
          if (z.biteT >= TUNE.biteWindup) {
            z.biteT = 0;
            z.biteCool = TUNE.biteCooldown;
            if (biteDistance < TUNE.biteRange + 0.25) this.bite(z, biteDx / biteDistance, biteDz / biteDistance);
          }
        } else {
          z.reach = Math.max(0, z.reach - dt * 3);
          if (biteDistance < TUNE.biteRange && z.biteCool <= 0) z.biteT = 1e-4;
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
    if (win && (!this.director.readyToComplete || this.alive > 0)) return;
    if (win) {
      this.coinDrops.collectAll(this);
      if (!this.trial) {
        const reward = this.profile
          ? this.mode === 'challenge' ? { ok: true, credited: this.profile.earn(this.dayConfig.completeBonus) } : this.profile.completeDay(this.day, this.dayConfig.completeBonus)
          : { ok: true, credited: this.dayConfig.completeBonus };
        this.income.completion = reward.credited ?? 0;
        this.loot += this.income.completion;
        this.bank = this.profile ? this.profile.coins : this.bank + this.income.completion;
      }
      this.sfx.win();
    }
    this.state = win ? 'win' : 'dead';
    this.encounter.cancelShots();
    this.coinDrops.clear();
    this.ballistics.clear();
    // Kill and pickup rewards were already saved. Never credit the displayed total again.
    const carried = Object.values(this.income).reduce((sum, amount) => sum + amount, 0);
    this.bank = this.profile?.coins ?? this.bank;
    this.hooks.end?.(win, { day: this.day, mode: this.mode, kills: this.kills, shots: this.shots, hits: this.hits, time: this.elapsed, hp: this.hp,
      income: { ...this.income }, loot: carried, carried, bank: this.bank, weapon: this.weapon.id, trial: this.trial,
      completed: this.profile?.campaignComplete ?? false, reason: win ? 'cleared' : 'dead' });
  }
}

// HUD and older callers read round.target.
Object.defineProperty(Round.prototype, 'target', { get() { return this.aimInfo.zombie; } });
