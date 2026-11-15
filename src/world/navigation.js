import { BOUNDS } from './arena.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const EPS = 1e-7;

function overlap(x, z, radius, c) {
  if (c.r != null) return Math.hypot(x - c.x, z - c.z) < radius + c.r - EPS;
  const dx = x - clamp(x, c.x - c.halfX, c.x + c.halfX);
  const dz = z - clamp(z, c.z - c.halfZ, c.z + c.halfZ);
  return Math.hypot(dx, dz) < radius - EPS ||
    (Math.abs(x - c.x) < c.halfX && Math.abs(z - c.z) < c.halfZ);
}

export function isWalkable(x, z, radius, colliders) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    x >= -BOUNDS.x + radius - EPS && x <= BOUNDS.x - radius + EPS &&
    z >= BOUNDS.zMin + radius - EPS && z <= BOUNDS.zMax - radius + EPS &&
    !colliders.some(c => overlap(x, z, radius, c));
}

/** In-place ground depenetration. Call after each small movement step; preserves y. */
export function resolvePosition(pos, radius, colliders) {
  for (let pass = 0; pass < 12; pass++) {
    pos.x = clamp(pos.x, -BOUNDS.x + radius, BOUNDS.x - radius);
    pos.z = clamp(pos.z, BOUNDS.zMin + radius, BOUNDS.zMax - radius);
    let moved = false;
    for (const c of colliders) {
      if (!overlap(pos.x, pos.z, radius, c)) continue;
      moved = true;
      let dx, dz, distance, push;
      if (c.r != null) {
        dx = pos.x - c.x; dz = pos.z - c.z;
        distance = Math.hypot(dx, dz);
        push = radius + c.r - distance + EPS;
      } else {
        dx = pos.x - clamp(pos.x, c.x - c.halfX, c.x + c.halfX);
        dz = pos.z - clamp(pos.z, c.z - c.halfZ, c.z + c.halfZ);
        distance = Math.hypot(dx, dz);
        if (distance < EPS) {
          const exits = [
            { d: pos.x - (c.x - c.halfX), x: c.x - c.halfX - radius - EPS, z: pos.z },
            { d: c.x + c.halfX - pos.x, x: c.x + c.halfX + radius + EPS, z: pos.z },
            { d: pos.z - (c.z - c.halfZ), x: pos.x, z: c.z - c.halfZ - radius - EPS },
            { d: c.z + c.halfZ - pos.z, x: pos.x, z: c.z + c.halfZ + radius + EPS },
          ];
          exits.sort((a, b) => a.d - b.d);
          pos.x = exits[0].x; pos.z = exits[0].z;
          continue;
        }
        push = radius - distance + EPS;
      }
      pos.x += (distance > EPS ? dx / distance : 1) * push;
      pos.z += (distance > EPS ? dz / distance : 0) * push;
    }
    if (!moved) break;
  }
  return pos;
}

// Exact segment tests against conservatively expanded shapes prevent corner cutting.
function clear(a, b, radius, colliders) {
  if (!isWalkable(a.x, a.z, radius, colliders) || !isWalkable(b.x, b.z, radius, colliders)) return false;
  const vx = b.x - a.x, vz = b.z - a.z;
  for (const c of colliders) {
    if (c.r != null) {
      const t = clamp(((c.x - a.x) * vx + (c.z - a.z) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      if (Math.hypot(a.x + vx * t - c.x, a.z + vz * t - c.z) < c.r + radius) return false;
    } else {
      let lo = 0, hi = 1;
      for (const [start, delta, center, half] of [[a.x, vx, c.x, c.halfX], [a.z, vz, c.z, c.halfZ]]) {
        if (Math.abs(delta) < EPS) {
          if (Math.abs(start - center) > half + radius) { lo = 2; break; }
        } else {
          const t1 = (center - half - radius - start) / delta;
          const t2 = (center + half + radius - start) / delta;
          lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
        }
      }
      if (lo <= hi) return false;
    }
  }
  return true;
}

// Static collider arrays must retain identity. Replace the array when geometry changes.
// Half-metre grid, four connected edges: no diagonal corner leaks. Reverse BFS
// fields are shared by all enemies chasing the same target cell (bounded cache).
const cache = new WeakMap();
const STEP = 0.5;
function gridFor(colliders, radius) {
  let radii = cache.get(colliders);
  if (!radii) cache.set(colliders, radii = new Map());
  if (radii.has(radius)) return radii.get(radius);
  const width = Math.round(2 * BOUNDS.x / STEP) + 1;
  const depth = Math.round((BOUNDS.zMax - BOUNDS.zMin) / STEP) + 1;
  const points = Array.from({ length: width * depth }, (_, i) => ({ x: -BOUNDS.x + (i % width) * STEP, z: BOUNDS.zMin + Math.floor(i / width) * STEP }));
  const walk = points.map(p => isWalkable(p.x, p.z, radius, colliders));
  const edges = points.map(() => []);
  for (let i = 0; i < points.length; i++) {
    if (!walk[i]) continue;
    for (const j of [i % width < width - 1 ? i + 1 : -1, i + width]) {
      if (j < 0 || j >= points.length || !walk[j] || !clear(points[i], points[j], radius, colliders)) continue;
      edges[i].push(j); edges[j].push(i);
    }
  }
  const grid = { points, walk, edges, fields: new Map(), width };
  radii.set(radius, grid);
  return grid;
}

function nearest(p, grid, radius, colliders) {
  const col = clamp(Math.round((p.x + BOUNDS.x) / STEP), 0, grid.width - 1);
  const row = clamp(Math.round((p.z - BOUNDS.zMin) / STEP), 0, grid.points.length / grid.width - 1);
  const index = row * grid.width + col;
  if (grid.walk[index] && clear(p, grid.points[index], radius, colliders)) return index;
  let best = -1, distance = Infinity;
  for (let i = 0; i < grid.points.length; i++) {
    if (!grid.walk[i]) continue;
    const q = grid.points[i], d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < distance && clear(p, q, radius, colliders)) { best = i; distance = d; }
  }
  return best;
}

/** Returns a plain {x,z} waypoint. Unreachable targets return the current position. */
export function nextWaypoint(from, to, colliders, radius = 0.35) {
  const start = { x: from.x, z: from.z };
  resolvePosition(start, radius, colliders);
  if (Math.hypot(start.x - from.x, start.z - from.z) > EPS) return start;
  const goal = { x: to.x, z: to.z };
  resolvePosition(goal, radius, colliders);
  if (clear(start, goal, radius, colliders)) return goal;
  const grid = gridFor(colliders, radius);
  const source = nearest(start, grid, radius, colliders), target = nearest(goal, grid, radius, colliders);
  if (source < 0 || target < 0) return start;
  let distances = grid.fields.get(target);
  if (!distances) {
    distances = new Int32Array(grid.points.length).fill(-1);
    const queue = new Int32Array(grid.points.length);
    let head = 0, tail = 1; queue[0] = target; distances[target] = 0;
    while (head < tail) {
      const i = queue[head++];
      for (const j of grid.edges[i]) if (distances[j] < 0) {
        distances[j] = distances[i] + 1; queue[tail++] = j;
      }
    }
    grid.fields.set(target, distances);
    if (grid.fields.size > 8) grid.fields.delete(grid.fields.keys().next().value);
  }
  if (distances[source] < 0) return start;
  let index = source, waypoint = grid.points[source];
  while (distances[index] > 0) {
    const next = grid.edges[index].find(j => distances[j] === distances[index] - 1);
    if (!clear(start, grid.points[next], radius, colliders)) break;
    index = next; waypoint = grid.points[index];
  }
  return { x: waypoint.x, z: waypoint.z };
}
