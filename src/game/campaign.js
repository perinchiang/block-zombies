const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

export const CAMPAIGN_DAYS = freeze({
  1: {
    day: 1, completeBonus: 40, totalCoins: 120,
    waves: [
      { location: { x: 0, z: -12 }, enemies: [{ runner: false, count: 6 }] },
      { location: { x: -19, z: -10 }, enemies: [{ runner: false, count: 6 }] },
      { location: { x: 19, z: 10 }, enemies: [{ runner: false, count: 7 }, { runner: false, count: 1, bounty: 20 }] }
    ]
  },
  2: {
    day: 2, completeBonus: 48, totalCoins: 150,
    waves: [
      { location: { x: 0, z: -12 }, enemies: [{ runner: false, count: 8 }] },
      { location: { x: -19, z: -10 }, enemies: [{ runner: false, count: 5 }, { runner: true, count: 3 }] },
      { location: { x: 19, z: 10 }, enemies: [{ runner: false, count: 6 }, { runner: true, count: 3 }, { runner: true, count: 1, bounty: 24 }] }
    ]
  }
});

export function getDay(day) {
  const config = CAMPAIGN_DAYS[day];
  if (!config) throw new RangeError(`Campaign day ${day} does not exist`);
  return config;
}

export class CampaignDirector {
  constructor(scene = null) {
    this.scene = scene;
    this.clear();
  }

  reset(day) {
    this.config = getDay(day);
    this.waveIndex = 0;
    this.waveCount = this.config.waves.length;
    this.queue = [];
    this.elapsed = 0;
    this.intermission = 0;
    this.started = false;
    this.readyToComplete = false;
    this._remaining = this.config.waves.reduce((sum, wave) => sum + wave.enemies.reduce((n, group) => n + group.count, 0), 0);
  }

  clear() {
    this.config = null;
    this.waveIndex = 0;
    this.waveCount = 0;
    this.queue = [];
    this.elapsed = 0;
    this.intermission = 0;
    this.started = false;
    this.readyToComplete = false;
    this._remaining = 0;
  }

  remaining(round) { return this._remaining + (round?.alive ?? 0); }

  _loadWave(index) {
    this.waveIndex = index;
    const wave = this.config.waves[index];
    this.queue = wave.enemies.flatMap(group => Array.from({ length: group.count }, (_, i) => ({
      x: wave.location.x, z: wave.location.z,
      runner: group.runner, bounty: group.bounty ?? 0
    })));
    this.intermission = 0;
  }

  update(dt, round) {
    if (dt <= 0 || round?.state !== 'play' || !this.config || this.readyToComplete) return;
    if (!this.started) {
      this.elapsed += dt;
      if (this.elapsed < 1) return;
      this.started = true;
      this._loadWave(0);
      round.notice = '第 1 波：北侧街道来敌'; round.noticeT = 4;
    }
    if (this.queue.length) {
      if (round.alive >= 12) return;
      const enemy = this.queue[0], hero = round.hero.root.position;
      if (Math.hypot(hero.x - enemy.x, hero.z - enemy.z) <= 3) {
        round.notice = '离开入口几步，让尸群进入街区'; round.noticeT = 2;
        return;
      }
      if (round.pool.some(z => z.active && !z.dead && Math.hypot(z.root.position.x - enemy.x, z.root.position.z - enemy.z) <= 1.5)) return;
      const z = round.spawn(enemy.x, enemy.z, enemy.runner, false);
      if (!z) return;
      z.coinValue = 3;
      z.coinPackValue = enemy.bounty;
      if (z.bountyMarker) z.bountyMarker.visible = enemy.bounty > 0;
      this.queue.shift();
      this._remaining--;
      return;
    }
    if (round.alive > 0) return;
    if (this.waveIndex + 1 < this.waveCount) {
      this.intermission += dt;
      if (this.intermission >= 5) {
        this._loadWave(this.waveIndex + 1);
        round.notice = `第 ${this.waveIndex + 1} 波：${this.waveIndex === 1 ? '西侧' : '东侧'}入口来敌`; round.noticeT = 4;
      } else {
        round.notice = `本波清理完成，${Math.ceil(5 - this.intermission)} 秒后下一波`; round.noticeT = 1;
      }
      return;
    }
    this.readyToComplete = true;
  }
}
