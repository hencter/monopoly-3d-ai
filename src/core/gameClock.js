/**
 * 商业帝国游戏时钟 + 股市开休市
 *
 * 日历：
 *   全体玩家各完成 1 个操作回合 = 推进 1 个「自然日」
 *
 * 周结构（对齐 A 股习惯：5 个交易日 + 周末）：
 *   周一～周五 开市可交易
 *   周六、周日 休市（不可买卖/做空/平空）
 *   dayNumber % 7：0=一 … 4=五 5=六 6=日
 *
 * T+N：
 *   自开局起已进入的「交易日」序号（仅周一～五计数；周末不涨 T+）
 */

export const SPEED_PRESETS = [0, 0.5, 1, 2, 4, 8];
export const SESSION_HOURS_PER_REAL_SEC = 0.08;

/** 0=周一 … 6=周日 */
const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

export class GameClock {
  /**
   * @param {{ dayNumber?: number, sessionHours?: number, speed?: number, yearStart?: number }} [opts]
   */
  constructor(opts = {}) {
    /** 自然日序号：0=开局周一；每全员轮完 +1 */
    this.dayNumber = opts.dayNumber ?? 0;
    /** 盘中钟（装饰） */
    this.sessionHours = opts.sessionHours ?? 9.5;
    this.speed = opts.speed != null ? opts.speed : 1;
    this.yearStart = opts.yearStart || 2026;
    this._lastTick = performance.now();
    this._raf = 0;
    this._listeners = new Set();
    this._running = false;
  }

  /** 0=周一 … 6=周日 */
  get weekdayIndex() {
    return ((this.dayNumber % 7) + 7) % 7;
  }

  get weekdayName() {
    return WEEKDAY_NAMES[this.weekdayIndex];
  }

  /** 周六、周日 */
  get isWeekend() {
    return this.weekdayIndex >= 5;
  }

  /** 周一～周五开市 */
  get isMarketOpen() {
    return !this.isWeekend;
  }

  /**
   * T+：已经历的交易日个数（从 0 起）
   * dayNumber=0 周一 → T+0；每经过一个交易日自然日 T+ 与 day 对齐计数
   */
  get tPlus() {
    // 0..dayNumber 中有多少个交易日（周一～五），再 -1 使开局为 T+0
    let tradingDays = 0;
    for (let d = 0; d <= this.dayNumber; d++) {
      if (d % 7 < 5) tradingDays++;
    }
    return Math.max(0, tradingDays - 1);
  }

  get dayIndex() {
    return this.dayNumber + 1;
  }

  get hourOfDay() {
    return ((this.sessionHours % 24) + 24) % 24;
  }

  get parts() {
    const totalDays = this.dayNumber;
    const h = this.hourOfDay;
    const hour = Math.floor(h);
    const minute = Math.floor((h - hour) * 60);
    const dayOfYear = totalDays % 360;
    const year = this.yearStart + Math.floor(totalDays / 360);
    const month = Math.floor(dayOfYear / 30) + 1;
    const day = (dayOfYear % 30) + 1;
    return {
      year,
      month,
      day,
      hour,
      minute,
      weekday: this.weekdayName,
      weekdayIndex: this.weekdayIndex,
      dayIndex: this.dayIndex,
      tPlus: this.tPlus,
      marketOpen: this.isMarketOpen,
      isWeekend: this.isWeekend,
    };
  }

  format() {
    const p = this.parts;
    const hh = String(p.hour).padStart(2, '0');
    const mm = String(p.minute).padStart(2, '0');
    const mkt = p.marketOpen ? '开市' : '休市';
    const tLabel = `T+${p.tPlus}`;
    return {
      date: `${p.year}年${p.month}月${p.day}日 周${p.weekday}`,
      time: `${hh}:${mm}`,
      dayLabel: `第 ${p.dayIndex} 天`,
      tPlus: tLabel,
      market: mkt,
      marketOpen: p.marketOpen,
      speedLabel: this.speed === 0 ? '暂停' : `${this.speed}×`,
      full: `📅 ${tLabel} · 周${p.weekday} · ${mkt} · ${p.year}.${p.month}.${p.day} ${hh}:${mm}`,
      short: `${tLabel} · 周${p.weekday} · ${mkt} · ${hh}:${mm}`,
    };
  }

  /**
   * 全体玩家各操作完一轮 → 自然日 +1
   * @returns {{ tPlus: number, dayNumber: number, marketOpen: boolean, weekday: string }}
   */
  onRoundComplete() {
    this.dayNumber += 1;
    this.sessionHours = this.isMarketOpen ? 9.5 : 10; // 休市日也给个钟面
    this._emit();
    return {
      tPlus: this.tPlus,
      dayNumber: this.dayNumber,
      marketOpen: this.isMarketOpen,
      weekday: this.weekdayName,
    };
  }

  /** 单人回合：微调盘中钟 */
  onTurnStart() {
    if (this.isMarketOpen) {
      this.sessionHours = Math.min(15, this.sessionHours + 0.45);
    }
    this._emit();
  }

  setSpeed(s) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return;
    this.tick();
    this.speed = n;
    this._emit();
  }

  cycleSpeed() {
    const i = SPEED_PRESETS.indexOf(this.speed);
    const next = SPEED_PRESETS[(i + 1) % SPEED_PRESETS.length];
    this.setSpeed(next);
    return this.speed;
  }

  tick(now = performance.now()) {
    const dt = Math.min(0.25, Math.max(0, (now - this._lastTick) / 1000));
    this._lastTick = now;
    if (this.speed > 0 && dt > 0 && this.isMarketOpen) {
      // 休市日盘中钟不走
      this.sessionHours = Math.min(15, this.sessionHours + dt * this.speed * SESSION_HOURS_PER_REAL_SEC);
      this._emit();
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTick = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      this.tick(now);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const snap = this.format();
    for (const fn of this._listeners) {
      try { fn(snap, this); } catch { /* */ }
    }
  }

  serialize() {
    return {
      dayNumber: this.dayNumber,
      sessionHours: this.sessionHours,
      speed: this.speed,
      yearStart: this.yearStart,
    };
  }

  static deserialize(data) {
    // 兼容旧存档 tPlus
    let dayNumber = data?.dayNumber;
    if (dayNumber == null && data?.tPlus != null) {
      // 粗映射：旧 tPlus 当自然日
      dayNumber = data.tPlus;
    }
    return new GameClock({
      dayNumber: dayNumber ?? 0,
      sessionHours: data?.sessionHours,
      speed: data?.speed ?? 1,
      yearStart: data?.yearStart,
    });
  }
}
