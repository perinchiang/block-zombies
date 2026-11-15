import * as THREE from 'three';
import { Demon } from '../actor/demon.js';
import { flat } from '../render/toon.js';
import { COL } from '../render/palette.js';
import { nextWaypoint } from '../world/navigation.js';

export const DEMON = Object.freeze({
  x: 15, z: -15, hp: 36, radius: 0.68,
  notice: 6, forget: 26, leash: 3, speed: 0.8,
  windup: 0.8, flight: 0.85, cooldown: 2.8, blastRadius: 1.8,
});

// One optional guard, with bounded projectiles and a fixed warning circle.
// It never pursues the player all the way to the evacuation vehicle.
export class DemonEncounter {
  constructor(scene) {
    this.actor = new Demon();
    Object.assign(this.actor, { demon: true, radius: DEMON.radius, vel: new THREE.Vector3() });
    scene.add(this.actor.root);
    const yellow = flat('#f2c84b'), red = flat(COL.blood, { side: THREE.DoubleSide });
    const disc = flat(COL.blood, { transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
    this.projectiles = Array.from({ length: 3 }, () => {
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.23, 0), yellow);
      const ring = new THREE.Mesh(new THREE.RingGeometry(DEMON.blastRadius - 0.09, DEMON.blastRadius, 48), red);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(DEMON.blastRadius, 48), disc);
      ring.rotation.x = fill.rotation.x = -Math.PI / 2;
      ring.visible = fill.visible = ball.visible = false;
      scene.add(ball, ring, fill);
      return { ball, ring, fill, active: false, age: 0, start: new THREE.Vector3(), target: new THREE.Vector3() };
    });
    // A small world-space health strip, visible only after engaging the guard.
    this.health = new THREE.Group();
    this.health.add(new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.14), flat(COL.ink, { side: THREE.DoubleSide })));
    this.healthFill = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.08), red.clone());
    this.healthFill.position.z = 0.01; this.health.add(this.healthFill);
    scene.add(this.health);
    this.reset();
  }

  reset() {
    const d = this.actor;
    Object.assign(d, { active: true, dead: false, deadT: 0, fall: 0, rise: 1, runner: false,
      hp: DEMON.hp, alert: false, cast: 0, windupT: 0, attackT: 1.2, forgetT: 0,
      interruptResistT: 0, interruptCueT: 0, yaw: Math.PI / 2 });
    this.health.scale.setScalar(1);
    this.healthFill.material.color.set(COL.blood);
    d.flash(0);
    d.vel.set(0, 0, 0); d.root.position.set(DEMON.x, 0, DEMON.z);
    d.root.rotation.set(0, d.yaw, 0); d.root.visible = true;
    this.cancelShots(); this.health.visible = false;
  }

  cancelShots() {
    for (const p of this.projectiles) { p.active = false; p.ball.visible = p.ring.visible = p.fill.visible = false; }
    this.actor.windupT = this.actor.cast = 0;
  }

  // Returns true only when this hit interrupts an unreleased cast.
  takeHit(round, control = true) {
    const d = this.actor;
    d.alert = true; d.forgetT = 0;
    d.flash();
    if (!control || d.interruptResistT > 0 || !this.projectiles.some(p => p.active && p.age < DEMON.windup)) return false;
    for (const p of this.projectiles) {
      if (!p.active || p.age >= DEMON.windup) continue;
      p.active = false; p.ball.visible = p.ring.visible = p.fill.visible = false;
    }
    d.windupT = d.cast = 0;
    d.interruptResistT = 3;
    d.interruptCueT = 0.45;
    // A prompt retry inside the resistance window guarantees continued pressure.
    d.attackT = Math.min(d.attackT, 0.6);
    this.healthFill.material.color.set(0xffffff);
    this.health.scale.setScalar(1.3);
    return true;
  }

  defeated(round) {
    this.cancelShots(); this.health.visible = false;
    round.extraction.unlockRare();
    round.buffs.drop(this.actor.root.position.clone().setY(0));
  }

  beginCast(round) {
    const p = this.projectiles.find(p => !p.active);
    if (!p) return false;
    const d = this.actor;
    p.active = true; p.age = 0;
    // Lock the point now: the telegraph never follows a dodging player.
    // Keep the warning above the raised sidewalk as well as the road surface.
    p.target.copy(round.hero.root.position).setY(0.18);
    p.ring.position.copy(p.target); p.fill.position.copy(p.target).y += 0.005;
    p.ring.visible = p.fill.visible = true; p.ball.visible = false;
    d.windupT = DEMON.windup;
    round.sfx.demonCast?.();
    return true;
  }

  explode(p, round) {
    p.active = false; p.ball.visible = p.ring.visible = p.fill.visible = false;
    const h = round.hero.root.position;
    const dir = h.clone().sub(p.target).setY(0);
    if (dir.lengthSq() <= DEMON.blastRadius ** 2) {
      if (dir.lengthSq() < 0.001) dir.set(0, 0, 1); else dir.normalize();
      // Blast damage does not consume the bite-only ink shield.
      round.hurtHero(dir.x, dir.z);
    }
    round.fx.spray(p.target, new THREE.Vector3(0, 1, 0), 22, 'brass', 4);
    round.fx.spray(p.target, new THREE.Vector3(0, 1, 0), 12, 'ink', 3);
    round.fx.decal(p.target.x, p.target.z, true);
    round.sfx.explosion?.(); round.hooks.shake(0.18);
  }

  updateProjectiles(dt, round) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const previous = p.age;
      p.age += dt;
      const windup = Math.min(1, p.age / DEMON.windup);
      p.fill.material.opacity = 0.13 + windup * 0.12;
      if (p.age < DEMON.windup) continue;
      if (previous < DEMON.windup) {
        this.actor.root.updateMatrixWorld(true);
        this.actor.muzzle.getWorldPosition(p.start);
      }
      const t = Math.min(1, (p.age - DEMON.windup) / DEMON.flight);
      const prev = p.ball.visible ? p.ball.position.clone() : p.start.clone();
      p.ball.visible = true;
      p.ball.position.lerpVectors(p.start, p.target, t);
      p.ball.position.y += Math.sin(t * Math.PI) * 1.35;
      // Low scenery stops a descending ball and detonates it at the collision.
      // Substeps keep even accelerated test frames from tunnelling through props.
      const steps = Math.max(1, Math.ceil(prev.distanceTo(p.ball.position) / 0.15));
      let hit = false;
      for (let i = 1; i <= steps && !hit; i++) {
        const pos = prev.clone().lerp(p.ball.position, i / steps);
        for (const c of round.colliders) {
          if (pos.y > (c.height ?? 1.5) + 0.15) continue;
          const blocked = c.r != null
            ? c.r >= 0.3 && Math.hypot(pos.x - c.x, pos.z - c.z) <= c.r + 0.15
            : Math.abs(pos.x - c.x) <= c.halfX + 0.15 && Math.abs(pos.z - c.z) <= c.halfZ + 0.15;
          if (!blocked) continue;
          p.target.copy(pos).setY(0.18); hit = true; break;
        }
      }
      if (hit || t >= 1) this.explode(p, round);
    }
  }

  update(dt, round, camera) {
    if (dt <= 0 || round.state === 'paused') return;
    const d = this.actor;
    if (!d.active) { this.cancelShots(); this.health.visible = false; return; }
    if (d.dead) {
      this.health.visible = false;
      d.deadT += dt; d.fall = Math.min(1, d.fall + dt * 1.8);
      if (d.deadT > 3) d.root.position.y -= dt * 0.7;
      if (d.deadT > 5) round.retire(d);
      d.pose(dt, 0); return;
    }
    const playing = round.state === 'play';
    const h = round.hero.root.position, pos = d.root.position;
    const dist = Math.hypot(pos.x - h.x, pos.z - h.z);
    if (playing) {
      if (dist < DEMON.notice) d.alert = true;
      d.forgetT = dist > DEMON.forget ? d.forgetT + dt : 0;
      if (d.forgetT > 2) d.alert = false;
      d.interruptResistT = Math.max(0, d.interruptResistT - dt);
      d.interruptCueT = Math.max(0, d.interruptCueT - dt);
      this.healthFill.material.color.set(d.interruptCueT > 0 ? 0xffffff : COL.blood);
      this.health.scale.setScalar(d.interruptCueT > 0 ? 1.3 : 1);
      d.attackT -= dt;
      d.windupT = Math.max(0, d.windupT - dt);
      d.cast = d.windupT > 0 ? 1 - d.windupT / DEMON.windup : Math.max(0, d.cast - dt * 5);
      const desired = d.alert ? h.clone() : new THREE.Vector3(DEMON.x, 0, DEMON.z);
      // Stay inside the guard post even after a shot from across the street.
      const homeOffset = desired.clone().sub(new THREE.Vector3(DEMON.x, 0, DEMON.z)).setY(0);
      if (homeOffset.length() > DEMON.leash) homeOffset.setLength(DEMON.leash);
      desired.set(DEMON.x + homeOffset.x, 0, DEMON.z + homeOffset.z);
      const waypoint = nextWaypoint(pos, desired, round.colliders, DEMON.radius);
      const step = new THREE.Vector3(waypoint.x - pos.x, 0, waypoint.z - pos.z);
      const walk = desired.distanceTo(pos) > 0.2 && step.length() > 1e-6 && !d.windupT && (!d.alert || dist > 4.5);
      if (walk) pos.addScaledVector(step.clone().normalize(), Math.min(step.length(), DEMON.speed * dt));
      pos.addScaledVector(d.vel, dt); d.vel.multiplyScalar(Math.max(0, 1 - dt * 7));
      round.collide(pos, DEMON.radius);
      if (d.alert) d.yaw = Math.atan2(h.x - pos.x, h.z - pos.z);
      d.root.rotation.y = d.yaw;
      if (d.alert && dist <= DEMON.forget && d.attackT <= 0 && !d.windupT && this.beginCast(round)) d.attackT = DEMON.cooldown;
      d.pose(dt, walk ? 1 : 0);
      this.updateProjectiles(dt, round);
    } else d.pose(dt, 0);
    this.health.visible = d.alert;
    this.health.position.copy(pos).y += 2.75;
    this.health.lookAt(camera.position);
    const fraction = Math.max(0, d.hp / DEMON.hp);
    this.healthFill.scale.x = fraction;
    this.healthFill.position.x = -(1 - fraction) * 0.59;
  }
}
