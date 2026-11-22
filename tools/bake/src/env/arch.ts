import * as THREE from 'three';
import type { BakeItem } from '../core';
import { Col, cyl, DEG, group, lathe, mat, mesh, Xf } from '../geo';
import * as T from './tex_build';

// ---------------------------------------------------------------- UV 与基础几何
let uvCount = 0;
const nextOff = (): [number, number] => {
  uvCount++;
  return [((uvCount * 0.6180339) % 1), ((uvCount * 0.7548777) % 1)];
};

/** 按面法线做平面投影 UV（1 UV = s 米）；grain 指定纹理 V 方向对应的轴 */
export function boxUV(geo: THREE.BufferGeometry, s = 1, grain: 'x' | 'y' | 'z' = 'y', off: [number, number] = nextOff()): THREE.BufferGeometry {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let a: number, b: number;
    if (ax >= ay && ax >= az) [a, b] = grain === 'z' ? [y, z] : [z, y];
    else if (ay >= az) [a, b] = grain === 'x' ? [z, x] : [x, z];
    else [a, b] = grain === 'x' ? [y, x] : [x, y];
    uv[i * 2] = a / s + off[0];
    uv[i * 2 + 1] = b / s + off[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** 带投影 UV 的盒子 */
export function bx(w: number, h: number, d: number, s = 1, grain: 'x' | 'y' | 'z' = 'y'): THREE.BufferGeometry {
  return boxUV(new THREE.BoxGeometry(w, h, d), s, grain);
}

/** 缩放已有 UV */
export function uvMul(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** 圆柱（UV：绕一圈 = around 次重复，沿高 = h/s） */
export function cy(rTop: number, rBot: number, h: number, segs = 14, s = 1, around = 1): THREE.BufferGeometry {
  return uvMul(cyl(rTop, rBot, h, segs), around, h / s);
}

// ---------------------------------------------------------------- 材质
const tp = (t: T.TexPair, scale: number) => ({ map: t.map, bump: t.bump, bumpScale: scale });
export const M = {
  plaster: (c: Col = '#ece7da') => mat(c, tp(T.plaster(), 1.2)),
  wood: (c: Col = '#5d3f2b', double = false) => mat(c, { ...tp(T.wood(), 2.5), double }),
  woodFine: (c: Col = '#5d3f2b', double = false) => mat(c, { ...tp(T.woodFine(), 1.5), double }),
  tile: (c: Col = '#ffffff') => mat(c, { ...tp(T.roofTile(), 3), double: true }),
  thatch: (c: Col = '#c9a966') => mat(c, { ...tp(T.thatch(), 4), double: true }),
  stone: (c: Col = '#9a968d') => mat(c, tp(T.stone(), 2.5)),
  brick: (c: Col = '#7f858a') => mat(c, tp(T.brick(), 2)),
  rubble: (c: Col = '#8e8a80') => mat(c, tp(T.rubble(), 3.5)),
  cloth: (c: Col = '#b9a27c', double = true) => mat(c, { ...tp(T.canvasCloth(), 1.2), double }),
  clay: (c: Col = '#8a6a4e') => mat(c, tp(T.clay(), 2.5)),
  metal: (c: Col = '#3d4046') => mat(c, { kind: 'metal' }),
  flat: (c: Col, double = false) => mat(c, { kind: 'flat', double }),
};

/** 带贴图的一次性材质（招牌、门、窗） */
export function texMat(map: THREE.Texture, o: { emissive?: Col; emisMap?: THREE.Texture; double?: boolean; color?: Col } = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, color: new THREE.Color((o.color ?? '#ffffff') as any), side: o.double ? THREE.DoubleSide : THREE.FrontSide });
  if (o.emissive !== undefined) m.userData.emissive = o.emissive;
  if (o.emisMap) m.emissiveMap = o.emisMap;
  return m;
}

// ---------------------------------------------------------------- 构建上下文
export interface LightInfo { p: [number, number, number]; c: [number, number, number]; r: number; flicker?: number; night?: boolean; }

export class Build {
  root = new THREE.Group();
  info: Record<string, any>;
  hasEmissive = false;
  constructor(public key: string, kind: 'building' | 'prop') {
    this.info = { kind };
  }
  add(...objs: THREE.Object3D[]) { for (const o of objs) this.root.add(o); return this; }
  solid(x0: number, z0: number, x1: number, z1: number) {
    (this.info.solid ??= []).push([+x0.toFixed(2), +z0.toFixed(2), +x1.toFixed(2), +z1.toFixed(2)]);
    return this;
  }
  light(p: [number, number, number], c: [number, number, number], r: number, o: { flicker?: number; night?: boolean } = {}) {
    const l: LightInfo = { p: p.map((v) => +v.toFixed(2)) as any, c, r };
    if (o.flicker) l.flicker = o.flicker;
    if (o.night !== false) l.night = true;
    (this.info.lights ??= []).push(l);
    this.hasEmissive = true;
    return this;
  }
  door(x: number, z: number) { this.info.door = [x, z]; return this; }
  item(): BakeItem {
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m) && m.userData.emissive !== undefined) this.hasEmissive = true;
    });
    return { root: this.root, frames: [{ key: this.key }], emissive: this.hasEmissive, info: this.info };
  }
}

export const WARM: [number, number, number] = [1.9, 1.15, 0.5];
export const RED_GLOW: [number, number, number] = [2.0, 0.75, 0.3];
export const FIRE: [number, number, number] = [2.6, 1.2, 0.35];

// ---------------------------------------------------------------- 屋顶
const prof = (t: number) => 0.55 * t + 0.45 * t * t;

export interface RoofOpts {
  /** 檐口处的平面尺寸（X、Z） */
  W: number; D: number;
  rise: number;
  /** 山面收进（>0 为庑殿/歇山，0 为悬山/硬山） */
  inset?: number;
  /** 歇山：戗脊止于 tc（1 = 庑殿） */
  tc?: number;
  /** 翼角起翘高度 */
  lift?: number;
  /** 瓦垄间距 */
  pitch?: number;
  amp?: number;
  material?: THREE.Material;
  ridgeMat?: THREE.Material;
  /** 正脊高度，0 表示不做 */
  ridgeH?: number;
  /** 正脊两端起翘 */
  ridgeUp?: number;
  /** 翘角尖端伸出长度 */
  tip?: number;
  /** 脊的粗细 */
  ridgeR?: number;
  /** 只保留 t ≤ cut 的部分（腰檐/围脊用，中间留洞） */
  cut?: number;
  /** 不做垂脊、吻与起翘（可无缝拼接的墙帽等） */
  plain?: boolean;
  /** 戗脊上的走兽数量 */
  beasts?: number;
}

/** 生成屋顶（檐口在 y=0，脊沿 X 方向） */
export function roof(o: RoofOpts): THREE.Group {
  const { W, D, rise } = o;
  const inset = o.inset ?? 0;
  const hip = inset > 0;
  const tc = hip ? o.tc ?? 1 : 0;
  const lift = o.plain ? 0 : o.lift ?? 0;
  const cut = o.cut ?? 1;
  const amp = o.amp ?? 0.045;
  const tileM = o.material ?? M.tile();
  const ridgeM = o.ridgeMat ?? M.stone('#5b6066');
  const rr = o.ridgeR ?? 0.075;
  const Rc = Math.min(W, D) * 0.5;
  const liftAt = (x: number, z: number) => {
    if (!lift) return 0;
    if (hip) {
      const k = Math.max(0, 1 - Math.hypot(W / 2 - Math.abs(x), D / 2 - Math.abs(z)) / Rc);
      return lift * k * k;
    }
    const k = Math.max(0, 1 - (W / 2 - Math.abs(x)) / Math.min(2.2, W * 0.3));
    return lift * k * k;
  };
  const g = new THREE.Group();

  const face = (Wf: number, run: number, hipIn: number, tcF: number, tMax: number, toG: (xl: number, zl: number) => [number, number]) => {
    const rows = Math.max(2, Math.round(Wf / (o.pitch ?? 0.26)));
    const p = Wf / rows;
    const per = 10, nx = rows * per, ny = 10;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const slope = Math.hypot(run, rise);
    for (let i = 0; i <= nx; i++) {
      const xl = -Wf / 2 + (Wf * i) / nx;
      const ax = Math.abs(xl);
      const lim = hipIn > 0 ? (ax <= Wf / 2 - hipIn * tcF ? tMax : Math.min(tMax, (Wf / 2 - ax) / hipIn)) : tMax;
      const s = ((i / per) % 1 + 1) % 1;
      const d = Math.abs(s - 0.5) / 0.26;
      const c = d < 1 ? Math.sqrt(1 - d * d) : 0;
      for (let j = -1; j <= ny; j++) {
        const t = (lim * Math.max(0, j)) / ny;
        const zl = run * (1 - t);
        const [X, Z] = toG(xl, zl);
        let y = rise * prof(t) + liftAt(X, Z) + amp * c;
        if (j < 0) y -= 0.1;
        pos.push(X, y, Z);
        uv.push(i / per / 8, j < 0 ? -0.04 : (t * slope) / 0.22 / 8);
      }
    }
    const st = ny + 2;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny + 1; j++) {
        const A = i * st + j, B = (i + 1) * st + j, C = (i + 1) * st + j + 1, Dd = i * st + j + 1;
        idx.push(A, B, C, A, C, Dd);
      }
    }
    void p;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, tileM));
  };

  const xg = W / 2 - inset * tc; // 山花位置 / 正脊端点
  // 前后坡
  face(W, D / 2, inset, tc, cut, (x, z) => [x, z]);
  face(W, D / 2, inset, tc, cut, (x, z) => [-x, -z]);
  if (hip) {
    const b = W / 2 - inset;
    face(D, inset, D / 2, 1, Math.min(tc, cut), (x, z) => [z + b, -x]);
    face(D, inset, D / 2, 1, Math.min(tc, cut), (x, z) => [-(z + b), x]);
  }

  const tubeOf = (pts: THREE.Vector3[], r: number, segs = 20) =>
    new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, 6, false), ridgeM);

  // 戗脊/垂脊 + 翘角
  const tip = o.tip ?? 0.34;
  if (hip) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const t = Math.min(tc, cut) * (1 - i / n);
        const x = W / 2 - inset * t, z = (D / 2) * (1 - t);
        pts.push(new THREE.Vector3(sx * x, rise * prof(t) + liftAt(x, z) + amp + 0.02, sz * z));
      }
      const last = pts[pts.length - 1];
      pts.push(new THREE.Vector3(last.x + sx * tip * 0.6, last.y + tip * 0.32, last.z + sz * tip * 0.6));
      pts.push(new THREE.Vector3(last.x + sx * tip, last.y + tip * 0.85, last.z + sz * tip));
      g.add(tubeOf(pts, rr));
      for (let k = 0; k < (o.beasts ?? 0); k++) {
        const a = pts[n - 1 - k], bb = pts[n - k];
        const p = a.clone().lerp(bb, 0.5);
        const beast = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(rr * 0.9, rr * 1.5, rr * 1.1), ridgeM);
        beast.position.set(p.x, p.y + rr * 1.5, p.z);
        g.add(beast);
      }
    }
    if (tc < 1 && cut >= 1) {
      // 歇山：山面垂脊、博脊与山花
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= 6; i++) {
            const t = 1 - (1 - tc) * (i / 6);
            pts.push(new THREE.Vector3(sx * (xg - 0.06), rise * prof(t) + amp + 0.03, sz * (D / 2) * (1 - t)));
          }
          g.add(tubeOf(pts, rr));
        }
        const zb = (D / 2) * (1 - tc), yb = rise * prof(tc);
        g.add(tubeOf([new THREE.Vector3(sx * xg, yb + 0.05, -zb), new THREE.Vector3(sx * xg, yb + 0.05, zb)], rr * 0.9, 4));
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([sx * (xg - 0.1), yb, -zb, sx * (xg - 0.1), yb, zb, sx * (xg - 0.1), rise, 0], 3));
        tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
        tri.computeVertexNormals();
        g.add(new THREE.Mesh(tri, mat('#7c2f24', { double: true })));
      }
    }
  } else if (!o.plain) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const x = W / 2 - 0.1;
      for (let i = 0; i <= 8; i++) {
        const t = 1 - i / 8;
        pts.push(new THREE.Vector3(sx * x, rise * prof(t) + liftAt(x, 0) + amp + 0.02, sz * (D / 2) * (1 - t)));
      }
      const last = pts[pts.length - 1];
      pts.push(new THREE.Vector3(last.x, last.y + tip * 0.25, last.z + sz * tip * 0.5));
      g.add(tubeOf(pts, rr));
    }
  }

  // 正脊
  const rh = o.ridgeH ?? 0.24;
  if (rh > 0 && cut >= 1) {
    const Lr = hip ? Math.max(0.2, 2 * xg) : o.plain ? W : W - 0.06;
    const up = o.plain ? 0 : o.ridgeUp ?? 0.12;
    const yr = (x: number) => {
      const k = Math.max(0, (Math.abs(x) - (Lr / 2 - Lr * 0.22)) / (Lr * 0.22));
      return rise + liftAt(x, 0) + up * k * k;
    };
    const body = boxUV(new THREE.BoxGeometry(Lr, rh, 0.2, 28, 1, 1), 1.2, 'x');
    const bp = body.attributes.position;
    for (let i = 0; i < bp.count; i++) bp.setY(i, bp.getY(i) + rh / 2 + yr(bp.getX(i)));
    body.computeVertexNormals();
    g.add(new THREE.Mesh(body, ridgeM));
    const cap: THREE.Vector3[] = [];
    const ext = o.plain ? 0 : 0.04;
    for (let i = 0; i <= 28; i++) {
      const x = -Lr / 2 - ext + ((Lr + ext * 2) * i) / 28;
      cap.push(new THREE.Vector3(x, rh + yr(x) + 0.03, 0));
    }
    g.add(tubeOf(cap, Math.min(0.085, rh * 0.5 + 0.02), 28));
    // 两端吻：向外上方卷起的短角
    if (!o.plain) for (const sx of [-1, 1]) {
      const x0 = sx * (Lr / 2);
      const k = Math.min(1, rh / 0.24);
      g.add(tubeOf([
        new THREE.Vector3(x0 - sx * 0.4 * k, rh + yr(x0 - sx * 0.4 * k) + 0.03, 0),
        new THREE.Vector3(x0 - sx * 0.05 * k, rh + yr(x0) + 0.08 * k, 0),
        new THREE.Vector3(x0 + sx * 0.2 * k, rh + yr(x0) + 0.24 * k, 0),
        new THREE.Vector3(x0 + sx * 0.36 * k, rh + yr(x0) + 0.46 * k, 0),
      ], 0.075 * k, 10));
    }
  }
  return g;
}

/** 屋面在平面点 (x,z) 处的高度（相对檐口；仅前后坡，供放置构件用） */
export function roofY(o: RoofOpts, z: number): number {
  const t = Math.max(0, 1 - Math.abs(z) / (o.D / 2));
  return o.rise * prof(t);
}

// ---------------------------------------------------------------- 常用构件
/** 圆柱 + 柱础 */
export function column(h: number, r = 0.14, color: Col = '#5a3524', base = true): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(cy(r * 0.94, r, h, 14, 1.2, 2), M.woodFine(color), { p: [0, h / 2, 0] }));
  if (base) g.add(mesh(lathe([[r * 1.7, 0], [r * 1.75, 0.06], [r * 1.35, 0.14], [r * 1.1, 0.17]], 14), M.stone('#a09c92')));
  return g;
}

/** 台基：条石砌，顶面压一圈阶条石 */
export function plinth(w: number, d: number, h: number, color: Col = '#9a968d'): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(bx(w, h, d, 1.8), M.stone(color), { p: [0, h / 2, 0] }));
  g.add(mesh(bx(w + 0.08, 0.07, d + 0.08, 2.4), M.stone('#aaa69c'), { p: [0, h - 0.02, 0] }));
  return g;
}

/** 石阶：最高一级贴着 z=0，向 +Z 逐级下降 */
export function steps(w: number, n: number, totalH: number, tread = 0.32, color: Col = '#a39f95'): THREE.Group {
  const g = new THREE.Group();
  const sh = totalH / (n + 1);
  for (let i = 0; i < n; i++) {
    const hh = totalH - sh * (i + 1);
    g.add(mesh(bx(w, hh, tread, 1.6), M.stone(color), { p: [0, hh / 2, tread * (i + 0.5)] }));
  }
  return g;
}

/** 纸灯笼，原点在悬挂点（顶部） */
export function lantern(r = 0.2, h = 0.34, color: Col = '#c22a20', glow: Col = '#ff8a3c'): THREE.Group {
  const g = new THREE.Group();
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    prof.push([Math.max(0.03, r * (0.42 + 0.58 * Math.sin(a))), -0.1 - h * (1 - i / 10)]);
  }
  g.add(mesh(lathe(prof, 14), mat(color, { emissive: glow })));
  const gold = M.flat('#b8923e');
  g.add(mesh(cyl(r * 0.45, r * 0.5, 0.05, 10), gold, { p: [0, -0.085, 0] }));
  g.add(mesh(cyl(r * 0.5, r * 0.42, 0.05, 10), gold, { p: [0, -0.115 - h, 0] }));
  g.add(mesh(cyl(0.008, 0.008, 0.1, 5), M.flat('#2a1a12'), { p: [0, -0.04, 0] }));
  g.add(mesh(cyl(0.03, 0.012, 0.16, 6), M.flat('#d7a534'), { p: [0, -0.22 - h, 0] }));
  return g;
}

/** 棂窗（带木框），原点在窗中心，面朝 +Z */
export function windowPanel(w: number, h: number, kind: T.LatticeKind = 'grid', frame: Col = '#3b2618', glow: Col = '#ffc070'): THREE.Group {
  const g = new THREE.Group();
  const lt = T.lattice(kind, typeof frame === 'string' ? frame : '#3b2618');
  g.add(mesh(new THREE.BoxGeometry(w, h, 0.05), texMat(lt.map, { emissive: glow, emisMap: lt.emis })));
  const fm = M.woodFine(frame);
  const t = 0.09;
  g.add(mesh(bx(w + t * 2, t, 0.12, 1, 'x'), fm, { p: [0, h / 2 + t / 2, 0.02] }));
  g.add(mesh(bx(w + t * 2 + 0.1, t * 1.1, 0.18, 1, 'x'), fm, { p: [0, -h / 2 - t / 2, 0.04] }));
  for (const s of [-1, 1]) g.add(mesh(bx(t, h, 0.12), fm, { p: [s * (w / 2 + t / 2), 0, 0.02] }));
  return g;
}

/** 双扇门（带门框、门槛），原点在门底中心，面朝 +Z */
export function doorPanel(w: number, h: number, color = '#5a2a1e', frame: Col = '#3b2618', studs = true): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, 0.06), texMat(T.door(color, studs)), { p: [0, h / 2, 0] }));
  const fm = M.woodFine(frame);
  for (const s of [-1, 1]) g.add(mesh(bx(0.14, h + 0.14, 0.2), fm, { p: [s * (w / 2 + 0.07), h / 2 + 0.07, 0.03] }));
  g.add(mesh(bx(w + 0.44, 0.18, 0.24, 1, 'x'), fm, { p: [0, h + 0.09, 0.04] }));
  g.add(mesh(bx(w + 0.3, 0.1, 0.22, 1.6), M.stone('#8d897f'), { p: [0, 0.05, 0.05] }));
  return g;
}

/** 深色内景材质：白天近黑，夜里透出由下而上渐暗的暖光 */
let _interior: THREE.MeshLambertMaterial | null = null;
export function interiorMat(): THREE.MeshLambertMaterial {
  if (_interior) return _interior;
  const glow = T.drawTex('interior_glow', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.8, 6, w / 2, h * 0.6, w * 0.8);
    g.addColorStop(0, '#ffc070'); g.addColorStop(0.5, '#b8642a'); g.addColorStop(1, '#3a1c0c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  _interior = new THREE.MeshLambertMaterial({ color: new THREE.Color('#1c130e') });
  _interior.userData.emissive = '#ffffff';
  _interior.emissiveMap = glow;
  return _interior;
}

/** 敞开的门洞（深色内景 + 暖光），原点在底中心 */
export function doorway(w: number, h: number, frame: Col = '#3b2618'): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, 0.05), interiorMat(), { p: [0, h / 2, 0] }));
  const fm = M.woodFine(frame);
  for (const s of [-1, 1]) g.add(mesh(bx(0.16, h + 0.16, 0.22), fm, { p: [s * (w / 2 + 0.08), h / 2 + 0.08, 0.03] }));
  g.add(mesh(bx(w + 0.5, 0.2, 0.26, 1, 'x'), fm, { p: [0, h + 0.1, 0.04] }));
  g.add(mesh(bx(w + 0.3, 0.1, 0.24, 1.6), M.stone('#8d897f'), { p: [0, 0.05, 0.05] }));
  return g;
}

/** 匾额，原点在中心，面朝 +Z，可前倾 */
export function plaque(text: string, w: number, h: number, o: { bg?: string; fg?: string; vertical?: boolean; tilt?: number; border?: string } = {}): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, 0.07), texMat(T.sign(text, o))));
  g.add(mesh(bx(w + 0.1, h + 0.1, 0.05), M.woodFine('#3a2418'), { p: [0, 0, -0.03] }));
  g.rotation.x = (o.tilt ?? 0) * DEG;
  return g;
}

/** 山墙面：沿屋面轮廓的五边形墙（面朝 +Z，原点在底边中心） */
export function gableWall(w: number, h: number, rise: number, thick: number, material: THREE.Material, uvS = 4): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  const n = 10;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    s.lineTo((w / 2) * (1 - t), h + rise * prof(t));
  }
  for (let i = n - 1; i >= 0; i--) {
    const t = i / n;
    s.lineTo(-(w / 2) * (1 - t), h + rise * prof(t));
  }
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, -thick / 2);
  uvMul(geo, 1 / uvS, 1 / uvS);
  return new THREE.Mesh(geo, material);
}

/** 沿任意折线摆放的绳/杆 */
export function rod(a: [number, number, number], b: [number, number, number], r: number, material: THREE.Material, segs = 6): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const len = d.length();
  const m = new THREE.Mesh(cy(r, r, len, segs, 1.2, 1), material);
  m.position.copy(va).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export { group, mesh, mat, DEG };
export type { Xf };
