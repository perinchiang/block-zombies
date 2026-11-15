import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5191/?skip&still'); await page.waitForFunction(() => window.__ready);
  const results = await page.evaluate(() => {
    const R = window.__game.round, B = R.buffs, camera = window.__game.camera;
    const checks = [], check = (label, pass) => checks.push({ label, pass: !!pass });
    const idle = { move: { x: 0, y: 0 }, turn: 0, firing: false };
    const reset = () => {
      R.reset('rifle'); R.start(); R.spawnTick = () => {}; R.pool.forEach(z => R.retire(z));
      R.hero.root.position.set(0, 0, -7); R.yaw = Math.PI; R.pitch = 0;
      R.hero.aimPitch = 0; R.hero.recoil = 0;
      R.hero.root.rotation.y = R.yaw; R.hero.pose(0); R.scene.updateMatrixWorld(true);
      camera.position.copy(R.hero.muzzle.getWorldPosition(R.hero.root.position.clone()));
      camera.lookAt(0, 0.95, -17); camera.updateMatrixWorld(true);
    };
    const fireAt = target => {
      R.scene.updateMatrixWorld(true);
      camera.lookAt(R.chest(target, target.root.position.clone())); camera.updateMatrixWorld(true);
      R.fire(camera);
    };
    const flight = () => { for (let i = 0; i < 50; i++) R.ballistics.update(0.02); };
    reset(); const h = R.hero.root.position;
    B.grant('frenzy'); B.update(3, h, true); B.grant('frenzy');
    check('same buff refreshes to eight seconds', B.timers.frenzy === 8);
    B.grant('shield'); B.update(1, h, true); B.grant('blast');
    check('third buff replaces one, never exceeds two', Object.values(B.timers).filter(t => t > 0).length === 2 && B.has('blast'));
    B.update(8, h, true); check('buffs expire completely', Object.values(B.timers).every(t => t === 0));
    B.drop(h, 'pierce'); B.update(0.1, h, false); check('paused drops cannot be collected', !B.has('pierce'));
    B.update(0.1, h, true); check('nearby drop picked up', B.has('pierce'));
    B.reset(); B.drop(h.clone().addScalar(10), 'sprint'); B.update(6, h, true);
    check('uncollected drop expires in six seconds', B.drops.every(d => !d.mesh.visible));
    for (let i = 0; i < 30; i++) B.drop(h); check('drop pool bounded to twelve', B.drops.length === 12);
    reset(); B.grant('frenzy'); R.ammo = 1; R.fire(camera);
    check('frenzy gives 60percent fire rate without ammo cost', R.ammo === 1 && Math.abs(R.cool - 1 / 14.4) < 1e-8);
    R.reloadT = 1; R.update(0.01, idle, camera); check('frenzy cancels reload', R.reloadT === 0);
    reset();
    // Extend the muzzle-to-chest ray through the second chest, including height.
    // Equal ground X alone is not collinear with the offset rifle muzzle.
    const a = R.spawn(camera.position.x, -11, false, false);
    const b = R.spawn(camera.position.x, -14, false, false);
    const ray = R.chest(a, a.root.position.clone()).sub(camera.position);
    const rearChest = camera.position.clone().addScaledVector(ray, (b.root.position.z - camera.position.z) / ray.z);
    b.root.position.x = rearChest.x; b.root.position.y = rearChest.y - 0.95;
    R.scene.updateMatrixWorld(true);
    B.grant('pierce'); fireAt(a);
    check('pierce waits for bullet travel', a.hp === 3 && b.hp === 3 && R.ballistics.active.length === 1);
    const positions = [a.root.position.clone(), b.root.position.clone()]; flight();
    check('pierce damages both lined-up zombies', a.hp === 2 && b.hp === 2);
    check('isolated bullet updates leave enemies stationary', a.root.position.equals(positions[0]) && b.root.position.equals(positions[1]));
    reset(); const c = R.spawn(0, -11, false, false), d = R.spawn(1, -11, false, false);
    B.grant('blast'); fireAt(c); flight(); check('blast damages a nearby off-line zombie', c.hp === 1 && d.hp === 2);
    reset(); const z = R.spawn(0, -8, false, false); B.grant('shield'); const hp = R.hp; R.bite(z, 0, 1);
    check('shield absorbs exactly one bite', R.hp === hp && !B.has('shield')); R.invuln = 0; R.bite(z, 0, 1); check('next bite hurts', R.hp === hp - 1);
    reset(); R.update(0.1, { ...idle, move: { x: 0, y: 1 } }, camera); const normal = -7 - h.z;
    reset(); B.grant('sprint'); R.update(0.1, { ...idle, move: { x: 0, y: 1 } }, camera);
    check('sprint increases speed by 40percent', Math.abs((-7 - h.z) / normal - 1.4) < 1e-8);
    reset(); const walker = R.spawn(0, -7.8, false, false); B.grant('sprint'); R.update(0.01, idle, camera);
    check('sprint shoves ordinary zombies away', walker.vel.length() > 0 && walker.biteCool > 0);
    reset(); check('retry clears buffs and drops', Object.values(B.timers).every(t => t === 0) && B.drops.every(d => !d.mesh.visible));
    return checks;
  });
  results.forEach(r => console.log(r.pass ? 'PASS' : 'FAIL', r.label));
  assert(results.every(r => r.pass)); assert.deepEqual(errors, []);
} finally { await browser.close(); }
