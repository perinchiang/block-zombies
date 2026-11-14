#!/usr/bin/env node
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5191/'); await page.waitForFunction(() => window.__ready);
  await page.locator('[data-weapon="shotgun"]').tap();
  assert.equal(await page.locator('[data-weapon="shotgun"]').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '进入街道' }).tap();
  await page.waitForFunction(() => window.__game.round.weapon.id === 'shotgun');
  assert.equal(await page.locator('.ammo').innerText(), '6/6');
  assert(await page.evaluate(() => window.__game.round.hero.shotgun.visible && !window.__game.round.hero.rifle.visible));
  await page.getByRole('button', { name: '暂停', exact: true }).tap();
  assert.match(await page.locator('#panel').innerText(), /本局物资 · 霰弹枪/);
  await page.getByRole('button', { name: '继续游戏' }).tap();
  await page.evaluate(() => window.__game.round.finish(false));
  await page.getByRole('button', { name: '再来一局' }).waitFor();
  assert.equal(await page.locator('[data-weapon="shotgun"]').getAttribute('aria-pressed'), 'true');
  const layout = await page.locator('.card').evaluate(el => ({ overflow: el.scrollHeight > el.clientHeight, bottom: el.querySelector('.btn').getBoundingClientRect().bottom }));
  assert(!layout.overflow && layout.bottom < 375, 'result loadout and retry button fit phone landscape');
  await page.screenshot({ path: '/tmp/bz/m2-result-667.png' });
  await page.locator('[data-weapon="rifle"]').tap();
  await page.getByRole('button', { name: '再来一局' }).tap();
  await page.waitForFunction(() => window.__game.round.weapon.id === 'rifle' && window.__game.round.state === 'play');
  await page.waitForFunction(() => document.querySelector('.ammo').innerText === '24/24');
  assert.equal(await page.locator('.tutorial').count(), 0);
  assert(await page.evaluate(() => window.__game.round.hero.rifle.visible && !window.__game.round.hero.shotgun.visible));

  // Freeze an active telegraphed attack via the real pause control.
  await page.evaluate(() => {
    const R = window.__game.round;
    R.pool.forEach(z => { if (!z.demon) R.retire(z); }); R.spawnT = 999;
    R.hero.root.position.set(-2, 0, -38); R.encounter.actor.attackT = 0;
  });
  await page.waitForFunction(() => window.__game.round.encounter.projectiles.some(p => p.active));
  await page.getByRole('button', { name: '暂停', exact: true }).tap();
  const snapshot = () => page.evaluate(() => {
    const E = window.__game.round.encounter;
    return { cast: E.actor.cast, hp: E.actor.hp, age: E.projectiles.map(p => p.age), positions: E.projectiles.map(p => p.ball.position.toArray()) };
  });
  const frozen = await snapshot(); await page.waitForTimeout(400);
  assert.deepEqual(await snapshot(), frozen);
  await page.getByRole('button', { name: '继续游戏' }).tap();
  await page.waitForTimeout(100); assert.notDeepEqual(await snapshot(), frozen);
  assert.deepEqual(errors, []);
  console.log('PASS mobile weapon choice, ammo, retry persistence, result layout, and live demon pause');
} finally { await browser.close(); }
