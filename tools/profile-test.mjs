import assert from 'node:assert/strict';
import test from 'node:test';
import { Profile, PROFILE_KEY, SHOP_PRICES } from '../src/game/profile.js';

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
  assert.equal(storage.writes, 0);
});

test('funds, purchases, ownership, equipment and atomic snapshot reload', () => {
  const storage = new StorageFake();
  const profile = new Profile(storage);
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
  assert.equal(storage.writes, 3);
  assert.equal(storage.values.size, 1);
  assert.deepEqual(JSON.parse(storage.getItem(PROFILE_KEY)), snapshot({ coins: 60, owned: ['rifle', 'shotgun'], equipped: 'shotgun' }));
  const restored = new Profile(storage);
  assert.equal(restored.coins, 60);
  assert.equal(restored.owns('shotgun'), true);
  assert.equal(restored.equipped, 'shotgun');
  assert.equal(restored.persistent, true);
  assert.deepEqual(restored.buy('shotgun'), { ok: false, reason: 'owned' });
  assert.deepEqual(restored.buy('rifle'), { ok: false, reason: 'owned' });
  assert.equal(restored.coins, 60);
  assert.equal(storage.writes, 3);
});

test('corrupt, unknown, invalid version and inconsistent snapshots are rejected', () => {
  const invalid = [
    '{', 'null', '[]', 'true', '{}',
    ...[
      { version: 0 }, { version: 2 }, { version: '1' }, { version: undefined },
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
