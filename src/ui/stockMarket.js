// 全屏股市：lightweight-charts 真 K 线 + 公告轮播
// 观战只读：展示全场行情/持仓/公告，禁止买卖
import { createChart, CrosshairMode } from 'lightweight-charts';
import {
  INDUSTRIES, INDUSTRY_STATES, STOCK_INDUSTRIES,
  MAX_SHARES_PER_IND, MAX_MARKET_SHARES, MAX_SHORT_PER_IND, formatMoney,
} from '../data/tiles.js';

/**
 * @param {import('../core/state.js').GameState} game
 * @param {object} player 当前视角玩家（观战也用于「我的持仓」高亮）
 * @param {() => void} onChange
 * @param {{ log?: Function, toast?: Function }} ui
 * @param {{ buy?: Function, sell?: Function, openShort?: Function, coverShort?: Function }} [hooks]
 * @param {{ tradeable?: boolean, readOnly?: boolean }} [opts]
 */
export function openStockMarket(game, player, onChange, ui = {}, hooks = {}, opts = {}) {
  const marketOpen = game.isMarketOpen?.() !== false && game.marketOpen !== false;
  // 休市时强制只读成交
  const tradeable = opts.tradeable !== false && opts.readOnly !== true && marketOpen;

  const maxBuyable = (key) => {
    if (!tradeable || !player) return 0;
    if (typeof game.maxBuyableShares === 'function') return game.maxBuyableShares(player, key);
    if (!game.canTradeStock?.(player, key)) return 0;
    const hold = game.ensureStocks(player)[key] || 0;
    const room = Math.max(0, MAX_SHARES_PER_IND - hold);
    const mkt = Math.max(0, MAX_MARKET_SHARES - (game.totalShares?.(key) || 0));
    const price = game.stockPrice(key);
    if (price <= 0) return 0;
    return Math.max(0, Math.min(room, mkt, Math.floor(player.money / price)));
  };
  const maxSellable = (key) => {
    if (!tradeable || !player) return 0;
    return game.ensureStocks(player)[key] || 0;
  };
  const maxShortOpen = (key) => {
    if (!tradeable || !player) return 0;
    if (typeof game.maxOpenShort === 'function') return game.maxOpenShort(player, key);
    return 0;
  };
  const maxShortCover = (key) => {
    if (!tradeable || !player) return 0;
    if (typeof game.maxCoverShort === 'function') return game.maxCoverShort(player, key);
    return game.ensureShorts?.(player)?.[key] || player.shorts?.[key] || 0;
  };

  const qtyOptions = (maxN) => {
    if (maxN <= 0) return [1];
    const set = new Set([1]);
    for (const n of [2, 5, 10, 20]) if (maxN >= n) set.add(n);
    set.add(maxN);
    return [...set].filter(n => n <= maxN).sort((a, b) => a - b);
  };

  const root = document.getElementById('stock-market');
  const grid = document.getElementById('stock-grid');
  const cashEl = document.getElementById('stock-cash');
  const closeBtn = document.getElementById('stock-close');
  const track = document.getElementById('stock-news-track');
  if (!root || !grid) return;

  // 确保 K 线与公告可用（镜像状态也挂方法）
  for (const k of STOCK_INDUSTRIES) {
    try { game.getKline?.(k); } catch { /* */ }
  }
  try { game.pruneNewsBoard?.(); } catch { /* */ }

  root.classList.remove('hidden');
  root.classList.toggle('readonly', !tradeable);
  const charts = [];
  let newsTimer = null;
  let newsIdx = 0;
  let closed = false;
  let mountGen = 0; // 取消过期的异步挂载（频繁 refresh 时）

  const destroy = () => {
    if (closed) return;
    closed = true;
    if (newsTimer) clearInterval(newsTimer);
    for (const c of charts) {
      try { c.chart.remove(); } catch { /* */ }
      if (c.ro) c.ro.disconnect();
    }
    charts.length = 0;
    grid.innerHTML = '';
    if (track) track.innerHTML = '';
    root.classList.add('hidden');
    root.classList.remove('readonly', 'market-closed');
    if (closeBtn) closeBtn.onclick = null;
  };

  const refreshCash = () => {
    if (!cashEl) return;
    const meta = game.calendarMeta || {};
    const wd = meta.weekday ? `周${meta.weekday}` : '';
    if (!marketOpen) {
      cashEl.textContent = `🛑 休市 ${wd} · 现金 ${formatMoney(player?.money || 0)} · 不可买卖（周末）`;
      return;
    }
    if (tradeable) {
      cashEl.textContent = `现金 ${formatMoney(player?.money || 0)} · ${wd}开市 · 可交易`;
    } else {
      const name = player?.name ? `${player.name} · ` : '';
      cashEl.textContent = `👁 观战行情 · ${name}参考现金 ${formatMoney(player?.money || 0)} · 不可买卖`;
    }
  };

  // 休市横幅（插在标题栏下方）
  let banner = root.querySelector('.stock-closed-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'stock-closed-banner hidden';
    const head = root.querySelector('.stock-market-head');
    if (head) head.insertAdjacentElement('afterend', banner);
    else root.prepend(banner);
  }
  if (!marketOpen) {
    const wd = game.calendarMeta?.weekday || '末';
    banner.textContent = `🛑 股市休市（周${wd}）· 全员轮完 = 过 1 天 · 周一～五开市 · 仅可浏览行情`;
    banner.classList.remove('hidden');
    root.classList.add('market-closed');
  } else {
    banner.classList.add('hidden');
    root.classList.remove('market-closed');
  }

  const renderNews = () => {
    if (!track) return;
    let list = [];
    try {
      list = game.activeNewsBoard?.() || game.newsBoard || [];
    } catch {
      list = game.newsBoard || [];
    }
    track.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'stock-news-item active stock-news-empty';
      empty.textContent = '暂无有效公告 · 资讯卡 / 风口风险 / 行业快讯会显示在此';
      track.appendChild(empty);
      return;
    }
    list.forEach((n, i) => {
      const el = document.createElement('div');
      el.className = `stock-news-item${n.mode === 'up' ? ' up' : n.mode === 'down' ? ' down' : ''}${i === 0 ? ' active' : ''}`;
      const left = n.expireTurn != null ? Math.max(0, n.expireTurn - (game.turn || 0)) : '?';
      el.textContent = `${n.icon || '📢'} ${n.text}　·　剩余 ${left} 回合失效`;
      el.dataset.id = String(n.id);
      track.appendChild(el);
    });
    newsIdx = 0;
  };

  const rotateNews = () => {
    try { game.pruneNewsBoard?.(); } catch { /* */ }
    let list = [];
    try { list = game.activeNewsBoard?.() || []; } catch { list = game.newsBoard || []; }
    const nodes = [...track.querySelectorAll('.stock-news-item:not(.stock-news-empty)')];
    if (nodes.length !== list.length || list.some((n, i) => nodes[i]?.dataset.id !== String(n.id))) {
      renderNews();
      return;
    }
    if (nodes.length <= 1) return;
    nodes[newsIdx]?.classList.remove('active');
    newsIdx = (newsIdx + 1) % nodes.length;
    nodes[newsIdx]?.classList.add('active');
  };

  /** 清洗 K 线：唯一递增时间 + 合法 OHLC（库对脏数据会静默失败） */
  const sanitizeBars = (data) => {
    const raw = Array.isArray(data) ? data : [];
    const byTime = new Map();
    for (const b of raw) {
      if (!b) continue;
      let t = Number(b.time);
      if (!Number.isFinite(t)) continue;
      // 毫秒误存 → 秒
      if (t > 1e12) t = Math.floor(t / 1000);
      t = Math.floor(t);
      let open = Number(b.open);
      let high = Number(b.high);
      let low = Number(b.low);
      let close = Number(b.close);
      if (![open, high, low, close].every(Number.isFinite)) continue;
      open = Math.max(0.01, open);
      close = Math.max(0.01, close);
      high = Math.max(high, open, close);
      low = Math.min(low, open, close);
      low = Math.max(0.01, low);
      // 通天币整数过大时库仍可画；保留 2 位避免科学计数
      byTime.set(t, {
        time: t,
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
      });
    }
    return [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);
  };

  /** Canvas 兜底折线（库挂了也能看到走势） */
  const drawFallback = (el, bars) => {
    el.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.className = 'stock-fallback-canvas';
    const w = Math.max(el.clientWidth || 0, 200);
    const h = Math.max(el.clientHeight || 0, 120);
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx || !bars.length) {
      if (ctx) {
        ctx.fillStyle = '#8fa3c0';
        ctx.font = '24px sans-serif';
        ctx.fillText('暂无 K 线', 24, h);
      }
      return;
    }
    ctx.scale(2, 2);
    const pad = 8;
    const closes = bars.map(b => b.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = Math.max(1e-6, max - min);
    ctx.strokeStyle = 'rgba(80,120,180,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = pad + ((h - pad * 2) * i) / 2;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#26a69a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    bars.forEach((b, i) => {
      const x = pad + (i / Math.max(1, bars.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (b.close - min) / span) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  const mountChart = (el, data) => {
    if (!el || closed) return null;
    el.innerHTML = '';
    const bars = sanitizeBars(data);
    // 固定占位高度，避免 flex 压成 0
    if (!el.style.minHeight) el.style.minHeight = '140px';
    const w = Math.max(el.clientWidth || 0, el.parentElement?.clientWidth || 0, 200);
    const h = Math.max(el.clientHeight || 0, 140);

    try {
      const chart = createChart(el, {
        layout: {
          background: { color: 'rgba(8,14,24,0.35)' },
          textColor: '#8fa3c0',
          fontSize: 10,
        },
        grid: {
          vertLines: { color: 'rgba(80,120,180,0.14)' },
          horzLines: { color: 'rgba(80,120,180,0.14)' },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.12, bottom: 0.12 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: false,
          secondsVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: false,
        handleScale: false,
        width: w,
        height: h,
      });

      if (typeof chart.addCandlestickSeries !== 'function') {
        throw new Error('addCandlestickSeries unavailable');
      }
      const series = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        priceFormat: { type: 'price', precision: 0, minMove: 1 },
      });
      if (bars.length) series.setData(bars);
      chart.timeScale().fitContent();

      const resize = () => {
        if (!el.isConnected || closed) return;
        const nw = Math.max(el.clientWidth || 0, 160);
        const nh = Math.max(el.clientHeight || 0, 120);
        chart.applyOptions({ width: nw, height: nh });
        chart.timeScale().fitContent();
      };
      const ro = new ResizeObserver(() => resize());
      ro.observe(el);
      // 布局完成后再量两次尺寸
      requestAnimationFrame(() => {
        resize();
        requestAnimationFrame(resize);
      });
      charts.push({ chart, series, ro, key: el.dataset.key });
      return series;
    } catch (err) {
      console.warn('[stock] chart mount failed, fallback canvas', err);
      drawFallback(el, bars);
      return null;
    }
  };

  const holdersHtml = (key) => {
    let list = [];
    try {
      list = game.stockHolders?.(key) || [];
    } catch {
      list = (game.players || [])
        .filter(p => !p.bankrupt && (p.stocks?.[key] || 0) > 0)
        .map(p => ({ id: p.id, name: p.name, n: p.stocks[key] }))
        .sort((a, b) => b.n - a.n);
    }
    if (!list.length) return '<span class="stock-holders empty">暂无持仓</span>';
    return `<span class="stock-holders">${list.map(h => {
      const me = player && h.id === player.id ? ' me' : '';
      return `<span class="sh${me}">${h.name} <b>${h.n}</b></span>`;
    }).join('')}</span>`;
  };

  const renderGrid = () => {
    const scrollLeft = grid.scrollLeft;
    const scrollTop = grid.scrollTop;
    const gen = ++mountGen;
    for (const c of charts) {
      try { c.chart.remove(); } catch { /* */ }
      if (c.ro) c.ro.disconnect();
    }
    charts.length = 0;
    grid.innerHTML = '';
    refreshCash();

    for (const key of STOCK_INDUSTRIES) {
      const ind = INDUSTRIES[key];
      const st = INDUSTRY_STATES[game.industry?.[key] ?? 1] || INDUSTRY_STATES[1];
      const hold = player ? (game.ensureStocks?.(player)?.[key] || player.stocks?.[key] || 0) : 0;
      const shortN = player
        ? (game.ensureShorts?.(player)?.[key] || player.shorts?.[key] || 0)
        : 0;
      const total = game.totalShares?.(key) ?? 0;
      const heat = game.marketHeat?.[key] || 0;
      const price = game.stockPrice?.(key) ?? 0;
      const sellP = game.sellStockPrice?.(key) ?? price;
      // 观战：用地主视角展示抬租参考；交易：用自己 id
      const boost = player
        ? (game.industryRentBoost?.(key, player.id) ?? 1)
        : (game.industryRentBoost?.(key) ?? 1);
      const news = game.newsMult?.[key] ?? 1;
      const maxB = maxBuyable(key);
      const maxS = maxSellable(key);
      const maxSO = maxShortOpen(key);
      const maxSC = maxShortCover(key);
      const canBuy = tradeable && maxB > 0 && game.canBuyStock?.(player, key, 1);
      const canSell = tradeable && maxS > 0;
      const canShort = tradeable && maxSO > 0;
      const canCover = tradeable && maxSC > 0;
      const gate = player ? !!game.canTradeStock?.(player, key) : false;
      let kdata = [];
      try { kdata = game.getKline?.(key) || []; } catch { kdata = game.kline?.[key] || []; }
      const prev = kdata.length > 1 ? kdata[kdata.length - 2].close : price;
      const last = kdata.length ? kdata[kdata.length - 1].close : price;
      const up = last >= prev;
      const qtyMax = Math.max(maxB, maxS, maxSO, maxSC, 1);
      const opts = qtyOptions(qtyMax);
      const roomMkt = Math.max(0, MAX_MARKET_SHARES - total);

      const card = document.createElement('div');
      card.className = 'stock-card';
      card.dataset.key = key;
      card.dataset.qty = '1';
      card.innerHTML = `
        <div class="stock-card-head">
          <b>${ind.icon} ${ind.name}</b>
          <span class="tag">${st.icon}${st.name}</span>
          <span class="stock-card-price ${up ? 'up' : 'down'}">${formatMoney(price)} ${up ? '▲' : '▼'}</span>
        </div>
        <div class="stock-card-chart" data-key="${key}"></div>
        <div class="stock-card-meta">
          卖 ${formatMoney(sellP)}
          · 全场多头 <b>${total}</b>/${MAX_MARKET_SHARES}
          · 热度 ${heat}
          · 资讯×${Number(news).toFixed(2)}
          · 抬租参考 ×${Number(boost).toFixed(2)}
          <br/>
          我多 <b style="color:#9fd4ff">${hold}</b>/${MAX_SHARES_PER_IND}
          · 我空 <b style="color:#ff8a80">${shortN}</b>/${MAX_SHORT_PER_IND}
          ${tradeable
            ? (gate
              ? ` · 可买 <b style="color:#7dffa0">${maxB}</b> · 可空 <b style="color:#ffb060">${maxSO}</b>`
              : ' · <span style="color:#e67e22">需持有该行业未抵押地产才可交易/做空</span>')
            : ` · 余市 <b>${roomMkt}</b>`}
        </div>
        <div class="stock-card-holders">
          <span class="hl">多头</span>
          ${holdersHtml(key)}
        </div>
        ${tradeable ? `
        <div class="stock-card-qty">
          <span class="qty-label">手数</span>
          <div class="qty-stepper">
            <button type="button" class="qty-step" data-qty-step="-1" aria-label="减一手">−</button>
            <span class="qty-display" data-qty-display="${key}">1</span>
            <button type="button" class="qty-step" data-qty-step="1" aria-label="加一手">+</button>
          </div>
          <div class="qty-btns" data-qty-group="${key}">
            ${opts.map(n => {
              const isMax = n === qtyMax && qtyMax > 1;
              return `<button type="button" class="qty-btn${n === 1 ? ' active' : ''}" data-qty-val="${n}">${isMax ? `满${n}` : n}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="stock-card-actions stock-card-actions-4">
          <button type="button" class="buy" data-buy="${key}" ${canBuy ? '' : 'disabled'}>买入</button>
          <button type="button" class="sell" data-sell="${key}" ${canSell ? '' : 'disabled'}>卖出</button>
          <button type="button" class="short" data-short="${key}" ${canShort ? '' : 'disabled'}>做空</button>
          <button type="button" class="cover" data-cover="${key}" ${canCover ? '' : 'disabled'}>平空</button>
        </div>` : `
        <div class="stock-card-meta stock-readonly-tip">👁 观战中 · 行情与持仓均可查看 · 不可交易</div>
        `}`;
      grid.appendChild(card);
      const chartEl = card.querySelector('.stock-card-chart');
      // 双 rAF：等 grid 布局完成后再挂图；gen 防止 refresh 冲掉旧回调
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (closed || gen !== mountGen || !chartEl?.isConnected) return;
          mountChart(chartEl, kdata);
        });
      });

      if (!tradeable) continue;

      const buyBtn = card.querySelector(`[data-buy="${key}"]`);
      const sellBtn = card.querySelector(`[data-sell="${key}"]`);
      const shortBtn = card.querySelector(`[data-short="${key}"]`);
      const coverBtn = card.querySelector(`[data-cover="${key}"]`);
      const qtyGroup = card.querySelector(`[data-qty-group="${key}"]`);
      const qtyDisplay = card.querySelector(`[data-qty-display="${key}"]`);
      const stepBtns = card.querySelectorAll('.qty-step');

      const clampQty = (n) => {
        const hi = Math.max(qtyMax, 1);
        return Math.max(1, Math.min(hi, n | 0));
      };

      const syncLabels = () => {
        let n = clampQty(parseInt(card.dataset.qty, 10) || 1);
        card.dataset.qty = String(n);
        if (qtyDisplay) qtyDisplay.textContent = String(n);
        qtyGroup?.querySelectorAll('.qty-btn').forEach(b => {
          b.classList.toggle('active', +b.dataset.qtyVal === n);
        });
        stepBtns.forEach(b => {
          const d = +b.dataset.qtyStep;
          b.disabled = (d < 0 && n <= 1) || (d > 0 && n >= qtyMax);
        });
        if (buyBtn) {
          const bn = Math.min(n, maxB || 1);
          buyBtn.textContent = maxB > 0 ? `买入 ${bn}` : '买入';
          buyBtn.disabled = maxB <= 0 || !game.canBuyStock(player, key, bn);
        }
        if (sellBtn) {
          const sn = Math.min(n, maxS || 1);
          sellBtn.textContent = maxS > 0 ? `卖出 ${sn}` : '卖出';
          sellBtn.disabled = maxS <= 0;
        }
        if (shortBtn) {
          const sn = Math.min(n, maxSO || 1);
          shortBtn.textContent = maxSO > 0 ? `做空 ${sn}` : '做空';
          shortBtn.disabled = maxSO <= 0;
        }
        if (coverBtn) {
          const cn = Math.min(n, maxSC || 1);
          coverBtn.textContent = maxSC > 0 ? `平空 ${cn}` : '平空';
          coverBtn.disabled = maxSC <= 0;
        }
      };

      qtyGroup?.querySelectorAll('.qty-btn').forEach(b => {
        b.onclick = () => {
          card.dataset.qty = String(clampQty(+b.dataset.qtyVal));
          syncLabels();
        };
      });
      stepBtns.forEach(b => {
        b.onclick = () => {
          const cur = clampQty(parseInt(card.dataset.qty, 10) || 1);
          card.dataset.qty = String(clampQty(cur + (+b.dataset.qtyStep || 0)));
          syncLabels();
        };
      });
      syncLabels();
    }

    if (!tradeable) return;

    const readQty = (key) => {
      const card = grid.querySelector(`.stock-card[data-key="${key}"]`);
      return Math.max(1, parseInt(card?.dataset.qty, 10) || 1);
    };

    grid.querySelectorAll('[data-buy]').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.buy;
        let n = readQty(key);
        n = Math.min(n, maxBuyable(key));
        if (n <= 0) { ui.toast?.('无法买入（门槛/现金/上限）'); return; }
        if (hooks.buy) {
          hooks.buy(key, n);
          setTimeout(() => { if (!closed) renderGrid(); }, 80);
          return;
        }
        const r = game.buyStock(player, key, n);
        if (!r) { ui.toast?.('无法买入（门槛/现金/上限）'); return; }
        ui.log?.(`${player.name} 买入 ${INDUSTRIES[key].icon}${INDUSTRIES[key].name} 股票 ${r.n} 手（${formatMoney(r.cost)}）`, 'good');
        onChange?.();
        renderGrid();
      };
    });
    grid.querySelectorAll('[data-sell]').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.sell;
        let n = readQty(key);
        n = Math.min(n, maxSellable(key));
        if (n <= 0) { ui.toast?.('无法卖出'); return; }
        if (hooks.sell) {
          hooks.sell(key, n);
          setTimeout(() => { if (!closed) renderGrid(); }, 80);
          return;
        }
        const r = game.sellStock(player, key, n);
        if (!r) { ui.toast?.('无法卖出'); return; }
        ui.log?.(`${player.name} 卖出 ${INDUSTRIES[key].icon}${INDUSTRIES[key].name} 股票 ${r.n} 手（+${formatMoney(r.gain)}）`, 'card');
        onChange?.();
        renderGrid();
      };
    });
    grid.querySelectorAll('[data-short]').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.short;
        let n = readQty(key);
        n = Math.min(n, maxShortOpen(key));
        if (n <= 0) { ui.toast?.('无法做空（门槛/上限/已持多头）'); return; }
        if (hooks.openShort) {
          hooks.openShort(key, n);
          setTimeout(() => { if (!closed) renderGrid(); }, 80);
          return;
        }
        const r = game.openShort(player, key, n);
        if (!r) { ui.toast?.('无法做空'); return; }
        ui.log?.(
          `${player.name} 做空 ${INDUSTRIES[key].icon}${INDUSTRIES[key].name} ${r.n} 手（+${formatMoney(r.gain)}，待平）`,
          'bad',
        );
        onChange?.();
        renderGrid();
      };
    });
    grid.querySelectorAll('[data-cover]').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.cover;
        let n = readQty(key);
        n = Math.min(n, maxShortCover(key));
        if (n <= 0) { ui.toast?.('无法平空（空仓/现金不足）'); return; }
        if (hooks.coverShort) {
          hooks.coverShort(key, n);
          setTimeout(() => { if (!closed) renderGrid(); }, 80);
          return;
        }
        const r = game.coverShort(player, key, n);
        if (!r) { ui.toast?.('无法平空'); return; }
        ui.log?.(
          `${player.name} 平空 ${INDUSTRIES[key].icon}${INDUSTRIES[key].name} ${r.n} 手（-${formatMoney(r.cost)}）`,
          'good',
        );
        onChange?.();
        renderGrid();
      };
    });
    requestAnimationFrame(() => {
      grid.scrollLeft = scrollLeft;
      grid.scrollTop = scrollTop;
    });
  };

  if (closeBtn) closeBtn.onclick = destroy;
  const onKey = (e) => {
    if (e.key === 'Escape') {
      destroy();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  renderNews();
  renderGrid();
  newsTimer = setInterval(rotateNews, 3200);

  return { close: destroy, refresh: () => { if (closed) return; renderNews(); renderGrid(); } };
}
