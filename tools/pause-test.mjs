#!/usr/bin/env node
// Real frame-loop checks: pausing must freeze gameplay and discard held inputs.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const port = +(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? 5191);
const base = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const track = page => page.on('pageerror', e => errors.push(e.message));
const ready = page => page.waitForFunction(() => window.__ready);
const state = page => page.evaluate(() => {
  const R = window.__game.round;
  return {
    state: R.state, time: R.time, elapsed: R.elapsed, hp: R.hp, pressure: R.pressure,
    shots: R.shots, ammo: R.ammo, reload: R.reloadT,
    spawn: { timer: R.director.timer, graveTimer: R.director.graveTimer, gate: R.director.gate, pending: R.director.pending ? { ...R.director.pending } : null },
    position: R.hero.root.position.toArray(), yaw: R.yaw, extracting: R.extracting,
    buffs: { ...R.buffTimers }, loot: R.loot,
    crates: R.crates.map(c => c.opened),
    bullets: R.ballistics.active.map(p => [p.position.toArray(), p.remaining, p.travelled]),
    zombies: R.pool.map(z => [z.active, z.dead, z.biteT, z.root.position.toArray()]),
  };
});

try {
  const ctx = await browser.newContext({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); track(page);
  await page.goto(base); await ready(page);
  assert.equal(await page.locator('.tutorial').count(), 1, 'first visit shows teaching before combat');
  await page.getByRole('button', { name: '进入街道' }).tap();
  await page.waitForFunction(() => window.__game.round.state === 'play');
  assert.equal(await page.locator('#hud .turn, #hud .resources, #hud .objective, #hud .hint, #hud .notice').count(), 0);
  await page.evaluate(() => {
    const R = window.__game.round;
    R.loot = 72; R.opened = 2; R.buffs.grant('frenzy');
  });

  // Pause with the other thumb still holding fire. Releasing/reusing that finger
  // after resume must not revive an old touch or silently fire a shot.
  const cdp = await ctx.newCDPSession(page);
  const center = selector => page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const fire = await center('.fire'), pause = await center('.pause');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...fire }] });
  await page.waitForFunction(() => window.__game.round.shots > 0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...fire }, { id: 2, ...pause }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, ...fire }] });
  await page.waitForFunction(() => window.__game.round.state === 'paused');
  const frozen = await state(page);
  assert.match(await page.locator('#panel').innerText(), /72\s*携带金币/);
  const crateCount = await page.evaluate(() => window.__game.round.crates.length);
  assert.match(await page.locator('#panel').innerText(), new RegExp(`2 / ${crateCount}\\s*已开物资箱`));
  await page.keyboard.down('KeyW'); await page.keyboard.down('Space');
  await page.waitForTimeout(600);
  assert.deepEqual(await state(page), frozen, 'all gameplay stays frozen while paused');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(100);
  assert.deepEqual(await state(page), frozen, 'orientation changes do not resume combat');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByRole('button', { name: '继续游戏' }).tap();
  await page.waitForTimeout(300);
  const resumed = await state(page);
  assert.equal(resumed.state, 'play'); assert(resumed.elapsed > frozen.elapsed);
  assert(resumed.buffs.frenzy < frozen.buffs.frenzy);
  assert.equal(resumed.shots, frozen.shots, 'pause/resume does not fire or restore held fire');
  assert.deepEqual(resumed.position, frozen.position, 'held movement does not carry over');
  await page.keyboard.up('KeyW'); await page.keyboard.up('Space');
  console.log('PASS mobile pause freezes combat, clocks, buffs and clears held inputs');

  // Automatic crate collection and evacuation both respect pause.
  for (const kind of ['crate', 'evac']) {
    await page.evaluate(kind => {
      window.__game.begin();
      const R = window.__game.round;
      R.pool.forEach(z => R.retire(z)); R.spawnTick = () => {};
      if (kind === 'crate') {
        const c = R.crates[0]; R.hero.root.position.set(c.x, 0, c.z + 1);
        R.state = 'paused';
      } else {
        R.elapsed = 100; R.hero.root.position.set(R.evac.x, 0, R.evac.z);
      }
    }, kind);
    if (kind === 'evac') {
      await page.waitForFunction(() => window.__game.round.extracting > 0);
      await page.getByRole('button', { name: '暂停', exact: true }).tap();
    }
    const before = await state(page);
    await page.waitForTimeout(400);
    assert.deepEqual(await state(page), before, `${kind} stays frozen`);
    if (kind === 'crate') {
      assert.equal(before.crates[0], false, 'paused crate is not collected');
      await page.evaluate(() => {
        const R = window.__game.round;
        R.state = 'play'; R.extraction.update(R, 0.001, { move: { x: 0, y: 0 }, firing: false });
      });
      assert.equal((await state(page)).crates[0], true, 'crate collects on the first active update');
    } else await page.getByRole('button', { name: '继续游戏' }).tap();
  }
  console.log('PASS automatic crate pickup and evacuation respect pause');

  await page.evaluate(() => window.__game.begin());
  assert.equal(await page.locator('.tutorial').count(), 0, 'retry does not repeat tutorial');
  await page.reload(); await ready(page);
  await page.getByRole('button', { name: '进入街道' }).waitFor();
  assert.equal(await page.locator('.tutorial').count(), 0, 'refresh returns to the shop without repeating tutorial');
  assert.equal(await page.locator('.weapon-choice[data-weapon="rifle"]').getAttribute('aria-pressed'), 'true');
  console.log('PASS first-visit tutorial stays dismissed across retry and refresh');
  await ctx.close();

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } }); track(desktop);
  await desktop.goto(`${base}?skip`); await ready(desktop);
  await desktop.mouse.click(640, 400);
  await desktop.waitForFunction(() => !!document.pointerLockElement);
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => window.__game.round.state === 'paused');
  await desktop.waitForFunction(() => !document.pointerLockElement);
  const paused = await state(desktop);
  await desktop.getByRole('button', { name: '继续游戏' }).click();
  await desktop.waitForFunction(() => !!document.pointerLockElement && window.__game.round.state === 'play');
  await desktop.waitForTimeout(200);
  assert.equal((await state(desktop)).shots, paused.shots, 'resume click never reaches the canvas');
  const oldYaw = (await state(desktop)).yaw;
  await desktop.mouse.move(720, 400);
  await desktop.waitForFunction(yaw => window.__game.round.yaw !== yaw, oldYaw);
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !document.pointerLockElement && window.__game.round.state === 'paused');
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !!document.pointerLockElement && window.__game.round.state === 'play');
  console.log('PASS desktop resume restores mouse aiming without stray shots');

  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !document.pointerLockElement && window.__game.round.state === 'paused');
  await desktop.evaluate(() => {
    const canvas = document.getElementById('gl');
    window.restoreLock = () => delete canvas.requestPointerLock;
    canvas.requestPointerLock = () => Promise.reject(new Error('simulated browser denial'));
  });
  const denied = await state(desktop);
  await desktop.getByRole('button', { name: '继续游戏' }).click();
  await desktop.waitForFunction(() => !document.querySelector('.lock-hint').hidden);
  await desktop.waitForTimeout(200);
  assert.deepEqual(await state(desktop), denied, 'lock denial leaves gameplay paused');
  assert(await desktop.getByRole('button', { name: '继续游戏' }).isVisible());
  await desktop.evaluate(() => window.restoreLock());
  await desktop.getByRole('button', { name: '继续游戏' }).click();
  await desktop.waitForFunction(() => !!document.pointerLockElement && window.__game.round.state === 'play');
  console.log('PASS denied mouse-lock requests keep the pause panel usable');
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !document.pointerLockElement);
  await desktop.close();
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
