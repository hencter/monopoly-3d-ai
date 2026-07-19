// 联机模式客户端：连接界面 → 大厅 → 对局（事件重放 / 输入转发 / 自建轻量操作面板）
// 用法：import { startOnline } from './net/online.js'; startOnline(world, ui);
import {
  GameState, TILES, INDUSTRIES, INDUSTRY_STATES, STOCK_INDUSTRIES,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
  formatMoney, ttc, GO_SALARY, STAMINA_MAX, STAMINA_DICE,
} from '../core/state.js';
import { ITEMS, MAX_SHARES_PER_IND, HAND_CAP } from '../data/tiles.js';
import { PLAYER_COLORS, PLAYER_COLORS_CSS } from '../three/world.js';

const $ = (s) => document.querySelector(s);
const ownable = (t) => ['property', 'railroad', 'utility'].includes(t.type);

const ACTIVE_CARDS = {
  demolish:     { icon: '💥', name: '拆迁卡',   desc: '拆除任一对手的建筑 1 级' },
  equalize:     { icon: '💳', name: '均富卡',   desc: '所有存活玩家现金平均分配' },
  rob:          { icon: '🥷', name: '抢夺卡',   desc: `偷取目标 20% 现金（上限 Ŧ300万）` },
  swap:         { icon: '🔀', name: '换地卡',   desc: '用我一块地产换目标一块地产' },
  hibernate:    { icon: '😴', name: '冬眠卡',   desc: '目标跳过下一个回合' },
  intel:        { icon: '📰', name: '资讯卡',   desc: '发布利好/利空资讯，干扰股价' },
  bail:         { icon: '🔓', name: '保释令',   desc: '在监管局时立即脱身' },
  subsidy:      { icon: '🎁', name: '财政补贴', desc: '立即获得 Ŧ200万' },
  debtCut:      { icon: '✂️', name: '债务豁免', desc: '减免最高 Ŧ400万债务' },
  audit:        { icon: '🧾', name: '审计风暴', desc: '对手补缴 Ŧ150万税款' },
  poach:        { icon: '🧲', name: '挖角',     desc: '随机偷取对手 1 张道具' },
  hedge:        { icon: '☂️', name: '对冲保单', desc: '下次租金减半' },
  rush:         { icon: '⚡', name: '抢工卡',   desc: '下次建楼免建设卡' },
  warp:         { icon: '🌀', name: '跃迁卡',   desc: '传送到名下一块地产' },
  doubleGo:     { icon: '🏦', name: '双倍融资', desc: '下次经过起点 ×2' },
  freeze:       { icon: '🛑', name: '停工令',   desc: '对手下回合不可建设' },
  equalizeDebt: { icon: '💸', name: '均负卡',   desc: '全员债务平均化' },
  reverse:      { icon: '🔄', name: '反向卡',   desc: '下次掷骰反向行走' },
};
const WAIT_LABEL = { buy: '考虑收购', jail: '设法脱身', itemUse: '抉择道具', roll: '掷骰', endTurn: '回合收尾', trade: '考虑交易' };

/** 把服务器快照还原成带方法的 GameState 镜像 */
function revive(data) {
  const g = new GameState([]);
  Object.assign(g, data);
  g.mortgaged = new Set(data.mortgaged || []);
  if (!g.marketHeat) g.marketHeat = Object.fromEntries(STOCK_INDUSTRIES.map(k => [k, 0]));
  if (!g.newsMult) g.newsMult = Object.fromEntries(STOCK_INDUSTRIES.map(k => [k, 1]));
  for (const p of g.players || []) {
    if (!p.stocks) p.stocks = Object.fromEntries(STOCK_INDUSTRIES.map(k => [k, 0]));
    if (!p.shorts) p.shorts = Object.fromEntries(STOCK_INDUSTRIES.map(k => [k, 0]));
    if (p.items && p.items.intel == null) p.items.intel = 0;
    if (p.items && p.items.permit == null) p.items.permit = 0;
    if (p.items && p.items.charter == null) p.items.charter = 0;
    if (p.freeDrawsLeft == null) p.freeDrawsLeft = 0;
    if (p.paidDrawsUsed == null) p.paidDrawsUsed = 0;
    if (p.company && !p.company.holders) {
      p.company.holders = { [p.id]: 100 };
      p.company.totalShares = 100;
      p.company.freeFloat = 0;
      p.company.pledged = 0;
      p.company.ipo = !!p.company.ipo;
    }
  }
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

/** 联机版弹窗（挂在 #modal/#modal-box，与 UI 艺术 grid 壳共用） */
const modal = () => document.getElementById('modal');
const modalBox = () => document.getElementById('modal-box');
/** @type {import('../ui/ui.js').UI | null} */
let _uiRef = null;
function openModal(html, opts = {}) {
  if (_uiRef?._openModal) {
    _uiRef._openModal(html, opts);
    return;
  }
  // 进局前兜底
  modalBox().innerHTML = html;
  modal().classList.remove('hidden');
}
function closeModal() {
  if (_uiRef?.closeModal) {
    _uiRef.closeModal();
    return;
  }
  modal().classList.add('hidden');
}

export async function startOnline(world, ui) {
  injectCSS();
  _uiRef = ui;
  ui.bindWorld?.(world);

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
  let acting = false;
  let myRoundEnded = false;
  let currentRound = begin.state.round || 0;
  const deadTokens = new Set();
  let panelOpen = null;
  let over = false;

  world.setPlayerCount(begin.roster.length);
  // 按镜像状态落子（中途加入/重连时位置与逻辑一致）
  for (const p of mirror.players) {
    if (!p.bankrupt) world.createToken(p.id, p.position ?? 0);
  }
  world.onPick((tileIdx, x, y) => ui.showTileInfo(tileIdx, mirror, x, y));

  // 牌桌按钮：操作改为发消息给服务器
  const cardsBtn = document.createElement('button');
  cardsBtn.id = 'btn-cards';
  cardsBtn.textContent = '🃏 卡牌';
  cardsBtn.disabled = true;
  $('#btn-company').after(cardsBtn);
  const marketBtn = document.createElement('button');
  marketBtn.id = 'btn-market';
  marketBtn.textContent = '🏴 黑市';
  cardsBtn.after(marketBtn);

  const setActing = (on) => {
    acting = on;
    cardsBtn.disabled = !on;
    marketBtn.disabled = !on;
  };
  const tryOpen = (name, fn) => {
    if ((!acting || myRoundEnded) && name !== 'stock') return;
    if (ui.modalOpen || over) return;
    fn();
  };
  $('#btn-build').onclick = () => tryOpen('build', openBuild);
  $('#btn-bank').onclick = () => tryOpen('bank', openBank);
  $('#btn-company').onclick = () => tryOpen('company', openCompanyOnline);
  $('#btn-stock')?.addEventListener('click', () => openStock(!!acting && !myRoundEnded));
  if (ui.el.btnStock) ui.el.btnStock.disabled = false;
  cardsBtn.onclick = () => tryOpen('cards', openCards);
  marketBtn.onclick = () => openBlackMarketOnline();
  $('#btn-trade').onclick = () => tryOpen('invest', openInvest);

  ui.el.btnRoll.textContent = '🎲 掷骰';
  ui.el.btnRoll.onclick = () => {
    if (myRoundEnded || !acting) return;
    ui.el.btnRoll.disabled = true;
    send({ t: 'roll' });
    ui.toast('掷骰已发送…', 800);
  };
  ui.el.btnEnd.textContent = '✅ 结束回合';
  ui.el.btnEnd.onclick = () => {
    if (myRoundEnded) return;
    myRoundEnded = true;
    send({ t: 'endRound' });
    world.clearHandCards();
    ui.setButtons({ stock: true, roll: false });
    setActing(false);
    ui.el.itemBar.innerHTML = '';
    ui.setTurnInfo('⏳ 已结束回合，等待其他玩家…');
    if (panelOpen === 'stock') stockUi?.refresh?.();
    else if (panelOpen === 'invest') investUi?.refresh?.();
    else if (panelOpen) { closeModal(); panelOpen = null; }
  };
  $('#btn-camera').onclick = () => {
    const mode = world.cycleCameraMode();
    ui.setCameraLabel(mode);
    const tips = {
      follow: '📷 跟随当前玩家',
      free: '📷 自由视角（骰子特写不会抢镜）',
      orbit: '🎥 通天观战 · 自动环绕棋盘',
    };
    ui.toast(tips[mode] || tips.follow, 1600);
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
    updateStaminaBars();
    ui.renderIndustries(mirror);
    world.syncLivingZones?.(mirror.players, PLAYER_COLORS);
    if (panelOpen === 'stock') {
      stockUi?.refresh?.();
    } else if (panelOpen) {
      if (ui.modalOpen) rerenderPanel();
      else panelOpen = null;
    }
  }
  function updateStaminaBars() {
    const cards = document.querySelectorAll('.player-card');
    cards.forEach(el => {
      const pid = parseInt(el.dataset.pid);
      const p = mirror.players[pid];
      if (!p || p.bankrupt) return;
      let bar = el.querySelector('.stamina-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'stamina-bar';
        bar.style.cssText = 'height:3px;background:rgba(255,255,255,.1);border-radius:2px;margin-top:3px;overflow:hidden';
        bar.innerHTML = '<div class="stamina-fill" style="height:100%;border-radius:2px;transition:width .3s"></div>';
        el.querySelector('.pmeta')?.after(bar);
      }
      const fill = bar.querySelector('.stamina-fill');
      const ratio = (p.stamina || 0) / STAMINA_MAX;
      fill.style.width = `${ratio * 100}%`;
      fill.style.background = ratio > 0.5 ? '#6dff9a' : ratio > 0.2 ? '#f0c75e' : '#e74c3c';
      bar.title = `体力 ${p.stamina || 0}/${STAMINA_MAX}`;
    });
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
      case 'roundStart': onRoundStart(m); break;
      case 'newRound': onNewRound(m); break;
      case 'playerEnded': onPlayerEnded(m); break;
      case 'phase': onPhase(m); break;
      case 'dice': enqueue(() => world.animateDice(m.d1, m.d2)); break;
      case 'move': enqueue(() => world.moveToken(m.player, m.from, m.steps)); break;
      case 'tele': enqueue(() => {
        const pl = mirror.players[m.player];
        const name = m.playerName || pl?.name;
        return world.teleportToken(m.player, m.from, m.to, { playerName: name });
      }); break;
      case 'card': enqueue(() => ui.showCard(m.card, m.deck, m.player !== mySeat)); break;
      case 'itemCast': enqueue(async () => {
        const pl = mirror.players[m.playerId] || { id: m.playerId, name: m.name || '玩家' };
        const mine = m.playerId === mySeat;
        await ui.showItemCast?.(pl, m.item, { silent: mine, skipFx: mine });
      }); break;
      case 'holo': enqueue(() => ui.showHoloNotice({
        kind: m.kind || 'notice',
        icon: m.icon || '📡',
        title: m.title || '通知',
        text: m.text || '',
        auto: m.auto !== false,
        duration: m.duration || 3800,
      })); break;
      case 'ask': enqueue(() => onAsk(m)); break;
      case 'tradeResult': enqueue(() => onTradeResult(m)); break;
      case 'over': enqueue(() => onOver(m)); break;
      case 'error': ui.toast(m.msg); break;
      case 'marketRefresh': renderMirror(); if (panelOpen === 'bmarket') renderBlackMarket(); break;
    }
  };

  function onRoundStart(m) {
    currentRound = m.round;
    myRoundEnded = false;
    const me = () => mirror.players[mySeat];
    const myP = me();
    ui.setTurnInfo(`🔄 第 ${m.round + 1} 回合 · 同步行动中 · 体力 ${myP ? (myP.stamina || 0) : '?'}/${STAMINA_MAX}`);
    setActing(true);
    myRoundEnded = false;
    const staminaOk = myP && (myP.stamina || 0) >= STAMINA_DICE;
    ui.setButtons({ roll: staminaOk && !myRoundEnded, end: true, build: true, bank: true, trade: true, company: true, stock: true });
    if (myP && (myP.stamina || 0) > 0) {
      ui.toast(`🔄 第 ${m.round + 1} 回合开始！体力 ${myP.stamina}/${STAMINA_MAX}`);
    } else {
      ui.toast(`🔄 第 ${m.round + 1} 回合开始！体力不足，等待下回合恢复…`);
      ui.setButtons({ roll: false, end: true, build: false, bank: false, trade: false, company: false, stock: true });
    }
    world.clearHandCards();
    ui.el.itemBar.innerHTML = '';
    updateStaminaBars();
  }

  function onNewRound(m) {
    if (m.state) { mirror = revive(m.state); renderMirror(); }
    currentRound = m.round;
    myRoundEnded = false;
    const me = () => mirror.players[mySeat];
    const myP = me();
    ui.setTurnInfo(`🔄 第 ${m.round + 1} 回合 · 同步行动中 · 体力 ${myP ? (myP.stamina || 0) : '?'}/${STAMINA_MAX}`);
    setActing(true);
    const staminaOk = myP && (myP.stamina || 0) >= STAMINA_DICE;
    ui.setButtons({ roll: staminaOk && !myRoundEnded, end: true, build: true, bank: true, trade: true, company: true, stock: true });
    updateStaminaBars();
  }

  function onPlayerEnded(m) {
    const p = mirror.players[m.seat];
    if (p) {
      ui.log(`🏁 ${p.name} 已结束回合（体力 ${m.stamina}/${STAMINA_MAX}）`, 'muted');
    }
    updateStaminaBars();
  }
  ws.onclose = () => {
    if (over) return;
    ui.toast('与服务器断开连接', 5000);
    ui.setButtons({});
    setActing(false);
  };

  function onPhase(m) {
    const p = mirror.players[m.playerId];
    const me = () => mirror.players[mySeat];
    if (m.name === 'turnStart') {
      activeId = m.playerId;
      world.setFollow(m.playerId);
      ui.setTurnInfo(`🎯 ${p ? p.name : ''} 同步行动中`);
      if (m.playerId === mySeat) {
        ui.setButtons({ roll: (me().stamina || 0) >= STAMINA_DICE, build: true, bank: true, trade: true, company: true, stock: true });
      }
      setActing(false);
      ui.el.itemBar.innerHTML = '';
      ui.renderPlayers(mirror, activeId);
    } else if (m.name === 'waitRoll' && m.playerId !== mySeat) {
      world.clearHandCards();
      ui.setTurnInfo(`⏳ ${p ? p.name : '对手'} 行动中… · 可点「股市」观战行情`);
      ui.setButtons({ stock: true });
    } else if (m.name === 'endTurn' && m.playerId !== mySeat) {
      world.clearHandCards();
      ui.setTurnInfo(`⏳ ${p ? p.name : '对手'} 操作中… · 可点「股市」观战行情`);
      ui.setButtons({ stock: true });
    }
  }

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
      case 'bankPledge': {
        const yes = await ui.promptBankPledge(me(), { shares: m.shares || 5, loan: m.loan || 40 });
        send({ t: 'resp', reqId: m.reqId, value: !!yes });
        break;
      }
      case 'trade': {
        const accept = await incomingTradeUI(m);
        send({ t: 'tradeResp', reqId: m.reqId, accept });
        break;
      }
    }
  }

  /** 人类卖方收到的要约 */
  function incomingTradeUI(m) {
    const t = TILES[m.tileIdx];
    openModal(`
      <h2>🤝 收购要约</h2>
      <div class="modal-body">
        <p><b>${m.fromName}</b> 想出价 <b style="color:var(--gold)">${formatMoney(m.price)}</b> 收购你的 <b>${t.name}</b>（市值 ${formatMoney(t.price)}）。</p>
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
    else if (panelOpen === 'company') renderCompanyOnline();
    else if (panelOpen === 'cards') renderCards();
    else     if (panelOpen === 'stock') renderStock();
    if (panelOpen === 'bmarket') renderBlackMarket();
    else if (panelOpen === 'invest') renderInvest();
  }

  // ---------- 入股（全屏） ----------
  let investUi = null;
  function openInvest() {
    panelOpen = 'invest';
    import('../ui/investMarket.js').then(({ openInvestMarket }) => {
      investUi?.close?.();
      const canTrade = !!acting;
      const api = openInvestMarket(mirror, me(), () => {}, {
        log: (html, cls) => ui.log(html, cls),
        toast: (m) => ui.toast(m),
      }, canTrade ? {
        invest: (founderId, n = 1, fromFloat = false) =>
          send({ t: 'op', op: 'invest', founderId, n, fromFloat: !!fromFloat }),
      } : {}, { tradeable: canTrade });
      const orig = api.close;
      api.close = () => { orig(); panelOpen = null; investUi = null; };
      investUi = api;
    });
  }
  function renderInvest() {
    investUi?.refresh?.();
  }

  function openCompanyOnline() { panelOpen = 'company'; renderCompanyOnline(); }
  function renderCompanyOnline() {
    const p = me();
    if (!p.company) {
      openCompany();
      return;
    }
    const c = p.company;
    const ind = INDUSTRIES[c.industry] || { icon: '🏢', name: '公司', css: '#888' };
    const st = INDUSTRY_STATES[mirror.industry[c.industry] ?? 1];
    const charters = p.items?.charter || 0;
    const held = c.holders?.[mySeat] ?? 0;
    const unit = mirror.companySharePrice?.(p) ?? 0;
    const value = mirror.companyValue?.(p) ?? 0;
    const myRev = mirror.companyRevenue?.(p) ?? 0;
    modal()?.classList.add('company-fs');
    modalBox()?.classList.add('company-wide');
    openModal(`
      <div class="company-fs-shell">
        <header class="company-fs-head co-hero" style="background:
          radial-gradient(ellipse 70% 100% at 100% 0%, ${ind.css}33, transparent 55%),
          linear-gradient(135deg, #152238, #0b1320)">
          <div class="co-hero-top">
            <div class="co-hero-icon" style="border-color:${ind.css}88">${ind.icon}</div>
            <div class="co-hero-meta">
              <h2>🏢 ${p.name} · ${ind.name}
                <span class="co-badge lv">Lv${c.level}/${COMPANY_MAX_LEVEL}</span>
                ${c.ipo ? '<span class="co-badge ipo">IPO</span>' : '<span class="co-badge private">未上市</span>'}
              </h2>
              <div class="co-sub">${ind.name} · 景气 ${st.icon}${st.name}
                · 现金 ${formatMoney(p.money)} · 📜 公司卡 ${charters}</div>
            </div>
          </div>
        </header>
        <div class="company-fs-body">
          <div class="co-panel co-panel-kpis">
            <div class="co-kpi-grid">
              <div class="co-kpi"><div class="k">估值</div><div class="v">${formatMoney(value)}</div></div>
              <div class="co-kpi"><div class="k">每股</div><div class="v">${formatMoney(unit)}</div></div>
              <div class="co-kpi"><div class="k">本回合营收</div><div class="v">${formatMoney(myRev)}</div></div>
              <div class="co-kpi"><div class="k">持股 / 质押 / 池</div>
                <div class="v soft">${held} / ${c.pledged || 0} / ${c.freeFloat || 0}</div></div>
            </div>
          </div>
          <div class="co-panel co-panel-ops" style="grid-column:1/-1;grid-row:2">
            <h3>经营操作</h3>
            <div class="co-actions">
              <button type="button" class="co-act primary-act" data-up ${mirror.canUpgradeCompany(p) ? '' : 'disabled'}>
                <div class="t">⬆️ 升级</div><div class="d">需 📜 公司卡</div>
              </button>
              <button type="button" class="co-act" data-ipo>
                <div class="t">📢 IPO</div><div class="d">${c.ipo ? '已上市' : '启动上市'}</div>
              </button>
              <button type="button" class="co-act danger-act" data-pledge>
                <div class="t">🏦 质押 5 股</div><div class="d">银行贷款</div>
              </button>
              <button type="button" class="co-act" data-close>
                <div class="t">关闭</div><div class="d">返回棋盘</div>
              </button>
            </div>
          </div>
        </div>
        <footer class="company-fs-foot btn-row">
          <button type="button" class="primary" data-close>完 成</button>
        </footer>
      </div>`, { layout: 'wide', kind: 'company' });
    modalBox().querySelector('[data-up]')?.addEventListener('click', () => send({ t: 'op', op: 'upgradeCompany' }));
    modalBox().querySelector('[data-ipo]')?.addEventListener('click', () => send({ t: 'op', op: 'ipo' }));
    modalBox().querySelector('[data-pledge]')?.addEventListener('click', () => send({ t: 'op', op: 'pledge', n: 5 }));
    bindClose();
  }

  // ---------- 股市（全屏 K 线） ----------
  let stockUi = null;
  function openStock(tradeable = false) {
    panelOpen = 'stock';
    import('../ui/stockMarket.js').then(({ openStockMarket }) => {
      stockUi?.close?.();
      const canTrade = !!tradeable && !!acting;
      // 观战：仍传入完整 mirror + 本座位玩家（用于高亮「我的持仓」），只读展示全场
      const api = openStockMarket(mirror, me(), () => {}, {
        log: (html, cls) => ui.log(html, cls),
        toast: (m) => ui.toast(m),
      }, canTrade ? {
        buy: (key, n = 1) => send({ t: 'op', op: 'buyStock', industry: key, n }),
        sell: (key, n = 1) => send({ t: 'op', op: 'sellStock', industry: key, n }),
        openShort: (key, n = 1) => send({ t: 'op', op: 'openShort', industry: key, n }),
        coverShort: (key, n = 1) => send({ t: 'op', op: 'coverShort', industry: key, n }),
      } : {}, { tradeable: canTrade, readOnly: !canTrade });
      const orig = api.close;
      api.close = () => { orig(); panelOpen = null; stockUi = null; };
      stockUi = api;
    });
  }
  function renderStock() {
    stockUi?.refresh?.();
  }

  function bindClose() {
    modalBox().querySelectorAll('[data-close]').forEach((el) => {
      el.onclick = () => {
        modal()?.classList.remove('company-fs');
        modalBox()?.classList.remove('company-wide');
        closeModal();
        panelOpen = null;
      };
    });
  }

  // ---------- 建楼 ----------
  function openBuild() { panelOpen = 'build'; renderBuild(); }
  function renderBuild() {
    const p = me();
    const props = mirror.playerProperties(mySeat).filter(i => TILES[i].type === 'property');
    const permits = p.items?.permit || 0;
    let rows = '';
    for (const i of props) {
      const t = TILES[i], h = mirror.houses[i];
      const stars = h >= 5 ? '🏙️ 地标' : '🏬'.repeat(h) + '·'.repeat(4 - h);
      rows += `<div class="build-prop">
        <span class="bp-name">${INDUSTRIES[t.color].icon}${t.name}</span>
        <span class="bp-houses">${stars}</span>
        <button data-build="${i}" ${mirror.canBuild(p, i) ? '' : 'disabled'}>＋建 ${formatMoney(t.houseCost)}</button>
        <button data-sell="${i}" ${mirror.canSellHouse(p, i) ? '' : 'disabled'}>－卖</button>
      </div>`;
    }
    openModal(`
      <h2>🏠 楼宇建设 <small style="color:#9ab">现金 ${formatMoney(p.money)} · 🏗️ 建设卡 ${permits} · 每级消耗 1 张</small></h2>
      <div class="modal-body">
        ${permits < 1 ? '<p style="color:#e67e22">没有建设卡，无法建楼。</p>' : ''}
        ${rows || '<p class="muted">你还没有地产。</p>'}
      </div>
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
          ? `<button data-unmort="${i}" ${mirror.canUnmortgage(p, i) ? '' : 'disabled'}>赎回 ${formatMoney(mirror.unmortgageCost(i))}</button>`
          : `<button data-mort="${i}" ${mirror.canMortgage(p, i) ? '' : 'disabled'}>抵押 +${formatMoney(mirror.mortgageValue(i))}</button>`}
      </div>`;
    }
    openModal(`
      <h2>🏦 帝国银行</h2>
      <div class="modal-body">
        <div class="panel-section">
          <h3>💰 信贷 <small class="muted">每回合债务计息 5%</small></h3>
          <div class="panel-row"><span class="grow">现金 <b style="color:var(--gold)">${formatMoney(p.money)}</b>　债务 <b class="debt">${formatMoney(p.debt)}</b></span></div>
          <div class="panel-row"><span class="grow">信用额度 ${formatMoney(limit)}，可用 <b>${avail}</b></span></div>
          <div class="panel-row"><span>借款：</span>
            ${[ttc(100), ttc(300), ttc(500)].map(v => `<button data-borrow="${v}" ${mirror.canBorrow(p, v) ? '' : 'disabled'}>+${formatMoney(v)}</button>`).join('')}
          </div>
          <div class="panel-row"><span>还款：</span>
            ${[ttc(100), ttc(500)].map(v => `<button data-repay="${v}" ${p.debt > 0 && p.money > 0 ? '' : 'disabled'}>-${formatMoney(v)}</button>`).join('')}
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

  // ---------- 公司（全屏 grid） ----------
  function openCompany() { panelOpen = 'company'; renderCompany(); }
  function renderCompany() {
    const p = me();
    const charters = p.items?.charter || 0;
    modal()?.classList.add('company-fs');
    modalBox()?.classList.add('company-wide');
    if (!p.company) {
      const canFound = mirror.canFoundCompany(p);
      const cards = Object.entries(INDUSTRIES)
        .filter(([k]) => k !== 'railroad' && k !== 'utility')
        .map(([k, ind]) => {
          const st = INDUSTRY_STATES[mirror.industry[k] ?? 1];
          return `<button type="button" class="co-found-card" data-ind="${k}" ${canFound ? '' : 'disabled'}
            style="border-color:${ind.css}44;--ind:${ind.css}">
            <div class="fi">${ind.icon}</div>
            <div class="fn">${ind.name}</div>
            <div class="fs">景气 ${st.icon}${st.name} · ×${st.mult}</div>
            <div class="fm"><span>选此赛道</span></div>
          </button>`;
        }).join('');
      openModal(`
        <div class="company-fs-shell">
          <header class="company-fs-head co-hero" style="background:linear-gradient(135deg,#1a2a44,#0c1524)">
            <div class="co-hero-top">
              <div class="co-hero-icon">🏢</div>
              <div class="co-hero-meta">
                <h2>创办商业帝国</h2>
                <div class="co-sub">注册费 <b style="color:var(--gold)">${formatMoney(COMPANY_FOUND_COST)}</b>
                  · 📜 公司卡 ${charters} · 现金 ${formatMoney(p.money)}</div>
                ${charters < 1 ? '<div class="co-sub" style="color:#e67e22;margin-top:6px">没有公司卡，无法创办</div>' : ''}
              </div>
            </div>
          </header>
          <div class="company-fs-body co-found-layout">
            <div class="co-panel co-panel-span">
              <h3>选择赛道</h3>
              <div class="co-found-grid">${cards}</div>
            </div>
          </div>
          <footer class="company-fs-foot btn-row">
            <button type="button" data-close>再想想</button>
          </footer>
        </div>`, { layout: 'wide', kind: 'company' });
      modalBox().querySelectorAll('[data-ind]').forEach(b => {
        b.onclick = () => send({ t: 'op', op: 'foundCompany', industry: b.dataset.ind });
      });
      bindClose();
      return;
    }
    // 已有公司时走完整 HQ 全屏
    renderCompanyOnline();
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

  function openBlackMarketOnline() { panelOpen = 'bmarket'; renderBlackMarket(); }
  function renderBlackMarket() {
    if (!mirror) return;
    const panel = document.getElementById('black-market');
    const body = document.getElementById('black-market-body');
    const closeBtn = panel?.querySelector('.black-market-close');
    if (!panel || !body) return;
    panel.classList.remove('hidden');

    const closePanel = () => {
      panel.classList.add('hidden');
      panelOpen = null;
      if (closeBtn) closeBtn.onclick = null;
    };
    if (closeBtn) closeBtn.onclick = closePanel;
    // Esc 键关闭
    const onEsc = (e) => { if (e.key === 'Escape') { closePanel(); window.removeEventListener('keydown', onEsc); } };
    window.addEventListener('keydown', onEsc);

    const p = me();
    const market = mirror.blackMarket || [];
    const total = mirror.countItems?.(p) || 0;
    const room = Math.max(0, HAND_CAP - total);
    const myListings = market.filter(e => e.sellerId === mySeat);
    const otherListings = market.filter(e => e.sellerId !== mySeat);
    const pending = p.pendingListings || [];

    const row = (e, isMine) => {
      const seller = mirror.players[e.sellerId] || { name: '???' };
      const meta = ITEMS[e.item] || { icon: '🃏', name: e.item };
      return `<div class="panel-row">
        <span class="grow">${meta.icon} ${meta.name} · ${seller.name} · <b style="color:var(--gold)">${formatMoney(e.price)}</b></span>
        ${isMine
          ? `<button data-bm="unlist" data-id="${e.id}" ${room <= 0 ? 'disabled' : ''}>下架</button>`
          : `<button data-bm="buy" data-id="${e.id}" ${room <= 0 ? 'disabled' : ''}>买入</button>`}
      </div>`;
    };

    const pendingRows = pending.length
      ? pending.map((item, idx) => {
        const meta = ITEMS[item] || { icon: '🃏', name: item };
        const base = 100000;
        return `<div class="panel-row">
          <span class="grow">📦 待定价：${meta.icon} ${meta.name} · 参考 ${formatMoney(base)}</span>
          <button data-bm="price" data-idx="${idx}" data-item="${item}" data-val="${Math.round(base*0.5)}">½</button>
          <button data-bm="price" data-idx="${idx}" data-item="${item}" data-val="${base}">1×</button>
          <button data-bm="price" data-idx="${idx}" data-item="${item}" data-val="${Math.round(base*2)}">2×</button>
        </div>`;
      }).join('')
      : '';

    body.innerHTML = `
      <div class="bm-section">
        <div class="bm-info">手牌 <b style="color:var(--gold)">${total}</b>/10 · 可买入 <b style="color:#6dff9a">${room}</b> 张</div>
        ${room <= 0 ? '<div class="bm-warn">⚠️ 手牌已满，无法买入或下架</div>' : ''}
      </div>
      ${pending.length
        ? `<div class="bm-section">
          <h3 style="color:#f0c75e">📦 待定价（${pending.length} 张）</h3>
          ${pendingRows}
        </div>`
        : ''}
      ${myListings.length
        ? `<div class="bm-section">
          <h3 style="color:#9fd4ff">我的挂牌（${myListings.length}）</h3>
          ${myListings.map(e => row(e, true)).join('')}
        </div>`
        : '<div class="bm-section"><p class="muted">你还没有在售卡牌</p></div>'}
      ${otherListings.length
        ? `<div class="bm-section">
          <h3 style="color:#6dff9a">在售卡牌（${otherListings.length}）</h3>
          ${otherListings.map(e => row(e, false)).join('')}
        </div>`
        : '<div class="bm-section"><p class="muted">暂无其他玩家挂售</p></div>'}`;

    body.querySelectorAll('[data-bm="buy"]').forEach(b => {
      b.onclick = () => { send({ t: 'op', op: 'buyCard', listingId: +b.dataset.id }); };
    });
    body.querySelectorAll('[data-bm="unlist"]').forEach(b => {
      b.onclick = () => { send({ t: 'op', op: 'unlistCard', listingId: +b.dataset.id }); };
    });
    body.querySelectorAll('[data-bm="price"]').forEach(b => {
      b.onclick = () => { send({ t: 'op', op: 'listCard', item: b.dataset.item, price: +b.dataset.val }); };
    });
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
        label: `${q.name}（现金 ${formatMoney(q.money)}）`,
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
          label: `${TILES[j].name}（市值 ${formatMoney(TILES[j].price)}）`,
          cb: () => pickRow(`🔁 第三步：选择你要给出的地产`, mine.map(i => ({
            label: `${TILES[i].name}（市值 ${formatMoney(TILES[i].price)}）`,
            cb: () => send({ t: 'op', op: 'playCard', item: 'swap', myTile: i, targetTile: j }),
          })), back),
        })), back),
      })), back);
      return;
    }
    if (item === 'intel') {
      pickRow(`📰 资讯方向`, [
        { label: '📈 发布利好', cb: () => {
          const keys = STOCK_INDUSTRIES;
          pickRow(`选择行业`, keys.map(k => ({
            label: `${INDUSTRIES[k].icon} ${INDUSTRIES[k].name}`,
            cb: () => send({ t: 'op', op: 'intel', industry: k, mode: 'up' }),
          })), back);
        }},
        { label: '📉 发布利空', cb: () => {
          const keys = STOCK_INDUSTRIES;
          pickRow(`选择行业`, keys.map(k => ({
            label: `${INDUSTRIES[k].icon} ${INDUSTRIES[k].name}`,
            cb: () => send({ t: 'op', op: 'intel', industry: k, mode: 'down' }),
          })), back);
        }},
      ], back);
      return;
    }
    if (item === 'audit' || item === 'freeze') {
      const targets = mirror.players.filter(q => q.id !== mySeat && !q.bankrupt);
      pickRow(`选择目标玩家`, targets.map(q => ({
        label: `${q.name}（现金 ${formatMoney(q.money)}）`,
        cb: () => send({ t: 'op', op: 'playCard', item, targetId: q.id }),
      })), back);
      return;
    }
    if (item === 'poach') {
      const targets = mirror.players.filter(q => q.id !== mySeat && !q.bankrupt && Object.values(q.items || {}).some(v => v > 0));
      if (!targets.length) { ui.toast('对手都没有道具卡'); return; }
      pickRow(`选择目标玩家`, targets.map(q => ({
        label: `${q.name}`,
        cb: () => send({ t: 'op', op: 'playCard', item, targetId: q.id }),
      })), back);
      return;
    }
    if (item === 'warp') {
      const mine = mirror.playerProperties(mySeat);
      if (!mine.length) { ui.toast('你名下没有地产'); return; }
      pickRow(`选择传送目的地`, mine.map(i => ({
        label: `${TILES[i].name}（${formatMoney(TILES[i].price)}）`,
        cb: () => send({ t: 'op', op: 'playCard', item: 'warp', tileIdx: i }),
      })), back);
      return;
    }
    // 无目标直接打出
    send({ t: 'op', op: 'playCard', item });
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
        <div id="ol-room-list" style="margin-top:12px;max-height:160px;overflow-y:auto"></div>
        <button class="ol-btn" id="ol-refresh" style="margin-top:8px;width:100%;">🔄 刷新房间列表</button>
        <p class="ol-hint">房号为 4 位字符，由创建者分享给好友<br/>局域网联机请把地址改为房主 IP</p>`);
      el.querySelector('#ol-create').onclick = () => doConnect('create');
      el.querySelector('#ol-join').onclick = () => doConnect('join');
      // 刷新房间列表
      const doListRooms = () => {
        const url = $('#ol-url').value.trim();
        const sock = new WebSocket(url);
        sock.onopen = () => sock.send(JSON.stringify({ t: 'listRooms' }));
        sock.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data.t === 'roomList') {
              const listEl = $('#ol-room-list');
              if (data.list.length) {
                listEl.innerHTML = data.list.map(r => `
                  <div class="ol-room-row" style="padding:6px 8px;margin:4px 0;border-radius:6px;background:rgba(255,255,255,0.05);cursor:pointer"
                       onclick="$('#ol-code').value='${r.code}';ui.toast('已填入房号：${r.code}')">
                    <span style="color:var(--gold)">🏠 ${r.code}</span>
                    <span style="margin-left:8px;color:#9ab">${r.name} · ${r.humans}人 · ${r.seats}座</span>
                  </div>`).join('');
              } else {
                listEl.innerHTML = '<p class="ol-hint">暂无可用房间，创建你自己的吧</p>';
              }
            }
          } catch {}
          sock.close();
        };
        sock.onerror = () => { const listEl = $('#ol-room-list'); if (listEl) listEl.innerHTML = '<p class="ol-hint" style="color:#e67e22">无法连接服务器获取房间列表</p>'; };
      };
      el.querySelector('#ol-refresh').onclick = () => doListRooms();
      doListRooms(); // 打开页面自动拉一次
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
