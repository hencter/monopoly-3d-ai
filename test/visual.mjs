// 定向视觉检查：摩天楼/地标/公司总部/智能镜头
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ server: { port: 5198 }, logLevel: 'silent' });
await vite.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle' });
await page.click('#btn-start');
await page.waitForTimeout(800);

// 玩家0：AI 组地标+3级；玩家1：半导体组 2 级；两人都办公司
await page.evaluate(() => {
  const { game, adapter, world } = window.__df;
  game.owner[31] = 0; game.houses[31] = 5;  // 大模型实验室 地标
  game.owner[32] = 0; game.houses[32] = 3;  // 智能体平台 3级
  game.owner[26] = 1; game.houses[26] = 2;  // 芯片设计所 2级
  game.players[0].items.charter = (game.players[0].items.charter || 0) + 1;
  game.players[1].items.charter = (game.players[1].items.charter || 0) + 1;
  game.foundCompany(game.players[0], 'ai');
  game.players[0].company.level = 4;
  game.foundCompany(game.players[1], 'semiconductor');
  adapter.update();
  world.setFollow(0);
});
await page.waitForTimeout(2000);
await page.screenshot({ path: 'test/shot-towers.png' });

// 俯瞰全景（关闭跟随，手动取景）
await page.evaluate(() => {
  const { world } = window.__df;
  world.followEnabled = false;
  world.camera.position.set(0, 26, 30);
  world.controls.target.set(0, 0, 0);
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'test/shot-overview.png' });

await browser.close();
await vite.close();
if (errors.length) { console.error('❌', errors); process.exit(1); }
console.log('✅ 视觉检查截图完成');
