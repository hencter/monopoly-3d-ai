// 浏览器冒烟测试：开始游戏 → 人类+AI 回合 → 面板开合 → 截图，收集控制台错误
// 运行: node test/smoke.mjs  (需先 npx playwright install chromium)
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ server: { port: 5199 }, logLevel: 'silent' });
await vite.listen();

const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'test/shot-1-start.png' });

// 3 人局：1 人类 + 2 AI
await page.click('#btn-add-player');
await page.click('#btn-start');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'test/shot-2-board.png' });

// 推进游戏的通用循环：处理弹窗 / 掷骰 / 结束回合
async function pump(maxSec) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxSec * 1000) {
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({
      modal: !document.getElementById('modal').classList.contains('hidden'),
      roll: !document.getElementById('btn-roll').disabled,
      end: !document.getElementById('btn-end').disabled,
      over: document.querySelector('#modal-box')?.textContent?.includes('游戏结束'),
    }));
    if (state.over) return 'over';
    if (state.modal) {
      const first = await page.$('#modal-box [data-choice]');
      if (first) { await first.click(); continue; }
      // 无 data-choice 的面板（银行/建设等）：找关闭按钮
      const close = await page.$('#modal-box [data-close]');
      if (close) { await close.click(); continue; }
      await page.keyboard.press('Escape');
      continue;
    }
    if (state.roll) { await page.click('#btn-roll').catch(() => {}); await page.waitForTimeout(2000); continue; }
    if (state.end) { await page.click('#btn-end').catch(() => {}); continue; }
  }
  return 'timeout';
}

await pump(20);
await page.screenshot({ path: 'test/shot-3-mid.png' });

// 打开各面板验证（利用调试句柄；每步前后确保无弹窗遮挡）
async function clearModal() {
  for (let k = 0; k < 10; k++) {
    const open = await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
    if (!open) return;
    const c = await page.$('#modal-box [data-close]') || await page.$('#modal-box [data-choice]');
    if (c) await c.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}
await clearModal();
await page.evaluate(() => { window.__df.adapter._panelTarget = window.__df.game.players[0]; });

// 银行
await page.evaluate(() => window.__df.adapter.openPanel('bank'));
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/shot-4-bank.png' });
await clearModal();
// 公司（创办）
await page.evaluate(() => window.__df.adapter.openPanel('company'));
await page.waitForTimeout(300);
const indBtn = await page.$('#modal-box [data-ind]');
if (indBtn) await indBtn.click();
await clearModal();
// 交易
await page.evaluate(() => window.__df.adapter.openPanel('trade'));
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/shot-5-trade.png' });
await clearModal();
// 设置
await page.evaluate(() => document.getElementById('btn-settings').click());
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/shot-6-settings.png' });
await clearModal();

// 聊天
await page.fill('#chat-input', '你好，手下留情啊');
await page.click('#chat-send');
await page.waitForTimeout(800);

// 继续跑若干回合
await pump(30);
await page.screenshot({ path: 'test/shot-7-late.png' });

const hud = await page.evaluate(() => ({
  players: document.querySelectorAll('.player-card').length,
  logLines: document.querySelectorAll('#log div').length,
  chatLines: document.querySelectorAll('#chat-log div').length,
  industries: document.querySelectorAll('.ind-chip').length,
  money: [...document.querySelectorAll('.pmoney')].map(e => e.textContent),
}));
console.log('HUD:', JSON.stringify(hud, null, 1));

await browser.close();
await vite.close();

if (errors.length) {
  console.error(`\n❌ 发现 ${errors.length} 个浏览器错误:`);
  [...new Set(errors)].slice(0, 10).forEach(e => console.error('  ' + e));
  process.exit(1);
}
console.log('✅ 浏览器冒烟测试通过，无控制台错误');
