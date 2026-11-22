import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR } from '../../../../src/shared/consts';
import type { Baker } from '../core';
import { canvasTex, Col, fbm, rng } from '../geo';
import type { CustomCtx } from '../jobs';
import { fbm3, jitter, LeafBuilder, merge, Palette, pick, Rand, randDir, rr, SHAPES, StripBuilder, tint, tubeGeo, UP, V3, v3, vcMat } from './flora';

/** 地表平铺贴图：边长（米）与像素 */
const T = 4;
const PX = 512;
const K_FLOOR = 0.3;
const C = (c: Col) => new THREE.Color(c as any);

/** 以 T 为周期的噪声（世界坐标 → 周期晶格） */
const pn = (x: number, z: number, periods: number, oct = 4, seed = 1) => fbm((x / T) * periods, (z / T) * periods, periods, oct, seed);

// ---------- 通用部件 ----------
/** 起伏的基底平面，覆盖 [0,T)²，顶点色与高度都按周期噪声生成 */
function basePlane(height: (x: number, z: number) => number, color: (x: number, z: number, h: number) => THREE.Color, res = 200, mat?: THREE.Material): THREE.Mesh {
  const g = new THREE.PlaneGeometry(T, T, res, res).rotateX(-Math.PI / 2).translate(T / 2, 0, T / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    // 边界顶点坐标取模，保证两侧完全一致
    const x = p.getX(i), z = p.getZ(i);
    const xm = ((x % T) + T) % T, zm = ((z % T) + T) % T;
    const h = height(xm, zm);
    p.setY(i, h);
    const c = color(xm, zm, h);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    uv.setXY(i, x / T, z / T);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  // 边界法线：把对边的法线取平均，消除接缝处的光照跳变
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const W = res + 1;
  const avg = (a: number, b: number) => {
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  };
  for (let i = 0; i < W; i++) { avg(i, res * W + i); avg(i * W, i * W + res); }
  return new THREE.Mesh(g, mat ?? vcMat());
}

/** 把 [0,T)² 的内容复制到 3×3 邻格，得到严格周期的场景 */
function tile9(content: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = dx === 0 && dz === 0 ? content : content.clone(true);
    c.position.set(dx * T, 0, dz * T);
    g.add(c);
  }
  return g;
}

function pebbleGeos(seed: number, n = 4, detail = 2): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const q = v3();
    for (let i = 0; i < p.count; i++) {
      q.fromBufferAttribute(p, i);
      q.multiplyScalar(0.78 + 0.44 * fbm3(q.x * 1.6 + k * 9, q.y * 1.6, q.z * 1.6, 3, seed + k));
      p.setXYZ(i, q.x, q.y, q.z);
    }
    g.computeVertexNormals();
    out.push(g);
  }
  return out;
}

interface Inst { x: number; z: number; y: number; sx: number; sy: number; sz: number; yaw: number; tiltX?: number; tiltZ?: number; c: THREE.Color; }

function instanced(geo: THREE.BufferGeometry, list: Inst[], mat?: THREE.Material): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat ?? new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: !!geo.getAttribute('color') }), list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach((it, i) => {
    e.set(it.tiltX ?? 0, it.yaw, it.tiltZ ?? 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(v3(it.x, it.y, it.z), q, v3(it.sx, it.sy, it.sz));
    im.setMatrixAt(i, m);
    im.setColorAt(i, it.c);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.frustumCulled = false;
  return im;
}

function scatterPebbles(r: Rand, n: number, size: [number, number], pal: Palette, hAt: (x: number, z: number) => number, flat = 0.6, sink = 0.35): Inst[] {
  const out: Inst[] = [];
  for (let i = 0; i < n; i++) {
    const x = r() * T, z = r() * T;
    const s = size[0] + (size[1] - size[0]) * Math.pow(r(), 2.2);
    const sy = s * flat * rr(r, 0.7, 1.15);
    out.push({
      x, z, y: hAt(x, z) + sy * (1 - sink * 2) * 0.5, sx: s * rr(r, 0.75, 1.25), sy, sz: s * rr(r, 0.75, 1.25),
      yaw: r() * Math.PI * 2, tiltX: rr(r, -0.25, 0.25), tiltZ: rr(r, -0.25, 0.25), c: jitter(pick(pal, r), r, 0.12, 0.01, 0.04),
    });
  }
  return out;
}

function bladeGeo(bend: number, width = 0.16): THREE.BufferGeometry {
  const sb = new StripBuilder();
  const shade = v3(0.3, 0.95, 0).normalize();
  sb.blade(v3(), v3(1, 0, 0), 1, width, bend, shade, C('#8c8c8c'), C('#ffffff'), 4, 0.15);
  return sb.geometry();
}

// ---------- 草地 ----------
function grassTile(): THREE.Object3D {
  const r = rng(9001);
  const g = new THREE.Group();
  const hAt = (x: number, z: number) => 0.02 + 0.03 * pn(x, z, 4, 3, 5);
  g.add(basePlane(hAt, (x, z) => {
    const n = pn(x, z, 8, 4, 7);
    return C('#3c3d22').lerp(C('#52502c'), n);
  }, 120));
  const pal: Palette = [['#4c7e30', 4], ['#5f9238', 3.2], ['#3d6c2a', 2.6], ['#74a042', 1.6], ['#8aa848', 0.6]];
  const dry = C('#9aa04a'), lush = C('#3a6e2c');
  const lists: Inst[][] = [[], [], []];
  const cell = 0.0205;
  const nx = Math.round(T / cell);
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ((i + r()) / nx) * T, z = ((j + r()) / nx) * T;
      const patch = pn(x, z, 3, 3, 11), tone = pn(x, z, 5, 3, 13), fine = pn(x, z, 16, 2, 17);
      const h = (0.065 + 0.085 * r()) * (0.7 + 0.75 * patch) * (0.85 + 0.3 * fine);
      const c = jitter(pick(pal, r), r, 0.13, 0.012, 0.05);
      if (tone > 0.56) c.lerp(dry, Math.min(1, (tone - 0.56) * 4) * 0.45);
      else if (tone < 0.42) c.lerp(lush, Math.min(1, (0.42 - tone) * 4) * 0.45);
      const k = r() < 0.4 ? 0 : r() < 0.6 ? 1 : 2;
      lists[k].push({ x, z, y: hAt(x, z) - 0.004, sx: h, sy: h, sz: h, yaw: r() * Math.PI * 2, tiltX: rr(r, -0.25, 0.25), tiltZ: rr(r, -0.25, 0.25), c });
    }
  }
  [0.45, 0.9, 1.5].forEach((b, k) => g.add(instanced(bladeGeo(b), lists[k])));
  // 贴地的小圆叶（三叶草之类）与零星小花
  const lb = new LeafBuilder();
  const clover: Palette = [['#3f7a34', 3], ['#56903c', 2], ['#2f6a30', 2]];
  for (let i = 0; i < 520; i++) {
    const x = r() * T, z = r() * T;
    if (pn(x, z, 6, 2, 23) < 0.5) continue;
    const y = hAt(x, z) + rr(r, 0.03, 0.07);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + r();
      lb.add(SHAPES.round, v3(x, y, z), v3(Math.cos(a), 0.1, Math.sin(a)).normalize(), UP, rr(r, 0.022, 0.034), UP, jitter(pick(clover, r), r, 0.12), 0.25, 0.2);
    }
  }
  for (let i = 0; i < 46; i++) {
    const x = r() * T, z = r() * T, y = hAt(x, z) + rr(r, 0.07, 0.11);
    const white = r() < 0.6;
    lb.add(SHAPES.flower, v3(x, y, z), randDir(r), UP, rr(r, 0.022, 0.032), UP, white ? C('#f1eedf') : C('#f0d04a'), 0.3);
  }
  g.add(lb.build());
  return g;
}

// ---------- 土路 ----------
function dirtTile(): THREE.Object3D {
  const r = rng(9101);
  const g = new THREE.Group();
  const hAt = (x: number, z: number) => {
    // 纵向（沿 X）的浅车辙 + 起伏
    const rut = Math.pow(Math.abs(Math.sin(((z / T) * 2 + pn(x, z, 2, 2, 31) * 1.1) * Math.PI)), 3);
    return 0.03 + 0.03 * pn(x, z, 5, 4, 33) + 0.014 * pn(x, z, 20, 2, 35) - 0.007 * rut * pn(x, z, 3, 2, 37);
  };
  const bump = canvasTex('dirt_bump', 256, (u, v) => { const k = fbm(u * 40, v * 40, 40, 3, 61); return [k, k, k]; }, false);
  bump.repeat.set(3, 3);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, bumpMap: bump, bumpScale: 1.2 });
  g.add(basePlane(hAt, (x, z, h) => {
    const n = pn(x, z, 6, 4, 41), n2 = pn(x, z, 28, 2, 43);
    const n3 = pn(x, z, 3, 3, 45);
    const c = C('#86705a').lerp(C('#a08b72'), n).lerp(C('#63523f'), Math.max(0, 0.5 - n3) * 1.3);
    // 细颗粒 + 低洼处略暗
    c.multiplyScalar(0.84 + 0.28 * n2 + Math.min(0.06, Math.max(-0.06, (h - 0.05) * 2)));
    return c;
  }, 220, mat));
  const pg = pebbleGeos(51);
  const pal: Palette = [['#8a8072', 3], ['#9a8e7a', 3], ['#746c62', 2], ['#a39680', 1.5], ['#665848', 2]];
  const lists: Inst[][] = pg.map(() => []);
  // 碎石成片：有的地方密，有的地方几乎没有
  for (const it of scatterPebbles(r, 1500, [0.005, 0.024], pal, hAt, 0.6, 0.3)) if (pn(it.x, it.z, 4, 3, 53) > 0.47) lists[Math.floor(r() * pg.length)].push(it);
  for (const it of scatterPebbles(r, 46, [0.028, 0.055], pal, hAt, 0.5, 0.38)) if (pn(it.x, it.z, 4, 3, 53) > 0.5) lists[Math.floor(r() * pg.length)].push(it);
  pg.forEach((geo, i) => g.add(instanced(geo, lists[i])));
  // 枯草屑、细枝、路面上冒出的零星草
  const lb = new LeafBuilder();
  const litter: Palette = [['#8a7040', 3], ['#a08a52', 2], ['#6e5a36', 2]];
  for (let i = 0; i < 150; i++) {
    const x = r() * T, z = r() * T;
    const nh = v3(rr(r, -0.25, 0.25), 1, rr(r, -0.25, 0.25)).normalize();
    lb.add(r() < 0.5 ? SHAPES.lance : SHAPES.oval, v3(x, hAt(x, z) + 0.006, z), v3(Math.cos(i), 0, Math.sin(i)), nh, rr(r, 0.03, 0.07), nh, jitter(pick(litter, r), r, 0.12), 0.2, 0.2, 1.4);
  }
  g.add(lb.build());
  const twigs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const x = r() * T, z = r() * T, a = r() * Math.PI * 2, l = rr(r, 0.06, 0.2), y = hAt(x, z) + 0.006;
    const t = tubeGeo([v3(x, y, z), v3(x + Math.cos(a) * l * 0.5, y + 0.004, z + Math.sin(a) * l * 0.5 + 0.01), v3(x + Math.cos(a) * l, y, z + Math.sin(a) * l)], [0.004, 0.0035, 0.0025], 5, 1, 1).toNonIndexed();
    t.deleteAttribute('uv');
    twigs.push(tint(t, jitter(C('#5c4630'), r, 0.12)));
  }
  g.add(new THREE.Mesh(merge(twigs), vcMat()));
  const sb = new StripBuilder();
  const gp: Palette = [['#6f8a3a', 3], ['#8a9a44', 2], ['#a39a4c', 1.5]];
  for (let c = 0; c < 9; c++) {
    const cx = r() * T, cz = r() * T;
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.07;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const cb = jitter(pick(gp, r), r, 0.12);
      sb.blade(v3(x, hAt(((x % T) + T) % T, ((z % T) + T) % T), z), v3(Math.cos(a), 0, Math.sin(a)), rr(r, 0.05, 0.11), 0.012, rr(r, 0.5, 1.4), v3(0, 1, 0), cb.clone().multiplyScalar(0.65), cb, 4, 0.15);
    }
  }
  g.add(sb.build());
  return g;
}

// ---------- 石板 ----------
interface Slab { cx: number; cz: number; w: number; d: number; }
function slabLayout(r: Rand): Slab[] {
  const rows = [0.56, 0.44, 0.6, 0.48, 0.42, 0.58, 0.44, 0.48];
  const out: Slab[] = [];
  let z = 0;
  for (const d of rows) {
    // 把一行切成若干块，宽度和恰为 T
    const ws: number[] = [];
    let left = T;
    while (left > 1.25) { const w = rr(r, 0.55, 1.0); ws.push(w); left -= w; }
    if (left < 0.5) ws[ws.length - 1] += left; else ws.push(left);
    let x = r() * T;
    for (const w of ws) { out.push({ cx: (x + w / 2) % T, cz: z + d / 2, w, d }); x += w; }
    z += d;
  }
  return out;
}

function slabGeo(r: Rand, w: number, d: number, thick: number, seed: number): THREE.BufferGeometry {
  const gap = 0.018;
  const a = (w - gap) / 2, b = (d - gap) / 2;
  const S = 72, K = 18;
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const baseC = jitter(pick([['#8a8d8c', 3], ['#93948f', 2.5], ['#7c7f80', 2], ['#9a9890', 1.2], ['#858980', 1]], r), r, 0.07, 0.008, 0.02);
  const dirt = C('#5a5040');
  const p = 16;
  // 四角各自的缺损程度
  const chip = [0, 1, 2, 3].map(() => (r() < 0.22 ? rr(r, 0.04, 0.1) : rr(r, 0, 0.02)));
  const tiltX = rr(r, -0.012, 0.012), tiltZ = rr(r, -0.012, 0.012);
  const c = new THREE.Color();
  for (let k = 0; k <= K + 1; k++) {
    for (let s = 0; s <= S; s++) {
      const th = (s / S) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th);
      let R = 1 / Math.pow(Math.pow(Math.abs(cs) / a, p) + Math.pow(Math.abs(sn) / b, p), 1 / p);
      // 角部缺损与边缘不平
      const quad = (cs >= 0 ? 0 : 1) + (sn >= 0 ? 0 : 2);
      const corner = Math.pow(Math.abs(Math.sin(th * 2)), 4);
      R *= 1 - chip[quad] * corner - 0.012 * (fbm(s * 0.6 + seed, 0, 64, 2, seed) - 0.5) * 2;
      // 环：0..K 是顶面与圆角，K+1 是垂直侧壁
      // 内圈均匀加密（让顶面的磨损噪声采样足够细），最外几圈收成圆角
      const rho = k <= K ? (k <= K - 4 ? (k / (K - 4)) * 0.94 : [0.962, 0.98, 0.993, 1][k - (K - 3)]) : 1;
      const x = cs * R * rho, z = sn * R * rho;
      const edge = Math.max(0, (rho - 0.94) / 0.06);
      let y = k <= K ? thick - 0.011 * (1 - Math.sqrt(Math.max(0, 1 - edge * edge))) : -0.01;
      const wear = fbm3(x * 5 + seed, 0, z * 5, 3, seed) - 0.5;
      if (k <= K) y += wear * 0.005 + x * tiltX + z * tiltZ;
      pos.push(x, y, z);
      const pit = fbm3(x * 16 + seed, 1, z * 16, 2, seed + 3);
      const mott = fbm3(x * 2.2 + seed * 3, 2, z * 2.2, 3, seed + 7);
      c.copy(baseC).multiplyScalar(0.86 + 0.16 * (wear + 0.5) + 0.14 * mott + (pit < 0.3 ? -0.08 : 0));
      c.lerp(dirt, Math.min(1, edge * 0.45 + (k > K ? 0.6 : 0)));
      col.push(c.r, c.g, c.b);
      uv.push(x * 1.4 + seed, z * 1.4);
    }
  }
  const W = S + 1;
  for (let k = 0; k <= K; k++) for (let s = 0; s < S; s++) {
    const i0 = k * W + s, i1 = i0 + 1, j0 = i0 + W, j1 = j0 + 1;
    idx.push(i0, j1, j0, i0, i1, j1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function stoneTile(): THREE.Object3D {
  const r = rng(9201);
  const g = new THREE.Group();
  const hAt = (x: number, z: number) => 0.012 + 0.012 * pn(x, z, 10, 3, 71);
  g.add(basePlane(hAt, (x, z) => C('#3f382c').lerp(C('#5a4f3c'), pn(x, z, 12, 3, 73)), 100));
  const bump = canvasTex('slab_bump', 256, (u, v) => {
    const k = 0.5 + 0.35 * (fbm(u * 10, v * 10, 10, 4, 81) - 0.5) - (fbm(u * 34, v * 34, 34, 2, 83) < 0.3 ? 0.25 : 0);
    return [k, k, k];
  }, false);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, bumpMap: bump, bumpScale: 1.6 });
  const slabs = slabLayout(r);
  slabs.forEach((s, i) => {
    const geo = slabGeo(r, s.w, s.d, rr(r, 0.05, 0.062), 100 + i * 3);
    // 跨越左右边界的石板在两侧各放一块
    for (const dx of [-T, 0, T]) {
      const cx = s.cx + dx;
      if (cx + s.w / 2 < 0 || cx - s.w / 2 > T) continue;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cx, 0, s.cz);
      g.add(m);
    }
  });
  // 石缝里的苔与小草：只保留落在缝隙附近的点
  const inGap = (x: number, z: number) => {
    for (const s of slabs) {
      for (const dx of [-T, 0, T]) {
        const ux = Math.abs(x - s.cx - dx) / (s.w / 2), uz = Math.abs(z - s.cz) / (s.d / 2);
        if (ux < 0.95 && uz < 0.93) return false;
      }
    }
    return true;
  };
  const lb = new LeafBuilder();
  const moss: Palette = [['#566f34', 3], ['#68803a', 2.5], ['#48602c', 2], ['#7c8a44', 1]];
  let placed = 0;
  for (let i = 0; i < 80000 && placed < 1500; i++) {
    const x = r() * T, z = r() * T;
    if (!inGap(x, z) || pn(x, z, 5, 3, 91) < 0.5) continue;
    placed++;
    const a = r() * Math.PI * 2;
    lb.add(SHAPES.round, v3(x, hAt(x, z) + rr(r, 0.015, 0.04), z), v3(Math.cos(a), 0.1, Math.sin(a)).normalize(), UP, rr(r, 0.012, 0.024), UP, jitter(pick(moss, r), r, 0.14), 0.3, 0.3);
  }
  g.add(lb.build());
  const sb = new StripBuilder();
  const gp: Palette = [['#5f8a36', 3], ['#7a9a42', 2], ['#4c7430', 2]];
  placed = 0;
  for (let i = 0; i < 60000 && placed < 260; i++) {
    const x = r() * T, z = r() * T;
    if (!inGap(x, z) || pn(x, z, 4, 3, 93) < 0.56) continue;
    placed++;
    const a = r() * Math.PI * 2, cb = jitter(pick(gp, r), r, 0.12);
    sb.blade(v3(x, hAt(x, z), z), v3(Math.cos(a), 0, Math.sin(a)), rr(r, 0.05, 0.1), 0.011, rr(r, 0.4, 1.3), v3(0, 1, 0), cb.clone().multiplyScalar(0.6), cb, 4, 0.15);
  }
  g.add(sb.build());
  return g;
}

// ---------- 河滩沙砾 ----------
function sandTile(): THREE.Object3D {
  const r = rng(9301);
  const g = new THREE.Group();
  const hAt = (x: number, z: number) => {
    const ripple = Math.sin(((z / T) * 9 + pn(x, z, 3, 3, 101) * 2.2) * Math.PI * 2);
    return 0.02 + 0.03 * pn(x, z, 4, 3, 103) + 0.004 * ripple * pn(x, z, 2, 2, 105);
  };
  const bump = canvasTex('sand_bump', 256, (u, v) => { const k = fbm(u * 64, v * 64, 64, 2, 111); return [k, k, k]; }, false);
  bump.repeat.set(4, 4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, bumpMap: bump, bumpScale: 0.9 });
  g.add(basePlane(hAt, (x, z, h) => {
    const n = pn(x, z, 6, 4, 113), f = pn(x, z, 40, 2, 115);
    return C('#b8a682').lerp(C('#c9b994'), n).lerp(C('#9c8a6a'), Math.max(0, 0.45 - n)).multiplyScalar(0.86 + 0.26 * f + (h - 0.035) * 1.5);
  }, 220, mat));
  const pg = pebbleGeos(121, 5, 3);
  const pal: Palette = [['#a09a8e', 3], ['#b5ad9c', 2.5], ['#8a857c', 2], ['#c4bba6', 1.2], ['#a58a6c', 1.2], ['#77726c', 0.8], ['#bfa888', 1]];
  const lists: Inst[][] = pg.map(() => []);
  const add = (n: number, size: [number, number], flat: number, sink: number) => {
    for (const it of scatterPebbles(r, n, size, pal, hAt, flat, sink)) {
      // 砾石成片分布
      if (pn(it.x, it.z, 4, 3, 123) < (size[1] < 0.05 ? 0.46 : 0.52)) continue;
      lists[Math.floor(r() * pg.length)].push(it);
    }
  };
  add(2600, [0.005, 0.022], 0.55, 0.3);
  add(120, [0.025, 0.05], 0.45, 0.38);
  pg.forEach((geo, i) => g.add(instanced(geo, lists[i])));
  const sb = new StripBuilder();
  const gp: Palette = [['#9a9a4c', 3], ['#b3a858', 2], ['#7f8a3e', 1.5]];
  for (let c = 0; c < 5; c++) {
    const cx = r() * T, cz = r() * T;
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.06;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, cb = jitter(pick(gp, r), r, 0.12);
      sb.blade(v3(x, hAt(((x % T) + T) % T, ((z % T) + T) % T), z), v3(Math.cos(a), 0, Math.sin(a)), rr(r, 0.05, 0.12), 0.011, rr(r, 0.5, 1.4), v3(0, 1, 0), cb.clone().multiplyScalar(0.65), cb, 4, 0.15);
    }
  }
  g.add(sb.build());
  return g;
}

// ---------- 林地落叶 ----------
function leafTile(): THREE.Object3D {
  const r = rng(9401);
  const g = new THREE.Group();
  const hAt = (x: number, z: number) => 0.03 + 0.04 * pn(x, z, 5, 4, 131) + 0.012 * pn(x, z, 22, 2, 133);
  const bump = canvasTex('humus_bump', 256, (u, v) => { const k = fbm(u * 48, v * 48, 48, 3, 141); return [k, k, k]; }, false);
  bump.repeat.set(3, 3);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, bumpMap: bump, bumpScale: 1.4 });
  g.add(basePlane(hAt, (x, z) => {
    const n = pn(x, z, 7, 4, 143), f = pn(x, z, 30, 2, 145);
    return C('#352a1f').lerp(C('#4c3c2a'), n).multiplyScalar(0.8 + 0.4 * f);
  }, 200, mat));
  const lb = new LeafBuilder();
  const pal: Palette = [['#6e4a2a', 4], ['#7d5830', 3.4], ['#5a3d26', 3], ['#8a6030', 2], ['#6a3622', 1.4], ['#9a7430', 0.7], ['#3e2c1d', 2.6], ['#84502a', 1]];
  const shapes = [SHAPES.maple, SHAPES.maple, SHAPES.oval, SHAPES.oval, SHAPES.oval];
  for (let i = 0; i < 2400; i++) {
    const x = r() * T, z = r() * T;
    // 落叶有厚有薄：稀疏处露出腐殖土
    if (pn(x, z, 5, 3, 151) < 0.3 && r() < 0.75) continue;
    const a = r() * Math.PI * 2;
    const nh = v3(rr(r, -0.35, 0.35), 1, rr(r, -0.35, 0.35)).normalize();
    const sh = shapes[Math.floor(r() * shapes.length)];
    const size = sh === SHAPES.maple ? rr(r, 0.09, 0.15) : rr(r, 0.07, 0.125);
    const shade = v3(nh.x * 0.6, 1, nh.z * 0.6).normalize();
    lb.add(sh, v3(x, hAt(x, z) + rr(r, 0.004, 0.034), z), v3(Math.cos(a), rr(r, -0.1, 0.12), Math.sin(a)).normalize(), nh, size, shade,
      jitter(pick(pal, r), r, 0.18, 0.012, 0.05), rr(r, 0.05, 0.4), rr(r, -0.3, 0.4), sh === SHAPES.oval ? rr(r, 0.9, 1.5) : 1);
  }
  // 小片苔藓
  const moss: Palette = [['#46592c', 3], ['#566a32', 2], ['#3a4c26', 2]];
  for (let c = 0; c < 6; c++) {
    const cx = r() * T, cz = r() * T, rad = rr(r, 0.12, 0.26);
    for (let i = 0; i < 110; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const x = ((cx + Math.cos(a) * d) % T + T) % T, z = ((cz + Math.sin(a) * d) % T + T) % T;
      lb.add(SHAPES.round, v3(x, hAt(x, z) + rr(r, 0.012, 0.03), z), v3(Math.cos(a), 0.1, Math.sin(a)).normalize(), UP, rr(r, 0.016, 0.03), UP, jitter(pick(moss, r), r, 0.14), 0.3, 0.3);
    }
  }
  g.add(lb.build());
  const twigs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 70; i++) {
    const x = r() * T, z = r() * T, a = r() * Math.PI * 2, l = rr(r, 0.1, 0.38), y = hAt(x, z) + rr(r, 0.012, 0.03);
    const bendA = a + rr(r, -0.5, 0.5);
    const t = tubeGeo([v3(x, y, z), v3(x + Math.cos(a) * l * 0.5, y + 0.006, z + Math.sin(a) * l * 0.5), v3(x + Math.cos(a) * l * 0.5 + Math.cos(bendA) * l * 0.5, y, z + Math.sin(a) * l * 0.5 + Math.sin(bendA) * l * 0.5)],
      [0.007, 0.006, 0.004].map((k) => k * rr(r, 0.7, 1.3)), 5, 1, 1).toNonIndexed();
    t.deleteAttribute('uv');
    twigs.push(tint(t, jitter(C('#4c3a2a'), r, 0.14)));
  }
  g.add(new THREE.Mesh(merge(twigs), vcMat()));
  const pg = pebbleGeos(161, 3);
  const lists: Inst[][] = pg.map(() => []);
  for (const it of scatterPebbles(r, 60, [0.012, 0.04], [['#6a665e', 2], ['#57534c', 2], ['#7d776a', 1]], hAt, 0.55, 0.35)) lists[Math.floor(r() * pg.length)].push(it);
  pg.forEach((geo, i) => g.add(instanced(geo, lists[i])));
  return g;
}

// ---------- 烘焙 ----------
interface TileOut { color: Uint8ClampedArray; normal: Uint8ClampedArray; hRange: number; hMin: number; }

const l2s = (v: number) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };

function bakeTile(baker: Baker, content: THREE.Object3D, ss: number): TileOut {
  const root = tile9(content);
  baker.scene.add(root);
  baker.ground.visible = false;
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  root.updateMatrixWorld(true);
  const W = PX * ss;
  baker.setRT(W, W);
  const cam = baker.cam;
  cam.left = -T / 2; cam.right = T / 2; cam.top = T / 2; cam.bottom = -T / 2;
  cam.position.set(T / 2, 60, T / 2);
  cam.up.set(0, 0, -1);
  cam.lookAt(T / 2, 0, T / 2);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  const center = new THREE.Vector3(T / 2, 0, T / 2), radius = T * 0.7072 + 0.9;
  // 贴图里的细节只有厘米级，收紧阴影偏移
  const sh = baker.light.shadow;
  const ob = sh.bias, onb = sh.normalBias;
  sh.bias = -0.00025; sh.normalBias = 0.004;

  const N = baker.aoDirs.length;
  baker.clearAccum();
  baker.amb.intensity = 0;
  baker.light.visible = true;
  for (const d of baker.aoDirs) {
    baker.setLight(d, center, radius, ((1 - K_FLOOR) * 2 * baker.dirI) / N);
    baker.renderPass();
    baker.addToAccum(1, 0);
  }
  baker.light.visible = false;
  baker.amb.intensity = K_FLOOR * baker.ambI;
  baker.renderPass();
  baker.addToAccum(1, 1);
  baker.light.visible = true;
  baker.amb.intensity = 0;
  const col = baker.down(baker.read(baker.rtAccum), W, W, ss);

  const restore = baker.swapMaterials(root, baker.normalMatFor);
  baker.renderPass();
  restore();
  const nrm = baker.down(baker.read(baker.rtPass), W, W, ss);

  baker.heightMat.uniforms.hScale.value = 1;
  baker.scene.overrideMaterial = baker.heightMat;
  baker.renderPass();
  baker.scene.overrideMaterial = null;
  const hgt = baker.down(baker.read(baker.rtPass), W, W, ss);

  sh.bias = ob; sh.normalBias = onb;
  baker.scene.remove(root);

  const n = PX * PX;
  let hMin = Infinity, hMax = -Infinity;
  // 用 1%/99.7% 分位裁掉个别尖刺，避免高度通道被极少数像素压扁
  const hs = new Float32Array(n);
  for (let i = 0; i < n; i++) hs[i] = hgt[i * 4];
  const sorted = Float32Array.from(hs).sort();
  hMin = sorted[Math.floor(n * 0.002)]; hMax = sorted[Math.floor(n * 0.997)];
  const hRange = Math.max(1e-4, hMax - hMin);
  const color = new Uint8ClampedArray(n * 4), normal = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const a = Math.max(1e-4, col[i * 4 + 3]);
    color[i * 4] = Math.round(l2s(col[i * 4] / a) * 255);
    color[i * 4 + 1] = Math.round(l2s(col[i * 4 + 1] / a) * 255);
    color[i * 4 + 2] = Math.round(l2s(col[i * 4 + 2] / a) * 255);
    color[i * 4 + 3] = 255;
    // 俯视相机的视空间：x = 世界 x，y = −世界 z，z = 世界 y
    const na = Math.max(1e-4, nrm[i * 4 + 3]);
    let vx = (nrm[i * 4] / na) * 2 - 1, vy = (nrm[i * 4 + 1] / na) * 2 - 1, vz = (nrm[i * 4 + 2] / na) * 2 - 1;
    const l = Math.hypot(vx, vy, vz) || 1;
    vx /= l; vy /= l; vz /= l;
    if (vz < 0.05) { vz = 0.05; const l2 = Math.hypot(vx, vy, vz); vx /= l2; vy /= l2; }
    normal[i * 4] = Math.round((vx * 0.5 + 0.5) * 255);
    normal[i * 4 + 1] = Math.round((-vy * 0.5 + 0.5) * 255);
    normal[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, (hs[i] - hMin) / hRange)) * 255);
    normal[i * 4 + 3] = 255;
  }
  return { color, normal, hRange, hMin };
}

/** 2×2 平铺 + 简单日光，检查接缝与观感 */
function tilePreview(t: TileOut): Uint8ClampedArray {
  const S = PX * 2;
  const out = new Uint8ClampedArray(S * S * 4);
  const s2l = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const amb = [0.36, 0.42, 0.52], sun = [1.35, 1.2, 0.98];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = ((y % PX) * PX + (x % PX)) * 4, o = (y * S + x) * 4;
    const nx = t.normal[i] / 127.5 - 1, nz = t.normal[i + 1] / 127.5 - 1;
    const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
    const ndl = Math.max(0, nx * SUN_DIR[0] + ny * SUN_DIR[1] + nz * SUN_DIR[2]);
    for (let c = 0; c < 3; c++) out[o + c] = l2s(s2l(t.color[i + c]) * (amb[c] + sun[c] * ndl)) * 255;
    out[o + 3] = 255;
  }
  return out;
}

const TILES: Record<string, () => THREE.Object3D> = {
  grass: grassTile, dirt: dirtTile, stone: stoneTile, sand: sandTile, leaf: leafTile,
};

export async function bakeTiles(ctx: CustomCtx): Promise<void> {
  const only = ctx.query.get('filter') ? new RegExp(ctx.query.get('filter')!) : null;
  const ss = 3;
  const meta: Record<string, any> = { size: T, px: PX, tiles: {} };
  for (const [name, make] of Object.entries(TILES)) {
    if (only && !only.test(name)) continue;
    const t0 = performance.now();
    const out = bakeTile(ctx.baker, make(), ss);
    meta.tiles[name] = { hScale: +out.hRange.toFixed(4) };
    console.log(`  ${name}: 高度范围 ${out.hRange.toFixed(3)} 米，用时 ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    if (ctx.preview) {
      await ctx.save(`preview/tile_${name}.png`, tilePreview(out), PX * 2, PX * 2);
      // 高度通道单独出图
      const h = new Uint8ClampedArray(PX * PX * 4);
      for (let i = 0; i < PX * PX; i++) { h[i * 4] = h[i * 4 + 1] = h[i * 4 + 2] = out.normal[i * 4 + 2]; h[i * 4 + 3] = 255; }
      await ctx.save(`preview/tile_${name}_h.png`, h, PX, PX);
    } else {
      await ctx.save(`../ground/${name}.color.png`, out.color, PX, PX, true);
      await ctx.save(`../ground/${name}.normal.png`, out.normal, PX, PX, true);
    }
    await new Promise((res) => setTimeout(res, 0));
  }
  if (!ctx.preview && !only) await ctx.save('../ground/ground.json', JSON.stringify(meta));
}
