import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EMISSIVE_MATS } from '../models/geo';
import type { Renderer } from './renderer';

/** 一种物件压平后的一块：同材质的所有网格合并成一个几何体 */
interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean; }
interface Kind { parts: Part[]; flipped: Part[] | null; cast: boolean; }

export interface Placement { key: string; x: number; z: number; s: number; flip: boolean; yaw: number; }

const CHUNK = 24;

/** 把物件模型的所有网格烘成世界空间下、按材质合并的几何体 */
function flatten(root: THREE.Object3D, cast: boolean): Part[] {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  const push = (mesh: THREE.Mesh, matrix: THREE.Matrix4) => {
    const src = mesh.geometry;
    if (!src.getAttribute('position')) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const g = new THREE.BufferGeometry();
    const n = src.getAttribute('position').count;
    g.setAttribute('position', src.getAttribute('position').clone());
    g.setAttribute('normal', src.getAttribute('normal') ? src.getAttribute('normal').clone() : new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', src.getAttribute('uv') ? src.getAttribute('uv').clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const col = src.getAttribute('color');
    const c = new Float32Array(n * 3).fill(1);
    if (col) for (let i = 0; i < n; i++) { c[i * 3] = col.getX(i); c[i * 3 + 1] = col.getY(i); c[i * 3 + 2] = col.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    let index: number[];
    if (src.index) index = Array.from(src.index.array as ArrayLike<number>);
    else { index = new Array(n); for (let i = 0; i < n; i++) index[i] = i; }
    // 镜像过的部件（负缩放）：翻转绕序，保持面朝外
    if (matrix.determinant() < 0) for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
    g.applyMatrix4(matrix);
    const noShadow = !!mesh.userData.noShadow;
    const add = (m: THREE.Material, idx: number[]) => {
      const key = m.uuid + (noShadow ? ':n' : '');
      let e = groups.get(key);
      if (!e) groups.set(key, (e = { mat: m, cast: cast && !noShadow, geos: [] }));
      const gg = g.clone();
      gg.setIndex(idx);
      e.geos.push(gg);
    };
    if (mats.length > 1 && src.groups.length) for (const gr of src.groups) add(mats[gr.materialIndex ?? 0], index.slice(gr.start, gr.start + gr.count));
    else add(mats[0], index);
  };
  const m4 = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); push(mesh, new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, m4)); }
    } else push(mesh, mesh.matrixWorld);
  });
  const out: Part[] = [];
  for (const e of groups.values()) {
    const geo = mergeGeometries(e.geos, false);
    if (!geo) continue;
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    out.push({ geo, mat: e.mat, cast: e.cast });
  }
  return out;
}

/** 沿 X 镜像的副本（地图里的 f 标记） */
function mirror(parts: Part[]): Part[] {
  return parts.map((p) => {
    const geo = p.geo.clone();
    geo.scale(-1, 1, 1);
    const idx = geo.index?.array as Uint32Array | Uint16Array | undefined;
    if (idx) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return { geo, mat: p.mat, cast: p.cast };
  });
}

/** 只在阴影贴图里出现的代理网格用的材质：主画面里不写颜色也不写深度 */
const PROXY_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });

/**
 * 给实时渲染瘦身的树冠。
 * 建模代码是为离线渲染写的，一棵树有两万片叶子、二三十万个三角形。这里按「连通块 = 一片叶子」拆开，
 * 每 keep 片留一片并放大（树冠的遮盖率大致不变），另外再生成一份每片叶子只有一个三角形的阴影代理。
 */
function thinLeaves(geo: THREE.BufferGeometry, keep: number, scale: number, proxyEvery: number): { visual: THREE.BufferGeometry; proxy: THREE.BufferGeometry } {
  const idx = geo.index!.array as ArrayLike<number>;
  const P = geo.getAttribute('position').array as Float32Array, N = geo.getAttribute('normal').array as Float32Array;
  const U = geo.getAttribute('uv').array as Float32Array, C = geo.getAttribute('color').array as Float32Array;
  const nv = P.length / 3;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < idx.length; i += 3) {
    const a = find(idx[i]), b = find(idx[i + 1]), c = find(idx[i + 2]);
    if (b !== a) parent[b] = a;
    if (c !== a) parent[c] = a;
  }
  // 连通块编号（按出现顺序），以及各块的质心
  const comp = new Int32Array(nv).fill(-1);
  const rootId = new Map<number, number>();
  const cen: number[] = [], cnt: number[] = [];
  for (let v = 0; v < nv; v++) {
    const r = find(v);
    let id = rootId.get(r);
    if (id === undefined) { id = cen.length / 3; rootId.set(r, id); cen.push(0, 0, 0); cnt.push(0); }
    comp[v] = id;
    cen[id * 3] += P[v * 3]; cen[id * 3 + 1] += P[v * 3 + 1]; cen[id * 3 + 2] += P[v * 3 + 2]; cnt[id]++;
  }
  const nc = cnt.length;
  for (let i = 0; i < nc; i++) { cen[i * 3] /= cnt[i]; cen[i * 3 + 1] /= cnt[i]; cen[i * 3 + 2] /= cnt[i]; }
  const kept = (id: number) => id % keep === 0;
  // 留下的顶点重新编号
  const remap = new Int32Array(nv).fill(-1);
  const p2: number[] = [], n2: number[] = [], u2: number[] = [], c2: number[] = [], i2: number[] = [];
  for (let v = 0; v < nv; v++) {
    const id = comp[v];
    if (!kept(id)) continue;
    remap[v] = p2.length / 3;
    for (let k = 0; k < 3; k++) p2.push(cen[id * 3 + k] + (P[v * 3 + k] - cen[id * 3 + k]) * scale);
    n2.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); u2.push(U[v * 2], U[v * 2 + 1]); c2.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
  }
  const area = new Float32Array(nc), nrm = new Float32Array(nc * 3);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2], id = comp[a];
    if (!kept(id)) continue;
    i2.push(remap[a], remap[b], remap[c]);
    const ax = P[b * 3] - P[a * 3], ay = P[b * 3 + 1] - P[a * 3 + 1], az = P[b * 3 + 2] - P[a * 3 + 2];
    const bx = P[c * 3] - P[a * 3], by = P[c * 3 + 1] - P[a * 3 + 1], bz = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const l = Math.hypot(cx, cy, cz);
    area[id] += l * 0.5;
    // 叶片可能是双面的（正反两套三角形），法线统一到朝上的一侧再累加
    const sgn = cy < 0 ? -1 : 1;
    nrm[id * 3] += cx * sgn; nrm[id * 3 + 1] += cy * sgn; nrm[id * 3 + 2] += cz * sgn;
  }
  const visual = new THREE.BufferGeometry();
  visual.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
  visual.setAttribute('normal', new THREE.Float32BufferAttribute(n2, 3));
  visual.setAttribute('uv', new THREE.Float32BufferAttribute(u2, 2));
  visual.setAttribute('color', new THREE.Float32BufferAttribute(c2, 3));
  visual.setIndex(i2);
  visual.computeBoundingSphere(); visual.computeBoundingBox();

  const pp: number[] = [];
  const n = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  for (let id = 0; id < nc; id += keep * proxyEvery) {
    n.set(nrm[id * 3], nrm[id * 3 + 1], nrm[id * 3 + 2]);
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    u.set(1, 0, 0); if (Math.abs(n.x) > 0.9) u.set(0, 0, 1);
    u.cross(n).normalize(); w.crossVectors(n, u);
    // 一个正三角形顶替这一撮叶子：面积按被它代表的叶片数放大
    const A = area[id] * scale * scale * proxyEvery * 0.8;
    const R = Math.sqrt(A / 1.299);
    const cx = cen[id * 3], cy = cen[id * 3 + 1], cz = cen[id * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + id;
      const ca = Math.cos(a) * R, sa = Math.sin(a) * R;
      pp.push(cx + u.x * ca + w.x * sa, cy + u.y * ca + w.y * sa, cz + u.z * ca + w.z * sa);
    }
  }
  const proxy = new THREE.BufferGeometry();
  proxy.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  proxy.computeBoundingSphere(); proxy.computeBoundingBox();
  return { visual, proxy };
}

const patched = new WeakSet<THREE.Material>();

/**
 * 给静态物件的材质打补丁：
 * - hole：镜头与主角之间的部分以抖动方式挖空，人走到树冠、屋檐后面时仍看得见
 * - sway：草叶与树冠随风摆动（幅度随离地高度增加）
 */
export function patchMaterial(m: THREE.Material, r: Renderer, o: { hole?: boolean; sway?: number }) {
  if (patched.has(m)) return;
  patched.add(m);
  const sway = o.sway ?? 0, hole = !!o.hole;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, gl) => {
    prev?.call(m, sh, gl);
    sh.uniforms.uTime = r.uniforms.uTime;
    sh.uniforms.uHoleA = r.uniforms.uHoleA;
    sh.uniforms.uHoleB = r.uniforms.uHoleB;
    sh.uniforms.uHoleR = r.uniforms.uHoleR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vHoleW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${sway > 0 ? `{
          #ifdef USE_INSTANCING
            vec3 swW = (instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vec3 swW = transformed;
          #endif
          float swH = sqrt(max(transformed.y, 0.0));
          float swP = dot(swW.xz, vec2(0.31, 0.23)) + uTime * 1.25;
          float swG = sin(swP) + 0.45 * sin(swP * 2.3 + 1.7);
          float swF = sin(dot(swW, vec3(7.1, 5.3, 6.7)) + uTime * 4.2) * 0.25;
          transformed.x += (swG + swF) * swH * ${sway.toFixed(4)};
          transformed.z += (swG * 0.6 - swF) * swH * ${(sway * 0.7).toFixed(4)};
        }` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 hw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            hw = instanceMatrix * hw;
          #endif
          vHoleW = (modelMatrix * hw).xyz; }`);
    if (hole) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHoleA, uHoleB;\nuniform float uHoleR;\nvarying vec3 vHoleW;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          { vec3 hab = uHoleB - uHoleA;
            float ht = dot(vHoleW - uHoleA, hab) / dot(hab, hab);
            if (ht > 0.0 && ht < 0.955) {
              float hd = length(vHoleW - (uHoleA + hab * ht));
              float hn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
              if (hd < uHoleR * (0.62 + 0.38 * hn)) discard;
            } }`);
    }
  };
  m.customProgramCacheKey = () => `st:${hole ? 1 : 0}:${sway}`;
  m.needsUpdate = true;
}

/** 静态场景：每种物件只建模一次，按地块分组做实例化渲染 */
export class Statics {
  group = new THREE.Group();
  private kinds = new Map<string, Kind>();
  constructor(private r: Renderer) {
    r.scene.add(this.group);
  }

  /** 登记一种物件的模型 */
  addKind(key: string, root: THREE.Object3D, info: Record<string, any>) {
    const kind = info.kind as string | undefined;
    // 花草不投影：数量太多，而且影子几乎看不出来
    const small = kind === 'plant' || kind === 'water';
    const parts = flatten(root, !small || !!info.solid);
    const proxies: Part[] = [];
    for (const p of parts) {
      const isLeaf = (p.mat as any).vertexColors && !(p.mat as any).map && !(p.mat as any).bumpMap;
      const tris = p.geo.index!.count / 3;
      if (isLeaf && tris > 12000 && (kind === 'tree' || kind === 'bush')) {
        const keep = tris > 100000 ? 4 : tris > 40000 ? 3 : 2;
        const t = thinLeaves(p.geo, keep, Math.sqrt(keep) * 0.76, Math.round(16 / keep));
        p.geo = t.visual; p.cast = false;
        proxies.push({ geo: t.proxy, mat: PROXY_MAT, cast: true });
      }
      p.mat = this.own(p.mat);
      patchMaterial(p.mat, this.r, { hole: true, sway: isLeaf ? 0.03 : 0 });
    }
    parts.push(...proxies);
    // 阴影贴图里不需要区分材质：所有投影的部件并成一个只含位置的代理网格，一种物件在阴影里只占一次绘制
    const casters = parts.filter((p) => p.cast);
    if (casters.length > 1 || (casters.length === 1 && casters[0].mat !== PROXY_MAT)) {
      const geos = casters.map((p) => {
        const g = new THREE.BufferGeometry();
        const src = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        g.setAttribute('position', src.getAttribute('position'));
        return g;
      });
      const merged = mergeGeometries(geos, false);
      if (merged) {
        merged.computeBoundingSphere(); merged.computeBoundingBox();
        for (const p of casters) p.cast = false;
        const rest = parts.filter((p) => p.mat !== PROXY_MAT);
        parts.length = 0;
        parts.push(...rest, { geo: merged, mat: PROXY_MAT, cast: true });
      }
    }
    this.kinds.set(key, { parts, flipped: null, cast: !small });
  }
  has(key: string) { return this.kinds.has(key); }

  private clones = new Map<string, THREE.Material>();
  /** 静态物件用材质的副本：补丁（挖空、摆动）不能波及与角色共用的材质 */
  private own(m: THREE.Material): THREE.Material {
    let c = this.clones.get(m.uuid);
    if (!c) {
      c = m.clone();
      if (EMISSIVE_MATS.has(m as any)) EMISSIVE_MATS.add(c as any);
      this.clones.set(m.uuid, c);
    }
    return c;
  }

  private partsOf(key: string, flip: boolean): Part[] | null {
    const k = this.kinds.get(key);
    if (!k) return null;
    if (!flip) return k.parts;
    return (k.flipped ??= mirror(k.parts));
  }

  /** 摆放整张地图的物件 */
  place(list: Placement[]) {
    const buckets = new Map<string, Placement[]>();
    for (const p of list) {
      if (!this.kinds.has(p.key)) continue;
      const id = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}|${p.key}|${p.flip ? 1 : 0}`;
      let b = buckets.get(id);
      if (!b) buckets.set(id, (b = []));
      b.push(p);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (const b of buckets.values()) {
      const parts = this.partsOf(b[0].key, b[0].flip)!;
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, b.length);
        b.forEach((p, i) => {
          q.setFromAxisAngle(up, p.yaw);
          m.compose(pos.set(p.x, 0, p.z), q, scl.setScalar(p.s));
          im.setMatrixAt(i, m);
        });
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = part.cast;
        im.receiveShadow = part.mat !== PROXY_MAT;
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false;
        this.group.add(im);
      }
    }
  }

  /** 单独一件、可以随时显隐的物件（采集点等） */
  single(key: string, x: number, z: number, s = 1): THREE.Group | null {
    const parts = this.partsOf(key, false);
    if (!parts) return null;
    const g = new THREE.Group();
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geo, p.mat);
      mesh.castShadow = p.cast; mesh.receiveShadow = p.mat !== PROXY_MAT;
      g.add(mesh);
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    this.group.add(g);
    return g;
  }
}
