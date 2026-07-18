// 卡牌栏与卡牌使用流程的视觉检查
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ server: { port: 5195 }, logLevel: 'silent' });
await vite.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:5195/', { waitUntil: 'networkidle' });
await page.click('#btn-start');
await page.waitForTimeout(1000);

// 塞给玩家0 全部卡牌并重渲染牌栏
await page.evaluate(() => {
  const { game, ui, adapter } = window.__df;
  Object.assign(game.players[0].items, { demolish: 1, equalize: 1, rob: 1, swap: 1, hibernate: 1 });
  ui.el.itemBar.innerHTML = '';
  ui.renderCardBar(game.players[0], (item) => adapter.useCard(game.players[0], item));
  adapter.update();
});

// 等待玩家0 的掷骰阶段（btn-roll 可用）
for (let k = 0; k < 40; k++) {
  await page.waitForTimeout(500);
  const roll = await page.evaluate(() => !document.getElementById('btn-roll').disabled);
  if (roll) break;
  const modal = await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
  if (modal) {
    const c = await page.$('#modal-box [data-choice]') || await page.$('#modal-box [data-close]');
    if (c) await c.click().catch(() => {});
  }
}
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/shot-cardbar.png' });

// 打出抢夺卡（走目标选择流程）
await page.evaluate(() => {
  const bar = document.getElementById('item-bar');
  const btn = [...bar.querySelectorAll('.item-btn')].find(b => b.title.includes('抢夺'));
  btn?.click();
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/shot-card-rob.png' });
// 选择第一个目标
const pick = await page.$('#modal-box [data-p]');
if (pick) await pick.click();
await page.waitForTimeout(400);

await browser.close();
await vite.close();
if (errors.length) { console.error('❌', errors); process.exit(1); }
console.log('✅ 卡牌视觉检查完成');
