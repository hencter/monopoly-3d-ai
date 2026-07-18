// 核心游戏状态与规则（纯逻辑，无 DOM / Three 依赖，可无头测试）
// 现代商业版：行业景气、银行贷款、地产抵押、创办公司、道具
import {
  TILES, INDUSTRIES, INDUSTRY_STATES, GO_SALARY, JAIL_INDEX, JAIL_FINE, START_MONEY,
  MAX_HOUSES, RAILROAD_RENTS, BANK_BASE_CREDIT, LOAN_INTEREST,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost, companyBaseRevenue,
} from '../data/tiles.js';
import { CHANCE_CARDS, CHEST_CARDS } from '../data/cards.js';

export {
  TILES, INDUSTRIES, INDUSTRY_STATES, GO_SALARY, JAIL_INDEX, JAIL_FINE, START_MONEY, MAX_HOUSES,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
};

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
      company: null,              // { industry, level }
      skipTurns: 0,               // 冬眠：跳过回合数
      items: { remote: 1, boost: 0, rentFree: 0, demolish: 0, equalize: 0, rob: 0, swap: 0, hibernate: 0 },
    }));
    // 开局手牌：遥控骰子 + 随机一张策略卡
    const pool = ['boost', 'rentFree', 'demolish', 'equalize', 'rob', 'swap', 'hibernate'];
    for (const p of this.players) {
      p.items[pool[Math.floor(this.rng() * pool.length)]]++;
    }
    this.owner = new Array(TILES.length).fill(-1);
    this.houses = new Array(TILES.length).fill(0);
    this.mortgaged = new Set();   // 已抵押格子
    // 行业景气（0~3，初始平稳=1）
    this.industry = {};
    for (const key of Object.keys(INDUSTRIES)) this.industry[key] = 1;
    this.chanceDeck = this._shuffle(CHANCE_CARDS.map((c, i) => i));
    this.chestDeck = this._shuffle(CHEST_CARDS.map((c, i) => i));
    this.turn = 0;
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
    if (passedGo) player.money += GO_SALARY;
    return { from, to, passedGo };
  }

  moveTo(player, target, collectGo) {
    const from = player.position;
    player.position = target;
    if (collectGo && target <= from) player.money += GO_SALARY; // 绕圈或直达起点
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
      return diceSum * (n >= 2 ? 10 : 4);
    }
    if (t.type === 'property') {
      const h = this.houses[tileIdx];
      let r = h > 0 ? t.rents[h] : (this.hasMonopoly(ownerId, t.color) ? t.rents[0] * 2 : t.rents[0]);
      return Math.max(1, Math.round(r * this.industryMult(t.color)));
    }
    return 0;
  }

  buyProperty(player, tileIdx) {
    player.money -= TILES[tileIdx].price;
    this.owner[tileIdx] = player.id;
  }

  /** 大富翁经典规则：任何自有且未抵押的地产均可建楼（垄断另享空地双倍租金） */
  canBuild(player, tileIdx) {
    const t = TILES[tileIdx];
    if (t.type !== 'property') return false;
    if (this.owner[tileIdx] !== player.id) return false;
    if (this.isMortgaged(tileIdx)) return false;
    if (this.houses[tileIdx] >= MAX_HOUSES) return false;
    return player.money >= t.houseCost;
  }

  buyHouse(player, tileIdx) {
    player.money -= TILES[tileIdx].houseCost;
    this.houses[tileIdx]++;
  }

  canSellHouse(player, tileIdx) {
    return TILES[tileIdx].type === 'property'
      && this.owner[tileIdx] === player.id
      && this.houses[tileIdx] > 0;
  }

  sellHouse(player, tileIdx) {
    this.houses[tileIdx]--;
    player.money += Math.floor(TILES[tileIdx].houseCost / 2);
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
    return true;
  }

  repay(player, amount) {
    const real = Math.min(amount, player.debt, player.money);
    if (real <= 0) return 0;
    player.debt -= real;
    player.money -= real;
    return real;
  }

  // ---------- 公司 ----------
  canFoundCompany(player) {
    return !player.company && player.money >= COMPANY_FOUND_COST;
  }

  foundCompany(player, industry) {
    player.money -= COMPANY_FOUND_COST;
    player.company = { industry, level: 1 };
  }

  canUpgradeCompany(player) {
    return player.company && player.company.level < COMPANY_MAX_LEVEL
      && player.money >= companyUpgradeCost(player.company.level);
  }

  upgradeCompany(player) {
    player.money -= companyUpgradeCost(player.company.level);
    player.company.level++;
  }

  companyRevenue(player) {
    if (!player.company) return 0;
    return Math.round(companyBaseRevenue(player.company.level) * this.industryMult(player.company.industry));
  }

  companyValue(player) {
    if (!player.company) return 0;
    return COMPANY_FOUND_COST + 250 * (player.company.level - 1);
  }

  /** 回合开始结算：公司营收 + 贷款利息（利滚利计入债务） */
  applyTurnStart(player) {
    const revenue = this.companyRevenue(player);
    if (revenue > 0) player.money += revenue;
    let interest = 0;
    if (player.debt > 0) {
      interest = Math.ceil(player.debt * LOAN_INTEREST);
      player.debt += interest;
    }
    return { revenue, interest };
  }

  // ---------- 道具 ----------
  giveItem(player, item, n = 1) {
    player.items[item] = (player.items[item] || 0) + n;
  }

  useItem(player, item) {
    if ((player.items[item] || 0) <= 0) return false;
    player.items[item]--;
    return true;
  }

  // ---------- 卡牌效果（主动卡，仅自己回合可用；联机与单机共用此语义） ----------
  /** 均富卡：所有存活玩家现金平均，返回平均值 */
  playEqualize() {
    const alive = this.alivePlayers();
    const avg = Math.floor(alive.reduce((s, p) => s + p.money, 0) / alive.length);
    for (const p of alive) p.money = avg;
    return avg;
  }

  /** 抢夺卡：偷取目标 min(其现金20%, ¥300) */
  playRob(caster, target) {
    const amt = Math.min(Math.floor(target.money * 0.2), 300);
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
    player.company = null;
    player.debt = 0;
    player.jailCards = 0;
    player.skipTurns = 0;
    for (const k of Object.keys(player.items)) player.items[k] = 0;
    TILES.forEach((t, i) => {
      if (this.owner[i] === player.id) {
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
    v += this.companyValue(player);
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
    this.owner[tileIdx] = buyer.id;
  }

  // ---------- 卡牌 ----------
  drawCard(deck) {
    const d = deck === 'chance' ? this.chanceDeck : this.chestDeck;
    const idx = d.shift();
    const card = (deck === 'chance' ? CHANCE_CARDS : CHEST_CARDS)[idx];
    if (card.action.kind !== 'jailCard') d.push(idx);
    return { card, deck };
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
      chanceDeck: this.chanceDeck,
      chestDeck: this.chestDeck,
      turn: this.turn,
    };
  }

  static deserialize(data) {
    const g = new GameState([]);
    g.players = data.players;
    g.owner = data.owner;
    g.houses = data.houses;
    g.mortgaged = new Set(data.mortgaged);
    g.industry = data.industry;
    g.chanceDeck = data.chanceDeck;
    g.chestDeck = data.chestDeck;
    g.turn = data.turn || 0;
    return g;
  }
}
