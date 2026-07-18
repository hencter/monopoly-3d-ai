// 联机模式客户端：连接界面 → 大厅 → 对局（事件重放 / 输入转发 / 自建轻量操作面板）
// 用法：import { startOnline } from './net/online.js'; startOnline(world, ui);
import {
  GameState, TILES, INDUSTRIES, INDUSTRY_STATES,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
} from '../core/state.js';
import { ITEMS } from '../data/tiles.js';
import { PLAYER_COLORS, PLAYER_COLORS_CSS } from '../three/world.js';

const $ = (s) => document.querySelector(s);
const ownable = (t) => ['property', 'railroad', 'utility'].includes(t.type);

// 5 种回合内主动卡（ITEMS 里只有前 4 种的元数据，这里补全展示信息）
const ACTIVE_CARDS = {
  demolish:   { icon: '💥', name: '拆迁卡', desc: '拆除任一对手的建筑 1 级' },
  equalize:   { icon: '⚖️', name: '均富卡', desc: '所有存活玩家现金平均分配' },
  rob:        { icon: '🥷', name: '窃取卡', desc: '偷取目标 20% 现金（上限 ¥300）' },
  swap:       { icon: '🔁', name: '置换卡', desc: '用我一块地产换目标一块地产' },
  hibernate:  { icon: '💤', name: '休眠卡', desc: '目标跳过下一个回合' },
};
const WAIT_LABEL = { buy: '考虑收购', jail: '设法脱身', itemUse: '抉择道具', roll: '掷骰', endTurn: '回合收尾', trade: '考虑交易' };

/** 把服务器快照还原成带方法的 GameState 镜像 */
function revive(data) {
  const g = new GameState([]);
  Object.assign(g, data);
  g.mortgaged = new Set(data.mortgaged);
  return g;
}

function injectCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .ol-overlay{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;
      background:rgba(5,9,18,.72);backdrop-filter:blur(6px);}
    .ol-card{width:min(420px,92vw);max-height:88vh;overflow:auto;background:rgba(16,24,40,.95);
      border:1px solid rgba(240,199,94,.45);border-radius:12px;padding:26px 28px;color:#dfe6f3;
      box-shadow:0 18px 60px rgba(0,0,0,.6);}
    .ol-card h1{margin:0 0 18px;font-size:22px;text-align:center;color:#f0c75e;letter-spacing:2px;}
    .ol-field{margin-bottom:14px;}
    .ol-field label{display:block;font-size:12px;color:#8fa0bd;margin-bottom:5px;}
    .ol-field input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;font-size:14px;
      background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);color:#fff;outline:none;}
    .ol-field input:focus{border-color:#f0c75e;}
    .ol-btn{width:100%;padding:11px;border-radius:8px;border:1px solid rgba(255,255,255,.18);cursor:pointer;
      background:rgba(255,255,255,.08);color:#dfe6f3;font-size:15px;margin-top:10px;transition:filter .15s;}
    .ol-btn:hover:not(:disabled){filter:brightness(1.25);}
    .ol-btn:disabled{opacity:.35;cursor:not-allowed;}
    .ol-btn.primary{background:linear-gradient(135deg,#f0c75e,#d9a83c);border:none;color:#3a2805;font-weight:bold;}
    .ol-row{display:flex;gap:10px;}
    .ol-row .ol-btn{flex:1;}
    .ol-hint{margin-top:14px;font-size:12px;color:#7787a5;text-align:center;line-height:1.7;}
    .ol-code{font-size:34px;letter-spacing:10px;text-align:center;color:#f0c75e;font-weight:bold;margin:6px 0 2px;}
    .ol-player{display:flex;align-items:center;gap:9px;padding:8px 12px;border-radius:8px;
      background:rgba(255,255,255,.06);margin-bottom:7px;font-size:14px;}
    .ol-dot{width:12px;height:12px;border-radius:50%;flex:none;}
    .ol-ai{font-size:10px;background:#f0c75e;color:#3a2805;border-radius:6px;padding:1px 6px;font-weight:bold;}
    .ol-host{margin-left:auto;font-size:11px;color:#f0c75e;}
    .ol-wait{text-align:center;color:#8fa0bd;margin:16px 0 4px;animation:ol-blink 1.6s ease-in-out infinite;}
    @keyframes ol-blink{50%{opacity:.4;}}
  `;
  document.head.appendChild(style);
}

/** 通用覆盖层（连接界面 / 大厅） */
function showOverlay(html) {
  closeOverlay();
  const el = document.createElement('div');
  el.className = 'ol-overlay';
  el.id = 'ol-overlay';
  el.innerHTML = `<div class="ol-card">${html}</div>`;
  document.body.appendChild(el);
  return el;
}
function closeOverlay() { document.getElementById('ol-overlay')?.remove(); }

/** 联机版弹窗（挂在 #modal/#modal-box，与 UI 类共用样式） */
const modal = () => document.getElementById('modal');
const modalBox = () => document.getElementById('modal-box');
function openModal(html) { modalBox().innerHTML = html; modal().classList.remove('hidden'); }
function closeModal() { modal().classList.add('hidden'); }

export async function startOnline(world, ui) {
  injectCSS();

  // ================= 第一步：连接 + 大厅 =================
  const session = await connectAndLobby(ui).catch(err => {
    ui.toast(err.message || '联机失败');
    return null;
  });
  if (!session) return; // 用户放弃或失败（界面已提示）

  const { ws, code, mySeat, myName, begin } = session;
  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  // ================= 第二步：开局初始化 =================
  closeOverlay();
  $('#start-screen')?.classList.add('hidden');
  ui.enterGame();

  let mirror = revive(begin.state);
  let activeId = -1;
  let acting = false;          // 我的可操作窗口（ask roll / endTurn 期间）
  const deadTokens = new Set();
  let panelOpen = null;        // 当前打开的联机面板名
  let over = false;

  world.setPlayerCount(begin.roster.length);
  for (const r of begin.roster) world.createToken(r.seat);
  world.onPick((tileIdx, x, y) => ui.showTileInfo(tileIdx, mirror, x, y));

  // 牌桌按钮：操作改为发消息给服务器
  const cardsBtn = document.createElement('button');
  cardsBtn.id = 'btn-cards';
  cardsBtn.textContent = '🃏 卡牌';
  cardsBtn.disabled = true;
  $('#btn-company').after(cardsBtn);

  const setActing = (on) => {
    acting = on;
    cardsBtn.disabled = !on;
  };
  const tryOpen = (name, fn) => {
    if (!acting || ui.modalOpen || over) return;
    fn();
  };
  $('#btn-build').onclick = () => tryOpen('build', openBuild);
  $('#btn-bank').onclick = () => tryOpen('bank', openBank);
  $('#btn-company').onclick = () => tryOpen('company', openCompany);
  cardsBtn.onclick = () => tryOpen('cards', openCards);
  $('#btn-trade').onclick = () => tryOpen('trade', () => {
    ui.openTrade(mirror, mirror.players[mySeat], (offer) => {
      send({ t: 'trade', ...offer });
      ui.toast('报价已发出，等待对方回应…');
    });
  });
  $('#btn-camera').onclick = () => {
    world.followEnabled = !world.followEnabled;
    if (world.followEnabled) world.refocus();
    ui.setCameraLabel(world.followEnabled);
  };
  $('#btn-settings').onclick = () => ui.toast('联机模式：AI 由服务器托管');

  ui.onChatSend = (text) => send({ t: 'chat', text });

  // ---------- 镜像 → 表现层 ----------
  function renderMirror() {
    for (let i = 0; i < TILES.length; i++) {
      const o = mirror.owner[i];
      world.setOwner(i, o >= 0 ? PLAYER_COLORS[o] : null);
      world.setHouses(i, mirror.houses[i]);
    }
    for (const p of mirror.players) {
      world.setCompany(p.id, p.company, p.name);
      if (p.bankrupt && !deadTokens.has(p.id)) {
        deadTokens.add(p.id);
        world.removeToken(p.id);
        world.setCompany(p.id, null, p.name);
      }
    }
    ui.renderPlayers(mirror, activeId);
    ui.renderIndustries(mirror);
    // 面板打开时跟随最新镜像重渲染（弹窗被关闭则放弃面板）
    if (panelOpen) {
      if (ui.modalOpen) rerenderPanel();
      else panelOpen = null;
    }
  }
  renderMirror();
  ui.log(`已加入房间 <b>${code}</b>，你是 ${myName}（${mySeat + 1} 号位）`, 'turn');
  ui.chatAdd({ sys: true, text: `联机对战开始！房间号 ${code}` });

  // ================= 第三步：消息路由 =================
  let queue = Promise.resolve(); // 动画/问答按序执行，避免叠加
  const enqueue = (fn) => { queue = queue.then(fn).catch(err => console.error('[online]', err)); };

  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.t) {
      case 'state': mirror = revive(m.state); renderMirror(); break;
      case 'log': ui.log(m.html, m.cls); break;
      case 'chat': ui.chatAdd({ from: m.name, color: PLAYER_COLORS_CSS[m.seat], text: m.text }); break;
      case 'say': {
        const p = mirror.players[m.seat];
        ui.chatAdd({ from: p ? p.name : `玩家${m.seat + 1}`, color: PLAYER_COLORS_CSS[m.seat], text: m.text });
        break;
      }
      case 'wait': {
        if (m.playerId !== mySeat) {
          const p = mirror.players[m.playerId];
          ui.setTurnInfo(`⏳ 等待 ${p ? p.name : '对手'}${WAIT_LABEL[m.kind] || '操作'}…`);
        }
        break;
      }
      case 'phase': onPhase(m); break;
      case 'dice': enqueue(() => world.animateDice(m.d1, m.d2)); break;
      case 'move': enqueue(() => world.moveToken(m.player, m.from, m.steps)); break;
      case 'tele': enqueue(() => world.teleportToken(m.player, m.from, m.to)); break;
      case 'card': enqueue(() => ui.showCard(m.card, m.deck, m.player !== mySeat)); break;
      case 'ask': enqueue(() => onAsk(m)); break;
      case 'tradeResult': enqueue(() => onTradeResult(m)); break;
      case 'over': enqueue(() => onOver(m)); break;
      case 'error': ui.toast(m.msg); break;
    }
  };
  ws.onclose = () => {
    if (over) return;
    ui.toast('与服务器断开连接', 5000);
    ui.setButtons({});
    setActing(false);
  };

  function onPhase(m) {
    const p = mirror.players[m.playerId];
    if (m.name === 'turnStart') {
      activeId = m.playerId;
      world.setFollow(m.playerId);
      ui.setTurnInfo(`🎯 ${p ? p.name : ''} 的回合`);
      ui.toast(m.playerId === mySeat ? '🎯 轮到你了！' : `轮到 ${p ? p.name : '对手'}`);
      ui.setButtons({});
      setActing(false);
      ui.el.itemBar.innerHTML = '';
      ui.renderPlayers(mirror, activeId);
    } else if (m.name === 'waitRoll' && m.playerId !== mySeat) {
      ui.setTurnInfo(`⏳ ${p ? p.name : '对手'} 掷骰中…`);
    } else if (m.name === 'endTurn' && m.playerId !== mySeat) {
      ui.setTurnInfo(`⏳ ${p ? p.name : '对手'} 回合收尾…`);
    }
  }

  // ---------- 问答 ----------
  async function onAsk(m) {
    const me = () => mirror.players[mySeat];
    switch (m.kind) {
      case 'buy': {
        const yes = await ui.promptBuy(me(), m.tileIdx, mirror);
        send({ t: 'resp', reqId: m.reqId, value: yes });
        break;
      }
      case 'jail': {
        const choice = await ui.promptJail(me(), { canPay: m.canPay, hasCard: m.hasCard });
        send({ t: 'resp', reqId: m.reqId, value: choice });
        break;
      }
      case 'itemUse': {
        const yes = await ui.promptItemUse(me(), m.item, m.ctx);
        send({ t: 'resp', reqId: m.reqId, value: yes });
        break;
      }
      case 'roll': {
        const action = await rollUI(me());
        send({ t: 'resp', reqId: m.reqId, value: action });
        break;
      }
      case 'endTurn': {
        await endTurnUI(me());
        send({ t: 'resp', reqId: m.reqId, value: null });
        break;
      }
      case 'trade': { // 人类卖方收到的收购要约
        const accept = await incomingTradeUI(m);
        send({ t: 'tradeResp', reqId: m.reqId, accept });
        break;
      }
    }
  }

  /** 掷骰阶段：按钮 + 道具栏（remote/boost） */
  function rollUI(p) {
    return new Promise((resolve) => {
      ui.setTurnInfo(`${p.name}：请掷骰子`);
      ui.setButtons({ roll: true, build: true, bank: true, trade: true, company: true });
      setActing(true);
      let boost = false;
      const bar = ui.el.itemBar;
      bar.innerHTML = '';
      const done = (action) => {
        bar.innerHTML = '';
        ui.el.btnRoll.onclick = null;
        ui.setButtons({});
        setActing(false);
        resolve(action);
      };
      ui.el.btnRoll.onclick = () => done({ type: 'roll', boost });

      const mk = (item) => {
        const n = p.items[item] || 0;
        if (n <= 0) return null;
        const b = document.createElement('button');
        b.className = 'item-btn';
        b.innerHTML = `${ITEMS[item].icon}<span class="cnt">${n}</span>`;
        b.title = ITEMS[item].desc;
        bar.appendChild(b);
        return b;
      };
      const remoteBtn = mk('remote');
      if (remoteBtn) remoteBtn.onclick = async () => {
        const n = await ui.askNumber('🎯 遥控骰子：选择点数', 1, 6);
        if (n != null) done({ type: 'remote', total: n });
      };
      const boostBtn = mk('boost');
      if (boostBtn) boostBtn.onclick = () => {
        boost = !boost;
        boostBtn.classList.toggle('toggled', boost);
        ui.toast(boost ? '🚀 加速卡已激活：本次 +3 步' : '已取消加速卡');
      };
      if ((p.items.rentFree || 0) > 0) {
        const b = document.createElement('button');
        b.className = 'item-btn';
        b.disabled = true;
        b.title = '免租卡：踩到他人地产时自动询问使用';
        b.innerHTML = `${ITEMS.rentFree.icon}<span class="cnt">${p.items.rentFree}</span>`;
        bar.appendChild(b);
      }
    });
  }

  /** 回合收尾：可操作面板或结束回合 */
  function endTurnUI(p) {
    ui.setTurnInfo(`${p.name}：可操作或结束回合`);
    ui.setButtons({ end: true, build: true, bank: true, trade: true, company: true });
    setActing(true);
    return ui.waitButton('end').then(() => {
      ui.setButtons({});
      setActing(false);
      if (panelOpen) { closeModal(); panelOpen = null; }
    });
  }

  /** 人类卖方收到的要约 */
  function incomingTradeUI(m) {
    const t = TILES[m.tileIdx];
    openModal(`
      <h2>🤝 收购要约</h2>
      <div class="modal-body">
        <p><b>${m.fromName}</b> 想出价 <b style="color:var(--gold)">¥${m.price}</b> 收购你的 <b>${t.name}</b>（市值 ¥${t.price}）。</p>
      </div>
      <div class="btn-row">
        <button class="primary" data-a="1">✅ 同意出售</button>
        <button class="danger" data-a="0">❌ 拒绝</button>
      </div>`);
    return new Promise((res) => {
      modalBox().querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        closeModal();
        res(b.dataset.a === '1');
      });
    });
  }

  /** 发起方收到议价结果（AI 或人类回应） */
  async function onTradeResult(m) {
    if (m.decision === 'counter') {
      const choice = await ui.showTradeResponse(m.name, 'counter', m.counterPrice, m.say || '');
      send({ t: 'tradeResp', reqId: m.reqId, accept: choice === 'accept' });
    } else {
      await ui.showTradeResponse(m.name, m.decision, 0, m.say || '');
    }
  }

  async function onOver(m) {
    over = true;
    activeId = -1;
    world.setFollow(null);
    ui.setButtons({});
    setActing(false);
    ui.el.itemBar.innerHTML = '';
    ui.setTurnInfo('游戏结束');
    const winner = mirror.players[m.winnerId];
    await ui.showGameOver(winner, mirror);
    location.reload();
  }

  // ================= 第四步：联机操作面板（自建轻量版） =================
  const me = () => mirror.players[mySeat];

  function rerenderPanel() {
    if (panelOpen === 'build') renderBuild();
    else if (panelOpen === 'bank') renderBank();
    else if (panelOpen === 'company') renderCompany();
    else if (panelOpen === 'cards') renderCards();
  }

  function bindClose() {
    modalBox().querySelector('[data-close]').onclick = () => { closeModal(); panelOpen = null; };
  }

  // ---------- 建楼 ----------
  function openBuild() { panelOpen = 'build'; renderBuild(); }
  function renderBuild() {
    const p = me();
    const props = mirror.playerProperties(mySeat).filter(i => TILES[i].type === 'property');
    let rows = '';
    for (const i of props) {
      const t = TILES[i], h = mirror.houses[i];
      const stars = h >= 5 ? '🏙️ 地标' : '🏬'.repeat(h) + '·'.repeat(4 - h);
      rows += `<div class="build-prop">
        <span class="bp-name">${INDUSTRIES[t.color].icon}${t.name}</span>
        <span class="bp-houses">${stars}</span>
        <button data-build="${i}" ${mirror.canBuild(p, i) ? '' : 'disabled'}>＋建 ¥${t.houseCost}</button>
        <button data-sell="${i}" ${mirror.canSellHouse(p, i) ? '' : 'disabled'}>－卖</button>
      </div>`;
    }
    openModal(`
      <h2>🏠 楼宇建设 <small style="color:#9ab">现金 ¥${p.money}</small></h2>
      <div class="modal-body">${rows || '<p class="muted">你还没有地产。<br/>集齐同一行业的全部资产（且无抵押）后即可建楼。</p>'}</div>
      <div class="btn-row"><button class="primary" data-close>完 成</button></div>`);
    modalBox().querySelectorAll('[data-build]').forEach(b => b.onclick = () => send({ t: 'op', op: 'build', tileIdx: +b.dataset.build }));
    modalBox().querySelectorAll('[data-sell]').forEach(b => b.onclick = () => send({ t: 'op', op: 'sellHouse', tileIdx: +b.dataset.sell }));
    bindClose();
  }

  // ---------- 银行 ----------
  function openBank() { panelOpen = 'bank'; renderBank(); }
  function renderBank() {
    const p = me();
    const limit = mirror.creditLimit(p);
    const avail = limit - p.debt;
    let rows = '';
    for (const i of mirror.playerProperties(mySeat)) {
      const t = TILES[i];
      const mort = mirror.isMortgaged(i);
      rows += `<div class="panel-row">
        <span class="grow">${t.type === 'property' ? INDUSTRIES[t.color].icon : ''}${t.name}
          ${mirror.houses[i] > 0 ? `<span class="tag">${mirror.houses[i]}级</span>` : ''}
          ${mort ? '<span class="mort-flag">已抵押</span>' : ''}</span>
        ${mort
          ? `<button data-unmort="${i}" ${mirror.canUnmortgage(p, i) ? '' : 'disabled'}>赎回 ¥${mirror.unmortgageCost(i)}</button>`
          : `<button data-mort="${i}" ${mirror.canMortgage(p, i) ? '' : 'disabled'}>抵押 +¥${mirror.mortgageValue(i)}</button>`}
      </div>`;
    }
    openModal(`
      <h2>🏦 帝国银行</h2>
      <div class="modal-body">
        <div class="panel-section">
          <h3>💰 信贷 <small class="muted">每回合债务计息 5%</small></h3>
          <div class="panel-row"><span class="grow">现金 <b style="color:var(--gold)">¥${p.money}</b>　债务 <b class="debt">¥${p.debt}</b></span></div>
          <div class="panel-row"><span class="grow">信用额度 ¥${limit}，可用 <b>${avail}</b></span></div>
          <div class="panel-row"><span>借款：</span>
            ${[100, 300, 500].map(v => `<button data-borrow="${v}" ${mirror.canBorrow(p, v) ? '' : 'disabled'}>+¥${v}</button>`).join('')}
          </div>
          <div class="panel-row"><span>还款：</span>
            ${[100, 500].map(v => `<button data-repay="${v}" ${p.debt > 0 && p.money > 0 ? '' : 'disabled'}>-¥${v}</button>`).join('')}
            <button data-repay="all" ${p.debt > 0 && p.money > 0 ? '' : 'disabled'}>还清</button>
          </div>
        </div>
        <div class="panel-section">
          <h3>🏢 地产抵押</h3>
          ${rows || '<p class="muted">你还没有地产</p>'}
        </div>
      </div>
      <div class="btn-row"><button class="primary" data-close>关 闭</button></div>`);
    modalBox().querySelectorAll('[data-borrow]').forEach(b => b.onclick = () => send({ t: 'op', op: 'borrow', amount: +b.dataset.borrow }));
    modalBox().querySelectorAll('[data-repay]').forEach(b => b.onclick = () => {
      const v = b.dataset.repay === 'all' ? me().debt : +b.dataset.repay;
      send({ t: 'op', op: 'repay', amount: v });
    });
    modalBox().querySelectorAll('[data-mort]').forEach(b => b.onclick = () => send({ t: 'op', op: 'mortgage', tileIdx: +b.dataset.mort }));
    modalBox().querySelectorAll('[data-unmort]').forEach(b => b.onclick = () => send({ t: 'op', op: 'unmortgage', tileIdx: +b.dataset.unmort }));
    bindClose();
  }

  // ---------- 公司 ----------
  function openCompany() { panelOpen = 'company'; renderCompany(); }
  function renderCompany() {
    const p = me();
    if (!p.company) {
      const canAfford = p.money >= COMPANY_FOUND_COST;
      openModal(`
        <h2>🏢 创办公司</h2>
        <div class="modal-body">
          <p>注册费 <b style="color:var(--gold)">¥${COMPANY_FOUND_COST}</b>　你的现金：¥${p.money}</p>
          <p class="muted">公司每回合产生营收 = 基础营收 × 行业景气度。选择赛道：</p>
          <div class="btn-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${Object.entries(INDUSTRIES).filter(([k]) => k !== 'railroad' && k !== 'utility').map(([k, ind]) => {
              const st = INDUSTRY_STATES[mirror.industry[k]];
              return `<button data-ind="${k}" ${canAfford ? '' : 'disabled'}>${ind.icon} ${ind.name} ${st.icon}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="btn-row"><button data-close>再想想</button></div>`);
      modalBox().querySelectorAll('[data-ind]').forEach(b => b.onclick = () => send({ t: 'op', op: 'foundCompany', industry: b.dataset.ind }));
      bindClose();
      return;
    }
    const c = p.company;
    const ind = INDUSTRIES[c.industry];
    const st = INDUSTRY_STATES[mirror.industry[c.industry]];
    const upCost = companyUpgradeCost(c.level);
    openModal(`
      <h2>🏢 ${p.name}的公司</h2>
      <div class="modal-body"><div class="panel-section">
        <div class="panel-row">赛道：${ind.icon} ${ind.name} ${st.icon}${st.name}</div>
        <div class="panel-row">等级：<b style="color:var(--gold)">Lv${c.level}</b> / Lv${COMPANY_MAX_LEVEL}</div>
        <div class="panel-row">每回合营收：<b style="color:var(--gold)">¥${mirror.companyRevenue(p)}</b></div>
      </div></div>
      <div class="btn-row">
        ${c.level < COMPANY_MAX_LEVEL ? `<button class="primary" data-up ${mirror.canUpgradeCompany(p) ? '' : 'disabled'}>⬆️ 升级（¥${upCost}）</button>` : '<span class="tag">已满级</span>'}
        <button data-close>关 闭</button>
      </div>`);
    const up = modalBox().querySelector('[data-up]');
    if (up) up.onclick = () => send({ t: 'op', op: 'upgradeCompany' });
    bindClose();
  }

  // ---------- 卡牌（5 种回合内主动卡） ----------
  function openCards() { panelOpen = 'cards'; renderCards(); }
  function renderCards() {
    const p = me();
    const rows = Object.entries(ACTIVE_CARDS)
      .filter(([k]) => (p.items[k] || 0) > 0)
      .map(([k, c]) => `<div class="panel-row">
          <span class="grow">${c.icon} ${c.name} ×${p.items[k]} <small class="muted">${c.desc}</small></span>
          <button data-card="${k}">使用</button>
        </div>`).join('');
    openModal(`
      <h2>🃏 道具卡 <small style="color:#9ab">仅自己回合可用</small></h2>
      <div class="modal-body">${rows || '<p class="muted">没有可主动使用的卡牌（遥控骰子/加速卡在掷骰时使用）。</p>'}</div>
      <div class="btn-row"><button class="primary" data-close>关 闭</button></div>`);
    modalBox().querySelectorAll('[data-card]').forEach(b => b.onclick = () => useCard(b.dataset.card));
    bindClose();
  }

  /** 卡牌目标选择流程 */
  function useCard(item) {
    const p = me();
    const back = () => renderCards();
    if (item === 'equalize') {
      send({ t: 'op', op: 'playCard', item: 'equalize' });
      return;
    }
    if (item === 'rob' || item === 'hibernate') {
      const targets = mirror.players.filter(q => q.id !== mySeat && !q.bankrupt);
      pickRow(`选择目标玩家`, targets.map(q => ({
        label: `${q.name}（现金 ¥${q.money}）`,
        cb: () => send({ t: 'op', op: 'playCard', item, targetId: q.id }),
      })), back);
      return;
    }
    if (item === 'demolish') {
      const targets = [];
      for (const q of mirror.players) {
        if (q.id === mySeat || q.bankrupt) continue;
        for (const i of mirror.playerProperties(q.id)) {
          if (mirror.houses[i] > 0) targets.push({ i, owner: q });
        }
      }
      if (!targets.length) { ui.toast('场上没有可拆除的建筑'); return; }
      targets.sort((a, b) => mirror.houses[b.i] - mirror.houses[a.i]);
      pickRow(`💥 选择拆除目标`, targets.slice(0, 8).map(({ i, owner }) => ({
        label: `${TILES[i].name}（${owner.name}，${mirror.houses[i] >= 5 ? '地标' : mirror.houses[i] + '级'}）`,
        cb: () => send({ t: 'op', op: 'playCard', item: 'demolish', tileIdx: i }),
      })), back);
      return;
    }
    if (item === 'swap') {
      const tradable = (pid) => mirror.playerProperties(pid).filter(i => mirror.houses[i] === 0 && !mirror.isMortgaged(i));
      const mine = tradable(mySeat);
      if (!mine.length) { ui.toast('你没有可置换的地产（需无建筑、未抵押）'); return; }
      const others = mirror.players.filter(q => q.id !== mySeat && !q.bankrupt && tradable(q.id).length);
      if (!others.length) { ui.toast('对手没有可置换的地产'); return; }
      pickRow(`🔁 第一步：选择交换对象`, others.map(q => ({
        label: q.name,
        cb: () => pickRow(`🔁 第二步：选择对方的地产`, tradable(q.id).map(j => ({
          label: `${TILES[j].name}（市值 ¥${TILES[j].price}）`,
          cb: () => pickRow(`🔁 第三步：选择你要给出的地产`, mine.map(i => ({
            label: `${TILES[i].name}（市值 ¥${TILES[i].price}）`,
            cb: () => send({ t: 'op', op: 'playCard', item: 'swap', myTile: i, targetTile: j }),
          })), back),
        })), back),
      })), back);
    }
  }

  /** 面板内的选项列表（带返回） */
  function pickRow(title, options, onBack) {
    openModal(`
      <h2>${title}</h2>
      <div class="modal-body">
        ${options.map((o, idx) => `<div class="panel-row"><span class="grow">${o.label}</span><button data-pick="${idx}">选择</button></div>`).join('')}
      </div>
      <div class="btn-row"><button data-back>返回</button></div>`);
    modalBox().querySelectorAll('[data-pick]').forEach(b => b.onclick = () => options[+b.dataset.pick].cb());
    modalBox().querySelector('[data-back]').onclick = onBack;
  }
}

// ================= 连接 + 大厅流程 =================
function connectAndLobby(ui) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let settled = false;
    const sess = { code: '', mySeat: -1, myName: '', isHost: false };

    const fail = (msg) => {
      if (settled) return;
      ui.toast(msg);
      try { ws?.close(); } catch { /* 忽略 */ }
      renderConnect();
    };

    // ---------- 连接界面 ----------
    function renderConnect() {
      const el = showOverlay(`
        <h1>🌐 联机对战</h1>
        <div class="ol-field"><label>服务器地址</label>
          <input id="ol-url" value="ws://${location.hostname || 'localhost'}:8081" /></div>
        <div class="ol-field"><label>你的昵称</label>
          <input id="ol-name" maxlength="8" value="玩家${Math.floor(Math.random() * 900 + 100)}" /></div>
        <button class="ol-btn primary" id="ol-create">创建房间</button>
        <div class="ol-row">
          <input id="ol-code" maxlength="4" placeholder="房号" style="flex:1;padding:11px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#fff;text-transform:uppercase;" />
          <button class="ol-btn" id="ol-join" style="flex:2;margin-top:0;">加入房间</button>
        </div>
        <p class="ol-hint">房号为 4 位字符，由创建者分享给好友<br/>局域网联机请把地址改为房主 IP</p>`);
      el.querySelector('#ol-create').onclick = () => doConnect('create');
      el.querySelector('#ol-join').onclick = () => doConnect('join');
    }

    async function doConnect(mode) {
      const url = $('#ol-url').value.trim();
      const name = $('#ol-name').value.trim() || '玩家';
      const code = $('#ol-code')?.value.trim().toUpperCase() || '';
      if (mode === 'join' && code.length !== 4) { ui.toast('请输入 4 位房号'); return; }
      sess.myName = name;
      try {
        ws = await new Promise((res, rej) => {
          const s = new WebSocket(url);
          s.onopen = () => res(s);
          s.onerror = () => rej(new Error('无法连接服务器'));
        });
      } catch {
        return fail('无法连接服务器，请检查地址');
      }
      ws.onmessage = onLobbyMsg;
      ws.onclose = () => { if (!settled) fail('连接已断开'); };
      ws.send(JSON.stringify(mode === 'create' ? { t: 'create', name } : { t: 'join', code, name }));
    }

    // ---------- 大厅 ----------
    function onLobbyMsg(ev) {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'room') {
        sess.code = m.code;
        sess.mySeat = m.seat;
        sess.isHost = m.host;
      } else if (m.t === 'lobby') {
        renderLobby(m);
      } else if (m.t === 'error') {
        ui.toast(m.msg);
        try { ws?.close(); } catch { /* 忽略 */ }
        renderConnect();
      } else if (m.t === 'begin') {
        settled = true;
        resolve({ ws, code: sess.code, mySeat: m.yourSeat, myName: sess.myName, begin: m });
      }
    }

    function renderLobby(m) {
      sess.isHost = m.host === sess.mySeat;
      const rows = m.players.map(p => `
        <div class="ol-player">
          <span class="ol-dot" style="background:${PLAYER_COLORS_CSS[p.seat]}"></span>
          <span>${p.seat + 1}. ${p.name}${p.seat === sess.mySeat ? '（你）' : ''}</span>
          ${p.isAI ? '<span class="ol-ai">AI</span>' : ''}
          ${p.seat === m.host ? '<span class="ol-host">👑 房主</span>' : ''}
        </div>`).join('');
      const el = showOverlay(`
        <h1>🌐 房间大厅</h1>
        <div class="ol-code">${m.code}</div>
        <p class="ol-hint" style="margin:0 0 14px;">把房号告诉好友（2~6 人开局）</p>
        ${rows}
        ${sess.isHost ? `
          <div class="ol-row">
            <button class="ol-btn" id="ol-addai">＋ AI</button>
            <button class="ol-btn" id="ol-rmai">－ AI</button>
          </div>
          <button class="ol-btn primary" id="ol-start" ${m.players.length >= 2 ? '' : 'disabled'}>开始游戏</button>`
        : '<p class="ol-wait">等待房主开始…</p>'}`);
      if (sess.isHost) {
        el.querySelector('#ol-addai').onclick = () => ws.send(JSON.stringify({ t: 'addAI' }));
        el.querySelector('#ol-rmai').onclick = () => ws.send(JSON.stringify({ t: 'removeAI' }));
        el.querySelector('#ol-start').onclick = () => ws.send(JSON.stringify({ t: 'start' }));
      }
    }

    renderConnect();
    // 注：Promise 在 begin 前会一直挂起（覆盖层等待用户操作），这是预期行为
  });
}
