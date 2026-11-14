import * as THREE from 'three';
import { COL } from './render/palette.js';
import { LIGHT, TOON } from './render/toon.js';
import { InkLine } from './render/inkline.js';
import { buildArena, splat, muzzleFlash } from './world/arena.js';
import { BlockMan } from './actor/blockman.js';

// Day-one style slice: a street, the hero, a shambling horde. No gameplay yet.
const params = new URLSearchParams(location.search);
const still = params.has('still');
// ?shade=flat swaps hatched shadows for solid ink blocks (style comparison)
const flatShade = params.get('shade') === 'flat';
const vec = (s, d) => (s ? new THREE.Vector3(...s.split(',').map(Number)) : d);

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // banded by the toon pass into hard edges

const scene = new THREE.Scene();
scene.background = COL.paper.clone();
scene.fog = new THREE.Fog(COL.paper, 16, 46);

scene.add(new THREE.AmbientLight(0xffffff, LIGHT.ambient));
const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
sun.position.set(-7, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

buildArena(scene);
if (flatShade) TOON.flat = true;

const hero = new BlockMan({ kind: 'hero' });
hero.root.rotation.y = Math.PI; // face -Z, down the street
scene.add(hero.root);

const zombies = [];
const spots = [[-0.6, -4.2], [1.3, -6.0], [-1.8, -7.4], [0.4, -9.8], [-0.9, -12.5], [2.4, -13.6], [-2.7, -17], [1.0, -19], [-0.2, -23]];
spots.forEach(([x, z], i) => {
  const zb = new BlockMan({ kind: 'zombie', seed: i + 1 });
  zb.root.position.set(x, 0, z);
  zb.root.rotation.y = Math.atan2(-x, -z); // shamble toward the hero
  zb.home = new THREE.Vector3(x, 0, z);
  scene.add(zb.root);
  zombies.push(zb);
});

// a downed zombie with the only red on the street
const downed = new BlockMan({ kind: 'zombie', seed: 42 });
downed.pose(0, 0);
downed.root.position.set(2.0, 0.14, -3.6);
downed.root.rotation.set(-Math.PI / 2, 0.4, 0, 'YXZ');
scene.add(downed.root);
const blood = splat(COL.blood, 0.55, 3);
blood.position.set(2.1, 0.02, -3.0);
scene.add(blood);
const inkPool = splat(COL.ink, 0.35, 9);
inkPool.position.set(-2.4, 0.02, -8.6);
scene.add(inkPool);

const flash = muzzleFlash();
scene.add(flash);

// over-the-shoulder camera: behind and right of the hero, hero in lower left
const CAM_OFF = vec(params.get('cam'), new THREE.Vector3(1.3, 2.5, 3.9));
const LOOK_OFF = vec(params.get('look'), new THREE.Vector3(1.0, 0.95, -6));
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
scene.add(camera);

const ink = new InkLine(renderer);
const rotate = document.getElementById('rotate');

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  ink.setSize(size.x, size.y, h < 500 ? 1.8 : 2.2);
  TOON.hatch.value = 8 * dpr;
  camera.aspect = w / h;
  // narrower landscape windows get a little more vertical field
  camera.fov = 50 + THREE.MathUtils.clamp((1.9 - camera.aspect) / 0.6, 0, 1) * 10;
  camera.updateProjectionMatrix();
  rotate.hidden = !(h > w);
}
window.addEventListener('resize', resize);
resize();

const _v = new THREE.Vector3();
let last = performance.now(), frames = 0, shotT = 0;
function frame(now) {
  const dt = still ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;

  hero.pose(dt, 0);
  for (const z of zombies) {
    if (!still) {
      // walk a short loop toward the hero, then drift back to home
      z.cycle = ((z.cycle ?? Math.random() * 6) + dt) % 6;
      const d = z.cycle * 0.35 * z.speed;
      _v.set(-z.home.x, 0, -z.home.z).normalize().multiplyScalar(d);
      z.root.position.copy(z.home).add(_v);
    }
    z.pose(dt, 1);
  }

  camera.position.copy(hero.root.position).add(CAM_OFF);
  camera.lookAt(_v.copy(hero.root.position).add(LOOK_OFF));

  // muzzle flash pulses like an automatic burst
  shotT += dt;
  const on = still || (shotT % 0.5) < 0.07;
  flash.visible = on;
  if (on) {
    hero.muzzle.getWorldPosition(flash.position);
    flash.quaternion.copy(camera.quaternion);
    flash.rotation.z += 0.4;
    flash.scale.setScalar(still ? 1 : 0.8 + Math.random() * 0.5);
  }

  ink.render(scene, camera, scene.fog);
  if (++frames === 3) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game = { scene, camera, hero, zombies, renderer };
