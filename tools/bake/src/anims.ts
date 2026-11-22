import * as THREE from 'three';
import { DEG } from './geo';
import { flattenPose, Humanoid, Look, Pose, restPose, unflattenPose, WeaponKind } from './humanoid';

type PP = Partial<Pose>;
const mk = (base: Pose, o: PP): Pose => ({ ...JSON.parse(JSON.stringify(base)), ...JSON.parse(JSON.stringify(o)) });

/** 关键帧轨道：Hermite 插值 */
function track(keys: [number, Pose][], loop = false): (t: number) => Pose {
  const ts = keys.map((k) => k[0]);
  const vs = keys.map((k) => flattenPose(k[1]));
  const n = keys.length, dim = vs[0].length;
  const tan: number[][] = [];
  for (let i = 0; i < n; i++) {
    const m = new Array(dim).fill(0);
    let a = i - 1, b = i + 1, ta: number, tb: number;
    if (loop) {
      // 约定首尾关键帧相同（t=0 与 t=1）
      if (i === 0) a = n - 2; if (i === n - 1) b = 1;
      ta = i === 0 ? ts[a] - 1 : ts[a];
      tb = i === n - 1 ? ts[b] + 1 : ts[b];
    } else {
      if (i === 0 || i === n - 1) { tan.push(m); continue; }
      ta = ts[a]; tb = ts[b];
    }
    for (let d = 0; d < dim; d++) m[d] = (vs[b][d] - vs[a][d]) / (tb - ta);
    tan.push(m);
  }
  return (t: number) => {
    t = loop ? ((t % 1) + 1) % 1 : Math.min(1, Math.max(0, t));
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i] || 1e-6;
    const u = Math.min(1, Math.max(0, (t - ts[i]) / h));
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const out = new Array(dim);
    for (let d = 0; d < dim; d++) {
      out[d] = h00 * vs[i][d] + h10 * h * tan[i][d] + h01 * vs[i + 1][d] + h11 * h * tan[i + 1][d];
    }
    return unflattenPose(out);
  };
}

// -------------------- 架势 --------------------
export function stance(w: WeaponKind): Pose {
  const r = restPose();
  const legs: PP = { hip: [0, -0.035, 0], legL: [14, 7, 8, 18], legR: [-12, 9, 14, 20], footL: -3, footR: 6 };
  switch (w) {
    case 'fist':
      return mk(r, {
        ...legs, hip: [0, -0.05, 0], hipRot: [4, -18, 0], chest: [4, -10, 0], head: [0, 26, 0],
        armL: [58, -6, 0, 100], armR: [34, 12, 0, 118], handL: [20, 0, 0], handR: [20, 0, 0],
      });
    case 'sword':
      return mk(r, {
        ...legs, hipRot: [2, -14, 0], chest: [2, -6, 0], head: [0, 18, 0],
        armR: [26, 16, 0, 34], handR: [48, -24, 0], armL: [16, 22, 0, 46], handL: [10, 0, 0],
      });
    case 'saber':
      return mk(r, {
        ...legs, hip: [0, -0.05, 0], hipRot: [3, -20, 0], chest: [3, -8, 0], head: [0, 26, 0],
        armR: [44, 26, 0, 64], handR: [8, 0, 0], armL: [30, 10, 0, 70], handL: [20, 0, 0],
      });
    case 'spear':
      return mk(r, {
        ...legs, hip: [0, -0.05, 0], hipRot: [3, -34, 0], chest: [2, -14, 0], head: [0, 44, 0],
        armR: [-8, 14, 0, 62], handR: [54, 46, 0], armL: [40, 0, 0, 40], grip: 1,
      });
    case 'bow':
      return mk(r, {
        ...legs, hipRot: [2, -30, 0], chest: [0, -10, 0], head: [0, 38, 0],
        armL: [28, 20, 0, 24], handL: [0, 0, 0], armR: [10, 12, 0, 40],
      });
  }
}

// -------------------- 走/跑 --------------------
function gait(w: WeaponKind, run: boolean): (t: number) => Pose {
  const A = run ? 44 : 27, K = run ? 92 : 52, bob = run ? 0.045 : 0.022, arm = run ? 44 : 24;
  const lean = run ? 13 : 4;
  return (t: number) => {
    const ph = t * Math.PI * 2;
    const p = restPose();
    const leg = (th: number): [number, number, number, number] => [
      A * Math.sin(th) + (run ? 8 : 2), 3, 4,
      (run ? 14 : 6) + K * Math.pow(Math.max(0, Math.cos(th - 0.35)), 1.3),
    ];
    p.legL = leg(ph);
    p.legR = leg(ph + Math.PI);
    p.footL = -16 * Math.sin(ph) + (run ? 8 : 0);
    p.footR = -16 * Math.sin(ph + Math.PI) + (run ? 8 : 0);
    p.hip = [0, -0.02 + bob * Math.cos(ph * 2) - (run ? 0.03 : 0), 0];
    p.hipRot = [lean, -7 * Math.sin(ph), 2.5 * Math.sin(ph)];
    p.spine = [run ? 4 : 1, 5 * Math.sin(ph), -2 * Math.sin(ph)];
    p.chest = [0, 9 * Math.sin(ph), 0];
    p.head = [-lean * 0.7, -6 * Math.sin(ph), 0];
    p.armL = [-arm * Math.sin(ph) + 4, 8, 0, (run ? 78 : 22) - (run ? 14 : 6) * Math.sin(ph)];
    p.armR = [arm * Math.sin(ph) + 4, 8, 0, (run ? 78 : 22) + (run ? 14 : 6) * Math.sin(ph)];
    p.handL = [10, 0, 0];
    p.handR = [10, 0, 0];
    const s = Math.sin(ph);
    if (w === 'sword' || w === 'saber') {
      // 倒提兵器于身侧后方
      p.armR = [-14 + 8 * s, 22, 0, 26 + 6 * s];
      p.handR = [w === 'sword' ? 142 : 128, 0, 0];
    } else if (w === 'spear') {
      p.chest = [0, -18 + 5 * s, 0];
      p.head = [-lean * 0.7, 14, 0];
      p.armR = [-12 + 4 * s, 16, 0, 58];
      p.handR = [40, 40, 0];
      p.grip = 1;
    } else if (w === 'bow') {
      p.armL = [14 - 6 * s, 16, 0, 36];
      p.handL = [-10, 0, 0];
    }
    return p;
  };
}

function idle(w: WeaponKind): (t: number) => Pose {
  const base = stance(w);
  return (t: number) => {
    const s = Math.sin(t * Math.PI * 2), c = Math.cos(t * Math.PI * 2);
    const p = mk(base, {});
    p.hip[1] += 0.008 * s;
    p.chest[0] += 1.6 * s;
    p.spine[0] += 0.8 * s;
    p.head[0] -= 1.2 * s;
    p.armR[3] += 3 * s; p.armL[3] += 3 * c;
    p.armR[0] += 1.5 * c; p.armL[0] += 1.5 * s;
    return p;
  };
}

// -------------------- 攻击 --------------------
function attackA(w: WeaponKind): (t: number) => Pose {
  const s = stance(w);
  if (w === 'sword') {
    // 横斩：右→左
    return track([
      [0, s],
      [0.24, mk(s, { hip: [-0.03, -0.07, -0.05], hipRot: [4, -36, 0], spine: [2, -12, 0], chest: [2, -22, 0], head: [0, 50, 0],
        armR: [88, 96, 0, 58], handR: [30, 0, 0], armL: [50, -10, 0, 80], legL: [22, 8, 8, 30], legR: [-18, 10, 16, 34] })],
      [0.42, mk(s, { hip: [0.02, -0.1, 0.2], hipRot: [8, 12, 0], spine: [4, 10, 0], chest: [4, 22, 0], head: [0, -26, 0],
        armR: [86, 4, 0, 10], handR: [84, 0, 0], armL: [-10, 36, 0, 50], legL: [44, 6, 6, 52], legR: [-34, 8, 10, 12], footR: 24 })],
      [0.58, mk(s, { hip: [0.03, -0.1, 0.22], hipRot: [8, 26, 0], spine: [4, 14, 0], chest: [4, 34, 0], head: [0, -46, 0],
        armR: [80, -62, 0, 34], handR: [78, 0, 0], armL: [-24, 40, 0, 40], legL: [46, 6, 6, 54], legR: [-34, 8, 10, 14], footR: 26 })],
      [0.8, mk(s, { hip: [0.01, -0.07, 0.1], hipRot: [4, 4, 0], chest: [3, 8, 0], head: [0, 6, 0],
        armR: [50, -30, 0, 50], handR: [60, 0, 0] })],
      [1, s],
    ]);
  }
  if (w === 'saber') {
    // 斜劈：右上→左下
    return track([
      [0, s],
      [0.26, mk(s, { hip: [0, -0.04, -0.06], hipRot: [-4, -34, 0], spine: [-4, -8, 0], chest: [-6, -20, 0], head: [6, 46, 0],
        armR: [158, 40, 0, 74], handR: [-10, 0, 0], armL: [60, 0, 0, 70], legL: [20, 8, 8, 26], legR: [-16, 10, 16, 30] })],
      [0.44, mk(s, { hip: [0.02, -0.13, 0.2], hipRot: [16, 14, 0], spine: [10, 8, 0], chest: [10, 20, 0], head: [-18, -24, 0],
        armR: [66, -6, 0, 12], handR: [80, 0, 0], armL: [-16, 34, 0, 56], legL: [46, 6, 6, 58], legR: [-34, 8, 10, 14], footR: 24 })],
      [0.6, mk(s, { hip: [0.03, -0.15, 0.22], hipRot: [20, 24, 0], spine: [12, 10, 0], chest: [12, 28, 0], head: [-22, -38, 0],
        armR: [24, -52, 0, 26], handR: [84, 0, 0], armL: [-26, 38, 0, 46], legL: [48, 6, 6, 60], legR: [-34, 8, 10, 16], footR: 26 })],
      [0.82, mk(s, { hip: [0.01, -0.09, 0.1], hipRot: [8, 0, 0], chest: [6, 6, 0], armR: [34, -10, 0, 50], handR: [50, 0, 0] })],
      [1, s],
    ]);
  }
  if (w === 'spear') {
    // 突刺
    return track([
      [0, s],
      [0.28, mk(s, { hip: [0, -0.08, -0.1], hipRot: [4, -46, 0], chest: [2, -18, 0], head: [0, 60, 0],
        armR: [-34, 18, 0, 84], handR: [44, 52, 0], legL: [20, 8, 8, 30], legR: [-16, 10, 16, 36] })],
      [0.44, mk(s, { hip: [0, -0.14, 0.26], hipRot: [12, -10, 0], spine: [6, 0, 0], chest: [6, 4, 0], head: [-12, 8, 0],
        armR: [62, 4, 0, 6], handR: [62, 8, 0], legL: [50, 6, 6, 62], legR: [-36, 8, 10, 10], footR: 26 })],
      [0.6, mk(s, { hip: [0, -0.14, 0.27], hipRot: [12, -8, 0], spine: [6, 0, 0], chest: [6, 4, 0], head: [-12, 8, 0],
        armR: [64, 4, 0, 4], handR: [64, 8, 0], legL: [50, 6, 6, 62], legR: [-36, 8, 10, 10], footR: 26 })],
      [0.82, mk(s, { hip: [0, -0.08, 0.1], armR: [10, 12, 0, 56], handR: [54, 40, 0] })],
      [1, s],
    ]);
  }
  if (w === 'bow') {
    const aim: PP = { hip: [0, -0.03, 0], hipRot: [0, -72, 0], spine: [0, -6, 0], chest: [0, -8, 0], head: [0, 80, 0],
      legL: [8, 14, 30, 10], legR: [-6, 16, 30, 12] };
    return track([
      [0, s],
      [0.22, mk(s, { ...aim, armL: [88, 84, 0, 6], handL: [0, 0, 0], armR: [80, 40, 0, 110], draw: 0.05, grip: 1 })],
      [0.5, mk(s, { ...aim, armL: [90, 86, 0, 4], armR: [80, 40, 0, 110], draw: 1, grip: 1 })],
      [0.62, mk(s, { ...aim, armL: [90, 86, 0, 4], armR: [80, 40, 0, 110], draw: 1, grip: 1 })],
      [0.66, mk(s, { ...aim, armL: [91, 86, 0, 2], armR: [88, 128, 0, 100], draw: 0, grip: 0 })],
      [0.84, mk(s, { ...aim, armL: [80, 80, 0, 10], armR: [70, 120, 0, 80], draw: 0, grip: 0 })],
      [1, s],
    ]);
  }
  // 拳：左刺拳 + 右直拳
  return track([
    [0, s],
    [0.2, mk(s, { hip: [0, -0.07, 0.06], hipRot: [6, -26, 0], chest: [6, -20, 0], head: [0, 44, 0],
      armL: [86, 0, 0, 8], handL: [10, 0, 0], armR: [36, 16, 0, 124] })],
    [0.34, mk(s, { hip: [0, -0.07, 0.05], hipRot: [6, -30, 0], chest: [6, -26, 0], head: [0, 54, 0],
      armL: [60, 0, 0, 96], armR: [40, 20, 0, 126] })],
    [0.5, mk(s, { hip: [0, -0.1, 0.2], hipRot: [10, 22, 0], spine: [4, 8, 0], chest: [8, 26, 0], head: [-4, -44, 0],
      armR: [88, -8, 0, 6], handR: [10, 0, 0], armL: [40, 20, 0, 126], legL: [42, 6, 6, 50], legR: [-32, 8, 10, 14], footR: 26 })],
    [0.64, mk(s, { hip: [0, -0.1, 0.21], hipRot: [10, 26, 0], spine: [4, 8, 0], chest: [8, 30, 0], head: [-4, -50, 0],
      armR: [86, -12, 0, 10], handR: [10, 0, 0], armL: [40, 20, 0, 126], legL: [42, 6, 6, 50], legR: [-32, 8, 10, 14], footR: 26 })],
    [0.84, mk(s, { hip: [0, -0.07, 0.08], hipRot: [6, 0, 0], chest: [6, 4, 0], armR: [50, 8, 0, 100] })],
    [1, s],
  ]);
}

function attackB(w: WeaponKind): (t: number) => Pose {
  const s = stance(w);
  if (w === 'sword') {
    // 纵劈 + 前刺
    return track([
      [0, s],
      [0.24, mk(s, { hip: [0, -0.02, -0.06], hipRot: [-6, -8, 0], spine: [-6, 0, 0], chest: [-8, -6, 0], head: [8, 10, 0],
        armR: [172, 14, 0, 62], handR: [-4, 0, 0], armL: [70, 10, 0, 40] })],
      [0.42, mk(s, { hip: [0, -0.12, 0.2], hipRot: [18, 4, 0], spine: [10, 0, 0], chest: [12, 8, 0], head: [-22, -8, 0],
        armR: [72, 2, 0, 8], handR: [84, 0, 0], armL: [-20, 30, 0, 50], legL: [46, 6, 6, 56], legR: [-34, 8, 10, 12], footR: 24 })],
      [0.58, mk(s, { hip: [0, -0.15, 0.22], hipRot: [22, 6, 0], spine: [12, 0, 0], chest: [14, 10, 0], head: [-28, -10, 0],
        armR: [38, 0, 0, 10], handR: [88, 0, 0], armL: [-26, 32, 0, 46], legL: [48, 6, 6, 60], legR: [-34, 8, 10, 14], footR: 26 })],
      [0.8, mk(s, { hip: [0, -0.08, 0.1], hipRot: [8, -6, 0], chest: [6, 0, 0], armR: [36, 10, 0, 40], handR: [60, 0, 0] })],
      [1, s],
    ]);
  }
  if (w === 'saber') {
    // 反手横扫：左→右
    return track([
      [0, s],
      [0.26, mk(s, { hip: [0.02, -0.08, -0.04], hipRot: [6, 30, 0], spine: [4, 12, 0], chest: [4, 30, 0], head: [0, -50, 0],
        armR: [84, -78, 0, 70], handR: [40, 0, 0], armL: [20, 30, 0, 50], legL: [20, 8, 8, 30], legR: [-16, 10, 16, 34] })],
      [0.44, mk(s, { hip: [0, -0.12, 0.2], hipRot: [8, -16, 0], spine: [4, -8, 0], chest: [4, -18, 0], head: [0, 34, 0],
        armR: [86, 10, 0, 8], handR: [84, 0, 0], armL: [30, 30, 0, 80], legL: [44, 6, 6, 54], legR: [-34, 8, 10, 12], footR: 24 })],
      [0.6, mk(s, { hip: [-0.02, -0.12, 0.22], hipRot: [8, -34, 0], spine: [4, -12, 0], chest: [4, -30, 0], head: [0, 62, 0],
        armR: [84, 80, 0, 24], handR: [80, 0, 0], armL: [36, 30, 0, 90], legL: [46, 6, 6, 56], legR: [-34, 8, 10, 14], footR: 26 })],
      [0.82, mk(s, { hip: [0, -0.08, 0.1], hipRot: [4, -26, 0], armR: [60, 50, 0, 50], handR: [40, 0, 0] })],
      [1, s],
    ]);
  }
  if (w === 'spear') {
    // 横扫
    return track([
      [0, s],
      [0.26, mk(s, { hip: [-0.02, -0.08, -0.04], hipRot: [4, -60, 0], chest: [2, -30, 0], head: [0, 84, 0],
        armR: [30, 70, 0, 70], handR: [70, 30, 0], legL: [20, 8, 8, 30], legR: [-16, 10, 16, 34] })],
      [0.44, mk(s, { hip: [0, -0.12, 0.16], hipRot: [8, -4, 0], spine: [4, 6, 0], chest: [4, 14, 0], head: [0, -10, 0],
        armR: [60, 0, 0, 40], handR: [80, -20, 0], legL: [42, 6, 6, 52], legR: [-32, 8, 10, 14], footR: 22 })],
      [0.6, mk(s, { hip: [0.02, -0.12, 0.18], hipRot: [8, 30, 0], spine: [4, 10, 0], chest: [4, 30, 0], head: [0, -56, 0],
        armR: [70, -40, 0, 50], handR: [80, -50, 0], legL: [44, 6, 6, 54], legR: [-32, 8, 10, 14], footR: 24 })],
      [0.82, mk(s, { hip: [0, -0.08, 0.08], hipRot: [4, -10, 0], armR: [20, 0, 0, 60], handR: [60, 20, 0] })],
      [1, s],
    ]);
  }
  if (w === 'bow') return attackA(w);
  // 拳：右侧踢
  return track([
    [0, s],
    [0.26, mk(s, { hip: [0, -0.02, 0.02], hipRot: [-6, 10, -6], chest: [0, 6, 4], head: [0, -10, 0],
      legR: [70, 16, 0, 110], legL: [4, 6, 10, 16], footR: 20, armL: [50, 20, 0, 100], armR: [30, 30, 0, 100] })],
    [0.44, mk(s, { hip: [0, 0.0, 0.1], hipRot: [-16, 16, -8], spine: [-4, 0, 0], chest: [-4, 8, 6], head: [14, -18, 0],
      legR: [96, 10, 0, 6], legL: [-4, 6, 16, 12], footR: 30, footL: 0, armL: [40, 30, 0, 90], armR: [-10, 40, 0, 50] })],
    [0.58, mk(s, { hip: [0, 0.0, 0.11], hipRot: [-16, 18, -8], spine: [-4, 0, 0], chest: [-4, 8, 6], head: [14, -18, 0],
      legR: [94, 10, 0, 10], legL: [-4, 6, 16, 12], footR: 30, armL: [40, 30, 0, 90], armR: [-10, 40, 0, 50] })],
    [0.8, mk(s, { hip: [0, -0.03, 0.04], hipRot: [0, 0, 0], legR: [40, 12, 6, 80], armR: [30, 20, 0, 100] })],
    [1, s],
  ]);
}

function hit(w: WeaponKind): (t: number) => Pose {
  const s = stance(w);
  return track([
    [0, mk(s, { hip: [0, -0.06, -0.1], hipRot: [-10, s.hipRot[1] - 8, 3], spine: [-8, 0, 0], chest: [-12, -6, 4], head: [-14, s.head[1], 6],
      armL: [s.armL[0] + 14, s.armL[1] + 22, 0, s.armL[3] - 10], armR: [s.armR[0] + 10, s.armR[1] + 20, 0, s.armR[3] - 10] })],
    [1, mk(s, { hip: [0, -0.07, -0.05], hipRot: [-3, s.hipRot[1] - 3, 1], chest: [-3, -3, 2] })],
  ]);
}

function die(w: WeaponKind): (t: number) => Pose {
  const s = stance(w);
  const g = s.grip;
  return track([
    [0, mk(s, { hip: [0, -0.06, -0.06], hipRot: [-10, s.hipRot[1], 3], chest: [-12, -6, 4], head: [-16, 0, 6] })],
    [0.3, mk(s, { hip: [0, -0.3, -0.16], hipRot: [-28, 0, 4], spine: [-8, 0, 0], chest: [-10, 0, 0], head: [-18, 0, 8],
      legL: [40, 10, 0, 90], legR: [30, 12, 0, 80], armL: [40, 50, 0, 40], armR: [30, 50, 0, 40], handR: [60, 0, 0], grip: g })],
    [0.62, mk(s, { hip: [0, -0.64, -0.36], hipRot: [-66, 0, 3], spine: [-4, 0, 0], chest: [-4, 0, 0], head: [-6, 10, 0],
      legL: [50, 12, 0, 70], legR: [36, 14, 0, 56], armL: [60, 70, 0, 30], armR: [50, 74, 0, 30], handR: [70, 0, 0], grip: 0 })],
    [0.86, mk(s, { hip: [0, -0.8, -0.5], hipRot: [-88, 0, 0], spine: [2, 0, 0], chest: [2, 0, 0], head: [6, 18, 0],
      legL: [12, 14, 0, 26], legR: [4, 16, 0, 10], armL: [20, 84, 0, 20], armR: [14, 80, 0, 26], handR: [80, 0, 0], grip: 0 })],
    [1, mk(s, { hip: [0, -0.815, -0.5], hipRot: [-90, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], head: [8, 20, 0],
      legL: [8, 14, 0, 18], legR: [2, 16, 0, 6], armL: [12, 84, 0, 16], armR: [10, 80, 0, 22], handR: [86, 0, 0], grip: 0 })],
  ]);
}

function sit(_w: WeaponKind): (t: number) => Pose {
  const r = restPose();
  const base = mk(r, {
    hip: [0, -0.74, 0], hipRot: [-2, 0, 0], spine: [2, 0, 0], chest: [0, 0, 0], head: [6, 0, 0],
    legL: [84, 52, 20, 142], legR: [78, 56, 20, 146], footL: 30, footR: 30,
    armL: [36, 30, -20, 76], armR: [36, 30, -20, 76], handL: [30, 0, 0], handR: [30, 0, 0],
  });
  return (t: number) => {
    const s = Math.sin(t * Math.PI * 2);
    const p = mk(base, {});
    p.chest[0] += 1.8 * s; p.spine[0] += 0.8 * s; p.hip[1] += 0.004 * s; p.head[0] -= 1.2 * s;
    return p;
  };
}

export interface AnimDef {
  name: string;
  n: number;
  fps: number;
  loop: boolean;
  dur: number;
  hit?: number;
  /** 链模拟的迎面风（向后的加速度） */
  wind?: number;
  pose: (t: number) => Pose;
}

export function humanoidAnims(w: WeaponKind, set: 'player' | 'mob'): AnimDef[] {
  const list: AnimDef[] = [
    { name: 'idle', n: 4, fps: 3, loop: true, dur: 1.4, pose: idle(w) },
    { name: 'run', n: 8, fps: 12, loop: true, dur: 0.66, wind: 9, pose: gait(w, true) },
    { name: 'atk1', n: 8, fps: 14, loop: false, dur: 0.58, hit: 3, pose: attackA(w) },
    { name: 'hit', n: 2, fps: 6, loop: false, dur: 0.3, pose: hit(w) },
    { name: 'die', n: 6, fps: 8, loop: false, dur: 0.8, pose: die(w) },
  ];
  if (set === 'player') {
    if (w !== 'bow') list.push({ name: 'atk2', n: 8, fps: 14, loop: false, dur: 0.58, hit: 3, pose: attackB(w) });
    list.push({ name: 'sit', n: 2, fps: 1, loop: true, dur: 2.4, pose: sit(w) });
  } else {
    list.push({ name: 'walk', n: 8, fps: 9, loop: true, dur: 0.9, wind: 4, pose: gait(w, false) });
  }
  if (w === 'bow') { const a = list.find((x) => x.name === 'atk1')!; a.hit = 5; a.n = 9; a.dur = 0.7; }
  return list;
}

/** NPC 的闲立姿态：按身份给一点不同的站相 */
export function npcIdle(look: Look, id: string): AnimDef {
  const r = restPose();
  let base: Pose;
  if (look.weapon === 'spear') base = mk(r, { legL: [4, 6, 6, 4], legR: [-2, 6, 8, 4], armR: [30, 26, 0, 46], handR: [-8, 0, 0], armL: [4, 10, 0, 14], head: [0, 0, 0] });
  else if (look.weapon === 'bow') base = mk(r, { legL: [6, 6, 6, 6], legR: [-3, 7, 10, 6], armL: [16, 16, 0, 26], handL: [0, 0, 0], armR: [34, -8, 0, 96], hipRot: [0, -8, 0] });
  else if (id === 'master') base = mk(r, { armL: [-22, 4, 0, 34], armR: [-22, 4, 0, 34], handL: [0, 40, 0], handR: [0, 40, 0], chest: [-4, 0, 0], legL: [2, 6, 6, 2], legR: [2, 6, 6, 2] });
  else if (id === 'elder') base = mk(r, { spine: [8, 0, 0], chest: [8, 0, 0], head: [-6, 0, 0], armL: [30, -16, 0, 74], armR: [30, -16, 0, 74], hip: [0, -0.02, 0], legL: [4, 5, 6, 8], legR: [4, 5, 6, 8] });
  else if (id === 'smith' || id === 'innkeeper') base = mk(r, { armL: [22, 24, 0, 100], armR: [22, 24, 0, 100], handL: [20, -30, 0], handR: [20, -30, 0], legL: [2, 9, 10, 2], legR: [2, 9, 10, 2] });
  else if (id === 'kid') base = mk(r, { armL: [10, 30, 0, 30], armR: [40, 20, 0, 70], legL: [8, 6, 6, 6], legR: [-4, 6, 8, 4], head: [-8, 10, 0] });
  else base = mk(r, { armL: [34, -18, 0, 78], armR: [34, -18, 0, 78], handL: [10, 0, 0], handR: [10, 0, 0], legL: [2, 5, 6, 2], legR: [2, 5, 6, 2] });
  const pose = (t: number) => {
    const s = Math.sin(t * Math.PI * 2);
    const p = mk(base, {});
    p.hip[1] += 0.006 * s; p.chest[0] += 1.5 * s; p.head[0] -= 1.0 * s; p.head[1] += 3 * Math.sin(t * Math.PI * 2 + 1);
    return p;
  };
  return { name: 'idle', n: 4, fps: 3, loop: true, dur: 1.6, pose };
}

export interface SimFrame { pose: Pose; chains: number[][]; }

/** 沿动画时间线模拟链，返回每帧的姿势与链状态 */
export function simulate(h: Humanoid, a: AnimDef): SimFrame[] {
  const out: SimFrame[] = [];
  h.root.rotation.y = 0;
  const frameT = (f: number) => (a.loop ? f / a.n : a.n > 1 ? f / (a.n - 1) : 0);
  const wind = new THREE.Vector3(0, 0, -(a.wind ?? 0));
  const dt = 1 / 120;
  h.setPose(a.pose(0));
  h.resetChains();
  // 预热：循环动画先跑两圈，一次性动画在首帧姿势静置
  const pre = a.loop ? a.dur * 2 : 0.5;
  for (let t = 0; t < pre; t += dt) {
    h.setPose(a.pose(a.loop ? t / a.dur : 0));
    h.stepChains(dt, wind);
  }
  for (let f = 0; f < a.n; f++) {
    const t1 = frameT(f);
    if (f > 0) {
      const t0 = frameT(f - 1);
      const steps = Math.max(1, Math.round(((t1 - t0) * a.dur) / dt));
      for (let i = 1; i <= steps; i++) {
        h.setPose(a.pose(t0 + ((t1 - t0) * i) / steps));
        h.stepChains(dt, wind);
      }
    }
    const pose = a.pose(t1);
    h.setPose(pose);
    out.push({ pose, chains: h.saveChains() });
  }
  return out;
}

export const DIR_ANGLE = (i: number) => i * 45 * DEG;
