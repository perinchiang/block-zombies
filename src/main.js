import * as THREE from 'three';
import { COL } from './render/palette.js';
import { LIGHT, TOON } from './render/toon.js';
import { InkLine, NO_INK_LAYER } from './render/inkline.js';
import { makeSky } from './render/sky.js';
import { buildArena, BOUNDS } from './world/arena.js';
import { resolvePosition } from './world/navigation.js';
import { Round } from './game/round.js';
import { Fx } from './game/fx.js';
import { Input } from './game/input.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './ui/hud.js';
import { Profile } from './game/profile.js';

// Dev params:
//   ?still          freeze time (screenshots)
//   ?skip           skip the title card
//   ?auto           autopilot plays the round (tests); ?speed=3 runs faster
//   ?shade=flat     solid ink shadows instead of hatching (style comparison)
//   ?cam=x,y,z   camera offset in hero space (right, up, back)
//   ?fps            show a frame-time readout
//   ?inspect=deg,dist,height  orbit the hero for model screenshots (0 = from the front)
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
scene.background = COL.horizon.clone();
// Haze takes the horizon colour, so the far skyline melts into the sky.
scene.fog = new THREE.Fog(COL.horizon, 18, 72);
scene.add(new THREE.AmbientLight(0xffffff, LIGHT.ambient));
const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
const SUN_OFF = new THREE.Vector3(-7, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const { colliders, group: arena } = buildArena(scene);
const fx = new Fx(scene);
const sfx = new Sfx();
const hud = new Hud();
const profile = new Profile();
hud.profile = profile;
hud.selectedWeapon = profile.equipped;

const cam = { shake: 0, offset: new THREE.Vector3() };
let hitstop = 0;

const round = new Round({
  scene, colliders, scenery: [arena], fx, sfx, profile,
  hooks: {
    camera: () => updateCamera(),
    shake: (a) => (cam.shake = Math.max(cam.shake, a)),
    hitstop: (t) => (hitstop = Math.max(hitstop, t)),
    hurt: () => hud.hurt(),
    // Coins are already banked when this fires; this only makes the reward felt.
    reward: ({ kind, amount, at }) => {
      const pack = kind === 'pickups';
      let landed = 0;
      fx.coins(at, pack ? 10 : Math.min(3, amount), round.hero.root.position, () => sfx.coin(landed++));
      hud.floater(`+${amount}`, at, pack);
      if (pack) sfx.jackpot();
    },
    end: (win, s) => {
      window.__game.result = { win, ...s };
      syncInput();
      input.reset();
      hud.pauseButton.hidden = true;
      document.exitPointerLock?.();
      setTimeout(() => {
        hud.result(win, s, () => openShop());
      }, win ? 900 : 1300);
    },
  },
});

const input = new Input(canvas, { stick: document.querySelector('.stick'), knob: document.querySelector('.knob'), fire: document.querySelector('.fire') });

// Over-the-shoulder rig, in hero space: right, up, back.
const CAM_OFF = vec(params.get('cam'), new THREE.Vector3(1.15, 1.65, 5.2));
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
camera.layers.enable(NO_INK_LAYER);
scene.add(camera);
const sky = makeSky();
sky.layers.set(NO_INK_LAYER);
camera.add(sky);
const ink = new InkLine(renderer);
fx.camera = camera;
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
  TOON.hatch.value = 5 * dpr;
  sky.material.uniforms.uDot.value = 9 * dpr;
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

function openShop() {
  round.state = 'shop';
  input.reset();
  syncInput();
  hud.closePause();
  hud.pauseButton.hidden = true;
  hud.show(false);
  profile.refresh();
  round.bank = profile.coins;
  hud.selectedWeapon = profile.equipped;
  hud.title((weaponId, options) => begin(weaponId, options));
}

function begin(weaponId = hud.selectedWeapon, { trial = false, mode = 'campaign' } = {}) {
  profile.refresh();
  if (!trial && mode !== 'challenge' && profile.campaignComplete) { openShop(); return; }
  // Trials are explicit, and never change the saved owned loadout.
  if (trial && weaponId !== 'shotgun') trial = false;
  if (!trial && !profile.owns(weaponId)) weaponId = profile.equipped;
  if (!trial) profile.equip(weaponId);
  sfx.init();
  input.reset();
  hud.closePause();
  round.reset(weaponId, { trial, mode });
  round.start();
  syncInput();
  hud.pauseButton.hidden = false;
  resumeWithMouse = resuming = false;
  hud.show(true);
  hitstop = 0;
  cam.shake = 0;
  cam.offset.set(0, 0, 0);
  camRig.t = camRig.side = camRig.wantSide = 1;
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
  // The sight is the camera's ray, and the camera sits off the shoulder: aim
  // from there, or every shot passes a metre beside the target.
  const chest = round.chest(near, _f.clone()), eye = camera.position;
  const want = Math.atan2(chest.x - eye.x, chest.z - eye.z);
  let d = want - round.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const tilt = Math.atan2(chest.y - eye.y, Math.hypot(chest.x - eye.x, chest.z - eye.z)) - round.pitch;
  const pitch = THREE.MathUtils.clamp(tilt, -(weak ? 1.2 : 4) * dt, (weak ? 1.2 : 4) * dt);
  if (weak) {
    bot.react -= dt;
    const turn = bot.react > 0 ? 0 : THREE.MathUtils.clamp(d, -1.8 * dt, 1.8 * dt);
    if (Math.abs(d) > 0.6 && bot.react <= -0.6) bot.react = 0.35; // loses track now and then
    return { move: { x: bot.strafe * 0.25, y: 0 }, turn, pitch, firing: Math.abs(d) < 0.12 };
  }
  const turn = THREE.MathUtils.clamp(d, -5 * dt, 5 * dt);
  return { move: { x: bot.strafe * 0.6, y: nd < 4.5 ? -1 : nd > 9 ? 0.4 : -0.2 }, turn, pitch, firing: Math.abs(d) < 0.08 && Math.abs(tilt) < 0.08 };
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
const _f = new THREE.Vector3(), _r = new THREE.Vector3();
const fpsEl = params.has('fps') ? Object.assign(document.body.appendChild(document.createElement('div')), { style: 'position:fixed;left:6px;bottom:4px;font:12px monospace;color:#1d1b21;z-index:9' }) : null;
let last = performance.now(), frames = 0, ftAvg = 16;
const stats = { frames: 0, slow: 0 };

// Near end of the rig: the hero's own eye line, which is always clear of walls.
const camRig = { t: 1, side: 1, wantSide: 1, hidden: false };
const CAM_CLEAR = 0.24; // keeps the near plane out of wall faces
const _eye = new THREE.Vector3(), _arm = new THREE.Vector3(), _far = new THREE.Vector3();

/** Full rig position for a shoulder (1 right .. -1 left), before any obstruction. */
function rigPoint(side, out) {
  const hp = round.hero.root.position;
  out.copy(_r).multiplyScalar(CAM_OFF.x * side).addScaledVector(_f, -CAM_OFF.z).setY(CAM_OFF.y - 0.65);
  // Orbit around the lower torso so the whole hero fits below the sight.
  out.applyAxisAngle(_r, round.pitch).add(hp);
  out.y += 0.65;
  out.x = THREE.MathUtils.clamp(out.x, -BOUNDS.x + 0.2, BOUNDS.x - 0.2);
  out.z = THREE.MathUtils.clamp(out.z, BOUNDS.zMin + 0.2, BOUNDS.zMax - 0.2);
  out.y = Math.max(0.25, out.y);
  return out;
}

/** How far along eye -> rig the camera may travel: 1 is the whole way. */
function rigClearance(side) {
  _arm.copy(rigPoint(side, _far)).sub(_eye);
  const reach = _arm.length();
  const hit = round.ballistics.trace(_eye, _arm.divideScalar(reach), reach, new Set(), true);
  return hit.blocked ? THREE.MathUtils.clamp((hit.distance - CAM_CLEAR) / reach, 0, 1) : 1;
}

const INSPECT = params.get('inspect')?.split(',').map(Number);

function updateCamera(dt = 0) {
  const hp = round.hero.root.position;
  if (INSPECT) {
    const [deg = 0, dist = 2.6, height = 1.1] = INSPECT;
    const a = round.yaw + THREE.MathUtils.degToRad(deg);
    camera.position.set(hp.x + Math.sin(a) * dist, height, hp.z + Math.cos(a) * dist);
    camera.lookAt(hp.x, 0.8, hp.z);
    camera.updateMatrixWorld(true);
    return;
  }
  _f.set(Math.sin(round.yaw), 0, Math.cos(round.yaw));
  _r.set(-Math.cos(round.yaw), 0, Math.sin(round.yaw));
  round.scene.updateMatrixWorld(true);
  _eye.copy(hp).setY(1.3).addScaledVector(_f, 0.1);
  // A wall on the camera's side would fill half the frame: use the other shoulder
  // while that one is clearly more open, and come back once the right is free.
  const right = rigClearance(1), left = right < 0.75 ? rigClearance(-1) : 0;
  if (camRig.wantSide > 0 ? left > right + 0.2 : right >= 0.9 || right >= left) camRig.wantSide = -camRig.wantSide;
  camRig.side += THREE.MathUtils.clamp(camRig.wantSide - camRig.side, -dt * 5, dt * 5);
  // With a wall behind the hero the camera slides forward along the line from
  // the full rig to the eye line. It ends in a first-person view rather than
  // inside the torso, so the street ahead is never covered by the hero.
  const allowed = rigClearance(camRig.side);
  // Close in at once, ease back out so passing a pillar does not pump the view.
  camRig.t = allowed < camRig.t ? allowed : Math.min(allowed, camRig.t + dt * 2.2);
  const want = rigPoint(camRig.side, _far).sub(_eye).multiplyScalar(camRig.t).add(_eye);
  // A ray is thin; the near plane is not. Keep clear of faces beside the path.
  if (camRig.t > 0.02) resolvePosition(want, CAM_CLEAR, round.colliders.filter((c) => c.height > want.y - 0.15));
  const near = Math.hypot(want.x - hp.x, want.z - hp.z);
  // Up close the hero would fill the frame: ghost first, then drop out entirely.
  camRig.hidden = near < (camRig.hidden ? 1.0 : 0.85);
  round.hero.root.visible = !camRig.hidden;
  round.hero.setGhost(THREE.MathUtils.smoothstep(near, 0.9, 2.3));
  camera.position.copy(want).add(cam.offset);
  const direction = _f.clone().multiplyScalar(Math.cos(round.pitch)).setY(Math.sin(round.pitch));
  camera.lookAt(camera.position.clone().add(direction));
  camera.updateMatrixWorld(true);
}

function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  ftAvg += (raw * 1000 - ftAvg) * 0.05;
  if (fpsEl && frames % 15 === 0) fpsEl.textContent = `${ftAvg.toFixed(1)} ms · ${round.alive} zombies`;
  stats.frames++; if (raw > 1 / 40) stats.slow++;

  const paused = round.state === 'paused';
  const inShop = round.state === 'shop';
  let dt = still || portrait || paused || inShop ? 0 : raw * timeScale;
  if (hitstop > 0 && dt > 0) { hitstop -= raw; dt *= 0.08; }
  if (!paused) {
    cam.shake = Math.max(0, cam.shake - raw * 1.6);
    const shake = cam.shake * cam.shake * 0.6;
    cam.offset.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0);
    const inp = auto && round.state === 'play' ? autopilot(dt) : input.read();
    round.update(dt, inp, camera);
    fx.update(dt);
  }

  const hp = round.hero.root.position;
  if (!paused) {
    updateCamera(raw);
    round.resolveAim(camera);
  }

  // shadows follow the hero so the frustum stays tight
  sun.position.copy(hp).add(SUN_OFF);
  sun.target.position.copy(hp);

  // A fixed sight never snaps to a target; muzzle obstruction is physical.
  hud.update(round, paused ? 0 : raw, { x: W / 2, y: H / 2 });
  hud.threats(threatsAround(), W, H);
  hud.floaters(camera, W, H, paused ? 0 : raw);

  ink.render(scene, camera, scene.fog);
  if (++frames === 3) window.__ready = true;
  requestAnimationFrame(frame);
}

window.__game = { scene, camera, round, renderer, stats, hud, profile, begin, openShop };
if (params.has('skip') || auto || still) begin();
else openShop();
requestAnimationFrame(frame);
