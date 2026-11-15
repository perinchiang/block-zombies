export const UPGRADE_COSTS = Object.freeze([0, 60, 120, 220]);
const DAMAGE = [1, 1.5, 1.75, 2];
const RELOAD = [1, 0.95, 0.9, 0.85];
export const WEAPONS = Object.freeze({
  rifle: Object.freeze({
    id: 'rifle', name: '步枪', description: '中远距离连射，边退边清',
    mag: 24, reload: 1.25, fireRate: 9, range: 24, noise: 0.12,
    pellets: Object.freeze([0]), knockback: 1, movingSpeed: 2.6,
  }),
  shotgun: Object.freeze({
    id: 'shotgun', name: '霰弹枪', description: '近距离散射击退，打出突围缺口',
    mag: 6, reload: 1.8, fireRate: 1.5, range: 10, noise: 0.5,
    pellets: Object.freeze([-0.24, -0.16, -0.08, 0, 0.08, 0.16, 0.24]), knockback: 3.2, movingSpeed: 3.0,
  }),
});

/** A frozen per-round configuration; multiply base pellet damage exactly once. */
export function buildWeapon(id, level = 1) {
  if (!Object.hasOwn(WEAPONS, id)) throw new RangeError('Unknown weapon');
  if (!Number.isInteger(level) || level < 1 || level > 4) throw new RangeError('Invalid weapon level');
  const base = WEAPONS[id];
  return Object.freeze({
    ...base, level, damageMultiplier: DAMAGE[level - 1],
    mag: base.mag + (level - 1) * (id === 'rifle' ? 3 : 1),
    reload: base.reload * RELOAD[level - 1],
  });
}
