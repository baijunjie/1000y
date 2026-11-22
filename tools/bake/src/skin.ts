import * as THREE from 'three';

/** 水平截面环：p 为中心，rx/rz 为半轴，w 为骨骼权重 [[骨骼下标, 权重], ...]，v 为贴图纵坐标（0 顶 → 1 底） */
export interface Ring {
  p: [number, number, number];
  rx: number;
  rz: number;
  w: [number, number][];
  v?: number;
}

/**
 * 由一串截面环生成带蒙皮权重的管状网格（环需自上而下排列）。
 * 贴图 u：0/1 在背后接缝，0.5 在正前方，0.25 为穿戴者右侧。
 */
export function tubeGeo(rings: Ring[], segs = 18, cap0 = true, cap1 = true): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
  const addV = (x: number, y: number, z: number, u: number, v: number, w: [number, number][]) => {
    pos.push(x, y, z);
    uv.push(u, 1 - v);
    const a = w[0], b = w[1] ?? [a[0], 0];
    const t = a[1] + b[1] || 1;
    si.push(a[0], b[0], 0, 0);
    sw.push(a[1] / t, b[1] / t, 0, 0);
  };
  const n = rings.length;
  rings.forEach((r, i) => {
    for (let s = 0; s <= segs; s++) {
      const ph = (s / segs) * Math.PI * 2 + Math.PI;
      addV(r.p[0] + r.rx * Math.sin(ph), r.p[1], r.p[2] + r.rz * Math.cos(ph), s / segs, r.v ?? i / (n - 1), r.w);
    }
  });
  const down = rings[0].p[1] >= rings[n - 1].p[1];
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < segs; s++) {
      const a = i * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
      if (down) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (ri: number, first: boolean) => {
    const r = rings[ri], base = ri * (segs + 1), ci = pos.length / 3;
    addV(r.p[0], r.p[1], r.p[2], 0.5, r.v ?? ri / (n - 1), r.w);
    for (let s = 0; s < segs; s++) {
      const a = base + s, b = base + s + 1;
      if (first === down) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  if (cap0) cap(0, true);
  if (cap1) cap(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 接缝处法线取平均，避免背后出现一条棱
  const nr = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const a = i * (segs + 1), b = a + segs;
    const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

export interface Collider { a: THREE.Vector3; b?: THREE.Vector3; r: number; }

const _t = new THREE.Vector3(), _ab = new THREE.Vector3();
export function pushOut(p: THREE.Vector3, cols: Collider[]) {
  for (const c of cols) {
    if (c.b) {
      _ab.copy(c.b).sub(c.a);
      const t = Math.min(1, Math.max(0, _t.copy(p).sub(c.a).dot(_ab) / (_ab.lengthSq() || 1)));
      _t.copy(c.a).addScaledVector(_ab, t);
    } else _t.copy(c.a);
    const dx = p.x - _t.x, dy = p.y - _t.y, dz = p.z - _t.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < c.r && d > 1e-6) { const k = (c.r - d) / d; p.x += dx * k; p.y += dy * k; p.z += dz * k; }
  }
}

export interface SimPart {
  reset(): void;
  step(dt: number, wind: THREE.Vector3, cols: Collider[]): void;
  place(): void;
  save(): number[];
  load(a: number[]): void;
}

/** 布料：质点网格，首行钉在骨骼上 */
export class Cloth implements SimPart {
  pts: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  private cons: [number, number, number][] = [];
  mesh: THREE.Mesh;
  private posAttr: THREE.BufferAttribute;
  /**
   * rest：行优先的静止形状（body 绑定空间），首行为钉点。
   * anchor：钉点所跟随的骨骼；其绑定姿态下的世界逆矩阵用于把静止形状换算到骨骼局部。
   */
  private local: THREE.Vector3[] = [];
  constructor(
    public cols: number, public rows: number, rest: THREE.Vector3[], public anchor: THREE.Object3D,
    public holder: THREE.Object3D, material: THREE.Material, public stiffness = 0.9, public damping = 0.965, public gravity = 1,
  ) {
    anchor.updateWorldMatrix(true, false);
    holder.updateWorldMatrix(true, false);
    for (const r of rest) {
      const wp = holder.localToWorld(r.clone());
      this.local.push(anchor.worldToLocal(wp));
      this.pts.push(r.clone());
      this.prev.push(r.clone());
    }
    const id = (c: number, r: number) => r * cols + c;
    const link = (a: number, b: number) => this.cons.push([a, b, rest[a].distanceTo(rest[b])]);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) link(id(c, r), id(c + 1, r));
      if (r + 1 < rows) link(id(c, r), id(c, r + 1));
      if (c + 1 < cols && r + 1 < rows) { link(id(c, r), id(c + 1, r + 1)); link(id(c + 1, r), id(c, r + 1)); }
      if (r + 2 < rows) link(id(c, r), id(c, r + 2));
      if (c + 2 < cols) link(id(c, r), id(c + 2, r));
    }
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), idx: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      uv[(r * cols + c) * 2] = c / (cols - 1); uv[(r * cols + c) * 2 + 1] = 1 - r / (rows - 1);
      if (c + 1 < cols && r + 1 < rows) idx.push(id(c, r), id(c, r + 1), id(c + 1, r), id(c + 1, r), id(c, r + 1), id(c + 1, r + 1));
    }
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    holder.add(this.mesh);
    this.place();
  }
  private target(i: number, out: THREE.Vector3) {
    out.copy(this.local[i]);
    this.anchor.localToWorld(out);
    this.holder.worldToLocal(out);
    return out;
  }
  reset() {
    this.pts.forEach((p, i) => { this.target(i, p); this.prev[i].copy(p); });
  }
  step(dt: number, wind: THREE.Vector3, cols: Collider[]) {
    const { pts, prev } = this;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.cols; i++) this.target(i, pts[i]);
    for (let i = this.cols; i < pts.length; i++) {
      const p = pts[i], q = prev[i];
      tmp.copy(p).sub(q).multiplyScalar(this.damping);
      q.copy(p);
      p.add(tmp);
      p.y -= 9.8 * dt * dt * this.gravity;
      p.addScaledVector(wind, dt * dt);
    }
    for (let it = 0; it < 10; it++) {
      for (const [a, b, len] of this.cons) {
        const pa = pts[a], pb = pts[b];
        tmp.copy(pb).sub(pa);
        const d = tmp.length() || 1e-6;
        const k = ((d - len) / d) * this.stiffness;
        const fa = a < this.cols, fb = b < this.cols;
        if (fa && fb) continue;
        if (fa) pb.addScaledVector(tmp, -k);
        else if (fb) pa.addScaledVector(tmp, k);
        else { pa.addScaledVector(tmp, k * 0.5); pb.addScaledVector(tmp, -k * 0.5); }
      }
      for (let i = this.cols; i < pts.length; i++) { pushOut(pts[i], cols); if (pts[i].y < 0.015) pts[i].y = 0.015; }
    }
  }
  place() {
    const a = this.posAttr.array as Float32Array;
    this.pts.forEach((p, i) => { a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z; });
    this.posAttr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingBox();
    this.mesh.geometry.computeBoundingSphere();
  }
  save(): number[] { return this.pts.flatMap((p) => [p.x, p.y, p.z]); }
  load(a: number[]) { this.pts.forEach((p, i) => p.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])); this.place(); }
}

/** 发丝/飘带：质点链，渲染成一条平滑的扁管 */
export class Ribbon implements SimPart {
  pts: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  mesh: THREE.Mesh;
  private posAttr: THREE.BufferAttribute;
  private readonly SEG = 6;
  constructor(
    public anchor: THREE.Object3D, public local: THREE.Vector3, public segLen: number, public n: number,
    public holder: THREE.Object3D, material: THREE.Material,
    /** 每节的半宽与半厚 */
    private shape: (t: number) => [number, number],
    /** 发丝朝外的参考方向所在的骨骼局部向量（决定扁管的朝向） */
    private outward = new THREE.Vector3(0, 0, -1),
    /** 根部的初始走向（骨骼局部），让发根贴着头皮出来而不是垂直下坠 */
    private rootDir = new THREE.Vector3(0, -1, 0),
    public damping = 0.95, private rootStiff = 2,
  ) {
    for (let i = 0; i <= n; i++) { this.pts.push(new THREE.Vector3()); this.prev.push(new THREE.Vector3()); }
    const S = this.SEG;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((n + 1) * S * 3), uv = new Float32Array((n + 1) * S * 2), idx: number[] = [];
    for (let i = 0; i <= n; i++) for (let s = 0; s < S; s++) {
      uv[(i * S + s) * 2] = s / S; uv[(i * S + s) * 2 + 1] = 1 - i / n;
      if (i < n) {
        const a = i * S + s, b = i * S + ((s + 1) % S), c = a + S, d = b + S;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    holder.add(this.mesh);
  }
  private toHolder(v: THREE.Vector3, dir = false) {
    if (dir) { v.transformDirection(this.anchor.matrixWorld); const q = this.holder.getWorldQuaternion(new THREE.Quaternion()).invert(); return v.applyQuaternion(q); }
    this.anchor.localToWorld(v);
    return this.holder.worldToLocal(v);
  }
  reset() {
    const a = this.toHolder(this.local.clone()), d = this.toHolder(this.rootDir.clone(), true);
    this.pts.forEach((p, i) => {
      const k = Math.min(1, i / this.rootStiff);
      p.set(a.x + d.x * this.segLen * i * (1 - k * 0.6), a.y + (d.y * (1 - k) - k) * this.segLen * i, a.z + d.z * this.segLen * i * (1 - k * 0.6));
      this.prev[i].copy(p);
    });
  }
  step(dt: number, wind: THREE.Vector3, cols: Collider[]) {
    const tmp = new THREE.Vector3();
    const { pts, prev } = this;
    this.toHolder(pts[0].copy(this.local));
    const d = this.toHolder(this.rootDir.clone(), true);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = prev[i];
      tmp.copy(p).sub(q).multiplyScalar(this.damping);
      q.copy(p);
      p.add(tmp);
      p.y -= 9.8 * dt * dt;
      p.addScaledVector(wind, dt * dt);
      // 发根附近向初始走向回弹
      if (i <= this.rootStiff) {
        tmp.copy(pts[0]).addScaledVector(d, this.segLen * i);
        p.lerp(tmp, 0.35 / i);
      }
    }
    for (let it = 0; it < 8; it++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        tmp.copy(b).sub(a);
        const l = tmp.length() || 1e-6;
        tmp.multiplyScalar((l - this.segLen) / l);
        if (i === 1) b.sub(tmp); else { a.addScaledVector(tmp, 0.5); b.addScaledVector(tmp, -0.5); }
      }
      for (let i = 1; i < pts.length; i++) { pushOut(pts[i], cols); if (pts[i].y < 0.02) pts[i].y = 0.02; }
    }
  }
  place() {
    const S = this.SEG, a = this.posAttr.array as Float32Array, n = this.n;
    const out = this.toHolder(this.outward.clone(), true);
    const tan = new THREE.Vector3(), side = new THREE.Vector3(), nor = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const p = this.pts[i];
      tan.copy(this.pts[Math.min(n, i + 1)]).sub(this.pts[Math.max(0, i - 1)]).normalize();
      side.crossVectors(tan, out);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      nor.crossVectors(side, tan).normalize();
      const [hw, ht] = this.shape(i / n);
      for (let s = 0; s < S; s++) {
        const ang = (s / S) * Math.PI * 2, c = Math.cos(ang) * hw, sn = Math.sin(ang) * ht;
        const o = (i * S + s) * 3;
        a[o] = p.x + side.x * c + nor.x * sn; a[o + 1] = p.y + side.y * c + nor.y * sn; a[o + 2] = p.z + side.z * c + nor.z * sn;
      }
    }
    this.posAttr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingBox();
    this.mesh.geometry.computeBoundingSphere();
  }
  save(): number[] { return this.pts.flatMap((p) => [p.x, p.y, p.z]); }
  load(a: number[]) { this.pts.forEach((p, i) => p.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])); this.place(); }
}
