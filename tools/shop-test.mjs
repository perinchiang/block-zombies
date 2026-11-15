#!/usr/bin/env node
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const baseURL = process.env.SHOP_TEST_URL || 'http://127.0.0.1:5191/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ready = () => page.waitForFunction(() => window.__ready);
  const go = () => page.getByRole('button', { name: '进入街道', exact: true }).tap();
  const back = async () => { await page.getByRole('button', { name: '返回商店', exact: true }).tap(); await page.waitForFunction(() => window.__game.round.state === 'shop'); };
  const balance = () => page.evaluate(() => window.__game.profile.coins);
  await page.goto(baseURL); await ready();
  assert.equal(await balance(), 0);
  assert(await page.locator('.shop-buy').isDisabled());
  assert.equal(await page.locator('.weapon-choice[data-weapon="shotgun"]').count(), 0);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__game.round.elapsed), 0);
  console.log('PASS new profile starts with free rifle, locked shotgun and frozen shop');

  await page.locator('.shop-trial').tap();
  assert(await page.evaluate(() => window.__game.round.trial && window.__game.round.weapon.id === 'shotgun'));
  await page.evaluate(() => { const R = window.__game.round; R.loot = 500; R.finish(true); R.finish(true); });
  await back();
  assert.equal(await balance(), 0);
  assert(await page.evaluate(() => window.__game.profile.equipped === 'rifle' && !window.__game.profile.owns('shotgun')));
  await page.locator('.shop-trial').tap();
  await page.evaluate(() => { const R = window.__game.round; R.loot = 500; R.finish(false); });
  await back(); assert.equal(await balance(), 0);
  console.log('PASS trial success and death never credit coins or unlock/change saved equipment');

  await go();
  await page.evaluate(() => { const R = window.__game.round; R.loot = 300; R.finish(true); R.finish(true); });
  await back(); assert.equal(await balance(), 300);
  await page.reload(); await ready(); assert.equal(await balance(), 300);
  await page.locator('.shop-buy').tap();
  assert.equal(await balance(), 60);
  assert(await page.evaluate(() => window.__game.profile.owns('shotgun') && window.__game.profile.equipped === 'shotgun'));
  assert.equal(await page.locator('.shop-buy').count(), 0);
  await page.reload(); await ready();
  assert.equal(await page.locator('.weapon-choice[data-weapon="shotgun"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await balance(), 60);
  console.log('PASS extraction credits once, purchase debits once, wallet/ownership/equipment survive refresh');

  await go();
  assert(await page.evaluate(() => !window.__game.round.trial && window.__game.round.weapon.id === 'shotgun'));
  await page.evaluate(() => { const R = window.__game.round; R.loot = 75; R.finish(false); R.finish(false); });
  await back(); assert.equal(await balance(), 78);
  assert(await page.evaluate(() => window.__game.profile.owns('shotgun')));
  await page.locator('.weapon-choice[data-weapon="rifle"]').tap();
  await page.reload(); await ready();
  assert.equal(await page.locator('.weapon-choice[data-weapon="rifle"]').getAttribute('aria-pressed'), 'true');
  console.log('PASS death credits floor(25%) once, preserves purchased gun, and switching equipment persists');

  const upgrade = page.locator('.shop-upgrade[data-weapon="rifle"]');
  assert.match(await upgrade.innerText(), /Lv\.2 · 60 金币/);
  assert.match(await page.locator('.weapon-product').first().innerText(), /伤害 ×1.5 · 弹匣 27/);
  await upgrade.evaluate(button => { button.click(); button.click(); });
  assert.equal(await balance(), 18);
  assert.equal(await page.evaluate(() => window.__game.profile.weaponLevel('rifle')), 2);
  assert(await page.locator('.shop-upgrade[data-weapon="rifle"]').isDisabled());
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => window.__game.profile.weaponLevel('rifle')), 2);
  // A stale card must refresh rather than silently purchase the following tier.
  await page.evaluate(() => {
    const P = window.__game.profile;
    P.earn(500);
  });
  await page.reload(); await ready();
  await page.evaluate(async () => {
    const { Profile } = await import('/src/game/profile.js');
    new Profile().upgrade('rifle');
  });
  await page.locator('.shop-upgrade[data-weapon="rifle"]').tap();
  assert.equal(await balance(), 398);
  assert.equal(await page.evaluate(() => window.__game.profile.weaponLevel('rifle')), 3);
  await page.locator('.shop-upgrade[data-weapon="rifle"]').tap();
  assert.equal(await balance(), 178);
  assert.equal(await page.locator('.shop-upgrade[data-weapon="rifle"]').count(), 0);
  assert.match(await page.locator('.weapon-product').first().innerText(), /已满级/);
  console.log('PASS upgrades persist, debit once per click, reject stale tier cards and show max level');

  for (const [width, height] of [[852, 393], [667, 375]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { localStorage.removeItem('block-zombies:tutorial-seen'); });
    await page.reload(); await ready();
    await page.getByRole('button', { name: '进入街道', exact: true }).scrollIntoViewIfNeeded();
    const startBox = await page.getByRole('button', { name: '进入街道', exact: true }).boundingBox();
    assert(startBox && startBox.y >= 0 && startBox.y + startBox.height <= height);
    const layout = await page.locator('.card').evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, fits: el.scrollWidth <= el.clientWidth + 1 }; });
    assert(layout.fits && layout.left >= 0 && layout.right <= width);
    // Keep this regression read-only outside its owned test files.
  }
  console.log('PASS shop tutorial, equipment cards and start button remain reachable on phone landscapes');
  assert.deepEqual(errors, []);
  await context.close();

  const denied = await browser.newPage({ viewport: { width: 667, height: 375 } });
  await denied.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
  await denied.goto(baseURL); await denied.waitForFunction(() => window.__ready);
  assert.match(await denied.locator('#panel').innerText(), /存档不可用/);
  await denied.getByRole('button', { name: '进入街道', exact: true }).click();
  await denied.evaluate(() => { const R = window.__game.round; R.loot = 300; R.finish(true); });
  await denied.getByRole('button', { name: '返回商店', exact: true }).click();
  await denied.locator('.shop-buy').click();
  assert(await denied.evaluate(() => window.__game.profile.coins === 60 && window.__game.profile.owns('shotgun') && !window.__game.profile.persistent));
  console.log('PASS denied local storage keeps purchases usable in the current session with an explicit warning');
} finally { await browser.close(); }
