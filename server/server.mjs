// 联机对战权威服务器：房间制 + WebSocket（ws@8）
// 规则全部在服务端 GameState/Engine 上执行，客户端只做表现与输入转发。
// 运行：node server/server.mjs （环境变量 PORT 指定端口，默认 8081；DF_FAST=1 加快节奏，供仿真测试用）
import { WebSocketServer } from 'ws';
import { GameState, TILES, INDUSTRIES, formatMoney, ttc, GO_SALARY, MONEY_SCALE } from '../src/core/state.js';
import { Engine } from '../src/core/engine.js';
import { AIBrain, PERSONAS } from '../src/llm/ai.js';

const PORT = Number(process.env.PORT || 8081);
const FAST = !!process.env.DF_FAST;          // 测试模式：动画/思考延时缩短为 1/4
const SPEED = FAST ? 4 : 1;
const ASK_TIMEOUT = 60_000;                  // 人类玩家应答超时（超时用默认值）
const MAX_SEATS = 34;

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const ownable = (t) => !!t && ['property', 'railroad', 'utility'].includes(t.type);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符

// ---------- 序列化 ----------
function serializeState(g) {
  return {
    players: g.players,
    owner: g.owner,
    houses: g.houses,
    mortgaged: [...g.mortgaged],   // Set → 数组
    industry: g.industry,
    marketHeat: g.marketHeat,
    newsMult: g.newsMult,
    kline: g.kline,
    newsBoard: g.newsBoard,
    chanceDeck: g.chanceDeck,
    chestDeck: g.chestDeck,
    turn: g.turn,
  };
}

// ---------- 房间 ----------
class Room {
  constructor(code) {
    this.code = code;
    this.slots = [];               // [{seat,name,isAI}] 大厅座位表
    this.conns = new Map();        // seat → ws
    this.hostSeat = 0;
    this.started = false;
    this.game = null;
    this.engine = null;
    this.brain = null;
    this.pending = new Map();      // reqId → {cat, seat, resolve, timer, def}
    this.aiManaged = new Set();    // 断线托管座位
    this.currentSeat = -1;
    this.reqSeq = 1;
  }

  // ---------- 发送 ----------
  send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  sendSeat(seat, obj) { this.send(this.conns.get(seat), obj); }
  broadcast(obj, exceptSeat = -1) {
    const s = JSON.stringify(obj);
    for (const [seat, ws] of this.conns) if (seat !== exceptSeat && ws.readyState === 1) ws.send(s);
  }
  log(html, cls = '') { this.broadcast({ t: 'log', html, cls }); }
  update() { this.broadcast({ t: 'state', state: serializeState(this.game) }); }
  say(seat, text) { if (text) this.broadcast({ t: 'say', seat, text }); }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby', code: this.code, host: this.hostSeat,
      players: this.slots.map(s => ({ seat: s.seat, name: s.name, isAI: s.isAI })),
    });
  }

  /** 人类座位是否在线（未连接或已托管则走 AI） */
  isHumanOnline(seat) { return this.conns.has(seat) && !this.aiManaged.has(seat); }

  /** 向人类座位发问，挂起等 resp/tradeResp；超时或断线用默认值 */
  ask(kind, seat, ctx, def) {
    return new Promise((resolve) => {
      const reqId = this.reqSeq++;
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve(def);
      }, ASK_TIMEOUT);
      this.pending.set(reqId, { cat: 'prompt', kind, seat, resolve, timer, def });
      this.sendSeat(seat, { t: 'ask', reqId, kind, ...ctx });
      this.broadcast({ t: 'wait', playerId: seat, kind }, seat);
    });
  }

  resolvePrompt(reqId, value) {
    const e = this.pending.get(reqId);
    if (!e || e.cat !== 'prompt') return;
    clearTimeout(e.timer);
    this.pending.delete(reqId);
    e.resolve(value);
  }

  /** 座位掉线时，解挂该座位所有等待中的问答（用默认值） */
  resolveSeatDefaults(seat) {
    for (const [id, e] of this.pending) {
      if (e.seat !== seat) continue;
      clearTimeout(e.timer);
      this.pending.delete(id);
      e.resolve(e.def);
    }
  }

  // ---------- 开局 ----------
  async start() {
    this.started = true;
    // 重排座位：大厅可能有人离开留下空位，开局时压缩为 0..n-1，保证 seat === 玩家 id
    const sorted = [...this.slots].sort((a, b) => a.seat - b.seat);
    const newConns = new Map();
    sorted.forEach((s, i) => {
      const ws = this.conns.get(s.seat);
      if (ws) { ws._seat = i; newConns.set(i, ws); }
      s.seat = i;
    });
    this.slots = sorted;
    this.conns = newConns;

    // 按座位顺序构造玩家；AI 随机分配人格
    const personas = [...PERSONAS].sort(() => Math.random() - 0.5);
    let pi = 0;
    const configs = this.slots.map(s => ({
      name: s.name, isAI: s.isAI,
      persona: s.isAI ? personas[pi++ % personas.length].id : undefined,
    }));
    this.game = new GameState(configs);
    // 纯本地启发式（不接 LLM）
    this.brain = new AIBrain({ enabled: false, chat: async () => null }, this.game);

    const adapter = makeNetAdapter(this);
    this.engine = new Engine(this.game, adapter);
    // 休眠卡：包装 playTurn 实现跳过回合（不改 engine.js）
    const origPlay = this.engine.playTurn.bind(this.engine);
    this.engine.playTurn = async (p) => {
      if ((p.skipTurns || 0) > 0) {
        p.skipTurns--;
        this.log(`💤 ${p.name} 进入休眠，跳过本回合`, 'bad');
        this.update();
        await delay(600 / SPEED);
        return;
      }
      return origPlay(p);
    };

    // 开局：逐客户端下发（yourSeat 各自不同）
    const roster = this.slots.map(s => ({ seat: s.seat, name: s.name, isAI: s.isAI }));
    for (const [seat, ws] of this.conns) {
      this.send(ws, { t: 'begin', state: serializeState(this.game), yourSeat: seat, roster });
    }
    this.log(`🎮 游戏开始！${roster.length} 位玩家入场`, 'turn');

    try {
      await this.engine.run();
    } catch (err) {
      console.error(`[room ${this.code}] engine error:`, err);
      this.log('服务器内部错误，本局终止', 'bad');
    }
    // 结束后给客户端留出展示时间再回收房间
    setTimeout(() => destroyRoom(this.code), 30_000);
  }
}

// ---------- 网络适配器（Engine adapter 的服务端实现） ----------
function makeNetAdapter(room) {
  const g = () => room.game;
  return {
    log: (html, cls) => room.log(html, cls),
    update: () => room.update(),
    pause: (ms) => delay(ms / SPEED),

    onEvent(p, kind) {
      if (!p.isAI) return;
      room.brain.banter(p, kind).then(text => room.say(p.id, text));
    },

    /** 全员视野：道具出牌特效 */
    onItemCast(p, item) {
      if (!p || !item) return;
      room.broadcast({ t: 'itemCast', playerId: p.id, item, name: p.name });
    },

    phase(name, p) {
      if (name === 'turnStart') room.currentSeat = p.id;
      room.broadcast({ t: 'phase', name, playerId: p.id });
    },

    async animateDice(d1, d2) {
      room.broadcast({ t: 'dice', d1, d2 });
      await delay(2600 / SPEED); // 掷骰 + 特写停留约 1s + 拉回
    },

    async promptBankPledge(p, opts) {
      if (room.isHumanOnline(p.id)) {
        return room.ask('bankPledge', p.id, opts, false);
      }
      return p.money < ttc(250);
    },
    async animateMove(p, from, steps) {
      room.broadcast({ t: 'move', player: p.id, from, steps });
      await delay(Math.min(1000, 200 + Math.abs(steps) * 90) / SPEED);
    },
    async animateTeleport(p, from, to) {
      room.broadcast({ t: 'tele', player: p.id, from, to, playerName: p.name });
      // 进监管局：红头文件展示 3s + 铁笼收场
      const toJail = to === 10;
      await delay((toJail ? 4200 : 650) / SPEED);
    },
    async showCard(p, card, deck) {
      room.broadcast({ t: 'card', player: p.id, card, deck });
      // 与客户端 showCard auto 停留对齐（约 4.2s）
      await delay(4200 / SPEED);
    },

    async showHoloNotice(opts) {
      room.broadcast({ t: 'holo', ...opts, auto: true });
      await delay((opts.duration || 3800) / SPEED);
    },

    // ---------- 问答：人类在线→网络问答；AI/托管→启发式 ----------
    waitRoll(p) {
      if (room.isHumanOnline(p.id)) return room.ask('roll', p.id, {}, { type: 'roll' });
      return (async () => { await delay(500 / SPEED); return { type: 'roll' }; })();
    },

    async waitEndTurn(p) {
      if (room.isHumanOnline(p.id)) return room.ask('endTurn', p.id, {}, undefined);
      await delay(300 / SPEED);
      aiEndTurnOps(room, p);
      await delay(400 / SPEED);
    },

    promptBuy(p, tileIdx) {
      if (room.isHumanOnline(p.id)) return room.ask('buy', p.id, { tileIdx }, false);
      return (async () => {
        const r = await room.brain.decideBuy(p, tileIdx);
        if (r.say) room.say(p.id, r.say);
        return r.buy;
      })();
    },

    promptJail(p, opts) {
      if (room.isHumanOnline(p.id)) return room.ask('jail', p.id, opts, 'roll');
      return (async () => {
        await delay(400 / SPEED);
        if (opts.hasCard) return 'card';
        if (opts.canPay && p.money >= ttc(300)) return 'pay';
        return 'roll';
      })();
    },

    promptItemUse(p, item, ctx) {
      if (room.isHumanOnline(p.id)) return room.ask('itemUse', p.id, { item, ctx }, false);
      return Promise.resolve(ctx.rent >= ttc(80));
    },

    async gameOver(winner) {
      room.update();
      room.log(`🏆 ${winner.name} 加冕商业帝国！`, 'turn');
      if (winner.isAI) room.say(winner.id, await room.brain.banter(winner, 'win'));
      room.broadcast({ t: 'over', winnerId: winner.id });
    },
  };
}

// ---------- AI 回合末简单策略（建房/借贷/还贷/公司/拆迁卡） ----------
function aiEndTurnOps(room, p) {
  const g = room.game;
  if (p.bankrupt) return;
  // 银行
  if (p.money < ttc(160) && g.creditLimit(p) - p.debt >= ttc(300)) {
    g.borrow(p, ttc(300));
    room.log(`${p.name} 向银行贷款 ${formatMoney(ttc(300))}`, 'card');
  }
  if (p.debt > 0 && p.money > ttc(800)) {
    const r = g.repay(p, p.debt);
    if (r > 0) room.log(`${p.name} 偿还贷款 ${formatMoney(r)}`);
  }
  // 建楼
  const target = p.money > ttc(1400) ? 5 : p.money > ttc(800) ? 3 : 2;
  for (let k = 0; k < 20; k++) {
    const sets = g.buildableSets(p.id);
    if (!sets.length) break;
    const c = sets.flatMap(s => s.tiles)
      .filter(i => g.houses[i] < target)
      .sort((a, b) => g.houses[a] - g.houses[b] || TILES[a].houseCost - TILES[b].houseCost);
    if (!c.length || !g.canBuild(p, c[0]) || p.money - TILES[c[0]].houseCost < ttc(150)) break;
    g.buyHouse(p, c[0]);
    room.log(`${p.name} 消耗建设卡，在 ${TILES[c[0]].name} 起了一级楼`, 'good');
  }
  // 公司（需公司卡）
  if (g.canFoundCompany(p) && p.money > ttc(900)) {
    const keys = Object.keys(INDUSTRIES).filter(k => k !== 'railroad' && k !== 'utility');
    const fav = room.brain.personaOf(p).favIndustry?.find(k => keys.includes(k));
    const ind = fav || keys[Math.floor(g.rng() * keys.length)];
    if (g.foundCompany(p, ind)) {
      room.log(`${p.name} 消耗公司卡，创办了 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 公司！`, 'good');
    }
  } else if (g.canUpgradeCompany(p) && p.money > ttc(900) && g.rng() < 0.6) {
    if (g.upgradeCompany(p)) {
      room.log(`${p.name} 消耗公司卡，公司升到 Lv${p.company.level}`, 'good');
    }
  }
  // IPO / 入股
  if (g.canIPO(p) && p.money < ttc(900) && g.rng() < 0.5) {
    const r = g.doIPO(p);
    if (r) room.log(`${p.name} 公司 IPO，套现 ${formatMoney(r.raised)}`, 'good');
  }
  if (p.money > ttc(500)) {
    for (const f of g.players) {
      if (f.id === p.id || f.bankrupt || !f.company) continue;
      if (g.canInvestCompany(p, f, 1, true) || g.canInvestCompany(p, f, 1, false)) {
        const r = g.investCompany(p, f, 1, g.canInvestCompany(p, f, 1, true));
        if (r) { room.log(`${p.name} 入股 ${f.name} 公司 1 手（${formatMoney(r.cost)}）`, 'good'); break; }
      }
    }
  }
  // 股市
  let stockOps = 0;
  if (p.money < ttc(200)) {
    const held = g.stockIndustries().filter(k => (p.stocks?.[k] || 0) > 0)
      .sort((a, b) => g.sellStockPrice(b) - g.sellStockPrice(a));
    for (const k of held) {
      if (stockOps >= 2 || p.money >= ttc(280)) break;
      const r = g.sellStock(p, k, 1);
      if (r) {
        room.log(`${p.name} 卖出 ${INDUSTRIES[k].icon}${INDUSTRIES[k].name} 股票 1 手（+${formatMoney(r.gain)}）`, 'card');
        stockOps++;
      }
    }
  }
  if (p.money > ttc(600) && stockOps < 3) {
    const cands = g.stockIndustries()
      .filter(k => g.canBuyStock(p, k, 1))
      .sort((a, b) => ((g.industry[b] ?? 1) - (g.industry[a] ?? 1)));
    for (const k of cands) {
      if (stockOps >= 3 || p.money < ttc(450)) break;
      if (p.money - g.stockPrice(k) < ttc(250)) continue;
      const r = g.buyStock(p, k, 1);
      if (r) {
        room.log(`${p.name} 买入 ${INDUSTRIES[k].icon}${INDUSTRIES[k].name} 股票 1 手（${formatMoney(r.cost)}）`, 'good');
        stockOps++;
      }
    }
  }
  // 拆迁卡
  if ((p.items.demolish || 0) > 0 && g.rng() < 0.5) {
    let best = -1, bestRent = 0;
    for (const other of g.players) {
      if (other.id === p.id || other.bankrupt) continue;
      for (const i of g.playerProperties(other.id)) {
        if (g.houses[i] > 0) {
          const r = g.calcRent(i);
          if (r > bestRent) { bestRent = r; best = i; }
        }
      }
    }
    if (best >= 0 && bestRent > ttc(100)) {
      g.useItem(p, 'demolish');
      g.houses[best]--;
      const owner = g.players[g.owner[best]];
      room.log(`${p.name} 发动 💥拆迁卡，${owner.name} 的 ${TILES[best].name} 被拆了一级！`, 'bad');
    }
  }
  room.update();
}

// ---------- 回合内操作（op） ----------
function handleOp(room, seat, msg) {
  const g = room.game;
  const p = g.players[seat];
  const err = (m) => room.sendSeat(seat, { t: 'error', msg: m });
  if (!g || p.bankrupt) return;
  if (seat !== room.currentSeat) return err('还没轮到你行动');

  const tileOk = (i) => Number.isInteger(i) && i >= 0 && i < TILES.length;
  let done = '';
  switch (msg.op) {
    case 'build': {
      const i = msg.tileIdx;
      if (!tileOk(i) || !g.canBuild(p, i)) {
        return err((p.items?.permit || 0) < 1 ? '需要建设卡才能建楼' : '此处不能建设');
      }
      g.buyHouse(p, i);
      done = `${p.name} 消耗建设卡，在 ${TILES[i].name} 起了一级楼`;
      break;
    }
    case 'sellHouse': {
      const i = msg.tileIdx;
      if (!tileOk(i) || !g.canSellHouse(p, i)) return err('此处没有可卖建筑');
      g.sellHouse(p, i);
      done = `${p.name} 卖出了 ${TILES[i].name} 的一级建筑`;
      break;
    }
    case 'borrow': {
      const amt = Math.max(1, Math.round(Number(msg.amount) || 0));
      if (!g.canBorrow(p, amt)) return err('超出信用额度');
      g.borrow(p, amt);
      done = `${p.name} 向银行贷款 ${formatMoney(amt)}`;
      break;
    }
    case 'repay': {
      const amt = Math.max(1, Math.round(Number(msg.amount) || 0));
      const r = g.repay(p, amt);
      if (r <= 0) return err('没有可还金额');
      done = `${p.name} 偿还贷款 ${formatMoney(r)}`;
      break;
    }
    case 'mortgage': {
      const i = msg.tileIdx;
      if (!tileOk(i) || !g.canMortgage(p, i)) return err('该地产不能抵押');
      g.mortgage(p, i);
      done = `${p.name} 抵押了 ${TILES[i].name}（+${formatMoney(g.mortgageValue(i))}）`;
      break;
    }
    case 'unmortgage': {
      const i = msg.tileIdx;
      if (!tileOk(i) || !g.canUnmortgage(p, i)) return err('该地产不能赎回');
      g.unmortgage(p, i);
      done = `${p.name} 赎回了 ${TILES[i].name}`;
      break;
    }
    case 'foundCompany': {
      const ind = msg.industry;
      if (!INDUSTRIES[ind] || ind === 'railroad' || ind === 'utility') return err('无效行业');
      if (!g.canFoundCompany(p)) {
        return err((p.items?.charter || 0) < 1 ? '需要公司卡才能创办' : '现在不能创办公司');
      }
      g.foundCompany(p, ind);
      done = `${p.name} 消耗公司卡，创办了 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 公司！`;
      break;
    }
    case 'upgradeCompany': {
      if (!g.canUpgradeCompany(p)) {
        return err((p.items?.charter || 0) < 1 ? '需要公司卡才能升级' : '公司不能升级');
      }
      g.upgradeCompany(p);
      done = `${p.name} 消耗公司卡，公司升到 Lv${p.company.level}`;
      break;
    }
    case 'buyStock': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if (!g.canBuyStock(p, ind, n)) {
        return err('无法买入股票（需持有该行业地产、现金足够、未超个人/全场持股上限）');
      }
      const r = g.buyStock(p, ind, n);
      done = `${p.name} 买入 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 股票 ${n} 手（${formatMoney(r.cost)}），过路费 ×${r.boost.toFixed(2)}`;
      break;
    }
    case 'sellStock': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if (!g.canSellStock(p, ind, n)) return err('无法卖出股票');
      const r = g.sellStock(p, ind, n);
      done = `${p.name} 卖出 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 股票 ${n} 手（+${formatMoney(r.gain)}），过路费 ×${r.boost.toFixed(2)}`;
      break;
    }
    case 'openShort': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if (!g.openShort || !g.canOpenShort?.(p, ind, n)) {
        return err('无法做空（需持地、无多头、未超空仓上限）');
      }
      const r = g.openShort(p, ind, n);
      if (!r) return err('无法做空');
      done = `${p.name} 做空 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} ${n} 手（+${formatMoney(r.gain)}，待平）`;
      break;
    }
    case 'coverShort': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if (!g.coverShort || !g.canCoverShort?.(p, ind, n)) return err('无法平空');
      const r = g.coverShort(p, ind, n);
      if (!r) return err('无法平空');
      done = `${p.name} 平空 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} ${n} 手（-${formatMoney(r.cost)}）`;
      break;
    }
    case 'ipo': {
      if (!g.canIPO(p)) return err('暂不可 IPO');
      const r = g.doIPO(p);
      done = `${p.name} 公司 IPO！抛出 ${r.n} 股，套现 ${formatMoney(r.raised)}`;
      break;
    }
    case 'invest': {
      const founder = g.players[msg.founderId];
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      const fromFloat = !!msg.fromFloat;
      if (!founder || !g.canInvestCompany(p, founder, n, fromFloat)) return err('无法入股');
      const r = g.investCompany(p, founder, n, fromFloat);
      done = `${p.name} 入股 ${founder.name} 公司 ${n} 股（${formatMoney(r.cost)}）`;
      break;
    }
    case 'drawPack': {
      const mode = msg.mode === 'free' ? 'free' : 'paid';
      const r = g.takeDraw(p, mode);
      if (!r) return err(mode === 'paid' ? '无法付费抽牌（现金/次数）' : '没有免费抽牌次数');
      done = mode === 'paid'
        ? `${p.name} 付费补给（${formatMoney(r.cost)}）：${g.formatDrawLoot(r.got)}`
        : `${p.name} 免费补给：${g.formatDrawLoot(r.got)}`;
      break;
    }
    case 'pledge': {
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 5)));
      if (!g.canPledgeShares(p, n)) return err('无法质押公司股');
      const r = g.pledgeSharesForLoan(p, n);
      done = `${p.name} 质押公司股 ${r.n} 手，获贷 ${formatMoney(r.loan)}`;
      break;
    }
    case 'intel': {
      const ind = msg.industry;
      const mode = msg.mode === 'down' ? 'down' : 'up';
      if ((p.items.intel || 0) <= 0) return err('没有资讯卡');
      if (!g.useItem(p, 'intel')) return err('没有资讯卡');
      const r = g.applyNews(ind, mode);
      if (!r) return err('无效行业');
      done = `📰 ${p.name} 发布${mode === 'up' ? '利好' : '利空'}：${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} ${r.from.toFixed(2)}→${r.to.toFixed(2)}`;
      break;
    }
    case 'demolish': // 兼容简写：直接给 tileIdx
      return handleOp(room, seat, { op: 'playCard', item: 'demolish', tileIdx: msg.tileIdx });
    case 'playCard': {
      done = playCard(room, p, msg, err);
      if (!done) return;
      break;
    }
    default:
      return err('未知操作');
  }
  room.log(done, msg.op === 'playCard' ? 'card' : 'good');
  // 全员视野：道具出牌特效
  if (msg.op === 'playCard' && msg.item) {
    room.broadcast({ t: 'itemCast', playerId: p.id, item: msg.item, name: p.name });
  }
  if (msg.op === 'intel') {
    room.broadcast({ t: 'itemCast', playerId: p.id, item: 'intel', name: p.name });
  }
  room.update();
}

/** 主动道具卡：demolish/equalize/rob/swap/hibernate，返回日志文本（空=失败已 err） */
function playCard(room, p, msg, err) {
  const g = room.game;
  const item = msg.item;
  if ((p.items[item] || 0) <= 0) { err('没有该道具卡'); return ''; }
  const aliveTarget = (id) => {
    const t = g.players[id];
    return t && t.id !== p.id && !t.bankrupt ? t : null;
  };
  const tradable = (i, pid) => ownable(TILES[i]) && g.owner[i] === pid && g.houses[i] === 0 && !g.isMortgaged(i);

  switch (item) {
    case 'demolish': {
      const i = msg.tileIdx;
      const o = g.owner[i];
      if (!(o >= 0 && o !== p.id && !g.players[o].bankrupt && g.houses[i] > 0)) { err('无效拆迁目标'); return ''; }
      g.useItem(p, 'demolish');
      g.houses[i]--;
      return `💥 ${p.name} 发动拆迁卡，${g.players[o].name} 的 ${TILES[i].name} 被拆了一级！`;
    }
    case 'equalize': {
      g.useItem(p, 'equalize');
      const alive = g.alivePlayers();
      const avg = Math.floor(alive.reduce((s, x) => s + x.money, 0) / alive.length);
      for (const x of alive) x.money = avg;
      return `⚖️ ${p.name} 发动均富卡，所有存活玩家现金平均为 ${formatMoney(avg)}！`;
    }
    case 'rob': {
      const t = aliveTarget(msg.targetId);
      if (!t) { err('无效窃取目标'); return ''; }
      const steal = Math.min(Math.floor(t.money * 0.2), ttc(300));
      if (steal <= 0) { err('目标没有可偷现金'); return ''; }
      g.useItem(p, 'rob');
      t.money -= steal;
      p.money += steal;
      return `🥷 ${p.name} 发动窃取卡，从 ${t.name} 处偷走 ${formatMoney(steal)}！`;
    }
    case 'swap': {
      const a = msg.myTile, b = msg.targetTile;
      const tb = g.players[g.owner[b]];
      if (!(tradable(a, p.id) && tb && tb.id !== p.id && !tb.bankrupt && tradable(b, tb.id))) { err('置换目标不合法'); return ''; }
      g.useItem(p, 'swap');
      g.owner[a] = tb.id;
      g.owner[b] = p.id;
      return `🔁 ${p.name} 发动置换卡，用 ${TILES[a].name} 换走 ${tb.name} 的 ${TILES[b].name}！`;
    }
    case 'hibernate': {
      const t = aliveTarget(msg.targetId);
      if (!t) { err('无效休眠目标'); return ''; }
      g.useItem(p, 'hibernate');
      t.skipTurns = (t.skipTurns || 0) + 1;
      return `💤 ${p.name} 发动休眠卡，${t.name} 将跳过一个回合！`;
    }
    case 'bail': {
      if (!p.inJail) { err('不在监管局'); return ''; }
      g.useItem(p, 'bail');
      g.playBail(p);
      return `🔓 ${p.name} 使用保释令，即刻脱身！`;
    }
    case 'subsidy': {
      g.useItem(p, 'subsidy');
      g.playSubsidy(p);
      return `🎁 ${p.name} 领取财政补贴 +${formatMoney(ttc(200))}`;
    }
    case 'debtCut': {
      g.useItem(p, 'debtCut');
      const cut = g.playDebtCut(p);
      return cut > 0 ? `✂️ ${p.name} 债务豁免 ${formatMoney(cut)}` : `✂️ ${p.name} 无债可免`;
    }
    case 'audit': {
      const t = aliveTarget(msg.targetId);
      if (!t) { err('无效审计目标'); return ''; }
      g.useItem(p, 'audit');
      g.playAudit(p, t);
      return `🧾 ${p.name} 审计 ${t.name}，${t.name} 补缴 ${formatMoney(ttc(150))} 税款`;
    }
    case 'poach': {
      const t = aliveTarget(msg.targetId);
      if (!t) { err('无效挖角目标'); return ''; }
      const hasItems = Object.values(t.items || {}).some(v => v > 0);
      if (!hasItems) { err('目标没有道具卡'); return ''; }
      g.useItem(p, 'poach');
      const stolen = g.playPoach(p, t);
      return stolen ? `🧲 ${p.name} 挖角 ${t.name}，偷到道具` : '🧲 挖角失败';
    }
    case 'hedge': {
      g.useItem(p, 'hedge');
      g.playHedge(p);
      return `☂️ ${p.name} 投保对冲保单：下次租金减半`;
    }
    case 'rush': {
      g.useItem(p, 'rush');
      g.playRush(p);
      return `⚡ ${p.name} 激活抢工卡`;
    }
    case 'warp': {
      const tile = Number(msg.tileIdx);
      if (!(tile >= 0 && g.owner[tile] === p.id)) { err('无效跃迁目标'); return ''; }
      g.useItem(p, 'warp');
      g.playWarp(p, tile);
      return `🌀 ${p.name} 跃迁到 ${TILES[tile].name}`;
    }
    case 'doubleGo': {
      g.useItem(p, 'doubleGo');
      g.playDoubleGo(p);
      return `🏦 ${p.name} 激活双倍融资`;
    }
    case 'freeze': {
      const t = aliveTarget(msg.targetId);
      if (!t) { err('无效停工目标'); return ''; }
      g.useItem(p, 'freeze');
      g.playFreeze(p, t);
      return `🛑 ${p.name} 对 ${t.name} 发出停工令`;
    }
    case 'equalizeDebt': {
      g.useItem(p, 'equalizeDebt');
      const avg = g.playEqualizeDebt();
      return `💸 ${p.name} 打出均负卡，全员债务均化为 ${formatMoney(avg)}`;
    }
    default:
      err('该卡牌不能主动使用');
      return '';
  }
}

// ---------- 交易议价 ----------
async function runTrade(room, offer) {
  const g = room.game;
  const { buyerId, sellerId, tileIdx, price, initiator } = offer;
  const buyer = g.players[buyerId], seller = g.players[sellerId];
  const tileName = TILES[tileIdx].name;
  const buyerAI = !room.isHumanOnline(buyerId);
  const sellerAI = !room.isHumanOnline(sellerId);

  const execute = (finalPrice) => {
    if (!g.canTrade(buyer, seller, tileIdx, finalPrice)) {
      room.sendSeat(initiator, { t: 'tradeResult', reqId: 0, decision: 'reject', name: '系统', say: '交易条件已变化，无法成交', tileIdx, price: finalPrice });
      return;
    }
    g.executeTrade(buyer, seller, tileIdx, finalPrice);
    room.log(`🤝 成交！${buyer.name} 以 <span class="gold">${formatMoney(finalPrice)}</span> 购得 ${seller.name} 的 <b>${tileName}</b>`, 'good');
    room.update();
  };
  const result = (seat, r, reqId = 0) => room.sendSeat(seat, {
    t: 'tradeResult', reqId, decision: r.decision, counterPrice: r.counterPrice || 0,
    say: r.say || '', name: sellerAI || r._bySeller ? seller.name : buyer.name, tileIdx, price,
  });

  if (sellerAI || buyerAI) {
    // 一方为 AI：由 AIBrain 评估
    const bySeller = sellerAI;
    const ai = bySeller ? seller : buyer;
    const r = bySeller
      ? await room.brain.evaluateTrade(buyer, seller, tileIdx, price)
      : await room.brain.evaluatePurchase(buyer, seller, tileIdx, price);
    if (r.say) room.say(ai.id, r.say);
    if (r.decision === 'accept') {
      execute(price);
      result(initiator, { decision: 'accept', say: r.say, _bySeller: bySeller });
    } else if (r.decision === 'reject') {
      room.log(`${ai.name} 拒绝了 ${bySeller ? buyer.name : seller.name} 的报价`);
      result(initiator, { decision: 'reject', say: r.say, _bySeller: bySeller });
    } else {
      // 还价：转达发起方，等 tradeResp
      const reqId = room.reqSeq++;
      const timer = setTimeout(() => {
        room.pending.delete(reqId);
        room.log(`${bySeller ? buyer.name : seller.name} 未回应还价，交易取消`);
      }, ASK_TIMEOUT);
      room.pending.set(reqId, {
        cat: 'trade', seat: initiator, timer, def: false,
        resolve: (accept) => {
          if (accept && g.canTrade(buyer, seller, tileIdx, r.counterPrice)) execute(r.counterPrice);
          else room.log(`${bySeller ? buyer.name : seller.name} 放弃了还价 ${formatMoney(r.counterPrice)}`);
        },
      });
      result(initiator, { decision: 'counter', counterPrice: r.counterPrice, say: r.say, _bySeller: bySeller }, reqId);
    }
    return;
  }

  // 人类 ↔ 人类：问卖方
  const reqId = room.reqSeq++;
  const timer = setTimeout(() => {
    room.pending.delete(reqId);
    room.log(`${seller.name} 未回应 ${buyer.name} 的报价`);
    room.sendSeat(initiator, { t: 'tradeResult', reqId: 0, decision: 'reject', name: seller.name, say: '对方未回应', tileIdx, price });
  }, ASK_TIMEOUT);
  room.pending.set(reqId, {
    cat: 'trade', seat: sellerId, timer, def: false,
    resolve: (accept) => {
      if (accept) {
        execute(price);
        room.sendSeat(initiator, { t: 'tradeResult', reqId: 0, decision: 'accept', name: seller.name, say: '', tileIdx, price });
      } else {
        room.log(`${seller.name} 拒绝了 ${buyer.name} 的报价`);
        room.sendSeat(initiator, { t: 'tradeResult', reqId: 0, decision: 'reject', name: seller.name, say: '', tileIdx, price });
      }
    },
  });
  room.sendSeat(sellerId, { t: 'ask', reqId, kind: 'trade', fromId: buyerId, fromName: buyer.name, tileIdx, price });
  room.broadcast({ t: 'wait', playerId: sellerId, kind: 'trade' }, sellerId);
}

// ---------- 房间管理 ----------
const rooms = new Map();

function makeCode() {
  for (let tries = 0; tries < 50; tries++) {
    const c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    if (!rooms.has(c)) return c;
  }
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function destroyRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const e of room.pending.values()) clearTimeout(e.timer);
  for (const ws of room.conns.values()) { try { ws.close(); } catch { /* 忽略 */ } }
  rooms.delete(code);
  console.log(`[room ${code}] destroyed`);
}

function freeSeat(room) {
  for (let i = 0; i < MAX_SEATS; i++) if (!room.slots.some(s => s.seat === i)) return i;
  return -1;
}

// ---------- 连接处理 ----------
const wss = new WebSocketServer({ port: PORT });
console.log(`[server] ws listening on :${PORT}${FAST ? ' (FAST)' : ''}`);

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { onMessage(ws, msg); } catch (err) { console.error('onMessage error:', err); }
  });
  ws.on('close', () => onClose(ws));
  ws.on('error', () => { /* close 事件会随后到来 */ });
});

function onMessage(ws, msg) {
  switch (msg.t) {
    // ---------- 建房 / 加入 ----------
    case 'create': {
      if (ws._room) return;
      const code = makeCode();
      const room = new Room(code);
      const name = String(msg.name || '玩家').slice(0, 12);
      room.slots.push({ seat: 0, name, isAI: false });
      room.conns.set(0, ws);
      ws._room = room;
      ws._seat = 0;
      rooms.set(code, room);
      room.send(ws, { t: 'room', code, seat: 0, host: true });
      room.broadcastLobby();
      console.log(`[room ${code}] created by ${name}`);
      break;
    }
    case 'join': {
      if (ws._room) return;
      const code = String(msg.code || '').toUpperCase();
      const room = rooms.get(code);
      const err = (m) => room ? room.send(ws, { t: 'error', msg: m }) : ws.send(JSON.stringify({ t: 'error', msg: m }));
      if (!room) return err('房间不存在，请核对房号');
      const name = String(msg.name || '玩家').slice(0, 12);
      // 对局中：同名人类座位可重连（解除 AI 托管）
      if (room.started) {
        const slot = room.slots.find(s => !s.isAI && s.name === name);
        if (!slot) return err('游戏已开始；请使用原昵称重连');
        const seat = slot.seat;
        const old = room.conns.get(seat);
        if (old && old !== ws) try { old.close(); } catch { /* */ }
        room.conns.set(seat, ws);
        room.aiManaged.delete(seat);
        ws._room = room;
        ws._seat = seat;
        const roster = room.slots.map(s => ({ seat: s.seat, name: s.name, isAI: s.isAI }));
        room.send(ws, {
          t: 'begin', state: serializeState(room.game), yourSeat: seat, roster, rejoin: true,
        });
        room.log(`🔄 ${name} 重新连接`, 'turn');
        room.update();
        break;
      }
      if (room.slots.length >= MAX_SEATS) return err('房间已满');
      const seat = freeSeat(room);
      room.slots.push({ seat, name, isAI: false });
      room.conns.set(seat, ws);
      ws._room = room;
      ws._seat = seat;
      room.send(ws, { t: 'room', code, seat, host: false });
      room.broadcastLobby();
      break;
    }

    // ---------- 大厅 ----------
    case 'addAI': {
      const room = ws._room;
      if (!room || room.started || ws._seat !== room.hostSeat) return;
      if (room.slots.length >= MAX_SEATS) return room.send(ws, { t: 'error', msg: '最多 34 人' });
      const seat = freeSeat(room);
      const used = new Set(room.slots.map(s => s.name));
      const persona = PERSONAS.find(p => !used.has(p.name)) || PERSONAS[seat % PERSONAS.length];
      room.slots.push({ seat, name: persona.name, isAI: true });
      room.broadcastLobby();
      break;
    }
    case 'removeAI': {
      const room = ws._room;
      if (!room || room.started || ws._seat !== room.hostSeat) return;
      const idx = [...room.slots].reverse().findIndex(s => s.isAI);
      if (idx < 0) return;
      room.slots.splice(room.slots.length - 1 - idx, 1);
      room.broadcastLobby();
      break;
    }
    case 'start': {
      const room = ws._room;
      if (!room || room.started || ws._seat !== room.hostSeat) return;
      if (room.slots.length < 2) return room.send(ws, { t: 'error', msg: '至少 2 名玩家才能开始' });
      room.start();
      break;
    }

    // ---------- 局内 ----------
    case 'resp': {
      ws._room?.resolvePrompt(msg.reqId, msg.value);
      break;
    }
    case 'op': {
      const room = ws._room;
      if (room?.started) handleOp(room, ws._seat, msg);
      break;
    }
    case 'trade': {
      const room = ws._room;
      if (!room?.started) return;
      const seat = ws._seat;
      const err = (m) => room.send(ws, { t: 'error', msg: m });
      const { buyerId, sellerId } = msg;
      const tileIdx = msg.tileIdx | 0;
      if (seat !== buyerId && seat !== sellerId) return err('只能发起自己参与的交易');
      if (seat !== room.currentSeat) return err('只能在自己回合发起交易');
      const g = room.game;
      const buyer = g.players[buyerId], seller = g.players[sellerId];
      if (!buyer || !seller || buyerId === sellerId) return err('交易对象无效');
      if (!TILES[tileIdx]) return err('无效资产');
      const p = Math.max(1, Math.round(Number(price) || 0));
      if (!g.canTrade(buyer, seller, tileIdx, p)) return err('交易不成立：现金不足或资产不可交易');
      runTrade(room, { buyerId, sellerId, tileIdx, price: p, initiator: seat });
      break;
    }
    case 'tradeResp': {
      const room = ws._room;
      const e = room?.pending.get(msg.reqId);
      if (!e || e.cat !== 'trade') return;
      clearTimeout(e.timer);
      room.pending.delete(msg.reqId);
      e.resolve(!!msg.accept);
      break;
    }
    case 'chat': {
      const room = ws._room;
      if (!room) return;
      const name = room.slots.find(s => s.seat === ws._seat)?.name || `玩家${ws._seat + 1}`;
      room.broadcast({ t: 'chat', seat: ws._seat, name, text: String(msg.text || '').slice(0, 200) });
      break;
    }
  }
}

function onClose(ws) {
  const room = ws._room;
  if (!room) return;
  const seat = ws._seat;
  room.conns.delete(seat);
  if (room.conns.size === 0) return destroyRoom(room.code);

  if (!room.started) {
    // 大厅中离开：移除座位，必要时移交房主
    room.slots = room.slots.filter(s => s.seat !== seat);
    if (room.hostSeat === seat) room.hostSeat = Math.min(...room.conns.keys());
    room.broadcastLobby();
  } else {
    // 游戏中掉线：AI 托管
    room.aiManaged.add(seat);
    const p = room.game.players[seat];
    if (p) p.isAI = true;
    room.resolveSeatDefaults(seat);
    room.log(`🔌 ${p?.name ?? `玩家${seat + 1}`} 掉线，由 AI 托管`, 'bad');
    room.update();
  }
}
