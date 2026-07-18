// 棋盘数据：现代商业版 40 格布局
// 8 大行业 + 交通枢纽 + 基础设施；rents = [空地, 1级, 2级, 3级, 4级, 地标]

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
  demolish:  { name: '拆迁卡',   icon: '💥', desc: '拆除任一对手的一级建筑' },
  equalize:  { name: '均富卡',   icon: '💳', desc: '所有存活玩家的现金变为平均值' },
  rob:       { name: '抢夺卡',   icon: '🥷', desc: '偷取一名对手 20% 现金（上限 ¥300）' },
  swap:      { name: '换地卡',   icon: '🔀', desc: '用你的一块地产换对手的一块地产（均须无建筑未抵押）' },
  hibernate: { name: '冬眠卡',   icon: '😴', desc: '指定一名对手跳过其下一个回合' },
};

// 回合内可主动打出的卡
export const PLAYABLE_ITEMS = ['demolish', 'equalize', 'rob', 'swap', 'hibernate'];

export const TILES = [
  { type: 'go',       name: '创业起点' },
  { type: 'property', name: '智慧农场',   color: 'agriculture',   price: 60,  houseCost: 50,  rents: [2, 10, 30, 90, 160, 250] },
  { type: 'chest',    name: '风险' },
  { type: 'property', name: '中央厨房',   color: 'agriculture',   price: 60,  houseCost: 50,  rents: [4, 20, 60, 180, 320, 450] },
  { type: 'tax',      name: '企业所得税', amount: 200, desc: '缴纳 ¥200' },
  { type: 'railroad', name: '高铁站',     price: 200 },
  { type: 'property', name: '快递网点',   color: 'ecommerce',     price: 100, houseCost: 50,  rents: [6, 30, 90, 270, 400, 550] },
  { type: 'chance',   name: '风口' },
  { type: 'property', name: '云仓基地',   color: 'ecommerce',     price: 100, houseCost: 50,  rents: [6, 30, 90, 270, 400, 550] },
  { type: 'property', name: '跨境商城',   color: 'ecommerce',     price: 120, houseCost: 50,  rents: [8, 40, 100, 300, 450, 600] },
  { type: 'jail',     name: '监管局' },
  { type: 'property', name: '直播平台',   color: 'culture',       price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { type: 'utility',  name: '云计算平台', price: 150 },
  { type: 'property', name: '电竞俱乐部', color: 'culture',       price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { type: 'property', name: '影视工场',   color: 'culture',       price: 160, houseCost: 100, rents: [12, 60, 180, 500, 700, 900] },
  { type: 'railroad', name: '国际机场',   price: 200 },
  { type: 'property', name: '光伏电站',   color: 'energy',        price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { type: 'chest',    name: '风险' },
  { type: 'property', name: '充电网络',   color: 'energy',        price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { type: 'property', name: '电池工厂',   color: 'energy',        price: 200, houseCost: 100, rents: [16, 80, 220, 600, 800, 1000] },
  { type: 'parking',  name: '休闲度假区' },
  { type: 'property', name: '创新药企',   color: 'biotech',       price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { type: 'chance',   name: '风口' },
  { type: 'property', name: '基因实验室', color: 'biotech',       price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { type: 'property', name: '医疗集团',   color: 'biotech',       price: 240, houseCost: 150, rents: [20, 100, 300, 750, 925, 1100] },
  { type: 'railroad', name: '航运港口',   price: 200 },
  { type: 'property', name: '芯片设计所', color: 'semiconductor', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { type: 'property', name: '晶圆工厂',   color: 'semiconductor', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { type: 'utility',  name: '智能电网',   price: 150 },
  { type: 'property', name: '光刻中心',   color: 'semiconductor', price: 280, houseCost: 150, rents: [24, 120, 360, 850, 1025, 1200] },
  { type: 'gotojail', name: '违规被查' },
  { type: 'property', name: '大模型实验室', color: 'ai',          price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { type: 'property', name: '智能体平台', color: 'ai',            price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { type: 'chest',    name: '风险' },
  { type: 'property', name: '算力中心',   color: 'ai',            price: 320, houseCost: 200, rents: [28, 150, 450, 1000, 1200, 1400] },
  { type: 'railroad', name: '航天发射场', price: 200 },
  { type: 'chance',   name: '风口' },
  { type: 'property', name: '量化基金',   color: 'fintech',       price: 350, houseCost: 200, rents: [35, 175, 500, 1100, 1300, 1500] },
  { type: 'tax',      name: '反垄断罚款', amount: 100, desc: '缴纳 ¥100' },
  { type: 'property', name: '数字银行',   color: 'fintech',       price: 400, houseCost: 200, rents: [50, 200, 600, 1400, 1700, 2000] },
];

export const GO_SALARY = 200;        // 经过起点（融资到账）
export const JAIL_INDEX = 10;        // 监管局
export const JAIL_FINE = 50;         // 保释金
export const START_MONEY = 1500;     // 初始资金
export const MAX_HOUSES = 5;         // 5 = 地标大厦
export const RAILROAD_RENTS = [25, 50, 100, 200]; // 按拥有枢纽数量

// 银行
export const BANK_BASE_CREDIT = 600; // 基础贷款额度
export const LOAN_INTEREST = 0.06;   // 每回合债务计息比例（利滚利）——平衡仿真调优值

// 公司
export const COMPANY_FOUND_COST = 300;
export const COMPANY_MAX_LEVEL = 5;
export const companyUpgradeCost = (level) => 250 * level;
export const companyBaseRevenue = (level) => 6 + 13 * level; // Lv1≈19, Lv5≈71（×行业景气）
