import * as THREE from 'three';
import { DEG } from './geo';
import { Chain } from './humanoid';
import { Collider, Ring, SimPart, tubeGeo } from './skin';

// ============================================================
// 四足（及禽类）刚体骨架：躯干分前后两段，腿用解析 IK 踩在地面目标点上
// ============================================================

export interface Sec { z: number; w: number; up: number; dn: number; y?: number; }

/** 截面参数做 Catmull-Rom 细分，让躯干轮廓圆润 */
export function smooth(secs: Sec[], sub = 3): Sec[] {
  const out: Sec[] = [];
  const n = secs.length;
  const get = (i: number) => secs[Math.min(n - 1, Math.max(0, i))];
  const cr = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      out.push({
        z: p1.z + (p2.z - p1.z) * t,
        w: Math.max(0.002, cr(p0.w, p1.w, p2.w, p3.w, t)),
        up: Math.max(0.002, cr(p0.up, p1.up, p2.up, p3.up, t)),
        dn: Math.max(0.002, cr(p0.dn, p1.dn, p2.dn, p3.dn, t)),
        y: cr(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0, t),
      });
    }
  }
  out.push({ ...secs[n - 1] });
  return out;
}

/** 放样顶点的骨骼权重：z 为沿身长的位置，c 为截面角的余弦（1 = 背脊，−1 = 腹部） */
export type WFn = (z: number, c: number) => [number, number][];

/**
 * 沿 Z 放样的椭圆截面体。UV：u 绕身一周（0 = 背脊，0.5 = 腹部），v 沿身长。
 * 传入 wfn 时写出蒙皮权重（每顶点最多 4 根骨骼）。
 */
export function loft(secs: Sec[], radial = 18, wfn?: WFn): THREE.BufferGeometry {
  const n = secs.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], si: number[] = [], sw: number[] = [];
  const z0 = secs[0].z, z1 = secs[n - 1].z;
  for (let i = 0; i < n; i++) {
    const s = secs[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(s.w * sn, (s.y ?? 0) + (c >= 0 ? s.up : s.dn) * c, s.z);
      uv.push(j / radial, (s.z - z0) / (z1 - z0 || 1));
      if (wfn) {
        const w = wfn(s.z, c).filter((x) => x[1] > 1e-4).sort((p, q) => q[1] - p[1]).slice(0, 4);
        const tot = w.reduce((t, x) => t + x[1], 0) || 1;
        for (let k = 0; k < 4; k++) { si.push(w[k] ? w[k][0] : 0); sw.push(w[k] ? w[k][1] / tot : 0); }
      }
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (wfn) {
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  const nm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const a = i * (radial + 1), b = a + radial;
    const x = nm.getX(a) + nm.getX(b), y = nm.getY(a) + nm.getY(b), z = nm.getZ(a) + nm.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nm.setXYZ(a, x / l, y / l, z / l);
    nm.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/** 放样体表面上的一点：z 处、与背脊夹角 aDeg 的位置（side = ±1 选左右），lift 沿径向外推的比例 */
export function surfAt(secs: Sec[], z: number, aDeg: number, side = 1, lift = 0): [number, number, number] {
  let i = 0;
  while (i < secs.length - 2 && z > secs[i + 1].z) i++;
  const a = secs[i], b = secs[i + 1];
  const t = Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z || 1)));
  const lp = (p: number, q: number) => p + (q - p) * t;
  const c = Math.cos(aDeg * DEG), sn = Math.sin(aDeg * DEG), k = 1 + lift;
  return [side * lp(a.w, b.w) * sn * k, lp(a.y ?? 0, b.y ?? 0) + (c >= 0 ? lp(a.up, b.up) : lp(a.dn, b.dn)) * c * k, z];
}

/** 极轴沿 Z 的椭球（UV 约定同 loft） */
export function zSphere(rx: number, ry: number, rz: number, radial = 16, rings = 9): THREE.BufferGeometry {
  const secs: Sec[] = [];
  for (let k = 0; k <= rings; k++) {
    const th = (Math.PI * k) / rings;
    const r = Math.max(0.004, Math.sin(th));
    secs.push({ z: -rz * Math.cos(th), w: rx * r, up: ry * r, dn: ry * r });
  }
  return loft(secs, radial);
}

// ---------------- 姿势 ----------------
export interface QPose {
  /** 躯干相对站立位的位移 */
  pos: [number, number, number];
  /** 躯干旋转 [pitch(+低头), yaw, roll] */
  rot: [number, number, number];
  fore: [number, number, number];
  hind: [number, number, number];
  /** 颈 [相对静止抬起角的增量(+抬), yaw] */
  neck: [number, number];
  /** 头 [pitch 增量(+低), yaw, roll] */
  head: [number, number, number];
  jaw: number;
  /** 物种自定义（鸡：振翅；其它：耳朵） */
  aux: number;
  /** 四足落点相对静止落点的位移与爪俯仰 [dx, dy, dz, pitch] */
  fl: [number, number, number, number];
  fr: [number, number, number, number];
  hl: [number, number, number, number];
  hr: [number, number, number, number];
}

const KEYS: (keyof QPose)[] = ['pos', 'rot', 'fore', 'hind', 'neck', 'head', 'jaw', 'aux', 'fl', 'fr', 'hl', 'hr'];

export const qRest = (): QPose => ({
  pos: [0, 0, 0], rot: [0, 0, 0], fore: [0, 0, 0], hind: [0, 0, 0], neck: [0, 0], head: [0, 0, 0], jaw: 0, aux: 0,
  fl: [0, 0, 0, 0], fr: [0, 0, 0, 0], hl: [0, 0, 0, 0], hr: [0, 0, 0, 0],
});

export const qp = (o: Partial<QPose> = {}): QPose => ({ ...qRest(), ...JSON.parse(JSON.stringify(o)) });

function flat(p: QPose): number[] {
  const out: number[] = [];
  for (const k of KEYS) { const v = p[k]; if (typeof v === 'number') out.push(v); else out.push(...v); }
  return out;
}
function unflat(a: number[]): QPose {
  const p = qRest() as any;
  let i = 0;
  for (const k of KEYS) {
    if (typeof p[k] === 'number') p[k] = a[i++];
    else for (let j = 0; j < p[k].length; j++) p[k][j] = a[i++];
  }
  return p;
}

/** Hermite 关键帧轨道（loop 时约定首尾关键帧相同） */
export function qtrack(keys: [number, QPose][], loop = false): (t: number) => QPose {
  const ts = keys.map((k) => k[0]);
  const vs = keys.map((k) => flat(k[1]));
  const n = keys.length, dim = vs[0].length;
  const tan: number[][] = [];
  for (let i = 0; i < n; i++) {
    const m = new Array(dim).fill(0);
    let a = i - 1, b = i + 1, ta: number, tb: number;
    if (loop) {
      if (i === 0) a = n - 2;
      if (i === n - 1) b = 1;
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
    for (let d = 0; d < dim; d++) out[d] = h00 * vs[i][d] + h10 * h * tan[i][d] + h01 * vs[i + 1][d] + h11 * h * tan[i + 1][d];
    return unflat(out);
  };
}

// ---------------- 骨架 ----------------
export interface LegSpec {
  /** 关节在所属躯干段内的位置（左侧，x>0；右侧自动镜像） */
  joint: [number, number, number];
  l1: number;
  l2: number;
  /** 后腿的跖骨长度（与大腿平行的第三段），前腿为 0 */
  l3?: number;
  /** 腕/踝离地高度 */
  pawH: number;
  /** 静止落点（左侧）[x, z]，身体局部坐标 */
  foot: [number, number];
  /** +1 肘向后（前腿），−1 膝向前（后腿/禽类） */
  bend: 1 | -1;
  /** 关节可沿目标方向滑动的最大距离（模拟肩胛/髋的活动） */
  slide?: number;
  build: (parts: LegParts, side: number) => void;
}

export interface LegParts { upper: THREE.Bone; mid: THREE.Bone; low: THREE.Bone | null; paw: THREE.Bone; }

interface Leg extends LegParts {
  spec: LegSpec;
  side: number;
  section: THREE.Bone;
  base: THREE.Vector3;
  rest: THREE.Vector3;
}

export interface QuadSpec {
  scale?: number;
  /** 脊柱中点（前后段的转轴）离地高度 */
  spineY: number;
  front: LegSpec | null;
  hind: LegSpec;
  /** 颈部根部在前段内的位置与静止抬起角 */
  neckAt: [number, number, number];
  neckUp: number;
  neckLen: number;
  headPitch: number;
  /** 蒙皮权重的过渡范围（米）：脊柱中点两侧、颈根前后、头关节前后；neckLow 让腹侧的颈部过渡更靠前 */
  blend?: { spine?: number; neck0?: number; neck1?: number; neckLow?: number; head0?: number; head1?: number };
  build: (rig: QuadRig) => void;
}

const _m = new THREE.Matrix4();
function basisQuat(segDir: THREE.Vector3, xHint: THREE.Vector3): THREE.Quaternion {
  const y = segDir.clone().negate();
  const x = xHint.clone().addScaledVector(y, -xHint.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  _m.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

export class QuadRig {
  root = new THREE.Group();
  body = new THREE.Group();
  trunk = new THREE.Bone();
  fore = new THREE.Bone();
  hind = new THREE.Bone();
  neck = new THREE.Bone();
  head = new THREE.Bone();
  jaw = new THREE.Bone();
  holder = new THREE.Group();
  legs: { fl: Leg | null; fr: Leg | null; hl: Leg; hr: Leg };
  chains: Chain[] = [];
  /** 布料/尾巴等质点模拟部件 */
  sims: SimPart[] = [];
  /** 链的碰撞球：[所属节点, 局部位置, 半径] */
  chainCols: [THREE.Object3D, THREE.Vector3, number][] = [];
  /** 物种自定义的姿势后处理（如振翅、耳朵） */
  onPose: ((p: QPose) => void) | null = null;
  pose: QPose = qRest();
  /** 蒙皮骨骼表：下标即权重里的骨骼编号 */
  bones: THREE.Bone[] = [];
  skeleton: THREE.Skeleton | null = null;

  constructor(public spec: QuadSpec) {
    const s = spec.scale ?? 1;
    this.root.add(this.body);
    this.body.scale.setScalar(s);
    this.body.add(this.trunk, this.holder);
    this.trunk.rotation.order = 'YXZ';
    this.fore.rotation.order = 'YXZ';
    this.hind.rotation.order = 'YXZ';
    this.neck.rotation.order = 'YXZ';
    this.head.rotation.order = 'YXZ';
    // 零姿势即绑定姿势：躯干水平、颈与头顺着 +Z 平伸、四肢垂直向下
    this.trunk.position.set(0, spec.spineY, 0);
    this.trunk.add(this.fore, this.hind);
    this.neck.position.set(...spec.neckAt);
    this.fore.add(this.neck);
    this.head.position.set(0, 0, spec.neckLen);
    this.neck.add(this.head);
    this.head.add(this.jaw);
    this.bones.push(this.trunk, this.fore, this.hind, this.neck, this.head, this.jaw);
    const mk = (ls: LegSpec, section: THREE.Bone, side: number): Leg => {
      const upper = new THREE.Bone(), mid = new THREE.Bone(), paw = new THREE.Bone();
      const low = ls.l3 ? new THREE.Bone() : null;
      const base = new THREE.Vector3(ls.joint[0] * side, ls.joint[1], ls.joint[2]);
      upper.position.copy(base);
      mid.position.set(0, -ls.l1, 0);
      upper.add(mid);
      if (low) { low.position.set(0, -ls.l2, 0); mid.add(low); paw.position.set(0, -ls.l3!, 0); low.add(paw); }
      else { paw.position.set(0, -ls.l2, 0); mid.add(paw); }
      section.add(upper);
      this.bones.push(upper, mid, ...(low ? [low] : []), paw);
      const parts = { upper, mid, low, paw };
      ls.build(parts, side);
      return { ...parts, spec: ls, side, section, base, rest: new THREE.Vector3(ls.foot[0] * side, 0, ls.foot[1]) };
    };
    this.legs = {
      fl: spec.front ? mk(spec.front, this.fore, 1) : null,
      fr: spec.front ? mk(spec.front, this.fore, -1) : null,
      hl: mk(spec.hind, this.hind, 1),
      hr: mk(spec.hind, this.hind, -1),
    };
    spec.build(this);
    this.setPose(qRest());
    this.resetChains();
  }

  // ---- 蒙皮 ----
  /** 追加一根骨骼（如尾椎）；必须在第一次 skin() 之前调用 */
  addBone(parent: THREE.Object3D, pos: [number, number, number]): THREE.Bone {
    if (this.skeleton) throw new Error('addBone 必须在 skin() 之前调用');
    const b = new THREE.Bone();
    b.position.set(...pos);
    parent.add(b);
    this.bones.push(b);
    return b;
  }
  /** 骨骼在蒙皮权重里的编号 */
  bi(b: THREE.Object3D): number {
    const i = this.bones.indexOf(b as THREE.Bone);
    if (i < 0) throw new Error('不是已登记的骨骼');
    return i;
  }
  /** 把带蒙皮权重的几何体（body 空间、零姿势下建模）绑到骨架上 */
  skin(geo: THREE.BufferGeometry, material: THREE.Material): THREE.SkinnedMesh {
    if (!this.skeleton) {
      this.root.updateMatrixWorld(true);
      this.skeleton = new THREE.Skeleton(this.bones.slice());
    }
    const m = new THREE.SkinnedMesh(geo, material);
    m.frustumCulled = false;
    this.body.add(m);
    m.updateMatrixWorld(true);
    m.bind(this.skeleton, m.matrixWorld);
    return m;
  }
  /** 躯干—颈—头放样体的权重：按 z 在后躯 / 前躯 / 颈 / 头之间平滑过渡 */
  bodyW: WFn = (z, c) => {
    const sp = this.spec, b = sp.blend ?? {};
    const ss = (a: number, e: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (e - a))); return t * t * (3 - 2 * t); };
    const sb = b.spine ?? 0.1;
    const zn = sp.neckAt[2], zh = zn + sp.neckLen;
    const low = ((1 - c) / 2) * (b.neckLow ?? 0.07);
    const kN = ss(zn - (b.neck0 ?? 0.07) + low, zn + (b.neck1 ?? 0.1) + low * 0.6, z);
    const kH = ss(zh - (b.head0 ?? 0.05), zh + (b.head1 ?? 0.04), z);
    const kS = ss(-sb, sb, z);
    return [[2, 1 - kS], [1, kS * (1 - kN)], [3, kN * (1 - kH)], [4, kH]];
  };

  setPose(p: QPose) {
    this.pose = p;
    const sp = this.spec;
    this.trunk.position.set(p.pos[0], sp.spineY + p.pos[1], p.pos[2]);
    this.trunk.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
    this.fore.rotation.set(p.fore[0] * DEG, p.fore[1] * DEG, p.fore[2] * DEG);
    this.hind.rotation.set(p.hind[0] * DEG, p.hind[1] * DEG, p.hind[2] * DEG);
    this.neck.rotation.set(-(sp.neckUp + p.neck[0]) * DEG, p.neck[1] * DEG, 0);
    this.head.rotation.set((sp.headPitch + p.head[0]) * DEG, p.head[1] * DEG, p.head[2] * DEG);
    this.jaw.rotation.x = p.jaw * DEG;
    this.onPose?.(p);
    for (const l of [this.legs.fl, this.legs.fr, this.legs.hl, this.legs.hr]) if (l) l.upper.position.copy(l.base);
    this.root.updateMatrixWorld(true);
    if (this.legs.fl) this.solveLeg(this.legs.fl, p.fl);
    if (this.legs.fr) this.solveLeg(this.legs.fr, p.fr);
    this.solveLeg(this.legs.hl, p.hl);
    this.solveLeg(this.legs.hr, p.hr);
    this.root.updateMatrixWorld(true);
    this.skeleton?.update();
  }

  private solveLeg(leg: Leg, d: [number, number, number, number]) {
    const ls = leg.spec;
    const sc = this.body.scale.x;
    const secQ = leg.section.getWorldQuaternion(new THREE.Quaternion());
    const X = new THREE.Vector3(1, 0, 0).applyQuaternion(secQ);
    const S = leg.upper.getWorldPosition(new THREE.Vector3());
    const T = new THREE.Vector3(leg.rest.x + d[0], d[1] + ls.pawH, leg.rest.z + d[2]);
    this.body.localToWorld(T);
    const la = (ls.l1 + (ls.l3 ?? 0)) * sc, lb = ls.l2 * sc;
    const maxR = la + lb - 0.003 * sc;
    let to = T.clone().sub(S);
    let dist = to.length();
    if (dist > maxR && ls.slide) {
      const slide = Math.min(dist - maxR, ls.slide * sc);
      S.addScaledVector(to.clone().normalize(), slide);
      leg.upper.position.copy(leg.section.worldToLocal(S.clone()));
      to = T.clone().sub(S);
      dist = to.length();
    }
    dist = Math.min(maxR, Math.max(Math.abs(la - lb) + 0.003 * sc, dist));
    const dir = to.normalize();
    const alpha = Math.acos(Math.min(1, Math.max(-1, (la * la + dist * dist - lb * lb) / (2 * la * dist))));
    const upDir = dir.clone().applyAxisAngle(X, ls.bend * alpha);
    const knee = S.clone().addScaledVector(upDir, la);
    const lowDir = S.clone().addScaledVector(dir, dist).sub(knee).normalize();
    const qU = basisQuat(upDir, X), qM = basisQuat(lowDir, X);
    leg.upper.quaternion.copy(secQ.clone().invert().multiply(qU));
    leg.mid.quaternion.copy(qU.clone().invert().multiply(qM));
    let last = qM;
    if (leg.low) { leg.low.quaternion.copy(qM.clone().invert().multiply(qU)); last = qU; }
    const pawQ = secQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), d[3] * DEG));
    leg.paw.quaternion.copy(last.clone().invert().multiply(pawQ));
  }

  // ---- 链（尾巴等） ----
  resetChains() {
    this.root.updateMatrixWorld(true);
    for (const c of this.chains) { c.reset(); c.place(); }
    for (const s of this.sims) { s.reset(); s.place(); }
  }
  stepChains(dt: number, wind: THREE.Vector3) {
    const cols = this.chainCols.map(([o, local, r]) => {
      const c = local.clone();
      o.localToWorld(c);
      this.holder.worldToLocal(c);
      return { c, r };
    });
    for (const c of this.chains) c.step(dt, wind, cols);
    if (this.sims.length) {
      const caps: Collider[] = cols.map((c) => ({ a: c.c, r: c.r }));
      for (const s of this.sims) s.step(dt, wind, caps);
    }
  }
  saveChains(): number[][] { return [...this.chains.map((c) => c.save()), ...this.sims.map((s) => s.save())]; }
  loadChains(d: number[][]) {
    const n = this.chains.length;
    this.chains.forEach((c, i) => c.load(d[i]));
    this.sims.forEach((s, i) => s.load(d[n + i]));
  }
}

// ---------------- 蒙皮的腿 ----------------
export interface LegShape {
  /** 各关节处的半径：[肩/髋, 肘/膝, 腕/跗, (趾关节)] */
  r: number[];
  /** 上段前后向的加宽倍数（肩胛/股部的肌肉） */
  tz: number;
  /** 爪/蹄的尺寸 */
  paw: number;
  hoof?: boolean;
  /** 肩胛/髋部肌肉向躯干内延伸的高度 */
  rise?: number;
  /** 上段肌肉相对关节的前后偏移 */
  bz?: number;
  /** 上段中部的鼓起 */
  bulge?: number;
}

/** 在零姿势（腿垂直向下）下生成一条连续的蒙皮腿，关节处权重平滑过渡；蹄子单独成一段 */
export function skinLeg(rig: QuadRig, key: 'fl' | 'fr' | 'hl' | 'hr', sh: LegShape, material: THREE.Material, hoofMat?: THREE.Material) {
  const leg = rig.legs[key];
  if (!leg) return;
  const ls = leg.spec;
  const S = rig.bi(leg.section), U = rig.bi(leg.upper), M = rig.bi(leg.mid), L = leg.low ? rig.bi(leg.low) : -1, P = rig.bi(leg.paw);
  const jx = leg.base.x, jy = rig.spec.spineY + leg.base.y, jz = leg.base.z;
  const l1 = ls.l1, l2 = ls.l2, l3 = ls.l3 ?? 0;
  const total = l1 + l2 + l3 + ls.pawH;
  const r = sh.r, tz = sh.tz, ps = sh.paw, bz = sh.bz ?? 0, bulge = sh.bulge ?? 1;
  const rise = sh.rise ?? r[0] * 1.7;
  const d = Math.min(0.04, l1 * 0.2);
  const lp = (a: number, b: number, t: number) => a + (b - a) * t;
  const rings: Ring[] = [];
  const add = (dy: number, rx: number, rz: number, w: [number, number][], dz = 0, xk = 1) =>
    rings.push({ p: [jx * xk, jy + dy, jz + dz], rx, rz, w, v: Math.min(1, Math.max(0, -dy / total)) });
  // 肩胛/髋部：上端埋进躯干，只在侧面鼓出一点肌肉轮廓
  add(rise, r[0] * 0.34, r[0] * tz * 0.46, [[S, 1]], bz * 0.4, 0.5);
  add(rise * 0.5, r[0] * 0.66, r[0] * tz * 0.82, [[S, 0.82], [U, 0.18]], bz, 0.68);
  add(0, r[0] * 0.9, r[0] * tz, [[S, 0.45], [U, 0.55]], bz, 0.86);
  add(-l1 * 0.28, r[0] * bulge, r[0] * tz * 0.96 * bulge, [[U, 1]], bz);
  add(-l1 * 0.6, lp(r[0], r[1], 0.6) * 1.02, lp(r[0], r[1], 0.6) * lp(tz, 1.18, 0.6), [[U, 1]], bz * 0.5);
  add(-l1 + d, r[1] * 1.04, r[1] * 1.24, [[U, 0.78], [M, 0.22]]);
  add(-l1, r[1] * 1.03, r[1] * 1.2, [[U, 0.5], [M, 0.5]]);
  add(-l1 - d, r[1], r[1] * 1.16, [[U, 0.22], [M, 0.78]]);
  add(-l1 - l2 * 0.45, lp(r[1], r[2], 0.45), lp(r[1], r[2], 0.45) * 1.12, [[M, 1]]);
  const N = L >= 0 ? L : P;
  add(-l1 - l2 + d, r[2] * 1.02, r[2] * 1.1, [[M, 0.78], [N, 0.22]]);
  add(-l1 - l2, r[2] * 1.06, r[2] * 1.13, [[M, 0.5], [N, 0.5]]);
  let rEnd = r[2];
  if (L >= 0) {
    add(-l1 - l2 - d, r[2], r[2] * 1.08, [[M, 0.22], [L, 0.78]]);
    add(-l1 - l2 - l3 * 0.5, lp(r[2], r[3], 0.5), lp(r[2], r[3], 0.5) * 1.05, [[L, 1]]);
    add(-l1 - l2 - l3 + d * 0.7, r[3] * 1.02, r[3] * 1.08, [[L, 0.75], [P, 0.25]]);
    add(-l1 - l2 - l3, r[3] * 1.07, r[3] * 1.12, [[L, 0.5], [P, 0.5]]);
    rEnd = r[3];
  }
  const yP = -(l1 + l2 + l3), h = ls.pawH;
  if (sh.hoof) {
    // 蹄：窄而略前倾的一小段，上沿收在毛腿里面
    const hs = ps * 1.15;
    add(yP - (h - hs) * 0.5, rEnd * 0.9, rEnd * 0.96, [[P, 1]], 0.004);
    add(yP - (h - hs) - 0.006, ps * 0.56, ps * 0.62, [[P, 1]], ps * 0.1);
    rig.skin(tubeGeo(rings, 14, true, true), material);
    const hy = jy + yP - h;
    rig.skin(tubeGeo([
      { p: [jx, hy + hs + 0.012, jz + ps * 0.08], rx: ps * 0.46, rz: ps * 0.52, w: [[P, 1]] },
      { p: [jx, hy + hs * 0.5, jz + ps * 0.16], rx: ps * 0.52, rz: ps * 0.66, w: [[P, 1]] },
      { p: [jx, hy, jz + ps * 0.24], rx: ps * 0.56, rz: ps * 0.8, w: [[P, 1]] },
    ], 12, false, true), hoofMat ?? material);
  } else {
    add(yP - h * 0.42, ps * 0.6, ps * 0.72, [[P, 1]], ps * 0.22);
    add(yP - h + ps * 0.44, ps * 0.8, ps * 1.1, [[P, 1]], ps * 0.5);
    add(yP - h + ps * 0.16, ps * 0.86, ps * 1.2, [[P, 1]], ps * 0.57);
    add(yP - h + 0.004, ps * 0.74, ps * 1.06, [[P, 1]], ps * 0.57);
    rig.skin(tubeGeo(rings, 14, true, true), material);
  }
}

// ---------------- 步态 ----------------
/** 单足的循环轨迹：支撑相贴地后移，摆动相抬起前送 */
export function footCycle(t: number, phase: number, duty: number, stride: number, zc: number, lift: number, toe = 34): [number, number, number, number] {
  const p = (((t - phase) % 1) + 1) % 1;
  if (p < duty) return [0, 0, zc + stride * (0.5 - p / duty), 0];
  const u = (p - duty) / (1 - duty);
  const e = u * u * (3 - 2 * u);
  return [0, lift * Math.sin(Math.PI * Math.pow(u, 0.85)), zc + stride * (-0.5 + e), toe * Math.sin(Math.PI * Math.min(1, u * 1.7)) * (1 - u)];
}

export interface WalkSpec { stride: number; duty: number; liftF: number; liftH: number; bob: number; yaw: number; neck: number; }
export interface RunSpec {
  strideF: number; strideH: number; zcF: number; zcH: number; liftF: number; liftH: number; duty: number;
  bob: number; pitch: number; flexH: number; flexF: number; neck: number; lift: number;
}

/** 四拍行走（左后→左前→右后→右前） */
export function walkPose(w: WalkSpec, base: QPose = qRest()): (t: number) => QPose {
  return (t: number) => {
    const p = qp(base);
    const a = t * Math.PI * 2;
    p.hl = footCycle(t, 0.0, w.duty, w.stride, 0, w.liftH);
    p.fl = footCycle(t, 0.25, w.duty, w.stride, 0, w.liftF);
    p.hr = footCycle(t, 0.5, w.duty, w.stride, 0, w.liftH);
    p.fr = footCycle(t, 0.75, w.duty, w.stride, 0, w.liftF);
    p.pos[1] += -0.008 + w.bob * Math.cos(a * 2);
    p.fore[1] += -w.yaw * Math.cos(a - Math.PI / 2);
    p.hind[1] += -w.yaw * Math.cos(a);
    p.fore[2] += 1.5 * Math.sin(a - Math.PI / 2);
    p.hind[2] += 2 * Math.sin(a);
    p.neck[0] += w.neck * Math.cos(a * 2 + 0.6);
    p.neck[1] += w.yaw * 0.6 * Math.cos(a - Math.PI / 2);
    p.head[0] += -w.neck * 0.6 * Math.cos(a * 2 + 0.6);
    return p;
  };
}

/** 奔跑（袭步）：后足几乎同时蹬地，随后前足着地，中间两次腾空 */
export function runPose(r: RunSpec, base: QPose = qRest()): (t: number) => QPose {
  return (t: number) => {
    const p = qp(base);
    const a = t * Math.PI * 2;
    p.hl = footCycle(t, 0.0, r.duty, r.strideH, r.zcH, r.liftH, 20);
    p.hr = footCycle(t, 0.08, r.duty, r.strideH, r.zcH, r.liftH, 20);
    p.fl = footCycle(t, 0.44, r.duty, r.strideF, r.zcF, r.liftF, 50);
    p.fr = footCycle(t, 0.53, r.duty, r.strideF, r.zcF, r.liftF, 50);
    // 两次腾空期最高：伸展腾空 ~0.38，收拢腾空 ~0.88
    const air = 0.5 + 0.5 * Math.cos((t - 0.38) * Math.PI * 4);
    // 腾空时身体与四足一并离地
    const hop = r.lift * air * air;
    p.pos[1] += r.bob * (air * 2 - 1) + hop;
    for (const f of [p.fl, p.fr, p.hl, p.hr]) f[1] += hop;
    p.rot[0] += -r.pitch * Math.sin(a - 0.12);
    const flex = Math.cos(a - Math.PI * 1.8);
    p.hind[0] += -r.flexH * flex;
    p.fore[0] += r.flexF * flex;
    p.neck[0] += -r.neck + r.neck * 0.7 * flex;
    p.head[0] += -r.neck * 0.5 * flex;
    return p;
  };
}

export function idlePose(base: QPose, look = 7, breathe = 0.006): (t: number) => QPose {
  return (t: number) => {
    const p = qp(base);
    const s = Math.sin(t * Math.PI * 2), c = Math.cos(t * Math.PI * 2);
    p.pos[1] += breathe * s;
    p.fore[0] += 0.8 * s;
    p.neck[0] += 1.5 * s;
    p.neck[1] += look * c;
    p.head[1] += look * 0.8 * c;
    p.head[0] += 2 * s;
    return p;
  };
}

// ---------------- 动画定义与链模拟 ----------------
export interface CAnim<P> {
  name: string;
  n: number;
  fps: number;
  loop: boolean;
  dur: number;
  hit?: number;
  /** 链模拟的迎面风（向后的加速度） */
  wind?: number;
  pose: (t: number) => P;
}

export interface Rig<P> {
  root: THREE.Object3D;
  setPose(p: P): void;
  resetChains(): void;
  stepChains(dt: number, wind: THREE.Vector3): void;
  saveChains(): number[][];
  loadChains(d: number[][]): void;
}

export function simulateRig<P>(rig: Rig<P>, a: CAnim<P>): { pose: P; chains: number[][] }[] {
  const out: { pose: P; chains: number[][] }[] = [];
  rig.root.rotation.y = 0;
  const frameT = (f: number) => (a.loop ? f / a.n : a.n > 1 ? f / (a.n - 1) : 0);
  const wind = new THREE.Vector3(0, 0, -(a.wind ?? 0));
  const dt = 1 / 120;
  rig.setPose(a.pose(0));
  rig.resetChains();
  const pre = a.loop ? a.dur * 2 : 0.6;
  for (let t = 0; t < pre; t += dt) {
    rig.setPose(a.pose(a.loop ? t / a.dur : 0));
    rig.stepChains(dt, wind);
  }
  for (let f = 0; f < a.n; f++) {
    const t1 = frameT(f);
    if (f > 0) {
      const t0 = frameT(f - 1);
      const steps = Math.max(1, Math.round(((t1 - t0) * a.dur) / dt));
      for (let i = 1; i <= steps; i++) {
        rig.setPose(a.pose(t0 + ((t1 - t0) * i) / steps));
        rig.stepChains(dt, wind);
      }
    }
    const pose = a.pose(t1);
    rig.setPose(pose);
    out.push({ pose, chains: rig.saveChains() });
  }
  return out;
}
