// 棋盘数据：现代商业版 40 格布局
// 8 大行业 + 交通枢纽 + 基础设施；rents = [空地, 1级, 2级, 3级, 4级, 地标]
// 货币：通天币 Ŧ —— 见 currency.js（1 通天币 ≈ 1 元人民币；经典数值 ×10000）
import { ttc, formatMoney, CURRENCY_SYMBOL, CURRENCY_NAME, MONEY_SCALE } from './currency.js';
export { ttc, formatMoney, CURRENCY_SYMBOL, CURRENCY_NAME, MONEY_SCALE };

export const INDUSTRIES = {
  agriculture:   { name: '农业食品', icon: '🌾', hex: 0x9c6b30, css: '#9c6b30' },
  ecommerce:     { name: '电商物流', icon: '📦', hex: 0x4db6e8, css: '#4db6e8' },
  culture:       { name: '文化娱乐', icon: '🎬', hex: 0xd94f8e, css: '#d94f8e' },
  energy:        { name: '新能源',   icon: '⚡', hex: 0xf08a24, css: '#f08a24' },
  biotech:       { name: '生物医药', icon: '🧬', hex: 0xd42c2c, css: '#d42c2c' },
  semiconductor: { name: '半导体',   icon: '💾', hex: 0xe8d21f, css: '#e8d21f' },
  ai:            { name: '人工智能', icon: '🤖', hex: 0x2b9e4b, css: '#2b9e4b' },
  fintech:       { name: '金融科技', icon: '💹', hex: 0x2745a8, css: '#2745a8' },
  railroad:      { name: '交通枢纽', icon: '🚄', hex: 0x333333, css: '#333333' },
  utility:       { name: '基础设施', icon: '🔌', hex: 0x7a7a7a, css: '#7a7a7a' },
};

// 行业景气度：影响该行业租金与公司营收
export const INDUSTRY_STATES = [
  { name: '低迷', mult: 0.6,  icon: '📉' },
  { name: '平稳', mult: 1.0,  icon: '➖' },
  { name: '向好', mult: 1.35, icon: '📈' },
  { name: '火爆', mult: 1.8,  icon: '🔥' },
];

export const ITEMS = {
  remote:    { name: '遥控骰子', icon: '🎯', desc: '指定本次掷骰点数（1~6）', rollFlow: true },
  boost:     { name: '加速卡',   icon: '🚀', desc: '本次掷骰额外前进 3 步', rollFlow: true },
  rentFree:  { name: '免租卡',   icon: '🛡️', desc: '踩到他人地产时，免疫下一次租金', passive: true },
  permit:    { name: '建设卡',   icon: '🏗️', desc: '建设/升级一级楼宇时消耗 1 张（仍需支付建楼费）', passive: true },
  charter:   { name: '公司卡',   icon: '📜', desc: '创办或升级公司时消耗 1 张（仍需支付注册/升级费）', passive: true },
  demolish:  { name: '拆迁卡',   icon: '💥', desc: '拆除任一对手的一级建筑' },
  equalize:  { name: '均富卡',   icon: '💳', desc: '所有存活玩家的现金变为平均值' },
  rob:       { name: '抢夺卡',   icon: '🥷', desc: `偷取一名对手 20% 现金（上限 ${formatMoney(ttc(300))}）` },
  swap:      { name: '换地卡',   icon: '🔀', desc: '用你的一块地产换对手的一块地产（均须无建筑未抵押）' },
  hibernate: { name: '冬眠卡',   icon: '😴', desc: '指定一名对手跳过其下一个回合' },
  intel:     { name: '资讯卡',   icon: '📰', desc: '发布利好/利空资讯，干扰行业股价与过路费氛围' },
  // —— 扩展卡池 ——
  bail:      { name: '保释令',   icon: '🔓', desc: '若在监管局，立即脱身且无需保证金' },
  subsidy:   { name: '财政补贴', icon: '🎁', desc: `立刻获得 ${formatMoney(ttc(200))} 通天币` },
  debtCut:   { name: '债务豁免', icon: '✂️', desc: `减免债务（最高 ${formatMoney(ttc(400))}）` },
  audit:     { name: '审计风暴', icon: '🧾', desc: `指定对手向银行补缴 ${formatMoney(ttc(150))} 税款` },
  poach:     { name: '挖角',     icon: '🧲', desc: '随机偷取对手 1 张道具卡' },
  hedge:     { name: '对冲保单', icon: '☂️', desc: '下次支付租金只付一半' },
  rush:      { name: '抢工卡',   icon: '⚡', desc: '下次建楼免消耗建设卡（仍付建楼费）' },
  warp:      { name: '跃迁卡',   icon: '🌀', desc: '立刻传送到你名下的任意一块地产' },
  doubleGo:  { name: '双倍融资', icon: '🏦', desc: '下次经过起点融资到账 ×2' },
  freeze:    { name: '停工令',   icon: '🛑', desc: '指定对手下一回合内不可建设' },
  equalizeDebt: { name: '均负卡', icon: '💸', desc: '所有存活玩家的债务变为平均值' },
  reverse:   { name: '反向卡',   icon: '🔄', desc: '下次掷骰反向行走，视角同步跟随' },
};

// 回合内可主动打出的卡（建设卡/公司卡为消耗型库存，在建设/公司面板使用）
export const PLAYABLE_ITEMS = [
  'demolish', 'equalize', 'rob', 'swap', 'hibernate', 'intel',
  'bail', 'subsidy', 'debtCut', 'audit', 'poach', 'hedge', 'rush', 'warp', 'doubleGo', 'freeze',
  'equalizeDebt', 'reverse',
];
/** 手牌展示但不点击打出（被动/消耗库存） */
export const PASSIVE_ITEMS = ['rentFree', 'permit', 'charter'];

// 价格/租金均为通天币整数（经典值 × MONEY_SCALE）
const P = (n) => ttc(n);
const R = (arr) => arr.map(ttc);

// ---------- 道具补给包（抽牌系统） ----------
// 权重：建设/公司卡更高，保证能扩展；强力策略卡略稀有
export const ITEM_DRAW_WEIGHTS = {
  permit: 22,
  charter: 16,
  remote: 10,
  boost: 10,
  rentFree: 9,
  subsidy: 9,
  hedge: 8,
  rush: 8,
  bail: 7,
  debtCut: 7,
  demolish: 7,
  rob: 6,
  intel: 7,
  audit: 6,
  poach: 6,
  warp: 5,
  doubleGo: 6,
  freeze: 5,
  swap: 5,
  hibernate: 5,
  equalize: 4,
  equalizeDebt: 4,
  reverse: 6,
};
/** 单种道具持有上限（禁止重复） */
export const ITEM_STACK_CAP = 1;
/** 手牌槽位上限（满时需丢弃旧卡才能抽新） */
export const HAND_CAP = 5;
/** 黑市参考价（Ŧ万） */
export const ITEM_MARKET_BASE = {
  remote: P(8), boost: P(8), rentFree: P(10), permit: P(4), charter: P(5),
  demolish: P(15), equalize: P(25), rob: P(15), swap: P(18), hibernate: P(18),
  intel: P(12), bail: P(12), subsidy: P(10), debtCut: P(12), audit: P(15),
  poach: P(18), hedge: P(10), rush: P(10), warp: P(18), doubleGo: P(15),
  freeze: P(18), equalizeDebt: P(25), reverse: P(18),
};
/** 回合开始赠送的免费抽牌次数 */
export const FREE_DRAWS_PER_TURN = 1;
/** 付费抽 1 张的价格 */
export const PAID_DRAW_COST = P(40);
/** 每回合最多付费抽几次 */
export const PAID_DRAWS_PER_TURN = 3;
/** 买地时额外抽牌概率 */
export const BUY_LAND_DRAW_CHANCE = 0.4;
/** 经过起点额外抽几张 */
export const GO_DRAW_N = 1;
/** 休闲度假区抽几张 */
export const PARKING_DRAW_N = 2;
/** 彩票站点：刮一张的价格 */
export const LOTTERY_COST = P(10);
/** 彩票中奖金额 */
export const LOTTERY_JACKPOT = P(50);
/** 彩票中奖概率 */
export const LOTTERY_WIN_CHANCE = 0.4;
/** 医院体检费 */
export const HOSPITAL_FEE = P(30);
/** 掷骰费用（很贵，加速烧钱） */
export const DICE_COST = P(5);
/** 体力系统 */
export const STAMINA_MAX = 100;
export const STAMINA_REGEN = 30;
export const STAMINA_DICE = 20;
export const STAMINA_BUY_LAND = 15;
export const STAMINA_BUILD = 15;

export const TILES = [
  { type: 'go',       name: '创业起点' },
  { type: 'property', name: '智慧农场',   color: 'agriculture',   price: P(60),  houseCost: P(50),  rents: R([2, 10, 30, 90, 160, 250]) },
  { type: 'lottery',  name: '彩票站点' },
  { type: 'property', name: '中央厨房',   color: 'agriculture',   price: P(60),  houseCost: P(50),  rents: R([4, 20, 60, 180, 320, 450]) },
  { type: 'tax',      name: '企业所得税', amount: P(200), desc: `缴纳 ${formatMoney(P(200))}` },
  { type: 'railroad', name: '高铁站',     price: P(200) },
  { type: 'property', name: '快递网点',   color: 'ecommerce',     price: P(100), houseCost: P(50),  rents: R([6, 30, 90, 270, 400, 550]) },
  { type: 'chance',   name: '风口' },
  { type: 'property', name: '云仓基地',   color: 'ecommerce',     price: P(100), houseCost: P(50),  rents: R([6, 30, 90, 270, 400, 550]) },
  { type: 'property', name: '跨境商城',   color: 'ecommerce',     price: P(120), houseCost: P(50),  rents: R([8, 40, 100, 300, 450, 600]) },
  { type: 'jail',     name: '监管局' },
  { type: 'property', name: '直播平台',   color: 'culture',       price: P(140), houseCost: P(100), rents: R([10, 50, 150, 450, 625, 750]) },
  { type: 'utility',  name: '云计算平台', price: P(150) },
  { type: 'property', name: '电竞俱乐部', color: 'culture',       price: P(140), houseCost: P(100), rents: R([10, 50, 150, 450, 625, 750]) },
  { type: 'property', name: '影视工场',   color: 'culture',       price: P(160), houseCost: P(100), rents: R([12, 60, 180, 500, 700, 900]) },
  { type: 'railroad', name: '国际机场',   price: P(200) },
  { type: 'property', name: '光伏电站',   color: 'energy',        price: P(180), houseCost: P(100), rents: R([14, 70, 200, 550, 750, 950]) },
  { type: 'hospital', name: '综合医院' },
  { type: 'property', name: '充电网络',   color: 'energy',        price: P(180), houseCost: P(100), rents: R([14, 70, 200, 550, 750, 950]) },
  { type: 'property', name: '电池工厂',   color: 'energy',        price: P(200), houseCost: P(100), rents: R([16, 80, 220, 600, 800, 1000]) },
  { type: 'parking',  name: '休闲度假区' },
  { type: 'property', name: '创新药企',   color: 'biotech',       price: P(220), houseCost: P(150), rents: R([18, 90, 250, 700, 875, 1050]) },
  { type: 'chance',   name: '风口' },
  { type: 'property', name: '基因实验室', color: 'biotech',       price: P(220), houseCost: P(150), rents: R([18, 90, 250, 700, 875, 1050]) },
  { type: 'property', name: '医疗集团',   color: 'biotech',       price: P(240), houseCost: P(150), rents: R([20, 100, 300, 750, 925, 1100]) },
  { type: 'railroad', name: '航运港口',   price: P(200) },
  { type: 'property', name: '芯片设计所', color: 'semiconductor', price: P(260), houseCost: P(150), rents: R([22, 110, 330, 800, 975, 1150]) },
  { type: 'property', name: '晶圆工厂',   color: 'semiconductor', price: P(260), houseCost: P(150), rents: R([22, 110, 330, 800, 975, 1150]) },
  { type: 'utility',  name: '智能电网',   price: P(150) },
  { type: 'property', name: '光刻中心',   color: 'semiconductor', price: P(280), houseCost: P(150), rents: R([24, 120, 360, 850, 1025, 1200]) },
  { type: 'gotojail', name: '违规被查' },
  { type: 'property', name: '大模型实验室', color: 'ai',          price: P(300), houseCost: P(200), rents: R([26, 130, 390, 900, 1100, 1275]) },
  { type: 'property', name: '智能体平台', color: 'ai',            price: P(300), houseCost: P(200), rents: R([26, 130, 390, 900, 1100, 1275]) },
  { type: 'chest',    name: '风险' },
  { type: 'property', name: '算力中心',   color: 'ai',            price: P(320), houseCost: P(200), rents: R([28, 150, 450, 1000, 1200, 1400]) },
  { type: 'railroad', name: '航天发射场', price: P(200) },
  { type: 'chance',   name: '风口' },
  { type: 'property', name: '量化基金',   color: 'fintech',       price: P(350), houseCost: P(200), rents: R([35, 175, 500, 1100, 1300, 1500]) },
  { type: 'tax',      name: '反垄断罚款', amount: P(100), desc: `缴纳 ${formatMoney(P(100))}` },
  { type: 'property', name: '数字银行',   color: 'fintech',       price: P(400), houseCost: P(200), rents: R([50, 200, 600, 1400, 1700, 2000]) },
];

export const GO_SALARY = P(200);        // 经过起点 ≈ Ŧ200万 融资
export const JAIL_INDEX = 10;           // 监管局
export const JAIL_FINE = P(50);         // 保释金
export const START_MONEY = P(1500);     // 初始 ≈ Ŧ1500万 启动资金
export const MAX_HOUSES = 5;            // 5 = 地标大厦
export const RAILROAD_RENTS = R([25, 50, 100, 200]);

// 银行
export const BANK_BASE_CREDIT = P(600); // 基础贷款额度
export const LOAN_INTEREST = 0.06;      // 每回合债务计息比例（利滚利）

// 公司
export const COMPANY_FOUND_COST = P(300);
export const COMPANY_MAX_LEVEL = 5;
export const companyUpgradeCost = (level) => P(250) * level;
export const companyBaseRevenue = (level) => P(6) + P(13) * level; // Lv1≈19万级

// ---------- 行业股票（8 大产业；交通/基建不进股市） ----------
// 设计说明：
// - 每人每行业最多 MAX_SHARES_PER_IND 手（可多手交易）
// - 全场流通另有 MAX_MARKET_SHARES 上限，避免无限印股把价/过路费打飞
// - 股价随「全场持股」上涨（供需）；过路费只随「地产业主自己的持股」上涨（激励地主持仓）
// - 分红按持股结算，与地产过路费分离
export const STOCK_INDUSTRIES = Object.keys(INDUSTRIES).filter(k => k !== 'railroad' && k !== 'utility');
export const STOCK_UNIT_BASE = P(50);    // 基础一手价 ≈ Ŧ50万
export const STOCK_PRICE_SHARE = 0.03;   // 全场每多 1 手，价 ×(1+0.03)；20 手约 +60%
export const STOCK_SPREAD = 0.90;       // 卖出价 = 买价 × 90%
export const HEAT_PER_BUY = 0.06;       // 购产热度对过路费
export const SHARE_RENT_PER = 0.035;    // 业主每持 1 手对该行业地产过路费 +3.5%
export const RENT_BOOST_CAP = 1.75;
export const DIVIDEND_PER_SHARE = P(3); // 每手每回合基础分红（再×景气）
export const MAX_SHARES_PER_IND = 20;   // 单玩家单行业持仓上限
export const MAX_MARKET_SHARES = 48;    // 单行业全场流通上限（约 2~3 人打满）
/** 单玩家单行业做空上限（裸空：先卖后买平） */
export const MAX_SHORT_PER_IND = 10;
/** 开空后现金中须保留的保证金比例（相对开空所得），防止无本做空 */
export const SHORT_MARGIN_RATIO = 0.35;

// ---------- 生活区房租（按操作秒数结算 + 上限；第一颗骰定区域倍率） ----------
// 公式：rent = min(LIVING_RENT_MAX, max(0, ceil(秒 - 免费秒)) * 每秒租金) × 区域倍率
// 有任意自有 property 则整次豁免。
export const LIVING_RENT_FREE_SEC = 8;     // 前 N 秒思考免费
export const LIVING_RENT_PER_SEC = P(3);   // 超时每秒房租（通天币）
export const LIVING_RENT_MAX = P(120);     // 单次房租硬上限（未乘区域前封顶，再乘区域后仍受此 cap）
export const LIVING_ZONES = [
  { id: 'suburb', name: '城郊生活区', dice: [1, 2], mult: 0.85, icon: '🏡' },
  { id: 'urban',  name: '城区生活区', dice: [3, 4], mult: 1.00, icon: '🏢' },
  { id: 'core',   name: '核心生活区', dice: [5, 6], mult: 1.25, icon: '🌆' },
];
export function livingZoneFromDie(d1) {
  const d = Math.max(1, Math.min(6, d1 | 0));
  return LIVING_ZONES.find(z => z.dice.includes(d)) || LIVING_ZONES[0];
}

/**
 * 纯函数：操作秒数 → 房租（通天币整数）
 * @param {number} seconds 本段操作耗时（秒，可小数）
 * @param {{ mult?: number }} [zone] 生活区（倍率）
 */
export function calcLivingRentAmount(seconds, zone = null) {
  const sec = Math.max(0, Number(seconds) || 0);
  const over = Math.max(0, sec - LIVING_RENT_FREE_SEC);
  // 按整秒向上计（犹豫 8.1s → 收 1 秒）
  const billable = Math.ceil(over - 1e-9);
  if (billable <= 0) return 0;
  const raw = billable * LIVING_RENT_PER_SEC;
  const mult = zone?.mult != null ? zone.mult : 1;
  const scaled = Math.round(raw * mult);
  return Math.min(LIVING_RENT_MAX, Math.max(0, scaled));
}

// ---------- 操作时长（兼容旧字段：与房租同一套上限语义） ----------
export const OP_TIME_FREE_SEC = LIVING_RENT_FREE_SEC;
export const OP_TIME_RATE = LIVING_RENT_PER_SEC;
export const OP_TIME_MAX = LIVING_RENT_MAX;

// ---------- 公司股权 / IPO ----------
export const COMPANY_TOTAL_SHARES = 100;
export const COMPANY_IPO_MIN_LEVEL = 2;
export const COMPANY_IPO_FLOAT = 30;
export const COMPANY_MAX_SELL_PCT = 0.45;
export const SHARE_PLEDGE_LOAN = P(8);   // 每质押 1 股可贷

// ---------- 行业资讯对股价 ----------
export const NEWS_MIN = 0.65;
export const NEWS_MAX = 1.45;
export const NEWS_STEP = 0.12;
