import fs from 'fs';

const path = 'src/main.js';
let s = fs.readFileSync(path, 'utf8');

if (!s.includes('_announceCast')) {
  const marker = '  /** 人类玩家打出主动卡（含目标选择流程），返回 Promise（完成后刷新牌角标） */';
  const insert = `  /** 全场可见出牌（列表高亮；HUD 已在 handUI 播过时可 silent） */
  async _announceCast(p, item, { silent = true } = {}) {
    try { await this.ui.showItemCast?.(p, item, { silent }); } catch { /* */ }
  }

`;
  if (!s.includes(marker)) throw new Error('marker not found');
  s = s.replace(marker, insert + marker);
}

const patches = [
  [
    `          this.log(\`\${p.name} 打出 💥拆迁卡`,
    `          await this._announceCast(p, item);
          this.log(\`\${p.name} 打出 💥拆迁卡`,
  ],
  [
    `          this.log(\`💳 \${p.name} 打出均富卡`,
    `          await this._announceCast(p, item);
          this.log(\`💳 \${p.name} 打出均富卡`,
  ],
  [
    `        this.log(\`🥷 \${p.name} 抢夺 \${t.name}`,
    `        await this._announceCast(p, item);
        this.log(\`🥷 \${p.name} 抢夺 \${t.name}`,
  ],
  [
    `        this.log(\`😴 \${p.name} 让 \${t.name} 进入冬眠，跳过其下一回合`,
    `        await this._announceCast(p, item);
        this.log(\`😴 \${p.name} 让 \${t.name} 进入冬眠，跳过其下一回合`,
  ],
  [
    `            this.log(\`🔀 \${p.name} 用 \${TILES[myTile].name}`,
    `            await this._announceCast(p, item);
            this.log(\`🔀 \${p.name} 用 \${TILES[myTile].name}`,
  ],
  [
    `          this.log(\`📰 \${p.name} 发布\${mode === 'up' ? '利好' : '利空'}`,
    `          await this._announceCast(p, item);
          this.log(\`📰 \${p.name} 发布\${mode === 'up' ? '利好' : '利空'}`,
  ],
];

for (const [a, b] of patches) {
  if (!s.includes(a)) {
    console.warn('skip missing', a.slice(0, 40));
    continue;
  }
  if (s.includes(b.slice(0, 40))) continue;
  s = s.replace(a, b);
  console.log('patched', a.slice(0, 30));
}

// openDemolish callback needs async
s = s.replace(
  'this.ui.openDemolish(this.g, p, (tileIdx) => {',
  'this.ui.openDemolish(this.g, p, async (tileIdx) => {',
);
s = s.replace(
  'this.ui.openSwap(this.g, p, ({ targetId, myTile, theirTile }) => {',
  'this.ui.openSwap(this.g, p, async ({ targetId, myTile, theirTile }) => {',
);

fs.writeFileSync(path, s);
console.log('done');
