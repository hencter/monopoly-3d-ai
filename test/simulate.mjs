// 无头仿真：不依赖浏览器，快速跑数百局完整游戏验证规则引擎（现代商业版）
// 覆盖：行业景气、银行贷款/抵押、公司、道具、交易
// 运行: npm run sim
import { GameState, TILES, INDUSTRIES } from '../src/core/state.js';
import { Engine } from '../src/core/engine.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class HeadlessAdapter {
  constructor(game, rng) {
    this.g = game;
    this.rng = rng;
    this.errors = [];
  }
  log() {}
  phase() {}
  onEvent() {}
  pause() { return Promise.resolve(); }
  animateDice() { return Promise.resolve(); }
  animateMove() { return Promise.resolve(); }
  animateTeleport() { return Promise.resolve(); }
  showCard() { return Promise.resolve(); }
  gameOver() { return Promise.resolve(); }

  waitRoll(p) {
    // 20% 使用遥控骰子（若持有）
    if ((p.items.remote || 0) > 0 && this.rng() < 0.2) {
      return Promise.resolve({ type: 'remote', total: 1 + Math.floor(this.rng() * 6) });
    }
    return Promise.resolve({ type: 'roll', boost: (p.items.boost || 0) > 0 && this.rng() < 0.3 });
  }

  promptItemUse(p, item, ctx) { return Promise.resolve(ctx.rent >= 100 && this.rng() < 0.6); }

  update() {
    for (const p of this.g.players) {
      if (!Number.isFinite(p.money)) this.errors.push(`money NaN: ${p.name}`);
      if (p.money < 0) this.errors.push(`negative money: ${p.name} ${p.money}`);
      if (p.debt < 0) this.errors.push(`negative debt: ${p.name}`);
      if (p.position < 0 || p.position > 39) this.errors.push(`bad position: ${p.position}`);
      if ((p.skipTurns || 0) < 0 || (p.skipTurns || 0) > 5) this.errors.push(`bad skipTurns: ${p.name} ${p.skipTurns}`);
      for (const [k, v] of Object.entries(p.items)) if (v < 0) this.errors.push(`negative item ${k}: ${p.name}`);
      if (p.company && !INDUSTRIES[p.company.industry]) this.errors.push(`bad company industry: ${p.name}`);
    }
    for (let i = 0; i < 40; i++) {
      if (this.g.houses[i] < 0 || this.g.houses[i] > 5) this.errors.push(`bad houses at ${i}`);
      const o = this.g.owner[i];
      if (o >= 0 && this.g.players[o].bankrupt) this.errors.push(`bankrupt owner at ${i}`);
      if (this.g.isMortgaged(i) && this.g.houses[i] > 0) this.errors.push(`mortgaged with houses at ${i}`);
    }
    for (const [k, v] of Object.entries(this.g.industry)) {
      if (v < 0 || v > 3) this.errors.push(`bad industry state ${k}=${v}`);
    }
  }

  waitEndTurn(p) {
    const g = this.g, rng = this.rng;
    // 银行：缺钱借贷 / 富裕还贷
    if (p.money < 150 && g.creditLimit(p) - p.debt >= 300) g.borrow(p, 300);
    if (p.debt > 0 && p.money > 700) g.repay(p, p.debt);
    // 建房
    const target = p.money > 1400 ? 5 : p.money > 800 ? 3 : 2;
    for (let guard = 30; guard > 0; guard--) {
      const sets = g.buildableSets(p.id);
      if (!sets.length) break;
      const c = sets.flatMap(s => s.tiles).filter(i => g.houses[i] < target)
        .sort((a, b) => g.houses[a] - g.houses[b] || TILES[a].houseCost - TILES[b].houseCost);
      if (!c.length || !g.canBuild(p, c[0]) || p.money - TILES[c[0]].houseCost < 150) break;
      g.buyHouse(p, c[0]);
    }
    // 公司
    if (g.canFoundCompany(p) && p.money > 900) {
      const keys = Object.keys(INDUSTRIES).filter(k => k !== 'railroad' && k !== 'utility');
      g.foundCompany(p, keys[Math.floor(rng() * keys.length)]);
    } else if (g.canUpgradeCompany(p) && p.money > 900 && rng() < 0.5) {
      g.upgradeCompany(p);
    }
    // 主动卡牌（随机演练每种卡）
    const opponents = g.players.filter(o => o.id !== p.id && !o.bankrupt);
    if (opponents.length) {
      if ((p.items.demolish || 0) > 0 && rng() < 0.4) {
        for (const other of opponents) {
          const t = g.playerProperties(other.id).find(i => g.houses[i] > 0);
          if (t != null) { g.useItem(p, 'demolish'); g.houses[t]--; break; }
        }
      }
      if ((p.items.equalize || 0) > 0 && rng() < 0.3) { g.useItem(p, 'equalize'); g.playEqualize(); }
      if ((p.items.rob || 0) > 0 && rng() < 0.3) {
        g.useItem(p, 'rob');
        g.playRob(p, opponents[Math.floor(rng() * opponents.length)]);
      }
      if ((p.items.hibernate || 0) > 0 && rng() < 0.3) {
        g.useItem(p, 'hibernate');
        g.playHibernate(opponents[Math.floor(rng() * opponents.length)]);
      }
      if ((p.items.swap || 0) > 0 && rng() < 0.3) {
        const o = opponents[Math.floor(rng() * opponents.length)];
        const mine = g.playerProperties(p.id).find(i => g.canSwapTile(p, i));
        const theirs = g.playerProperties(o.id).find(i => g.canSwapTile(o, i));
        if (mine != null && theirs != null) { g.useItem(p, 'swap'); g.playSwap(p, o, mine, theirs); }
      }
    }
    // 偶发 AI 间交易（合法才执行）
    if (rng() < 0.05) {
      for (const other of g.players) {
        if (other.id === p.id || other.bankrupt) continue;
        const t = g.playerProperties(other.id).find(i => g.houses[i] === 0 && !g.isMortgaged(i));
        if (t != null) {
          const price = Math.round(TILES[t].price * 1.2);
          if (g.canTrade(p, other, t, price)) g.executeTrade(p, other, t, price);
          break;
        }
      }
    }
    return Promise.resolve();
  }

  promptBuy(p, i) {
    return Promise.resolve(this.rng() < 0.75 && p.money - TILES[i].price >= 50);
  }

  promptJail(p, opts) {
    if (opts.hasCard && this.rng() < 0.8) return Promise.resolve('card');
    if (opts.canPay && p.money > 250) return Promise.resolve('pay');
    return Promise.resolve('roll');
  }
}

const N = Number(process.argv[2] || 300);
let finished = 0, byCap = 0, totalTurns = 0;
const wins = new Array(35).fill(0);
const seatCount = new Array(35).fill(0);
const errors = [];

for (let s = 1; s <= N; s++) {
  const rng = mulberry32(s * 7919);
  // 70% 常规 2~6 人；30% 大人数 12/16/24/34 人
  const nPlayers = rng() < 0.7
    ? 2 + Math.floor(rng() * 5)
    : [12, 16, 24, 34][Math.floor(rng() * 4)];
  const configs = Array.from({ length: nPlayers }, (_, i) => ({ name: `P${i}`, isAI: true }));
  const game = new GameState(configs, rng);
  const adapter = new HeadlessAdapter(game, rng);
  const engine = new Engine(game, adapter);
  try {
    const winner = await engine.run();
    if (!winner) { errors.push(`seed ${s}: no winner`); continue; }
    finished++;
    wins[winner.id]++;
    seatCount[nPlayers]++;
    totalTurns += game.turn;
    if (game.turn >= 12000) byCap++;
    if (winner.bankrupt) errors.push(`seed ${s}: winner bankrupt`);
    errors.push(...adapter.errors.slice(0, 3).map(e => `seed ${s}: ${e}`));
  } catch (e) {
    errors.push(`seed ${s}: EXCEPTION ${e.stack}`);
  }
}

console.log(`完成 ${finished}/${N} 局`);
console.log(`平均回合数: ${(totalTurns / finished).toFixed(1)}，触顶结束: ${byCap}`);
console.log(`胜率分布(按座位): ${wins.filter(w => w > 0).map((w, i) => `P${i}:${w}`).join('  ')}`);
console.log(`人数分布: ${seatCount.map((c, n) => (n >= 2 && c > 0) ? `${n}人:${c}` : null).filter(Boolean).join(' ')}`);
if (errors.length) {
  console.error(`\n发现 ${errors.length} 个问题（前 10 条）:`);
  errors.slice(0, 10).forEach(e => console.error('  ' + e));
  process.exit(1);
} else {
  console.log('✅ 所有不变量检查通过，无异常');
}
