// DeepSeek API 客户端（OpenAI 兼容格式）
// 文档：https://api-docs.deepseek.com/zh-cn/
// base_url: https://api.deepseek.com
// 开发环境走 Vite 代理 /ds 规避 CORS；Key 仅存 localStorage

const LS_KEY = 'df_ds_key';
const LS_MODEL = 'df_ds_model';
const LS_EP = 'df_ds_ep';
const LS_THINK = 'df_ds_think';

/** 当前官方主推模型（deepseek-chat / reasoner 将于 2026-07-24 弃用） */
export const DEEPSEEK_MODELS = [
  {
    id: 'deepseek-v4-flash',
    label: 'deepseek-v4-flash（推荐·快）',
    thinkingDefault: 'disabled',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'deepseek-v4-pro（更强）',
    thinkingDefault: 'enabled',
  },
  // 兼容旧名：映射到 flash 的非思考 / 思考
  {
    id: 'deepseek-chat',
    label: 'deepseek-chat（兼容·将弃用）',
    thinkingDefault: 'disabled',
    legacy: true,
  },
  {
    id: 'deepseek-reasoner',
    label: 'deepseek-reasoner（兼容·将弃用）',
    thinkingDefault: 'enabled',
    legacy: true,
  },
];

const DEFAULT_MODEL = 'deepseek-v4-flash';

export class DeepSeekClient {
  constructor() {
    this.key = '';
    this.model = DEFAULT_MODEL;
    this.endpoint = '';
    /** @type {'enabled'|'disabled'|'auto'} */
    this.thinking = 'auto';
    this.stats = { calls: 0, tokens: 0, failures: 0, lastError: '' };
    this._workingEp = null;
    this._load();
  }

  _load() {
    try {
      this.key = localStorage.getItem(LS_KEY) || '';
      const m = localStorage.getItem(LS_MODEL) || DEFAULT_MODEL;
      this.model = m;
      this.endpoint = localStorage.getItem(LS_EP) || '';
      this.thinking = localStorage.getItem(LS_THINK) || 'auto';
    } catch {
      /* Node / 无 localStorage */
    }
  }

  get enabled() { return !!this.key; }

  /**
   * @param {string} key
   * @param {string} [model]
   * @param {string} [endpoint]
   * @param {'enabled'|'disabled'|'auto'} [thinking]
   */
  save(key, model, endpoint, thinking) {
    this.key = (key || '').trim();
    this.model = model || DEFAULT_MODEL;
    this.endpoint = (endpoint || '').trim();
    if (thinking) this.thinking = thinking;
    try {
      localStorage.setItem(LS_KEY, this.key);
      localStorage.setItem(LS_MODEL, this.model);
      localStorage.setItem(LS_EP, this.endpoint);
      localStorage.setItem(LS_THINK, this.thinking);
    } catch { /* */ }
    this._workingEp = null;
  }

  endpoints() {
    const list = [];
    if (this._workingEp) list.push(this._workingEp);
    if (this.endpoint) list.push(this.endpoint);
    // 开发代理：/ds → https://api.deepseek.com
    list.push('/ds/chat/completions', 'https://api.deepseek.com/chat/completions');
    return [...new Set(list)];
  }

  /** 解析思考模式：auto 时按模型默认 */
  _resolveThinking(explicit) {
    if (explicit === 'enabled' || explicit === 'disabled') return explicit;
    if (this.thinking === 'enabled' || this.thinking === 'disabled') return this.thinking;
    const meta = DEEPSEEK_MODELS.find((m) => m.id === this.model);
    // 决策类默认非思考（快+省）；reasoner / pro 默认思考
    if (meta?.thinkingDefault === 'enabled') return 'enabled';
    if (this.model === 'deepseek-reasoner' || this.model === 'deepseek-v4-pro') return 'enabled';
    return 'disabled';
  }

  /**
   * 对话补全
   * @param {Array<{role:string, content:string}>} messages
   * @param {{
   *   maxTokens?: number,
   *   temperature?: number,
   *   timeout?: number,
   *   jsonMode?: boolean,
   *   thinking?: 'enabled'|'disabled'|'auto',
   *   reasoningEffort?: 'high'|'max',
   * }} [opts]
   * @returns {Promise<string|null>} 失败/未配置返回 null（调用方回退本地策略）
   */
  async chat(messages, {
    maxTokens = 160,
    temperature = 0.8,
    timeout = 20000,
    jsonMode = false,
    thinking = 'auto',
    reasoningEffort = 'high',
  } = {}) {
    if (!this.enabled) {
      this.stats.lastError = 'no_key';
      return null;
    }

    const thinkType = this._resolveThinking(thinking);
    /** @type {Record<string, unknown>} */
    const body = {
      model: this.model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
      // 官方 thinking 开关（V4）
      thinking: { type: thinkType },
    };
    if (thinkType === 'enabled') {
      body.reasoning_effort = reasoningEffort;
    }
    // JSON 模式：保证输出可解析（决策用）
    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    for (const ep of this.endpoints()) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const res = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.key}`,
          },
          body: JSON.stringify(body),
        });
        clearTimeout(timer);

        if (!res.ok) {
          this.stats.failures++;
          let detail = `${res.status}`;
          try {
            const err = await res.json();
            detail = err?.error?.message || err?.message || detail;
          } catch { /* */ }
          this.stats.lastError = detail;
          console.warn('[DeepSeek]', ep, detail);
          continue;
        }

        const data = await res.json();
        const msg = data?.choices?.[0]?.message;
        // 思考模式：最终答案在 content；推理过程在 reasoning_content
        let text = msg?.content;
        if (typeof text !== 'string' || !text.trim()) {
          // 极少数情况 content 空但有 reasoning —— 仍视为失败走回退
          this.stats.failures++;
          this.stats.lastError = 'empty_content';
          continue;
        }
        this._workingEp = ep;
        this.stats.calls++;
        this.stats.tokens += data?.usage?.total_tokens || 0;
        this.stats.lastError = '';
        return text.trim();
      } catch (e) {
        this.stats.failures++;
        this.stats.lastError = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network');
        console.warn('[DeepSeek] fetch fail', ep, this.stats.lastError);
      }
    }
    return null;
  }

  /** 测试连接（设置页用） */
  async test() {
    const t0 = Date.now();
    const r = await this.chat(
      [{ role: 'user', content: '用四个字回答：连接正常' }],
      { maxTokens: 32, timeout: 15000, thinking: 'disabled', temperature: 0.3 },
    );
    return r
      ? { ok: true, ms: Date.now() - t0, reply: r.slice(0, 40) }
      : { ok: false, error: this.stats.lastError || 'unknown' };
  }
}
