// Three.js 3D 世界：棋盘、棋子、摩天楼、公司总部、骰子、智能镜头、生活区、场景弹幕
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TILES, INDUSTRIES, LIVING_ZONES, JAIL_INDEX, formatMoney } from '../data/tiles.js';
import { soundManager } from '../audio.js';
import { handUI, preloadCardTextures } from '../ui/handUI.js';

export { preloadCardTextures };

// ---------- 外部贴图（public/textures）----------
const TEX = Object.create(null);
const TEX_FILES = {
  ground: 'ground.png',
  board_felt: 'board_felt.png',
  board_rim: 'board_rim.png',
  tile_base: 'tile_base.png',
  tower_glass: 'tower_glass.png',
  hq_cladding: 'hq_cladding.png',
  mat_plastic: 'mat_plastic.png',
  mat_metal: 'mat_metal.png',
  mat_felt: 'mat_felt.png',
  mat_wood: 'mat_wood.png',
  mat_panel: 'mat_panel.png',
  mat_rubber: 'mat_rubber.png',
  mat_tech: 'mat_tech.png',
  // 行业建筑立面（与地块行业对应）
  bld_agriculture: 'buildings/facade_agriculture.jpg',
  bld_ecommerce: 'buildings/facade_ecommerce.jpg',
  bld_culture: 'buildings/facade_culture.jpg',
  bld_energy: 'buildings/facade_energy.jpg',
  bld_biotech: 'buildings/facade_biotech.jpg',
  bld_semiconductor: 'buildings/facade_semiconductor.jpg',
  bld_ai: 'buildings/facade_ai.jpg',
  bld_fintech: 'buildings/facade_fintech.jpg',
  bld_landmark: 'buildings/facade_landmark.jpg',
  bld_roof: 'buildings/facade_roof.jpg',
};

/** 行业 → 建筑贴图键 */
const BLD_TEX_KEY = {
  agriculture: 'bld_agriculture',
  ecommerce: 'bld_ecommerce',
  culture: 'bld_culture',
  energy: 'bld_energy',
  biotech: 'bld_biotech',
  semiconductor: 'bld_semiconductor',
  ai: 'bld_ai',
  fintech: 'bld_fintech',
};

/** 预加载全部 PBR 贴图；失败时对应键保持 undefined，材质回退纯色 */
export function preloadTextures() {
  const loader = new THREE.TextureLoader();
  const maxAniso = 8;
  return Promise.all([
    ...Object.entries(TEX_FILES).map(([key, file]) =>
      new Promise((resolve) => {
        loader.load(
          `/textures/${file}`,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.anisotropy = maxAniso;
            tex.userData.shared = true;
            TEX[key] = tex;
            resolve();
          },
          undefined,
          () => { console.warn(`[textures] missing ${file}`); resolve(); }
        );
      }),
    ),
    preloadTileArt(),
  ]);
}

// ---------- 地砖艺术面（行业/特殊格）----------
const TILE_ART = Object.create(null);
const TILE_ART_FILES = {
  agriculture: 'tiles/ind_agriculture.jpg',
  ecommerce: 'tiles/ind_ecommerce.jpg',
  culture: 'tiles/ind_culture.jpg',
  energy: 'tiles/ind_energy.jpg',
  biotech: 'tiles/ind_biotech.jpg',
  semiconductor: 'tiles/ind_semiconductor.jpg',
  ai: 'tiles/ind_ai.jpg',
  fintech: 'tiles/ind_fintech.jpg',
  railroad: 'tiles/special_railroad.jpg',
  utility: 'tiles/special_utility.jpg',
  go: 'tiles/special_go.jpg',
  jail: 'tiles/special_jail.jpg',
  parking: 'tiles/special_parking.jpg',
  gotojail: 'tiles/special_gotojail.jpg',
  chance: 'tiles/special_chance.jpg',
  chest: 'tiles/special_chest.jpg',
  tax: 'tiles/special_tax.jpg',
};

/** 预加载地砖艺术贴图 */
export function preloadTileArt() {
  const loader = new THREE.TextureLoader();
  return Promise.all(Object.entries(TILE_ART_FILES).map(([key, file]) =>
    new Promise((resolve) => {
      loader.load(
        `/textures/${file}`,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.anisotropy = 8;
          tex.userData.shared = true;
          TILE_ART[key] = tex;
          resolve();
        },
        undefined,
        () => { console.warn(`[tile-art] missing ${file}`); resolve(); },
      );
    }),
  ));
}

function tileArtKey(t) {
  if (!t) return null;
  if (t.type === 'property') return t.color || null;
  if (t.type === 'railroad') return 'railroad';
  if (t.type === 'utility') return 'utility';
  return TILE_ART_FILES[t.type] ? t.type : null;
}

/** 克隆一份可独立 UV 的贴图（可安全 dispose；共享底图不会被释放） */
function texClone(key, repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0) {
  const src = TEX[key];
  if (!src) return null;
  const t = src.clone();
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = src.anisotropy;
  t.repeat.set(repeatX, repeatY);
  t.offset.set(offsetX, offsetY);
  t.needsUpdate = true;
  t.userData.shared = false;
  return t;
}

/** 标准带贴图材质；map 可 tint（map × color）。无贴图时退回纯色 */
function stdMat(key, {
  color = 0xffffff,
  roughness = 0.55,
  metalness = 0.1,
  repeat = 1,
  repeatY = null,
  offsetX = null,
  offsetY = null,
  emissive = 0x000000,
  emissiveIntensity = 0,
  useAsEmissiveMap = false,
} = {}) {
  const ox = offsetX == null ? Math.random() * 0.35 : offsetX;
  const oy = offsetY == null ? Math.random() * 0.35 : offsetY;
  const map = texClone(key, repeat, repeatY ?? repeat, ox, oy);
  return new THREE.MeshStandardMaterial({
    map: map || undefined,
    color: map ? color : color,
    roughness,
    metalness,
    emissive,
    emissiveMap: useAsEmissiveMap && map ? map : undefined,
    emissiveIntensity,
  });
}

/**
 * 建筑立面材质：优先行业 facade 贴图，否则通用幕墙 / 程序化窗
 * @param {number} rows 纵向重复
 * @param {number} [litRatio=0.55]
 * @param {string|null} [industry] 行业键
 * @param {{ landmark?: boolean }} [opts]
 */
function towerMat(rows, litRatio = 0.55, industry = null, opts = {}) {
  const indKey = industry && BLD_TEX_KEY[industry];
  const prefer = opts.landmark
    ? (TEX.bld_landmark ? 'bld_landmark' : indKey)
    : indKey;
  const tryKeys = [prefer, 'tower_glass', 'hq_cladding'].filter(Boolean);
  let map = null;
  let usedKey = null;
  for (const k of tryKeys) {
    map = texClone(k, 1, Math.max(0.55, rows / 8), Math.random() * 0.2, Math.random() * 0.15);
    if (map) { usedKey = k; break; }
  }
  const accent = INDUSTRIES[industry]?.hex ?? 0xffc766;
  if (map) {
    return new THREE.MeshStandardMaterial({
      map,
      color: 0xffffff,
      emissive: accent,
      emissiveMap: map,
      emissiveIntensity: usedKey?.startsWith('bld_') ? 0.22 + litRatio * 0.12 : 0.5 + litRatio * 0.15,
      roughness: usedKey?.startsWith('bld_') ? 0.42 : 0.3,
      metalness: usedKey?.startsWith('bld_') ? 0.28 : 0.4,
    });
  }
  const tex = towerTexture(rows, litRatio, industry);
  return new THREE.MeshStandardMaterial({
    map: tex,
    emissive: accent,
    emissiveMap: tex,
    emissiveIntensity: 0.45,
    roughness: 0.35,
    metalness: 0.3,
  });
}

/** 屋顶材质 */
function roofMat(industry = null) {
  const map = texClone('bld_roof', 1, 1, 0, 0) || texClone('mat_panel', 2, 2, 0, 0);
  const col = INDUSTRIES[industry]?.hex ?? 0x555555;
  return new THREE.MeshStandardMaterial({
    map: map || undefined,
    color: map ? 0xffffff : col,
    roughness: 0.7,
    metalness: 0.25,
    emissive: col,
    emissiveIntensity: 0.08,
  });
}

/** 释放 Group 内全部几何体/材质/贴图，防止 GPU 显存泄漏（共享贴图不释放） */
function disposeGroup(g) {
  if (!g) return;
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map && !m.map.userData?.shared) m.map.dispose();
        if (m.emissiveMap && m.emissiveMap !== m.map && !m.emissiveMap.userData?.shared) m.emissiveMap.dispose();
        m.dispose();
      }
    }
  });
}

export const MAX_PLAYERS = 34;

// 34 色：前 6 色固定（辨识度高），其余按黄金角 hue 生成
function buildColors() {
  const fixed = [[0xe74c3c, '#e74c3c'], [0x3498db, '#3498db'], [0xf1c40f, '#f1c40f'], [0x2ecc71, '#2ecc71'], [0x9b59b6, '#9b59b6'], [0x1abc9c, '#1abc9c']];
  const hex = [], css = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (i < fixed.length) { hex.push(fixed[i][0]); css.push(fixed[i][1]); continue; }
    const hue = (i * 137.508) % 360;
    const c = new THREE.Color(`hsl(${hue.toFixed(1)}, 68%, 55%)`);
    hex.push(c.getHex());
    css.push(`#${c.getHexString()}`);
  }
  return { hex, css };
}
const _colors = buildColors();
export const PLAYER_COLORS = _colors.hex;
export const PLAYER_COLORS_CSS = _colors.css;
export const TOKEN_NAMES = ['汽车', '礼帽', '小狗', '帆船', '火箭', '机器人'];

const HALF = 10;
const TILE = 2;
const TILE_H = 0.35;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

export function tilePosition(i) {
  i = ((i % 40) + 40) % 40;
  if (i <= 10) return new THREE.Vector3(HALF - TILE * i, TILE_H, HALF);
  if (i <= 20) return new THREE.Vector3(-HALF, TILE_H, HALF - TILE * (i - 10));
  if (i <= 30) return new THREE.Vector3(-HALF + TILE * (i - 20), TILE_H, -HALF);
  return new THREE.Vector3(HALF, TILE_H, -HALF + TILE * (i - 30));
}

/** 棋子槽位：≤6 人用 2×3 网格；更多人用动态网格（人数越多越密、棋子越小） */
function slotLayout(count) {
  if (count <= 6) return { cols: 2, rows: 3, span: 0.95 };
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows, span: 1.62 };
}

function tokenSlot(i, playerId, count = 6) {
  const p = tilePosition(i);
  const { cols, rows, span } = slotLayout(count);
  const col = playerId % cols;
  const row = Math.floor(playerId / cols) % rows;
  p.x += (col - (cols - 1) / 2) * (span / cols) * 2;
  p.z += (row - (rows - 1) / 2) * (span / rows) * 2;
  p.y = TILE_H + 0.02;
  return p;
}

/** 人数对应的棋子缩放（34 人时约 0.5 倍） */
function tokenScale(count) {
  if (count <= 6) return 1;
  return Math.max(0.45, Math.min(1, 3.4 / slotLayout(count).cols));
}

function tileFrame(i) {
  if (i <= 10)      return { dir: new THREE.Vector3(0, 0, -1), tan: new THREE.Vector3(1, 0, 0) };
  if (i <= 20)      return { dir: new THREE.Vector3(1, 0, 0),  tan: new THREE.Vector3(0, 0, 1) };
  if (i <= 30)      return { dir: new THREE.Vector3(0, 0, 1),  tan: new THREE.Vector3(1, 0, 0) };
  return                   { dir: new THREE.Vector3(-1, 0, 0), tan: new THREE.Vector3(0, 0, 1) };
}

function makeCanvas(w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

/**
 * 地砖顶面：纯艺术贴图（文字改由 CSS2D 悬浮标签）
 * @param {object} t TILES[i]
 */
function tileTexture(t) {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  const key = tileArtKey(t);
  const art = key ? TILE_ART[key] : null;
  const img = art?.image;

  if (img && img.width) {
    ctx.drawImage(img, 0, 0, S, S);
  } else {
    // 无艺术图兜底
    ctx.fillStyle = '#f8f3e6';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#b9a67a';
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, S - 12, S - 12);
    if (t.type === 'property' && INDUSTRIES[t.color]) {
      ctx.fillStyle = INDUSTRIES[t.color].css;
      ctx.fillRect(12, 12, S - 24, 96);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 48px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(INDUSTRIES[t.color].icon, S / 2, 60);
    } else {
      const icon = ({
        go: '💰', jail: '⚖️', parking: '🏝️', gotojail: '🚨',
        chance: '🌪️', chest: '⚠️', tax: '💸', railroad: '🚄', utility: '🔌',
      })[t.type] || '⬜';
      ctx.font = '72px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, S / 2, S / 2);
    }
  }

  // 细金边
  ctx.strokeStyle = 'rgba(240, 199, 94, 0.4)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, S - 20, S - 20);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 地砖悬浮文字 DOM（CSS2D，始终朝向屏幕）
 * @param {object} t
 */
function makeTileFloatLabel(t) {
  const el = document.createElement('div');
  el.className = `tile-float-label tfl-${t.type || 'other'}`;
  if (t.type === 'property' && t.color) el.classList.add(`tfl-ind-${t.color}`);

  let icon = '';
  let sub = '';
  if (t.type === 'property') {
    icon = INDUSTRIES[t.color]?.icon || '🏢';
    sub = formatMoney(t.price);
  } else if (t.type === 'railroad') {
    icon = t.name?.includes('航天') ? '🚀' : t.name?.includes('机场') ? '✈️' : t.name?.includes('港') ? '🚢' : '🚄';
    sub = formatMoney(t.price);
  } else if (t.type === 'utility') {
    icon = t.name?.includes('云') ? '☁️' : '🔌';
    sub = formatMoney(t.price);
  } else if (t.type === 'chance') {
    icon = '🌪️';
  } else if (t.type === 'chest') {
    icon = '⚠️';
  } else if (t.type === 'tax') {
    icon = '💸';
    sub = formatMoney(t.amount);
  } else if (t.type === 'go') {
    icon = '💰';
  } else if (t.type === 'jail') {
    icon = '⚖️';
  } else if (t.type === 'parking') {
    icon = '🏝️';
  } else if (t.type === 'gotojail') {
    icon = '🚨';
  }

  el.innerHTML = `
    <span class="tfl-icon">${icon}</span>
    <span class="tfl-name">${t.name || ''}</span>
    ${sub ? `<span class="tfl-sub">${sub}</span>` : ''}`;
  return el;
}

function diceFaceTexture(v) {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#fdfdfd';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = (v === 1 || v === 4) ? '#c0392b' : '#222';
  const P = { 1: [[64, 64]], 2: [[36, 36], [92, 92]], 3: [[32, 32], [64, 64], [96, 96]], 4: [[36, 36], [92, 36], [36, 92], [92, 92]], 5: [[32, 32], [96, 32], [64, 64], [32, 96], [96, 96]], 6: [[36, 30], [92, 30], [36, 64], [92, 64], [36, 98], [92, 98]] }[v];
  for (const [x, y] of P) { ctx.beginPath(); ctx.arc(x, y, v === 1 ? 18 : 12, 0, Math.PI * 2); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const DICE_FACE_VALUES = [2, 5, 1, 6, 3, 4];
function diceQuaternionFor(v) {
  const q = new THREE.Quaternion();
  switch (v) {
    case 1: q.identity(); break;
    case 6: q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI); break;
    case 2: q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2); break;
    case 5: q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2); break;
    case 3: q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); break;
    case 4: q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); break;
  }
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2);
  return spin.multiply(q);
}

/** 程序化幕墙（无外部贴图时）；可带行业主色 */
function towerTexture(rows, litRatio = 0.55, industry = null) {
  const [c, ctx] = makeCanvas(64, 32 * rows);
  const hex = INDUSTRIES[industry]?.hex ?? 0x223549;
  const r0 = (hex >> 16) & 255;
  const g0 = (hex >> 8) & 255;
  const b0 = hex & 255;
  ctx.fillStyle = `rgb(${Math.floor(r0 * 0.22)},${Math.floor(g0 * 0.25)},${Math.floor(b0 * 0.32 + 40)})`;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < 4; col++) {
      const lit = Math.random() < litRatio;
      ctx.fillStyle = lit
        ? `rgb(${Math.min(255, r0 + 80)},${Math.min(255, g0 + 90)},${Math.min(255, b0 + 40)})`
        : `rgb(${Math.floor(r0 * 0.35)},${Math.floor(g0 * 0.4)},${Math.floor(b0 * 0.45 + 30)})`;
      ctx.fillRect(6 + col * 14, 6 + r * 32, 9, 14);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 按行业生成建筑几何（等级 1~4 普通楼；5 地标）
 * @returns {THREE.Group}
 */
function buildIndustryHouse(industry, level, cx, cz) {
  const g = new THREE.Group();
  const ind = industry || 'fintech';
  const body = towerMat(3 + level * 2, 0.5 + level * 0.05, ind, { landmark: level >= 5 });
  const roof = roofMat(ind);
  const accent = INDUSTRIES[ind]?.hex ?? 0x888888;

  const addBox = (w, h, d, y, mat, ox = 0, oz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx + ox, TILE_H + y, cz + oz);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  if (level >= 5) {
    // 地标：主塔 + 副楼 + 行业特色顶饰
    addBox(0.62, 1.9, 0.62, 0.95, body);
    addBox(0.34, 0.95, 0.34, 0.48, towerMat(8, 0.55, ind), 0.4, 0.28);
    addBox(0.68, 0.07, 0.68, 1.94, roof);
    // 尖顶 / 天线
    const spireMat = new THREE.MeshStandardMaterial({
      color: accent, emissive: accent, emissiveIntensity: 0.85, metalness: 0.6, roughness: 0.25,
    });
    if (ind === 'energy') {
      // 风机式顶
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.55, 8), spireMat);
      pole.position.set(cx, TILE_H + 2.2, cz);
      g.add(pole);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.08), spireMat);
        blade.position.set(cx, TILE_H + 2.42, cz);
        blade.rotation.z = (i / 3) * Math.PI * 2;
        g.add(blade);
      }
    } else if (ind === 'agriculture') {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({
          color: 0xa8e6cf, transparent: true, opacity: 0.55, metalness: 0.1, roughness: 0.2,
        }),
      );
      dome.position.set(cx, TILE_H + 1.95, cz);
      g.add(dome);
    } else if (ind === 'ai' || ind === 'semiconductor') {
      const dish = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16),
        spireMat,
      );
      dish.position.set(cx, TILE_H + 2.0, cz);
      g.add(dish);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6), spireMat);
      ant.position.set(cx, TILE_H + 2.25, cz);
      g.add(ant);
    } else if (ind === 'fintech') {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 8), spireMat);
      cone.position.set(cx, TILE_H + 2.2, cz);
      g.add(cone);
    } else if (ind === 'culture') {
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.18, 0.08),
        new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.1 }),
      );
      sign.position.set(cx, TILE_H + 2.05, cz);
      g.add(sign);
    } else if (ind === 'biotech') {
      const helix = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 16), spireMat);
      helix.position.set(cx, TILE_H + 2.1, cz);
      helix.rotation.x = Math.PI / 2;
      g.add(helix);
    } else {
      // ecommerce 等：箱型屋顶 + 灯塔
      const light = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), spireMat);
      light.position.set(cx, TILE_H + 2.15, cz);
      g.add(light);
    }
    return g;
  }

  // Lv1~4：行业造型差异
  const h = 0.38 + 0.34 * (level - 1);
  switch (ind) {
    case 'agriculture': {
      // 宽基温室仓
      addBox(0.72, h * 0.85, 0.5, (h * 0.85) / 2, body);
      addBox(0.78, 0.05, 0.56, h * 0.85 + 0.03, roof);
      // 小烟囱
      const ch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.22, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }),
      );
      ch.position.set(cx + 0.2, TILE_H + h * 0.85 + 0.14, cz);
      g.add(ch);
      break;
    }
    case 'ecommerce': {
      // 扁宽物流仓 + 装卸台
      addBox(0.7, h * 0.75, 0.48, (h * 0.75) / 2, body);
      addBox(0.35, 0.12, 0.28, 0.08, roofMat(ind), 0.42, 0);
      addBox(0.74, 0.05, 0.52, h * 0.75 + 0.03, roof);
      break;
    }
    case 'energy': {
      // 高塔 + 侧翼太阳能板
      addBox(0.42, h * 1.15, 0.42, (h * 1.15) / 2, body);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.04, 0.28),
        new THREE.MeshStandardMaterial({
          color: 0x1a3a6a, emissive: 0x0a2040, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.2,
        }),
      );
      panel.position.set(cx + 0.38, TILE_H + h * 0.55, cz);
      panel.rotation.z = -0.35;
      g.add(panel);
      addBox(0.46, 0.05, 0.46, h * 1.15 + 0.03, roof);
      break;
    }
    case 'biotech': {
      // 圆柱实验室 + 方楼
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.3, h, 16),
        body,
      );
      cyl.position.set(cx - 0.12, TILE_H + h / 2, cz);
      cyl.castShadow = true;
      g.add(cyl);
      addBox(0.32, h * 0.7, 0.32, (h * 0.7) / 2, towerMat(4 + level, 0.45, ind), 0.28, 0.1);
      break;
    }
    case 'semiconductor': {
      // 扁平洁净厂房
      addBox(0.75, h * 0.65, 0.55, (h * 0.65) / 2, body);
      addBox(0.28, h * 0.95, 0.28, (h * 0.95) / 2, towerMat(5 + level, 0.4, ind), -0.22, -0.15);
      addBox(0.8, 0.05, 0.6, h * 0.65 + 0.03, roof);
      break;
    }
    case 'ai': {
      // 倾斜数据中心塔
      const tower = addBox(0.5, h, 0.5, h / 2, body);
      tower.rotation.y = 0.2;
      addBox(0.3, h * 0.55, 0.3, (h * 0.55) / 2, towerMat(4 + level, 0.6, ind), 0.32, 0.2);
      addBox(0.54, 0.06, 0.54, h + 0.03, roof);
      break;
    }
    case 'fintech': {
      // 经典摩天细塔
      addBox(0.48, h * 1.1, 0.48, (h * 1.1) / 2, body);
      addBox(0.52, 0.06, 0.52, h * 1.1 + 0.03, roof);
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.2 + level * 0.04, 6),
        new THREE.MeshStandardMaterial({ color: accent, metalness: 0.7, roughness: 0.25, emissive: accent, emissiveIntensity: 0.3 }),
      );
      tip.position.set(cx, TILE_H + h * 1.1 + 0.16, cz);
      g.add(tip);
      break;
    }
    case 'culture':
    default: {
      // 方塔 + 霓虹顶带
      addBox(0.58, h, 0.58, h / 2, body);
      const neon = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.08, 0.62),
        new THREE.MeshStandardMaterial({
          color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.2,
        }),
      );
      neon.position.set(cx, TILE_H + h + 0.04, cz);
      g.add(neon);
      break;
    }
  }
  return g;
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // CSS2D：地砖悬浮名 + 生活区标签 + 场景内 3D 弹幕
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(innerWidth, innerHeight);
    const lr = this.labelRenderer.domElement;
    lr.style.position = 'fixed';
    lr.style.inset = '0';
    lr.style.pointerEvents = 'none';
    lr.style.zIndex = '6';
    document.body.appendChild(lr);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101c2e);
    this.scene.fog = new THREE.Fog(0x101c2e, 50, 100);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 24, 30);
    // 手牌挂在 camera 子节点上，必须把 camera 加入场景才会被渲染
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 75 * DEG;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 60;

    // 镜头模式：follow 跟随 / free 自由 / orbit 通天观战（自动环绕）
    this.cameraMode = 'follow';
    this.followEnabled = true;
    this._manualUntil = 0;
    this._orbitAngle = 0.85;
    this._orbitRadius = 34;
    this._orbitElev = 28 * DEG;
    this._orbitSpeed = 0.18; // rad/s
    this.controls.addEventListener('start', () => {
      // 自由/观战下用户拖转后短暂停自动镜头
      if (this._lookMode) return;
      this._manualUntil = performance.now() + (this.cameraMode === 'orbit' ? 2500 : 4000);
    });

    // ---------- WASD 平移 + 双击进入鼠标方向控制（类 FPS） ----------
    this._keys = { w: false, a: false, s: false, d: false, shift: false };
    this._lookMode = false;
    this._lookYaw = 0;
    this._lookPitch = 0;
    this._moveSpeed = 16; // 单位/秒
    this._lookSens = 0.0022;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._bindWalkLookControls(canvas);

    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a2b1a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = 20;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 5, far: 70 });
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(70, 48),
      stdMat('ground', { color: 0xffffff, roughness: 1, metalness: 0, repeat: 10, offsetX: 0, offsetY: 0 })
    );
    if (!TEX.ground) ground.material.color.setHex(0x14273a);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.animations = new Set();
    this.tokens = [];
    this.houseGroups = new Array(40).fill(null);
    this.ownerPlates = new Array(40).fill(null);
    this.hqs = [];
    this.activeToken = -1;
    this.playerCount = 6;
    this.time = 0;

    this.livingZoneRoots = Object.create(null);
    this.livingPlayerMarkers = Object.create(null); // playerId -> CSS2DObject
    this.worldDanmaku = [];

    this._buildBoard();
    this._buildDice();
    this._buildLivingDistricts();

    // 手牌改为 CSS 扇形（handUI），不再挂 3D 卡

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** 显示/刷新 CSS 手牌；mode: roll | endTurn | all | hide */
  setHandCards(items, mode = 'endTurn', onUse = null) {
    if (mode === 'hide' || !items) {
      handUI.clear();
      return;
    }
    handUI.setHand(items, {
      mode,
      interactive: typeof onUse === 'function',
      onUse: typeof onUse === 'function' ? onUse : null,
    });
  }

  clearHandCards() {
    handUI.clear();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.labelRenderer?.setSize(innerWidth, innerHeight);
  }

  // ---------- 生活区（棋盘外侧三区） ----------
  _buildLivingDistricts() {
    // 城郊 / 城区 / 核心：分布在棋盘外围三侧
    const layout = [
      { id: 'suburb', x: -17.5, z: 4, color: 0x5a9e4a, emissive: 0x1a4a18 },
      { id: 'urban', x: 0, z: -17.5, color: 0x4a7ab8, emissive: 0x123058 },
      { id: 'core', x: 17.5, z: 4, color: 0xc47a3a, emissive: 0x5a3010 },
    ];
    const metaById = Object.fromEntries(LIVING_ZONES.map(z => [z.id, z]));

    for (const L of layout) {
      const meta = metaById[L.id] || { name: L.id, icon: '🏠', mult: 1, dice: [] };
      const root = new THREE.Group();
      root.position.set(L.x, 0, L.z);
      root.name = `living-${L.id}`;

      // 底座平台
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(3.6, 3.9, 0.35, 32),
        new THREE.MeshStandardMaterial({
          color: L.color,
          roughness: 0.75,
          metalness: 0.15,
          emissive: L.emissive,
          emissiveIntensity: 0.25,
        }),
      );
      base.position.y = 0.05;
      base.receiveShadow = true;
      base.castShadow = true;
      root.add(base);

      // 外圈环
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.85, 0.12, 10, 48),
        new THREE.MeshStandardMaterial({
          color: 0xf0c75e,
          roughness: 0.4,
          metalness: 0.55,
          emissive: 0xf0c75e,
          emissiveIntensity: 0.15,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.28;
      root.add(ring);

      // 中心建筑小品
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.8, 1.2),
        new THREE.MeshStandardMaterial({
          color: L.color,
          roughness: 0.5,
          metalness: 0.25,
          emissive: L.emissive,
          emissiveIntensity: 0.35,
        }),
      );
      tower.position.y = 1.15;
      tower.castShadow = true;
      root.add(tower);

      // 悬浮标签
      const label = document.createElement('div');
      label.className = 'living-zone-label';
      label.innerHTML = `
        <div class="lz-icon">${meta.icon || '🏠'}</div>
        <div class="lz-name">${meta.name}</div>
        <div class="lz-meta">骰 ${meta.dice?.join('/') || '?'} · 房租×${meta.mult ?? 1}</div>
        <div class="lz-residents" data-zone="${L.id}"></div>`;
      const lab = new CSS2DObject(label);
      lab.position.set(0, 2.6, 0);
      root.add(lab);

      // 高亮光柱（激活时）
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.45, 6, 12),
        new THREE.MeshBasicMaterial({
          color: L.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      beam.position.y = 3.2;
      root.add(beam);

      this.scene.add(root);
      this.livingZoneRoots[L.id] = { root, label, beam, color: L.color, residentsEl: label.querySelector('.lz-residents') };
    }
  }

  /**
   * 刷新生活区：根据各玩家 homeZone 更新驻点与标签
   * @param {Array<{id:number,name:string,homeZone?:string|null,bankrupt?:boolean}>} players
   * @param {number[]} colors hex colors
   */
  syncLivingZones(players, colors = []) {
    if (!this.livingZoneRoots) return;
    // 清旧标记
    for (const id of Object.keys(this.livingPlayerMarkers)) {
      const m = this.livingPlayerMarkers[id];
      m.parent?.remove(m);
      if (m.element?.parentNode) m.element.remove();
    }
    this.livingPlayerMarkers = Object.create(null);

    const byZone = { suburb: [], urban: [], core: [] };
    for (const p of players || []) {
      if (p.bankrupt || !p.homeZone || !byZone[p.homeZone]) continue;
      byZone[p.homeZone].push(p);
    }

    for (const [zid, zone] of Object.entries(this.livingZoneRoots)) {
      const list = byZone[zid] || [];
      if (zone.residentsEl) {
        zone.residentsEl.innerHTML = list.length
          ? list.map((p) => {
            const c = colors[p.id] != null
              ? `#${(colors[p.id] >>> 0).toString(16).padStart(6, '0')}`
              : '#9ab';
            return `<span class="lz-dot" style="background:${c}" title="${p.name}"></span>${p.name}`;
          }).join(' · ')
          : '<span class="lz-empty">暂无住户</span>';
      }
      // 有住户时抬高光柱
      if (zone.beam?.material) {
        zone.beam.material.opacity = list.length ? 0.35 : 0;
      }
      zone.root.scale.setScalar(list.length ? 1.06 : 1);

      // 在平台上放玩家小标记
      list.forEach((p, i) => {
        const ang = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
        const r = 1.6;
        const el = document.createElement('div');
        el.className = 'living-player-pin';
        const hex = colors[p.id] != null
          ? `#${(colors[p.id] >>> 0).toString(16).padStart(6, '0')}`
          : '#f0c75e';
        el.innerHTML = `<span class="lpp-dot" style="background:${hex}"></span><span class="lpp-name">${p.name}</span>`;
        const obj = new CSS2DObject(el);
        obj.position.set(Math.cos(ang) * r, 1.35, Math.sin(ang) * r);
        zone.root.add(obj);
        this.livingPlayerMarkers[p.id] = obj;
      });
    }
  }

  /**
   * 场景内 3D 弹幕（操作日志 / 战报）
   * @param {string} html
   * @param {string} [cls]
   */
  spawnWorldDanmaku(html, cls = '') {
    // 去标签取纯文本，保留简短样式 class
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = (tmp.textContent || '').trim();
    if (!text) return;

    const el = document.createElement('div');
    el.className = `world-danmaku${cls ? ` ${cls}` : ''}`;
    el.textContent = text;

    const obj = new CSS2DObject(el);
    const y = 3.2 + Math.random() * 5.5;
    const z = -6 + Math.random() * 12;
    const x0 = -16 - Math.random() * 4;
    const x1 = 16 + Math.random() * 4;
    obj.position.set(x0, y, z);
    this.scene.add(obj);

    const dur = 8 + Math.min(5, text.length * 0.08);
    const start = performance.now();
    const entry = { obj, el, start, dur, x0, x1, y, z };
    this.worldDanmaku.push(entry);

    // 过多清理
    while (this.worldDanmaku.length > 28) {
      const old = this.worldDanmaku.shift();
      old.obj.parent?.remove(old.obj);
      old.el.remove();
    }
  }

  _tickWorldDanmaku(now) {
    const remain = [];
    for (const d of this.worldDanmaku) {
      const k = (now - d.start) / (d.dur * 1000);
      if (k >= 1) {
        d.obj.parent?.remove(d.obj);
        d.el.remove();
        continue;
      }
      d.obj.position.x = d.x0 + (d.x1 - d.x0) * k;
      d.obj.position.y = d.y + Math.sin(k * Math.PI) * 0.6;
      // 淡入淡出
      const opacity = k < 0.08 ? k / 0.08 : k > 0.82 ? (1 - k) / 0.18 : 1;
      d.el.style.opacity = String(Math.max(0, Math.min(1, opacity)));
      remain.push(d);
    }
    this.worldDanmaku = remain;
  }

  // ---------- 棋盘 ----------
  _buildBoard() {
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(26.6, 0.8, 26.6),
      new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.45, metalness: 0.55 })
    );
    rim.position.y = -0.45;
    rim.receiveShadow = true;
    this.scene.add(rim);

    // 棋盘底面：Box 侧面纯色，下沉让顶面在地面以下
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x122438, roughness: 0.95, metalness: 0 });
    const baseBox = new THREE.Mesh(new THREE.BoxGeometry(25.4, 0.5, 25.4), baseMat);
    baseBox.position.y = -0.3;
    baseBox.receiveShadow = true;
    this.scene.add(baseBox);

    // 顶面独立 Plane，避免 BoxGeometry UV 拉伸
    const topGeo = new THREE.PlaneGeometry(25.4, 25.4);
    topGeo.rotateX(-Math.PI / 2);
    const topMat = stdMat('board_felt', { color: 0xffffff, roughness: 0.85, metalness: 0, repeat: 4 });
    const topFace = new THREE.Mesh(topGeo, topMat);
    topFace.position.y = 0.002;
    topFace.receiveShadow = true;
    this.scene.add(topFace);

    // 中央 Logo
    const [lc, lctx] = makeCanvas(512, 512);
    lctx.translate(256, 256);
    lctx.rotate(-Math.PI / 4);
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    lctx.fillStyle = 'rgba(120, 200, 255, 0.95)';
    lctx.font = 'bold 88px "Microsoft YaHei", "PingFang SC", sans-serif';
    lctx.strokeStyle = 'rgba(10, 30, 60, 0.9)';
    lctx.lineWidth = 8;
    lctx.strokeText('商业帝国', 0, -30);
    lctx.fillText('商业帝国', 0, -30);
    lctx.font = 'bold 38px Georgia, serif';
    lctx.fillStyle = 'rgba(240, 199, 94, 0.9)';
    lctx.fillText('B U S I N E S S   W A R', 0, 50);
    const logoTex = new THREE.CanvasTexture(lc);
    logoTex.colorSpace = THREE.SRGBColorSpace;
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, opacity: 0.9 })
    );
    logo.rotation.x = -Math.PI / 2;
    logo.position.y = 0.22;
    this.scene.add(logo);

    this.tileMeshes = [];
    this.tileFloatLabels = [];
    TILES.forEach((t, i) => {
      const pos = tilePosition(i);
      // 侧面：米色陶瓷 + 行业色 tint
      let sideTint = 0xf3ecd9;
      if (t.type === 'property' && INDUSTRIES[t.color]) sideTint = INDUSTRIES[t.color].hex;
      else if (t.type === 'railroad') sideTint = 0x4a4a52;
      else if (t.type === 'utility') sideTint = 0x6a7480;
      else if (t.type === 'go' || t.type === 'gotojail') sideTint = 0xa03030;
      else if (t.type === 'jail') sideTint = 0x2a3a68;
      else if (t.type === 'chance') sideTint = 0xc06020;
      else if (t.type === 'chest') sideTint = 0x2a6a98;
      else if (t.type === 'tax') sideTint = 0x7a2838;
      else if (t.type === 'parking') sideTint = 0x2a7a78;

      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.92, TILE_H, 1.92),
        stdMat('tile_base', {
          color: TEX.tile_base ? sideTint : sideTint,
          roughness: 0.82,
          metalness: 0.08,
          repeat: 1,
          offsetX: 0,
          offsetY: 0,
        })
      );
      if (!TEX.tile_base) box.material.color.setHex(sideTint);
      box.position.set(pos.x, TILE_H / 2, pos.z);
      box.castShadow = box.receiveShadow = true;
      box.userData.tileIndex = i;
      this.scene.add(box);
      this.tileMeshes.push(box);

      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 1.9),
        new THREE.MeshBasicMaterial({ map: tileTexture(t) })
      );
      const g = new THREE.Group();
      top.rotation.x = -Math.PI / 2;
      g.add(top);
      g.position.set(pos.x, TILE_H + 0.005, pos.z);
      if (i > 10 && i <= 20) g.rotation.y = -Math.PI / 2;
      else if (i > 20 && i <= 30) g.rotation.y = Math.PI;
      else if (i > 30) g.rotation.y = Math.PI / 2;
      this.scene.add(g);

      // 悬浮文字：CSS2D 始终朝向镜头，浮在贴图上方
      const labEl = makeTileFloatLabel(t);
      const lab = new CSS2DObject(labEl);
      lab.position.set(pos.x, TILE_H + 0.72, pos.z);
      lab.center.set(0.5, 1);
      this.scene.add(lab);
      this.tileFloatLabels[i] = lab;

      // 默认底座色（未占领）= 行业/类型 tint；占领时改写为玩家色
      box.userData.baseColor = sideTint;

      if (['property', 'railroad', 'utility'].includes(t.type)) {
        // 占领光晕：略大于格子，从底座边缘露出玩家色
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(2.22, 0.14, 2.22),
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.45,
            metalness: 0.25,
            emissive: 0x000000,
            emissiveIntensity: 0,
          })
        );
        plate.position.set(pos.x, 0.04, pos.z);
        plate.visible = false;
        this.scene.add(plate);
        this.ownerPlates[i] = plate;

        if (t.type === 'property') {
          const { dir } = tileFrame(i);
          const strip = new THREE.Mesh(
            new THREE.BoxGeometry(dir.x !== 0 ? 0.5 : 1.9, 0.06, dir.x !== 0 ? 1.9 : 0.5),
            new THREE.MeshStandardMaterial({ color: INDUSTRIES[t.color].hex, roughness: 0.7 })
          );
          strip.position.set(pos.x + dir.x * 0.68, TILE_H + 0.03, pos.z + dir.z * 0.68);
          this.scene.add(strip);
        }
      }
    });
  }

  setPlayerCount(n) { this.playerCount = Math.max(2, n); }

  // ---------- 棋子（6 种造型循环 + 34 色 + 材质贴图） ----------
  /** @param {number} playerId @param {number} [tileIndex=0] 初始所在格子（存档续玩用） */
  createToken(playerId, tileIndex = 0) {
    const color = PLAYER_COLORS[playerId % PLAYER_COLORS.length];
    const kind = playerId % 6;
    // 主色可 tint 的材质贴图（按造型区分材质语义）
    const bodyKey = ['mat_metal', 'mat_felt', 'mat_plastic', 'mat_wood', 'mat_metal', 'mat_tech'][kind];
    const mat = stdMat(bodyKey, {
      color, roughness: kind === 1 ? 0.92 : kind === 2 ? 0.55 : 0.35,
      metalness: kind === 0 || kind === 5 ? 0.45 : kind === 4 ? 0.35 : 0.08,
      repeat: 2, offsetX: 0, offsetY: 0,
    });
    const dark = stdMat(kind === 0 ? 'mat_rubber' : 'mat_metal', {
      color: 0x222222, roughness: 0.85, metalness: kind === 0 ? 0.05 : 0.4, repeat: 2, offsetX: 0, offsetY: 0,
    });
    const white = stdMat(kind === 4 ? 'mat_panel' : 'mat_plastic', {
      color: 0xf5f5f5, roughness: 0.45, metalness: kind === 4 ? 0.25 : 0.05, repeat: 2, offsetX: 0, offsetY: 0,
    });
    const g = new THREE.Group();
    const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };

    switch (kind) {
      case 0: { // 汽车 — 金属漆车身 + 橡胶轮胎
        add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.9), mat), 0, 0.24, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.42), mat), 0, 0.42, -0.05);
        const wg = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14);
        for (const [x, z] of [[-0.28, 0.28], [0.28, 0.28], [-0.28, -0.28], [0.28, -0.28]]) {
          add(new THREE.Mesh(wg, dark), x, 0.11, z).rotation.z = Math.PI / 2;
        }
        break;
      }
      case 1: { // 礼帽 — 毡布 + 深色帽箍
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24), mat), 0, 0.06, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.45, 24), mat), 0, 0.3, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.1, 24), dark), 0, 0.14, 0);
        break;
      }
      case 2: { // 小狗 — 注塑塑料
        add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), mat), 0, 0.28, 0).scale.set(1, 0.85, 1.25);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), mat), 0, 0.48, 0.26);
        const earG = new THREE.ConeGeometry(0.07, 0.18, 8);
        add(new THREE.Mesh(earG, mat), -0.1, 0.64, 0.24);
        add(new THREE.Mesh(earG, mat), 0.1, 0.64, 0.24);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 8), mat), 0, 0.42, -0.32).rotation.x = -0.8;
        break;
      }
      case 3: { // 帆船 — 木质船体 + 白帆
        add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.85), mat), 0, 0.12, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), dark), 0, 0.5, 0);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 3), white), 0.02, 0.55, 0).rotation.y = Math.PI / 6;
        break;
      }
      case 4: { // 火箭 — 面板筒身 + 金属翼 + 尾焰
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.55, 16), white), 0, 0.4, 0);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 16), mat), 0, 0.82, 0);
        const finG = new THREE.BoxGeometry(0.05, 0.25, 0.18);
        for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
          const fin = add(new THREE.Mesh(finG, mat), Math.sin(a) * 0.18, 0.18, Math.cos(a) * 0.18);
          fin.rotation.y = a;
        }
        add(new THREE.Mesh(
          new THREE.ConeGeometry(0.1, 0.25, 12),
          new THREE.MeshStandardMaterial({ color: 0xffa500, emissive: 0xff6600, emissiveIntensity: 0.8, roughness: 0.4 })
        ), 0, 0.05, 0).rotation.x = Math.PI;
        break;
      }
      case 5: { // 机器人 — 科技面板 + 金属底盘 + 霓虹眼
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.3), mat), 0, 0.3, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.26), mat), 0, 0.62, 0);
        const eyeG = new THREE.SphereGeometry(0.045, 8, 8);
        const eyeMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1, roughness: 0.2 });
        add(new THREE.Mesh(eyeG, eyeMat), -0.08, 0.64, 0.14);
        add(new THREE.Mesh(eyeG, eyeMat), 0.08, 0.64, 0.14);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), dark), 0, 0.82, 0);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat), 0, 0.92, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.32), dark), 0, 0.08, 0);
        break;
      }
    }
    const tile = ((tileIndex % 40) + 40) % 40;
    g.position.copy(tokenSlot(tile, playerId, this.playerCount));
    g.scale.setScalar(tokenScale(this.playerCount));
    g.userData.tileIndex = tile;
    this.scene.add(g);
    this.tokens[playerId] = g;
    return g;
  }

  /** 立即把棋子放到指定格（无动画，用于存档同步） */
  placeToken(playerId, tileIndex) {
    const t = this.tokens[playerId];
    if (!t) return;
    const tile = ((tileIndex % 40) + 40) % 40;
    t.position.copy(tokenSlot(tile, playerId, this.playerCount));
    t.userData.tileIndex = tile;
  }

  removeToken(playerId) {
    const t = this.tokens[playerId];
    if (t) { this.scene.remove(t); disposeGroup(t); this.tokens[playerId] = null; }
  }

  // ---------- 骰子 ----------
  _buildDice() {
    const geo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const mats = DICE_FACE_VALUES.map(v => new THREE.MeshStandardMaterial({ map: diceFaceTexture(v), roughness: 0.25 }));
    this.dice = [0, 1].map(k => {
      const m = new THREE.Mesh(geo, mats);
      m.castShadow = true;
      m.position.set(k === 0 ? -0.9 : 0.9, 0.55, 0);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.scene.add(m);
      return m;
    });
  }

  /**
   * 仅「跟随」模式下允许特写抢镜；自由 / 通天观战不改用户镜头
   */
  _allowCinematicCam() {
    return this.cameraMode === 'follow' && this.followEnabled;
  }

  /**
   * 掷骰动画 + 特写镜头；d2=0 表示遥控骰子（只摇一颗，镜头更近更久）
   * 时间线：推进特写 → 骰子翻滚停稳 → 特写停留 holdSec → 拉回
   * 自由视角 / 通天观战：只播骰子，不抢镜头
   */
  animateDice(d1, d2, duration = 1.2, holdSec = 1.0) {
    soundManager.play('dice');
    const single = d2 === 0;
    // 遥控骰子：更慢翻滚 + 更长定格，方便看清点数
    if (single) {
      duration = Math.max(duration, 1.45);
      holdSec = Math.max(holdSec, 1.55);
    }
    const values = single ? [d1] : [d1, d2];
    const active = single ? [this.dice[0]] : this.dice;
    const targets = values.map(v => diceQuaternionFor(v));
    const vels = active.map(() => new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18));
    const settleFrom = active.map(() => null);
    if (single) this.dice[1].visible = false;
    if (single) active[0].position.x = 0;

    const pullSec = single ? 0.5 : 0.35;
    const totalSec = duration + holdSec + pullSec;

    // 仅跟随模式做特写
    const camFx = this._allowCinematicCam();
    const camFrom = this.camera.position.clone();
    const tgtFrom = this.controls.target.clone();
    const diceFocus = new THREE.Vector3(0, 0.55, 0);
    const camClose = single
      ? new THREE.Vector3(0.05, 2.35, 3.6)   // 遥控：紧贴单骰
      : new THREE.Vector3(0.2, 3.2, 5.5);
    const prevFollow = this.followEnabled;
    const prevMode = this.cameraMode;
    if (camFx) {
      this.followEnabled = false;
      this._manualUntil = performance.now() + totalSec * 1000 + 400;
    }

    const start = performance.now();
    return new Promise(resolve => {
      const anim = {
        update: (now) => {
          const t = (now - start) / 1000;
          // 骰子动画进度（仅前 duration 秒）
          const diceK = Math.min(t / duration, 1);
          if (camFx) {
            // 镜头：0~0.25s 推进 → 特写保持到 duration+hold → 最后 pullSec 拉回
            const holdEnd = duration + holdSec;
            let camBlend; // 0=原位, 1=特写
            if (t < 0.25) camBlend = t / 0.25;
            else if (t < holdEnd) camBlend = 1;
            else if (t < totalSec) camBlend = 1 - (t - holdEnd) / pullSec;
            else camBlend = 0;
            const ease = camBlend * camBlend * (3 - 2 * camBlend);
            this.camera.position.lerpVectors(camFrom, camClose, ease);
            this.controls.target.lerpVectors(tgtFrom, diceFocus, ease);
            this.controls.update();
          }

          if (diceK < 1) {
            active.forEach((d, i) => {
              if (diceK < 0.55) {
                const dt = 1 / 60;
                d.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(vels[i].x * dt, vels[i].y * dt, vels[i].z * dt)));
                vels[i].multiplyScalar(0.985);
                d.position.y = 1.6 + Math.abs(Math.sin(t * 9 + i)) * 0.9 * (1 - diceK);
              } else {
                if (!settleFrom[i]) settleFrom[i] = d.quaternion.clone();
                const kk = (diceK - 0.55) / 0.45;
                const e = 1 - Math.pow(1 - kk, 3);
                d.quaternion.slerpQuaternions(settleFrom[i], targets[i], e);
                d.position.y = 0.55 + Math.abs(Math.sin(kk * Math.PI)) * 0.35 * (1 - kk);
              }
            });
          } else {
            active.forEach((d, i) => { d.quaternion.copy(targets[i]); d.position.y = 0.55; });
          }

          if (t >= totalSec) {
            active.forEach((d, i) => { d.quaternion.copy(targets[i]); d.position.y = 0.55; });
            if (single) { this.dice[1].visible = true; this.dice[0].position.x = -0.9; }
            if (camFx) {
              this.camera.position.copy(camFrom);
              this.controls.target.copy(tgtFrom);
              this.controls.update();
              this.followEnabled = prevFollow;
              this.cameraMode = prevMode;
            }
            this.animations.delete(anim);
            resolve();
          }
        }
      };
      this.animations.add(anim);
    });
  }

  // ---------- 移动动画 ----------
  moveToken(playerId, from, steps) {
    const token = this.tokens[playerId];
    if (!token) return Promise.resolve();
    const dir = Math.sign(steps);
    let cur = ((from % 40) + 40) % 40;
    let left = Math.abs(steps);
    const hop = () => new Promise(resolve => {
      const next = ((cur + dir) % 40 + 40) % 40;
      const p0 = token.position.clone();
      const p1 = tokenSlot(next, playerId, this.playerCount);
      const start = performance.now();
      const dur = 220;
      const anim = {
        update: (now) => {
          const k = Math.min((now - start) / dur, 1);
          token.position.lerpVectors(p0, p1, k);
          token.position.y = TILE_H + 0.02 + Math.sin(k * Math.PI) * 0.85;
          if (k >= 1) { this.animations.delete(anim); resolve(); }
        }
      };
      this.animations.add(anim);
    });
    return (async () => {
      while (left-- > 0) {
        await hop();
        soundManager.play('step');
        cur = ((cur + dir) % 40 + 40) % 40;
      }
    })();
  }

  /**
   * @param {number} playerId
   * @param {number} from
   * @param {number} to
   * @param {{ playerName?: string }} [opts]
   */
  teleportToken(playerId, from, to, opts = {}) {
    const token = this.tokens[playerId];
    if (!token) return Promise.resolve();
    const p0 = tokenSlot(from, playerId, this.playerCount);
    const p1 = tokenSlot(to, playerId, this.playerCount);
    const start = performance.now();
    const toJail = ((to % 40) + 40) % 40 === JAIL_INDEX;
    return new Promise(resolve => {
      const anim = {
        update: (now) => {
          const k = Math.min((now - start) / 650, 1);
          token.position.lerpVectors(p0, p1, k);
          // 进监管：弧线更高、带一点自旋
          const lift = toJail ? 4.2 : 3.2;
          token.position.y = TILE_H + 0.02 + Math.sin(k * Math.PI) * lift;
          if (toJail) token.rotation.y += 0.18;
          if (k >= 1) {
            this.animations.delete(anim);
            token.rotation.y = 0;
            if (toJail) {
              this.playJailFx(playerId, 4.0, { ...opts, noticeSec: 3 }).then(resolve);
            } else {
              resolve();
            }
          }
        }
      };
      this.animations.add(anim);
    });
  }

  /** 显示 A4 红头「监管调查通知书」叠层 */
  _showJailNotice(playerName, playerId = 0) {
    let el = document.getElementById('jail-notice-fx');
    if (!el) {
      el = document.createElement('div');
      el.id = 'jail-notice-fx';
      el.className = 'hidden';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `
        <div class="jn-backdrop"></div>
        <div class="jn-stage">
          <div class="jn-paper">
            <img class="jn-bg" alt="" draggable="false" />
            <div class="jn-content">
              <div class="jn-org">商业帝国市场监督管理局</div>
              <div class="jn-title">监 管 调 查 通 知 书</div>
              <div class="jn-no"></div>
              <div class="jn-to"><span class="jn-name">当事人</span>：</div>
              <div class="jn-text"></div>
              <div class="jn-sign">
                <div class="jn-agency">商业帝国市场监督管理局</div>
                <div class="jn-date"></div>
              </div>
            </div>
            <div class="jn-stamp">约谈中</div>
          </div>
        </div>`;
      document.body.appendChild(el);
    }
    const name = (playerName || `玩家${playerId + 1}`).trim() || '当事人';
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const caseNo = String(1000 + ((playerId * 37 + y + m * 13 + d) % 9000));
    const noEl = el.querySelector('.jn-no');
    const nameEl = el.querySelector('.jn-name');
    const textEl = el.querySelector('.jn-text');
    const dateEl = el.querySelector('.jn-date');
    if (noEl) noEl.textContent = `监调字〔${y}〕第 ${caseNo} 号`;
    if (nameEl) nameEl.textContent = name;
    if (textEl) {
      textEl.innerHTML =
        `经查，你方在商业帝国棋盘内涉嫌违规经营、恶意圈地及扰乱市场秩序。` +
        `现依法对你实施<strong>监管约谈</strong>，并暂扣至<strong>监管局</strong>接受调查。` +
        `约谈期间不得擅自离场，违者将加重处罚。特此通知。`;
    }
    if (dateEl) dateEl.textContent = `${y} 年 ${m} 月 ${d} 日`;

    const paper = el.querySelector('.jn-paper');
    const img = el.querySelector('.jn-bg');
    // 绿幕抠像红头文件底图（失败则纸色 fallback）
    const applyBg = (url) => {
      if (!img) return;
      if (url) {
        img.src = url;
        img.style.display = '';
        paper?.classList.remove('jn-fallback');
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        paper?.classList.add('jn-fallback');
      }
    };
    if (this._jailNoticeBg) {
      applyBg(this._jailNoticeBg);
    } else {
      applyBg(null);
      import('../ui/chromaKey.js').then(async ({ keyGreenUrl, getArtFrames }) => {
        try {
          // 优先用启动时预加载的 frames
          const frames = await getArtFrames().catch(() => null);
          const url = frames?.jailNotice
            || await keyGreenUrl('/textures/hud/jail_notice_gs.jpg', {
              cacheKey: 'jailNotice',
              crop: true,
            });
          this._jailNoticeBg = url;
          // 仍显示中才更新
          if (el.classList.contains('jn-play')) applyBg(url);
        } catch {
          /* keep fallback */
        }
      }).catch(() => {});
    }

    el.classList.remove('hidden', 'jn-out');
    el.classList.add('jn-play');
    el.setAttribute('aria-hidden', 'false');
    // 重启动画：强制 reflow
    if (paper) {
      paper.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      paper.offsetWidth;
      paper.style.animation = '';
    }
    this._jailNoticeEl = el;
  }

  _hideJailNotice() {
    const el = this._jailNoticeEl || document.getElementById('jail-notice-fx');
    if (!el) return;
    el.classList.add('jn-out');
    el.setAttribute('aria-hidden', 'true');
    clearTimeout(this._jailNoticeHideT);
    this._jailNoticeHideT = setTimeout(() => {
      el.classList.remove('jn-play', 'jn-out');
      el.classList.add('hidden');
    }, 420);
  }

  /**
   * 进监管局特效：A4 红头通知书 + 镜头特写 + 红蓝警灯 + 铁笼 + 「约谈中」标 + 场景弹幕
   * @param {number} playerId
   * @param {number} [duration=4]
   * @param {{ playerName?: string, noticeSec?: number }} [opts]
   */
  playJailFx(playerId, duration = 4.0, opts = {}) {
    const token = this.tokens[playerId];
    const jailPos = tilePosition(JAIL_INDEX);
    const playerName = opts.playerName || `玩家${playerId + 1}`;
    // 红头文件至少完整展示 noticeSec 秒（默认 3s）
    const noticeSec = Math.max(3, Number(opts.noticeSec) || 3);
    duration = Math.max(duration, noticeSec + 0.8);
    soundManager.play('jail');

    // 清理上一轮残留
    this.clearJailFx?.();
    this._showJailNotice(playerName, playerId);

    const fx = new THREE.Group();
    fx.name = 'jailFx';
    fx.position.copy(jailPos);
    fx.position.y = 0;
    this.scene.add(fx);
    this._jailFx = fx;

    // 红蓝警灯（两个点光交替）
    const red = new THREE.PointLight(0xff2244, 0, 14, 2);
    const blue = new THREE.PointLight(0x2288ff, 0, 14, 2);
    red.position.set(-1.2, 2.2, 0.4);
    blue.position.set(1.2, 2.2, -0.4);
    fx.add(red, blue);

    // 地面警示环
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3344,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.45, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    fx.add(ring);

    // 铁笼：竖栏 + 顶环
    const barMat = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      metalness: 0.85,
      roughness: 0.25,
      emissive: 0x112233,
      emissiveIntensity: 0.2,
    });
    const cage = new THREE.Group();
    const barN = 10;
    const cageR = 0.72;
    for (let i = 0; i < barN; i++) {
      const a = (i / barN) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), barMat);
      bar.position.set(Math.cos(a) * cageR, 0.9, Math.sin(a) * cageR);
      cage.add(bar);
    }
    const topRing = new THREE.Mesh(new THREE.TorusGeometry(cageR, 0.04, 8, 24), barMat);
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 1.65;
    cage.add(topRing);
    const botRing = topRing.clone();
    botRing.position.y = 0.25;
    cage.add(botRing);
    // 从大缩到正常
    cage.scale.setScalar(2.2);
    fx.add(cage);

    // 「约谈中」标签
    const badge = document.createElement('div');
    badge.className = 'jail-fx-badge';
    badge.innerHTML = `<span class="jfx-icon">⚖️</span><span class="jfx-text">监管约谈中</span>`;
    const badgeObj = new CSS2DObject(badge);
    badgeObj.position.set(0, 2.4, 0);
    fx.add(badgeObj);

    // 棋子半透明“铐住”感
    const prevMats = [];
    if (token) {
      token.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            prevMats.push({ m, t: m.transparent, o: m.opacity, e: m.emissive?.getHex?.(), ei: m.emissiveIntensity });
            m.transparent = true;
            m.opacity = 0.82;
            if (m.emissive) {
              m.emissive.setHex(0x331111);
              m.emissiveIntensity = 0.35;
            }
          }
        }
      });
    }

    // 镜头特写监管局（仅跟随模式）
    const camFx = this._allowCinematicCam();
    const camFrom = this.camera.position.clone();
    const tgtFrom = this.controls.target.clone();
    const camClose = jailPos.clone().add(new THREE.Vector3(2.8, 4.2, 5.5));
    const tgtClose = jailPos.clone().add(new THREE.Vector3(0, 0.6, 0));
    const prevFollow = this.followEnabled;
    const prevMode = this.cameraMode;
    if (camFx) {
      this.followEnabled = false;
      this._manualUntil = performance.now() + duration * 1000 + 500;
    }

    this.spawnWorldDanmaku?.(`⚖️ ${playerName} 被监管调查，押送监管局！`, 'bad');

    const start = performance.now();
    // 红头文件固定展示 noticeSec 秒后再收起
    const hideNoticeAt = noticeSec;
    let noticeHidden = false;
    return new Promise((resolve) => {
      const anim = {
        update: (now) => {
          const t = (now - start) / 1000;
          const k = Math.min(t / duration, 1);

          // 红头文件展示满 noticeSec 秒后收起
          if (!noticeHidden && t >= hideNoticeAt) {
            noticeHidden = true;
            this._hideJailNotice();
          }

          // 镜头：0~0.3 推进 → 保持 → 末段拉回（自由/观战不抢镜）
          if (camFx) {
            let camBlend;
            if (t < 0.3) camBlend = t / 0.3;
            else if (t < duration - 0.45) camBlend = 1;
            else camBlend = Math.max(0, 1 - (t - (duration - 0.45)) / 0.45);
            const ease = camBlend * camBlend * (3 - 2 * camBlend);
            this.camera.position.lerpVectors(camFrom, camClose, ease);
            this.controls.target.lerpVectors(tgtFrom, tgtClose, ease);
            this.controls.update();
          }

          // 警灯闪烁
          const flash = (Math.sin(t * 14) + 1) * 0.5;
          red.intensity = 4.5 * flash;
          blue.intensity = 4.5 * (1 - flash);
          ringMat.opacity = 0.25 + 0.4 * flash;
          ring.scale.setScalar(1 + 0.08 * Math.sin(t * 10));

          // 铁笼落下
          const ck = Math.min(1, t / 0.55);
          const ce = 1 - Math.pow(1 - ck, 3);
          cage.scale.setScalar(2.2 - 1.2 * ce);
          cage.rotation.y = t * 0.6;

          // 棋子轻颤
          if (token && t < duration - 0.4) {
            token.position.x = slot.x + Math.sin(t * 40) * 0.02;
            token.position.z = slot.z + Math.cos(t * 36) * 0.02;
            token.position.y = slot.y;
          }

          if (k >= 1) {
            this.animations.delete(anim);
            if (token) {
              token.position.copy(slot);
            }
            // 还原材质
            for (const s of prevMats) {
              s.m.transparent = s.t;
              s.m.opacity = s.o;
              if (s.m.emissive && s.e != null) {
                s.m.emissive.setHex(s.e);
                s.m.emissiveIntensity = s.ei ?? 0;
              }
            }
            if (camFx) {
              this.camera.position.copy(camFrom);
              this.controls.target.copy(tgtFrom);
              this.controls.update();
              this.followEnabled = prevFollow;
              this.cameraMode = prevMode;
            }
            this._hideJailNotice();
            // 淡出拆除铁笼
            const fadeStart = performance.now();
            const fade = {
              update: (n2) => {
                const fk = Math.min((n2 - fadeStart) / 500, 1);
                red.intensity *= 0.85;
                blue.intensity *= 0.85;
                ringMat.opacity *= 0.85;
                cage.scale.multiplyScalar(0.9);
                badge.style.opacity = String(1 - fk);
                if (fk >= 1) {
                  this.animations.delete(fade);
                  this.clearJailFx();
                  resolve();
                }
              },
            };
            this.animations.add(fade);
          }
        },
      };
      const slot = tokenSlot(JAIL_INDEX, playerId, this.playerCount);
      this.animations.add(anim);
    });
  }

  clearJailFx() {
    this._hideJailNotice?.();
    if (!this._jailFx) return;
    this._jailFx.traverse((o) => {
      if (o.element?.parentNode) o.element.remove();
    });
    this.scene.remove(this._jailFx);
    disposeGroup(this._jailFx);
    this._jailFx = null;
  }

  // ---------- 产权 / 摩天楼 ----------
  /** 占领地显示为玩家色：底座 tint + 边缘光晕；释放则恢复默认米色 */
  setOwner(tileIdx, colorHex) {
    const plate = this.ownerPlates[tileIdx];
    const box = this.tileMeshes?.[tileIdx];
    if (!plate && !box) return;

    if (colorHex == null) {
      if (plate) {
        plate.visible = false;
        plate.material.emissive.setHex(0x000000);
        plate.material.emissiveIntensity = 0;
      }
      if (box) {
        const base = box.userData.baseColor ?? (TEX.tile_base ? 0xffffff : 0xf3ecd9);
        box.material.color.setHex(base);
        if (box.material.emissive) {
          box.material.emissive.setHex(0x000000);
          box.material.emissiveIntensity = 0;
        }
      }
      return;
    }

    // 底座整体染成玩家色（贴图 × color）
    if (box) {
      box.material.color.setHex(colorHex);
      if (box.material.emissive) {
        box.material.emissive.setHex(colorHex);
        box.material.emissiveIntensity = 0.22;
      }
    }
    // 边缘光晕框
    if (plate) {
      plate.material.color.setHex(colorHex);
      plate.material.emissive.setHex(colorHex);
      plate.material.emissiveIntensity = 0.45;
      plate.visible = true;
    }
  }

  /**
   * 建筑等级 0~5：按地块行业使用对应立面贴图 + 造型；5 = 行业地标
   * @param {number} tileIdx
   * @param {number} n
   */
  setHouses(tileIdx, n) {
    const old = this.houseGroups[tileIdx];
    if (old) { this.scene.remove(old); disposeGroup(old); this.houseGroups[tileIdx] = null; }
    if (n <= 0) return;
    const t = TILES[tileIdx];
    const pos = tilePosition(tileIdx);
    const { dir } = tileFrame(tileIdx);
    const cx = pos.x + dir.x * 0.32;
    const cz = pos.z + dir.z * 0.32;
    const industry = t.type === 'property' ? t.color : null;
    const level = Math.min(5, Math.max(1, n | 0));
    const g = buildIndustryHouse(industry, level, cx, cz);
    // 略朝向棋盘外侧，层次更清晰
    g.rotation.y = Math.atan2(dir.x, dir.z) * 0.15;
    this.scene.add(g);
    this.houseGroups[tileIdx] = g;
  }

  // ---------- 公司总部（幕墙贴图 + 行业招牌 + 底座；大人数自动缩小） ----------
  setCompany(playerId, company, playerName) {
    const old = this.hqs[playerId];
    if (old) { this.scene.remove(old); disposeGroup(old); this.hqs[playerId] = null; }
    if (!company) return;
    const crowd = this.playerCount > 12;
    const color = PLAYER_COLORS[playerId % PLAYER_COLORS.length];
    const css = PLAYER_COLORS_CSS[playerId % PLAYER_COLORS.length];
    const ind = INDUSTRIES[company.industry] || { icon: '🏢', name: '公司', hex: color, css };
    const g = new THREE.Group();
    const angle = (playerId / this.playerCount) * Math.PI * 2 + Math.PI / 6;
    const r = crowd ? 6.3 : 4.8;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const h = (1.0 + 0.55 * company.level) * (crowd ? 0.65 : 1);
    const bodyW = crowd ? 0.55 : 0.72;
    const bodyD = crowd ? 0.55 : 0.72;

    // 底座：金属包边贴图
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 1.35, 0.14, bodyD * 1.35),
      stdMat('hq_cladding', {
        color: 0xffffff, roughness: 0.4, metalness: 0.55,
        repeat: 1, offsetX: 0, offsetY: 0,
      })
    );
    if (!TEX.hq_cladding) plinth.material.color.setHex(0x2c3e50);
    plinth.position.set(x, 0.12, z);
    plinth.castShadow = plinth.receiveShadow = true;
    g.add(plinth);

    // 主体：行业立面贴图（与地块建筑同套材质）
    const bodyMat = towerMat(6 + company.level * 2, 0.55, company.industry, {
      landmark: company.level >= 4,
    });
    // 略染玩家色，但保持贴图可见（用偏白 tint）
    bodyMat.color = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55);
    const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, h, bodyD), bodyMat);
    body.position.set(x, 0.2 + h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // 侧面窄条：金属包边
    const rimMat = stdMat('hq_cladding', {
      color: 0xffffff, roughness: 0.35, metalness: 0.6, repeat: 1, offsetX: 0, offsetY: 0,
    });
    if (!TEX.hq_cladding) rimMat.color.setHex(0x3a4a5c);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const isX = dx !== 0;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(isX ? 0.06 : bodyW * 0.92, h * 0.98, isX ? bodyD * 0.92 : 0.06),
        rimMat
      );
      strip.position.set(x + dx * (bodyW / 2 + 0.02), 0.2 + h / 2, z + dz * (bodyD / 2 + 0.02));
      g.add(strip);
    }

    // 行业色屋顶 + IPO 金顶
    const roofMat = new THREE.MeshStandardMaterial({
      color: company.ipo ? 0xf0c75e : (ind.hex ?? color),
      roughness: 0.35,
      metalness: company.ipo ? 0.7 : 0.25,
      emissive: company.ipo ? 0x886600 : 0x000000,
      emissiveIntensity: company.ipo ? 0.35 : 0,
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 1.08, 0.1, bodyD * 1.08), roofMat);
    roof.position.set(x, 0.2 + h + 0.05, z);
    g.add(roof);

    // 正面行业招牌贴图（Canvas：图标 + 行业名 + 玩家色条），朝外可读
    const logoTex = this._makeCompanyLogoTex(playerName, company, ind, css, crowd);
    const logoH = crowd ? 0.28 : 0.38;
    const logoW = crowd ? 0.48 : 0.62;
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(logoW, logoH),
      new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, depthWrite: false })
    );
    const out = new THREE.Vector3(x, 0, z);
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    out.normalize();
    logo.position.set(
      x + out.x * (bodyD / 2 + 0.04),
      0.2 + h * 0.52,
      z + out.z * (bodyD / 2 + 0.04)
    );
    logo.lookAt(logo.position.x + out.x, logo.position.y, logo.position.z + out.z);
    g.add(logo);

    // 灯塔
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(crowd ? 0.1 : 0.14, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.25 })
    );
    beacon.position.set(x, 0.2 + h + 0.28, z);
    g.add(beacon);

    // 头顶名牌
    const [nc, nctx] = makeCanvas(256, 72);
    nctx.fillStyle = css;
    nctx.beginPath();
    nctx.roundRect(0, 0, 256, 72, 16);
    nctx.fill();
    nctx.fillStyle = '#fff';
    nctx.font = `bold ${crowd ? 40 : 30}px "Microsoft YaHei", sans-serif`;
    nctx.textAlign = 'center';
    nctx.textBaseline = 'middle';
    const tag = company.ipo ? 'IPO·' : '';
    nctx.fillText(crowd ? `${tag}Lv${company.level}` : `${playerName}·${tag}Lv${company.level}`, 128, 38);
    const ntex = new THREE.CanvasTexture(nc);
    ntex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ntex, transparent: true }));
    sprite.scale.set(crowd ? 1.2 : 2.8, crowd ? 0.34 : 0.72, 1);
    sprite.position.set(x, 0.2 + h + (crowd ? 0.55 : 0.95), z);
    g.add(sprite);

    this.scene.add(g);
    this.hqs[playerId] = g;
  }

  /** 公司正面招牌贴图 */
  _makeCompanyLogoTex(playerName, company, ind, css, crowd) {
    const [c, ctx] = makeCanvas(256, 160);
    // 玻璃底
    ctx.fillStyle = '#1a2a3c';
    ctx.fillRect(0, 0, 256, 160);
    // 玩家色顶条
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 256, 28);
    // 行业色底条
    ctx.fillStyle = ind.css || css;
    ctx.fillRect(0, 132, 256, 28);
    // 图标
    ctx.font = `${crowd ? 48 : 56}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ind.icon || '🏢', 128, 70);
    // 行业名
    ctx.fillStyle = '#e8f0ff';
    ctx.font = `bold ${crowd ? 18 : 22}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(ind.name || '公司', 128, 118);
    // 金边
    ctx.strokeStyle = company.ipo ? '#f0c75e' : 'rgba(180,200,230,0.5)';
    ctx.lineWidth = company.ipo ? 6 : 3;
    ctx.strokeRect(4, 4, 248, 152);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // ---------- 智能镜头 ----------
  setFollow(playerId) { this.activeToken = playerId ?? -1; }

  /**
   * 设置镜头模式
   * @param {'follow'|'free'|'orbit'} mode
   */
  setCameraMode(mode) {
    if (this._lookMode) this.setLookMode(false);
    const m = mode === 'orbit' || mode === 'free' ? mode : 'follow';
    this.cameraMode = m;
    this.followEnabled = m === 'follow';
    this._manualUntil = 0;
    if (m === 'orbit') {
      // 以当前距离为环绕半径
      const dist = this.camera.position.distanceTo(this.controls.target);
      this._orbitRadius = Math.min(52, Math.max(18, dist || 34));
      const p = this.camera.position;
      this._orbitAngle = Math.atan2(p.x, p.z);
      this.controls.target.set(0, 0.2, 0);
    }
    if (m === 'follow') this.refocus();
    return m;
  }

  /** 循环：跟随 → 自由 → 通天观战 → 跟随 */
  cycleCameraMode() {
    const order = ['follow', 'free', 'orbit'];
    const i = order.indexOf(this.cameraMode);
    return this.setCameraMode(order[(i + 1) % order.length]);
  }

  /** 立即恢复跟随并重新取景 */
  refocus() {
    if (this._lookMode) this.setLookMode(false);
    this.cameraMode = 'follow';
    this.followEnabled = true;
    this._manualUntil = 0;
  }

  /**
   * WASD + 双击鼠标方向控制
   * @param {HTMLCanvasElement} canvas
   */
  _bindWalkLookControls(canvas) {
    const isTyping = () => {
      const t = document.activeElement;
      if (!t) return false;
      const tag = (t.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
    };

    const setKey = (code, down) => {
      if (code === 'KeyW' || code === 'ArrowUp') this._keys.w = down;
      else if (code === 'KeyS' || code === 'ArrowDown') this._keys.s = down;
      else if (code === 'KeyA' || code === 'ArrowLeft') this._keys.a = down;
      else if (code === 'KeyD' || code === 'ArrowRight') this._keys.d = down;
      else if (code === 'ShiftLeft' || code === 'ShiftRight') this._keys.shift = down;
    };

    addEventListener('keydown', (e) => {
      if (isTyping()) return;
      // 空格掷骰等全局热键不拦截；仅处理 WASD
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        setKey(e.code, true);
        if (e.code.startsWith('Arrow') || e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
          e.preventDefault();
        }
        // 移动时暂停自动跟随/环绕
        this._manualUntil = performance.now() + 6000;
        if (this.cameraMode === 'follow' || this.cameraMode === 'orbit') {
          // 临时保持模式，但不抢回镜头
        }
      }
      if (e.code === 'Escape' && this._lookMode) {
        this.setLookMode(false);
      }
    });
    addEventListener('keyup', (e) => {
      setKey(e.code, false);
    });
    addEventListener('blur', () => {
      this._keys = { w: false, a: false, s: false, d: false, shift: false };
    });

    // 双击画布：开关鼠标方向控制（Pointer Lock）
    canvas.addEventListener('dblclick', (e) => {
      // 忽略 UI 上的双击
      if (e.target !== canvas) return;
      e.preventDefault();
      this.setLookMode(!this._lookMode);
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this._lookMode) {
        // 用户按 Esc 退出锁定
        this._lookMode = false;
        this.controls.enabled = true;
        this._syncOrbitFromCamera();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._lookMode || document.pointerLockElement !== canvas) return;
      this._lookYaw -= e.movementX * this._lookSens;
      this._lookPitch -= e.movementY * this._lookSens;
      // 限制俯仰，避免翻转
      const maxP = 1.2; // ~69°
      const minP = -1.35;
      this._lookPitch = Math.max(minP, Math.min(maxP, this._lookPitch));
    });
  }

  /**
   * 进入/退出鼠标方向控制
   * @param {boolean} on
   */
  setLookMode(on) {
    const canvas = this.renderer?.domElement;
    if (!canvas) return;
    if (on) {
      // 从当前朝向初始化 yaw/pitch
      this.camera.getWorldDirection(this._fwd);
      this._lookYaw = Math.atan2(-this._fwd.x, -this._fwd.z);
      this._lookPitch = Math.asin(Math.max(-1, Math.min(1, this._fwd.y)));
      this._lookMode = true;
      this.controls.enabled = false;
      this._manualUntil = performance.now() + 999999;
      // 切到 free，避免跟随抢镜头
      this.cameraMode = 'free';
      this.followEnabled = false;
      try {
        canvas.requestPointerLock?.();
      } catch { /* */ }
      this._flashCamHint('🖱️ 方向控制：移动鼠标转向 · WASD 移动 · Esc 退出');
    } else {
      this._lookMode = false;
      this.controls.enabled = true;
      this._manualUntil = performance.now() + 4000;
      this._syncOrbitFromCamera();
      if (document.pointerLockElement === canvas) {
        try { document.exitPointerLock?.(); } catch { /* */ }
      }
      this._flashCamHint('已退出方向控制 · 拖拽旋转 / WASD 平移');
    }
  }

  /** 轻量提示（不依赖 UI 模块） */
  _flashCamHint(msg) {
    let el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._camHintT);
    this._camHintT = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  /** 根据 yaw/pitch 更新相机朝向，并同步 Orbit target */
  _applyLookOrientation() {
    const cy = Math.cos(this._lookYaw);
    const sy = Math.sin(this._lookYaw);
    const cp = Math.cos(this._lookPitch);
    const sp = Math.sin(this._lookPitch);
    // 前向（Three 默认 -Z 为前）
    this._fwd.set(-sy * cp, sp, -cy * cp).normalize();
    const lookAt = this.camera.position.clone().addScaledVector(this._fwd, 12);
    this.camera.lookAt(lookAt);
    this.controls.target.copy(lookAt);
  }

  /** 退出 look 后让 OrbitControls 与当前相机一致 */
  _syncOrbitFromCamera() {
    this.camera.getWorldDirection(this._fwd);
    this.controls.target.copy(this.camera.position).addScaledVector(this._fwd, 12);
    this.controls.update();
  }

  /**
   * 每帧：WASD 平移（相对镜头水平朝向）
   * @param {number} dt
   */
  _updateWalk(dt) {
    const k = this._keys;
    if (!k || !(k.w || k.a || k.s || k.d)) {
      // look 模式仍要应用鼠标朝向
      if (this._lookMode) this._applyLookOrientation();
      return;
    }

    this._manualUntil = performance.now() + 6000;

    if (this._lookMode) {
      this._applyLookOrientation();
      this.camera.getWorldDirection(this._fwd);
    } else {
      this.camera.getWorldDirection(this._fwd);
    }

    // 水平前进（压平到 XZ）
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-6) this._fwd.set(0, 0, -1);
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, UP).normalize();

    this._move.set(0, 0, 0);
    if (k.w) this._move.add(this._fwd);
    if (k.s) this._move.sub(this._fwd);
    if (k.d) this._move.add(this._right);
    if (k.a) this._move.sub(this._right);
    if (this._move.lengthSq() < 1e-6) return;
    this._move.normalize();

    const speed = this._moveSpeed * (k.shift ? 2.2 : 1) * dt;
    this.camera.position.addScaledVector(this._move, speed);
    this.controls.target.addScaledVector(this._move, speed);

    // 高度限制，避免钻地/飞太高
    this.camera.position.y = Math.max(2.5, Math.min(55, this.camera.position.y));

    if (this._lookMode) this._applyLookOrientation();
  }

  onPick(cb) {
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downPos = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => {
      if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 6) return;
      // CSS 手牌在独立层，不会点到 canvas；保留兼容
      if (e.target?.closest?.('#hand-fan, #card-cast-fx')) return;
      ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      ray.setFromCamera(ptr, this.camera);
      const hits = ray.intersectObjects(this.tileMeshes, false);
      if (hits.length) cb(hits[0].object.userData.tileIndex, e.clientX, e.clientY);
    });
  }

  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.time ? (now - this.time) / 1000 : 0.016);
      this.time = now;
      for (const a of [...this.animations]) a.update(now);

      // 智能镜头
      if (this.cameraMode === 'orbit' && now > this._manualUntil) {
        // 通天观战：绕棋盘中心自动旋转
        this._orbitAngle += dt * this._orbitSpeed;
        const r = this._orbitRadius;
        const elev = this._orbitElev;
        const cosE = Math.cos(elev);
        const sinE = Math.sin(elev);
        const desired = new THREE.Vector3(
          Math.sin(this._orbitAngle) * r * cosE,
          r * sinE + 1.2,
          Math.cos(this._orbitAngle) * r * cosE,
        );
        const k = 1 - Math.exp(-dt * 3.2);
        this.camera.position.lerp(desired, k);
        this.controls.target.lerp(new THREE.Vector3(0, 0.2, 0), 1 - Math.exp(-dt * 4));
      } else if (this.cameraMode === 'follow' && this.followEnabled && now > this._manualUntil) {
        // 跟随：追踪当前棋子，保留用户缩放；用户拖转 4 秒后再接管
        const tk = this.tokens[this.activeToken];
        if (tk) {
          const tp = tk.position;
          const tgt = this.controls.target;
          const dist = Math.min(45, Math.max(14, this.camera.position.distanceTo(tgt)));
          const dir = new THREE.Vector3(tp.x, 0, tp.z);
          if (dir.lengthSq() < 0.3) dir.set(0.7, 0, 0.7);
          dir.normalize().applyAxisAngle(UP, -0.55);
          const elev = 33 * DEG;
          const desired = tp.clone()
            .addScaledVector(dir, dist * Math.cos(elev))
            .add(new THREE.Vector3(0, dist * Math.sin(elev), 0));
          const k = 1 - Math.exp(-dt * 2.0);
          this.camera.position.lerp(desired, k);
          tgt.lerp(tp, 1 - Math.exp(-dt * 4));
        }
      }
      // WASD 平移（任意模式可用；look 模式下同时处理鼠标朝向）
      this._updateWalk?.(dt);

      // free / 默认：OrbitControls（look 模式已禁用）
      if (!this._lookMode) this.controls.update();
      this._tickWorldDanmaku(now);
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer?.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}
