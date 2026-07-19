// 全屏入股投资：公司卡片网格，公允价即时成交
import {
  INDUSTRIES, INDUSTRY_STATES, formatMoney, COMPANY_MAX_LEVEL,
} from '../data/tiles.js';

/**
 * @param {import('../core/state.js').GameState} game
 * @param {object} me 当前玩家
 * @param {() => void} onChange
 * @param {{ log?: Function, toast?: Function }} ui
 * @param {{ invest?: (founderId:number, n:number, fromFloat:boolean)=>void }} [hooks]
 * @param {{ tradeable?: boolean }} [opts]
 */
export function openInvestMarket(game, me, onChange, ui = {}, hooks = {}, opts = {}) {
  const tradeable = opts.tradeable !== false;
  const root = document.getElementById('invest-market');
  const grid = document.getElementById('invest-grid');
  const cashEl = document.getElementById('invest-cash');
  const closeBtn = document.getElementById('invest-close');
  const emptyEl = document.getElementById('invest-empty');
  if (!root || !grid) return { close: () => {}, refresh: () => {} };

  let closed = false;

  const destroy = () => {
    if (closed) return;
    closed = true;
    grid.innerHTML = '';
    root.classList.add('hidden');
    if (closeBtn) closeBtn.onclick = null;
  };

  /** 快捷档位：控制数量，避免一排按钮把卡片撑破 */
  const qtyOptions = (maxN) => {
    if (maxN <= 0) return [1];
    const set = new Set([1]);
    for (const n of [2, 5, 10, 20, 50]) {
      if (n < maxN) set.add(n);
    }
    set.add(maxN);
    return [...set].filter(n => n <= maxN).sort((a, b) => a - b).slice(0, 6);
  };

  const maxBuy = (founder, fromFloat) => {
    if (!tradeable || !me) return 0;
    const unit = game.companySharePrice(founder);
    if (unit <= 0) return 0;
    const byCash = Math.floor(me.money / unit);
    let room = 0;
    if (fromFloat) {
      room = founder.company?.ipo ? (founder.company.freeFloat || 0) : 0;
    } else {
      room = game.founderSellableShares?.(founder) || 0;
    }
    // 逐步试探最大可买 n
    let n = Math.min(byCash, room);
    while (n > 0 && !game.canInvestCompany(me, founder, n, fromFloat)) n--;
    return Math.max(0, n);
  };

  const refreshCash = () => {
    if (!cashEl) return;
    cashEl.textContent = tradeable
      ? `现金 ${formatMoney(me.money)} · 公允价即时成交`
      : `观战 · 仅可查看 · 参考现金 ${formatMoney(me?.money || 0)}`;
  };

  const targets = () => game.players.filter(p => p.id !== me.id && !p.bankrupt && p.company);

  const renderGrid = () => {
    if (closed) return;
    grid.innerHTML = '';
    refreshCash();
    const list = targets();
    if (emptyEl) emptyEl.classList.toggle('hidden', list.length > 0);
    if (!list.length) {
      if (emptyEl) {
        emptyEl.innerHTML = `
          <div class="invest-empty-inner">
            <div class="ie-icon">🏢</div>
            <h3>场上暂无其他公司</h3>
            <p>其他玩家创办公司后，可在此以公允价入股或从 IPO 公众池买入。</p>
          </div>`;
      }
      return;
    }

    for (const f of list) {
      const c = f.company;
      const ind = INDUSTRIES[c.industry] || { icon: '🏢', name: '公司', css: '#888' };
      const st = INDUSTRY_STATES[game.industry?.[c.industry] ?? 1] || INDUSTRY_STATES[1];
      const unit = game.companySharePrice(f);
      const value = game.companyValue?.(f) || 0;
      const pool = game.companyProfitPool?.(f) || 0;
      const sellable = game.founderSellableShares?.(f) || 0;
      const floatN = c.freeFloat || 0;
      const myHold = c.holders?.[me.id] || 0;
      const myDiv = game.companyInvestorDividend?.(me, f) || 0;
      const maxPriv = maxBuy(f, false);
      const maxFloat = maxBuy(f, true);
      const qtyMax = Math.max(maxPriv, maxFloat, 1);
      const optsN = qtyOptions(qtyMax);
      const canPriv = tradeable && maxPriv > 0;
      const canFloat = tradeable && maxFloat > 0;

      const card = document.createElement('div');
      card.className = 'invest-card';
      card.dataset.fid = String(f.id);
      card.dataset.qty = '1';
      card.style.setProperty('--ind', ind.css || '#6eb0ff');
      card.innerHTML = `
        <div class="invest-card-hero">
          <div class="invest-card-icon" style="border-color:${ind.css}88">${ind.icon}</div>
          <div class="invest-card-title">
            <h3>${f.name}<span class="co-badge lv">Lv${c.level}/${COMPANY_MAX_LEVEL}</span>
              ${c.ipo ? '<span class="co-badge ipo">IPO</span>' : '<span class="co-badge private">未上市</span>'}
            </h3>
            <div class="invest-card-sub">${ind.icon} ${ind.name} · 景气 ${st.icon}${st.name}</div>
          </div>
          <div class="invest-card-price">${formatMoney(unit)}<small>/股</small></div>
        </div>
        <div class="invest-kpi">
          <div><span class="k">估值</span><b>${formatMoney(value)}</b></div>
          <div><span class="k">分红池</span><b>${formatMoney(pool)}/回</b></div>
          <div><span class="k">你持有</span><b class="mine">${myHold} 股</b></div>
          <div><span class="k">你股息</span><b class="gold">${formatMoney(myDiv)}/回</b></div>
        </div>
        <div class="invest-card-meta">
          可购创始人股 <b>${sellable}</b>
          · 公众池 <b>${floatN}</b>
          · 总股本 ${c.totalShares || 100}
          ${myHold > 0 ? ` · 已入股分红参考 <b style="color:var(--gold)">${formatMoney(myDiv)}</b>/回合` : ''}
        </div>
        ${tradeable ? `
        <div class="invest-card-qty stock-card-qty">
          <span class="qty-label">股数</span>
          <div class="qty-stepper">
            <button type="button" class="qty-step" data-qty-step="-1" aria-label="减少">−</button>
            <span class="qty-display" data-qty-display>1</span>
            <button type="button" class="qty-step" data-qty-step="1" aria-label="增加">+</button>
          </div>
          <div class="qty-btns" role="group" aria-label="快捷股数">
            ${optsN.map(n => {
              const isMax = n === qtyMax && qtyMax > 1;
              return `<button type="button" class="qty-btn${n === 1 ? ' active' : ''}" data-qty-val="${n}" title="${isMax ? `全部 ${n} 股` : `${n} 股`}">${isMax ? `满` : n}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="invest-card-actions">
          <button type="button" class="buy-priv" data-priv ${canPriv ? '' : 'disabled'}>
            <span class="btn-main">向创始人入股</span>
            <span class="btn-sub" data-priv-sub>1 股</span>
          </button>
          <button type="button" class="buy-float" data-float ${canFloat ? '' : 'disabled'}>
            <span class="btn-main">公众池买入</span>
            <span class="btn-sub" data-float-sub>1 股</span>
          </button>
        </div>` : `
        <div class="invest-readonly-tip">👁 观战中 · 不可交易</div>
        `}`;
      grid.appendChild(card);

      if (!tradeable) continue;

      const privBtn = card.querySelector('[data-priv]');
      const floatBtn = card.querySelector('[data-float]');
      const privSub = card.querySelector('[data-priv-sub]');
      const floatSub = card.querySelector('[data-float-sub]');
      const qtyDisplay = card.querySelector('[data-qty-display]');
      const qtyBtns = card.querySelectorAll('.qty-btn');
      const stepBtns = card.querySelectorAll('.qty-step');

      const clampQty = (n) => Math.max(1, Math.min(qtyMax, n | 0));
      const sync = () => {
        let n = clampQty(parseInt(card.dataset.qty, 10) || 1);
        card.dataset.qty = String(n);
        if (qtyDisplay) qtyDisplay.textContent = String(n);
        qtyBtns.forEach(b => b.classList.toggle('active', +b.dataset.qtyVal === n));
        stepBtns.forEach(b => {
          const d = +b.dataset.qtyStep;
          b.disabled = (d < 0 && n <= 1) || (d > 0 && n >= qtyMax);
        });
        // 主文案固定，副行显示股数+金额，避免长句撑破卡片
        if (privBtn) {
          const bn = Math.min(n, maxPriv || 1);
          if (privSub) {
            privSub.textContent = maxPriv > 0
              ? `${bn} 股 · ${formatMoney(unit * bn)}`
              : '暂不可购';
          }
          privBtn.disabled = maxPriv <= 0 || !game.canInvestCompany(me, f, bn, false);
          privBtn.title = maxPriv > 0
            ? `向创始人入股 ${bn} 股，约 ${formatMoney(unit * bn)}`
            : '无法向创始人入股';
        }
        if (floatBtn) {
          const bn = Math.min(n, maxFloat || 1);
          if (floatSub) {
            floatSub.textContent = maxFloat > 0
              ? `${bn} 股 · ${formatMoney(unit * bn)}`
              : (c.ipo ? '池内不足' : '未 IPO');
          }
          floatBtn.disabled = maxFloat <= 0 || !game.canInvestCompany(me, f, bn, true);
          floatBtn.title = maxFloat > 0
            ? `公众池买入 ${bn} 股，约 ${formatMoney(unit * bn)}`
            : (c.ipo ? '公众池不足' : '公司尚未 IPO');
        }
      };

      qtyBtns.forEach(b => {
        b.onclick = () => { card.dataset.qty = String(clampQty(+b.dataset.qtyVal)); sync(); };
      });
      stepBtns.forEach(b => {
        b.onclick = () => {
          const cur = clampQty(parseInt(card.dataset.qty, 10) || 1);
          card.dataset.qty = String(clampQty(cur + (+b.dataset.qtyStep || 0)));
          sync();
        };
      });

      const doInvest = (fromFloat) => {
        let n = clampQty(parseInt(card.dataset.qty, 10) || 1);
        n = Math.min(n, fromFloat ? maxFloat : maxPriv);
        if (n <= 0) {
          ui.toast?.(fromFloat ? '公众池不足或现金不够' : '无法入股');
          return;
        }
        if (hooks.invest) {
          hooks.invest(f.id, n, fromFloat);
          setTimeout(() => { if (!closed) renderGrid(); }, 80);
          return;
        }
        const r = game.investCompany(me, f, n, fromFloat);
        if (!r) {
          ui.toast?.(fromFloat ? '公众池不足或现金不够' : '无法入股');
          return;
        }
        ui.log?.(
          fromFloat
            ? `${me.name} 从公众池买入 ${f.name} 公司 ${r.n} 股（${formatMoney(r.cost)}）`
            : `${me.name} 向 ${f.name} 公司入股 ${r.n} 股（${formatMoney(r.cost)}）`,
          'good',
        );
        onChange?.();
        renderGrid();
      };

      if (privBtn) privBtn.onclick = () => doInvest(false);
      if (floatBtn) floatBtn.onclick = () => doInvest(true);
      sync();
    }
  };

  root.classList.remove('hidden');
  root.classList.toggle('readonly', !tradeable);
  if (closeBtn) {
    closeBtn.onclick = destroy;
  }
  const onKey = (e) => {
    if (e.key === 'Escape') {
      destroy();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  renderGrid();

  return {
    close: destroy,
    refresh: () => { if (!closed) renderGrid(); },
  };
}
