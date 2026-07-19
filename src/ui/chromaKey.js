// 绿幕抠像：加载含 #00FF00 背景的艺术素材 → 透明 PNG dataURL，供 CSS/蒙版渲染

const CACHE = Object.create(null);

/**
 * 判断像素是否为绿幕（带容差，兼容压缩后的绿）
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
export function isChromaGreen(r, g, b, {
  minG = 70,
  greenDominance = 28,
  maxRB = 140,
} = {}) {
  if (g < minG) return false;
  if (r > maxRB && b > maxRB && g < r + 20) return false;
  const dom = g - Math.max(r, b);
  return dom >= greenDominance;
}

/**
 * 软边 alpha：越“绿”越透明
 */
function greenAlpha(r, g, b) {
  const dom = g - Math.max(r, b);
  if (dom < 18) return 255;
  if (dom > 90 && g > 120) return 0;
  // 18~90 线性过渡
  const t = (dom - 18) / (90 - 18);
  return Math.round(255 * (1 - Math.min(1, Math.max(0, t))));
}

/**
 * 对 Image/Canvas 做绿幕抠像，返回 canvas
 * @param {CanvasImageSource} source
 * @param {{ soft?: boolean }} [opts]
 */
export function keyGreenSource(source, opts = {}) {
  const soft = opts.soft !== false;
  const w = source.naturalWidth || source.videoWidth || source.width;
  const h = source.naturalHeight || source.videoHeight || source.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    if (soft) {
      const a = greenAlpha(r, g, b);
      if (a < 255) {
        d[i + 3] = Math.min(d[i + 3], a);
        // 去绿溢色：边缘略压绿
        if (a > 0 && a < 250) {
          d[i + 1] = Math.min(d[i + 1], Math.max(d[i], d[i + 2]) + 10);
        }
      }
    } else if (isChromaGreen(r, g, b)) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load fail: ${url}`));
    img.src = url;
  });
}

/**
 * 按非透明像素包围盒裁切（去绿幕后的留白）
 * @param {HTMLCanvasElement} canvas
 * @param {number} [pad=4]
 */
export function cropTransparent(canvas, pad = 4) {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return canvas;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

/**
 * 加载绿幕图并抠像，返回可缓存的 dataURL（PNG）
 * @param {string} url
 * @param {{ soft?: boolean, cacheKey?: string, crop?: boolean }} [opts]
 */
export async function keyGreenUrl(url, opts = {}) {
  const key = opts.cacheKey || url;
  if (CACHE[key]) return CACHE[key];
  try {
    const img = await loadImage(url);
    let canvas = keyGreenSource(img, opts);
    if (opts.crop) canvas = cropTransparent(canvas);
    const dataUrl = canvas.toDataURL('image/png');
    CACHE[key] = dataUrl;
    return dataUrl;
  } catch (e) {
    console.warn('[chromaKey]', e);
    CACHE[key] = url; // 失败回退原图
    return url;
  }
}

/** 预加载一组绿幕素材 */
export async function preloadKeyedFrames(map) {
  const out = {};
  await Promise.all(
    Object.entries(map).map(async ([name, url]) => {
      // 红头文件需裁掉绿幕后的留白，便于 A4 叠层对齐
      const crop = name === 'jailNotice';
      out[name] = await keyGreenUrl(url, { cacheKey: name, crop });
    }),
  );
  return out;
}

// 默认弹窗/卡牌绿幕素材路径
export const GS_ASSETS = {
  modalPortrait: '/textures/hud/gs/modal_portrait_gs.jpg',
  modalWide: '/textures/hud/gs/modal_wide_gs.jpg',
  cardFrame: '/textures/hud/gs/card_frame_gs.jpg',
  jailNotice: '/textures/hud/jail_notice_gs.jpg',
};

let _frames = null;

/** 懒加载并缓存抠像后的弹窗框 */
export async function getArtFrames() {
  if (_frames) return _frames;
  _frames = await preloadKeyedFrames(GS_ASSETS);
  return _frames;
}
