// 双浏览器联机测试：A 建房 → B 加入 → A 开始 → 双方各掷一回合 → 截图 + 错误收集
// 运行: node test/net-web.mjs  (需 playwright + chromium)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';

const WS_PORT = 18119;
// 启动游戏服务器
const server = spawn('node', ['server/server.mjs'], { env: { ...process.env, PORT: String(WS_PORT) }, stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));

const vite = await createServer({ server: { port: 5196 }, logLevel: 'silent' });
await vite.listen();

const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const errors = [];
async function mkPage(name) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.goto('http://localhost:5196/', { waitUntil: 'networkidle' });
  await page.click('#btn-online');
  await page.waitForTimeout(400);
  await page.fill('#ol-url', `ws://localhost:${WS_PORT}`);
  return page;
}

const A = await mkPage('A');
const B = await mkPage('B');

// A 创建房间
await A.fill('#ol-name', '房主甲');
await A.click('#ol-create');
await A.waitForSelector('.ol-code', { timeout: 8000 });
const code = await A.evaluate(() => document.querySelector('.ol-code')?.textContent?.trim());
console.log('房间号:', code);
if (!code) throw new Error('未获取到房间号');

// B 加入
await B.fill('#ol-name', '挑战者乙');
await B.fill('#ol-code', code);
await B.click('#ol-join');
await B.waitForTimeout(800);
await A.screenshot({ path: 'test/shot-net-lobby.png' });

// A 开始（2 人类，不加 AI）
await A.click('#ol-start');
await A.waitForTimeout(2500);
await A.screenshot({ path: 'test/shot-net-A.png' });
await B.screenshot({ path: 'test/shot-net-B.png' });

// 通用应答泵：遇到可用按钮就按
async function pump(page, tag, sec) {
  const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) {
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({
      modal: !document.getElementById('modal').classList.contains('hidden'),
      roll: !document.getElementById('btn-roll').disabled,
      end: !document.getElementById('btn-end').disabled,
    }));
    if (st.modal) {
      const c = await page.$('#modal-box [data-choice]') || await page.$('#modal-box [data-close]') || await page.$('#modal-box [data-a]');
      if (c) { await c.click().catch(() => {}); continue; }
    }
    if (st.roll) { await page.click('#btn-roll'); await page.waitForTimeout(1500); continue; }
    if (st.end) { await page.click('#btn-end'); continue; }
  }
}
await Promise.all([pump(A, 'A', 25), pump(B, 'B', 25)]);
await A.screenshot({ path: 'test/shot-net-A2.png' });
await B.screenshot({ path: 'test/shot-net-B2.png' });

const stateA = await A.evaluate(() => ({
  players: document.querySelectorAll('.player-card').length,
  log: document.querySelectorAll('#log div').length,
  money: [...document.querySelectorAll('.pmoney')].map(e => e.textContent),
}));
const stateB = await B.evaluate(() => ({
  players: document.querySelectorAll('.player-card').length,
  money: [...document.querySelectorAll('.pmoney')].map(e => e.textContent),
}));
console.log('A:', JSON.stringify(stateA));
console.log('B:', JSON.stringify(stateB));

await browser.close();
await vite.close();
server.kill();

const syncOk = JSON.stringify(stateA.money) === JSON.stringify(stateB.money);
console.log(syncOk ? '✅ 双端资金显示一致' : '⚠️ 双端显示不一致');
if (errors.length) {
  console.error(`❌ ${errors.length} 个错误:`);
  [...new Set(errors)].slice(0, 8).forEach(e => console.error('  ' + e));
  process.exit(1);
}
console.log('✅ 联机双浏览器测试通过');
