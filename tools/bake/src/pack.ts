import type { FrameMeta } from '../../../src/shared/consts';
import type { FrameResult } from './core';

interface Rect { key: string; w: number; h: number; x: number; y: number; }

function shelf(rects: Rect[], W: number, gap: number): number {
  let x = gap, y = gap, rowH = 0;
  for (const r of rects) {
    if (x + r.w + gap > W) { x = gap; y += rowH + gap; rowH = 0; }
    r.x = x; r.y = y;
    x += r.w + gap;
    if (r.h > rowH) rowH = r.h;
  }
  return y + rowH + gap;
}

function layout(rects: Rect[], maxSize: number): [number, number] {
  rects.sort((a, b) => b.h - a.h || b.w - a.w);
  const maxW = rects.reduce((m, r) => Math.max(m, r.w), 0) + 4;
  // 选最接近正方形的布局（最长边最短），保证贴图不超出常见的 4096 上限
  let best: [number, number] | null = null;
  for (const W of [256, 384, 512, 768, 1024, 1280, 1536, 2048, 2560, 3072, 3584, 4096, 5120, 6144, 8192]) {
    if (W < maxW || W > maxSize) continue;
    const H = shelf(rects, W, 2);
    if (H > maxSize) continue;
    if (!best || Math.max(W, H) < Math.max(best[0], best[1]) || (Math.max(W, H) === Math.max(best[0], best[1]) && W * H < best[0] * best[1])) best = [W, H];
  }
  if (!best) throw new Error(`atlas 超出 ${maxSize}，需要拆分`);
  shelf(rects, best[0], 2);
  return best;
}

function blit(dst: Uint8ClampedArray, dw: number, src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number) {
  for (let j = 0; j < sh; j++) dst.set(src.subarray(j * sw * 4, (j + 1) * sw * 4), ((y + j) * dw + x) * 4);
}

export interface PackedAtlas {
  size: [number, number];
  color: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  shadowSize?: [number, number];
  shadow?: Uint8ClampedArray;
  frames: Record<string, FrameMeta>;
}

export function packAtlas(results: FrameResult[], maxSize = 8192): PackedAtlas {
  const rects: Rect[] = [];
  const src = new Map<string, { w: number; h: number; color: Uint8ClampedArray; normal: Uint8ClampedArray }>();
  for (const r of results) {
    rects.push({ key: r.key, w: r.w, h: r.h, x: 0, y: 0 });
    src.set(r.key, r);
    if (r.emissive) {
      rects.push({ key: r.key + '@e', w: r.emissive.w, h: r.emissive.h, x: 0, y: 0 });
      src.set(r.key + '@e', r.emissive);
    }
  }
  const [W, H] = layout(rects, maxSize);
  const color = new Uint8ClampedArray(W * H * 4);
  const normal = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { normal[i * 4] = 128; normal[i * 4 + 1] = 128; normal[i * 4 + 3] = 255; }
  const pos = new Map<string, Rect>();
  for (const r of rects) {
    const s = src.get(r.key)!;
    blit(color, W, s.color, s.w, s.h, r.x, r.y);
    blit(normal, W, s.normal, s.w, s.h, r.x, r.y);
    pos.set(r.key, r);
  }
  const frames: Record<string, FrameMeta> = {};
  for (const r of results) {
    const p = pos.get(r.key)!;
    const f: FrameMeta = { r: [p.x, p.y, r.w, r.h], a: [r.ax, r.ay] };
    if (r.emissive) {
      const e = pos.get(r.key + '@e')!;
      f.e = [e.x, e.y, r.emissive.w, r.emissive.h, r.emissive.ax, r.emissive.ay];
    }
    frames[r.key] = f;
  }
  const out: PackedAtlas = { size: [W, H], color, normal, frames };

  const sh = results.filter((r) => r.shadow);
  if (sh.length) {
    const sr: Rect[] = sh.map((r) => ({ key: r.key, w: r.shadow!.w, h: r.shadow!.h, x: 0, y: 0 }));
    const [SW, SH] = layout(sr, maxSize);
    const sdata = new Uint8ClampedArray(SW * SH * 4);
    for (let i = 3; i < sdata.length; i += 4) sdata[i] = 255;
    const byKey = new Map(sh.map((r) => [r.key, r]));
    for (const r of sr) {
      const s = byKey.get(r.key)!.shadow!;
      blit(sdata, SW, s.data, s.w, s.h, r.x, r.y);
      frames[r.key].s = [r.x, r.y, s.w, s.h, s.ax, s.ay];
    }
    out.shadowSize = [SW, SH];
    out.shadow = sdata;
  }
  return out;
}
