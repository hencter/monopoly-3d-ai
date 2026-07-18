// 入口：组装 3D 世界、UI、DeepSeek AI 与游戏引擎；提供浏览器版表现层适配器（含 AI 策略）
import { World, PLAYER_COLORS, PLAYER_COLORS_CSS } from './three/world.js';
import { UI } from './ui/ui.js';
import { GameState, TILES, INDUSTRIES } from './core/state.js';
import { Engine } from './core/engine.js';
import { DeepSeekClient } from './llm/deepseek.js';
import { AIBrain, PERSONAS } from './llm/ai.js';
import { soundManager } from './audio.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const ownable = (t) => ['property', 'railroad', 'utility'].includes(t.type);
const SAVE_KEY = 'df_save_v1';

class BrowserAdapter {
  constructor(world, ui, game, brain) {
    this.world = world;
    this.ui = ui;
    this.g = game;
    this.brain = brain;
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
    for (const p of this.g.players) {
      const cs = p.company ? `${p.company.industry}:${p.company.level}` : '';
      if (this._csig.get(p.id) !== cs) { this.world.setCompany(p.id, p.company, p.name); this._csig.set(p.id, cs); }
      const prev = this._snap.get(p.id) || { bankrupt: false, inJail: false };
      if (!prev.bankrupt && p.bankrupt) {
        this.world.removeToken(p.id);
        this.world.setCompany(p.id, null, p.name);
        this._say(p, 'bankrupt');
      } else if (!prev.inJail && p.inJail && !p.bankrupt) {
        this._say(p, 'jail');
      }
      this._snap.set(p.id, { bankrupt: p.bankrupt, inJail: p.inJail });
    }
    const isig = JSON.stringify(this.g.industry);
    if (this._isig && this._isig !== isig) soundManager.play('news');
    this._isig = isig;
    this.ui.renderPlayers(this.g, this.activeId);
    this.ui.renderIndustries(this.g);
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
    if (name === 'turnStart') {
      this._jailRoll = false;
      // 回合开始存档点（刷新/关页面后可续玩）
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, at: Date.now(), nextPlayer: p.id, state: this.g.serialize() }));
      } catch {}
      this.activeId = p.id;
      this.world.setFollow(p.id);
      this.ui.setTurnInfo(`🎯 ${p.name} 的回合`);
      this.ui.setButtons({});
      this.ui.el.itemBar.innerHTML = '';
      this._panelTarget = null;
      this.update();
      this.ui.toast(`轮到 ${p.name}`);
    }
  }

  async animateDice(d1, d2) { await this.world.animateDice(d1, d2); }
  async animateMove(p, from, steps) { await this.world.moveToken(p.id, from, steps); }
  async animateTeleport(p, from, to) { await this.world.teleportToken(p.id, from, to); }

  // ---------- 掷骰 ----------
  async waitRoll(p) {
    if (p.isAI) {
      this.ui.setTurnInfo(`🤖 ${p.name} 思考中…`);
      await delay(750);
      // 遥控骰子：评估 1~6 步落点价值
      if ((p.items.remote || 0) > 0) {
        let bestK = -1, bestScore = 1.9;
        for (let k = 1; k <= 6; k++) {
          const s = this._scoreLanding(p, (p.position + k) % 40);
          if (s > bestScore) { bestScore = s; bestK = k; }
        }
        if (bestK > 0) return { type: 'remote', total: bestK };
      }
      const boost = (p.items.boost || 0) > 0 && this.g.rng() < 0.3;
      return { type: 'roll', boost };
    }
    if (this._jailRoll) { // 监禁掷骰：无道具栏
      this.ui.setTurnInfo(`${p.name}：掷双数脱困`);
      this.ui.setButtons({ roll: true });
      await this.ui.waitButton('roll');
      this.ui.setButtons({});
      return { type: 'roll' };
    }
    this.ui.setTurnInfo(`${p.name}：请掷骰子`);
    this.ui.setButtons({ roll: true, build: true, bank: true, trade: true, company: true });
    this._panelTarget = p;
    const action = await this.ui.waitRollAction(p, { onUseCard: (item) => this.useCard(p, item) });
    this.ui.setButtons({});
    return action;
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
      this._aiBank(p);
      this._aiBuild(p);
      this._aiPlayCards(p);
      this.update();
      await this._aiTryTrade(p);
      await delay(500);
      return;
    }
    this.ui.setTurnInfo(`${p.name}：可建设/用卡/交易，或结束回合`);
    this.ui.setButtons({ end: true, build: true, bank: true, trade: true, company: true });
    this._panelTarget = p;
    this.ui.renderCardBar(p, (item) => this.useCard(p, item));
    await this.ui.waitButton('end');
    this.ui.renderCardBar(null);
    this.ui.setButtons({});
    this._panelTarget = null;
  }

  // ---------- 面板入口（人类） ----------
  openPanel(kind) {
    const p = this._panelTarget;
    if (!p || p.isAI || this.ui.modalOpen) return;
    if (kind === 'build') this.ui.openBuild(this.g, p, () => this.update());
    if (kind === 'bank') this.ui.openBank(this.g, p, () => this.update());
    if (kind === 'company') this.ui.openCompany(this.g, p, () => this.update());
    if (kind === 'trade') this.ui.openTrade(this.g, p, (offer) => this.proposeTrade(offer));
  }

  /** 人类玩家打出主动卡（含目标选择流程），返回 Promise（完成后刷新牌角标） */
  async useCard(p, item) {
    if (this.ui.modalOpen || (p.items[item] || 0) <= 0) return;
    const opponents = this.g.players.filter(o => o.id !== p.id && !o.bankrupt);
    switch (item) {
      case 'demolish':
        this.ui.openDemolish(this.g, p, (tileIdx) => {
          if (!this.g.useItem(p, 'demolish')) return;
          this.g.houses[tileIdx]--;
          const owner = this.g.players[this.g.owner[tileIdx]];
          this.log(`${p.name} 打出 💥拆迁卡，${owner?.name} 的 ${TILES[tileIdx].name} 被拆了一级！`, 'bad');
          soundManager.play('pay');
          this.update();
        });
        break;
      case 'equalize':
        if (!this.g.useItem(p, 'equalize')) return;
        {
          const avg = this.g.playEqualize();
          this.log(`💳 ${p.name} 打出均富卡，所有人现金变为 <span class="gold">¥${avg}</span>`, 'card');
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
        this.log(`🥷 ${p.name} 抢夺 ${t.name} <span class="gold">¥${amt}</span>！`, 'bad');
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
        this.log(`😴 ${p.name} 让 ${t.name} 进入冬眠，跳过其下一回合`, 'card');
        soundManager.play('jail');
        this.update();
        break;
      }
      case 'swap':
        this.ui.openSwap(this.g, p, ({ targetId, myTile, theirTile }) => {
          if (!this.g.useItem(p, 'swap')) return;
          const t = this.g.players[targetId];
          if (this.g.playSwap(p, t, myTile, theirTile)) {
            this.log(`🔀 ${p.name} 用 ${TILES[myTile].name} 换了 ${t.name} 的 ${TILES[theirTile].name}`, 'good');
            soundManager.play('trade');
            this.update();
          }
        });
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
      this.log(`🤝 成交！${buyer.name} 以 <span class="gold">¥${finalPrice}</span> 购得 ${seller.name} 的 <b>${TILES[tileIdx].name}</b>`, 'good');
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
        if (p.money < offer + 120) continue;
        this._tradeOffers.add(key);
        this.log(`${p.name} 想收购 ${human.name} 的 ${t.name}…`);
        this._say(p, 'chatGeneric');
        const c = await this.ui.promptIncomingTrade({ buyerName: p.name, sellerName: human.name, tileIdx: i, price: offer, responder: 'seller' });
        if (c === 'accept' && this.g.canTrade(p, human, i, offer)) {
          this.g.executeTrade(p, human, i, offer);
          this.log(`🤝 ${human.name} 同意出售，${p.name} 以 ¥${offer} 拿下 ${t.name}！`, 'good');
        } else {
          this.log(`${human.name} 拒绝了 ${p.name} 的收购要约`);
        }
        this.update();
        return;
      }
    }
  }

  // ---------- AI 策略 ----------
  _aiBuild(p) {
    const target = p.money > 1400 ? 5 : p.money > 800 ? 3 : 2;
    for (let guard = 30; guard > 0; guard--) {
      const sets = this.g.buildableSets(p.id);
      if (!sets.length) break;
      const c = sets.flatMap(s => s.tiles)
        .filter(i => this.g.houses[i] < target)
        .sort((a, b) => this.g.houses[a] - this.g.houses[b] || TILES[a].houseCost - TILES[b].houseCost);
      if (!c.length || !this.g.canBuild(p, c[0]) || p.money - TILES[c[0]].houseCost < 150) break;
      this.g.buyHouse(p, c[0]);
      this.log(`${p.name} 在 ${TILES[c[0]].name} 起了一级楼`, 'good');
    }
    // 创办/升级公司
    if (this.g.canFoundCompany(p) && p.money > 900) {
      const keys = Object.keys(INDUSTRIES).filter(k => k !== 'railroad' && k !== 'utility');
      const fav = this.brain.personaOf(p).favIndustry?.find(k => keys.includes(k));
      const ind = fav || keys[Math.floor(this.g.rng() * keys.length)];
      this.g.foundCompany(p, ind);
      this.log(`${p.name} 创办了 ${INDUSTRIES[ind].icon}${INDUSTRIES[ind].name} 公司！`, 'good');
    } else if (this.g.canUpgradeCompany(p) && p.money > 900 && this.g.rng() < 0.6) {
      this.g.upgradeCompany(p);
      this.log(`${p.name} 的公司升到 Lv${p.company.level}`, 'good');
    }
  }

  _aiBank(p) {
    if (p.money < 160 && this.g.creditLimit(p) - p.debt >= 300) {
      this.g.borrow(p, 300);
      this.log(`${p.name} 向银行贷款 ¥300`, 'card');
    }
    if (p.debt > 0 && p.money > 800) {
      const r = this.g.repay(p, p.debt);
      if (r > 0) this.log(`${p.name} 偿还贷款 ¥${r}`);
    }
  }

  /** AI 回合末策略性用卡（每回合最多一张） */
  _aiPlayCards(p) {
    const g = this.g;
    const opponents = g.players.filter(o => o.id !== p.id && !o.bankrupt);
    if (!opponents.length) return;
    const richest = [...opponents].sort((a, b) => b.money - a.money)[0];
    const leader = [...opponents].sort((a, b) => g.netWorth(b) - g.netWorth(a))[0];
    // 均富卡：现金明显低于全场均值
    const avg = g.alivePlayers().reduce((s, x) => s + x.money, 0) / g.alivePlayers().length;
    if ((p.items.equalize || 0) > 0 && p.money < avg - 120) {
      g.useItem(p, 'equalize');
      const v = g.playEqualize();
      this.log(`💳 ${p.name} 打出均富卡，全场现金变为 ¥${v}`, 'card');
      return;
    }
    // 抢夺卡：偷最富的
    if ((p.items.rob || 0) > 0 && richest.money >= 200 && g.rng() < 0.7) {
      g.useItem(p, 'rob');
      const amt = g.playRob(p, richest);
      this.log(`🥷 ${p.name} 抢夺 ${richest.name} ¥${amt}！`, 'bad');
      return;
    }
    // 冬眠卡：压制领先者
    if ((p.items.hibernate || 0) > 0 && g.netWorth(leader) > g.netWorth(p) + 300 && g.rng() < 0.6) {
      g.useItem(p, 'hibernate');
      g.playHibernate(leader);
      this.log(`😴 ${p.name} 让 ${leader.name} 进入冬眠`, 'card');
      return;
    }
    // 换地卡：换来能完成垄断的地
    if ((p.items.swap || 0) > 0) {
      for (const o of opponents) {
        for (const i of g.playerProperties(o.id)) {
          const t = TILES[i];
          if (t.type !== 'property' || !g.canSwapTile(o, i)) continue;
          const completes = g.groupTiles(t.color).every(j => j === i || g.owner[j] === p.id);
          if (!completes) continue;
          const mine = g.playerProperties(p.id).filter(j => g.canSwapTile(p, j)).sort((a, b) => TILES[a].price - TILES[b].price)[0];
          if (mine != null) {
            g.useItem(p, 'swap');
            if (g.playSwap(p, o, mine, i)) {
              this.log(`🔀 ${p.name} 用 ${TILES[mine].name} 换了 ${o.name} 的 ${t.name}`, 'good');
            }
            return;
          }
        }
      }
    }
    this._aiDemolish(p);
  }

  _aiDemolish(p) {
    if ((p.items.demolish || 0) <= 0 || this.g.rng() > 0.5) return;
    let best = -1, bestRent = 0;
    for (const other of this.g.players) {
      if (other.id === p.id || other.bankrupt) continue;
      for (const i of this.g.playerProperties(other.id)) {
        if (this.g.houses[i] > 0) {
          const r = this.g.calcRent(i);
          if (r > bestRent) { bestRent = r; best = i; }
        }
      }
    }
    if (best >= 0 && bestRent > 100) {
      this.g.useItem(p, 'demolish');
      this.g.houses[best]--;
      const owner = this.g.players[this.g.owner[best]];
      this.log(`${p.name} 发动 💥拆迁卡，${owner.name} 的 ${TILES[best].name} 被拆了一级！`, 'bad');
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
      await delay(600);
      if (opts.hasCard) return 'card';
      if (opts.canPay && p.money >= 300) return 'pay';
      return 'roll';
    })();
  }

  promptItemUse(p, item, ctx) {
    if (!p.isAI) return this.ui.promptItemUse(p, item, ctx);
    return Promise.resolve(ctx.rent >= 80);
  }

  showCard(p, card, deck) {
    soundManager.play('card');
    return this.ui.showCard(card, deck, p.isAI);
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
const world = new World(canvas);
world.start();
const ui = new UI();
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
  if (!game) {
    const configs = setup.configs;
    const personas = [...PERSONAS].sort(() => Math.random() - 0.5);
    let pi = 0;
    for (const c of configs) if (c.isAI) c.persona = personas[pi++ % personas.length].id;
    game = new GameState(configs);
  }
  startLocalGame(game, resumeFrom);
}

/** 单机游戏装配（新局 / 存档续玩 共用） */
function startLocalGame(game, resumeFrom) {
  world.setPlayerCount(game.players.length);
  for (const p of game.players) if (!p.bankrupt) world.createToken(p.id);
  ui.enterGame();

  const brain = new AIBrain(client, game);
  const adapter = new BrowserAdapter(world, ui, game, brain);
  adapter.update();

  world.onPick((tileIdx, x, y) => ui.showTileInfo(tileIdx, game, x, y));

  document.getElementById('btn-build').onclick = () => adapter.openPanel('build');
  document.getElementById('btn-bank').onclick = () => adapter.openPanel('bank');
  document.getElementById('btn-trade').onclick = () => adapter.openPanel('trade');
  document.getElementById('btn-company').onclick = () => adapter.openPanel('company');
  document.getElementById('btn-camera').onclick = () => {
    world.followEnabled = !world.followEnabled;
    if (world.followEnabled) world.refocus();
    ui.setCameraLabel(world.followEnabled);
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
      world.followEnabled = true;
      world.refocus();
      ui.setCameraLabel(true);
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
