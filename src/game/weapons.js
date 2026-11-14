// The choice changes handling, not a permanent damage upgrade.
export const WEAPONS = Object.freeze({
  rifle: Object.freeze({
    id: 'rifle', name: '步枪', description: '中远距离连射，边退边清',
    mag: 24, reload: 1.25, fireRate: 9, range: 24, noise: 0.12,
    pellets: [0], knockback: 1, movingSpeed: 2.6,
  }),
  shotgun: Object.freeze({
    id: 'shotgun', name: '霰弹枪', description: '近距离散射击退，打出突围缺口',
    mag: 6, reload: 1.8, fireRate: 1.5, range: 10, noise: 0.5,
    pellets: [-0.24, -0.16, -0.08, 0, 0.08, 0.16, 0.24], knockback: 3.2, movingSpeed: 3.0,
  }),
});
