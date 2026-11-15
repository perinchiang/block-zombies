#!/usr/bin/env node
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { PROFILE_KEY } from '../src/game/profile.js';
const baseURL = process.env.SHOP_TEST_URL || 'http://127.0.0.1:5191/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ready = () => page.waitForFunction(() => window.__ready);
  const main = () => page.locator('#panel .btn');
  const back = async () => { await page.getByRole('button', { name: '返回商店', exact: true }).tap(); await page.waitForFunction(() => window.__game.round.state === 'shop'); };
  const balance = () => page.evaluate(() => window.__game.profile.coins);
  // Only exercises result/shop UI; full wave completion and rewards live in day-campaign-test.
  const finish = win => page.evaluate(win => {
    const R = window.__game.round;
    if (win) { R.pool.forEach(z => R.retire(z)); R.director.readyToComplete = true; }
    R.finish(win);
  }, win);
  await page.goto(baseURL); await ready();
  assert.equal(await balance(), 0);
  assert.equal(await main().innerText(), '挑战 Day 1');
  assert(await page.locator('.shop-buy').isDisabled());
  assert.equal(await page.locator('.weapon-choice[data-weapon="shotgun"]').count(), 0);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__game.round.elapsed), 0);
  console.log('PASS new profile starts at Day 1 with free rifle, gated shotgun and frozen shop');

  for (const win of [true, false]) {
    await page.locator('.shop-trial').tap();
    assert(await page.evaluate(() => window.__game.round.trial && window.__game.round.weapon.id === 'shotgun'));
    await finish(win); await back();
    assert.equal(await balance(), 0);
    assert(await page.evaluate(() => window.__game.profile.completedDay === 0 && window.__game.profile.equipped === 'rifle' && !window.__game.profile.owns('shotgun')));
  }
  console.log('PASS trial results preserve wallet, campaign progress and saved equipment');

  await page.evaluate(() => { window.__game.profile.earn(1000); window.__game.openShop(); });
  assert(await page.locator('.shop-buy').isDisabled());
  assert.equal(await page.evaluate(() => window.__game.profile.buy('shotgun').reason), 'locked');
  assert.equal(await balance(), 1000);
  await page.evaluate(() => { window.__game.profile.completeDay(1, 0); window.__game.openShop(); });
  assert.equal(await main().innerText(), '挑战 Day 2');
  assert(await page.locator('.shop-buy').isDisabled());
  assert.equal(await page.evaluate(() => window.__game.profile.buy('shotgun').reason), 'locked');
  assert.equal(await balance(), 1000);
  await page.evaluate(() => { window.__game.profile.completeDay(2, 0); window.__game.openShop(); });
  assert(await main().isDisabled());
  assert(await page.locator('.shop-buy').isEnabled());
  await page.reload(); await ready();
  assert(await main().isDisabled());
  assert(await page.locator('.shop-trial').isEnabled());
  await page.evaluate(() => window.__game.begin('rifle'));
  assert.equal(await page.evaluate(() => window.__game.round.state), 'shop');
  assert.equal(await balance(), 1000);
  await page.locator('.shop-trial').tap();
  assert(await page.evaluate(() => window.__game.round.state === 'play' && window.__game.round.trial));
  await finish(true); await back();
  assert.equal(await balance(), 1000);
  assert.equal(await page.evaluate(() => window.__game.profile.completedDay), 2);
  console.log('PASS rich profiles cannot bypass either Day gate; completed main stays locked across refresh while trial remains available');

  await page.locator('.shop-buy').tap();
  assert.equal(await balance(), 760);
  assert(await page.evaluate(() => window.__game.profile.owns('shotgun') && window.__game.profile.equipped === 'shotgun'));
  await page.reload(); await ready();
  assert.equal(await page.locator('.weapon-choice[data-weapon="shotgun"]').getAttribute('aria-pressed'), 'true');
  await page.locator('.weapon-choice[data-weapon="rifle"]').tap();
  await page.reload(); await ready();
  assert.equal(await page.locator('.weapon-choice[data-weapon="rifle"]').getAttribute('aria-pressed'), 'true');
  const upgrade = page.locator('.shop-upgrade[data-weapon="rifle"]');
  assert.match(await upgrade.innerText(), /Lv\.2 · 60 金币/);
  assert.match(await page.locator('.weapon-product').first().innerText(), /伤害 ×1.5 · 弹匣 27/);
  await upgrade.evaluate(button => { button.click(); button.click(); });
  assert.equal(await balance(), 700);
  assert.equal(await page.evaluate(() => window.__game.profile.weaponLevel('rifle')), 2);
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => window.__game.profile.weaponLevel('rifle')), 2);
  await page.evaluate(async () => { const { Profile } = await import('/src/game/profile.js'); new Profile().upgrade('rifle'); });
  await page.locator('.shop-upgrade[data-weapon="rifle"]').tap();
  assert.equal(await balance(), 580);
  assert.equal(await page.evaluate(() => window.__game.profile.weaponLevel('rifle')), 3);
  await page.locator('.shop-upgrade[data-weapon="rifle"]').tap();
  assert.equal(await balance(), 360);
  assert.equal(await page.locator('.shop-upgrade[data-weapon="rifle"]').count(), 0);
  assert.match(await page.locator('.weapon-product').first().innerText(), /已满级/);
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => window.__game.profile.weaponLevel('rifle')), 4);
  console.log('PASS purchase, equipment and upgrades persist; duplicate clicks and stale tier cards cannot buy extra upgrades');

  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 2, coins: 300, owned: ['rifle', 'shotgun'], equipped: 'shotgun', levels: { rifle: 4, shotgun: 4 } })), PROFILE_KEY);
  await page.reload(); await ready();
  assert(await page.evaluate(key => {
    const P = window.__game.profile, saved = JSON.parse(localStorage.getItem(key));
    return saved.version === 3 && P.completedDay === 0 && P.coins === 300 && P.owns('shotgun') && P.equipped === 'shotgun' && P.weaponLevel('rifle') === 4 && P.weaponLevel('shotgun') === 4;
  }, PROFILE_KEY));
  await main().tap();
  assert(await page.evaluate(() => window.__game.round.weapon.id === 'shotgun' && window.__game.round.weapon.level === 4 && !window.__game.round.trial));
  await finish(false); await back();
  assert.equal(await balance(), 300);
  console.log('PASS legacy Lv4 weapons migrate to v3 intact and remain usable before Day 2');

  for (const [width, height] of [[852, 393], [667, 375]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => localStorage.removeItem('block-zombies:tutorial-seen-v2'));
    await page.reload(); await ready();
    assert.equal(await page.locator('.tutorial').count(), 1);
    await main().scrollIntoViewIfNeeded();
    const box = await main().boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= height);
    const layout = await page.locator('.card').evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, fits: el.scrollWidth <= el.clientWidth + 1 }; });
    assert(layout.fits && layout.left >= 0 && layout.right <= width);
  }
  console.log('PASS tutorial, equipment cards and Day button remain reachable on phone landscapes');
  assert.deepEqual(errors, []);
  await context.close();

  const denied = await browser.newPage({ viewport: { width: 667, height: 375 } });
  const deniedErrors = []; denied.on('pageerror', e => deniedErrors.push(e.message));
  await denied.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
  await denied.goto(baseURL); await denied.waitForFunction(() => window.__ready);
  assert.match(await denied.locator('#panel').innerText(), /存档不可用/);
  await denied.evaluate(() => { const P = window.__game.profile; P.earn(300); P.completeDay(1, 0); P.completeDay(2, 0); window.__game.openShop(); });
  await denied.locator('.shop-buy').click();
  assert(await denied.evaluate(() => window.__game.profile.coins === 60 && window.__game.profile.owns('shotgun') && !window.__game.profile.persistent));
  assert.match(await denied.locator('#panel').innerText(), /存档不可用/);
  assert.deepEqual(deniedErrors, []);
  console.log('PASS denied storage keeps unlocked purchases usable in session with an explicit warning');
} finally { await browser.close(); }
