// 核心游戏状态与规则（纯逻辑，无 DOM / Three 依赖，可无头测试）
// 现代商业版：行业景气、银行贷款、地产抵押、创办公司、道具
import {
  TILES, INDUSTRIES, INDUSTRY_STATES, GO_SALARY, JAIL_INDEX, JAIL_FINE, START_MONEY,
  MAX_HOUSES, RAILROAD_RENTS, BANK_BASE_CREDIT, LOAN_INTEREST,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost, companyBaseRevenue,
  STOCK_INDUSTRIES, STOCK_UNIT_BASE, STOCK_PRICE_SHARE, STOCK_SPREAD,
  HEAT_PER_BUY, SHARE_RENT_PER, RENT_BOOST_CAP, DIVIDEND_PER_SHARE, MAX_SHARES_PER_IND, MAX_MARKET_SHARES,
  MAX_SHORT_PER_IND, SHORT_MARGIN_RATIO,
  livingZoneFromDie, LIVING_ZONES, calcLivingRentAmount,
  LIVING_RENT_FREE_SEC, LIVING_RENT_PER_SEC, LIVING_RENT_MAX,
  OP_TIME_FREE_SEC, OP_TIME_RATE, OP_TIME_MAX,
  COMPANY_TOTAL_SHARES, COMPANY_IPO_MIN_LEVEL, COMPANY_IPO_FLOAT, COMPANY_MAX_SELL_PCT,
  SHARE_PLEDGE_LOAN, NEWS_MIN, NEWS_MAX, NEWS_STEP,
  ITEMS, ITEM_DRAW_WEIGHTS, ITEM_STACK_CAP, HAND_CAP, FREE_DRAWS_PER_TURN, PAID_DRAW_COST,
  PAID_DRAWS_PER_TURN, BUY_LAND_DRAW_CHANCE, GO_DRAW_N, PARKING_DRAW_N,
  LOTTERY_COST, LOTTERY_JACKPOT, LOTTERY_WIN_CHANCE, HOSPITAL_FEE, DICE_COST, ITEM_MARKET_BASE, STAMINA_MAX, STAMINA_REGEN, STAMINA_DICE, STAMINA_BUY_LAND, STAMINA_BUILD,
  ttc, formatMoney, CURRENCY_SYMBOL, CURRENCY_NAME, MONEY_SCALE,
} from '../data/tiles.js';
import { CHANCE_CARDS, CHEST_CARDS } from '../data/cards.js';

export {
  TILES, INDUSTRIES, INDUSTRY_STATES, GO_SALARY, JAIL_INDEX, JAIL_FINE, START_MONEY, MAX_HOUSES,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
  STOCK_INDUSTRIES, STOCK_UNIT_BASE, STOCK_SPREAD, HEAT_PER_BUY, SHARE_RENT_PER,
  RENT_BOOST_CAP, DIVIDEND_PER_SHARE, MAX_SHARES_PER_IND, MAX_MARKET_SHARES,
  MAX_SHORT_PER_IND, SHORT_MARGIN_RATIO,
  livingZoneFromDie, LIVING_ZONES, calcLivingRentAmount,
  LIVING_RENT_FREE_SEC, LIVING_RENT_PER_SEC, LIVING_RENT_MAX,
  OP_TIME_FREE_SEC, OP_TIME_RATE, OP_TIME_MAX,
  COMPANY_TOTAL_SHARES, COMPANY_IPO_MIN_LEVEL, SHARE_PLEDGE_LOAN,
  ITEMS, ITEM_DRAW_WEIGHTS, ITEM_STACK_CAP, FREE_DRAWS_PER_TURN, PAID_DRAW_COST,
  PAID_DRAWS_PER_TURN, BUY_LAND_DRAW_CHANCE, GO_DRAW_N, PARKING_DRAW_N,
  LOTTERY_COST, LOTTERY_JACKPOT, LOTTERY_WIN_CHANCE, HOSPITAL_FEE, DICE_COST, ITEM_MARKET_BASE, STAMINA_MAX, STAMINA_REGEN, STAMINA_DICE, STAMINA_BUY_LAND, STAMINA_BUILD, HAND_CAP,
  ttc, formatMoney, CURRENCY_SYMBOL, CURRENCY_NAME, MONEY_SCALE,
};

function emptyStocks() {
  const s = {};
  for (const k of STOCK_INDUSTRIES) s[k] = 0;
  return s;
}

function emptyHeat() {
  const h = {};
  for (const k of STOCK_INDUSTRIES) h[k] = 0;
  return h;
}

function emptyNews() {
  const n = {};
  for (const k of STOCK_INDUSTRIES) n[k] = 1;
  return n;
}

/** 规范化公司股权结构（兼容旧存档） */
export function normalizeCompany(c, founderId) {
  if (!c) return null;
  if (!c.holders) {
    c.holders = { [founderId]: COMPANY_TOTAL_SHARES };
    c.totalShares = COMPANY_TOTAL_SHARES;
    c.freeFloat = 0;
    c.ipo = !!c.ipo;
    c.pledged = c.pledged || 0;
  }
  c.totalShares = c.totalShares || COMPANY_TOTAL_SHARES;
  c.freeFloat = c.freeFloat || 0;
  c.pledged = c.pledged || 0;
  c.ipo = !!c.ipo;
  return c;
}

const PROPERTY_TYPES = ['property', 'railroad', 'utility'];

export class GameState {
  constructor(playerConfigs, rng = Math.random) {
    this.rng = rng;
    this.players = playerConfigs.map((c, i) => ({
      id: i,
      name: c.name,
      isAI: !!c.isAI,
      persona: c.persona || null,   // AI 人格名
      money: START_MONEY,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
      debt: 0,                    // 银行债务
      company: null,              // { industry, level, ipo, holders, freeFloat, pledged, totalShares }
      skipTurns: 0,               // 冬眠：跳过回合数
      stocks: emptyStocks(),      // 行业多头持股（手）
      shorts: emptyStocks(),      // 行业空头仓位（手）
      homeZone: null,             // 本回合生活区 id
      items: {
        remote: 1, boost: 0, rentFree: 0, permit: 2, charter: 1,
        demolish: 0, equalize: 0, rob: 0, swap: 0, hibernate: 0, intel: 0,
      },
      freeDrawsLeft: FREE_DRAWS_PER_TURN,
      paidDrawsUsed: 0,
      ledger: [],
      stamina: STAMINA_MAX,
    }));
    // 开局再抽 2 张补给（加权），起步就能用卡
    for (const p of this.players) {
      this.drawItemPack(p, 2);
      p.freeDrawsLeft = FREE_DRAWS_PER_TURN;
      p.paidDrawsUsed = 0;
    }
    this.owner = new Array(TILES.length).fill(-1);
    this.houses = new Array(TILES.length).fill(0);
    this.mortgaged = new Set();   // 已抵押格子
    // 行业景气（0~3，初始平稳=1）
    this.industry = {};
    for (const key of Object.keys(INDUSTRIES)) this.industry[key] = 1;
    // 购产热度：买入该行业地产次数累计（释放时回落）
    this.marketHeat = emptyHeat();
    // 资讯对股价的倍率（1 为中性）
    this.newsMult = emptyNews();
    /** 股市是否开市（周一～五 true；周六日 false；由 GameClock 同步） */
    this.marketOpen = true;
    /** 展示用：周几 / T+ */
    this.calendarMeta = { weekday: '一', tPlus: 0, dayNumber: 0 };
    // K 线历史（lightweight-charts 用）
    this.kline = {};
    for (const k of STOCK_INDUSTRIES) this.kline[k] = [];
    // 公告板：{ id, text, icon, industry, mode, expireTurn }
    this.newsBoard = [];
    this._newsSeq = 1;
    this._candleTime = Math.floor(Date.now() / 1000) - 7 * 86400;
    this.blackMarket = [];
    this._blackMarketSeq = 0;
    this.chanceDeck = this._shuffle(CHANCE_CARDS.map((c, i) => i));
    this.chestDeck = this._shuffle(CHEST_CARDS.map((c, i) => i));
    this.turn = 0;
    // 预热各行业 K 线
    for (const k of STOCK_INDUSTRIES) this._seedKline(k, 48);
  }

  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  alivePlayers() { return this.players.filter(p => !p.bankrupt); }

  nextPlayerIndex(from) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const idx = (from + k) % n;
      if (!this.players[idx].bankrupt) return idx;
    }
    return -1;
  }

  winner() {
    const alive = this.alivePlayers();
    return alive.length === 1 ? alive[0] : null;
  }

  rollDie() { return 1 + Math.floor(this.rng() * 6); }

  // ---------- 行业景气 ----------
  industryMult(key) { return INDUSTRY_STATES[this.industry[key] ?? 1].mult; }

  shiftIndustry(key, to) {
    const from = this.industry[key];
    const clamped = Math.max(0, Math.min(INDUSTRY_STATES.length - 1, to));
    this.industry[key] = clamped;
    return { key, from, to: clamped };
  }

  /** 随机一个行业景气 ±1（新闻事件用） */
  randomIndustryShift(rng = this.rng) {
    const keys = Object.keys(INDUSTRIES).filter(k => k !== 'railroad' && k !== 'utility');
    for (let tries = 0; tries < 10; tries++) {
      const key = keys[Math.floor(rng() * keys.length)];
      const dir = rng() < 0.5 ? -1 : 1;
      const cur = this.industry[key];
      const to = cur + dir;
      if (to >= 0 && to < INDUSTRY_STATES.length) return this.shiftIndustry(key, to);
      const inv = cur - dir;
      if (inv >= 0 && inv < INDUSTRY_STATES.length) return this.shiftIndustry(key, inv);
    }
    return null;
  }

  setIndustryExtreme(rng, extreme) { // 'boom' | 'bust'
    const keys = Object.keys(INDUSTRIES).filter(k => k !== 'railroad' && k !== 'utility');
    const key = keys[Math.floor(rng() * keys.length)];
    return this.shiftIndustry(key, extreme === 'boom' ? INDUSTRY_STATES.length - 1 : 0);
  }

  // ---------- 移动 ----------
  recordTransaction(player, amount, reason) {
    if (!player.ledger) player.ledger = [];
    player.ledger.push({ turn: this.turn, amount, balance: player.money, reason });
    if (player.ledger.length > 150) player.ledger.splice(0, player.ledger.length - 150);
  }

  moveSteps(player, steps) {
    const from = player.position;
    let to = from + steps;
    let passedGo = false;
    if (steps > 0) {
      passedGo = to >= TILES.length;
      to %= TILES.length;
    } else {
      to = ((to % TILES.length) + TILES.length) % TILES.length;
    }
    player.position = to;
    if (passedGo) { player.money += GO_SALARY; this.recordTransaction(player, GO_SALARY, '经过起点融资'); }
    if (passedGo && player.doubleGo) {
      player.money += GO_SALARY;
      player.doubleGo = false;
      this.recordTransaction(player, GO_SALARY, '双倍融资');
    }
    return { from, to, passedGo };
  }

  moveTo(player, target, collectGo) {
    const from = player.position;
    player.position = target;
    if (collectGo && target <= from) { player.money += GO_SALARY; this.recordTransaction(player, GO_SALARY, '经过起点融资'); }
    return { from, to: target };
  }

  sendToJail(player) {
    player.position = JAIL_INDEX;
    player.inJail = true;
    player.jailTurns = 0;
  }

  // ---------- 地产 ----------
  groupTiles(color) {
    const idx = [];
    TILES.forEach((t, i) => { if (t.type === 'property' && t.color === color) idx.push(i); });
    return idx;
  }

  hasMonopoly(playerId, color) {
    return this.groupTiles(color).every(i => this.owner[i] === playerId);
  }

  countOwned(playerId, type) {
    let n = 0;
    TILES.forEach((t, i) => { if (t.type === type && this.owner[i] === playerId) n++; });
    return n;
  }

  isMortgaged(i) { return this.mortgaged.has(i); }

  calcRent(tileIdx, diceSum = 7) {
    const t = TILES[tileIdx];
    const ownerId = this.owner[tileIdx];
    if (ownerId < 0 || this.isMortgaged(tileIdx)) return 0;
    if (t.type === 'railroad') {
      const n = this.countOwned(ownerId, 'railroad');
      return RAILROAD_RENTS[Math.max(0, n - 1)];
    }
    if (t.type === 'utility') {
      const n = this.countOwned(ownerId, 'utility');
      return diceSum * (n >= 2 ? ttc(10) : ttc(4));
    }
    if (t.type === 'property') {
      const h = this.houses[tileIdx];
      let r = h > 0 ? t.rents[h] : (this.hasMonopoly(ownerId, t.color) ? t.rents[0] * 2 : t.rents[0]);
      // 景气 ×（购产热度 + 业主本人持股）抬租
      return Math.max(1, Math.round(r * this.industryMult(t.color) * this.industryRentBoost(t.color, ownerId)));
    }
    return 0;
  }

  buyProperty(player, tileIdx) {
    const t = TILES[tileIdx];
    player.money -= t.price;
    this.recordTransaction(player, -t.price, `收购${t.name}`);
    this.owner[tileIdx] = player.id;
    if (t.type === 'property' && STOCK_INDUSTRIES.includes(t.color)) this.onPropertyAcquired(t.color);
  }

  // ---------- 行业股票 / 购产热度 ----------
  stockIndustries() { return STOCK_INDUSTRIES; }

  ensureStocks(player) {
    if (!player.stocks) player.stocks = emptyStocks();
    for (const k of STOCK_INDUSTRIES) if (player.stocks[k] == null) player.stocks[k] = 0;
    return player.stocks;
  }

  totalShares(ind) {
    let n = 0;
    for (const p of this.players) {
      if (p.bankrupt) continue;
      n += (p.stocks?.[ind] || 0);
    }
    return n;
  }

  /** 股价：基础 × 景气 × 资讯 × (1 + 0.05×全场持股) */
  stockPrice(ind) {
    const news = this.newsMult?.[ind] ?? 1;
    return Math.max(1, Math.round(
      STOCK_UNIT_BASE * this.industryMult(ind) * news * (1 + STOCK_PRICE_SHARE * this.totalShares(ind))
    ));
  }

  _nextCandleTime() {
    this._candleTime = (this._candleTime || Math.floor(Date.now() / 1000)) + 86400;
    return this._candleTime;
  }

  /** 预热历史 K 线（几何布朗式随机游走，贴近真实涨跌） */
  _seedKline(ind, bars = 40) {
    if (!this.kline) this.kline = {};
    if (!this.kline[ind]) this.kline[ind] = [];
    let price = this.stockPrice(ind);
    const baseT = Math.floor(Date.now() / 1000) - bars * 86400;
    this.kline[ind] = [];
    for (let i = 0; i < bars; i++) {
      const open = price;
      // 自然涨跌：景气偏向 + 噪声
      const bias = ((this.industry[ind] ?? 1) - 1.5) * 0.008;
      const ret = bias + (this.rng() - 0.48) * 0.06;
      const close = Math.max(1, +(open * (1 + ret)).toFixed(2));
      const hi = Math.max(open, close) * (1 + this.rng() * 0.02);
      const lo = Math.min(open, close) * (1 - this.rng() * 0.02);
      this.kline[ind].push({
        time: baseT + i * 86400,
        open: +open.toFixed(2),
        high: +hi.toFixed(2),
        low: +Math.max(0.5, lo).toFixed(2),
        close,
      });
      price = close;
    }
    this._candleTime = baseT + bars * 86400;
  }

  /** 追加一根 K 线；close 缺省取当前 stockPrice */
  pushCandle(ind, closePrice = null) {
    if (!STOCK_INDUSTRIES.includes(ind)) return null;
    if (!this.kline) this.kline = {};
    if (!this.kline[ind]?.length) this._seedKline(ind, 32);
    const series = this.kline[ind];
    const prev = series[series.length - 1];
    const open = prev ? prev.close : this.stockPrice(ind);
    const close = closePrice != null ? closePrice : this.stockPrice(ind);
    const mid = (open + close) / 2;
    const high = Math.max(open, close, mid * (1 + this.rng() * 0.015));
    const low = Math.min(open, close, mid * (1 - this.rng() * 0.015));
    const bar = {
      time: this._nextCandleTime(),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +Math.max(0.5, low).toFixed(2),
      close: +close.toFixed(2),
    };
    series.push(bar);
    if (series.length > 120) series.splice(0, series.length - 120);
    return bar;
  }

  /**
   * 自然涨跌一轮：所有行业随机游走 + 景气/资讯偏移，并落 K 线
   * 在回合推进时调用
   */
  tickMarket() {
    if (!this.kline) this.kline = {};
    for (const ind of STOCK_INDUSTRIES) {
      if (!this.kline[ind]?.length) this._seedKline(ind, 40);
      const last = this.kline[ind][this.kline[ind].length - 1].close;
      const news = this.newsMult?.[ind] ?? 1;
      const indBias = ((this.industry[ind] ?? 1) - 1.5) * 0.01;
      const newsBias = (news - 1) * 0.04;
      const ret = indBias + newsBias + (this.rng() - 0.5) * 0.05;
      // 把游走结果反映到 newsMult 的微调（有界），使 stockPrice 与 K 线同向
      if (!this.newsMult) this.newsMult = emptyNews();
      const drift = ret * 0.35;
      this.newsMult[ind] = Math.max(NEWS_MIN, Math.min(NEWS_MAX,
        +((this.newsMult[ind] ?? 1) + drift).toFixed(3)));
      const close = Math.max(1, +(last * (1 + ret)).toFixed(2));
      // 同步：用合成价与公式价的混合，避免完全脱节
      const formula = this.stockPrice(ind);
      const blended = +(close * 0.55 + formula * 0.45).toFixed(2);
      this.pushCandle(ind, blended);
    }
    this.pruneNewsBoard();
  }

  getKline(ind) {
    if (!this.kline?.[ind]?.length) this._seedKline(ind, 40);
    return this.kline[ind];
  }

  /** 发布资讯：mode up/down，写入公告板（有失效回合） */
  applyNews(ind, mode, extraText = '') {
    if (!STOCK_INDUSTRIES.includes(ind)) return null;
    if (!this.newsMult) this.newsMult = emptyNews();
    const from = this.newsMult[ind] ?? 1;
    const delta = mode === 'up' ? NEWS_STEP : -NEWS_STEP;
    const to = Math.max(NEWS_MIN, Math.min(NEWS_MAX, +(from + delta).toFixed(2)));
    this.newsMult[ind] = to;
    const indMeta = INDUSTRIES[ind];
    const text = extraText || (
      mode === 'up'
        ? `${indMeta.icon}${indMeta.name} 获资金加持，行情偏多`
        : `${indMeta.icon}${indMeta.name} 遭遇抛压，行情偏空`
    );
    const item = this.pushNewsBoard({
      text,
      icon: mode === 'up' ? '📈' : '📉',
      industry: ind,
      mode,
      ttlTurns: 3,
    });
    // 资讯冲击立刻落一根 K 线
    this.pushCandle(ind);
    return { key: ind, from, to, mode, news: item };
  }

  applyRandomNews(mode, rng = this.rng) {
    const key = STOCK_INDUSTRIES[Math.floor(rng() * STOCK_INDUSTRIES.length)];
    return this.applyNews(key, mode);
  }

  pushNewsBoard({ text, icon = '📢', industry = null, mode = null, ttlTurns = 3 }) {
    if (!this.newsBoard) this.newsBoard = [];
    const item = {
      id: this._newsSeq++,
      text,
      icon,
      industry,
      mode,
      expireTurn: (this.turn || 0) + Math.max(1, ttlTurns),
      at: Date.now(),
    };
    this.newsBoard.unshift(item);
    if (this.newsBoard.length > 24) this.newsBoard.length = 24;
    return item;
  }

  /** 清除已过期公告（expireTurn <= 当前 turn） */
  pruneNewsBoard() {
    if (!this.newsBoard?.length) return [];
    const t = this.turn || 0;
    const kept = [];
    const expired = [];
    for (const n of this.newsBoard) {
      if (n.expireTurn != null && n.expireTurn <= t) expired.push(n);
      else kept.push(n);
    }
    this.newsBoard = kept;
    return expired;
  }

  activeNewsBoard() {
    this.pruneNewsBoard();
    return this.newsBoard || [];
  }

  /**
   * 操作时长 → 生活房租（与 calcLivingRentAmount 同一公式，保留别名）
   * @param {number} seconds
   * @param {object|null} [zone]
   */
  calcOpTimeCost(seconds, zone = null) {
    return calcLivingRentAmount(seconds, zone);
  }

  /** 预估当前操作秒数下的房租（UI 实时提示用） */
  previewLivingRent(seconds, d1Hint = 4) {
    const zone = livingZoneFromDie(d1Hint);
    return { zone, rent: calcLivingRentAmount(seconds, zone) };
  }

  /** 拥有任意可交易地产（房产）→ 豁免生活房租 */
  hasHousing(player) {
    return this.playerProperties(player.id).some(i => TILES[i].type === 'property');
  }

  /**
   * 生活区房租：第一颗骰定区域倍率；金额 = f(操作秒数)，有上限；有房产则豁免
   * @param {object} player
   * @param {number} d1 第一颗骰（1~6）
   * @param {number} [opSeconds=0] 本段操作耗时（秒）
   * @returns {{ zone, rent, seconds, billableSec, waived, paid, bankrupt, capped }}
   */
  resolveLivingRent(player, d1, opSeconds = 0) {
    const zone = livingZoneFromDie(d1);
    player.homeZone = zone.id;
    const sec = Math.max(0, Number(opSeconds) || 0);
    const rent = calcLivingRentAmount(sec, zone);
    const billableSec = Math.max(0, Math.ceil(Math.max(0, sec - LIVING_RENT_FREE_SEC) - 1e-9));
    const capped = rent >= LIVING_RENT_MAX && billableSec > 0;

    if (this.hasHousing(player)) {
      return {
        zone, rent, seconds: sec, billableSec,
        waived: true, paid: 0, bankrupt: false, capped,
      };
    }
    if (rent <= 0) {
      return {
        zone, rent: 0, seconds: sec, billableSec: 0,
        waived: false, paid: 0, bankrupt: false, capped: false,
      };
    }
    const r = this.forcePay(player, rent, null);
    return {
      zone, rent, seconds: sec, billableSec,
      waived: false, paid: r.paid, bankrupt: r.bankrupt, capped,
    };
  }

  sellStockPrice(ind) {
    return Math.max(1, Math.round(this.stockPrice(ind) * STOCK_SPREAD));
  }

  /**
   * 过路费抬升倍率：1 + heat×购产热度 + 业主持股×SHARE_RENT_PER，上限 RENT_BOOST_CAP
   * @param {string} ind 行业
   * @param {number|null} [ownerId] 地产业主 id；缺省时仅用热度（行情总览参考）
   * 说明：持股加成只计业主本人，避免「买对手行业股却抬高对方地租」的反向激励；
   * 全场持股仍通过 stockPrice 影响股价。
   */
  industryRentBoost(ind, ownerId = null) {
    if (!STOCK_INDUSTRIES.includes(ind)) return 1;
    const heat = this.marketHeat?.[ind] || 0;
    let ownerShares = 0;
    if (ownerId != null && ownerId >= 0) {
      const owner = this.players[ownerId];
      ownerShares = owner?.stocks?.[ind] || 0;
    }
    return Math.min(
      RENT_BOOST_CAP,
      1 + HEAT_PER_BUY * heat + SHARE_RENT_PER * ownerShares,
    );
  }

  /** 某玩家在某行业的持股 */
  playerShares(player, ind) {
    if (!player) return 0;
    return this.ensureStocks(player)[ind] || 0;
  }

  /** 行业持仓排行（观战/行情用） */
  stockHolders(ind) {
    if (!STOCK_INDUSTRIES.includes(ind)) return [];
    return this.players
      .filter(p => !p.bankrupt && (p.stocks?.[ind] || 0) > 0)
      .map(p => ({ id: p.id, name: p.name, n: p.stocks[ind] || 0 }))
      .sort((a, b) => b.n - a.n);
  }

  onPropertyAcquired(ind) {
    if (!STOCK_INDUSTRIES.includes(ind)) return;
    if (!this.marketHeat) this.marketHeat = emptyHeat();
    this.marketHeat[ind] = (this.marketHeat[ind] || 0) + 1;
  }

  onPropertyReleased(ind) {
    if (!STOCK_INDUSTRIES.includes(ind)) return;
    if (!this.marketHeat) this.marketHeat = emptyHeat();
    this.marketHeat[ind] = Math.max(0, (this.marketHeat[ind] || 0) - 1);
  }

  /** 同步日历开休市（主线程 GameClock → 逻辑层） */
  syncCalendar(clockOrMeta) {
    if (!clockOrMeta) return;
    if (typeof clockOrMeta.isMarketOpen === 'boolean') {
      this.marketOpen = clockOrMeta.isMarketOpen;
      this.calendarMeta = {
        weekday: clockOrMeta.weekdayName || clockOrMeta.parts?.weekday || '一',
        tPlus: clockOrMeta.tPlus ?? 0,
        dayNumber: clockOrMeta.dayNumber ?? 0,
        marketOpen: this.marketOpen,
      };
    } else {
      this.marketOpen = clockOrMeta.marketOpen !== false;
      this.calendarMeta = { ...clockOrMeta, marketOpen: this.marketOpen };
    }
  }

  isMarketOpen() {
    return this.marketOpen !== false;
  }

  /**
   * 是否具备该行业交易资格（持地门槛，不含开休市）
   */
  canTradeStock(player, ind) {
    if (!STOCK_INDUSTRIES.includes(ind) || player.bankrupt) return false;
    return TILES.some((t, i) =>
      t.type === 'property' && t.color === ind
      && this.owner[i] === player.id && !this.isMortgaged(i)
    );
  }

  canBuyStock(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.isMarketOpen()) return false;
    if (!this.canTradeStock(player, ind)) return false;
    const stocks = this.ensureStocks(player);
    if (stocks[ind] + n > MAX_SHARES_PER_IND) return false;
    // 全场流通上限：防止无限增发
    if (this.totalShares(ind) + n > MAX_MARKET_SHARES) return false;
    return player.money >= this.stockPrice(ind) * n;
  }

  canSellStock(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.isMarketOpen()) return false;
    if (player.bankrupt || !STOCK_INDUSTRIES.includes(ind)) return false;
    return (this.ensureStocks(player)[ind] || 0) >= n;
  }

  /** 还能买几手：个人上限、全场上限、现金三者取 min */
  maxBuyableShares(player, ind) {
    if (!this.isMarketOpen() || !this.canTradeStock(player, ind)) return 0;
    const hold = this.ensureStocks(player)[ind] || 0;
    const byCap = Math.max(0, MAX_SHARES_PER_IND - hold);
    const byMkt = Math.max(0, MAX_MARKET_SHARES - this.totalShares(ind));
    const price = this.stockPrice(ind);
    if (price <= 0) return 0;
    const byCash = Math.floor(player.money / price);
    return Math.max(0, Math.min(byCap, byMkt, byCash));
  }

  buyStock(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.canBuyStock(player, ind, n)) return null;
    const unit = this.stockPrice(ind);
    const cost = unit * n;
    player.money -= cost;
    this.ensureStocks(player)[ind] += n;
    this.pushCandle(ind);
    return {
      cost,
      price: this.stockPrice(ind),
      n,
      // 对自己地产的抬租参考
      boost: this.industryRentBoost(ind, player.id),
    };
  }

  sellStock(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.canSellStock(player, ind, n)) return null;
    const unit = this.sellStockPrice(ind);
    const gain = unit * n;
    player.money += gain;
    this.ensureStocks(player)[ind] -= n;
    this.pushCandle(ind);
    return { gain, price: unit, n, boost: this.industryRentBoost(ind, player.id) };
  }

  // ---------- 做空（裸空：先卖后买平；需持有该行业地产门槛，与做多一致） ----------
  ensureShorts(player) {
    if (!player.shorts) player.shorts = emptyStocks();
    for (const k of STOCK_INDUSTRIES) if (player.shorts[k] == null) player.shorts[k] = 0;
    return player.shorts;
  }

  playerShorts(player, ind) {
    return this.ensureShorts(player)[ind] || 0;
  }

  /** 开空：立即按卖价入账，记空头仓 */
  canOpenShort(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.isMarketOpen()) return false;
    if (!this.canTradeStock(player, ind)) return false;
    // 不可同时持有多头与空头
    if ((this.ensureStocks(player)[ind] || 0) > 0) return false;
    const shorts = this.ensureShorts(player);
    if (shorts[ind] + n > MAX_SHORT_PER_IND) return false;
    // 保证金：开空所得后现金仍须 ≥ 所得×SHORT_MARGIN_RATIO
    // 等价：始终可开（所得先进账），但 maxOpenShort 会限制 n
    return true;
  }

  maxOpenShort(player, ind) {
    if (!this.isMarketOpen() || !this.canTradeStock(player, ind)) return 0;
    if ((this.ensureStocks(player)[ind] || 0) > 0) return 0;
    const held = this.ensureShorts(player)[ind] || 0;
    const byCap = Math.max(0, MAX_SHORT_PER_IND - held);
    if (byCap <= 0) return 0;
    // 保证金约束：开空 n 手得 sellP*n，要求 money+gain >= gain*MARGIN
    // => money >= gain*(MARGIN-1) 当 MARGIN<1 时恒成立于 money>=0
    // 改为：开空后保留金 money+gain - gain = money 不变用作缓冲；
    // 额外限制：潜在回补成本（现价）不超过 money+gain 的 80%
    const sellP = this.sellStockPrice(ind);
    const buyP = this.stockPrice(ind);
    let n = byCap;
    while (n > 0) {
      const gain = sellP * n;
      const coverEst = buyP * n;
      const after = player.money + gain;
      const marginNeed = Math.round(gain * SHORT_MARGIN_RATIO);
      if (after >= marginNeed && after >= coverEst * 0.5) break;
      n--;
    }
    return n;
  }

  openShort(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    const maxN = this.maxOpenShort(player, ind);
    if (n > maxN || n <= 0) return null;
    if (!this.canOpenShort(player, ind, n)) return null;
    const unit = this.sellStockPrice(ind);
    const gain = unit * n;
    player.money += gain;
    this.ensureShorts(player)[ind] += n;
    // 做空压低热度（与卖出类似）
    if (!this.marketHeat) this.marketHeat = emptyHeat();
    this.marketHeat[ind] = Math.max(0, (this.marketHeat[ind] || 0) - 1);
    this.pushCandle(ind);
    return { gain, price: unit, n, short: this.ensureShorts(player)[ind] };
  }

  canCoverShort(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.isMarketOpen()) return false;
    if (player.bankrupt || !STOCK_INDUSTRIES.includes(ind)) return false;
    if ((this.ensureShorts(player)[ind] || 0) < n) return false;
    return player.money >= this.stockPrice(ind) * n;
  }

  maxCoverShort(player, ind) {
    if (!this.isMarketOpen()) return 0;
    const sh = this.ensureShorts(player)[ind] || 0;
    if (sh <= 0) return 0;
    const price = this.stockPrice(ind);
    if (price <= 0) return 0;
    const byCash = Math.floor(player.money / price);
    return Math.max(0, Math.min(sh, byCash));
  }

  /** 平空：按买价回补 */
  coverShort(player, ind, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.canCoverShort(player, ind, n)) return null;
    const unit = this.stockPrice(ind);
    const cost = unit * n;
    player.money -= cost;
    this.ensureShorts(player)[ind] -= n;
    this.pushCandle(ind);
    return { cost, price: unit, n, short: this.ensureShorts(player)[ind] };
  }

  stockPortfolioValue(player) {
    let v = 0;
    const stocks = this.ensureStocks(player);
    const shorts = this.ensureShorts(player);
    for (const k of STOCK_INDUSTRIES) {
      const px = this.stockPrice(k);
      v += (stocks[k] || 0) * px;
      // 空头：负债市值
      v -= (shorts[k] || 0) * px;
    }
    return v;
  }

  /** 持股分红：多头收息；空头付息（不直接改钱；由 applyTurnStart 结算） */
  calcStockDividend(player) {
    let d = 0;
    const stocks = this.ensureStocks(player);
    const shorts = this.ensureShorts(player);
    for (const k of STOCK_INDUSTRIES) {
      const mult = this.industryMult(k);
      const sh = stocks[k] || 0;
      if (sh > 0) d += Math.round(DIVIDEND_PER_SHARE * sh * mult);
      const sk = Math.max(0, shorts[k] || 0);
      if (sk > 0) d -= Math.round(DIVIDEND_PER_SHARE * sk * mult);
    }
    return d;
  }

  /** 任何自有且未抵押地产可建楼；每次升级需消耗 1 张建设卡 + 建楼费（抢工卡免消耗） */
  canBuild(player, tileIdx) {
    const t = TILES[tileIdx];
    if (t.type !== 'property') return false;
    if (this.owner[tileIdx] !== player.id) return false;
    if (this.isMortgaged(tileIdx)) return false;
    if (this.houses[tileIdx] >= MAX_HOUSES) return false;
    if ((player.noBuildTurns || 0) > 0) return false;
    if (!player.rushBuild && (player.items?.permit || 0) < 1) return false;
    return player.money >= t.houseCost;
  }

  buyHouse(player, tileIdx) {
    if (!this.canBuild(player, tileIdx)) return false;
    player.money -= TILES[tileIdx].houseCost;
    this.recordTransaction(player, -TILES[tileIdx].houseCost, `建设${TILES[tileIdx].name}`);
    if (player.rushBuild) {
      player.rushBuild = false;
    } else {
      player.items.permit = (player.items.permit || 0) - 1;
    }
    this.houses[tileIdx]++;
    return true;
  }

  canSellHouse(player, tileIdx) {
    return TILES[tileIdx].type === 'property'
      && this.owner[tileIdx] === player.id
      && this.houses[tileIdx] > 0;
  }

  sellHouse(player, tileIdx) {
    this.houses[tileIdx]--;
    const val = Math.floor(TILES[tileIdx].houseCost / 2);
    player.money += val;
    this.recordTransaction(player, val, `变卖${TILES[tileIdx].name}`);
  }

  playerProperties(playerId) {
    const out = [];
    TILES.forEach((t, i) => {
      if (PROPERTY_TYPES.includes(t.type) && this.owner[i] === playerId) out.push(i);
    });
    return out;
  }

  /** 玩家自有地产按行业分组（建设面板用） */
  buildableSets(playerId) {
    const map = new Map();
    for (const i of this.playerProperties(playerId)) {
      const t = TILES[i];
      if (t.type !== 'property') continue;
      if (!map.has(t.color)) map.set(t.color, []);
      map.get(t.color).push(i);
    }
    return [...map.entries()].map(([color, tiles]) => ({ color, tiles }));
  }

  // ---------- 银行：贷款 / 抵押 ----------
  mortgageValue(i) { return Math.floor(TILES[i].price / 2); }
  unmortgageCost(i) { return Math.ceil(TILES[i].price / 2 * 1.1); }

  canMortgage(player, i) {
    return PROPERTY_TYPES.includes(TILES[i].type)
      && this.owner[i] === player.id && !this.isMortgaged(i) && this.houses[i] === 0;
  }

  mortgage(player, i) {
    this.mortgaged.add(i);
    player.money += this.mortgageValue(i);
  }

  canUnmortgage(player, i) {
    return this.isMortgaged(i) && this.owner[i] === player.id && player.money >= this.unmortgageCost(i);
  }

  unmortgage(player, i) {
    player.money -= this.unmortgageCost(i);
    this.mortgaged.delete(i);
  }

  /** 信用额度 = 基础额度 + 净资产担保 */
  creditLimit(player) {
    let v = BANK_BASE_CREDIT;
    for (const i of this.playerProperties(player.id)) {
      if (this.isMortgaged(i)) continue; // 已抵押地产不再重复担保
      v += this.mortgageValue(i) + this.houses[i] * (TILES[i].houseCost || 0) * 0.4;
    }
    if (player.company) v += 100 * player.company.level;
    return Math.round(v);
  }

  canBorrow(player, amount) {
    return amount > 0 && player.debt + amount <= this.creditLimit(player);
  }

  borrow(player, amount) {
    if (!this.canBorrow(player, amount)) return false;
    player.debt += amount;
    player.money += amount;
    this.recordTransaction(player, amount, '银行贷款');
    return true;
  }

  repay(player, amount) {
    const real = Math.min(amount, player.debt, player.money);
    if (real <= 0) return 0;
    player.debt -= real;
    player.money -= real;
    this.recordTransaction(player, -real, '偿还贷款');
    return real;
  }

  // ---------- 公司（含股权 / IPO / 质押） ----------
  /** 创办/升级公司均需消耗 1 张公司卡 */
  canFoundCompany(player) {
    return !player.company
      && player.money >= COMPANY_FOUND_COST
      && (player.items?.charter || 0) >= 1;
  }

  foundCompany(player, industry) {
    if (!this.canFoundCompany(player)) return false;
    player.money -= COMPANY_FOUND_COST;
    this.recordTransaction(player, -COMPANY_FOUND_COST, `创办${INDUSTRIES[industry]?.name || industry}公司`);
    player.items.charter = (player.items.charter || 0) - 1;
    player.company = {
      industry,
      level: 1,
      ipo: false,
      totalShares: COMPANY_TOTAL_SHARES,
      freeFloat: 0,
      pledged: 0,
      holders: { [player.id]: COMPANY_TOTAL_SHARES },
    };
    return true;
  }

  canUpgradeCompany(player) {
    return player.company
      && player.company.level < COMPANY_MAX_LEVEL
      && player.money >= companyUpgradeCost(player.company.level)
      && (player.items?.charter || 0) >= 1;
  }

  upgradeCompany(player) {
    if (!this.canUpgradeCompany(player)) return false;
    player.money -= companyUpgradeCost(player.company.level);
    this.recordTransaction(player, -companyUpgradeCost(player.company.level), `公司升级至Lv${player.company.level + 1}`);
    player.items.charter = (player.items.charter || 0) - 1;
    player.company.level++;
    return true;
  }

  companySharePrice(ownerPlayer) {
    const c = ownerPlayer?.company;
    if (!c) return 0;
    normalizeCompany(c, ownerPlayer.id);
    const base = this.companyValue(ownerPlayer) / COMPANY_TOTAL_SHARES;
    const news = this.newsMult?.[c.industry] ?? 1;
    return Math.max(1, Math.round(base * this.industryMult(c.industry) * news));
  }

  companyValue(player) {
    if (!player.company) return 0;
    // 与升级成本同量级：注册费 + 累计升级投入
    return COMPANY_FOUND_COST + ttc(250) * (player.company.level - 1);
  }

  /** 有效持股（质押股不参与分红） */
  effectiveCompanyShares(ownerPlayer, holderId) {
    const c = ownerPlayer?.company;
    if (!c) return 0;
    normalizeCompany(c, ownerPlayer.id);
    let n = c.holders[holderId] || 0;
    if (holderId === ownerPlayer.id) n = Math.max(0, n - (c.pledged || 0));
    return n;
  }

  /** 公司总利润池（分给全体有效持股） */
  companyProfitPool(ownerPlayer) {
    if (!ownerPlayer.company) return 0;
    return Math.round(
      companyBaseRevenue(ownerPlayer.company.level) * this.industryMult(ownerPlayer.company.industry)
    );
  }

  /** 创始人应得营收（按有效持股占比） */
  companyRevenue(player) {
    if (!player.company) return 0;
    normalizeCompany(player.company, player.id);
    const pool = this.companyProfitPool(player);
    const eff = this.effectiveCompanyShares(player, player.id);
    return Math.round(pool * eff / COMPANY_TOTAL_SHARES);
  }

  /** 投资人从该公司分到的股息 */
  companyInvestorDividend(investor, founder) {
    if (!founder.company || investor.id === founder.id) return 0;
    normalizeCompany(founder.company, founder.id);
    const pool = this.companyProfitPool(founder);
    const eff = this.effectiveCompanyShares(founder, investor.id);
    return Math.round(pool * eff / COMPANY_TOTAL_SHARES);
  }

  canIPO(player) {
    if (!player.company || player.company.ipo) return false;
    if (player.company.level < COMPANY_IPO_MIN_LEVEL) return false;
    normalizeCompany(player.company, player.id);
    return (player.company.holders[player.id] || 0) - (player.company.pledged || 0) >= COMPANY_IPO_FLOAT;
  }

  /** IPO：抛出公众股，创始人套现 */
  doIPO(player) {
    if (!this.canIPO(player)) return null;
    const c = player.company;
    normalizeCompany(c, player.id);
    const price = this.companySharePrice(player);
    const n = COMPANY_IPO_FLOAT;
    c.holders[player.id] -= n;
    c.freeFloat += n;
    c.ipo = true;
    const raised = price * n;
    player.money += raised;
    return { n, price, raised };
  }

  /** 可卖出的创始人股份（未质押、且保留底线） */
  founderSellableShares(founder) {
    if (!founder.company) return 0;
    const c = founder.company;
    normalizeCompany(c, founder.id);
    const held = c.holders[founder.id] || 0;
    const free = held - (c.pledged || 0);
    const minKeep = Math.ceil(COMPANY_TOTAL_SHARES * (1 - COMPANY_MAX_SELL_PCT));
    return Math.max(0, Math.min(free, held - minKeep));
  }

  /**
   * 入股：从创始人处买入（公允价即时成交，无需对方点同意）
   * 或从 IPO 公众池买入
   */
  canInvestCompany(investor, founder, n = 1, fromFloat = false) {
    n = Math.max(1, n | 0);
    if (!founder?.company || investor.bankrupt || founder.bankrupt) return false;
    if (investor.id === founder.id) return false;
    normalizeCompany(founder.company, founder.id);
    const price = this.companySharePrice(founder) * n;
    if (investor.money < price) return false;
    if (fromFloat) return founder.company.ipo && founder.company.freeFloat >= n;
    return this.founderSellableShares(founder) >= n;
  }

  investCompany(investor, founder, n = 1, fromFloat = false) {
    n = Math.max(1, n | 0);
    if (!this.canInvestCompany(investor, founder, n, fromFloat)) return null;
    const c = founder.company;
    normalizeCompany(c, founder.id);
    const unit = this.companySharePrice(founder);
    const cost = unit * n;
    investor.money -= cost;
    if (fromFloat) {
      c.freeFloat -= n;
    } else {
      c.holders[founder.id] -= n;
      founder.money += cost;
    }
    c.holders[investor.id] = (c.holders[investor.id] || 0) + n;
    return { n, unit, cost, fromFloat };
  }

  /** 银行诱导：质押公司股份换贷款 */
  canPledgeShares(player, n = 1) {
    n = Math.max(1, n | 0);
    if (!player.company) return false;
    normalizeCompany(player.company, player.id);
    const free = (player.company.holders[player.id] || 0) - (player.company.pledged || 0);
    return free >= n;
  }

  pledgeSharesForLoan(player, n = 1) {
    n = Math.max(1, n | 0);
    if (!this.canPledgeShares(player, n)) return null;
    player.company.pledged += n;
    const loan = n * SHARE_PLEDGE_LOAN * Math.max(1, player.company.level);
    player.debt += loan;
    player.money += loan;
    return { n, loan };
  }

  unpledgeShares(player, n = 1) {
    n = Math.max(1, n | 0);
    if (!player.company) return null;
    normalizeCompany(player.company, player.id);
    n = Math.min(n, player.company.pledged || 0);
    if (n <= 0) return null;
    const cost = n * SHARE_PLEDGE_LOAN * Math.max(1, player.company.level);
    if (player.money < cost && player.debt < cost) return null;
    // 优先用现金赎回质押；不足则用还债语义：减少债务并支付
    const pay = Math.min(cost, player.money);
    player.money -= pay;
    if (pay < cost) {
      // 无法足额则拒绝
      player.money += pay;
      return null;
    }
    player.company.pledged -= n;
    // 同步减少等额债务（若有）
    const cut = Math.min(player.debt, cost);
    player.debt -= cut;
    return { n, cost };
  }

  /**
   * 监管智能体审查：高负债、高垄断热度、IPO 后空壳等触发罚款
   * @returns null | { fine, reason }
   */
  regulatorAudit(player, rng = this.rng) {
    if (player.bankrupt || rng() > 0.30) return null; // 30% 触发率（原18%）
    let fine = 0;
    let reason = '';
    if (player.debt > ttc(800) && player.money < player.debt * 0.3) {
      fine = ttc(60) + Math.floor(rng() * ttc(80));
      reason = '高杠杆经营引发合规关注';
    } else if (player.company?.ipo && this.effectiveCompanyShares(player, player.id) < 40) {
      fine = ttc(40) + Math.floor(rng() * ttc(50));
      reason = 'IPO 后控制权异常，启动穿透审查';
    } else {
      let mono = 0;
      for (const k of STOCK_INDUSTRIES) if (this.hasMonopoly(player.id, k)) mono++;
      if (mono >= 2) {
        fine = ttc(50) + mono * ttc(20);
        reason = '多赛道垄断涉嫌不正当竞争';
      }
    }
    if (!fine) {
      // IRS 财富税：资产越高税越重
      const worth = this.netWorth(player);
      if (worth > ttc(500)) {
        fine = Math.floor(worth * (0.01 + rng() * 0.03));
        reason = 'IRS 财富稽查：资产超标，征收累进税';
      } else if (rng() < 0.35) return { fine: 0, reason: '抽查通过，经营合规' };
      return null;
    }
    return { fine, reason };
  }

  /** 银行智能体：是否建议质押贷款 */
  bankShouldPitchPledge(player) {
    if (!player.company || player.bankrupt) return false;
    if (player.money >= ttc(400)) return false;
    if (!this.canPledgeShares(player, 5)) return false;
    return player.debt < ttc(600);
  }

  /** 回合开始结算：公司营收 + 入股股息 + 行业股分红 + 贷款利息 */
  applyTurnStart(player) {
    this.refreshDrawCharges(player);
    player.stamina = Math.min(STAMINA_MAX, (player.stamina || STAMINA_MAX) + STAMINA_REGEN);
    const revenue = this.companyRevenue(player);
    if (revenue > 0) player.money += revenue;

    let equityDiv = 0;
    for (const other of this.players) {
      if (other.id === player.id || other.bankrupt || !other.company) continue;
      equityDiv += this.companyInvestorDividend(player, other);
    }
    if (equityDiv > 0) player.money += equityDiv;

    const stockDiv = this.calcStockDividend(player);
    // 多头分红为正；空头付息为负
    if (stockDiv > 0) player.money += stockDiv;
    else if (stockDiv < 0) {
      const due = -stockDiv;
      if (player.money >= due) player.money -= due;
      else this.forcePay(player, due, null);
    }

    let interest = 0;
    if (player.debt > 0) {
      interest = Math.ceil(player.debt * LOAN_INTEREST);
      player.debt += interest;
    }

    // 地产维护费：每块地 Ŧ5万 + 每级建筑 Ŧ3万
    let maint = 0;
    for (const i of this.playerProperties(player.id)) {
      maint += ttc(5);
      if (this.houses[i] > 0) maint += this.houses[i] * ttc(3);
    }
    if (maint > 0 && player.money >= maint) {
      player.money -= maint;
    } else if (maint > 0) {
      const r = this.forcePay(player, maint, null);
      if (r.bankrupt) return { revenue, interest, dividend: stockDiv + equityDiv, stockDiv, equityDiv, maint };
    }

    return { revenue, interest, dividend: stockDiv + equityDiv, stockDiv, equityDiv, maint };
  }

  // ---------- 道具 / 抽牌系统 ----------
  giveItem(player, item, n = 1) {
    if (!player.items) player.items = {};
    const cur = player.items[item] || 0;
    const typeRoom = Math.max(0, ITEM_STACK_CAP - cur);
    let add = Math.max(0, Math.min(n, typeRoom));
    if (add <= 0) return 0;
    const total = this.countItems(player);
    const handRoom = Math.max(0, HAND_CAP - total);
    const actualAdd = Math.min(add, handRoom);
    if (actualAdd > 0) player.items[item] = cur + actualAdd;
    const overflow = add - actualAdd;
    if (overflow > 0) {
      if (!player.pendingListings) player.pendingListings = [];
      for (let i = 0; i < overflow; i++) player.pendingListings.push(item);
    }
    return actualAdd;
  }

  useItem(player, item) {
    if ((player.items[item] || 0) <= 0) return false;
    player.items[item]--;
    return true;
  }

  /** 手牌总数 */
  countItems(player) {
    if (!player?.items) return 0;
    return Object.values(player.items).reduce((s, n) => s + (n || 0), 0);
  }

  /**
   * 从补给包加权抽 n 张（遵守单种上限）
   * @returns {{ item: string, name: string, icon: string, n: number }[]}
   */
  drawItemPack(player, n = 1) {
    n = Math.max(0, n | 0);
    const got = [];
    for (let i = 0; i < n; i++) {
      const item = this._rollItemKey(player);
      if (!item) break;
      const added = this.giveItem(player, item, 1);
      if (added <= 0) continue;
      const meta = ITEMS[item] || { name: item, icon: '🃏' };
      const last = got[got.length - 1];
      if (last && last.item === item) last.n += added;
      else got.push({ item, name: meta.name, icon: meta.icon, n: added });
    }
    return got;
  }

  /** 加权抽一张键名；若全满则返回 null */
  _rollItemKey(player) {
    const entries = Object.entries(ITEM_DRAW_WEIGHTS).filter(([k]) => {
      const cur = player.items?.[k] || 0;
      return cur < ITEM_STACK_CAP;
    });
    if (!entries.length) return null;
    const sum = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.rng() * sum;
    for (const [k, w] of entries) {
      r -= w;
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  /** 回合开始重置免费/付费抽牌额度 */
  refreshDrawCharges(player) {
    player.freeDrawsLeft = FREE_DRAWS_PER_TURN;
    player.paidDrawsUsed = 0;
  }

  canFreeDraw(player) {
    return !player.bankrupt && (player.freeDrawsLeft || 0) > 0 && !!this._rollItemKey(player);
  }

  canPaidDraw(player) {
    return !player.bankrupt
      && (player.paidDrawsUsed || 0) < PAID_DRAWS_PER_TURN
      && player.money >= PAID_DRAW_COST
      && !!this._rollItemKey(player);
  }

  /**
   * 消耗一次免费抽 / 付费抽
   * @param {'free'|'paid'} mode
   * @returns {{ got: object[], cost: number } | null}
   */
  takeDraw(player, mode = 'free') {
    if (mode === 'paid') {
      if (!this.canPaidDraw(player)) return null;
      player.money -= PAID_DRAW_COST;
      player.paidDrawsUsed = (player.paidDrawsUsed || 0) + 1;
      const got = this.drawItemPack(player, 1);
      return { got, cost: PAID_DRAW_COST, mode: 'paid' };
    }
    if (!this.canFreeDraw(player)) return null;
    player.freeDrawsLeft = (player.freeDrawsLeft || 0) - 1;
    const got = this.drawItemPack(player, 1);
    return { got, cost: 0, mode: 'free' };
  }

  /** 格式化抽牌结果文案 */
  formatDrawLoot(got) {
    if (!got?.length) return '（空手）';
    return got.map(g => `${g.icon}${g.name}×${g.n}`).join('、');
  }

  // ---------- 卡牌黑市 ----------
  autoPriceItem(player, item) {
    const base = ITEM_MARKET_BASE[item] || ttc(10);
    const price = Math.round(base * (0.7 + this.rng() * 0.6));
    return this.listOnMarket(player, item, price);
  }

  listOnMarket(seller, item, price) {
    if (!this.blackMarket) this.blackMarket = [];
    if (!this._blackMarketSeq) this._blackMarketSeq = 0;
    const id = ++this._blackMarketSeq;
    this.blackMarket.push({ id, sellerId: seller.id, item, price, listedTurn: this.turn });
    return id;
  }

  canBuyFromMarket(buyer, listingId) {
    const entry = this.blackMarket.find(e => e.id === listingId);
    if (!entry || entry.sellerId === buyer.id) return false;
    if (this.countItems(buyer) >= HAND_CAP) return false;
    return buyer.money >= entry.price;
  }

  buyFromMarket(buyer, listingId) {
    if (!this.canBuyFromMarket(buyer, listingId)) return null;
    const idx = this.blackMarket.findIndex(e => e.id === listingId);
    const entry = this.blackMarket[idx];
    const seller = this.players[entry.sellerId];
    buyer.money -= entry.price;
    seller.money += entry.price;
    this.giveItem(buyer, entry.item, 1);
    this.blackMarket.splice(idx, 1);
    return entry;
  }

  canUnlist(player, listingId) {
    const entry = this.blackMarket.find(e => e.id === listingId);
    if (!entry || entry.sellerId !== player.id) return false;
    return this.countItems(player) < HAND_CAP;
  }

  unlistFromMarket(player, listingId) {
    if (!this.canUnlist(player, listingId)) return null;
    const idx = this.blackMarket.findIndex(e => e.id === listingId);
    const entry = this.blackMarket[idx];
    this.giveItem(player, entry.item, 1);
    this.blackMarket.splice(idx, 1);
    return entry;
  }

  resolvePendingListings(player, prices = {}) {
    if (!player.pendingListings?.length) return [];
    const listed = [];
    for (const item of player.pendingListings) {
      const price = prices[item] || ITEM_MARKET_BASE[item] || ttc(10);
      const id = this.listOnMarket(player, item, price);
      listed.push({ id, item, price });
    }
    player.pendingListings = [];
    return listed;
  }

  // ---------- 卡牌效果（主动卡，仅自己回合可用；联机与单机共用此语义） ----------
  /** 均富卡：所有存活玩家现金平均，返回平均值 */
  playEqualize() {
    const alive = this.alivePlayers();
    const avg = Math.floor(alive.reduce((s, p) => s + p.money, 0) / alive.length);
    for (const p of alive) p.money = avg;
    return avg;
  }

  /** 抢夺卡：偷取目标 min(其现金20%, Ŧ300万) */
  playRob(caster, target) {
    const amt = Math.min(Math.floor(target.money * 0.2), ttc(300));
    target.money -= amt;
    caster.money += amt;
    return amt;
  }

  canSwapTile(player, tileIdx) {
    return PROPERTY_TYPES.includes(TILES[tileIdx].type)
      && this.owner[tileIdx] === player.id
      && this.houses[tileIdx] === 0
      && !this.isMortgaged(tileIdx);
  }

  /** 换地卡：互换两块地产归属 */
  playSwap(a, b, tileA, tileB) {
    if (!this.canSwapTile(a, tileA) || !this.canSwapTile(b, tileB)) return false;
    this.owner[tileA] = b.id;
    this.owner[tileB] = a.id;
    return true;
  }

  /** 冬眠卡：目标跳过一个回合 */
  playHibernate(target) {
    target.skipTurns = (target.skipTurns || 0) + 1;
  }

  /** 保释令：若在监管局立即脱身 */
  playBail(player) {
    if (!player.inJail) return false;
    player.inJail = false;
    player.jailTurns = 0;
    return true;
  }

  /** 财政补贴：立即获得 Ŧ200万 */
  playSubsidy(player) {
    player.money += ttc(200);
  }

  /** 债务豁免：减免最高 Ŧ400万 */
  playDebtCut(player) {
    const cut = Math.min(player.debt, ttc(400));
    if (cut <= 0) return 0;
    player.debt -= cut;
    return cut;
  }

  /** 审计风暴：指定对手向银行补缴 Ŧ150万 税款 */
  playAudit(caster, target) {
    if (!target || target.id === caster.id || target.bankrupt) return false;
    const result = this.forcePay(target, ttc(150), null);
    return result;
  }

  /** 挖角：随机偷取对手 1 张道具卡 */
  playPoach(caster, target) {
    if (!target || target.id === caster.id || target.bankrupt) return null;
    const entries = Object.entries(target.items || {}).filter(([, n]) => n > 0);
    if (!entries.length) return null;
    const total = entries.reduce((s, [, n]) => s + n, 0);
    let r = this.rng() * total;
    for (const [k, n] of entries) {
      r -= n;
      if (r <= 0) {
        target.items[k]--;
        this.giveItem(caster, k, 1);
        return k;
      }
    }
    const last = entries[entries.length - 1][0];
    target.items[last]--;
    this.giveItem(caster, last, 1);
    return last;
  }

  /** 对冲保单：下次支付租金只付一半 */
  playHedge(player) {
    player.hedgeRent = true;
  }

  /** 抢工卡：下次建楼免消耗建设卡 */
  playRush(player) {
    player.rushBuild = true;
  }

  /** 跃迁卡：传送到名下任意一块地产 */
  playWarp(player, tileIdx) {
    if (tileIdx < 0 || tileIdx >= TILES.length) return false;
    if (this.owner[tileIdx] !== player.id) return false;
    player.position = tileIdx;
    return true;
  }

  /** 双倍融资：下次经过起点融资到账 ×2 */
  playDoubleGo(player) {
    player.doubleGo = true;
  }

  /** 停工令：指定对手下一回合内不可建设 */
  playFreeze(caster, target) {
    if (!target || target.id === caster.id || target.bankrupt) return false;
    target.noBuildTurns = (target.noBuildTurns || 0) + 1;
    return true;
  }

  /** 均负卡：所有存活玩家债务变为平均值 */
  playEqualizeDebt() {
    const alive = this.alivePlayers();
    if (!alive.length) return 0;
    const avg = Math.floor(alive.reduce((s, p) => s + p.debt, 0) / alive.length);
    for (const p of alive) p.debt = avg;
    return avg;
  }

  // ---------- 支付 / 破产 ----------
  /**
   * 强制支付：自动卖房 → 自动抵押 → 信用贷款 → 破产
   * @returns {{paid, bankrupt, soldHouses, mortgaged, borrowed}}
   */
  forcePay(player, amount, creditor = null) {
    let sold = 0, mort = 0, borrowed = 0;
    while (player.money < amount) {
      const props = this.playerProperties(player.id).filter(i => this.houses[i] > 0);
      if (props.length === 0) break;
      props.sort((a, b) => TILES[b].houseCost - TILES[a].houseCost);
      this.sellHouse(player, props[0]);
      sold++;
    }
    while (player.money < amount) {
      const props = this.playerProperties(player.id).filter(i => this.canMortgage(player, i));
      if (props.length === 0) break;
      props.sort((a, b) => TILES[b].price - TILES[a].price);
      this.mortgage(player, props[0]);
      mort++;
    }
    if (player.money < amount) {
      const need = amount - player.money;
      const room = this.creditLimit(player) - player.debt;
      const take = Math.min(need, Math.max(0, room));
      if (take > 0 && this.borrow(player, take)) borrowed = take;
    }
    if (player.money >= amount) {
      player.money -= amount;
      if (creditor) creditor.money += amount;
      return { paid: amount, bankrupt: false, soldHouses: sold, mortgaged: mort, borrowed };
    }
    const rest = player.money;
    player.money = 0;
    if (creditor) creditor.money += rest;
    this._eliminate(player);
    return { paid: rest, bankrupt: true, soldHouses: sold, mortgaged: mort, borrowed };
  }

  _eliminate(player) {
    player.bankrupt = true;
    player.inJail = false;
    player.debt = 0;
    player.jailCards = 0;
    player.skipTurns = 0;
    for (const k of Object.keys(player.items)) player.items[k] = 0;
    player.stocks = emptyStocks();
    player.shorts = emptyStocks();
    // 他人公司中的股权作废（进 freeFloat 若已 IPO，否则销毁到创始人）
    for (const other of this.players) {
      if (!other.company?.holders?.[player.id]) continue;
      const n = other.company.holders[player.id];
      delete other.company.holders[player.id];
      if (other.company.ipo) other.company.freeFloat += n;
      else other.company.holders[other.id] = (other.company.holders[other.id] || 0) + n;
    }
    // 自己的公司解散：股权清零
    player.company = null;
    TILES.forEach((t, i) => {
      if (this.owner[i] === player.id) {
        if (t.type === 'property' && STOCK_INDUSTRIES.includes(t.color)) this.onPropertyReleased(t.color);
        this.owner[i] = -1;
        this.houses[i] = 0;
        this.mortgaged.delete(i);
      }
    });
  }

  netWorth(player) {
    let v = player.money - player.debt;
    for (const i of this.playerProperties(player.id)) {
      v += TILES[i].price + this.houses[i] * (TILES[i].houseCost || 0);
    }
    // 公司净值按有效持股占比
    if (player.company) {
      normalizeCompany(player.company, player.id);
      const eff = this.effectiveCompanyShares(player, player.id);
      v += Math.round(this.companyValue(player) * eff / COMPANY_TOTAL_SHARES);
    }
    // 入股他人公司
    for (const other of this.players) {
      if (other.id === player.id || !other.company) continue;
      const sh = other.company.holders?.[player.id] || 0;
      if (sh > 0) v += sh * this.companySharePrice(other);
    }
    v += this.stockPortfolioValue(player);
    return v;
  }

  // ---------- 交易 ----------
  /** 交易合法性：无建筑、未抵押、双方未破产、买家付得起 */
  canTrade(buyer, seller, tileIdx, price) {
    if (buyer.bankrupt || seller.bankrupt) return false;
    if (!PROPERTY_TYPES.includes(TILES[tileIdx].type)) return false;
    if (this.owner[tileIdx] !== seller.id) return false;
    if (this.houses[tileIdx] > 0 || this.isMortgaged(tileIdx)) return false;
    if (price <= 0 || buyer.money < price) return false;
    return true;
  }

  executeTrade(buyer, seller, tileIdx, price) {
    buyer.money -= price;
    seller.money += price;
    // 产权转移不改变全场「已售地产」数量，热度不变
    this.owner[tileIdx] = buyer.id;
  }

  // ---------- 卡牌（AI 加权随机 + 牌堆） ----------
  /**
   * AI 随机抽卡：按局势加权，再与牌堆结合
   * - 穷则多偏向得钱/道具；富则多偏向风险/行业波动
   */
  drawCard(deck) {
    const pool = deck === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
    const d = deck === 'chance' ? this.chanceDeck : this.chestDeck;
    // AI 权重：根据「当前回合玩家」若不可得则用均值
    const p = this.players[this.turn % Math.max(1, this.players.length)] || this.alivePlayers()[0];
    const money = p?.money ?? 1000;
    const weights = pool.map((card) => {
      let w = 1;
      const k = card.action?.kind;
      if (money < 400) {
        if (k === 'money' && card.action.amount > 0) w += 2;
        if (k === 'item') w += 1.5;
        if (k === 'money' && card.action.amount < 0) w *= 0.5;
        if (k === 'jail') w *= 0.4;
      } else if (money > 2000) {
        if (k === 'industry' || k === 'news') w += 1.5;
        if (k === 'money' && card.action.amount < 0) w += 0.8;
      }
      if (k === 'news' || k === 'item' && card.action.item === 'intel') w += 0.6;
      return w;
    });
    // 70% AI 加权从全池抽，30% 走牌堆（保留洗牌感）
    let idx;
    if (this.rng() < 0.7 || !d.length) {
      const sum = weights.reduce((a, b) => a + b, 0);
      let r = this.rng() * sum;
      idx = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) { idx = i; break; }
      }
      // 与牌堆同步：若在牌堆中则移到末尾
      const pos = d.indexOf(idx);
      if (pos >= 0) {
        d.splice(pos, 1);
        if (pool[idx].action.kind !== 'jailCard') d.push(idx);
      }
    } else {
      idx = d.shift();
      if (pool[idx].action.kind !== 'jailCard') d.push(idx);
    }
    return { card: pool[idx], deck };
  }

  nearestOfType(position, type) {
    for (let k = 1; k <= TILES.length; k++) {
      const i = (position + k) % TILES.length;
      if (TILES[i].type === type) return i;
    }
    return position;
  }

  // ---------- 存档序列化 ----------
  serialize() {
    return {
      players: this.players,
      owner: this.owner,
      houses: this.houses,
      mortgaged: [...this.mortgaged],
      industry: this.industry,
      marketHeat: this.marketHeat,
      newsMult: this.newsMult,
      marketOpen: this.marketOpen !== false,
      calendarMeta: this.calendarMeta || null,
      kline: this.kline,
      newsBoard: this.newsBoard,
      chanceDeck: this.chanceDeck,
      chestDeck: this.chestDeck,
      turn: this.turn,
      blackMarket: this.blackMarket,
      _blackMarketSeq: this._blackMarketSeq,
    };
  }

  static deserialize(data) {
    const g = new GameState([]);
    g.players = data.players;
    for (const p of g.players) {
      if (!p.stocks) p.stocks = emptyStocks();
      else for (const k of STOCK_INDUSTRIES) if (p.stocks[k] == null) p.stocks[k] = 0;
      if (!p.shorts) p.shorts = emptyStocks();
      else for (const k of STOCK_INDUSTRIES) if (p.shorts[k] == null) p.shorts[k] = 0;
      if (!p.items) p.items = {};
      if (p.items.intel == null) p.items.intel = 0;
      if (p.items.permit == null) p.items.permit = 0;
      if (p.items.charter == null) p.items.charter = 0;
      if (p.freeDrawsLeft == null) p.freeDrawsLeft = 0;
      if (p.paidDrawsUsed == null) p.paidDrawsUsed = 0;
      if (p.company) normalizeCompany(p.company, p.id);
    }
    g.owner = data.owner;
    g.houses = data.houses;
    g.mortgaged = new Set(data.mortgaged);
    g.industry = data.industry;
    g.marketHeat = data.marketHeat ? { ...emptyHeat(), ...data.marketHeat } : emptyHeat();
    g.newsMult = data.newsMult ? { ...emptyNews(), ...data.newsMult } : emptyNews();
    g.marketOpen = data.marketOpen !== false;
    g.calendarMeta = data.calendarMeta || { weekday: '一', tPlus: 0, dayNumber: 0, marketOpen: g.marketOpen };
    g.kline = data.kline || {};
    for (const k of STOCK_INDUSTRIES) {
      if (!g.kline[k]?.length) g._seedKline(k, 40);
    }
    g.newsBoard = data.newsBoard || [];
    g.chanceDeck = data.chanceDeck;
    g.chestDeck = data.chestDeck;
    g.turn = data.turn || 0;
    g.blackMarket = data.blackMarket || [];
    g._blackMarketSeq = data._blackMarketSeq || 0;
    g._newsSeq = (data._newsSeq || 0) || Math.max(g.turn, 0);
    return g;
  }
}
