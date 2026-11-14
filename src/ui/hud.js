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
    this.pressure = $('.pressure b', this.el);
    this.pressureFill = $('.pressure em', this.el);
    this.loot = $('.loot b', this.el);
    this.opened = $('.opened b', this.el);
    this.phase = $('.phase', this.el);
    this.navigation = $('.navigation', this.el);
    this.interaction = $('.interaction', this.el);
    this.notice = $('.notice', this.el);
    this.buffs = $('.buffs', this.el);
    this.buffEdge = $('.buff-edge', this.el);
    this.threatBox = $('.threats', this.el);
    this.threatEls = Array.from({ length: 4 }, () => this.threatBox.appendChild(Object.assign(document.createElement('div'), { className: 'threat' })));
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
    this.updateMission(round);
    const sec = Math.max(0, Math.ceil(round.time));
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

  updateMission(round) {
    const pressure = Math.round(Math.max(0, Math.min(100, round.pressure ?? 0)));
    this.set('pressure', pressure, (v) => {
      this.pressure.textContent = v;
      this.pressureFill.style.width = `${v}%`;
    });
    this.set('loot', round.loot ?? 0, (v) => (this.loot.textContent = v));
    this.set('opened', round.opened ?? 0, (v) => (this.opened.textContent = v));
    this.phase.textContent = round.missed ? '末班车已离开 · 未能撤离' : round.evacOpen
      ? '撤离车已到 · 倒计时归零即离开' : `搜刮物资 · 撤离车 ${Math.max(0, Math.ceil(90 - round.elapsed))} 秒后到`;
    const h = round.hero.root.position;
    const distance = (p) => Math.hypot(p.x - h.x, p.z - h.z);
    let goal = null;
    if (round.evacOpen) goal = round.evac;
    else if (!round.missed) {
      for (const crate of round.crates ?? []) {
        if (!crate.opened && (!goal || distance(crate) < distance(goal))) goal = crate;
      }
    }
    if (goal) {
      // Round.right is (-cos(yaw), sin(yaw)): positive angle is screen-right.
      const a = round.yaw - Math.atan2(goal.x - h.x, goal.z - h.z);
      const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
      const index = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      this.navigation.textContent = `${arrows[index]} ${round.evacOpen ? '撤离车' : '最近物资箱'} · ${Math.ceil(distance(goal))} 米`;
    } else this.navigation.textContent = round.missed ? '失败仍带走 25% 金币' : '物资箱已清空 · 等待撤离车';
    const crate = round.nearbyCrate;
    const atEvac = round.evacOpen && round.evac && distance(round.evac) <= round.evac.radius;
    this.interaction.hidden = !atEvac && (!crate || crate.opened) || round.missed;
    if (!this.interaction.hidden) {
      const duration = atEvac ? 5 : 1.5;
      const elapsed = Math.max(0, Math.min(duration, (atEvac ? round.extracting : crate.progress) ?? 0));
      $('span', this.interaction).textContent = atEvac
        ? `圈内坚持 · ${elapsed.toFixed(1)} / 5 秒`
        : `停步停火开箱 · ${elapsed.toFixed(1)} / 1.5 秒`;
      $('progress', this.interaction).value = elapsed / duration;
    }
    this.notice.hidden = !(round.noticeT > 0 && round.notice);
    this.notice.textContent = this.notice.hidden ? '' : round.notice;
    const names = { frenzy: '狂热', pierce: '穿甲', blast: '爆裂', sprint: '疾走', shield: '墨盾' };
    const active = Object.entries(names).filter(([key]) => round.buffTimers?.[key] > 0).slice(0, 2);
    this.buffs.textContent = active.map(([key, name]) => `${name} ${Math.ceil(round.buffTimers[key])}秒`).join(' · ');
    this.buffs.hidden = this.buffEdge.hidden = active.length === 0;
  }

  hurt() { this.hurtT = 0.45; }

  /** Edge arrows for nearby zombies outside the view. a: 0 ahead, + right. */
  threats(list, W, H) {
    const cx = W / 2, cy = H / 2, rx = W / 2 - 46, ry = H / 2 - 46;
    this.threatEls.forEach((el, i) => {
      const t = list[i];
      if (!t) { el.style.opacity = 0; return; }
      // push onto the rectangle edge along the arrow direction
      const sx = Math.sin(t.a), sy = -Math.cos(t.a);
      const k = Math.min(rx / Math.max(Math.abs(sx), 1e-3), ry / Math.max(Math.abs(sy), 1e-3));
      const near = 1 - Math.min(1, t.d / 9);
      el.style.opacity = (0.45 + near * 0.55).toFixed(2);
      el.style.transform = `translate(${cx + sx * k}px, ${cy + sy * k}px) rotate(${t.a}rad) scale(${0.8 + near * 0.6})`;
    });
  }

  resetHint() { this.hint.classList.remove('gone'); this.last.hint = undefined; }

  card(html, onGo) {
    this.panel.innerHTML = `<div class="card">${html}</div>`;
    this.panel.hidden = false;
    const btn = $('.btn', this.panel);
    let used = false;
    const go = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (used) return;
      used = true;
      this.panel.hidden = true;
      onGo();
    };
    btn.addEventListener('click', go, { once: true });
    btn.addEventListener('touchend', go, { once: true });
  }

  title(onGo) {
    this.card(`
      <h1>方块<span class="r">尸潮</span></h1>
      <p>搜刮金币，活着赶上末班车。</p>
      <div class="rules">物资箱：靠近 1.6 米，停步停火 1.5 秒自动开箱<br>撤离车：90 秒到站，240 秒离开；圈内坚持 5 秒<br>成功带走全部金币；死亡 / 错过末班车只带走 25%</div>
      <p class="save-note">M1 原型 · 金币仅本次会话累计，暂不存档</p>
      <button class="btn" type="button">进入街道</button>`, onGo);
  }

  result(win, s, onGo) {
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    this.card(`
      <h1>${win ? '撤离成功' : '<span class="r">未能撤离</span>'}</h1>
      <p>${s.reason === 'missed' ? '错过末班车' : win ? '赶上撤离车，金币全部带走' : '倒在街头'} · ${Math.floor(s.time ?? 0)} 秒</p>
      <div class="stats"><div><b>${s.loot ?? 0}</b>搜刮金币</div><div><b>${s.carried ?? (win ? s.loot ?? 0 : Math.floor((s.loot ?? 0) * 0.25))}</b>带出 ${win ? '100%' : '25%（向下取整）'}</div><div><b>${s.bank ?? 0}</b>会话金币</div></div>
      <p class="combat-stats">开箱 ${s.opened ?? 0} · 击倒 ${s.kills} · 命中 ${acc}% · 剩余血量 ${s.hp}</p>
      <p class="save-note">暂不存档 · 会话金币刷新页面即清零</p>
      <button class="btn" type="button">再来一局</button>`, onGo);
  }
}
