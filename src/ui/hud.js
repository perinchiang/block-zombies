import { TUNE } from '../game/round.js';
import { WEAPONS, buildWeapon, UPGRADE_COSTS } from '../game/weapons.js';
import { SHOP_PRICES } from '../game/profile.js';

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
    const atEvac = round.evacOpen && round.evac && Math.hypot(round.evac.x - h.x, round.evac.z - h.z) <= round.evac.radius;
    this.interaction.hidden = round.state !== 'play' || round.missed || !atEvac;
    if (!this.interaction.hidden) {
      $('progress', this.interaction).value = Math.max(0, Math.min(1, round.extracting / 5));
      $('progress', this.interaction).setAttribute('aria-label', '撤离进度');
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
      if (this.profile && !this.profile.owns(choice.dataset.weapon)) return;
      this.selectedWeapon = choice.dataset.weapon;
      this.profile?.equip(this.selectedWeapon);
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
  }

  weaponChoices() {
    return `<div class="weapon-choices" role="group" aria-label="武器商店">${Object.values(WEAPONS).map((weapon) => {
      const owned = this.profile.owns(weapon.id);
      const level = owned ? this.profile.weaponLevel(weapon.id) : 1;
      const current = buildWeapon(weapon.id, level);
      const next = level < 4 ? buildWeapon(weapon.id, level + 1) : null;
      const upgradePrice = UPGRADE_COSTS[level];
      const stats = config => `伤害 ×${config.damageMultiplier} · 弹匣 ${config.mag} · 换弹 ${Number(config.reload.toFixed(4))}秒`;
      const price = SHOP_PRICES[weapon.id];
      const remaining = Math.max(0, price - this.profile.coins);
      return `<article class="weapon-product">
        <h2>${weapon.name} <span class="weapon-level">Lv.${level}</span></h2><p>${weapon.description}</p>
        <p class="weapon-stats">${stats(current)}</p>
        ${owned ? next ? `<p class="weapon-next">Lv.${level + 1}：${stats(next)}</p>
          <button class="shop-upgrade" type="button" data-weapon="${weapon.id}" data-level="${level}" ${this.profile.coins < upgradePrice ? 'disabled' : ''}>升级 Lv.${level + 1} · ${upgradePrice} 金币${this.profile.coins < upgradePrice ? `（还差 ${upgradePrice - this.profile.coins}）` : ''}</button>` : '<p class="weapon-next">已满级 · 永久保留</p>' : ''}
        <p class="weapon-price">${price === 0 ? '免费 · 已拥有' : owned ? '已拥有' : `${price} 金币`}</p>
        ${owned ? `<button class="weapon-choice" type="button" data-weapon="${weapon.id}" aria-pressed="${this.selectedWeapon === weapon.id}">${this.selectedWeapon === weapon.id ? '已选择' : '选择装备'}</button>` : `<div class="shop-actions">
          <button class="shop-buy" type="button" data-weapon="${weapon.id}" ${remaining ? 'disabled' : ''}>${remaining ? `还差 ${remaining} 金币` : `购买 · ${price} 金币`}</button>
          <button class="shop-trial" type="button" data-weapon="${weapon.id}">免费试用</button>
        </div>`}
      </article>`;
    }).join('')}</div>`;
  }

  storageWarning() {
    return this.profile?.persistent === false ? '<p class="save-note">存档不可用，刷新后进度会丢失</p>' : '';
  }

  title(onGo) {
    this.profile.refresh();
    this.selectedWeapon = this.profile.owns(this.profile.equipped) ? this.profile.equipped : 'rifle';
    let started = false;
    const start = (id, trial) => {
      if (started) return;
      started = true;
      this.panel.hidden = true;
      this.tutorialSeen = true;
      try { localStorage.setItem('block-zombies:tutorial-seen', '1'); } catch { /* Keep the in-memory flag for this session. */ }
      onGo(id, { trial });
    };
    this.card(`
      <div class="shop-heading"><h1>方块<span class="r">尸潮</span></h1><p class="wallet">存款 <b>${this.profile.coins}</b> 金币</p></div>
      ${this.tutorialSeen ? '' : `<div class="rules tutorial">
        <span class="touch-hint">左侧移动 · 右侧上下左右瞄准 · 按住开火也能拖动瞄准</span><span class="desktop-hint">WASD 移动 · 鼠标上下左右瞄准 · 左键开火</span><br>
        对准屏幕中心开火，无自动瞄准；远处移动目标需提前量<br>
        靠近自动开箱、收金币，移动开火也能拾取；红箱先击败恶魔<br>
        撤离车 90 秒到中央广场，4 分钟离开；车门旁累计登车 5 秒<br>
        撤离带走全部金币，失败保留 25%
      </div>`}
      ${this.weaponChoices()}
      ${this.profile.owns('shotgun') ? '' : '<p class="trial-note">免费试用固定 Lv.1，不能升级：整局收益为 0，撤离也不获得金币。</p>'}
      ${this.profile.persistent ? '<p class="save-note">金币、已购武器和永久等级自动保存在当前浏览器</p>' : this.storageWarning()}
      <button class="btn" type="button">进入街道</button>`, () => start(this.selectedWeapon, false));
    $('.card', this.panel).classList.add('shop-card');
    this.panel.querySelectorAll('.weapon-choice').forEach((button) => button.addEventListener('click', () => this.title(onGo)));
    this.panel.querySelectorAll('.shop-buy').forEach((button) => button.addEventListener('click', () => {
      if (started || this.panel.hidden || button.disabled) return;
      button.disabled = true;
      const id = button.dataset.weapon;
      this.profile.buy(id);
      if (this.profile.owns(id)) {
        this.profile.equip(id);
        this.selectedWeapon = id;
      }
      this.title(onGo);
    }));
    this.panel.querySelectorAll('.shop-upgrade').forEach((button) => button.addEventListener('click', () => {
      if (started || this.panel.hidden || button.disabled || !button.isConnected) return;
      button.disabled = true;
      const id = button.dataset.weapon;
      this.profile.refresh();
      // A stale card must not buy a different tier after another tab upgrades.
      if (this.profile.weaponLevel(id) === Number(button.dataset.level)) this.profile.upgrade(id);
      this.title(onGo);
    }));
    this.panel.querySelectorAll('.shop-trial').forEach((button) => button.addEventListener('click', () => start(button.dataset.weapon, true)));
  }

  pause(round, onResume) {
    const names = { frenzy: '狂热', pierce: '穿甲', blast: '爆裂', sprint: '疾走', shield: '墨盾' };
    const active = Object.entries(names).filter(([key]) => round.buffTimers[key] > 0);
    this.card(`
      <h1>暂停</h1>
      <p>本局物资 · ${round.weapon?.name ?? WEAPONS.rifle.name} · Lv.${round.weapon?.level ?? 1}${round.trial ? ' · 试用局（收益为 0）' : ''}</p>
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
      <p>${s.reason === 'missed' ? '错过末班车' : win ? (s.trial ? '赶上撤离车' : '赶上撤离车，金币全部带走') : '倒在街头'} · ${Math.floor(s.time ?? 0)} 秒</p>
      <div class="stats"><div><b>${s.loot ?? 0}</b>搜刮金币</div><div><b>${s.trial ? 0 : s.carried ?? (win ? s.loot ?? 0 : Math.floor((s.loot ?? 0) * 0.25))}</b>${s.trial ? '试用收益' : `带出 ${win ? '100%' : '25%（向下取整）'}`}</div><div><b>${this.profile?.coins ?? s.bank ?? 0}</b>存款</div></div>
      <p class="combat-stats">开箱 ${s.opened ?? 0} · 击倒 ${s.kills} · 命中 ${acc}% · 剩余血量 ${s.hp}</p>
      ${s.trial ? '<p class="trial-note">试用局整局收益为 0，搜刮金币不计入存款。</p>' : ''}
      ${this.storageWarning()}
      <button class="btn" type="button">返回商店</button>`, () => onGo());
  }
}
