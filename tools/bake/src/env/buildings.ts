import * as THREE from 'three';
import { cyl, ellipsoid, lathe, rng } from '../geo';
import {
  Build, bx, column, cy, DEG, doorPanel, doorway, FIRE, gableWall, interiorMat, lantern, M, mat, mesh, plaque, plinth,
  RED_GLOW, rod, roof, RoofOpts, roofY, steps, texMat, WARM, windowPanel,
} from './arch';
import * as T from './tex_build';

const WOOD_DARK = '#4a3122';
const WOOD_RED = '#8a3324';
type V3 = [number, number, number];

/** 给已有对象设置位置/旋转（度） */
export function place<O extends THREE.Object3D>(o: O, p: V3, r?: V3): O {
  o.position.set(...p);
  if (r) o.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
  return o;
}

/** 把屋顶放到指定檐口高度；rotY=90 时脊沿 Z 方向 */
function placeRoof(o: RoofOpts, y: number, x = 0, z = 0, rotY = 0): THREE.Group {
  return place(roof(o), [x, y, z], [0, rotY, 0]);
}

/** 让屋面在墙线（距脊 wallHalf）处刚好盖过墙顶所需的檐口高度 */
const eaveFor = (o: RoofOpts, wallHalf: number, wallTop: number) => wallTop + 0.08 - roofY(o, wallHalf);

function hangLantern(b: Build, x: number, y: number, z: number, r = 0.2, h = 0.34, lit = true, color = '#c22a20') {
  b.add(place(lantern(r, h, color), [x, y, z]));
  if (lit) b.light([x, y - 0.3, z + 0.15], RED_GLOW, 3.8, { flicker: 0.12 });
}

export function firewood(n: number, len = 0.7): THREE.Group {
  const g = new THREE.Group();
  const r = rng(n * 7 + 3);
  let k = 0;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < n - row; i++) {
      const rad = 0.07 + r() * 0.025;
      g.add(mesh(cy(rad, rad, len, 7, 0.6, 1), M.woodFine(k++ % 3 ? '#9a7850' : '#7a5c3e'), {
        p: [(i - (n - row - 1) / 2) * 0.17, 0.08 + row * 0.145, (r() - 0.5) * 0.06], r: [90, 0, 0],
      }));
    }
  }
  return g;
}

export function jar(r = 0.3, h = 0.6, color = '#7a5640', lid?: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(lathe([[r * 0.55, 0], [r * 0.95, h * 0.25], [r, h * 0.55], [r * 0.7, h * 0.88], [r * 0.62, h], [r * 0.5, h * 0.96], [0.01, h * 0.9]], 14), M.clay(color)));
  if (lid) g.add(mesh(cyl(r * 0.66, r * 0.66, 0.05, 12), mat(lid), { p: [0, h + 0.01, 0] }));
  return g;
}

export function basket(r = 0.3, h = 0.3, fill?: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(lathe([[r * 0.7, 0], [r, h], [r * 0.93, h], [r * 0.64, 0.03], [0.01, 0.03]], 12), M.thatch('#b8975a')));
  if (fill) g.add(mesh(ellipsoid(r * 0.9, h * 0.35, r * 0.9, 10, 6), mat(fill), { p: [0, h * 0.82, 0] }));
  return g;
}

// ---------------------------------------------------------------- 立面
type Bay = 'wall' | 'door' | 'open' | 'win' | 'panel' | 'none';
interface Facade {
  x0: number; x1: number; base: number; wh: number; z: number;
  bays: Bay[];
  widths?: number[];
  wood?: string;
  wall?: THREE.Material;
  wainscot?: number;
  winKind?: T.LatticeKind; winW?: number; winH?: number; winY?: number;
  doorW?: number; doorH?: number; doorCol?: string;
  round?: boolean;
  lit?: boolean;
}

/** 正立面：粉墙 + 槛墙 + 木构架 + 各开间门窗。返回各开间中心 x */
function facade(b: Build, f: Facade): number[] {
  const W = f.x1 - f.x0, cx = (f.x0 + f.x1) / 2;
  const wood = f.wood ?? WOOD_DARK;
  const wm = M.woodFine(wood);
  const wains = f.wainscot ?? 0.8;
  b.add(mesh(bx(W, f.wh, 0.2, 4), f.wall ?? M.plaster(), { p: [cx, f.base + f.wh / 2, f.z - 0.12] }));
  if (wains > 0) b.add(mesh(bx(W, wains, 0.26, 1.2), M.brick(), { p: [cx, f.base + wains / 2, f.z - 0.11] }));
  const n = f.bays.length;
  const widths = f.widths ?? f.bays.map(() => W / n);
  const centers: number[] = [];
  let x = f.x0;
  const post = (px: number) => {
    if (f.round) b.add(place(column(f.wh, 0.15, wood), [px, f.base, f.z + 0.02]));
    else b.add(mesh(bx(0.24, f.wh, 0.3), wm, { p: [px, f.base + f.wh / 2, f.z - 0.02] }));
  };
  post(f.x0 + 0.12);
  for (let i = 0; i < n; i++) {
    const bw = widths[i], c = x + bw / 2;
    centers.push(c);
    const kind = f.bays[i];
    if (kind === 'door') {
      b.add(place(doorPanel(f.doorW ?? 1.6, f.doorH ?? 2.25, f.doorCol ?? '#5a2a1e', wood), [c, f.base, f.z + 0.03]));
    } else if (kind === 'open') {
      b.add(place(doorway(f.doorW ?? 1.7, f.doorH ?? 2.3, wood), [c, f.base, f.z + 0.03]));
      if (f.lit !== false) b.light([c, f.base + 1.2, f.z + 0.6], WARM, 4.2);
    } else if (kind === 'win') {
      const ww = f.winW ?? Math.min(1.5, bw - 0.7), wh = f.winH ?? 1.1;
      b.add(place(windowPanel(ww, wh, f.winKind ?? 'grid', wood), [c, f.base + (f.winY ?? 1.45), f.z + 0.01]));
      if (f.lit !== false) b.light([c, f.base + (f.winY ?? 1.45), f.z + 0.5], WARM, 3.4);
    } else if (kind === 'panel') {
      const ph = Math.min(f.wh - 0.75, 2.5), pw = bw - 0.5;
      const half = pw / 2;
      for (const s of [-1, 1]) b.add(place(windowPanel(half - 0.06, ph, 'panel', wood), [c + s * half / 2, f.base + 0.12 + ph / 2, f.z + 0.02]));
      if (f.lit !== false) b.light([c, f.base + 1.5, f.z + 0.5], WARM, 3.6);
    }
    x += bw;
    post(i === n - 1 ? f.x1 - 0.12 : x);
  }
  b.add(mesh(bx(W + 0.16, 0.26, 0.32, 1, 'x'), wm, { p: [cx, f.base + f.wh - 0.13, f.z - 0.01] }));
  return centers;
}

/** 后墙与两侧墙（侧面看不到，主要用于投影与遮蔽） */
function shell(b: Build, x0: number, x1: number, z0: number, z1: number, base: number, wh: number, gableRise = 0, material = M.plaster()) {
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.add(mesh(bx(W, wh, 0.22, 4), material, { p: [cx, base + wh / 2, z0 + 0.11] }));
  for (const x of [x0 + 0.11, x1 - 0.11]) {
    if (gableRise > 0) b.add(place(gableWall(D, wh, gableRise, 0.22, material), [x, base, cz], [0, 90, 0]));
    else b.add(mesh(bx(0.22, wh, D, 4), material, { p: [x, base + wh / 2, cz] }));
  }
}

// ================================================================ 民居 A：三开间悬山
export function houseA(): Build {
  const b = new Build('house_a', 'building');
  const W = 7.0, D = 4.4, base = 0.3, wh = 3.3, zf = D / 2;
  b.add(plinth(7.8, 5.4, base));
  b.add(place(steps(1.9, 2, base), [0, 0, 2.7]));
  shell(b, -W / 2, W / 2, -zf, zf, base, wh, 1.1);
  facade(b, { x0: -W / 2, x1: W / 2, base, wh, z: zf, bays: ['win', 'door', 'win'], widths: [2.4, 2.2, 2.4] });
  const ro: RoofOpts = { W: 8.3, D: 5.5, rise: 1.75, lift: 0.18 };
  b.add(placeRoof(ro, eaveFor(ro, zf, base + wh)));
  b.add(place(firewood(5), [-2.5, base, zf + 0.34]));
  b.add(place(jar(0.3, 0.62), [2.95, base, zf + 0.34]));
  b.add(place(jar(0.2, 0.42, '#8a6446'), [2.4, base, zf + 0.36]));
  hangLantern(b, 1.3, base + 2.55, zf + 0.42, 0.14, 0.24);
  b.solid(-3.9, -2.7, 3.9, 2.7);
  b.door(0, 3.7);
  return b;
}

// ================================================================ 民居 B：山面朝前的马头墙
function matouWall(b: Build, z: number, base: number, front: boolean) {
  const plaster = M.plaster();
  const th = 0.34;
  // [x0, x1, 高]
  const secs: [number, number, number][] = [[-1.2, 1.2, 5.75], [-2.15, -1.2, 4.9], [1.2, 2.15, 4.9], [-3.05, -2.15, 4.05], [2.15, 3.05, 4.05]];
  for (const [x0, x1, h] of secs) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    b.add(mesh(bx(w, h - base, th, 4), plaster, { p: [cx, base + (h - base) / 2, z] }));
    // 墙帽：小瓦顶 + 外端鹊尾
    const capW = w + (cx === 0 ? 0.5 : 0.3);
    const off = cx === 0 ? 0 : Math.sign(cx) * 0.12;
    b.add(placeRoof({ W: capW, D: 0.74, rise: 0.2, pitch: 0.17, amp: 0.03, ridgeH: 0.09, plain: true }, h - 0.03, cx + off, z));
    const ends = cx === 0 ? [-1, 1] : [Math.sign(cx)];
    for (const s of ends) {
      const ex = cx + off + s * capW / 2;
      b.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(ex - s * 0.5, h + 0.3, z), new THREE.Vector3(ex - s * 0.1, h + 0.34, z),
        new THREE.Vector3(ex + s * 0.16, h + 0.46, z), new THREE.Vector3(ex + s * 0.3, h + 0.66, z),
      ]), 10, 0.055, 6), M.stone('#5b6066')));
    }
    // 檐下墨线
    b.add(mesh(bx(w + 0.02, 0.1, th + 0.04, 2), M.brick('#6f757a'), { p: [cx, h - 0.1, z] }));
  }
  if (front) b.add(mesh(bx(6.1, 0.6, th + 0.06, 1.6), M.stone('#8f8c84'), { p: [0, base + 0.3, z] }));
}

export function houseB(): Build {
  const b = new Build('house_b', 'building');
  const W = 5.6, D = 7.2, base = 0.25, wh = 3.25, zf = D / 2;
  b.add(plinth(6.5, 7.9, base));
  b.add(place(steps(1.7, 2, base), [0, 0, 3.95]));
  // 侧墙
  for (const s of [-1, 1]) b.add(mesh(bx(0.24, wh, D, 4), M.plaster(), { p: [s * (W / 2 - 0.12), base + wh / 2, 0] }));
  // 屋顶：脊沿 Z
  const ro: RoofOpts = { W: D - 0.3, D: 6.5, rise: 1.7, plain: true, ridgeH: 0.22 };
  b.add(placeRoof(ro, eaveFor(ro, W / 2, base + wh), 0, 0, 90));
  matouWall(b, zf, base, true);
  matouWall(b, -zf, base, false);
  // 石库门 + 门罩
  const st = M.stone('#a8a49a');
  b.add(place(doorPanel(1.45, 2.35, '#2f211a', '#2a1c14', false), [0, base, zf + 0.2]));
  for (const s of [-1, 1]) b.add(mesh(bx(0.3, 2.7, 0.16, 1.4), st, { p: [s * 1.0, base + 1.35, zf + 0.2] }));
  b.add(mesh(bx(2.5, 0.36, 0.2, 1.4, 'x'), st, { p: [0, base + 2.72, zf + 0.21] }));
  b.add(place(plaque('福', 0.66, 0.66, { bg: '#7c2219', fg: '#e3bf62' }), [0, base + 4.35, zf + 0.2], [0, 0, 45]));
  b.add(placeRoof({ W: 2.5, D: 1.3, rise: 0.3, pitch: 0.17, amp: 0.03, ridgeH: 0.1, lift: 0.12, tip: 0.18, ridgeR: 0.05 }, base + 3.02, 0, zf + 0.1));
  for (const s of [-1, 1]) b.add(mesh(bx(0.14, 0.3, 0.46), M.woodFine(WOOD_DARK), { p: [s * 1.0, base + 2.95, zf + 0.38], r: [-30, 0, 0] }));
  // 高窗
  for (const s of [-1, 1]) {
    b.add(place(windowPanel(0.62, 0.72, 'diamond', '#3a3a3a'), [s * 2.15, base + 2.5, zf + 0.19]));
    b.light([s * 2.15, base + 2.5, zf + 0.7], WARM, 2.6);
  }
  hangLantern(b, -1.45, base + 2.5, zf + 0.5, 0.15, 0.26);
  b.add(place(jar(0.28, 0.58), [2.4, base, zf + 0.42]));
  b.add(place(basket(0.26, 0.26, '#b9482e'), [-2.35, base, zf + 0.42]));
  b.solid(-3.25, -3.95, 3.25, 3.95);
  b.door(0, 4.9);
  return b;
}

// ================================================================ 民居 C：曲尺形，正屋 + 山面朝前的厢房
export function houseC(): Build {
  const b = new Build('house_c', 'building');
  const base = 0.28, wh = 3.2;
  // 正屋 x∈[-4.4,1.3] z∈[-2.9,0.9]；厢房 x∈[1.3,4.4] z∈[-2.9,2.9]
  b.add(place(plinth(6.2, 4.6, base), [-1.8, 0, -1.0]));
  b.add(place(plinth(3.7, 6.4, base), [2.85, 0, 0]));
  b.add(place(plinth(5.6, 2.0, 0.14, '#a39f95'), [-1.6, 0, 2.2]));
  b.add(place(steps(1.6, 1, base), [-2.6, 0, 1.3]));
  shell(b, -4.4, 1.3, -2.9, 0.9, base, wh, 0.95);
  facade(b, { x0: -4.4, x1: 1.3, base, wh, z: 0.9, bays: ['door', 'win'], widths: [2.9, 2.8], winKind: 'diamond' });
  const rm: RoofOpts = { W: 6.6, D: 4.9, rise: 1.5, lift: 0.16 };
  b.add(placeRoof(rm, eaveFor(rm, 1.9, base + wh), -1.75, -1.0));
  // 厢房
  const wx = 2.85, ww = 3.1;
  for (const s of [-1, 1]) b.add(mesh(bx(0.22, wh, 5.8, 4), M.plaster(), { p: [wx + s * (ww / 2 - 0.11), base + wh / 2, 0] }));
  b.add(mesh(bx(ww, wh, 0.22, 4), M.plaster(), { p: [wx, base + wh / 2, -2.79] }));
  const ro: RoofOpts = { W: 6.6, D: 4.3, rise: 1.5, plain: true, ridgeH: 0.22 };
  const eave = eaveFor(ro, ww / 2, base + wh);
  b.add(placeRoof(ro, eave, wx, 0, 90));
  b.add(place(gableWall(ww, wh - 0.12, 1.2, 0.22, M.plaster()), [wx, base, 2.79]));
  b.add(mesh(bx(ww, 0.8, 0.26, 1.2), M.brick(), { p: [wx, base + 0.4, 2.8] }));
  const wm = M.woodFine(WOOD_DARK);
  for (const s of [-1, 1]) b.add(mesh(bx(0.22, wh - 0.1, 0.3), wm, { p: [wx + s * (ww / 2 - 0.11), base + (wh - 0.1) / 2, 2.84] }));
  // 博风板 + 悬鱼
  for (const s of [-1, 1]) {
    const len = Math.hypot(2.15, 1.5);
    b.add(mesh(bx(len, 0.22, 0.06, 1, 'x'), wm, { p: [wx + s * 1.075, eave + 0.68, 3.28], r: [0, 0, -s * Math.atan2(1.5, 2.15) / DEG] }));
  }
  b.add(mesh(bx(0.22, 0.42, 0.05), wm, { p: [wx, eave + 1.2, 3.3], r: [0, 0, 45] }));
  // 圆窗
  const lt = T.lattice('diamond', '#3b2618');
  const disc = cyl(0.55, 0.55, 0.05, 28);
  b.add(mesh(disc, [mat('#3b2618'), texMat(lt.map, { emissive: '#ffc070', emisMap: lt.emis }), mat('#3b2618')] as any, { p: [wx, base + 1.95, 2.92], r: [90, 0, 0] }));
  b.add(mesh(new THREE.TorusGeometry(0.57, 0.07, 8, 28), wm, { p: [wx, base + 1.95, 2.94] }));
  b.light([wx, base + 1.95, 3.4], WARM, 3.2);
  // 小院细节：晾衣杆、陶缸、长凳
  const yard = 0.14;
  b.add(rod([-3.9, yard, 2.0], [-3.9, yard + 1.9, 2.0], 0.035, wm));
  b.add(rod([-0.3, yard, 2.0], [-0.3, yard + 1.9, 2.0], 0.035, wm));
  b.add(rod([-4.0, yard + 1.85, 2.0], [-0.2, yard + 1.85, 2.0], 0.022, M.woodFine('#a58a5c')));
  const cols = ['#9c3b30', '#d9d3c2', '#3f5a80', '#d9d3c2'];
  cols.forEach((c, i) => b.add(mesh(bx(0.62, 0.95 - (i % 2) * 0.2, 0.03, 1), M.cloth(c), { p: [-3.4 + i * 0.88, yard + 1.36 + (i % 2) * 0.1, 2.0] })));
  b.add(place(jar(0.34, 0.7), [0.75, base, 1.35]));
  b.add(place(basket(0.3, 0.3, '#7d9a4c'), [-4.0, base, 1.3]));
  hangLantern(b, -1.45, base + 2.5, 1.32, 0.14, 0.24);
  b.solid(-4.9, -3.3, 1.3, 1.25);
  b.solid(1.0, -3.2, 4.7, 3.2);
  b.door(-2.95, 2.3);
  return b;
}

// ================================================================ 客栈：两层，腰檐 + 歇山顶
export function inn(): Build {
  const b = new Build('inn', 'building');
  const base = 0.4, W = 9.0, D = 5.6, h1 = 3.2, zf = D / 2;
  b.add(plinth(10.0, 6.6, base));
  b.add(place(steps(2.6, 3, base), [0, 0, 3.3]));
  shell(b, -W / 2, W / 2, -zf, zf, base, h1 + 0.6, 0, M.plaster('#e4dccb'));
  facade(b, {
    x0: -W / 2, x1: W / 2, base, wh: h1, z: zf, bays: ['panel', 'panel', 'open', 'panel', 'panel'], widths: [1.75, 1.75, 2.0, 1.75, 1.75],
    wood: WOOD_RED, wainscot: 0, doorW: 1.6, doorH: 2.4, round: true, wall: M.plaster('#e4dccb'),
  });
  // 腰檐
  const skirtY = base + h1 - 0.15;
  b.add(placeRoof({ W: W + 2.0, D: D + 2.0, rise: 2.6, inset: (D + 2.0) / 2, cut: 0.4, lift: 0.3 }, skirtY));
  // 二层
  const W2 = 8.0, D2 = 4.6, y2 = skirtY + 0.62, h2 = 2.85, z2 = D2 / 2;
  shell(b, -W2 / 2, W2 / 2, -z2, z2, y2, h2, 0, M.plaster('#e4dccb'));
  facade(b, {
    x0: -W2 / 2, x1: W2 / 2, base: y2, wh: h2, z: z2, bays: ['win', 'win', 'wall', 'win', 'win'], widths: [1.5, 1.5, 2.0, 1.5, 1.5],
    wood: WOOD_RED, wainscot: 0, winW: 1.0, winH: 0.95, winY: 0.98, wall: M.plaster('#e4dccb'),
  });
  b.add(place(plaque('客栈', 1.8, 0.86, { bg: '#1f1612', fg: '#e3bf62' }), [0, y2 + 1.0, z2 + 0.14], [-8, 0, 0]));
  // 二层栏杆
  const rm = M.woodFine(WOOD_RED);
  for (const y of [0.42, 0.74]) b.add(mesh(bx(W2 + 0.5, 0.07, 0.07, 1, 'x'), rm, { p: [0, y2 + y - 0.3, z2 + 0.5] }));
  for (let i = 0; i <= 16; i++) b.add(mesh(bx(0.06, 0.52, 0.06), rm, { p: [-W2 / 2 - 0.25 + ((W2 + 0.5) * i) / 16, y2 + 0.2, z2 + 0.5] }));
  // 歇山顶
  const rt: RoofOpts = { W: 9.6, D: 6.0, rise: 2.2, inset: 2.5, tc: 0.5, lift: 0.45, ridgeH: 0.3, ridgeR: 0.09, beasts: 3 };
  b.add(placeRoof(rt, eaveFor(rt, z2, y2 + h2)));
  // 檐下灯笼
  for (const x of [-3.75, -1.45, 1.45, 3.75]) hangLantern(b, x, skirtY - 0.12, zf + 0.92, 0.22, 0.36);
  // 酒幌
  const px = 5.75, pz = 4.3;
  b.add(rod([px, 0, pz], [px, 4.6, pz], 0.06, M.woodFine('#5a4030')));
  b.add(rod([px - 0.95, 4.35, pz], [px + 0.1, 4.35, pz], 0.035, M.woodFine('#5a4030')));
  b.add(mesh(new THREE.BoxGeometry(0.7, 1.7, 0.02), texMat(T.banner('酒', '#8c2a20', '#f0e2b8', 128, 310), { double: true }), { p: [px - 0.5, 3.45, pz + 0.01] }));
  b.add(mesh(cyl(0.2, 0.2, 0.06, 12), M.stone('#8d897f'), { p: [px, 0.03, pz] }));
  // 酒坛
  b.add(place(jar(0.3, 0.55, '#5b3b2a', '#b3322a'), [3.9, base, zf + 0.42]));
  b.add(place(jar(0.3, 0.55, '#5b3b2a', '#b3322a'), [3.3, base, zf + 0.44]));
  b.add(place(jar(0.26, 0.48, '#6b4532', '#b3322a'), [3.6, base + 0.5, zf + 0.42]));
  b.add(place(basket(0.3, 0.3, '#c9a24a'), [-3.9, base, zf + 0.42]));
  b.solid(-5.0, -3.3, 5.0, 3.3);
  b.solid(5.5, 4.05, 6.0, 4.55);
  b.door(0, 4.8);
  return b;
}

// ================================================================ 铁匠铺：后棚 + 前院炉台
export function smithy(): Build {
  const b = new Build('smithy', 'building');
  const wm = M.woodFine('#4f3a2a');
  b.add(place(plinth(7.2, 6.2, 0.14, '#8f8b82'), [0, 0, 0]));
  // 后棚
  const eave = 2.75;
  b.add(mesh(bx(6.4, 2.6, 0.26, 1.2), M.brick('#6f7377'), { p: [0, 1.44, -2.75] }));
  for (const s of [-1, 1]) b.add(mesh(bx(0.24, 2.6, 2.5, 1.2), M.brick('#6f7377'), { p: [s * 3.08, 1.44, -1.6] }));
  for (const x of [-3.05, -1.0, 1.0, 3.05]) b.add(mesh(bx(0.2, 2.7, 0.2), wm, { p: [x, 1.49, -0.3] }));
  b.add(mesh(bx(6.5, 0.2, 0.22, 1, 'x'), wm, { p: [0, 2.72, -0.3] }));
  const ro: RoofOpts = { W: 7.2, D: 3.6, rise: 1.15, pitch: 0.34, amp: 0.02, material: M.thatch('#968b70'), ridgeMat: M.thatch('#766b52'), ridgeH: 0.16, lift: 0.12, tip: 0.1 };
  b.add(placeRoof(ro, eaveFor(ro, 1.25, eave + 0.09), 0, -1.55));
  // 棚下：工作台与工具
  b.add(mesh(bx(2.2, 0.1, 0.7, 1, 'x'), M.wood('#7a5a3c'), { p: [1.85, 0.95, -0.75] }));
  for (const [x, z] of [[0.9, -0.5], [2.8, -0.5], [0.9, -1.0], [2.8, -1.0]]) b.add(mesh(bx(0.1, 0.8, 0.1), wm, { p: [x, 0.54, z] }));
  // 炉台
  const fx = -1.7, fz = 0.95;
  b.add(mesh(bx(1.6, 1.0, 1.15, 1.1), M.brick('#7b6a5c'), { p: [fx, 0.64, fz] }));
  b.add(mesh(bx(1.72, 0.12, 1.27, 1.6), M.stone('#6e6a64'), { p: [fx, 1.18, fz] }));
  b.add(mesh(cyl(0.44, 0.44, 0.08, 16), mat('#2a1c14', { kind: 'flat' }), { p: [fx, 1.25, fz] }));
  b.add(mesh(cyl(0.36, 0.36, 0.06, 16), mat('#e2581a', { kind: 'flat', emissive: '#ff8a2a' }), { p: [fx, 1.29, fz] }));
  const r = rng(77);
  for (let i = 0; i < 12; i++) {
    const a = r() * 6.28, d = 0.08 + r() * 0.26;
    const hot = i % 3 === 0;
    b.add(mesh(ellipsoid(0.06 + r() * 0.03, 0.045, 0.06 + r() * 0.03, 6, 4), hot ? mat('#ffb04a', { kind: 'flat', emissive: '#ffd070' }) : mat('#1a1614', { kind: 'flat' }), { p: [fx + Math.cos(a) * d, 1.33, fz + Math.sin(a) * d] }));
  }
  // 烟囱
  b.add(mesh(bx(0.6, 3.5, 0.55, 1.1), M.brick('#746458'), { p: [fx, 1.89, fz - 0.9] }));
  b.add(mesh(bx(0.72, 0.14, 0.66, 1.1), M.stone('#5e5a55'), { p: [fx, 3.7, fz - 0.9] }));
  // 风箱
  b.add(mesh(bx(0.5, 0.55, 1.05, 1, 'z'), M.wood('#6b4c33'), { p: [fx - 1.2, 0.42, fz] }));
  b.add(rod([fx - 1.2, 0.42, fz + 0.52], [fx - 1.2, 0.42, fz + 0.95], 0.03, wm));
  b.add(mesh(bx(0.24, 0.05, 0.05), wm, { p: [fx - 1.2, 0.42, fz + 0.95] }));
  // 煤堆
  for (let i = 0; i < 16; i++) b.add(mesh(ellipsoid(0.09 + r() * 0.05, 0.07, 0.09 + r() * 0.05, 6, 4), mat('#1d1a19', { kind: 'flat' }), { p: [fx + 0.2 + (r() - 0.5) * 0.9, 0.2 + r() * 0.12, fz + 0.9 + r() * 0.4] }));
  // 铁砧
  const ax = 0.5, az = 1.35;
  b.add(mesh(cy(0.3, 0.33, 0.5, 12, 0.8, 2), M.woodFine('#6a4c34'), { p: [ax, 0.39, az] }));
  const iron = M.metal('#3a3d42');
  b.add(mesh(bx(0.5, 0.14, 0.24, 1), iron, { p: [ax, 0.9, az] }));
  b.add(mesh(bx(0.3, 0.16, 0.18, 1), iron, { p: [ax, 0.75, az] }));
  b.add(mesh(cyl(0.02, 0.1, 0.3, 8), iron, { p: [ax - 0.38, 0.9, az], r: [0, 0, 90] }));
  b.add(rod([ax + 0.05, 1.0, az - 0.05], [ax + 0.4, 1.04, az + 0.12], 0.02, wm));
  b.add(mesh(bx(0.1, 0.09, 0.16, 1), iron, { p: [ax + 0.05, 1.01, az - 0.05], r: [0, 25, 0] }));
  // 淬火桶
  b.add(mesh(cy(0.36, 0.32, 0.6, 14, 0.8, 3), M.wood('#6f5136'), { p: [1.55, 0.44, 0.75] }));
  b.add(mesh(cyl(0.31, 0.31, 0.02, 14), mat('#1f3340', { kind: 'flat' }), { p: [1.55, 0.7, 0.75] }));
  for (const y of [0.26, 0.6]) b.add(mesh(new THREE.TorusGeometry(0.35, 0.02, 5, 16), iron, { p: [1.55, y, 0.75], r: [90, 0, 0] }));
  // 兵器架（成品）
  const rx = 2.55, rz = 1.2;
  for (const s of [-1, 1]) b.add(mesh(bx(0.08, 1.3, 0.08), wm, { p: [rx + s * 0.6, 0.79, rz] }));
  for (const y of [0.55, 1.25]) b.add(mesh(bx(1.3, 0.07, 0.07, 1, 'x'), wm, { p: [rx, y, rz] }));
  const steel = M.metal('#c9d0d6');
  for (let i = 0; i < 4; i++) {
    const x = rx - 0.42 + i * 0.28;
    b.add(mesh(bx(0.05, 0.95, 0.012), steel, { p: [x, 0.85, rz + 0.07], r: [8, 0, 0] }));
    b.add(mesh(bx(0.14, 0.03, 0.03), M.flat('#b8923e'), { p: [x, 1.33, rz + 0.02] }));
    b.add(mesh(cyl(0.018, 0.018, 0.2, 6), M.woodFine('#3b2a20'), { p: [x, 1.44, rz + 0.005] }));
  }
  // 砂轮与铁料箱
  const gx = -0.75, gz = 2.25;
  for (const s of [-1, 1]) {
    b.add(rod([gx + s * 0.22, 0.14, gz - 0.25], [gx + s * 0.22, 0.75, gz], 0.035, wm));
    b.add(rod([gx + s * 0.22, 0.14, gz + 0.25], [gx + s * 0.22, 0.75, gz], 0.035, wm));
  }
  b.add(mesh(cyl(0.34, 0.34, 0.12, 20), M.stone('#8a877f'), { p: [gx, 0.75, gz], r: [0, 0, 90] }));
  b.add(rod([gx - 0.3, 0.75, gz], [gx + 0.42, 0.75, gz], 0.02, iron));
  b.add(mesh(bx(0.7, 0.34, 0.5, 1), M.wood('#6f5136'), { p: [2.4, 0.31, 2.35] }));
  for (let i = 0; i < 5; i++) b.add(mesh(bx(0.5, 0.06, 0.08, 1), iron, { p: [2.4, 0.5, 2.18 + i * 0.085], r: [0, (i % 2) * 6 - 3, 0] }));
  b.light([fx, 1.6, fz + 0.2], FIRE, 5.2, { flicker: 0.3, night: false });
  b.info.fires = [[fx, 1.34, fz, 0.6]];
  b.info.smoke = [[fx, 3.8, +(fz - 0.9).toFixed(2)]];
  b.solid(-3.3, -2.95, 3.3, -0.15);
  b.solid(-3.2, 0.3, -0.85, 1.9);
  b.solid(0.1, 1.0, 0.9, 1.7);
  b.solid(1.15, 0.35, 3.2, 1.45);
  b.door(0.5, 2.6);
  return b;
}

// ================================================================ 药铺
export function clinic(): Build {
  const b = new Build('clinic', 'building');
  const W = 6.4, D = 4.6, base = 0.3, wh = 3.3, zf = D / 2;
  b.add(plinth(7.2, 5.6, base));
  b.add(place(steps(1.8, 2, base), [0.2, 0, 2.8]));
  shell(b, -W / 2, W / 2, -zf, zf, base, wh, 0);
  const cs = facade(b, { x0: -W / 2, x1: W / 2, base, wh, z: zf, bays: ['none', 'open', 'win'], widths: [2.4, 1.9, 2.1], winKind: 'diamond', doorW: 1.4 });
  // 柜台窗口
  const cx = cs[0];
  b.add(mesh(new THREE.BoxGeometry(1.7, 1.15, 0.05), interiorMat(), { p: [cx, base + 1.55, zf + 0.0] }));
  b.add(mesh(bx(2.0, 0.1, 0.5, 1, 'x'), M.wood('#6b4a32'), { p: [cx, base + 0.95, zf + 0.2] }));
  b.add(mesh(bx(1.9, 0.12, 0.14, 1, 'x'), M.woodFine(WOOD_DARK), { p: [cx, base + 2.18, zf + 0.04] }));
  // 柜台上的药罐
  for (let i = 0; i < 4; i++) b.add(place(jar(0.09, 0.2, i % 2 ? '#3f5f6b' : '#e3dccb', '#b3322a'), [cx - 0.6 + i * 0.4, base + 1.0, zf + 0.26]));
  b.light([cx, base + 1.5, zf + 0.6], WARM, 3.6);
  // 门帘
  for (let i = 0; i < 3; i++) b.add(mesh(bx(0.44, 0.9, 0.02, 1), M.cloth('#2f4f7a'), { p: [cs[1] - 0.46 + i * 0.46, base + 1.85, zf + 0.1] }));
  // 庑殿顶
  const ro: RoofOpts = { W: 7.8, D: 5.8, rise: 1.85, inset: 2.9, lift: 0.36 };
  b.add(placeRoof(ro, eaveFor(ro, zf, base + wh)));
  // 药幌：竖杆 + 圆牌
  const px = 3.75, pz = 3.0;
  b.add(rod([px, 0, pz], [px, 3.5, pz], 0.05, M.woodFine('#5a4030')));
  b.add(rod([px - 0.8, 3.3, pz], [px + 0.08, 3.3, pz], 0.03, M.woodFine('#5a4030')));
  const signTex = T.sign('药', { bg: '#efe6cf', fg: '#1d1512', border: '#7c2219', w: 200, h: 200 });
  b.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.05), texMat(signTex), { p: [px - 0.45, 2.75, pz + 0.01] }));
  b.add(mesh(cyl(0.02, 0.02, 0.3, 5), M.flat('#b3322a'), { p: [px - 0.45, 2.2, pz + 0.01] }));
  // 晒药架
  const rx = -2.6, rz = zf + 0.55, wm = M.woodFine('#8a6a48');
  for (const [x, z] of [[-0.75, -0.2], [0.75, -0.2], [-0.75, 0.2], [0.75, 0.2]]) b.add(mesh(bx(0.06, 1.0, 0.06), wm, { p: [rx + x, base + 0.5, rz + z] }));
  b.add(mesh(bx(1.6, 0.04, 0.5, 1, 'x'), wm, { p: [rx, base + 0.98, rz] }));
  const herbs = ['#6f8f46', '#a8552e', '#c9b06a'];
  herbs.forEach((c, i) => {
    const tx = rx - 0.5 + i * 0.5;
    b.add(mesh(cyl(0.25, 0.22, 0.05, 16), M.thatch('#b8975a'), { p: [tx, base + 1.03, rz] }));
    b.add(mesh(cyl(0.21, 0.21, 0.03, 16), mat(c), { p: [tx, base + 1.06, rz] }));
  });
  hangLantern(b, 1.15, base + 2.5, zf + 0.45, 0.15, 0.26, true, '#e9e2cf');
  b.solid(-3.6, -2.8, 3.6, 2.8);
  b.solid(3.5, 2.75, 4.0, 3.25);
  b.door(0.2, 3.9);
  return b;
}

// ================================================================ 武馆
export function dojo(): Build {
  const b = new Build('dojo', 'building');
  const base = 0.8, W = 11.0, wh = 4.4;
  b.add(place(plinth(12.6, 8.4, base), [0, 0, 0]));
  b.add(place(steps(3.6, 4, base, 0.34), [0, 0, 4.2]));
  // 石鼓
  for (const s of [-1, 1]) {
    b.add(mesh(bx(0.6, 0.5, 1.5, 1.4), M.stone('#a09c92'), { p: [s * 2.15, 0.25, 4.95] }));
    b.add(mesh(cyl(0.34, 0.34, 0.3, 16), M.stone('#b0aca2'), { p: [s * 2.15, 0.82, 5.2], r: [0, 0, 90] }));
  }
  shell(b, -W / 2, W / 2, -3.3, 2.4, base, wh - 0.3, 0, M.plaster('#d9cdb6'));
  facade(b, {
    x0: -W / 2, x1: W / 2, base, wh, z: 2.4, bays: ['panel', 'panel', 'panel', 'panel', 'panel'],
    wood: WOOD_RED, wainscot: 0, wall: M.plaster('#d9cdb6'),
  });
  // 前廊柱
  for (let i = 0; i < 6; i++) b.add(place(column(wh - 0.3, 0.19, WOOD_RED), [-5.3 + i * 2.12, base, 3.35]));
  b.add(mesh(bx(11.0, 0.3, 0.24, 1, 'x'), M.woodFine(WOOD_RED), { p: [0, base + wh - 0.42, 3.35] }));
  // 斗拱彩带
  const cols = ['#2f5f8a', '#3f7a52', '#c9a44a'];
  for (let i = 0; i < 30; i++) b.add(mesh(bx(0.2, 0.16, 0.26, 1), mat(cols[i % 3]), { p: [-5.3 + i * 0.366, base + wh - 0.66, 3.4] }));
  b.add(place(plaque('武馆', 2.3, 1.0, { bg: '#16233a', fg: '#e8c666' }), [0, base + 2.75, 3.52], [-12, 0, 0]));
  // 歇山大顶
  const ro: RoofOpts = { W: 13.0, D: 8.4, rise: 2.9, inset: 3.3, tc: 0.46, lift: 0.6, pitch: 0.3, amp: 0.055, ridgeH: 0.36, ridgeR: 0.1, ridgeUp: 0.2, tip: 0.5, beasts: 4 };
  const eave = eaveFor(ro, 3.35, base + wh - 0.22);
  b.add(placeRoof(ro, eave, 0, 0));
  // 脊中宝珠
  const ry = eave + 2.9 + 0.36;
  b.add(mesh(lathe([[0.18, 0], [0.2, 0.08], [0.1, 0.16], [0.16, 0.3], [0.12, 0.42], [0.02, 0.5]], 12), M.flat('#c9a44a'), { p: [0, ry, 0] }));
  // 旗幡
  for (const s of [-1, 1]) {
    const px = s * 5.4, pz = 4.9;
    b.add(rod([px, 0, pz], [px, 5.6, pz], 0.07, M.woodFine('#5a4030')));
    b.add(mesh(cyl(0.24, 0.24, 0.08, 12), M.stone('#8d897f'), { p: [px, 0.04, pz] }));
    b.add(rod([px - 0.1, 5.3, pz], [px + 0.9 * -s + 0.0, 5.3, pz], 0.03, M.woodFine('#5a4030')));
    b.add(mesh(new THREE.BoxGeometry(0.78, 2.6, 0.02), texMat(T.banner('武', '#8c1f1a', '#f0d890', 128, 420), { double: true }), { p: [px - s * 0.45, 3.95, pz + 0.01] }));
  }
  // 大鼓
  const dx = 2.12, dz = 2.95;
  for (const s of [-1, 1]) {
    b.add(rod([dx + s * 0.5, base, dz - 0.3], [dx + s * 0.5, base + 1.25, dz], 0.04, M.woodFine(WOOD_DARK)));
    b.add(rod([dx + s * 0.5, base, dz + 0.3], [dx + s * 0.5, base + 1.25, dz], 0.04, M.woodFine(WOOD_DARK)));
  }
  b.add(mesh(lathe([[0.46, -0.3], [0.56, -0.1], [0.56, 0.1], [0.46, 0.3]], 18), mat('#9a2a20'), { p: [dx, base + 1.25, dz], r: [0, 0, 90] }));
  for (const s of [-1, 1]) b.add(mesh(cyl(0.46, 0.46, 0.02, 18), mat('#e3d5b0'), { p: [dx + s * 0.3, base + 1.25, dz], r: [0, 0, 90] }));
  for (const x of [-3.2, 3.2]) hangLantern(b, x, base + wh - 0.75, 3.8, 0.26, 0.42);
  b.solid(-6.3, -4.2, 6.3, 4.2);
  b.solid(-2.5, 4.2, 2.5, 5.75);
  b.solid(-5.7, 4.6, -5.1, 5.2);
  b.solid(5.1, 4.6, 5.7, 5.2);
  b.door(0, 6.5);
  return b;
}

// ================================================================ 牌坊
export function gate(): Build {
  const b = new Build('gate', 'building');
  const red = M.woodFine(WOOD_RED);
  const xs: [number, number][] = [[-1.95, 5.3], [1.95, 5.3], [-3.95, 4.3], [3.95, 4.3]];
  for (const [x, h] of xs) {
    b.add(mesh(bx(0.42, h, 0.42), red, { p: [x, h / 2 + 0.5, 0] }));
    b.add(mesh(bx(0.8, 0.5, 1.0, 1.4), M.stone('#a09c92'), { p: [x, 0.25, 0] }));
    for (const s of [-1, 1]) b.add(mesh(cyl(0.36, 0.36, 0.26, 16), M.stone('#aeaaa0'), { p: [x, 0.62, s * 0.5], r: [0, 0, 90] }));
    b.solid(x - 0.42, -0.9, x + 0.42, 0.9);
  }
  const beam = (x0: number, x1: number, y: number, h: number, c = WOOD_RED) => b.add(mesh(bx(x1 - x0, h, 0.34, 1, 'x'), M.woodFine(c), { p: [(x0 + x1) / 2, y, 0] }));
  beam(-2.2, 2.2, 3.95, 0.34); beam(-2.2, 2.2, 5.3, 0.3);
  beam(-4.2, -1.75, 3.3, 0.3); beam(1.75, 4.2, 3.3, 0.3);
  beam(-4.2, -1.75, 4.15, 0.26); beam(1.75, 4.2, 4.15, 0.26);
  // 彩画枋心
  b.add(mesh(bx(3.3, 0.2, 0.36, 1, 'x'), mat('#2f5f8a'), { p: [0, 3.95, 0] }));
  for (const s of [-1, 1]) b.add(mesh(bx(1.5, 0.18, 0.36, 1, 'x'), mat('#3f7a52'), { p: [s * 2.95, 3.3, 0] }));
  for (const s of [-1, 1]) b.add(mesh(bx(1.6, 0.5, 0.1), M.plaster('#d9cdb6'), { p: [s * 2.95, 3.75, 0] }));
  b.add(place(plaque('落霞村', 2.5, 0.84, { bg: '#16233a', fg: '#e8c666' }), [0, 4.6, 0.14]));
  // 斗拱
  const cols = ['#2f5f8a', '#3f7a52', '#c9a44a'];
  for (let i = 0; i < 12; i++) b.add(mesh(bx(0.22, 0.2, 0.5, 1), mat(cols[i % 3]), { p: [-1.98 + i * 0.36, 5.55, 0] }));
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) b.add(mesh(bx(0.2, 0.18, 0.44, 1), mat(cols[i % 3]), { p: [s * 2.95 - 0.9 + i * 0.36, 4.37, 0] }));
  b.add(placeRoof({ W: 5.4, D: 1.5, rise: 0.75, inset: 0.75, lift: 0.34, pitch: 0.2, amp: 0.035, ridgeH: 0.2, tip: 0.3, ridgeR: 0.06 }, 5.7));
  for (const s of [-1, 1]) b.add(placeRoof({ W: 3.1, D: 1.3, rise: 0.56, inset: 0.65, lift: 0.28, pitch: 0.2, amp: 0.035, ridgeH: 0.16, tip: 0.26, ridgeR: 0.055 }, 4.5, s * 2.95));
  for (const s of [-1, 1]) hangLantern(b, s * 1.25, 3.8, 0.1, 0.22, 0.36);
  return b;
}

// ================================================================ 山野小庙
export function shrine(): Build {
  const b = new Build('shrine', 'building');
  const mossy = M.rubble('#858b78'), st = M.stone('#8f9384');
  b.add(mesh(bx(3.8, 0.36, 3.3, 1.6), mossy, { p: [0, 0.18, -0.1] }));
  b.add(mesh(bx(1.5, 0.18, 0.5, 1.6), mossy, { p: [0, 0.09, 1.75] }));
  // 祠屋
  b.add(mesh(bx(2.3, 1.85, 0.25, 1.6), st, { p: [0, 1.28, -1.1] }));
  for (const s of [-1, 1]) b.add(mesh(bx(0.3, 1.85, 1.7, 1.6), st, { p: [s * 1.0, 1.28, -0.35] }));
  b.add(mesh(bx(2.3, 0.26, 0.3, 1.6, 'x'), st, { p: [0, 2.08, 0.42] }));
  b.add(mesh(new THREE.BoxGeometry(1.7, 1.6, 0.05), mat('#17120f', { kind: 'flat' }), { p: [0, 1.16, -0.6] }));
  // 神像剪影
  b.add(mesh(lathe([[0.3, 0], [0.26, 0.3], [0.2, 0.62], [0.13, 0.72], [0.15, 0.86], [0.02, 0.98]], 10), M.stone('#6f7366'), { p: [0, 0.36, -0.3] }));
  b.add(mesh(bx(1.1, 0.16, 0.5, 1.6), st, { p: [0, 0.44, 0.15] }));
  b.add(place(roof({ W: 3.3, D: 2.9, rise: 0.95, inset: 1.2, lift: 0.26, pitch: 0.3, amp: 0.03, material: M.tile('#c7d0b4'), ridgeMat: M.stone('#6c7163'), ridgeH: 0.18, tip: 0.24 }), [0.03, 2.16, -0.3], [0, 0, 1.6]));
  // 香炉
  const bronze = M.metal('#5a5a3c');
  b.add(mesh(lathe([[0.16, 0], [0.3, 0.14], [0.34, 0.3], [0.3, 0.34], [0.26, 0.3], [0.02, 0.24]], 14), bronze, { p: [0, 0.5, 1.15] }));
  for (let i = 0; i < 3; i++) b.add(mesh(cyl(0.035, 0.03, 0.2, 6), bronze, { p: [Math.sin(i * 2.09) * 0.2, 0.45, 1.15 + Math.cos(i * 2.09) * 0.2] }));
  b.add(mesh(cyl(0.24, 0.24, 0.02, 12), mat('#6b665c', { kind: 'flat' }), { p: [0, 0.82, 1.15] }));
  for (const [dx, dz] of [[-0.06, 0], [0.05, 0.04], [0, -0.06]]) {
    b.add(mesh(cyl(0.008, 0.008, 0.3, 4), M.flat('#7a3524'), { p: [dx, 0.97, 1.15 + dz] }));
    b.add(mesh(ellipsoid(0.016, 0.016, 0.016, 5, 4), mat('#ff7a2a', { kind: 'flat', emissive: '#ff9a40' }), { p: [dx, 1.13, 1.15 + dz] }));
  }
  b.light([0, 1.1, 1.2], [1.4, 0.6, 0.25], 2.2, { flicker: 0.2 });
  // 残柱与碎石
  b.add(mesh(cy(0.2, 0.23, 1.1, 10, 1, 2), st, { p: [1.55, 0.9, 1.0] }));
  b.add(mesh(cy(0.2, 0.2, 1.3, 10, 1, 2), st, { p: [-2.3, 0.2, 1.1], r: [90, 0, 62] }));
  b.add(mesh(cy(0.2, 0.2, 0.5, 10, 1, 2), st, { p: [-1.55, 0.46, 1.05], r: [0, 0, 8] }));
  const r = rng(5);
  for (let i = 0; i < 7; i++) b.add(mesh(bx(0.2 + r() * 0.25, 0.14 + r() * 0.12, 0.2 + r() * 0.2, 1), st, { p: [-2.4 + r() * 4.8, 0.08, 1.5 + r() * 0.7], r: [0, r() * 90, 0] }));
  // 祈愿红布条
  for (let i = 0; i < 6; i++) b.add(mesh(bx(0.07, 0.45 + r() * 0.3, 0.012, 1), M.cloth('#b3261e'), { p: [-1.2 + i * 0.48, 1.72 - r() * 0.1, 0.6] }));
  b.solid(-1.9, -1.75, 1.9, 1.45);
  b.door(0, 2.4);
  return b;
}

// ================================================================ 山贼望楼
export function watchtower(): Build {
  const b = new Build('watchtower', 'building');
  const log = M.woodFine('#6b5038'), dark = M.woodFine('#4a3828');
  const H = 4.5;
  const foot = 1.35, top = 1.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(rod([sx * foot, 0, sz * foot], [sx * top, H + 2.0, sz * top], 0.13, log, 8));
  // 斜撑
  const lv = (y: number) => foot + ((top - foot) * y) / (H + 2.0);
  for (const [y0, y1] of [[0.4, 2.2], [2.3, 4.2]]) {
    for (const sz of [-1, 1]) {
      b.add(rod([-lv(y0), y0, sz * lv(y0)], [lv(y1), y1, sz * lv(y1)], 0.06, dark));
      b.add(rod([lv(y0), y0, sz * lv(y0)], [-lv(y1), y1, sz * lv(y1)], 0.06, dark));
    }
    for (const sx of [-1, 1]) {
      b.add(rod([sx * lv(y0), y0, -lv(y0)], [sx * lv(y1), y1, lv(y1)], 0.06, dark));
      b.add(rod([sx * lv(y0), y0, lv(y0)], [sx * lv(y1), y1, -lv(y1)], 0.06, dark));
    }
    for (const sz of [-1, 1]) b.add(rod([-lv(y1), y1, sz * lv(y1)], [lv(y1), y1, sz * lv(y1)], 0.07, log));
    for (const sx of [-1, 1]) b.add(rod([sx * lv(y1), y1, -lv(y1)], [sx * lv(y1), y1, lv(y1)], 0.07, log));
  }
  // 平台
  b.add(mesh(bx(2.9, 0.12, 2.9, 1.1, 'z'), M.wood('#8a6c4a'), { p: [0, H, 0] }));
  for (const sz of [-1, 1]) for (const y of [H + 0.5, H + 0.95]) b.add(rod([-1.4, y, sz * 1.4], [1.4, y, sz * 1.4], 0.045, dark));
  for (const sx of [-1, 1]) for (const y of [H + 0.5, H + 0.95]) b.add(rod([sx * 1.4, y, -1.4], [sx * 1.4, y, 1.4], 0.045, dark));
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) b.add(rod([sx * 1.4, H, sz * 1.4], [sx * 1.4, H + 1.0, sz * 1.4], 0.045, dark));
  // 草顶
  b.add(placeRoof({ W: 3.7, D: 3.7, rise: 1.25, inset: 1.84, pitch: 0.3, amp: 0.02, material: M.thatch('#93896e'), ridgeMat: M.thatch('#73694f'), ridgeH: 0, lift: 0.1, tip: 0.12, ridgeR: 0.06 }, H + 1.95));
  b.add(mesh(cyl(0.02, 0.14, 0.4, 8), M.thatch('#73694f'), { p: [0, H + 3.3, 0] }));
  // 梯子
  for (const s of [-1, 1]) b.add(rod([-0.55 + s * 0.24, 0, 1.95], [-0.55 + s * 0.24, H + 0.1, 1.5], 0.04, log));
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    b.add(rod([-0.83, t * H, 1.95 - 0.45 * t], [-0.27, t * H, 1.95 - 0.45 * t], 0.028, dark));
  }
  // 火盆
  b.add(mesh(lathe([[0.1, 0], [0.22, 0.14], [0.24, 0.2], [0.2, 0.2], [0.02, 0.12]], 10), M.metal('#3a3530'), { p: [0.95, H + 0.06, 0.95] }));
  b.add(mesh(ellipsoid(0.16, 0.06, 0.16, 8, 5), mat('#e2581a', { kind: 'flat', emissive: '#ff9a3a' }), { p: [0.95, H + 0.24, 0.95] }));
  b.light([0.95, H + 0.6, 0.95], FIRE, 5.5, { flicker: 0.3 });
  b.info.fires = [[0.95, H + 0.28, 0.95, 0.5]];
  // 小旗
  b.add(rod([-1.05, H + 2.0, -1.05], [-1.05, H + 4.0, -1.05], 0.03, dark));
  b.add(mesh(bx(0.8, 0.5, 0.02, 1), M.cloth('#7a1f1a'), { p: [-0.63, H + 3.7, -1.05] }));
  b.solid(-1.5, -1.5, 1.5, 1.6);
  return b;
}

// ================================================================ 营帐
export function canvasSheet(pts: (u: number, v: number) => V3, nu: number, nv: number, material: THREE.Material): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const p = pts(i / nu, j / nv);
    pos.push(...p); uv.push((i / nu) * 2, (j / nv) * 2);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, c = (i + 1) * (nv + 1) + j;
    idx.push(a, c, c + 1, a, c + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

export function tentA(): Build {
  const b = new Build('tent_a', 'building');
  const cv = M.cloth('#9c8a68'), cvD = M.cloth('#85745a'), pole = M.woodFine('#5a4433');
  const H = 2.3, hw = 1.9, L = 1.9;
  for (const s of [-1, 1]) {
    b.add(canvasSheet((u, v) => {
      const sag = Math.sin(v * Math.PI) * 0.1 * Math.sin(u * Math.PI * 0.9 + 0.3);
      const x = s * hw * u, y = H * (1 - u) ** 1.12 - sag + 0.02 + 0.05 * Math.sin(v * 9) * u * (1 - u);
      return [x, Math.max(0.02, y), -L + 2 * L * v];
    }, 10, 12, s < 0 ? cv : cvD));
  }
  // 前后山面：两片门帘
  for (const z of [L, -L]) {
    const dk = new THREE.BufferGeometry();
    dk.setAttribute('position', new THREE.Float32BufferAttribute([-0.95, 0.02, 0, 0.95, 0.02, 0, 0, 1.25, 0], 3));
    dk.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    dk.computeVertexNormals();
    b.add(place(new THREE.Mesh(dk, mat('#15110e', { kind: 'flat', double: true })), [0, 0, z - Math.sign(z) * 0.07]));
    for (const s of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([s * hw, 0.02, z, s * 0.34, 0.02, z + Math.sign(z) * 0.05, 0, H - 0.02, z], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1.4], 2));
      tri.computeVertexNormals();
      b.add(new THREE.Mesh(tri, cvD));
    }
  }
  b.add(rod([0, 0, L + 0.02], [0, H + 0.3, L + 0.02], 0.05, pole));
  b.add(rod([0, 0, -L - 0.02], [0, H + 0.3, -L - 0.02], 0.05, pole));
  b.add(rod([0, H + 0.02, -L - 0.2], [0, H + 0.02, L + 0.2], 0.04, pole));
  // 底边暗红滚边与补丁
  // 缝线
  for (const s of [-1, 1]) for (const zz of [-0.65, 0.65]) b.add(rod([0, H + 0.02, zz], [s * hw, 0.05, zz], 0.014, M.flat('#5c4d38'), 4));
  b.add(mesh(bx(0.5, 0.02, 0.6, 1), M.cloth('#6f6048'), { p: [-0.9, 1.24, 0.4], r: [0, 0, 50] }));
  // 风绳与地钉
  const rope = M.flat('#6b5a44');
  for (const s of [-1, 1]) for (const z of [-L, 0, L]) {
    b.add(rod([s * hw * 0.5, H * 0.52, z], [s * 2.55, 0.05, z], 0.012, rope, 4));
    b.add(rod([s * 2.5, 0, z], [s * 2.62, 0.22, z], 0.03, pole));
  }
  // 门口杂物
  b.add(mesh(bx(0.55, 0.4, 0.45, 1), M.wood('#7a5c3e'), { p: [1.35, 0.2, L + 0.5] }));
  b.add(mesh(cy(0.13, 0.13, 0.9, 10, 1, 1), M.cloth('#7d6a4c', false), { p: [-1.2, 0.13, L + 0.45], r: [0, 0, 90] }));
  b.solid(-1.9, -1.95, 1.9, 1.8);
  b.door(0, 2.7);
  return b;
}

export function tentB(): Build {
  const b = new Build('tent_b', 'building');
  const R = 2.4, wallH = 1.5, H = 3.5;
  const wallTex = T.stripes('#9a8562', '#7f6c4e', 16);
  const wall = uvCyl(R, wallH, 32);
  b.add(mesh(wall, texMat(wallTex, { double: true }), { p: [0, wallH / 2, 0] }));
  // 顶：略微下垂的锥面
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push([(R + 0.18) * (1 - t) + 0.08 * t, wallH - 0.08 + (H - wallH) * (t ** 1.25)]);
  }
  b.add(mesh(lathe(prof, 32), M.cloth('#7d5a44')));
  // 顶部的放射状缝线
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const pts: V3[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5, rr = (R + 0.2) * (1 - t) + 0.08 * t;
      pts.push([Math.sin(a) * rr, wallH - 0.05 + (H - wallH) * (t ** 1.25) + 0.012, Math.cos(a) * rr]);
    }
    for (let k = 0; k < 5; k++) b.add(rod(pts[k], pts[k + 1], 0.022, M.flat('#4f382a'), 4));
  }
  b.add(mesh(new THREE.TorusGeometry(R + 0.16, 0.05, 6, 40), M.cloth('#6e231c', false), { p: [0, wallH - 0.06, 0], r: [90, 0, 0] }));
  b.add(mesh(lathe([[0.16, 0], [0.2, 0.1], [0.08, 0.26], [0.02, 0.46]], 10), M.flat('#b8923e'), { p: [0, H - 0.04, 0] }));
  // 顶旗
  b.add(rod([0, H + 0.3, 0], [0, H + 1.5, 0], 0.025, M.woodFine('#4a3828')));
  b.add(mesh(bx(0.85, 0.5, 0.02, 1), M.cloth('#7a1f1a'), { p: [0.44, H + 1.2, 0] }));
  // 门
  b.add(mesh(new THREE.BoxGeometry(1.25, 1.45, 0.06), interiorMat(), { p: [0, 0.72, R - 0.03] }));
  b.add(mesh(bx(0.5, 1.4, 0.04, 1), M.cloth('#6e231c'), { p: [-0.74, 0.74, R + 0.03], r: [0, 18, -6] }));
  b.add(mesh(bx(1.5, 0.14, 0.08, 1, 'x'), M.woodFine('#4a3828'), { p: [0, 1.5, R + 0.02] }));
  b.light([0, 1.0, R + 0.6], WARM, 3.2);
  // 风绳
  const rope = M.flat('#6b5a44'), pole = M.woodFine('#5a4433');
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    b.add(rod([Math.sin(a) * (R + 0.15), wallH - 0.05, Math.cos(a) * (R + 0.15)], [Math.sin(a) * (R + 1.0), 0.05, Math.cos(a) * (R + 1.0)], 0.012, rope, 4));
    b.add(rod([Math.sin(a) * (R + 0.95), 0, Math.cos(a) * (R + 0.95)], [Math.sin(a) * (R + 1.08), 0.22, Math.cos(a) * (R + 1.08)], 0.03, pole));
  }
  // 兽皮与木箱
  b.add(place(jar(0.26, 0.5, '#5b3b2a', '#6e231c'), [1.7, 0, R + 0.25]));
  b.add(mesh(bx(0.6, 0.45, 0.45, 1), M.wood('#6f5136'), { p: [-1.75, 0.22, R + 0.35] }));
  b.solid(-2.3, -2.3, 2.3, 2.3);
  b.door(0, 3.3);
  return b;
}

/** 侧面带可平铺 UV 的开口圆筒 */
function uvCyl(r: number, h: number, segs: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, h, segs, 1, true);
}

// ================================================================ 木栅寨墙与寨门
function palisadeLogs(b: Build, x0: number, x1: number, seed: number) {
  const r = rng(seed);
  const n = Math.round((x1 - x0) / 0.31);
  const step = (x1 - x0) / n;
  const tones = ['#6b5038', '#5c4632', '#77593c', '#665040'];
  for (let i = 0; i < n; i++) {
    const x = x0 + step * (i + 0.5);
    const rad = 0.145 + r() * 0.02, h = 2.45 + r() * 0.45;
    const m = M.woodFine(tones[Math.floor(r() * tones.length)]);
    const lean = (r() - 0.5) * 3;
    const g = new THREE.Group();
    g.add(mesh(cy(rad * 0.92, rad, h, 9, 1.2, 2), m, { p: [0, h / 2, 0] }));
    g.add(mesh(cyl(0.02, rad * 0.92, 0.36, 9), M.woodFine('#a58a62'), { p: [0, h + 0.18, 0] }));
    b.add(place(g, [x, 0, (r() - 0.5) * 0.05], [0, r() * 360, lean]));
  }
  const rail = M.woodFine('#4a3828');
  for (const y of [0.85, 1.95]) b.add(rod([x0, y, 0.17], [x1, y, 0.17], 0.07, rail, 7));
  for (let i = 0; i < n; i += 2) for (const y of [0.85, 1.95]) b.add(mesh(new THREE.TorusGeometry(0.09, 0.018, 4, 8), M.flat('#8a7a5c'), { p: [x0 + step * (i + 0.5), y, 0.17], r: [0, 90, 0] }));
}

export function palisadeH(): Build {
  const b = new Build('palisade_h', 'building');
  palisadeLogs(b, -2, 2, 11);
  b.solid(-2, -0.25, 2, 0.28);
  return b;
}

export function palisadeGate(): Build {
  const b = new Build('palisade_gate', 'building');
  palisadeLogs(b, -4, -2.17, 23);
  palisadeLogs(b, 2.17, 4, 29);
  const log = M.woodFine('#5c4632'), dark = M.woodFine('#3f3024');
  for (const s of [-1, 1]) {
    b.add(mesh(cy(0.22, 0.25, 4.4, 10, 1.2, 2), log, { p: [s * 1.95, 2.2, 0] }));
    b.add(mesh(cyl(0.03, 0.22, 0.5, 10), M.woodFine('#a58a62'), { p: [s * 1.95, 4.65, 0] }));
    // 火把
    b.add(rod([s * 2.25, 2.3, 0.3], [s * 2.42, 3.1, 0.5], 0.035, dark));
    b.add(mesh(ellipsoid(0.09, 0.12, 0.09, 8, 6), mat('#e2581a', { kind: 'flat', emissive: '#ff9a3a' }), { p: [s * 2.44, 3.2, 0.52] }));
    b.light([s * 2.44, 3.4, 0.6], FIRE, 5, { flicker: 0.3 });
    (b.info.fires ??= []).push([s * 2.44, 3.28, 0.52, 0.4]);
  }
  b.add(rod([-2.5, 3.75, 0], [2.5, 3.75, 0], 0.16, log, 9));
  b.add(rod([-2.3, 4.2, 0], [2.3, 4.2, 0], 0.12, log, 9));
  b.add(mesh(new THREE.BoxGeometry(2.3, 0.62, 0.07), texMat(T.sign('黑风寨', { bg: '#241a14', fg: '#b3261e', border: '#5c4632' })), { p: [0, 3.25, 0.12], r: [-10, 0, 0] }));
  for (const s of [-1, 1]) b.add(rod([s * 0.9, 3.7, 0.08], [s * 0.9, 3.5, 0.12], 0.012, M.flat('#6b5a44'), 4));
  // 敞开的门扇
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group();
    leaf.add(mesh(bx(1.8, 2.9, 0.1, 1.1), M.wood('#5f4833'), { p: [0.9, 1.5, 0] }));
    for (const y of [0.5, 1.5, 2.5]) leaf.add(mesh(bx(1.8, 0.14, 0.05, 1, 'x'), dark, { p: [0.9, y, 0.07] }));
    leaf.add(mesh(bx(2.2, 0.12, 0.05, 1, 'x'), dark, { p: [0.9, 1.5, 0.075], r: [0, 0, 48] }));
    b.add(place(leaf, [s * 1.72, 0, -0.1], [0, s > 0 ? 105 : 75, 0]));
  }
  b.solid(-4, -0.25, -1.7, 0.28);
  b.solid(1.7, -0.25, 4, 0.28);
  b.solid(-1.95, -1.85, -1.2, -0.1);
  b.solid(1.2, -1.85, 1.95, -0.1);
  return b;
}

// ================================================================ 院墙
export function wallH(): Build {
  const b = new Build('wall_h', 'building');
  b.add(mesh(bx(4, 0.45, 0.44, 1.2), M.brick(), { p: [0, 0.225, 0] }));
  b.add(mesh(bx(4, 1.7, 0.34, 4), M.plaster(), { p: [0, 1.3, 0] }));
  b.add(mesh(bx(4, 0.09, 0.4, 2), M.brick('#6f757a'), { p: [0, 2.14, 0] }));
  b.add(placeRoof({ W: 4, D: 0.86, rise: 0.22, pitch: 0.2, amp: 0.032, ridgeH: 0.1, plain: true }, 2.2));
  // 漏窗
  const lt = T.lattice('diamond', '#555b60', '#2a2f2c');
  b.add(mesh(new THREE.BoxGeometry(0.9, 0.62, 0.36), texMat(lt.map), { p: [0, 1.38, 0] }));
  b.add(mesh(bx(1.04, 0.07, 0.38, 1, 'x'), M.brick('#6f757a'), { p: [0, 1.73, 0] }));
  b.add(mesh(bx(1.04, 0.07, 0.38, 1, 'x'), M.brick('#6f757a'), { p: [0, 1.03, 0] }));
  b.solid(-2, -0.24, 2, 0.24);
  return b;
}
