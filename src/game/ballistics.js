import * as THREE from 'three';

export const BULLET_SPEED = 48;

// Raycast the actual posed block meshes, including arms/heads. A segment is
// swept every tick: even a fast bullet cannot skip a thin obstacle between frames.
export class Ballistics {
  constructor(round, scenery = []) {
    this.round = round;
    this.scenery = scenery;
    this.ray = new THREE.Raycaster();
    this.active = [];
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 4, 3),
      new THREE.MeshBasicMaterial({ color: 0xffd36a }), 256);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    round.scene.add(this.mesh);
    this.matrix = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
  }

  clear() { this.active.length = 0; this.mesh.count = 0; }

  meshHit(objects, origin) {
    let nearest = Infinity;
    const local = new THREE.Vector3();
    const inverse = new THREE.Matrix4();
    const hits = [];
    for (const root of objects) root.traverseVisible(mesh => {
      if (!mesh.isMesh || mesh.userData.noBulletCollision) return;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      this.sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      if (!this.ray.ray.intersectsSphere(this.sphere) || origin.distanceTo(this.sphere.center) - this.sphere.radius > this.ray.far) return;
      // An initial overlap with a block is a hit, even when its outward-facing
      // triangles would otherwise hide the exit surface from an inside ray.
      if (mesh.geometry.type === 'BoxGeometry' || mesh.geometry.type === 'CylinderGeometry') {
        local.copy(origin).applyMatrix4(inverse.copy(mesh.matrixWorld).invert());
        if (mesh.geometry.type === 'BoxGeometry') {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox.containsPoint(local)) { nearest = 0; return; }
        } else {
          const { height, radiusTop, radiusBottom } = mesh.geometry.parameters;
          const radius = THREE.MathUtils.lerp(radiusBottom, radiusTop, local.y / height + 0.5);
          if (Math.abs(local.y) <= height / 2 && local.x ** 2 + local.z ** 2 <= radius ** 2) { nearest = 0; return; }
        }
      }
      hits.length = 0;
      mesh.raycast(this.ray, hits);
      for (const hit of hits) nearest = Math.min(nearest, hit.distance);
    });
    return nearest;
  }

  trace(origin, dir, range, ignored = new Set(), sceneryOnly = false) {
    this.ray.set(origin, dir);
    this.ray.near = 0;
    this.ray.far = range;
    let distance = range, zombie = null, blocked = false;
    const sceneryDistance = this.meshHit(this.scenery, origin);
    if (sceneryDistance <= distance) { distance = sceneryDistance; blocked = true; }
    for (const z of sceneryOnly ? [] : this.round.pool) {
      if (!this.round.targetable(z) || ignored.has(z)) continue;
      const hitDistance = this.meshHit([z.root], origin);
      if (hitDistance < distance) {
        distance = hitDistance; zombie = z; blocked = false;
      }
    }
    return { distance, zombie, blocked, point: origin.clone().addScaledVector(dir, distance) };
  }

  fire(origin, dir, weapon, shot) {
    if (this.active.length >= 256) return;
    // Capture upgrades and buffs at trigger time, shared by every pellet.
    if (!shot.weapon) {
      Object.defineProperties(shot, {
        weapon: { value: Object.freeze({ ...weapon }) },
        controlled: { value: new Set() },
        pierce: { value: !!shot.pierce, writable: false },
        blast: { value: !!shot.blast, writable: false },
      });
    }
    this.active.push({ position: origin.clone(), dir: dir.clone(), remaining: shot.weapon.range,
      travelled: 0, weapon: shot.weapon, shot, ignored: new Set() });
  }

  update(dt) {
    if (dt <= 0 || this.round.state !== 'play') return;
    this.round.scene.updateMatrixWorld(true);
    const survivors = [];
    const impacts = [];
    // Collect impacts before applying damage so pellets in the same frame do
    // not pass through an enemy that another pellet just killed.
    for (const p of this.active) {
      let step = Math.min(p.remaining, BULLET_SPEED * dt), ended = false;
      while (step > 1e-6) {
        const hit = this.trace(p.position, p.dir, step, p.ignored);
        const start = p.position.clone();
        p.position.copy(hit.point);
        p.travelled += hit.distance;
        p.remaining -= hit.distance;
        step -= hit.distance;
        this.round.fx.tracer(start, p.position);
        if (hit.zombie) {
          p.ignored.add(hit.zombie);
          impacts.push({ p, z: hit.zombie, point: hit.point, distance: p.travelled });
          if (!p.shot.pierce) { ended = true; break; }
        } else {
          if (hit.blocked) {
            this.round.fx.spray(hit.point, p.dir.clone().negate(), 3, 'ink', 1.5);
            ended = true;
          }
          break;
        }
      }
      if (!ended && p.remaining > 1e-6) survivors.push(p);
    }
    this.active = survivors;
    for (const { p, z, point, distance } of impacts) {
      if (!p.shot.hit) { p.shot.hit = true; this.round.hits++; }
      const control = !p.shot.controlled.has(z);
      p.shot.controlled.add(z);
      this.round.damage(z, p.dir, p.weapon.id === 'shotgun' && distance > 6 ? 0.4 : 1,
        p.weapon.knockback, { weaponId: p.weapon.id, control });
      if (p.shot.blast && !p.shot.exploded) {
        p.shot.exploded = true;
        this.round.fx.spray(point, new THREE.Vector3(0, 1, 0), 18, 'ink', 4);
        this.round.hooks.shake(0.16);
        for (const other of this.round.pool) {
          if (!this.round.targetable(other) || this.round.chest(other, new THREE.Vector3()).distanceToSquared(point) > 2.2 ** 2) continue;
          const push = other.root.position.clone().sub(point).setY(0).normalize();
          const control = !p.shot.controlled.has(other);
          p.shot.controlled.add(other);
          this.round.damage(other, push, 1, 1, { weaponId: p.weapon.id, control });
        }
      }
    }
    this.mesh.count = this.active.length;
    this.active.forEach((p, i) => this.mesh.setMatrixAt(i, this.matrix.makeTranslation(p.position.x, p.position.y, p.position.z)));
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
