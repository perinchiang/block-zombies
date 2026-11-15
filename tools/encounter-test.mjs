#!/usr/bin/env node
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { PROFILE_KEY } from '../src/game/profile.js';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(key => {
    localStorage.setItem(key, JSON.stringify({ version: 2, coins: 0, owned: ['rifle', 'shotgun'], equipped: 'rifle', levels: { rifle: 1, shotgun: 1 } }));
  }, PROFILE_KEY);
  await page.goto(new URL('?still', process.env.ENCOUNTER_TEST_URL || 'http://127.0.0.1:5191/').href); await page.waitForFunction(() => window.__ready);
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const g = window.__game, R = g.round, camera = g.camera;
    const idle = { move: { x: 0, y: 0 }, turn: 0, firing: false };
    const checks = [], check = (label, pass) => checks.push({ label, pass: !!pass });
    const step = (seconds, input = idle) => { for (let t = 0; t < seconds; t += 0.02) R.update(0.02, input, camera); };
    const reset = (weapon = 'shotgun') => {
      R.reset(weapon); R.start(); R.spawnTick = () => {};
      for (const z of R.pool) R.retire(z);
      R.hero.root.position.set(0, 0, -7); R.yaw = Math.PI;
      R.hero.aimPitch = 0; R.hero.t = 0; R.hero.recoil = 0;
    };
    const fire = target => {
      const h = R.hero;
      h.root.rotation.y = R.yaw; h.pose(0); R.scene.updateMatrixWorld(true);
      camera.position.copy(h.muzzle.getWorldPosition(new THREE.Vector3()));
      camera.lookAt(target ? R.chest(target, new THREE.Vector3()) : new THREE.Vector3(0, 1, -17));
      camera.updateMatrixWorld(true); R.scene.updateMatrixWorld(true);
      R.fire(camera);
    };
    const flight = () => { for (let i = 0; i < 50; i++) R.ballistics.update(0.02); };
    reset(); const near = R.spawn(0, -8.8, false, false); fire(near);
    check('shotgun damage waits for projectile travel', near.hp === 3 && R.hits === 0 && R.ballistics.active.length > 0);
    const bullets = R.ballistics.active.map(p => ({ position: p.position.clone(), remaining: p.remaining }));
    R.state = 'paused'; R.ballistics.update(1);
    check('pause freezes every live pellet and prevents damage', near.hp === 3 && R.ballistics.active.length === bullets.length &&
      R.ballistics.active.every((p, i) => p.position.equals(bullets[i].position) && p.remaining === bullets[i].remaining));
    R.state = 'play'; flight();
    check('close shotgun burst kills a normal zombie', near.dead && R.ammo === 5);
    check('one trigger counts as one shot and hit', R.shots === 1 && R.hits === 1);
    reset(); const targets = [-0.6, 0, 0.6].map(x => R.spawn(x, -10, false, false));
    targets.forEach(z => { z.hp = 20; z.t = 0; z.pose(0); }); fire(targets[1]); flight();
    check('fan hits multiple enemies and knocks them back', targets.every(z => z.hp < 20 && z.vel.length() > 0 && z.vel.length() <= 5 + 1e-8));
    reset(); const mid = R.spawn(0, -9, false, false); mid.hp = 20; fire(mid); flight(); const nearDamage = 20 - mid.hp;
    reset(); const far = R.spawn(0, -15, false, false); far.hp = 20; fire(far); flight();
    check('shotgun damage falls with range', 20 - far.hp < nearDamage);
    reset(); const outside = R.spawn(0, -19, false, false); fire(outside); flight();
    check('shotgun cannot hit past ten metres', outside.hp === 3 && R.ballistics.active.length === 0);
    reset('rifle'); const rifleFar = R.spawn(0, -18, false, false); fire(rifleFar); flight();
    check('rifle still reaches distant targets', rifleFar.hp === 2 && R.ammo === 23);
    reset(); R.ammo = 1; R.update(0.02, { ...idle, firing: true }, camera);
    check('shotgun has its own reload duration', R.reloadT === 1.8 && R.ammo === 0);
    step(1.82); check('shotgun refills six shells', R.reloadT === 0 && R.ammo === 6);
    reset(); R.buffs.grant('frenzy'); R.reloadT = 1; R.update(0.02, { ...idle, firing: true }, camera);
    check('frenzy works with shotgun without converting its magazine', R.ammo === 6 && R.reloadT === 0 && Math.abs(R.cool - 1 / 2.4) < 1e-8);
    reset(); R.buffs.grant('pierce'); const front = R.spawn(0, -9, false, false), back = R.spawn(0, -11, false, false); fire(front); flight();
    check('piercing shotgun reaches enemy behind the front row', front.hp < 3 && back.hp < 3);
    reset(); R.buffs.grant('blast'); const blasted = R.spawn(0, -8.8, false, false), aside = R.spawn(1.5, -8.8, false, false); fire(blasted); flight();
    check('blast buff explodes even if direct pellets kill the target', blasted.dead && aside.hp === 2);
    reset();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1.5, -8.5); R.scene.add(wall); R.ballistics.scenery.push(wall);
    const blocked = R.spawn(0, -10, false, false); fire(blocked); flight();
    check('shotgun pellets respect scenery meshes', blocked.hp === 3 && R.hits === 0);
    R.ballistics.scenery.splice(R.ballistics.scenery.indexOf(wall), 1);
    R.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose();

    // Campaign rewards/completion are covered by day-campaign-test;
    // standalone demon reactions are covered by combat-reaction-test.
    return checks;
  });
  for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', r.label);
  assert(results.every(r => r.pass)); assert.deepEqual(errors, []);
} finally { await browser.close(); }
