#!/usr/bin/env node
// Keep the full hero visible at ordinary combat angles on phone landscapes.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const [width, height] of [[852, 393], [844, 390], [667, 375]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5191/?skip&still');
    await page.waitForFunction('window.__ready');
    const results = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { round: R, camera } = window.__game;
      const checks = [], check = (label, pass) => checks.push({ label, pass });
      async function view(pitch) {
        R.pitch = pitch; R.hero.aimPitch = pitch; R.hero.pose(0);
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      }
      for (const pitch of [-0.65, -0.18, 0, 0.12]) {
        await view(pitch);
        R.scene.updateMatrixWorld(true);
        const corners = [];
        for (const leg of [R.hero.legL, R.hero.legR]) leg.traverse(o => {
          if (!o.isMesh) return;
          o.geometry.computeBoundingBox();
          const { min, max } = o.geometry.boundingBox;
          for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
            corners.push(new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld).project(camera));
          }
        });
        check(`legs and feet remain inside the frame at pitch ${pitch}`, corners.every(p => Math.abs(p.x) < 0.9 && p.y > -0.94 && p.y < 0.9 && p.z < 1));
        const center = R.hero.root.position.clone().setY(0.8).project(camera);
        check(`hero stays left of the center sight at pitch ${pitch}`, center.x < -0.12 && center.x > -0.8);
        const facing = camera.getWorldDirection(new THREE.Vector3());
        check(`camera retains requested vertical aim at pitch ${pitch}`, Math.abs(facing.y - Math.sin(pitch)) < 1e-6);
      }
      await view(-0.18);
      const position = camera.position.clone(), rotation = camera.quaternion.clone();
      R.state = 'paused'; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      check('pause preserves framing', camera.position.equals(position) && camera.quaternion.equals(rotation));
      R.start();
      for (const [x, z] of [[-19.4, 0], [19.4, 0], [0, -19.4], [0, 19.4]]) {
        R.hero.root.position.set(x, 0, z); await view(-0.18);
        check(`camera stays within square walls at (${x}, ${z})`, Math.abs(camera.position.x) <= 19.8 && Math.abs(camera.position.z) <= 19.8 && camera.position.y >= 0.25);
      }
      return checks;
    });
    results.forEach(r => console.log(r.pass ? 'PASS' : 'FAIL', `${width}×${height}`, r.label));
    assert(results.every(r => r.pass)); assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
