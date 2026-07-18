// DeepSeek API 客户端（浏览器直连或走 vite 代理 /ds）
// Key 仅存 localStorage，只发往 DeepSeek 官方接口
const LS_KEY = 'df_ds_key';
const LS_MODEL = 'df_ds_model';
const LS_EP = 'df_ds_ep';

export class DeepSeekClient {
  constructor() {
    this.key = localStorage.getItem(LS_KEY) || '';
    this.model = localStorage.getItem(LS_MODEL) || 'deepseek-chat';
    this.endpoint = localStorage.getItem(LS_EP) || '';
    this.stats = { calls: 0, tokens: 0, failures: 0 };
    this._workingEp = null;
  }

  get enabled() { return !!this.key; }

  save(key, model, endpoint) {
    this.key = (key || '').trim();
    this.model = model || 'deepseek-chat';
    this.endpoint = (endpoint || '').trim();
    localStorage.setItem(LS_KEY, this.key);
    localStorage.setItem(LS_MODEL, this.model);
    localStorage.setItem(LS_EP, this.endpoint);
    this._workingEp = null;
  }

  endpoints() {
    const list = [];
    if (this._workingEp) list.push(this._workingEp);
    if (this.endpoint) list.push(this.endpoint);
    list.push('/ds/chat/completions', 'https://api.deepseek.com/chat/completions');
    return [...new Set(list)];
  }

  /** @returns {Promise<string|null>} 失败/未配置返回 null（调用方回退本地策略） */
  async chat(messages, { maxTokens = 160, temperature = 0.8, timeout = 15000 } = {}) {
    if (!this.enabled) return null;
    for (const ep of this.endpoints()) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const res = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
          body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature }),
        });
        clearTimeout(timer);
        if (!res.ok) { this.stats.failures++; continue; }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string') { this.stats.failures++; continue; }
        this._workingEp = ep;
        this.stats.calls++;
        this.stats.tokens += data?.usage?.total_tokens || 0;
        return text;
      } catch {
        this.stats.failures++;
      }
    }
    return null;
  }

  /** 测试连接（设置页用） */
  async test() {
    const t0 = Date.now();
    const r = await this.chat([{ role: 'user', content: '用四个字回答：连接正常' }], { maxTokens: 20, timeout: 12000 });
    return r ? { ok: true, ms: Date.now() - t0, reply: r.slice(0, 30) } : { ok: false };
  }
}
