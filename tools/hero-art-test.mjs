#!/usr/bin/env node
// Verify the posed hero, not only construction constants: hands remain attached
// through aim/recoil, and the GPU accepts the sky and per-weapon ink shaders.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5191/?skip&still');
  await page.waitForFunction('window.__ready');
  const checks = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { OBB } = await import('/node_modules/three/examples/jsm/math/OBB.js');
    const { scene, round: R, camera } = window.__game, h = R.hero;
    R.state = 'paused';
    const results = [], check = (name, pass) => results.push({ name, pass });
    const obb = m => {
      m.geometry.computeBoundingBox();
      return new OBB().fromBox3(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    };
    for (const id of ['rifle', 'shotgun']) {
      h.setWeapon(id); h.setWeaponLevel(4);
      let connected = true, contact = true, upright = true, headClear = true;
      for (const pitch of [-1.05, -0.18, 0, 1.05]) for (const recoil of [0, 0.5, 1]) {
        h.aimPitch = pitch; h.recoil = recoil; h.pose(0, 1); scene.updateMatrixWorld(true);
        for (const [arm, hand] of [[h.armL, h.handL], [h.armR, h.handR]]) {
          const sleeveEnd = arm.children[1].localToWorld(new T.Vector3(0, 0.5, 0));
          connected &&= sleeveEnd.distanceTo(hand.getWorldPosition(new T.Vector3())) < 1e-6;
        }
        contact &&= obb(h.handR).intersectsOBB(obb(h.guns[id].children[2]));
        contact &&= obb(h.handL).intersectsOBB(obb(h.guns[id].children[6]));
        upright &&= Math.abs(h.torso.rotation.x) < 0.23;
        headClear &&= h.guns[id].children.filter(m => m.visible).every(m =>
          h.head.children.every(head => !obb(m).intersectsOBB(obb(head))));
      }
      check(id + ': both sleeves meet wrists through aim and recoil', connected);
      check(id + ': both gloves contact their actual grip surfaces', contact);
      check(id + ': torso stays upright at extreme aim', upright);
      check(id + ': upgraded gun stays outside the enlarged head', headClear);
    }
    h.setWeapon('rifle'); h.aimPitch = -0.18; h.recoil = 0; h.pose(0); scene.updateMatrixWorld(true);
    const band = h.head.getObjectByName('headband'), cap = h.head.getObjectByName('hair-cap');
    band.geometry.computeBoundingBox(); cap.geometry.computeBoundingBox();
    const head = h.head.children[0]; head.geometry.computeBoundingBox();
    check('headband stands clear of the head and does not overlap the cap',
      band.geometry.boundingBox.max.x - head.geometry.boundingBox.max.x > 0.025 &&
      band.position.y + band.geometry.boundingBox.max.y < cap.position.y + cap.geometry.boundingBox.min.y);
    const barrel = h.rifle.children[4];
    const width = barrel.geometry.parameters.width;
    const a = barrel.localToWorld(new T.Vector3(-width / 2, 0, 0)).project(camera);
    const b = barrel.localToWorld(new T.Vector3(width / 2, 0, 0)).project(camera);
    check('rifle barrel has at least 5 pixels of width at phone size', Math.hypot((a.x-b.x)*422, (a.y-b.y)*195) > 5);
    const vector = h.gun.getWorldDirection(new T.Vector3());
    check('resting barrel retains the camera aim direction', vector.angleTo(camera.getWorldDirection(new T.Vector3())) < 0.001);
    h.setWeapon('shotgun'); h.setWeaponLevel(4);
    return results;
  });
  await page.waitForTimeout(300);
  for (const c of checks) console.log(c.pass ? 'PASS' : 'FAIL', c.name);
  assert.deepEqual(errors, [], 'Browser rendering errors');
  assert.ok(checks.every(c => c.pass), 'Hero pose/readability regression');
} finally { await browser.close(); }
