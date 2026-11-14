import * as THREE from 'three';
import { COL } from './render/palette.js';
import { LIGHT, TOON } from './render/toon.js';
import { InkLine } from './render/inkline.js';
import { buildArena } from './world/arena.js';
import { Round } from './game/round.js';
import { Fx } from './game/fx.js';
import { Input } from './game/input.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './ui/hud.js';

// Dev params:
//   ?still          freeze time (screenshots)
//   ?skip           skip the title card
//   ?auto           autopilot plays the round (tests); ?speed=3 runs faster
//   ?shade=flat     solid ink shadows instead of hatching (style comparison)
//   ?cam=x,y,z&look=x,y,z   camera offsets in hero space (right, up, back / right, up, forward)
//   ?fps            show a frame-time readout
const params = new URLSearchParams(location.search);
const still = params.has('still');
const auto = params.has('auto');
const timeScale = +(params.get('speed') ?? 1);
if (params.get('shade') === 'flat') TOON.flat = true;
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
const SUN_OFF = new THREE.Vector3(-7, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const { colliders } = buildArena(scene);
const fx = new Fx(scene);
const sfx = new Sfx();
const hud = new Hud();

const cam = { shake: 0, t: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
let hitstop = 0;

const round = new Round({
  scene, colliders, fx, sfx,
  hooks: {
    shake: (a) => (cam.shake = Math.max(cam.shake, a)),
    hitstop: (t) => (hitstop = Math.max(hitstop, t)),
    hurt: () => hud.hurt(),
    end: (win, s) => {
      window.__game.result = { win, ...s };
      setTimeout(() => {
        input.reset();
        hud.result(win, s, () => begin());
      }, win ? 900 : 1300);
    },
  },
});

const input = new Input(canvas, { stick: document.querySelector('.stick'), knob: document.querySelector('.knob'), fire: document.querySelector('.fire') });

// over-the-shoulder rig, in hero space: right, up, back / right, up, forward
const CAM_OFF = vec(params.get('cam'), new THREE.Vector3(1.3, 2.5, 3.9));
const LOOK_OFF = vec(params.get('look'), new THREE.Vector3(1.0, 0.95, 6));
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
scene.add(camera);
const ink = new InkLine(renderer);
const rotateEl = document.getElementById('rotate');
let W = 1, H = 1, portrait = false;

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  ink.setSize(size.x, size.y, H < 500 ? 1.8 : 2.2);
  TOON.hatch.value = 8 * dpr;
  camera.aspect = W / H;
  camera.fov = 50 + THREE.MathUtils.clamp((1.9 - camera.aspect) / 0.6, 0, 1) * 10;
  camera.updateProjectionMatrix();
  portrait = H > W;
  rotateEl.hidden = !portrait;
  input.enabled = !portrait;
  if (portrait) input.reset();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

function begin() {
  sfx.init();
  round.reset();
  round.start();
  hud.resetHint();
  hud.show(true);
  cam.init = false;
}

// ---- autopilot: turns to the nearest zombie, fires, backs off when crowded.
// ?auto is a decent player; ?auto=weak turns slowly, hesitates and never backs off,
// a stand-in for a first-time phone player.
const weak = params.get('auto') === 'weak';
const bot = { strafe: 1, t: 0, react: 0 };
function autopilot(dt) {
  bot.t -= dt;
  if (bot.t <= 0) { bot.t = 1.5 + Math.random() * 2; bot.strafe = -bot.strafe; }
  const hp = round.hero.root.position;
  let near = null, nd = 1e9;
  for (const z of round.pool) {
    if (!z.active || z.dead || z.rise < 0.6) continue;
    const d = z.root.position.distanceTo(hp);
    if (d < nd) { nd = d; near = z; }
  }
  if (!near) return { move: { x: bot.strafe * 0.3, y: 0 }, turn: 0, firing: false };
  const want = Math.atan2(near.root.position.x - hp.x, near.root.position.z - hp.z);
  let d = want - round.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  if (weak) {
    bot.react -= dt;
    const turn = bot.react > 0 ? 0 : THREE.MathUtils.clamp(d, -1.8 * dt, 1.8 * dt);
    if (Math.abs(d) > 0.6 && bot.react <= -0.6) bot.react = 0.35; // loses track now and then
    return { move: { x: bot.strafe * 0.25, y: 0 }, turn, firing: Math.abs(d) < 0.12 };
  }
  const turn = THREE.MathUtils.clamp(d, -5 * dt, 5 * dt);
  return { move: { x: bot.strafe * 0.6, y: nd < 4.5 ? -1 : nd > 9 ? 0.4 : -0.2 }, turn, firing: Math.abs(d) < 0.25 };
}

// ---- frame
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3();
const fpsEl = params.has('fps') ? Object.assign(document.body.appendChild(document.createElement('div')), { style: 'position:fixed;left:6px;bottom:4px;font:12px monospace;color:#1d1b21;z-index:9' }) : null;
let last = performance.now(), frames = 0, ftAvg = 16;
const stats = { frames: 0, slow: 0 };

function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  ftAvg += (raw * 1000 - ftAvg) * 0.05;
  if (fpsEl && frames % 15 === 0) fpsEl.textContent = `${ftAvg.toFixed(1)} ms · ${round.alive} zombies`;
  stats.frames++; if (raw > 1 / 40) stats.slow++;

  let dt = still || portrait ? 0 : raw * timeScale;
  if (hitstop > 0) { hitstop -= raw; dt *= 0.08; }
  const inp = auto && round.state === 'play' ? autopilot(dt) : input.read();
  round.update(dt, inp, camera);
  fx.update(dt);

  // camera follows facing; position eases, look stays locked to the aim
  const hp = round.hero.root.position;
  _f.set(Math.sin(round.yaw), 0, Math.cos(round.yaw));
  _r.set(-Math.cos(round.yaw), 0, Math.sin(round.yaw));
  // shoulder offset; if it would push into a building, slide in and up instead
  const ox = _r.x * CAM_OFF.x - _f.x * CAM_OFF.z, oz = _r.z * CAM_OFF.x - _f.z * CAM_OFF.z;
  const WALL = 6.3;
  let k = 1;
  if (Math.abs(hp.x + ox) > WALL && Math.abs(ox) > 1e-4) k = THREE.MathUtils.clamp((Math.sign(hp.x + ox) * WALL - hp.x) / ox, 0.3, 1);
  const want = _v.set(hp.x + ox * k, CAM_OFF.y + (1 - k) * 1.6, hp.z + oz * k);
  if (!cam.init) { cam.pos.copy(want); cam.init = true; } else cam.pos.lerp(want, 1 - Math.exp(-raw * 14));
  cam.look.copy(hp).addScaledVector(_r, LOOK_OFF.x).addScaledVector(_f, LOOK_OFF.z).setY(LOOK_OFF.y);
  cam.t += raw;
  cam.shake = Math.max(0, cam.shake - raw * 1.6);
  const s = cam.shake * cam.shake * 0.6;
  camera.position.copy(cam.pos);
  camera.position.x += (Math.random() - 0.5) * s;
  camera.position.y += (Math.random() - 0.5) * s;
  camera.lookAt(cam.look);

  // shadows follow the hero so the frustum stays tight
  sun.position.copy(hp).add(SUN_OFF);
  sun.target.position.copy(hp);

  // crosshair: where the aim line meets the street ahead
  const aimAt = round.target ? round.chest(round.target, _v) : _v.copy(hp).addScaledVector(_f, 12).setY(1.0);
  aimAt.project(camera);
  hud.update(round, raw, { x: (aimAt.x + 1) * 0.5 * W, y: (1 - aimAt.y) * 0.5 * H });

  ink.render(scene, camera, scene.fog);
  if (++frames === 3) window.__ready = true;
  requestAnimationFrame(frame);
}

window.__game = { scene, camera, round, renderer, stats, hud, begin };
if (params.has('skip') || auto || still) begin();
else hud.title(() => begin());
requestAnimationFrame(frame);
