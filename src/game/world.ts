import type { Renderer } from '../engine/renderer';
import type { Placement } from '../engine/statics';

export interface MapData {
  name: string; w: number; h: number; cell: number; gw: number; gh: number; grid: string;
  spawn: { x: number; z: number };
  objects: { a: string; k: string; x: number; z: number; s?: number; f?: boolean }[];
  gather: { k: string; item: string; x: number; z: number }[];
  spawns: { mob: string; x: number; z: number; r: number; n: number }[];
  npcs: { id: string; x: number; z: number; dir: number }[];
  zones: { name: string; x0: number; z0: number; x1: number; z1: number; mood: string }[];
}

export interface StaticLight {
  id: string; x: number; y: number; z: number; r: number; c: [number, number, number];
  flicker: number; night: boolean; phase: number;
  /** 明火（篝火、火盆、炉火）：火光跳动更大 */
  fire?: boolean;
}
export interface Deck { x0: number; x1: number; z0: number; z1: number; rise: number }

/** 位置决定的伪随机数（0..1）：给树木花草一个固定的朝向 */
const hash = (x: number, z: number) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };

export class World {
  w: number; h: number; cell: number; gw: number; gh: number;
  grid: Uint8Array;
  lights: StaticLight[] = [];
  decks: Deck[] = [];
  fires: { x: number; y: number; z: number; big: boolean; k: number }[] = [];
  trees: { x: number; z: number; kind: string }[] = [];
  /** 交给渲染层摆放的静态物件 */
  placements: Placement[] = [];

  /** infos：物件 key → 建模时给出的附加信息（碰撞、灯光、桥面等） */
  constructor(public map: MapData, infos: Record<string, Record<string, any>>) {
    this.w = map.w; this.h = map.h; this.cell = map.cell; this.gw = map.gw; this.gh = map.gh;
    this.grid = new Uint8Array(this.gw * this.gh);
    const bits = Uint8Array.from(atob(map.grid), (c) => c.charCodeAt(0));
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = (bits[i >> 3] >> (i & 7)) & 1;
    const missing = new Set<string>();
    const clear: Deck[] = [];
    let seq = 0;
    for (const o of map.objects) {
      const info = infos[o.k];
      if (!info) { missing.add(o.k); continue; }
      const s = o.s ?? 1, flip = !!o.f;
      // 树木花草绕竖轴随机转一个角度，打破「同一棵树到处都是」的重复感；建筑与道具保持原样
      const free = info.kind === 'tree' || info.kind === 'bush' || info.kind === 'plant';
      this.placements.push({ key: o.k, x: o.x, z: o.z, s, flip, yaw: free && !o.k.startsWith('log') ? hash(o.x, o.z) * Math.PI * 2 : 0 });
      const mx = flip ? -1 : 1;
      for (const r of (info.solid ?? []) as number[][]) {
        const xa = o.x + r[0] * s * mx, xb = o.x + r[2] * s * mx;
        this.stamp(Math.min(xa, xb), o.z + r[1] * s, Math.max(xa, xb), o.z + r[3] * s, 1);
      }
      for (const l of (info.lights ?? []) as any[]) {
        this.lights.push({
          id: 'w' + seq++, x: o.x + l.p[0] * s * mx, y: l.p[1] * s, z: o.z + l.p[2] * s, r: l.r, c: l.c,
          flicker: l.flicker ?? 0, night: !!l.night, phase: Math.random() * 100,
        });
      }
      if (info.deck) {
        const d = info.deck;
        const deck = { x0: o.x + d.x0, x1: o.x + d.x1, z0: o.z + d.z0, z1: o.z + d.z1, rise: d.rise };
        this.decks.push(deck);
        clear.push(deck);
      }
      for (const f of (info.fires ?? []) as number[][]) this.fires.push({ x: o.x + f[0] * s * mx, y: f[1] * s, z: o.z + f[2] * s, big: (f[3] ?? 1) >= 0.8, k: f[3] ?? 1 });
      if (info.walk) clear.push({ x0: o.x + info.walk[0], z0: o.z + info.walk[1], x1: o.x + info.walk[2], z1: o.z + info.walk[3], rise: 0 });
      if (info.kind === 'tree') this.trees.push({ x: o.x, z: o.z, kind: o.k });
    }
    // 桥面可通行（盖过水面），随后把栏杆等实体重新压上
    for (const d of clear) this.stamp(d.x0, d.z0, d.x1, d.z1, 0, 0);
    for (const o of map.objects) {
      const info = infos[o.k];
      if (!info?.deck) continue;
      for (const r of (info.solid ?? []) as number[][]) this.stamp(o.x + r[0], o.z + r[1], o.x + r[2], o.z + r[3], 1, 0);
    }
    if (missing.size) console.warn('地图引用了缺失的模型:', [...missing].join(', '));
  }

  private stamp(x0: number, z0: number, x1: number, z1: number, v: number, pad = 0.28) {
    const i0 = Math.max(0, Math.floor((x0 - pad) / this.cell)), i1 = Math.min(this.gw - 1, Math.floor((x1 + pad) / this.cell));
    const j0 = Math.max(0, Math.floor((z0 - pad) / this.cell)), j1 = Math.min(this.gh - 1, Math.floor((z1 + pad) / this.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * this.gw + i] = v;
  }

  blocked(x: number, z: number): boolean {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return true;
    return this.grid[j * this.gw + i] === 1;
  }

  /** 两点间直线是否畅通 */
  clear(x0: number, z0: number, x1: number, z1: number): boolean {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (this.blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  /** 桥面等抬高的可行走面的高度 */
  elevation(x: number, z: number): number {
    for (const d of this.decks) {
      if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) {
        const u = ((x - d.x0) / (d.x1 - d.x0)) * 2 - 1;
        return d.rise * (1 - u * u);
      }
    }
    return 0;
  }

  nearestFree(x: number, z: number, maxR = 6): [number, number] {
    if (!this.blocked(x, z)) return [x, z];
    for (let r = this.cell; r <= maxR; r += this.cell) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r, pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (!this.blocked(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }

  // ---------------- A* ----------------
  private gScore = new Float32Array(0);
  private came = new Int32Array(0);
  private stampId = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private runId = 0;

  findPath(sx: number, sz: number, tx: number, tz: number, maxNodes = 9000): [number, number][] | null {
    const { gw, gh, cell, grid } = this;
    [tx, tz] = this.nearestFree(tx, tz);
    if (this.clear(sx, sz, tx, tz)) return [[tx, tz]];
    const N = gw * gh;
    if (this.gScore.length !== N) {
      this.gScore = new Float32Array(N); this.came = new Int32Array(N); this.stampId = new Uint32Array(N); this.closed = new Uint32Array(N);
    }
    const run = ++this.runId;
    const si = Math.floor(sx / cell), sj = Math.floor(sz / cell), ti = Math.floor(tx / cell), tj = Math.floor(tz / cell);
    if (si < 0 || sj < 0 || si >= gw || sj >= gh) return null;
    const start = sj * gw + si, goal = tj * gw + ti;
    const heap: number[] = [], heapF: number[] = [];
    const push = (n: number, f: number) => {
      let i = heap.length; heap.push(n); heapF.push(f);
      while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= f) break; heap[i] = heap[p]; heapF[i] = heapF[p]; i = p; }
      heap[i] = n; heapF[i] = f;
    };
    const pop = () => {
      const top = heap[0], n = heap.pop()!, f = heapF.pop()!;
      if (heap.length) {
        let i = 0; const len = heap.length;
        for (;;) {
          let c = i * 2 + 1; if (c >= len) break;
          if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
          if (heapF[c] >= f) break;
          heap[i] = heap[c]; heapF[i] = heapF[c]; i = c;
        }
        heap[i] = n; heapF[i] = f;
      }
      return top;
    };
    const hF = (i: number, j: number) => { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    this.gScore[start] = 0; this.stampId[start] = run; this.came[start] = -1;
    push(start, hF(si, sj));
    let found = -1, expanded = 0, best = start, bestH = hF(si, sj);
    while (heap.length) {
      const cur = pop();
      if (this.closed[cur] === run) continue;
      this.closed[cur] = run;
      if (cur === goal) { found = cur; break; }
      if (++expanded > maxNodes) break;
      const ci = cur % gw, cj = (cur / gw) | 0;
      const h = hF(ci, cj);
      if (h < bestH) { bestH = h; best = cur; }
      for (let d = 0; d < 8; d++) {
        const di = [1, -1, 0, 0, 1, 1, -1, -1][d], dj = [0, 0, 1, -1, 1, -1, 1, -1][d];
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const nn = nj * gw + ni;
        if (grid[nn] === 1 && nn !== goal) continue;
        if (d >= 4 && (grid[cj * gw + ni] === 1 || grid[nj * gw + ci] === 1)) continue;
        const g = this.gScore[cur] + (d >= 4 ? 1.4142 : 1);
        if (this.stampId[nn] === run && g >= this.gScore[nn]) continue;
        this.gScore[nn] = g; this.stampId[nn] = run; this.came[nn] = cur;
        push(nn, g + hF(ni, nj));
      }
    }
    const end = found >= 0 ? found : best;
    if (end === start) return null;
    const pts: [number, number][] = [];
    for (let n = end; n !== -1 && n !== start; n = this.came[n]) pts.push([((n % gw) + 0.5) * cell, (((n / gw) | 0) + 0.5) * cell]);
    pts.reverse();
    if (found >= 0) pts[pts.length - 1] = [tx, tz];
    // 视线拉直
    const out: [number, number][] = [];
    let cx = sx, cz = sz, i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 40);
      while (j > i && !this.clear(cx, cz, pts[j][0], pts[j][1])) j--;
      out.push(pts[j]);
      [cx, cz] = pts[j];
      i = j + 1;
    }
    return out;
  }

  /** 提交视野附近的灯火 */
  submitLights(r: Renderer, night: number, time: number) {
    for (const l of this.lights) {
      const k0 = l.night ? night : 1;
      if (k0 < 0.02) continue;
      const f = l.flicker ? 1 - l.flicker * (0.5 + 0.3 * Math.sin(time * 9 + l.phase) + 0.2 * Math.sin(time * 23.7 + l.phase * 1.7)) : 1;
      r.light(l.id, l.x, l.y, l.z, l.r * 2.4, l.c, k0 * f, true);
    }
  }
}
