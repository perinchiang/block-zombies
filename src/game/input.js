// Phone-first controls.
//  - Left half: a floating stick appears where the thumb lands (move).
//  - Right half: drag to turn. The fire button fires while held and can be
//    dragged to keep turning, so one thumb can aim and shoot.
//  - Desktop: WASD/arrows move, click to lock the mouse, mouse turns,
//    left button or Space fires, F turns around.
//  - The small turn button spins the hero 180° (for the ones behind you).
export class Input {
  constructor(el, { stick, knob, fire, turn }) {
    this.move = { x: 0, y: 0 };   // x right, y forward, length <= 1
    this.turn = 0;                // accumulated yaw delta in radians, consumed per frame
    this.firing = false;
    this.enabled = true;
    this.stickEl = stick; this.knobEl = knob; this.fireEl = fire; this.turnEl = turn;
    this.quick = false;
    this.touches = new Map();     // id -> { role, x0, y0, x, y }
    this.keys = new Set();
    this.mouseFire = false;
    this.sens = 0.0065;           // radians per CSS pixel of drag
    const opts = { passive: false };
    el.addEventListener('touchstart', (e) => this.onStart(e), opts);
    el.addEventListener('touchmove', (e) => this.onMove(e), opts);
    el.addEventListener('touchend', (e) => this.onEnd(e), opts);
    el.addEventListener('touchcancel', (e) => this.onEnd(e), opts);
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyF' && !e.repeat) this.quick = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      if (document.pointerLockElement !== el) el.requestPointerLock?.();
      this.mouseFire = true;
    });
    window.addEventListener('mouseup', () => (this.mouseFire = false));
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === el && this.enabled) this.turn -= e.movementX * 0.0025;
    });
    this.el = el;
  }

  onStart(e) {
    e.preventDefault();
    if (!this.enabled) return;
    const fireBox = this.fireEl.getBoundingClientRect();
    const turnBox = this.turnEl?.getBoundingClientRect();
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      let role;
      const fx = fireBox.left + fireBox.width / 2, fy = fireBox.top + fireBox.height / 2;
      if (turnBox && Math.hypot(x - (turnBox.left + turnBox.width / 2), y - (turnBox.top + turnBox.height / 2)) < turnBox.width * 0.7) {
        role = 'turn';
        this.quick = true;
        this.turnEl.classList.add('down');
      } else if (Math.hypot(x - fx, y - fy) < fireBox.width * 0.75) role = 'fire';
      else if (x < window.innerWidth * 0.45) role = [...this.touches.values()].some((v) => v.role === 'stick') ? 'look' : 'stick';
      else role = 'look';
      this.touches.set(t.identifier, { role, x0: x, y0: y, x, y });
      if (role === 'stick') this.showStick(x, y);
      if (role === 'fire') this.fireEl.classList.add('down');
    }
    this.sync();
  }

  onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = this.touches.get(t.identifier);
      if (!s) continue;
      if (s.role === 'look' || s.role === 'fire') this.turn -= (t.clientX - s.x) * this.sens;
      s.x = t.clientX; s.y = t.clientY;
    }
    this.sync();
  }

  onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = this.touches.get(t.identifier);
      if (s?.role === 'fire') this.fireEl.classList.remove('down');
      if (s?.role === 'turn') this.turnEl.classList.remove('down');
      this.touches.delete(t.identifier);
    }
    this.sync();
  }

  showStick(x, y) {
    this.stickEl.style.left = `${x - 60}px`;
    this.stickEl.style.top = `${y - 60}px`;
    this.stickEl.style.bottom = 'auto';
    this.stickEl.classList.add('live');
  }

  sync() {
    let stick = null, fire = false;
    for (const s of this.touches.values()) {
      if (s.role === 'stick') stick = s;
      if (s.role === 'fire') fire = true;
    }
    this.touchFire = fire;
    if (stick) {
      const R = 48;
      let dx = stick.x - stick.x0, dy = stick.y - stick.y0;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      const k = Math.min(1, len / R);
      const dead = 0.12;
      const m = k < dead ? 0 : (k - dead) / (1 - dead);
      const clampedLen = Math.min(len, R);
      this.touchMove = len > 0 ? { x: (dx / clampedLen) * m, y: (-dy / clampedLen) * m } : { x: 0, y: 0 };
    } else {
      this.knobEl.style.transform = '';
      this.stickEl.classList.remove('live');
      this.stickEl.style.left = ''; this.stickEl.style.top = ''; this.stickEl.style.bottom = '';
      this.touchMove = null;
    }
  }

  /** Read the frame's input. Returns { move, turn, firing }. */
  read() {
    if (!this.enabled) { this.turn = 0; this.quick = false; return { move: { x: 0, y: 0 }, turn: 0, firing: false, quickTurn: false }; }
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyQ')) this.turn += 0.04;
    if (k.has('KeyE')) this.turn -= 0.04;
    const l = Math.hypot(x, y);
    const move = this.touchMove ?? (l ? { x: x / l, y: y / l } : { x: 0, y: 0 });
    const turn = this.turn, quickTurn = this.quick;
    this.turn = 0;
    this.quick = false;
    return { move, turn, firing: !!this.touchFire || this.mouseFire || k.has('Space'), quickTurn };
  }

  reset() {
    this.touches.clear();
    this.keys.clear();
    this.mouseFire = false;
    this.quick = false;
    this.turn = 0;
    this.fireEl.classList.remove('down');
    this.turnEl?.classList.remove('down');
    this.sync();
  }
}
