/**
 * 通天币（Tongtian Coin）
 *
 * 符号 Ŧ（Latin Capital T with Stroke，读作「通」）
 * 现实映射：1 通天币 ≈ 1 人民币元（展示量级对齐现实商业）
 * 内部仍用整数；展示时自动万/亿缩写。
 *
 * 相对经典大富翁底表的缩放：×10_000
 * 例：起点融资 200 → Ŧ200万；初始资金 1500 → Ŧ1500万
 */

export const CURRENCY_NAME = '通天币';
/** 通天币符号：Ŧ */
export const CURRENCY_SYMBOL = 'Ŧ';
/** 经典大富翁数值 → 通天币内部整数 */
export const MONEY_SCALE = 10_000;

/** 将经典单位放大为通天币 */
export const ttc = (classic) => Math.round(Number(classic) * MONEY_SCALE);

/**
 * 格式化金额
 * @param {number} n 通天币整数
 * @param {{ compact?: boolean, sign?: boolean }} [opt]
 */
export function formatMoney(n, opt = {}) {
  const { compact = true, sign = false } = opt;
  const v = Math.round(Number(n) || 0);
  const neg = v < 0;
  const abs = Math.abs(v);
  let body;
  if (compact && abs >= 100_000_000) {
    // 亿
    const yi = abs / 100_000_000;
    body = `${trimNum(yi)}亿`;
  } else if (compact && abs >= 10_000) {
    // 万
    const wan = abs / 10_000;
    body = `${trimNum(wan)}万`;
  } else {
    body = abs.toLocaleString('zh-CN');
  }
  const prefix = neg ? '-' : (sign && v > 0 ? '+' : '');
  return `${prefix}${CURRENCY_SYMBOL}${body}`;
}

function trimNum(x) {
  if (x >= 100) return String(Math.round(x));
  if (x >= 10) return (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return (Math.round(x * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

/** 纯数字说明：1 通天币 ≈ 1 元人民币 */
export const CURRENCY_REAL_MAP = '1 通天币 ≈ 1 元人民币；开局 Ŧ1500万 ≈ 现实 1500 万元启动资金';
