import * as THREE from 'three';
import { CAnim, footCycle, LegParts, LegSpec, loft, qp, QPose, qtrack, QuadRig, Rig, smooth, zSphere } from './creature_quad';
import { box, canvasTex, cyl, DEG, ellipsoid, fbm, limb, mat, mesh, tube } from './geo';

type RGB = [number, number, number];
const cap = (z: number, y = 0) => ({ z, w: 0.003, up: 0.003, dn: 0.003, y });

// ============================================================
// 鸡（复用四足骨架：无前腿，后腿即两足）
// ============================================================
export function makeChicken(): { rig: QuadRig; anims: CAnim<QPose>[]; info: { radius: number; height: number } } {
  const feather = (key: string, base: RGB, dark: RGB, seed: number) => mat('#ffffff', {
    map: canvasTex('feather_' + key, 128, (u, v) => {
      // 鳞片状的羽毛排列
      const row = v * 9, col = u * 14 + (Math.floor(row) % 2) * 0.5;
      const fx = col - Math.floor(col) - 0.5, fy = row - Math.floor(row);
      const edge = Math.min(1, Math.max(0, (Math.hypot(fx * 1.3, fy - 0.2) - 0.42) * 6));
      const n = 0.86 + 0.28 * fbm(u * 20, v * 20, 20, 3, seed);
      const t = edge * 0.55;
      return [(base[0] + (dark[0] - base[0]) * t) * n, (base[1] + (dark[1] - base[1]) * t) * n, (base[2] + (dark[2] - base[2]) * t) * n] as RGB;
    }),
  });
  const bodyM = feather('body', [0.6, 0.3, 0.13], [0.3, 0.14, 0.07], 3);
  const neckM = feather('neck', [0.82, 0.52, 0.16], [0.55, 0.28, 0.08], 5);
  const wingM = feather('wing', [0.42, 0.21, 0.1], [0.2, 0.1, 0.06], 7);
  const tailM = mat('#18261f', { kind: 'hair' });
  const red = mat('#c5271f', { kind: 'skin' });
  const yellow = mat('#d8a637', { kind: 'leather' });

  const hl = { l1: 0.07, l2: 0.09, pawH: 0.02 };
  const hind: LegSpec = {
    joint: [0.04, -0.035, -0.01], ...hl, foot: [0.046, 0.005], bend: -1, slide: 0.02,
    build: (p: LegParts) => {
      p.upper.add(mesh(limb(0.034, 0.014, 0.07, 8), bodyM));
      p.mid.add(mesh(limb(0.009, 0.008, 0.09, 6), yellow));
      for (const a of [-28, 0, 28]) {
        const g = cyl(0.006, 0.004, 0.055, 5); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.0275);
        p.paw.add(mesh(g, yellow, { p: [0, -0.014, 0], r: [0, a, 0] }));
      }
      const b = cyl(0.005, 0.004, 0.03, 5); b.rotateX(Math.PI / 2); b.translate(0, 0, -0.015);
      p.paw.add(mesh(b, yellow, { p: [0, -0.014, 0] }));
    },
  };
  const wings: THREE.Group[] = [];
  const rig = new QuadRig({
    spineY: 0.2, front: null, hind, neckAt: [0, 0.05, 0.085], neckUp: 62, neckLen: 0.1, headPitch: 58,
    build: (r) => {
      r.fore.add(mesh(loft(smooth([
        cap(-0.15, 0.035), { z: -0.12, w: 0.045, up: 0.055, dn: 0.04, y: 0.028 }, { z: -0.04, w: 0.076, up: 0.08, dn: 0.076, y: 0.005 },
        { z: 0.04, w: 0.073, up: 0.076, dn: 0.08 }, { z: 0.1, w: 0.052, up: 0.056, dn: 0.062, y: 0.01 }, cap(0.135, 0.02),
      ]), 16), bodyM));
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(0.064 * s, 0.035, -0.01);
        w.add(mesh(ellipsoid(0.018, 0.05, 0.088), wingM, { p: [0.012 * s, -0.03, -0.01] }));
        r.fore.add(w);
        wings.push(w);
      }
      // 尾羽
      for (let k = 0; k < 6; k++) {
        const spread = (k - 2.5) * 9;
        const g = ellipsoid(0.011, 0.085, 0.03); g.translate(0, 0.075, 0);
        r.fore.add(mesh(g, tailM, { p: [0, 0.045, -0.125], r: [-(38 + Math.abs(k - 2.5) * 10), 0, spread] }));
      }
      r.neck.add(mesh(loft(smooth([
        cap(-0.04), { z: -0.02, w: 0.042, up: 0.044, dn: 0.048 }, { z: 0.05, w: 0.031, up: 0.031, dn: 0.034 }, { z: 0.1, w: 0.027, up: 0.027, dn: 0.027 }, cap(0.12),
      ]), 12), neckM));
      const h = r.head;
      h.add(mesh(zSphere(0.031, 0.033, 0.037, 12, 7), neckM, { p: [0, 0.006, 0.016] }));
      const beak = new THREE.ConeGeometry(0.012, 0.038, 6); beak.rotateX(Math.PI / 2);
      h.add(mesh(beak, yellow, { p: [0, -0.002, 0.066] }));
      [-0.006, 0.012, 0.03].forEach((z, i) => h.add(mesh(ellipsoid(0.006, 0.018 - i * 0.002, 0.012), red, { p: [0, 0.042 - i * 0.004, z] })));
      h.add(mesh(ellipsoid(0.008, 0.017, 0.008), red, { p: [0, -0.036, 0.04] }));
      for (const s of [-1, 1]) h.add(mesh(ellipsoid(0.005, 0.005, 0.004), mat('#120d0a', { kind: 'flat' }), { p: [0.026 * s, 0.012, 0.03] }));
    },
  });
  rig.onPose = (p) => { wings.forEach((w, i) => { w.rotation.z = (i === 0 ? -1 : 1) * p.aux * 62 * DEG; }); };

  const base = qp({});
  const peck = qtrack([
    [0, base],
    [0.2, qp({ neck: [2, 14], head: [0, 22, 0] })],
    [0.42, qp({ pos: [0, -0.008, 0.012], rot: [30, 0, 0], neck: [-78, 0], head: [-22, 0, 0] })],
    [0.54, qp({ pos: [0, -0.004, 0.008], rot: [20, 0, 0], neck: [-50, 0], head: [-14, 0, 0] })],
    [0.66, qp({ pos: [0, -0.008, 0.012], rot: [30, 0, 0], neck: [-80, 0], head: [-22, 0, 0] })],
    [0.86, qp({ neck: [-6, -10], head: [0, -16, 0] })],
    [1, base],
  ], true);
  const walk = (t: number) => {
    const p = qp({});
    const a = t * Math.PI * 2;
    p.hl = footCycle(t, 0, 0.58, 0.11, 0, 0.038, 40);
    p.hr = footCycle(t, 0.5, 0.58, 0.11, 0, 0.038, 40);
    p.pos = [0.006 * Math.sin(a), 0.006 * Math.cos(a * 2), 0];
    p.rot = [3, 0, 3 * Math.sin(a)];
    // 走一步点一下头
    p.neck = [9 * Math.sin(a * 2 + 0.8), 0];
    p.head = [-7 * Math.sin(a * 2 + 0.8), 0, 0];
    return p;
  };
  const hit = qtrack([
    [0, qp({ pos: [0, 0.07, -0.04], rot: [-14, 0, 6], neck: [12, -14], head: [-12, -10, 0], aux: 1, hl: [0, 0.04, -0.01, 40], hr: [0, 0.05, 0.01, 40] })],
    [1, qp({ pos: [0, 0.01, -0.02], rot: [-4, 0, 2], neck: [4, -4], aux: 0.35 })],
  ]);
  const drop = -(0.2 - 0.075);
  const die = qtrack([
    [0, qp({ pos: [0, 0.05, -0.03], rot: [-12, 0, 8], neck: [10, -12], aux: 1, hl: [0, 0.03, 0, 40], hr: [0, 0.04, 0, 40] })],
    [0.4, qp({ pos: [0.03, drop * 0.5, -0.02], rot: [0, 0, 44], neck: [-20, -6], aux: 0.8, hl: [0.03, 0.02, 0, 20], hr: [0.06, 0, 0, 20] })],
    [0.8, qp({ pos: [0.06, drop, -0.02], rot: [0, 0, 88], neck: [-62, -18], head: [-40, 0, 0], aux: 0.5, hl: [0.11, 0.1, 0.02, 30], hr: [0.2, 0.02, -0.02, 30] })],
    [1, qp({ pos: [0.06, drop, -0.02], rot: [0, 0, 90], neck: [-64, -20], head: [-44, 0, 0], aux: 0.42, hl: [0.11, 0.1, 0.02, 30], hr: [0.2, 0.02, -0.02, 30] })],
  ]);
  const anims: CAnim<QPose>[] = [
    { name: 'idle', n: 4, fps: 3, loop: true, dur: 1.4, pose: peck },
    { name: 'walk', n: 6, fps: 10, loop: true, dur: 0.6, pose: walk },
    { name: 'hit', n: 2, fps: 6, loop: false, dur: 0.3, pose: hit },
    { name: 'die', n: 4, fps: 7, loop: false, dur: 0.6, pose: die },
  ];
  return { rig, anims, info: { radius: 0.18, height: 0.5 } };
}

// ============================================================
// 木人桩
// ============================================================
export type DummyPose = [number, number];

export class DummyRig implements Rig<DummyPose> {
  root = new THREE.Group();
  pivot = new THREE.Group();
  constructor() {
    const grain = (key: string, c: RGB, seed: number) => mat('#ffffff', {
      map: canvasTex('wood_' + key, 256, (u, v) => {
        const g = 0.7 + 0.42 * fbm(u * 36, v * 3, 36, 4, seed) + 0.06 * Math.sin(v * 40 + fbm(u * 6, v * 6, 6, 2, seed + 1) * 9);
        return [c[0] * g, c[1] * g, c[2] * g] as RGB;
      }),
    });
    const wood = grain('post', [0.52, 0.33, 0.18], 3), woodDark = grain('base', [0.32, 0.21, 0.13], 5), woodArm = grain('arm', [0.6, 0.4, 0.22], 7);
    const straw = mat('#c4a35b', { kind: 'straw' }), rope = mat('#a98f58', { kind: 'straw' });
    const iron = mat('#3a3a3d', { kind: 'metal' }), red = mat('#a82a22'), sack = mat('#b79f72', { kind: 'cloth' });

    // 十字底座
    this.root.add(mesh(box(1.05, 0.1, 0.17), woodDark, { p: [0, 0.05, 0] }));
    this.root.add(mesh(box(0.17, 0.1, 1.05), woodDark, { p: [0, 0.052, 0] }));
    for (const [x, z] of [[0.46, 0], [-0.46, 0], [0, 0.46], [0, -0.46]] as const) {
      this.root.add(mesh(box(x ? 0.06 : 0.2, 0.115, x ? 0.2 : 0.06), iron, { p: [x, 0.052, z] }));
    }
    this.root.add(mesh(cyl(0.14, 0.17, 0.18, 14), woodDark, { p: [0, 0.16, 0] }));
    this.root.add(mesh(new THREE.TorusGeometry(0.146, 0.014, 6, 20), iron, { p: [0, 0.24, 0], r: [90, 0, 0] }));

    // 桩身（绕底部摇晃）
    this.pivot.position.set(0, 0.14, 0);
    this.root.add(this.pivot);
    const P = this.pivot;
    P.add(mesh(cyl(0.098, 0.11, 1.42, 16), wood, { p: [0, 0.71, 0] }));
    // 草垫躯干与捆绳
    P.add(mesh(cyl(0.158, 0.152, 0.52, 18), straw, { p: [0, 0.94, 0] }));
    for (const y of [0.7, 0.82, 0.94, 1.06, 1.18]) {
      P.add(mesh(new THREE.TorusGeometry(0.158, 0.012, 6, 22), rope, { p: [0, y, 0], r: [90, 0, 0] }));
    }
    // 头：麻布包 + 红头巾
    P.add(mesh(ellipsoid(0.125, 0.135, 0.125, 18, 14), sack, { p: [0, 1.5, 0] }));
    P.add(mesh(new THREE.TorusGeometry(0.108, 0.012, 6, 20), rope, { p: [0, 1.39, 0], r: [90, 0, 0] }));
    P.add(mesh(new THREE.TorusGeometry(0.121, 0.02, 6, 22), red, { p: [0, 1.55, 0], r: [90, 0, 0], s: [1, 1, 1.5] }));
    P.add(mesh(box(0.035, 0.2, 0.006), mat('#a82a22', { double: true }), { p: [0.03, 1.45, -0.128], r: [8, 0, 6] }));
    P.add(mesh(box(0.035, 0.16, 0.006), mat('#a82a22', { double: true }), { p: [-0.03, 1.47, -0.13], r: [10, 0, -8] }));
    // 面部的墨圈靶心
    P.add(mesh(new THREE.TorusGeometry(0.05, 0.007, 5, 18), mat('#2a211b', { kind: 'flat' }), { p: [0, 1.5, 0.117] }));
    P.add(mesh(ellipsoid(0.014, 0.014, 0.006), red, { p: [0, 1.5, 0.126] }));
    // 桩手：上两只外张，中一只前伸
    const arm = (y: number, yaw: number, pitch: number, len: number) => {
      const g = cyl(0.026, 0.034, len, 10); g.rotateX(Math.PI / 2); g.translate(0, 0, len / 2 + 0.06);
      P.add(mesh(g, woodArm, { p: [0, y, 0], r: [-pitch, yaw, 0] }));
    };
    arm(1.26, 26, 8, 0.46);
    arm(1.26, -26, 8, 0.46);
    arm(0.98, 0, 0, 0.42);
    // 桩脚：前伸后下折
    P.add(mesh(tube([[0, 0.5, 0.08], [0, 0.47, 0.34], [0, 0.4, 0.5], [0, 0.16, 0.58]], 0.034, 8, 16), woodArm));
    // 桩身铁箍
    for (const y of [0.42, 1.3]) P.add(mesh(new THREE.TorusGeometry(0.106, 0.011, 6, 20), iron, { p: [0, y, 0], r: [90, 0, 0] }));
    this.setPose([0, 0]);
  }
  setPose(p: DummyPose) {
    this.pivot.rotation.set(p[0] * DEG, 0, p[1] * DEG);
    this.root.updateMatrixWorld(true);
  }
  resetChains() {}
  stepChains() {}
  placeChains() {}
  saveChains(): number[][] { return []; }
  loadChains() {}
}

export function makeDummy(): { rig: DummyRig; anims: CAnim<DummyPose>[]; info: { radius: number; height: number } } {
  const rig = new DummyRig();
  const wobble: DummyPose[] = [[-10, 3], [6, -2], [-3, 1], [0, 0]];
  const anims: CAnim<DummyPose>[] = [
    { name: 'idle', n: 1, fps: 1, loop: true, dur: 1, pose: () => [0, 0] },
    { name: 'hit', n: 4, fps: 12, loop: false, dur: 0.34, pose: (t) => wobble[Math.min(3, Math.round(t * 3))] },
  ];
  return { rig, anims, info: { radius: 0.4, height: 1.8 } };
}
