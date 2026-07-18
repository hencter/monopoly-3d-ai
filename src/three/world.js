// Three.js 3D 世界：棋盘、棋子、摩天楼、公司总部、骰子、智能镜头
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TILES, INDUSTRIES } from '../data/tiles.js';
import { soundManager } from '../audio.js';

/** 释放 Group 内全部几何体/材质/贴图，防止 GPU 显存泄漏 */
function disposeGroup(g) {
  if (!g) return;
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        if (m.emissiveMap && m.emissiveMap !== m.map) m.emissiveMap.dispose();
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

function tileTexture(t) {
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = '#f8f3e6';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#b9a67a';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 250);
  const center = (txt, y, size, color = '#333', bold = true) => {
    ctx.fillStyle = color;
    ctx.font = `${bold ? 'bold ' : ''}${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, 128, y);
  };
  if (t.type === 'property') {
    const ind = INDUSTRIES[t.color];
    ctx.fillStyle = ind.css;
    ctx.fillRect(6, 6, 244, 54);
    center(ind.icon, 33, 36, '#fff');
    center(t.name, 130, t.name.length <= 3 ? 46 : t.name.length <= 4 ? 40 : 34);
    center(`¥${t.price}`, 205, 32, '#8a6d3b');
  } else if (t.type === 'railroad') {
    center(t.name.includes('航天') ? '🚀' : t.name.includes('机场') ? '✈️' : t.name.includes('港') ? '🚢' : '🚄', 82, 68);
    center(t.name, 152, t.name.length <= 4 ? 40 : 34);
    center(`¥${t.price}`, 205, 32, '#8a6d3b');
  } else if (t.type === 'utility') {
    center(t.name.includes('云') ? '☁️' : '🔌', 82, 68);
    center(t.name, 152, t.name.length <= 4 ? 40 : 34);
    center(`¥${t.price}`, 205, 32, '#8a6d3b');
  } else if (t.type === 'chance') {
    center('🌪️', 100, 72);
    center('风 口', 195, 44, '#e67e22');
  } else if (t.type === 'chest') {
    center('⚠️', 100, 72);
    center('风 险', 195, 44, '#2e86c1');
  } else if (t.type === 'tax') {
    center('💸', 90, 64);
    center(t.name, 155, 34);
    center(`¥${t.amount}`, 208, 30, '#a33', false);
  } else if (t.type === 'go') {
    center('💰', 105, 72);
    center('创业起点', 195, 42, '#c0392b');
  } else if (t.type === 'jail') {
    center('⚖️', 100, 72);
    center('监管局', 190, 44);
  } else if (t.type === 'parking') {
    center('🏝️', 100, 72);
    center('休闲度假', 190, 38);
  } else if (t.type === 'gotojail') {
    center('🚨', 100, 72);
    center('违规被查', 190, 40);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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

/** 摩天楼玻璃幕墙贴图（带亮灯窗户） */
function towerTexture(rows, litRatio = 0.55) {
  const [c, ctx] = makeCanvas(64, 32 * rows);
  ctx.fillStyle = '#223549';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = Math.random() < litRatio ? '#ffd980' : '#33475e';
      ctx.fillRect(6 + col * 14, 6 + r * 32, 9, 14);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101c2e);
    this.scene.fog = new THREE.Fog(0x101c2e, 50, 100);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 24, 30);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 75 * DEG;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 60;

    // 智能镜头：用户操作时暂停接管，4 秒后恢复
    this.followEnabled = true;
    this._manualUntil = 0;
    this.controls.addEventListener('start', () => { this._manualUntil = performance.now() + 4000; });

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
      new THREE.MeshStandardMaterial({ color: 0x14273a, roughness: 1 })
    );
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

    this._buildBoard();
    this._buildDice();

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ---------- 棋盘 ----------
  _buildBoard() {
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(26.6, 0.8, 26.6),
      new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.6, metalness: 0.3 })
    );
    rim.position.y = -0.45;
    rim.receiveShadow = true;
    this.scene.add(rim);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(25.4, 0.5, 25.4),
      new THREE.MeshStandardMaterial({ color: 0x16324a, roughness: 0.95 })
    );
    base.position.y = -0.05;
    base.receiveShadow = true;
    this.scene.add(base);

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
    TILES.forEach((t, i) => {
      const pos = tilePosition(i);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.92, TILE_H, 1.92),
        new THREE.MeshStandardMaterial({ color: 0xf3ecd9, roughness: 0.9 })
      );
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

      if (['property', 'railroad', 'utility'].includes(t.type)) {
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(2.04, 0.1, 2.04),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
        );
        plate.position.set(pos.x, 0.05, pos.z);
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

  // ---------- 棋子（6 种造型循环 + 34 色） ----------
  createToken(playerId) {
    const color = PLAYER_COLORS[playerId % PLAYER_COLORS.length];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
    const g = new THREE.Group();
    const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };

    switch (playerId % 6) {
      case 0: { // 汽车
        add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.9), mat), 0, 0.24, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.42), mat), 0, 0.42, -0.05);
        const wg = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14);
        for (const [x, z] of [[-0.28, 0.28], [0.28, 0.28], [-0.28, -0.28], [0.28, -0.28]]) {
          add(new THREE.Mesh(wg, dark), x, 0.11, z).rotation.z = Math.PI / 2;
        }
        break;
      }
      case 1: { // 礼帽
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24), mat), 0, 0.06, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.45, 24), mat), 0, 0.3, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.1, 24), dark), 0, 0.14, 0);
        break;
      }
      case 2: { // 小狗
        add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), mat), 0, 0.28, 0).scale.set(1, 0.85, 1.25);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), mat), 0, 0.48, 0.26);
        const earG = new THREE.ConeGeometry(0.07, 0.18, 8);
        add(new THREE.Mesh(earG, mat), -0.1, 0.64, 0.24);
        add(new THREE.Mesh(earG, mat), 0.1, 0.64, 0.24);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 8), mat), 0, 0.42, -0.32).rotation.x = -0.8;
        break;
      }
      case 3: { // 帆船
        add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.85), mat), 0, 0.12, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), dark), 0, 0.5, 0);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 3), white), 0.02, 0.55, 0).rotation.y = Math.PI / 6;
        break;
      }
      case 4: { // 火箭
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.55, 16), white), 0, 0.4, 0);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 16), mat), 0, 0.82, 0);
        const finG = new THREE.BoxGeometry(0.05, 0.25, 0.18);
        for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
          const fin = add(new THREE.Mesh(finG, mat), Math.sin(a) * 0.18, 0.18, Math.cos(a) * 0.18);
          fin.rotation.y = a;
        }
        add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0xffa500, emissive: 0xff6600, emissiveIntensity: 0.8 })), 0, 0.05, 0).rotation.x = Math.PI;
        break;
      }
      case 5: { // 机器人
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.3), mat), 0, 0.3, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.26), mat), 0, 0.62, 0);
        const eyeG = new THREE.SphereGeometry(0.045, 8, 8);
        add(new THREE.Mesh(eyeG, new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1 })), -0.08, 0.64, 0.14);
        add(new THREE.Mesh(eyeG, new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1 })), 0.08, 0.64, 0.14);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), dark), 0, 0.82, 0);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat), 0, 0.92, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.32), dark), 0, 0.08, 0);
        break;
      }
    }
    g.position.copy(tokenSlot(0, playerId, this.playerCount));
    g.scale.setScalar(tokenScale(this.playerCount));
    this.scene.add(g);
    this.tokens[playerId] = g;
    return g;
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

  /** 掷骰动画；d2=0 表示遥控骰子（只摇一颗） */
  animateDice(d1, d2, duration = 1.15) {
    soundManager.play('dice');
    const single = d2 === 0;
    const values = single ? [d1] : [d1, d2];
    const active = single ? [this.dice[0]] : this.dice;
    const targets = values.map(v => diceQuaternionFor(v));
    const vels = active.map(() => new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18));
    const settleFrom = active.map(() => null);
    if (single) this.dice[1].visible = false;
    if (single) active[0].position.x = 0;
    const start = performance.now();
    return new Promise(resolve => {
      const anim = {
        update: (now) => {
          const t = (now - start) / 1000;
          const k = Math.min(t / duration, 1);
          active.forEach((d, i) => {
            if (k < 0.55) {
              const dt = 1 / 60;
              d.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(vels[i].x * dt, vels[i].y * dt, vels[i].z * dt)));
              vels[i].multiplyScalar(0.985);
              d.position.y = 1.6 + Math.abs(Math.sin(t * 9 + i)) * 0.9 * (1 - k);
            } else {
              if (!settleFrom[i]) settleFrom[i] = d.quaternion.clone();
              const kk = (k - 0.55) / 0.45;
              const e = 1 - Math.pow(1 - kk, 3);
              d.quaternion.slerpQuaternions(settleFrom[i], targets[i], e);
              d.position.y = 0.55 + Math.abs(Math.sin(kk * Math.PI)) * 0.35 * (1 - kk);
            }
          });
          if (k >= 1) {
            active.forEach((d, i) => { d.quaternion.copy(targets[i]); d.position.y = 0.55; });
            if (single) { this.dice[1].visible = true; this.dice[0].position.x = -0.9; }
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

  teleportToken(playerId, from, to) {
    const token = this.tokens[playerId];
    if (!token) return Promise.resolve();
    const p0 = tokenSlot(from, playerId, this.playerCount);
    const p1 = tokenSlot(to, playerId, this.playerCount);
    const start = performance.now();
    return new Promise(resolve => {
      const anim = {
        update: (now) => {
          const k = Math.min((now - start) / 650, 1);
          token.position.lerpVectors(p0, p1, k);
          token.position.y = TILE_H + 0.02 + Math.sin(k * Math.PI) * 3.2;
          if (k >= 1) { this.animations.delete(anim); resolve(); }
        }
      };
      this.animations.add(anim);
    });
  }

  // ---------- 产权 / 摩天楼 ----------
  setOwner(tileIdx, colorHex) {
    const plate = this.ownerPlates[tileIdx];
    if (!plate) return;
    if (colorHex == null) plate.visible = false;
    else { plate.material.color.setHex(colorHex); plate.visible = true; }
  }

  /** 建筑等级 0~5：玻璃幕墙摩天楼，逐级长高；5 = 地标大厦 */
  setHouses(tileIdx, n) {
    const old = this.houseGroups[tileIdx];
    if (old) { this.scene.remove(old); disposeGroup(old); this.houseGroups[tileIdx] = null; }
    if (n <= 0) return;
    const t = TILES[tileIdx];
    const pos = tilePosition(tileIdx);
    const { dir } = tileFrame(tileIdx);
    const g = new THREE.Group();
    const cx = pos.x + dir.x * 0.32;
    const cz = pos.z + dir.z * 0.32;

    if (n >= 5) {
      // 地标大厦：主塔 + 副楼 + 尖顶
      const tex = towerTexture(14, 0.65);
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 1.9, 0.62),
        new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffc766, emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 })
      );
      tower.position.set(cx, TILE_H + 0.95, cz);
      tower.castShadow = true;
      g.add(tower);
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.5, 8),
        new THREE.MeshStandardMaterial({ color: 0xff5555, emissive: 0xff2222, emissiveIntensity: 1 })
      );
      spire.position.set(cx, TILE_H + 2.15, cz);
      g.add(spire);
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.9, 0.34),
        new THREE.MeshStandardMaterial({ map: towerTexture(7, 0.5), emissive: 0xffc766, emissiveIntensity: 0.4, roughness: 0.3 })
      );
      wing.position.set(cx + 0.42, TILE_H + 0.45, cz + 0.3);
      wing.castShadow = true;
      g.add(wing);
    } else {
      const h = 0.4 + 0.32 * (n - 1); // 逐级长高
      const rows = 3 + n * 2;
      const tex = towerTexture(rows, 0.5);
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, h, 0.56),
        new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffc766, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.35 })
      );
      tower.position.set(cx, TILE_H + h / 2, cz);
      tower.castShadow = true;
      g.add(tower);
      // 行业色屋顶
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.06, 0.6),
        new THREE.MeshStandardMaterial({ color: INDUSTRIES[t.color]?.hex ?? 0x888888, roughness: 0.5 })
      );
      roof.position.set(cx, TILE_H + h + 0.03, cz);
      g.add(roof);
    }
    this.scene.add(g);
    this.houseGroups[tileIdx] = g;
  }

  // ---------- 公司总部（棋盘中央；大人数自动加密/缩小/简化名牌） ----------
  setCompany(playerId, company, playerName) {
    const old = this.hqs[playerId];
    if (old) { this.scene.remove(old); disposeGroup(old); this.hqs[playerId] = null; }
    if (!company) return;
    const crowd = this.playerCount > 12;
    const color = PLAYER_COLORS[playerId % PLAYER_COLORS.length];
    const g = new THREE.Group();
    const angle = (playerId / this.playerCount) * Math.PI * 2 + Math.PI / 6;
    const r = crowd ? 6.3 : 4.8;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const h = (0.9 + 0.5 * company.level) * (crowd ? 0.65 : 1);
    const baseR = crowd ? 0.38 : 0.55;

    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(baseR, baseR * 1.25, h, 6),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 })
    );
    tower.position.set(x, h / 2 + 0.2, z);
    tower.castShadow = true;
    g.add(tower);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(crowd ? 0.1 : 0.14, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.2 })
    );
    beacon.position.set(x, h + 0.32, z);
    g.add(beacon);

    // 名牌（大人数时缩小只显示等级，避免糊成一团）
    const [nc, nctx] = makeCanvas(256, 72);
    nctx.fillStyle = PLAYER_COLORS_CSS[playerId % PLAYER_COLORS.length];
    nctx.beginPath();
    nctx.roundRect(0, 0, 256, 72, 16);
    nctx.fill();
    nctx.fillStyle = '#fff';
    nctx.font = `bold ${crowd ? 44 : 34}px "Microsoft YaHei", sans-serif`;
    nctx.textAlign = 'center';
    nctx.textBaseline = 'middle';
    nctx.fillText(crowd ? `Lv${company.level}` : `${playerName}·Lv${company.level}`, 128, 38);
    const ntex = new THREE.CanvasTexture(nc);
    ntex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ntex, transparent: true }));
    sprite.scale.set(crowd ? 1.1 : 2.6, crowd ? 0.32 : 0.72, 1);
    sprite.position.set(x, h + (crowd ? 0.55 : 0.95), z);
    g.add(sprite);

    this.scene.add(g);
    this.hqs[playerId] = g;
  }

  // ---------- 智能镜头 ----------
  setFollow(playerId) { this.activeToken = playerId ?? -1; }

  /** 立即恢复跟随并重新取景 */
  refocus() {
    this.followEnabled = true;
    this._manualUntil = 0;
  }

  onPick(cb) {
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downPos = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => {
      if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 6) return;
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

      // 智能镜头：追踪当前棋子，保留用户缩放；用户拖转 4 秒后再接管
      if (this.followEnabled && now > this._manualUntil) {
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
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}
