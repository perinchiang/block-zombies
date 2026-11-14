#!/usr/bin/env node
// Multi-touch smoke test on a phone-sized landscape viewport.
// Left thumb pushes the floating stick forward while the right thumb holds the
// fire button and drags left. Asserts the hero moved forward, turned, and fired.
//   node tools/touch-test.mjs [--port=5191]
import { chromium } from 'playwright-core';

const port = +(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 5191);
const W = 844, H = 390;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let ok = true;
const fail = (m) => { ok = false; console.log('FAIL', m); };
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`pageerror ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/?skip`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  const fire = await page.evaluate(() => { const r = document.querySelector('.fire').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const before = await page.evaluate(() => { const r = window.__game.round; return { z: r.hero.root.position.z, yaw: r.yaw, pitch: r.pitch, shots: r.shots }; });

  const stick = { x: 150, y: 260 };
  const pts = (s, f) => [{ x: s.x, y: s.y, id: 1 }, ...(f ? [{ x: f.x, y: f.y, id: 2 }] : [])];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(stick) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(stick, fire) });
  for (let i = 1; i <= 30; i++) {
    const s = { x: stick.x, y: stick.y - Math.min(45, i * 4) };
    const f = { x: fire.x - Math.min(60, i * 2), y: fire.y - Math.min(45, i * 1.5) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(s, f) });
    await page.waitForTimeout(40);
  }
  const mid = await page.evaluate(() => ({ live: document.querySelector('.stick').classList.contains('live'), down: document.querySelector('.fire').classList.contains('down') }));
  await page.screenshot({ path: 'shots/touch-test.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => { const r = window.__game.round; return { z: r.hero.root.position.z, yaw: r.yaw, pitch: r.pitch, shots: r.shots, fireDown: document.querySelector('.fire').classList.contains('down') }; });

  console.log('before', before, 'after', after, 'mid', mid);
  if (!mid.live) fail('stick did not appear under the left thumb');
  if (!mid.down) fail('fire button not pressed while held');
  if (before.z - after.z < 0.5) fail(`hero did not move forward (dz=${(before.z - after.z).toFixed(2)})`);
  if (after.yaw - before.yaw < 0.2) fail(`dragging the fire button did not turn left (dyaw=${(after.yaw - before.yaw).toFixed(2)})`);
  if (after.shots - before.shots < 5) fail(`too few shots while holding fire (${after.shots - before.shots})`);
  if (after.fireDown) fail('fire button stuck after release');
  if (after.pitch - before.pitch < 0.2) fail('dragging fire upward did not raise the view');
  const look = { x: 580, y: 170, id: 3 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [look] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...look, y: 260 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const lower = await page.evaluate(() => window.__game.round.pitch);
  if (lower > after.pitch - 0.4) fail('right-side drag downward did not lower the view');
} finally {
  await browser.close();
}
console.log(ok ? 'PASS touch controls' : 'FAILED');
process.exit(ok ? 0 : 1);
