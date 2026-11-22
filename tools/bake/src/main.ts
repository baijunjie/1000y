import type { AtlasMeta } from '../../../src/shared/consts';
import { COS, SHADOW_SCALE, SIN, SUN_DIR } from '../../../src/shared/consts';
import { Baker, FrameResult } from './core';
import { JOBS } from './jobs';
import { packAtlas } from './pack';

declare global {
  interface Window { __done?: boolean; __error?: string; }
}

async function save(file: string, body: Uint8ClampedArray | string, w = 0, h = 0, rgb = false) {
  const url = `/__save?file=${encodeURIComponent(file)}&w=${w}&h=${h}&rgb=${rgb ? 1 : 0}`;
  const res = await fetch(url, { method: 'POST', body: body as any });
  if (!res.ok) throw new Error('save failed: ' + (await res.text()));
}

const s2l = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const l2s = (v: number) => { v = Math.min(1, Math.max(0, v)); return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255; };

/** 用近似运行时的光照把烘焙结果合成一张预览图 */
function preview(results: FrameResult[], cols: number, zoom: number): { data: Uint8ClampedArray; w: number; h: number } {
  let up = 0, dn = 0, lf = 0, rt = 0;
  for (const r of results) {
    lf = Math.max(lf, r.ax); rt = Math.max(rt, r.w - r.ax);
    up = Math.max(up, r.ay); dn = Math.max(dn, r.h - r.ay);
    if (r.shadow) {
      const s = r.shadow, k = 1 / SHADOW_SCALE;
      lf = Math.max(lf, s.ax * k); rt = Math.max(rt, (s.w - s.ax) * k);
      up = Math.max(up, s.ay * k); dn = Math.max(dn, (s.h - s.ay) * k);
    }
  }
  const cw = Math.ceil(lf + rt) + 6, ch = Math.ceil(up + dn) + 6;
  cols = Math.min(cols, results.length);
  const rows = Math.ceil(results.length / cols);
  const W = cw * cols, H = ch * rows;
  const lin = new Float32Array(W * H * 3);
  const amb = [0.36, 0.42, 0.52], sun = [1.35, 1.2, 0.98];
  const bg = [s2l(96), s2l(112), s2l(70)];
  const shS = new Float32Array(W * H), shA = new Float32Array(W * H);
  results.forEach((r, i) => {
    const ox = (i % cols) * cw + Math.ceil(lf) + 3, oy = Math.floor(i / cols) * ch + Math.ceil(up) + 3;
    if (r.shadow) {
      const s = r.shadow, k = 1 / SHADOW_SCALE;
      for (let y = 0; y < s.h * k; y++) {
        for (let x = 0; x < s.w * k; x++) {
          const sx = Math.min(s.w - 1, Math.floor(x / k)), sy = Math.min(s.h - 1, Math.floor(y / k));
          const px = ox - s.ax * k + x, py = oy - s.ay * k + y;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const p = (sy * s.w + sx) * 4;
          shS[py * W + px] = Math.max(shS[py * W + px], s.data[p] / 255);
          shA[py * W + px] = Math.max(shA[py * W + px], s.data[p + 1] / 255);
        }
      }
    }
  });
  for (let i = 0; i < W * H; i++) {
    const s = 1 - shS[i] * 0.85, a = 1 - shA[i] * 0.75;
    for (let c = 0; c < 3; c++) lin[i * 3 + c] = bg[c] * (amb[c] * a + sun[c] * SUN_DIR[1] * s * a);
  }
  results.forEach((r, i) => {
    const ox = (i % cols) * cw + Math.ceil(lf) + 3, oy = Math.floor(i / cols) * ch + Math.ceil(up) + 3;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const p = (y * r.w + x) * 4;
        const a = r.color[p + 3] / 255;
        if (a <= 0) continue;
        const px = ox - r.ax + x, py = oy - r.ay + y;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const nx = r.normal[p] / 127.5 - 1, ny = r.normal[p + 1] / 127.5 - 1;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const wx = nx, wy = ny * COS + nz * SIN, wz = -ny * SIN + nz * COS;
        const ndl = Math.max(0, wx * SUN_DIR[0] + wy * SUN_DIR[1] + wz * SUN_DIR[2]);
        // 高光：视线方向 V = (0, SIN, COS)
        const gloss = 1 - r.normal[p + 3] / 255;
        let hx = SUN_DIR[0], hy = SUN_DIR[1] + SIN, hz = SUN_DIR[2] + COS;
        const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
        const ndh = Math.max(0, wx * hx + wy * hy + wz * hz);
        const spec = Math.pow(ndh, 8 + gloss * gloss * 160) * gloss * (0.25 + gloss * 1.6);
        const rim = Math.pow(1 - Math.max(0, wy * SIN + wz * COS), 3) * (0.1 + gloss * 0.5);
        const o = (py * W + px) * 3;
        for (let c = 0; c < 3; c++) {
          // 颜色为预乘
          const v = s2l(r.color[p + c]) * (amb[c] + sun[c] * ndl) + (sun[c] * spec + amb[c] * rim) * a;
          lin[o + c] = lin[o + c] * (1 - a) + v;
        }
      }
    }
  });
  const Z = zoom;
  const out = new Uint8ClampedArray(W * Z * H * Z * 4);
  for (let y = 0; y < H * Z; y++) {
    for (let x = 0; x < W * Z; x++) {
      const s = (Math.floor(y / Z) * W + Math.floor(x / Z)) * 3, o = (y * W * Z + x) * 4;
      out[o] = l2s(lin[s]); out[o + 1] = l2s(lin[s + 1]); out[o + 2] = l2s(lin[s + 2]); out[o + 3] = 255;
    }
  }
  return { data: out, w: W * Z, h: H * Z };
}

async function run() {
  const q = new URLSearchParams(location.search);
  const name = q.get('job') ?? '';
  const make = JOBS[name];
  if (!make) throw new Error('未知的烘焙任务: ' + name + '，可选: ' + Object.keys(JOBS).join(', '));
  const filter = q.get('filter') ? new RegExp(q.get('filter')!) : null;
  const isPreview = q.get('preview') === '1';
  const t0 = performance.now();
  const job = make();
  if (q.get('ppu')) job.ppu = +q.get('ppu')!;
  const baker = new Baker(job.aoSamples ?? 28, job.shadowRes ?? 1024);
  baker.hScale = job.hScale;
  if (job.custom) {
    await job.custom({ baker, save, preview: isPreview, query: q });
    console.log(`  ${name}: 用时 ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }
  const results: FrameResult[] = [];
  const info: Record<string, any> = { ...(job.info ?? {}) };
  let count = 0;
  const total = job.items.reduce((s, it) => s + it.frames.filter((f) => !filter || filter.test(f.key)).length, 0);
  for (const item of job.items) {
    for (const fr of item.frames) {
      if (filter && !filter.test(fr.key)) continue;
      const r = baker.bakeFrame(item, fr, job.ppu, job.ss);
      if (r) results.push(r);
      if (item.info) info[fr.key] = item.info;
      if (++count % 40 === 0) {
        console.log(`  ${name}: ${count}/${total}`);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    baker.scene.remove(item.root);
  }
  if (isPreview) {
    const p = preview(results, +(q.get('cols') ?? 8), +(q.get('zoom') ?? 1));
    await save(`preview/${q.get('as') ?? name}.png`, p.data, p.w, p.h);
  } else {
    const packed = packAtlas(results);
    const meta: AtlasMeta = {
      name: job.name, ppu: job.ppu, size: packed.size, hScale: job.hScale,
      frames: packed.frames, anims: job.anims, info,
    };
    await save(`${job.name}.color.webp`, packed.color, packed.size[0], packed.size[1]);
    await save(`${job.name}.normal.webp`, packed.normal, packed.size[0], packed.size[1]);
    if (packed.shadow) {
      meta.shadowSize = packed.shadowSize;
      meta.shadowPpu = job.ppu * SHADOW_SCALE;
      await save(`${job.name}.shadow.webp`, packed.shadow, packed.shadowSize![0], packed.shadowSize![1], true);
    }
    await save(`${job.name}.json`, JSON.stringify(meta));
    console.log(`  ${name}: 图集 ${packed.size.join('×')}，${results.length} 帧`);
  }
  console.log(`  ${name}: 用时 ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

run().then(() => { window.__done = true; }).catch((e) => {
  console.error(e);
  window.__error = String(e?.stack ?? e);
});
