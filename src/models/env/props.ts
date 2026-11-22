import * as THREE from 'three';
import { cyl, ellipsoid, lathe, rng } from '../geo';
import { Build, bx, cy, DEG, FIRE, lantern, M, mat, mesh, RED_GLOW, rod, roof, texMat, WARM } from './arch';
import { basket, canvasSheet, jar, place } from './buildings';
import * as T from './tex_build';

type V3 = [number, number, number];
const WOOD_DARK = '#4a3122';
const WOOD_RED = '#8a3324';

function sack(w = 0.3, h = 0.22, d = 0.42, color = '#b5a37c'): THREE.Mesh {
  return mesh(ellipsoid(w, h, d, 10, 7), M.cloth(color, false));
}

function crateMesh(s = 0.8, color = '#8a6a48'): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(bx(s, s, s, 0.8), M.wood(color), { p: [0, s / 2, 0] }));
  const fm = M.woodFine('#6b4f36');
  const e = 0.08;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(bx(e, s + 0.02, e), fm, { p: [sx * (s / 2 - e / 2 + 0.01), s / 2, sz * (s / 2 - e / 2 + 0.01)] }));
  for (const y of [e / 2, s - e / 2]) for (const sz of [-1, 1]) g.add(mesh(bx(s + 0.02, e, e, 1, 'x'), fm, { p: [0, y, sz * (s / 2 - e / 2 + 0.01)] }));
  for (const sx of [-1, 1]) g.add(mesh(bx(e, e, s, 1, 'z'), fm, { p: [sx * (s / 2 - e / 2 + 0.01), s - e / 2 + 0.005, 0] }));
  g.add(mesh(bx(s * 1.25, e * 0.9, 0.03, 1, 'x'), fm, { p: [0, s / 2, s / 2 + 0.012], r: [0, 0, 42] }));
  return g;
}

function barrelMesh(r = 0.36, h = 0.9): THREE.Group {
  const g = new THREE.Group();
  const body = lathe([[r * 0.8, 0], [r * 0.98, h * 0.28], [r, h * 0.5], [r * 0.96, h * 0.75], [r * 0.8, h], [r * 0.72, h], [r * 0.72, h - 0.04], [0.01, h - 0.04]], 16);
  const uv = body.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.2);
  g.add(mesh(body, M.wood('#86623f')));
  const iron = M.metal('#3b3d42');
  for (const [y, k] of [[h * 0.14, 0.9], [h * 0.5, 1.01], [h * 0.86, 0.9]]) g.add(mesh(new THREE.TorusGeometry(r * k, 0.02, 5, 18), iron, { p: [0, y, 0], r: [90, 0, 0] }));
  return g;
}

function wheel(r = 0.5): THREE.Group {
  const g = new THREE.Group();
  const wm = M.woodFine('#5c4532');
  g.add(mesh(new THREE.TorusGeometry(r, 0.055, 6, 22), wm));
  g.add(mesh(new THREE.TorusGeometry(r + 0.04, 0.018, 4, 22), M.metal('#3b3d42')));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(rod([0, 0, 0], [Math.cos(a) * r, Math.sin(a) * r, 0], 0.028, wm, 5));
  }
  g.add(mesh(cyl(0.09, 0.09, 0.18, 10), wm, { r: [90, 0, 0] }));
  return g;
}

// ---------------------------------------------------------------- 灯
export function lanternPost(): Build {
  const b = new Build('lantern_post', 'prop');
  const wm = M.woodFine(WOOD_DARK);
  b.add(mesh(bx(0.42, 0.22, 0.42, 1.2), M.stone('#9a968d'), { p: [0, 0.11, 0] }));
  b.add(mesh(cy(0.065, 0.085, 3.2, 8, 1.2, 1), wm, { p: [0, 1.7, 0] }));
  b.add(mesh(cyl(0.02, 0.09, 0.14, 8), wm, { p: [0, 3.37, 0] }));
  b.add(rod([-0.2, 3.02, 0], [0.82, 3.12, 0], 0.04, wm));
  b.add(rod([0, 2.5, 0], [0.52, 3.07, 0], 0.03, wm));
  b.add(place(lantern(0.21, 0.36), [0.72, 3.08, 0]));
  b.light([0.72, 2.7, 0.15], RED_GLOW, 5.5, { flicker: 0.12 });
  b.solid(-0.2, -0.2, 0.2, 0.2);
  return b;
}

export function stoneLantern(): Build {
  const b = new Build('stone_lantern', 'prop');
  const st = M.stone('#a09d94'), st2 = M.rubble('#8f8d85');
  b.add(mesh(lathe([[0.36, 0], [0.38, 0.1], [0.26, 0.2], [0.24, 0.26], [0.01, 0.26]], 6), st2));
  b.add(mesh(cy(0.11, 0.14, 0.6, 8, 1, 1), st, { p: [0, 0.55, 0] }));
  b.add(mesh(lathe([[0.12, 0], [0.3, 0.1], [0.32, 0.16], [0.3, 0.18], [0.01, 0.18]], 6), st, { p: [0, 0.84, 0] }));
  // 灯室：四面开窗
  b.add(mesh(bx(0.4, 0.46, 0.4, 1), st, { p: [0, 1.25, 0] }));
  const glow = mat('#f3d79a', { kind: 'flat', emissive: '#ffc878' });
  b.add(mesh(new THREE.BoxGeometry(0.2, 0.3, 0.42), glow, { p: [0, 1.22, 0] }));
  b.add(mesh(new THREE.BoxGeometry(0.42, 0.3, 0.2), glow, { p: [0, 1.22, 0] }));
  b.add(place(roof({ W: 0.74, D: 0.74, rise: 0.3, inset: 0.365, lift: 0.04, pitch: 0.37, amp: 0, material: M.stone('#8d8b84'), ridgeMat: st, ridgeH: 0, tip: 0.05, ridgeR: 0.026 }), [0, 1.5, 0]));
  b.add(mesh(lathe([[0.07, 0], [0.09, 0.06], [0.04, 0.12], [0.07, 0.2], [0.01, 0.28]], 8), st, { p: [0, 1.74, 0] }));
  b.light([0, 1.2, 0.3], WARM, 4, { flicker: 0.08 });
  b.solid(-0.32, -0.32, 0.32, 0.32);
  return b;
}

// ---------------------------------------------------------------- 水井
export function well(): Build {
  const b = new Build('well', 'prop');
  b.add(mesh(lathe([[0.52, 0.2], [0.52, 0.72], [0.76, 0.72], [0.8, 0.0]], 16), M.rubble('#8e8b82')));
  b.add(mesh(lathe([[0.5, 0.7], [0.5, 0.76], [0.8, 0.76], [0.8, 0.7]], 16), M.stone('#a09d94')));
  b.add(mesh(cyl(0.52, 0.52, 0.02, 16), mat('#16242b', { kind: 'flat' }), { p: [0, 0.3, 0] }));
  b.add(mesh(cyl(1.15, 1.2, 0.08, 18), M.stone('#8d8a82'), { p: [0, 0.04, 0] }));
  const wm = M.woodFine(WOOD_DARK);
  for (const s of [-1, 1]) b.add(mesh(bx(0.12, 2.15, 0.12), wm, { p: [s * 0.95, 1.07, 0] }));
  b.add(rod([-1.05, 1.55, 0], [1.05, 1.55, 0], 0.085, M.woodFine('#7a5c40'), 8));
  b.add(rod([1.05, 1.55, 0], [1.3, 1.55, 0], 0.025, M.metal()));
  b.add(rod([1.3, 1.55, 0], [1.3, 1.25, 0.1], 0.025, M.metal()));
  b.add(rod([0.1, 1.5, 0], [0.1, 0.95, 0.3], 0.014, M.flat('#b8a47c'), 4));
  for (let i = 0; i < 5; i++) b.add(mesh(new THREE.TorusGeometry(0.095, 0.014, 4, 10), M.flat('#b8a47c'), { p: [-0.25 + i * 0.07, 1.55, 0], r: [0, 90, 0] }));
  // 水桶
  b.add(mesh(lathe([[0.12, 0], [0.16, 0.28], [0.14, 0.28], [0.1, 0.03]], 10), M.wood('#86623f'), { p: [0.3, 0.76, 0.5] }));
  b.add(mesh(new THREE.TorusGeometry(0.15, 0.012, 4, 12), M.metal(), { p: [0.3, 0.95, 0.5], r: [90, 0, 0] }));
  b.add(place(roof({ W: 2.5, D: 1.5, rise: 0.5, pitch: 0.2, amp: 0.032, ridgeH: 0.12, lift: 0.1, tip: 0.14, ridgeR: 0.045 }), [0, 2.12, 0]));
  b.solid(-1.05, -0.8, 1.05, 0.8);
  return b;
}

// ---------------------------------------------------------------- 摊位
function stallFrame(b: Build, w: number, d: number, canopy: THREE.Material, back = 2.45, front = 2.0) {
  const wm = M.woodFine('#6b4f36');
  b.add(mesh(bx(w, 0.07, d, 1, 'x'), M.wood('#8a6a48'), { p: [0, 0.86, 0] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(mesh(bx(0.08, 0.84, 0.08), wm, { p: [sx * (w / 2 - 0.08), 0.42, sz * (d / 2 - 0.08)] }));
  b.add(mesh(bx(w - 0.1, 0.5, 0.03, 1, 'x'), M.cloth('#7d6a4c'), { p: [0, 0.58, d / 2 - 0.05] }));
  const px = w / 2 + 0.12;
  for (const sx of [-1, 1]) {
    b.add(rod([sx * px, 0, -d / 2 - 0.15], [sx * px, back, -d / 2 - 0.15], 0.035, wm));
    b.add(rod([sx * px, 0, d / 2 + 0.3], [sx * px, front, d / 2 + 0.3], 0.035, wm));
  }
  b.add(canvasSheet((u, v) => {
    const x = -px - 0.18 + (2 * px + 0.36) * u;
    const z = -d / 2 - 0.35 + (d + 0.95) * v;
    const sag = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.12;
    return [x, back + 0.03 + (front - back) * v - sag, z];
  }, 12, 8, canopy));
}

export function stallA(): Build {
  const b = new Build('stall_a', 'prop');
  stallFrame(b, 2.2, 0.9, texMat(T.stripes('#a8322a', '#e6dcc2', 8), { double: true }));
  // 瓜果
  const fruits: [number, string][] = [[-0.75, '#d9792b'], [-0.25, '#7da043'], [0.25, '#b9342a'], [0.75, '#d6b441']];
  const r = rng(31);
  for (const [x, c] of fruits) {
    b.add(place(basket(0.2, 0.14), [x, 0.9, 0.05]));
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28, d = r() * 0.12;
      b.add(mesh(ellipsoid(0.055, 0.05, 0.055, 7, 5), mat(c), { p: [x + Math.cos(a) * d, 1.03 + r() * 0.05, 0.05 + Math.sin(a) * d] }));
    }
  }
  b.add(place(basket(0.26, 0.3, '#7da043'), [-1.5, 0, 0.35]));
  b.solid(-1.25, -0.6, 1.25, 0.55);
  return b;
}

export function stallB(): Build {
  const b = new Build('stall_b', 'prop');
  const indigo = T.drawTex('stall_indigo', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#2c4770'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '10,20,40' : '120,150,200'},${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 24, 2 + Math.random() * 4);
    }
    // 蜡染白纹：两道横带 + 菱形点
    ctx.fillStyle = '#d9dccf';
    ctx.fillRect(0, h * 0.12, w, 5); ctx.fillRect(0, h * 0.88 - 5, w, 5);
    for (let i = 0; i < 4; i++) {
      const cx = (i + 0.5) * (w / 4), cy = h / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx, cy + 9); ctx.lineTo(cx - 9, cy); ctx.closePath(); ctx.fill();
    }
  }, true, true);
  stallFrame(b, 2.4, 0.95, texMat(indigo, { double: true }), 2.5, 2.05);
  // 陶器、布匹、斗笠
  const pots: [number, number, string][] = [[-0.95, 0.12, '#7a5640'], [-0.65, 0.09, '#3f5f6b'], [-0.38, 0.11, '#e3dccb'], [-0.12, 0.08, '#7a5640']];
  for (const [x, rr, c] of pots) b.add(place(jar(rr, rr * 2.1, c), [x, 0.9, 0.08]));
  const cloths = ['#a8322a', '#2f6b5a', '#d6b441', '#5a3f78'];
  cloths.forEach((c, i) => b.add(mesh(cy(0.065, 0.065, 0.62, 10, 1, 1), M.cloth(c, false), { p: [0.35 + (i % 2) * 0.14, 0.97 + Math.floor(i / 2) * 0.12, 0.0], r: [90, 0, 0] })));
  for (let i = 0; i < 2; i++) b.add(mesh(lathe([[0.26, 0], [0.12, 0.06], [0.01, 0.12]], 14), M.thatch('#c2a468'), { p: [0.95, 0.9 + i * 0.045, 0.05] }));
  // 挂着的葫芦与草鞋
  for (const x of [-0.7, -0.3, 0.2]) {
    b.add(rod([x, 2.12, 0.72], [x, 1.8, 0.72], 0.008, M.flat('#6b5a44'), 4));
    b.add(mesh(lathe([[0.01, 0], [0.07, 0.05], [0.075, 0.1], [0.04, 0.15], [0.05, 0.2], [0.01, 0.25]], 8), mat('#c9a24a'), { p: [x, 1.55, 0.72] }));
  }
  b.add(place(jar(0.3, 0.6, '#5b3b2a'), [1.6, 0, 0.3]));
  b.solid(-1.35, -0.65, 1.35, 0.6);
  return b;
}

// ---------------------------------------------------------------- 杂物
export function barrel(): Build {
  const b = new Build('barrel', 'prop');
  b.add(barrelMesh());
  b.solid(-0.36, -0.36, 0.36, 0.36);
  return b;
}

export function crate(): Build {
  const b = new Build('crate', 'prop');
  b.add(crateMesh(0.8));
  b.solid(-0.42, -0.42, 0.42, 0.42);
  return b;
}

export function crates(): Build {
  const b = new Build('crates', 'prop');
  b.add(place(crateMesh(0.8), [-0.55, 0, -0.05], [0, 6, 0]));
  b.add(place(crateMesh(0.7, '#7d6142'), [0.3, 0, 0.0], [0, -8, 0]));
  b.add(place(crateMesh(0.6, '#93734e'), [-0.3, 0.8, -0.05], [0, 20, 0]));
  b.add(place(sack(0.3, 0.2, 0.4), [0.95, 0.18, 0.15], [0, 20, 0]));
  b.add(place(sack(0.28, 0.2, 0.38, '#a8966e'), [0.9, 0.5, 0.12], [0, -30, 0]));
  b.add(place(sack(0.3, 0.2, 0.4, '#b8a880'), [0.3, 0.88, 0.0], [0, 70, 0]));
  b.add(place(barrelMesh(0.28, 0.7), [-0.1, 0, 0.72]));
  b.solid(-1.0, -0.5, 1.3, 1.0);
  return b;
}

export function cart(): Build {
  const b = new Build('cart', 'prop');
  const wm = M.woodFine('#6b4f36');
  b.add(mesh(bx(1.9, 0.07, 1.05, 1, 'x'), M.wood('#8a6a48'), { p: [0, 0.68, 0] }));
  for (const sz of [-1, 1]) {
    b.add(place(wheel(0.5), [-0.1, 0.5, sz * 0.66]));
    b.add(rod([-0.95, 0.66, sz * 0.46], [2.2, 0.62, sz * 0.4], 0.035, wm));
    for (const x of [-0.9, 0, 0.9]) b.add(mesh(bx(0.06, 0.34, 0.06), wm, { p: [x, 0.88, sz * 0.5] }));
    b.add(mesh(bx(1.9, 0.06, 0.05, 1, 'x'), wm, { p: [0, 1.04, sz * 0.5] }));
  }
  b.add(rod([-0.1, 0.5, -0.66], [-0.1, 0.5, 0.66], 0.04, wm));
  b.add(rod([1.6, 0, 0.3], [1.5, 0.62, 0.38], 0.03, wm));
  b.add(mesh(bx(0.05, 0.4, 1.05, 1, 'z'), wm, { p: [-0.93, 0.9, 0] }));
  b.add(place(sack(0.3, 0.2, 0.42), [-0.45, 0.9, -0.1], [0, 15, 0]));
  b.add(place(sack(0.3, 0.2, 0.42, '#a8966e'), [0.2, 0.9, 0.1], [0, -20, 0]));
  b.add(place(sack(0.28, 0.19, 0.4, '#b8a880'), [-0.15, 1.22, 0.0], [0, 60, 0]));
  b.add(mesh(ellipsoid(0.36, 0.2, 0.36, 10, 6), M.thatch('#b8a060'), { p: [0.65, 0.88, -0.05] }));
  b.solid(-1.0, -0.72, 1.0, 0.72);
  return b;
}

export function haystack(): Build {
  const b = new Build('haystack', 'prop');
  const g = lathe([[1.05, 0], [1.14, 0.25], [1.08, 0.6], [0.86, 1.05], [0.52, 1.5], [0.2, 1.8], [0.03, 1.95]], 20);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 2);
  // 让轮廓不那么规整
  const pos = g.attributes.position;
  const r = rng(17);
  const jit = Array.from({ length: 64 }, () => r());
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.06 * Math.sin(a * 3 + y * 2) + 0.04 * (jit[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 21) % 21] - 0.5);
    pos.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  b.add(mesh(g, M.thatch('#c2a868')));
  b.add(mesh(new THREE.TorusGeometry(0.72, 0.022, 4, 22), M.flat('#8a7650'), { p: [0, 1.22, 0], r: [90, 0, 0] }));
  b.add(mesh(cyl(0.04, 0.05, 0.5, 6), M.woodFine('#6b4f36'), { p: [0, 2.1, 0] }));
  // 草叉
  b.add(rod([1.25, 0, 0.4], [0.82, 1.7, 0.2], 0.022, M.woodFine('#7a5c40')));
  for (const d of [-0.08, 0, 0.08]) b.add(rod([0.84 + d, 1.64, 0.2], [0.74 + d * 1.4, 2.0, 0.17], 0.01, M.metal()));
  b.solid(-1.05, -0.95, 1.05, 0.95);
  return b;
}

function fenceSeg(): THREE.Group {
  const g = new THREE.Group();
  const post = M.woodFine('#6b5038'), bam = M.woodFine('#a39058');
  const r = rng(41);
  for (const x of [-1, 0, 1]) {
    const h = 1.02 + r() * 0.12;
    g.add(mesh(cy(0.05, 0.06, h, 7, 1, 1), post, { p: [x, h / 2, 0], r: [0, 0, (r() - 0.5) * 4] }));
  }
  for (const y of [0.32, 0.8]) g.add(rod([-1.02, y, 0.04], [1.02, y + (r() - 0.5) * 0.04, 0.04], 0.028, bam));
  for (let i = 0; i < 10; i++) {
    const x = -0.95 + i * 0.21;
    const lean = (i % 2 ? 1 : -1) * 0.16;
    g.add(rod([x - lean, 0.02, 0.0], [x + lean, 0.95 + r() * 0.1, 0.0], 0.016, bam, 5));
  }
  return g;
}

export function fenceH(): Build {
  const b = new Build('fence_h', 'prop');
  b.add(fenceSeg());
  b.solid(-1, -0.12, 1, 0.12);
  return b;
}

export function fenceV(): Build {
  const b = new Build('fence_v', 'prop');
  b.add(place(fenceSeg(), [0, 0, 0], [0, 90, 0]));
  b.solid(-0.12, -1, 0.12, 1);
  return b;
}

export function signPost(): Build {
  const b = new Build('sign_post', 'prop');
  const wm = M.woodFine('#6b4f36');
  b.add(mesh(cy(0.06, 0.075, 2.3, 8, 1, 1), wm, { p: [0, 1.15, 0] }));
  for (let i = 0; i < 5; i++) b.add(mesh(ellipsoid(0.12, 0.08, 0.11, 6, 4), M.rubble('#8e8b82'), { p: [Math.cos(i * 1.3) * 0.14, 0.06, Math.sin(i * 1.3) * 0.14] }));
  const board = (text: string, y: number, dir: number, rot: number) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.0, 0.3, 0.04), texMat(T.sign(text, { bg: '#7a5c40', fg: '#1d1512', border: '#5a4030' })), { p: [dir * 0.42, 0, 0.07] }));
    const tri = new THREE.Shape();
    tri.moveTo(0, -0.2); tri.lineTo(0.22, 0); tri.lineTo(0, 0.2); tri.closePath();
    const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: false });
    g.add(mesh(tg, wm, { p: [dir * 0.92, 0, 0.05], r: [0, dir > 0 ? 0 : 180, 0] }));
    b.add(place(g, [0, y, 0], [0, 0, rot]));
  };
  board('落霞村', 1.95, 1, 3);
  board('黑风林', 1.55, -1, -4);
  b.solid(-0.15, -0.15, 0.15, 0.15);
  return b;
}

export function campfire(): Build {
  const b = new Build('campfire', 'prop');
  const r = rng(53);
  b.add(mesh(cyl(0.5, 0.56, 0.03, 14), mat('#2b2622', { kind: 'flat' }), { p: [0, 0.015, 0] }));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(mesh(ellipsoid(0.13 + r() * 0.05, 0.09 + r() * 0.04, 0.12 + r() * 0.04, 7, 5), M.rubble(i % 3 ? '#8e8b82' : '#75726a'), {
      p: [Math.cos(a) * 0.56, 0.07, Math.sin(a) * 0.56], r: [0, r() * 180, 0],
    }));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const burnt = i % 2 === 0;
    b.add(rod([Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42], [Math.cos(a + 0.5) * -0.06, 0.42, Math.sin(a + 0.5) * -0.06], 0.055, M.woodFine(burnt ? '#2a221e' : '#5a4433'), 7));
  }
  for (let i = 0; i < 7; i++) {
    const a = r() * 6.28, d = r() * 0.22;
    b.add(mesh(ellipsoid(0.05, 0.035, 0.05, 6, 4), mat('#ff8a2a', { kind: 'flat', emissive: '#ffb050' }), { p: [Math.cos(a) * d, 0.06, Math.sin(a) * d] }));
  }
  b.light([0, 0.6, 0], FIRE, 6.5, { flicker: 0.35, night: false });
  b.info.fires = [[0, 0.2, 0, 1]];
  b.solid(-0.55, -0.55, 0.55, 0.55);
  return b;
}

// ---------------------------------------------------------------- 木拱桥
export function bridgeH(): Build {
  const b = new Build('bridge_h', 'prop');
  const L = 3.5, rise = 0.9, hw = 1.5;
  const yAt = (x: number) => rise * (1 - (x / L) ** 2);
  const slope = (x: number) => Math.atan((-2 * rise * x) / (L * L)) / DEG;
  const plank = M.wood('#8c6c4a'), dark = M.woodFine('#5a3f2c'), red = M.woodFine(WOOD_RED);
  const r = rng(61);
  // 桥面板
  const n = 30;
  for (let i = 0; i < n; i++) {
    const x = -L + ((i + 0.5) * 2 * L) / n;
    b.add(mesh(bx((2 * L) / n - 0.012, 0.07, hw * 2 + (r() - 0.5) * 0.06, 0.9, 'z'), i % 4 === 1 ? M.wood('#7d5f40') : plank, { p: [x, yAt(x) + 0.035, 0], r: [0, 0, slope(x)] }));
  }
  // 拱梁与桥下立柱
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      const x0 = -L + (i * 2 * L) / 14, x1 = x0 + (2 * L) / 14;
      b.add(rod([x0, yAt(x0) - 0.14, sz * (hw - 0.02)], [x1, yAt(x1) - 0.14, sz * (hw - 0.02)], 0.13, dark, 6));
    }
    for (const x of [-1.9, 1.9]) b.add(mesh(cy(0.13, 0.14, 1.2, 8, 1, 1), dark, { p: [x, yAt(x) - 0.75, sz * (hw - 0.22)] }));
  }
  for (const x of [-1.9, 1.9]) b.add(rod([x, yAt(x) - 0.5, -hw + 0.2], [x, yAt(x) - 0.5, hw - 0.2], 0.08, dark));
  // 栏杆
  const posts = 9;
  for (const sz of [-1, 1]) {
    const z = sz * (hw - 0.08);
    let prev: V3 | null = null;
    for (let i = 0; i < posts; i++) {
      const x = -L + 0.12 + (i * (2 * L - 0.24)) / (posts - 1);
      const end = i === 0 || i === posts - 1;
      const y0 = yAt(x) + 0.05, h = end ? 1.12 : 0.92;
      b.add(mesh(bx(0.13, h, 0.13), red, { p: [x, y0 + h / 2, z] }));
      b.add(mesh(lathe([[0.09, 0], [0.1, 0.05], [0.05, 0.1], [0.08, 0.17], [0.01, 0.24]], 8), end ? M.flat('#c9a44a') : red, { p: [x, y0 + h, z] }));
      const cur: V3 = [x, y0, z];
      if (prev) {
        for (const yy of [0.82, 0.45]) b.add(rod([prev[0], prev[1] + yy, z], [x, y0 + yy, z], yy > 0.6 ? 0.045 : 0.032, red));
        const mx = (prev[0] + x) / 2, my = (prev[1] + y0) / 2;
        b.add(mesh(bx(0.5, 0.26, 0.03, 1, 'x'), M.woodFine('#a4513a'), { p: [mx, my + 0.63, z], r: [0, 0, slope(mx)] }));
      }
      prev = cur;
    }
  }
  // 两端石踏
  for (const sx of [-1, 1]) b.add(mesh(bx(0.7, 0.1, hw * 2 + 0.3, 1.6), M.stone('#9a968d'), { p: [sx * (L + 0.3), 0.05, 0] }));
  b.info.deck = { x0: -L, x1: L, z0: -1.3, z1: 1.3, rise };
  b.solid(-L - 0.6, -hw - 0.1, L + 0.6, -hw + 0.2);
  b.solid(-L - 0.6, hw - 0.2, L + 0.6, hw + 0.1);
  return b;
}

// ---------------------------------------------------------------- 兵器架
export function weaponRack(): Build {
  const b = new Build('weapon_rack', 'prop');
  const wm = M.woodFine(WOOD_DARK), steel = M.metal('#c9d0d6'), gold = M.flat('#b8923e');
  for (const s of [-1, 1]) {
    b.add(mesh(bx(0.09, 1.7, 0.09), wm, { p: [s * 0.9, 0.85, 0] }));
    b.add(mesh(bx(0.14, 0.1, 0.7, 1, 'z'), wm, { p: [s * 0.9, 0.05, 0] }));
    b.add(mesh(lathe([[0.07, 0], [0.08, 0.04], [0.03, 0.1], [0.06, 0.16], [0.01, 0.22]], 8), wm, { p: [s * 0.9, 1.7, 0] }));
  }
  for (const y of [0.45, 1.5]) b.add(mesh(bx(1.9, 0.08, 0.08, 1, 'x'), wm, { p: [0, y, 0] }));
  // 两杆长枪、一把大刀、两柄剑、一根棍
  for (const x of [-0.65, -0.4]) {
    b.add(rod([x, 0.05, 0.12], [x, 2.25, 0.06], 0.018, M.woodFine('#5a3a22')));
    b.add(mesh(cyl(0, 0.035, 0.26, 4), steel, { p: [x, 2.38, 0.058], s: [1, 1, 0.35] }));
    b.add(mesh(lathe([[0.05, -0.08], [0.03, -0.03], [0.012, 0]], 8), mat('#c0261d', { double: true }), { p: [x, 2.22, 0.06] }));
  }
  b.add(rod([-0.1, 0.05, 0.12], [-0.1, 1.5, 0.07], 0.02, M.woodFine('#5a3a22')));
  const blade = new THREE.Shape();
  blade.moveTo(-0.02, 0); blade.lineTo(0.03, 0); blade.quadraticCurveTo(0.14, 0.4, 0.05, 0.75); blade.quadraticCurveTo(0, 0.6, -0.02, 0); blade.closePath();
  b.add(mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false }), steel, { p: [-0.1, 1.5, 0.064] }));
  for (const x of [0.2, 0.45]) {
    b.add(mesh(bx(0.045, 0.85, 0.012), steel, { p: [x, 0.95, 0.08] }));
    b.add(mesh(bx(0.16, 0.03, 0.03), gold, { p: [x, 1.39, 0.08] }));
    b.add(mesh(cyl(0.016, 0.016, 0.2, 6), M.woodFine('#3b2a20'), { p: [x, 1.5, 0.08] }));
    b.add(mesh(cyl(0.004, 0.02, 0.1, 4), steel, { p: [x, 0.49, 0.08], r: [180, 0, 0], s: [1, 1, 0.4] }));
  }
  b.add(rod([0.7, 0.05, 0.12], [0.7, 1.95, 0.06], 0.022, M.woodFine('#8a6a48')));
  b.solid(-0.98, -0.3, 0.98, 0.3);
  return b;
}

export function bench(): Build {
  const b = new Build('bench', 'prop');
  const wm = M.woodFine('#6b4f36');
  b.add(mesh(bx(1.5, 0.06, 0.32, 1, 'x'), M.wood('#8a6a48'), { p: [0, 0.46, 0] }));
  for (const s of [-1, 1]) {
    for (const sz of [-1, 1]) b.add(rod([s * 0.58, 0.44, sz * 0.1], [s * 0.64, 0, sz * 0.17], 0.03, wm));
    b.add(rod([s * 0.6, 0.2, -0.13], [s * 0.6, 0.2, 0.13], 0.02, wm));
  }
  b.solid(-0.75, -0.18, 0.75, 0.18);
  return b;
}

export function table(): Build {
  const b = new Build('table', 'prop');
  const wm = M.woodFine('#5c4030');
  b.add(mesh(bx(0.98, 0.06, 0.98, 1, 'x'), M.wood('#7d5a3c'), { p: [0, 0.77, 0] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(mesh(bx(0.07, 0.74, 0.07), wm, { p: [sx * 0.42, 0.37, sz * 0.42] }));
  for (const s of [-1, 1]) {
    b.add(mesh(bx(0.84, 0.06, 0.04, 1, 'x'), wm, { p: [0, 0.66, s * 0.42] }));
    b.add(mesh(bx(0.04, 0.06, 0.84, 1, 'z'), wm, { p: [s * 0.42, 0.66, 0] }));
  }
  // 茶壶、茶杯、小碟
  const cer = mat('#d9d4c4'), blue = mat('#3f5f8a');
  b.add(mesh(lathe([[0.06, 0], [0.1, 0.05], [0.1, 0.11], [0.05, 0.15], [0.03, 0.17], [0.01, 0.2]], 12), cer, { p: [0.05, 0.8, -0.05] }));
  b.add(rod([0.14, 0.87, -0.05], [0.24, 0.94, -0.05], 0.014, cer, 5));
  b.add(mesh(new THREE.TorusGeometry(0.045, 0.012, 4, 10, Math.PI), blue, { p: [-0.05, 0.9, -0.05], r: [0, 0, 90] }));
  for (const [x, z] of [[-0.22, 0.2], [0.25, 0.22], [-0.2, -0.28]]) b.add(mesh(lathe([[0.025, 0], [0.04, 0.05], [0.032, 0.05], [0.02, 0.01]], 8), cer, { p: [x, 0.8, z] }));
  b.add(mesh(cyl(0.09, 0.06, 0.02, 10), blue, { p: [0.3, 0.81, -0.28] }));
  for (let i = 0; i < 4; i++) b.add(mesh(ellipsoid(0.025, 0.018, 0.025, 6, 4), mat('#c9a24a'), { p: [0.28 + (i % 2) * 0.04, 0.83, -0.3 + Math.floor(i / 2) * 0.04] }));
  // 方凳
  const stool = (x: number, z: number, ry: number) => {
    const g = new THREE.Group();
    g.add(mesh(bx(0.36, 0.05, 0.36, 1, 'x'), M.wood('#86623f'), { p: [0, 0.45, 0] }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(bx(0.045, 0.43, 0.045), wm, { p: [sx * 0.14, 0.215, sz * 0.14] }));
    b.add(place(g, [x, 0, z], [0, ry, 0]));
  };
  stool(-0.88, 0.05, 8); stool(0.9, -0.05, -6); stool(0.05, 0.9, 3);
  b.solid(-0.55, -0.55, 0.55, 0.55);
  return b;
}

export function flagA(): Build {
  const b = new Build('flag_a', 'prop');
  const wm = M.woodFine('#4a3828');
  b.add(mesh(cy(0.05, 0.07, 4.4, 8, 1.2, 1), wm, { p: [0, 2.2, 0] }));
  b.add(mesh(cyl(0.0, 0.06, 0.22, 6), M.metal('#6a6d72'), { p: [0, 4.5, 0] }));
  const r = rng(71);
  for (let i = 0; i < 6; i++) b.add(mesh(ellipsoid(0.14 + r() * 0.05, 0.1, 0.13 + r() * 0.05, 6, 4), M.rubble('#807d74'), { p: [Math.cos(i * 1.05) * 0.2, 0.07, Math.sin(i * 1.05) * 0.2] }));
  b.add(rod([-0.08, 4.1, 0], [1.12, 4.1, 0], 0.03, wm));
  // 旗面：略带飘动的布面
  const tex = T.banner('黑风', '#641a16', '#120d0b', 128, 256);
  const sheet = canvasSheet((u, v) => {
    const wave = Math.sin(v * 5 + u * 2) * 0.05 * v;
    return [0.1 + 0.95 * u, 4.06 - 1.9 * v - (u > 0.5 ? (u - 0.5) * 0.25 * v : 0), 0.02 + wave];
  }, 8, 12, texMat(tex, { double: true }));
  // canvasSheet 的 UV 是平铺用的 0..2，这里改成 0..1 并翻转 V
  const uv = (sheet.geometry as THREE.BufferGeometry).attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, 1 - uv.getY(i) / 2);
  b.add(sheet);
  // 破口下摆
  for (let i = 0; i < 3; i++) {
    const tri = new THREE.BufferGeometry();
    const x0 = 0.12 + i * 0.31;
    tri.setAttribute('position', new THREE.Float32BufferAttribute([x0, 2.2, 0.03, x0 + 0.28, 2.16, 0.05, x0 + 0.1 + r() * 0.1, 1.85 - r() * 0.15, 0.06], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    tri.computeVertexNormals();
    b.add(new THREE.Mesh(tri, M.cloth('#641a16')));
  }
  b.solid(-0.2, -0.2, 0.2, 0.2);
  return b;
}

// ---------------------------------------------------------------- 乌篷船与栈桥
export function boat(): Build {
  const b = new Build('boat', 'prop');
  const halfL = 1.95;
  const hull = canvasSheet((u, v) => {
    const s = u * 2 - 1, a = Math.abs(s);
    const W = 0.62 * Math.pow(1 - Math.pow(a, 2.6), 0.6) + 0.02;
    const gy = 0.4 + 0.26 * Math.pow(a, 2.4);
    const D = 0.4 * (1 - 0.45 * Math.pow(a, 3));
    const th = v * Math.PI;
    return [s * halfL, gy - D * Math.pow(Math.sin(th), 0.75), W * Math.cos(th)];
  }, 28, 14, M.wood('#6f5136', true));
  b.add(hull);
  // 船舷压条
  for (const sz of [-1, 1]) {
    let prev: V3 | null = null;
    for (let i = 0; i <= 20; i++) {
      const s = (i / 20) * 2 - 1, a = Math.abs(s);
      const W = 0.62 * Math.pow(1 - Math.pow(a, 2.6), 0.6) + 0.02;
      const p: V3 = [s * halfL, 0.41 + 0.26 * Math.pow(a, 2.4), sz * W];
      if (prev) b.add(rod(prev, p, 0.03, M.woodFine('#4a3626'), 5));
      prev = p;
    }
  }
  // 舱板与横板
  b.add(mesh(bx(2.9, 0.04, 0.84, 1, 'x'), M.wood('#8a6a48'), { p: [0, 0.14, 0] }));
  for (const x of [-1.25, 1.2]) b.add(mesh(bx(0.22, 0.04, 1.0, 1, 'z'), M.wood('#7d5f40'), { p: [x, 0.36, 0] }));
  // 乌篷
  const awn = canvasSheet((u, v) => {
    const th = v * Math.PI;
    return [-0.75 + 1.5 * u, 0.36 + 0.62 * Math.sin(th), 0.6 * Math.cos(th)];
  }, 6, 12, M.thatch('#4a443a'));
  b.add(awn);
  for (const x of [-0.75, -0.25, 0.25, 0.75]) {
    let prev: V3 | null = null;
    for (let i = 0; i <= 10; i++) {
      const th = (i / 10) * Math.PI;
      const p: V3 = [x, 0.37 + 0.63 * Math.sin(th), 0.61 * Math.cos(th)];
      if (prev) b.add(rod(prev, p, 0.022, M.woodFine('#2e2620'), 5));
      prev = p;
    }
  }
  // 橹与缆绳
  b.add(rod([1.1, 0.5, 0.3], [2.6, 0.2, 0.75], 0.025, M.woodFine('#7a5c40')));
  b.add(mesh(bx(0.5, 0.02, 0.12, 1, 'x'), M.woodFine('#7a5c40'), { p: [2.72, 0.17, 0.79], r: [0, -17, -11] }));
  b.add(mesh(new THREE.TorusGeometry(0.12, 0.025, 5, 12), M.flat('#b8a47c'), { p: [-1.45, 0.4, 0.0], r: [90, 0, 0] }));
  b.add(mesh(lathe([[0.14, 0], [0.1, 0.1], [0.01, 0.2]], 12), M.thatch('#c2a468'), { p: [1.45, 0.4, -0.1] }));
  b.solid(-1.95, -0.62, 1.95, 0.62);
  return b;
}

export function pier(): Build {
  const b = new Build('pier', 'prop');
  const plank = M.wood('#8c6c4a'), dark = M.woodFine('#5a3f2c');
  const r = rng(83);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const z = -2 + ((i + 0.5) * 4) / n;
    b.add(mesh(bx(1.6 + (r() - 0.5) * 0.08, 0.06, 4 / n - 0.012, 0.9, 'x'), i % 5 === 2 ? M.wood('#7d5f40') : plank, { p: [(r() - 0.5) * 0.03, 0.19, z] }));
  }
  for (const sx of [-1, 1]) {
    b.add(mesh(bx(0.12, 0.14, 4.0, 1, 'z'), dark, { p: [sx * 0.72, 0.09, 0] }));
    for (const z of [-1.9, -0.6, 0.7, 1.9]) {
      const h = 0.75 + r() * 0.25;
      b.add(mesh(cy(0.085, 0.095, h + 0.3, 8, 1, 1), dark, { p: [sx * 0.86, (h - 0.3) / 2, z] }));
    }
  }
  // 系缆桩、缆绳、鱼篓
  b.add(mesh(new THREE.TorusGeometry(0.11, 0.022, 5, 12), M.flat('#b8a47c'), { p: [0.86, 0.5, 1.9], r: [90, 0, 0] }));
  b.add(mesh(new THREE.TorusGeometry(0.16, 0.03, 5, 14), M.flat('#b8a47c'), { p: [-0.4, 0.25, 1.4], r: [90, 0, 0] }));
  b.add(place(basket(0.2, 0.26, '#8f9aa0'), [0.35, 0.22, 0.9]));
  b.add(rod([-0.86, 0.9, -0.6], [-0.55, 2.3, -0.2], 0.014, M.woodFine('#a39058'), 5));
  b.info.walk = [-0.8, -2, 0.8, 2];
  return b;
}

export function woodpile(): Build {
  const b = new Build('woodpile', 'prop');
  const r = rng(91);
  const rows = [6, 5, 4];
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const rad = 0.105 + r() * 0.02;
      const g = new THREE.Group();
      const tone = ['#7a5c40', '#6b5038', '#8a6a48'][Math.floor(r() * 3)];
      g.add(mesh(cy(rad, rad, 0.95, 9, 1, 1), M.woodFine(tone), { r: [90, 0, 0] }));
      g.add(mesh(cyl(rad * 0.96, rad * 0.96, 0.02, 9), mat('#c9aa78'), { p: [0, 0, 0.475], r: [90, 0, 0] }));
      g.add(mesh(cyl(rad * 0.5, rad * 0.5, 0.022, 9), mat('#a98a5c'), { p: [0, 0, 0.476], r: [90, 0, 0] }));
      b.add(place(g, [(i - (n - 1) / 2) * 0.235, 0.115 + row * 0.2, (r() - 0.5) * 0.06]));
    }
  });
  for (const s of [-1, 1]) b.add(mesh(cy(0.04, 0.05, 0.85, 6, 1, 1), M.woodFine('#5a4433'), { p: [s * 0.77, 0.42, 0.2] }));
  // 砧木与斧
  b.add(mesh(cy(0.24, 0.27, 0.4, 12, 0.8, 2), M.woodFine('#6a4c34'), { p: [1.25, 0.2, 0.25] }));
  b.add(mesh(cyl(0.22, 0.22, 0.01, 12), mat('#c9aa78'), { p: [1.25, 0.405, 0.25] }));
  b.add(rod([1.2, 0.42, 0.22], [1.55, 0.95, 0.3], 0.02, M.woodFine('#8a6a48')));
  b.add(mesh(bx(0.16, 0.12, 0.03, 1), M.metal('#5a5d62'), { p: [1.22, 0.46, 0.225], r: [0, 0, 35] }));
  b.solid(-0.85, -0.5, 1.5, 0.55);
  return b;
}

export function pot(): Build {
  const b = new Build('pot', 'prop');
  const g = lathe([[0.26, 0], [0.4, 0.2], [0.46, 0.48], [0.44, 0.72], [0.38, 0.86], [0.42, 0.9], [0.42, 0.94], [0.34, 0.92], [0.36, 0.7], [0.3, 0.3]], 18);
  b.add(mesh(g, M.clay('#6b4a36')));
  b.add(mesh(cyl(0.35, 0.35, 0.02, 18), mat('#1c2e33', { kind: 'flat' }), { p: [0, 0.74, 0] }));
  b.add(mesh(new THREE.TorusGeometry(0.455, 0.02, 5, 20), M.clay('#4a3226'), { p: [0, 0.5, 0], r: [90, 0, 0] }));
  // 半掩的木盖与水瓢
  b.add(mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.035, 18, 1, false, 0, Math.PI), M.wood('#8a6a48'), { p: [0, 0.96, 0], r: [0, 200, 0] }));
  b.add(mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#c9a24a', { double: true }), { p: [0.2, 1.05, 0.18] }));
  b.add(rod([0.2, 1.02, 0.18], [0.5, 1.1, 0.34], 0.014, M.woodFine('#8a6a48'), 5));
  b.solid(-0.46, -0.46, 0.46, 0.46);
  return b;
}
