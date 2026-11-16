import * as THREE from 'three';
import { TUNE } from '../game/round.js';
import { WEAPONS, buildWeapon, UPGRADE_COSTS } from '../game/weapons.js';
import { SHOP_PRICES } from '../game/profile.js';
import { gunIcon } from '../actor/guns.js';

const $ = (s, r = document) => r.querySelector(s);
const _p = new THREE.Vector3();

export class Hud {
  constructor() {
    this.el = $('#hud');
    this.hp = $('.hp', this.el);
    this.clock = $('.clock', this.el);
    this.kills = $('.kills b', this.el);
    this.coins = $('.coins b', this.el);
    this.notice = $('.notice', this.el);
    this.ammo = $('.ammo b', this.el);
    this.ammoMax = $('.ammo', this.el);
    this.reload = $('.reload', this.el);
    this.gunTag = $('.gun-tag', this.el);
    this.cross = $('.cross', this.el);
    this.hurtEl = $('#hurt');
    this.pauseButton = $('.pause', this.el);
    this.interaction = $('.interaction', this.el);
    this.buffs = $('.buffs', this.el);
    this.buffEdge = $('.buff-edge', this.el);
    this.threatBox = $('.threats', this.el);
    this.threatEls = Array.from({ length: 4 }, () => this.threatBox.appendChild(Object.assign(document.createElement('div'), { className: 'threat' })));
    this.coinBox = $('.coins', this.el);
    this.floatEls = Array.from({ length: 8 }, () => {
      const el = $('.floaters', this.el).appendChild(Object.assign(document.createElement('div'), { className: 'floater' }));
      el.style.opacity = 0;
      return { el, at: new THREE.Vector3(), t: 0, life: 0 };
    });
    this.floatI = 0;
    this.panel = $('#panel');
    this.hurtT = 0;
    this.last = {};
    this.selectedWeapon = 'rifle';
    this.tutorialSeen = false;
    try { this.tutorialSeen = localStorage.getItem('block-zombies:tutorial-seen-v2') === '1'; } catch { /* Private browsing can disable storage. */ }
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
    const day = round.day ?? this.profile?.currentDay ?? 1;
    const wave = Math.min((round.waveIndex ?? 0) + 1, round.waveCount ?? 1);
    const clockKey = `${round.mode}:${day}:${wave}/${round.waveCount ?? 1}`;
    this.set('clock', clockKey, () => {
      this.clock.textContent = `${round.mode === 'challenge' ? '金币挑战' : `Day ${day}`} · 波 ${wave}/${round.waveCount ?? 1}`;
      this.clock.classList.remove('hot');
    });
    this.set('kills', round.kills, (v) => (this.kills.textContent = v));
    const notice = round.noticeT > 0 ? (round.notice ?? round.waveNotice ?? '') : '';
    this.set('notice', notice, (v) => { if (this.notice) { this.notice.textContent = v; this.notice.hidden = !v; } });
    const wallet = this.profile?.coins ?? round.bank ?? 0;
    this.set('wallet', wallet, (v) => { if (this.coins) this.coins.textContent = v; });
    this.set('gun', `${round.weapon?.id}:${round.weapon?.level}`, () => { if (this.gunTag) this.gunTag.innerHTML = gunIcon(round.weapon.id, round.weapon.level); });
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
      this.interaction.hidden = true;
    }
    const names = { frenzy: '狂热', pierce: '穿甲', blast: '爆裂', sprint: '疾走', shield: '墨盾' };
    const active = Object.entries(names).filter(([key]) => round.buffTimers?.[key] > 0).slice(0, 2);
    this.buffs.textContent = active.map(([key, name]) => `${name} ${Math.ceil(round.buffTimers[key])}秒`).join(' · ');
    this.buffs.hidden = this.buffEdge.hidden = active.length === 0;
  }

  hurt() { this.hurtT = 0.45; }

  /** Reward text that rises from a point in the world. */
  floater(text, at, big = false) {
    const f = this.floatEls[this.floatI++ % this.floatEls.length];
    f.el.textContent = text;
    f.el.classList.toggle('big', big);
    f.at.copy(at);
    f.at.y = Math.max(f.at.y, 0.9) + 0.5;
    f.t = 0;
    f.life = big ? 1.5 : 1.0;
    if (this.coinBox) {
      this.coinBox.classList.remove('bump');
      void this.coinBox.offsetWidth;
      this.coinBox.classList.add('bump');
    }
  }

  floaters(camera, W, H, dt) {
    for (const f of this.floatEls) {
      if (f.life <= 0) continue;
      f.t += dt;
      if (f.t >= f.life) { f.life = 0; f.el.style.opacity = 0; continue; }
      const k = f.t / f.life;
      const p = _p.copy(f.at).setY(f.at.y + (1 - (1 - k) ** 2) * 0.9).project(camera);
      if (p.z > 1) { f.el.style.opacity = 0; continue; }
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.6 : 1.2 - Math.min(1, (k - 0.12) / 0.2) * 0.2;
      f.el.style.opacity = k > 0.7 ? ((1 - k) / 0.3).toFixed(2) : 1;
      f.el.style.transform = `translate(${((p.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
    }
  }

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
      const shotgunLocked = weapon.id === 'shotgun' && !owned && (this.profile.completedDay ?? 0) < 2;
      const remaining = Math.max(0, price - this.profile.coins);
      return `<article class="weapon-product">
        <div class="weapon-head"><h2>${weapon.name} <span class="weapon-level">Lv.${level}</span></h2>${gunIcon(weapon.id, level)}</div><p>${weapon.description}</p>
        <p class="weapon-stats">${stats(current)}</p>
        ${owned ? next ? `<p class="weapon-next">Lv.${level + 1}：${stats(next)}</p>
          <button class="shop-upgrade" type="button" data-weapon="${weapon.id}" data-level="${level}" ${this.profile.coins < upgradePrice ? 'disabled' : ''}>升级 Lv.${level + 1} · ${upgradePrice} 金币${this.profile.coins < upgradePrice ? `（还差 ${upgradePrice - this.profile.coins}）` : ''}</button>` : '<p class="weapon-next">已满级 · 永久保留</p>' : ''}
        <p class="weapon-price">${price === 0 ? '免费 · 已拥有' : owned ? '已拥有' : `${price} 金币`}</p>
        ${owned ? `<button class="weapon-choice" type="button" data-weapon="${weapon.id}" aria-pressed="${this.selectedWeapon === weapon.id}">${this.selectedWeapon === weapon.id ? '已选择' : '选择装备'}</button>` : `<div class="shop-actions">
          <button class="shop-buy" type="button" data-weapon="${weapon.id}" ${shotgunLocked || remaining ? 'disabled' : ''}>${shotgunLocked ? 'Day 2 完成后解锁' : remaining ? `还差 ${remaining} 金币` : `购买 · ${price} 金币`}</button>
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
    const start = (id, trial, mode = 'campaign') => {
      if (started || (!trial && mode === 'campaign' && (this.profile.campaignComplete === true || (this.profile.completedDay ?? 0) >= 2))) return;
      started = true;
      this.panel.hidden = true;
      this.tutorialSeen = true;
      try { localStorage.setItem('block-zombies:tutorial-seen-v2', '1'); } catch { /* Keep the in-memory flag for this session. */ }
      onGo(id, { trial, mode });
    };
    const completed = this.profile.campaignComplete === true || this.profile.completedDay >= 2;
    const day = Math.min((this.profile.completedDay ?? 0) + 1, 2);
    this.card(`
      <div class="shop-heading"><h1>方块<span class="r">尸潮</span></h1><p class="wallet">存款 <b>${this.profile.coins}</b> 金币</p></div>
      ${this.tutorialSeen ? '' : `<div class="rules tutorial">
        <span class="touch-hint">左侧移动 · 右侧上下左右瞄准 · 按住开火也能拖动瞄准</span><span class="desktop-hint">WASD 移动 · 鼠标上下左右瞄准 · 左键开火</span><br>
        击倒敌人直接获得金币；特殊金币包会自动拾取<br>
        清除全部波次即可完成挑战；死亡时本局已赚金币仍会保留
      </div>`}
      ${this.weaponChoices()}
      ${this.profile.owns('shotgun') ? '' : '<p class="trial-note">霰弹枪可免费试用：固定 Lv.1，本局无进度、无奖励。</p>'}
      ${this.profile.persistent ? '<p class="save-note">金币、已购武器和永久等级自动保存在当前浏览器</p>' : this.storageWarning()}
      <button class="shop-challenge" type="button">金币挑战 · 可重复 · 通关共 150 金币</button>
      <button class="btn" type="button" ${completed ? 'disabled' : ''}>${completed ? 'Day 1–2 已完成，后续关卡制作中' : `挑战 Day ${day}`}</button>`, () => start(this.selectedWeapon, false));
    $('.card', this.panel).classList.add('shop-card');
    this.panel.querySelector('.shop-challenge').addEventListener('click', () => start(this.selectedWeapon, false, 'challenge'));
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
    const income = round.income ?? { kills: 0, pickups: 0, completion: 0 };
    const day = round.day ?? this.profile?.currentDay ?? 1;
    this.card(`
      <h1>暂停</h1>
      <p>${round.weapon.name} · Lv.${round.weapon.level}</p>
      <p>${round.mode === 'challenge' ? '金币挑战' : `Day ${day}`} · 波 ${(round.waveIndex ?? 0) + 1}/${round.waveCount ?? 1}${round.trial ? ' · 试用局（收益为 0）' : ''}</p>
      <div class="stats"><div><b>${round.kills}</b>击倒</div><div><b>${income.kills ?? 0}</b>击倒收入</div><div><b>${income.pickups ?? 0}</b>拾取收入</div><div><b>${this.profile?.coins ?? round.bank ?? 0}</b>当前存款</div></div>
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
      <h1>${win ? '挑战完成' : '<span class="r">挑战失败</span>'}</h1>
      <p>${s.mode === 'challenge' ? '金币挑战' : `Day ${s.day ?? 1}`} · ${s.reason === 'cleared' ? '清除全部波次' : '倒在街头'} · ${Math.floor(s.time ?? 0)} 秒</p>
      <div class="stats"><div><b>${s.income?.kills ?? 0}</b>击倒收入</div><div><b>${s.income?.pickups ?? 0}</b>拾取收入</div><div><b>${s.income?.completion ?? 0}</b>完成收入</div><div><b>${s.carried ?? 0}</b>本局合计</div><div><b>${s.bank ?? this.profile?.coins ?? 0}</b>当前存款</div></div>
      <p class="combat-stats">击倒 ${s.kills} · 命中 ${acc}% · 剩余血量 ${s.hp}${s.trial ? ' · 试用局' : ''}</p>
      ${s.trial ? '<p class="trial-note">试用局不计进度或奖励。</p>' : '<p class="trial-note">本局已计入存款，无需再次领取。</p>'}
      ${this.storageWarning()}
      <button class="btn" type="button">返回商店</button>`, () => onGo());
  }
}
