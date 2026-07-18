// 34 人局视觉检查：开局界面快捷选择 + 棋盘拥挤渲染 + 紧凑 HUD
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ server: { port: 5194 }, logLevel: 'silent' });
await vite.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:5194/', { waitUntil: 'networkidle' });
// 快捷选 34 人
await page.click('#quick-count .qc-chip:last-child');
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/shot-crowd-setup.png' });
await page.click('#btn-start');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test/shot-crowd-board.png' });

// 推进人类回合（掷骰→处理弹窗→结束回合），再让 AI 跑几轮
await page.evaluate(() => { window.__df.world.followEnabled = false; });
const t0 = Date.now();
let turns = 0;
while (Date.now() - t0 < 45000 && turns < 2) {
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
  if (st.roll) { await page.click('#btn-roll'); await page.waitForTimeout(1500); continue; }
  if (st.end) { await page.click('#btn-end'); turns++; }
}
await page.screenshot({ path: 'test/shot-crowd-mid.png' });

const hud = await page.evaluate(() => ({
  players: document.querySelectorAll('.player-card').length,
  compact: document.getElementById('players').classList.contains('compact'),
  tokens: window.__df.world.tokens.filter(Boolean).length,
  log: document.querySelectorAll('#log div').length,
}));
console.log('HUD:', JSON.stringify(hud));

await browser.close();
await vite.close();
if (errors.length) {
  console.error('❌', [...new Set(errors)].slice(0, 6));
  process.exit(1);
}
console.log('✅ 34 人局视觉检查完成');
