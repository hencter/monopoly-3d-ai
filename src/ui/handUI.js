// CSS 扇形手牌 + 出牌时 HUD 3D 全息特效
import { ITEMS, PLAYABLE_ITEMS, PASSIVE_ITEMS } from '../data/tiles.js';

export const HAND_ITEMS = [
  'remote', 'boost',
  ...PASSIVE_ITEMS,
  ...PLAYABLE_ITEMS.filter(i => !PASSIVE_ITEMS.includes(i)),
];

const CARD_IMG = {
  remote: '/textures/cards/remote.png',
  boost: '/textures/cards/boost.png',
  rentFree: '/textures/cards/rentFree.png',
  permit: '/textures/cards/permit.png',
  charter: '/textures/cards/charter.png',
  demolish: '/textures/cards/demolish.png',
  equalize: '/textures/cards/equalize.png',
  rob: '/textures/cards/rob.png',
  swap: '/textures/cards/swap.png',
  hibernate: '/textures/cards/hibernate.png',
  intel: '/textures/cards/intel.png',
};

function ensureRoot() {
  let root = document.getElementById('hand-fan');
  if (!root) {
    root = document.createElement('div');
    root.id = 'hand-fan';
    root.className = 'hidden';
    document.body.appendChild(root);
  }
  let fx = document.getElementById('card-cast-fx');
  if (!fx) {
    fx = document.createElement('div');
    fx.id = 'card-cast-fx';
    fx.className = 'hidden';
    fx.innerHTML = `
      <div class="cast-stage">
        <div class="cast-beam"></div>
        <div class="cast-ring cast-ring-a"></div>
        <div class="cast-ring cast-ring-b"></div>
        <div class="cast-sparkles"></div>
        <div class="cast-card-wrap">
          <img class="cast-card-img" alt="" />
          <div class="cast-card-glow"></div>
        </div>
        <div class="cast-title"></div>
      </div>`;
    document.body.appendChild(fx);
  }
  let pop = document.getElementById('hand-card-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'hand-card-pop';
    pop.className = 'hidden';
    pop.setAttribute('role', 'tooltip');
    document.body.appendChild(pop);
  }
  return { root, fx, pop };
}

/**
 * CSS 手牌控制器（全局单例）
 */
class HandUI {
  constructor() {
    this._onUse = null;
    this._mode = 'endTurn';
    this._busy = false;
    this._items = null;
    this._popHideT = null;
  }

  /** 手牌悬停信息卡（大号 UI，不用浏览器原生 title） */
  showCardPop(el, info, meta) {
    const { pop } = ensureRoot();
    clearTimeout(this._popHideT);
    const status = info.canClick
      ? { cls: 'ok', text: '点击打出' }
      : info.isPassive
        ? { cls: 'stock', text: '库存卡 · 在建设/公司等面板消耗' }
        : { cls: 'off', text: '当前阶段不可用' };
    pop.innerHTML = `
      <div class="hcp-inner">
        <div class="hcp-thumb-wrap">
          <img class="hcp-thumb" src="${CARD_IMG[info.item] || ''}" alt="" draggable="false" />
          <div class="hcp-thumb-fallback">${meta.icon || '🃏'}</div>
        </div>
        <div class="hcp-main">
          <div class="hcp-title">
            <span class="hcp-icon">${meta.icon || '🃏'}</span>
            <span class="hcp-name">${meta.name || info.item}</span>
            ${info.n > 1 ? `<span class="hcp-cnt">×${info.n}</span>` : ''}
          </div>
          <p class="hcp-desc">${meta.desc || '暂无说明'}</p>
          <div class="hcp-status ${status.cls}">${status.text}</div>
        </div>
      </div>
      <div class="hcp-arrow"></div>`;
    const thumb = pop.querySelector('.hcp-thumb');
    if (thumb) {
      thumb.onerror = () => {
        thumb.style.display = 'none';
        pop.classList.add('no-thumb');
      };
    }
    pop.classList.remove('hidden');
    // 定位：卡牌上方居中，避开屏幕边缘
    const r = el.getBoundingClientRect();
    const pw = pop.offsetWidth || 280;
    const ph = pop.offsetHeight || 120;
    let left = r.left + r.width / 2 - pw / 2;
    let top = r.top - ph - 14;
    left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
    if (top < 10) {
      // 上方不够则放到卡牌侧上方
      top = Math.max(10, r.top - 8);
      left = r.right + 10;
      if (left + pw > window.innerWidth - 10) left = r.left - pw - 10;
      pop.classList.add('side');
    } else {
      pop.classList.remove('side');
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.classList.add('show');
  }

  hideCardPop(delay = 80) {
    const pop = document.getElementById('hand-card-pop');
    if (!pop) return;
    clearTimeout(this._popHideT);
    this._popHideT = setTimeout(() => {
      pop.classList.remove('show');
      pop.classList.add('hidden');
    }, delay);
  }

  /**
   * @param {object} items
   * @param {{ mode?: string, interactive?: boolean, onUse?: (item:string)=>void|Promise<void> }} opts
   */
  setHand(items, opts = {}) {
    const { mode = 'endTurn', interactive = true, onUse = null } = opts;
    this._mode = mode;
    this._onUse = onUse;
    this._items = items;
    const { root } = ensureRoot();
    root.innerHTML = '';
    root.classList.remove('hidden');

    const list = [];
    for (const item of HAND_ITEMS) {
      const n = items?.[item] || 0;
      if (n <= 0) continue;
      const isPassive = PASSIVE_ITEMS.includes(item);
      const canClick = interactive && !isPassive && (
        (mode === 'roll' && (item === 'remote' || item === 'boost'))
        || (mode === 'endTurn' && PLAYABLE_ITEMS.includes(item))
        || (mode === 'all' && (PLAYABLE_ITEMS.includes(item) || item === 'remote' || item === 'boost'))
      );
      list.push({ item, n, canClick, isPassive });
    }

    if (!list.length) {
      root.classList.add('hidden');
      return;
    }

    const n = list.length;
    // 横向拉开：中心间距随数量变化，避免叠成一坨
    const gap = n <= 1 ? 0 : Math.min(92, Math.max(64, Math.floor(720 / (n - 1))));
    const totalW = (n - 1) * gap;
    const startX = -totalW / 2;
    // 轻微扇形角度（小，不挡命中）
    const rotMax = Math.min(18, Math.max(0, (n - 1) * 2.2));

    root.style.setProperty('--hand-n', String(n));

    list.forEach((info, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = startX + i * gap;
      const rot = -rotMax / 2 + t * rotMax;
      // 中间略高、两边略低，形成浅弧，不往下压操作台
      const arcY = -Math.sin(t * Math.PI) * 10;
      const meta = ITEMS[info.item] || { name: info.item, icon: '🃏', desc: '' };
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `hand-card${info.canClick ? ' is-playable' : ' is-locked'}${info.isPassive ? ' is-passive' : ''}`;
      el.style.setProperty('--x', `${x}px`);
      el.style.setProperty('--rot', `${rot}deg`);
      el.style.setProperty('--arc-y', `${arcY}px`);
      el.style.setProperty('--i', String(i));
      el.style.zIndex = String(20 + i);
      el.dataset.item = info.item;
      // 可出的牌始终可点；锁定牌 pointer-events 由 CSS 处理，避免挡住邻居
      el.disabled = !info.canClick || this._busy;
      el.setAttribute('aria-disabled', info.canClick ? 'false' : 'true');
      // 不用原生 title（字太小），改用手牌信息卡
      el.removeAttribute('title');
      el.innerHTML = `
        <img class="hand-card-face" src="${CARD_IMG[info.item] || ''}" alt="${meta.name}" draggable="false" />
        <div class="hand-card-fallback" aria-hidden="true">
          <span class="hf-icon">${meta.icon || '🃏'}</span>
          <span class="hf-name">${meta.name || info.item}</span>
        </div>
        ${info.n > 1 ? `<span class="hand-card-cnt">${info.n}</span>` : ''}
      `;
      const img = el.querySelector('.hand-card-face');
      if (img) {
        img.onerror = () => {
          img.style.display = 'none';
          el.classList.add('no-img');
        };
      }
      el.addEventListener('pointerenter', () => {
        el.style.zIndex = '90';
        this.showCardPop(el, info, meta);
      });
      el.addEventListener('pointerleave', () => {
        if (!el.matches(':focus-visible')) el.style.zIndex = String(20 + i);
        this.hideCardPop();
      });
      el.addEventListener('focus', () => {
        el.style.zIndex = '90';
        this.showCardPop(el, info, meta);
      });
      el.addEventListener('blur', () => {
        el.style.zIndex = String(20 + i);
        this.hideCardPop();
      });
      if (info.canClick) {
        el.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.hideCardPop(0);
          this._click(info.item, el);
        };
      }
      root.appendChild(el);
    });
  }

  clear() {
    this.hideCardPop(0);
    const root = document.getElementById('hand-fan');
    if (root) {
      root.innerHTML = '';
      root.classList.add('hidden');
    }
    this._onUse = null;
    this._busy = false;
  }

  async _click(item, el) {
    if (this._busy || !this._onUse) return;
    this._busy = true;
    // 锁定全部手牌，避免连点
    document.querySelectorAll('#hand-fan .hand-card').forEach(b => { b.disabled = true; });
    try {
      await this.playCastFx(item, el);
      await this._onUse(item);
    } finally {
      this._busy = false;
      // 调用方会 refresh；若未刷新则恢复
      if (this._items) this.setHand(this._items, { mode: this._mode, interactive: !!this._onUse, onUse: this._onUse });
    }
  }

  /**
   * 出牌 HUD 3D 特效：卡牌飞到屏幕中央翻转发光（全员可见）
   * @param {string} item
   * @param {HTMLElement|null} [fromEl]
   * @param {{ playerName?: string, playerColor?: string }} [opts]
   */
  playCastFx(item, fromEl = null, opts = {}) {
    return new Promise((resolve) => {
      const { fx } = ensureRoot();
      const meta = ITEMS[item] || { name: item, icon: '🃏' };
      const img = fx.querySelector('.cast-card-img');
      const title = fx.querySelector('.cast-title');
      const sparkles = fx.querySelector('.cast-sparkles');
      const wrap = fx.querySelector('.cast-card-wrap');

      if (img) {
        img.src = CARD_IMG[item] || '';
        img.alt = meta.name;
        img.onerror = () => { img.style.opacity = '0'; };
        img.style.opacity = '1';
      }
      if (title) {
        const who = opts.playerName
          ? `<span class="cast-who" style="color:${opts.playerColor || '#f0c75e'}">${opts.playerName}</span> 打出 `
          : '';
        title.innerHTML = `${who}${meta.icon || ''} ${meta.name}`;
      }
      if (sparkles) {
        sparkles.innerHTML = '';
        for (let i = 0; i < 18; i++) {
          const s = document.createElement('span');
          s.className = 'cast-spark';
          const a = (i / 18) * Math.PI * 2;
          s.style.setProperty('--dx', `${Math.cos(a) * (80 + (i % 3) * 40)}px`);
          s.style.setProperty('--dy', `${Math.sin(a) * (60 + (i % 4) * 30)}px`);
          s.style.animationDelay = `${(i % 6) * 0.04}s`;
          sparkles.appendChild(s);
        }
      }

      // 起点：从手牌位置飞入
      if (fromEl && wrap) {
        const r = fromEl.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = cx - window.innerWidth / 2;
        const dy = cy - window.innerHeight / 2;
        wrap.style.setProperty('--from-x', `${dx}px`);
        wrap.style.setProperty('--from-y', `${dy}px`);
      } else if (wrap) {
        wrap.style.setProperty('--from-x', '0px');
        wrap.style.setProperty('--from-y', '120px');
      }

      fx.classList.remove('hidden');
      fx.classList.remove('cast-out');
      // 强制重排再播
      void fx.offsetWidth;
      fx.classList.add('cast-play');

      const done = () => {
        fx.classList.remove('cast-play');
        fx.classList.add('hidden');
        resolve();
      };
      // 与 CSS cast-play 时长对齐（约 2.4s，中段定格展示）
      setTimeout(done, 2450);
    });
  }
}

export const handUI = new HandUI();

/** 兼容旧预加载接口（浏览器预热卡面图；Node 无 Image 则跳过） */
export function preloadCardTextures() {
  if (typeof Image === 'undefined') return Promise.resolve();
  return Promise.all(
    Object.values(CARD_IMG).map(
      (src) => new Promise((res) => {
        const img = new Image();
        img.onload = img.onerror = () => res();
        img.src = src;
      }),
    ),
  );
}
