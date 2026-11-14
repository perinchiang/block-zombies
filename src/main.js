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
      syncInput();
      input.reset();
      hud.pauseButton.hidden = true;
      document.exitPointerLock?.();
      setTimeout(() => {
        hud.result(win, s, () => begin());
      }, win ? 900 : 1300);
    },
  },
});

const input = new Input(canvas, { stick: document.querySelector('.stick'), knob: document.querySelector('.knob'), fire: document.querySelector('.fire') });

// over-the-shoulder rig, in hero space: right, up, back / right, up, forward
const CAM_OFF = vec(params.get('cam'), new THREE.Vector3(1.35, 2.55, 3.7));
const LOOK_OFF = vec(params.get('look'), new THREE.Vector3(0.75, 0.55, 4.2));
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
scene.add(camera);
const ink = new InkLine(renderer);
const rotateEl = document.getElementById('rotate');
let W = 1, H = 1, portrait = false;
let mouseLocked = false, resumeWithMouse = false, resuming = false;

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
  syncInput();
  if (portrait) input.reset();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

function syncInput() {
  input.enabled = !portrait && round.state === 'play';
}

function begin() {
  sfx.init();
  input.reset();
  hud.closePause();
  round.reset();
  round.start();
  syncInput();
  hud.pauseButton.hidden = false;
  resumeWithMouse = resuming = false;
  hud.show(true);
  hitstop = 0;
  cam.init = false;
}

function pause() {
  if (round.state !== 'play') return;
  resumeWithMouse = document.pointerLockElement === canvas || mouseLocked;
  round.state = 'paused';
  syncInput();
  input.reset();
  document.exitPointerLock?.();
  hud.pause(round, resume);
}

function resume() {
  if (round.state !== 'paused' || portrait || document.hidden || resuming) return;
  if (resumeWithMouse && document.pointerLockElement !== canvas) {
    resuming = true;
    // Stay paused until aim is usable again. Some browsers require another click
    // after Escape releases the pointer, so a rejected request keeps the panel open.
    try { canvas.requestPointerLock()?.catch(resumeLockFailed); } catch { resumeLockFailed(); }
    return;
  }
  completeResume();
}

function completeResume() {
  resuming = false;
  if (round.state !== 'paused' || portrait || document.hidden) return;
  input.reset();
  round.state = 'play';
  hud.closePause();
  syncInput();
}

function resumeLockFailed() {
  if (!resuming) return;
  resuming = false;
  hud.pauseLockHint();
}

// A second thumb does not always produce a compatibility click on mobile.
hud.pauseButton.addEventListener('pointerdown', (e) => { e.preventDefault(); pause(); });
hud.pauseButton.addEventListener('click', pause);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.repeat) return;
  if (round.state === 'paused') resume(); else pause();
});
// A phone switching apps must not leave combat running behind the page.
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked) pause();
  mouseLocked = locked;
  if (locked && resuming) completeResume();
});
document.addEventListener('pointerlockerror', resumeLockFailed);

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

// Zombies close by but outside the view: shown as red ink arrows on the edge.
const _threats = [];
function threatsAround() {
  _threats.length = 0;
  if (round.state !== 'play') return _threats;
  const hp = round.hero.root.position;
  const fx_ = Math.sin(round.yaw), fz = Math.cos(round.yaw);
  for (const z of round.pool) {
    if (!round.targetable(z)) continue;
    const dx = z.root.position.x - hp.x, dz = z.root.position.z - hp.z, d = Math.hypot(dx, dz);
    if (d > 9) continue;
    const ly = dx * fx_ + dz * fz, lx = -dx * fz + dz * fx_; // forward / right components
    const a = Math.atan2(lx, ly);                              // 0 ahead, + to the right
    if (Math.abs(a) < 0.95) continue;                          // already on screen
    _threats.push({ a, d });
  }
  _threats.sort((p, q) => p.d - q.d);
  return _threats;
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

  const paused = round.state === 'paused';
  let dt = still || portrait || paused ? 0 : raw * timeScale;
  if (hitstop > 0 && dt > 0) { hitstop -= raw; dt *= 0.08; }
  if (!paused) {
    const inp = auto && round.state === 'play' ? autopilot(dt) : input.read();
    round.update(dt, inp, camera);
    fx.update(dt);
  }

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
  if (!cam.init) { cam.pos.copy(want); cam.init = true; } else if (!paused) cam.pos.lerp(want, 1 - Math.exp(-raw * 14));
  cam.look.copy(hp).addScaledVector(_r, LOOK_OFF.x).addScaledVector(_f, LOOK_OFF.z).setY(LOOK_OFF.y);
  if (!paused) {
    cam.t += raw;
    cam.shake = Math.max(0, cam.shake - raw * 1.6);
    const s = cam.shake * cam.shake * 0.6;
    camera.position.copy(cam.pos);
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.lookAt(cam.look);
  }

  // shadows follow the hero so the frustum stays tight
  sun.position.copy(hp).add(SUN_OFF);
  sun.target.position.copy(hp);

  // crosshair: where the aim line meets the street ahead
  // crosshair sits exactly where the next bullet lands
  const aimAt = _v.copy(round.aimInfo.point).project(camera);
  hud.update(round, paused ? 0 : raw, { x: (aimAt.x + 1) * 0.5 * W, y: (1 - aimAt.y) * 0.5 * H });
  hud.threats(threatsAround(), W, H);

  ink.render(scene, camera, scene.fog);
  if (++frames === 3) window.__ready = true;
  requestAnimationFrame(frame);
}

window.__game = { scene, camera, round, renderer, stats, hud, begin };
if (params.has('skip') || auto || still) begin();
else hud.title(() => begin());
requestAnimationFrame(frame);
