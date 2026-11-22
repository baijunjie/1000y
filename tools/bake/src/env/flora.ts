import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, Col, fbm } from '../geo';

export type V3 = THREE.Vector3;
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const UP = new THREE.Vector3(0, 1, 0);
export type Rand = () => number;
export const rr = (r: Rand, a: number, b: number) => a + (b - a) * r();

// ---------- 3D 值噪声 ----------
function h3(x: number, y: number, z: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function noise3(x: number, y: number, z: number, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi, seed), h3(xi + 1, yi, zi, seed), u), l(h3(xi, yi + 1, zi, seed), h3(xi + 1, yi + 1, zi, seed), u), v),
    l(l(h3(xi, yi, zi + 1, seed), h3(xi + 1, yi, zi + 1, seed), u), l(h3(xi, yi + 1, zi + 1, seed), h3(xi + 1, yi + 1, zi + 1, seed), u), v),
    w,
  );
}
export function fbm3(x: number, y: number, z: number, oct = 4, seed = 1) {
  let s = 0, amp = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    s += noise3(x * f, y * f, z * f, seed + i * 31) * amp;
    tot += amp; amp *= 0.5; f *= 2;
  }
  return s / tot;
}

// ---------- 曲线与管 ----------
export function bezier(p0: V3, p1: V3, p2: V3, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
    out.push(v3(p0.x * a + p1.x * b + p2.x * c, p0.y * a + p1.y * b + p2.y * c, p0.z * a + p1.z * b + p2.z * c));
  }
  return out;
}

/** 沿折线的变半径管，带 UV（u 绕圈，v 沿长度，单位米×vScale） */
export function tubeGeo(pts: V3[], radii: number[], radial = 8, uRep = 2, vScale = 1, capEnd = true): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = pts.length;
  const tan = (i: number) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    return b.clone().sub(a).normalize();
  };
  let t = tan(0);
  let nrm = Math.abs(t.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  nrm.addScaledVector(t, -nrm.dot(t)).normalize();
  let acc = 0;
  for (let i = 0; i < n; i++) {
    t = tan(i);
    nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    const bin = new THREE.Vector3().crossVectors(t, nrm);
    if (i > 0) acc += pts[i].distanceTo(pts[i - 1]);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      const d = nrm.clone().multiplyScalar(dx).addScaledVector(bin, dy);
      pos.push(pts[i].x + d.x * radii[i], pts[i].y + d.y * radii[i], pts[i].z + d.z * radii[i]);
      nor.push(d.x, d.y, d.z);
      uv.push((j / radial) * uRep, acc * vScale);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capEnd) {
    const ci = pos.length / 3;
    const p = pts[n - 1], tt = tan(n - 1);
    pos.push(p.x + tt.x * radii[n - 1] * 0.6, p.y + tt.y * radii[n - 1] * 0.6, p.z + tt.z * radii[n - 1] * 0.6);
    nor.push(tt.x, tt.y, tt.z);
    uv.push(0.5, acc * vScale);
    const base = (n - 1) * ring;
    for (let j = 0; j < radial; j++) idx.push(base + j, base + j + 1, ci);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 1) return geos[0];
  const g = mergeGeometries(geos, false);
  if (!g) throw new Error('mergeGeometries 失败（属性不一致）');
  return g;
}

/** 把几何体中低于地面的顶点压到地面 */
export function clampGround(g: THREE.BufferGeometry, y0 = 0) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < y0) p.setY(i, y0);
  p.needsUpdate = true;
  return g;
}

// ---------- 树皮 ----------
export function barkMat(color: Col, kind: 'rough' | 'plate' | 'smooth' | 'bamboo' = 'rough'): THREE.MeshLambertMaterial {
  const f = (u: number, v: number) => {
    if (kind === 'rough') {
      const a = fbm(u * 16, v * 3, 16, 4, 21), b = fbm(u * 40, v * 10, 40, 2, 5);
      const crack = Math.pow(Math.abs(Math.sin((u * 16 + a * 2.2) * Math.PI)), 0.35);
      return 0.56 + 0.44 * crack * (0.7 + 0.3 * b);
    }
    if (kind === 'plate') {
      const a = fbm(u * 6, v * 4, 6, 3, 9);
      const cx = Math.abs(Math.sin((u * 6 + a * 1.4) * Math.PI)), cy = Math.abs(Math.sin((v * 5 + a * 2.0) * Math.PI));
      return 0.52 + 0.48 * Math.pow(Math.min(cx, cy), 0.3) * (0.8 + 0.2 * fbm(u * 30, v * 30, 30, 2, 3));
    }
    if (kind === 'bamboo') {
      // v 每 1 个周期一个竹节
      const d = Math.min(v, 1 - v);
      const node = Math.exp(-d * d * 2600);
      return 0.72 + 0.1 * fbm(u * 6, v * 2, 6, 2, 4) + 0.22 * node - 0.2 * Math.exp(-Math.pow(d - 0.035, 2) * 4000);
    }
    return 0.75 + 0.2 * fbm(u * 12, v * 4, 12, 3, 7);
  };
  const map = canvasTex('bark_' + kind, 256, (u, v) => { const g = f(u, v); return [g, g, g]; });
  const bump = canvasTex('barkb_' + kind, 256, (u, v) => { const g = f(u, v); return [g, g, g]; }, false);
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color as any), map, bumpMap: bump, bumpScale: kind === 'bamboo' ? 1.2 : 2.5 });
  return m;
}

// ---------- 叶片 ----------
export interface LeafShape { pts: [number, number][]; c: [number, number]; }
function starShape(tips: [number, number][], sinus: number, c: [number, number]): LeafShape {
  // tips: [角度(度), 半径]，相邻 tip 之间插入 sinus 半径的凹点
  const pts: [number, number][] = [];
  for (let i = 0; i < tips.length; i++) {
    const [a, r] = tips[i];
    const [a2] = tips[(i + 1) % tips.length];
    let mid = (a + a2) / 2;
    if (a2 < a) mid += 180;
    pts.push([c[0] + Math.cos((a * Math.PI) / 180) * r, c[1] + Math.sin((a * Math.PI) / 180) * r]);
    pts.push([c[0] + Math.cos((mid * Math.PI) / 180) * sinus, c[1] + Math.sin((mid * Math.PI) / 180) * sinus]);
  }
  return { pts, c };
}
export const SHAPES: Record<string, LeafShape> = {
  oval: { pts: [[0, 0], [0.26, 0.22], [0.33, 0.52], [0.2, 0.84], [0, 1], [-0.2, 0.84], [-0.33, 0.52], [-0.26, 0.22]], c: [0, 0.5] },
  round: { pts: [[0, 0], [0.33, 0.14], [0.47, 0.48], [0.33, 0.84], [0, 1], [-0.33, 0.84], [-0.47, 0.48], [-0.33, 0.14]], c: [0, 0.5] },
  lance: { pts: [[0, 0], [0.085, 0.28], [0.07, 0.64], [0, 1], [-0.07, 0.64], [-0.085, 0.28]], c: [0, 0.45] },
  needle: { pts: [[0, 0], [0.03, 0.3], [0, 1], [-0.03, 0.3]], c: [0, 0.4] },
  maple: starShape([[90, 0.56], [150, 0.5], [200, 0.36], [270, 0.16], [340, 0.36], [30, 0.5]], 0.2, [0, 0.45]),
  tuft: starShape([[10, 0.5], [50, 0.46], [90, 0.5], [130, 0.44], [170, 0.5], [210, 0.46], [250, 0.5], [290, 0.44], [330, 0.5]], 0.17, [0, 0]),
  flower: starShape([[90, 0.5], [162, 0.5], [234, 0.5], [306, 0.5], [18, 0.5]], 0.3, [0, 0]),
};

export class LeafBuilder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; idx: number[] = [];
  count = 0;
  private x = v3(); private y = v3(); private z = v3();
  /**
   * @param origin 叶柄基点
   * @param dir 叶片延伸方向
   * @param up 叶面法线的大致方向
   * @param shade 用于光照的法线（球化法线）
   */
  add(shape: LeafShape, origin: V3, dir: V3, up: V3, size: number, shade: V3, color: THREE.Color, fold = 0, curl = 0, width = 1) {
    const z = this.z.copy(dir).normalize();
    const y = this.y.copy(up).addScaledVector(z, -up.dot(z));
    if (y.lengthSq() < 1e-6) y.set(z.y, z.z, z.x).addScaledVector(z, -(z.y * z.x + z.z * z.y + z.x * z.z));
    y.normalize();
    const x = this.x.crossVectors(y, z);
    const base = this.pos.length / 3;
    const put = (px: number, pz: number, k: number) => {
      const yo = (fold * Math.abs(px) + curl * pz * pz) * size;
      const sx = px * size * width, sz = pz * size;
      this.pos.push(origin.x + x.x * sx + z.x * sz + y.x * yo, origin.y + x.y * sx + z.y * sz + y.y * yo, origin.z + x.z * sx + z.z * sz + y.z * yo);
      this.nor.push(shade.x, shade.y, shade.z);
      this.col.push(color.r * k, color.g * k, color.b * k);
    };
    put(shape.c[0], shape.c[1], 0.92);
    for (const p of shape.pts) put(p[0], p[1], 0.94 + 0.14 * p[1]);
    const n = shape.pts.length;
    for (let i = 0; i < n; i++) {
      const a = base + 1 + i, b = base + 1 + ((i + 1) % n);
      this.idx.push(base, a, b, base, b, a); // 双面（同一法线）
    }
    this.count++;
  }
  build(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return new THREE.Mesh(g, leafMat());
  }
}

let _leafMat: THREE.MeshLambertMaterial | null = null;
export function leafMat() {
  if (!_leafMat) _leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.FrontSide });
  return _leafMat;
}

export type Palette = [Col, number][];
export function pick(pal: Palette, r: Rand): THREE.Color {
  let tot = 0;
  for (const p of pal) tot += p[1];
  let x = r() * tot;
  for (const p of pal) { x -= p[1]; if (x <= 0) return new THREE.Color(p[0] as any); }
  return new THREE.Color(pal[0][0] as any);
}
export function jitter(c: THREE.Color, r: Rand, dl = 0.1, dh = 0.015, ds = 0.06): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(
    (hsl.h + (r() - 0.5) * 2 * dh + 1) % 1,
    Math.min(1, Math.max(0, hsl.s + (r() - 0.5) * 2 * ds)),
    Math.min(1, Math.max(0, hsl.l * (1 + (r() - 0.5) * 2 * dl))),
  );
}

export function randDir(r: Rand): V3 {
  const y = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - y * y);
  return v3(Math.cos(a) * s, y, Math.sin(a) * s);
}

/** 带顶点色的简单网格材质（不带变化贴图） */
export function vcMat(double = false, flat = false) {
  return new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: double ? THREE.DoubleSide : THREE.FrontSide, flatShading: flat });
}

/** 给几何体写入统一顶点色 */
export function tint(g: THREE.BufferGeometry, c: THREE.Color | Col): THREE.BufferGeometry {
  const col = c instanceof THREE.Color ? c : new THREE.Color(c as any);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** 草叶/长条叶：沿抛物线弯曲的细长条带（双面同法线） */
export class StripBuilder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; idx: number[] = [];
  /**
   * @param lean 水平倾倒方向（单位向量）
   * @param bend 叶尖水平偏移 / 高度
   */
  blade(base: V3, lean: V3, h: number, w: number, bend: number, shade: V3, cBase: THREE.Color, cTip: THREE.Color, segs = 4, droop = 0) {
    const sx = -lean.z, sz = lean.x; // 垂直于倾倒方向的水平向量
    const b0 = this.pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const off = bend * h * t * t;
      const y = h * t - droop * h * t * t * t;
      const ww = w * (1 - t * 0.92) * 0.5;
      const cx = base.x + lean.x * off, cy = base.y + y, cz = base.z + lean.z * off;
      const r = cBase.r + (cTip.r - cBase.r) * t, g = cBase.g + (cTip.g - cBase.g) * t, b = cBase.b + (cTip.b - cBase.b) * t;
      this.pos.push(cx - sx * ww, cy, cz - sz * ww, cx + sx * ww, cy, cz + sz * ww);
      this.nor.push(shade.x, shade.y, shade.z, shade.x, shade.y, shade.z);
      this.col.push(r, g, b, r, g, b);
    }
    for (let i = 0; i < segs; i++) {
      const a = b0 + i * 2, b = a + 1, c = a + 2, d = a + 3;
      this.idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
  build(): THREE.Mesh { return new THREE.Mesh(this.geometry(), leafMat()); }
}
