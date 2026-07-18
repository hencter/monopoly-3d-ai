// 风口 / 风险 卡牌（现代商业版）
// action.kind:
//   moveTo      前进到指定格 (collectGo: 经过起点是否领工资)
//   moveSteps   前进/后退若干格
//   nearest     前进到最近的交通枢纽/基础设施
//   money       与银行结算 (正=收入, 负=支出)
//   moneyEach   与其他每位玩家结算 (正=收取, 负=赔付)
//   jail        直接被约谈（进监管局）
//   jailCard    获得免于约谈卡
//   repair      建筑维护费: 每栋建筑 house, 每个地标 hotel
//   industry    行业景气变动 (mode: 'boom' 火爆 / 'bust' 低迷)
//   item        获得道具 (item: remote/boost/rentFree/demolish)

export const CHANCE_CARDS = [
  { text: '融资到账！前进到创业起点，领取 ¥200。', action: { kind: 'moveTo', to: 0, collectGo: true } },
  { text: '数字化转型成功，获得政府补贴 ¥100。', action: { kind: 'money', amount: 100 } },
  { text: '你的短视频意外爆火，每位玩家打赏你 ¥20。', action: { kind: 'moneyEach', amount: 20 } },
  { text: '获得 🎯 遥控骰子 ×1。', action: { kind: 'item', item: 'remote', n: 1 } },
  { text: '获得 🛡️ 免租卡 ×1。', action: { kind: 'item', item: 'rentFree', n: 1 } },
  { text: '获得 🚀 加速卡 ×1。', action: { kind: 'item', item: 'boost', n: 1 } },
  { text: '获得 💳 均富卡 ×1。', action: { kind: 'item', item: 'equalize', n: 1 } },
  { text: '获得 🥷 抢夺卡 ×1。', action: { kind: 'item', item: 'rob', n: 1 } },
  { text: '获得 😴 冬眠卡 ×1。', action: { kind: 'item', item: 'hibernate', n: 1 } },
  { text: '万亿赛道开启！随机一个行业进入 🔥火爆 状态。', action: { kind: 'industry', mode: 'boom' } },
  { text: '前往最近的交通枢纽考察物流。', action: { kind: 'nearest', target: 'railroad' } },
  { text: '前往算力中心洽谈合作（经过起点领 ¥200）。', action: { kind: 'moveTo', to: 34, collectGo: true } },
  { text: '聘请顶级合规顾问，获得免于约谈卡 ×1。', action: { kind: 'jailCard' } },
  { text: '抢占先机！前进 3 步。', action: { kind: 'moveSteps', steps: 3 } },
  { text: '担任行业协会会长，向每位玩家收取 ¥50 会费。', action: { kind: 'moneyEach', amount: 50 } },
];

export const CHEST_CARDS = [
  { text: '黑客攻击！支付数据恢复费 ¥100。', action: { kind: 'money', amount: -100 } },
  { text: '行业寒冬来袭！随机一个行业陷入 📉低迷。', action: { kind: 'industry', mode: 'bust' } },
  { text: '股市闪崩，你的持仓蒸发 ¥80。', action: { kind: 'money', amount: -80 } },
  { text: '违规操作被当场约谈！直接进监管局，不得领取融资。', action: { kind: 'jail' } },
  { text: '数据中心全面维护：每栋建筑支付 ¥30，每个地标支付 ¥120。', action: { kind: 'repair', house: 30, hotel: 120 } },
  { text: '挖到对手黑料，获得 💥 拆迁卡 ×1。', action: { kind: 'item', item: 'demolish', n: 1 } },
  { text: '塞翁失马：获得 🔀 换地卡 ×1。', action: { kind: 'item', item: 'swap', n: 1 } },
  { text: '产品召回，退一赔三：向每位玩家赔付 ¥15。', action: { kind: 'moneyEach', amount: -15 } },
  { text: '过劳体检异常，医疗费 ¥50。', action: { kind: 'money', amount: -50 } },
  { text: '盲目扩张被市场教育，损失 ¥60。', action: { kind: 'money', amount: -60 } },
  { text: '供应链中断！后退 3 步。', action: { kind: 'moveSteps', steps: -3 } },
  { text: '服务器宕机一小时，损失 ¥40。', action: { kind: 'money', amount: -40 } },
  { text: '塞翁失马：获得 🎯 遥控骰子 ×1。', action: { kind: 'item', item: 'remote', n: 1 } },
  { text: '年终审计通过，退税 ¥30。', action: { kind: 'money', amount: 30 } },
  { text: '荣获行业大奖，奖金 ¥10。', action: { kind: 'money', amount: 10 } },
];
