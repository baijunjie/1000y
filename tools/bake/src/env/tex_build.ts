import * as THREE from 'three';

/** 建筑/道具用的程序贴图。所有贴图可平铺（除招牌等一次性贴图）。 */

const cache = new Map<string, THREE.CanvasTexture>();

function h2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 144665) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** 两个轴周期可不同的值噪声 */
export function n2(x: number, y: number, px: number, py: number, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const wx = (a: number) => ((a % px) + px) % px, wy = (a: number) => ((a % py) + py) % py;
  const a = h2(wx(xi), wy(yi), seed), b = h2(wx(xi + 1), wy(yi), seed);
  const c = h2(wx(xi), wy(yi + 1), seed), d = h2(wx(xi + 1), wy(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function f2(x: number, y: number, px: number, py: number, oct = 4, seed = 1) {
  let s = 0, amp = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    s += n2(x * f, y * f, px * f, py * f, seed + i * 31) * amp;
    tot += amp; amp *= 0.5; f *= 2;
  }
  return s / tot;
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type RGB = [number, number, number];

function pixelTex(key: string, w: number, h: number, fn: (u: number, v: number) => RGB, srgb: boolean): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // v 向上为正，与 three 的 UV 约定一致（flipY 默认 true）
      const [r, g, b] = fn((x + 0.5) / w, 1 - (y + 0.5) / h);
      const o = (y * w + x) * 4;
      img.data[o] = clamp01(r) * 255; img.data[o + 1] = clamp01(g) * 255; img.data[o + 2] = clamp01(b) * 255; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

export function drawTex(
  key: string, w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srgb = true, repeat = false,
): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

export interface TexPair { map: THREE.Texture; bump: THREE.Texture; }

function pair(key: string, size: number, fn: (u: number, v: number) => { c: RGB; h: number }): TexPair {
  const store: { c: RGB; h: number }[] = [];
  const hitM = cache.get(key + '_m'), hitB = cache.get(key + '_b');
  if (hitM && hitB) return { map: hitM, bump: hitB };
  // 先算一遍缓存，颜色与凹凸共用
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) store.push(fn((x + 0.5) / size, 1 - (y + 0.5) / size));
  const at = (u: number, v: number) => store[Math.min(size - 1, Math.floor((1 - v) * size)) * size + Math.min(size - 1, Math.floor(u * size))];
  const map = pixelTex(key + '_m', size, size, (u, v) => at(u, v).c, true);
  const bump = pixelTex(key + '_b', size, size, (u, v) => { const g = at(u, v).h; return [g, g, g]; }, false);
  return { map, bump };
}

/** 白灰墙：斑驳、水渍 */
export function plaster(): TexPair {
  return pair('plaster', 256, (u, v) => {
    const big = f2(u * 4, v * 4, 4, 4, 4, 3);
    const streak = f2(u * 28, v * 2, 28, 2, 3, 9);
    const fine = f2(u * 48, v * 48, 48, 48, 2, 5);
    const stain = sstep(0.55, 0.85, streak) * 0.09;
    const patch = sstep(0.6, 0.78, big) * 0.07;
    const g = 0.93 + 0.05 * big - stain - patch + 0.03 * (fine - 0.5);
    return { c: [g * 1.0, g * 0.985, g * 0.955], h: 0.5 + 0.3 * (fine - 0.5) + 0.3 * (big - 0.5) - patch * 2 };
  });
}

/** 木板：纹理沿 V 方向，U 方向 4 块板 */
export function wood(): TexPair {
  return pair('wood', 256, (u, v) => {
    const pu = u * 4, pi = Math.floor(pu), pf = pu - pi;
    const tone = 0.8 + 0.22 * h2(pi, 7, 11);
    const grain = f2(u * 40 + pi * 13.7, v * 3 + pi * 0.37, 40, 3, 4, 21);
    const knot = sstep(0.82, 0.9, f2(u * 8, v * 4, 8, 4, 2, 33)) * 0.25;
    const edge = Math.min(pf, 1 - pf);
    const seam = 1 - sstep(0, 0.035, edge);
    const g = tone * (0.74 + 0.36 * grain) * (1 - 0.5 * seam) - knot;
    return { c: [g, g * 0.97, g * 0.93], h: 0.55 + 0.35 * (grain - 0.5) - 0.55 * seam };
  });
}

/** 细木纹（无板缝）：柱、梁、细构件 */
export function woodFine(): TexPair {
  return pair('woodfine', 256, (u, v) => {
    const grain = f2(u * 36, v * 3, 36, 3, 4, 41);
    const big = f2(u * 3, v * 3, 3, 3, 3, 43);
    const g = 0.78 + 0.3 * (grain - 0.5) + 0.16 * (big - 0.5);
    return { c: [g, g * 0.97, g * 0.94], h: 0.5 + 0.5 * (grain - 0.5) };
  });
}

/** 青瓦屋面：U 方向 8 垄，V 方向 8 层 */
export function roofTile(): TexPair {
  return pair('rooftile', 512, (u, v) => {
    const r = Math.floor(u * 8), cu = v * 8, c = Math.floor(cu), fv = cu - c;
    const tone = 0.86 + 0.2 * h2(r, c, 51);
    // 域扭曲，避免值噪声的方块感
    const wu = u + 0.09 * (f2(u * 3, v * 3, 3, 3, 3, 53) - 0.5), wv = v + 0.09 * (f2(u * 3 + 1.7, v * 3, 3, 3, 3, 55) - 0.5);
    const wx = f2(wu * 6, wv * 6, 6, 6, 4, 57);
    const moss = sstep(0.57, 0.8, f2(wu * 5 + 2.3, wv * 5, 5, 5, 4, 63));
    const lichen = sstep(0.87, 0.93, f2(u * 26, v * 26, 26, 26, 2, 67));
    const lap = sstep(0, 0.22, fv) * 0.3 + 0.7; // 上一层瓦压住的阴影线
    const g = tone * lap * (0.86 + 0.24 * wx);
    let col: RGB = [0.335 * g, 0.355 * g, 0.385 * g];
    const mc: RGB = [0.33 * g, 0.39 * g, 0.25 * g];
    const k = moss * 0.6;
    col = [col[0] + (mc[0] - col[0]) * k, col[1] + (mc[1] - col[1]) * k, col[2] + (mc[2] - col[2]) * k];
    col = [col[0] + lichen * 0.16, col[1] + lichen * 0.16, col[2] + lichen * 0.13];
    return { c: col, h: 0.25 + 0.6 * (1 - fv) + 0.1 * (wx - 0.5) };
  });
}

/** 茅草/稻草 */
export function thatch(): TexPair {
  return pair('thatch', 256, (u, v) => {
    const strand = f2(u * 64, v * 4, 64, 4, 3, 71);
    const layer = v * 6 - Math.floor(v * 6);
    const big = f2(u * 4, v * 4, 4, 4, 3, 73);
    const g = (0.7 + 0.4 * (strand - 0.5) + 0.2 * (big - 0.5)) * (0.74 + 0.26 * sstep(0, 0.3, layer));
    return { c: [g * 1.0, g * 0.94, g * 0.8], h: 0.4 + 0.5 * (strand - 0.5) + 0.35 * (1 - layer) };
  });
}

function blocks(key: string, rows: number, cols: number, mortar: number, jitter: number): TexPair {
  return pair(key, 256, (u, v) => {
    const rv = v * rows, r = Math.floor(rv), fr = rv - r;
    const off = (r % 2) * 0.5 + h2(r, 3, 81) * jitter;
    const cu = u * cols + off, c = Math.floor(cu), fc = cu - c;
    const cw = ((c % cols) + cols) % cols;
    const tone = 0.78 + 0.26 * h2(cw, r, 83);
    const warm = h2(cw, r, 85) - 0.5;
    const e = Math.min(Math.min(fr, 1 - fr) / rows, Math.min(fc, 1 - fc) / cols);
    const m = 1 - sstep(mortar * 0.4, mortar, e);
    const sp = f2(u * 40, v * 40, 40, 40, 3, 87);
    const big = f2(u * 4, v * 4, 4, 4, 3, 89);
    const g = tone * (0.86 + 0.2 * (sp - 0.5) + 0.16 * (big - 0.5)) * (1 - 0.42 * m);
    return { c: [g * (1 + warm * 0.06), g, g * (1 - warm * 0.06)], h: 0.6 + 0.25 * (sp - 0.5) - 0.5 * m + 0.1 * (tone - 0.9) };
  });
}

/** 条石（台基、石阶） */
export const stone = () => blocks('stone', 4, 2, 0.014, 0.2);
/** 青砖 */
export const brick = () => blocks('brick', 8, 3, 0.012, 0.08);
/** 乱石/毛石 */
export const rubble = () => blocks('rubble', 6, 4, 0.02, 0.5);

/** 粗布（营帐、棚布） */
export function canvasCloth(): TexPair {
  return pair('canvascloth', 256, (u, v) => {
    const big = f2(u * 4, v * 4, 4, 4, 4, 91);
    const weave = 0.5 + 0.5 * Math.sin(u * 256 * Math.PI) * Math.sin(v * 256 * Math.PI);
    const dirt = sstep(0.6, 0.85, f2(u * 7, v * 3, 7, 3, 3, 93));
    const g = 0.88 + 0.14 * (big - 0.5) + 0.04 * weave - 0.12 * dirt;
    return { c: [g, g * 0.985, g * 0.96], h: 0.5 + 0.3 * (big - 0.5) + 0.1 * weave };
  });
}

/** 夯土/泥地（炉台、灶） */
export function clay(): TexPair {
  return pair('clay', 256, (u, v) => {
    const big = f2(u * 5, v * 5, 5, 5, 4, 95);
    const sp = f2(u * 50, v * 50, 50, 50, 2, 97);
    const g = 0.82 + 0.24 * (big - 0.5) + 0.12 * (sp - 0.5);
    return { c: [g, g * 0.97, g * 0.93], h: 0.5 + 0.4 * (big - 0.5) + 0.3 * (sp - 0.5) };
  });
}

/** 条纹棚布（一次性颜色贴图，沿 U 方向条纹） */
export function stripes(a: string, b: string, n = 6): THREE.Texture {
  return drawTex(`stripes_${a}_${b}_${n}`, 256, 64, (ctx, w, h) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? a : b;
      ctx.fillRect((i * w) / n, 0, w / n + 1, h);
    }
    // 做旧
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(60,40,20,${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 20, 2 + Math.random() * 5);
    }
  }, true, true);
}

export type LatticeKind = 'grid' | 'diamond' | 'panel';

/** 窗棂：返回颜色贴图与夜间发光贴图 */
export function lattice(kind: LatticeKind, woodCol = '#3b2618', paper = '#e4d3a6'): { map: THREE.Texture; emis: THREE.Texture } {
  const draw = (emis: boolean) => (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (emis) {
      const g = ctx.createRadialGradient(w / 2, h * 0.55, 10, w / 2, h / 2, w * 0.75);
      g.addColorStop(0, '#fff0c4'); g.addColorStop(1, '#d08a3a');
      ctx.fillStyle = g;
    } else ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    if (!emis) {
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(120,90,50,${Math.random() * 0.07})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 10 + Math.random() * 30, 6 + Math.random() * 20);
      }
    }
    ctx.strokeStyle = emis ? '#000000' : woodCol;
    ctx.lineCap = 'square';
    const line = (x0: number, y0: number, x1: number, y1: number, lw: number) => {
      ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    const m = 14;
    if (kind === 'grid') {
      const n = 4;
      for (let i = 1; i < n; i++) { line((w * i) / n, 0, (w * i) / n, h, 9); line(0, (h * i) / n, w, (h * i) / n, 9); }
      // 中心回纹
      ctx.lineWidth = 7; ctx.strokeRect(w * 0.375, h * 0.375, w * 0.25, h * 0.25);
    } else if (kind === 'diamond') {
      const n = 5;
      for (let i = -n; i <= n * 2; i++) { line((w * i) / n, 0, (w * (i + n)) / n, h, 7); line((w * i) / n, h, (w * (i + n)) / n, 0, 7); }
    } else {
      // 隔扇：上部格心 + 下部裙板
      const top = h * 0.62;
      for (let i = 1; i < 4; i++) line((w * i) / 4, 0, (w * i) / 4, top, 8);
      for (let i = 1; i < 5; i++) line(0, (top * i) / 5, w, (top * i) / 5, 8);
      ctx.fillStyle = emis ? '#000000' : woodCol;
      ctx.fillRect(0, top, w, h - top);
      if (!emis) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 5; ctx.strokeRect(m * 1.6, top + m, w - m * 3.2, h - top - m * 2); }
    }
    ctx.strokeStyle = emis ? '#000000' : woodCol;
    ctx.lineWidth = m * 2; ctx.strokeRect(0, 0, w, h);
  };
  return {
    map: drawTex(`lat_${kind}_${woodCol}_${paper}`, 256, 256, draw(false)),
    emis: drawTex(`lat_${kind}_e`, 256, 256, draw(true)),
  };
}

/** 双扇板门 */
export function door(col = '#5a2a1e', studs = true): THREE.Texture {
  return drawTex(`door_${col}_${studs}`, 256, 320, (ctx, w, h) => {
    ctx.fillStyle = col; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`;
      ctx.fillRect((i * w) / 8, 0, w / 8 - 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect((i * w) / 8 - 1, 0, 2, h);
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,220,170'},${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 20 + Math.random() * 60);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(w / 2 - 3, 0, 6, h);
    if (studs) {
      ctx.fillStyle = '#c9a44a';
      for (const sx of [0, 1]) for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
        ctx.beginPath(); ctx.arc(sx * (w / 2) + 26 + c * 38, 40 + r * 70, 7, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.strokeStyle = '#c9a44a'; ctx.lineWidth = 5;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(w / 2 + sx * 24, h * 0.52, 11, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 8; ctx.strokeRect(0, 0, w, h);
  });
}

const FONT = "'Kaiti SC','STKaiti','KaiTi','Songti SC','PingFang SC',serif";

/** 匾额/招牌：横排或竖排文字 */
export function sign(text: string, o: { bg?: string; fg?: string; vertical?: boolean; border?: string; w?: number; h?: number } = {}): THREE.Texture {
  const n = text.length;
  const vertical = !!o.vertical;
  const cell = 128;
  const w = o.w ?? (vertical ? cell + 40 : cell * n + 56), h = o.h ?? (vertical ? cell * n + 56 : cell + 40);
  return drawTex(`sign_${text}_${o.bg}_${o.fg}_${vertical}_${w}_${h}`, w, h, (ctx) => {
    ctx.fillStyle = o.bg ?? '#2a1a12'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 80, 2);
    }
    ctx.strokeStyle = o.border ?? '#b8923e'; ctx.lineWidth = 10; ctx.strokeRect(9, 9, w - 18, h - 18);
    ctx.fillStyle = o.fg ?? '#d9b45a';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${cell * 0.82}px ${FONT}`;
    for (let i = 0; i < n; i++) {
      const x = vertical ? w / 2 : 28 + cell * (i + 0.5), y = vertical ? 28 + cell * (i + 0.5) : h / 2 + 4;
      ctx.fillText(text[i], x, y);
    }
  });
}

/** 布幌/旗面：单色底 + 文字或图案 */
export function banner(text: string, bg: string, fg: string, w = 128, h = 256): THREE.Texture {
  return drawTex(`banner_${text}_${bg}_${fg}_${w}_${h}`, w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 50, 3);
    }
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const n = text.length || 1;
    const size = Math.min(w * 0.8, (h * 0.8) / n);
    ctx.font = `bold ${size}px ${FONT}`;
    for (let i = 0; i < text.length; i++) ctx.fillText(text[i], w / 2, h * 0.1 + size * (i + 0.5) + (h * 0.8 - size * n) / 2);
    ctx.strokeStyle = fg; ctx.lineWidth = 4; ctx.strokeRect(6, 6, w - 12, h - 12);
  });
}
