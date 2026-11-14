import * as THREE from 'three';
import { HEX } from '../render/palette.js';
import { flat, toon } from '../render/toon.js';

export const BUFF_NAMES = Object.freeze({
  frenzy: '狂热',
  pierce: '穿甲',
  blast: '爆裂',
  sprint: '疾走',
  shield: '墨盾',
});

const TYPES = Object.keys(BUFF_NAMES);
const SYMBOLS = { frenzy: '!', pierce: '↗', blast: '✹', sprint: '»', shield: '⬟' };
const VALID = (type) => Object.hasOwn(BUFF_NAMES, type);

/** Bounded, reusable comic bubbles; gameplay clocks pause independently of animation. */
export class Buffs {
  constructor(scene) {
    this.timers = Object.fromEntries(TYPES.map((type) => [type, 0]));
    this.time = 0;
    this.nextDrop = 0;

    const geometry = new THREE.SphereGeometry(0.32, 16, 12);
    const blue = toon('#4f8fb0');
    const outline = flat(HEX.ink, { side: THREE.BackSide });
    // Five shared labels, never allocated during drops or resets.
    const labels = Object.fromEntries(TYPES.map((type) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.font = 'bold 88px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.strokeStyle = HEX.paper;
      ctx.fillStyle = HEX.ink;
      ctx.strokeText(SYMBOLS[type], 64, 68);
      ctx.fillText(SYMBOLS[type], 64, 68);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      return [type, new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false })];
    }));
    this.labels = labels;
    this.drops = Array.from({ length: 12 }, (_, i) => {
      const mesh = new THREE.Mesh(geometry, blue);
      const ink = new THREE.Mesh(geometry, outline);
      ink.scale.setScalar(1.1);
      mesh.add(ink);
      const label = new THREE.Sprite(labels.frenzy);
      label.scale.set(0.48, 0.48, 1);
      // Keep the billboard readable over the solid bubble.
      label.renderOrder = 1;
      mesh.add(label);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, label, position: new THREE.Vector3(), type: 'frenzy', remaining: 0, phase: i * 2.4 };
    });
  }

  reset() {
    for (const type of TYPES) this.timers[type] = 0;
    for (const drop of this.drops) {
      drop.remaining = 0;
      drop.mesh.visible = false;
    }
    this.time = 0;
    this.nextDrop = 0;
  }

  has(type) {
    return VALID(type) && this.timers[type] > 0;
  }

  consume(type) {
    if (!this.has(type)) return false;
    this.timers[type] = 0;
    return true;
  }

  grant(type) {
    if (!VALID(type)) return false;
    if (!this.has(type)) {
      const active = TYPES.filter((key) => this.has(key));
      if (active.length >= 2) {
        const oldest = active.reduce((a, b) => this.timers[a] <= this.timers[b] ? a : b);
        this.timers[oldest] = 0;
      }
    }
    this.timers[type] = 8;
    return true;
  }

  drop(position, type = TYPES[Math.floor(Math.random() * TYPES.length)]) {
    if (!VALID(type)) return false;
    const drop = this.drops.find((item) => !item.mesh.visible)
      ?? this.drops[this.nextDrop++ % this.drops.length];
    drop.position.copy(position);
    drop.type = type;
    drop.remaining = 6;
    drop.label.material = this.labels[type];
    drop.mesh.position.copy(position);
    drop.mesh.position.y += 0.65;
    drop.mesh.visible = true;
    return true;
  }

  update(dt, heroPosition, playing) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.time += dt;
    if (playing) {
      for (const type of TYPES) this.timers[type] = Math.max(0, this.timers[type] - dt);
    }
    for (const drop of this.drops) {
      if (!drop.mesh.visible) continue;
      drop.mesh.position.y = drop.position.y + 0.65 + Math.sin(this.time * 3 + drop.phase) * 0.12;
      drop.mesh.rotation.y += dt * 1.8;
      if (!playing) continue;
      drop.remaining = Math.max(0, drop.remaining - dt);
      if (drop.remaining === 0) {
        drop.mesh.visible = false;
      } else if (heroPosition && drop.position.distanceToSquared(heroPosition) < 1) {
        this.grant(drop.type);
        drop.remaining = 0;
        drop.mesh.visible = false;
      }
    }
  }
}
