// DOM UI：开始界面、HUD、行业条、银行/交易/公司/设置面板、聊天、道具栏、弹窗
import {
  TILES, INDUSTRIES, INDUSTRY_STATES, ITEMS, PLAYABLE_ITEMS, JAIL_FINE,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
  STOCK_INDUSTRIES, MAX_SHARES_PER_IND, COMPANY_IPO_MIN_LEVEL, SHARE_PLEDGE_LOAN,
  LIVING_RENT_FREE_SEC, LIVING_RENT_MAX, calcLivingRentAmount,
  formatMoney, ttc, CURRENCY_SYMBOL, CURRENCY_NAME, GO_SALARY, RAILROAD_RENTS,
  ITEM_MARKET_BASE,
} from '../data/tiles.js';
import { PLAYER_COLORS_CSS, MAX_PLAYERS } from '../three/world.js';

const $ = (s) => document.querySelector(s);
const ownable = (t) => ['property', 'railroad', 'utility'].includes(t.type);

export class UI {
  constructor() {
    this.el = {
      players: $('#players'), actions: $('#actions'), turnInfo: $('#turn-info'),
      rentMeter: $('#rent-meter'), rentMeterText: $('#rent-meter-text'),
      btnRoll: $('#btn-roll'), btnBuild: $('#btn-build'), btnEnd: $('#btn-end'),
      btnBank: $('#btn-bank'), btnTrade: $('#btn-trade'), btnCompany: $('#btn-company'),
      btnStock: $('#btn-stock'), btnDraw: $('#btn-draw'),
      btnMarket: $('#btn-market'),
      btnCamera: $('#btn-camera'), btnSettings: $('#btn-settings'),
      itemBar: $('#item-bar'), industries: $('#industries'),
      log: $('#log'), logWrap: $('#log-wrap'), danmaku: $('#danmaku-layer'),
      chatDanmaku: $('#chat-danmaku-layer'),
      chatWrap: $('#chat-wrap'), chatLog: $('#chat-log'), chatInput: $('#chat-input'), chatSend: $('#chat-send'),
      modal: $('#modal'), modalBox: $('#modal-box'),
      toast: $('#toast'), tileInfo: $('#tile-info'),
      holoHud: $('#holo-hud'),
      startScreen: $('#start-screen'), playerSetup: $('#player-setup'),
      countLabel: $('#player-count-label'),
      gameClock: $('#game-clock'), gameClockText: $('#game-clock-text'),
      gameClockSpeed: $('#game-clock-speed'),
    };
    this._rentTimer = null;
    this._rentT0 = 0;
    this.el.chatSend.onclick = () => this._sendChat();
    this.el.chatInput.onkeydown = (e) => { if (e.key === 'Enter') this._sendChat(); };
  }

  /**
   * 掷骰阶段：实时显示「操作秒数 → 预估房租」
   * @param {{ waived?: boolean, zoneMult?: number }} [opts]
   * @returns {() => number} stop 后返回经过秒数
   */
  startRentMeter(opts = {}) {
    this.stopRentMeter();
    const meter = this.el.rentMeter;
    const text = this.el.rentMeterText;
    if (!meter || !text) return () => 0;
    this._rentT0 = performance.now();
    const waived = !!opts.waived;
    // 预估用城区倍率 1.0；掷出后再按真实区域结算
    const zoneHint = { mult: opts.zoneMult != null ? opts.zoneMult : 1 };
    meter.classList.remove('hidden', 'warn', 'hot');
    const tick = () => {
      const sec = (performance.now() - this._rentT0) / 1000;
      const rent = calcLivingRentAmount(sec, zoneHint);
      const freeLeft = Math.max(0, LIVING_RENT_FREE_SEC - sec);
      if (waived) {
        text.textContent = `思考 ${sec.toFixed(1)}s · 有房产 · 房租豁免`;
        meter.classList.remove('warn', 'hot');
      } else if (freeLeft > 0) {
        text.textContent = `思考 ${sec.toFixed(1)}s · 免费剩余 ${freeLeft.toFixed(1)}s · 预估 Ŧ0`;
        meter.classList.remove('warn', 'hot');
      } else {
        const cap = rent >= LIVING_RENT_MAX;
        text.textContent = `思考 ${sec.toFixed(1)}s · 预估房租 ${formatMoney(rent)}${cap ? '（上限）' : ''} · 上限 ${formatMoney(LIVING_RENT_MAX)}`;
        meter.classList.toggle('warn', rent > 0 && !cap);
        meter.classList.toggle('hot', cap);
      }
    };
    tick();
    this._rentTimer = setInterval(tick, 200);
    return () => {
      const sec = (performance.now() - this._rentT0) / 1000;
      this.stopRentMeter();
      return sec;
    };
  }

  stopRentMeter() {
    if (this._rentTimer) {
      clearInterval(this._rentTimer);
      this._rentTimer = null;
    }
    this.el.rentMeter?.classList.add('hidden');
    this.el.rentMeter?.classList.remove('warn', 'hot');
  }

  _sendChat() {
    const text = this.el.chatInput.value.trim();
    if (!text) return;
    this.el.chatInput.value = '';
    this.onChatSend?.(text);
  }

  // ---------- 开始界面 ----------
  showStart() {
    return new Promise((resolve) => {
      // 存在存档时展示"继续对局"
      let saveInfo = null;
      try {
        const raw = localStorage.getItem('df_save_v1');
        if (raw) {
          const s = JSON.parse(raw);
          const alive = s.state.players.filter(p => !p.bankrupt).length;
          saveInfo = { total: s.state.players.length, alive, turn: s.state.turn, at: s.at };
        }
      } catch {}
      const continueWrap = $('#continue-game');
      if (saveInfo && continueWrap) {
        continueWrap.classList.remove('hidden');
        $('#continue-info').textContent =
          `${saveInfo.total} 人局 · 存活 ${saveInfo.alive} 人 · 第 ${saveInfo.turn} 回合 · ${new Date(saveInfo.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        $('#btn-continue').onclick = () => {
          this.el.startScreen.classList.add('hidden');
          resolve({ continue: true });
        };
        $('#btn-delete-save').onclick = () => {
          localStorage.removeItem('df_save_v1');
          continueWrap.classList.add('hidden');
        };
      }

      let count = 3;
      const defaults = Array.from({ length: MAX_PLAYERS }, (_, i) => `玩家${i + 1}`);
      const aiFlags = Array.from({ length: MAX_PLAYERS }, (_, i) => i !== 0);
      const snapshot = () => {
        this.el.playerSetup.querySelectorAll('input').forEach((inp, i) => { defaults[i] = inp.value; });
        this.el.playerSetup.querySelectorAll('select').forEach((s, i) => { aiFlags[i] = s.value === 'ai'; });
      };
      // 快捷人数档位
      const qc = $('#quick-count');
      if (qc) {
        for (const n of [2, 3, 4, 6, 8, 12, 16, 24, 34]) {
          const b = document.createElement('button');
          b.className = 'qc-chip';
          b.textContent = `${n}人`;
          b.onclick = () => { snapshot(); count = n; render(); };
          qc.appendChild(b);
        }
      }
      const render = () => {
        this.el.countLabel.textContent = `${count} 名玩家`;
        this.el.countLabel.style.color = count > 8 ? 'var(--gold)' : '';
        this.el.playerSetup.innerHTML = '';
        for (let i = 0; i < count; i++) {
          const row = document.createElement('div');
          row.className = 'setup-player';
          row.innerHTML = `
            <span class="dot" style="background:${PLAYER_COLORS_CSS[i]}"></span>
            <input maxlength="6" value="${defaults[i]}" data-i="${i}" />
            <select data-i="${i}">
              <option value="human" ${aiFlags[i] ? '' : 'selected'}>🧑 人类</option>
              <option value="ai" ${aiFlags[i] ? 'selected' : ''}>🤖 AI</option>
            </select>`;
          this.el.playerSetup.appendChild(row);
        }
      };
      render();
      $('#btn-add-player').onclick = () => { if (count < MAX_PLAYERS) { snapshot(); count++; render(); } };
      $('#btn-remove-player').onclick = () => { if (count > 2) { snapshot(); count--; render(); } };
      $('#btn-start').onclick = () => {
        // 只读本面板行内控件，避免误选到其它 select
        const rows = [...this.el.playerSetup.querySelectorAll('.setup-player')];
        const names = rows.map((row, i) => {
          const inp = row.querySelector('input');
          return (inp?.value || '').trim() || defaults[i];
        });
        const ais = rows.map((row) => row.querySelector('select')?.value === 'ai');
        // 允许首位为 AI；全 AI 时为自动对局（观战），不再静默把 0 号改回人类
        if (ais.every((a) => a)) {
          this.toast?.('全员 AI · 自动对局观战', 2000);
        }
        this.el.startScreen.classList.add('hidden');
        resolve({ configs: names.map((name, i) => ({ name, isAI: !!ais[i] })) });
      };
      const onlineBtn = $('#btn-online');
      if (onlineBtn) onlineBtn.onclick = () => {
        this.el.startScreen.classList.add('hidden');
        resolve({ online: true });
      };
    });
  }

  enterGame() {
    for (const k of ['players', 'actions', 'logWrap', 'chatWrap', 'chatDanmaku', 'industries', 'gameClock']) {
      this.el[k]?.classList.remove('hidden');
    }
  }

  // ---------- HUD ----------
  /**
   * 通天榜：按身价排序的玩家排行
   * @param {import('../core/state.js').GameState} game
   * @param {number} [activeIdx=-1]
   */
  renderPlayers(game, activeIdx = -1, deltas = {}) {
    const wrap = this.el.players;
    wrap.classList.toggle('compact', game.players.length > 8);
    wrap.classList.add('rank-board');
    // 保留已展开状态
    const expanded = new Set(
      [...wrap.querySelectorAll('.player-card.expanded')].map((el) => el.dataset.pid),
    );
    wrap.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'rank-board-head';
    head.innerHTML = `
      <div class="rank-board-title">通天榜</div>
      <div class="rank-board-sub">身价排行 · 点击展开手牌</div>`;
    wrap.appendChild(head);

    const ranked = [...game.players].sort((a, b) => {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      return game.netWorth(b) - game.netWorth(a);
    });

    ranked.forEach((p, idx) => {
      const rank = idx + 1;
      const worth = game.netWorth(p);
      const delta = deltas[p.id] || 0;
      const div = document.createElement('div');
      div.dataset.pid = String(p.id);
      div.className = 'player-card rank-row'
        + (p.id === activeIdx ? ' active' : '')
        + (p.bankrupt ? ' bankrupt' : '')
        + (expanded.has(String(p.id)) ? ' expanded' : '')
        + (rank <= 3 && !p.bankrupt ? ` top-${rank}` : '');
      const props = game.playerProperties(p.id).length;
      const houses = game.playerProperties(p.id).reduce((s, i) => s + game.houses[i], 0);
      const items = p.items || {};
      const itemEntries = Object.entries(items).filter(([, n]) => n > 0);
      const itemCount = itemEntries.reduce((a, [, b]) => a + b, 0);
      const handHtml = itemEntries.length
        ? itemEntries.map(([k, n]) => {
          const meta = ITEMS[k] || { icon: '🃏', name: k };
          return `<span class="phand-chip" data-item="${k}" title="${meta.name}×${n}">${meta.icon}${n > 1 ? `<b>×${n}</b>` : ''}</span>`;
        }).join('')
        : '<span class="phand-empty">无手牌</span>';
      const rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
      const deltaHtml = delta !== 0
        ? `<span class="money-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${formatMoney(delta)}</span>`
        : '';
      const shortTotal = Object.values(p.shorts || {}).reduce((s, v) => s + (v || 0), 0);
      div.innerHTML = `
        <div class="rank-badge" aria-label="第 ${rank} 名">${rankIcon}</div>
        <div class="rank-main">
          <div class="pname">
            <span class="dot" style="background:${PLAYER_COLORS_CSS[p.id]}"></span>
            <span>${p.name}</span>
            ${p.isAI ? '<span class="ai-badge">AI</span>' : ''}
            ${shortTotal > 0 ? `<span class="short-badge">📉空${shortTotal}</span>` : ''}
            <button class="ledger-btn" data-ledger="${p.id}" title="账本">📋</button>
          </div>
          <div class="pworth">${formatMoney(worth)}</div>
          <div class="pmoney">现金 ${formatMoney(p.money)}${p.debt > 0 ? ` <small class="debt">债 ${formatMoney(p.debt)}</small>` : ''}${deltaHtml}</div>
          <div class="pmeta">
            <span>🏢 ${props}</span><span>🏬 ${houses}</span>
            ${p.company ? `<span>${INDUSTRIES[p.company.industry].icon}Lv${p.company.level}</span>` : ''}
            ${itemCount ? `<span>🎒${itemCount}</span>` : ''}
            ${p.jailCards ? `<span>🃏×${p.jailCards}</span>` : ''}
            ${(p.skipTurns || 0) > 0 ? '<span>😴</span>' : ''}
          </div>
          <div class="phand">${handHtml}</div>
          ${itemCount ? '<div class="pexpand-hint">悬停 / 点击展开手牌</div>' : ''}
        </div>
        ${p.inJail ? '<span class="jail-flag">⚖️</span>' : ''}
        ${p.bankrupt ? '<span class="jail-flag">💀</span>' : ''}`;
      div.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        div.classList.toggle('expanded');
      });
      div.querySelector('.ledger-btn').onclick = (e) => {
        e.stopPropagation();
        this.openLedger(p, game);
      };
      wrap.appendChild(div);
    });
  }

  openLedger(player, game) {
    const entries = player.ledger || [];
    const recent = entries.slice(-50).reverse();
    const rows = recent.length
      ? recent.map(e => {
        const cls = e.amount >= 0 ? 'good' : 'bad';
        const sign = e.amount >= 0 ? '+' : '';
        return `<div class="panel-row">
          <span class="grow">T${e.turn || '?'} ${e.reason}</span>
          <span class="${cls}" style="min-width:100px;text-align:right">${sign}${formatMoney(e.amount)}</span>
          <span class="muted" style="min-width:110px;text-align:right">余额 ${formatMoney(e.balance)}</span>
        </div>`;
      }).join('')
      : '<p class="muted">暂无交易记录</p>';
    const income = entries.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter(e => e.amount < 0).reduce((s, e) => s + e.amount, 0);
    this._openModal(`
      <h2>📋 ${player.name} 的账本 <small style="color:#9ab">近${Math.min(50, entries.length)}笔</small></h2>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto">
        <div style="display:flex;gap:16px;margin-bottom:8px;font-size:13px">
          <span style="color:#6dff9a">📈 入 ${formatMoney(income)}</span>
          <span style="color:#ff8a80">📉 出 ${formatMoney(expense)}</span>
          <span style="color:#f0c75e">💰 ${formatMoney(player.money)}</span>
        </div><hr/>${rows}
      </div>
      <div class="btn-row"><button data-close>关 闭</button></div>`);
    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
  }

  /**
   * 全场可见：某人打出道具卡（HUD 出牌特效 + 玩家列表高亮）
   * @param {object} player
   * @param {string} item
   * @param {{ silent?: boolean }} [opts]
   */
  showItemCast(player, item, opts = {}) {
    if (!player || !item) return Promise.resolve();
    const meta = ITEMS[item] || { icon: '🃏', name: item };
    // 玩家列表闪一下 + 对应手牌芯片高亮（全员可见）
    const card = this.el.players?.querySelector(`.player-card[data-pid="${player.id}"]`);
    if (card) {
      card.classList.add('cast-flash', 'expanded');
      const chip = card.querySelector(`.phand-chip[data-item="${item}"]`);
      if (chip) chip.classList.add('just-cast');
      setTimeout(() => {
        card.classList.remove('cast-flash');
        chip?.classList.remove('just-cast');
      }, 2400);
    }
    if (!opts.silent) {
      this.toast(`${player.name} 打出 ${meta.icon}${meta.name}`, 1800);
    }
    // skipFx：本地手牌已播过出牌动画时只高亮列表，避免叠两次
    if (opts.skipFx) return Promise.resolve();
    return import('./handUI.js').then(({ handUI }) =>
      handUI.playCastFx(item, null, {
        playerName: player.name,
        playerColor: PLAYER_COLORS_CSS[player.id],
      }),
    ).catch(() => {});
  }

  renderIndustries(game) {
    this.el.industries.innerHTML = Object.entries(game.industry)
      .filter(([k]) => k !== 'railroad' && k !== 'utility')
      .map(([k, v]) => {
        const ind = INDUSTRIES[k], st = INDUSTRY_STATES[v];
        return `<span class="ind-chip" style="border-color:${ind.css}66">${ind.icon}${ind.name} ${st.icon}</span>`;
      }).join('');
  }

  setTurnInfo(text) { this.el.turnInfo.textContent = text; }

  /**
   * 绑定游戏日历显示
   * @param {import('../core/gameClock.js').GameClock} clock
   */
  bindGameClock(clock) {
    this._gameClock = clock;
    const el = this.el.gameClock || document.getElementById('game-clock');
    if (!el || !clock) return;
    this.el.gameClock = el;
    if (!this.el.gameClockText) this.el.gameClockText = document.getElementById('game-clock-text');
    if (!this.el.gameClockSpeed) this.el.gameClockSpeed = document.getElementById('game-clock-speed');
    el.classList.remove('hidden');
    const paint = (fmt) => {
      if (this.el.gameClockText) this.el.gameClockText.textContent = fmt.short || fmt.full;
      if (this.el.gameClockSpeed) {
        this.el.gameClockSpeed.textContent = fmt.speedLabel;
        this.el.gameClockSpeed.classList.toggle('paused', clock.speed === 0);
      }
      el.title =
        `${fmt.full}\n` +
        `全员各操作完一轮 = 推进 1 天\n` +
        `周一～五 开市 · 周六日 休市（不可买卖股票）\n` +
        `T+ 只计交易日；点击切换盘中钟倍速`;
      el.classList.toggle('market-closed', !fmt.marketOpen);
    };
    paint(clock.format());
    clock.onChange(paint);
    el.onclick = () => {
      const s = clock.cycleSpeed();
      const f = clock.format();
      this.toast(
        s === 0
          ? `⏸️ 盘中钟暂停 · ${f.tPlus} 周${clock.weekdayName} · ${f.market}`
          : `⏩ ${s}× · ${f.tPlus} 周${clock.weekdayName} · ${f.market}`,
        1600,
      );
    };
  }

  setGameClockVisible(on) {
    this.el.gameClock?.classList.toggle('hidden', !on);
  }

  /**
   * @param {object} flags
   * stock 默认 true：任意时刻可看行情；draw 付费抽牌仅自己回合末
   */
  setButtons({
    roll = false, build = false, end = false, bank = false,
    trade = false, company = false, stock = true, draw = false,
  }) {
    this.el.btnRoll.disabled = !roll;
    this.el.btnBuild.disabled = !build;
    this.el.btnEnd.disabled = !end;
    this.el.btnBank.disabled = !bank;
    this.el.btnTrade.disabled = !trade;
    this.el.btnCompany.disabled = !company;
    if (this.el.btnStock) this.el.btnStock.disabled = !stock;
    if (this.el.btnDraw) this.el.btnDraw.disabled = !draw;
  }

  /** 更新抽牌按钮文案（显示价格与剩余次数） */
  setDrawLabel(text) {
    if (this.el.btnDraw) this.el.btnDraw.textContent = text || '🃏 抽牌';
  }

  /**
   * 镜头模式按钮文案
   * @param {'follow'|'free'|'orbit'|boolean} mode 兼容旧 bool
   */
  setCameraLabel(mode) {
    const m = mode === true ? 'follow' : mode === false ? 'free' : mode;
    const map = {
      follow: '📷 跟随',
      free: '📷 自由',
      orbit: '🎥 通天观战',
    };
    this.el.btnCamera.textContent = map[m] || map.follow;
  }

  waitButton(which) {
    const btn = { roll: this.el.btnRoll, end: this.el.btnEnd }[which];
    return new Promise(res => {
      const h = () => { btn.removeEventListener('click', h); res(); };
      btn.addEventListener('click', h);
    });
  }

  // ---------- 道具栏 & 掷骰动作 ----------
  /** 渲染主动卡牌按钮到道具栏；onUse(item) 由外部执行效果 */
  renderCardBar(player, onUse) {
    const bar = this.el.itemBar;
    if (!player) { bar.innerHTML = ''; return; }
    for (const item of PLAYABLE_ITEMS) {
      const n = player.items[item] || 0;
      if (n <= 0) continue;
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `${ITEMS[item].icon}<span class="cnt">${n}</span>`;
      b.title = `${ITEMS[item].name}：${ITEMS[item].desc}`;
      b.onclick = async () => {
        await onUse(item);
        const left = player.items[item] || 0;
        if (left <= 0) b.remove();
        else b.querySelector('.cnt').textContent = left;
      };
      bar.appendChild(b);
    }
  }

  /**
   * 渲染道具栏并等待玩家的掷骰动作
   * @returns {Promise<{type:'roll', boost:boolean} | {type:'remote', total:number}>}
   */
  waitRollAction(player, { onUseCard } = {}) {
    return new Promise(resolve => {
      let boost = false;
      const bar = this.el.itemBar;
      bar.innerHTML = '';
      const done = (action) => { bar.innerHTML = ''; this.el.btnRoll.onclick = null; resolve(action); };

      this.el.btnRoll.onclick = () => done({ type: 'roll', boost });

      const mk = (item, onclick) => {
        const n = player.items[item] || 0;
        if (n <= 0) return;
        const b = document.createElement('button');
        b.className = 'item-btn';
        b.innerHTML = `${ITEMS[item].icon}<span class="cnt">${n}</span>`;
        b.title = `${ITEMS[item].name}：${ITEMS[item].desc}`;
        b.onclick = onclick;
        bar.appendChild(b);
        return b;
      };

      mk('remote', async () => {
        const n = await this.askNumber('🎯 遥控骰子：选择点数', 1, 6);
        if (n != null) done({ type: 'remote', total: n });
      });
      const boostBtn = mk('boost', () => {
        boost = !boost;
        boostBtn.classList.toggle('toggled', boost);
        this.toast(boost ? '🚀 加速卡已激活：本次 +3 步' : '已取消加速卡');
      });
      // 主动策略卡
      for (const item of PLAYABLE_ITEMS) {
        const b = mk(item, async () => {
          await onUseCard?.(item);
          const left = player.items[item] || 0;
          if (left <= 0) b?.remove();
          else b?.querySelector('.cnt') && (b.querySelector('.cnt').textContent = left);
        });
      }
      if ((player.items.rentFree || 0) > 0) {
        const b = document.createElement('button');
        b.className = 'item-btn';
        b.disabled = true;
        b.title = '免租卡：踩到他人地产时自动询问使用';
        b.innerHTML = `${ITEMS.rentFree.icon}<span class="cnt">${player.items.rentFree}</span>`;
        bar.appendChild(b);
      }
    });
  }

  /**
   * 全屏平铺选择层（与遥控骰子同风格）
   * @param {{
   *   title: string,
   *   sub?: string,
   *   options: Array<{ id: string|number, label: string, icon?: string, meta?: string, html?: string }>,
   *   cancelLabel?: string|null,
   *   cols?: number,
   * }} cfg
   * @returns {Promise<string|number|null>}
   */
  openPickOverlay(cfg) {
    const {
      title,
      sub = '点击下方选项确认',
      options = [],
      cancelLabel = '取消',
      cols,
    } = cfg || {};
    let root = document.getElementById('dice-pick-overlay');
    if (!root) {
      root = document.createElement('div');
      root.id = 'dice-pick-overlay';
      document.body.appendChild(root);
    }
    const n = options.length;
    const colN = cols || (n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : 3);
    root.className = 'dice-pick-overlay pick-overlay';
    clearTimeout(root._pickHideT);
    root.innerHTML = `
      <div class="dice-pick-backdrop"></div>
      <div class="dice-pick-stage">
        <header class="dice-pick-head">
          <h2>${title || '请选择'}</h2>
          ${sub ? `<p>${sub}</p>` : ''}
        </header>
        <div class="dice-pick-grid pick-option-grid" style="--pick-cols:${colN}" role="listbox" aria-label="${title || '选项'}">
          ${options.map((o) => `
            <button type="button" class="dice-face-btn pick-option-btn" data-pick="${o.id}" role="option">
              <span class="dice-face-glow"></span>
              ${o.html || `
                <span class="pick-option-icon">${o.icon || '✦'}</span>
                <span class="dice-face-label pick-option-label">${o.label}</span>
                ${o.meta ? `<span class="pick-option-meta">${o.meta}</span>` : ''}
              `}
            </button>`).join('')}
        </div>
        <footer class="dice-pick-foot">
          ${cancelLabel != null
            ? `<button type="button" class="dice-pick-cancel" data-pick="">${cancelLabel}</button>`
            : '<span></span>'}
        </footer>
      </div>`;
    root.classList.remove('hidden');
    void root.offsetWidth;
    root.classList.add('show');

    return new Promise((res) => {
      const finish = (v) => {
        root.classList.remove('show');
        root.classList.add('hiding');
        root._pickHideT = setTimeout(() => {
          root.classList.add('hidden');
          root.classList.remove('hiding');
          root.innerHTML = '';
          root._pickHideT = null;
        }, 280);
        res(v);
      };
      root.querySelectorAll('[data-pick]').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.pick === '') {
            finish(null);
            return;
          }
          b.classList.add('picked');
          const raw = b.dataset.pick;
          const num = Number(raw);
          const val = raw !== '' && !Number.isNaN(num) && String(num) === raw ? num : raw;
          setTimeout(() => finish(val), 200);
        };
      });
    });
  }

  /** 选择一名玩家（卡牌目标等）——全屏平铺 */
  askPlayer(title, players) {
    return this.openPickOverlay({
      title,
      sub: '点击选择目标玩家',
      cols: players.length <= 3 ? players.length : 3,
      options: players.map((p) => ({
        id: p.id,
        label: p.name,
        icon: '👤',
        meta: `现金 ${formatMoney(p.money)}`,
        html: `
          <span class="pick-player-dot" style="background:${PLAYER_COLORS_CSS[p.id]}"></span>
          <span class="dice-face-label pick-option-label">${p.name}</span>
          <span class="pick-option-meta">现金 ${formatMoney(p.money)}</span>
          ${p.isAI ? '<span class="pick-option-tag">AI</span>' : ''}
        `,
      })),
      cancelLabel: '取消',
    });
  }

  /** 通用多选一：options = [{id,label,icon?,meta?}] —— 全屏平铺 */
  askChoice(title, options) {
    return this.openPickOverlay({
      title,
      sub: '点击确认一项',
      options: options.map((o) => ({
        id: o.id,
        label: o.label,
        icon: o.icon || '✦',
        meta: o.meta,
      })),
      cancelLabel: '取消',
    });
  }

  askIndustry(keys) {
    return this.askChoice('选择行业', keys.map(k => ({
      id: k,
      label: INDUSTRIES[k].name,
      icon: INDUSTRIES[k].icon,
    })));
  }

  /** 换地卡：全屏分步选择 对手 → 我的地 → 对方地 */
  async openSwap(game, me, onPick) {
    const others = game.players.filter(p => p.id !== me.id && !p.bankrupt);
    const myTiles = game.playerProperties(me.id).filter(i => game.canSwapTile(me, i));
    if (!myTiles.length) { this.toast('你没有可交换的地产（须无建筑且未抵押）'); return; }
    const othersWithTiles = others.filter(o => game.playerProperties(o.id).some(i => game.canSwapTile(o, i)));
    if (!othersWithTiles.length) { this.toast('对手没有可交换的地产'); return; }

    const targetId = await this.openPickOverlay({
      title: '🔀 换地卡 · 选对手',
      sub: '选择要交换地产的对手',
      options: othersWithTiles.map((p) => ({
        id: p.id,
        label: p.name,
        icon: '🤝',
        meta: `${game.playerProperties(p.id).filter(i => game.canSwapTile(p, i)).length} 处可换`,
      })),
    });
    if (targetId == null) return;

    const myTile = await this.openPickOverlay({
      title: '🔀 换地卡 · 我方地产',
      sub: '选择你要换出的地产',
      options: myTiles.map((i) => ({
        id: i,
        label: TILES[i].name,
        icon: '🏢',
        meta: formatMoney(TILES[i].price),
      })),
    });
    if (myTile == null) return;

    const opp = game.players[targetId];
    const theirList = game.playerProperties(opp.id).filter(i => game.canSwapTile(opp, i));
    const theirTile = await this.openPickOverlay({
      title: `🔀 换地卡 · ${opp.name} 的地产`,
      sub: '选择你想换得的地产',
      options: theirList.map((i) => ({
        id: i,
        label: TILES[i].name,
        icon: '🏠',
        meta: formatMoney(TILES[i].price),
      })),
    });
    if (theirTile == null) return;
    onPick({ targetId: +targetId, myTile: +myTile, theirTile: +theirTile });
  }

  askNumber(title, min, max) {
    // 遥控骰子 1~6：展示艺术点数图
    if (min === 1 && max === 6 && /遥控|骰子|点数/.test(String(title || ''))) {
      return this.askDiceFace(title);
    }
    const opts = Array.from({ length: max - min + 1 }, (_, i) => {
      const n = min + i;
      return { id: n, label: String(n), icon: '🔢', meta: `选择 ${n}` };
    });
    return this.openPickOverlay({
      title,
      sub: `选择 ${min} ~ ${max}`,
      options: opts,
      cols: Math.min(6, opts.length),
    });
  }

  /**
   * 遥控骰子：全屏平铺艺术骰面选 1~6
   * @param {string} [title]
   * @returns {Promise<number|null>}
   */
  askDiceFace(title = '🎯 遥控骰子：选择点数') {
    let root = document.getElementById('dice-pick-overlay');
    if (!root) {
      root = document.createElement('div');
      root.id = 'dice-pick-overlay';
      document.body.appendChild(root);
    }
    root.className = 'dice-pick-overlay';
    clearTimeout(root._pickHideT);
    root.innerHTML = `
      <div class="dice-pick-backdrop"></div>
      <div class="dice-pick-stage">
        <header class="dice-pick-head">
          <h2>${title}</h2>
          <p>点击下方艺术骰面 · 指定本次前进点数 · 消耗 1 张遥控骰子</p>
        </header>
        <div class="dice-pick-grid" role="listbox" aria-label="选择点数">
          ${[1, 2, 3, 4, 5, 6].map((n) => `
            <button type="button" class="dice-face-btn" data-n="${n}" role="option" title="指定 ${n} 点" aria-label="${n} 点">
              <span class="dice-face-glow"></span>
              <img class="dice-face-art" src="/textures/dice/d${n}.png" alt="${n} 点" draggable="false"
                onerror="this.onerror=null;this.src='/textures/dice/d${n}.svg'" />
              <span class="dice-face-label"><b>${n}</b> 点</span>
            </button>`).join('')}
        </div>
        <footer class="dice-pick-foot">
          <button type="button" class="dice-pick-cancel" data-n="">取消</button>
        </footer>
      </div>`;
    root.classList.remove('hidden');
    void root.offsetWidth;
    root.classList.add('show');

    import('./chromaKey.js').then(async ({ keyGreenUrl }) => {
      const imgs = [...root.querySelectorAll('.dice-face-art')];
      await Promise.all(imgs.map(async (img) => {
        const n = img.closest('[data-n]')?.dataset?.n;
        if (!n) return;
        try {
          const url = await keyGreenUrl(`/textures/dice/d${n}.png`, { cacheKey: `dice-art-${n}` });
          img.src = url;
        } catch { /* 保留原图 / svg 兜底 */ }
      }));
    });

    return new Promise((res) => {
      const finish = (v) => {
        root.classList.remove('show');
        root.classList.add('hiding');
        root._pickHideT = setTimeout(() => {
          root.classList.add('hidden');
          root.classList.remove('hiding');
          root.innerHTML = '';
          root._pickHideT = null;
        }, 280);
        res(v);
      };
      root.querySelectorAll('[data-n]').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.n !== '') {
            b.classList.add('picked');
            setTimeout(() => finish(+b.dataset.n), 220);
          } else {
            finish(null);
          }
        };
      });
    });
  }

  // ---------- 日志 / 聊天 / 提示 ----------
  /**
   * 绑定 3D 世界（场景弹幕 / 生活区）
   * @param {import('../three/world.js').World} world
   */
  bindWorld(world) {
    this.world = world;
  }

  log(html, cls = '') {
    // 右上角迷你历史（可滚）
    if (this.el.log) {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      div.innerHTML = html;
      this.el.log.appendChild(div);
      this.el.log.scrollTop = this.el.log.scrollHeight;
      while (this.el.log.children.length > 80) this.el.log.firstChild.remove();
    }
    // 场景内 3D 弹幕（不再用左侧 2D 弹幕）
    this._spawnDanmaku(html, cls);
  }

  /** 操作日志 → 棋盘上空 3D 弹幕 */
  _spawnDanmaku(html, cls = '') {
    if (this.world?.spawnWorldDanmaku) {
      this.world.spawnWorldDanmaku(html, cls);
      return;
    }
    // 无 3D 世界时兜底：仍不使用左侧层，只写历史
  }

  chatAdd({ from, color, text, sys = false }) {
    // 右侧历史面板
    if (this.el.chatLog) {
      const div = document.createElement('div');
      if (sys) { div.className = 'sys'; div.textContent = text; }
      else div.innerHTML = `<span class="cname" style="color:${color}">${from}:</span>${this._escapeHtml(text)}`;
      this.el.chatLog.appendChild(div);
      this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
      while (this.el.chatLog.children.length > 80) this.el.chatLog.firstChild.remove();
    }
    // 视频式弹幕：从右往左飞过
    this._spawnChatBarrage({ from, color, text, sys });
  }

  _escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 视频弹幕：轨道占用 + CSS transform 从屏右滚到屏左
   * 速度随字数略变，大号描边字
   */
  _spawnChatBarrage({ from, color, text, sys = false }) {
    const layer = this.el.chatDanmaku || document.getElementById('chat-danmaku-layer');
    if (!layer || layer.classList.contains('hidden')) {
      // 未进局时也允许弹（去掉 hidden 仅当层存在且游戏中）
      if (!layer) return;
    }
    layer.classList.remove('hidden');

    // 轨道：上半屏 8 条，避免挡操作区
    if (!this._chatLanes) this._chatLanes = new Array(8).fill(0);
    const now = performance.now();
    let lane = 0;
    let best = Infinity;
    for (let i = 0; i < this._chatLanes.length; i++) {
      if (this._chatLanes[i] <= now) { lane = i; best = -1; break; }
      if (this._chatLanes[i] < best) { best = this._chatLanes[i]; lane = i; }
    }

    const el = document.createElement('div');
    el.className = sys ? 'chat-barrage sys' : 'chat-barrage';
    if (sys) {
      el.textContent = text;
    } else {
      el.innerHTML = `<span class="cname" style="color:${color || '#f0c75e'}">${this._escapeHtml(from)}</span>${this._escapeHtml(text)}`;
    }

    // 先离屏测量宽度
    el.style.visibility = 'hidden';
    el.style.transform = 'translateX(0)';
    layer.appendChild(el);
    const w = Math.max(el.offsetWidth, 80);
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    // 轨道 Y：顶部 8% ~ 42% 区域
    const topPct = 0.08 + (lane / Math.max(1, this._chatLanes.length - 1)) * 0.34;
    el.style.top = `${Math.round(vh * topPct)}px`;
    el.style.visibility = 'visible';

    // 时长：基础 8s + 字数加成，保证读得完
    const chars = (text || '').length + (from || '').length;
    const duration = Math.min(14, Math.max(7.5, 7 + chars * 0.12 + w / 180));
    // 同轨占用：弹幕尾部离开起点后再放下一条
    const gap = (w / (vw + w)) * duration * 1000 + 380;
    this._chatLanes[lane] = Math.max(this._chatLanes[lane], now) + gap;

    const startX = vw + 24;
    const endX = -w - 48;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / (duration * 1000));
      // 线性匀速（视频弹幕体感）
      const x = startX + (endX - startX) * k;
      el.style.transform = `translate3d(${x}px, 0, 0)`;
      if (k < 1) {
        el._raf = requestAnimationFrame(tick);
      } else {
        el.remove();
      }
    };
    el._raf = requestAnimationFrame(tick);

    while (layer.children.length > 40) {
      const old = layer.firstChild;
      if (old?._raf) cancelAnimationFrame(old._raf);
      old?.remove();
    }
  }

  toast(msg, ms = 1600) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.el.toast.classList.add('hidden'), ms);
  }

  // ---------- 弹窗基础（干净面板，无外挂金框以免挡操作） ----------
  /**
   * @param {string} html
   * @param {{ layout?: 'portrait'|'wide'|'card'|'auto', kind?: string }} [opts]
   */
  _openModal(html, opts = {}) {
    const box = this.el.modalBox;
    const layout = opts.layout
      || (box.classList.contains('company-wide') ? 'wide' : 'portrait');
    const kind = opts.kind || 'notice';

    // 保留 company-wide 等外部类
    const keepWide = box.classList.contains('company-wide');
    box.className = '';
    if (keepWide) box.classList.add('company-wide');
    box.classList.add('art-modal', `art-layout-${layout}`, `art-kind-${kind}`);
    if (layout === 'wide' || keepWide) box.classList.add('art-layout-wide');

    // 不再叠加 art-modal-frame 金框层（抠像框易错位挡点击）
    box.innerHTML = `<div class="art-modal-inner">${html}</div>`;

    const inner = box.querySelector('.art-modal-inner');
    this._structureArtModal(inner);

    this.el.modal.classList.remove('hidden');
  }

  /** 将任意弹窗内容整理为 head / body / foot 三行 grid */
  _structureArtModal(inner) {
    if (!inner) return;
    // 公司全屏壳已自带 grid，不再拆 head/body/foot
    if (inner.querySelector(':scope > .company-fs-shell')) {
      inner.classList.add('art-m-company');
      return;
    }
    const children = [...inner.children];
    if (!children.length) return;
    // 已是结构化则跳过
    if (inner.querySelector(':scope > .art-m-head')) return;

    const head = document.createElement('header');
    head.className = 'art-m-head';
    const body = document.createElement('div');
    body.className = 'art-m-body';
    const foot = document.createElement('footer');
    foot.className = 'art-m-foot';

    const isTitle = (el) =>
      /^H[1-3]$/.test(el.tagName)
      || el.classList.contains('dice-pick-title')
      || el.classList.contains('art-title');
    const isFoot = (el) =>
      el.classList.contains('btn-row')
      || el.classList.contains('art-actions')
      || el.classList.contains('dice-face-grid'); // 骰子选择本身是主内容，不进 foot

    // dice-face-grid 进 body；仅 btn-row 进 foot
    const titles = children.filter(isTitle);
    const foots = children.filter((el) => el.classList.contains('btn-row') || el.classList.contains('art-actions'));
    const rests = children.filter((el) => !titles.includes(el) && !foots.includes(el));

    titles.forEach((t) => head.appendChild(t));
    // 副标题（紧跟标题的 p.dice-pick-sub 等）留在 rests 顶部
    rests.forEach((r) => body.appendChild(r));
    foots.forEach((f) => foot.appendChild(f));

    // 若 body 里混有 btn-row（嵌套），提到 foot
    body.querySelectorAll('.btn-row').forEach((b) => foot.appendChild(b));

    inner.innerHTML = '';
    if (titles.length) inner.appendChild(head);
    else {
      head.classList.add('empty');
      inner.appendChild(head);
    }
    inner.appendChild(body);
    if (foots.length || foot.children.length) inner.appendChild(foot);
    else {
      foot.classList.add('empty');
      inner.appendChild(foot);
    }

    // 通用 grid：子区域按钮组
    body.querySelectorAll('.modal-body, .stock-panel, .panel-section').forEach((el) => {
      el.classList.add('art-grid-block');
    });
  }

  closeModal() {
    this.el.modal.classList.add('hidden');
    this.el.modal?.classList.remove('company-fs');
    this.el.modalBox?.classList.remove(
      'company-wide', 'art-modal', 'art-layout-portrait', 'art-layout-wide',
      'art-layout-card', 'art-kind-notice', 'dice-pick-modal',
    );
    // 清掉残留 class 前缀
    if (this.el.modalBox) {
      [...this.el.modalBox.classList].forEach((c) => {
        if (c.startsWith('art-')) this.el.modalBox.classList.remove(c);
      });
    }
  }
  get modalOpen() { return !this.el.modal.classList.contains('hidden'); }

  _modalButtons() {
    return new Promise(res => {
      this.el.modalBox.querySelectorAll('[data-choice]').forEach(btn => {
        btn.onclick = () => { this.closeModal(); res(btn.dataset.choice); };
      });
    });
  }

  showThinking(name) {
    this._openModal(`<div class="card-display"><div class="card-icon">🤖</div><h2>${name} 思考中…</h2><div class="modal-body"><span class="muted">正在调用大模型决策</span></div></div>`);
  }

  /** 简单确认弹窗，返回 true/false */
  confirmAction(message, yesLabel = '确认', noLabel = '取消') {
    this._openModal(`
      <h2>🤝 确认操作</h2>
      <div class="modal-body"><p>${message}</p></div>
      <div class="btn-row">
        <button class="primary" data-choice="yes">${yesLabel}</button>
        <button data-choice="no">${noLabel}</button>
      </div>`);
    return this._modalButtons().then(c => c === 'yes');
  }

  // ---------- 决策弹窗 ----------
  promptBuy(player, tileIdx, game) {
    const t = TILES[tileIdx];
    let rentRows = '';
    if (t.type === 'property') {
      const labels = ['空地', '1级', '2级', '3级', '4级', '地标'];
      const mult = game.industryMult(t.color);
      const st = INDUSTRY_STATES[game.industry[t.color]];
      rentRows = `<p>行业：${INDUSTRIES[t.color].icon}${INDUSTRIES[t.color].name} ${st.icon}${st.name}（租金×${mult}）</p>
        <table>${t.rents.map((r, i) => `<tr><td>${labels[i]}</td><td>${formatMoney(Math.max(1, Math.round(r * mult)))}</td></tr>`).join('')}</table>`;
    } else if (t.type === 'railroad') {
      rentRows = `<p>租金按拥有枢纽数：${RAILROAD_RENTS.map(formatMoney).join(' / ')}</p>`;
    } else {
      rentRows = '<p>租金 = 骰子点数 × 4（集齐两家 ×10）</p>';
    }
    this._openModal(`
      <h2>收购 ${t.name}？</h2>
      <div class="modal-body">
        <p>售价：<b style="color:var(--gold)">${formatMoney(t.price)}</b>　你的现金：${formatMoney(player.money)}</p>
        ${t.type === 'property' ? `<p>建筑成本：${formatMoney(t.houseCost)}/级</p>` : ''}
        ${rentRows}
      </div>
      <div class="btn-row">
        <button class="primary" data-choice="buy">💰 收购</button>
        <button data-choice="skip">放弃</button>
      </div>`);
    return this._modalButtons().then(c => c === 'buy');
  }

  promptJail(player, { canPay, hasCard }) {
    const options = [];
    if (hasCard) {
      options.push({
        id: 'card',
        label: '免于约谈卡',
        icon: '🃏',
        meta: '消耗 1 张免谈卡',
      });
    }
    if (canPay) {
      options.push({
        id: 'pay',
        label: '缴纳保证金',
        icon: '💸',
        meta: formatMoney(JAIL_FINE),
      });
    }
    options.push({
      id: 'roll',
      label: '掷双数碰运气',
      icon: '🎲',
      meta: `第 ${player.jailTurns + 1}/3 次`,
    });
    return this.openPickOverlay({
      title: `⚖️ ${player.name} · 监管约谈`,
      sub: '选择脱身方式',
      options,
      cols: options.length,
      cancelLabel: null,
    });
  }

  promptItemUse(player, item, ctx) {
    const meta = ITEMS[item] || { icon: '🃏', name: item };
    return this.openPickOverlay({
      title: `${meta.icon} 使用${meta.name}？`,
      sub: `即将支付租金 ${formatMoney(ctx.rent)} · 剩余 ${player.items.rentFree || 0} 张`,
      options: [
        {
          id: 'yes',
          label: '使用免租卡',
          icon: meta.icon || '🛡️',
          meta: `免除 ${formatMoney(ctx.rent)}`,
        },
        {
          id: 'no',
          label: '不使用',
          icon: '💰',
          meta: '照常付租',
        },
      ],
      cols: 2,
      cancelLabel: null,
    }).then((c) => c === 'yes');
  }

  /**
   * 风口/风险卡：HUD 全息投影展示（自研贴图框 + 扫描光效）
   * auto=true 时自动关闭，不阻塞对手视角过久
   */
  showCard(card, deck, auto = false) {
    const isChance = deck === 'chance';
    return this.showHoloNotice({
      kind: isChance ? 'chance' : 'chest',
      icon: isChance ? '🌪️' : '⚠️',
      title: isChance ? '风 口' : '风 险',
      text: card?.text || '',
      auto,
      // 自动关闭：多停留一会儿方便读文案
      duration: auto ? 4200 : 0,
    });
  }

  /**
   * HUD 全息通知卡
   * @param {{ kind?: 'chance'|'chest'|'notice', icon?: string, title?: string, text?: string, auto?: boolean, duration?: number }} opts
   */
  showHoloNotice({
    kind = 'notice',
    icon = '📡',
    title = '通 知',
    text = '',
    auto = false,
    duration = 0,
  } = {}) {
    const hud = this.el.holoHud || document.getElementById('holo-hud');
    if (!hud) {
      // 兜底：旧 modal
      this._openModal(`
        <div class="card-display">
          <div class="card-icon">${icon}</div>
          <h2>${title}</h2>
          <div class="modal-body">${text}</div>
          <div class="btn-row"><button class="primary" data-choice="ok">确 定</button></div>
        </div>`);
      if (auto) return new Promise(res => setTimeout(() => { this.closeModal(); res(); }, duration || 3800));
      return this._modalButtons();
    }

    hud.className = `interactive ${kind}${auto ? ' auto' : ''}`;
    const iconEl = hud.querySelector('.holo-card-icon');
    const titleEl = hud.querySelector('.holo-card-title');
    const textEl = hud.querySelector('.holo-card-text');
    const okBtn = hud.querySelector('.holo-card-ok');
    const frameEl = hud.querySelector('.holo-card-frame') || hud.querySelector('.holo-card-wrap');
    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    // 不再套绿幕金框（易挡内容/按钮）
    if (frameEl) {
      frameEl.style.backgroundImage = '';
      frameEl.classList?.remove?.('keyed-frame');
    }
    hud.classList.remove('hidden');

    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        hud.classList.add('hidden');
        hud.classList.remove('interactive', 'auto', 'chance', 'chest', 'notice');
        if (okBtn) okBtn.onclick = null;
        clearTimeout(this._holoT);
        resolve();
      };
      if (okBtn) okBtn.onclick = finish;
      if (auto) {
        this._holoT = setTimeout(finish, duration || 3800);
      }
      // 点击背景也可关（非 auto）
      if (!auto) {
        const onBg = (e) => {
          if (e.target === hud) {
            hud.removeEventListener('click', onBg);
            finish();
          }
        };
        hud.addEventListener('click', onBg);
      }
    });
  }

  /**
   * 系统通知：若未走聊天弹幕，则用全息卡补强展示
   * @param {string} text
   * @param {{ icon?: string, title?: string, forceHolo?: boolean, skipChat?: boolean }} [opts]
   */
  notify(text, opts = {}) {
    const { icon = '📡', title = '系统通知', forceHolo = false, skipChat = true } = opts;
    // 重要通知默认走全息；轻提示仍可用 toast
    if (forceHolo || (text && text.length >= 8)) {
      return this.showHoloNotice({
        kind: 'notice',
        icon,
        title,
        text,
        auto: true,
        duration: Math.min(4200, 1800 + text.length * 40),
      });
    }
    this.toast(text);
    return Promise.resolve();
  }

  showGameOver(winner, game) {
    const rows = game.players.map(p =>
      `<div>${p.bankrupt ? '💀' : '🙂'} ${p.name} —— 现金 ${formatMoney(p.money)}，债务 ${formatMoney(p.debt)}，地产 ${game.playerProperties(p.id).length} 处，总身价 <b style="color:var(--gold)">${formatMoney(game.netWorth(p))}</b></div>`
    ).join('');
    this._openModal(`
      <h2>🏆 游戏结束</h2>
      <div class="modal-body" style="text-align:center;font-size:22px;">
        <b style="color:var(--gold)">${winner.name}</b> 加冕商业帝国！
      </div>
      <div class="gameover-stats">${rows}</div>
      <div class="btn-row"><button class="primary big" data-choice="again">🔄 再来一局</button></div>`);
    return this._modalButtons();
  }

  // ---------- 银行 ----------
  openBank(game, player, onChange) {
    const render = () => {
      const limit = game.creditLimit(player);
      const avail = limit - player.debt;
      let mortgageRows = '';
      for (const i of game.playerProperties(player.id)) {
        const t = TILES[i];
        const mort = game.isMortgaged(i);
        const h = game.houses[i];
        mortgageRows += `<div class="panel-row">
          <span class="grow">${ownable(t) && t.type === 'property' ? INDUSTRIES[t.color].icon : ''}${t.name}
            ${h > 0 ? `<span class="tag">${h}级</span>` : ''} ${mort ? '<span class="mort-flag">已抵押</span>' : ''}</span>
          ${mort
            ? `<button data-unmort="${i}" ${game.canUnmortgage(player, i) ? '' : 'disabled'}>赎回 ${formatMoney(game.unmortgageCost(i))}</button>`
            : `<button data-mort="${i}" ${game.canMortgage(player, i) ? '' : 'disabled'}>抵押 +${formatMoney(game.mortgageValue(i))}</button>`}
        </div>`;
      }
      if (!mortgageRows) mortgageRows = '<p class="muted">你还没有地产</p>';
      this._openModal(`
        <h2>🏦 帝国银行</h2>
        <div class="modal-body">
          <div class="panel-section">
            <h3>💰 信贷 <small class="muted">每回合债务计息 5%（利滚利）</small></h3>
            <div class="panel-row"><span class="grow">现金 <b style="color:var(--gold)">${formatMoney(player.money)}</b>　债务 <b class="debt">${formatMoney(player.debt)}</b></span></div>
            <div class="panel-row"><span class="grow">信用额度 ${formatMoney(limit)}，可用 <b>${formatMoney(avail)}</b></span></div>
            <div class="panel-row">
              <span>借款：</span>
              ${[ttc(100), ttc(300), ttc(500)].map(v => `<button data-borrow="${v}" ${game.canBorrow(player, v) ? '' : 'disabled'}>+${formatMoney(v)}</button>`).join('')}
            </div>
            <div class="panel-row">
              <span>还款：</span>
              ${[ttc(100), ttc(500)].map(v => `<button data-repay="${v}" ${player.debt > 0 && player.money > 0 ? '' : 'disabled'}>-${formatMoney(v)}</button>`).join('')}
              <button data-repay="all" ${player.debt > 0 && player.money > 0 ? '' : 'disabled'}>还清</button>
            </div>
          </div>
          <div class="panel-section">
            <h3>🏢 地产抵押 <small class="muted">抵押得 50% 市值，赎回加价 10%；抵押期间不收租、有建筑不可抵押</small></h3>
            ${mortgageRows}
          </div>
        </div>
        <div class="btn-row"><button class="primary" data-close>关 闭</button></div>`);

      this.el.modalBox.querySelectorAll('[data-borrow]').forEach(b => b.onclick = () => {
        game.borrow(player, +b.dataset.borrow); onChange(); render();
      });
      this.el.modalBox.querySelectorAll('[data-repay]').forEach(b => b.onclick = () => {
        const v = b.dataset.repay === 'all' ? player.debt : +b.dataset.repay;
        game.repay(player, v); onChange(); render();
      });
      this.el.modalBox.querySelectorAll('[data-mort]').forEach(b => b.onclick = () => {
        const i = +b.dataset.mort;
        if (game.canMortgage(player, i)) { game.mortgage(player, i); onChange(); render(); }
      });
      this.el.modalBox.querySelectorAll('[data-unmort]').forEach(b => b.onclick = () => {
        const i = +b.dataset.unmort;
        if (game.canUnmortgage(player, i)) { game.unmortgage(player, i); onChange(); render(); }
      });
      this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
    };
    render();
  }

  // ---------- 公司 HQ 面板 ----------
  openCompany(game, player, onChange) {
    const render = () => {
      this.el.modalBox.classList.add('company-wide');
      this.el.modal?.classList.add('company-fs');
      if (!player.company) {
        this._renderFoundCompany(game, player, onChange, render);
        return;
      }
      this._renderCompanyHQ(game, player, onChange, render);
    };
    render();
  }

  _renderFoundCompany(game, player, onChange, render) {
    const canFound = game.canFoundCompany(player);
    const charters = player.items?.charter || 0;
    const cards = Object.entries(INDUSTRIES)
      .filter(([k]) => k !== 'railroad' && k !== 'utility')
      .map(([k, ind]) => {
        const st = INDUSTRY_STATES[game.industry[k] ?? 1];
        const owned = game.playerProperties(player.id)
          .filter(i => TILES[i].type === 'property' && TILES[i].color === k).length;
        return `<button type="button" class="co-found-card" data-ind="${k}" ${canFound ? '' : 'disabled'}
          style="border-color:${ind.css}44;--ind:${ind.css}">
          <div class="fi">${ind.icon}</div>
          <div class="fn">${ind.name}</div>
          <div class="fs">景气 ${st.icon}${st.name} · 营收×${st.mult}</div>
          <div class="fm">
            <span>你持有地产 ${owned} 块</span>
            <span style="color:${ind.css}">选此赛道</span>
          </div>
        </button>`;
      }).join('');

    this.el.modal?.classList.add('company-fs');
    this._openModal(`
      <div class="company-fs-shell">
        <header class="company-fs-head co-hero" style="background:linear-gradient(135deg,#1a2a44,#0c1524)">
          <div class="co-hero-top">
            <div class="co-hero-icon">🏢</div>
            <div class="co-hero-meta">
              <h2>创办商业帝国</h2>
              <div class="co-sub">注册费 <b style="color:var(--gold)">${formatMoney(COMPANY_FOUND_COST)}</b>
                · 消耗 📜 公司卡 ×1（持有 <b style="color:${charters > 0 ? '#7dffa0' : '#ff8a80'}">${charters}</b>）
                · 现金 ${formatMoney(player.money)}
                · 最高 Lv${COMPANY_MAX_LEVEL}</div>
              <div class="co-sub" style="margin-top:6px">创办/升级公司都需要公司卡。每回合营收 = 基础 × 行业景气；可 IPO、质押贷款。</div>
              ${charters < 1 ? '<div class="co-sub" style="margin-top:6px;color:#e67e22">⚠️ 没有公司卡，无法创办。</div>' : ''}
            </div>
          </div>
        </header>
        <div class="company-fs-body co-found-layout">
          <div class="co-panel co-panel-span">
            <h3>选择赛道</h3>
            <div class="co-found-grid">${cards}</div>
          </div>
        </div>
        <footer class="company-fs-foot btn-row">
          <button type="button" data-close>再想想</button>
        </footer>
      </div>`, { layout: 'wide', kind: 'company' });

    this.el.modalBox.querySelectorAll('[data-ind]').forEach(b => {
      b.onclick = () => {
        if (!game.canFoundCompany(player)) {
          this.toast(charters < 1 ? '需要 📜 公司卡才能创办' : '现金不足或已有公司');
          return;
        }
        if (!game.foundCompany(player, b.dataset.ind)) { this.toast('创办失败'); return; }
        const ind = INDUSTRIES[player.company.industry];
        this.log(`${player.name} 消耗公司卡，创办了 ${ind.icon}${ind.name} 公司！`, 'good');
        onChange();
        render();
      };
    });
    this.el.modalBox.querySelector('[data-close]').onclick = () => {
      this.el.modalBox.classList.remove('company-wide');
      this.el.modal?.classList.remove('company-fs');
      this.closeModal();
    };
  }

  _renderCompanyHQ(game, player, onChange, render) {
    const c = player.company;
    const ind = INDUSTRIES[c.industry] || { icon: '🏢', name: '公司', css: '#888', hex: 0x888888 };
    const st = INDUSTRY_STATES[game.industry[c.industry] ?? 1];
    const upCost = companyUpgradeCost(c.level);
    const unit = game.companySharePrice(player);
    const value = game.companyValue(player);
    const pool = game.companyProfitPool(player);
    const myRev = game.companyRevenue(player);
    const held = c.holders?.[player.id] ?? 0;
    const pledged = c.pledged || 0;
    const floatN = c.freeFloat || 0;
    const total = c.totalShares || 100;
    const myEff = game.effectiveCompanyShares(player, player.id);
    const myPct = ((myEff / total) * 100).toFixed(1);
    const heldFree = Math.max(0, held - pledged);

    // 股权条：自己有效 | 自己质押 | 公众池 | 其他股东
    let others = 0;
    const holders = [];
    for (const [pid, n] of Object.entries(c.holders || {})) {
      const id = +pid;
      if (id === player.id) continue;
      others += n;
      const p = game.players[id];
      holders.push({ id, name: p?.name || `玩家${id}`, n, isYou: false });
    }
    holders.unshift({ id: player.id, name: player.name, n: held, isYou: true, pledged });
    holders.sort((a, b) => b.n - a.n);

    const pct = (n) => Math.max(0, (n / total) * 100);
    const barHeld = pct(heldFree);
    const barPledged = pct(pledged);
    const barFloat = pct(floatN);
    const barOthers = pct(others);

    // 对外投资
    const investRows = [];
    for (const other of game.players) {
      if (other.id === player.id || !other.company) continue;
      const sh = other.company.holders?.[player.id] || 0;
      if (sh <= 0) continue;
      const oind = INDUSTRIES[other.company.industry];
      const div = game.companyInvestorDividend(player, other);
      investRows.push({ other, sh, oind, div, price: game.companySharePrice(other) });
    }

    const lvPct = Math.round((c.level / COMPANY_MAX_LEVEL) * 100);
    const charters = player.items?.charter || 0;
    const canUp = game.canUpgradeCompany(player);
    const canIpo = game.canIPO(player);
    const canPledge = game.canPledgeShares(player, 5);
    const canUnpledge = (c.pledged || 0) > 0;
    const sellable = game.founderSellableShares?.(player) || 0;
    const hasTargets = game.players.some(o => o.id !== player.id && !o.bankrupt && o.money >= unit);

    this.el.modal?.classList.add('company-fs');
    this._openModal(`
      <div class="company-fs-shell">
        <header class="company-fs-head co-hero" style="background:
          radial-gradient(ellipse 70% 100% at 100% 0%, ${ind.css}33, transparent 55%),
          linear-gradient(135deg, #152238, #0b1320)">
          <div class="co-hero-top">
            <div class="co-hero-icon" style="border-color:${ind.css}88;box-shadow:0 0 24px ${ind.css}44">${ind.icon}</div>
            <div class="co-hero-meta">
              <h2>
                ${player.name} · ${ind.name}
                <span class="co-badge lv">Lv${c.level}/${COMPANY_MAX_LEVEL}</span>
                ${c.ipo
                  ? '<span class="co-badge ipo">IPO 上市</span>'
                  : '<span class="co-badge private">未上市</span>'}
              </h2>
              <div class="co-sub">${ind.icon} ${ind.name} 赛道 · 景气 ${st.icon}<b>${st.name}</b>（营收×${st.mult}）
                · 现金 ${formatMoney(player.money)}
                · 📜 公司卡 <b style="color:${charters > 0 ? '#7dffa0' : '#ff8a80'}">${charters}</b></div>
              <div class="co-lv-bar"><div class="co-lv-fill" style="width:${lvPct}%"></div></div>
            </div>
          </div>
        </header>

        <div class="company-fs-body">
          <div class="co-panel co-panel-kpis">
            <div class="co-kpi-grid">
              <div class="co-kpi">
                <div class="k">公司估值</div>
                <div class="v">${formatMoney(value)}</div>
                <div class="hint">注册+升级累计</div>
              </div>
              <div class="co-kpi">
                <div class="k">每股公允价</div>
                <div class="v">${formatMoney(unit)}</div>
                <div class="hint">景气×资讯</div>
              </div>
              <div class="co-kpi">
                <div class="k">本回合你的营收</div>
                <div class="v">${formatMoney(myRev)}</div>
                <div class="hint">池 ${formatMoney(pool)} × ${myPct}%</div>
              </div>
              <div class="co-kpi">
                <div class="k">控制权（有效）</div>
                <div class="v soft">${myEff} 股 · ${myPct}%</div>
                <div class="hint">质押股不分红</div>
              </div>
            </div>
          </div>

          <div class="co-panel co-panel-eq">
            <h3>股权结构</h3>
            <div class="co-eq-bar">
              <span class="held" style="width:${barHeld}%" title="你持有"></span>
              <span class="pledged" style="width:${barPledged}%" title="质押"></span>
              <span class="others" style="width:${barOthers}%" title="其他股东"></span>
              <span class="float" style="width:${barFloat}%" title="公众池"></span>
            </div>
            <div class="co-eq-legend">
              <span><i style="background:#6eb0ff"></i>你持有 ${heldFree}</span>
              <span><i style="background:#f39c12"></i>质押 ${pledged}</span>
              <span><i style="background:#9b59b6"></i>外部 ${others}</span>
              <span><i style="background:#2ecc71"></i>公众池 ${floatN}</span>
              <span>总股本 ${total}</span>
            </div>
            <div class="co-table-wrap">
              <table class="co-table">
                <thead><tr><th>股东</th><th class="right">持股</th><th class="right">占比</th><th class="right">备注</th></tr></thead>
                <tbody>
                  ${holders.map(h => `
                    <tr class="${h.isYou ? 'you' : ''}">
                      <td class="${h.isYou ? 'you' : ''}">${h.isYou ? '👑 ' : ''}${h.name}</td>
                      <td class="right">${h.n}</td>
                      <td class="right">${((h.n / total) * 100).toFixed(1)}%</td>
                      <td class="right muted">${h.isYou && h.pledged ? `质押 ${h.pledged}` : (h.isYou ? '创始人' : '入股')}</td>
                    </tr>`).join('')}
                  ${floatN > 0 ? `<tr><td>🌐 公众流通</td><td class="right">${floatN}</td><td class="right">${((floatN / total) * 100).toFixed(1)}%</td><td class="right muted">可买入</td></tr>` : ''}
                </tbody>
              </table>
            </div>
          </div>

          <div class="co-panel co-panel-invest">
            <h3>对外投资组合</h3>
            ${investRows.length ? `
              <div class="co-invest-list">
                ${investRows.map(r => `
                  <div class="co-invest-row">
                    <span>${r.oind?.icon || '🏢'}</span>
                    <span class="grow"><b>${r.other.name}</b> · ${r.oind?.name || ''}
                      <span class="muted">×${r.sh} 股 · 市价 ${formatMoney(r.price)}</span></span>
                    <span style="color:var(--gold)">股息 ${formatMoney(r.div)}/回合</span>
                  </div>`).join('')}
              </div>` : '<p class="muted co-empty">暂无对外持股 · 可在「入股」买入他人公司</p>'}
          </div>

          <div class="co-panel co-panel-ops">
            <h3>经营操作</h3>
            <div class="co-actions">
              <button type="button" class="co-act primary-act" data-up ${canUp ? '' : 'disabled'}>
                <div class="t">⬆️ 升级总部 ${c.level < COMPANY_MAX_LEVEL ? `→ Lv${c.level + 1}` : '(已满级)'}</div>
                <div class="d">${c.level < COMPANY_MAX_LEVEL
                  ? `费用 ${formatMoney(upCost)} · 消耗 📜 公司卡 ×1 · 提升估值与分红池`
                  : '已达最高等级'}</div>
              </button>
              <button type="button" class="co-act" data-ipo ${canIpo ? '' : 'disabled'}>
                <div class="t">📢 ${c.ipo ? '已完成 IPO' : '启动 IPO 上市'}</div>
                <div class="d">${c.ipo
                  ? '公众池已开放，他人可买入'
                  : `需 Lv≥${COMPANY_IPO_MIN_LEVEL} · 抛出 30 股套现 ≈ ${formatMoney(unit * 30)}`}</div>
              </button>
              <button type="button" class="co-act danger-act" data-pledge ${canPledge ? '' : 'disabled'}>
                <div class="t">🏦 质押 5 股贷款</div>
                <div class="d">到账约 ${formatMoney(5 * (SHARE_PLEDGE_LOAN * Math.max(1, c.level)))} · 质押股不分红</div>
              </button>
              <button type="button" class="co-act" data-unpledge ${canUnpledge ? '' : 'disabled'}>
                <div class="t">🔓 赎回质押股</div>
                <div class="d">${canUnpledge ? `当前质押 ${pledged} 股 · 用现金赎回恢复分红` : '当前无质押股份'}</div>
              </button>
            </div>
            <p class="muted co-ops-tip">
              他人可通过「入股」买入你的股份（公允价即时成交）。监管智能体可能抽查高杠杆与 IPO 控制权。
            </p>
            ${sellable > 0 ? `
              <button type="button" class="co-act" data-private ${!hasTargets ? 'disabled' : ''} style="background:linear-gradient(135deg,#2a5a3a,#1a3a2a);border-color:#4a8">
                <div class="t">🤝 私募融资</div>
                <div class="d">可卖出 <b>${sellable}</b> 股 · 公允价 ${formatMoney(unit)}/股 · 定向寻找投资者</div>
              </button>` : ''}
          </div>
        </div>

        <footer class="company-fs-foot btn-row">
          <button type="button" class="primary" data-close>完 成</button>
        </footer>
      </div>`, { layout: 'wide', kind: 'company' });

    const bind = (sel, fn) => {
      const el = this.el.modalBox.querySelector(sel);
      if (el) el.onclick = fn;
    };
    bind('[data-up]', () => {
      if (!game.canUpgradeCompany(player)) {
        this.toast((player.items?.charter || 0) < 1 ? '需要 📜 公司卡才能升级' : '无法升级（现金/等级）');
        return;
      }
      if (!game.upgradeCompany(player)) { this.toast('升级失败'); return; }
      this.log(`${player.name} 消耗公司卡，公司升级到 Lv${player.company.level}！`, 'good');
      onChange(); render();
    });
    bind('[data-ipo]', () => {
      const r = game.doIPO(player);
      if (!r) { this.toast('暂不可 IPO'); return; }
      this.log(`${player.name} 公司 IPO！抛出 ${r.n} 股，套现 <span class="gold">${formatMoney(r.raised)}</span>`, 'good');
      onChange(); render();
    });
    bind('[data-pledge]', () => {
      const r = game.pledgeSharesForLoan(player, 5);
      if (!r) { this.toast('无法质押'); return; }
      this.log(`${player.name} 质押公司股 ${r.n} 手，获贷 ${formatMoney(r.loan)}`, 'card');
      onChange(); render();
    });
    bind('[data-unpledge]', () => {
      const n = Math.min(5, player.company.pledged || 0);
      const r = game.unpledgeShares(player, n);
      if (!r) { this.toast('赎回失败（现金不足或无质押）'); return; }
      this.log(`${player.name} 赎回质押股 ${r.n} 手（${formatMoney(r.cost)}）`, 'good');
      onChange(); render();
    });
    bind('[data-private]', async () => {
      const targets = game.players.filter(o => o.id !== player.id && !o.bankrupt && o.money >= unit);
      if (!targets.length) { this.toast('没有玩家买得起'); return; }
      const tid = await this.askPlayer('🤝 私募融资 · 选择投资者', targets);
      if (tid == null) return;
      const t = game.players[tid];
      const maxN = Math.min(sellable, Math.floor(t.money / unit));
      if (maxN <= 0) { this.toast('对方资金不足'); return; }
      const nOpts = [1, 2, 5, 10].filter(n => n <= maxN);
      if (maxN > 0 && !nOpts.includes(maxN)) nOpts.push(maxN);
      const n = await this.openPickOverlay({
        title: `私募 · 出售给 ${t.name}`,
        sub: `价格 ${formatMoney(unit)}/股 · 对方现金 ${formatMoney(t.money)}`,
        options: nOpts.map(v => ({ id: v, label: `${v} 股`, meta: `共 ${formatMoney(unit * v)}` })),
      });
      if (n == null) return;
      // 目标方同意确认
      if (!t.isAI) {
        const ok = await this.confirmAction(
          `🤝 ${player.name} 想向你私募出售 ${n} 股（每股 ${formatMoney(unit)}，共 ${formatMoney(unit * n)}）`,
          '接受', '拒绝'
        );
        if (!ok) return;
      }
      const r = game.investCompany?.(t, player, +n, false);
      if (!r) { this.toast('交易失败'); return; }
      this.log(`${player.name} 私募出售 ${r.n} 股给 ${t.name}（${formatMoney(r.cost)}）`, 'good');
      onChange(); render();
    });
    bind('[data-close]', () => {
      this.el.modalBox.classList.remove('company-wide');
      this.el.modal?.classList.remove('company-fs');
      this.closeModal();
    });
  }

  // ---------- 入股（全屏铺满） ----------
  /** 公允价即时入股其他玩家公司；全屏卡片网格 */
  openInvest(game, me, onChange, opts = {}) {
    if (this.modalOpen) return;
    this._investUi?.close?.();
    import('./investMarket.js').then(({ openInvestMarket }) => {
      this._investUi = openInvestMarket(game, me, onChange, {
        log: (html, cls) => this.log(html, cls),
        toast: (m) => this.toast(m),
      }, {}, { tradeable: opts.tradeable !== false && opts.readOnly !== true });
    });
  }

  /** @deprecated 保留别名，交易已改为入股 */
  openTrade(game, me, onPropose) {
    this.openInvest(game, me, () => onPropose?.({ invested: true }));
  }

  promptBankPledge(player, { shares, loan }) {
    this._openModal(`
      <h2>🏦 银行智能体</h2>
      <div class="modal-body">
        <p>检测到你现金紧张。可用公司股质押贷款：</p>
        <p>质押 <b>${shares}</b> 手 → 到账 <b style="color:var(--gold)">${formatMoney(loan)}</b></p>
        <p class="muted">质押期间该部分股份不参与分红；债务仍计息。</p>
      </div>
      <div class="btn-row">
        <button class="primary" data-choice="yes">接受质押贷款</button>
        <button data-choice="no">拒绝</button>
      </div>`);
    return this._modalButtons().then(c => c === 'yes');
  }

  /** 交易结果展示（AI 回应） */
  showTradeResponse(sellerName, decision, counterPrice, say) {
    const heads = { accept: '✅ 同意成交', reject: '❌ 拒绝交易', counter: '💬 提出还价' };
    const body = decision === 'counter'
      ? `<p>对方还价 <b style="color:var(--gold)">${formatMoney(counterPrice)}</b></p>`
      : '';
    this._openModal(`
      <h2>${heads[decision]}</h2>
      <div class="modal-body">
        <p><b>${sellerName}</b>：「${say}」</p>
        ${body}
      </div>
      <div class="btn-row">
        ${decision === 'counter' ? '<button class="primary" data-choice="accept">接受还价</button>' : ''}
        <button data-choice="close">${decision === 'counter' ? '放弃' : '好的'}</button>
      </div>`);
    return this._modalButtons();
  }

  /** 交易确认弹窗（由交易"对方"确认）：responder='seller' 卖方确认 / 'buyer' 买方确认 */
  promptIncomingTrade({ buyerName, sellerName, tileIdx, price, responder = 'seller', buyerMoney = 0 }) {
    const t = TILES[tileIdx];
    const text = responder === 'buyer'
      ? `<p><b>${sellerName}</b> 想把 <b>${t.name}</b> 以 <b style="color:var(--gold)">${formatMoney(price)}</b> 卖给你（市值 ${formatMoney(t.price)}，你的现金 ${formatMoney(buyerMoney)}）。</p><p class="muted">由买方玩家确认</p>`
      : `<p><b>${buyerName}</b> 想出价 <b style="color:var(--gold)">${formatMoney(price)}</b> 收购你的 <b>${t.name}</b>（市值 ${formatMoney(t.price)}）。</p><p class="muted">由卖方玩家确认</p>`;
    this._openModal(`
      <h2>🤝 交易要约</h2>
      <div class="modal-body">${text}</div>
      <div class="btn-row">
        <button class="primary" data-choice="accept">✅ 同意</button>
        <button class="danger" data-choice="reject">❌ 拒绝</button>
      </div>`);
    return this._modalButtons();
  }

  // ---------- 股市（全屏 K 线 + 公告轮播） ----------
  /** @param {{ tradeable?: boolean, readOnly?: boolean }} [opts] tradeable=false 时只读观战 */
  openStock(game, player, onChange, opts = {}) {
    const tradeable = opts.tradeable !== false && opts.readOnly !== true;
    import('./stockMarket.js').then(({ openStockMarket }) => {
      openStockMarket(game, player, onChange, {
        log: (html, cls) => this.log(html, cls),
        toast: (m) => this.toast(m),
      }, {}, { tradeable, readOnly: !tradeable });
    });
  }

  // ---------- 建设 ----------
  openBuild(game, player, onChange) {
    const render = () => {
      const sets = game.buildableSets(player.id);
      const sellable = game.playerProperties(player.id).filter(i => game.houses[i] > 0);
      const permits = player.items?.permit || 0;
      let html = `<h2>🏠 楼宇建设
        <small style="color:#9ab">现金 ${formatMoney(player.money)}
          · 🏗️ 建设卡 <b style="color:${permits > 0 ? '#7dffa0' : '#ff8a80'}">${permits}</b>
          · 每建一级消耗 1 张建设卡 + 建楼费</small></h2><div class="modal-body">`;
      if (permits < 1) {
        html += '<p style="color:#e67e22">没有建设卡，无法建楼。风口/风险牌可获得建设卡；卖楼不需要卡。</p>';
      }
      if (sets.length === 0 && sellable.length === 0) {
        html += '<p>你还没有地产。<br/><small>买地后即可在此建楼（最多 5 级，第 5 级为地标大厦），楼宇会真实矗立在棋盘上。</small></p>';
      }
      for (const set of sets) {
        const g = INDUSTRIES[set.color];
        const st = INDUSTRY_STATES[game.industry[set.color]];
        html += `<div class="build-set"><h3>${g.icon} ${g.name} ${st.icon}（每级 ${formatMoney(TILES[set.tiles[0]].houseCost)} + 建设卡）</h3>`;
        for (const i of set.tiles) {
          const h = game.houses[i];
          const stars = h >= 5 ? '🏙️ 地标' : '🏬'.repeat(h) + '·'.repeat(4 - h);
          html += `<div class="build-prop">
            <span class="bp-name">${TILES[i].name}</span>
            <span class="bp-houses">${stars}</span>
            <button data-build="${i}" ${game.canBuild(player, i) ? '' : 'disabled'}>＋建</button>
            <button data-sell="${i}" ${game.canSellHouse(player, i) ? '' : 'disabled'}>－卖</button>
          </div>`;
        }
        html += '</div>';
      }
      html += `</div><div class="btn-row"><button class="primary" data-close>完 成</button></div>`;
      this._openModal(html);
      this.el.modalBox.querySelectorAll('[data-build]').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.build;
        if (!game.canBuild(player, i)) {
          this.toast((player.items?.permit || 0) < 1 ? '需要 🏗️ 建设卡' : '无法建设');
          return;
        }
        if (game.buyHouse(player, i)) {
          this.log(`${player.name} 消耗建设卡，在 ${TILES[i].name} 起了一级楼`, 'good');
          onChange();
          render();
        }
      });
      this.el.modalBox.querySelectorAll('[data-sell]').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.sell;
        if (game.canSellHouse(player, i)) { game.sellHouse(player, i); onChange(); render(); }
      });
      this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
    };
    render();
  }

  /** 拆迁卡目标选择 */
  openDemolish(game, player, onPick) {
    const targets = [];
    for (const other of game.players) {
      if (other.id === player.id || other.bankrupt) continue;
      for (const i of game.playerProperties(other.id)) {
        if (game.houses[i] > 0) targets.push({ i, owner: other });
      }
    }
    if (!targets.length) { this.toast('场上没有可拆除的建筑'); return; }
    targets.sort((a, b) => game.houses[b.i] - game.houses[a.i]);
    this._openModal(`
      <h2>💥 拆迁卡：选择目标</h2>
      <div class="modal-body">
        ${targets.slice(0, 8).map(({ i, owner }) => `
          <div class="panel-row">
            <span class="grow">${TILES[i].name}（${owner.name}，${game.houses[i] >= 5 ? '地标' : game.houses[i] + '级'}）</span>
            <button class="danger" data-target="${i}">拆除</button>
          </div>`).join('')}
      </div>
      <div class="btn-row"><button data-close>取消</button></div>`);
    this.el.modalBox.querySelectorAll('[data-target]').forEach(b => b.onclick = () => {
      this.closeModal();
      onPick(+b.dataset.target);
    });
    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
  }

  // ---------- AI 设置 ----------
  openSettings(client, onSave) {
    if (this.modalOpen) return;
    import('../llm/deepseek.js').then(({ DEEPSEEK_MODELS }) => {
      const models = DEEPSEEK_MODELS || [];
      const modelOpts = models.map((m) =>
        `<option value="${m.id}" ${client.model === m.id ? 'selected' : ''}>${m.label}</option>`,
      ).join('');
      this._openModal(`
      <h2>⚙️ DeepSeek AI 设置</h2>
      <div class="modal-body">
        <p class="muted" style="margin-bottom:10px;line-height:1.5">
          官方文档：api-docs.deepseek.com · base_url =
          <code>https://api.deepseek.com</code> · 开发环境走 <code>/ds</code> 代理。
          配置 Key 后：购地 / 交易谈判 / 聊天 / 部分回合决策走大模型；未配置则本地启发式。
        </p>
        <div class="settings-row">
          <label>API Key（仅存本机 localStorage，直发 DeepSeek）</label>
          <input type="password" id="set-key" placeholder="sk-..." value="${client.key || ''}" autocomplete="off" />
        </div>
        <div class="settings-row">
          <label>模型</label>
          <select id="set-model">
            ${modelOpts || `
              <option value="deepseek-v4-flash" selected>deepseek-v4-flash</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro</option>`}
          </select>
        </div>
        <div class="settings-row">
          <label>思考模式（V4 thinking）</label>
          <select id="set-think">
            <option value="auto" ${client.thinking === 'auto' ? 'selected' : ''}>auto（决策关·聊天按模型）</option>
            <option value="disabled" ${client.thinking === 'disabled' ? 'selected' : ''}>disabled 非思考（更快更省）</option>
            <option value="enabled" ${client.thinking === 'enabled' ? 'selected' : ''}>enabled 思考模式</option>
          </select>
        </div>
        <div class="settings-row">
          <label>自定义完整接口 URL（留空自动：/ds/chat/completions → api.deepseek.com）</label>
          <input type="text" id="set-ep" placeholder="https://api.deepseek.com/chat/completions" value="${client.endpoint || ''}" />
        </div>
        <div id="settings-status" class="muted">
          ${client.enabled
            ? `已配置 · 模型 ${client.model} · 调用 ${client.stats.calls} 次 / ${client.stats.tokens} tokens`
            : '未配置 Key → AI 使用内置策略 + 台词（不是 DeepSeek）'}
        </div>
      </div>
      <div class="btn-row">
        <button class="primary" id="set-save">保存</button>
        <button id="set-test">测试连接</button>
        <button data-close>关闭</button>
      </div>`, { layout: 'wide', kind: 'settings' });

      const applySave = () => {
        client.save(
          $('#set-key')?.value,
          $('#set-model')?.value,
          $('#set-ep')?.value,
          $('#set-think')?.value,
        );
      };
      $('#set-save').onclick = () => {
        applySave();
        $('#settings-status').textContent = client.enabled
          ? `✅ 已保存 · ${client.model} 已上线`
          : '已保存（未配置 Key，仍用本地策略）';
        onSave?.();
      };
      $('#set-test').onclick = async () => {
        $('#settings-status').textContent = '⏳ 测试中…';
        applySave();
        const r = await client.test();
        $('#settings-status').textContent = r.ok
          ? `✅ 连接成功（${r.ms}ms）：${r.reply}`
          : `❌ 连接失败：${r.error || '请检查 Key / 网络 / 接口'}`;
      };
      this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
    });
  }

  // ---------- 格子信息 ----------
  showTileInfo(tileIdx, game, x, y) {
    const t = TILES[tileIdx];
    let html = '';
    if (t.type === 'property') {
      const ind = INDUSTRIES[t.color];
      const mult = game.industryMult(t.color);
      const ownerId = game.owner?.[tileIdx] ?? -1;
      const boost = game.industryRentBoost?.(t.color, ownerId >= 0 ? ownerId : null) ?? 1;
      const totalMult = mult * boost;
      const st = INDUSTRY_STATES[game.industry[t.color]];
      const labels = ['空地', '1级', '2级', '3级', '4级', '地标'];
      const boostTip = boost > 1.001
        ? ` · 抬租×${boost.toFixed(2)}（购产热度+业主持股）`
        : '';
      html = `<div class="color-bar" style="background:${ind.css}"></div>
        <h3>${ind.icon} ${t.name}</h3>
        <p>${ind.name} · ${st.icon}${st.name}（景气×${mult}${boostTip}）</p>
        <p>售价 ${formatMoney(t.price)} · 建楼 ${formatMoney(t.houseCost)}/级</p>
        <table>${t.rents.map((r, i) => `<tr><td>${labels[i]}</td><td>${formatMoney(Math.max(1, Math.round(r * totalMult)))}</td></tr>`).join('')}</table>`;
    } else if (t.type === 'railroad') {
      html = `<h3>🚄 ${t.name}</h3><p>售价 ${formatMoney(t.price)}</p><p>租金（按拥有枢纽数）：${RAILROAD_RENTS.map(formatMoney).join(' / ')}</p>`;
    } else if (t.type === 'utility') {
      html = `<h3>${t.name}</h3><p>售价 ${formatMoney(t.price)}</p><p>租金 = 骰子点数 × ${formatMoney(ttc(4))}（集齐两家则 × ${formatMoney(ttc(10))}）</p>`;
    } else {
      const tip = {
        go: `经过或停留：融资到账 ${formatMoney(GO_SALARY)}`,
        tax: `缴纳 ${formatMoney(t.amount)}`,
        jail: '监管约谈 / 配合调查中',
        parking: '休假中，无事发生',
        gotojail: '违规经营，当场约谈！',
        chance: '抽一张风口卡',
        chest: '抽一张风险卡',
      }[t.type] || '';
      html = `<h3>${t.name}</h3><p>${tip}</p>`;
    }
    const owner = game.owner[tileIdx];
    if (owner >= 0) {
      const h = game.houses[tileIdx];
      html += `<p>所有者：<b style="color:${PLAYER_COLORS_CSS[owner]}">${game.players[owner].name}</b>${h > 0 ? (h >= 5 ? ' · 🏙️ 地标' : ` · 🏬 Lv${h}`) : ''}${game.isMortgaged(tileIdx) ? ' <span class="mort-flag">已抵押</span>' : ''}</p>`;
    } else if (ownable(t)) {
      html += '<p style="color:#080">待售中</p>';
    }
    this.el.tileInfo.innerHTML = html;
    this.el.tileInfo.classList.remove('hidden');
    this.el.tileInfo.style.left = Math.min(x + 16, innerWidth - 240) + 'px';
    this.el.tileInfo.style.top = Math.min(y + 16, innerHeight - 260) + 'px';
    clearTimeout(this._tileT);
    this._tileT = setTimeout(() => this.el.tileInfo.classList.add('hidden'), 4500);
  }

  /** 黑市面板：浏览挂单 / 买入 / 下架 / 待定价 */
  openBlackMarket(game, player, onChange) {
    const render = () => this.openBlackMarket(game, player, onChange);
    const market = game.blackMarket || [];
    const myListings = market.filter(e => e.sellerId === player.id);
    const otherListings = market.filter(e => e.sellerId !== player.id);
    const pending = player.pendingListings || [];
    const total = game.countItems(player);
    const room = Math.max(0, 10 - total);

    const listingRow = (e, isMine) => {
      const seller = game.players[e.sellerId] || { name: '???' };
      const meta = ITEMS[e.item] || { icon: '🃏', name: e.item };
      return `<div class="panel-row">
        <span class="grow">${meta.icon} ${meta.name} · ${seller.name} · <b style="color:var(--gold)">${formatMoney(e.price)}</b></span>
        ${isMine
          ? `<button data-bm="unlist" data-id="${e.id}" ${room <= 0 ? 'disabled' : ''}>下架</button>`
          : `<button data-bm="buy" data-id="${e.id}" ${room <= 0 ? 'disabled' : ''}>买入</button>`}
      </div>`;
    };

    const pendingRows = pending.length
      ? pending.map((item, idx) => {
        const meta = ITEMS[item] || { icon: '🃏', name: item };
        const base = (ITEM_MARKET_BASE || {})[item] || ttc(10);
        return `<div class="panel-row">
          <span class="grow">📦 待定价：${meta.icon} ${meta.name} · 参考 ${formatMoney(base)}</span>
          <button data-bm="price" data-idx="${idx}" data-val="${Math.round(base*0.5)}">½</button>
          <button data-bm="price" data-idx="${idx}" data-val="${base}">1×</button>
          <button data-bm="price" data-idx="${idx}" data-val="${Math.round(base*2)}">2×</button>
        </div>`;
      }).join('')
      : '';

    const html = `
      <h2>🏴 卡牌黑市 <small style="color:#9ab">手牌 ${total}/10 · 可买入 ${room} 张</small></h2>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto">
        ${pending.length
          ? `<h3 style="margin:8px 0 4px;color:#f0c75e">📦 待定价（${pending.length} 张）</h3>${pendingRows}<hr/>`
          : ''}
        ${myListings.length
          ? `<h3 style="margin:8px 0 4px;color:#9fd4ff">我的挂牌（${myListings.length}）</h3>${myListings.map(e => listingRow(e, true)).join('')}`
          : '<p class="muted">你还没有在售卡牌</p>'}
        <hr/>
        <h3 style="margin:8px 0 4px;color:#6dff9a">在售卡牌（${otherListings.length}）</h3>
        ${otherListings.length
          ? otherListings.map(e => listingRow(e, false)).join('')
          : '<p class="muted">暂无其他玩家挂售</p>'}
        ${room <= 0 ? '<p class="muted" style="color:#ff8a80">⚠️ 手牌已满，无法买入或下架</p>' : ''}
      </div>
      <div class="btn-row"><button data-close>关 闭</button></div>`;

    this._openModal(html);

    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();

    this.el.modalBox.querySelectorAll('[data-bm="buy"]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.id;
        const r = game.buyFromMarket?.(player, id);
        if (r) {
          this.log(`${player.name} 从黑市买入 ${ITEMS[r.item]?.icon || '🃏'}${r.item}（${formatMoney(r.price)}）`, 'good');
          onChange();
          render();
        } else { this.toast('买入失败（资金不足/手牌已满）'); }
      };
    });

    this.el.modalBox.querySelectorAll('[data-bm="unlist"]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.id;
        const r = game.unlistFromMarket?.(player, id);
        if (r) {
          this.log(`${player.name} 从黑市下架 ${ITEMS[r.item]?.icon || '🃏'}${r.item}`, 'card');
          onChange();
          render();
        } else { this.toast('下架失败（手牌已满）'); }
      };
    });

    this.el.modalBox.querySelectorAll('[data-bm="price"]').forEach(b => {
      b.onclick = () => {
        const idx = +b.dataset.idx;
        const val = +b.dataset.val;
        const item = pending[idx];
        if (!item) return;
        if (!player._pendingPrices) player._pendingPrices = {};
        player._pendingPrices[item] = val;
        b.parentElement.querySelectorAll('[data-bm="price"]').forEach(bb => bb.style.outline = '');
        b.style.outline = '2px solid var(--gold)';
        // 所有 pending 都定价后自动挂牌
        const allPriced = pending.every((it, i) => player._pendingPrices[it] !== undefined);
        if (allPriced) {
          const prices = { ...player._pendingPrices };
          player._pendingPrices = null;
          const listed = game.resolvePendingListings?.(player, prices) || [];
          if (listed.length) {
            this.log(`${player.name} 将 ${listed.length} 张卡牌挂上黑市`, 'card');
            onChange();
            render();
          }
        }
      };
    });
  }
}
