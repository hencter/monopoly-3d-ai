// 联机对战权威服务器：同步回合制 + WebSocket（ws@8）
// 规则全部在服务端 GameState 上执行，客户端只做表现与输入转发。
// 同一回合内所有存活玩家并发操作，体力耗尽或主动声明后进入下一回合。
// 运行：node server/server.mjs （环境变量 PORT 指定端口，默认 8081；DF_FAST=1 加快节奏，供仿真测试用）
import { WebSocketServer } from 'ws';
import {
  GameState, TILES, INDUSTRIES, ITEMS, formatMoney, ttc, GO_SALARY,
  STAMINA_DICE, STAMINA_BUY_LAND, STAMINA_BUILD,
  PARKING_DRAW_N, BUY_LAND_DRAW_CHANCE,
  LOTTERY_COST, LOTTERY_JACKPOT, LOTTERY_WIN_CHANCE,
  HOSPITAL_FEE, JAIL_INDEX, JAIL_FINE,
} from '../src/core/state.js';
import { Engine } from '../src/core/engine.js';
import { AIBrain, PERSONAS } from '../src/llm/ai.js';

const PORT = Number(process.env.PORT || 8081);
const FAST = !!process.env.DF_FAST;
const SPEED = FAST ? 4 : 1;
const ASK_TIMEOUT = 60_000;
const MAX_SEATS = 34;

const STAMINA_CARD = 5;
const STAMINA_BANK = 5;
const STAMINA_STOCK = 5;
const STAMINA_COMPANY = 5;
const STAMINA_BLACKMARKET = 5;
const STAMINA_DRAW = 5;
const STAMINA_INVEST = 5;
const STAMINA_MORTGAGE = 5;
const STAMINA_SELLHOUSE = 5;

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const ownable = (t) => !!t && ['property', 'railroad', 'utility'].includes(t.type);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---------- 序列化 ----------
function serializeState(g, round = 0) {
  return {
    players: g.players,
    owner: g.owner,
    houses: g.houses,
    mortgaged: [...g.mortgaged],
    industry: g.industry,
    marketHeat: g.marketHeat,
    newsMult: g.newsMult,
    kline: g.kline,
    newsBoard: g.newsBoard,
    chanceDeck: g.chanceDeck,
    chestDeck: g.chestDeck,
    turn: g.turn,
    round,
  };
}

// ---------- 房间 ----------
class Room {
  constructor(code) {
    this.code = code;
    this.slots = [];
    this.conns = new Map();
    this.hostSeat = 0;
    this.started = false;
    this.game = null;
    this.engine = null;
    this.brain = null;
    this.pending = new Map();
    this.aiManaged = new Set();
    this.reqSeq = 1;
    this.round = 0;
    this.roundEnded = new Set();
    this._opQueue = new Map();
    this._roundResolver = null;
  }

  // ---------- 发送 ----------
  send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  sendSeat(seat, obj) { this.send(this.conns.get(seat), obj); }
  broadcast(obj, exceptSeat = -1) {
    const s = JSON.stringify(obj);
    for (const [seat, ws] of this.conns) if (seat !== exceptSeat && ws.readyState === 1) ws.send(s);
  }
  log(html, cls = '') { this.broadcast({ t: 'log', html, cls }); }
  update() { this.broadcast({ t: 'state', state: serializeState(this.game, this.round) }); }
  say(seat, text) { if (text) this.broadcast({ t: 'say', seat, text }); }

  _enqueueOp(seat, fn) {
    const prev = this._opQueue.get(seat) || Promise.resolve();
    const next = prev.then(fn).catch(err => console.error(`[op queue seat ${seat}]`, err));
    this._opQueue.set(seat, next);
    return next;
  }

  _checkRoundEnd() {
    if (!this._roundResolver) return;
    const g = this.game;
    const alive = g.alivePlayers();
    const allEnded = alive.every(p => this.roundEnded.has(p.id));
    const allExhausted = alive.every(p => (p.stamina || 0) <= 0 || this.roundEnded.has(p.id));
    if (allEnded || allExhausted) {
      const resolve = this._roundResolver;
      this._roundResolver = null;
      resolve();
    }
  }

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
    const sorted = [...this.slots].sort((a, b) => a.seat - b.seat);
    const newConns = new Map();
    sorted.forEach((s, i) => {
      const ws = this.conns.get(s.seat);
      if (ws) { ws._seat = i; newConns.set(i, ws); }
      s.seat = i;
    });
    this.slots = sorted;
    this.conns = newConns;

    const personas = [...PERSONAS].sort(() => Math.random() - 0.5);
    let pi = 0;
    const configs = this.slots.map(s => ({
      name: s.name, isAI: s.isAI,
      persona: s.isAI ? personas[pi++ % personas.length].id : undefined,
    }));
    this.game = new GameState(configs);
    this.brain = new AIBrain({ enabled: false, chat: async () => null }, this.game);

    const adapter = makeNetAdapter(this);
    this.engine = new Engine(this.game, adapter);

    const roster = this.slots.map(s => ({ seat: s.seat, name: s.name, isAI: s.isAI }));
    for (const [seat, ws] of this.conns) {
      this.send(ws, { t: 'begin', state: serializeState(this.game, this.round), yourSeat: seat, roster });
    }
    this.log(`🎮 游戏开始！${roster.length} 位玩家入场 · 同步回合制`, 'turn');

    try {
      await this.runRoundLoop();
    } catch (err) {
      console.error(`[room ${this.code}] engine error:`, err);
      this.log('服务器内部错误，本局终止', 'bad');
    }
    setTimeout(() => destroyRoom(this.code), 30_000);
  }

  // ---------- 同步回合循环 ----------
  async runRoundLoop() {
    const g = this.game;
    const engine = this.engine;
    const brain = this.brain;
    const adapter = makeNetAdapter(this);

    while (!g.winner()) {
      this.roundEnded = new Set();
      const alive = g.alivePlayers();

      this.broadcast({
        t: 'roundStart',
        round: this.round,
        players: alive.map(p => ({
          id: p.id, name: p.name, stamina: p.stamina,
          money: p.money, bankrupt: p.bankrupt,
        })),
        state: serializeState(g, this.round),
      });
      this.log(`—— 第 ${this.round + 1} 回合开始，${alive.length} 位玩家同步行动 ——`, 'turn');

      const tasks = [];
      for (const p of alive) {
        if (this.roundEnded.has(p.id)) continue;
        tasks.push(this._runPlayerRound(p, engine, brain, adapter));
      }

      await new Promise(resolve => {
        this._roundResolver = resolve;
        this._checkRoundEnd();
      });

      if (!g.winner()) {
        await this.advanceRound(g);
      }
    }

    let w = g.winner();
    if (!w) w = g.alivePlayers().sort((x, y) => g.netWorth(y) - g.netWorth(x))[0];
    this.broadcast({ t: 'over', winnerId: w.id });
  }

  async _runPlayerRound(p, engine, brain, adapter) {
    if (p.bankrupt) {
      this.roundEnded.add(p.id);
      this._checkRoundEnd();
      return;
    }
    try {
      if ((p.skipTurns || 0) > 0) {
        p.skipTurns--;
        this.log(`💤 ${p.name} 进入休眠，跳过本回合`, 'bad');
        this.update();
        this.roundEnded.add(p.id);
        this._checkRoundEnd();
        return;
      }

      if (p.isAI || this.aiManaged.has(p.id)) {
        await this._runAIPlayerRound(p, engine, brain, adapter);
        this.roundEnded.add(p.id);
        this._checkRoundEnd();
      }
    } catch (err) {
      console.error(`[player round ${p.id}]`, err);
      this.roundEnded.add(p.id);
      this._checkRoundEnd();
    }
  }

  async _runAIPlayerRound(p, engine, brain, adapter) {
    await delay(300 / SPEED);
    if ((p.stamina || 0) >= STAMINA_DICE) {
      await this._executePlayerRoll(p, engine, brain);
    }
    await delay(200 / SPEED);
    if (!p.bankrupt) {
      aiEndTurnOps(this, p);
      await this._autoFreeDraw(p);
    }
  }

  async _executePlayerRoll(p, engine, brain) {
    const g = this.game;
    if ((p.stamina || 0) < STAMINA_DICE) return;

    if (p.inJail) {
      const escaped = await this._handleJailEscape(p);
      if (!escaped) return;
    }

    p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_DICE);

    const d1 = g.rollDie();
    const d2 = g.rollDie();
    const doubles = d1 === d2;
    let total = d1 + d2;

    this.broadcast({ t: 'dice', d1, d2, playerId: p.id });
    this.log(`${p.name} 掷出 <b>${d1}</b> + <b>${d2}</b>${doubles ? ' <span class="gold">双数！</span>' : ''}`);
    await delay(2600 / SPEED);

    if (doubles && this._doublesCount && this._doublesCount.get(p.id) >= 2) {
      this.log(`${p.name} 连续三次双数，操纵市场被约谈！`, 'bad');
      const from = p.position;
      g.sendToJail(p);
      this.broadcast({ t: 'tele', player: p.id, from, to: JAIL_INDEX, playerName: p.name });
      await delay(4200 / SPEED);
      this._doublesCount.delete(p.id);
      return;
    }
    if (doubles) {
      this._doublesCount = this._doublesCount || new Map();
      this._doublesCount.set(p.id, (this._doublesCount.get(p.id) || 0) + 1);
    } else {
      this._doublesCount?.delete(p.id);
    }

    const { from, passedGo } = g.moveSteps(p, total);
    this.broadcast({ t: 'move', player: p.id, from, steps: total });
    await delay(Math.min(1000, 200 + Math.abs(total) * 90) / SPEED);

    if (passedGo) {
      this.log(`${p.name} 经过起点，融资到账 <span class="gold">${formatMoney(GO_SALARY)}</span>`, 'good');
      const loot = g.drawItemPack(p, 1);
      if (loot.length) this.log(`🎁 起点补给：${g.formatDrawLoot(loot)}`, 'card');
    }

    await this._resolveLanding(p, total, brain);
    this.update();

    if (!p.bankrupt && doubles && !p.inJail && (p.stamina || 0) >= STAMINA_DICE) {
      this.log(`${p.name} 获得额外一次掷骰机会`, 'good');
      await delay(400 / SPEED);
      await this._executePlayerRoll(p, engine, brain);
    }
  }

  async _handleJailEscape(p) {
    const g = this.game;
    if (p.jailCards > 0) {
      p.jailCards--;
      p.inJail = false;
      p.jailTurns = 0;
      this.log(`${p.name} 出示免于约谈卡，从容离场！`, 'good');
      return true;
    }
    if (p.money >= JAIL_FINE) {
      p.money -= JAIL_FINE;
      p.inJail = false;
      p.jailTurns = 0;
      this.log(`${p.name} 缴纳保证金离开监管局`, 'good');
      return true;
    }
    const d1 = g.rollDie();
    const d2 = g.rollDie();
    this.broadcast({ t: 'dice', d1, d2, playerId: p.id });
    await delay(2600 / SPEED);
    this.log(`${p.name} 在监管局掷出 ${d1} + ${d2}`);
    if (d1 === d2) {
      p.inJail = false;
      p.jailTurns = 0;
      this.log(`${p.name} 掷出双数，恢复自由！`, 'good');
      const { from } = g.moveSteps(p, d1 + d2);
      this.broadcast({ t: 'move', player: p.id, from, steps: d1 + d2 });
      await delay(800 / SPEED);
      return true;
    }
    p.jailTurns++;
    if (p.jailTurns >= 3) {
      p.inJail = false;
      p.jailTurns = 0;
      this.log(`${p.name} 三次未脱身，强制缴纳保证金`, 'bad');
      g.forcePay(p, JAIL_FINE, null);
      return true;
    }
    this.log(`${p.name} 未能掷出双数（第 ${p.jailTurns}/3 次）`, 'bad');
    return false;
  }

  async _resolveLanding(p, diceSum, brain) {
    if (p.bankrupt) return;
    const g = this.game;
    const i = p.position;
    const t = TILES[i];
    this.log(`${p.name} 抵达 <b>${t.name}</b>`);
    switch (t.type) {
      case 'go': break;
      case 'parking': {
        this.log('在度假区充电灵感，打开补给包！');
        const loot = g.drawItemPack(p, PARKING_DRAW_N);
        if (loot.length) this.log(`🎁 度假补给：${g.formatDrawLoot(loot)}`, 'card');
        await delay(400 / SPEED);
        break;
      }
      case 'jail':
        this.log('只是路过监管局门口。');
        await delay(400 / SPEED);
        break;
      case 'lottery': {
        this.log(`${p.name} 在彩票站点刮了一张彩票（${formatMoney(LOTTERY_COST)}）`);
        const r = g.forcePay(p, LOTTERY_COST, null);
        if (r.bankrupt) { this.log(`${p.name} 连彩票钱都付不起，破产！`, 'bad'); break; }
        if (g.rng() < LOTTERY_WIN_CHANCE) {
          p.money += LOTTERY_JACKPOT;
          this.log(`🎉 ${p.name} 中大奖！+${formatMoney(LOTTERY_JACKPOT)}`, 'good');
        } else {
          this.log('😞 谢谢参与。');
        }
        break;
      }
      case 'hospital': {
        const worth = g.netWorth(p);
        const fee = Math.max(HOSPITAL_FEE, HOSPITAL_FEE + Math.floor(worth * 0.03));
        this.log(`${p.name} 在综合医院就诊（${formatMoney(fee)}，含资产税）`);
        const r = g.forcePay(p, fee, null);
        if (r.bankrupt) this.log(`${p.name} 付不起医疗费，破产！`, 'bad');
        break;
      }
      case 'tax': {
        this.log(`${p.name} 缴纳${t.name} <span class="bad">${formatMoney(t.amount)}</span>`);
        const r = g.forcePay(p, t.amount, null);
        if (r.bankrupt) this.log(`${p.name} 缴税破产出局！`, 'bad');
        break;
      }
      case 'gotojail': {
        this.log(`${p.name} 违规经营被当场约谈！`, 'bad');
        g.sendToJail(p);
        this.broadcast({ t: 'tele', player: p.id, from: i, to: JAIL_INDEX, playerName: p.name });
        await delay(4200 / SPEED);
        break;
      }
      case 'chance':
      case 'chest': {
        const { card, deck } = g.drawCard(t.type);
        this.broadcast({ t: 'card', player: p.id, card, deck });
        await delay(4200 / SPEED);
        await this._applyCard(p, card, diceSum);
        break;
      }
      case 'property':
      case 'railroad':
      case 'utility':
        await this._resolveProperty(p, i, diceSum, brain);
        break;
    }
  }

  async _resolveProperty(p, i, diceSum, brain) {
    const g = this.game;
    const t = TILES[i];
    const ownerId = g.owner[i];
    if (ownerId === p.id) {
      this.log('自家产业，巡视一番。');
      await delay(300 / SPEED);
      return;
    }
    if (ownerId < 0) {
      if (p.money < t.price) {
        this.log(`${p.name} 资金不足，拿不下 ${t.name}（${formatMoney(t.price)}）`, 'bad');
        return;
      }
      let buy = false;
      if (p.isAI || this.aiManaged.has(p.id)) {
        const r = await brain.decideBuy(p, i);
        if (r.say) this.say(p.id, r.say);
        buy = r.buy;
      } else {
        buy = await this.ask('buy', p.id, { tileIdx: i }, false);
      }
      if (buy && (p.stamina || 0) >= STAMINA_BUY_LAND) {
        g.buyProperty(p, i);
        p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_BUY_LAND);
        this.log(`${p.name} 以 <span class="gold">${formatMoney(t.price)}</span> 收购 <b>${t.name}</b>！`, 'good');
        if (g.rng() < BUY_LAND_DRAW_CHANCE) {
          const loot = g.drawItemPack(p, 1);
          if (loot.length) this.log(`🎁 开业礼包：${g.formatDrawLoot(loot)}`, 'card');
        }
      } else if (!p.isAI && !this.aiManaged.has(p.id)) {
        this.log(`${p.name} 踏入无主之地 ${t.name}（需体力 ≥${STAMINA_BUY_LAND} 方可收购）`, 'muted');
      }
      return;
    }
    const owner = g.players[ownerId];
    if (g.isMortgaged(i)) {
      this.log(`${t.name} 已抵押给银行，暂停收租。`);
      await delay(300 / SPEED);
      return;
    }
    let rent = g.calcRent(i, diceSum);
    this.log(`${t.name} 属于 ${owner.name}，应付租金 <span class="bad">${formatMoney(rent)}</span>`);
    if (rent > 0 && p.hedgeRent) {
      rent = Math.ceil(rent / 2);
      p.hedgeRent = false;
      this.log(`${p.name} 触发 ☂️对冲保单，租金减半至 ${formatMoney(rent)}`, 'good');
    }
    const r = g.forcePay(p, rent, owner);
    if (r.bankrupt) {
      this.log(`${p.name} 全部身家 ${formatMoney(r.paid)} 赔给 ${owner.name}，破产出局！`, 'bad');
    } else {
      this.log(`${p.name} 支付 ${formatMoney(r.paid)} 给 ${owner.name}`);
    }
    if (r.soldHouses > 0) this.log(`${p.name} 被迫变卖 ${r.soldHouses} 栋建筑筹资`, 'bad');
    if (r.mortgaged > 0) this.log(`${p.name} 抵押了 ${r.mortgaged} 处地产`, 'bad');
    if (r.borrowed > 0) this.log(`${p.name} 向银行紧急贷款 ${formatMoney(r.borrowed)}`, 'bad');
  }

  async _applyCard(p, card, diceSum) {
    const g = this.game;
    const a = card.action;
    this.log(`卡牌：${card.text}`, 'card');
    switch (a.kind) {
      case 'money':
        if (a.amount >= 0) p.money += a.amount;
        else {
          const r = g.forcePay(p, -a.amount, null);
          if (r.bankrupt) this.log(`${p.name} 付款破产出局！`, 'bad');
        }
        break;
      case 'moneyEach':
        for (const other of g.players) {
          if (other.id === p.id || other.bankrupt) continue;
          if (a.amount >= 0) {
            const r = g.forcePay(other, a.amount, p);
            if (r.bankrupt) this.log(`${other.name} 被此卡逼到破产！`, 'bad');
          } else {
            const r = g.forcePay(p, -a.amount, other);
            if (r.bankrupt) { this.log(`${p.name} 赔付破产出局！`, 'bad'); break; }
          }
        }
        break;
      case 'jailCard':
        p.jailCards++;
        break;
      case 'item':
        g.giveItem(p, a.item, a.n || 1);
        break;
      case 'jail': {
        const from = p.position;
        g.sendToJail(p);
        this.broadcast({ t: 'tele', player: p.id, from, to: JAIL_INDEX, playerName: p.name });
        await delay(4200 / SPEED);
        break;
      }
      case 'moveTo': {
        const from = p.position;
        const steps = (a.to - from + TILES.length) % TILES.length;
        if (steps > 0) {
          const r = g.moveSteps(p, steps);
          this.broadcast({ t: 'move', player: p.id, from, steps });
          await delay(Math.min(1000, 200 + Math.abs(steps) * 90) / SPEED);
          if (a.collectGo && r.passedGo) this.log(`经过起点，融资到账 ${formatMoney(GO_SALARY)}`, 'good');
          this.update();
          await this._resolveLanding(p, diceSum, null);
        }
        break;
      }
      case 'moveSteps': {
        const from = p.position;
        g.moveSteps(p, a.steps);
        this.broadcast({ t: 'move', player: p.id, from, steps: a.steps });
        await delay(Math.min(1000, 200 + Math.abs(a.steps) * 90) / SPEED);
        this.update();
        await this._resolveLanding(p, diceSum, null);
        break;
      }
    }
  }

  async _autoFreeDraw(p) {
    const g = this.game;
    while (g.canFreeDraw(p)) {
      const r = g.takeDraw(p, 'free');
      if (!r?.got?.length) break;
      this.log(`🃏 回合补给：${g.formatDrawLoot(r.got)}`, 'card');
    }
  }

  async advanceRound(g) {
    for (const p of g.alivePlayers()) {
      g.applyTurnStart(p);
      if ((p.noBuildTurns || 0) > 0) p.noBuildTurns--;
    }
    g.tickMarket();
    if (g.rng() < 0.42) {
      const shift = g.randomIndustryShift();
      if (shift) {
        const ind = INDUSTRIES[shift.key];
        const st = shift.to > shift.from ? '📈' : '📉';
        this.log(`📰 <b>行业快讯</b>：${ind.icon}${ind.name} 景气变动 ${st}`, 'card');
      }
    }
    this.round++;
    for (const p of g.alivePlayers()) {
      const audit = g.regulatorAudit(p);
      if (audit && audit.fine > 0) {
        this.log(`🕵️ 监管：${audit.reason}，罚款 ${formatMoney(audit.fine)}`, 'bad');
        g.forcePay(p, audit.fine, null);
      } else if (audit && audit.fine === 0) {
        this.log(`🕵️ 监管：${audit.reason}`, 'good');
      }
    }
    this.broadcast({
      t: 'newRound',
      round: this.round,
      state: serializeState(g, this.round),
    });
    this.update();
  }
}

// ---------- 网络适配器（最小化，仅用于 Engine 构造兼容） ----------
function makeNetAdapter(room) {
  return {
    log: (html, cls) => room.log(html, cls),
    update: () => room.update(),
    pause: (ms) => delay(ms / SPEED),
    phase() {},
    animateDice() {},
    animateMove() {},
    animateTeleport() {},
    showCard() {},
    waitRoll() { return { type: 'roll' }; },
    waitEndTurn() {},
    promptBuy() { return false; },
    promptJail() { return 'roll'; },
    promptItemUse() { return false; },
    gameOver(w) { room.broadcast({ t: 'over', winnerId: w.id }); },
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

  room._enqueueOp(seat, async () => {
    if (p.bankrupt) return;

    const done = executeOp(room, seat, msg, err);
    if (done) {
      room.log(done, msg.op === 'playCard' ? 'card' : 'good');
      if (msg.op === 'playCard' && msg.item) {
        room.broadcast({ t: 'itemCast', playerId: p.id, item: msg.item, name: p.name });
      }
      if (msg.op === 'intel') {
        room.broadcast({ t: 'itemCast', playerId: p.id, item: 'intel', name: p.name });
      }
      room.update();
      if ((p.stamina || 0) <= 0 && !room.roundEnded.has(seat)) {
        room.log(`${p.name} 体力耗尽，自动结束回合`, 'muted');
        room.roundEnded.add(seat);
        room._checkRoundEnd();
      }
    }
  });
}

function executeOp(room, seat, msg, err) {
  const g = room.game;
  const p = g.players[seat];
  const tileOk = (i) => Number.isInteger(i) && i >= 0 && i < TILES.length;

  switch (msg.op) {
    case 'build': {
      const i = msg.tileIdx;
      if ((p.stamina || 0) < STAMINA_BUILD) return err('体力不足，需要 ' + STAMINA_BUILD);
      if (!tileOk(i) || !g.canBuild(p, i)) {
        return err((p.items?.permit || 0) < 1 ? '需要建设卡才能建楼' : '此处不能建设');
      }
      g.buyHouse(p, i);
      return `${p.name} 消耗建设卡，在 ${TILES[i].name} 起了一级楼`;
    }
    case 'sellHouse': {
      const i = msg.tileIdx;
      if ((p.stamina || 0) < STAMINA_SELLHOUSE) return err('体力不足');
      if (!tileOk(i) || !g.canSellHouse(p, i)) return err('此处没有可卖建筑');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_SELLHOUSE);
      g.sellHouse(p, i);
      return `${p.name} 卖出了 ${TILES[i].name} 的一级建筑`;
    }
    case 'borrow': {
      const amt = Math.max(1, Math.round(Number(msg.amount) || 0));
      if ((p.stamina || 0) < STAMINA_BANK) return err('体力不足，需要 ' + STAMINA_BANK);
      if (!g.canBorrow(p, amt)) return err('超出信用额度');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_BANK);
      g.borrow(p, amt);
      return `${p.name} 向银行贷款 ${formatMoney(amt)}`;
    }
    case 'repay': {
      const amt = Math.max(1, Math.round(Number(msg.amount) || 0));
      if ((p.stamina || 0) < STAMINA_BANK) return err('体力不足，需要 ' + STAMINA_BANK);
      const r = g.repay(p, amt);
      if (r <= 0) return err('没有可还金额');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_BANK);
      return `${p.name} 偿还贷款 ${formatMoney(r)}`;
    }
    case 'mortgage': {
      const i = msg.tileIdx;
      if ((p.stamina || 0) < STAMINA_MORTGAGE) return err('体力不足');
      if (!tileOk(i) || !g.canMortgage(p, i)) return err('该地产不能抵押');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_MORTGAGE);
      g.mortgage(p, i);
      return `${p.name} 抵押了 ${TILES[i].name}（+${formatMoney(g.mortgageValue(i))}）`;
    }
    case 'unmortgage': {
      const i = msg.tileIdx;
      if ((p.stamina || 0) < STAMINA_MORTGAGE) return err('体力不足');
      if (!tileOk(i) || !g.canUnmortgage(p, i)) return err('该地产不能赎回');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_MORTGAGE);
      g.unmortgage(p, i);
      return `${p.name} 赎回了 ${TILES[i].name}`;
    }
    case 'foundCompany': {
      const ind = msg.industry;
      if ((p.stamina || 0) < STAMINA_COMPANY) return err('体力不足，需要 ' + STAMINA_COMPANY);
      if (!INDUSTRIES[ind] || ind === 'railroad' || ind === 'utility') return err('无效行业');
      if (!g.canFoundCompany(p)) {
        return err((p.items?.charter || 0) < 1 ? '需要公司卡才能创办' : '现在不能创办公司');
      }
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_COMPANY);
      g.foundCompany(p, ind);
      return `${p.name} 消耗公司卡，创办了 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 公司！`;
    }
    case 'upgradeCompany': {
      if ((p.stamina || 0) < STAMINA_COMPANY) return err('体力不足，需要 ' + STAMINA_COMPANY);
      if (!g.canUpgradeCompany(p)) {
        return err((p.items?.charter || 0) < 1 ? '需要公司卡才能升级' : '公司不能升级');
      }
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_COMPANY);
      g.upgradeCompany(p);
      return `${p.name} 消耗公司卡，公司升到 Lv${p.company.level}`;
    }
    case 'buyStock': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if ((p.stamina || 0) < STAMINA_STOCK) return err('体力不足，需要 ' + STAMINA_STOCK);
      if (!g.canBuyStock(p, ind, n)) {
        return err('无法买入股票（需持有该行业地产、现金足够、未超个人/全场持股上限）');
      }
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_STOCK);
      const r = g.buyStock(p, ind, n);
      return `${p.name} 买入 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 股票 ${n} 手（${formatMoney(r.cost)}），过路费 ×${r.boost.toFixed(2)}`;
    }
    case 'sellStock': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if ((p.stamina || 0) < STAMINA_STOCK) return err('体力不足，需要 ' + STAMINA_STOCK);
      if (!g.canSellStock(p, ind, n)) return err('无法卖出股票');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_STOCK);
      const r = g.sellStock(p, ind, n);
      return `${p.name} 卖出 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 股票 ${n} 手（+${formatMoney(r.gain)}），过路费 ×${r.boost.toFixed(2)}`;
    }
    case 'openShort': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if ((p.stamina || 0) < STAMINA_STOCK) return err('体力不足，需要 ' + STAMINA_STOCK);
      if (!g.openShort || !g.canOpenShort?.(p, ind, n)) {
        return err('无法做空（需持地、无多头、未超空仓上限）');
      }
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_STOCK);
      const r = g.openShort(p, ind, n);
      if (!r) return err('无法做空');
      return `${p.name} 做空 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} ${n} 手（+${formatMoney(r.gain)}，待平）`;
    }
    case 'coverShort': {
      const ind = msg.industry;
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      if ((p.stamina || 0) < STAMINA_STOCK) return err('体力不足，需要 ' + STAMINA_STOCK);
      if (!g.coverShort || !g.canCoverShort?.(p, ind, n)) return err('无法平空');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_STOCK);
      const r = g.coverShort(p, ind, n);
      if (!r) return err('无法平空');
      return `${p.name} 平空 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} ${n} 手（-${formatMoney(r.cost)}）`;
    }
    case 'ipo': {
      if ((p.stamina || 0) < STAMINA_COMPANY) return err('体力不足，需要 ' + STAMINA_COMPANY);
      if (!g.canIPO(p)) return err('暂不可 IPO');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_COMPANY);
      const r = g.doIPO(p);
      return `${p.name} 公司 IPO！抛出 ${r.n} 股，套现 ${formatMoney(r.raised)}`;
    }
    case 'invest': {
      const founder = g.players[msg.founderId];
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 1)));
      const fromFloat = !!msg.fromFloat;
      if ((p.stamina || 0) < STAMINA_INVEST) return err('体力不足，需要 ' + STAMINA_INVEST);
      if (!founder || !g.canInvestCompany(p, founder, n, fromFloat)) return err('无法入股');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_INVEST);
      const r = g.investCompany(p, founder, n, fromFloat);
      return `${p.name} 入股 ${founder.name} 公司 ${n} 股（${formatMoney(r.cost)}）`;
    }
    case 'drawPack': {
      const mode = msg.mode === 'free' ? 'free' : 'paid';
      if ((p.stamina || 0) < STAMINA_DRAW) return err('体力不足，需要 ' + STAMINA_DRAW);
      const r = g.takeDraw(p, mode);
      if (!r) return err(mode === 'paid' ? '无法付费抽牌（现金/次数）' : '没有免费抽牌次数');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_DRAW);
      return mode === 'paid'
        ? `${p.name} 付费补给（${formatMoney(r.cost)}）：${g.formatDrawLoot(r.got)}`
        : `${p.name} 免费补给：${g.formatDrawLoot(r.got)}`;
    }
    case 'pledge': {
      const n = Math.max(1, Math.min(20, Math.round(Number(msg.n) || 5)));
      if ((p.stamina || 0) < STAMINA_COMPANY) return err('体力不足，需要 ' + STAMINA_COMPANY);
      if (!g.canPledgeShares(p, n)) return err('无法质押公司股');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_COMPANY);
      const r = g.pledgeSharesForLoan(p, n);
      return `${p.name} 质押公司股 ${r.n} 手，获贷 ${formatMoney(r.loan)}`;
    }
    case 'intel': {
      const ind = msg.industry;
      const mode = msg.mode === 'down' ? 'down' : 'up';
      if ((p.items.intel || 0) <= 0) return err('没有资讯卡');
      if ((p.stamina || 0) < STAMINA_CARD) return err('体力不足，需要 ' + STAMINA_CARD);
      if (!g.useItem(p, 'intel')) return err('没有资讯卡');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_CARD);
      const r = g.applyNews(ind, mode);
      if (!r) return err('无效行业');
      return `📰 ${p.name} 发布${mode === 'up' ? '利好' : '利空'}：${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} ${r.from.toFixed(2)}→${r.to.toFixed(2)}`;
    }
    case 'demolish':
      return executeOp(room, seat, { op: 'playCard', item: 'demolish', tileIdx: msg.tileIdx }, err);
    case 'playCard': {
      if ((p.stamina || 0) < STAMINA_CARD) return err('体力不足，需要 ' + STAMINA_CARD);
      const result = playCard(room, p, msg, err);
      if (!result) return undefined;
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_CARD);
      return result;
    }
    case 'listCard': {
      const item = msg.item;
      const price = Math.max(1, Math.round(Number(msg.price) || ttc(10)));
      if ((p.stamina || 0) < STAMINA_BLACKMARKET) return err('体力不足，需要 ' + STAMINA_BLACKMARKET);
      if (!p.pendingListings?.length) return err('没有待定价卡牌');
      const idx = p.pendingListings.findIndex(it => it === item || !item);
      if (idx < 0) return err('该卡不在待定价列表');
      const [target] = p.pendingListings.splice(idx, 1);
      const id = g.listOnMarket(p, target, price);
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_BLACKMARKET);
      room.broadcast({ t: 'marketRefresh' });
      return `🏴 ${p.name} 将 ${ITEMS[target]?.icon || '🃏'}${target} 挂上黑市（${formatMoney(price)}）`;
    }
    case 'buyCard': {
      const listingId = Number(msg.listingId);
      if ((p.stamina || 0) < STAMINA_BLACKMARKET) return err('体力不足，需要 ' + STAMINA_BLACKMARKET);
      if (!g.canBuyFromMarket(p, listingId)) return err('无法买入（资金不足/手牌已满/自己不能买自己的）');
      const r = g.buyFromMarket(p, listingId);
      if (!r) return err('买入失败');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_BLACKMARKET);
      room.broadcast({ t: 'marketRefresh' });
      return `🏴 ${p.name} 从黑市买入 ${ITEMS[r.item]?.icon || '🃏'}${r.item}（${formatMoney(r.price)}）`;
    }
    case 'unlistCard': {
      const listingId = Number(msg.listingId);
      if ((p.stamina || 0) < STAMINA_BLACKMARKET) return err('体力不足，需要 ' + STAMINA_BLACKMARKET);
      if (!g.canUnlist(p, listingId)) return err('无法下架（手牌已满/不是你的挂牌）');
      const r = g.unlistFromMarket(p, listingId);
      if (!r) return err('下架失败');
      p.stamina = Math.max(0, (p.stamina || 0) - STAMINA_BLACKMARKET);
      room.broadcast({ t: 'marketRefresh' });
      return `🏴 ${p.name} 从黑市下架 ${ITEMS[r.item]?.icon || '🃏'}${r.item}`;
    }
    default:
      return err('未知操作');
  }
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
    case 'reverse': {
      g.useItem(p, 'reverse');
      g.playReverse(p);
      return `🔄 ${p.name} 激活反向卡，下次掷骰反向行走`;
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
    case 'endRound': {
      const room = ws._room;
      if (!room?.started) return;
      const seat = ws._seat;
      if (room.roundEnded.has(seat)) break;
      const p = room.game.players[seat];
      room.roundEnded.add(seat);
      room.broadcast({ t: 'playerEnded', seat, stamina: p?.stamina || 0 });
      room.log(`${p?.name || '玩家'} 结束回合`, 'muted');
      room._checkRoundEnd();
      break;
    }
    case 'roll': {
      const room = ws._room;
      if (!room?.started) return;
      const seat = ws._seat;
      room._enqueueOp(seat, async () => {
        const p = room.game.players[seat];
        if (!p || p.bankrupt || room.roundEnded.has(seat)) return;
        if ((p.stamina || 0) < STAMINA_DICE) {
          room.sendSeat(seat, { t: 'error', msg: '体力不足，需要 ' + STAMINA_DICE });
          return;
        }
        await room._executePlayerRoll(p, room.engine, room.brain);
        await room._autoFreeDraw(p);
        if (!p.bankrupt && room.game.bankShouldPitchPledge(p) && (p.isAI || room.aiManaged.has(seat))) {
          const accept = await room.brain.decideBuy?.(p, -1)?.then?.(() => false) || false;
          if (accept) {
            const r = room.game.pledgeSharesForLoan(p, 5);
            if (r) room.log(`${p.name} 质押公司股 5 手，获贷 ${formatMoney(r.loan)}`, 'card');
          }
        }
        room.update();
      });
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
