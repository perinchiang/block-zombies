export const PROFILE_KEY = 'block-zombies.profile.v1';
export const SHOP_PRICES = Object.freeze({ rifle: 0, shotgun: 240 });
const MAX_COINS = 1_000_000;
const isWeapon = id => id === 'rifle' || id === 'shotgun';

function validSnapshot(value) {
  return value !== null && typeof value === 'object' && value.version === 1 &&
    Number.isSafeInteger(value.coins) && value.coins >= 0 && value.coins <= MAX_COINS &&
    Array.isArray(value.owned) && value.owned.every(isWeapon) &&
    new Set(value.owned).size === value.owned.length && value.owned.includes('rifle') &&
    isWeapon(value.equipped) && value.owned.includes(value.equipped);
}

export class Profile {
  #storage;
  #coins = 0;
  #owned = new Set(['rifle']);
  #equipped = 'rifle';
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

  owns(id) { return isWeapon(id) && this.#owned.has(id); }

  refresh() {
    // A stale disk snapshot must never replace progress that failed to save.
    if (this.#dirty) return false;
    try {
      const raw = this.#storage.getItem(PROFILE_KEY);
      const snapshot = raw === null
        ? { version: 1, coins: 0, owned: ['rifle'], equipped: 'rifle' }
        : JSON.parse(raw);
      if (!validSnapshot(snapshot)) throw new Error('Invalid profile');
      this.#coins = snapshot.coins;
      this.#owned = new Set(snapshot.owned);
      this.#equipped = snapshot.equipped;
      this.#persistent = true;
      return true;
    } catch {
      this.#persistent = false;
      return false;
    }
  }

  #save() {
    this.#dirty = true;
    try {
      this.#storage.setItem(PROFILE_KEY, JSON.stringify({
        version: 1, coins: this.#coins, owned: [...this.#owned], equipped: this.#equipped,
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
    const price = SHOP_PRICES[id];
    if (this.#coins < price) return { ok: false, reason: 'funds' };
    this.#coins -= price;
    this.#owned.add(id);
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
}
