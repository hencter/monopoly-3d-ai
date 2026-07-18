// 程序化音效：纯 WebAudio 合成，零外部资源
// 懒初始化，浏览器 autoplay 策略安全；静音状态持久化 localStorage('df_sound')
const LS = 'df_sound';

class SoundManager {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._bgmTimer = null;
    try { this.enabled = localStorage.getItem(LS) !== '0'; }
    catch { this.enabled = true; } // node 等无 localStorage 环境
  }

  _ac() {
    if (typeof window === 'undefined') return null;
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._ctx = new AC();
      this._master = this._ctx.createGain();
      this._master.gain.value = 0.16;
      this._master.connect(this._ctx.destination);
    }
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._ctx;
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(LS, this.enabled ? '1' : '0'); } catch {}
    if (!this.enabled) this.stopBgm();
    return this.enabled;
  }

  /** 基础音符：freq 起 → freqEnd（可选滑音），dur 秒 */
  _tone({ freq = 440, freqEnd = null, dur = 0.15, type = 'sine', vol = 1, delay = 0, filterFreq = null }) {
    const ctx = this._ac();
    if (!ctx || !this.enabled) return;
    try {
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      let node = osc;
      if (filterFreq) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filterFreq;
        osc.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(this._master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {}
  }

  /** 噪声（嗖/骰子） */
  _noise({ dur = 0.2, vol = 0.6, delay = 0, filterFrom = 4000, filterTo = 400 }) {
    const ctx = this._ac();
    if (!ctx || !this.enabled) return;
    try {
      const t0 = ctx.currentTime + delay;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(filterFrom, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this._master);
      src.start(t0);
    } catch {}
  }

  play(name) {
    if (!this.enabled) return;
    try {
      switch (name) {
        case 'dice':
          this._noise({ dur: 0.08, vol: 0.5, filterFrom: 2500, filterTo: 1200 });
          this._noise({ dur: 0.08, vol: 0.5, delay: 0.12, filterFrom: 2200, filterTo: 1000 });
          this._tone({ freq: 180, freqEnd: 90, dur: 0.12, type: 'square', vol: 0.4, delay: 0.26 });
          break;
        case 'step': this._tone({ freq: 520, dur: 0.06, type: 'triangle', vol: 0.5 }); break;
        case 'coin':
          this._tone({ freq: 880, dur: 0.09, type: 'sine', vol: 0.7 });
          this._tone({ freq: 1320, dur: 0.14, type: 'sine', vol: 0.7, delay: 0.09 });
          break;
        case 'pay':
          this._tone({ freq: 660, dur: 0.1, type: 'sine', vol: 0.6 });
          this._tone({ freq: 440, dur: 0.16, type: 'sine', vol: 0.6, delay: 0.1 });
          break;
        case 'buy':
          [523, 659, 784].forEach((f, i) => this._tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.6, delay: i * 0.07 }));
          break;
        case 'build':
          this._tone({ freq: 300, freqEnd: 700, dur: 0.22, type: 'sawtooth', vol: 0.4, filterFreq: 1500 });
          this._noise({ dur: 0.06, vol: 0.4, delay: 0.2, filterFrom: 3000, filterTo: 2000 });
          break;
        case 'card': this._noise({ dur: 0.28, vol: 0.5, filterFrom: 900, filterTo: 5200 }); break;
        case 'jail':
          this._tone({ freq: 220, dur: 0.2, type: 'square', vol: 0.5 });
          this._tone({ freq: 165, dur: 0.3, type: 'square', vol: 0.5, delay: 0.2 });
          break;
        case 'bankrupt': this._tone({ freq: 500, freqEnd: 80, dur: 0.9, type: 'sawtooth', vol: 0.5, filterFreq: 1200 }); break;
        case 'win':
          [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.7, delay: i * 0.12 }));
          break;
        case 'trade':
          this._tone({ freq: 587, dur: 0.12, type: 'triangle', vol: 0.6 });
          this._tone({ freq: 880, dur: 0.18, type: 'triangle', vol: 0.6, delay: 0.1 });
          break;
        case 'news':
          this._tone({ freq: 988, dur: 0.09, type: 'sine', vol: 0.55 });
          this._tone({ freq: 988, dur: 0.12, type: 'sine', vol: 0.55, delay: 0.14 });
          break;
        case 'click': this._tone({ freq: 900, dur: 0.03, type: 'sine', vol: 0.35 }); break;
        case 'rob': this._noise({ dur: 0.2, vol: 0.55, filterFrom: 3500, filterTo: 500 }); this._tone({ freq: 700, freqEnd: 1100, dur: 0.15, type: 'sine', vol: 0.5, delay: 0.12 }); break;
      }
    } catch {}
  }

  startBgm() {
    const ctx = this._ac();
    if (!ctx || this._bgmTimer || !this.enabled) return;
    const chords = [
      [261.6, 329.6, 392.0],   // C
      [220.0, 261.6, 329.6],   // Am
      [174.6, 220.0, 261.6],   // F
      [196.0, 246.9, 293.7],   // G
    ];
    let step = 0;
    const playChord = () => {
      if (!this.enabled) return;
      const chord = chords[step++ % chords.length];
      for (const f of chord) this._tone({ freq: f, dur: 2.2, type: 'sine', vol: 0.16, filterFreq: 900 });
      this._tone({ freq: chord[0] / 2, dur: 2.2, type: 'triangle', vol: 0.14, filterFreq: 500 });
    };
    playChord();
    this._bgmTimer = setInterval(playChord, 2000);
  }

  stopBgm() {
    if (this._bgmTimer) { clearInterval(this._bgmTimer); this._bgmTimer = null; }
  }
}

export const soundManager = new SoundManager();
