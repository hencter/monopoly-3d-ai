// 入口：组装 3D 世界、UI、DeepSeek AI 与游戏引擎；提供浏览器版表现层适配器（含 AI 策略）
import { World, PLAYER_COLORS, PLAYER_COLORS_CSS, preloadTextures, preloadCardTextures } from './three/world.js';
import { UI } from './ui/ui.js';
import { GameState, TILES, INDUSTRIES , formatMoney, ttc, MONEY_SCALE, GO_SALARY } from './core/state.js';
import { Engine } from './core/engine.js';
import { GameClock } from './core/gameClock.js';
import { DeepSeekClient } from './llm/deepseek.js';
import { AIBrain, PERSONAS } from './llm/ai.js';
import { soundManager } from './audio.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const ownable = (t) => ['property', 'railroad', 'utility'].includes(t.type);
const SAVE_KEY = 'df_save_v1';

class BrowserAdapter {
  constructor(world, ui, game, brain, clock = null) {
    this.world = world;
    this.ui = ui;
    this.g = game;
    this.brain = brain;
    this.clock = clock;
    this.activeId = -1;
    this._panelTarget = null;     // 当前可操作面板的人类玩家
    this._snap = new Map();       // 破产/坐牢状态快照（触发吐槽）
    this._tradeOffers = new Set(); // AI 主动求购冷却
    this._jailRoll = false;        // 监禁掷骰（不渲染道具栏）
    // 渲染签名缓存：仅变化时重建 3D 对象（防 GPU 泄漏与窗户闪烁）
    this._hsig = new Array(40).fill(-1);
    this._osig = new Array(40).fill(-2);
    this._csig = new Map();
    this._isig = '';
  }

  log(html, cls) { this.ui.log(html, cls); }
  pause(ms) { return delay(ms); }

  // ---------- 状态同步 ----------
  update() {
    for (let i = 0; i < TILES.length; i++) {
      const o = this.g.owner[i];
      if (o !== this._osig[i]) { this.world.setOwner(i, o >= 0 ? PLAYER_COLORS[o] : null); this._osig[i] = o; }
      const h = this.g.houses[i];
      if (h !== this._hsig[i]) {
        if (this._hsig[i] >= 0 && h > this._hsig[i]) soundManager.play('build');
        this.world.setHouses(i, h);
        this._hsig[i] = h;
      }
    }
    const deltas = {};
    for (const p of this.g.players) {
      const cs = p.company ? `${p.company.industry}:${p.company.level}` : '';
      if (this._csig.get(p.id) !== cs) { this.world.setCompany(p.id, p.company, p.name); this._csig.set(p.id, cs); }
      const prev = this._snap.get(p.id) || { bankrupt: false, inJail: false, money: p.money };
      if (!prev.bankrupt && p.bankrupt) {
        this.world.removeToken(p.id);
        this.world.setCompany(p.id, null, p.name);
        this._say(p, 'bankrupt');
      } else if (!prev.inJail && p.inJail && !p.bankrupt) {
        this._say(p, 'jail');
      }
      const dm = p.money - prev.money;
      if (dm !== 0) deltas[p.id] = dm;
      this._snap.set(p.id, { bankrupt: p.bankrupt, inJail: p.inJail, money: p.money });
    }
    const isig = JSON.stringify(this.g.industry);
    if (this._isig && this._isig !== isig) soundManager.play('news');
    this._isig = isig;
    this.ui.renderPlayers(this.g, this.activeId, deltas);
    this.ui.renderIndustries(this.g);
    // 3D 生活区：按各玩家本回合 homeZone 刷新驻点
    this.world.syncLivingZones?.(this.g.players, PLAYER_COLORS);
  }

  // ---------- AI 闲聊 ----------
  _say(p, kind) {
    if (!p.isAI) return;
    // 大人数局节流，防止聊天刷屏
    if (this.g.players.length > 8 && Math.random() > 0.3 && kind !== 'bankrupt' && kind !== 'win') return;
    this.brain.banter(p, kind).then(text => {
      if (text) this.ui.chatAdd({ from: p.name, color: PLAYER_COLORS_CSS[p.id], text });
    });
  }

  onEvent(p, kind) {
    soundManager.play({ buy: 'buy', rent: 'pay', doubles: 'coin', skip: 'click', jail: 'jail', bankrupt: 'bankrupt' }[kind] || 'click');
    this._say(p, kind);
  }

  phase(name, p) {
    if (name === 'jailRoll') this._jailRoll = true;
    if (name === 'roundEnd') {
      // 全员各操作完一轮 → 自然日 +1（5 交易日 + 周末）
      const info = this.clock?.onRoundComplete?.() ?? null;
      if (info && this.clock) {
        this.g.syncCalendar?.(this.clock);
        const open = info.marketOpen;
        if (open) {
          this.log(
            `📅 <b>T+${info.tPlus}</b> · 周${info.weekday} · <span class="good">股市开市</span> · 全员完成上一轮`,
            'turn',
          );
          this.ui.toast(`📅 T+${info.tPlus} 周${info.weekday} · 开市`, 1600);
        } else {
          this.log(
            `📅 第 ${this.clock.dayIndex} 天 · 周${info.weekday} · <span class="bad">股市休市</span>（周末不可交易）`,
            'turn',
          );
          this.ui.toast(`📅 周${info.weekday} · 休市`, 1600);
        }
        try {
          const raw = localStorage.getItem(SAVE_KEY);
          if (raw) {
            const s = JSON.parse(raw);
            s.clock = this.clock.serialize();
            s.state = this.g.serialize();
            localStorage.setItem(SAVE_KEY, JSON.stringify(s));
          }
        } catch { /* */ }
      }
      this.update();
      return;
    }
    if (name === 'turnStart') {
      this._jailRoll = false;
      this.clock?.onTurnStart?.();
      this.g.syncCalendar?.(this.clock);
      // 回合开始存档点（刷新/关页面后可续玩）
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          v: 1,
          at: Date.now(),
          nextPlayer: p.id,
          state: this.g.serialize(),
          clock: this.clock?.serialize?.(),
        }));
      } catch {}
      this.activeId = p.id;
      this.world.setFollow(p.id);
      const tPlus = this.clock ? `T+${this.clock.tPlus} · ` : '';
      this.ui.setTurnInfo(`🎯 ${tPlus}${p.name} 的回合`);
      this.ui.setButtons({});
      this.ui.el.itemBar.innerHTML = '';
      this._panelTarget = null;
      this.update();
      this.ui.toast(`轮到 ${p.name}`);
    }
  }

  /** 引擎在整轮结束时也会调（与 phase roundEnd 二选一兜底） */
  onRoundEnd() {
    if (!this.clock) return;
    // phase('roundEnd') 已推进时不要重复
  }

  async animateDice(d1, d2) { await this.world.animateDice(d1, d2); }
  async animateMove(p, from, steps) { await this.world.moveToken(p.id, from, steps); }
  async animateTeleport(p, from, to) {
    await this.world.teleportToken(p.id, from, to, { playerName: p.name });
  }

  // ---------- 掷骰 ----------
  async waitRoll(p) {
    if (p.isAI) {
      this.ui.setTurnInfo(`🤖 ${p.name} 思考中…`);
      await delay(400);
      const landingScores = {};
      for (let k = 1; k <= 6; k++) landingScores[k] = this._scoreLanding(p, (p.position + k) % 40);
      const d = await this.brain.decideRoll(p, landingScores);
      if (d.type === 'remote' && (p.items.remote || 0) > 0) {
        return { type: 'remote', total: d.total || 4, opSeconds: 0 };
      }
      return { type: 'roll', boost: !!d.boost && (p.items.boost || 0) > 0, opSeconds: 0 };
    }
    const stopRent = this.ui.startRentMeter({ waived: this.g.hasHousing(p) });
    if (this._jailRoll) { // 监禁掷骰：无道具栏
      this.ui.setTurnInfo(`${p.name}：掷双数脱困 · 犹豫越久房租越高`);
      this.ui.setButtons({ roll: true, stock: true });
      await this.ui.waitButton('roll');
      this.ui.setButtons({ stock: true });
      const opSeconds = stopRent();
      return { type: 'roll', opSeconds };
    }
    this.ui.setTurnInfo(`${p.name}：请掷骰子 · 点下方手牌使用道具 · ⏱️房租按秒计`);
    this.ui.setButtons({ roll: true, build: true, bank: true, trade: true, company: true, stock: true });
    this._panelTarget = p;
    this._rollBoost = false;

    const action = await new Promise((resolve) => {
      let settled = false;
      const finish = (act) => {
        if (settled) return;
        settled = true;
        const opSeconds = stopRent();
        this.world.clearHandCards();
        this.ui.el.itemBar.innerHTML = '';
        this.ui.el.btnRoll.onclick = null;
        resolve({ ...act, opSeconds });
      };

      const bindHand = () => {
        this.world.setHandCards(p.items, 'roll', async (item) => {
          if (item === 'remote') {
            const n = await this.ui.askNumber('🎯 遥控骰子：选择点数', 1, 6);
            if (n != null) finish({ type: 'remote', total: n });
          } else if (item === 'boost') {
            this._rollBoost = !this._rollBoost;
            this.ui.toast(this._rollBoost ? '🚀 加速卡已激活：本次 +3 步' : '已取消加速卡');
            bindHand();
          }
        });
      };
      bindHand();

      this.ui.el.btnRoll.onclick = () => finish({
        type: 'roll',
        boost: this._rollBoost,
      });
      this.ui.el.itemBar.innerHTML = '';
    });

    this.ui.setButtons({ stock: true });
    return action;
  }

  async promptBankPledge(p, opts) {
    if (p.isAI) {
      // AI：现金很低时接受
      return p.money < ttc(250) && this.g.rng() < 0.65;
    }
    return this.ui.promptBankPledge(p, opts);
  }

  _scoreLanding(p, idx) {
    const t = TILES[idx];
    if (!ownable(t)) {
      return { tax: -1.5, gotojail: -4, chance: 0.3, chest: 0.2 }[t.type] ?? 0;
    }
    const o = this.g.owner[idx];
    if (o === -1) {
      if (p.money < t.price) return 0;
      let s = 2;
      if (t.type === 'property' && this.g.groupTiles(t.color).every(i => i === idx || this.g.owner[i] === p.id)) s += 3;
      return s;
    }
    if (o === p.id) return 0.5;
    return -Math.min(4, this.g.calcRent(idx) / 100);
  }

  async waitEndTurn(p) {
    if (p.isAI) {
      this.ui.setTurnInfo(`🤖 ${p.name} 经营决策中…`);
      await this._aiExecuteTurnEnd(p);
      this.update();
      await delay(400);
      return;
    }
    this.ui.setTurnInfo(`${p.name}：可建设/股市/入股/抽牌 · 点下方手牌出牌 · 或结束回合`);
    this._panelTarget = p;
    this._stockTradeable = true;
    this.ui.el.itemBar.innerHTML = '';

    const syncDrawBtn = () => {
      const can = this.g.canPaidDraw(p);
      const left = Math.max(0, 3 - (p.paidDrawsUsed || 0));
      this.ui.setButtons({
        end: true, build: true, bank: true, trade: true, company: true, stock: true, draw: can,
      });
      this.ui.setDrawLabel(can ? `🃏 抽牌(${left})` : '🃏 抽牌');
    };
    const refreshHand = () => {
      this.world.setHandCards(p.items, 'endTurn', async (item) => {
        await this.useCard(p, item);
        refreshHand();
        syncDrawBtn();
      });
    };
    refreshHand();
    syncDrawBtn();

    // 付费抽牌（回合补给自动已发，这里是加抽）
    const onDraw = () => {
      if (!this.g.canPaidDraw(p)) {
        this.ui.toast('无法抽牌（现金不足或本回合次数用尽）');
        return;
      }
      const r = this.g.takeDraw(p, 'paid');
      if (!r) { this.ui.toast('抽牌失败'); return; }
      this.log(`🃏 ${p.name} 付费补给（${formatMoney(r.cost)}）：${this.g.formatDrawLoot(r.got)}`, 'card');
      this.ui.toast(`抽到 ${this.g.formatDrawLoot(r.got)}`);
      this.update();
      refreshHand();
      syncDrawBtn();
    };
    if (this.ui.el.btnDraw) this.ui.el.btnDraw.onclick = onDraw;

    await this.ui.waitButton('end');
    if (this.ui.el.btnDraw) this.ui.el.btnDraw.onclick = null;
    this.world.clearHandCards();
    this._stockTradeable = false;
    this.ui.setButtons({ stock: true });
    this._panelTarget = null;
  }

  // ---------- 面板入口（人类） ----------
  openPanel(kind) {
    // 股市：任意时刻可看；仅回合末（可操作）时可买卖
    if (kind === 'stock') {
      // 任意时刻可看全场行情；仅本方回合末可买卖
      if (this.ui.modalOpen) return;
      const viewer = (this._panelTarget && !this._panelTarget.isAI)
        ? this._panelTarget
        : (this.g.alivePlayers().find(p => !p.isAI) || this.g.players[0]);
      const tradeable = !!(this._stockTradeable && this._panelTarget && !this._panelTarget.isAI);
      this.ui.openStock(this.g, viewer, () => this.update(), { tradeable, readOnly: !tradeable });
      return;
    }
    const p = this._panelTarget;
    if (!p || p.isAI || this.ui.modalOpen) return;
    if (kind === 'build') this.ui.openBuild(this.g, p, () => this.update());
    if (kind === 'bank') this.ui.openBank(this.g, p, () => this.update());
    if (kind === 'company') this.ui.openCompany(this.g, p, () => this.update());
    if (kind === 'trade') this.ui.openInvest(this.g, p, () => this.update());
    if (kind === 'blackMarket') this.ui.openBlackMarket?.(this.g, p, () => this.update());
  }

  /**
   * 执行 DeepSeek / 本地启发式回合末计划
   * @param {object} p
   */
  async _aiExecuteTurnEnd(p) {
    const g = this.g;
    const plan = await this.brain.planTurnEnd(p);
    if (plan.say) {
      this.ui.chatAdd?.({ from: p.name, color: PLAYER_COLORS_CSS[p.id], text: plan.say });
    }
    for (const a of plan.actions || []) {
      try {
        await this._aiApplyAction(p, a);
      } catch (e) {
        console.warn('[ai action]', a, e);
      }
    }
  }

  /** @param {object} p @param {object} a */
  async _aiApplyAction(p, a) {
    if (!a?.op) return;
    const g = this.g;
    const op = a.op;
    const n = Math.max(1, Math.min(20, Number(a.n) || 1));

    if (op === 'borrow') {
      const amt = Math.max(ttc(50), Number(a.amount) || ttc(300));
      if (g.borrow?.(p, amt)) this.log(`${p.name} 向银行贷款 ${formatMoney(amt)}`, 'card');
      return;
    }
    if (op === 'repay') {
      const amt = Math.max(0, Number(a.amount) || p.debt);
      const r = g.repay?.(p, amt);
      if (r > 0) this.log(`${p.name} 偿还贷款 ${formatMoney(r)}`);
      return;
    }
    if (op === 'build') {
      const i = Number(a.tileIdx);
      if (g.canBuild(p, i) && g.buyHouse(p, i)) {
        this.log(`${p.name} 消耗建设卡，在 ${TILES[i].name} 起了一级楼`, 'good');
      }
      return;
    }
    if (op === 'foundCompany') {
      const ind = a.ind;
      if (g.canFoundCompany(p) && INDUSTRIES[ind] && g.foundCompany(p, ind)) {
        this.log(`${p.name} 消耗公司卡，创办了 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 公司！`, 'good');
      }
      return;
    }
    if (op === 'upgradeCompany') {
      if (g.canUpgradeCompany(p) && g.upgradeCompany(p)) {
        this.log(`${p.name} 消耗公司卡，公司升到 Lv${p.company.level}`, 'good');
      }
      return;
    }
    if (op === 'ipo') {
      const r = g.doIPO?.(p);
      if (r) this.log(`${p.name} 公司 IPO，套现 ${formatMoney(r.raised)}`, 'good');
      return;
    }
    if (op === 'buyStock') {
      const r = g.buyStock(p, a.ind, n);
      if (r) {
        this.log(`${p.name} 买入 ${INDUSTRIES[a.ind].icon}${INDUSTRIES[a.ind].name} 股票 ${r.n} 手（${formatMoney(r.cost)}）`, 'good');
      }
      return;
    }
    if (op === 'sellStock') {
      const r = g.sellStock(p, a.ind, n);
      if (r) {
        this.log(`${p.name} 卖出 ${INDUSTRIES[a.ind].icon}${INDUSTRIES[a.ind].name} 股票 ${r.n} 手（+${formatMoney(r.gain)}）`, 'card');
      }
      return;
    }
    if (op === 'openShort') {
      const r = g.openShort?.(p, a.ind, n);
      if (r) {
        this.log(`${p.name} 做空 ${INDUSTRIES[a.ind].icon}${INDUSTRIES[a.ind].name} ${r.n} 手（+${formatMoney(r.gain)}）`, 'bad');
      }
      return;
    }
    if (op === 'coverShort') {
      const r = g.coverShort?.(p, a.ind, n);
      if (r) {
        this.log(`${p.name} 平空 ${INDUSTRIES[a.ind].icon}${INDUSTRIES[a.ind].name} ${r.n} 手（-${formatMoney(r.cost)}）`, 'good');
      }
      return;
    }
    if (op === 'invest') {
      const f = g.players[Number(a.founderId)];
      if (!f?.company) return;
      const fromFloat = a.fromFloat !== false;
      const r = g.investCompany?.(p, f, n, fromFloat) || g.investCompany?.(p, f, n, !fromFloat);
      if (r) this.log(`${p.name} 入股 ${f.name} 公司 ${r.n || n} 手（${formatMoney(r.cost)}）`, 'good');
      return;
    }
    if (op === 'paidDraw') {
      if (g.canPaidDraw?.(p) && g.countItems(p) < 6) {
        const r = g.takeDraw(p, 'paid');
        if (r) this.log(`🃏 ${p.name} 付费补给：${g.formatDrawLoot(r.got)}`, 'card');
      }
      return;
    }
    if (op === 'playCard') {
      await this._aiPlayCardFromPlan(p, a);
    }
  }

  async _aiPlayCardFromPlan(p, a) {
    const g = this.g;
    const item = a.item;
    if (!item || (p.items[item] || 0) <= 0) return;
    const opponents = g.players.filter((o) => o.id !== p.id && !o.bankrupt);

    if (item === 'equalize') {
      if (!g.useItem(p, 'equalize')) return;
      const v = g.playEqualize();
      this.ui.showItemCast?.(p, 'equalize');
      this.log(`💳 ${p.name} 打出均富卡，全场现金变为 ${formatMoney(v)}`, 'card');
      return;
    }
    if (item === 'rob') {
      const t = g.players[Number(a.targetId)] || opponents.sort((x, y) => y.money - x.money)[0];
      if (!t || !g.useItem(p, 'rob')) return;
      const amt = g.playRob(p, t);
      this.ui.showItemCast?.(p, 'rob');
      this.log(`🥷 ${p.name} 抢夺 ${t.name} ${formatMoney(amt)}！`, 'bad');
      return;
    }
    if (item === 'hibernate') {
      const t = g.players[Number(a.targetId)] || opponents.sort((x, y) => g.netWorth(y) - g.netWorth(x))[0];
      if (!t || !g.useItem(p, 'hibernate')) return;
      g.playHibernate(t);
      this.ui.showItemCast?.(p, 'hibernate');
      this.log(`😴 ${p.name} 让 ${t.name} 进入冬眠`, 'card');
      return;
    }
    if (item === 'demolish') {
      let tile = Number(a.tileIdx);
      if (!(tile >= 0) || g.houses[tile] <= 0) {
        tile = -1;
        let best = 0;
        for (const o of opponents) {
          for (const i of g.playerProperties(o.id)) {
            if (g.houses[i] > 0 && g.calcRent(i) > best) { best = g.calcRent(i); tile = i; }
      }
    }
    if (item === 'bail') {
      if (!p.inJail || !g.useItem(p, 'bail')) return;
      g.playBail(p);
      this.ui.showItemCast?.(p, 'bail');
      this.log(`${p.name} 使用 🔓保释令，即刻脱身！`, 'good');
      return;
    }
    if (item === 'subsidy') {
      if (!g.useItem(p, 'subsidy')) return;
      g.playSubsidy(p);
      this.ui.showItemCast?.(p, 'subsidy');
      this.log(`${p.name} 领取 🎁财政补贴 +${formatMoney(ttc(200))}`, 'good');
      return;
    }
    if (item === 'debtCut') {
      if (!g.useItem(p, 'debtCut')) return;
      const cut = g.playDebtCut(p);
      this.ui.showItemCast?.(p, 'debtCut');
      if (cut > 0) this.log(`${p.name} 使用 ✂️债务豁免，减免 ${formatMoney(cut)}`, 'card');
      return;
    }
    if (item === 'audit') {
      const t = g.players[Number(a.targetId)] || opponents.sort((x, y) => y.money - x.money)[0];
      if (!t || !g.useItem(p, 'audit')) return;
      g.playAudit(p, t);
      this.ui.showItemCast?.(p, 'audit');
      this.log(`${p.name} 对 ${t.name} 发动 🧾审计风暴`, 'bad');
      return;
    }
    if (item === 'poach') {
      const tWithItems = opponents.filter(o => Object.values(o.items || {}).some(v => v > 0));
      const t = g.players[Number(a.targetId)] || tWithItems.sort((x, y) => g.netWorth(y) - g.netWorth(x))[0];
      if (!t || !g.useItem(p, 'poach')) return;
      const stolen = g.playPoach(p, t);
      if (stolen) {
        this.ui.showItemCast?.(p, 'poach');
        const meta = ITEMS[stolen] || { icon: '🃏', name: stolen };
        this.log(`${p.name} 🧲挖角 ${t.name}，偷到 ${meta.icon}${meta.name}`, 'card');
      }
      return;
    }
    if (item === 'hedge') {
      if (!g.useItem(p, 'hedge')) return;
      g.playHedge(p);
      this.ui.showItemCast?.(p, 'hedge');
      this.log(`${p.name} 投保 ☂️对冲保单：下次租金减半`, 'card');
      return;
    }
    if (item === 'rush') {
      if (!g.useItem(p, 'rush')) return;
      g.playRush(p);
      this.ui.showItemCast?.(p, 'rush');
      this.log(`${p.name} 激活 ⚡抢工卡`, 'card');
      return;
    }
    if (item === 'warp') {
      const ownProps = g.playerProperties(p.id);
      const tile = Number(a.tileIdx);
      const target = ownProps.includes(tile) ? tile : ownProps[Math.floor(g.rng() * ownProps.length)];
      if (target == null || !g.useItem(p, 'warp')) return;
      g.playWarp(p, target);
      this.ui.showItemCast?.(p, 'warp');
      this.log(`${p.name} 🌀跃迁到 ${TILES[target].name}`, 'card');
      return;
    }
    if (item === 'doubleGo') {
      if (!g.useItem(p, 'doubleGo')) return;
      g.playDoubleGo(p);
      this.ui.showItemCast?.(p, 'doubleGo');
      this.log(`${p.name} 激活 🏦双倍融资`, 'card');
      return;
    }
    if (item === 'freeze') {
      const t = g.players[Number(a.targetId)] || opponents.sort((x, y) => g.netWorth(y) - g.netWorth(x))[0];
      if (!t || !g.useItem(p, 'freeze')) return;
      g.playFreeze(p, t);
      this.ui.showItemCast?.(p, 'freeze');
      this.log(`${p.name} 对 ${t.name} 发出 🛑停工令`, 'bad');
      return;
    }
    if (item === 'equalizeDebt') {
      if (!g.useItem(p, 'equalizeDebt')) return;
      const avg = g.playEqualizeDebt();
      this.ui.showItemCast?.(p, 'equalizeDebt');
      this.log(`💸 ${p.name} 打出均负卡，全员债务均化为 ${formatMoney(avg)}`, 'card');
      return;
    }
  }
      if (tile < 0 || !g.useItem(p, 'demolish')) return;
      g.houses[tile]--;
      this.ui.showItemCast?.(p, 'demolish');
      const owner = g.players[g.owner[tile]];
      this.log(`${p.name} 发动 💥拆迁卡，${owner?.name} 的 ${TILES[tile].name} 被拆了一级！`, 'bad');
      return;
    }
    if (item === 'swap') {
      const o = g.players[Number(a.targetId)];
      const my = Number(a.myTile);
      const their = Number(a.theirTile);
      if (!o || !g.useItem(p, 'swap')) return;
      if (g.playSwap(p, o, my, their)) {
        this.ui.showItemCast?.(p, 'swap');
        this.log(`🔀 ${p.name} 用 ${TILES[my].name} 换了 ${o.name} 的 ${TILES[their].name}`, 'good');
      }
      return;
    }
    if (item === 'intel') {
      const keys = g.stockIndustries();
      const ind = keys.includes(a.ind) ? a.ind : keys[0];
      const mode = a.mode === 'down' ? 'down' : 'up';
      if (!g.useItem(p, 'intel')) return;
      const news = g.applyNews(ind, mode);
      if (news) {
        this.ui.showItemCast?.(p, 'intel');
        this.log(`📰 ${p.name} 发布${mode === 'up' ? '利好' : '利空'}：${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name}`, 'card');
      }
    }
  }

  /** 全场可见出牌（列表高亮；HUD 已在 handUI 播过时可 silent） */
  async _announceCast(p, item, { silent = true, skipFx = true } = {}) {
    // 人类手牌路径已播 cast，这里默认只刷新列表高亮；AI/联机观众 skipFx=false
    try { await this.ui.showItemCast?.(p, item, { silent, skipFx }); } catch { /* */ }
  }

  /** 人类玩家打出主动卡（含目标选择流程），返回 Promise（完成后刷新牌角标） */
  async useCard(p, item) {
    if (this.ui.modalOpen || (p.items[item] || 0) <= 0) return;
    const opponents = this.g.players.filter(o => o.id !== p.id && !o.bankrupt);
    switch (item) {
      case 'demolish':
        this.ui.openDemolish(this.g, p, async (tileIdx) => {
          if (!this.g.useItem(p, 'demolish')) return;
          this.g.houses[tileIdx]--;
          const owner = this.g.players[this.g.owner[tileIdx]];
          await this._announceCast(p, item);
          this.log(`${p.name} 打出 💥拆迁卡，${owner?.name} 的 ${TILES[tileIdx].name} 被拆了一级！`, 'bad');
          soundManager.play('pay');
          this.update();
        });
        break;
      case 'equalize':
        if (!this.g.useItem(p, 'equalize')) return;
        {
          const avg = this.g.playEqualize();
          await this._announceCast(p, item);
          this.log(`💳 ${p.name} 打出均富卡，所有人现金变为 <span class="gold">${formatMoney(avg)}</span>`, 'card');
          soundManager.play('coin');
          this.update();
        }
        break;
      case 'rob': {
        if (!opponents.length) { this.ui.toast('没有可抢夺的对手'); return; }
        const id = await this.ui.askPlayer('🥷 抢夺卡：选择目标', opponents);
        if (id == null) return;
        if (!this.g.useItem(p, 'rob')) return;
        const t = this.g.players[id];
        const amt = this.g.playRob(p, t);
        await this._announceCast(p, item);
        this.log(`🥷 ${p.name} 抢夺 ${t.name} <span class="gold">${formatMoney(amt)}</span>！`, 'bad');
        soundManager.play('rob');
        this.update();
        break;
      }
      case 'hibernate': {
        if (!opponents.length) { this.ui.toast('没有可冬眠的对手'); return; }
        const id = await this.ui.askPlayer('😴 冬眠卡：选择目标', opponents);
        if (id == null) return;
        if (!this.g.useItem(p, 'hibernate')) return;
        const t = this.g.players[id];
        this.g.playHibernate(t);
        await this._announceCast(p, item);
        this.log(`😴 ${p.name} 让 ${t.name} 进入冬眠，跳过其下一回合`, 'card');
        soundManager.play('jail');
        this.update();
        break;
      }
      case 'swap':
        this.ui.openSwap(this.g, p, async ({ targetId, myTile, theirTile }) => {
          if (!this.g.useItem(p, 'swap')) return;
          const t = this.g.players[targetId];
          if (this.g.playSwap(p, t, myTile, theirTile)) {
            await this._announceCast(p, item);
            this.log(`🔀 ${p.name} 用 ${TILES[myTile].name} 换了 ${t.name} 的 ${TILES[theirTile].name}`, 'good');
            soundManager.play('trade');
            this.update();
          }
        });
        break;
      case 'intel': {
        const keys = this.g.stockIndustries();
        const mode = await this.ui.askChoice('📰 资讯方向', [
          { id: 'up', label: '📈 发布利好' },
          { id: 'down', label: '📉 发布利空' },
        ]);
        if (!mode) return;
        const ind = await this.ui.askIndustry(keys);
        if (!ind) return;
        if (!this.g.useItem(p, 'intel')) return;
        const n = this.g.applyNews(ind, mode);
        if (n) {
          await this._announceCast(p, item);
          this.log(`📰 ${p.name} 发布${mode === 'up' ? '利好' : '利空'}：${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 资讯 ${n.from.toFixed(2)}→${n.toFixed(2)}`, 'card');
          soundManager.play('news');
          this.update();
        }
        break;
      }
      case 'bail':
        if (!p.inJail) { this.ui.toast('不在监管局，无需保释'); return; }
        if (!this.g.useItem(p, 'bail')) return;
        this.g.playBail(p);
        await this._announceCast(p, item);
        this.log(`${p.name} 使用 🔓保释令，即刻脱身！`, 'good');
        soundManager.play('coin');
        this.update();
        break;
      case 'subsidy':
        if (!this.g.useItem(p, 'subsidy')) return;
        this.g.playSubsidy(p);
        await this._announceCast(p, item);
        this.log(`${p.name} 领取 🎁财政补贴 +${formatMoney(2000000)}`, 'good');
        soundManager.play('coin');
        this.update();
        break;
      case 'debtCut':
        if (!this.g.useItem(p, 'debtCut')) return;
        const cut = this.g.playDebtCut(p);
        await this._announceCast(p, item);
        this.log(cut > 0 ? `${p.name} 使用 ✂️债务豁免，减免 ${formatMoney(cut)} 债务` : `${p.name} 没有债务可免`, 'card');
        soundManager.play('coin');
        this.update();
        break;
      case 'audit': {
        if (!opponents.length) { this.ui.toast('没有可审查的对手'); return; }
        const aid = await this.ui.askPlayer('🧾 审计风暴：选择审查对象', opponents);
        if (aid == null) return;
        if (!this.g.useItem(p, 'audit')) return;
        const t = this.g.players[aid];
        this.g.playAudit(p, t);
        await this._announceCast(p, item);
        this.log(`${p.name} 对 ${t.name} 发动 🧾审计风暴，${t.name} 补缴 ${formatMoney(ttc(150))} 税款`, 'bad');
        soundManager.play('pay');
        this.update();
        break;
      }
      case 'poach': {
        const hasItems = opponents.filter(o => Object.values(o.items || {}).some(v => v > 0));
        if (!hasItems.length) { this.ui.toast('对手都没有道具卡可偷'); return; }
        const pid = await this.ui.askPlayer('🧲 挖角：选择目标', hasItems);
        if (pid == null) return;
        if (!this.g.useItem(p, 'poach')) return;
        const t = this.g.players[pid];
        const stolen = this.g.playPoach(p, t);
        await this._announceCast(p, item);
        if (stolen) {
          const meta = ITEMS[stolen] || { icon: '🃏', name: stolen };
          this.log(`${p.name} 🧲挖角 ${t.name}，偷到 ${meta.icon}${meta.name}×1`, 'card');
        }
        soundManager.play('rob');
        this.update();
        break;
      }
      case 'hedge':
        if (!this.g.useItem(p, 'hedge')) return;
        this.g.playHedge(p);
        await this._announceCast(p, item);
        this.log(`${p.name} 投保 ☂️对冲保单：下次租金减半`, 'card');
        soundManager.play('click');
        this.update();
        break;
      case 'rush':
        if (!this.g.useItem(p, 'rush')) return;
        this.g.playRush(p);
        await this._announceCast(p, item);
        this.log(`${p.name} 激活 ⚡抢工卡：下次建楼免消耗建设卡`, 'card');
        soundManager.play('click');
        this.update();
        break;
      case 'warp': {
        const warps = this.g.playerProperties(p.id);
        if (!warps.length) { this.ui.toast('你名下没有地产可传送'); return; }
        const tileIdx = await this.ui.openPickOverlay({
          title: '🌀 跃迁卡 · 选择目的地',
          sub: '传送到你名下的一块地产',
          options: warps.map(i => ({
            id: i, label: TILES[i].name, icon: '🏢', meta: formatMoney(TILES[i].price),
          })),
        });
        if (tileIdx == null) return;
        if (!this.g.useItem(p, 'warp')) return;
        this.g.playWarp(p, +tileIdx);
        await this._announceCast(p, item);
        this.log(`${p.name} 🌀跃迁到 ${TILES[+tileIdx].name}`, 'card');
        soundManager.play('click');
        this.update();
        break;
      }
      case 'doubleGo':
        if (!this.g.useItem(p, 'doubleGo')) return;
        this.g.playDoubleGo(p);
        await this._announceCast(p, item);
        this.log(`${p.name} 激活 🏦双倍融资：下次经过起点 ×2`, 'card');
        soundManager.play('coin');
        this.update();
        break;
      case 'freeze': {
        if (!opponents.length) { this.ui.toast('没有可冻结的对手'); return; }
        const fid = await this.ui.askPlayer('🛑 停工令：选择目标', opponents);
        if (fid == null) return;
        if (!this.g.useItem(p, 'freeze')) return;
        const ft = this.g.players[fid];
        this.g.playFreeze(p, ft);
        await this._announceCast(p, item);
        this.log(`${p.name} 对 ${ft.name} 发出 🛑停工令，下回合禁止建设`, 'bad');
        soundManager.play('jail');
        this.update();
        break;
      }
      case 'equalizeDebt':
        if (!this.g.useItem(p, 'equalizeDebt')) return;
        const avgDebt = this.g.playEqualizeDebt();
        await this._announceCast(p, item);
        this.log(`💸 ${p.name} 打出均负卡，全员债务平均为 ${formatMoney(avgDebt)}`, 'card');
        soundManager.play('coin');
        this.update();
        break;
    }
  }

  // ---------- 交易 ----------
  async proposeTrade({ buyerId, sellerId, tileIdx, price }) {
    const g = this.g;
    const buyer = g.players[buyerId], seller = g.players[sellerId];
    if (!g.canTrade(buyer, seller, tileIdx, price)) { this.ui.toast('交易不成立：现金不足或资产不可交易'); return; }

    const execute = (finalPrice) => {
      g.executeTrade(buyer, seller, tileIdx, finalPrice);
      this.log(`🤝 成交！${buyer.name} 以 <span class="gold">${formatMoney(finalPrice)}</span> 购得 ${seller.name} 的 <b>${TILES[tileIdx].name}</b>`, 'good');
      this.update();
    };

    if (seller.isAI) {
      this.ui.showThinking(seller.name);
      const r = await this.brain.evaluateTrade(buyer, seller, tileIdx, price);
      this.ui.closeModal();
      if (r.say) this.ui.chatAdd({ from: seller.name, color: PLAYER_COLORS_CSS[seller.id], text: r.say });
      const choice = await this.ui.showTradeResponse(seller.name, r.decision, r.counterPrice, r.say);
      if (r.decision === 'accept') execute(price);
      else if (r.decision === 'counter' && choice === 'accept') {
        if (g.canTrade(buyer, seller, tileIdx, r.counterPrice)) execute(r.counterPrice);
        else this.ui.toast('现金不足，接不下还价');
      } else this.log(`${seller.name} 拒绝了 ${buyer.name} 的报价`);
    } else if (buyer.isAI) {
      this.ui.showThinking(buyer.name);
      const r = await this.brain.evaluatePurchase(buyer, seller, tileIdx, price);
      this.ui.closeModal();
      if (r.say) this.ui.chatAdd({ from: buyer.name, color: PLAYER_COLORS_CSS[buyer.id], text: r.say });
      const choice = await this.ui.showTradeResponse(buyer.name, r.decision, r.counterPrice, r.say);
      if (r.decision === 'accept') execute(price);
      else if (r.decision === 'counter' && choice === 'accept') {
        if (g.canTrade(buyer, seller, tileIdx, r.counterPrice)) execute(r.counterPrice);
        else this.ui.toast('对方接不下还价');
      } else this.log(`${buyer.name} 婉拒了这桩买卖`);
    } else {
      // 人类 ↔ 人类（同屏）：弹窗由"对方"确认（发起方是买方→卖方确认；发起方是卖方→买方确认）
      const initiator = this._panelTarget;
      const responder = initiator && initiator.id === buyer.id ? 'seller' : 'buyer';
      const c = await this.ui.promptIncomingTrade({
        buyerName: buyer.name, sellerName: seller.name, tileIdx, price,
        responder, buyerMoney: buyer.money,
      });
      if (c === 'accept') execute(price);
      else this.log(`${responder === 'seller' ? seller.name : buyer.name} 拒绝了这笔交易`);
    }
  }

  /** AI 回合末：向人类求购能完成其垄断的资产 */
  async _aiTryTrade(p) {
    for (const human of this.g.players) {
      if (human.isAI || human.bankrupt) continue;
      for (const i of this.g.playerProperties(human.id)) {
        const t = TILES[i];
        if (t.type !== 'property') continue;
        if (this.g.houses[i] > 0 || this.g.isMortgaged(i)) continue;
        const completes = this.g.groupTiles(t.color).every(j => j === i || this.g.owner[j] === p.id);
        if (!completes) continue;
        const key = `${p.id}-${i}`;
        if (this._tradeOffers.has(key)) continue;
        const offer = Math.round(t.price * 1.3);
        if (p.money < offer + ttc(120)) continue;
        this._tradeOffers.add(key);
        this.log(`${p.name} 想收购 ${human.name} 的 ${t.name}…`);
        this._say(p, 'chatGeneric');
        const c = await this.ui.promptIncomingTrade({ buyerName: p.name, sellerName: human.name, tileIdx: i, price: offer, responder: 'seller' });
        if (c === 'accept' && this.g.canTrade(p, human, i, offer)) {
          this.g.executeTrade(p, human, i, offer);
          this.log(`🤝 ${human.name} 同意出售，${p.name} 以 ${formatMoney(offer)} 拿下 ${t.name}！`, 'good');
        } else {
          this.log(`${human.name} 拒绝了 ${p.name} 的收购要约`);
        }
        this.update();
        return;
      }
    }
  }

  // ---------- 决策 ----------
  async promptBuy(p, tileIdx) {
    if (!p.isAI) return this.ui.promptBuy(p, tileIdx, this.g);
    const r = await this.brain.decideBuy(p, tileIdx);
    if (r.say) this.ui.chatAdd({ from: p.name, color: PLAYER_COLORS_CSS[p.id], text: r.say });
    return r.buy;
  }

  promptJail(p, opts) {
    if (!p.isAI) return this.ui.promptJail(p, opts);
    return (async () => {
      await delay(400);
      return this.brain.decideJail(p, opts);
    })();
  }

  promptItemUse(p, item, ctx) {
    if (!p.isAI) return this.ui.promptItemUse(p, item, ctx);
    return this.brain.decideItemUse(p, item, ctx);
  }

  showCard(p, card, deck) {
    soundManager.play('card');
    return this.ui.showCard(card, deck, p.isAI);
  }

  /** 系统通知全息卡（不依赖聊天弹幕） */
  showHoloNotice(opts) {
    return this.ui.showHoloNotice(opts);
  }

  /** 引擎回调：全场可见出牌 */
  onItemCast(p, item) {
    this.ui.showItemCast?.(p, item);
  }

  async gameOver(winner) {
    this.activeId = -1;
    try { localStorage.removeItem(SAVE_KEY); } catch {} // 对局结束清除存档
    this.update();
    soundManager.play('win');
    this.ui.setButtons({});
    this.ui.el.itemBar.innerHTML = '';
    this.ui.setTurnInfo('游戏结束');
    this.world.setFollow(null);
    this.log(`🏆 ${winner.name} 加冕商业帝国！`, 'turn');
    if (winner.isAI) this._say(winner, 'win');
    await this.ui.showGameOver(winner, this.g);
    location.reload();
  }
}

// ---------- 启动 ----------
const canvas = document.getElementById('scene');
await Promise.all([
  preloadTextures(),
  preloadCardTextures(),
  import('./ui/chromaKey.js').then(m => m.getArtFrames()).catch(() => null),
]);
const world = new World(canvas);
world.start();
const ui = new UI();
ui.bindWorld(world);
const client = new DeepSeekClient();

// 全局音效：按钮点击音、M 静音切换、首次交互启动 BGM
addEventListener('click', (e) => { if (e.target.closest?.('button')) soundManager.play('click'); });
addEventListener('pointerdown', () => soundManager.startBgm(), { once: true });

const setup = await ui.showStart();

if (setup.online) {
  // ---------- 联机模式 ----------
  const { startOnline } = await import('./net/online.js');
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') ui.toast(soundManager.toggle() ? '🔊 音效开启' : '🔇 音效关闭');
  });
  await startOnline(world, ui);
} else {
  // ---------- 单机模式 ----------
  let game, resumeFrom = null;
  if (setup.continue) {
    // 恢复存档
    try {
      const save = JSON.parse(localStorage.getItem(SAVE_KEY));
      game = GameState.deserialize(save.state);
      resumeFrom = save.nextPlayer ?? null;
      ui.toast(`🕒 已恢复存档，轮到 ${game.players[resumeFrom]?.name ?? '?'}`);
    } catch (e) {
      console.error('存档损坏，开新局', e);
      localStorage.removeItem(SAVE_KEY);
      game = null;
    }
  }
  let clockData = null;
  if (!game) {
    const configs = setup.configs;
    const personas = [...PERSONAS].sort(() => Math.random() - 0.5);
    let pi = 0;
    for (const c of configs) if (c.isAI) c.persona = personas[pi++ % personas.length].id;
    game = new GameState(configs);
  } else {
    try {
      const save = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      clockData = save.clock || null;
    } catch { /* */ }
  }
  startLocalGame(game, resumeFrom, clockData);
}

/** 单机游戏装配（新局 / 存档续玩 共用） */
function startLocalGame(game, resumeFrom, clockData = null) {
  world.setPlayerCount(game.players.length);
  // 按逻辑位置落子（新局在起点 0；续玩恢复到存档中的格子）
  for (const p of game.players) {
    if (!p.bankrupt) world.createToken(p.id, p.position ?? 0);
  }
  ui.enterGame();

  const clock = clockData ? GameClock.deserialize(clockData) : new GameClock({ dayNumber: 0, speed: 1 });
  clock.start();
  game.syncCalendar?.(clock);
  ui.bindGameClock(clock);

  const brain = new AIBrain(client, game);
  const adapter = new BrowserAdapter(world, ui, game, brain, clock);
  adapter.update();

  world.onPick((tileIdx, x, y) => ui.showTileInfo(tileIdx, game, x, y));

  document.getElementById('btn-build').onclick = () => adapter.openPanel('build');
  document.getElementById('btn-bank').onclick = () => adapter.openPanel('bank');
  document.getElementById('btn-trade').onclick = () => adapter.openPanel('trade');
  document.getElementById('btn-company').onclick = () => adapter.openPanel('company');
  document.getElementById('btn-stock').onclick = () => adapter.openPanel('stock');
  document.getElementById('btn-market').onclick = () => adapter.openPanel('blackMarket');
  // 抽牌按钮在 waitEndTurn 里动态绑定；此处默认禁用
  if (ui.el.btnDraw) ui.el.btnDraw.disabled = true;
  document.getElementById('btn-camera').onclick = () => {
    const mode = world.cycleCameraMode();
    ui.setCameraLabel(mode);
    const tips = {
      follow: '📷 跟随当前玩家',
      free: '📷 自由视角（骰子特写不会抢镜）',
      orbit: '🎥 通天观战 · 自动环绕棋盘',
    };
    ui.toast(tips[mode] || tips.follow, 1600);
  };
  document.getElementById('btn-settings').onclick = () => {
    ui.openSettings(client, () => {
      ui.chatAdd({ sys: true, text: client.enabled ? '🤖 AI 大脑已接入 DeepSeek' : '🤖 AI 使用内置策略（未配置 Key）' });
    });
  };

  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !document.getElementById('btn-roll').disabled && !ui.modalOpen) {
      e.preventDefault();
      document.getElementById('btn-roll').click();
    }
    if (e.code === 'KeyF') {
      const mode = world.cycleCameraMode();
      ui.setCameraLabel(mode);
    }
    if (e.code === 'KeyM') ui.toast(soundManager.toggle() ? '🔊 音效开启' : '🔇 音效关闭');
  });

  ui.onChatSend = (text) => {
    const me = game.alivePlayers().find(p => !p.isAI) || game.alivePlayers()[0];
    ui.chatAdd({ from: me.name, color: PLAYER_COLORS_CSS[me.id], text });
    const ais = game.alivePlayers().filter(p => p.isAI);
    if (!ais.length) { ui.chatAdd({ sys: true, text: '场上没有 AI 对手…' }); return; }
    const target = ais.find(p => text.includes(p.name)) || ais[Math.floor(Math.random() * ais.length)];
    brain.chatReply(target, me.name, text).then(reply => {
      ui.chatAdd({ from: target.name, color: PLAYER_COLORS_CSS[target.id], text: reply });
    });
  };

  ui.log(resumeFrom != null ? `🕒 存档已恢复（第 ${game.turn} 回合），继续对局！` : '欢迎来到商业帝国 3D！点击格子查看详情；回合内可用卡牌/建设/贷款/交易/开公司。');
  ui.chatAdd({ sys: true, text: client.enabled ? '🤖 AI 大脑已接入 DeepSeek，可随时和对手聊天' : '🤖 AI 使用内置策略；点右上角「⚙️ AI」配置 DeepSeek Key 解锁真·对话' });

  const engine = new Engine(game, adapter);
  engine.run(resumeFrom).catch(err => {
    console.error('[engine]', err);
    ui.toast('游戏引擎出错：' + err.message, 6000);
  });

  window.__df = { game, world, engine, adapter, ui, client, brain };
}
