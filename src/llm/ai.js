import { ttc, formatMoney } from '../data/currency.js';
// AI 人格大脑：DeepSeek 驱动决策/谈判/闲聊；无 Key 或调用失败时回退本地启发式
import { TILES, INDUSTRIES, INDUSTRY_STATES } from '../data/tiles.js';

export const PERSONAS = [
  { id: 'shenyi', name: '沈毅', style: '精明保守的风控总监，现金流至上，说话简洁专业，讨厌冲动消费', buyReserve: 250, risk: 0.4 },
  { id: 'ahao',   name: '阿豪', style: '激进的赌徒型投资人，敢加杠杆，口头禅"富贵险中求"', buyReserve: 60, risk: 0.9 },
  { id: 'linda',  name: '琳达', style: '科技新贵，坚定看好人工智能和半导体，说话带英文词，喜欢all in前沿行业', buyReserve: 150, risk: 0.7, favIndustry: ['ai', 'semiconductor'] },
  { id: 'laozhou',name: '老周', style: '实业起家的老江湖，精打细算爱还价，常说"年轻人，做生意要讲道理"', buyReserve: 180, risk: 0.55 },
  { id: 'xiaomeng',name:'小萌', style: '运气爆棚的创业萌新，说话可爱用颜文字，决策随性', buyReserve: 100, risk: 0.65 },
];

const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

// ---------- 本地兜底台词 ----------
const BANTER = {
  buy: ['这块地我看好很久了！', '拿下！现金留着也是贬值。', '好地段不等人。', '小投一笔，布局未来。'],
  skip: ['太贵了，pass。', '这价格当我冤大头？', '现金流要紧，忍一手。'],
  rent: ['嘶……这一刀有点疼。', '房租比我的利润还高！', '下次我一定绕着你走。'],
  jail: ['我要求见我的律师！', '误会，都是误会啊！', '里面信号好不好……'],
  bankrupt: ['不可能！我的商业帝国……', '江湖再见，我还会回来的！'],
  win: ['承让承让，商界就是这么残酷。', '下次记得叫我一声董事长。'],
  doubles: ['手感来了，挡都挡不住！', '连双！今天运气在我这边。'],
  chatGeneric: ['这局我志在必得。', '先让我看看报表。', '生意嘛，有得谈。', '你猜我下一步买哪？'],
};

export class AIBrain {
  /**
   * @param {DeepSeekClient} client
   * @param {GameState} game
   */
  constructor(client, game) {
    this.client = client;
    this.g = game;
    this._banterBusy = false;
  }

  personaOf(player) {
    return PERSONAS.find(p => p.id === player.persona) || PERSONAS[player.id % PERSONAS.length];
  }

  // ---------- 上下文 ----------
  _playerCtx(p) {
    const stocks = {};
    const shorts = {};
    for (const k of Object.keys(INDUSTRIES)) {
      if (k === 'railroad' || k === 'utility') continue;
      const long = p.stocks?.[k] || 0;
      const sh = p.shorts?.[k] || 0;
      if (long) stocks[INDUSTRIES[k].name] = long;
      if (sh) shorts[INDUSTRIES[k].name] = sh;
    }
    return {
      名字: p.name,
      现金: p.money,
      债务: p.debt,
      身价: this.g.netWorth?.(p) ?? p.money,
      位置: TILES[p.position]?.name,
      地产数: this.g.playerProperties(p.id).length,
      道具: Object.fromEntries(Object.entries(p.items || {}).filter(([, n]) => n > 0)),
      公司: p.company ? `${INDUSTRIES[p.company.industry].name}Lv${p.company.level}${p.company.ipo ? 'IPO' : ''}` : '无',
      多头持股: stocks,
      空头仓位: shorts,
      行业景气: Object.fromEntries(
        Object.entries(this.g.industry)
          .filter(([k]) => !['railroad', 'utility'].includes(k))
          .map(([k, v]) => [INDUSTRIES[k].name, INDUSTRY_STATES[v].name]),
      ),
    };
  }

  _tileCtx(i) {
    const t = TILES[i];
    const ctx = { 名称: t.name, 类型: t.type, 价格: t.price };
    if (t.type === 'property') {
      ctx.行业 = INDUSTRIES[t.color].name;
      ctx.行业状态 = INDUSTRY_STATES[this.g.industry[t.color]].name;
      ctx.空地租金 = t.rents[0];
      ctx.地标租金 = t.rents[5];
      ctx.当前租金 = this.g.calcRent(i);
    }
    return ctx;
  }

  /**
   * 调用 DeepSeek 拿 JSON 决策；失败回退 fallback
   * 使用官方 response_format=json_object + 非思考模式（快、稳、省）
   */
  async _json(system, user, fallback, maxTokens = 200) {
    if (!this.client?.enabled) return fallback;
    const sys = `${system}\n你必须只输出一个合法 JSON 对象，不要 markdown，不要解释。`;
    const text = await this.client.chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user, null, 0) },
      ],
      {
        maxTokens,
        temperature: 0.4,
        timeout: 22000,
        jsonMode: true,
        thinking: 'disabled', // 决策要快，不走思维链
      },
    );
    if (!text) return fallback;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    try { return { ...fallback, ...JSON.parse(m[0]) }; } catch { return fallback; }
  }

  // ---------- 购地决策 ----------
  async decideBuy(player, tileIdx) {
    const t = TILES[tileIdx];
    const persona = this.personaOf(player);
    const completes = t.type === 'property' &&
      this.g.groupTiles(t.color).every(i => i === tileIdx || this.g.owner[i] === player.id);
    const fav = persona.favIndustry?.includes(t.color);

    // 本地估值（兜底 & 校验）
    const reserve = completes ? 0 : persona.buyReserve - (fav ? 60 : 0);
    const localBuy = player.money - t.price >= reserve;

    if (!this.client.enabled) {
      return { buy: localBuy, say: pick(localBuy ? BANTER.buy : BANTER.skip) };
    }
    const r = await this._json(
      `你在大富翁商业战争游戏中扮演"${player.name}"，人设：${persona.style}。是否收购这块地？只输出JSON：{"buy":true或false,"say":"一句10字以内的话"}`,
      { 你的情况: this._playerCtx(player), 地块: this._tileCtx(tileIdx), 收购后现金: player.money - t.price, 能完成行业垄断: completes },
      { buy: localBuy, say: pick(localBuy ? BANTER.buy : BANTER.skip) }
    );
    // 现金安全线：LLM 也不能低于 0 现金（游戏已保证），极端保守修正
    if (player.money - t.price < 30 && !completes) r.buy = false;
    const buy = r.buy === true || r.buy === 'true'; // 严格布尔（防 LLM 返回字符串）
    return { buy, say: String(r.say || '').slice(0, 40) };
  }

  // ---------- 交易谈判 ----------
  /**
   * AI 作为卖方或被求购方评估报价
   * @returns {Promise<{decision:'accept'|'reject'|'counter', counterPrice:number, say:string}>}
   */
  async evaluateTrade(buyer, seller, tileIdx, price) {
    const t = TILES[tileIdx];
    const persona = this.personaOf(seller);
    // 本地公允估值
    let fair = t.price;
    if (t.type === 'property') {
      const inMyMonopoly = this.g.hasMonopoly(seller.id, t.color);
      const breaksSet = this.g.groupTiles(t.color).filter(i => this.g.owner[i] === seller.id).length >= 2;
      if (inMyMonopoly) fair *= 2.4;
      else if (breaksSet) fair *= 1.6;
      fair *= INDUSTRY_STATES[this.g.industry[t.color]].mult > 1 ? 1.3 : 1;
      // 对方能完成垄断则抬价
      const completesForBuyer = this.g.groupTiles(t.color).every(i => i === tileIdx || this.g.owner[i] === buyer.id);
      if (completesForBuyer) fair *= 1.5;
    }
    fair = Math.round(fair);
    const local = price >= fair
      ? { decision: 'accept', counterPrice: price, say: '成交！' }
      : price >= fair * 0.65
        ? { decision: 'counter', counterPrice: Math.round(fair * 1.05), say: `这点钱？${formatMoney(Math.round(fair * 1.05))} 才够。` }
        : { decision: 'reject', counterPrice: 0, say: '打发叫花子呢？' };

    if (!this.client.enabled) return { ...local, fair };
    const r = await this._json(
      `你在大富翁商业战争游戏中扮演"${seller.name}"，人设：${persona.style}。有人想买你的地产，评估报价。只输出JSON：{"decision":"accept"|"reject"|"counter","counterPrice":数字(还价,accept/reject时填0),"say":"一句15字以内的话"}`,
      { 你的情况: this._playerCtx(seller), 买家: buyer.name, 地产: this._tileCtx(tileIdx), 你的心理价位: fair, 对方报价: price },
      local, 140
    );
    if (!['accept', 'reject', 'counter'].includes(r.decision)) r.decision = local.decision;
    r.counterPrice = Math.max(0, Math.round(Number(r.counterPrice) || 0));
    if (r.decision === 'counter' && r.counterPrice <= price) r.decision = 'accept';
    r.say = String(r.say || '').slice(0, 50);
    r.fair = fair;
    return r;
  }

  /** AI 作为买家评估对方卖价 */
  async evaluatePurchase(buyer, seller, tileIdx, price) {
    const t = TILES[tileIdx];
    let value = t.price * 0.95;
    if (t.type === 'property') {
      const completes = this.g.groupTiles(t.color).every(i => i === tileIdx || this.g.owner[i] === buyer.id);
      if (completes) value *= 1.9;
    }
    value = Math.round(value);
    const local = price <= value
      ? { decision: 'accept', counterPrice: price, say: '这价公道，买了！' }
      : price <= value * 1.35
        ? { decision: 'counter', counterPrice: Math.max(1, Math.round(value)), say: '便宜点，交个朋友。' }
        : { decision: 'reject', counterPrice: 0, say: '狮子大开口啊。' };
    if (!this.client.enabled) return { ...local, fair: value };
    const persona = this.personaOf(buyer);
    const r = await this._json(
      `你在大富翁商业战争游戏中扮演"${buyer.name}"，人设：${persona.style}。对方要把地产卖给你，评估是否接盘。只输出JSON：{"decision":"accept"|"reject"|"counter","counterPrice":数字,"say":"一句15字以内的话"}`,
      { 你的情况: this._playerCtx(buyer), 卖家: seller.name, 地产: this._tileCtx(tileIdx), 你的心理价位: value, 对方开价: price },
      local, 140
    );
    if (!['accept', 'reject', 'counter'].includes(r.decision)) r.decision = local.decision;
    r.counterPrice = Math.max(0, Math.round(Number(r.counterPrice) || 0));
    if (r.decision === 'counter' && (r.counterPrice >= price || r.counterPrice <= 0)) r.decision = 'reject';
    r.say = String(r.say || '').slice(0, 50);
    r.fair = value;
    return r;
  }

  // ---------- 闲聊 / 垃圾话 ----------
  async banter(player, kind) {
    if (!this.client.enabled) return pick(BANTER[kind] || BANTER.chatGeneric);
    if (this._banterBusy) return pick(BANTER[kind] || BANTER.chatGeneric);
    this._banterBusy = true;
    try {
      const persona = this.personaOf(player);
      const events = {
        buy: '刚刚收购了一块地', skip: '刚刚放弃了一块地', rent: '刚刚付了一大笔租金',
        jail: '刚刚被关进监管局', bankrupt: '刚刚破产了', win: '即将赢下整局', doubles: '刚刚掷出双数',
      };
      const text = await this.client.chat([
        { role: 'system', content: `你在大富翁商业战争游戏中扮演"${player.name}"，人设：${persona.style}。针对事件说一句15字以内的短评（符合人设，可幽默可嘲讽），只输出这句话本身。` },
        { role: 'user', content: `事件：${events[kind] || '轮到你了'}。当前你现金${formatMoney(player.money)}，债务${formatMoney(player.debt)}。` },
      ], { maxTokens: 60, temperature: 0.95, thinking: 'disabled' });
      this._banterBusy = false;
      return (text || pick(BANTER[kind] || BANTER.chatGeneric)).replace(/["\n]/g, '').slice(0, 40);
    } catch {
      this._banterBusy = false;
      return pick(BANTER[kind] || BANTER.chatGeneric);
    }
  }

  /** 自由聊天回复 */
  async chatReply(player, fromName, message) {
    if (!this.client.enabled) return pick(BANTER.chatGeneric);
    const persona = this.personaOf(player);
    const text = await this.client.chat([
      { role: 'system', content: `你在大富翁商业战争游戏中扮演"${player.name}"，人设：${persona.style}。玩家"${fromName}"在局内聊天中对你说话，用一两句话回复（25字以内，符合人设，可谈生意可互怼），只输出回复本身。` },
      { role: 'user', content: `你的现状：现金${formatMoney(player.money)}，债务${formatMoney(player.debt)}，地产${this.g.playerProperties(player.id).length}处。对方说：${message}` },
    ], { maxTokens: 80, temperature: 0.9, thinking: 'disabled' });
    return (text || pick(BANTER.chatGeneric)).replace(/\n/g, ' ').slice(0, 60);
  }

  /** 掷骰阶段：遥控 / 加速 / 普通 */
  async decideRoll(player, landingScores = {}) {
    const local = { type: 'roll', boost: false, total: 0 };
    const hasRemote = (player.items?.remote || 0) > 0;
    const hasBoost = (player.items?.boost || 0) > 0;
    if (hasRemote) {
      let best = 0, bestS = -1e9;
      for (let k = 1; k <= 6; k++) {
        const s = landingScores[k] ?? 0;
        if (s > bestS) { bestS = s; best = k; }
      }
      if (bestS > 1.5) Object.assign(local, { type: 'remote', total: best });
    }
    if (local.type === 'roll' && hasBoost && this.g.rng() < 0.3) local.boost = true;

    if (!this.client.enabled) return local;
    const persona = this.personaOf(player);
    const r = await this._json(
      `你在大富翁商业战争游戏中扮演"${player.name}"，人设：${persona.style}。决定如何前进。只输出JSON：{"type":"roll"或"remote","total":1到6(仅remote),"boost":true或false(仅roll且有加速卡)}`,
      {
        你的情况: this._playerCtx(player),
        有遥控骰子: hasRemote,
        有加速卡: hasBoost,
        各点数落点评分: landingScores,
      },
      local,
      100,
    );
    if (r.type === 'remote' && hasRemote) {
      const t = Math.max(1, Math.min(6, Number(r.total) || local.total || 4));
      return { type: 'remote', total: t, boost: false };
    }
    return {
      type: 'roll',
      boost: !!(hasBoost && (r.boost === true || r.boost === 'true')),
      total: 0,
    };
  }

  /** 监管约谈脱身 */
  async decideJail(player, { canPay, hasCard }) {
    let local = 'roll';
    if (hasCard) local = 'card';
    else if (canPay && player.money >= 300) local = 'pay';
    if (!this.client.enabled) return local;
    const persona = this.personaOf(player);
    const r = await this._json(
      `你在大富翁商业战争游戏中扮演"${player.name}"，人设：${persona.style}。在监管局选择脱身。只输出JSON：{"choice":"card"|"pay"|"roll"}`,
      {
        你的情况: this._playerCtx(player),
        有免谈卡: hasCard,
        可缴保证金: canPay,
        尝试次数: player.jailTurns + 1,
      },
      { choice: local },
      80,
    );
    const c = r.choice;
    if (c === 'card' && hasCard) return 'card';
    if (c === 'pay' && canPay) return 'pay';
    return 'roll';
  }

  /** 是否使用免租卡 */
  async decideItemUse(player, item, ctx) {
    const local = (ctx?.rent || 0) >= 80;
    if (!this.client.enabled) return local;
    const persona = this.personaOf(player);
    const r = await this._json(
      `你在大富翁商业战争游戏中扮演"${player.name}"，人设：${persona.style}。是否使用免租卡。只输出JSON：{"use":true或false}`,
      {
        你的情况: this._playerCtx(player),
        本次租金: ctx?.rent,
        剩余免租卡: player.items?.rentFree || 0,
      },
      { use: local },
      60,
    );
    return r.use === true || r.use === 'true';
  }

  /**
   * 回合末完整经营计划（DeepSeek）
   * @returns {Promise<{actions: object[], say: string}>}
   */
  async planTurnEnd(player) {
    const g = this.g;
    const localActions = this._localTurnEndPlan(player);
    if (!this.client.enabled) return { actions: localActions, say: '' };

    const persona = this.personaOf(player);
    const buildable = [];
    for (const set of g.buildableSets(player.id)) {
      for (const i of set.tiles) {
        if (g.canBuild(player, i)) {
          buildable.push({ tileIdx: i, name: TILES[i].name, cost: TILES[i].houseCost, lv: g.houses[i] });
        }
      }
    }
    const stockOps = [];
    for (const k of g.stockIndustries()) {
      const long = player.stocks?.[k] || 0;
      const sh = player.shorts?.[k] || 0;
      stockOps.push({
        ind: k,
        name: INDUSTRIES[k].name,
        price: g.stockPrice(k),
        long,
        short: sh,
        canBuy: g.canBuyStock(player, k, 1),
        canSell: long > 0,
        canOpenShort: (g.maxOpenShort?.(player, k) || 0) > 0,
        canCover: (g.maxCoverShort?.(player, k) || 0) > 0,
      });
    }
    const opponents = g.players.filter((o) => o.id !== player.id && !o.bankrupt).map((o) => ({
      id: o.id, name: o.name, money: o.money, net: g.netWorth(o),
    }));
    const cards = Object.entries(player.items || {}).filter(([, n]) => n > 0).map(([k, n]) => ({ item: k, n }));

    const r = await this._json(
      `你在大富翁商业战争游戏中扮演"${player.name}"，人设：${persona.style}。
回合末可安排最多 6 个经营动作，按数组顺序执行。可选 op：
borrow(amount), repay(amount), build(tileIdx), foundCompany(ind), upgradeCompany, ipo,
buyStock(ind,n), sellStock(ind,n), openShort(ind,n), coverShort(ind,n),
invest(founderId,n,fromFloat), paidDraw,
playCard(item, 可选 targetId/tileIdx/myTile/theirTile/mode/ind),
none。
做空 openShort=先卖空；coverShort=买回平仓。不可同时多空同行业。
只输出JSON：{"actions":[...],"say":"一句12字以内"}`,
      {
        你的情况: this._playerCtx(player),
        可建楼: buildable.slice(0, 12),
        股市: stockOps,
        对手: opponents,
        手牌: cards,
        可创办公司: g.canFoundCompany(player),
        可升级公司: g.canUpgradeCompany(player),
        可IPO: g.canIPO(player),
        信贷余额: Math.max(0, (g.creditLimit?.(player) || 0) - player.debt),
        可付费抽牌: g.canPaidDraw?.(player),
      },
      { actions: localActions, say: '' },
      480,
    );

    let actions = Array.isArray(r.actions) ? r.actions : localActions;
    actions = actions.filter((a) => a && a.op && a.op !== 'none').slice(0, 6);
    if (!actions.length) actions = localActions;
    return { actions, say: String(r.say || '').slice(0, 40) };
  }

  /** 本地启发式回合末计划（类人行为：会负债、不秒还、偶尔冲动） */
  _localTurnEndPlan(player) {
    const g = this.g;
    const rng = g.rng;
    const actions = [];

    // 积极举债：现金不够就借
    if (player.money < ttc(400) && (g.creditLimit?.(player) || 0) - player.debt >= ttc(200)) {
      const amt = rng() < 0.5 ? ttc(200) : ttc(500);
      actions.push({ op: 'borrow', amount: amt });
    }
    // 只在大赚或欠太多时还钱（人类不秒还）
    if (player.debt > 0) {
      if (player.money > ttc(3000) || player.debt > ttc(2000)) {
        actions.push({ op: 'repay', amount: player.debt });
      } else if (player.money > ttc(1500) && rng() < 0.3) {
        actions.push({ op: 'repay', amount: Math.min(player.debt, ttc(500)) });
      }
    }
    // 建楼
    for (const set of g.buildableSets(player.id)) {
      const t = set.tiles.filter((i) => g.canBuild(player, i)).sort((a, b) => g.houses[a] - g.houses[b])[0];
      if (t != null && player.money - TILES[t].houseCost >= ttc(200)) {
        actions.push({ op: 'build', tileIdx: t });
        break;
      }
    }
    // 创办/升级公司（不秒创，留钱）
    if (g.canFoundCompany(player) && player.money > ttc(800) && rng() < 0.6) {
      const keys = Object.keys(INDUSTRIES).filter((k) => k !== 'railroad' && k !== 'utility');
      const fav = this.personaOf(player).favIndustry?.find((k) => keys.includes(k));
      actions.push({ op: 'foundCompany', ind: fav || keys[0] });
    } else if (g.canUpgradeCompany(player) && player.money > ttc(800) && rng() < 0.5) {
      actions.push({ op: 'upgradeCompany' });
    }
    // 买股票（不那么积极）
    if (player.money > ttc(500) && rng() < 0.5) {
      const k = g.stockIndustries().find((ind) => g.canBuyStock(player, ind, 1));
      if (k) actions.push({ op: 'buyStock', ind: k, n: 1 });
    }
    // 缺钱卖股或做空
    if (player.money < ttc(200)) {
      const k = g.stockIndustries().find((ind) => (player.stocks?.[ind] || 0) > 0);
      if (k) actions.push({ op: 'sellStock', ind: k, n: 1 });
      else {
        const sk = g.stockIndustries().find((ind) => (g.maxOpenShort?.(player, ind) || 0) > 0);
        if (sk && rng() < 0.3) actions.push({ op: 'openShort', ind: sk, n: 1 });
      }
    }
    // 空头盈利平仓：现价明显低于“应回补”时
    for (const k of g.stockIndustries()) {
      if ((player.shorts?.[k] || 0) > 0 && (g.maxCoverShort?.(player, k) || 0) > 0 && g.rng() < 0.4) {
        actions.push({ op: 'coverShort', ind: k, n: 1 });
        break;
      }
    }
    // 启发式出牌
    const items = player.items || {};
    const ops = g.players.filter(o => o.id !== player.id && !o.bankrupt);
    if (items.subsidy > 0 && rng() < 0.9) actions.push({ op: 'playCard', item: 'subsidy' });
    if (items.debtCut > 0 && player.debt > ttc(100) && rng() < 0.8) actions.push({ op: 'playCard', item: 'debtCut' });
    if (items.bail > 0 && player.inJail && rng() < 0.95) actions.push({ op: 'playCard', item: 'bail' });
    if (items.hedge > 0 && rng() < 0.6) actions.push({ op: 'playCard', item: 'hedge' });
    if (items.rush > 0 && rng() < 0.7) actions.push({ op: 'playCard', item: 'rush' });
    if (items.doubleGo > 0 && rng() < 0.7) actions.push({ op: 'playCard', item: 'doubleGo' });
    if (items.rob > 0 && ops.length && rng() < 0.5) {
      const richest = ops.sort((a, b) => b.money - a.money)[0];
      if (richest) actions.push({ op: 'playCard', item: 'rob', targetId: richest.id });
    }
    if (items.hibernate > 0 && ops.length && rng() < 0.4) {
      const lead = ops.sort((a, b) => g.netWorth(b) - g.netWorth(a))[0];
      if (lead) actions.push({ op: 'playCard', item: 'hibernate', targetId: lead.id });
    }
    if (items.demolish > 0 && rng() < 0.5) {
      let best = -1, bestRent = 0;
      for (const o of ops) {
        for (const i of g.playerProperties(o.id)) {
          if (g.houses[i] > 0 && g.calcRent(i) > bestRent) { bestRent = g.calcRent(i); best = i; }
        }
      }
      if (best >= 0) actions.push({ op: 'playCard', item: 'demolish', tileIdx: best });
    }
    if (items.freeze > 0 && ops.length && rng() < 0.35) {
      const lead = ops.sort((a, b) => g.netWorth(b) - g.netWorth(a))[0];
      if (lead) actions.push({ op: 'playCard', item: 'freeze', targetId: lead.id });
    }
    if (items.equalizeDebt > 0 && player.debt > ttc(300) && rng() < 0.4) actions.push({ op: 'playCard', item: 'equalizeDebt' });
    if (items.equalize > 0 && player.money < g.alivePlayers().reduce((s, p) => s + p.money, 0) / g.alivePlayers().length && rng() < 0.3) actions.push({ op: 'playCard', item: 'equalize' });
    return actions.slice(0, 5);
  }
}
