// 存档/续玩验证：打几回合 → 刷新页面 → 继续对局 → 状态应一致
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ server: { port: 5193 }, logLevel: 'silent' });
await vite.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

async function pump(sec, maxTurns = 99) {
  const t0 = Date.now();
  let turns = 0;
  while (Date.now() - t0 < sec * 1000 && turns < maxTurns) {
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({
      modal: !document.getElementById('modal').classList.contains('hidden'),
      roll: !document.getElementById('btn-roll').disabled,
      end: !document.getElementById('btn-end').disabled,
    }));
    if (st.modal) {
      const c = await page.$('#modal-box [data-choice]') || await page.$('#modal-box [data-close]');
      if (c) { await c.click().catch(() => {}); continue; }
    }
    if (st.roll) { await page.click('#btn-roll').catch(() => {}); await page.waitForTimeout(1500); continue; }
    if (st.end) { await page.click('#btn-end').catch(() => {}); turns++; }
  }
  return turns;
}

await page.goto('http://localhost:5193/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('df_save_v1'));
await page.reload({ waitUntil: 'networkidle' });

// 开始 → 打 2 个完整人类回合（中间 AI 回合自动跑）
await page.click('#btn-start');
await page.waitForTimeout(1000);
await pump(40, 2);

// 读取存档
const save = await page.evaluate(() => JSON.parse(localStorage.getItem('df_save_v1') || 'null'));
if (!save) throw new Error('未生成存档');
console.log(`存档检查点: 第 ${save.state.turn} 回合, 下一位: 玩家${save.nextPlayer + 1}`);
const expectMoney = save.state.players.map(p => p.money);
const expectPos = save.state.players.map(p => p.position);

// 刷新页面 → 继续对局
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const hasContinue = await page.evaluate(() => !!document.querySelector('#btn-continue'));
console.log('继续按钮存在:', hasContinue);
await page.screenshot({ path: 'test/shot-save-start.png' });
if (!hasContinue) throw new Error('开始界面未显示继续按钮');
await page.click('#btn-continue');
await page.waitForTimeout(400); // 赶在 AI 行动(750ms 延迟)前读取恢复态

const after = await page.evaluate(() => ({
  players: window.__df.game.players.map(p => ({ money: p.money, position: p.position, bankrupt: p.bankrupt })),
  turn: window.__df.game.turn,
  tokens: window.__df.world.tokens.filter(Boolean).length,
  cards: document.querySelectorAll('.player-card').length,
}));

let ok = true;
// 恢复瞬间引擎会为被恢复玩家结算回合开始（公司营收 + 股票分红），回合计数 +1 —— 属预期语义
const mults = [0.6, 1, 1.35, 1.8];
const S = 10_000; // 通天币缩放
const DIV_BASE = 4 * S;
after.players.forEach((p, i) => {
  let revenue = 0;
  let dividend = 0;
  if (i === save.nextPlayer) {
    const sp = save.state.players[i];
    if (sp.company) {
      revenue = Math.round((6 * S + 13 * S * sp.company.level) * mults[save.state.industry[sp.company.industry] ?? 1]);
    }
    if (sp.stocks) {
      for (const [k, sh] of Object.entries(sp.stocks)) {
        if (sh > 0) dividend += Math.round(DIV_BASE * sh * mults[save.state.industry[k] ?? 1]);
      }
    }
  }
  const expect = expectMoney[i] + revenue + dividend;
  if (p.money !== expect) {
    console.error(`玩家${i + 1} 资金不一致: 存档 ${expectMoney[i]}(+营收${revenue}+分红${dividend}) ≠ 恢复 ${p.money}`);
    ok = false;
  }
  if (p.position !== expectPos[i]) { console.error(`玩家${i + 1} 位置不一致: 存档 ${expectPos[i]} ≠ 恢复 ${p.position}`); ok = false; }
});
if (after.turn !== save.state.turn + 1) { console.error(`回合数不一致: ${save.state.turn}+1 ≠ ${after.turn}`); ok = false; }
console.log('恢复校验:', ok ? '✅ 全部一致' : '❌ 存在差异');
console.log('棋子数:', after.tokens, '玩家卡:', after.cards);

// 继续打 1 回合确认引擎正常运转
await pump(30, 1);
await page.screenshot({ path: 'test/shot-save-resumed.png' });

await browser.close();
await vite.close();
if (!ok || errors.length) {
  if (errors.length) console.error('浏览器错误:', [...new Set(errors)].slice(0, 5));
  process.exit(1);
}
console.log('✅ 存档/续玩测试通过');
