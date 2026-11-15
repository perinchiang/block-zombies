#!/usr/bin/env node
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { PROFILE_KEY } from '../src/game/profile.js';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(key => {
    const marker = `${key}:loadout-test-seeded`;
    if (sessionStorage.getItem(marker)) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, coins: 0, owned: ['rifle', 'shotgun'], equipped: 'rifle' }));
    sessionStorage.setItem(marker, '1');
  }, PROFILE_KEY);
  await page.goto(process.env.LOADOUT_TEST_URL || 'http://127.0.0.1:5191/'); await page.waitForFunction(() => window.__ready);
  await page.locator('.weapon-choice[data-weapon="shotgun"]').tap();
  assert.equal(await page.locator('.weapon-choice[data-weapon="shotgun"]').getAttribute('aria-pressed'), 'true');
  assert(await page.evaluate(() => window.__game.profile.owns('shotgun') && window.__game.profile.equipped === 'shotgun'));
  await page.getByRole('button', { name: '挑战 Day 1', exact: true }).tap();
  await page.waitForFunction(() => window.__game.round.weapon.id === 'shotgun' && window.__game.round.state === 'play');
  assert.equal(await page.evaluate(() => window.__game.round.trial), false, 'owned shotgun earns normal rewards');
  assert.equal(await page.locator('.ammo').innerText(), '6/6');
  assert(await page.evaluate(() => window.__game.round.hero.shotgun.visible && !window.__game.round.hero.rifle.visible));
  await page.getByRole('button', { name: '暂停', exact: true }).tap();
  assert.match(await page.locator('#panel').innerText(), /霰弹枪/);
  assert.match(await page.locator('#panel').innerText(), /Day 1/);
  await page.getByRole('button', { name: '继续游戏' }).tap();
  await page.evaluate(() => window.__game.round.finish(false));
  await page.getByRole('button', { name: '返回商店' }).waitFor();
  const layout = await page.locator('.card').evaluate(el => ({ overflow: el.scrollHeight > el.clientHeight, bottom: el.querySelector('.btn').getBoundingClientRect().bottom }));
  assert(!layout.overflow && layout.bottom < 375, 'result and return-to-shop button fit phone landscape');
  await page.getByRole('button', { name: '返回商店' }).tap();
  await page.getByRole('button', { name: '挑战 Day 1', exact: true }).waitFor();
  assert.equal(await page.locator('.weapon-choice[data-weapon="shotgun"]').getAttribute('aria-pressed'), 'true');
  await page.reload(); await page.waitForFunction(() => window.__ready);
  assert.equal(await page.locator('.weapon-choice[data-weapon="shotgun"]').getAttribute('aria-pressed'), 'true', 'purchased shotgun stays equipped after returning and refreshing');
  assert(await page.evaluate(() => window.__game.profile.owns('shotgun') && window.__game.profile.equipped === 'shotgun'));
  await page.locator('.weapon-choice[data-weapon="rifle"]').tap();
  assert.equal(await page.evaluate(() => window.__game.profile.equipped), 'rifle');
  // Explicit trial entry supports an owned gun without replacing saved equipment.
  await page.evaluate(() => window.__game.begin('shotgun', { trial: true }));
  assert(await page.evaluate(() => window.__game.round.trial && window.__game.round.weapon.id === 'shotgun' && window.__game.profile.equipped === 'rifle'));
  await page.evaluate(() => window.__game.round.finish(false));
  await page.getByRole('button', { name: '返回商店' }).tap();
  await page.reload(); await page.waitForFunction(() => window.__ready);
  assert.equal(await page.locator('.weapon-choice[data-weapon="rifle"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__game.profile.completedDay), 0);
  await page.getByRole('button', { name: '挑战 Day 1', exact: true }).tap();
  await page.waitForFunction(() => window.__game.round.weapon.id === 'rifle' && window.__game.round.state === 'play');
  await page.waitForFunction(() => document.querySelector('.ammo').innerText === '24/24');
  assert.equal(await page.locator('.tutorial').count(), 0);
  assert(await page.evaluate(() => window.__game.round.hero.rifle.visible && !window.__game.round.hero.shotgun.visible));

  // Standalone demon behavior is covered by combat-reaction-test.
  assert.deepEqual(errors, []);
  console.log('PASS mobile weapon choice, ammo, equipment and trial persistence, and result layout');
} finally { await browser.close(); }
