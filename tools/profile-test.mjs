import assert from 'node:assert/strict';
import test from 'node:test';
import { Profile, PROFILE_KEY, SHOP_PRICES } from '../src/game/profile.js';
import { buildWeapon, WEAPONS, UPGRADE_COSTS } from '../src/game/weapons.js';

class StorageFake {
  values = new Map();
  denyRead = false;
  denyWrite = false;
  writes = 0;
  getItem(key) {
    if (this.denyRead) throw new Error('Denied');
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.denyWrite) throw new Error('Quota exceeded');
    this.values.set(key, value);
    this.writes++;
  }
}
const snapshot = overrides => ({ version: 1, coins: 300, owned: ['rifle'], equipped: 'rifle', ...overrides });
const finishCampaign = profile => {
  assert.deepEqual(profile.completeDay(1, 0), { ok: true, credited: 0 });
  assert.deepEqual(profile.completeDay(2, 0), { ok: true, credited: 0 });
};

test('weapon configurations are immutable and apply each upgrade exactly once', () => {
  assert.deepEqual(UPGRADE_COSTS, [0, 60, 120, 220]);
  for (const id of ['rifle', 'shotgun']) {
    for (let level = 1; level <= 4; level++) {
      const weapon = buildWeapon(id, level);
      assert.equal(weapon.level, level);
      assert.equal(weapon.damageMultiplier, [1, 1.5, 1.75, 2][level - 1]);
      assert.equal(weapon.mag, (id === 'rifle' ? [24, 27, 30, 33] : [6, 7, 8, 9])[level - 1]);
      assert.equal(weapon.reload, WEAPONS[id].reload * [1, .95, .9, .85][level - 1]);
      for (const key of ['range', 'fireRate', 'knockback', 'noise', 'movingSpeed']) assert.equal(weapon[key], WEAPONS[id][key]);
      assert(Object.isFrozen(weapon));
      assert(Object.isFrozen(weapon.pellets));
      assert.throws(() => { weapon.mag = 999; }, TypeError);
      assert.throws(() => weapon.pellets.push(1), TypeError);
    }
    assert.equal(buildWeapon(id).level, 1);
    for (const level of [0, 5, 1.5, '2', NaN, null]) assert.throws(() => buildWeapon(id, level), RangeError);
  }
  assert.throws(() => buildWeapon('__proto__'), RangeError);
});

test('v2 migration preserves exact wallet, ownership, equipment and all legacy levels', () => {
  for (const rifle of [1, 2, 3, 4]) {
    for (const shotgun of [1, 2, 3, 4]) {
      const storage = new StorageFake();
      const legacy = snapshot({ version: 2, coins: 1040, owned: ['rifle', 'shotgun'],
        equipped: 'shotgun', levels: { rifle, shotgun } });
      storage.setItem(PROFILE_KEY, JSON.stringify(legacy));
      const profile = new Profile(storage);
      assert.deepEqual(JSON.parse(storage.getItem(PROFILE_KEY)), { ...legacy, version: 3, completedDay: 0 });
      assert.equal(profile.weaponLevel('rifle'), rifle);
      assert.equal(profile.weaponLevel('shotgun'), shotgun);
      assert.equal(profile.equip('shotgun'), true);
      assert.equal(profile.coins, 1040);
      const writes = storage.writes;
      assert.equal(profile.refresh(), true);
      assert.equal(storage.writes, writes);
    }
  }
});

test('v1 migration preserves wallet, ownership and equipment and persists base levels', () => {
  const storage = new StorageFake();
  storage.setItem(PROFILE_KEY, JSON.stringify(snapshot({ coins: 1040, owned: ['rifle', 'shotgun'], equipped: 'shotgun' })));
  const profile = new Profile(storage);
  assert.equal(profile.coins, 1040);
  assert.equal(profile.equipped, 'shotgun');
  assert.equal(profile.weaponLevel('rifle'), 1);
  assert.equal(profile.weaponLevel('shotgun'), 1);
  assert.equal(JSON.parse(storage.getItem(PROFILE_KEY)).version, 3);
  assert.equal(JSON.parse(storage.getItem(PROFILE_KEY)).completedDay, 0);
  assert.equal(profile.equip('shotgun'), true);
  assert.deepEqual(JSON.parse(storage.getItem(PROFILE_KEY)).levels, { rifle: 1, shotgun: 1 });
});

test('upgrades debit each tier, preserve equipment and cap both weapons at Lv4', () => {
  const storage = new StorageFake(), profile = new Profile(storage);
  assert.equal(profile.weaponLevel('shotgun'), 0);
  assert.equal(profile.weaponLevel('__proto__'), 0);
  assert.deepEqual(profile.upgrade('shotgun'), { ok: false, reason: 'unowned' });
  assert.deepEqual(profile.upgrade('__proto__'), { ok: false, reason: 'weapon' });
  assert.deepEqual(profile.upgrade('rifle'), { ok: false, reason: 'funds' });
  profile.earn(1040);
  finishCampaign(profile);
  profile.buy('shotgun');
  for (const id of ['rifle', 'shotgun']) {
    for (let level = 1; level < 4; level++) {
      const before = profile.coins, writes = storage.writes;
      assert.deepEqual(profile.upgrade(id), { ok: true });
      assert.equal(profile.coins, before - UPGRADE_COSTS[level]);
      assert.equal(storage.writes, writes + 1);
      assert.equal(new Profile(storage).weaponLevel(id), level + 1);
    }
    assert.deepEqual(profile.upgrade(id), { ok: false, reason: 'max' });
  }
  assert.equal(profile.coins, 0);
  assert.equal(profile.equipped, 'rifle');
});

test('upgrade refreshes stale wallets and failed writes retain the whole session snapshot', () => {
  const storage = new StorageFake(), first = new Profile(storage);
  first.earn(180);
  const stale = new Profile(storage);
  first.upgrade('rifle');
  assert.deepEqual(stale.upgrade('rifle'), { ok: true });
  assert.equal(stale.coins, 0);
  assert.equal(stale.weaponLevel('rifle'), 3);
  first.earn(220);
  storage.denyWrite = true;
  first.upgrade('rifle');
  assert.equal(first.weaponLevel('rifle'), 4);
  assert.equal(first.coins, 0);
  assert.equal(first.persistent, false);
  assert.equal(first.refresh(), false);
  assert.equal(first.weaponLevel('rifle'), 4);
  storage.denyWrite = false;
  first.earn(1);
  assert.equal(new Profile(storage).weaponLevel('rifle'), 4);
  assert.equal(new Profile(storage).coins, 1);
});

test('unknown versions are never overwritten, including during unsaved session recovery', () => {
  for (const version of [0, 4, 99, '3']) {
    for (const mode of ['cold', 'refresh', 'dirty']) {
      const storage = new StorageFake();
      let profile;
      if (mode !== 'cold') {
        profile = new Profile(storage);
        if (mode === 'dirty') { storage.denyWrite = true; profile.earn(10); storage.denyWrite = false; }
      }
      const raw = JSON.stringify(snapshot({ version, coins: 12345 }));
      storage.setItem(PROFILE_KEY, raw);
      if (mode === 'cold') profile = new Profile(storage);
      if (mode === 'refresh') profile.refresh();
      // Dirty sessions skip refresh, so save itself must detect the unknown version.
      profile.earn(300);
      finishCampaign(profile);
      profile.buy('shotgun');
      profile.upgrade('shotgun');
      profile.equip('shotgun');
      assert.equal(storage.getItem(PROFILE_KEY), raw);
      assert.equal(profile.persistent, false);
    }
  }
});

test('invalid v3 snapshots never partially replace wallet, levels or campaign progress', () => {
  const invalid = [
    ...[undefined, null, -1, 3, 1.5, '2', true, {}, []].map(completedDay => ({ completedDay })),
    ...[null, [], {}, { rifle: 0 }, { rifle: 5 }, { rifle: '2' }, { rifle: 1, shotgun: 1 }].map(levels => ({ levels })),
    { coins: -1 }, { owned: ['rifle', 'rifle'] }, { equipped: 'shotgun' },
  ];
  for (const overrides of invalid) {
    const storage = new StorageFake(), profile = new Profile(storage);
    profile.earn(180);
    profile.upgrade('rifle');
    profile.completeDay(1, 30);
    const raw = JSON.stringify(snapshot({ version: 3, levels: { rifle: 1 }, completedDay: 0, ...overrides }));
    storage.setItem(PROFILE_KEY, raw);
    const writes = storage.writes;
    assert.equal(profile.refresh(), false, raw);
    assert.equal(storage.writes, writes);
    assert.equal(profile.coins, 150);
    assert.equal(profile.weaponLevel('rifle'), 2);
    assert.equal(profile.completedDay, 1);
    assert.equal(profile.persistent, false);
    const cold = new Profile(storage);
    assert.equal(cold.completedDay, 0);
    assert.equal(cold.coins, 0);
    assert.equal(cold.persistent, false);
  }
});

test('invalid v2 levels cannot partially replace a valid snapshot', () => {
  const storage = new StorageFake(), profile = new Profile(storage);
  profile.earn(180); profile.upgrade('rifle');
  for (const levels of [null, [], {}, { rifle: 0 }, { rifle: 5 }, { rifle: 1.5 }, { rifle: '2' }, { rifle: 2, shotgun: 1 }]) {
    storage.setItem(PROFILE_KEY, JSON.stringify(snapshot({ version: 2, levels })));
    assert.equal(profile.refresh(), false);
    assert.equal(profile.coins, 120);
    assert.equal(profile.weaponLevel('rifle'), 2);
  }
});

test('cold start exposes the free rifle and versioned storage key', () => {
  const storage = new StorageFake();
  const profile = new Profile(storage);
  assert.match(PROFILE_KEY, /v1/);
  assert.deepEqual(SHOP_PRICES, { rifle: 0, shotgun: 240 });
  assert.equal(profile.coins, 0);
  assert.equal(profile.equipped, 'rifle');
  assert.equal(profile.owns('rifle'), true);
  assert.equal(profile.owns('shotgun'), false);
  assert.equal(profile.persistent, true);
  assert.equal(profile.completedDay, 0);
  assert.equal(profile.currentDay, 1);
  assert.equal(profile.campaignComplete, false);
  assert.equal(storage.writes, 0);
});

test('funds, purchases, ownership, equipment and atomic snapshot reload', () => {
  const storage = new StorageFake();
  const profile = new Profile(storage);
  assert.deepEqual(profile.buy('shotgun'), { ok: false, reason: 'locked' });
  finishCampaign(profile);
  assert.deepEqual(profile.buy('shotgun'), { ok: false, reason: 'funds' });
  assert.equal(profile.equip('shotgun'), false);
  for (const id of ['unknown', '__proto__', 'toString', null, {}, 1]) {
    assert.deepEqual(profile.buy(id), { ok: false, reason: 'weapon' });
    assert.equal(profile.owns(id), false);
    assert.equal(profile.equip(id), false);
  }
  assert.equal(profile.earn(300), 300);
  assert.deepEqual(profile.buy('shotgun'), { ok: true });
  assert.equal(profile.coins, 60);
  assert.equal(profile.equip('shotgun'), true);
  assert.equal(storage.writes, 5);
  assert.equal(storage.values.size, 1);
  assert.deepEqual(JSON.parse(storage.getItem(PROFILE_KEY)), snapshot({ version: 3, coins: 60, owned: ['rifle', 'shotgun'], equipped: 'shotgun', levels: { rifle: 1, shotgun: 1 }, completedDay: 2 }));
  const restored = new Profile(storage);
  assert.equal(restored.coins, 60);
  assert.equal(restored.owns('shotgun'), true);
  assert.equal(restored.equipped, 'shotgun');
  assert.equal(restored.persistent, true);
  assert.deepEqual(restored.buy('shotgun'), { ok: false, reason: 'owned' });
  assert.deepEqual(restored.buy('rifle'), { ok: false, reason: 'owned' });
  assert.equal(restored.coins, 60);
  assert.equal(storage.writes, 5);
});

test('corrupt, unknown, invalid version and inconsistent snapshots are rejected', () => {
  const invalid = [
    '{', 'null', '[]', 'true', '{}',
    ...[
      { version: 2 }, { version: undefined },
      { coins: -1 }, { coins: 0.5 }, { coins: '300' }, { coins: null },
      { coins: NaN }, { coins: Infinity }, { coins: Number.MAX_SAFE_INTEGER },
      { coins: 1_000_001 }, { coins: undefined },
      { owned: [] }, { owned: ['shotgun'] }, { owned: ['rifle', 'laser'] },
      { owned: ['rifle', 'rifle'] }, { owned: 'rifle' }, { owned: null },
      { equipped: 'laser' }, { equipped: 'shotgun' }, { equipped: null },
    ].map(value => JSON.stringify(snapshot(value))),
  ];
  for (const raw of invalid) {
    const storage = new StorageFake();
    storage.setItem(PROFILE_KEY, raw);
    const profile = new Profile(storage);
    assert.equal(profile.coins, 0, raw);
    assert.equal(profile.equipped, 'rifle', raw);
    assert.equal(profile.owns('rifle'), true, raw);
    assert.equal(profile.owns('shotgun'), false, raw);
    assert.equal(profile.persistent, false, raw);
    assert.equal(profile.earn(10), 10);
    assert.equal(new Profile(storage).coins, 10);
  }
});

test('denied reads and writes allow session progress and preserve it on refresh', () => {
  const storage = new StorageFake();
  storage.denyRead = true;
  storage.denyWrite = true;
  const profile = new Profile(storage);
  assert.equal(profile.persistent, false);
  assert.equal(profile.earn(300), 300);
  finishCampaign(profile);
  assert.deepEqual(profile.buy('shotgun'), { ok: true });
  assert.equal(profile.equip('shotgun'), true);
  assert.equal(profile.persistent, false);
  storage.denyRead = false;
  storage.denyWrite = false;
  storage.setItem(PROFILE_KEY, JSON.stringify(snapshot({ coins: 1 })));
  assert.equal(profile.refresh(), false);
  assert.equal(profile.coins, 60);
  assert.equal(profile.owns('shotgun'), true);
  assert.equal(profile.equipped, 'shotgun');
  assert.equal(profile.persistent, false);
  assert.deepEqual(profile.buy('shotgun'), { ok: false, reason: 'owned' });
  assert.equal(profile.earn(1), 1);
  assert.equal(profile.persistent, true);
  const restored = new Profile(storage);
  assert.equal(restored.coins, 61);
  assert.equal(restored.equipped, 'shotgun');
});

test('a failed write after successful load cannot roll back session progress', () => {
  const storage = new StorageFake();
  storage.setItem(PROFILE_KEY, JSON.stringify(snapshot({})));
  const profile = new Profile(storage);
  finishCampaign(profile);
  storage.denyWrite = true;
  assert.deepEqual(profile.buy('shotgun'), { ok: true });
  assert.equal(profile.persistent, false);
  profile.refresh();
  assert.equal(profile.coins, 60);
  assert.equal(profile.owns('shotgun'), true);
});

test('default storage access is safe when absent or its getter throws', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const get of [() => undefined, () => { throw new Error('SecurityError'); }]) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get });
      const profile = new Profile();
      assert.equal(profile.persistent, false);
      assert.equal(profile.earn(240), 240);
      finishCampaign(profile);
      assert.deepEqual(profile.buy('shotgun'), { ok: true });
      assert.equal(profile.equip('shotgun'), true);
      profile.refresh();
      assert.equal(profile.owns('shotgun'), true);
      assert.equal(profile.persistent, false);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('campaign advances exactly once per day and saves bonus with progress in one snapshot', () => {
  const storage = new StorageFake(), profile = new Profile(storage);
  profile.earn(12); // Immediate kill income.
  profile.earn(8); // Actual pickup income.
  const writes = storage.writes;
  assert.deepEqual(profile.completeDay(2, 999), { ok: false, credited: 0 });
  assert.equal(storage.writes, writes);
  assert.deepEqual(profile.completeDay(1, 30), { ok: true, credited: 30 });
  assert.equal(storage.writes, writes + 1);
  assert.equal(profile.coins, 50);
  assert.equal(profile.completedDay, 1);
  assert.equal(profile.currentDay, 2);
  assert.equal(profile.campaignComplete, false);
  assert.deepEqual(JSON.parse(storage.getItem(PROFILE_KEY)), snapshot({
    version: 3, coins: 50, levels: { rifle: 1 }, completedDay: 1,
  }));
  assert.deepEqual(profile.completeDay(1, 30), { ok: false, credited: 0 });
  assert.deepEqual(profile.completeDay(2, 40), { ok: true, credited: 40 });
  assert.equal(profile.coins, 90);
  assert.equal(profile.currentDay, 2);
  assert.equal(profile.campaignComplete, true);
  const doneWrites = storage.writes;
  for (const day of [1, 2, 3]) assert.deepEqual(profile.completeDay(day, 100), { ok: false, credited: 0 });
  assert.equal(storage.writes, doneWrites);
  assert.equal(new Profile(storage).completedDay, 2);
});

test('completion validates inputs and advances even with zero or capped bonus', () => {
  const storage = new StorageFake(), profile = new Profile(storage);
  for (const bonus of [-1, 1.5, NaN, Infinity, '20', null, undefined, {}, 1n, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(profile.completeDay(1, bonus), { ok: false, credited: 0 });
  }
  for (const day of [0, -1, 3, 1.5, '1', null, undefined, NaN, Infinity, {}, 1n]) {
    assert.deepEqual(profile.completeDay(day, 20), { ok: false, credited: 0 });
  }
  assert.equal(storage.writes, 0);
  assert.equal(profile.completedDay, 0);
  profile.earn(999_999);
  assert.deepEqual(profile.completeDay(1, Number.MAX_SAFE_INTEGER), { ok: true, credited: 1 });
  assert.deepEqual(profile.completeDay(2, 50), { ok: true, credited: 0 });
  assert.equal(new Profile(storage).coins, 1_000_000);
  assert.equal(new Profile(storage).completedDay, 2);
});

test('shotgun purchase needs Day 2 and funds; owned legacy shotgun remains usable', () => {
  const storage = new StorageFake(), profile = new Profile(storage);
  assert.equal(profile.unlocked('rifle'), true);
  assert.equal(profile.canBuy('rifle'), false);
  profile.earn(240);
  for (const day of [0, 1]) {
    assert.equal(profile.completedDay, day);
    assert.equal(profile.unlocked('shotgun'), false);
    assert.equal(profile.canBuy('shotgun'), false);
    const writes = storage.writes;
    assert.deepEqual(profile.buy('shotgun'), { ok: false, reason: 'locked' });
    assert.equal(storage.writes, writes);
    if (day === 0) profile.completeDay(1, 0);
  }
  profile.completeDay(2, 0);
  assert.equal(profile.unlocked('shotgun'), true);
  assert.equal(profile.canBuy('shotgun'), true);
  assert.deepEqual(profile.buy('shotgun'), { ok: true });
  assert.equal(profile.canBuy('shotgun'), false);
  for (const id of ['__proto__', 'toString', null, {}]) {
    assert.equal(profile.unlocked(id), false);
    assert.equal(profile.canBuy(id), false);
  }
  storage.setItem(PROFILE_KEY, JSON.stringify(snapshot({ version: 2, coins: 60,
    owned: ['rifle', 'shotgun'], equipped: 'shotgun', levels: { rifle: 4, shotgun: 3 } })));
  const legacy = new Profile(storage);
  assert.equal(legacy.completedDay, 0);
  assert.equal(legacy.equip('shotgun'), true);
  assert.deepEqual(legacy.upgrade('shotgun'), { ok: false, reason: 'funds' });
  legacy.earn(160);
  assert.deepEqual(legacy.upgrade('shotgun'), { ok: true });
  assert.equal(legacy.weaponLevel('shotgun'), 4);
  assert.equal(legacy.coins, 0);
});

test('stale tabs refresh campaign gates and reject duplicate completion bonuses', () => {
  const storage = new StorageFake(), first = new Profile(storage), stale = new Profile(storage);
  first.completeDay(1, 100);
  const writes = storage.writes;
  assert.deepEqual(stale.completeDay(1, 100), { ok: false, credited: 0 });
  assert.equal(storage.writes, writes);
  assert.equal(stale.coins, 100);
  assert.deepEqual(stale.completeDay(2, 140), { ok: true, credited: 140 });
  assert.deepEqual(first.buy('shotgun'), { ok: true });
  assert.equal(first.completedDay, 2);
  assert.equal(first.coins, 0);
  assert.deepEqual(stale.completeDay(2, 140), { ok: false, credited: 0 });
  assert.equal(stale.coins, 0);
  assert.equal(stale.owns('shotgun'), true);
});

test('failed completion writes retain bonus and progress together until session recovery', () => {
  const storage = new StorageFake(), profile = new Profile(storage);
  profile.earn(20);
  storage.denyWrite = true;
  assert.deepEqual(profile.completeDay(1, 30), { ok: true, credited: 30 });
  assert.equal(profile.persistent, false);
  assert.equal(profile.refresh(), false);
  assert.equal(profile.completedDay, 1);
  assert.equal(profile.coins, 50);
  assert.equal(new Profile(storage).completedDay, 0);
  assert.deepEqual(profile.completeDay(1, 30), { ok: false, credited: 0 });
  storage.denyWrite = false;
  profile.earn(1);
  const restored = new Profile(storage);
  assert.equal(restored.completedDay, 1);
  assert.equal(restored.coins, 51);
  assert.deepEqual(restored.completeDay(1, 30), { ok: false, credited: 0 });
});

test('credits reject malformed amounts and clamp safely at the coin cap', () => {
  const storage = new StorageFake();
  const profile = new Profile(storage);
  for (const amount of [-1, 1.5, NaN, Infinity, -Infinity, '240', null, undefined, {}, 1n, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(profile.earn(amount), 0);
    assert.equal(profile.coins, 0);
  }
  assert.equal(storage.writes, 0);
  assert.equal(profile.earn(0), 0);
  assert.equal(profile.earn(999_999), 999_999);
  assert.equal(profile.earn(Number.MAX_SAFE_INTEGER), 1);
  assert.equal(profile.coins, 1_000_000);
  assert.equal(profile.earn(10), 0);
  assert.equal(new Profile(storage).coins, 1_000_000);
});

test('stale tabs reconcile purchases before equip, purchase and settlement', () => {
  const storage = new StorageFake();
  const first = new Profile(storage);
  first.earn(300);
  finishCampaign(first);
  const stale = new Profile(storage);
  first.buy('shotgun');
  first.equip('shotgun');
  assert.equal(stale.equip('rifle'), true);
  assert.equal(stale.coins, 60);
  assert.equal(stale.owns('shotgun'), true);
  assert.deepEqual(stale.buy('shotgun'), { ok: false, reason: 'owned' });
  first.earn(18);
  stale.earn(20);
  assert.equal(new Profile(storage).coins, 98);
  const writes = storage.writes;
  stale.earn(0);
  assert.equal(storage.writes, writes);
  assert.equal(new Profile(storage).owns('shotgun'), true);
});

test('refresh loads cross-tab snapshots and preserves current state on invalid reads', () => {
  const storage = new StorageFake();
  const profile = new Profile(storage);
  const other = new Profile(storage);
  other.earn(250);
  finishCampaign(other);
  other.buy('shotgun');
  other.equip('shotgun');
  assert.equal(profile.refresh(), true);
  assert.equal(profile.coins, 10);
  assert.equal(profile.equipped, 'shotgun');
  storage.setItem(PROFILE_KEY, '{');
  assert.equal(profile.refresh(), false);
  assert.equal(profile.coins, 10);
  assert.equal(profile.owns('shotgun'), true);
  assert.equal(profile.persistent, false);
  storage.values.delete(PROFILE_KEY);
  assert.equal(profile.refresh(), true);
  assert.equal(profile.coins, 0);
  assert.equal(profile.equipped, 'rifle');
  assert.equal(profile.owns('shotgun'), false);
  assert.equal(profile.persistent, true);
});
