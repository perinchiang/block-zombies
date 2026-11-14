import { TUNE } from '../game/round.js';

const $ = (s, r = document) => r.querySelector(s);

export class Hud {
  constructor() {
    this.el = $('#hud');
    this.hp = $('.hp', this.el);
    this.clock = $('.clock', this.el);
    this.kills = $('.kills b', this.el);
    this.ammo = $('.ammo b', this.el);
    this.ammoMax = $('.ammo', this.el);
    this.reload = $('.reload', this.el);
    this.cross = $('.cross', this.el);
    this.hint = $('.hint', this.el);
    this.hurtEl = $('#hurt');
    this.panel = $('#panel');
    this.hurtT = 0;
    this.last = {};
    this.hp.innerHTML = '<span></span>'.repeat(TUNE.hearts);
    this.ammoMax.innerHTML = `<b>${TUNE.mag}</b>/${TUNE.mag}`;
    this.ammo = $('.ammo b', this.el);
  }

  show(on) { this.el.hidden = !on; }

  set(key, value, fn) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    fn(value);
  }

  update(round, dt, crossXY) {
    this.set('hp', round.hp, (v) => [...this.hp.children].forEach((s, i) => s.classList.toggle('off', i >= v)));
    const sec = Math.ceil(round.time);
    this.set('clock', sec, (v) => {
      this.clock.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
      this.clock.classList.toggle('hot', v <= 10);
    });
    this.set('kills', round.kills, (v) => (this.kills.textContent = v));
    this.set('ammo', round.ammo, (v) => (this.ammo.textContent = Math.max(0, v)));
    this.set('reload', round.reloadT > 0, (v) => (this.reload.hidden = !v));
    if (crossXY) this.cross.style.transform = `translate(${crossXY.x}px, ${crossXY.y}px)${round.target ? ' rotate(45deg) scale(0.85)' : ''}`;
    this.set('lock', !!round.target, (v) => this.cross.classList.toggle('lock', v));
    if (round.elapsed > 6) this.set('hint', true, () => this.hint.classList.add('gone'));
    if (this.hurtT > 0) { this.hurtT -= dt; this.hurtEl.style.opacity = Math.max(0, this.hurtT / 0.45).toFixed(2); }
  }

  hurt() { this.hurtT = 0.45; }

  resetHint() { this.hint.classList.remove('gone'); this.last.hint = undefined; }

  card(html, onGo) {
    this.panel.innerHTML = `<div class="card">${html}</div>`;
    this.panel.hidden = false;
    const btn = $('.btn', this.panel);
    const go = (e) => { e.preventDefault(); e.stopPropagation(); this.panel.hidden = true; onGo(); };
    btn.addEventListener('click', go, { once: true });
    btn.addEventListener('touchend', go, { once: true });
  }

  title(onGo) {
    this.card(`
      <h1>方块<span class="r">尸潮</span></h1>
      <p>撑过 60 秒</p>
      <div class="btn">开始</div>`, onGo);
  }

  result(win, s, onGo) {
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    this.card(`
      <h1>${win ? '撑过来了' : '<span class="r">被咬了</span>'}</h1>
      <p>${win ? '街上安静了一会儿。' : `坚持了 ${Math.floor(s.time)} 秒`}</p>
      <div class="stats"><div><b>${s.kills}</b>击倒</div><div><b>${acc}%</b>命中</div><div><b>${s.hp}</b>剩余血量</div></div>
      <div class="btn">再来一局</div>`, onGo);
  }
}
