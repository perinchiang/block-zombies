import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArena, BOUNDS } from '../src/world/arena.js';
import { isWalkable, resolvePosition, nextWaypoint } from '../src/world/navigation.js';

const scene = new THREE.Scene();
const { colliders, group } = buildArena(scene);
assert.deepEqual(BOUNDS, { x: 20, zMin: -20, zMax: 20 });
const sites = [[0, 5], [2.8, 0], [-19, -10], [19, 10], [0, -5], [-16, -4], [-16, 15], [0, 16], [16, 5], [0, -16], [15, -17]];
for (const [x, z] of sites) assert.ok(isWalkable(x, z, 0.6, colliders), `reserved site ${x},${z}`);
for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) assert.ok(isWalkable(x, z, 0.35, colliders));
for (const [x, z] of [[-10, -9], [10, -9], [-10, 9], [10, 9]]) assert.ok(!isWalkable(x, z, 0.35, colliders));

for (const p of [{ x: -10, y: 7, z: -9 }, { x: -6.8, y: 7, z: -5.8 }, { x: -11, y: 7, z: 14 }, { x: 25, y: 7, z: -25 }]) {
  assert.equal(resolvePosition(p, 0.35, colliders), p);
  assert.ok(isWalkable(p.x, p.z, 0.35, colliders), JSON.stringify(p));
  assert.equal(p.y, 7);
}

function travel(a, b, radius = 0.35, solids = colliders) {
  const p = { x: a[0], z: a[1] }, goal = { x: b[0], z: b[1] };
  for (let step = 0; step < 2500; step++) {
    const distance = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (distance < 0.08) return;
    const waypoint = nextWaypoint(p, goal, solids, radius);
    const dx = waypoint.x - p.x, dz = waypoint.z - p.z, d = Math.hypot(dx, dz);
    assert.ok(d > 1e-8, `stalled ${JSON.stringify({ p, goal, waypoint })}`);
    p.x += dx / d * Math.min(0.07, d); p.z += dz / d * Math.min(0.07, d);
    // Check BEFORE resolution: navigation itself must not cut collision corners.
    assert.ok(isWalkable(p.x, p.z, radius, solids), `path crossed obstacle ${JSON.stringify(p)}`);
    resolvePosition(p, radius, solids);
  }
  assert.fail(`route failed ${a} -> ${b}`);
}
const routes = [
  [[-16, -9], [0, -9]], [[10, -16], [10, 0]],
  [[-19, -10], [0, 5]], [[19, 10], [0, 5]],
  [[-16, -16], [16, 16]], [[16, -16], [-16, 16]],
  [[0, -16], [15, -15]], [[16, 0], [15, -15]],
  [[-16, -16], [16, -16]], [[16, -16], [16, 16]],
  [[16, 16], [-16, 16]], [[-16, 16], [-16, -16]],
];
for (const [a, b] of routes) for (const radius of [0.35, 0.6]) { travel(a, b, radius); travel(b, a, radius); }
travel([-3, 0], [3, 0], 0.35, [{ x: 0, z: 0, r: 1, height: 1 }]);
const sealed = [{ x: 0, z: 0, halfX: 0.2, halfZ: 20, height: 2 }];
assert.deepEqual(nextWaypoint({ x: -3, z: 0 }, { x: 3, z: 0 }, sealed), { x: -3, z: 0 });

// Mesh raycasts, used by bullets, must hit all collider bodies at their surfaces.
group.updateMatrixWorld(true);
for (const c of colliders) {
  const half = c.r ?? c.halfX;
  const ray = new THREE.Raycaster(new THREE.Vector3(c.x - half - 0.05, c.height / 2, c.z), new THREE.Vector3(1, 0, 0), 0, 0.1);
  assert.ok(ray.intersectObject(group, true).length, `missing visible collider ${JSON.stringify(c)}`);
}
const begin = performance.now();
for (let frame = 0; frame < 120; frame++) for (let enemy = 0; enemy < 24; enemy++) {
  nextWaypoint({ x: -16, z: -15 + enemy * 0.4 }, { x: 0, z: 5 }, colliders);
}
console.log(`Navigation OK: 49 traversals, reserved sites, collisions, unreachable route, mesh raycasts; 2880 cached queries ${(performance.now() - begin).toFixed(1)}ms`);
