import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, Col, fbm, rng } from '../geo';
import {
  barkMat, bezier, clampGround, fbm3, jitter, LeafBuilder, merge, Palette, pick, Rand, randDir, rr, SHAPES, StripBuilder, tint, tubeGeo, UP, V3, v3, vcMat,
} from './flora';
import type { SpriteDef } from './nature';
import { trunkGeo } from './trees';

const C = (c: Col) => new THREE.Color(c as any);

// ====================== 岩石 ======================
let _rockMat: THREE.MeshLambertMaterial | null = null;
function rockMat() {
  if (!_rockMat) {
    const f = (u: number, v: number) => {
      const a = fbm(u * 8, v * 8, 8, 5, 41);
      const crack = Math.pow(Math.abs(Math.sin((u * 5 + fbm(u * 4, v * 4, 4, 3, 43) * 3) * Math.PI)), 0.25);
      return 0.5 + 0.42 * a + 0.07 * crack;
    };
    const bump = canvasTex('rock_bump', 256, (u, v) => { const g = f(u, v); return [g, g, g]; }, false);
    const map = canvasTex('rock_map', 256, (u, v) => { const g = 0.82 + 0.2 * fbm(u * 10, v * 10, 10, 4, 47); return [g, g, g]; });
    _rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map, bumpMap: bump, bumpScale: 3 });
  }
  return _rockMat;
}

interface RockOpts { seed: number; size: [number, number, number]; pos?: [number, number, number]; cuts?: number; moss?: number; base?: Col; rough?: number; }

function rock(o: RockOpts): THREE.Mesh {
  const r = rng(o.seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 10);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // 随机平面切削出棱面
  const planes: { n: V3; d: number }[] = [];
  const nc = o.cuts ?? 11;
  for (let i = 0; i < nc; i++) {
    const n = randDir(r);
    if (n.y < -0.3) n.y = -n.y;
    planes.push({ n: n.normalize(), d: rr(r, 0.56, 0.9) });
  }
  const q = v3();
  const rough = o.rough ?? 1;
  for (let i = 0; i < p.count; i++) {
    q.fromBufferAttribute(p, i);
    // 大形起伏
    const s0 = 0.82 + 0.4 * fbm3(q.x * 1.3 + o.seed, q.y * 1.3, q.z * 1.3, 3, o.seed);
    q.multiplyScalar(s0);
    for (const pl of planes) {
      const d = q.dot(pl.n) - pl.d;
      if (d > 0) q.addScaledVector(pl.n, -d * 0.94);
    }
    // 细碎凹凸
    const n1 = fbm3(q.x * 4.5, q.y * 4.5, q.z * 4.5, 4, o.seed + 5) - 0.5;
    q.multiplyScalar(1 + n1 * 0.13 * rough);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  g.scale(o.size[0] / 2, o.size[1] / 1.25, o.size[2] / 2);
  g.rotateY(r() * Math.PI * 2);
  g.translate(0, o.size[1] * 0.32, 0);
  clampGround(g);
  g = toCreasedNormals(g, (26 * Math.PI) / 180);
  // 顶点色：岩色 + 裂隙暗部 + 朝上的苔藓 + 地衣斑
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const uv = new Float32Array(pos.count * 2);
  const base = C(o.base ?? '#8d887e'), warm = C('#9a8c78'), dark = C('#5d5a55');
  const mossA = C('#5f7a36'), mossB = C('#7d9244'), lichen = C('#b9b79c');
  const mossAmt = o.moss ?? 0.5;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nor.getY(i);
    const sc = 2.2 / Math.max(o.size[0], 0.6);
    const n1 = fbm3(x * 2.2 * sc + 7, y * 2.2 * sc, z * 2.2 * sc, 4, o.seed + 11);
    const n2 = fbm3(x * 6 * sc, y * 6 * sc + 3, z * 6 * sc, 3, o.seed + 13);
    c.copy(base).lerp(warm, n1).lerp(dark, Math.max(0, 0.55 - n2) * 0.9);
    c.multiplyScalar(0.8 + 0.3 * n2 + 0.12 * Math.min(1, y / o.size[1]));
    if (n2 > 0.66) c.lerp(lichen, Math.min(1, (n2 - 0.66) * 5) * 0.55);
    const m = Math.min(1, Math.max(0, (ny - 0.35) * 2.2)) * Math.min(1, Math.max(0, (n1 - (0.62 - mossAmt * 0.4)) * 5));
    if (m > 0) c.lerp(n2 > 0.5 ? mossB : mossA, m * 0.92);
    // 贴地一圈略暗、偏绿
    const low = Math.max(0, 1 - y / (o.size[1] * 0.18 + 0.03));
    c.lerp(C('#565a40'), low * 0.45);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    // 按法线主轴做盒式投影，避免极点处的放射状拉伸
    const ax = Math.abs(nor.getX(i)), az = Math.abs(nor.getZ(i)), ay = Math.abs(ny);
    const us = 1.1;
    if (ay >= ax && ay >= az) { uv[i * 2] = x * us; uv[i * 2 + 1] = z * us; }
    else if (ax >= az) { uv[i * 2] = z * us; uv[i * 2 + 1] = y * us; }
    else { uv[i * 2] = x * us; uv[i * 2 + 1] = y * us; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, rockMat());
  if (o.pos) m.position.set(...o.pos);
  return m;
}

// ====================== 草丛 ======================
interface TuftOpts {
  seed: number; n: number; radius: number; h: [number, number]; w: number; bend: [number, number];
  pal: Palette; tip?: Col; seedHeads?: Col; droop?: number;
}
function tuft(sb: StripBuilder, o: TuftOpts, at: V3 = v3(), heads?: THREE.BufferGeometry[]) {
  const r = rng(o.seed);
  const shade = v3(), lean = v3();
  for (let i = 0; i < o.n; i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * o.radius;
    const base = v3(at.x + Math.cos(a) * rad, at.y, at.z + Math.sin(a) * rad * 0.9);
    // 向外倾倒，中间的更直
    const la = a + rr(r, -0.7, 0.7);
    lean.set(Math.cos(la), 0, Math.sin(la));
    const k = rad / o.radius;
    const h = rr(r, o.h[0], o.h[1]) * (1 - 0.3 * k);
    const bend = rr(r, o.bend[0], o.bend[1]) * (0.4 + 0.8 * k);
    shade.set(Math.cos(a) * 0.55 * k, 0.85, Math.sin(a) * 0.55 * k).normalize();
    const cb = jitter(pick(o.pal, r), r, 0.12, 0.012, 0.05);
    const ct = o.tip ? cb.clone().lerp(C(o.tip), rr(r, 0.3, 0.8)) : cb.clone().multiplyScalar(1.25);
    sb.blade(base, lean, h, o.w * rr(r, 0.7, 1.2), bend, shade, cb.clone().multiplyScalar(0.62), ct, 5, o.droop ?? 0.12);
    if (heads && o.seedHeads && r() < 0.35) {
      const hx = base.x + lean.x * bend * h, hz = base.z + lean.z * bend * h, hy = h * (1 - (o.droop ?? 0.12));
      const e = new THREE.SphereGeometry(1, 6, 5).scale(0.012, 0.045, 0.012);
      e.rotateZ(-lean.x * 0.6); e.rotateX(lean.z * 0.6);
      e.translate(hx, hy + 0.03, hz);
      heads.push(tint(e, jitter(C(o.seedHeads), r, 0.12)));
    }
  }
}

function grassSprite(o: TuftOpts, extra?: (g: THREE.Group, r: Rand) => void): THREE.Group {
  const g = new THREE.Group();
  const sb = new StripBuilder();
  const heads: THREE.BufferGeometry[] = [];
  tuft(sb, o, v3(), heads);
  g.add(sb.build());
  if (heads.length) g.add(new THREE.Mesh(merge(heads.map((h) => h.toNonIndexed())), vcMat()));
  extra?.(g, rng(o.seed + 99));
  return g;
}

const GRASS: Palette = [['#4f8232', 4], ['#63963c', 3], ['#3f6f2c', 2.5], ['#7da646', 1.4]];
const GRASS_Y: Palette = [['#7c9a3c', 4], ['#96aa46', 3], ['#647f32', 2], ['#b3b24e', 1.4]];
const GRASS_DRY: Palette = [['#b99b4a', 4], ['#cfb25a', 3], ['#a3863e', 2.5], ['#8f8a3c', 1.2]];

// ====================== 花 ======================
interface FlowerOpts {
  seed: number; stems: number; radius: number; h: [number, number]; petal: Palette; center: Col; size: [number, number];
  /** 每根茎上的花数；>1 时沿茎上段排成穗 */
  perStem?: number; leafPal?: Palette; tilt?: number;
}
function flowerSprite(o: FlowerOpts): THREE.Group {
  const r = rng(o.seed);
  const g = new THREE.Group();
  const lb = new LeafBuilder();
  const sb = new StripBuilder();
  const geos: THREE.BufferGeometry[] = [];
  const dots: THREE.BufferGeometry[] = [];
  const leafPal = o.leafPal ?? GRASS;
  // 基部叶丛
  tuft(sb, { seed: o.seed + 1, n: Math.round(o.stems * 5), radius: o.radius, h: [0.08, 0.18], w: 0.03, bend: [0.5, 1.4], pal: leafPal });
  for (let i = 0; i < o.stems; i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * o.radius;
    const base = v3(Math.cos(a) * rad, 0, Math.sin(a) * rad * 0.9);
    const h = rr(r, o.h[0], o.h[1]);
    const lean = v3(Math.cos(a) * rad * 0.5 + rr(r, -0.04, 0.04), 0, Math.sin(a) * rad * 0.5 + rr(r, -0.04, 0.04));
    const top = v3(base.x + lean.x, h, base.z + lean.z);
    const mid = base.clone().lerp(top, 0.5).add(v3(lean.x * 0.3, 0.02, lean.z * 0.3));
    const pts = bezier(base, mid, top, 5);
    geos.push(tint(tubeGeo(pts, [0.007, 0.007, 0.006, 0.006, 0.005, 0.004], 5, 1, 1), jitter(C('#55803a'), r, 0.1)));
    // 茎上的小叶
    for (let k = 1; k <= 3; k++) {
      const la = r() * Math.PI * 2;
      const dir = v3(Math.cos(la), 0.35, Math.sin(la)).normalize();
      lb.add(SHAPES.oval, pts[k], dir, UP, rr(r, 0.05, 0.08), v3(dir.x * 0.4, 0.9, dir.z * 0.4).normalize(), jitter(pick(leafPal, r), r, 0.12), 0.2, 0.1);
    }
    const per = o.perStem ?? 1;
    for (let f = 0; f < per; f++) {
      const t = per === 1 ? 1 : 0.55 + (0.45 * f) / (per - 1);
      const fi = t * 5, ii = Math.min(4, Math.floor(fi));
      const p = pts[ii].clone().lerp(pts[ii + 1], fi - ii);
      const fa = r() * Math.PI * 2;
      const tiltK = (o.tilt ?? 0.35) * (per === 1 ? 1 : 2.2);
      const face = v3(Math.cos(fa) * tiltK + lean.x * 2, 1, Math.sin(fa) * tiltK + lean.z * 2).normalize();
      if (per > 1) p.add(v3(Math.cos(fa) * 0.018, 0, Math.sin(fa) * 0.018));
      const sz = rr(r, o.size[0], o.size[1]) * (per === 1 ? 1 : 1 - 0.35 * ((t - 0.55) / 0.45));
      const col = jitter(pick(o.petal, r), r, 0.08, 0.01, 0.05);
      const dirT = randDir(r);
      lb.add(SHAPES.flower, p, dirT, face, sz, v3(face.x * 0.5, 0.8, face.z * 0.5 + 0.2).normalize(), col, 0.25, 0, 1);
      // 第二层花瓣，错开半个花瓣角，显得更饱满
      const d2 = dirT.clone().applyAxisAngle(face, Math.PI / 5);
      lb.add(SHAPES.flower, p.clone().addScaledVector(face, 0.004), d2, face, sz * 0.78, v3(face.x * 0.5, 0.85, face.z * 0.5 + 0.2).normalize(), col.clone().multiplyScalar(1.1), 0.4, 0, 1);
      const s = new THREE.SphereGeometry(sz * 0.2, 7, 5);
      s.translate(p.x + face.x * 0.008, p.y + face.y * 0.008, p.z + face.z * 0.008);
      const sn = s.toNonIndexed(); sn.deleteAttribute('uv');
      dots.push(tint(sn, C(o.center)));
    }
  }
  g.add(sb.build(), lb.build());
  const stems = merge(geos.map((x) => { x.deleteAttribute('uv'); return x.toNonIndexed(); }).concat(dots));
  g.add(new THREE.Mesh(stems, vcMat()));
  return g;
}

// ====================== 芦苇 ======================
function reedSprite(seed: number, stems: number, radius: number, hh: [number, number], cattail: boolean): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const sb = new StripBuilder();
  const lb = new LeafBuilder();
  const geos: THREE.BufferGeometry[] = [];
  const pal: Palette = [['#7d9440', 3], ['#96a44a', 3], ['#a9a552', 2], ['#667e36', 2]];
  const plume: Palette = [['#cdb88c', 3], ['#b89e70', 3], ['#dccba4', 2]];
  for (let i = 0; i < stems; i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * radius;
    const base = v3(Math.cos(a) * rad, 0, Math.sin(a) * rad * 0.85);
    const h = rr(r, hh[0], hh[1]);
    const la = a + rr(r, -1, 1), lean = rr(r, 0.05, 0.22) * h;
    const top = v3(base.x + Math.cos(la) * lean, h, base.z + Math.sin(la) * lean);
    const mid = base.clone().lerp(top, 0.5).add(v3(-Math.cos(la) * lean * 0.2, 0, -Math.sin(la) * lean * 0.2));
    const pts = bezier(base, mid, top, 7);
    geos.push(tint(tubeGeo(pts, pts.map((_, k) => 0.011 - 0.006 * (k / 7)), 5, 1, 1), jitter(C('#8a9a4a'), r, 0.12)).toNonIndexed());
    // 长条叶
    const nl = 3 + Math.floor(r() * 3);
    for (let k = 0; k < nl; k++) {
      const t = rr(r, 0.12, 0.7), fi = t * 7, ii = Math.floor(fi);
      const p = pts[ii].clone().lerp(pts[ii + 1], fi - ii);
      const da = r() * Math.PI * 2;
      const dir = v3(Math.cos(da), 0, Math.sin(da));
      const cb = jitter(pick(pal, r), r, 0.12);
      sb.blade(p, dir, rr(r, 0.4, 0.75), 0.03, rr(r, 0.5, 1.1), v3(dir.x * 0.4, 0.85, dir.z * 0.4).normalize(), cb.clone().multiplyScalar(0.8), cb.clone().lerp(C('#c9b25a'), 0.45), 6, 0.35);
    }
    if (cattail && r() < 0.6) {
      const c = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8).toNonIndexed();
      c.deleteAttribute('uv');
      c.translate(top.x, h - 0.12, top.z);
      geos.push(tint(c, jitter(C('#6a4426'), r, 0.1)));
    } else {
      // 芦花：一束下垂的细羽片
      const n = 26;
      for (let k = 0; k < n; k++) {
        const da = la + rr(r, -1.0, 1.0);
        const dir = v3(Math.cos(da) * 0.55, rr(r, 0.1, 1.0), Math.sin(da) * 0.55).normalize();
        const p = top.clone().add(v3(rr(r, -0.012, 0.012), -r() * 0.24, rr(r, -0.012, 0.012)));
        lb.add(SHAPES.lance, p, dir, randDir(r), rr(r, 0.07, 0.13), v3(dir.x * 0.4, 0.85, dir.z * 0.4).normalize(), jitter(pick(plume, r), r, 0.1), 0.1, -0.6, 1.5);
      }
    }
  }
  g.add(sb.build(), lb.build());
  for (const x of geos) x.deleteAttribute('uv');
  g.add(new THREE.Mesh(merge(geos), vcMat()));
  return g;
}

// ====================== 荷 ======================
function lotusLeaf(geos: THREE.BufferGeometry[], r: Rand, c: V3, R: number, cup: number, tilt: V3 | null) {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const notch = r() * Math.PI * 2, segs = 44, rings = 5;
  const cA = jitter(C('#3f7a3a'), r, 0.1, 0.02), cB = jitter(C('#5f9a48'), r, 0.1, 0.02);
  const q = v3();
  const basis = new THREE.Quaternion();
  if (tilt) basis.setFromUnitVectors(UP, tilt.clone().normalize());
  for (let j = 0; j <= rings; j++) {
    const rho = j / rings;
    for (let i = 0; i <= segs; i++) {
      // 缺口处留一条缝
      const th = notch + 0.12 + (i / segs) * (Math.PI * 2 - 0.24);
      const rr2 = R * rho * (1 + 0.035 * Math.sin(th * 9 + c.x * 7) * rho);
      const y = cup * R * rho * rho + 0.012 * Math.sin(th * 6) * rho * rho * (cup > 0.1 ? 3 : 1);
      q.set(Math.cos(th) * rr2, y, Math.sin(th) * rr2);
      if (tilt) q.applyQuaternion(basis);
      pos.push(c.x + q.x, c.y + q.y, c.z + q.z);
      // 放射叶脉：沿角度的细亮纹
      const vein = Math.pow(Math.abs(Math.cos(th * 9)), 24) * 0.35 * rho;
      const k = 0.78 + 0.26 * rho + vein;
      const cc = cA.clone().lerp(cB, rho);
      col.push(cc.r * k, cc.g * k, cc.b * k);
    }
  }
  const W = segs + 1;
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * W + i, b = a + 1, d = a + W, e = d + 1;
    idx.push(a, d, b, b, d, e, a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const ni = g.toNonIndexed();
  // 双面三角形法线会互相抵消，直接给朝上的法线（带碗形坡度）
  const p = ni.getAttribute('position') as THREE.BufferAttribute;
  const n = new Float32Array(p.count * 3);
  const up = tilt ? tilt.clone().normalize() : UP;
  for (let i = 0; i < p.count; i++) {
    q.set(p.getX(i) - c.x, 0, p.getZ(i) - c.z);
    const rho = Math.min(1, q.length() / R);
    q.normalize().multiplyScalar(-cup * 1.6 * rho).add(up).normalize();
    n[i * 3] = q.x; n[i * 3 + 1] = q.y; n[i * 3 + 2] = q.z;
  }
  ni.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  geos.push(ni);
}

function lotusSprite(seed: number, flower: boolean): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const flat: [number, number, number][] = flower
    ? [[-0.42, 0.1, 0.42], [0.36, 0.3, 0.36], [0.1, -0.42, 0.3]]
    : [[-0.3, 0.05, 0.46], [0.42, 0.22, 0.36], [0.12, -0.38, 0.3], [-0.5, -0.45, 0.22], [0.62, -0.3, 0.2]];
  for (const [x, z, R] of flat) lotusLeaf(geos, r, v3(x, 0.02 + r() * 0.01, z), R, 0.04, null);
  const stemsG: THREE.BufferGeometry[] = [];
  const stem = (x: number, z: number, h: number, lx: number, lz: number) => {
    const pts = bezier(v3(x, 0, z), v3(x + lx * 0.2, h * 0.6, z + lz * 0.2), v3(x + lx, h, z + lz), 5);
    const t = tubeGeo(pts, pts.map(() => 0.012), 6, 1, 1).toNonIndexed();
    t.deleteAttribute('uv');
    stemsG.push(tint(t, C('#5a8a40')));
    return pts[5];
  };
  if (flower) {
    // 挺出水面的荷叶
    const t1 = stem(0.28, -0.18, 0.42, 0.1, -0.04);
    lotusLeaf(geos, r, t1, 0.34, 0.32, v3(0.25, 1, 0.3));
    // 荷花
    const top = stem(-0.12, 0.02, 0.5, -0.06, 0.05);
    const lb = new LeafBuilder();
    const pink: Palette = [['#f39ab4', 3], ['#f7b6c8', 3], ['#ee84a4', 2]];
    const rings: [number, number, number, number][] = [[9, 1.25, 0.2, 0.9], [8, 0.75, 0.19, 1.0], [6, 0.35, 0.16, 1.1]];
    for (const [n, tilt, size, bright] of rings) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + tilt * 3;
        const dir = v3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
        const nh = v3(-Math.cos(a) * Math.cos(tilt), Math.sin(tilt), -Math.sin(a) * Math.cos(tilt));
        const shade = v3(Math.cos(a) * 0.6, 0.75, Math.sin(a) * 0.6).normalize();
        lb.add(SHAPES.oval, top, dir, nh, size * rr(r, 0.9, 1.1), shade, jitter(pick(pink, r), r, 0.06).multiplyScalar(bright), -0.35, -0.25, 1.15);
      }
    }
    g.add(lb.build());
    const seedpod = new THREE.CylinderGeometry(0.035, 0.02, 0.04, 10).toNonIndexed();
    seedpod.deleteAttribute('uv');
    seedpod.translate(top.x, top.y + 0.03, top.z);
    stemsG.push(tint(seedpod, C('#e3c44a')));
    // 花苞
    const bt = stem(-0.4, -0.3, 0.36, -0.05, -0.03);
    const bud = new THREE.SphereGeometry(1, 10, 8).scale(0.04, 0.075, 0.04).toNonIndexed();
    bud.deleteAttribute('uv');
    bud.translate(bt.x, bt.y + 0.05, bt.z);
    stemsG.push(tint(bud, C('#ee8fac')));
  }
  g.add(new THREE.Mesh(merge(geos), vcMat()));
  if (stemsG.length) g.add(new THREE.Mesh(merge(stemsG), vcMat()));
  return g;
}

// ====================== 树桩、倒木、蘑菇 ======================
function ringsMat() {
  const map = canvasTex('wood_rings', 256, (u, v) => {
    const dx = u - 0.5 + (fbm(u * 3, v * 3, 3, 2, 3) - 0.5) * 0.05, dy = v - 0.5;
    const d = Math.hypot(dx, dy) * 2;
    const ring = 0.5 + 0.5 * Math.sin(d * 42 + fbm(u * 6, v * 6, 6, 3, 5) * 5);
    const g = 0.72 + 0.2 * ring - 0.25 * Math.pow(d, 3);
    // 径向裂纹
    const a = Math.atan2(dy, dx);
    const crack = Math.pow(Math.abs(Math.sin(a * 3.5 + 1)), 60) * (d > 0.15 ? 0.4 : 0);
    return [g - crack, (g - crack) * 0.86, (g - crack) * 0.62];
  });
  return new THREE.MeshLambertMaterial({ color: 0xd8c39a, map });
}

function mushrooms(g: THREE.Group, r: Rand, spots: [number, number, number, number][], cap: Col, capTop: Col, spotted = false) {
  const geos: THREE.BufferGeometry[] = [];
  for (const [x, y, z, s] of spots) {
    const st = new THREE.CylinderGeometry(0.018 * s, 0.026 * s, 0.11 * s, 8).toNonIndexed();
    st.deleteAttribute('uv');
    const lean = v3(rr(r, -0.3, 0.3), 1, rr(r, -0.3, 0.3)).normalize();
    const qq = new THREE.Quaternion().setFromUnitVectors(UP, lean);
    st.translate(0, 0.055 * s, 0);
    st.applyQuaternion(qq);
    st.translate(x, y, z);
    geos.push(tint(st, C('#e9dfc8')));
    // 伞盖
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector2(Math.max(1e-4, Math.sin((t * Math.PI) / 2) * 0.075 * s), Math.cos((t * Math.PI) / 2) * 0.045 * s));
    }
    pts.push(new THREE.Vector2(0.06 * s, -0.006 * s), new THREE.Vector2(1e-4, 0.004 * s));
    pts.reverse();
    const capG = new THREE.LatheGeometry(pts, 14).toNonIndexed();
    capG.deleteAttribute('uv');
    const p = capG.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const c0 = jitter(C(cap), r, 0.08), c1 = C(capTop), cc = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const yy = p.getY(i) / (0.045 * s), rad = Math.hypot(p.getX(i), p.getZ(i)) / (0.075 * s);
      cc.copy(c0).lerp(c1, Math.max(0, yy) * 0.6);
      if (yy < 0.05) cc.set('#d9c9a8');
      if (spotted && yy > 0.1) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        if (Math.sin(a * 5 + rad * 9) > 0.86) cc.set('#f4efe2');
      }
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
    }
    capG.setAttribute('color', new THREE.BufferAttribute(col, 3));
    capG.translate(0, 0.11 * s, 0);
    capG.applyQuaternion(qq);
    capG.translate(x, y, z);
    geos.push(capG);
  }
  g.add(new THREE.Mesh(merge(geos), vcMat()));
}

/** 贴在物体表面的苔藓：一小片朝上的圆叶 */
function mossPatch(lb: LeafBuilder, r: Rand, c: V3, rad: number, n: number, up: V3 = UP) {
  const pal: Palette = [['#5f8236', 3], ['#769642', 3], ['#4c6e2e', 2], ['#93a84e', 1]];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
    const p = v3(c.x + Math.cos(a) * d, c.y + rr(r, 0, 0.012), c.z + Math.sin(a) * d);
    const dir = v3(Math.cos(a + 1), 0.05, Math.sin(a + 1)).normalize();
    lb.add(SHAPES.round, p, dir, up, rr(r, 0.03, 0.055), v3(Math.cos(a) * 0.3, 0.9, Math.sin(a) * 0.3).normalize(), jitter(pick(pal, r), r, 0.14), 0.3, 0.3);
  }
}

function stumpSprite(): THREE.Group {
  const r = rng(311);
  const g = new THREE.Group();
  const H = 0.46, R = 0.3;
  const pts: V3[] = [], radii: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(v3(0.02 * t, H * t, 0.01 * t));
    radii.push(R * (1 - 0.08 * t) * (1 + 0.4 * Math.exp((-t * H) / 0.2)));
  }
  g.add(new THREE.Mesh(clampGround(trunkGeo(r, pts, radii, R, 6)), barkMat('#7a6650', 'rough')));
  const top = new THREE.CircleGeometry(R * 0.93, 24).rotateX(-Math.PI / 2);
  // 顶面略微不平
  const tp = top.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) tp.setY(i, tp.getY(i) + (fbm3(tp.getX(i) * 6, 0, tp.getZ(i) * 6, 2, 9) - 0.5) * 0.03);
  top.computeVertexNormals();
  top.translate(0.02, H + 0.005, 0.01);
  g.add(new THREE.Mesh(top, ringsMat()));
  const lb = new LeafBuilder();
  mossPatch(lb, r, v3(-0.12, H + 0.012, -0.1), 0.13, 60);
  mossPatch(lb, r, v3(0.2, H + 0.012, 0.05), 0.08, 26);
  g.add(lb.build());
  mushrooms(g, r, [[0.33, 0.0, 0.2, 1.0], [0.4, 0.0, 0.1, 0.7], [-0.36, 0, 0.16, 0.8]], '#b9743e', '#8f4f28');
  const sb = new StripBuilder();
  tuft(sb, { seed: 5, n: 22, radius: 0.16, h: [0.12, 0.26], w: 0.014, bend: [0.4, 1.0], pal: GRASS }, v3(-0.36, 0, -0.1));
  tuft(sb, { seed: 6, n: 16, radius: 0.12, h: [0.1, 0.2], w: 0.014, bend: [0.4, 1.0], pal: GRASS }, v3(0.3, 0, -0.22));
  g.add(sb.build());
  return g;
}

function logSprite(): THREE.Group {
  const r = rng(331);
  const g = new THREE.Group();
  const R = 0.2;
  const a = v3(-1.08, R * 0.9, 0.16), b = v3(1.05, R * 0.82, -0.14);
  const pts: V3[] = [], radii: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(a.clone().lerp(b, t).add(v3(0, Math.sin(t * Math.PI) * 0.02, Math.sin(t * 5) * 0.02)));
    radii.push(R * (1.08 - 0.22 * t) * (1 + 0.05 * Math.sin(t * 17)));
  }
  const bark = barkMat('#75624e', 'rough');
  const geos: THREE.BufferGeometry[] = [tubeGeo(pts, radii, 14, 3, 0.9, false)];
  // 断枝
  const s0 = pts[5];
  geos.push(tubeGeo([s0.clone(), s0.clone().add(v3(0.08, 0.26, -0.16)), s0.clone().add(v3(0.12, 0.44, -0.2))], [0.07, 0.055, 0.04], 8, 1, 0.9));
  geos.push(tubeGeo([pts[2].clone(), pts[2].clone().add(v3(-0.05, 0.1, 0.24))], [0.06, 0.04], 8, 1, 0.9));
  g.add(new THREE.Mesh(clampGround(merge(geos)), bark));
  // 两端截面
  const dir = b.clone().sub(a).normalize();
  for (const [p, rad, sgn] of [[pts[0], radii[0], -1], [pts[8], radii[8], 1]] as [V3, number, number][]) {
    const c = new THREE.CircleGeometry(rad * 0.96, 18);
    const qq = new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), dir.clone().multiplyScalar(sgn));
    c.applyQuaternion(qq);
    c.translate(p.x + dir.x * sgn * 0.004, p.y, p.z + dir.z * sgn * 0.004);
    g.add(new THREE.Mesh(c, ringsMat()));
  }
  const lb = new LeafBuilder();
  for (let i = 0; i < 7; i++) {
    const t = rr(r, 0.08, 0.92), fi = t * 8, ii = Math.floor(fi);
    const p = pts[ii].clone().lerp(pts[ii + 1], fi - ii);
    const rad = radii[ii];
    const off = rr(r, -0.5, 0.5);
    mossPatch(lb, r, v3(p.x, p.y + rad * Math.cos(off) + 0.004, p.z + rad * Math.sin(off)), rr(r, 0.07, 0.15), 34);
  }
  g.add(lb.build());
  mushrooms(g, r, [[0.3, 0.0, 0.26, 0.9], [0.42, 0.0, 0.3, 0.6], [-0.62, 0, 0.34, 0.75]], '#b9743e', '#8f4f28');
  const sb = new StripBuilder();
  tuft(sb, { seed: 15, n: 26, radius: 0.2, h: [0.14, 0.3], w: 0.014, bend: [0.4, 1.0], pal: GRASS }, v3(-0.7, 0, -0.26));
  tuft(sb, { seed: 16, n: 20, radius: 0.16, h: [0.12, 0.26], w: 0.014, bend: [0.4, 1.0], pal: GRASS }, v3(0.75, 0, 0.2));
  g.add(sb.build());
  return g;
}

function mushroomSprite(): THREE.Group {
  const r = rng(347);
  const g = new THREE.Group();
  mushrooms(g, r, [[0, 0, 0, 1.5], [0.13, 0, 0.06, 1.0], [-0.11, 0, 0.08, 0.85], [0.03, 0, -0.12, 1.1], [-0.15, 0, -0.06, 0.6]], '#c0462e', '#a3301f', true);
  const sb = new StripBuilder();
  tuft(sb, { seed: 21, n: 18, radius: 0.2, h: [0.06, 0.14], w: 0.012, bend: [0.5, 1.2], pal: GRASS });
  g.add(sb.build());
  return g;
}

// ====================== 药草（可采集） ======================
function herbSprite(): THREE.Group {
  const r = rng(367);
  const g = new THREE.Group();
  const lb = new LeafBuilder();
  const geos: THREE.BufferGeometry[] = [];
  const leafPal: Palette = [['#3f8a4a', 3], ['#52a058', 3], ['#2f7440', 2]];
  const stemC = C('#6a9a4e');
  const push = (pts: V3[], r0: number, r1: number) => {
    const t = tubeGeo(pts, pts.map((_, i) => r0 + (r1 - r0) * (i / (pts.length - 1))), 6, 1, 1).toNonIndexed();
    t.deleteAttribute('uv');
    geos.push(tint(t, stemC));
  };
  const hub = v3(0, 0.2, 0);
  push([v3(0, 0, 0), v3(0.01, 0.1, 0), hub], 0.012, 0.01);
  // 一轮掌状复叶
  const nL = 4;
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * Math.PI * 2 + 0.5;
    const tip = v3(Math.cos(a) * 0.16, 0.25, Math.sin(a) * 0.16);
    push(bezier(hub, hub.clone().lerp(tip, 0.5).add(v3(0, 0.03, 0)), tip, 4), 0.007, 0.005);
    for (let k = -2; k <= 2; k++) {
      const la = a + k * 0.52;
      const dir = v3(Math.cos(la), -0.18 - Math.abs(k) * 0.05, Math.sin(la)).normalize();
      const size = (k === 0 ? 0.17 : Math.abs(k) === 1 ? 0.145 : 0.1) * rr(r, 0.92, 1.08);
      lb.add(SHAPES.oval, tip, dir, UP, size, v3(dir.x * 0.45, 0.88, dir.z * 0.45).normalize(), jitter(pick(leafPal, r), r, 0.1), 0.22, -0.1, 0.95);
    }
  }
  // 花葶与红果
  const top = v3(0.01, 0.44, 0.0);
  push([hub, v3(0.0, 0.33, 0.005), top], 0.008, 0.006);
  const berries: THREE.BufferGeometry[] = [];
  const red: Palette = [['#d8201a', 3], ['#ee3a22', 2], ['#b8161a', 1.5]];
  for (let i = 0; i < 16; i++) {
    const u = randDir(r); u.y = Math.abs(u.y) * 0.9 + 0.1; u.normalize();
    const s = new THREE.SphereGeometry(rr(r, 0.02, 0.026), 8, 6).toNonIndexed();
    s.deleteAttribute('uv');
    s.translate(top.x + u.x * 0.042, top.y + u.y * 0.036, top.z + u.z * 0.042);
    berries.push(tint(s, jitter(pick(red, r), r, 0.06)));
  }
  // 两朵小白花点缀在果序下方
  for (const [dx, dz] of [[0.07, 0.03], [-0.06, -0.04]]) {
    const p = v3(top.x + dx, top.y - 0.06, top.z + dz);
    push([v3(0.0, 0.34, 0.0), p], 0.004, 0.003);
    lb.add(SHAPES.flower, p, randDir(r), UP, 0.055, UP, C('#f6f2e6'), 0.3);
  }
  g.add(lb.build(), new THREE.Mesh(merge(geos.concat(berries)), vcMat()));
  g.scale.setScalar(1.35);
  return g;
}

// ====================== 清单 ======================
const group = (...ms: THREE.Object3D[]) => { const g = new THREE.Group(); ms.forEach((m) => g.add(m)); return g; };
const withTufts = (g: THREE.Group, spots: [number, number, number][], pal: Palette = GRASS) => {
  const sb = new StripBuilder();
  spots.forEach(([x, z, n], i) => tuft(sb, { seed: 500 + i * 7 + Math.round(x * 100), n, radius: 0.16, h: [0.12, 0.3], w: 0.014, bend: [0.4, 1.0], pal }, v3(x, 0, z)));
  g.add(sb.build());
  return g;
};

export const PLANTS: SpriteDef[] = [
  { key: 'rock_a', info: { kind: 'rock' }, build: () => group(
    rock({ seed: 401, size: [0.42, 0.26, 0.36], moss: 0.3 }),
    rock({ seed: 402, size: [0.2, 0.13, 0.18], pos: [0.3, 0, 0.1], moss: 0.2 }),
    rock({ seed: 403, size: [0.14, 0.09, 0.13], pos: [-0.22, 0, 0.18], moss: 0.2 })) },
  { key: 'rock_b', info: { kind: 'rock', solid: [[-0.32, -0.22, 0.32, 0.22]] }, build: () => withTufts(group(
    rock({ seed: 411, size: [0.82, 0.52, 0.66], moss: 0.5 }),
    rock({ seed: 412, size: [0.26, 0.16, 0.22], pos: [0.5, 0, 0.2], moss: 0.3 })), [[-0.42, 0.2, 14]]) },
  { key: 'rock_c', info: { kind: 'rock', solid: [[-0.5, -0.32, 0.5, 0.32]] }, build: () => withTufts(group(
    rock({ seed: 421, size: [1.2, 0.8, 0.95], moss: 0.6, cuts: 11 }),
    rock({ seed: 422, size: [0.5, 0.34, 0.42], pos: [-0.7, 0, 0.3], moss: 0.45 }),
    rock({ seed: 423, size: [0.2, 0.12, 0.18], pos: [0.62, 0, 0.42], moss: 0.2 })), [[0.6, 0.1, 16], [-0.3, 0.5, 12]]) },
  { key: 'rock_d', info: { kind: 'rock', solid: [[-0.75, -0.45, 0.75, 0.45]] }, build: () => withTufts(group(
    rock({ seed: 431, size: [1.8, 1.35, 1.3], moss: 0.6, cuts: 12 }),
    rock({ seed: 432, size: [0.7, 0.46, 0.6], pos: [1.0, 0, 0.35], moss: 0.5 }),
    rock({ seed: 433, size: [0.34, 0.2, 0.3], pos: [-0.95, 0, 0.5], moss: 0.3 })), [[-0.9, 0.1, 18], [0.5, 0.72, 14], [1.3, -0.1, 12]]) },
  { key: 'rock_e', info: { kind: 'rock', solid: [[-1.1, -0.6, 1.1, 0.6]] }, build: () => withTufts(group(
    rock({ seed: 441, size: [2.5, 1.7, 1.75], moss: 0.7, cuts: 13 }),
    rock({ seed: 442, size: [1.15, 1.05, 0.95], pos: [-1.15, 0, 0.45], moss: 0.6, cuts: 10 }),
    rock({ seed: 443, size: [0.6, 0.38, 0.5], pos: [1.2, 0, 0.75], moss: 0.5 }),
    rock({ seed: 444, size: [0.3, 0.18, 0.26], pos: [0.3, 0, 1.0], moss: 0.3 })), [[-0.5, 0.95, 20], [1.5, 0.3, 16], [-1.75, 0.1, 14], [0.8, 1.05, 12]]) },

  { key: 'grass_a', info: { kind: 'plant' }, build: () => grassSprite({ seed: 501, n: 46, radius: 0.17, h: [0.22, 0.42], w: 0.02, bend: [0.4, 1.1], pal: GRASS }) },
  { key: 'grass_b', info: { kind: 'plant' }, build: () => grassSprite({ seed: 511, n: 90, radius: 0.3, h: [0.16, 0.32], w: 0.02, bend: [0.5, 1.3], pal: GRASS_Y }) },
  { key: 'grass_c', info: { kind: 'plant' }, build: () => grassSprite({ seed: 521, n: 40, radius: 0.16, h: [0.5, 0.85], w: 0.016, bend: [0.25, 0.7], pal: GRASS_Y, tip: '#c9b25a', seedHeads: '#c9ae74', droop: 0.2 }) },
  { key: 'grass_d', info: { kind: 'plant' }, build: () => grassSprite({ seed: 531, n: 70, radius: 0.24, h: [0.3, 0.6], w: 0.018, bend: [0.4, 1.2], pal: GRASS_DRY, tip: '#e2cf86', seedHeads: '#d9c08a', droop: 0.25 }) },

  { key: 'flower_a', info: { kind: 'plant' }, build: () => flowerSprite({ seed: 601, stems: 9, radius: 0.22, h: [0.2, 0.38], petal: [['#f2c832', 3], ['#f6da5a', 2], ['#eab21e', 1.5]], center: '#c9781c', size: [0.075, 0.105] }) },
  { key: 'flower_b', info: { kind: 'plant' }, build: () => flowerSprite({ seed: 611, stems: 11, radius: 0.26, h: [0.16, 0.32], petal: [['#f6f3ea', 3], ['#ffffff', 2], ['#ece6d2', 1]], center: '#e8b82e', size: [0.07, 0.095] }) },
  { key: 'flower_c', info: { kind: 'plant' }, build: () => flowerSprite({ seed: 621, stems: 8, radius: 0.2, h: [0.3, 0.5], petal: [['#8a6cd8', 3], ['#a288e6', 2], ['#6e56c0', 2]], center: '#f0e2a0', size: [0.05, 0.065], perStem: 5 }) },
  { key: 'flower_d', info: { kind: 'plant' }, build: () => flowerSprite({ seed: 631, stems: 7, radius: 0.22, h: [0.24, 0.42], petal: [['#e0403a', 3], ['#ee6a5a', 2], ['#c82a34', 2]], center: '#2a1e1a', size: [0.1, 0.135] }) },

  { key: 'reed_a', info: { kind: 'plant' }, build: () => reedSprite(701, 12, 0.24, [1.3, 1.9], false) },
  { key: 'reed_b', info: { kind: 'plant' }, build: () => reedSprite(711, 20, 0.36, [1.2, 2.1], true) },

  { key: 'lotus_a', info: { kind: 'water' }, build: () => lotusSprite(801, false) },
  { key: 'lotus_b', info: { kind: 'water' }, build: () => lotusSprite(811, true) },

  { key: 'stump_a', info: { kind: 'plant', solid: [[-0.32, -0.26, 0.32, 0.26]] }, build: stumpSprite },
  { key: 'log_a', info: { kind: 'plant', solid: [[-1.1, -0.26, 1.1, 0.26]] }, build: logSprite },
  { key: 'mushroom_a', info: { kind: 'plant' }, build: mushroomSprite },
  { key: 'herb_a', info: { kind: 'plant', gather: 'herb' }, build: herbSprite },
];
