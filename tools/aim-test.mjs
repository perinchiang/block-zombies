#!/usr/bin/env node
// Physical projectiles: flight time, mesh occlusion, no homing and vertical aim.
import { chromium } from 'playwright-core';
const port = +(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? 5191);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?skip&still`);
  await page.waitForFunction('window.__ready');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { round: R, camera } = window.__game, results = [];
    const check = (label, pass) => { results.push({ label, pass }); };
    function reset() {
      R.reset('rifle'); R.start(); R.spawnTick = () => {};
      for (const z of R.pool) R.retire(z);
      R.hero.root.position.set(0, 0, -7); R.hero.root.rotation.y = Math.PI;
      R.hero.aimPitch = 0; R.hero.pose(0); R.scene.updateMatrixWorld(true);
      return R.hero.muzzle.getWorldPosition(new THREE.Vector3());
    }
    function aim(origin, point) { camera.position.copy(origin); camera.lookAt(point); camera.updateMatrixWorld(true); }
    function advance(t = 0.5) { for (let i = 0; i < Math.ceil(t / 0.01); i++) R.ballistics.update(0.01); }
    let muzzle = reset();
    let far = R.spawn(muzzle.x, -17, false, false);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17));
    R.fire(camera);
    check('trigger creates a muzzle projectile without instant damage', far.hp === 3 && R.ballistics.active.length === 1 && R.ballistics.active[0].position.distanceTo(muzzle) < 1e-5);
    advance(0.05); check('distant enemy is unharmed before bullet arrival', far.hp === 3);
    advance(); check('enemy is hit after travel time', far.hp === 2);

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17)); R.fire(camera);
    const near = R.spawn(muzzle.x, -11, false, false);
    advance(); check('an enemy entering the flight path intercepts a shot aimed at the back enemy', near.hp === 2 && far.hp === 3);

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17)); R.fire(camera);
    far.root.position.x += 2; advance();
    check('a moving target can dodge; bullets do not home', far.hp === 3 && R.hits === 0);

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    aim(muzzle, new THREE.Vector3(muzzle.x, 4, -17)); R.fire(camera); advance();
    check('aiming above the head misses instead of snapping down', far.hp === 3);

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.025), new THREE.MeshBasicMaterial());
    wall.position.set(muzzle.x, 1.5, -11); R.scene.add(wall); R.ballistics.scenery.push(wall);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17)); R.fire(camera);
    R.ballistics.update(0.3);
    check('swept collision stops a bullet at a thin wall even during a long frame', far.hp === 3 && R.ballistics.active.length === 0);
    R.ballistics.scenery.pop(); R.scene.remove(wall);
    wall.geometry.dispose(); wall.material.dispose();

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    const embedded = R.spawn(muzzle.x, muzzle.z, false, false);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17)); R.fire(camera); advance();
    check('a barrel inside a foreground body cannot shoot through it', embedded.hp === 2 && far.hp === 3);

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 16), new THREE.MeshBasicMaterial());
    cylinder.position.set(muzzle.x, 1.5, muzzle.z); R.scene.add(cylinder); R.ballistics.scenery.push(cylinder);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17)); R.fire(camera); advance();
    check('a barrel entering a cylindrical prop cannot shoot through its back face', far.hp === 3 && R.ballistics.active.length === 0);
    R.ballistics.scenery.pop(); R.scene.remove(cylinder); cylinder.geometry.dispose(); cylinder.material.dispose();

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    const crate = R.crates[0]; const cratePosition = crate.root.position.clone();
    crate.root.position.set(muzzle.x, 0.6, -11);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17)); R.fire(camera); advance();
    check('supply crate meshes block bullets', far.hp === 3);
    crate.root.position.copy(cratePosition);

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    aim(new THREE.Vector3(muzzle.x, 1, -4), new THREE.Vector3(muzzle.x, 1, -17));
    const behind = R.spawn(muzzle.x, -5, false, false);
    R.fire(camera);
    check('camera obstruction behind the muzzle never reverses a shot', R.ballistics.active[0].dir.z < 0);
    advance(); check('a camera-only rear target is not shot backward', behind.hp === 3);

    // Camera can see past cover that still blocks the offset muzzle.
    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    const blocker = R.spawn(muzzle.x, -9, false, false);
    aim(new THREE.Vector3(muzzle.x + 1.5, 2.6, -5), new THREE.Vector3(muzzle.x, 1.1, -17));
    R.resolveAim(camera);
    check('shoulder camera sees the rear enemy', R.aimInfo.zombie === far);
    R.fire(camera); advance();
    check('muzzle path hits foreground body despite clear camera sight', blocker.hp === 2 && far.hp === 3);

    muzzle = reset(); far = R.spawn(muzzle.x, -17, false, false);
    aim(muzzle, new THREE.Vector3(muzzle.x, 1.1, -17)); R.fire(camera);
    const position = R.ballistics.active[0].position.clone();
    R.state = 'paused'; R.ballistics.update(1);
    check('pause freezes bullet and target', R.ballistics.active[0].position.equals(position) && far.hp === 3);
    R.state = 'play'; R.finish(true);
    check('settlement clears bullets', R.ballistics.active.length === 0);
    R.reset(); check('retry clears bullets and restores initial pitch', R.ballistics.active.length === 0 && R.pitch === -0.18);
    R.start(); R.spawnTick = () => {}; R.pool.forEach(z => R.retire(z));
    const idle = { move: { x: 0, y: 0 }, turn: 0, firing: false };
    const startPosition = R.hero.root.position.clone();
    R.update(0.01, { ...idle, pitch: 0.6 }, camera);
    const raised = camera.getWorldDirection(new THREE.Vector3()).y;
    R.update(0.01, { ...idle, pitch: -1.2 }, camera);
    check('vertical input raises and lowers the actual camera without moving the hero', raised > 0.3 && camera.getWorldDirection(new THREE.Vector3()).y < -0.5 && R.hero.root.position.equals(startPosition));
    R.update(0.01, { ...idle, pitch: 100 }, camera);
    check('upward pitch is bounded with the camera above ground', R.pitch === 1.05 && camera.position.y >= 0.25);
    R.update(0.01, { ...idle, pitch: -100 }, camera);
    check('downward pitch is bounded', R.pitch === -1.05);
    return results;
  });
  results.forEach(r => console.log(r.pass ? 'PASS' : 'FAIL', r.label));
  if (errors.length || results.some(r => !r.pass)) throw new Error(JSON.stringify(errors));
} finally { await browser.close(); }
