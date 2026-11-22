import * as THREE from 'three';
import {
  CAnim, idlePose, LegSpec, loft, qp, QPose, qtrack, QuadRig, runPose, RunSpec, Sec, skinLeg, smooth, surfAt, walkPose, WalkSpec, WFn,
} from './creature_quad';
import { canvasTex, cyl, ellipsoid, fbm, mat, mesh, tube } from './geo';
import { Ribbon } from './skin';

// ============================================================
// 四足动物：蒙皮的连续躯体。
// 躯干—颈—头是一整条沿 Z 的放样体（零姿势下颈与头平伸），四肢是连续的管状网格，
// 关节处骨骼权重平滑过渡；耳、眼、牙、角等小件刚性挂在头骨上。
// ============================================================
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mul = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
/** 0 = 腹部，1 = 背脊（放样体的 u：0/1 在背，0.5 在腹） */
const topness = (u: number) => Math.abs(u - 0.5) * 2;
/** 顺毛方向（沿身长）拉长的毛丝噪声 */
const hair = (u: number, v: number, seed: number, amp = 0.22) => 1 - amp / 2 + amp * fbm(u * 64, v * 22, 64, 3, seed);
/** 以 c 为中心、半宽 w 的钟形 */
const bell = (x: number, c: number, w: number) => Math.exp(-Math.pow((x - c) / w, 2));
const DEGR = Math.PI / 180;
const DARK = '#15100d';

/** 毛流凹凸：沿 v（顺毛）拉长的细丝 */
const furBump = () => canvasTex('fur_bump', 256, (u, v) => {
  const g = 0.5 + (fbm(u * 120, v * 44, 120, 3, 9) - 0.5) * 1.3;
  return [g, g, g];
}, false);

function furMat(key: string, fn: (u: number, v: number) => RGB, size = 256, gloss = 0.1, bumpScale = 0.8): THREE.MeshLambertMaterial {
  return mat('#ffffff', { map: canvasTex('fur2_' + key, size, fn), bump: furBump(), bumpScale, gloss });
}
const solid = (c: RGB | string, gloss = 0.1) => mat(typeof c === 'string' ? c : hex(c), { kind: 'fur', gloss });
const shiny = (c: string, gloss = 0.8) => mat(c, { kind: 'flat', gloss });

const cap = (z: number, y = 0): Sec => ({ z, w: 0.004, up: 0.004, dn: 0.004, y });
const S = (z: number, w: number, up: number, dn: number, y = 0): Sec => ({ z, w, up, dn, y });

/** 躯干—颈—头：一整条蒙皮放样体。返回细分后的截面（相对躯干原点），供在体表定位小件 */
function skinBody(rig: QuadRig, keys: Sec[], material: THREE.Material, radial = 26, wfn?: WFn): Sec[] {
  const secs = smooth(keys, 3);
  const g = loft(secs, radial, wfn ?? rig.bodyW);
  g.translate(0, rig.spec.spineY, 0);
  rig.skin(g, material);
  return secs;
}
/** 躯干相对坐标 → 头骨局部坐标 */
const toHead = (rig: QuadRig, p: [number, number, number]): [number, number, number] =>
  [p[0], p[1] - rig.spec.neckAt[1], p[2] - rig.spec.neckAt[2] - rig.spec.neckLen];
/** 贴图 v → 躯干相对的 z（画布的行自上而下，对应放样体从头到尾） */
const zOf = (keys: Sec[], v: number) => keys[0].z + (1 - v) * (keys[keys.length - 1].z - keys[0].z);

/** 立耳：外廓 + 耳蜗，绕根部转向 */
function ear(outer: THREE.Material, inner: THREE.Material, w: number, h: number, round = false): THREE.Group {
  const g = new THREE.Group();
  if (round) {
    g.add(mesh(ellipsoid(w, h, w * 0.32), outer, { p: [0, h * 0.75, 0] }));
    g.add(mesh(ellipsoid(w * 0.68, h * 0.7, w * 0.2), inner, { p: [0, h * 0.72, w * 0.2] }));
  } else {
    const o = new THREE.CylinderGeometry(w * 0.16, w, h, 12); o.scale(1, 1, 0.5); o.translate(0, h / 2, 0);
    const i = new THREE.CylinderGeometry(w * 0.08, w * 0.66, h * 0.8, 10); i.scale(1, 1, 0.34); i.translate(0, h * 0.44, w * 0.24);
    g.add(mesh(o, outer), mesh(i, inner));
  }
  return g;
}

// ============================================================
// 通用动作
// ============================================================
interface Motion {
  base: QPose;
  walk: WalkSpec;
  run: RunSpec;
  walkDur: number;
  runDur: number;
  /** 侧卧时躯干中心高度、四足向侧面伸出的距离 */
  lie: number;
  reachF: number;
  reachH: number;
  tailWind: number;
}

function hitPose(m: Motion): (t: number) => QPose {
  const b = m.base;
  return qtrack([
    [0, qp({ ...b, pos: [0.02, -0.05, -0.13], rot: [-7, -6, 7], fore: [-4, -8, 0], neck: [b.neck[0] + 10, -22], head: [b.head[0] - 12, -16, 12], jaw: 18,
      fl: [0, 0.06, -0.04, -10], fr: [0, 0, 0.02, 0], hl: [0, 0, 0.03, 0], hr: [0, 0, 0, 0] })],
    [1, qp({ ...b, pos: [0.01, -0.04, -0.07], rot: [-2, -2, 2], neck: [b.neck[0] + 3, -8], head: [b.head[0] - 3, -6, 4], jaw: 6 })],
  ]);
}

function diePose(rig: QuadRig, m: Motion): (t: number) => QPose {
  const b = m.base, sp = rig.spec;
  const drop = -(sp.spineY - m.lie);
  const fx = sp.front ? sp.front.foot[0] : 0, hx = sp.hind.foot[0];
  const fj = sp.front ? sp.front.joint[0] : 0, hj = sp.hind.joint[0];
  const fp = sp.front ? sp.front.pawH : 0, hp = sp.hind.pawH;
  const tx = 0.16;
  // 侧卧：背朝 −X，四足伸向 +X；左侧（上方）的腿略高
  const lie = (k: number): Partial<QPose> => ({
    fl: [(tx + m.reachF - fx) * k, Math.max(0, m.lie + fj - fp) * k, 0.1 * k, 0],
    fr: [(tx + m.reachF + fx) * k, Math.max(0, m.lie - fj - fp) * k, 0.02 * k, 0],
    hl: [(tx + m.reachH - hx) * k, Math.max(0, m.lie + hj - hp) * k, -0.02 * k, 0],
    hr: [(tx + m.reachH + hx) * k, Math.max(0, m.lie - hj - hp) * k, -0.1 * k, 0],
  });
  return qtrack([
    [0, qp({ ...b, pos: [0.02, -0.05, -0.1], rot: [-6, -4, 8], neck: [b.neck[0] + 8, -16], head: [b.head[0] - 10, -12, 10], jaw: 20 })],
    [0.3, qp({ ...b, pos: [0.06, drop * 0.42, -0.08], rot: [2, 0, 30], neck: [b.neck[0] - 6, -4], head: [b.head[0], 0, 6], jaw: 22, ...lie(0.12) })],
    [0.62, qp({ ...b, pos: [0.13, drop * 0.86, -0.06], rot: [0, 0, 68], neck: [-sp.neckUp * 0.8, -10], head: [-sp.headPitch * 0.4, -6, 0], jaw: 16, ...lie(0.7) })],
    [0.86, qp({ ...b, pos: [tx, drop, -0.06], rot: [0, 0, 88], neck: [-sp.neckUp - 2, -15], head: [-sp.headPitch + 8, -8, 0], jaw: 12, ...lie(1) })],
    [1, qp({ ...b, pos: [tx, drop - 0.005, -0.06], rot: [0, 0, 89], neck: [-sp.neckUp - 4, -16], head: [-sp.headPitch + 10, -9, 0], jaw: 10, ...lie(1) })],
  ]);
}

function commonAnims(rig: QuadRig, m: Motion, atk: ((t: number) => QPose) | null, atkHit = 3): CAnim<QPose>[] {
  const list: CAnim<QPose>[] = [
    { name: 'idle', n: 4, fps: 3, loop: true, dur: 1.6, wind: m.tailWind, pose: idlePose(m.base) },
    { name: 'walk', n: 8, fps: 9, loop: true, dur: m.walkDur, wind: m.tailWind + 2, pose: walkPose(m.walk, m.base) },
    { name: 'run', n: 8, fps: 14, loop: true, dur: m.runDur, wind: m.tailWind + 14, pose: runPose(m.run, m.base) },
  ];
  if (atk) list.push({ name: 'atk1', n: 8, fps: 13, loop: false, dur: 0.62, hit: atkHit, wind: m.tailWind + 4, pose: atk });
  list.push({ name: 'hit', n: 2, fps: 6, loop: false, dur: 0.3, wind: m.tailWind, pose: hitPose(m) });
  list.push({ name: 'die', n: 6, fps: 8, loop: false, dur: 0.85, wind: 0, pose: diePose(rig, m) });
  return list;
}

export interface Creature { rig: QuadRig; anims: CAnim<QPose>[]; info: { radius: number; height: number }; }


// ============================================================
// 灰狼
// ============================================================
export function makeWolf(): Creature {
  const cBack: RGB = [0.17, 0.16, 0.16], cSide: RGB = [0.47, 0.44, 0.4], cBelly: RGB = [0.8, 0.76, 0.68];
  const keys: Sec[] = [
    cap(-0.475, 0.05), S(-0.45, 0.06, 0.06, 0.07, 0.045), S(-0.38, 0.105, 0.1, 0.118, 0.03), S(-0.31, 0.128, 0.118, 0.14, 0.02),
    S(-0.2, 0.12, 0.11, 0.116, 0.015), S(-0.08, 0.118, 0.11, 0.118, 0.012), S(0.03, 0.125, 0.116, 0.14, 0.008),
    S(0.14, 0.14, 0.13, 0.185), S(0.25, 0.148, 0.148, 0.21), S(0.32, 0.14, 0.158, 0.205, 0.01), S(0.39, 0.118, 0.15, 0.185, 0.03),
    S(0.46, 0.102, 0.126, 0.15, 0.05), S(0.53, 0.092, 0.106, 0.118, 0.062), S(0.585, 0.084, 0.093, 0.096, 0.068),
    // 头：后脑 → 颧 → 眉眼 → 吻
    S(0.63, 0.09, 0.09, 0.084, 0.074), S(0.675, 0.097, 0.092, 0.08, 0.076), S(0.715, 0.086, 0.086, 0.064, 0.074),
    S(0.755, 0.058, 0.056, 0.036, 0.062), S(0.8, 0.044, 0.04, 0.024, 0.055), S(0.845, 0.037, 0.033, 0.02, 0.05),
    S(0.872, 0.03, 0.027, 0.018, 0.047), cap(0.886, 0.046),
  ];
  const body = furMat('wolf_body', (u, v) => {
    const t = topness(u), z = zOf(keys, v);
    let c = mix(cBelly, cSide, sstep(0.1, 0.42, t));
    // 背部的深色鞍纹，边缘用噪声打散；到肩颈渐淡
    const saddle = sstep(0.68, 0.93, t + (fbm(u * 10, v * 14, 10, 3, 4) - 0.5) * 0.24) * (1 - sstep(0.3, 0.52, z) * 0.6);
    c = mix(c, cBack, saddle * 0.85);
    c = mix(c, mul(cSide, 1.14), bell(t, 0.6, 0.12) * 0.3);
    // 颈部的浅色围毛
    c = mix(c, mul(cBelly, 0.96), bell(z, 0.5, 0.08) * sstep(0.75, 0.3, t) * 0.55);
    if (z > 0.6) {
      // 面部：两颊与吻侧浅，额与鼻梁深
      const face = sstep(0.6, 0.66, z);
      const mask = mix(cBelly, mul(cSide, 1.05), sstep(0.42, 0.7, t));
      c = mix(c, mix(mask, mul(cBack, 1.9), sstep(0.8, 1, t) * 0.75), face);
      c = mix(c, mul(cBelly, 1.02), bell(t, 0.5, 0.14) * sstep(0.7, 0.76, z) * 0.6);
      c = mix(c, [0.07, 0.06, 0.06], sstep(0.864, 0.874, z));
    }
    c = mix(c, mul(c, 0.8), sstep(-0.38, -0.46, z));
    return mul(c, hair(u, v, 31));
  }, 512);
  const legM = (seed: number, darkTo: number) => furMat('wolf_leg' + seed, (u, v) => {
    let c = mix(mul(cSide, 0.98), mix(cSide, cBelly, 0.6), sstep(0.3, 0.8, v));
    // 腿根并入躯干侧面/背部的毛色（后腿根在背线高度，深色要盖得更低）
    c = mix(c, mix(cSide, cBack, 0.7), sstep(darkTo, darkTo * 0.3, v));
    return mul(c, hair(u, v, seed, 0.2));
  });
  const darkFur = solid(mul(cBack, 1.15)), light = solid(mix(cSide, cBelly, 0.6));

  const fl = { l1: 0.22, l2: 0.28, pawH: 0.09 };
  const hl = { l1: 0.2, l2: 0.23, l3: 0.15, pawH: 0.07 };
  const front: LegSpec = { joint: [0.088, -0.06, 0.3], ...fl, foot: [0.094, 0.315], bend: 1, slide: 0.1, build: () => {} };
  const hind: LegSpec = { joint: [0.084, -0.02, -0.31], ...hl, foot: [0.096, -0.405], bend: -1, slide: 0.06, build: () => {} };
  const rig = new QuadRig({
    spineY: 0.6, front, hind, neckAt: [0, 0.06, 0.37], neckUp: 34, neckLen: 0.22, headPitch: 28,
    blend: { spine: 0.11, neck0: 0.07, neck1: 0.11, neckLow: 0.08 },
    build: (r) => {
      r.jaw.position.set(0, -0.03, 0.075);
      const secs = skinBody(r, keys, body);
      const fm = legM(33, 0.14), hm = legM(35, 0.3);
      for (const k of ['fl', 'fr'] as const) skinLeg(r, k, { r: [0.058, 0.041, 0.03], tz: 1.5, paw: 0.05, rise: 0.13, bz: -0.004 }, fm);
      for (const k of ['hl', 'hr'] as const) skinLeg(r, k, { r: [0.072, 0.047, 0.031, 0.026], tz: 1.95, paw: 0.048, rise: 0.1, bz: -0.014 }, hm);
      const h = r.head;
      h.add(mesh(ellipsoid(0.021, 0.016, 0.017), shiny(DARK, 0.6), { p: toHead(r, [0, 0.052, 0.876]) }));
      for (const s of [-1, 1]) {
        const e = ear(solid(mix(cSide, cBack, 0.6)), solid('#7a5e52'), 0.05, 0.112);
        e.position.set(...toHead(r, surfAt(secs, 0.65, 40, s, -0.16)));
        e.rotation.set(-8 * DEGR, 18 * s * DEGR, -20 * s * DEGR);
        h.add(e);
        h.add(mesh(ellipsoid(0.0095, 0.0085, 0.008), shiny('#b98318', 0.75), { p: toHead(r, surfAt(secs, 0.728, 52, s, -0.07)) }));
        h.add(mesh(ellipsoid(0.005, 0.006, 0.005), shiny(DARK, 0.85), { p: toHead(r, surfAt(secs, 0.732, 52, s, -0.02)) }));
        h.add(mesh(new THREE.ConeGeometry(0.0055, 0.024, 5), shiny('#f1ead8', 0.4), { p: toHead(r, [0.022 * s, 0.022, 0.84]), r: [180, 0, 0] }));
      }
      // 下颌
      r.jaw.add(mesh(loft(smooth([
        S(-0.01, 0.05, 0.012, 0.03), S(0.08, 0.038, 0.01, 0.022), S(0.16, 0.028, 0.008, 0.015), cap(0.2),
      ]), 12), light));
      r.jaw.add(mesh(ellipsoid(0.02, 0.006, 0.06), mat('#a5403c', { kind: 'flat', gloss: 0.35 }), { p: [0, 0.01, 0.09] }));
      for (const s of [-1, 1]) r.jaw.add(mesh(new THREE.ConeGeometry(0.005, 0.02, 5), shiny('#f1ead8', 0.4), { p: [0.017 * s, 0.018, 0.165] }));
      // 尾：蓬松的垂尾，随动作甩动
      const tailM = furMat('wolf_tail', (u, v) => mul(mix(mul(cSide, 0.92), cBack, sstep(0.45, 0.9, v)), hair(u, v, 39, 0.26)));
      r.sims.push(new Ribbon(r.hind, new THREE.Vector3(0, 0.045, -0.45), 0.078, 6, r.holder, tailM,
        (t) => { const k = 0.026 + 0.04 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.98)), 0.7); return [k, k * 0.92]; },
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -0.62, -1).normalize(), 0.93, 2));
      r.chainCols.push([r.hind, new THREE.Vector3(0, 0, -0.3), 0.13], [r.hind, new THREE.Vector3(0, 0, -0.14), 0.12]);
    },
  });

  const base = qp({ neck: [-8, 0], head: [4, 0, 0] });
  const m: Motion = {
    base,
    walk: { stride: 0.4, duty: 0.62, liftF: 0.07, liftH: 0.055, bob: 0.008, yaw: 4, neck: 2.5 },
    run: { strideF: 0.6, strideH: 0.56, zcF: 0.06, zcH: 0.0, liftF: 0.17, liftH: 0.14, duty: 0.28, bob: 0.03, pitch: 6, flexH: 14, flexF: 8, neck: 10, lift: 0.05 },
    walkDur: 0.9, runDur: 0.5, lie: 0.15, reachF: 0.4, reachH: 0.44, tailWind: 5,
  };
  const atk = qtrack([
    [0, base],
    [0.22, qp({ ...base, pos: [0, -0.1, -0.14], rot: [4, 0, 0], hind: [-8, 0, 0], neck: [-22, 0], head: [10, 0, 0], jaw: 4 })],
    [0.42, qp({ ...base, pos: [0, 0.12, 0.42], rot: [-16, 0, 0], fore: [-6, 0, 0], hind: [10, 0, 0], neck: [-18, 0], head: [-2, 0, 0], jaw: 42,
      fl: [0, 0.3, 0.52, -24], fr: [0, 0.35, 0.46, -24], hl: [0, 0, -0.06, 12], hr: [0, 0.02, -0.02, 12] })],
    [0.54, qp({ ...base, pos: [0, 0.05, 0.46], rot: [-5, 0, 0], neck: [-12, 0], head: [6, 0, 0], jaw: 4,
      fl: [0, 0.07, 0.5, 0], fr: [0, 0.1, 0.46, 0], hl: [0, 0, -0.04, 6], hr: [0, 0, -0.02, 6] })],
    [0.8, qp({ ...base, pos: [0, -0.03, 0.16], fl: [0, 0, 0.2, 0], fr: [0, 0.03, 0.14, 0], hl: [0, 0.04, 0.1, 10], hr: [0, 0, 0.04, 0], jaw: 8 })],
    [1, base],
  ]);
  return { rig, anims: commonAnims(rig, m, atk, 3), info: { radius: 0.45, height: 1.0 } };
}

// ============================================================
// 野猪
// ============================================================
export function makeBoar(): Creature {
  const cDark: RGB = [0.13, 0.1, 0.085], cMid: RGB = [0.3, 0.21, 0.15], cLow: RGB = [0.42, 0.31, 0.22];
  const bristle = (u: number, v: number, seed: number) => 0.72 + 0.56 * fbm(u * 72, v * 16, 72, 3, seed);
  const keys: Sec[] = [
    cap(-0.5, 0.01), S(-0.47, 0.085, 0.085, 0.095), S(-0.36, 0.152, 0.145, 0.155), S(-0.2, 0.158, 0.155, 0.17), S(-0.05, 0.158, 0.165, 0.176),
    S(0.06, 0.165, 0.18, 0.186, 0.003), S(0.18, 0.178, 0.205, 0.205, 0.01), S(0.32, 0.182, 0.224, 0.205, 0.02), S(0.42, 0.162, 0.2, 0.18, 0.02),
    S(0.5, 0.136, 0.166, 0.148, 0.01), S(0.56, 0.12, 0.136, 0.118, 0),
    // 头：楔形长脸，吻端是平的鼻盘
    S(0.64, 0.11, 0.116, 0.098, -0.008), S(0.72, 0.092, 0.09, 0.078, -0.016), S(0.8, 0.068, 0.064, 0.056, -0.024),
    S(0.88, 0.053, 0.05, 0.046, -0.032), S(0.945, 0.047, 0.046, 0.044, -0.034), S(0.962, 0.043, 0.042, 0.041, -0.034),
  ];
  const body = furMat('boar_body', (u, v) => {
    const t = topness(u), z = zOf(keys, v);
    let c = mix(cLow, cMid, sstep(0.1, 0.5, t));
    c = mix(c, cDark, sstep(0.55, 0.92, t + (fbm(u * 9, v * 14, 9, 3, 6) - 0.5) * 0.3));
    // 身上干结的泥
    c = mix(c, [0.4, 0.33, 0.25], sstep(0.62, 0.8, fbm(u * 7, v * 11, 7, 3, 12)) * (1 - sstep(0.5, 0.9, t)) * 0.6 * (1 - sstep(0.5, 0.6, z)));
    // 脸：吻部偏浅褐，眼周深
    c = mix(c, [0.4, 0.31, 0.27], sstep(0.78, 0.95, z) * 0.7);
    c = mix(c, cDark, bell(z, 0.68, 0.05) * sstep(0.5, 0.8, t) * 0.5);
    return mul(c, bristle(u, v, 41));
  }, 512, 0.08, 1.5);
  const legM = (seed: number) => furMat('boar_leg' + seed, (u, v) => mul(mix(mix(cMid, cDark, 0.3), mul(cDark, 1.15), sstep(0.25, 0.75, v)), bristle(u, v, seed)), 256, 0.08, 1.4);
  const hoofM = mat('#1a1512', { kind: 'leather', gloss: 0.4 });
  const darkM = solid(mul(cDark, 0.95), 0.08);
  const ivory = shiny('#e9dfc4', 0.5);

  const fl = { l1: 0.16, l2: 0.19, pawH: 0.08 };
  const hl = { l1: 0.17, l2: 0.18, l3: 0.12, pawH: 0.07 };
  const front: LegSpec = { joint: [0.118, -0.1, 0.3], ...fl, foot: [0.125, 0.31], bend: 1, slide: 0.07, build: () => {} };
  const hind: LegSpec = { joint: [0.108, -0.06, -0.32], ...hl, foot: [0.125, -0.385], bend: -1, slide: 0.05, build: () => {} };
  const rig = new QuadRig({
    spineY: 0.52, front, hind, neckAt: [0, -0.01, 0.46], neckUp: -4, neckLen: 0.1, headPitch: 14,
    blend: { spine: 0.13, neck0: 0.08, neck1: 0.06, neckLow: 0.03, head0: 0.04, head1: 0.05 },
    build: (r) => {
      r.jaw.position.set(0, -0.055, 0.08);
      const secs = skinBody(r, keys, body, 28);
      const fm = legM(45), hm = legM(47);
      for (const k of ['fl', 'fr'] as const) skinLeg(r, k, { r: [0.072, 0.048, 0.035], tz: 1.45, paw: 0.05, hoof: true, rise: 0.14 }, fm, hoofM);
      for (const k of ['hl', 'hr'] as const) skinLeg(r, k, { r: [0.082, 0.053, 0.037, 0.031], tz: 1.85, paw: 0.048, hoof: true, rise: 0.12, bz: -0.012 }, hm, hoofM);
      // 背脊的鬃毛：两排细刺，自头后一路到腰
      const zn = r.spec.neckAt[2];
      for (let k = 0; k < 26; k++) {
        const z = 0.6 - k * 0.036;
        const hgt = (0.05 + 0.055 * bell(z, 0.3, 0.2)) * (0.85 + 0.3 * ((k * 7919) % 13) / 13);
        for (const dx of [-0.014, 0.014]) {
          const g = new THREE.ConeGeometry(0.013, hgt, 5); g.translate(0, hgt / 2, 0);
          const p = surfAt(secs, z, 0, 1, -0.06);
          const parent = z > zn + 0.03 ? r.neck : z > 0 ? r.fore : r.hind;
          const lp: [number, number, number] = parent === r.neck ? [dx, p[1] - r.spec.neckAt[1], p[2] - zn] : [dx, p[1], p[2]];
          parent.add(mesh(g, darkM, { p: lp, r: [-30 - (k % 3) * 4, 0, dx > 0 ? -10 : 10] }));
        }
      }
      const h = r.head;
      // 鼻盘
      h.add(mesh(cyl(0.041, 0.041, 0.012, 14), mat('#6d4d45', { kind: 'skin', gloss: 0.35 }), { p: toHead(r, [0, -0.034, 0.966]), r: [90, 0, 0] }));
      for (const s of [-1, 1]) {
        h.add(mesh(ellipsoid(0.008, 0.01, 0.004), shiny(DARK, 0.3), { p: toHead(r, [0.014 * s, -0.032, 0.973]) }));
        const e = ear(darkM, solid('#5a4038'), 0.05, 0.115);
        e.position.set(...toHead(r, surfAt(secs, 0.585, 40, s, -0.1)));
        e.rotation.set(-14 * DEGR, 0, -40 * s * DEGR);
        h.add(e);
        h.add(mesh(ellipsoid(0.01, 0.009, 0.008), shiny('#1c110b', 0.8), { p: toHead(r, surfAt(secs, 0.69, 46, s, -0.01)) }));
        // 上獠牙（短）
        h.add(mesh(new THREE.ConeGeometry(0.011, 0.048, 6), ivory, { p: toHead(r, [0.048 * s, -0.062, 0.86]), r: [20, 0, -150 * s] }));
      }
      r.jaw.add(mesh(loft(smooth([
        S(-0.02, 0.07, 0.014, 0.04), S(0.12, 0.05, 0.012, 0.03), S(0.27, 0.036, 0.01, 0.02), cap(0.29),
      ]), 12), solid(mul(cMid, 0.95), 0.08)));
      for (const s of [-1, 1]) {
        // 下獠牙：向上向外弯
        r.jaw.add(mesh(tube([[0.036 * s, 0.0, 0.2], [0.058 * s, 0.03, 0.205], [0.07 * s, 0.075, 0.19], [0.066 * s, 0.11, 0.165]], 0.011, 6, 10), ivory));
        r.jaw.add(mesh(new THREE.ConeGeometry(0.011, 0.03, 6), ivory, { p: [0.065 * s, 0.123, 0.158], r: [-28, 0, 8 * s] }));
      }
      // 细尾
      r.sims.push(new Ribbon(r.hind, new THREE.Vector3(0, 0.06, -0.485), 0.04, 4, r.holder, darkM,
        (t) => { const k = 0.011 - t * 0.005 + (t > 0.75 ? 0.01 : 0); return [k, k]; },
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, -0.45).normalize(), 0.9, 1));
      r.chainCols.push([r.hind, new THREE.Vector3(0, 0, -0.33), 0.16]);
    },
  });

  const base = qp({ neck: [0, 0], head: [0, 0, 0] });
  const m: Motion = {
    base,
    walk: { stride: 0.3, duty: 0.62, liftF: 0.055, liftH: 0.045, bob: 0.007, yaw: 3, neck: 2 },
    run: { strideF: 0.42, strideH: 0.4, zcF: 0.04, zcH: 0.0, liftF: 0.12, liftH: 0.1, duty: 0.3, bob: 0.025, pitch: 6, flexH: 9, flexF: 5, neck: 4, lift: 0.035 },
    walkDur: 0.85, runDur: 0.46, lie: 0.19, reachF: 0.36, reachH: 0.4, tailWind: 0,
  };
  // 冲撞：低头蓄力 → 前冲 → 獠牙上挑
  const atk = qtrack([
    [0, base],
    [0.24, qp({ ...base, pos: [0, -0.05, -0.17], rot: [7, 0, 0], hind: [-6, 0, 0], neck: [-16, 0], head: [16, 0, 0] })],
    [0.42, qp({ ...base, pos: [0, 0.02, 0.4], rot: [2, 0, 0], neck: [-6, 0], head: [6, 0, 0], jaw: 6,
      fl: [0, 0.1, 0.4, -14], fr: [0, 0.14, 0.34, -14], hl: [0, 0, -0.05, 8], hr: [0, 0.02, -0.02, 8] })],
    [0.54, qp({ ...base, pos: [0, 0.05, 0.45], rot: [-9, 0, 0], neck: [26, 0], head: [-30, 0, 0], jaw: 14,
      fl: [0, 0.03, 0.46, 0], fr: [0, 0.05, 0.42, 0], hl: [0, 0, -0.04, 6], hr: [0, 0, -0.02, 6] })],
    [0.8, qp({ ...base, pos: [0, -0.02, 0.15], neck: [6, 0], head: [-6, 0, 0], fl: [0, 0, 0.18, 0], fr: [0, 0.03, 0.12, 0], hl: [0, 0.04, 0.08, 8] })],
    [1, base],
  ]);
  return { rig, anims: commonAnims(rig, m, atk, 4), info: { radius: 0.55, height: 1.05 } };
}

// ============================================================
// 猛虎
// ============================================================
export function makeTiger(): Creature {
  const cOr: RGB = [0.82, 0.42, 0.1], cSide: RGB = [0.9, 0.57, 0.2], cWhite: RGB = [0.95, 0.92, 0.85], cBlack: RGB = [0.07, 0.06, 0.055];
  const keys: Sec[] = [
    cap(-0.71, 0.05), S(-0.67, 0.086, 0.084, 0.094, 0.04), S(-0.54, 0.158, 0.144, 0.16, 0.02), S(-0.36, 0.16, 0.144, 0.15, 0.015),
    S(-0.18, 0.15, 0.138, 0.142, 0.01), S(-0.04, 0.152, 0.142, 0.154, 0.005), S(0.08, 0.162, 0.152, 0.176), S(0.24, 0.18, 0.168, 0.212),
    S(0.42, 0.192, 0.19, 0.232), S(0.53, 0.168, 0.18, 0.2, 0.012), S(0.62, 0.134, 0.142, 0.158, 0.04), S(0.7, 0.12, 0.124, 0.128, 0.052),
    S(0.76, 0.114, 0.11, 0.106, 0.058),
    // 头：宽而圆的颅、短阔的吻
    S(0.81, 0.128, 0.118, 0.108, 0.062), S(0.87, 0.134, 0.12, 0.106, 0.062), S(0.93, 0.118, 0.106, 0.08, 0.056),
    S(0.98, 0.09, 0.07, 0.046, 0.04), S(1.03, 0.08, 0.058, 0.04, 0.03), S(1.06, 0.068, 0.046, 0.034, 0.022), cap(1.08, 0.02),
  ];
  const stripes = (u: number, v: number, freq: number, seed: number) => {
    const warp = fbm(u * 6, v * 9, 6, 3, seed) - 0.5;
    const s = Math.sin((v * freq + warp * 1.5 + Math.sin(u * Math.PI * 2) * 0.2) * Math.PI * 2);
    const breakup = sstep(0.28, 0.48, fbm(u * 12, v * 5, 12, 2, seed + 9));
    return sstep(0.5, 0.74, s) * breakup;
  };
  const body = furMat('tiger_body', (u, v) => {
    const t = topness(u), z = zOf(keys, v);
    const headK = sstep(0.76, 0.84, z);
    let c = mix(cWhite, cSide, sstep(0.05, 0.3, t));
    c = mix(c, cOr, sstep(0.5, 0.9, t));
    // 躯干的竖纹（绕身一圈的黑带），到头部换成额上的横纹
    const st = stripes(u, v, 20, 51) * (0.3 + 0.7 * sstep(0.1, 0.4, t)) * (1 - headK);
    c = mix(c, cBlack, st);
    if (headK > 0) {
      // 白颊、白吻、眼上白斑
      let f = mix(cWhite, cSide, sstep(0.36, 0.58, t));
      f = mix(f, cOr, sstep(0.62, 0.9, t));
      f = mix(f, cWhite, sstep(0.96, 1.0, z) * sstep(0.85, 0.5, t));
      f = mix(f, cWhite, bell(z, 0.94, 0.02) * bell(t, 0.78, 0.07) * 0.9);
      const brow = sstep(0.55, 0.78, Math.sin((z * 24 + (fbm(u * 8, v * 30, 8, 2, 5) - 0.5) * 1.2) * Math.PI * 2)) * sstep(0.6, 0.85, t) * (1 - sstep(0.93, 0.97, z));
      f = mix(f, cBlack, brow * 0.9);
      // 颊上的黑纹
      f = mix(f, cBlack, sstep(0.6, 0.85, Math.sin(t * 34)) * bell(t, 0.42, 0.14) * (1 - sstep(0.9, 0.95, z)) * 0.8);
      c = mix(c, f, headK);
    }
    return mul(c, hair(u, v, 54, 0.15));
  }, 1024, 0.12, 1.3);
  const legM = (key: string, freq: number, seed: number) => furMat(key, (u, v) => {
    // 管状腿的 u：0.5 在前，内侧无法区分左右，取前后对称
    const front = bell(Math.abs(u - 0.5), 0, 0.2);
    let c = mix(mix(cOr, cSide, 0.55), cWhite, sstep(0.8, 1, v) * 0.35 + front * 0.1);
    const s = sstep(0.62, 0.86, Math.sin((v * freq + 0.2 + (fbm(u * 6, v * 8, 6, 2, seed) - 0.5) * 0.6) * Math.PI * 2)) * (1 - sstep(0.8, 0.95, v));
    c = mix(c, cBlack, s * (0.55 + 0.45 * fbm(u * 9, v * 3, 9, 2, seed + 4)));
    return mul(c, 0.92 + 0.16 * fbm(u * 40, v * 10, 40, 2, seed + 1));
  }, 256, 0.12, 1.3);
  const white = solid(cWhite, 0.12), black = solid(mul(cBlack, 1.3), 0.12);
  const ivory = shiny('#efe8d6', 0.5);

  const fl = { l1: 0.27, l2: 0.33, pawH: 0.1 };
  const hl = { l1: 0.26, l2: 0.3, l3: 0.19, pawH: 0.09 };
  const front: LegSpec = { joint: [0.122, -0.07, 0.44], ...fl, foot: [0.135, 0.455], bend: 1, slide: 0.13, build: () => {} };
  const hind: LegSpec = { joint: [0.116, -0.03, -0.5], ...hl, foot: [0.135, -0.6], bend: -1, slide: 0.08, build: () => {} };
  const tailBones: THREE.Bone[] = [];
  const TAIL_N = 7, TAIL_L = 0.125, TAIL_Z = -0.69, TAIL_Y = 0.05;
  const tailRest = [-62, 8, 8, 12, 18, 24, 28];
  const rig = new QuadRig({
    scale: 1.08, spineY: 0.74, front, hind, neckAt: [0, 0.05, 0.58], neckUp: 20, neckLen: 0.2, headPitch: 22,
    blend: { spine: 0.14, neck0: 0.09, neck1: 0.12, neckLow: 0.08, head0: 0.06, head1: 0.05 },
    build: (r) => {
      r.jaw.position.set(0, -0.05, 0.1);
      // 尾椎：零姿势下沿 −Z 平伸
      let parent: THREE.Object3D = r.hind;
      for (let i = 0; i < TAIL_N; i++) {
        const b = r.addBone(parent, i === 0 ? [0, TAIL_Y, TAIL_Z] : [0, 0, -TAIL_L]);
        tailBones.push(b);
        parent = b;
      }
      const secs = skinBody(r, keys, body, 30);
      const fm = legM('tiger_legF', 3.2, 61), hm = legM('tiger_legH', 3.6, 63);
      for (const k of ['fl', 'fr'] as const) skinLeg(r, k, { r: [0.09, 0.064, 0.052], tz: 1.5, paw: 0.07, rise: 0.19, bulge: 1.04 }, fm);
      for (const k of ['hl', 'hr'] as const) skinLeg(r, k, { r: [0.106, 0.07, 0.048, 0.043], tz: 1.9, paw: 0.068, rise: 0.15, bz: -0.02 }, hm);
      // 尾
      const t0 = r.bi(tailBones[0]), hindI = r.bi(r.hind);
      const tailSecs: Sec[] = [cap(TAIL_Z - TAIL_N * TAIL_L - 0.02, TAIL_Y)];
      for (let i = TAIL_N * 2; i >= -1; i--) {
        const z = TAIL_Z - (i / 2) * TAIL_L, k = Math.max(0, i) / (TAIL_N * 2);
        const rad = i < 0 ? 0.05 : 0.046 - k * 0.012 + (k > 0.9 ? 0.004 : 0);
        tailSecs.push(S(z, rad, rad, rad, TAIL_Y));
      }
      const tailW: WFn = (z) => {
        const f = (TAIL_Z - z) / TAIL_L;         // 0 = 尾根，向后递增
        if (f <= -0.4) return [[hindI, 1]];
        const i = Math.min(TAIL_N - 1, Math.max(0, Math.floor(f + 0.5)));
        const d = f + 0.5 - i;                    // 0..1：关节 i 前后各半节
        const k = sstep(0.1, 0.9, d);
        const prev = i === 0 ? hindI : t0 + i - 1;
        return [[prev, 1 - k], [t0 + i, k]];
      };
      const tg = loft(tailSecs, 12, tailW);
      tg.translate(0, r.spec.spineY, 0);
      r.skin(tg, furMat('tiger_tail', (u, v) => {
        let c = mix(mix(cOr, cSide, 0.5), cWhite, sstep(0.3, 0.0, topness(u)) * 0.5);
        c = mix(c, cBlack, Math.max(sstep(0.55, 0.8, Math.sin(v * 9 * Math.PI * 2)), sstep(0.86, 0.94, v)));
        return mul(c, 0.92 + 0.16 * fbm(u * 30, v * 20, 30, 2, 66));
      }, 256, 0.12, 1.2));

      const h = r.head;
      h.add(mesh(ellipsoid(0.026, 0.016, 0.014), mat('#b9625c', { kind: 'flat', gloss: 0.4 }), { p: toHead(r, [0, 0.062, 1.07]) }));
      for (const s of [-1, 1]) {
        const e = ear(black, solid(mix(cSide, cWhite, 0.5), 0.12), 0.05, 0.05, true);
        e.position.set(...toHead(r, surfAt(secs, 0.835, 42, s, -0.2)));
        e.rotation.set(-14 * DEGR, 20 * s * DEGR, -26 * s * DEGR);
        h.add(e);
        h.add(mesh(ellipsoid(0.012, 0.01, 0.009), shiny('#c9981c', 0.75), { p: toHead(r, surfAt(secs, 0.948, 50, s, -0.06)) }));
        h.add(mesh(ellipsoid(0.0055, 0.0075, 0.006), shiny(DARK, 0.85), { p: toHead(r, surfAt(secs, 0.953, 50, s, -0.01)) }));
        h.add(mesh(new THREE.ConeGeometry(0.009, 0.045, 6), ivory, { p: toHead(r, [0.034 * s, -0.02, 1.03]), r: [180, 0, 0] }));
        // 须垫
        h.add(mesh(ellipsoid(0.03, 0.022, 0.03), white, { p: toHead(r, [0.034 * s, 0.012, 1.045]) }));
      }
      r.jaw.add(mesh(loft(smooth([
        S(-0.02, 0.075, 0.014, 0.04), S(0.09, 0.062, 0.012, 0.032), S(0.175, 0.046, 0.01, 0.022), cap(0.195),
      ]), 12), white));
      r.jaw.add(mesh(ellipsoid(0.034, 0.007, 0.07), mat('#b0453f', { kind: 'flat', gloss: 0.35 }), { p: [0, 0.012, 0.08] }));
      for (const s of [-1, 1]) r.jaw.add(mesh(new THREE.ConeGeometry(0.008, 0.032, 6), ivory, { p: [0.03 * s, 0.026, 0.16] }));
    },
  });

  // 尾：J 形弧线（先下垂再上翘），随后躯摆动
  rig.onPose = (p) => {
    const sway = (p.hind[1] * 1.2 + p.aux * 9) * DEGR;
    tailBones.forEach((b, i) => { b.rotation.set(tailRest[i] * DEGR, sway * (i === 0 ? 0.6 : 0.5), 0); });
  };
  rig.setPose(rig.pose);
  const base = qp({ neck: [-6, 0], head: [4, 0, 0] });
  const m: Motion = {
    base,
    walk: { stride: 0.56, duty: 0.64, liftF: 0.09, liftH: 0.07, bob: 0.01, yaw: 5, neck: 2.5 },
    run: { strideF: 0.82, strideH: 0.76, zcF: 0.08, zcH: 0.0, liftF: 0.22, liftH: 0.18, duty: 0.28, bob: 0.04, pitch: 6, flexH: 15, flexF: 9, neck: 9, lift: 0.06 },
    walkDur: 1.05, runDur: 0.56, lie: 0.19, reachF: 0.52, reachH: 0.56, tailWind: 4,
  };
  // 扑击：伏身 → 腾起挥爪 → 下压
  const atk = qtrack([
    [0, base],
    [0.24, qp({ ...base, pos: [0, -0.16, -0.18], rot: [6, 0, 0], hind: [-10, 0, 0], neck: [-18, 0], head: [8, 0, 0], jaw: 10 })],
    [0.42, qp({ ...base, pos: [0, 0.2, 0.46], rot: [-24, 0, 0], fore: [-8, -6, 0], hind: [10, 0, 0], neck: [-22, 0], head: [8, 0, 0], jaw: 44,
      fl: [0.03, 0.62, 0.6, -46], fr: [-0.06, 0.36, 0.74, -34], hl: [0, 0, -0.08, 12], hr: [0, 0.02, -0.03, 12] })],
    [0.54, qp({ ...base, pos: [0, 0.0, 0.5], rot: [5, 0, 0], fore: [6, 0, 0], neck: [-14, 0], head: [10, 0, 0], jaw: 22,
      fl: [0, 0.04, 0.6, 8], fr: [-0.04, 0, 0.66, 0], hl: [0, 0, -0.06, 8], hr: [0, 0, -0.03, 8] })],
    [0.8, qp({ ...base, pos: [0, -0.04, 0.18], fl: [0, 0, 0.22, 0], fr: [0, 0.04, 0.2, 0], hl: [0, 0.05, 0.1, 8], jaw: 6 })],
    [1, base],
  ]);
  const list = commonAnims(rig, m, atk, 3);
  // 待机与奔跑时尾巴左右摆
  for (const a of list) {
    if (a.name === 'idle' || a.name === 'run') {
      const f = a.pose;
      a.pose = (t: number) => { const p = f(t); p.aux = Math.sin(t * Math.PI * 2); return p; };
    }
  }
  return { rig, anims: list, info: { radius: 0.7, height: 1.35 } };
}

// ============================================================
// 梅花鹿
// ============================================================
export function makeDeer(): Creature {
  const cCoat: RGB = [0.6, 0.36, 0.19], cDark: RGB = [0.3, 0.19, 0.12], cCream: RGB = [0.9, 0.84, 0.72], cSpot: RGB = [0.96, 0.93, 0.85];
  const keys: Sec[] = [
    cap(-0.45, 0.05), S(-0.42, 0.064, 0.064, 0.085, 0.04), S(-0.31, 0.11, 0.108, 0.13, 0.02), S(-0.16, 0.104, 0.1, 0.106, 0.01),
    S(-0.03, 0.104, 0.106, 0.118, 0.005), S(0.06, 0.11, 0.114, 0.136), S(0.18, 0.118, 0.122, 0.162), S(0.29, 0.116, 0.13, 0.168, 0.005),
    S(0.36, 0.096, 0.122, 0.148, 0.02), S(0.43, 0.076, 0.09, 0.112, 0.045), S(0.5, 0.064, 0.07, 0.086, 0.058),
    S(0.57, 0.056, 0.058, 0.066, 0.064), S(0.62, 0.054, 0.056, 0.058, 0.066),
    // 头：窄长的脸
    S(0.67, 0.064, 0.068, 0.062, 0.07), S(0.72, 0.066, 0.07, 0.058, 0.07), S(0.78, 0.05, 0.052, 0.04, 0.064),
    S(0.85, 0.039, 0.04, 0.03, 0.057), S(0.905, 0.032, 0.032, 0.025, 0.052), cap(0.93, 0.05),
  ];
  const hash = (i: number, j: number) => { const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); };
  const spots = (u: number, z: number) => {
    // 抖动网格上的圆斑（按体表的实际尺寸铺）
    const gu = u * 15, gv = z * 13;
    let best = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ci = Math.floor(gu) + di, cj = Math.floor(gv) + dj;
      const cu = ci + 0.2 + 0.6 * hash(ci, cj), cv = cj + 0.2 + 0.6 * hash(cj + 7, ci + 3);
      const rad = 0.2 + 0.14 * hash(ci + 11, cj + 5);
      const d = Math.hypot((gu - cu) * 0.9, gv - cv);
      best = Math.max(best, sstep(rad, rad * 0.55, d));
    }
    return best;
  };
  const body = furMat('deer_body', (u, v) => {
    const t = topness(u), z = zOf(keys, v);
    let c = mix(cCream, cCoat, sstep(0.14, 0.42, t));
    c = mix(c, cDark, sstep(0.82, 1, t) * 0.45 * (1 - sstep(0.6, 0.7, z)));
    c = mix(c, cSpot, spots(u, z) * sstep(0.34, 0.5, t) * (1 - sstep(0.86, 0.94, t)) * (1 - sstep(0.34, 0.44, z)));
    // 臀部白斑、喉下与吻端的浅色
    c = mix(c, cSpot, sstep(-0.36, -0.43, z) * sstep(0.95, 0.5, t));
    c = mix(c, cCream, bell(z, 0.5, 0.1) * sstep(0.4, 0.1, t) * 0.7);
    c = mix(c, cCream, sstep(0.84, 0.9, z) * sstep(0.7, 0.3, t) * 0.8);
    c = mix(c, [0.1, 0.08, 0.07], sstep(0.908, 0.918, z) * sstep(0.2, 0.5, t));
    return mul(c, hair(u, v, 71, 0.14));
  }, 1024, 0.12, 1.2);
  const legM = (seed: number) => furMat('deer_leg' + seed, (u, v) => mul(mix(cCoat, mix(cCoat, cCream, 0.45), sstep(0.3, 0.8, v)), hair(u, v, seed, 0.14)), 256, 0.12, 1.2);
  const hoofM = mat('#1c1613', { kind: 'leather', gloss: 0.45 });
  const cream = solid(cCream, 0.12), coat = solid(cCoat, 0.12);
  const antler = mat('#8b6c4a', { kind: 'leather', gloss: 0.28 });

  const fl = { l1: 0.2, l2: 0.36, pawH: 0.17 };
  const hl = { l1: 0.22, l2: 0.28, l3: 0.23, pawH: 0.08 };
  const front: LegSpec = { joint: [0.074, -0.09, 0.28], ...fl, foot: [0.074, 0.29], bend: 1, slide: 0.09, build: () => {} };
  const hind: LegSpec = { joint: [0.074, -0.04, -0.29], ...hl, foot: [0.08, -0.375], bend: -1, slide: 0.06, build: () => {} };
  const ears: THREE.Object3D[] = [];
  const rig = new QuadRig({
    spineY: 0.8, front, hind, neckAt: [0, 0.06, 0.37], neckUp: 52, neckLen: 0.27, headPitch: 50,
    blend: { spine: 0.1, neck0: 0.07, neck1: 0.12, neckLow: 0.1, head0: 0.06, head1: 0.04 },
    build: (r) => {
      r.jaw.position.set(0, -0.026, 0.07);
      const secs = skinBody(r, keys, body, 26);
      const fm = legM(77), hm = legM(79);
      for (const k of ['fl', 'fr'] as const) skinLeg(r, k, { r: [0.052, 0.033, 0.024], tz: 1.55, paw: 0.038, hoof: true, rise: 0.13 }, fm, hoofM);
      for (const k of ['hl', 'hr'] as const) skinLeg(r, k, { r: [0.066, 0.041, 0.026, 0.021], tz: 1.95, paw: 0.036, hoof: true, rise: 0.11, bz: -0.012 }, hm, hoofM);
      // 短尾：上褐下白
      r.hind.add(mesh(ellipsoid(0.03, 0.05, 0.026), cream, { p: [0, 0.035, -0.45], r: [-28, 0, 0] }));
      r.hind.add(mesh(ellipsoid(0.026, 0.045, 0.018), coat, { p: [0, 0.045, -0.462], r: [-28, 0, 0] }));
      const h = r.head;
      for (const s of [-1, 1]) {
        const e = new THREE.Group();
        e.add(mesh(ellipsoid(0.034, 0.085, 0.013), coat, { p: [0, 0.08, 0] }), mesh(ellipsoid(0.021, 0.062, 0.008), cream, { p: [0, 0.078, 0.009] }));
        e.position.set(...toHead(r, surfAt(secs, 0.67, 46, s, -0.1)));
        e.rotation.set(-14 * DEGR, 0, -62 * s * DEGR);
        h.add(e);
        ears.push(e);
        h.add(mesh(ellipsoid(0.013, 0.014, 0.01), shiny(DARK, 0.85), { p: toHead(r, surfAt(secs, 0.745, 56, s, -0.03)) }));
        // 鹿角：主干 + 三个叉
        const b = toHead(r, surfAt(secs, 0.7, 22, s, -0.1));
        const at = (dx: number, dy: number, dz: number): [number, number, number] => [b[0] + dx * s, b[1] + dy, b[2] + dz];
        h.add(mesh(tube([at(0, 0, 0), at(0.036, 0.11, -0.035), at(0.09, 0.24, -0.08), at(0.106, 0.37, -0.06), at(0.084, 0.46, -0.01)], 0.012, 6, 22), antler));
        h.add(mesh(tube([at(0.018, 0.055, -0.016), at(0.036, 0.1, 0.06), at(0.048, 0.17, 0.11)], 0.009, 5, 8), antler));
        h.add(mesh(tube([at(0.085, 0.23, -0.08), at(0.14, 0.3, -0.035), at(0.165, 0.38, 0.01)], 0.009, 5, 8), antler));
        h.add(mesh(tube([at(0.104, 0.355, -0.065), at(0.128, 0.41, -0.125), at(0.138, 0.48, -0.15)], 0.008, 5, 8), antler));
      }
      r.jaw.add(mesh(loft(smooth([
        S(-0.01, 0.04, 0.01, 0.024), S(0.09, 0.03, 0.008, 0.018), S(0.18, 0.02, 0.007, 0.011), cap(0.2),
      ]), 10), cream));
    },
  });
  rig.onPose = (p) => { ears.forEach((e, i) => { e.rotation.z = -(62 + p.aux * 22) * (i === 0 ? -1 : 1) * DEGR; }); };

  const base = qp({});
  const m: Motion = {
    base,
    walk: { stride: 0.44, duty: 0.62, liftF: 0.11, liftH: 0.08, bob: 0.008, yaw: 3, neck: 3.5 },
    run: { strideF: 0.7, strideH: 0.66, zcF: 0.08, zcH: 0.0, liftF: 0.26, liftH: 0.2, duty: 0.26, bob: 0.045, pitch: 7, flexH: 13, flexF: 7, neck: 10, lift: 0.1 },
    walkDur: 1.0, runDur: 0.52, lie: 0.14, reachF: 0.52, reachH: 0.56, tailWind: 0,
  };
  const idle = (t: number) => {
    const p = idlePose(base, 10, 0.005)(t);
    p.aux = Math.max(0, Math.sin(t * Math.PI * 4));
    return p;
  };
  const list = commonAnims(rig, m, null);
  list[0].pose = idle;
  return { rig, anims: list, info: { radius: 0.45, height: 1.6 } };
}

void walkPose; void runPose;
