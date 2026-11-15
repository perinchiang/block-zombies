import { UPGRADE_COSTS } from './weapons.js';

export const PROFILE_KEY = 'block-zombies.profile.v1';
export const SHOP_PRICES = Object.freeze({ rifle: 0, shotgun: 240 });
const MAX_COINS = 1_000_000;
const MAX_DAY = 2;
const isWeapon = id => id === 'rifle' || id === 'shotgun';

function validLevels(value, owned) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === owned.length && owned.every(id =>
      Object.hasOwn(value, id) && Number.isInteger(value[id]) && value[id] >= 1 && value[id] <= 4);
}

function validSnapshot(value) {
  if (value === null || typeof value !== 'object' ||
      ![1, 2, 3].includes(value.version) ||
      !Number.isSafeInteger(value.coins) || value.coins < 0 || value.coins > MAX_COINS ||
      !Array.isArray(value.owned) || !value.owned.every(isWeapon) ||
      new Set(value.owned).size !== value.owned.length || !value.owned.includes('rifle') ||
      !isWeapon(value.equipped) || !value.owned.includes(value.equipped)) return false;

  if (value.version === 1) return true;
  if (!validLevels(value.levels, value.owned)) return false;
  return value.version === 2 ||
    (Number.isInteger(value.completedDay) && value.completedDay >= 0 && value.completedDay <= MAX_DAY);
}

export class Profile {
  #storage;
  #coins = 0;
  #owned = new Set(['rifle']);
  #equipped = 'rifle';
  #levels = { rifle: 1 };
  #completedDay = 0;
  #blocked = false;
  #dirty = false;
  #persistent = false;

  // Resolve the default inside the try: localStorage's getter itself can throw.
  constructor(storage) {
    try {
      this.#storage = storage === undefined ? globalThis.localStorage : storage;
    } catch {
      return;
    }
    this.refresh();
  }

  get coins() { return this.#coins; }
  get equipped() { return this.#equipped; }
  get persistent() { return this.#persistent; }
  get completedDay() { return this.#completedDay; }
  get currentDay() { return Math.min(this.#completedDay + 1, MAX_DAY); }
  get campaignComplete() { return this.#completedDay >= MAX_DAY; }

  owns(id) { return isWeapon(id) && this.#owned.has(id); }

  // Permanent weapon levels are retained for legacy Lv4 saves.
  weaponLevel(id) { return this.owns(id) ? this.#levels[id] : 0; }

  // Whether the campaign gate for a weapon has been met, without checking coins or ownership.
  unlocked(id) { return id === 'rifle' || (id === 'shotgun' && this.#completedDay >= MAX_DAY); }

  // Whether a new purchase can currently be made, including funds and the unlock gate.
  canBuy(id) {
    return isWeapon(id) && !this.owns(id) && this.unlocked(id) && this.#coins >= SHOP_PRICES[id];
  }

  refresh() {
    // A stale disk snapshot must never replace progress that failed to save.
    if (this.#dirty) return false;
    try {
      const raw = this.#storage.getItem(PROFILE_KEY);
      const snapshot = raw === null
        ? { version: 1, coins: 0, owned: ['rifle'], equipped: 'rifle' }
        : JSON.parse(raw);
      if (snapshot && Object.hasOwn(snapshot, 'version') &&
          snapshot.version !== 1 && snapshot.version !== 2 && snapshot.version !== 3) this.#blocked = true;
      if (!validSnapshot(snapshot)) throw new Error('Invalid profile');
      this.#coins = snapshot.coins;
      this.#owned = new Set(snapshot.owned);
      this.#equipped = snapshot.equipped;
      this.#levels = snapshot.version === 1
        ? Object.fromEntries(snapshot.owned.map(id => [id, 1])) : { ...snapshot.levels };
      this.#completedDay = snapshot.version === 3 ? snapshot.completedDay : 0;
      this.#persistent = !this.#blocked;
      if (raw !== null && snapshot.version !== 3) this.#save();
      return true;
    } catch {
      this.#persistent = false;
      return false;
    }
  }

  #save() {
    this.#dirty = true;
    try {
      // Also protect a newer save written while this session has unsaved progress.
      try {
        const disk = JSON.parse(this.#storage.getItem(PROFILE_KEY));
        if (disk && Object.hasOwn(disk, 'version') &&
            disk.version !== 1 && disk.version !== 2 && disk.version !== 3) this.#blocked = true;
      } catch { /* Unavailable or corrupt storage still permits session fallback. */ }
      if (this.#blocked) throw new Error('Unsupported profile version');
      this.#storage.setItem(PROFILE_KEY, JSON.stringify({
        version: 3, coins: this.#coins, owned: [...this.#owned], equipped: this.#equipped,
        levels: { ...this.#levels }, completedDay: this.#completedDay,
      }));
      this.#dirty = false;
      this.#persistent = true;
    } catch {
      this.#persistent = false;
    }
  }

  buy(id) {
    this.refresh();
    if (!isWeapon(id)) return { ok: false, reason: 'weapon' };
    if (this.owns(id)) return { ok: false, reason: 'owned' };
    if (!this.unlocked(id)) return { ok: false, reason: 'locked' };
    const price = SHOP_PRICES[id];
    if (this.#coins < price) return { ok: false, reason: 'funds' };
    this.#coins -= price;
    this.#owned.add(id);
    this.#levels[id] = 1;
    this.#save();
    return { ok: true };
  }

  upgrade(id) {
    this.refresh();
    if (!isWeapon(id)) return { ok: false, reason: 'weapon' };
    if (!this.owns(id)) return { ok: false, reason: 'unowned' };
    const level = this.weaponLevel(id);
    if (level === 4) return { ok: false, reason: 'max' };
    const price = UPGRADE_COSTS[level];
    if (this.#coins < price) return { ok: false, reason: 'funds' };
    this.#coins -= price;
    this.#levels[id] = level + 1;
    this.#save();
    return { ok: true };
  }

  equip(id) {
    this.refresh();
    if (!this.owns(id)) return false;
    if (this.#equipped !== id) {
      this.#equipped = id;
      this.#save();
    }
    return true;
  }

  earn(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0) return 0;
    this.refresh();
    const credited = Math.min(amount, MAX_COINS - this.#coins);
    this.#coins += credited;
    if (credited > 0) this.#save();
    return credited;
  }

  completeDay(day, bonus) {
    this.refresh();
    if (!Number.isInteger(day) || !Number.isSafeInteger(bonus) || bonus < 0 ||
        day !== this.#completedDay + 1 || day > MAX_DAY) return { ok: false, credited: 0 };
    const credited = Math.min(bonus, MAX_COINS - this.#coins);
    this.#coins += credited;
    this.#completedDay = day;
    this.#save();
    return { ok: true, credited };
  }
}
