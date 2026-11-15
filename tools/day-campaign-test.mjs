import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5191/?still'); await page.waitForFunction(() => window.__ready);
  const checks = await page.evaluate(async () => {
    const { round: r, profile: p, camera } = window.__game;
    const THREE = await import('/node_modules/three/build/three.module.js');
    const out = [], check = (name, ok) => out.push({ name, ok: !!ok });
    const idle = { move: { x: 0, y: 0 }, turn: 0, firing: false };
    const hit = z => r.damage(z, new THREE.Vector3(0, 0, -1), 999);
    const step = () => { r.invuln = 99; r.update(0.05, idle, camera); };
    const clearDay = () => {
      for (let i = 0; i < 10000 && r.state === 'play'; i++) {
        r.pool.filter(z => r.targetable(z)).forEach(hit);
        step();
      }
    };
    r.reset('rifle'); r.start();
    check('fresh profile begins Day 1 without extraction or active demon', r.day === 1 && !r.encounter.actor.active && !r.extraction);
    r.finish(true); check('manual premature win cannot award or advance', r.state === 'play' && p.completedDay === 0 && p.coins === 0);
    for (let i = 0; i < 100 && r.alive === 0; i++) step();
    const victim = r.pool.find(z => r.targetable(z)); hit(victim);
    check('kill credits wallet immediately', p.coins === 3 && r.income.kills === 3);
    hit(victim); check('duplicate lethal callback cannot pay twice', p.coins === 3);
    r.finish(false); check('death keeps earned gold and current Day', p.coins === 3 && p.completedDay === 0 && r.income.completion === 0);
    r.finish(false); check('duplicate death settlement is inert', p.coins === 3);
    r.reset('rifle'); r.start();
    r.coinDrops.drop(new THREE.Vector3(0, 0, 5), 17);
    for (let i = 0; i < 100 && r.income.pickups === 0; i++) r.coinDrops.update(0.05, r);
    check('nearby gold pack auto collects once', r.income.pickups === 17 && p.coins === 20);
    r.coinDrops.update(1, r); check('pickup cannot credit again', p.coins === 20);
    r.coinDrops.drop(new THREE.Vector3(16, 0, 16), 19);
    r.state = 'paused'; r.coinDrops.update(10, r); check('paused drops do not pay', p.coins === 20);
    r.state = 'play'; r.finish(false); check('death leaves uncollected pack uncredited', p.coins === 20);
    r.reset('rifle'); r.start(); const before1 = p.coins; clearDay();
    check('Day 1 clears all 20 planned enemies and advances once', r.state === 'win' && r.kills === 20 && p.completedDay === 1 && p.currentDay === 2);
    check('Day 1 total is kill60 + pack20 + clear40, not double settled', p.coins - before1 === 120 && r.income.kills === 60 && r.income.pickups === 20 && r.income.completion === 40);
    r.finish(true); check('repeated win cannot duplicate completion bonus', p.coins === before1 + 120);
    r.reset('shotgun', { trial: true }); r.start(); const beforeTrial = p.coins; clearDay();
    check('trial can clear Day 2 but pays no coins and cannot advance', r.state === 'win' && p.completedDay === 1 && p.coins === beforeTrial && r.loot === 0 && r.weapon.level === 1);
    r.reset('rifle'); r.start(); const before2 = p.coins; clearDay();
    check('Day 2 clears 26 enemies and ends available campaign', r.state === 'win' && r.kills === 26 && p.completedDay === 2 && p.campaignComplete);
    check('Day 2 total is kill78 + pack24 + clear48', p.coins - before2 === 150 && r.income.kills === 78 && r.income.pickups === 24 && r.income.completion === 48);
    r.reset('rifle'); check('completed Day cannot be replayed as a paying main stage', r.start() === false && r.state !== 'play');
    const mainProgress = p.completedDay;
    for (let i = 0; i < 2; i++) {
      r.reset('rifle', { mode: 'challenge' }); r.start(); const before = p.coins; clearDay();
      check(`repeat challenge ${i + 1} pays 150 without changing main progress`, r.state === 'win' && p.coins === before + 150 && p.completedDay === mainProgress);
    }
    check('finished round preserves wave metadata for HUD', r.waveCount === 3 && r.waveIndex === 2);
    return out;
  });
  checks.forEach(c => console.log(c.ok ? 'PASS' : 'FAIL', c.name));
  assert(checks.every(c => c.ok)); assert.deepEqual(errors, []);
  await page.reload(); await page.waitForFunction(() => window.__ready);
  assert.equal(await page.evaluate(() => window.__game.profile.completedDay), 2);
  console.log('PASS reload restores completed campaign and wallet');
} finally { await browser.close(); }
