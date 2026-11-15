import assert from 'node:assert/strict';
import { CAMPAIGN_DAYS, CampaignDirector, getDay } from '../src/game/campaign.js';

for (const [day, kills, bounty, bonus, total] of [[1, 60, 20, 40, 120], [2, 78, 24, 48, 150]]) {
  const config = getDay(day);
  const enemies = config.waves.flatMap(wave => wave.enemies);
  assert.equal(enemies.reduce((sum, group) => sum + group.count, 0) * 3, kills);
  assert.equal(enemies.reduce((sum, group) => sum + group.count * (group.bounty || 0), 0), bounty);
  assert.equal(config.completeBonus, bonus);
  assert.equal(kills + bounty + bonus, total);
  assert.equal(config.totalCoins, total);
  assert(Object.isFrozen(config) && Object.isFrozen(config.waves[0].location));
}
assert.throws(() => getDay(3), RangeError);
assert(Object.isFrozen(CAMPAIGN_DAYS));

function fakeRound() {
  const pool = Array.from({ length: 13 }, () => ({ active: false, dead: false, root: { position: { x: 100, z: 100 } } }));
  return {
    state: 'play', alive: 0, pool,
    hero: { root: { position: { x: 50, z: 50 } } },
    block: false,
    spawn(x, z, runner) {
      if (this.block) return null;
      const enemy = pool.find(candidate => !candidate.active);
      if (!enemy) return null;
      Object.assign(enemy, { active: true, dead: false, runner, coinValue: 0, coinPackValue: 0, bountyMarker: { visible: false } });
      enemy.root.position = { x, z };
      this.alive++;
      return enemy;
    }
  };
}

const director = new CampaignDirector();
director.reset(1);
const round = fakeRound();
director.update(1, round);
assert.equal(director.queue.length, 5);
round.block = true;
director.update(1, round);
assert.equal(director.queue.length, 5, 'failed pool spawn remains queued');
round.block = false;
director.update(0, round);
assert.equal(director.queue.length, 5, 'paused update does not consume queue');
round.hero.root.position = { x: 0, z: -12 };
director.update(1, round);
assert.equal(director.queue.length, 5, 'blocked location remains queued');
round.hero.root.position = { x: 50, z: 50 };
const retireAll = () => {
  for (const enemy of round.pool) if (enemy.active) enemy.active = false;
  round.alive = 0;
};
for (let wave = 0; wave < director.waveCount; wave++) {
  if (wave > 0) { director.update(5, round); }
  while (director.queue.length) {
    const queued = director.queue.length;
    director.update(0.01, round);
    if (director.queue.length === queued) retireAll();
  }
  retireAll();
}
director.update(0.01, round);
assert.equal(director.remaining(round), 0);
assert.equal(director.waveIndex, 2);
assert.equal(director.readyToComplete, true);
director.reset(1);
const bountyRound = fakeRound(); bountyRound.hero.root.position = { x: 50, z: 50 };
director.started = true; director.waveIndex = 2;
director.queue = [{ x: 19, z: 10, runner: false, bounty: 20 }];
director._remaining = 1;
director.update(0.01, bountyRound);
const bountyEnemy = bountyRound.pool.find(enemy => enemy.active);
assert.equal(bountyEnemy.coinValue, 3);
assert.equal(bountyEnemy.coinPackValue, 20);
assert.equal(bountyEnemy.bountyMarker.visible, true);
console.log('PASS campaign configs, payouts, immutability, rejection, and spawn retry/pause behavior');
