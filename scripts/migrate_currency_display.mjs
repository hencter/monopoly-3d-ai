import fs from 'fs';

const files = [
  'src/core/engine.js',
  'src/main.js',
  'src/ui/ui.js',
  'src/ui/stockMarket.js',
  'src/net/online.js',
  'src/three/world.js',
  'src/llm/ai.js',
  'server/server.mjs',
];

function transform(src) {
  // ¥${expr} / +¥${expr}
  src = src.replace(/\+¥\$\{([^}]+)\}/g, '+${formatMoney($1)}');
  src = src.replace(/¥\$\{([^}]+)\}/g, '${formatMoney($1)}');
  // bare fixed amounts in templates that survived
  src = src.replace(/¥200/g, '${formatMoney(GO_SALARY)}');
  src = src.replace(/¥300/g, '${formatMoney(ttc(300))}');
  src = src.replace(/formatMoney\(formatMoney\(([^)]+)\)\)/g, 'formatMoney($1)');
  return src;
}

function patchImport(src, file) {
  if (!src.includes('formatMoney') && !src.includes('ttc')) return src;
  if (/import\s*\{[^}]*\bformatMoney\b/.test(src)) return src;

  if (file.endsWith('engine.js')) {
    return src.replace(
      /import \{([^}]+)\} from '\.\/state\.js';/,
      (m, inner) => `import {${inner}, formatMoney, GO_SALARY } from './state.js';`
    );
  }
  if (file.endsWith('main.js')) {
    return src.replace(
      /import \{([^}]+)\} from '\.\/core\/state\.js';/,
      (m, inner) => `import {${inner}, formatMoney, ttc, MONEY_SCALE, GO_SALARY } from './core/state.js';`
    );
  }
  if (file.endsWith('ui.js')) {
    return src.replace(
      /import \{\n  TILES, INDUSTRIES, INDUSTRY_STATES, ITEMS, PLAYABLE_ITEMS, JAIL_FINE,\n  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,\n  STOCK_INDUSTRIES, MAX_SHARES_PER_IND, COMPANY_IPO_MIN_LEVEL, SHARE_PLEDGE_LOAN,\n\} from '\.\.\/data\/tiles\.js';/,
      `import {
  TILES, INDUSTRIES, INDUSTRY_STATES, ITEMS, PLAYABLE_ITEMS, JAIL_FINE,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
  STOCK_INDUSTRIES, MAX_SHARES_PER_IND, COMPANY_IPO_MIN_LEVEL, SHARE_PLEDGE_LOAN,
  formatMoney, ttc, CURRENCY_SYMBOL, CURRENCY_NAME,
} from '../data/tiles.js';`
    );
  }
  if (file.endsWith('stockMarket.js')) {
    return src.replace(
      /import \{ INDUSTRIES, INDUSTRY_STATES, STOCK_INDUSTRIES, MAX_SHARES_PER_IND \} from '\.\.\/data\/tiles\.js';/,
      `import { INDUSTRIES, INDUSTRY_STATES, STOCK_INDUSTRIES, MAX_SHARES_PER_IND, formatMoney } from '../data/tiles.js';`
    );
  }
  if (file.endsWith('online.js')) {
    return src.replace(
      /import \{\n  GameState, TILES, INDUSTRIES, INDUSTRY_STATES, STOCK_INDUSTRIES,\n  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,\n\} from '\.\.\/core\/state\.js';/,
      `import {
  GameState, TILES, INDUSTRIES, INDUSTRY_STATES, STOCK_INDUSTRIES,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
  formatMoney, ttc, GO_SALARY,
} from '../core/state.js';`
    );
  }
  if (file.endsWith('world.js')) {
    // add after tiles import
    if (src.includes("from '../data/tiles.js'")) {
      return src.replace(
        /import \{ TILES, INDUSTRIES \} from '\.\.\/data\/tiles\.js';/,
        `import { TILES, INDUSTRIES, formatMoney } from '../data/tiles.js';`
      );
    }
  }
  if (file.endsWith('ai.js')) {
    return src.replace(
      /^/,
      `import { formatMoney } from '../data/currency.js';\n`
    );
  }
  if (file.endsWith('server.mjs')) {
    return src.replace(
      /import \{ GameState, TILES, INDUSTRIES \} from '\.\.\/src\/core\/state\.js';/,
      `import { GameState, TILES, INDUSTRIES, formatMoney, ttc, GO_SALARY, MONEY_SCALE } from '../src/core/state.js';`
    );
  }
  return src;
}

// Scale hardcoded AI money thresholds (classic units → 通天币)
function scaleThresholds(src, file) {
  if (!file.includes('main.js') && !file.includes('server.mjs')) return src;
  // Only scale comparison literals carefully using ttc(...)
  const pairs = [
    [/p\.money < 250/g, 'p.money < ttc(250)'],
    [/p\.money < 900/g, 'p.money < ttc(900)'],
    [/p\.money < 500/g, 'p.money < ttc(500)'],
    [/p\.money < 400/g, 'p.money < ttc(400)'],
    [/p\.money < 200/g, 'p.money < ttc(200)'],
    [/p\.money >= 280/g, 'p.money >= ttc(280)'],
    [/p\.money > 600/g, 'p.money > ttc(600)'],
    [/p\.money < 450/g, 'p.money < ttc(450)'],
    [/p\.money - g\.stockPrice\(k\) < 250/g, 'p.money - g.stockPrice(k) < ttc(250)'],
    [/p\.money > 1400/g, 'p.money > ttc(1400)'],
    [/p\.money > 800/g, 'p.money > ttc(800)'],
    [/p\.money - TILES\[c\[0\]\]\.houseCost < 150/g, 'p.money - TILES[c[0]].houseCost < ttc(150)'],
    [/p\.money > 900/g, 'p.money > ttc(900)'],
    [/p\.money < 160/g, 'p.money < ttc(160)'],
    [/\.borrow\(p, 300\)/g, '.borrow(p, ttc(300))'],
    [/贷款 ¥300|贷款 \$\{formatMoney\(300\)\}/g, '贷款 ${formatMoney(ttc(300))}'],
    [/avg - 120/g, 'avg - ttc(120)'],
    [/richest\.money >= 200/g, 'richest.money >= ttc(200)'],
    [/p\.money >= 300/g, 'p.money >= ttc(300)'],
    [/offer \+ 120/g, 'offer + ttc(120)'],
    [/bestRent > 100/g, 'bestRent > ttc(100)'],
    [/ctx\.rent >= 80/g, 'ctx.rent >= ttc(80)'],
    [/creditLimit\(p\) - p\.debt >= 300/g, 'creditLimit(p) - p.debt >= ttc(300)'],
  ];
  for (const [re, rep] of pairs) src = src.replace(re, rep);

  // server.mjs similar
  src = src.replace(/p\.money < 160/g, 'p.money < ttc(160)');
  src = src.replace(/p\.money > 800/g, 'p.money > ttc(800)');
  src = src.replace(/p\.money > 1400/g, 'p.money > ttc(1400)');
  src = src.replace(/p\.money > 900/g, 'p.money > ttc(900)');
  src = src.replace(/p\.money < 900/g, 'p.money < ttc(900)');
  src = src.replace(/p\.money > 500/g, 'p.money > ttc(500)');
  src = src.replace(/p\.money < 200/g, 'p.money < ttc(200)');
  src = src.replace(/p\.money >= 280/g, 'p.money >= ttc(280)');
  src = src.replace(/p\.money > 600/g, 'p.money > ttc(600)');
  src = src.replace(/p\.money < 450/g, 'p.money < ttc(450)');
  src = src.replace(/g\.borrow\(p, 300\)/g, 'g.borrow(p, ttc(300))');
  src = src.replace(/houseCost < 150/g, 'houseCost < ttc(150)');
  src = src.replace(/bestRent > 100/g, 'bestRent > ttc(100)');
  src = src.replace(/p\.money < 250/g, 'p.money < ttc(250)');
  return src;
}

for (const f of files) {
  if (!fs.existsSync(f)) { console.log('skip', f); continue; }
  let src = fs.readFileSync(f, 'utf8');
  const b = (src.match(/¥/g) || []).length;
  src = transform(src);
  src = patchImport(src, f);
  src = scaleThresholds(src, f);
  const a = (src.match(/¥/g) || []).length;
  fs.writeFileSync(f, src);
  console.log(f, b, '->', a);
}
