// 联机仿真测试：真实启动服务器子进程 + 2 个 ws 人类客户端 + 2 个 AI
// 流程：A 建房 → B 加入 → A 加 2 个 AI → A 开始 → 双方自动应答 → 跑满 60 次 state 同步或游戏结束
// 运行：node test/net-sim.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { TILES } from '../src/data/tiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18117;
const URL = `ws://127.0.0.1:${PORT}`;
const TARGET_STATES = 60;
const TIMEOUT = 150_000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, timeout, what) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error(`超时：${what}`);
    await sleep(50);
  }
}

// ---------- 模拟客户端 ----------
class Sim {
  constructor(name) {
    this.name = name;
    this.seat = -1;
    this.code = '';
    this.lobby = null;
    this.state = null;
    this.states = 0;
    this.over = null;
    this.errors = [];
    this.logs = 0;
    this.lastLogs = [];
  }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        this.handle(m);
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }

  handle(m) {
    switch (m.t) {
      case 'room': this.seat = m.seat; this.code = m.code; this.host = m.host; break;
      case 'lobby': this.lobby = m.players; break;
      case 'begin': this.seat = m.yourSeat; this.state = m.state; checkState(m.state); break;
      case 'state': this.state = m.state; this.states++; checkState(m.state); break;
      case 'log':
        this.logs++;
        this.lastLogs.push(String(m.html).replace(/<[^>]+>/g, ''));
        if (this.lastLogs.length > 5) this.lastLogs.shift();
        break;
      case 'ask': this.answer(m); break;
      case 'over': this.over = m.winnerId; break;
      case 'error': this.errors.push(m.msg); break;
    }
  }

  answer(m) {
    const me = this.state?.players?.[this.seat];
    const resp = (value) => this.send({ t: 'resp', reqId: m.reqId, value });
    switch (m.kind) {
      case 'buy': {
        const t = TILES[m.tileIdx];
        resp(!!me && !!t && me.money >= t.price);   // 钱够就买
        break;
      }
      case 'jail': resp('pay'); break;
      case 'itemUse': resp(true); break;
      case 'roll': resp({ type: 'roll' }); break;
      case 'endTurn': resp(null); break;
      case 'trade': this.send({ t: 'tradeResp', reqId: m.reqId, accept: true }); break;
    }
  }
}

// ---------- state 字段完整性校验 ----------
let stateChecks = 0;
function checkState(s) {
  const ok = s
    && Array.isArray(s.players) && s.players.length === 4
    && Array.isArray(s.owner) && s.owner.length === 40
    && Array.isArray(s.houses) && s.houses.length === 40
    && Array.isArray(s.mortgaged)
    && s.industry && typeof s.industry === 'object'
    && typeof s.turn === 'number'
    && s.players.every(p => typeof p.money === 'number' && typeof p.position === 'number'
      && typeof p.bankrupt === 'boolean' && p.items && typeof p.items === 'object');
  if (!ok) throw new Error('state 字段不完整或不合法');
  stateChecks++;
}

// ---------- 主流程 ----------
let server = null;
let passed = false;
try {
  console.log(`[sim] 启动服务器（端口 ${PORT}，DF_FAST=1）…`);
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    env: { ...process.env, PORT: String(PORT), DF_FAST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  server.stdout.on('data', d => { serverOut += d; });
  server.stderr.on('data', d => { serverOut += d; });
  server.on('exit', (code) => { if (!passed) console.error(`[sim] 服务器提前退出 code=${code}\n${serverOut}`); });
  await waitFor(() => serverOut.includes('listening'), 8000, '服务器启动');

  const A = new Sim('甲'), B = new Sim('乙');
  await A.open(); await B.open();
  console.log('[sim] 两个客户端已连接');

  A.send({ t: 'create', name: '甲' });
  await waitFor(() => A.seat === 0 && A.code, 3000, 'create');
  console.log(`[sim] A 建房成功，房号 ${A.code}`);

  B.send({ t: 'join', code: A.code, name: '乙' });
  await waitFor(() => B.seat === 1 && A.lobby?.length === 2, 3000, 'join');
  console.log('[sim] B 加入成功，大厅 2 人');

  A.send({ t: 'addAI' });
  A.send({ t: 'addAI' });
  await waitFor(() => A.lobby?.length === 4 && B.lobby?.length === 4, 3000, 'addAI');
  console.log(`[sim] 已加入 2 个 AI：${A.lobby.map(p => `${p.name}${p.isAI ? '(AI)' : ''}`).join(' / ')}`);

  A.send({ t: 'start' });
  await waitFor(() => A.state && B.state, 8000, 'begin');
  console.log(`[sim] 开局！A=座位${A.seat} B=座位${B.seat}，玩家数 ${A.state.players.length}`);

  // 主循环：跑满目标 state 数或某方收到 gameOver
  const t0 = Date.now();
  await waitFor(
    () => (A.states >= TARGET_STATES && B.states >= TARGET_STATES) || A.over != null || B.over != null,
    TIMEOUT,
    `${TARGET_STATES} 次 state 同步 / gameOver`
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const winner = A.over != null ? A.state.players[A.over] : (B.over != null ? B.state.players[B.over] : null);
  passed = true;
  console.log('\n========== PASS ==========');
  console.log(`state 同步次数：A=${A.states} B=${B.states}（校验通过 ${stateChecks} 次）`);
  console.log(`当前回合数 turn=${A.state.turn}，日志条数 A=${A.logs}，耗时 ${secs}s`);
  if (winner) console.log(`本局已结束，胜者：${winner.name}`);
  console.log(`错误消息：A=${A.errors.length} B=${B.errors.length}`);
  console.log('最近日志：');
  for (const l of A.lastLogs) console.log(`  · ${l}`);
} catch (err) {
  console.error('\n========== FAIL ==========');
  console.error(err.message);
  process.exitCode = 1;
} finally {
  server?.kill();
}
