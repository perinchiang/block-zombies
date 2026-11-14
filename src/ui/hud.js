import { TUNE } from '../game/round.js';
import { WEAPONS } from '../game/weapons.js';

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
    this.hurtEl = $('#hurt');
    this.pauseButton = $('.pause', this.el);
    this.interaction = $('.interaction', this.el);
    this.buffs = $('.buffs', this.el);
    this.buffEdge = $('.buff-edge', this.el);
    this.threatBox = $('.threats', this.el);
    this.threatEls = Array.from({ length: 4 }, () => this.threatBox.appendChild(Object.assign(document.createElement('div'), { className: 'threat' })));
    this.panel = $('#panel');
    this.hurtT = 0;
    this.last = {};
    this.selectedWeapon = 'rifle';
    this.tutorialSeen = false;
    try { this.tutorialSeen = localStorage.getItem('block-zombies:tutorial-seen') === '1'; } catch { /* Private browsing can disable storage. */ }
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
    this.set('ammoMax', round.weapon?.mag ?? TUNE.mag, (v) => (this.ammoMax.lastChild.textContent = `/${v}`));
    this.set('ammo', round.ammo, (v) => (this.ammo.textContent = Math.max(0, v)));
    this.set('reload', round.reloadT > 0, (v) => (this.reload.hidden = !v));
    if (crossXY) this.cross.style.transform = `translate(${crossXY.x}px, ${crossXY.y}px)${round.target ? ' rotate(45deg) scale(0.85)' : ''}`;
    this.set('lock', !!round.target, (v) => this.cross.classList.toggle('lock', v));
    if (this.hurtT > 0) { this.hurtT -= dt; this.hurtEl.style.opacity = Math.max(0, this.hurtT / 0.45).toFixed(2); }
  }

  updateMission(round) {
    const h = round.hero.root.position;
    const crate = round.nearbyCrate;
    const atEvac = round.evacOpen && round.evac && Math.hypot(round.evac.x - h.x, round.evac.z - h.z) <= round.evac.radius;
    const opening = crate && !crate.opened && crate.progress > 0;
    this.interaction.hidden = round.state !== 'play' || round.missed || (!atEvac && !opening);
    if (!this.interaction.hidden) {
      const duration = atEvac ? 5 : 1.5;
      $('progress', this.interaction).value = Math.max(0, Math.min(1, (atEvac ? round.extracting : crate.progress) / duration));
      $('progress', this.interaction).setAttribute('aria-label', atEvac ? '撤离进度' : '开箱进度');
    }
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

  card(html, onGo, keepOpen = false) {
    this.panel.innerHTML = `<div class="card">${html}</div>`;
    this.panel.hidden = false;
    const choices = this.panel.querySelectorAll('.weapon-choice');
    choices.forEach((choice) => choice.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedWeapon = choice.dataset.weapon;
      choices.forEach((button) => button.setAttribute('aria-pressed', String(button === choice)));
    }));
    const btn = $('.btn', this.panel);
    let used = false;
    const go = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (used || this.panel.hidden) return;
      used = !keepOpen;
      if (!keepOpen) this.panel.hidden = true;
      onGo();
    };
    btn.addEventListener('click', go, { once: !keepOpen });
    btn.addEventListener('touchend', go, { once: !keepOpen });
  }

  weaponChoices() {
    return `<div class="weapon-choices" role="group" aria-label="选择武器">${Object.values(WEAPONS).map((weapon) => `
      <button class="weapon-choice" type="button" data-weapon="${weapon.id}" aria-pressed="${this.selectedWeapon === weapon.id}">
        <strong>${weapon.name}</strong><span>${weapon.description}</span>
      </button>`).join('')}</div>`;
  }

  title(onGo) {
    this.card(`
      <h1>方块<span class="r">尸潮</span></h1>
      ${this.tutorialSeen ? '' : `<div class="rules tutorial">
        <span class="touch-hint">左侧移动 · 右侧拖动转向 · 按住开火</span><span class="desktop-hint">WASD 移动 · 鼠标转向/开火</span><br>
        靠近物资箱，停步停火 1.5 秒搜索<br>
        撤离车 90 秒到站，4 分钟离开；圈内坚持 5 秒<br>
        撤离带走全部金币，失败保留 25%
      </div>`}
      ${this.weaponChoices()}
      <button class="btn" type="button">进入街道</button>`, () => {
      this.tutorialSeen = true;
      try { localStorage.setItem('block-zombies:tutorial-seen', '1'); } catch { /* Keep the in-memory flag for this session. */ }
      onGo(this.selectedWeapon);
    });
  }

  pause(round, onResume) {
    const names = { frenzy: '狂热', pierce: '穿甲', blast: '爆裂', sprint: '疾走', shield: '墨盾' };
    const active = Object.entries(names).filter(([key]) => round.buffTimers[key] > 0);
    this.card(`
      <h1>暂停</h1>
      <p>本局物资 · ${round.weapon?.name ?? WEAPONS.rifle.name}</p>
      <div class="stats"><div><b>${round.loot}</b>携带金币</div><div><b>${round.opened} / ${round.crates.length}</b>已开物资箱</div></div>
      ${active.length ? `<p class="pause-buffs">${active.map(([key, name]) => `${name} · ${Math.ceil(round.buffTimers[key])} 秒`).join('　')}</p>` : ''}
      <p class="lock-hint" hidden aria-live="polite"></p>
      <button class="btn" type="button">继续游戏</button>`, onResume, true);
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', '游戏暂停');
    this.panel.querySelector('.btn').focus();
  }

  pauseLockHint() {
    const hint = $('.lock-hint', this.panel);
    if (!hint) return;
    hint.textContent = '鼠标尚未锁定，点击继续游戏';
    hint.hidden = false;
  }

  closePause() {
    this.panel.querySelector('.btn')?.blur();
    this.panel.hidden = true;
    this.panel.removeAttribute('role');
    this.panel.removeAttribute('aria-modal');
    this.panel.removeAttribute('aria-label');
    this.pauseButton.blur();
  }

  result(win, s, onGo) {
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    this.card(`
      <h1>${win ? '撤离成功' : '<span class="r">未能撤离</span>'}</h1>
      <p>${s.reason === 'missed' ? '错过末班车' : win ? '赶上撤离车，金币全部带走' : '倒在街头'} · ${Math.floor(s.time ?? 0)} 秒</p>
      <div class="stats"><div><b>${s.loot ?? 0}</b>搜刮金币</div><div><b>${s.carried ?? (win ? s.loot ?? 0 : Math.floor((s.loot ?? 0) * 0.25))}</b>带出 ${win ? '100%' : '25%（向下取整）'}</div><div><b>${s.bank ?? 0}</b>会话金币</div></div>
      <p class="combat-stats">开箱 ${s.opened ?? 0} · 击倒 ${s.kills} · 命中 ${acc}% · 剩余血量 ${s.hp}</p>
      <p class="save-note">暂不存档 · 会话金币刷新页面即清零</p>
      ${this.weaponChoices()}
      <button class="btn" type="button">再来一局</button>`, () => onGo(this.selectedWeapon));
  }
}
