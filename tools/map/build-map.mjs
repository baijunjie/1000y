// 生成世界地图：地表混合图（splat/aux）、物件摆放、刷怪点、NPC、区域。
// 用法：node tools/map/build-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/assets/map');
const W = 200, H = 160;          // 米
const PX = 4;                     // splat 每米像素
const CELL = 0.5;                 // 碰撞格边长
const SW = W * PX, SH = H * PX;

// ---------- 随机与噪声 ----------
let seed = 20261122;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const wpick = (pairs) => { let t = pairs.reduce((s, p) => s + p[1], 0) * rnd(); for (const p of pairs) { t -= p[1]; if (t <= 0) return p[0]; } return pairs[0][0]; };
const h2 = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vn = (x, y, s = 1) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return h2(xi, yi, s) * (1 - u) * (1 - v) + h2(xi + 1, yi, s) * u * (1 - v) + h2(xi, yi + 1, s) * (1 - u) * v + h2(xi + 1, yi + 1, s) * u * v; };
const fbm = (x, y, s = 1) => vn(x, y, s) * 0.5 + vn(x * 2, y * 2, s + 7) * 0.25 + vn(x * 4, y * 4, s + 13) * 0.15 + vn(x * 8, y * 8, s + 19) * 0.1;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- 几何 ----------
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function distPoly(px, pz, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}
/** Catmull-Rom 细分，让折线变成平滑曲线 */
function smooth(pts, n = 8) {
  const out = [];
  const P = (i) => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- 世界布局 ----------
const VILLAGE = [100, 107];
const river = smooth([[150, -4], [146, 26], [155, 58], [150, 88], [156, 104], [159, 124], [151, 164]]);
const RIVER_HALF = 4.2;
const BRIDGE = [156, 104.1];
const ponds = [{ x: 80, z: 131, r: 6.5 }];

const roads = {
  main: { w: 3.4, pts: smooth([[-2, 106], [40, 107], [70, 106], [100, 106], [130, 106], [150, 104], [162, 104], [202, 103]]) },
  north: { w: 3.0, pts: smooth([[100, 106], [100, 84], [101, 66], [97, 52], [88, 45], [78, 40], [76, 34]]) },
  south: { w: 2.8, pts: smooth([[100, 106], [100, 128], [104, 148], [106, 162]]) },
  eastTrail: { w: 2.0, pts: smooth([[162, 104], [176, 95], [186, 80], [183, 60], [188, 36], [186, 22]]) },
  westTrail: { w: 2.0, pts: smooth([[40, 107], [34, 92], [29, 72], [36, 54]]) },
  shrine: { w: 1.8, pts: smooth([[162, 104], [172, 118], [184, 131]]) },
  pond: { w: 1.6, pts: smooth([[92, 112], [86, 122], [82, 126]]) },
  inn: { w: 2.2, pts: [[86, 106], [86, 101]] },
  dojo: { w: 2.6, pts: [[116, 106], [116, 99]] },
};
const roadDist = (x, z) => { let d = Infinity; for (const r of Object.values(roads)) d = Math.min(d, distPoly(x, z, r.pts) - r.w / 2); return d; };
const waterAt = (x, z) => {
  // 桥位处河道收窄、岸线取直，保证桥面能完整跨过水面
  const nearBridge = Math.exp(-Math.pow((z - BRIDGE[1]) / 6.5, 2));
  const wob = (fbm(x * 0.12, z * 0.12, 5) - 0.5) * 2.4 * (1 - 0.85 * nearBridge);
  let m = 0.5 + (RIVER_HALF - 1.5 * nearBridge + wob - distPoly(x, z, river)) / 5.0;
  for (const p of ponds) m = Math.max(m, 0.5 + (p.r + wob * 0.6 - Math.hypot(x - p.x, z - p.z)) / 4.0);
  return clamp(m);
};

const CAMP = { x0: 54, x1: 96, z0: 8, z1: 36, gateX: 76 };

// 建筑：正立面朝南（+Z）。fw/fd 为避让用的粗略占地。
const buildings = [
  { k: 'inn', x: 86, z: 95.5, fw: 12, fd: 9 },
  { k: 'dojo', x: 116, z: 92.5, fw: 14, fd: 10 },
  { k: 'smithy', x: 72, z: 100, fw: 9, fd: 7 },
  { k: 'clinic', x: 131, z: 99.5, fw: 9, fd: 7 },
  { k: 'house_a', x: 60, z: 99, fw: 8, fd: 7 },
  { k: 'house_b', x: 143, z: 97, fw: 8, fd: 7 },
  { k: 'house_c', x: 112, z: 121, fw: 9, fd: 7 },
  { k: 'house_a', x: 126, z: 123, fw: 8, fd: 7 },
  { k: 'house_b', x: 68, z: 121, fw: 8, fd: 7 },
  { k: 'house_c', x: 56, z: 118, fw: 9, fd: 7 },
  { k: 'gate', x: 100, z: 82, fw: 7, fd: 2 },
  { k: 'shrine', x: 185, z: 128, fw: 6, fd: 5 },
  { k: 'watchtower', x: 90, z: 31, fw: 4, fd: 4 },
  { k: 'watchtower', x: 60, z: 31, fw: 4, fd: 4 },
  { k: 'tent_a', x: 64, z: 20, fw: 6, fd: 5 },
  { k: 'tent_b', x: 86, z: 19, fw: 6, fd: 5 },
  { k: 'tent_a', x: 75, z: 13, fw: 6, fd: 5 },
];
const nearBuilding = (x, z, m = 1.5) => buildings.some((b) => Math.abs(x - b.x) < b.fw / 2 + m && z > b.z - b.fd / 2 - m - 1.5 && z < b.z + b.fd / 2 + m + 2);
const inCamp = (x, z, m = 0) => x > CAMP.x0 - m && x < CAMP.x1 + m && z > CAMP.z0 - m && z < CAMP.z1 + m;
const inVillage = (x, z) => Math.hypot((x - VILLAGE[0]) / 52, (z - VILLAGE[1] - 2) / 30) < 1;

// 植被分区：返回 { density, types }
function biome(x, z) {
  const n = fbm(x * 0.03, z * 0.03, 31);
  if (inCamp(x, z, 3)) return null;
  if (inVillage(x, z)) return { d: 0.06, t: [['maple_a', 2], ['tree_a', 2], ['peach_a', 2], ['willow_a', 1], ['tree_b', 1]], under: 0.5 };
  if (x < 52 && z > 78 && z < 140) return { d: 0.55, t: [['bamboo_a', 3], ['bamboo_b', 3], ['bamboo_c', 3], ['tree_c', 1]], under: 0.8 };   // 西：竹林
  if (x < 60 && z <= 78) return { d: 0.16 + n * 0.2, t: [['tree_a', 2], ['tree_b', 2], ['tree_c', 2], ['maple_b', 1], ['pine_a', 1]], under: 1.2 }; // 西北：鹿鸣草甸
  if (z < 70 && x >= 60 && x < 140) return { d: 0.5 + n * 0.3, t: [['pine_a', 3], ['pine_b', 3], ['tree_b', 1], ['dead_a', 0.5], ['tree_c', 1]], under: 0.7 }; // 北：松林
  if (x > 162) return { d: 0.5 + n * 0.3, t: [['maple_a', 3], ['maple_b', 3], ['tree_a', 1], ['pine_a', 0.6], ['dead_a', 0.3]], under: 0.9 }; // 东：枫林
  if (z > 136) return { d: 0.3 + n * 0.3, t: [['willow_a', 1.5], ['tree_a', 2], ['tree_b', 2], ['maple_a', 1], ['peach_a', 0.6]], under: 1.0 };
  return { d: 0.2 + n * 0.25, t: [['tree_a', 2], ['tree_b', 2], ['tree_c', 2], ['maple_a', 1.5], ['maple_b', 1], ['peach_a', 0.5]], under: 1.0 };
}

// ---------- 地表混合图 ----------
const splat = new Float32Array(SW * SH * 4); // dirt, stone, sand, leaf
const aux = new Float32Array(SW * SH * 4);   // water, -, lush, -
const treeDensity = new Float32Array(SW * SH);
for (let j = 0; j < SH; j++) {
  for (let i = 0; i < SW; i++) {
    const x = (i + 0.5) / PX, z = (j + 0.5) / PX, o = (j * SW + i) * 4;
    const n1 = fbm(x * 0.35, z * 0.35, 3), n2 = fbm(x * 0.08, z * 0.08, 9);
    const wm = waterAt(x, z);
    const rd = roadDist(x, z) + (n1 - 0.5) * 0.9;
    let dirt = 1 - sstep(-0.2, 0.9, rd);
    let stone = 0, sand = 0, leaf = 0;
    // 村中石板：广场 + 主街
    const dPlaza = Math.hypot(x - VILLAGE[0], (z - VILLAGE[1]) * 1.15) - 9.5 + (n1 - 0.5) * 1.2;
    const dStreet = Math.max(Math.abs(z - 106) - 2.4, Math.abs(x - 101) - 34) + (n1 - 0.5) * 0.8;
    const dLane = Math.min(
      Math.max(Math.abs(x - 86) - 1.6, Math.abs(z - 102.5) - 4), Math.max(Math.abs(x - 116) - 2.0, Math.abs(z - 101) - 6),
      Math.max(Math.abs(x - 116) - 7.5, Math.abs(z - 101.5) - 3.2),
    ) + (n1 - 0.5) * 0.6;
    stone = 1 - sstep(-0.3, 0.6, Math.min(dPlaza, dStreet, dLane));
    // 建筑周边的夯土
    for (const b of buildings) {
      const d = Math.max(Math.abs(x - b.x) - b.fw / 2 - 0.8, Math.abs(z - b.z - 0.8) - b.fd / 2 - 1.6) + (n1 - 0.5) * 1.4;
      dirt = Math.max(dirt, (1 - sstep(-0.4, 1.0, d)) * 0.9);
    }
    // 营寨内部
    if (inCamp(x, z, 2)) {
      const d = Math.max(CAMP.x0 - x, x - CAMP.x1, CAMP.z0 - z, z - CAMP.z1) + (n1 - 0.5) * 2;
      dirt = Math.max(dirt, (1 - sstep(-2.5, 0.5, d)) * (0.55 + n2 * 0.5));
    }
    // 西边农田
    const dFarm = Math.max(Math.abs(x - 40) - 9, Math.abs(z - 122) - 7) + (n1 - 0.5) * 1.5;
    dirt = Math.max(dirt, (1 - sstep(-0.5, 0.8, dFarm)) * (0.6 + 0.4 * Math.abs(Math.sin(z * 2.6))));
    // 河滩
    sand = sstep(0.12, 0.42, wm) * (0.75 + n1 * 0.4);
    // 林地落叶
    const bio = biome(x, z);
    const td = bio ? bio.d : 0;
    treeDensity[j * SW + i] = td;
    leaf = sstep(0.3, 0.75, td + (n2 - 0.5) * 0.5) * 0.85 * (x < 52 && z > 78 && z < 140 ? 0.7 : 1);
    // 互斥归一
    stone = clamp(stone);
    dirt = clamp(dirt) * (1 - stone);
    sand = clamp(sand) * (1 - stone) * (1 - dirt * 0.5);
    leaf = clamp(leaf) * (1 - stone) * (1 - dirt) * (1 - sand);
    const sum = dirt + stone + sand + leaf;
    const k = sum > 1 ? 1 / sum : 1;
    splat[o] = dirt * k; splat[o + 1] = stone * k; splat[o + 2] = sand * k; splat[o + 3] = leaf * k;
    aux[o] = wm; aux[o + 1] = 0; aux[o + 2] = clamp(0.5 + (n2 - 0.5) * 2.2 + (inVillage(x, z) ? 0.1 : 0)); aux[o + 3] = 1;
  }
}
const toPng = (f, file) => {
  const b = Buffer.alloc(SW * SH * 4);
  for (let i = 0; i < f.length; i++) b[i] = Math.round(clamp(f[i]) * 255);
  return sharp(b, { raw: { width: SW, height: SH, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
};

// ---------- 物件 ----------
const objects = [];
const add = (a, k, x, z, o = {}) => objects.push({ a, k, x: +x.toFixed(2), z: +z.toFixed(2), ...o });
const occupied = []; // {x, z, r}
const free = (x, z, r) => !occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r);
const occ = (x, z, r) => occupied.push({ x, z, r });

for (const b of buildings) add('env_build', b.k, b.x, b.z);

// 营寨围栏：南北两面木栅，东西靠山石与密林封闭
for (let x = CAMP.x0; x < CAMP.x1; x += 4) {
  if (Math.abs(x + 2 - CAMP.gateX) < 3.5) continue;
  add('env_build', 'palisade_h', x + 2, CAMP.z1);
}
add('env_build', 'palisade_gate', CAMP.gateX, CAMP.z1);
for (let x = CAMP.x0; x < CAMP.x1; x += 4) add('env_build', 'palisade_h', x + 2, CAMP.z0);
for (let z = CAMP.z0 + 1; z < CAMP.z1; z += 2.6) {
  for (const x of [CAMP.x0 - 0.5, CAMP.x1 + 0.5]) {
    const k = rnd() < 0.6 ? 'rock_e' : 'rock_d';
    add('env_nature', k, x + rr(-0.5, 0.5), z + rr(-0.4, 0.4), { f: rnd() < 0.5, s: rr(0.95, 1.2) });
    occ(x, z, 2.2);
  }
}
// 武馆前院
for (const x of [108.5, 123.5]) add('env_build', 'wall_h', x, 104.6);
occ(108.5, 104.6, 2.4); occ(123.5, 104.6, 2.4);

// 道具摆放
const props = [
  ['well', 104.5, 111.5], ['stall_a', 93, 111.5], ['stall_b', 108.5, 113.5], ['stall_a', 96.5, 101.2],
  ['barrel', 92.6, 100.6], ['barrel', 93.5, 101.1], ['crates', 79.8, 100.8], ['cart', 80.5, 110.5], ['pot', 91.6, 101.6],
  ['weapon_rack', 122.5, 99.2], ['weapon_rack', 109.5, 99.2], ['woodpile', 66.5, 104], ['crate', 77, 103.6], ['barrel', 67.6, 101.8],
  ['bench', 97, 110.5], ['table', 89.5, 103.2], ['bench', 89.5, 104.3], ['haystack', 52, 112], ['haystack', 48.5, 114.5], ['cart', 50, 126],
  ['sign_post', 98, 86.5], ['sign_post', 148, 107], ['sign_post', 42.5, 104.5], ['sign_post', 80, 42],
  ['pot', 134.5, 102.5], ['crate', 127.2, 102.8], ['haystack', 138, 122], ['woodpile', 120.5, 125.5], ['barrel', 108.2, 124.2],
  ['bridge_h', BRIDGE[0], BRIDGE[1]], ['pier', 156.5, 127], ['boat', 160.2, 129.5],
  ['campfire', 75, 24], ['flag_a', 71.5, 35], ['flag_a', 80.5, 35], ['flag_a', 75, 10.5], ['weapon_rack', 68, 26], ['crates', 82, 27.5], ['barrel', 84, 24.5],
  ['crates', 62.5, 15.5], ['woodpile', 88.5, 14], ['pot', 69.5, 16.5], ['table', 78.5, 20.5], ['bench', 78.5, 21.7],
  ['campfire', 178, 62], ['campfire', 31, 60],
];
for (const [k, x, z] of props) { add('env_props', k, x, z); occ(x, z, k === 'bridge_h' ? 5 : 1.6); }
// 灯
const lamps = [[95, 104], [105, 104], [90, 108.2], [110, 108.2], [78, 104.3], [122, 108.2], [134, 104.3], [66, 108.2], [100, 96], [100, 118], [144, 108], [100, 88], [56, 104.5], [86, 102.6], [119.4, 100.3]];
for (const [x, z] of lamps) { add('env_props', 'lantern_post', x, z); occ(x, z, 1); }
for (const [x, z] of [[111, 105.2], [121, 105.2], [181.5, 131.5], [188.5, 131.5], [98.2, 79.5], [101.8, 79.5]]) { add('env_props', 'stone_lantern', x, z); occ(x, z, 1); }
for (const [x, z] of [[72, 37.6], [80, 37.6], [66, 22], [84, 21]]) { add('env_props', 'lantern_post', x, z); occ(x, z, 1); }
// 篱笆：农田与几户人家
const fenceH = (x0, x1, z) => { for (let x = x0; x < x1; x += 2) add('env_props', 'fence_h', x + 1, z); };
const fenceV = (x, z0, z1) => { for (let z = z0; z < z1; z += 2) add('env_props', 'fence_v', x, z + 1); };
fenceH(31, 49, 114.6); fenceH(31, 43, 129.4); fenceV(31, 115, 129); fenceV(49, 115, 123);
fenceH(52, 58, 123.5); fenceH(63, 73, 126.2); fenceH(121, 131, 128); fenceH(106, 110, 126.4);

// 树
const trees = [];
const fixedTrees = [
  ['maple_a', 100.5, 107.2, 1.25], ['willow_a', 86.5, 126.5, 1], ['willow_a', 74.5, 134, 1.05], ['peach_a', 122, 113, 1], ['peach_a', 78, 113.5, 0.95],
  ['maple_b', 137.5, 110.5, 1], ['tree_a', 61, 109, 1.1], ['pine_a', 96.2, 81, 1], ['pine_b', 104.2, 80.4, 1.05], ['willow_a', 147.5, 112, 1], ['willow_a', 161.5, 98, 1.05],
  ['maple_a', 180.5, 124.5, 1.1], ['maple_b', 190.5, 126, 1], ['peach_a', 52, 104, 1],
];
for (const [k, x, z, s] of fixedTrees) { trees.push([k, x, z, s]); occ(x, z, 2.2); }
for (let z = 1; z < H; z += 1.6) {
  for (let x = 1; x < W; x += 1.6) {
    const px = x + rr(-0.75, 0.75), pz = z + rr(-0.75, 0.75);
    const bio = biome(px, pz);
    // 地图边缘用密林封边
    const edge = Math.min(px, pz, W - px, H - pz);
    const d = edge < 7 ? 0.9 : bio ? bio.d : 0;
    if (rnd() > d * 0.42) continue;
    if (waterAt(px, pz) > 0.3) continue;
    if (roadDist(px, pz) < 2.2) continue;
    if (nearBuilding(px, pz, 3)) continue;
    if (inCamp(px, pz, 3.5)) continue;
    if (Math.hypot(px - VILLAGE[0], pz - VILLAGE[1]) < 14) continue;
    if (!free(px, pz, 2.4)) continue;
    const k = edge < 7 ? wpick([['pine_a', 2], ['pine_b', 2], ['tree_b', 2], ['tree_c', 1]]) : wpick(bio.t);
    trees.push([k, px, pz, rr(0.88, 1.18)]);
    occ(px, pz, k.startsWith('bamboo') ? 1.5 : 2.4);
  }
}
for (const [k, x, z, s] of trees) add('env_trees', k, x, z, { s: +s.toFixed(2), f: rnd() < 0.5 });

// 灌木、岩石、花草
for (let i = 0; i < 5200; i++) {
  const x = rr(1, W - 1), z = rr(1, H - 1);
  const wm = waterAt(x, z);
  const rd = roadDist(x, z);
  if (nearBuilding(x, z, 0.6)) continue;
  const bio = biome(x, z);
  const under = bio ? bio.under : 0.5;
  if (wm > 0.72) {
    if (rnd() < 0.07 && ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r - 1)) add('env_nature', rnd() < 0.35 ? 'lotus_b' : 'lotus_a', x, z, { f: rnd() < 0.5, s: rr(0.8, 1.2) });
    continue;
  }
  if (wm > 0.36) {
    if (wm < 0.6 && rnd() < 0.22) add('env_nature', pick(['reed_a', 'reed_b']), x, z, { f: rnd() < 0.5, s: rr(0.85, 1.2) });
    else if (rnd() < 0.03 && wm < 0.5) add('env_nature', pick(['rock_a', 'rock_b']), x, z, { f: rnd() < 0.5 });
    continue;
  }
  if (rd < 0.6) continue;
  if (Math.hypot(x - VILLAGE[0], (z - VILLAGE[1]) * 1.15) < 10.5) continue;
  if (Math.abs(z - 106) < 3 && Math.abs(x - 101) < 35) continue;
  const r = rnd();
  if (r < 0.5 * under) add('env_nature', pick(['grass_a', 'grass_b', 'grass_c', 'grass_d']), x, z, { f: rnd() < 0.5, s: rr(0.8, 1.25) });
  else if (r < 0.62 * under) add('env_nature', pick(['flower_a', 'flower_b', 'flower_c', 'flower_d']), x, z, { f: rnd() < 0.5, s: rr(0.85, 1.15) });
  else if (r < 0.66 * under && rd > 1.5 && free(x, z, 1.4)) { add('env_trees', pick(['bush_a', 'bush_b', 'bush_c']), x, z, { f: rnd() < 0.5, s: rr(0.85, 1.2) }); occ(x, z, 1.1); }
  else if (r < 0.685 * under && rd > 1.2 && free(x, z, 1.6) && !inVillage(x, z)) {
    const k = wpick([['rock_a', 4], ['rock_b', 4], ['rock_c', 3], ['rock_d', 1.5], ['rock_e', 0.5]]);
    add('env_nature', k, x, z, { f: rnd() < 0.5, s: rr(0.85, 1.2) }); occ(x, z, k > 'rock_c' ? 2 : 1.2);
  } else if (r < 0.7 * under && (bio?.d ?? 0) > 0.3 && free(x, z, 1.2)) {
    add('env_nature', wpick([['mushroom_a', 2], ['stump_a', 1.5], ['log_a', 1]]), x, z, { f: rnd() < 0.5 }); occ(x, z, 1);
  }
}

// ---------- 采集点、刷怪点、NPC、区域 ----------
const gather = [];
const herbSpots = [[58, 86], [46, 70], [28, 50], [118, 74], [132, 62], [112, 48], [170, 84], [178, 110], [192, 96], [168, 134], [190, 142], [128, 140], [86, 144], [60, 140], [140, 78], [22, 96], [66, 60], [176, 46]];
for (const [hx, hz] of herbSpots) {
  for (let t = 0; t < 30; t++) {
    const x = hx + rr(-3, 3), z = hz + rr(-3, 3);
    if (waterAt(x, z) < 0.3 && roadDist(x, z) > 1 && free(x, z, 1.2)) { gather.push({ k: 'herb_a', item: 'herb', x: +x.toFixed(2), z: +z.toFixed(2) }); occ(x, z, 1); break; }
  }
}

const spawns = [
  { mob: 'dummy', x: 111.5, z: 101.6, r: 0, n: 1 }, { mob: 'dummy', x: 114.5, z: 102.4, r: 0, n: 1 }, { mob: 'dummy', x: 117.5, z: 102.4, r: 0, n: 1 }, { mob: 'dummy', x: 120.5, z: 101.6, r: 0, n: 1 },
  { mob: 'chicken', x: 62, z: 112, r: 5, n: 4 }, { mob: 'chicken', x: 40, z: 121, r: 6, n: 4 }, { mob: 'chicken', x: 132, z: 116, r: 5, n: 3 },
  { mob: 'deer', x: 34, z: 56, r: 12, n: 5 }, { mob: 'deer', x: 50, z: 66, r: 9, n: 3 },
  { mob: 'dog', x: 72, z: 72, r: 9, n: 4 }, { mob: 'dog', x: 122, z: 80, r: 9, n: 4 }, { mob: 'dog', x: 64, z: 136, r: 8, n: 3 }, { mob: 'dog', x: 132, z: 138, r: 9, n: 4 }, { mob: 'dog', x: 30, z: 142, r: 8, n: 3 },
  { mob: 'wolf', x: 176, z: 92, r: 10, n: 5 }, { mob: 'wolf', x: 186, z: 70, r: 10, n: 5 }, { mob: 'wolf', x: 172, z: 142, r: 9, n: 4 }, { mob: 'wolf', x: 190, z: 112, r: 8, n: 3 },
  { mob: 'boar', x: 124, z: 52, r: 11, n: 5 }, { mob: 'boar', x: 112, z: 30, r: 10, n: 4 }, { mob: 'boar', x: 134, z: 22, r: 9, n: 3 },
  { mob: 'tiger', x: 186, z: 20, r: 6, n: 1 }, { mob: 'wolf', x: 178, z: 34, r: 8, n: 3 },
  { mob: 'bandit', x: 80, z: 44, r: 5, n: 3 }, { mob: 'bandit', x: 68, z: 30, r: 5, n: 3 }, { mob: 'bandit_spear', x: 84, z: 30, r: 4, n: 2 },
  { mob: 'bandit_bow', x: 62, z: 22, r: 4, n: 2 }, { mob: 'bandit_bow', x: 88, z: 23, r: 3, n: 2 }, { mob: 'bandit_spear', x: 70, z: 17, r: 4, n: 2 }, { mob: 'bandit', x: 80, z: 15, r: 4, n: 2 },
  { mob: 'boss', x: 75, z: 17, r: 1.5, n: 1 },
];

const npcs = [
  { id: 'master', x: 116, z: 100.4, dir: 0 },
  { id: 'smith', x: 73.2, z: 104.6, dir: 0 },
  { id: 'doctor', x: 131.2, z: 104.2, dir: 0 },
  { id: 'innkeeper', x: 87.6, z: 101.4, dir: 0 },
  { id: 'hunter', x: 146.5, z: 105.6, dir: 6 },
  { id: 'elder', x: 102.8, z: 109.6, dir: 7 },
  { id: 'vendor', x: 93.2, z: 113.2, dir: 0 },
  { id: 'kid', x: 97.6, z: 112.6, dir: 2 },
  { id: 'farmer', x: 46, z: 112.6, dir: 1 },
  { id: 'guard', x: 97.2, z: 84.6, dir: 0 },
];

const zones = [
  { name: '黑风寨', x0: CAMP.x0 - 4, z0: CAMP.z0 - 4, x1: CAMP.x1 + 4, z1: CAMP.z1 + 10, mood: 'danger' },
  { name: '落霞村', x0: 52, z0: 84, x1: 160, z1: 132, mood: 'town' },
  { name: '听竹坡', x0: 0, z0: 78, x1: 52, z1: 142, mood: 'calm' },
  { name: '鹿鸣草甸', x0: 0, z0: 30, x1: 60, z1: 78, mood: 'calm' },
  { name: '苍松岭', x0: 60, z0: 0, x1: 146, z1: 84, mood: 'wild' },
  { name: '虎啸崖', x0: 166, z0: 0, x1: 200, z1: 40, mood: 'danger' },
  { name: '红枫林', x0: 160, z0: 40, x1: 200, z1: 160, mood: 'wild' },
  { name: '浣溪南岸', x0: 0, z0: 132, x1: 160, z1: 160, mood: 'calm' },
];

// ---------- 基础碰撞格（水域与地图边界） ----------
const GW = Math.round(W / CELL), GH = Math.round(H / CELL);
const grid = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
  const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
  if (x < 2.5 || z < 2.5 || x > W - 2.5 || z > H - 2.5 || waterAt(x, z) > 0.53) grid[j * GW + i] = 1;
}
const bits = Buffer.alloc(Math.ceil(grid.length / 8));
grid.forEach((v, i) => { if (v) bits[i >> 3] |= 1 << (i & 7); });

// ---------- 小地图 ----------
{
  const MS = 2, MW = W * MS, MH = H * MS;
  const img = Buffer.alloc(MW * MH * 3);
  const cols = { grass: [92, 118, 66], dirt: [150, 124, 90], stone: [158, 156, 148], sand: [196, 182, 140], leaf: [70, 86, 52], water: [62, 112, 138] };
  for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
    const x = (i + 0.5) / MS, z = (j + 0.5) / MS;
    const o = (Math.min(SH - 1, Math.floor(z * PX)) * SW + Math.min(SW - 1, Math.floor(x * PX))) * 4;
    const d = splat[o], st = splat[o + 1], sa = splat[o + 2], lf = splat[o + 3], g = Math.max(0, 1 - d - st - sa - lf);
    let c = [0, 1, 2].map((k) => cols.grass[k] * g + cols.dirt[k] * d + cols.stone[k] * st + cols.sand[k] * sa + cols.leaf[k] * lf);
    const sh = 0.9 + 0.2 * fbm(x * 0.3, z * 0.3, 77);
    c = c.map((v) => v * sh);
    if (aux[o] > 0.5) c = cols.water.map((v, k) => v * (0.85 + 0.3 * aux[o]) * 0.9 + c[k] * 0.0);
    img.set(c.map((v) => clamp(Math.round(v), 0, 255)), (j * MW + i) * 3);
  }
  const dot = (x, z, r, col, a = 1) => {
    for (let j = Math.floor((z - r) * MS); j <= (z + r) * MS; j++) for (let i = Math.floor((x - r) * MS); i <= (x + r) * MS; i++) {
      if (i < 0 || j < 0 || i >= MW || j >= MH) continue;
      if (Math.hypot(i / MS - x, j / MS - z) > r) continue;
      for (let k = 0; k < 3; k++) img[(j * MW + i) * 3 + k] = img[(j * MW + i) * 3 + k] * (1 - a) + col[k] * a;
    }
  };
  for (const [k, x, z, s] of trees) dot(x, z - 0.6, k.startsWith('bamboo') ? 1.0 : 1.7 * s, k.startsWith('maple') ? [150, 70, 40] : k.startsWith('peach') ? [200, 140, 150] : k.startsWith('bamboo') ? [96, 140, 70] : [48, 82, 46], 0.8);
  for (const b of buildings) {
    for (let j = Math.floor((b.z - b.fd / 2) * MS); j < (b.z + b.fd / 2) * MS; j++) for (let i = Math.floor((b.x - b.fw / 2) * MS); i < (b.x + b.fw / 2) * MS; i++) {
      if (i < 0 || j < 0 || i >= MW || j >= MH) continue;
      const edge = j > (b.z + b.fd / 2) * MS - 3;
      img.set(edge ? [210, 200, 180] : [84, 90, 104], (j * MW + i) * 3);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  await sharp(img, { raw: { width: MW, height: MH, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'world.mini.png'));
}

fs.mkdirSync(OUT, { recursive: true });
await toPng(splat, 'world.splat.png');
await toPng(aux, 'world.aux.png');
const map = {
  name: 'world', w: W, h: H, cell: CELL, gw: GW, gh: GH, grid: bits.toString('base64'),
  spawn: { x: 100.5, z: 112.5 },
  objects, gather, spawns, npcs, zones,
};
fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify(map));
const cnt = {};
for (const o of objects) cnt[o.a] = (cnt[o.a] ?? 0) + 1;
console.log('地图已生成:', JSON.stringify(cnt), `采集点 ${gather.length}，刷怪点 ${spawns.length}`);
