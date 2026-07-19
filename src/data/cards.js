// 风口 / 风险 卡牌（现代商业版）— 金额为通天币
// action.kind:
//   moveTo / moveSteps / nearest / money / moneyEach / jail / jailCard
//   repair / industry / item / news
import { ttc, formatMoney } from './currency.js';

const M = (n) => ttc(n);

export const CHANCE_CARDS = [
  { text: `融资到账！前进到创业起点，领取 ${formatMoney(M(200))}。`, action: { kind: 'moveTo', to: 0, collectGo: true } },
  { text: `数字化转型成功，获得政府补贴 ${formatMoney(M(100))}。`, action: { kind: 'money', amount: M(100) } },
  { text: `你的短视频意外爆火，每位玩家打赏你 ${formatMoney(M(20))}。`, action: { kind: 'moneyEach', amount: M(20) } },
  { text: '获得 🎯 遥控骰子 ×1。', action: { kind: 'item', item: 'remote', n: 1 } },
  { text: '获得 🛡️ 免租卡 ×1。', action: { kind: 'item', item: 'rentFree', n: 1 } },
  { text: '获得 🚀 加速卡 ×1。', action: { kind: 'item', item: 'boost', n: 1 } },
  { text: '获得 💳 均富卡 ×1。', action: { kind: 'item', item: 'equalize', n: 1 } },
  { text: '获得 🥷 抢夺卡 ×1。', action: { kind: 'item', item: 'rob', n: 1 } },
  { text: '获得 😴 冬眠卡 ×1。', action: { kind: 'item', item: 'hibernate', n: 1 } },
  { text: '万亿赛道开启！随机一个行业进入 🔥火爆 状态。', action: { kind: 'industry', mode: 'boom' } },
  { text: '前往最近的交通枢纽考察物流。', action: { kind: 'nearest', target: 'railroad' } },
  { text: `前往算力中心洽谈合作（经过起点领 ${formatMoney(M(200))}）。`, action: { kind: 'moveTo', to: 34, collectGo: true } },
  { text: '聘请顶级合规顾问，获得免于约谈卡 ×1。', action: { kind: 'jailCard' } },
  { text: '抢占先机！前进 3 步。', action: { kind: 'moveSteps', steps: 3 } },
  { text: `担任行业协会会长，向每位玩家收取 ${formatMoney(M(50))} 会费。`, action: { kind: 'moneyEach', amount: M(50) } },
  { text: '内部路演材料泄露：获得 📰 资讯卡 ×1，可干扰股市。', action: { kind: 'item', item: 'intel', n: 1 } },
  { text: '买方机构抢筹！随机一行业股价资讯利好。', action: { kind: 'news', mode: 'up' } },
  { text: '市政放宽审批：获得 🏗️ 建设卡 ×2。', action: { kind: 'item', item: 'permit', n: 2 } },
  { text: '工商局绿色通道：获得 📜 公司卡 ×1。', action: { kind: 'item', item: 'charter', n: 1 } },
  { text: '供应链集采成功：获得 🏗️ 建设卡 ×1。', action: { kind: 'item', item: 'permit', n: 1 } },
  { text: '创投路演通关：获得 📜 公司卡 ×1。', action: { kind: 'item', item: 'charter', n: 1 } },
];

export const CHEST_CARDS = [
  { text: `黑客攻击！支付数据恢复费 ${formatMoney(M(100))}。`, action: { kind: 'money', amount: -M(100) } },
  { text: '行业寒冬来袭！随机一个行业陷入 📉低迷。', action: { kind: 'industry', mode: 'bust' } },
  { text: `股市闪崩，你的持仓蒸发 ${formatMoney(M(80))}。`, action: { kind: 'money', amount: -M(80) } },
  { text: '违规操作被当场约谈！直接进监管局，不得领取融资。', action: { kind: 'jail' } },
  { text: `数据中心全面维护：每栋建筑支付 ${formatMoney(M(30))}，每个地标支付 ${formatMoney(M(120))}。`, action: { kind: 'repair', house: M(30), hotel: M(120) } },
  { text: '挖到对手黑料，获得 💥 拆迁卡 ×1。', action: { kind: 'item', item: 'demolish', n: 1 } },
  { text: '塞翁失马：获得 🔀 换地卡 ×1。', action: { kind: 'item', item: 'swap', n: 1 } },
  { text: `产品召回，退一赔三：向每位玩家赔付 ${formatMoney(M(15))}。`, action: { kind: 'moneyEach', amount: -M(15) } },
  { text: `过劳体检异常，医疗费 ${formatMoney(M(50))}。`, action: { kind: 'money', amount: -M(50) } },
  { text: `盲目扩张被市场教育，损失 ${formatMoney(M(60))}。`, action: { kind: 'money', amount: -M(60) } },
  { text: '供应链中断！后退 3 步。', action: { kind: 'moveSteps', steps: -3 } },
  { text: `服务器宕机一小时，损失 ${formatMoney(M(40))}。`, action: { kind: 'money', amount: -M(40) } },
  { text: '塞翁失马：获得 🎯 遥控骰子 ×1。', action: { kind: 'item', item: 'remote', n: 1 } },
  { text: `年终审计通过，退税 ${formatMoney(M(30))}。`, action: { kind: 'money', amount: M(30) } },
  { text: `荣获行业大奖，奖金 ${formatMoney(M(10))}。`, action: { kind: 'money', amount: M(10) } },
  { text: '监管约谈纪要外泄：获得 📰 资讯卡 ×1。', action: { kind: 'item', item: 'intel', n: 1 } },
  { text: '空头砸盘！随机一行业股价资讯利空。', action: { kind: 'news', mode: 'down' } },
  { text: '工地赶工批复：获得 🏗️ 建设卡 ×1。', action: { kind: 'item', item: 'permit', n: 1 } },
  { text: '创业加速营结业：获得 📜 公司卡 ×1。', action: { kind: 'item', item: 'charter', n: 1 } },
  { text: '园区招商礼包：获得 🏗️ 建设卡 ×2。', action: { kind: 'item', item: 'permit', n: 2 } },
  { text: '赛道政策红利：获得 📜 公司卡 ×1。', action: { kind: 'item', item: 'charter', n: 1 } },
];
