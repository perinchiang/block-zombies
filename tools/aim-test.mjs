#!/usr/bin/env node
// Aim-priority regression test (from the first playtest: "the crosshair snaps
// to a far zombie and I can't shoot the one in my face").
// Stages zombies around a frozen hero and checks which one the shot goes to.
//   node tools/aim-test.mjs [--port=5191]
import { chromium } from 'playwright-core';

const port = +(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 5191);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let ok = true;
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  page.on('pageerror', (e) => { ok = false; console.log('pageerror', e.message); });
  await page.goto(`http://127.0.0.1:${port}/?skip&still`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });

  // hero stands at h facing -Z; each zombie is [name, dx(right of hero is -x... use world), dz]
  const cases = [
    ['point-blank beats a far zombie centred in the crosshair', [['near', 0.5, -1.3], ['far', 0, -10]], 'near'],
    ['first zombie on the barrel line takes the bullet', [['near', 0.25, -4], ['far', 0, -12]], 'near'],
    ['assist picks the nearest zombie in the cone, not the most centred', [['mid', 0.75, -8], ['far', 0.6, -15]], 'mid'],
    ['a far zombie is still targetable when nothing is closer', [['far', 0.2, -14]], 'far'],
    ['nothing in front: no lock, crosshair on the street', [['side', 3, -1]], null],
  ];
  for (const [label, zs, expect] of cases) {
    const r = await page.evaluate(({ zs }) => {
      const g = window.__game, R = g.round, h = R.hero.root.position;
      for (const z of R.pool) R.retire(z);
      const named = {};
      for (const [n, dx, dz] of zs) { const z = R.spawn(h.x + dx, h.z + dz, false, false); named[n] = z; }
      R.resolveAim();
      const pick = Object.entries(named).find(([, z]) => z === R.aimInfo.zombie)?.[0] ?? null;
      const hp = Object.fromEntries(Object.entries(named).map(([n, z]) => [n, z.hp]));
      R.ammo = 10; R.fire(g.camera);
      const hit = Object.entries(named).find(([n, z]) => z.hp < hp[n])?.[0] ?? null;
      return { pick, hit };
    }, { zs });
    const pass = r.pick === expect && r.hit === expect;
    if (!pass) ok = false;
    console.log(pass ? 'PASS' : 'FAIL', label, JSON.stringify(r));
  }
} finally {
  await browser.close();
}
console.log(ok ? 'PASS aim priority' : 'FAILED');
process.exit(ok ? 0 : 1);
