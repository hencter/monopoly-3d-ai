// 回合引擎：驱动完整一局游戏。所有表现（动画/弹窗/日志）通过 adapter 注入，
// 因此同一引擎既可用于浏览器（Three.js + DOM + DeepSeek），也可用于无头仿真测试。
import {
  GameState, TILES, JAIL_FINE, JAIL_INDEX, INDUSTRIES, INDUSTRY_STATES, ITEMS,
  formatMoney, ttc, GO_SALARY, GO_DRAW_N, PARKING_DRAW_N, BUY_LAND_DRAW_CHANCE, PAID_DRAW_COST,
  LOTTERY_COST, LOTTERY_JACKPOT, LOTTERY_WIN_CHANCE, HOSPITAL_FEE,
} from './state.js';

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
      // 下标回绕：全员各操作完一轮 → 新 T+ 交易日
      if (prevIdx !== -1 && idx <= prevIdx) {
        this.a.phase?.('roundEnd');
        this.a.onRoundEnd?.();
        await this._maybeNews();
      }
      prevIdx = idx;
      this.g.turn++;
      // 市场自然涨跌 + 公告过期
      this.g.tickMarket();
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
    const msg = `${ind.icon}${ind.name} → ${st.icon}${st.name}。${tpl.replace('{name}', ind.name)}`;
    this.a.log(`📰 <b>行业快讯</b>：${tpl.replace('{name}', `${ind.icon}${ind.name}`)}（${st.icon}${st.name}）`, 'card');
    // 写入公告板（3 回合后失效）+ K 线冲击
    this.g.pushNewsBoard?.({
      text: msg,
      icon: shift.to > shift.from ? '📈' : '📉',
      industry: shift.key,
      mode: shift.to > shift.from ? 'up' : 'down',
      ttlTurns: 3,
    });
    this.g.pushCandle?.(shift.key);
    if (this.a.showHoloNotice) {
      await this.a.showHoloNotice({
        kind: 'notice',
        icon: '📰',
        title: '行业快讯',
        text: msg,
        auto: true,
        duration: 3800,
      });
    }
    this.a.update();
  }

  _tag(p) { return p.isAI ? `${p.name}(AI)` : p.name; }

  async playTurn(p) {
    // 回合开始：公司营收 + 股票/入股分红 + 贷款利息 + 监管抽查
    const { revenue, interest, dividend, stockDiv, equityDiv } = this.g.applyTurnStart(p);
    if (revenue > 0) this.a.log(`${this._tag(p)} 的公司营收 <span class="gold">+${formatMoney(revenue)}</span>（余额 ${formatMoney(p.money)}）`, 'good');
    if (equityDiv > 0) this.a.log(`${this._tag(p)} 的入股股息 <span class="gold">+${formatMoney(equityDiv)}</span>（余额 ${formatMoney(p.money)}）`, 'good');
    if (stockDiv > 0) this.a.log(`${this._tag(p)} 的行业股分红 <span class="gold">+${formatMoney(stockDiv)}</span>（余额 ${formatMoney(p.money)}）`, 'good');
    if (stockDiv < 0) {
      const shorts = p.shorts || {};
      const detail = STOCK_INDUSTRIES.filter(k => shorts[k] > 0).map(k => `${k}×${shorts[k]}`).join(',');
      this.a.log(`${this._tag(p)} 的行业股付息 <span class="bad">${formatMoney(stockDiv)}</span>（余额 ${formatMoney(p.money)}）${detail ? ` · 空头：${detail}` : ''}`, 'bad');
    }
    if (interest > 0) this.a.log(`${this._tag(p)} 的贷款计息 ${formatMoney(interest)}（当前债务 ${formatMoney(p.debt)}）`, 'bad');

    const audit = this.g.regulatorAudit(p);
    if (audit) {
      await this.a.showHoloNotice?.({
        kind: 'notice', icon: '🕵️', title: '🏛️ 监管通知书',
        text: `${audit.reason}${audit.fine > 0 ? `\n罚款 ${formatMoney(audit.fine)}` : '\n本次无罚款'}`,
        auto: true, duration: 5000,
      });
      if (audit.fine > 0) {
        this.a.log(`🕵️ 监管智能体：${audit.reason}，罚款 <span class="bad">${formatMoney(audit.fine)}</span>`, 'bad');
        const r = this.g.forcePay(p, audit.fine, null);
        this._logForcePay(p, r);
        if (r.bankrupt) { this.a.log(`${this._tag(p)} 被监管罚到破产！`, 'bad'); return; }
      } else {
        this.a.log(`🕵️ 监管智能体：${audit.reason}`, 'good');
      }
    }
    this.a.update();

    let doublesCount = 0;
    while (true) {
      if (p.inJail) {
        const turnOver = await this._handleJail(p);
        if (turnOver) {
          if (!p.bankrupt && !this.g.winner()) {
            this.a.phase('endTurn', p);
            await this._endTurnWithBank(p);
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
        this.a.onItemCast?.(p, 'remote');
      } else {
        boost = !!(action && action.boost);
        if (boost && !this.g.useItem(p, 'boost')) boost = false;
        else if (boost) this.a.onItemCast?.(p, 'boost');
        d1 = this.g.rollDie();
        d2 = this.g.rollDie();
      }
      await this.a.animateDice(d1, d2);

      // 生活区房租：按掷骰前操作秒数结算 + 上限；第一颗骰定区域倍率；有房产豁免
      const opSec = action?.opSeconds != null ? Number(action.opSeconds) : 0;
      const live = this.g.resolveLivingRent(p, d1 || 1, opSec);
      const secTxt = `${Math.round(live.seconds || opSec)}s`;
      if (live.waived) {
        this.a.log(
          `${live.zone.icon} 生活区：${live.zone.name}（操作 ${secTxt}，估算房租 ${formatMoney(live.rent)}）· 有房产豁免`,
          'good',
        );
      } else if (live.rent <= 0) {
        this.a.log(
          `${live.zone.icon} 生活区：${live.zone.name} · 操作 ${secTxt} 在免费时限内，房租 ${formatMoney(0)}`,
          'good',
        );
      } else {
        const capNote = live.capped ? '（已达上限）' : '';
        this.a.log(
          `${live.zone.icon} 生活区：${live.zone.name} · 操作 ${secTxt}`
          + `（计费 ${live.billableSec || 0}s）房租 <span class="bad">${formatMoney(live.paid)}</span>${capNote}`,
          'bad',
        );
        if (live.bankrupt) { this.a.log(`${this._tag(p)} 付不起房租，破产出局！`, 'bad'); return; }
      }

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
      if (passedGo) {
        this.a.log(`${this._tag(p)} 经过起点，融资到账 <span class="gold">${formatMoney(GO_SALARY)}</span>`, 'good');
        const loot = this.g.drawItemPack(p, GO_DRAW_N);
        if (loot.length) {
          this.a.log(`🎁 起点补给：${this.g.formatDrawLoot(loot)}`, 'card');
          await this.a.showHoloNotice?.({
            kind: 'notice', icon: '🎁', title: '起点补给包',
            text: this.g.formatDrawLoot(loot), auto: true, duration: 3600,
          });
        }
    }
    // 满手超限自动挂黑市
    if (p.isAI && p.pendingListings?.length) {
      const listed = this.g.resolvePendingListings(p);
      if (listed.length) {
        const txt = listed.map(l => `${ITEMS[l.item]?.icon || '🃏'}${l.item} ${formatMoney(l.price)}`).join('，');
        this.a.log(`🏴 ${this._tag(p)} 手牌已满，挂出黑市：${txt}`, 'card');
      }
    }
    this.a.update();
      await this._resolveLanding(p, total, 0);
      this.a.update();
      if (p.bankrupt || this.g.winner()) return;
      if (!doubles || p.inJail) break;
      this.a.log(`${this._tag(p)} 获得额外一次掷骰机会`, 'good');
    }
    this.a.phase('endTurn', p);
    await this._endTurnWithBank(p);
  }

  /** 回合末：自动免费补给 → 银行诱导 → waitEndTurn（可再付费抽牌） */
  async _endTurnWithBank(p) {
    if ((p.noBuildTurns || 0) > 0) p.noBuildTurns--;
    // 未用完的免费抽：回合末自动发完，保证每回合至少能摸到牌
    while (this.g.canFreeDraw(p)) {
      const r = this.g.takeDraw(p, 'free');
      if (!r?.got?.length) break;
      this.a.log(`🃏 回合补给：${this.g.formatDrawLoot(r.got)}`, 'card');
    }
    this.a.update();

    if (!p.bankrupt && this.g.bankShouldPitchPledge(p)) {
      const accept = await this.a.promptBankPledge?.(p, { shares: 5, loan: 5 * 8 * Math.max(1, p.company?.level || 1) });
      if (accept) {
        const r = this.g.pledgeSharesForLoan(p, 5);
        if (r) {
          this.a.log(`🏦 银行智能体：${this._tag(p)} 质押公司股 ${r.n} 手，获贷 <span class="gold">${formatMoney(r.loan)}</span>（质押股不分红）`, 'card');
          this.a.update();
        }
      } else if (accept === false) {
        this.a.log(`🏦 银行智能体游说失败：${this._tag(p)} 拒绝质押贷款`, 'muted');
      }
    }
    await this.a.waitEndTurn(p);
  }

  /** 适配器可调用：付费抽牌（人类按钮 / AI 策略） */
  tryPaidDraw(p) {
    const r = this.g.takeDraw(p, 'paid');
    if (!r) return null;
    this.a.log(`🃏 付费补给（${formatMoney(r.cost)}）：${this.g.formatDrawLoot(r.got)}`, 'card');
    this.a.update();
    return r;
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
      this.a.log(`${this._tag(p)} 缴纳 ${formatMoney(JAIL_FINE)} 保证金离开监管局`, 'good');
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
      this.a.log(`${this._tag(p)} 三次未成，强制缴纳 ${formatMoney(JAIL_FINE)} 离场`, 'bad');
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
      case 'parking': {
        this.a.log('在度假区充电灵感，打开补给包！');
        const loot = this.g.drawItemPack(p, PARKING_DRAW_N);
        if (loot.length) {
          this.a.log(`🎁 度假补给：${this.g.formatDrawLoot(loot)}`, 'card');
          await this.a.showHoloNotice?.({
            kind: 'notice', icon: '🏝️', title: '度假区补给',
            text: this.g.formatDrawLoot(loot), auto: true, duration: 3600,
          });
        } else {
          this.a.log('补给包已满，无事发生～');
        }
        await this.a.pause(400);
        break;
      }
      case 'jail':
        this.a.log('只是路过监管局门口。');
        await this.a.pause(400);
        break;
      case 'lottery': {
        this.a.log(`${this._tag(p)} 在彩票站点刮了一张彩票（${formatMoney(LOTTERY_COST)}）`);
        const r = this.g.forcePay(p, LOTTERY_COST, null);
        this._logForcePay(p, r);
        if (r.bankrupt) { this.a.log(`${this._tag(p)} 连彩票钱都付不起，破产！`, 'bad'); break; }
        if (this.g.rng() < LOTTERY_WIN_CHANCE) {
          p.money += LOTTERY_JACKPOT;
          this.a.log(`🎉 ${this._tag(p)} 中大奖！+${formatMoney(LOTTERY_JACKPOT)}`, 'good');
        } else {
          this.a.log('😞 谢谢参与。');
        }
        break;
      }
      case 'hospital': {
        this.a.log(`${this._tag(p)} 在综合医院做全身体检（${formatMoney(HOSPITAL_FEE)}）`);
        const r = this.g.forcePay(p, HOSPITAL_FEE, null);
        this._logForcePay(p, r);
        if (r.bankrupt) this.a.log(`${this._tag(p)} 连体检费都付不起，破产！`, 'bad');
        break;
      }
      case 'tax': {
        this.a.log(`${this._tag(p)} 缴纳${t.name} <span class="bad">${formatMoney(t.amount)}</span>`);
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
    if (r.borrowed > 0) this.a.log(`${this._tag(p)} 向银行紧急贷款 ${formatMoney(r.borrowed)}`, 'bad');
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
        this.a.log(`${this._tag(p)} 资金不足，拿不下 ${t.name}（${formatMoney(t.price)}）`, 'bad');
        return;
      }
      const buy = await this.a.promptBuy(p, i);
      if (buy) {
        this.g.buyProperty(p, i);
        this.a.log(`${this._tag(p)} 以 <span class="gold">${formatMoney(t.price)}</span> 收购 <b>${t.name}</b>！`, 'good');
        if (t.type === 'property' && t.color) {
          const boost = this.g.industryRentBoost(t.color, p.id);
          const ind = INDUSTRIES[t.color];
          if (ind && boost > 1) {
            this.a.log(`${ind.icon}${ind.name} 过路费倍率 <b>×${boost.toFixed(2)}</b>（购产热度+业主持股）`, 'card');
          }
        }
        // 买地开业礼：概率抽补给
        if (this.g.rng() < BUY_LAND_DRAW_CHANCE) {
          const loot = this.g.drawItemPack(p, 1);
          if (loot.length) this.a.log(`🎁 开业礼包：${this.g.formatDrawLoot(loot)}`, 'card');
        }
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
    let rent = this.g.calcRent(i, diceSum);
    this.a.log(`${t.name} 属于 ${this._tag(owner)}，应付租金 <span class="bad">${formatMoney(rent)}</span>`);
    if (rent > 0 && p.hedgeRent) {
      rent = Math.ceil(rent / 2);
      p.hedgeRent = false;
      this.a.log(`${this._tag(p)} 触发 ☂️对冲保单，租金减半至 ${formatMoney(rent)}`, 'good');
    }
    if (rent > 0 && (p.items.rentFree || 0) > 0) {
      const use = await this.a.promptItemUse(p, 'rentFree', { rent });
      if (use) {
        this.g.useItem(p, 'rentFree');
        this.a.log(`${this._tag(p)} 使用 🛡️免租卡，免除 ${formatMoney(rent)} 租金！`, 'good');
        return;
      }
    }
    const r = this.g.forcePay(p, rent, owner);
    this._logForcePay(p, r);
    if (r.bankrupt) {
      this.a.log(`${this._tag(p)} 全部身家 ${formatMoney(r.paid)} 赔给 ${this._tag(owner)}，破产出局！`, 'bad');
    } else {
      this.a.log(`${this._tag(p)} 支付 ${formatMoney(r.paid)} 给 ${this._tag(owner)}`);
      if (r.paid >= ttc(150)) this.a.onEvent?.(p, 'rent', { rent: r.paid });
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
      case 'news': {
        const n = this.g.applyRandomNews(a.mode);
        if (n) {
          const ind = INDUSTRIES[n.key];
          const txt = `${ind.icon}${ind.name} ${a.mode === 'up' ? '利好' : '利空'}，资讯倍率 ${n.from.toFixed(2)}→${n.to.toFixed(2)}`;
          this.a.log(`📰 市场资讯：${txt}`, 'card');
          await this.a.showHoloNotice?.({
            kind: 'notice', icon: '📰', title: '市场资讯', text: txt, auto: true, duration: 3600,
          });
        }
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
        this.a.log(`需维护 ${houses} 栋建筑、${hotels} 个地标，共 <span class="bad">${formatMoney(cost)}</span>`);
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
          if (a.collectGo && r.passedGo) this.a.log(`经过起点，融资到账 ${formatMoney(GO_SALARY)}`, 'good');
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
