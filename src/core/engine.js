// 回合引擎：驱动完整一局游戏。所有表现（动画/弹窗/日志）通过 adapter 注入，
// 因此同一引擎既可用于浏览器（Three.js + DOM + DeepSeek），也可用于无头仿真测试。
import { GameState, TILES, JAIL_FINE, JAIL_INDEX, INDUSTRIES, INDUSTRY_STATES } from './state.js';

const MAX_TURNS = 12000; // 34 人局单轮即 34 回合，需更高上限
const MAX_CARD_CHAIN = 3;

const NEWS_UP = [
  '{name}赛道获得政策大礼包，景气度上升！',
  '万亿资金涌入{name}，租金水涨船高！',
  '{name}技术突破刷屏全网，行业一片向好！',
];
const NEWS_DOWN = [
  '{name}遭遇监管风暴，景气度下滑…',
  '{name}需求萎缩，资本市场用脚投票。',
  '价格战开打，{name}利润承压。',
];

export class Engine {
  /**
   * adapter 方法（均可 async）:
   *  log(html, cls), update(), pause(ms),
   *  animateDice(d1,d2) — d2=0 表示单骰（遥控骰子）,
   *  animateMove(player, from, steps), animateTeleport(player, from, to),
   *  waitRoll(player) -> {type:'roll', boost?:bool} | {type:'remote', total:1~6},
   *  waitEndTurn(player),
   *  promptBuy(player, tileIdx) -> bool,
   *  promptJail(player, {canPay, hasCard}) -> 'card'|'pay'|'roll',
   *  promptItemUse(player, item, ctx) -> bool,   // 被动道具（免租卡）
   *  showCard(player, card, deck),
   *  phase(name, player), gameOver(winner)
   */
  constructor(game, adapter) {
    this.g = game;
    this.a = adapter;
  }

  /** @param {number|null} resumeFrom 从指定玩家回合恢复（存档续玩） */
  async run(resumeFrom = null) {
    let idx = resumeFrom == null ? -1 : resumeFrom - 1;
    let prevIdx = idx;
    while (!this.g.winner() && this.g.turn < MAX_TURNS) {
      idx = this.g.nextPlayerIndex(idx);
      if (idx < 0) break;
      if (prevIdx !== -1 && idx <= prevIdx) await this._maybeNews();
      prevIdx = idx;
      this.g.turn++;
      const p = this.g.players[idx];
      if ((p.skipTurns || 0) > 0) {
        p.skipTurns--;
        this.a.log(`😴 ${this._tag(p)} 被冬眠卡命中，跳过本回合`, 'bad');
        this.a.update();
        continue;
      }
      this.a.phase('turnStart', p);
      this.a.log(`—— ${this._tag(p)} 的回合 ——`, 'turn');
      await this.playTurn(p);
      this.a.update();
    }
    let w = this.g.winner();
    if (!w) w = this.g.alivePlayers().sort((x, y) => this.g.netWorth(y) - this.g.netWorth(x))[0];
    await this.a.gameOver(w);
    return w;
  }

  async _maybeNews() {
    if (this.g.rng() >= 0.42) return;
    const shift = this.g.randomIndustryShift();
    if (!shift) return;
    const ind = INDUSTRIES[shift.key];
    const st = INDUSTRY_STATES[shift.to];
    const tpl = (shift.to > shift.from ? NEWS_UP : NEWS_DOWN)[Math.floor(this.g.rng() * 3)];
    this.a.log(`📰 <b>行业快讯</b>：${tpl.replace('{name}', `${ind.icon}${ind.name}`)}（${st.icon}${st.name}）`, 'card');
    this.a.update();
  }

  _tag(p) { return p.isAI ? `${p.name}(AI)` : p.name; }

  async playTurn(p) {
    // 回合开始：公司营收 + 贷款利息
    const { revenue, interest } = this.g.applyTurnStart(p);
    if (revenue > 0) this.a.log(`${this._tag(p)} 的公司营收 <span class="gold">+¥${revenue}</span>`, 'good');
    if (interest > 0) this.a.log(`${this._tag(p)} 的贷款计息 ¥${interest}（当前债务 ¥${p.debt}）`, 'bad');

    let doublesCount = 0;
    while (true) {
      if (p.inJail) {
        const turnOver = await this._handleJail(p);
        if (turnOver) {
          // 监禁路径回合结束：与其他路径一致，补回合末操作阶段
          if (!p.bankrupt && !this.g.winner()) {
            this.a.phase('endTurn', p);
            await this.a.waitEndTurn(p);
          }
          return;
        }
      }
      this.a.phase('waitRoll', p);
      const action = await this.a.waitRoll(p);

      let d1, d2, remote = false, boost = false;
      if (action && action.type === 'remote' && this.g.useItem(p, 'remote')) {
        remote = true;
        d1 = Math.max(1, Math.min(6, action.total | 0));
        d2 = 0;
        this.a.log(`${this._tag(p)} 使用 🎯遥控骰子，指定点数 <b>${d1}</b>`, 'good');
      } else {
        boost = !!(action && action.boost);
        if (boost && !this.g.useItem(p, 'boost')) boost = false;
        d1 = this.g.rollDie();
        d2 = this.g.rollDie();
      }
      await this.a.animateDice(d1, d2);

      const doubles = !remote && d1 === d2;
      if (doubles) { doublesCount++; this.a.onEvent?.(p, 'doubles'); }
      let total = d1 + d2;
      if (boost) {
        total += 3;
        this.a.log(`${this._tag(p)} 发动 🚀加速卡，额外 +3 步`, 'good');
      }
      this.a.log(remote
        ? `${this._tag(p)} 前进 <b>${total}</b> 步`
        : `${this._tag(p)} 掷出 <b>${d1}</b> + <b>${d2}</b>${doubles ? ' <span class="gold">双数！</span>' : ''}`);

      if (doublesCount >= 3) {
        this.a.log(`${this._tag(p)} 连续三次双数，操纵市场被约谈！`, 'bad');
        const from = p.position;
        this.g.sendToJail(p);
        await this.a.animateTeleport(p, from, JAIL_INDEX);
        this.a.update();
        return;
      }
      const { from, passedGo } = this.g.moveSteps(p, total);
      await this.a.animateMove(p, from, total);
      if (passedGo) this.a.log(`${this._tag(p)} 经过起点，融资到账 <span class="gold">¥200</span>`, 'good');
      this.a.update();
      await this._resolveLanding(p, total, 0);
      this.a.update();
      if (p.bankrupt || this.g.winner()) return;
      if (!doubles || p.inJail) break; // 双数入监：回合结束，不再加掷
      this.a.log(`${this._tag(p)} 获得额外一次掷骰机会`, 'good');
    }
    this.a.phase('endTurn', p);
    await this.a.waitEndTurn(p);
  }

  async _handleJail(p) {
    const choice = await this.a.promptJail(p, { canPay: p.money >= JAIL_FINE, hasCard: p.jailCards > 0 });
    if (choice === 'card' && p.jailCards > 0) {
      p.jailCards--;
      p.inJail = false;
      this.a.log(`${this._tag(p)} 出示免于约谈卡，从容离场！`, 'good');
      this.a.update();
      return false;
    }
    if (choice === 'pay' && p.money >= JAIL_FINE) {
      p.money -= JAIL_FINE;
      p.inJail = false;
      this.a.log(`${this._tag(p)} 缴纳 ¥${JAIL_FINE} 保证金离开监管局`, 'good');
      this.a.update();
      return false;
    }
    this.a.phase('jailRoll', p);
    await this.a.waitRoll(p);
    const d1 = this.g.rollDie();
    const d2 = this.g.rollDie();
    await this.a.animateDice(d1, d2);
    this.a.log(`${this._tag(p)} 在监管局掷出 ${d1} + ${d2}`);
    if (d1 === d2) {
      p.inJail = false;
      p.jailTurns = 0;
      this.a.log(`双数！${this._tag(p)} 澄清事实，恢复自由`, 'good');
      const { from } = this.g.moveSteps(p, d1 + d2);
      await this.a.animateMove(p, from, d1 + d2);
      this.a.update();
      await this._resolveLanding(p, d1 + d2, 0);
      this.a.update();
      return true;
    }
    p.jailTurns++;
    if (p.jailTurns >= 3) {
      this.a.log(`${this._tag(p)} 三次未成，强制缴纳 ¥${JAIL_FINE} 离场`, 'bad');
      const from = p.position;
      const r = this.g.forcePay(p, JAIL_FINE, null);
      p.inJail = !r.bankrupt;
      p.jailTurns = 0;
      if (r.bankrupt) { this.a.log(`${this._tag(p)} 无力缴纳保证金，破产出局！`, 'bad'); return true; }
      this.g.moveSteps(p, d1 + d2);
      await this.a.animateMove(p, from, d1 + d2);
      this.a.update();
      await this._resolveLanding(p, d1 + d2, 0);
      this.a.update();
      return true;
    }
    this.a.log(`${this._tag(p)} 未能掷出双数，继续配合调查（第 ${p.jailTurns}/3 次）`, 'bad');
    return true;
  }

  async _resolveLanding(p, diceSum, depth) {
    if (p.bankrupt) return;
    const i = p.position;
    const t = TILES[i];
    this.a.log(`${this._tag(p)} 抵达 <b>${t.name}</b>`);
    switch (t.type) {
      case 'go': break;
      case 'parking':
        this.a.log('在度假区小憩，无事发生～');
        await this.a.pause(400);
        break;
      case 'jail':
        this.a.log('只是路过监管局门口。');
        await this.a.pause(400);
        break;
      case 'tax': {
        this.a.log(`${this._tag(p)} 缴纳${t.name} <span class="bad">¥${t.amount}</span>`);
        const r = this.g.forcePay(p, t.amount, null);
        this._logForcePay(p, r);
        if (r.bankrupt) this.a.log(`${this._tag(p)} 缴税破产出局！`, 'bad');
        break;
      }
      case 'gotojail': {
        this.a.log(`${this._tag(p)} 违规经营被当场约谈！`, 'bad');
        this.g.sendToJail(p);
        await this.a.animateTeleport(p, i, JAIL_INDEX);
        break;
      }
      case 'chance':
      case 'chest': {
        if (depth >= MAX_CARD_CHAIN) { this.a.log('风平浪静，无事发生。'); break; }
        const { card, deck } = this.g.drawCard(t.type);
        await this.a.showCard(p, card, deck);
        await this._applyCard(p, card, diceSum, depth);
        break;
      }
      case 'property':
      case 'railroad':
      case 'utility':
        await this._resolveProperty(p, i, diceSum);
        break;
    }
  }

  _logForcePay(p, r) {
    if (r.soldHouses > 0) this.a.log(`${this._tag(p)} 被迫变卖 ${r.soldHouses} 栋建筑筹资`, 'bad');
    if (r.mortgaged > 0) this.a.log(`${this._tag(p)} 抵押了 ${r.mortgaged} 处地产`, 'bad');
    if (r.borrowed > 0) this.a.log(`${this._tag(p)} 向银行紧急贷款 ¥${r.borrowed}`, 'bad');
  }

  async _resolveProperty(p, i, diceSum) {
    const t = TILES[i];
    const ownerId = this.g.owner[i];
    if (ownerId === p.id) {
      this.a.log('自家产业，巡视一番。');
      await this.a.pause(300);
      return;
    }
    if (ownerId < 0) {
      if (p.money < t.price) {
        this.a.log(`${this._tag(p)} 资金不足，拿不下 ${t.name}（¥${t.price}）`, 'bad');
        return;
      }
      const buy = await this.a.promptBuy(p, i);
      if (buy) {
        this.g.buyProperty(p, i);
        this.a.log(`${this._tag(p)} 以 <span class="gold">¥${t.price}</span> 收购 <b>${t.name}</b>！`, 'good');
        this.a.update();
        this.a.onEvent?.(p, 'buy', { tileIdx: i });
      } else {
        this.a.log(`${this._tag(p)} 放弃了收购 ${t.name}`);
        this.a.onEvent?.(p, 'skip', { tileIdx: i });
      }
      return;
    }
    const owner = this.g.players[ownerId];
    if (this.g.isMortgaged(i)) {
      this.a.log(`${t.name} 已抵押给银行，暂停收租。`);
      await this.a.pause(300);
      return;
    }
    const rent = this.g.calcRent(i, diceSum);
    this.a.log(`${t.name} 属于 ${this._tag(owner)}，应付租金 <span class="bad">¥${rent}</span>`);
    if (rent > 0 && (p.items.rentFree || 0) > 0) {
      const use = await this.a.promptItemUse(p, 'rentFree', { rent });
      if (use) {
        this.g.useItem(p, 'rentFree');
        this.a.log(`${this._tag(p)} 使用 🛡️免租卡，免除 ¥${rent} 租金！`, 'good');
        return;
      }
    }
    const r = this.g.forcePay(p, rent, owner);
    this._logForcePay(p, r);
    if (r.bankrupt) {
      this.a.log(`${this._tag(p)} 全部身家 ¥${r.paid} 赔给 ${this._tag(owner)}，破产出局！`, 'bad');
    } else {
      this.a.log(`${this._tag(p)} 支付 ¥${r.paid} 给 ${this._tag(owner)}`);
      if (r.paid >= 150) this.a.onEvent?.(p, 'rent', { rent: r.paid });
    }
  }

  async _applyCard(p, card, diceSum, depth) {
    const a = card.action;
    this.a.log(`卡牌：${card.text}`, 'card');
    switch (a.kind) {
      case 'money':
        if (a.amount >= 0) p.money += a.amount;
        else {
          const r = this.g.forcePay(p, -a.amount, null);
          this._logForcePay(p, r);
          if (r.bankrupt) this.a.log(`${this._tag(p)} 付款破产出局！`, 'bad');
        }
        break;
      case 'moneyEach':
        for (const other of this.g.players) {
          if (other.id === p.id || other.bankrupt) continue;
          if (a.amount >= 0) {
            const r = this.g.forcePay(other, a.amount, p);
            if (r.bankrupt) this.a.log(`${this._tag(other)} 被此卡逼到破产！`, 'bad');
          } else {
            const r = this.g.forcePay(p, -a.amount, other);
            if (r.bankrupt) { this.a.log(`${this._tag(p)} 赔付破产出局！`, 'bad'); break; }
          }
        }
        break;
      case 'jailCard':
        p.jailCards++;
        break;
      case 'item':
        this.g.giveItem(p, a.item, a.n || 1);
        break;
      case 'industry': {
        const shift = this.g.setIndustryExtreme(this.g.rng, a.mode);
        const ind = INDUSTRIES[shift.key];
        const st = INDUSTRY_STATES[shift.to];
        this.a.log(`${ind.icon}<b>${ind.name}</b> 行业变为 ${st.icon}<b>${st.name}</b>！`, 'card');
        break;
      }
      case 'jail': {
        const from = p.position;
        this.g.sendToJail(p);
        await this.a.animateTeleport(p, from, JAIL_INDEX);
        break;
      }
      case 'repair': {
        let houses = 0, hotels = 0;
        for (const i of this.g.playerProperties(p.id)) {
          if (TILES[i].type !== 'property') continue;
          if (this.g.houses[i] >= 5) hotels++; else houses += this.g.houses[i];
        }
        const cost = houses * a.house + hotels * a.hotel;
        this.a.log(`需维护 ${houses} 栋建筑、${hotels} 个地标，共 <span class="bad">¥${cost}</span>`);
        if (cost > 0) {
          const r = this.g.forcePay(p, cost, null);
          this._logForcePay(p, r);
          if (r.bankrupt) this.a.log(`${this._tag(p)} 维护费破产出局！`, 'bad');
        }
        break;
      }
      case 'moveTo': {
        const from = p.position;
        const steps = (a.to - from + TILES.length) % TILES.length;
        if (steps > 0) {
          const r = this.g.moveSteps(p, steps);
          await this.a.animateMove(p, from, steps);
          if (a.collectGo && r.passedGo) this.a.log(`经过起点，融资到账 ¥200`, 'good');
          this.a.update();
          await this._resolveLanding(p, diceSum, depth + 1);
        }
        break;
      }
      case 'moveSteps': {
        const from = p.position;
        this.g.moveSteps(p, a.steps);
        await this.a.animateMove(p, from, a.steps);
        this.a.update();
        await this._resolveLanding(p, diceSum, depth + 1);
        break;
      }
      case 'nearest': {
        const from = p.position;
        const target = this.g.nearestOfType(from, a.target);
        const steps = (target - from + TILES.length) % TILES.length;
        if (steps > 0) {
          this.g.moveSteps(p, steps);
          await this.a.animateMove(p, from, steps);
          this.a.update();
          await this._resolveLanding(p, diceSum, depth + 1);
        }
        break;
      }
    }
  }
}
