import * as THREE from 'three';

export type Col = number | string;
export const DEG = Math.PI / 180;

// ---------- 随机与噪声 ----------
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** 可平铺的值噪声（period 为整数周期） */
export function vnoise(x: number, y: number, period: number, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, period: number, oct = 4, seed = 1) {
  let s = 0, amp = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * f, y * f, period * f, seed + i * 17) * amp;
    tot += amp; amp *= 0.5; f *= 2;
  }
  return s / tot;
}

// ---------- 程序纹理 ----------
const texCache = new Map<string, THREE.CanvasTexture>();

export function canvasTex(
  key: string, size: number,
  fn: (u: number, v: number) => [number, number, number],
  srgb = true,
): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn((x + 0.5) / size, (y + 0.5) / size);
      const o = (y * size + x) * 4;
      img.data[o] = r * 255; img.data[o + 1] = g * 255; img.data[o + 2] = b * 255; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** 灰度变化贴图：与材质颜色相乘，打破纯色的塑料感 */
export function variationTex(kind: 'cloth' | 'skin' | 'leather' | 'metal' | 'hair' | 'fur' | 'straw' = 'cloth') {
  return canvasTex('var_' + kind, 128, (u, v) => {
    let g = 1;
    if (kind === 'cloth') {
      const weave = 0.5 + 0.5 * Math.sin(u * 128 * Math.PI) * Math.sin(v * 128 * Math.PI);
      g = 0.9 + 0.1 * fbm(u * 8, v * 8, 8, 3, 3) + 0.035 * weave;
    } else if (kind === 'leather') {
      g = 0.82 + 0.2 * fbm(u * 12, v * 12, 12, 4, 5);
    } else if (kind === 'metal') {
      g = 0.9 + 0.12 * fbm(u * 4, v * 40, 4, 3, 7);
    } else if (kind === 'hair' || kind === 'fur') {
      g = 0.78 + 0.3 * fbm(u * 48, v * 5, 48, 3, 9);
    } else if (kind === 'straw') {
      g = 0.8 + 0.25 * fbm(u * 60, v * 4, 60, 3, 11);
    } else {
      g = 0.95 + 0.06 * fbm(u * 6, v * 6, 6, 3, 13);
    }
    return [g, g, g];
  });
}

// ---------- CC0 写实贴图（颜色 / 法线 / 粗糙度，见 public/assets/tex/CREDITS.md） ----------
/** 各套贴图的平均颜色（线性空间）：用来把贴图「归一」，再乘上模型想要的色调 */
const PBR_AVG: Record<string, [number, number, number]> = {
  bark: [0.237, 0.185, 0.143], brick: [0.149, 0.132, 0.125], leather: [0.083, 0.027, 0.005], linen: [0.264, 0.189, 0.1],
  pinebark: [0.136, 0.087, 0.052], planks: [0.087, 0.069, 0.05], plaster: [0.409, 0.365, 0.351], rock: [0.295, 0.266, 0.228],
  rooftile: [0.059, 0.066, 0.075], steel: [0.093, 0.095, 0.089], stonewall: [0.205, 0.189, 0.162], thatch: [0.09, 0.081, 0.067], wood: [0.055, 0.03, 0.015],
};
export interface PbrSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; }
const pbrBase = new Map<string, PbrSet>();
const pbrSets = new Map<string, PbrSet>();

/** 预先加载一批贴图。要在建模之前调用：材质创建时贴图必须已经在手 */
export async function loadPbr(names: string[] = Object.keys(PBR_AVG)) {
  const loader = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL + 'assets/tex/';
  await Promise.all(names.map(async (name) => {
    if (pbrBase.has(name)) return;
    const [map, normalMap, roughnessMap] = await Promise.all(['color', 'normal', 'rough'].map((k) => loader.loadAsync(`${base}${name}.${k}.webp`)));
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normalMap, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    pbrBase.set(name, { map, normalMap, roughnessMap });
  }));
}

/** 取一套贴图；repeat 为每个 UV 单位里平铺的次数 */
export function pbr(name: string, repeat = 1): PbrSet | null {
  const b = pbrBase.get(name);
  if (!b) return null;
  const key = name + '|' + repeat;
  let s = pbrSets.get(key);
  if (!s) {
    const mk = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = true; return c; };
    pbrSets.set(key, (s = { map: mk(b.map), normalMap: mk(b.normalMap), roughnessMap: mk(b.roughnessMap) }));
  }
  return s;
}

/** 让贴图的平均色落在 color 上所需的材质颜色（保留贴图自身的明暗与色差变化） */
export function pbrTint(name: string, color: Col, gain = 1): THREE.Color {
  const c = new THREE.Color(color as any), a = PBR_AVG[name] ?? [0.2, 0.2, 0.2];
  return c.setRGB(Math.min(4, (c.r / a[0]) * gain), Math.min(4, (c.g / a[1]) * gain), Math.min(4, (c.b / a[2]) * gain));
}

// ---------- 材质 ----------
const matCache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOpts {
  kind?: 'cloth' | 'skin' | 'leather' | 'metal' | 'hair' | 'fur' | 'straw' | 'flat';
  double?: boolean;
  flat?: boolean;
  emissive?: Col;
  map?: THREE.Texture;
  bump?: THREE.Texture;
  bumpScale?: number;
  repeat?: number;
  /** 光泽度 0..1，换算成粗糙度；缺省按材质类别给 */
  gloss?: number;
  /** 改用一套 CC0 写实贴图（见 pbr()）；此时 color 是希望呈现的平均色调 */
  pbr?: string;
  pbrRepeat?: number;
}

const GLOSS: Record<string, number> = { cloth: 0.1, skin: 0.22, leather: 0.32, metal: 0.9, hair: 0.55, fur: 0.06, straw: 0.04, flat: 0.08 };

/** 带自发光的材质（灯笼、窗纸）：渲染器按夜色调节 emissiveIntensity */
export const EMISSIVE_MATS = new Set<THREE.MeshStandardMaterial>();
export function markEmissive(m: THREE.MeshStandardMaterial, color: Col, map: THREE.Texture | null = null) {
  m.emissive = new THREE.Color(color as any);
  m.emissiveMap = map;
  m.emissiveIntensity = 0;
  m.userData.emissive = color;
  EMISSIVE_MATS.add(m);
}

/** 光泽度 → 粗糙度 */
export const glossToRough = (g: number) => Math.min(1, Math.max(0.18, 1 - g * 0.82));

export function mat(color: Col, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = [color, o.kind, o.double, o.flat, o.emissive, o.map?.uuid, o.bump?.uuid, o.bumpScale, o.repeat, o.gloss, o.pbr, o.pbrRepeat].join('|');
  let m = matCache.get(key);
  if (!m) {
    const set = o.pbr ? pbr(o.pbr, o.pbrRepeat ?? 1) : null;
    const gloss = o.gloss ?? GLOSS[o.kind ?? 'cloth'] ?? 0.1;
    if (set) {
      m = new THREE.MeshStandardMaterial({
        color: pbrTint(o.pbr!, color), map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0,
        side: o.double ? THREE.DoubleSide : THREE.FrontSide,
      });
    } else {
      const map = o.map ?? (o.kind === 'flat' ? null : variationTex((o.kind as any) ?? 'cloth'));
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color as any),
        map,
        side: o.double ? THREE.DoubleSide : THREE.FrontSide,
        flatShading: !!o.flat,
        bumpMap: o.bump ?? null,
        bumpScale: o.bumpScale ?? 1,
        roughness: glossToRough(gloss),
        metalness: o.kind === 'metal' ? 0.9 : 0,
      });
    }
    if (o.emissive !== undefined) markEmissive(m, o.emissive);
    m.userData.gloss = gloss;
    m.userData.kind = o.kind ?? 'cloth';
    matCache.set(key, m);
  }
  return m;
}

// ---------- 几何 ----------
/** 沿 −Y 方向的锥形肢体（两端半球），原点在上端球心 */
export function limb(rTop: number, rBot: number, len: number, segs = 14): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI / 2) * (1 - i / n);
    pts.push(new THREE.Vector2(Math.max(1e-4, rTop * Math.cos(a)), rTop * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI / 2) * (i / n);
    pts.push(new THREE.Vector2(Math.max(1e-4, rBot * Math.cos(a)), -len - rBot * Math.sin(a)));
  }
  pts.reverse();
  return new THREE.LatheGeometry(pts, segs);
}

/** 旋转体，profile 为 [半径, 高度] 列表（自下而上） */
export function lathe(profile: [number, number][], segs = 20, phiStart = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), segs, phiStart, phiLen);
}

export function ellipsoid(rx: number, ry: number, rz: number, ws = 18, hs = 12): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function cyl(rTop: number, rBot: number, h: number, segs = 14, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, open);
}

export function tube(points: [number, number, number][], radius: number, segs = 6, tubular = 24): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, tubular, radius, segs, false);
}

export interface Xf {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number] | number;
}

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, xf: Xf = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  if (xf.p) m.position.set(...xf.p);
  if (xf.r) m.rotation.set(xf.r[0] * DEG, xf.r[1] * DEG, xf.r[2] * DEG);
  if (xf.s !== undefined) typeof xf.s === 'number' ? m.scale.setScalar(xf.s) : m.scale.set(...xf.s);
  return m;
}

export function group(xf: Xf = {}, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (xf.p) g.position.set(...xf.p);
  if (xf.r) g.rotation.set(xf.r[0] * DEG, xf.r[1] * DEG, xf.r[2] * DEG);
  if (xf.s !== undefined) typeof xf.s === 'number' ? g.scale.setScalar(xf.s) : g.scale.set(...xf.s);
  for (const c of children) g.add(c);
  return g;
}

/** 颜色明度微调 */
export function shade(color: Col, k: number): string {
  const c = new THREE.Color(color as any);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * k)));
  return '#' + c.getHexString();
}
