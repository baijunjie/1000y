import * as THREE from 'three';
import { Col, rng } from '../geo';
import {
  barkMat, bezier, clampGround, jitter, LeafBuilder, LeafShape, merge, Palette, pick, Rand, randDir, rr, SHAPES, tubeGeo, UP, V3, v3,
} from './flora';

export interface LeafSpec {
  shape: LeafShape;
  size: [number, number];
  palette: Palette;
  /** 叶片下垂程度 */
  droop?: number;
  fold?: number;
  width?: number;
  /** 混入的第二种叶（如花） */
  alt?: { shape: LeafShape; size: [number, number]; palette: Palette; ratio: number; width?: number };
}

export interface Cluster { c: V3; r: number; flat: number; }

export interface BroadSpec {
  seed: number;
  trunkH: number;
  trunkR: number;
  bend: number;
  lean: [number, number];
  /** 树冠椭球：中心相对树干顶端 */
  crown: { c: [number, number, number]; r: [number, number, number]; n: number; cr: [number, number]; flat: number; cut: number; shell: number; space?: number };
  nMain: number;
  bark: Col;
  barkKind?: 'rough' | 'plate' | 'smooth';
  leaf: LeafSpec;
  /** 每簇叶片数 = leaves × r² */
  leaves: number;
  roots?: number;
  /** 细枝可见程度：簇内放射小枝数量 */
  twigs?: number;
}

const tmp = v3();

/**
 * 板根：直接把树干底部的截面做成带棱的花瓣形并向外张开，
 * 比另接几根「根管」自然得多。geo 必须是 tubeGeo(radial) 生成的树干。
 */
export function flareBase(geo: THREE.BufferGeometry, r: Rand, R: number, lobes: number, radial: number, height = 0.7) {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const angs: number[] = [], amps: number[] = [];
  for (let i = 0; i < lobes; i++) { angs.push((i / lobes) * Math.PI * 2 + rr(r, -0.35, 0.35)); amps.push(rr(r, 0.5, 1.0)); }
  const ring = radial + 1;
  const rings = Math.floor(p.count / ring);
  for (let i = 0; i < rings; i++) {
    // 环心
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < radial; j++) { cx += p.getX(i * ring + j); cy += p.getY(i * ring + j); cz += p.getZ(i * ring + j); }
    cx /= radial; cy /= radial; cz /= radial;
    const A = Math.exp(-Math.max(0, cy) / (height * 0.26)) * 0.55;
    if (A < 0.01) continue;
    for (let j = 0; j <= radial; j++) {
      const k = i * ring + j;
      const dx = p.getX(k) - cx, dz = p.getZ(k) - cz;
      const th = Math.atan2(dz, dx);
      let f = 0;
      for (let l = 0; l < lobes; l++) f = Math.max(f, amps[l] * Math.pow(Math.max(0, Math.cos(th - angs[l])), 5));
      const sc = 1 + A * (0.08 + f);
      p.setXYZ(k, cx + dx * sc, p.getY(k), cz + dz * sc);
    }
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  // 接缝处两列顶点位置相同，把法线取平均
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < rings; i++) {
    const a = i * ring, b = i * ring + radial;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  void R;
  return geo;
}

/** 生成带板根的树干 */
export function trunkGeo(r: Rand, pts: V3[], radii: number[], R: number, lobes = 5): THREE.BufferGeometry {
  // 底部加密几环，让板根的收束曲线平滑
  const P: V3[] = [], Rr: number[] = [];
  const sub = 5;
  for (let k = 0; k < sub; k++) {
    const t = k / sub;
    P.push(pts[0].clone().lerp(pts[1], t));
    Rr.push(radii[0] + (radii[1] - radii[0]) * t);
  }
  for (let i = 1; i < pts.length; i++) { P.push(pts[i]); Rr.push(radii[i]); }
  const radial = 18;
  return flareBase(tubeGeo(P, Rr, radial, 3, 0.9, false), r, R, lobes, radial, Math.min(0.9, R * 3.2));
}

function trunkPath(r: Rand, H: number, R: number, bend: number, lean: [number, number], n = 9) {
  const a = r() * Math.PI * 2, b = a + Math.PI / 2 + (r() - 0.5);
  const pts: V3[] = [], radii: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin(Math.PI * t) * bend, s2 = Math.sin(Math.PI * 2 * t) * bend * 0.45;
    pts.push(v3(lean[0] * t * t + Math.cos(a) * s1 + Math.cos(b) * s2, H * t, lean[1] * t * t + Math.sin(a) * s1 + Math.sin(b) * s2));
    radii.push(R * (1 - 0.32 * t) * (1 + 0.4 * Math.exp((-t * H) / 0.28)));
  }
  return { pts, radii };
}

function sampleCrown(r: Rand, C: V3, spec: BroadSpec['crown']): Cluster[] {
  const out: Cluster[] = [];
  const space = spec.space ?? 0.62;
  let tries = 0;
  while (out.length < spec.n && tries++ < 4000) {
    const u = randDir(r);
    if (u.y < spec.cut) continue;
    const rho = spec.shell + (1 - spec.shell) * Math.pow(r(), 0.5);
    const p = v3(C.x + u.x * spec.r[0] * rho, C.y + u.y * spec.r[1] * rho, C.z + u.z * spec.r[2] * rho);
    const cr = rr(r, spec.cr[0], spec.cr[1]);
    let ok = true;
    for (const q of out) if (q.c.distanceTo(p) < space * (cr + q.r)) { ok = false; break; }
    if (ok) out.push({ c: p, r: cr, flat: spec.flat });
  }
  return out;
}

/** 在簇内铺叶。crownR 为树冠竖向半径，用于自下而上的明度渐变 */
export function leafCluster(lb: LeafBuilder, r: Rand, cl: Cluster, crownC: V3, leaf: LeafSpec, count: number, tintC?: THREE.Color, crownRy = 1.5) {
  const u = v3(), p = v3(), nh = v3(), dir = v3(), shade = v3(), tang = v3();
  for (let i = 0; i < count; i++) {
    u.copy(randDir(r));
    if (u.y < -0.45 && r() < 0.75) u.y = -u.y;
    // 四分之一的叶片填在簇心，颜色压暗，挡住透光并做出层次
    const core = r() < 0.24;
    const rho = core ? 0.2 + 0.4 * r() : 0.6 + 0.4 * Math.pow(r(), 0.6);
    p.set(cl.c.x + u.x * cl.r * rho, cl.c.y + u.y * cl.r * cl.flat * rho, cl.c.z + u.z * cl.r * rho);
    tang.copy(randDir(r));
    nh.copy(u).addScaledVector(UP, 0.7).addScaledVector(tang, 0.55).normalize();
    dir.copy(u).multiplyScalar(0.5).addScaledVector(randDir(r), 0.9).addScaledVector(UP, -(leaf.droop ?? 0.3)).normalize();
    tmp.copy(p).sub(crownC).normalize();
    shade.copy(u).multiplyScalar(0.55).addScaledVector(tmp, 0.4).addScaledVector(UP, 0.3).addScaledVector(nh, 0.12).normalize();
    const useAlt = !core && leaf.alt && r() < leaf.alt.ratio;
    const sp = useAlt ? leaf.alt! : leaf;
    let col = pick(sp.palette, r);
    if (tintC && !useAlt && r() < 0.6) col = col.lerp(tintC, 0.6);
    col = jitter(col, r, 0.14, 0.012, 0.05);
    const ty = Math.min(1, Math.max(0, ((p.y - crownC.y) / crownRy + 1) * 0.5));
    const k = (0.66 + 0.42 * ty) * (0.9 + 0.14 * Math.max(-0.5, u.y)) * (core ? 0.55 : 1);
    if (!useAlt) col.multiplyScalar(k); else col.multiplyScalar(0.85 + 0.15 * ty);
    lb.add(sp.shape, p, dir, nh, rr(r, sp.size[0], sp.size[1]), shade, col, leaf.fold ?? 0.15, 0.1, sp.width ?? 1);
  }
}

export function buildBroadleaf(s: BroadSpec): THREE.Group {
  const r = rng(s.seed);
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const tr = trunkPath(r, s.trunkH, s.trunkR, s.bend, s.lean);
  geos.push(trunkGeo(r, tr.pts, tr.radii, s.trunkR, s.roots ?? 5));
  const T = tr.pts[tr.pts.length - 1];
  const C = v3(T.x + s.crown.c[0], T.y + s.crown.c[1], T.z + s.crown.c[2]);
  const clusters = sampleCrown(r, C, s.crown);

  // 主干延伸进树冠
  const topP = v3(C.x + rr(r, -0.2, 0.2), C.y + s.crown.r[1] * 0.45, C.z + rr(r, -0.2, 0.2));
  const leader = bezier(T, v3((T.x + topP.x) / 2 + rr(r, -0.3, 0.3), (T.y + topP.y) / 2, (T.z + topP.z) / 2 + rr(r, -0.3, 0.3)), topP, 6);
  const rT = tr.radii[tr.radii.length - 1];
  geos.push(tubeGeo(leader, leader.map((_, i) => rT * (0.82 - 0.7 * (i / 6)) + 0.012), 8, 2, 0.9));

  // 分组：按方位角分给主枝，靠近轴线的归主干
  const groups: Cluster[][] = Array.from({ length: s.nMain }, () => []);
  const axis: Cluster[] = [];
  const a0 = r() * Math.PI * 2;
  for (const cl of clusters) {
    const dx = cl.c.x - C.x, dz = cl.c.z - C.z;
    if (Math.hypot(dx / s.crown.r[0], dz / s.crown.r[2]) < 0.3) { axis.push(cl); continue; }
    let az = Math.atan2(dz, dx) - a0;
    az = ((az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    groups[Math.min(s.nMain - 1, Math.floor((az / (Math.PI * 2)) * s.nMain))].push(cl);
  }
  const twig = (from: V3, cl: Cluster, r0: number) => {
    const d = cl.c.distanceTo(from);
    const mid = from.clone().lerp(cl.c, 0.5).add(v3(rr(r, -0.12, 0.12) * d, 0.16 * d, rr(r, -0.12, 0.12) * d));
    const pts = bezier(from, mid, cl.c, 6);
    geos.push(tubeGeo(pts, pts.map((_, i) => r0 * (1 - 0.8 * (i / 6)) + 0.01), 6, 1, 0.9));
    // 簇内放射小枝
    const n = s.twigs ?? 4;
    for (let k = 0; k < n; k++) {
      const u = randDir(r); u.y = Math.abs(u.y) * 0.6 + 0.1;
      const e = v3(cl.c.x + u.x * cl.r * 0.8, cl.c.y + u.y * cl.r * cl.flat * 0.8, cl.c.z + u.z * cl.r * 0.8);
      const m = cl.c.clone().lerp(e, 0.5).add(v3(0, 0.08 * cl.r, 0));
      geos.push(tubeGeo(bezier(cl.c, m, e, 3), [r0 * 0.22 + 0.01, r0 * 0.16 + 0.008, 0.01, 0.006], 5, 1, 0.9));
    }
  };
  const pointOn = (pts: V3[], t: number) => {
    const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f));
    return pts[i].clone().lerp(pts[i + 1], f - i);
  };
  for (const cl of axis) twig(pointOn(leader, rr(r, 0.35, 0.85)), cl, rT * 0.34);
  groups.forEach((grp, gi) => {
    if (!grp.length) return;
    const G = v3();
    grp.forEach((c) => G.add(c.c));
    G.multiplyScalar(1 / grp.length);
    const S = pointOn(tr.pts, rr(r, 0.78, 0.98));
    void gi;
    const E = S.clone().lerp(G, 0.66);
    const d = G.distanceTo(S);
    const P1 = v3(S.x + (G.x - S.x) * 0.22, S.y + d * 0.34, S.z + (G.z - S.z) * 0.22);
    const limb = bezier(S, P1, E, 7);
    const r0 = rT * rr(r, 0.52, 0.66);
    geos.push(tubeGeo(limb, limb.map((_, i) => r0 * (1 - 0.6 * (i / 7))), 8, 2, 0.9));
    for (const cl of grp) twig(pointOn(limb, rr(r, 0.5, 1.0)), cl, r0 * 0.42);
  });

  const trunk = new THREE.Mesh(clampGround(merge(geos)), barkMat(s.bark, s.barkKind ?? 'rough'));
  g.add(trunk);

  const lb = new LeafBuilder();
  for (const cl of clusters) {
    const tintC = pick(s.leaf.palette, r);
    leafCluster(lb, r, cl, C, s.leaf, Math.round(s.leaves * cl.r * cl.r), tintC, s.crown.r[1] + s.crown.cr[1] * s.crown.flat);
  }
  g.add(lb.build());
  return g;
}

// ---------- 松 ----------
export interface PineSpec {
  seed: number; height: number; trunkR: number; bend: number; lean: [number, number];
  tiers: number; firstTier: number; spread: number; bark: Col; palette: Palette; padR: [number, number]; needles: number;
}

function needleTuft(lb: LeafBuilder, r: Rand, p: V3, axis: V3, shade: V3, col: THREE.Color, size: number) {
  // 一簇针叶用一片朝上的锯齿放射形叶片表示：俯视下读作松针团
  const dir = randDir(r); dir.addScaledVector(axis, -dir.dot(axis)).normalize();
  lb.add(SHAPES.tuft, p, dir, axis, size, shade, col, -0.35, 0, 1);
}

export function buildPine(s: PineSpec): THREE.Group {
  const r = rng(s.seed);
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const tr = trunkPath(r, s.height, s.trunkR, s.bend, s.lean, 12);
  // 松树树干向上收得更细
  tr.radii = tr.radii.map((x, i) => x * (1 - 0.5 * Math.pow(i / 12, 1.5)));
  geos.push(trunkGeo(r, tr.pts, tr.radii, s.trunkR, 5));
  const pointOn = (t: number) => {
    const f = t * (tr.pts.length - 1), i = Math.min(tr.pts.length - 2, Math.floor(f));
    return tr.pts[i].clone().lerp(tr.pts[i + 1], f - i);
  };
  const lb = new LeafBuilder();
  const top = tr.pts[tr.pts.length - 1];
  const pad = (c: V3, pr: number) => {
    // 扁平的针叶云片：上表面铺满针簇，下层压暗
    const count = Math.round(s.needles * pr * pr);
    const p = v3(), shade = v3(), axis = v3();
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, q = Math.sqrt(r()), rad = q * pr;
      const dome = Math.sqrt(Math.max(0, 1 - q * q));
      const lower = r() < 0.3;
      const hh = lower ? rr(r, -0.12, 0.05) : dome * pr * 0.36 * rr(r, 0.55, 1);
      p.set(c.x + Math.cos(a) * rad, c.y + hh, c.z + Math.sin(a) * rad * 0.92);
      shade.set(Math.cos(a) * q * 0.8, 0.7 + dome * 0.5, Math.sin(a) * q * 0.8).normalize();
      axis.set(Math.cos(a) * q * 0.7 + rr(r, -0.25, 0.25), 1, Math.sin(a) * q * 0.7 + rr(r, -0.25, 0.25)).normalize();
      const col = jitter(pick(s.palette, r), r, 0.16, 0.012, 0.05).multiplyScalar(lower ? 0.6 : 0.82 + 0.3 * dome);
      needleTuft(lb, r, p, axis, shade, col, rr(r, 0.26, 0.38));
    }
  };
  for (let t = 0; t < s.tiers; t++) {
    const f = s.tiers === 1 ? 0 : t / (s.tiers - 1);
    const ty = s.firstTier + (0.93 - s.firstTier) * f;
    const base = pointOn(ty);
    const n = Math.max(2, Math.round(rr(r, 3, 5) * (1 - 0.35 * f)));
    const a0 = r() * Math.PI * 2;
    const len = s.spread * (1 - 0.62 * f) * rr(r, 0.85, 1.1);
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + rr(r, -0.35, 0.35);
      const l = len * rr(r, 0.7, 1.1);
      const e = v3(base.x + Math.cos(a) * l, base.y + rr(r, -0.15, 0.3) * l, base.z + Math.sin(a) * l);
      const m = v3(base.x + Math.cos(a) * l * 0.5, base.y + 0.28 * l, base.z + Math.sin(a) * l * 0.5);
      const pts = bezier(base, m, e, 6);
      const r0 = tr.radii[Math.round(ty * 12)] * 0.5;
      geos.push(tubeGeo(pts, pts.map((_, i) => r0 * (1 - 0.75 * (i / 6)) + 0.012), 7, 2, 0.9));
      pad(e, rr(r, s.padR[0], s.padR[1]) * (1 - 0.25 * f));
      if (l > 1.2) pad(pts[4].clone().add(v3(rr(r, -0.3, 0.3), 0.12, rr(r, -0.3, 0.3))), rr(r, s.padR[0], s.padR[1]) * 0.75);
      // 小侧枝
      if (l > 1.0) {
        const side = a + (r() < 0.5 ? 1 : -1) * rr(r, 0.6, 1.0);
        const b0 = pts[3];
        const e2 = v3(b0.x + Math.cos(side) * l * 0.45, b0.y + 0.1 * l, b0.z + Math.sin(side) * l * 0.45);
        geos.push(tubeGeo(bezier(b0, b0.clone().lerp(e2, 0.5).add(v3(0, 0.1, 0)), e2, 4), [r0 * 0.4, r0 * 0.32, r0 * 0.24, r0 * 0.16, 0.012], 6, 1, 0.9));
        pad(e2, rr(r, s.padR[0], s.padR[1]) * 0.7);
      }
    }
  }
  pad(top.clone().add(v3(0, 0.05, 0)), s.padR[1] * 0.85);
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2;
    pad(top.clone().add(v3(Math.cos(a) * 0.55, -0.25, Math.sin(a) * 0.55)), s.padR[0] * 0.9);
  }
  g.add(new THREE.Mesh(clampGround(merge(geos)), barkMat(s.bark, 'plate')));
  g.add(lb.build());
  return g;
}

// ---------- 柳 ----------
export function buildWillow(seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const H = 2.8, R = 0.3;
  const tr = trunkPath(r, H, R, 0.22, [0.5, 0.15]);
  geos.push(trunkGeo(r, tr.pts, tr.radii, R, 6));
  const T = tr.pts[tr.pts.length - 1];
  const pal: Palette = [['#8fa446', 4], ['#a9b654', 3], ['#75913a', 3], ['#c4bd52', 1.4], ['#5f7f34', 1.5]];
  const lb = new LeafBuilder();
  const C = v3(T.x, T.y + 2.4, T.z);
  const strand = (from: V3, len: number, out: V3) => {
    // 垂丝：先随枝条惯性外伸，再垂直下落
    const pts: V3[] = [];
    const n = Math.max(6, Math.round(len / 0.12));
    const sway = v3(rr(r, -0.25, 0.25), 0, rr(r, -0.25, 0.25));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const k = 1 - Math.exp(-t * 5);
      pts.push(v3(
        from.x + out.x * 0.5 * k + sway.x * t * t * len * 0.3,
        Math.max(0.25, from.y - len * t + 0.08 * Math.sin(t * 9)),
        from.z + out.z * 0.5 * k + sway.z * t * t * len * 0.3,
      ));
    }
    geos.push(tubeGeo(pts, pts.map(() => 0.008), 4, 1, 1));
    const dir = v3(), nh = v3(), shade = v3();
    for (let i = 1; i <= n; i++) {
      for (let k = 0; k < 5; k++) {
        const p = pts[i - 1].clone().lerp(pts[i], r());
        const side = randDir(r); side.y = 0;
        dir.copy(side).multiplyScalar(0.6).addScaledVector(UP, -1).normalize();
        nh.copy(side).addScaledVector(UP, 0.4).normalize();
        tmp.copy(p).sub(C); tmp.y *= 0.4; tmp.normalize();
        shade.copy(tmp).multiplyScalar(0.75).addScaledVector(UP, 0.5).addScaledVector(side, 0.2).normalize();
        lb.add(SHAPES.lance, p, dir, nh, rr(r, 0.13, 0.2), shade, jitter(pick(pal, r), r, 0.14, 0.012, 0.05).multiplyScalar(0.72 + 0.4 * Math.min(1, p.y / 5.5)), 0.1, 0.2, 1.7);
      }
    }
  };
  const nLimb = 6;
  for (let i = 0; i < nLimb; i++) {
    const a = (i / nLimb) * Math.PI * 2 + rr(r, -0.3, 0.3);
    const l = rr(r, 1.5, 2.2);
    const E = v3(T.x + Math.cos(a) * l, T.y + rr(r, 2.2, 3.3), T.z + Math.sin(a) * l * 0.9);
    const P1 = v3(T.x + Math.cos(a) * l * 0.25, T.y + (E.y - T.y) * 0.8, T.z + Math.sin(a) * l * 0.25);
    const limb = bezier(T, P1, E, 8);
    const r0 = R * 0.5;
    geos.push(tubeGeo(limb, limb.map((_, k) => r0 * (1 - 0.8 * (k / 8)) + 0.014), 8, 2, 0.9));
    // 枝梢继续拱出并下垂
    for (let k = 2; k <= 8; k++) {
      const nS = k >= 5 ? 6 : 3;
      // 枝梢的叶团，填满树冠顶部
      if (k >= 4) leafCluster(lb, r, { c: limb[k].clone().add(v3(rr(r, -0.3, 0.3), 0.25, rr(r, -0.3, 0.3))), r: rr(r, 0.55, 0.8), flat: 0.6 }, C,
        { shape: SHAPES.lance, size: [0.14, 0.2], palette: pal, droop: 0.9, width: 1.7 }, 260, undefined, 2.2);
      for (let j = 0; j < nS; j++) {
        const b = a + rr(r, -1.5, 1.5);
        const outL = rr(r, 0.3, 0.85);
        const from = v3(limb[k].x + Math.cos(b) * outL, limb[k].y + rr(r, 0.0, 0.4), limb[k].z + Math.sin(b) * outL);
        const mid = limb[k].clone().lerp(from, 0.5).add(v3(0, 0.3, 0));
        const arc = bezier(limb[k], mid, from, 4);
        geos.push(tubeGeo(arc, [0.03, 0.024, 0.018, 0.013, 0.009], 5, 1, 0.9));
        strand(from, Math.min(from.y - 0.4, rr(r, 2.4, 4.4)), v3(Math.cos(b), 0, Math.sin(b)));
      }
    }
  }
  g.add(new THREE.Mesh(clampGround(merge(geos)), barkMat('#7d6a52', 'rough')));
  g.add(lb.build());
  return g;
}

// ---------- 竹 ----------
export function buildBamboo(seed: number, culms: number, height: [number, number], spreadR: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const cg: THREE.BufferGeometry[] = [], bg: THREE.BufferGeometry[] = [];
  const lb = new LeafBuilder();
  const pal: Palette = [['#4f8a3c', 4], ['#63a046', 3], ['#3c7434', 3], ['#86b458', 1.6], ['#a9b85c', 0.6]];
  const culmCols: Col[] = ['#7fae52', '#6c9e48', '#8fb85c', '#78a44e'];
  const mats = culmCols.map((c) => barkMat(c, 'bamboo'));
  const perMat: THREE.BufferGeometry[][] = mats.map(() => []);
  for (let c = 0; c < culms; c++) {
    const a = (c / culms) * Math.PI * 2 + rr(r, -0.5, 0.5);
    const rad = c === 0 ? 0 : spreadR * rr(r, 0.45, 1);
    const base = v3(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    const H = rr(r, height[0], height[1]);
    const R0 = rr(r, 0.05, 0.066) * (0.75 + 0.25 * (H / height[1]));
    const leanA = c === 0 ? r() * Math.PI * 2 : a + rr(r, -0.6, 0.6);
    const lean = rr(r, 0.03, 0.1), droop = rr(r, 0.35, 0.9);
    const node = 0.4;
    const n = Math.round(H / 0.2);
    const pts: V3[] = [], radii: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // 上部弯垂
      const off = lean * H * t + droop * Math.pow(Math.max(0, t - 0.45) / 0.55, 2.2) * 1.4;
      const dy = droop * Math.pow(Math.max(0, t - 0.6) / 0.4, 2.5) * 0.9;
      pts.push(v3(base.x + Math.cos(leanA) * off, H * t - dy, base.z + Math.sin(leanA) * off));
      radii.push(R0 * (1 - 0.78 * t) + 0.004);
    }
    perMat[c % mats.length].push(tubeGeo(pts, radii, 8, 1, 1 / node));
    void cg;
    // 枝与叶
    const at = (t: number) => {
      const f = t * n, i = Math.min(n - 1, Math.floor(f));
      return pts[i].clone().lerp(pts[i + 1], f - i);
    };
    const nodes = Math.floor(H / node);
    for (let k = Math.floor(nodes * 0.3); k < nodes; k++) {
      const t = (k * node) / H;
      const p = at(t);
      const nb = t > 0.92 ? 2 : 3;
      for (let j = 0; j < nb; j++) {
        const ba = k * 2.4 + j * 2.1 + rr(r, -0.5, 0.5);
        const bl = rr(r, 0.55, 1.15) * (1 - 0.5 * Math.pow(t, 3));
        const e = v3(p.x + Math.cos(ba) * bl * 0.85, p.y + bl * rr(r, 0.05, 0.4), p.z + Math.sin(ba) * bl * 0.85);
        const m = p.clone().lerp(e, 0.5).add(v3(0, bl * 0.2, 0));
        const br = bezier(p, m, e, 4);
        bg.push(tubeGeo(br, [0.011, 0.009, 0.007, 0.005, 0.004], 4, 1, 1));
        // 沿枝的叶组
        for (let q = 1; q <= 4; q++) {
          const bp = br[q];
          const nl = q === 4 ? 5 : 3;
          for (let l = 0; l < nl; l++) {
            const la = ba + rr(r, -1.2, 1.2);
            const dir = v3(Math.cos(la), rr(r, -0.75, -0.15), Math.sin(la)).normalize();
            const nh = v3(rr(r, -0.3, 0.3), 1, rr(r, -0.3, 0.3)).normalize();
            tmp.set(bp.x - pts[Math.round(t * n)].x, 0, bp.z - pts[Math.round(t * n)].z).normalize();
            const shade = v3(tmp.x * 0.55, 0.8, tmp.z * 0.55).addScaledVector(dir, 0.15).normalize();
            lb.add(SHAPES.lance, bp, dir, nh, rr(r, 0.17, 0.26), shade, jitter(pick(pal, r), r, 0.14, 0.012, 0.05), 0.12, 0.25, 1.5);
          }
        }
      }
    }
  }
  perMat.forEach((list, i) => { if (list.length) g.add(new THREE.Mesh(merge(list), mats[i])); });
  if (bg.length) g.add(new THREE.Mesh(merge(bg), barkMat('#7f9648', 'smooth')));
  g.add(lb.build());
  // 竹笋与落地枯叶点缀
  return g;
}

// ---------- 枯树 ----------
export function buildDead(seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const R = 0.25;
  const grow = (from: V3, dir: V3, len: number, r0: number, depth: number) => {
    const n = 6;
    const pts: V3[] = [from.clone()];
    const d = dir.clone();
    for (let i = 1; i <= n; i++) {
      d.addScaledVector(randDir(r), depth === 0 ? 0.13 : 0.3).addScaledVector(UP, depth === 0 ? 0.12 : 0.1).normalize();
      pts.push(pts[i - 1].clone().addScaledVector(d, len / n));
    }
    const r1 = depth >= 4 ? 0.007 : r0 * 0.58;
    const radii = pts.map((_, i) => r0 + (r1 - r0) * (i / n));
    if (depth === 0) {
      radii.forEach((x, i) => (radii[i] = x * (1 + 0.4 * Math.exp((-pts[i].y) / 0.25))));
      geos.push(trunkGeo(r, pts, radii, R, 5));
    } else geos.push(tubeGeo(pts, radii, 7, 1, 0.9));
    if (depth >= 4) return;
    const kids = depth === 0 ? 4 : r() < 0.55 ? 2 : 3;
    for (let k = 0; k < kids; k++) {
      const t = k === 0 ? 1 : depth === 0 ? rr(r, 0.5, 0.95) : rr(r, 0.35, 0.95);
      const f = t * n, i = Math.min(n - 1, Math.floor(f));
      const p = pts[i].clone().lerp(pts[i + 1], f - i);
      const side = randDir(r); side.y = Math.abs(side.y) * 0.3;
      const nd = d.clone().multiplyScalar(k === 0 ? 1 : 0.45).addScaledVector(side.normalize(), k === 0 ? 0.45 : 1.0).addScaledVector(UP, 0.3).normalize();
      grow(p, nd, len * rr(r, 0.55, 0.74), r1 * (k === 0 ? 0.95 : 0.66), depth + 1);
    }
    // 断枝茬
    if (depth === 1 && r() < 0.6) {
      const p = pts[2];
      const sd = randDir(r); sd.y = 0.2;
      geos.push(tubeGeo([p.clone(), p.clone().addScaledVector(sd.normalize(), 0.22)], [r0 * 0.5, r0 * 0.34], 6, 1, 0.9));
    }
  };
  grow(v3(0, 0, 0), v3(0.06, 1, 0.02).normalize(), 2.5, R, 0);
  g.add(new THREE.Mesh(clampGround(merge(geos)), barkMat('#857a6c', 'rough')));
  return g;
}

// ---------- 灌木 ----------
export interface BushSpec {
  seed: number; w: number; h: number; n: number; cr: [number, number]; leaf: LeafSpec; leaves: number; stems: Col;
  berries?: { color: Col; n: number; r: number };
}
export function buildBush(s: BushSpec): THREE.Group {
  const r = rng(s.seed);
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const lb = new LeafBuilder();
  const C = v3(0, s.h * 0.35, 0);
  const cls: Cluster[] = [];
  let tries = 0;
  while (cls.length < s.n && tries++ < 2000) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * s.w * 0.5;
    const cr = rr(r, s.cr[0], s.cr[1]);
    const dome = Math.sqrt(Math.max(0, 1 - Math.pow(rad / (s.w * 0.5), 2)));
    const p = v3(Math.cos(a) * rad, Math.max(cr * 0.75, (s.h - cr * 0.8) * dome * rr(r, 0.7, 1)), Math.sin(a) * rad * 0.9);
    let ok = true;
    for (const q of cls) if (q.c.distanceTo(p) < 0.6 * (cr + q.r)) { ok = false; break; }
    if (ok) cls.push({ c: p, r: cr, flat: 0.85 });
  }
  for (const cl of cls) {
    const b = v3(cl.c.x * 0.2, 0, cl.c.z * 0.2);
    const m = b.clone().lerp(cl.c, 0.5).add(v3(0, 0.1, 0));
    geos.push(tubeGeo(bezier(b, m, cl.c, 4), [0.03, 0.025, 0.02, 0.014, 0.008], 5, 1, 0.9));
    leafCluster(lb, r, cl, C, s.leaf, Math.round(s.leaves * cl.r * cl.r), pick(s.leaf.palette, r), s.h * 0.6);
  }
  g.add(new THREE.Mesh(clampGround(merge(geos)), barkMat(s.stems, 'smooth')));
  g.add(lb.build());
  if (s.berries) {
    const sph = new THREE.SphereGeometry(s.berries.r, 8, 6);
    const im = new THREE.InstancedMesh(sph, new THREE.MeshStandardMaterial({ color: new THREE.Color(s.berries.color as any) }), s.berries.n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < s.berries.n; i++) {
      const cl = cls[Math.floor(r() * cls.length)];
      const u = randDir(r); u.y = Math.abs(u.y) * 0.8 + 0.1; u.normalize();
      m4.makeTranslation(cl.c.x + u.x * cl.r * 0.98, cl.c.y + u.y * cl.r * cl.flat * 0.98, cl.c.z + u.z * cl.r * 0.98);
      im.setMatrixAt(i, m4);
    }
    im.frustumCulled = false;
    g.add(im);
  }
  return g;
}
