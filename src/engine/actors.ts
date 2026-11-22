import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ActorDef, ActorInst, lerpPose } from '../models/registry';
import type { Renderer } from './renderer';

/** 渲染一个角色所需的状态（由 Entity 提供） */
export interface ActorState {
  id: number;
  x: number; y: number; z: number;
  /** 朝向角（绕 Y，0 = 面向 +z） */
  yaw: number;
  scale: number;
  tint?: [number, number, number];
  alpha: number;
  spr: { def: ActorDef; anim: string; t: number; seq: number };
}

const TRAIL_LIFE = 0.14;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const FX_TRAIL = 8;
interface TrailPt { bx: number; by: number; bz: number; tx: number; ty: number; tz: number; t: number; }

/** 攻击动画里兵器真正在「走」的那一段（相位区间），只在这段留刀光 */
const SWING: Record<string, [number, number]> = { atk1: [0.22, 0.66], atk2: [0.22, 0.66] };

const SHADOW_PROXY = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });

/**
 * 把人形角色的网格按材质合并。
 * 建模时每个部件（发髻、护腕、兵器的每一段……）都是独立网格，一个人四五十次绘制，再乘上每盏投影灯的各个面就撑不住了。
 * 做法：挂在骨骼上的刚体部件改成「权重 1 绑在那根骨骼上」的蒙皮，与同材质的蒙皮网格并成一个。
 * 布料、穗子、弓弦这些每帧自己改形状的部件保持原样。
 */
function consolidate(rig: any) {
  const sk: THREE.Skeleton | undefined = rig.skeleton, body: THREE.Object3D | undefined = rig.body;
  if (!sk || !body || !rig.chainHolder) return;
  rig.root.updateMatrixWorld(true);
  const Mb = body.matrixWorld.clone(), MbInv = Mb.clone().invert();
  const dynamic = new Set<THREE.Object3D>([rig.chainHolder]);
  if (rig.bowString) for (const o of [rig.bowString.top, rig.bowString.bot, rig.bowString.arrow]) dynamic.add(o);
  const boneIdx = new Map<THREE.Object3D, number>(sk.bones.map((b, i) => [b, i]));
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const gone: THREE.Mesh[] = [];
  const m4 = new THREE.Matrix4();
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    let bone = -1;
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) {
      if (dynamic.has(p)) return;
      if (bone < 0 && boneIdx.has(p)) bone = boneIdx.get(p)!;
    }
    const src = mesh.geometry, n = src.getAttribute('position').count;
    const g = new THREE.BufferGeometry();
    const copy = (name: string, size: number) => {
      const a = src.getAttribute(name);
      g.setAttribute(name, new THREE.BufferAttribute(a ? new Float32Array(a.array as ArrayLike<number>) : new Float32Array(n * size), size));
    };
    copy('position', 3); copy('normal', 3); copy('uv', 2);
    let index: number[];
    if (src.index) index = Array.from(src.index.array as ArrayLike<number>);
    else { index = new Array(n); for (let i = 0; i < n; i++) index[i] = i; }
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      if ((mesh as THREE.SkinnedMesh).skeleton !== sk) return;
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(src.getAttribute('skinIndex').array as ArrayLike<number>), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(src.getAttribute('skinWeight').array as ArrayLike<number>), 4));
    } else {
      if (bone < 0) return;
      const B = sk.bones[bone];
      // 部件相对骨骼的固定变换，换算到绑定姿态下的蒙皮空间
      m4.copy(MbInv).multiply(new THREE.Matrix4().copy(sk.boneInverses[bone]).invert()).multiply(new THREE.Matrix4().copy(B.matrixWorld).invert()).multiply(mesh.matrixWorld);
      g.applyMatrix4(m4);
      if (m4.determinant() < 0) for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    g.setIndex(index);
    let e = groups.get(mesh.material.uuid);
    if (!e) groups.set(mesh.material.uuid, (e = { mat: mesh.material, geos: [] }));
    e.geos.push(g);
    gone.push(mesh);
  });
  for (const m of gone) m.parent?.remove(m);
  const all: THREE.BufferGeometry[] = [];
  for (const e of groups.values()) {
    const geo = mergeGeometries(e.geos, false);
    if (!geo) continue;
    const m = new THREE.SkinnedMesh(geo, e.mat);
    m.userData.noCast = true;
    body.add(m);
    m.updateWorldMatrix(true, false);
    m.bind(sk, Mb);
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'skinIndex', 'skinWeight']) g.setAttribute(k, geo.getAttribute(k));
    g.setIndex(geo.index);
    all.push(g);
  }
  // 阴影里不分材质：整个人再并成一个只在阴影贴图里出现的代理网格，每盏灯的每个面只画一次
  const proxyGeo = all.length ? mergeGeometries(all, false) : null;
  if (proxyGeo) {
    const m = new THREE.SkinnedMesh(proxyGeo, SHADOW_PROXY);
    m.userData.proxy = true;
    body.add(m);
    m.updateWorldMatrix(true, false);
    m.bind(sk, Mb);
  }
  // 穗子之类的小链节不投影
  for (const c of rig.chains ?? []) for (const m of c.meshes ?? []) m.userData.noCast = true;
}

class View {
  group = new THREE.Group();
  inst: ActorInst | null = null;
  defKey = '';
  seen = 0;
  yaw = 0;
  private lastSeq = -1;
  private lastAnim = '';
  private pose: any = null;
  private from: any = null;
  private blend = 1; private blendDur = 0.12;
  private px = 0; private pz = 0; private first = true;
  private wind = new THREE.Vector3();
  private trail: TrailPt[] = [];
  private weapon: THREE.Object3D | null = null;
  private tints = new Map<string, THREE.Material>();

  constructor(private r: Renderer) { r.scene.add(this.group); }

  private build(s: ActorState) {
    if (this.inst) { this.group.remove(this.inst.rig.root); }
    const def = s.spr.def;
    this.inst = def.make();
    this.defKey = def.key;
    consolidate(this.inst.rig);
    const root = this.inst.rig.root;
    const holder = (this.inst.rig as any).chainHolder ?? (this.inst.rig as any).holder ?? null;
    // 视锥裁剪用的包围球：蒙皮网格与布料的顶点每帧在动，给一个罩住全身的固定球，
    // 否则要么每帧重算、要么只能关掉裁剪（那样每盏投影灯的六个面都会把它画一遍）
    const big = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = !m.userData.noCast; m.receiveShadow = !m.userData.proxy;
      let inHolder = false;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p === holder) { inHolder = true; break; }
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) { (m as THREE.SkinnedMesh).boundingSphere = big; m.frustumCulled = true; }
      else if (inHolder) { m.geometry.boundingSphere = big; m.frustumCulled = true; }
      if (s.tint && !m.userData.proxy) m.material = Array.isArray(m.material) ? m.material.map((x) => this.tinted(x, s.tint!)) : this.tinted(m.material, s.tint);
    });
    this.group.add(root);
    this.weapon = def.blade ? ((this.inst.rig as any).weaponR ?? null) : null;
    this.pose = null; this.from = null; this.first = true; this.trail.length = 0;
    this.lastSeq = -1;
  }

  private tinted(m: THREE.Material, t: [number, number, number]): THREE.Material {
    let c = this.tints.get(m.uuid);
    if (!c) {
      c = m.clone();
      (c as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(t[0], t[1], t[2]));
      this.tints.set(m.uuid, c);
    }
    return c;
  }

  update(s: ActorState, dt: number, time: number) {
    if (!this.inst || this.defKey !== s.spr.def.key) this.build(s);
    const inst = this.inst!, rig = inst.rig, g = this.group;
    const sink = (1 - s.alpha) * 0.9;
    g.visible = true;

    // 朝向：向目标角平滑转过去
    if (this.first) this.yaw = s.yaw;
    let dy = s.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 16);
    g.position.set(s.x, s.y - sink, s.z);
    g.rotation.y = this.yaw;
    g.scale.setScalar(s.scale);
    g.updateMatrixWorld(true);

    // 姿势：动画切换时与上一刻的姿势做短暂混合
    const a = inst.anims[s.spr.anim] ?? inst.anims.idle;
    const m = s.spr.def.meta[a.name];
    const phase = a.loop ? ((s.spr.t * m.fps) / m.n) % 1 : Math.min(1, (s.spr.t * m.fps) / Math.max(1, m.n - 1));
    let pose = a.pose(phase);
    if (s.spr.seq !== this.lastSeq || a.name !== this.lastAnim) {
      if (this.pose && this.lastSeq !== -1) {
        this.from = this.pose; this.blend = 0;
        this.blendDur = a.name === 'hit' ? 0.05 : a.name.startsWith('atk') ? 0.07 : a.name === 'die' ? 0.08 : 0.16;
      }
      this.lastSeq = s.spr.seq; this.lastAnim = a.name;
    }
    if (this.from && this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      pose = lerpPose(this.from, pose, k);
      if (this.blend >= 1) this.from = null;
    }
    this.pose = pose;
    rig.setPose(pose);

    // 布料、发丝、穗子：迎面风 = 自身速度的反向（换到角色局部坐标）
    const vx = this.first ? 0 : (s.x - this.px) / Math.max(dt, 1e-3), vz = this.first ? 0 : (s.z - this.pz) / Math.max(dt, 1e-3);
    this.px = s.x; this.pz = s.z;
    const c = Math.cos(-this.yaw), sn = Math.sin(-this.yaw);
    const k = 1.6;
    this.wind.set(-(vx * c + vz * sn) * k + 0.6 * Math.sin(time * 0.7 + s.id), 0, -(-vx * sn + vz * c) * k);
    if (this.wind.lengthSq() > 144) this.wind.setLength(12);
    if (this.first) rig.resetChains();
    else rig.stepChains(Math.min(dt, 1 / 40), this.wind);
    rig.placeChains();
    this.first = false;

    this.updateTrail(s, a.name, phase, time);
  }

  private updateTrail(s: ActorState, anim: string, phase: number, time: number) {
    const blade = s.spr.def.blade, w = this.weapon;
    if (!blade || !w) return;
    const sw = SWING[anim];
    const tr = this.trail;
    if (sw && phase >= sw[0] && phase <= sw[1]) {
      w.updateWorldMatrix(true, false);
      // 只取刃的前半段：刀光是刃尖划出的一道细弧，不是一整面扇形
      const z0 = blade[0] + (blade[1] - blade[0]) * 0.55;
      const b = _a.set(0, 0, z0).applyMatrix4(w.matrixWorld), t = _b.set(0, 0, blade[1]).applyMatrix4(w.matrixWorld);
      tr.push({ bx: b.x, by: b.y, bz: b.z, tx: t.x, ty: t.y, tz: t.z, t: time });
    }
    while (tr.length && time - tr[0].t > TRAIL_LIFE) tr.shift();
    if (tr.length < 2) return;
    // 采样点之间用 Catmull-Rom 插值细分，弧线才不会是一段段折线
    const r = this.r, SUB = 4;
    const cr = (p0: number, p1: number, p2: number, p3: number, u: number) =>
      0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    const KEYS: (keyof TrailPt)[] = ['bx', 'by', 'bz', 'tx', 'ty', 'tz', 't'];
    let prev: TrailPt | null = null;
    for (let i = 0; i + 1 < tr.length; i++) {
      const p1 = tr[i], p2 = tr[i + 1];
      if (p2.t - p1.t > 0.08) { prev = null; continue; } // 两次挥击之间不要连起来
      const p0 = tr[Math.max(0, i - 1)], p3 = tr[Math.min(tr.length - 1, i + 2)];
      for (let k = prev ? 1 : 0; k <= SUB; k++) {
        const u = k / SUB, q = {} as TrailPt;
        for (const key of KEYS) q[key] = cr(p0[key], p1[key], p2[key], p3[key], u);
        if (prev) {
          const a0 = Math.max(0, 1 - (time - prev.t) / TRAIL_LIFE), a1 = Math.max(0, 1 - (time - q.t) / TRAIL_LIFE);
          r.fxQuad([prev.tx, prev.ty, prev.tz, q.tx, q.ty, q.tz, prev.bx, prev.by, prev.bz, q.bx, q.by, q.bz], FX_TRAIL, 0.85, 0.92, 1.0, a0 * a0 * 0.5, 1, a1 * a1 * 0.5);
        }
        prev = q;
      }
    }
  }
}

/** 角色视图池：只为视野附近的角色建模与更新 */
export class Actors {
  private views = new Map<number, View>();
  private frame = 0;
  constructor(private r: Renderer) {}

  begin() { this.frame++; }

  draw(s: ActorState, dt: number) {
    let v = this.views.get(s.id);
    if (!v) this.views.set(s.id, (v = new View(this.r)));
    v.seen = this.frame;
    v.update(s, dt, this.r.time);
  }

  /** 本帧没被提交的角色隐藏；久未出现的释放 */
  end() {
    for (const [id, v] of this.views) {
      if (v.seen === this.frame) continue;
      v.group.visible = false;
      if (this.frame - v.seen > 1800) { this.r.scene.remove(v.group); this.views.delete(id); }
    }
  }

  /** 角色身上某个高度处的世界坐标（用于命中火花等），取不到则返回 null */
  get(id: number) { return this.views.get(id) ?? null; }
}
