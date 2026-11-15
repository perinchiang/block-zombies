#!/usr/bin/env node
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/combat-reaction-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Combat checks</title>' }));
  await page.goto(new URL('/combat-reaction-test', process.env.TEST_URL ?? 'http://127.0.0.1:5191/').href);
  const checks = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { Ballistics } = await import('/src/game/ballistics.js');
    const { BlockMan } = await import('/src/actor/blockman.js');
    const { DemonEncounter, DEMON } = await import('/src/game/demon-encounter.js');
    const { isWalkable, resolvePosition } = await import('/src/world/navigation.js');
    const results = [], check = (label, pass) => results.push({ label, pass: !!pass });
    const scene = new THREE.Scene(), damage = [];
    const victim = { root: new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()) };
    victim.root.position.z = 3; scene.add(victim.root);
    const round = { scene, state: 'play', pool: [victim], hits: 0,
      targetable: () => true, damage: (...args) => damage.push(args),
      chest: (z, v) => v.copy(z.root.position),
      fx: { tracer() {}, spray() {}, decal() {} }, hooks: { shake() {} },
      hero: { root: new THREE.Group() }, sfx: {}, colliders: [], hurtHero() {},
      collide: (pos, radius) => resolvePosition(pos, radius, round.colliders),
    };
    const bullets = new Ballistics(round);
    const weapon = { id: 'shotgun', range: 10, knockback: 4 };
    const shot = { blast: true, pierce: false };
    for (let i = 0; i < 3; i++) bullets.fire(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), weapon, shot);
    weapon.id = 'rifle'; weapon.knockback = 99;
    bullets.update(0.1);
    check('all pellets plus blast damage; exactly one control for victim', damage.length === 4 && damage.filter(a => a[4].control).length === 1);
    check('projectiles retain weapon snapshot and buffs are locked', damage.every(a => a[4].weaponId === 'shotgun') && damage.filter(a => a[3] === 4).length === 3 && Object.isFrozen(shot.weapon) && !Object.getOwnPropertyDescriptor(shot, 'blast').writable);
    check('one hit statistic per shotgun shot', round.hits === 1);
    bullets.fire(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), weapon, {});
    bullets.update(0.1);
    check('new trigger can control the same victim', damage.at(-1)[4].control);
    const zombie = new BlockMan(); zombie.hitReact = 0.18; zombie.flash(); zombie.pose(0, 0);
    check('stationary target leans backward and flashes', zombie.body.rotation.x < -0.4 && zombie.flashT > 0);
    zombie.pose(0.2, 0); zombie.pose(0, 0);
    check('recoil and flash recover', zombie.body.rotation.x === 0 && zombie.meshes.every(m => m.material === m.userData.mat));
    const hero = new BlockMan({ kind: 'hero' });
    hero.setWeaponLevel(4);
    check('both weapons show upgrade geometry', [hero.rifle, hero.shotgun].every(w => w.children.filter(m => hero.weaponBands.some(b => b.mesh === m) && m.visible).length === 3));
    hero.setWeaponLevel(1);
    check('level reset hides upgrade geometry', hero.weaponBands.every(b => !b.mesh.visible));
    const encounter = new DemonEncounter(scene), d = encounter.actor;
    round.hero.root.position.set(15, 0, -12);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(20, 8, 0);
    check('guard home is beside rare crate', d.root.position.x === 15 && d.root.position.z === -15);
    encounter.beginCast(round);
    const flying = encounter.projectiles[1]; flying.active = true; flying.age = DEMON.windup + 0.1; flying.ball.visible = true;
    check('controlled hit interrupts only unreleased shots', encounter.takeHit(round, true) && !encounter.projectiles[0].active && flying.active);
    check('interrupt has a visible independent cue', d.interruptCueT > 0 && encounter.health.scale.x > 1 && encounter.healthFill.material.color.getHex() === 0xffffff);
    encounter.beginCast(round);
    check('resistance prevents repeated interruption', !encounter.takeHit(round, true) && encounter.projectiles[0].active && d.interruptResistT === 3);
    d.interruptResistT = 0;
    check('ordinary pellet flashes without interrupting', !encounter.takeHit(round, false) && encounter.projectiles[0].active && d.flashT > 0);
    check('control works again after resistance expires', encounter.takeHit(round, true));
    encounter.reset(); round.hero.root.position.set(15, 0, -12);
    encounter.beginCast(round); encounter.takeHit(round, true);
    let released = false;
    for (let i = 0; i < 100; i++) {
      encounter.takeHit(round, true); encounter.update(0.02, round, camera);
      released ||= encounter.projectiles.some(p => p.active && p.ball.visible);
    }
    check('continuous fire cannot suppress all future releases', released);
    encounter.reset();
    round.colliders = [{ x: 15, z: -14, halfX: 0.8, halfZ: 0.2, height: 5 }];
    encounter.beginCast(round);
    const projectile = encounter.projectiles[0];
    encounter.updateProjectiles(DEMON.windup + DEMON.flight, round);
    check('AABB scenery stops projectile before locked target', !projectile.active && projectile.target.z < -13.6);
    encounter.reset(); d.root.position.set(15, 0, -12); d.alert = false;
    round.hero.root.position.set(-15, 0, 10);
    let clear = true;
    for (let i = 0; i < 600; i++) {
      encounter.update(0.02, round, camera);
      clear &&= isWalkable(d.root.position.x, d.root.position.z, DEMON.radius, round.colliders);
    }
    check('guard routes around AABB scenery toward home', clear && d.root.position.distanceTo(new THREE.Vector3(15, 0, -15)) < 0.3);
    return results;
  });
  for (const c of checks) { console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.label}`); }
  assert.ok(checks.every(c => c.pass), 'Combat reaction checks failed');
} finally { await browser.close(); }
