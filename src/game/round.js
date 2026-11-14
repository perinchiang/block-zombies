import * as THREE from 'three';
import { BlockMan } from '../actor/blockman.js';
import { BOUNDS } from '../world/arena.js';

// One 60-second survival round. All tuning lives in TUNE so it can be
// adjusted after playtests without hunting through the code.
export const TUNE = {
  length: 60,
  hearts: 5,
  heroSpeed: 3.4,
  heroSpeedFiring: 2.6,
  fireRate: 9,           // shots per second
  mag: 24,
  reload: 1.25,
  range: 24,
  assistAngle: 0.16,     // radians of aim assist cone (~9°)
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
  constructor({ scene, colliders, fx, sfx, hooks }) {
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
    this.aim = new THREE.Vector3(0, 0, -1);
    this.target = null;
    this.state = 'idle';
    this.reset();
  }

  reset() {
    const h = this.hero;
    h.root.position.set(0, 0, -14); // mid-street: room ahead and behind
    h.root.rotation.set(0, 0, 0);
    this.yaw = Math.PI;              // facing -Z, down the street
    this.hp = TUNE.hearts;
    this.time = TUNE.length;
    this.elapsed = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.ammo = TUNE.mag;
    this.reloadT = 0;
    this.cool = 0;
    this.invuln = 0;
    this.spawnT = 0.6;
    this.groanT = 1.5;
    this.maxAlive = 0;
    this.heroFall = 0;
    this.heroKick = new THREE.Vector3();
    for (const z of this.pool) this.retire(z);
    this.fx.clearDecals();
    // a few already shambling down the street so the first second has a target
    for (const [x, zz] of [[-1.2, -23], [1.6, -26], [0.2, -29]]) this.spawn(x, zz, false, false);
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
    const z = this.pool.find((p) => !p.active);
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
    z.speed = runner ? TUNE.runnerSpeed : THREE.MathUtils.lerp(TUNE.walkSpeed[0], TUNE.walkSpeed[1], Math.random());
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
    const k = Math.min(1, this.elapsed / TUNE.length);
    this.spawnT = THREE.MathUtils.lerp(TUNE.spawnStart, TUNE.spawnEnd, k * k * (3 - 2 * k)) * (0.7 + Math.random() * 0.6);
    if (this.alive >= TUNE.maxAlive) return;
    const h = this.hero.root.position;
    const behind = this.elapsed > TUNE.behindFrom && Math.random() < TUNE.behindChance;
    const runner = this.elapsed > TUNE.runnerFrom && Math.random() < TUNE.runnerChance;
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
  chest(z, out) { return out.copy(z.root.position).setY(z.runner ? 0.85 : 0.95); }

  /** Pick the zombie closest to the aim line inside the assist cone. */
  pickTarget() {
    const h = this.hero.root.position;
    const f = this.forward(_c);
    let best = null, bestA = TUNE.assistAngle;
    for (const z of this.pool) {
      if (!z.active || z.dead || z.rise < 0.6) continue;
      const dx = z.root.position.x - h.x, dz = z.root.position.z - h.z;
      const d = Math.hypot(dx, dz);
      if (d > TUNE.range || d < 0.2) continue;
      const a = Math.acos(THREE.MathUtils.clamp((dx * f.x + dz * f.z) / d, -1, 1));
      // closer zombies get a slightly wider cone: they are the threat
      const cone = bestA * (d < 4 ? 1.8 : 1);
      if (a < cone) { best = z; bestA = Math.min(a, TUNE.assistAngle); }
    }
    return best;
  }

  fire(camera) {
    const h = this.hero;
    this.shots++;
    this.ammo--;
    this.cool = 1 / TUNE.fireRate;
    h.recoil = 1;
    const muzzle = h.muzzle.getWorldPosition(new THREE.Vector3());
    const origin = new THREE.Vector3(h.root.position.x, 1.0, h.root.position.z);
    const dir = this.forward(new THREE.Vector3());
    if (this.target) dir.subVectors(this.chest(this.target, _a), origin).normalize();
    // tiny spread so streams of fire read as hand-held
    dir.x += (Math.random() - 0.5) * 0.02; dir.z += (Math.random() - 0.5) * 0.02; dir.normalize();

    // hitscan against zombie cylinders, stopped by solid props
    let hitZ = null, hitD = TUNE.range;
    for (const z of this.pool) {
      if (!z.active || z.dead || z.rise < 0.5) continue;
      const t = (z.root.position.x - origin.x) * dir.x + (z.root.position.z - origin.z) * dir.z;
      if (t < 0 || t > hitD) continue;
      const px = origin.x + dir.x * t - z.root.position.x, pz = origin.z + dir.z * t - z.root.position.z;
      if (px * px + pz * pz < 0.38 * 0.38) { hitZ = z; hitD = t; }
    }
    for (const c of this.colliders) {
      if (c.r < 0.3) continue;
      const t = (c.x - origin.x) * dir.x + (c.z - origin.z) * dir.z;
      if (t < 0 || t > hitD) continue;
      const px = origin.x + dir.x * t - c.x, pz = origin.z + dir.z * t - c.z;
      if (px * px + pz * pz < c.r * c.r * 0.8) { hitZ = null; hitD = t; }
    }
    const end = origin.clone().addScaledVector(dir, hitD);
    end.y = hitZ ? (hitZ.runner ? 0.85 : 0.95) : 1.0 + dir.y * hitD;
    this.fx.muzzle(muzzle, camera);
    this.fx.tracer(muzzle, end);
    this.fx.shell(muzzle, this.right(new THREE.Vector3()));
    this.sfx.shot();
    this.hooks.shake(0.05);
    if (!hitZ) {
      if (hitD < TUNE.range) this.fx.spray(end, dir.clone().negate(), 3, 'ink', 1.5);
      return;
    }
    this.hits++;
    hitZ.hp--;
    hitZ.flash();
    hitZ.vel.addScaledVector(dir, hitZ.runner ? 2.2 : 1.6);
    this.fx.spray(end, dir, 5, Math.random() < 0.5 ? 'blood' : 'flesh', 2.4);
    const pan = THREE.MathUtils.clamp((end.x - h.root.position.x) * 0.1, -0.8, 0.8);
    if (hitZ.hp > 0) { this.sfx.hit(pan); return; }
    // kill
    hitZ.dead = true;
    hitZ.deadT = 0;
    hitZ.vel.addScaledVector(dir, 2.5);
    this.kills++;
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

    if (playing) {
      this.elapsed += dt;
      this.time = Math.max(0, TUNE.length - this.elapsed);
      this.yaw += input.turn;
      this.target = this.pickTarget();

      // move relative to facing
      const f = this.forward(_a).clone(), r = this.right(_b).clone();
      const sp = input.firing ? TUNE.heroSpeedFiring : TUNE.heroSpeed;
      const mv = r.multiplyScalar(input.move.x).addScaledVector(f, input.move.y);
      walk = Math.min(1, mv.length());
      hp.addScaledVector(mv, sp * dt);
      hp.addScaledVector(this.heroKick, dt);
      this.heroKick.multiplyScalar(Math.max(0, 1 - dt * 8));
      for (const z of this.pool) {
        if (!z.active || z.dead || z.rise < 0.8) continue;
        const dx = hp.x - z.root.position.x, dz = hp.z - z.root.position.z, d = Math.hypot(dx, dz);
        if (d < 0.6 && d > 1e-4) { hp.x = z.root.position.x + (dx / d) * 0.6; hp.z = z.root.position.z + (dz / d) * 0.6; }
      }
      this.collide(hp, 0.3);

      // weapon
      this.cool -= dt;
      if (this.reloadT > 0) {
        if ((this.reloadT -= dt) <= 0) { this.ammo = TUNE.mag; this.reloadT = 0; }
      } else if (input.firing && this.cool <= 0) {
        if (this.ammo > 0) this.fire(camera);
        if (this.ammo <= 0) { this.reloadT = TUNE.reload; this.sfx.reload(); }
      }
      this.invuln -= dt;
      this.spawnTick(dt);
      if (this.time <= 0) this.finish(true);
    }
    h.root.rotation.y = this.yaw;
    if (this.state === 'dead') {
      this.heroFall = Math.min(1, this.heroFall + dt * 2.5);
      h.root.rotation.x = -this.heroFall * Math.PI / 2;
      h.body.position.y = this.heroFall * 0.15;
    }
    h.pose(dt, walk);

    this.updateZombies(dt, playing);
    this.maxAlive = Math.max(this.maxAlive, this.alive);
  }

  updateZombies(dt, playing) {
    const hp = this.hero.root.position;
    let groanFrom = null;
    for (const z of this.pool) {
      if (!z.active) continue;
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
    if (win) {
      // everyone on the street drops at the bell
      for (const z of this.pool) if (z.active && !z.dead) { z.dead = true; z.deadT = Math.random() * -0.6; }
      this.sfx.win();
    }
    this.hooks.end?.(win, { kills: this.kills, shots: this.shots, hits: this.hits, time: this.elapsed, hp: this.hp });
  }
}
