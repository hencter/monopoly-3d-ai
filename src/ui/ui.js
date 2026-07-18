// DOM UI：开始界面、HUD、行业条、银行/交易/公司/设置面板、聊天、道具栏、弹窗
import {
  TILES, INDUSTRIES, INDUSTRY_STATES, ITEMS, PLAYABLE_ITEMS, JAIL_FINE,
  COMPANY_FOUND_COST, COMPANY_MAX_LEVEL, companyUpgradeCost,
} from '../data/tiles.js';
import { PLAYER_COLORS_CSS, MAX_PLAYERS } from '../three/world.js';

const $ = (s) => document.querySelector(s);
const ownable = (t) => ['property', 'railroad', 'utility'].includes(t.type);

export class UI {
  constructor() {
    this.el = {
      players: $('#players'), actions: $('#actions'), turnInfo: $('#turn-info'),
      btnRoll: $('#btn-roll'), btnBuild: $('#btn-build'), btnEnd: $('#btn-end'),
      btnBank: $('#btn-bank'), btnTrade: $('#btn-trade'), btnCompany: $('#btn-company'),
      btnCamera: $('#btn-camera'), btnSettings: $('#btn-settings'),
      itemBar: $('#item-bar'), industries: $('#industries'),
      log: $('#log'), logWrap: $('#log-wrap'),
      chatWrap: $('#chat-wrap'), chatLog: $('#chat-log'), chatInput: $('#chat-input'), chatSend: $('#chat-send'),
      modal: $('#modal'), modalBox: $('#modal-box'),
      toast: $('#toast'), tileInfo: $('#tile-info'),
      startScreen: $('#start-screen'), playerSetup: $('#player-setup'),
      countLabel: $('#player-count-label'),
    };
    this.el.chatSend.onclick = () => this._sendChat();
    this.el.chatInput.onkeydown = (e) => { if (e.key === 'Enter') this._sendChat(); };
  }

  _sendChat() {
    const text = this.el.chatInput.value.trim();
    if (!text) return;
    this.el.chatInput.value = '';
    this.onChatSend?.(text);
  }

  // ---------- 开始界面 ----------
  showStart() {
    return new Promise((resolve) => {
      // 存在存档时展示"继续对局"
      let saveInfo = null;
      try {
        const raw = localStorage.getItem('df_save_v1');
        if (raw) {
          const s = JSON.parse(raw);
          const alive = s.state.players.filter(p => !p.bankrupt).length;
          saveInfo = { total: s.state.players.length, alive, turn: s.state.turn, at: s.at };
        }
      } catch {}
      const continueWrap = $('#continue-game');
      if (saveInfo && continueWrap) {
        continueWrap.classList.remove('hidden');
        $('#continue-info').textContent =
          `${saveInfo.total} 人局 · 存活 ${saveInfo.alive} 人 · 第 ${saveInfo.turn} 回合 · ${new Date(saveInfo.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        $('#btn-continue').onclick = () => {
          this.el.startScreen.classList.add('hidden');
          resolve({ continue: true });
        };
        $('#btn-delete-save').onclick = () => {
          localStorage.removeItem('df_save_v1');
          continueWrap.classList.add('hidden');
        };
      }

      let count = 3;
      const defaults = Array.from({ length: MAX_PLAYERS }, (_, i) => `玩家${i + 1}`);
      const aiFlags = Array.from({ length: MAX_PLAYERS }, (_, i) => i !== 0);
      const snapshot = () => {
        this.el.playerSetup.querySelectorAll('input').forEach((inp, i) => { defaults[i] = inp.value; });
        this.el.playerSetup.querySelectorAll('select').forEach((s, i) => { aiFlags[i] = s.value === 'ai'; });
      };
      // 快捷人数档位
      const qc = $('#quick-count');
      if (qc) {
        for (const n of [2, 3, 4, 6, 8, 12, 16, 24, 34]) {
          const b = document.createElement('button');
          b.className = 'qc-chip';
          b.textContent = `${n}人`;
          b.onclick = () => { snapshot(); count = n; render(); };
          qc.appendChild(b);
        }
      }
      const render = () => {
        this.el.countLabel.textContent = `${count} 名玩家`;
        this.el.countLabel.style.color = count > 8 ? 'var(--gold)' : '';
        this.el.playerSetup.innerHTML = '';
        for (let i = 0; i < count; i++) {
          const row = document.createElement('div');
          row.className = 'setup-player';
          row.innerHTML = `
            <span class="dot" style="background:${PLAYER_COLORS_CSS[i]}"></span>
            <input maxlength="6" value="${defaults[i]}" data-i="${i}" />
            <select data-i="${i}">
              <option value="human" ${aiFlags[i] ? '' : 'selected'}>🧑 人类</option>
              <option value="ai" ${aiFlags[i] ? 'selected' : ''}>🤖 AI</option>
            </select>`;
          this.el.playerSetup.appendChild(row);
        }
      };
      render();
      $('#btn-add-player').onclick = () => { if (count < MAX_PLAYERS) { snapshot(); count++; render(); } };
      $('#btn-remove-player').onclick = () => { if (count > 2) { snapshot(); count--; render(); } };
      $('#btn-start').onclick = () => {
        const names = [...this.el.playerSetup.querySelectorAll('input')].map((inp, i) => inp.value.trim() || defaults[i]);
        const ais = [...this.el.playerSetup.querySelectorAll('select')].map(s => s.value === 'ai');
        if (ais.every(a => a)) ais[0] = false;
        this.el.startScreen.classList.add('hidden');
        resolve({ configs: names.map((name, i) => ({ name, isAI: ais[i] })) });
      };
      const onlineBtn = $('#btn-online');
      if (onlineBtn) onlineBtn.onclick = () => {
        this.el.startScreen.classList.add('hidden');
        resolve({ online: true });
      };
    });
  }

  enterGame() {
    for (const k of ['players', 'actions', 'logWrap', 'chatWrap', 'industries']) this.el[k].classList.remove('hidden');
  }

  // ---------- HUD ----------
  renderPlayers(game, activeIdx = -1) {
    const wrap = this.el.players;
    wrap.classList.toggle('compact', game.players.length > 8);
    wrap.innerHTML = '';
    for (const p of game.players) {
      const div = document.createElement('div');
      div.className = 'player-card' + (p.id === activeIdx ? ' active' : '') + (p.bankrupt ? ' bankrupt' : '');
      const props = game.playerProperties(p.id).length;
      const houses = game.playerProperties(p.id).reduce((s, i) => s + game.houses[i], 0);
      const itemCount = Object.values(p.items).reduce((a, b) => a + b, 0);
      div.innerHTML = `
        <div class="pname">
          <span class="dot" style="background:${PLAYER_COLORS_CSS[p.id]}"></span>
          <span>${p.name}</span>
          ${p.isAI ? '<span class="ai-badge">AI</span>' : ''}
        </div>
        <div class="pmoney">¥${p.money}${p.debt > 0 ? ` <small class="debt">债 ¥${p.debt}</small>` : ''}</div>
        <div class="pmeta">
          <span>🏢 ${props}</span><span>🏬 ${houses}</span>
          ${p.company ? `<span>${INDUSTRIES[p.company.industry].icon}Lv${p.company.level}</span>` : ''}
          ${itemCount ? `<span>🎒${itemCount}</span>` : ''}
          ${p.jailCards ? `<span>🃏×${p.jailCards}</span>` : ''}
          ${(p.skipTurns || 0) > 0 ? '<span>😴</span>' : ''}
        </div>
        ${p.inJail ? '<span class="jail-flag">⚖️</span>' : ''}
        ${p.bankrupt ? '<span class="jail-flag">💀</span>' : ''}`;
      wrap.appendChild(div);
    }
  }

  renderIndustries(game) {
    this.el.industries.innerHTML = Object.entries(game.industry)
      .filter(([k]) => k !== 'railroad' && k !== 'utility')
      .map(([k, v]) => {
        const ind = INDUSTRIES[k], st = INDUSTRY_STATES[v];
        return `<span class="ind-chip" style="border-color:${ind.css}66">${ind.icon}${ind.name} ${st.icon}</span>`;
      }).join('');
  }

  setTurnInfo(text) { this.el.turnInfo.textContent = text; }

  setButtons({ roll = false, build = false, end = false, bank = false, trade = false, company = false }) {
    this.el.btnRoll.disabled = !roll;
    this.el.btnBuild.disabled = !build;
    this.el.btnEnd.disabled = !end;
    this.el.btnBank.disabled = !bank;
    this.el.btnTrade.disabled = !trade;
    this.el.btnCompany.disabled = !company;
  }

  setCameraLabel(on) { this.el.btnCamera.textContent = on ? '📷 跟随' : '📷 自由'; }

  waitButton(which) {
    const btn = { roll: this.el.btnRoll, end: this.el.btnEnd }[which];
    return new Promise(res => {
      const h = () => { btn.removeEventListener('click', h); res(); };
      btn.addEventListener('click', h);
    });
  }

  // ---------- 道具栏 & 掷骰动作 ----------
  /** 渲染主动卡牌按钮到道具栏；onUse(item) 由外部执行效果 */
  renderCardBar(player, onUse) {
    const bar = this.el.itemBar;
    if (!player) { bar.innerHTML = ''; return; }
    for (const item of PLAYABLE_ITEMS) {
      const n = player.items[item] || 0;
      if (n <= 0) continue;
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `${ITEMS[item].icon}<span class="cnt">${n}</span>`;
      b.title = `${ITEMS[item].name}：${ITEMS[item].desc}`;
      b.onclick = async () => {
        await onUse(item);
        const left = player.items[item] || 0;
        if (left <= 0) b.remove();
        else b.querySelector('.cnt').textContent = left;
      };
      bar.appendChild(b);
    }
  }

  /**
   * 渲染道具栏并等待玩家的掷骰动作
   * @returns {Promise<{type:'roll', boost:boolean} | {type:'remote', total:number}>}
   */
  waitRollAction(player, { onUseCard } = {}) {
    return new Promise(resolve => {
      let boost = false;
      const bar = this.el.itemBar;
      bar.innerHTML = '';
      const done = (action) => { bar.innerHTML = ''; this.el.btnRoll.onclick = null; resolve(action); };

      this.el.btnRoll.onclick = () => done({ type: 'roll', boost });

      const mk = (item, onclick) => {
        const n = player.items[item] || 0;
        if (n <= 0) return;
        const b = document.createElement('button');
        b.className = 'item-btn';
        b.innerHTML = `${ITEMS[item].icon}<span class="cnt">${n}</span>`;
        b.title = `${ITEMS[item].name}：${ITEMS[item].desc}`;
        b.onclick = onclick;
        bar.appendChild(b);
        return b;
      };

      mk('remote', async () => {
        const n = await this.askNumber('🎯 遥控骰子：选择点数', 1, 6);
        if (n != null) done({ type: 'remote', total: n });
      });
      const boostBtn = mk('boost', () => {
        boost = !boost;
        boostBtn.classList.toggle('toggled', boost);
        this.toast(boost ? '🚀 加速卡已激活：本次 +3 步' : '已取消加速卡');
      });
      // 主动策略卡
      for (const item of PLAYABLE_ITEMS) {
        const b = mk(item, async () => {
          await onUseCard?.(item);
          const left = player.items[item] || 0;
          if (left <= 0) b?.remove();
          else b?.querySelector('.cnt') && (b.querySelector('.cnt').textContent = left);
        });
      }
      if ((player.items.rentFree || 0) > 0) {
        const b = document.createElement('button');
        b.className = 'item-btn';
        b.disabled = true;
        b.title = '免租卡：踩到他人地产时自动询问使用';
        b.innerHTML = `${ITEMS.rentFree.icon}<span class="cnt">${player.items.rentFree}</span>`;
        bar.appendChild(b);
      }
    });
  }

  /** 选择一名玩家（卡牌目标等） */
  askPlayer(title, players) {
    this._openModal(`
      <h2>${title}</h2>
      <div class="modal-body">
        ${players.map(p => `<div class="panel-row">
          <span class="dot" style="background:${PLAYER_COLORS_CSS[p.id]};display:inline-block;width:12px;height:12px;border-radius:50%"></span>
          <span class="grow">${p.name}（现金 ¥${p.money}）</span>
          <button data-p="${p.id}">选择</button>
        </div>`).join('')}
      </div>
      <div class="btn-row"><button data-p="">取消</button></div>`);
    return new Promise(res => {
      this.el.modalBox.querySelectorAll('[data-p]').forEach(b => {
        b.onclick = () => { this.closeModal(); res(b.dataset.p === '' ? null : +b.dataset.p); };
      });
    });
  }

  /** 换地卡：选对手 → 选双方地产 */
  openSwap(game, me, onPick) {
    const others = game.players.filter(p => p.id !== me.id && !p.bankrupt);
    const myTiles = game.playerProperties(me.id).filter(i => game.canSwapTile(me, i));
    if (!myTiles.length) { this.toast('你没有可交换的地产（须无建筑且未抵押）'); return; }
    const othersWithTiles = others.filter(o => game.playerProperties(o.id).some(i => game.canSwapTile(o, i)));
    if (!othersWithTiles.length) { this.toast('对手没有可交换的地产'); return; }
    this._openModal(`
      <h2>🔀 换地卡</h2>
      <div class="modal-body">
        <div class="panel-row"><span>对手：</span><select id="sw-player" class="grow">
          ${othersWithTiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select></div>
        <div class="panel-row"><span>我出：</span><select id="sw-mine" class="grow">
          ${myTiles.map(i => `<option value="${i}">${TILES[i].name}（¥${TILES[i].price}）</option>`).join('')}
        </select></div>
        <div class="panel-row"><span>换得：</span><select id="sw-theirs" class="grow"></select></div>
      </div>
      <div class="btn-row">
        <button class="primary" id="sw-ok">确认交换</button>
        <button data-close>取消</button>
      </div>`);
    const selP = $('#sw-player'), selT = $('#sw-theirs');
    const refresh = () => {
      const o = game.players[+selP.value];
      const list = game.playerProperties(o.id).filter(i => game.canSwapTile(o, i));
      selT.innerHTML = list.map(i => `<option value="${i}">${TILES[i].name}（¥${TILES[i].price}）</option>`).join('');
    };
    selP.onchange = refresh;
    refresh();
    $('#sw-ok').onclick = () => {
      const targetId = +selP.value, myTile = +$('#sw-mine').value, theirTile = +selT.value;
      this.closeModal();
      onPick({ targetId, myTile, theirTile });
    };
    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
  }

  askNumber(title, min, max) {
    const btns = Array.from({ length: max - min + 1 }, (_, i) => `<button data-n="${min + i}" style="font-size:20px;padding:10px 0;">${min + i}</button>`).join('');
    this._openModal(`
      <h2>${title}</h2>
      <div class="btn-row" style="display:grid;grid-template-columns:repeat(${max - min + 1},1fr);gap:8px;">${btns}</div>
      <div class="btn-row" style="margin-top:14px;"><button data-n="">取消</button></div>`);
    return new Promise(res => {
      this.el.modalBox.querySelectorAll('[data-n]').forEach(b => {
        b.onclick = () => { this.closeModal(); res(b.dataset.n === '' ? null : +b.dataset.n); };
      });
    });
  }

  // ---------- 日志 / 聊天 / 提示 ----------
  log(html, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.innerHTML = html;
    this.el.log.appendChild(div);
    this.el.log.scrollTop = this.el.log.scrollHeight;
    while (this.el.log.children.length > 150) this.el.log.firstChild.remove();
  }

  chatAdd({ from, color, text, sys = false }) {
    const div = document.createElement('div');
    if (sys) { div.className = 'sys'; div.textContent = text; }
    else div.innerHTML = `<span class="cname" style="color:${color}">${from}:</span>${text}`;
    this.el.chatLog.appendChild(div);
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
    while (this.el.chatLog.children.length > 80) this.el.chatLog.firstChild.remove();
  }

  toast(msg, ms = 1600) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.el.toast.classList.add('hidden'), ms);
  }

  // ---------- 弹窗基础 ----------
  _openModal(html) {
    this.el.modalBox.innerHTML = html;
    this.el.modal.classList.remove('hidden');
  }
  closeModal() { this.el.modal.classList.add('hidden'); }
  get modalOpen() { return !this.el.modal.classList.contains('hidden'); }

  _modalButtons() {
    return new Promise(res => {
      this.el.modalBox.querySelectorAll('[data-choice]').forEach(btn => {
        btn.onclick = () => { this.closeModal(); res(btn.dataset.choice); };
      });
    });
  }

  showThinking(name) {
    this._openModal(`<div class="card-display"><div class="card-icon">🤖</div><h2>${name} 思考中…</h2><div class="modal-body"><span class="muted">正在调用大模型决策</span></div></div>`);
  }

  // ---------- 决策弹窗 ----------
  promptBuy(player, tileIdx, game) {
    const t = TILES[tileIdx];
    let rentRows = '';
    if (t.type === 'property') {
      const labels = ['空地', '1级', '2级', '3级', '4级', '地标'];
      const mult = game.industryMult(t.color);
      const st = INDUSTRY_STATES[game.industry[t.color]];
      rentRows = `<p>行业：${INDUSTRIES[t.color].icon}${INDUSTRIES[t.color].name} ${st.icon}${st.name}（租金×${mult}）</p>
        <table>${t.rents.map((r, i) => `<tr><td>${labels[i]}</td><td>¥${Math.max(1, Math.round(r * mult))}</td></tr>`).join('')}</table>`;
    } else if (t.type === 'railroad') {
      rentRows = '<p>租金按拥有枢纽数：¥25 / ¥50 / ¥100 / ¥200</p>';
    } else {
      rentRows = '<p>租金 = 骰子点数 × 4（集齐两家 ×10）</p>';
    }
    this._openModal(`
      <h2>收购 ${t.name}？</h2>
      <div class="modal-body">
        <p>售价：<b style="color:var(--gold)">¥${t.price}</b>　你的现金：¥${player.money}</p>
        ${t.type === 'property' ? `<p>建筑成本：¥${t.houseCost}/级</p>` : ''}
        ${rentRows}
      </div>
      <div class="btn-row">
        <button class="primary" data-choice="buy">💰 收购</button>
        <button data-choice="skip">放弃</button>
      </div>`);
    return this._modalButtons().then(c => c === 'buy');
  }

  promptJail(player, { canPay, hasCard }) {
    this._openModal(`
      <h2>⚖️ ${player.name} 正在被约谈</h2>
      <div class="modal-body"><p>选择脱身方式（第 ${player.jailTurns + 1}/3 次尝试）：</p></div>
      <div class="btn-row">
        ${hasCard ? '<button class="primary" data-choice="card">🃏 免于约谈卡</button>' : ''}
        ${canPay ? `<button data-choice="pay">💸 缴 ¥${JAIL_FINE} 保证金</button>` : ''}
        <button data-choice="roll">🎲 掷双数碰运气</button>
      </div>`);
    return this._modalButtons();
  }

  promptItemUse(player, item, ctx) {
    this._openModal(`
      <h2>${ITEMS[item].icon} 使用${ITEMS[item].name}？</h2>
      <div class="modal-body"><p>即将支付租金 <b style="color:#ff8a80">¥${ctx.rent}</b>，使用免租卡可免除本次租金。</p></div>
      <div class="btn-row">
        <button class="primary" data-choice="yes">使用（剩 ${player.items.rentFree} 张）</button>
        <button data-choice="no">不用</button>
      </div>`);
    return this._modalButtons().then(c => c === 'yes');
  }

  showCard(card, deck, auto = false) {
    const isChance = deck === 'chance';
    this._openModal(`
      <div class="card-display ${isChance ? 'chance' : 'chest'}">
        <div class="card-icon">${isChance ? '🌪️' : '⚠️'}</div>
        <h2>${isChance ? '风口' : '风险'}</h2>
        <div class="modal-body">${card.text}</div>
        <div class="btn-row"><button class="primary" data-choice="ok">确 定</button></div>
      </div>`);
    if (auto) return new Promise(res => setTimeout(() => { this.closeModal(); res(); }, 1700));
    return this._modalButtons();
  }

  showGameOver(winner, game) {
    const rows = game.players.map(p =>
      `<div>${p.bankrupt ? '💀' : '🙂'} ${p.name} —— 现金 ¥${p.money}，债务 ¥${p.debt}，地产 ${game.playerProperties(p.id).length} 处，总身价 <b style="color:var(--gold)">¥${game.netWorth(p)}</b></div>`
    ).join('');
    this._openModal(`
      <h2>🏆 游戏结束</h2>
      <div class="modal-body" style="text-align:center;font-size:22px;">
        <b style="color:var(--gold)">${winner.name}</b> 加冕商业帝国！
      </div>
      <div class="gameover-stats">${rows}</div>
      <div class="btn-row"><button class="primary big" data-choice="again">🔄 再来一局</button></div>`);
    return this._modalButtons();
  }

  // ---------- 银行 ----------
  openBank(game, player, onChange) {
    const render = () => {
      const limit = game.creditLimit(player);
      const avail = limit - player.debt;
      let mortgageRows = '';
      for (const i of game.playerProperties(player.id)) {
        const t = TILES[i];
        const mort = game.isMortgaged(i);
        const h = game.houses[i];
        mortgageRows += `<div class="panel-row">
          <span class="grow">${ownable(t) && t.type === 'property' ? INDUSTRIES[t.color].icon : ''}${t.name}
            ${h > 0 ? `<span class="tag">${h}级</span>` : ''} ${mort ? '<span class="mort-flag">已抵押</span>' : ''}</span>
          ${mort
            ? `<button data-unmort="${i}" ${game.canUnmortgage(player, i) ? '' : 'disabled'}>赎回 ¥${game.unmortgageCost(i)}</button>`
            : `<button data-mort="${i}" ${game.canMortgage(player, i) ? '' : 'disabled'}>抵押 +¥${game.mortgageValue(i)}</button>`}
        </div>`;
      }
      if (!mortgageRows) mortgageRows = '<p class="muted">你还没有地产</p>';
      this._openModal(`
        <h2>🏦 帝国银行</h2>
        <div class="modal-body">
          <div class="panel-section">
            <h3>💰 信贷 <small class="muted">每回合债务计息 5%（利滚利）</small></h3>
            <div class="panel-row"><span class="grow">现金 <b style="color:var(--gold)">¥${player.money}</b>　债务 <b class="debt">¥${player.debt}</b></span></div>
            <div class="panel-row"><span class="grow">信用额度 ¥${limit}，可用 <b>${avail}</b></span></div>
            <div class="panel-row">
              <span>借款：</span>
              ${[100, 300, 500].map(v => `<button data-borrow="${v}" ${game.canBorrow(player, v) ? '' : 'disabled'}>+¥${v}</button>`).join('')}
            </div>
            <div class="panel-row">
              <span>还款：</span>
              ${[100, 500].map(v => `<button data-repay="${v}" ${player.debt > 0 && player.money > 0 ? '' : 'disabled'}>-¥${v}</button>`).join('')}
              <button data-repay="all" ${player.debt > 0 && player.money > 0 ? '' : 'disabled'}>还清</button>
            </div>
          </div>
          <div class="panel-section">
            <h3>🏢 地产抵押 <small class="muted">抵押得 50% 市值，赎回加价 10%；抵押期间不收租、有建筑不可抵押</small></h3>
            ${mortgageRows}
          </div>
        </div>
        <div class="btn-row"><button class="primary" data-close>关 闭</button></div>`);

      this.el.modalBox.querySelectorAll('[data-borrow]').forEach(b => b.onclick = () => {
        game.borrow(player, +b.dataset.borrow); onChange(); render();
      });
      this.el.modalBox.querySelectorAll('[data-repay]').forEach(b => b.onclick = () => {
        const v = b.dataset.repay === 'all' ? player.debt : +b.dataset.repay;
        game.repay(player, v); onChange(); render();
      });
      this.el.modalBox.querySelectorAll('[data-mort]').forEach(b => b.onclick = () => {
        const i = +b.dataset.mort;
        if (game.canMortgage(player, i)) { game.mortgage(player, i); onChange(); render(); }
      });
      this.el.modalBox.querySelectorAll('[data-unmort]').forEach(b => b.onclick = () => {
        const i = +b.dataset.unmort;
        if (game.canUnmortgage(player, i)) { game.unmortgage(player, i); onChange(); render(); }
      });
      this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
    };
    render();
  }

  // ---------- 公司 ----------
  openCompany(game, player, onChange) {
    if (!player.company) {
      const canAfford = player.money >= COMPANY_FOUND_COST;
      this._openModal(`
        <h2>🏢 创办公司</h2>
        <div class="modal-body">
          <p>注册费 <b style="color:var(--gold)">¥${COMPANY_FOUND_COST}</b>　你的现金：¥${player.money}</p>
          <p class="muted">公司每回合产生营收 = 基础营收 × 所在行业景气度，可升级（最高 Lv${COMPANY_MAX_LEVEL}）。选择赛道：</p>
          <div class="btn-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${Object.entries(INDUSTRIES).filter(([k]) => k !== 'railroad' && k !== 'utility').map(([k, ind]) => {
              const st = INDUSTRY_STATES[game.industry[k]];
              return `<button data-ind="${k}" ${canAfford ? '' : 'disabled'}>${ind.icon} ${ind.name} ${st.icon}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="btn-row"><button data-close>再想想</button></div>`);
      this.el.modalBox.querySelectorAll('[data-ind]').forEach(b => b.onclick = () => {
        if (game.canFoundCompany(player)) {
          game.foundCompany(player, b.dataset.ind);
          this.log(`${player.name} 创办了 ${INDUSTRIES[player.company.industry].icon}${INDUSTRIES[player.company.industry].name} 公司！`, 'good');
          onChange();
        }
        this.closeModal();
      });
      this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
      return;
    }
    const c = player.company;
    const ind = INDUSTRIES[c.industry];
    const st = INDUSTRY_STATES[game.industry[c.industry]];
    const upCost = companyUpgradeCost(c.level);
    this._openModal(`
      <h2>🏢 ${player.name}的公司</h2>
      <div class="modal-body">
        <div class="panel-section">
          <div class="panel-row">赛道：${ind.icon} ${ind.name} ${st.icon}${st.name}</div>
          <div class="panel-row">等级：<b style="color:var(--gold)">Lv${c.level}</b> / Lv${COMPANY_MAX_LEVEL}</div>
          <div class="panel-row">每回合营收：<b style="color:var(--gold)">¥${game.companyRevenue(player)}</b>（随行业景气浮动）</div>
          <div class="panel-row">公司估值：¥${game.companyValue(player)}</div>
        </div>
      </div>
      <div class="btn-row">
        ${c.level < COMPANY_MAX_LEVEL ? `<button class="primary" data-up ${game.canUpgradeCompany(player) ? '' : 'disabled'}>⬆️ 升级（¥${upCost}）</button>` : '<span class="tag">已满级</span>'}
        <button data-close>关 闭</button>
      </div>`);
    const upBtn = this.el.modalBox.querySelector('[data-up]');
    if (upBtn) upBtn.onclick = () => {
      if (game.canUpgradeCompany(player)) {
        game.upgradeCompany(player);
        this.log(`${player.name} 的公司升级到 Lv${player.company.level}！`, 'good');
        onChange();
      }
      this.closeModal();
    };
    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
  }

  // ---------- 交易 ----------
  /** 交易发起面板（人类）；onPropose({buyerId, sellerId, tileIdx, price}) */
  openTrade(game, me, onPropose) {
    const others = game.players.filter(p => p.id !== me.id && !p.bankrupt);
    if (!others.length) { this.toast('没有可交易的对手'); return; }
    const tradable = (pid) => game.playerProperties(pid).filter(i => game.houses[i] === 0 && !game.isMortgaged(i));
    this._openModal(`
      <h2>🤝 发起交易</h2>
      <div class="modal-body">
        <div class="panel-row"><span>交易对象：</span><select id="tr-player" class="grow">
          ${others.map(p => `<option value="${p.id}">${p.name}${p.isAI ? '(AI)' : ''}</option>`).join('')}
        </select></div>
        <div class="panel-row">
          <span>方向：</span>
          <button id="tr-mode-buy" class="primary" style="flex:1">我收购对方的资产</button>
          <button id="tr-mode-sell" style="flex:1">我出售我的资产</button>
        </div>
        <div class="panel-row"><span>资产：</span><select id="tr-tile" class="grow"></select></div>
        <div class="panel-row">
          <span>报价：</span>
          <input type="range" id="tr-range" min="1" max="1000" value="100" />
          <input type="number" id="tr-price" min="1" value="100" />
        </div>
        <p class="muted" id="tr-hint"></p>
      </div>
      <div class="btn-row">
        <button class="primary" id="tr-send">发出报价</button>
        <button data-close>取消</button>
      </div>`);

    const selP = $('#tr-player'), selT = $('#tr-tile'), range = $('#tr-range'), price = $('#tr-price'), hint = $('#tr-hint');
    let mode = 'buy';
    const refreshTiles = () => {
      const pid = mode === 'buy' ? +selP.value : me.id;
      const list = tradable(pid);
      selT.innerHTML = list.length
        ? list.map(i => `<option value="${i}">${TILES[i].name}（市值 ¥${TILES[i].price}）</option>`).join('')
        : '<option value="">（无可交易资产）</option>';
      const first = list[0];
      if (first != null) { range.value = price.value = TILES[first].price; }
      hint.textContent = list.length ? '有建筑或已抵押的资产不可交易。' : '对方暂无可交易资产（建筑需先拆除、抵押需先赎回）。';
    };
    selP.onchange = refreshTiles;
    selT.onchange = () => { const i = +selT.value; if (selT.value !== '' && TILES[i]?.price) range.value = price.value = TILES[i].price; };
    range.oninput = () => { price.value = range.value; };
    price.oninput = () => { range.value = price.value; };
    $('#tr-mode-buy').onclick = (e) => { mode = 'buy'; e.target.className = 'primary'; $('#tr-mode-sell').className = ''; refreshTiles(); };
    $('#tr-mode-sell').onclick = (e) => { mode = 'sell'; e.target.className = 'primary'; $('#tr-mode-buy').className = ''; refreshTiles(); };
    $('#tr-send').onclick = () => {
      if (selT.value === '') { this.toast('没有可交易的资产'); return; }
      const tileIdx = +selT.value;
      const p = Math.max(1, Math.round(+price.value || 0));
      if (!ownable(TILES[tileIdx])) { this.toast('请选择资产'); return; }
      const buyerId = mode === 'buy' ? me.id : +selP.value;
      const sellerId = mode === 'buy' ? +selP.value : me.id;
      this.closeModal();
      onPropose({ buyerId, sellerId, tileIdx, price: p });
    };
    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
    refreshTiles();
  }

  /** 交易结果展示（AI 回应） */
  showTradeResponse(sellerName, decision, counterPrice, say) {
    const heads = { accept: '✅ 同意成交', reject: '❌ 拒绝交易', counter: '💬 提出还价' };
    const body = decision === 'counter'
      ? `<p>对方还价 <b style="color:var(--gold)">¥${counterPrice}</b></p>`
      : '';
    this._openModal(`
      <h2>${heads[decision]}</h2>
      <div class="modal-body">
        <p><b>${sellerName}</b>：「${say}」</p>
        ${body}
      </div>
      <div class="btn-row">
        ${decision === 'counter' ? '<button class="primary" data-choice="accept">接受还价</button>' : ''}
        <button data-choice="close">${decision === 'counter' ? '放弃' : '好的'}</button>
      </div>`);
    return this._modalButtons();
  }

  /** 交易确认弹窗（由交易"对方"确认）：responder='seller' 卖方确认 / 'buyer' 买方确认 */
  promptIncomingTrade({ buyerName, sellerName, tileIdx, price, responder = 'seller', buyerMoney = 0 }) {
    const t = TILES[tileIdx];
    const text = responder === 'buyer'
      ? `<p><b>${sellerName}</b> 想把 <b>${t.name}</b> 以 <b style="color:var(--gold)">¥${price}</b> 卖给你（市值 ¥${t.price}，你的现金 ¥${buyerMoney}）。</p><p class="muted">由买方玩家确认</p>`
      : `<p><b>${buyerName}</b> 想出价 <b style="color:var(--gold)">¥${price}</b> 收购你的 <b>${t.name}</b>（市值 ¥${t.price}）。</p><p class="muted">由卖方玩家确认</p>`;
    this._openModal(`
      <h2>🤝 交易要约</h2>
      <div class="modal-body">${text}</div>
      <div class="btn-row">
        <button class="primary" data-choice="accept">✅ 同意</button>
        <button class="danger" data-choice="reject">❌ 拒绝</button>
      </div>`);
    return this._modalButtons();
  }

  // ---------- 建设 ----------
  openBuild(game, player, onChange) {
    const render = () => {
      const sets = game.buildableSets(player.id);
      const sellable = game.playerProperties(player.id).filter(i => game.houses[i] > 0);
      let html = `<h2>🏠 楼宇建设 <small style="color:#9ab">现金 ¥${player.money} · 任何自有地产均可建楼，集齐行业享空地双倍租金</small></h2><div class="modal-body">`;
      if (sets.length === 0 && sellable.length === 0) {
        html += '<p>你还没有地产。<br/><small>买地后即可在此建楼（最多 5 级，第 5 级为地标大厦），楼宇会真实矗立在棋盘上。</small></p>';
      }
      for (const set of sets) {
        const g = INDUSTRIES[set.color];
        const st = INDUSTRY_STATES[game.industry[set.color]];
        html += `<div class="build-set"><h3>${g.icon} ${g.name} ${st.icon}（每级 ¥${TILES[set.tiles[0]].houseCost}）</h3>`;
        for (const i of set.tiles) {
          const h = game.houses[i];
          const stars = h >= 5 ? '🏙️ 地标' : '🏬'.repeat(h) + '·'.repeat(4 - h);
          html += `<div class="build-prop">
            <span class="bp-name">${TILES[i].name}</span>
            <span class="bp-houses">${stars}</span>
            <button data-build="${i}" ${game.canBuild(player, i) ? '' : 'disabled'}>＋建</button>
            <button data-sell="${i}" ${game.canSellHouse(player, i) ? '' : 'disabled'}>－卖</button>
          </div>`;
        }
        html += '</div>';
      }
      html += `</div><div class="btn-row"><button class="primary" data-close>完 成</button></div>`;
      this._openModal(html);
      this.el.modalBox.querySelectorAll('[data-build]').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.build;
        if (game.canBuild(player, i)) { game.buyHouse(player, i); onChange(); render(); }
      });
      this.el.modalBox.querySelectorAll('[data-sell]').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.sell;
        if (game.canSellHouse(player, i)) { game.sellHouse(player, i); onChange(); render(); }
      });
      this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
    };
    render();
  }

  /** 拆迁卡目标选择 */
  openDemolish(game, player, onPick) {
    const targets = [];
    for (const other of game.players) {
      if (other.id === player.id || other.bankrupt) continue;
      for (const i of game.playerProperties(other.id)) {
        if (game.houses[i] > 0) targets.push({ i, owner: other });
      }
    }
    if (!targets.length) { this.toast('场上没有可拆除的建筑'); return; }
    targets.sort((a, b) => game.houses[b.i] - game.houses[a.i]);
    this._openModal(`
      <h2>💥 拆迁卡：选择目标</h2>
      <div class="modal-body">
        ${targets.slice(0, 8).map(({ i, owner }) => `
          <div class="panel-row">
            <span class="grow">${TILES[i].name}（${owner.name}，${game.houses[i] >= 5 ? '地标' : game.houses[i] + '级'}）</span>
            <button class="danger" data-target="${i}">拆除</button>
          </div>`).join('')}
      </div>
      <div class="btn-row"><button data-close>取消</button></div>`);
    this.el.modalBox.querySelectorAll('[data-target]').forEach(b => b.onclick = () => {
      this.closeModal();
      onPick(+b.dataset.target);
    });
    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
  }

  // ---------- AI 设置 ----------
  openSettings(client, onSave) {
    if (this.modalOpen) return;
    this._openModal(`
      <h2>⚙️ DeepSeek AI 设置</h2>
      <div class="modal-body">
        <div class="settings-row">
          <label>API Key（仅存于本机浏览器，直发 DeepSeek 官方接口）</label>
          <input type="password" id="set-key" placeholder="sk-..." value="${client.key}" />
        </div>
        <div class="settings-row">
          <label>模型</label>
          <select id="set-model">
            <option value="deepseek-chat" ${client.model === 'deepseek-chat' ? 'selected' : ''}>deepseek-chat（V3，快）</option>
            <option value="deepseek-reasoner" ${client.model === 'deepseek-reasoner' ? 'selected' : ''}>deepseek-reasoner（R1，会思考）</option>
          </select>
        </div>
        <div class="settings-row">
          <label>自定义接口（留空则自动：开发代理 /ds → api.deepseek.com）</label>
          <input type="text" id="set-ep" placeholder="https://api.deepseek.com/chat/completions" value="${client.endpoint}" />
        </div>
        <div id="settings-status" class="muted">
          ${client.enabled ? `已配置 · 累计调用 ${client.stats.calls} 次 / ${client.stats.tokens} tokens` : '未配置 Key，AI 使用内置策略 + 内置台词'}
        </div>
      </div>
      <div class="btn-row">
        <button class="primary" id="set-save">保存</button>
        <button id="set-test">测试连接</button>
        <button data-close>关闭</button>
      </div>`);
    $('#set-save').onclick = () => {
      client.save($('#set-key').value, $('#set-model').value, $('#set-ep').value);
      $('#settings-status').textContent = client.enabled ? '✅ 已保存，AI 大脑已上线！' : '已保存（未配置 Key，使用内置策略）';
      onSave?.();
    };
    $('#set-test').onclick = async () => {
      $('#settings-status').textContent = '⏳ 测试中…';
      client.save($('#set-key').value, $('#set-model').value, $('#set-ep').value);
      const r = await client.test();
      $('#settings-status').textContent = r.ok ? `✅ 连接成功（${r.ms}ms）：${r.reply}` : '❌ 连接失败：请检查 Key / 网络 / 接口地址';
    };
    this.el.modalBox.querySelector('[data-close]').onclick = () => this.closeModal();
  }

  // ---------- 格子信息 ----------
  showTileInfo(tileIdx, game, x, y) {
    const t = TILES[tileIdx];
    let html = '';
    if (t.type === 'property') {
      const ind = INDUSTRIES[t.color];
      const mult = game.industryMult(t.color);
      const st = INDUSTRY_STATES[game.industry[t.color]];
      const labels = ['空地', '1级', '2级', '3级', '4级', '地标'];
      html = `<div class="color-bar" style="background:${ind.css}"></div>
        <h3>${ind.icon} ${t.name}</h3>
        <p>${ind.name} · ${st.icon}${st.name}（租金×${mult}）</p>
        <p>售价 ¥${t.price} · 建楼 ¥${t.houseCost}/级</p>
        <table>${t.rents.map((r, i) => `<tr><td>${labels[i]}</td><td>¥${Math.max(1, Math.round(r * mult))}</td></tr>`).join('')}</table>`;
    } else if (t.type === 'railroad') {
      html = `<h3>🚄 ${t.name}</h3><p>售价 ¥${t.price}</p><p>租金（按拥有枢纽数）：25 / 50 / 100 / 200</p>`;
    } else if (t.type === 'utility') {
      html = `<h3>${t.name}</h3><p>售价 ¥${t.price}</p><p>租金 = 骰子×4，集齐两家 ×10</p>`;
    } else {
      html = `<h3>${t.name}</h3><p>${{ go: '经过或停留：融资到账 ¥200', tax: `缴纳 ¥${t.amount}`, jail: '监管约谈 / 配合调查中', parking: '休假中，无事发生', gotojail: '违规经营，当场约谈！', chance: '抽一张风口卡', chest: '抽一张风险卡' }[t.type] || ''}</p>`;
    }
    const owner = game.owner[tileIdx];
    if (owner >= 0) {
      const h = game.houses[tileIdx];
      html += `<p>所有者：<b style="color:${PLAYER_COLORS_CSS[owner]}">${game.players[owner].name}</b>${h > 0 ? (h >= 5 ? ' · 🏙️ 地标' : ` · 🏬 Lv${h}`) : ''}${game.isMortgaged(tileIdx) ? ' <span class="mort-flag">已抵押</span>' : ''}</p>`;
    } else if (ownable(t)) {
      html += '<p style="color:#080">待售中</p>';
    }
    this.el.tileInfo.innerHTML = html;
    this.el.tileInfo.classList.remove('hidden');
    this.el.tileInfo.style.left = Math.min(x + 16, innerWidth - 240) + 'px';
    this.el.tileInfo.style.top = Math.min(y + 16, innerHeight - 260) + 'px';
    clearTimeout(this._tileT);
    this._tileT = setTimeout(() => this.el.tileInfo.classList.add('hidden'), 4500);
  }
}
