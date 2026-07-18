// 经济平衡参数扫描：初始资金 × 公司营收倍率 × 贷款利率（纯逻辑，无头运行）
// 通过子类化 GameState 覆盖原型方法注入参数，不修改 src/ 下任何文件
// 运行: node test/balance.mjs [每组合局数，默认100]
import { GameState, TILES, INDUSTRIES } from '../src/core/state.js';
import { Engine } from '../src/core/engine.js';

const MAX_TURNS = 3000; // 与 engine.js 的 MAX_TURNS 保持一致（触顶判定）

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 参数注入：子类覆盖原型方法 ----------
// START_MONEY 在构造后改写玩家初始资金；
// companyRevenue 在父类结果上乘营收倍率；
// applyTurnStart 完全重写以注入贷款利率（不调 super，避免重复计息）。
class BalancedGameState extends GameState {
  constructor(configs, rng, params) {
    super(configs, rng);
    this._bal = params;
    for (const p of this.players) p.money = params.startMoney;
  }
  companyRevenue(player) {
    return Math.round(super.companyRevenue(player) * this._bal.revenueMult);
  }
  applyTurnStart(player) {
    const revenue = this.companyRevenue(player);
    if (revenue > 0) player.money += revenue;
    let interest = 0;
    if (player.debt > 0) {
      interest = Math.ceil(player.debt * this._bal.loanInterest);
      player.debt += interest;
    }
    return { revenue, interest };
  }
}

// ---------- 无头适配器（AI 行为与 test/simulate.mjs 保持一致） ----------
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
    }
  }

  waitEndTurn(p) {
    const g = this.g, rng = this.rng;
    if (p.money < 150 && g.creditLimit(p) - p.debt >= 300) g.borrow(p, 300);
    if (p.debt > 0 && p.money > 700) g.repay(p, p.debt);
    const target = p.money > 1400 ? 5 : p.money > 800 ? 3 : 2;
    for (let guard = 30; guard > 0; guard--) {
      const sets = g.buildableSets(p.id);
      if (!sets.length) break;
      const c = sets.flatMap(s => s.tiles).filter(i => g.houses[i] < target)
        .sort((a, b) => g.houses[a] - g.houses[b] || TILES[a].houseCost - TILES[b].houseCost);
      if (!c.length || !g.canBuild(p, c[0]) || p.money - TILES[c[0]].houseCost < 150) break;
      g.buyHouse(p, c[0]);
    }
    if (g.canFoundCompany(p) && p.money > 900) {
      const keys = Object.keys(INDUSTRIES).filter(k => k !== 'railroad' && k !== 'utility');
      g.foundCompany(p, keys[Math.floor(rng() * keys.length)]);
    } else if (g.canUpgradeCompany(p) && p.money > 900 && rng() < 0.5) {
      g.upgradeCompany(p);
    }
    if ((p.items.demolish || 0) > 0 && rng() < 0.4) {
      for (const other of g.players) {
        if (other.id === p.id || other.bankrupt) continue;
        const t = g.playerProperties(other.id).find(i => g.houses[i] > 0);
        if (t != null) { g.useItem(p, 'demolish'); g.houses[t]--; break; }
      }
    }
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

// ---------- 参数网格 ----------
const GRID = {
  startMoney: [1200, 1500, 1800],
  revenueMult: [0.7, 1.0, 1.3],
  loanInterest: [0.04, 0.05, 0.07],
};
const GAMES = Number(process.argv[2] || 100); // 每组合局数
const N_PLAYERS = 4;

// CJK 感知的对齐
function pad(s, w) {
  s = String(s);
  let len = 0;
  for (const ch of s) len += ch.codePointAt(0) > 0xFF ? 2 : 1;
  return s + ' '.repeat(Math.max(0, w - len));
}

async function runCombo(params, games) {
  let totalTurns = 0, capped = 0, totalBankrupts = 0, totalTopWorth = 0, finished = 0;
  const errors = [];
  for (let s = 0; s < games; s++) {
    // 所有组合使用同一套种子序列，保证横向可比、结果可复现
    const rng = mulberry32((s + 1) * 7919);
    const configs = Array.from({ length: N_PLAYERS }, (_, i) => ({ name: `P${i}`, isAI: true }));
    const game = new BalancedGameState(configs, rng, params);
    const adapter = new HeadlessAdapter(game, rng);
    const engine = new Engine(game, adapter);
    try {
      const winner = await engine.run();
      if (!winner) { errors.push(`seed ${s}: no winner`); continue; }
      finished++;
      totalTurns += game.turn;
      if (game.turn >= MAX_TURNS) capped++;
      totalBankrupts += game.players.filter(p => p.bankrupt).length;
      totalTopWorth += Math.max(...game.players.map(p => game.netWorth(p)));
      if (adapter.errors.length) errors.push(`seed ${s}: ${adapter.errors[0]}`);
    } catch (e) {
      errors.push(`seed ${s}: EXCEPTION ${e.message}`);
    }
  }
  return {
    avgTurns: totalTurns / finished,
    capRate: capped / finished,
    avgBankrupts: totalBankrupts / finished,
    avgTopWorth: totalTopWorth / finished,
    errors,
  };
}

console.log(`经济平衡参数扫描：${GRID.startMoney.length * GRID.revenueMult.length * GRID.loanInterest.length} 组合 × ${GAMES} 局（${N_PLAYERS} 名 AI，种子可复现）`);
const t0 = performance.now();

const rows = [];
const allErrors = [];
for (const startMoney of GRID.startMoney) {
  for (const revenueMult of GRID.revenueMult) {
    for (const loanInterest of GRID.loanInterest) {
      const params = { startMoney, revenueMult, loanInterest };
      const r = await runCombo(params, GAMES);
      allErrors.push(...r.errors.map(e => `[${startMoney}/${revenueMult}/${loanInterest}] ${e}`));
      // 节奏达标：平均回合 600~1200、触顶率 <15%、平均破产 ≥1.5
      const good = r.avgTurns >= 600 && r.avgTurns <= 1200 && r.capRate < 0.15 && r.avgBankrupts >= 1.5;
      rows.push({ startMoney, revenueMult, loanInterest, ...r, good });
      console.log(`  完成 初始资金=${startMoney} 营收×${revenueMult} 利率=${loanInterest} → 平均回合 ${r.avgTurns.toFixed(0)}`);
    }
  }
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

console.log('\n================ 扫描结果（每组合 ' + GAMES + ' 局） ================');
const header = ['初始资金', '营收倍率', '贷款利率', '平均回合', '触顶率', '平均破产', '最富身价', '评级'];
const widths = [10, 10, 10, 10, 10, 10, 12, 6];
console.log(header.map((h, i) => pad(h, widths[i])).join(''));
console.log(widths.map(w => '-'.repeat(w)).join(''));
for (const r of rows) {
  const cells = [
    `¥${r.startMoney}`,
    `×${r.revenueMult.toFixed(1)}`,
    `${(r.loanInterest * 100).toFixed(0)}%`,
    r.avgTurns.toFixed(0),
    `${(r.capRate * 100).toFixed(0)}%`,
    r.avgBankrupts.toFixed(2),
    `¥${Math.round(r.avgTopWorth)}`,
    r.good ? '✓ 佳' : '',
  ];
  console.log(cells.map((c, i) => pad(c, widths[i])).join(''));
}
console.log(`\n总耗时: ${elapsed}s`);
if (allErrors.length) {
  console.error(`\n发现 ${allErrors.length} 个问题（前 10 条）:`);
  allErrors.slice(0, 10).forEach(e => console.error('  ' + e));
  process.exit(1);
}
