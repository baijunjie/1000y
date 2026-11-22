import * as THREE from 'three';
import { box, canvasTex, Col, cyl, DEG, ellipsoid, fbm, group, lathe, limb, mat, mesh, rng, shade, tube } from './geo';
import { Cloth, Collider, Ribbon, Ring, SimPart, tubeGeo } from './skin';

export type WeaponKind = 'fist' | 'sword' | 'saber' | 'spear' | 'bow';

export interface Look {
  scale?: number;
  /** 体格：1 为标准 */
  bulk?: number;
  skin: Col;
  hair: Col;
  /** flow：束冠 + 披肩长发；ponytail：高马尾；topknot：发髻；bun：脑后低髻；buns：双髻；loose：散发；bald：光头 */
  hairStyle: 'flow' | 'topknot' | 'ponytail' | 'bald' | 'bun' | 'buns' | 'loose';
  hat?: 'douli' | 'bandana' | 'cap' | 'none';
  mask?: Col;
  beard?: Col;
  top: Col;
  trim: Col;
  /** 交领内露出的里衣颜色 */
  inner?: Col;
  /** 下摆渐染到的颜色 */
  dye?: Col;
  pants: Col;
  boots: Col;
  sash: Col;
  bracer: Col;
  /** 下摆长度（米，自腰线起），0 表示没有 */
  skirt: number;
  sleeve?: 'tight' | 'wide' | 'bare';
  ribbon?: Col;
  mantle?: Col;
  /** 发冠颜色 */
  crown?: Col;
  /** 体格：strong 为宽肩厚胸的练家子（缺省），slim 为清瘦 */
  build?: 'strong' | 'slim';
  /** 敞襟的粗布短褐：前胸露出皮肉 */
  open?: boolean;
  /** 缠臂布的颜色（赤臂时） */
  wraps?: Col;
  /** 绑腿的颜色（有则穿布鞋） */
  legwrap?: Col;
  /** 旧围巾 */
  scarf?: Col;
  /** 腰间挂酒葫芦 */
  gourd?: boolean;
  stubble?: boolean;
  scar?: boolean;
  weapon: WeaponKind;
  weaponScale?: number;
  bladeColor?: Col;
}

/**
 * 姿势。角度单位为度。
 * 手臂 [raise, out, twist, elbow]：raise 为从下垂起向前抬，out 为抬起方向朝外侧的偏航，elbow 为屈肘。
 * 腿 [fwd, out, twist, knee]。
 */
export interface Pose {
  hip: [number, number, number];
  hipRot: [number, number, number];
  spine: [number, number, number];
  chest: [number, number, number];
  head: [number, number, number];
  armR: [number, number, number, number];
  armL: [number, number, number, number];
  handR: [number, number, number];
  handL: [number, number, number];
  legR: [number, number, number, number];
  legL: [number, number, number, number];
  footR: number;
  footL: number;
  /** 弓的拉开程度 0..1 */
  draw: number;
  /** 副手是否用 IK 握住武器（0/1，取 >0.5） */
  grip: number;
}

export const POSE_KEYS: (keyof Pose)[] = [
  'hip', 'hipRot', 'spine', 'chest', 'head', 'armR', 'armL', 'handR', 'handL', 'legR', 'legL', 'footR', 'footL', 'draw', 'grip',
];

export function restPose(): Pose {
  return {
    hip: [0, 0, 0], hipRot: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
    armR: [0, 8, 0, 8], armL: [0, 8, 0, 8], handR: [0, 0, 0], handL: [0, 0, 0],
    legR: [0, 3, 0, 0], legL: [0, 3, 0, 0], footR: 0, footL: 0, draw: 0, grip: 0,
  };
}

export function flattenPose(p: Pose): number[] {
  const out: number[] = [];
  for (const k of POSE_KEYS) {
    const v = p[k];
    if (typeof v === 'number') out.push(v); else out.push(...v);
  }
  return out;
}

export function unflattenPose(a: number[]): Pose {
  const p = restPose() as any;
  let i = 0;
  for (const k of POSE_KEYS) {
    if (typeof p[k] === 'number') p[k] = a[i++];
    else for (let j = 0; j < p[k].length; j++) p[k][j] = a[i++];
  }
  return p;
}

const qx = new THREE.Quaternion(), qy = new THREE.Quaternion(), qz = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

interface Arm { upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone; side: number; }
interface Leg { upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Bone; side: number; }

/** 刚性分节的 Verlet 链（穗子、动物尾巴等） */
export class Chain {
  pts: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  meshes: THREE.Mesh[] = [];
  constructor(
    public anchor: THREE.Object3D, public local: THREE.Vector3, public segLen: number, n: number,
    public holder: THREE.Object3D, make: (i: number, n: number) => THREE.Mesh,
    public stiff: THREE.Vector3 | null = null,
  ) {
    for (let i = 0; i <= n; i++) {
      this.pts.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    for (let i = 0; i < n; i++) {
      const m = make(i, n);
      this.meshes.push(m);
      holder.add(m);
    }
  }
  anchorPos(out: THREE.Vector3) {
    out.copy(this.local);
    this.anchor.localToWorld(out);
    this.holder.worldToLocal(out);
    return out;
  }
  reset() {
    const a = this.anchorPos(new THREE.Vector3());
    this.pts.forEach((p, i) => { p.set(a.x, a.y - i * this.segLen, a.z); this.prev[i].copy(p); });
  }
  step(dt: number, wind: THREE.Vector3, colliders: { c: THREE.Vector3; r: number }[]) {
    const tmp = new THREE.Vector3();
    this.anchorPos(this.pts[0]);
    for (let i = 1; i < this.pts.length; i++) {
      const p = this.pts[i], q = this.prev[i];
      tmp.copy(p).sub(q).multiplyScalar(0.94);
      q.copy(p);
      p.add(tmp);
      p.y -= 9.8 * dt * dt * 1.3;
      p.addScaledVector(wind, dt * dt);
    }
    for (let it = 0; it < 6; it++) {
      for (let i = 1; i < this.pts.length; i++) {
        const a = this.pts[i - 1], b = this.pts[i];
        tmp.copy(b).sub(a);
        const d = tmp.length() || 1e-6;
        tmp.multiplyScalar((d - this.segLen) / d);
        if (i === 1) b.sub(tmp); else { a.addScaledVector(tmp, 0.5); b.addScaledVector(tmp, -0.5); }
      }
      for (const col of colliders) {
        for (let i = 1; i < this.pts.length; i++) {
          tmp.copy(this.pts[i]).sub(col.c);
          const d = tmp.length();
          if (d < col.r) this.pts[i].addScaledVector(tmp, (col.r - d) / (d || 1e-6));
        }
      }
      for (let i = 1; i < this.pts.length; i++) if (this.pts[i].y < 0.02) this.pts[i].y = 0.02;
    }
  }
  place() {
    const dir = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i < this.meshes.length; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      dir.copy(b).sub(a).normalize();
      const m = this.meshes[i];
      m.position.copy(a);
      m.quaternion.setFromUnitVectors(down, dir);
    }
  }
  save(): number[] { return this.pts.flatMap((p) => [p.x, p.y, p.z]); }
  load(a: number[]) { this.pts.forEach((p, i) => p.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])); this.place(); }
}

// ---------------------------------------------------------------- 贴图绘制
const painted = new Map<string, THREE.CanvasTexture>();
/** noise：明暗起伏的幅度；coarse：粗布（麻、葛）的经纬线 */
function paint(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, noise = 0.07, coarse = false): THREE.CanvasTexture {
  let t = painted.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  if (noise > 0) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const weave = coarse ? (((x >> 1) + (y >> 1)) & 1 ? 0.7 : 0.3) * 0.5 + (x % 3 === 0 ? 0.12 : 0.26) + (y % 4 === 0 ? 0.0 : 0.1) : ((x + y) & 1 ? 0.62 : 0.38);
      const k = 1 - noise + noise * 2 * (0.6 * fbm((x / w) * 14, (y / h) * 14, 14, 3, 5) + 0.4 * weave);
      const o = (y * w + x) * 4;
      d[o] *= k; d[o + 1] *= k; d[o + 2] *= k;
    }
    g.putImageData(img, 0, 0);
  }
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  painted.set(key, t);
  return t;
}
const css = (c: Col) => '#' + new THREE.Color(c as any).getHexString();
function shadeA(c: Col, a: number) { const k = new THREE.Color(c as any); return `rgba(${Math.round(k.r * 255)},${Math.round(k.g * 255)},${Math.round(k.b * 255)},${a})`; }

/** 纵向衣褶的明暗条 */
function folds(g: CanvasRenderingContext2D, w: number, h: number, seed: number, strength = 0.1, n = 26) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, wd = 8 + r() * 0.06 * w, dark = r() < 0.6;
    const gr = g.createLinearGradient(x, 0, x + wd, 0);
    const c = dark ? '0,0,0' : '255,255,255';
    gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(0.5, `rgba(${c},${strength * (0.4 + r() * 0.6)})`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr;
    g.fillRect(x, 0, wd, h);
    if (x + wd > w) g.fillRect(x - w, 0, wd, h);
  }
}
/** 缝了一圈线的补丁 */
function patch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, rot = 0.1) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = color; g.fillRect(-w / 2, -h / 2, w, h);
  g.strokeStyle = 'rgba(225,215,190,0.75)'; g.lineWidth = 1.6; g.setLineDash([5, 4]);
  g.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
  g.restore(); g.setLineDash([]);
}

/** 衣褶凹凸 */
const foldBump = () => canvasTex('fold_bump', 256, (u, v) => {
  const a = fbm(u * 9, v * 1.6, 9, 3, 21), b = fbm(u * 26, v * 5, 26, 2, 33), c = fbm(u * 60, v * 60, 60, 2, 41);
  const g = 0.5 + (a - 0.5) * 0.9 + (b - 0.5) * 0.3 + (c - 0.5) * 0.25;
  return [g, g, g];
}, false);

/** 交领上衣（袍服） */
function robeTopTex(L: Look): THREE.CanvasTexture {
  const inner = L.inner ?? shade(L.trim, 0.55);
  return paint(`top|${L.top}|${L.trim}|${inner}`, 512, 512, (g, w, h) => {
    g.fillStyle = css(L.top); g.fillRect(0, 0, w, h);
    folds(g, w, h, 7, 0.12);
    const cx = w / 2, nh = 0.052 * w, cy = 0.36 * h;
    g.fillStyle = css(inner);
    g.beginPath(); g.moveTo(cx - nh - 2, 0); g.lineTo(cx + nh + 2, 0); g.lineTo(cx + 6, cy + 6); g.lineTo(cx - 8, cy); g.closePath(); g.fill();
    const band = 0.04 * w;
    g.lineCap = 'butt';
    const lapel = (x0: number, y0: number, x1: number, y1: number) => {
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = band + 7; g.beginPath(); g.moveTo(x0 + 2, y0 + 3); g.lineTo(x1 + 2, y1 + 3); g.stroke();
      g.strokeStyle = css(L.trim); g.lineWidth = band; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    };
    lapel(cx - nh - 6, -6, cx + 4, cy + 4);
    lapel(cx + nh + 6, -6, cx - 0.17 * w, 0.86 * h);
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 2;
    for (const x of [0.25 * w, 0.75 * w]) { g.beginPath(); g.moveTo(x, 0.2 * h); g.lineTo(x, h); g.stroke(); }
  }, 0.1);
}

/** 敞襟的粗布短褐：前胸露出皮肉，画出胸肌与锁骨的明暗 */
function vestTex(L: Look): THREE.CanvasTexture {
  return paint(`vest|${L.top}|${L.trim}|${L.skin}`, 512, 512, (g, w, h) => {
    g.fillStyle = css(L.top); g.fillRect(0, 0, w, h);
    folds(g, w, h, 7, 0.16, 30);
    const cx = w / 2;
    // 敞开的前襟：自领口向下收成 V
    const top = 0.085 * w, bot = 0.012 * w, y1 = 0.6 * h;
    g.fillStyle = css(L.skin);
    g.beginPath(); g.moveTo(cx - top, 0); g.lineTo(cx + top, 0); g.lineTo(cx + bot, y1); g.lineTo(cx - bot, y1); g.closePath(); g.fill();
    const shadow = (x: number, y: number, rx: number, ry: number, a: number) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      gr.addColorStop(0, `rgba(70,35,20,${a})`); gr.addColorStop(1, 'rgba(70,35,20,0)');
      g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y);
      g.fillStyle = gr; g.fillRect(x - 200, y - 200, 400, 400); g.restore();
    };
    g.save();
    g.beginPath(); g.moveTo(cx - top, 0); g.lineTo(cx + top, 0); g.lineTo(cx + bot, y1); g.lineTo(cx - bot, y1); g.closePath(); g.clip();
    shadow(cx, 0.3 * h, 7, 70, 0.5);                    // 胸沟
    for (const s of [-1, 1]) { shadow(cx + s * 34, 0.38 * h, 34, 9, 0.5); shadow(cx + s * 30, 0.07 * h, 30, 5, 0.4); }   // 胸肌下缘、锁骨
    for (const y of [0.45, 0.51, 0.57]) shadow(cx, y * h, 16, 3.5, 0.32);  // 腹
    g.restore();
    // 衣襟的滚边与针脚
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 15; g.beginPath(); g.moveTo(cx + s * (top + 5), -4); g.lineTo(cx + s * (bot + 5), y1 + 4); g.stroke();
      g.strokeStyle = css(L.trim); g.lineWidth = 11; g.beginPath(); g.moveTo(cx + s * (top + 4), -4); g.lineTo(cx + s * (bot + 4), y1 + 4); g.stroke();
      g.strokeStyle = 'rgba(210,200,170,0.5)'; g.lineWidth = 1.4; g.setLineDash([4, 5]);
      g.beginPath(); g.moveTo(cx + s * (top + 13), 0); g.lineTo(cx + s * (bot + 13), y1); g.stroke(); g.setLineDash([]);
    }
    // 侧缝、后背中缝与补丁
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2.5;
    for (const x of [0.25 * w, 0.75 * w, 1, w - 1]) { g.beginPath(); g.moveTo(x, 0.1 * h); g.lineTo(x, h); g.stroke(); }
    patch(g, 0.68 * w, 0.52 * h, 46, 38, '#5a4d3c', 0.12);
    patch(g, 0.12 * w, 0.4 * h, 54, 44, css(shade(L.top, 0.74)), -0.08);
    // 下缘磨损
    const gr = g.createLinearGradient(0, 0.72 * h, 0, h);
    gr.addColorStop(0, 'rgba(120,105,80,0)'); gr.addColorStop(1, 'rgba(120,105,80,0.22)');
    g.fillStyle = gr; g.fillRect(0, 0.72 * h, w, 0.28 * h);
  }, 0.17, true);
}

function skirtTex(L: Look): THREE.CanvasTexture {
  const plain = !!L.open;
  const dye = L.dye ?? shade(L.top, plain ? 0.8 : 0.86);
  return paint(`skirt|${L.top}|${dye}|${L.trim}|${plain}`, 256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, css(L.top)); gr.addColorStop(0.42, css(L.top)); gr.addColorStop(1, css(dye));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    folds(g, w, h, 11, plain ? 0.2 : 0.14, 22);
    if (plain) {
      // 沾尘的下缘与毛边
      const d = g.createLinearGradient(0, 0.6 * h, 0, h);
      d.addColorStop(0, 'rgba(125,108,82,0)'); d.addColorStop(1, 'rgba(125,108,82,0.3)');
      g.fillStyle = d; g.fillRect(0, 0.6 * h, w, 0.4 * h);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, h * 0.975, w, h * 0.025);
      patch(g, 0.3 * w, 0.62 * h, 50, 42, '#5a4d3c', 0.1);
    } else {
      g.fillStyle = css(L.trim); g.fillRect(0, h * 0.955, w, h * 0.045);
    }
    g.fillStyle = shadeA(L.trim, 0.8); g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
  }, plain ? 0.17 : 0.1, plain);
}

function sleeveTex(L: Look): THREE.CanvasTexture {
  return paint(`sleeve|${L.top}|${L.trim}`, 256, 256, (g, w, h) => {
    g.fillStyle = css(L.top); g.fillRect(0, 0, w, h);
    folds(g, w, h, 19, 0.12, 16);
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + (i % 3) * 0.025})`; g.fillRect(0, h * (0.2 + i * 0.085), w, 3); }
    g.fillStyle = css(L.trim); g.fillRect(0, h * 0.93, w, h * 0.07);
  }, 0.1);
}

/** 赤臂的皮肤：三角肌、二头肌、肘窝、前臂肌群之间的明暗 */
function armTex(L: Look): THREE.CanvasTexture {
  return paint(`arm|${L.skin}`, 128, 256, (g, w, h) => {
    g.fillStyle = css(L.skin); g.fillRect(0, 0, w, h);
    const band = (v: number, sp: number, a: number) => {
      const gr = g.createLinearGradient(0, (v - sp) * h, 0, (v + sp) * h);
      gr.addColorStop(0, 'rgba(70,35,20,0)'); gr.addColorStop(0.5, `rgba(70,35,20,${a})`); gr.addColorStop(1, 'rgba(70,35,20,0)');
      g.fillStyle = gr; g.fillRect(0, (v - sp) * h, w, sp * 2 * h);
    };
    band(0.2, 0.035, 0.34);    // 三角肌下缘
    band(0.52, 0.03, 0.3);     // 肘
    band(0.62, 0.02, 0.16);
    // 肌束之间的纵沟
    for (const [u, v0, v1, a] of [[0.5, 0.22, 0.5, 0.22], [0.2, 0.24, 0.5, 0.14], [0.8, 0.24, 0.5, 0.14], [0.42, 0.62, 0.95, 0.16], [0.7, 0.62, 0.95, 0.12]] as const) {
      const gr = g.createLinearGradient((u - 0.05) * w, 0, (u + 0.05) * w, 0);
      gr.addColorStop(0, 'rgba(70,35,20,0)'); gr.addColorStop(0.5, `rgba(70,35,20,${a})`); gr.addColorStop(1, 'rgba(70,35,20,0)');
      g.fillStyle = gr; g.fillRect((u - 0.05) * w, v0 * h, 0.1 * w, (v1 - v0) * h);
    }
    // 肩头与前臂外侧的受光
    const hl = g.createRadialGradient(0.5 * w, 0.1 * h, 0, 0.5 * w, 0.1 * h, 0.4 * w);
    hl.addColorStop(0, 'rgba(255,225,190,0.18)'); hl.addColorStop(1, 'rgba(255,225,190,0)');
    g.fillStyle = hl; g.fillRect(0, 0, w, 0.3 * h);
  }, 0.05);
}

/** 一圈圈缠裹的布条（缠臂、绑腿） */
function wrapTex(color: Col): THREE.CanvasTexture {
  return paint(`wrap|${color}`, 128, 256, (g, w, h) => {
    g.fillStyle = css(color); g.fillRect(0, 0, w, h);
    for (let i = -2; i < 14; i++) {
      const y = i * (h / 11);
      g.strokeStyle = 'rgba(0,0,0,0.42)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, y + 26); g.lineTo(w, y); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y + 30); g.lineTo(w, y + 4); g.stroke();
    }
  }, 0.16, true);
}

function beltTex(L: Look): THREE.CanvasTexture {
  const rough = !!L.open;
  return paint(`belt|${L.sash}|${L.bracer}|${rough}`, 256, 64, (g, w, h) => {
    g.fillStyle = css(L.sash); g.fillRect(0, 0, w, h);
    g.fillStyle = shadeA('#000000', 0.22); for (let x = 0; x < w; x += 11) g.fillRect(x, 0, 2, h);
    // 布腰带外再勒一条皮带
    g.fillStyle = css(L.bracer); g.fillRect(0, h * 0.3, w, h * 0.4);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h * 0.3, w, 2); g.fillRect(0, h * 0.7 - 2, w, 2);
    g.fillStyle = rough ? '#5c5a58' : '#c9ced6'; g.fillRect(w / 2 - 12, h * 0.24, 24, h * 0.52);
    g.fillStyle = rough ? '#2a2826' : '#6f7a88'; g.fillRect(w / 2 - 7, h * 0.34, 14, h * 0.32);
  }, 0.1, rough);
}

/** 斗笠：放射状的篾条与一圈圈的编纹 */
function hatTex(): THREE.CanvasTexture {
  return paint('douli', 512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#8f7440'); gr.addColorStop(0.5, '#b89a58'); gr.addColorStop(1, '#a88a4a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // 细密的放射篾条与同心编纹，各条深浅不一
    const r = rng(77);
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '70,48,18' : '255,236,186'},${0.08 + r() * 0.16})`; g.fillRect((i / 120) * w, 0, 1.5 + r() * 2, h); }
    for (let j = 0; j < 40; j++) { g.fillStyle = `rgba(${j % 2 ? '70,48,18' : '255,236,186'},${0.07 + r() * 0.1})`; g.fillRect(0, (j / 40) * h, w, 2); }
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(60,40,16,${0.1 + r() * 0.14})`; g.fillRect(r() * w, r() * h, 10 + r() * 40, 2 + r() * 3); }   // 陈旧的色斑
    g.fillStyle = 'rgba(50,32,12,0.75)'; g.fillRect(0, h - 14, w, 14);   // 笠沿的包边
    g.fillStyle = 'rgba(40,25,10,0.55)'; g.fillRect(0, 0, w, 16);        // 笠顶
  }, 0.14);
}

function faceTex(L: Look): THREE.CanvasTexture {
  return paint(`face|${L.skin}|${L.hair}|${L.beard ?? ''}|${L.stubble}|${L.scar}`, 512, 256, (g, w, h) => {
    g.fillStyle = css(L.skin); g.fillRect(0, 0, w, h);
    const cx = w * 0.25;
    const blush = (x: number, y: number, r: number, c: string) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const s of [-1, 1]) {
      blush(cx + s * 46, h * 0.58, 30, 'rgba(120,60,40,0.22)');   // 颧下的阴影
      blush(cx + s * 37, h * 0.47, 24, 'rgba(50,28,20,0.34)');    // 眼窝
    }
    blush(cx, h * 0.74, 46, 'rgba(60,38,30,0.16)');
    if (L.stubble) {
      // 胡茬：下颌、唇周一片青灰
      g.fillStyle = 'rgba(40,36,34,0.3)';
      g.beginPath(); g.ellipse(cx, h * 0.72, 62, 34, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(40,36,34,0.22)'; g.beginPath(); g.ellipse(cx, h * 0.615, 24, 8, 0, 0, Math.PI * 2); g.fill();
    }
    const dark = '#17110e';
    for (const s of [-1, 1]) {
      g.strokeStyle = dark; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx + s * 14, h * 0.44); g.quadraticCurveTo(cx + s * 38, h * 0.405, cx + s * 64, h * 0.415); g.stroke();
      g.fillStyle = '#ece6dc'; g.beginPath(); g.ellipse(cx + s * 37, h * 0.48, 13, 4.2, s * -0.06, 0, Math.PI * 2); g.fill();
      g.fillStyle = dark; g.beginPath(); g.ellipse(cx + s * 37, h * 0.48, 5.2, 4.6, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = dark; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + s * 21, h * 0.484); g.quadraticCurveTo(cx + s * 37, h * 0.455, cx + s * 55, h * 0.472); g.stroke();
    }
    g.strokeStyle = 'rgba(80,45,35,0.4)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx - 8, h * 0.578); g.quadraticCurveTo(cx, h * 0.592, cx + 8, h * 0.578); g.stroke();
    g.fillStyle = 'rgba(140,78,66,0.85)'; g.beginPath(); g.ellipse(cx, h * 0.645, 16, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(70,35,30,0.85)'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(cx - 17, h * 0.645); g.lineTo(cx + 17, h * 0.645); g.stroke();
    if (L.scar) {
      g.strokeStyle = 'rgba(150,80,70,0.85)'; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(cx + 48, h * 0.4); g.lineTo(cx + 30, h * 0.56); g.stroke();
    }
    if (L.beard !== undefined) {
      g.fillStyle = shadeA(L.beard, 0.94);
      g.beginPath(); g.ellipse(cx, h * 0.73, 60, 36, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = css(L.skin); g.beginPath(); g.ellipse(cx, h * 0.645, 17, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = shadeA(L.beard, 0.94); g.fillRect(cx - 32, h * 0.598, 64, 9);
    }
  }, 0.035);
}

/** 由球面雕出头颅：下颌、眉骨、鼻梁、眼窝。jaw 越小下颌越宽 */
function headGeo(jaw: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 30);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const j = Math.min(1, Math.max(0, (-y - 0.02) / 0.98));
    const wx = 1 - jaw * Math.pow(j, 1.35), wz = 1 - 0.2 * Math.pow(j, 1.6);
    const X = x * 0.0805 * wx;
    let Y = y * 0.114, Z = z * 0.094 * (z < 0 ? 1.1 : 1) * wz;
    if (z > 0) {
      const front = Math.min(1, z * 1.6);
      Z += 0.013 * j * front;
      Z += 0.018 * Math.exp(-Math.pow(x / 0.14, 2)) * Math.exp(-Math.pow((y + 0.15) / 0.2, 2)) * front;
      Z += 0.006 * Math.exp(-Math.pow((y - 0.14) / 0.07, 2)) * front;
      Z -= 0.006 * Math.exp(-(Math.pow((Math.abs(x) - 0.4) / 0.17, 2) + Math.pow((y - 0.03) / 0.09, 2))) * front;
      Z += 0.004 * Math.exp(-(Math.pow(x / 0.2, 2) + Math.pow((y + 0.45) / 0.08, 2))) * front;
    }
    if (y < -0.75) Y = -0.114 * (0.75 + (-y - 0.75) * 0.7);
    p.setXYZ(i, X, Y, Z);
  }
  g.computeVertexNormals();
  return g;
}

/** 方正些的拳头 */
function fistGeo(k: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 16, 12);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const q = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < p.count; i++) {
    const x = q(p.getX(i), 0.62), y = q(p.getY(i), 0.7), z = q(p.getZ(i), 0.62);
    // 指节一侧略鼓
    p.setXYZ(i, x * 0.04 * k, y * 0.05, z * 0.033 * k + (y < -0.2 ? 0.006 : 0));
  }
  g.computeVertexNormals();
  return g;
}

/** 在已有几何体上做位移雕刻（胸肌、背肌等），不动蒙皮权重 */
function sculpt(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => [number, number, number]) {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = fn(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- 人物
const B = { hips: 0, spine: 1, chest: 2, head: 3, uaL: 4, faL: 5, hdL: 6, uaR: 7, faR: 8, hdR: 9, thL: 10, shL: 11, ftL: 12, thR: 13, shR: 14, ftR: 15 };
const HIP_Y = 0.99, SPINE_Y = 1.065, CHEST_Y = 1.235, HEAD_Y = 1.58, SHOULDER_Y = 1.49;
const HIPJ_Y = 0.96, HIPJ_X = 0.094, TH = 0.455, SH = 0.425, UA = 0.295, FA = 0.265;
/** 旧动画数据按腿长 0.88 调的骨盆位移，按新腿长等比放大 */
const HIP_SCALE = HIPJ_Y / 0.88;

export class Humanoid {
  root = new THREE.Group();
  body = new THREE.Group();
  hips = new THREE.Bone();
  spine = new THREE.Bone();
  chest = new THREE.Bone();
  head = new THREE.Bone();
  armR!: Arm; armL!: Arm; legR!: Leg; legL!: Leg;
  weaponR = new THREE.Group();
  weaponL = new THREE.Group();
  chains: Chain[] = [];
  sims: SimPart[] = [];
  chainHolder = new THREE.Group();
  skeleton!: THREE.Skeleton;
  /** 副手在主武器上的握点（武器局部坐标），无则不做 IK */
  gripPoint: THREE.Vector3 | null = null;
  bowString: { top: THREE.Mesh; bot: THREE.Mesh; arrow: THREE.Object3D; nock: THREE.Vector3 } | null = null;
  private upperLen = UA; private lowerLen = FA;
  private skinned: THREE.SkinnedMesh[] = [];
  private strong: boolean;
  private shoulderX: number;
  pose: Pose = restPose();

  constructor(public look: Look) {
    this.strong = look.build !== 'slim';
    this.shoulderX = this.strong ? 0.2 : 0.172;
    this.root.add(this.body);
    this.body.scale.setScalar(look.scale ?? 1);
    this.body.add(this.chainHolder);
    this.buildSkeleton();
    this.build();
    this.setPose(restPose());
    this.resetChains();
  }

  // -------------------- 骨架 --------------------
  private buildSkeleton() {
    const bk = this.look.bulk ?? 1;
    this.hips.position.set(0, HIP_Y, 0);
    this.spine.position.set(0, SPINE_Y - HIP_Y, 0);
    this.chest.position.set(0, CHEST_Y - SPINE_Y, 0);
    this.head.position.set(0, HEAD_Y - CHEST_Y, 0.004);
    for (const b of [this.hips, this.spine, this.chest, this.head]) b.rotation.order = 'YXZ';
    this.body.add(this.hips); this.hips.add(this.spine); this.spine.add(this.chest); this.chest.add(this.head);
    const arm = (side: number): Arm => {
      const upper = new THREE.Bone(), lower = new THREE.Bone(), hand = new THREE.Bone();
      upper.position.set(this.shoulderX * side * bk, SHOULDER_Y - CHEST_Y, 0);
      lower.position.set(0, -UA, 0); hand.position.set(0, -FA, 0);
      this.chest.add(upper); upper.add(lower); lower.add(hand);
      return { upper, lower, hand, side };
    };
    const leg = (side: number): Leg => {
      const upper = new THREE.Bone(), lower = new THREE.Bone(), foot = new THREE.Bone();
      upper.position.set(HIPJ_X * side * bk, HIPJ_Y - HIP_Y, 0);
      lower.position.set(0, -TH, 0); foot.position.set(0, -SH, 0);
      this.hips.add(upper); upper.add(lower); lower.add(foot);
      return { upper, lower, foot, side };
    };
    this.armL = arm(1); this.armR = arm(-1); this.legL = leg(1); this.legR = leg(-1);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton([
      this.hips, this.spine, this.chest, this.head,
      this.armL.upper, this.armL.lower, this.armL.hand, this.armR.upper, this.armR.lower, this.armR.hand,
      this.legL.upper, this.legL.lower, this.legL.foot, this.legR.upper, this.legR.lower, this.legR.foot,
    ]);
  }

  private skin(geo: THREE.BufferGeometry, material: THREE.Material): THREE.SkinnedMesh {
    const m = new THREE.SkinnedMesh(geo, material);
    m.frustumCulled = false;
    this.body.add(m);
    // 绑定前先更新世界矩阵：body 带缩放时（如孩童），绑定矩阵必须与骨骼逆矩阵处在同一空间
    m.updateWorldMatrix(true, false);
    m.bind(this.skeleton, m.matrixWorld);
    this.skinned.push(m);
    return m;
  }

  // -------------------- 建模 --------------------
  private build() {
    const L = this.look;
    const bk = L.bulk ?? 1;
    const S = this.strong;
    /** 壮实体格与清瘦体格之间取值 */
    const d = (strong: number, slim: number) => (S ? strong : slim) * bk;
    const bump = foldBump();
    const rough = !!L.open;
    const cloth = (map: THREE.Texture | undefined, color: Col = '#ffffff', double = false, gloss = rough ? 0.05 : 0.14) =>
      mat(color, { map, bump, bumpScale: rough ? 5 : 3, double, gloss });
    const skin = mat(L.skin, { kind: 'skin', gloss: 0.26 });
    const leather = (c: Col) => mat(c, { kind: 'leather', gloss: 0.3 });
    const silver = mat(rough ? '#6f7176' : '#c4cad3', { kind: 'metal', gloss: rough ? 0.7 : 0.92 });
    const hairM = mat(L.hair, { kind: 'hair', gloss: 0.5 });
    const hairM2 = mat(L.hair, { kind: 'hair', gloss: 0.5, double: true });
    const W1 = (b: number): [number, number][] => [[b, 1]];
    const W2 = (a: number, b: number, t: number): [number, number][] => [[a, 1 - t], [b, t]];
    const sx = this.shoulderX * bk;

    // ---- 腿：裤 + 绑腿/靴 ----
    for (const s of [1, -1]) {
      const th = s > 0 ? B.thL : B.thR, sh = s > 0 ? B.shL : B.shR, ft = s > 0 ? B.ftL : B.ftR;
      const x = HIPJ_X * s * bk;
      const kneeY = HIPJ_Y - TH, ankY = kneeY - SH;
      const lw = L.legwrap !== undefined;
      const baggy = lw ? 0.012 : 0;
      const pants: Ring[] = [
        { p: [x * 0.85, 1.0, 0], rx: d(0.086, 0.08), rz: d(0.094, 0.088), w: W1(B.hips) },
        { p: [x, 0.93, 0], rx: d(0.096, 0.086) + baggy, rz: d(0.102, 0.092) + baggy, w: W2(B.hips, th, 0.5) },
        { p: [x, 0.86, 0.006], rx: d(0.096, 0.084) + baggy, rz: d(0.104, 0.09) + baggy, w: W1(th) },
        { p: [x, 0.72, 0.008], rx: d(0.086, 0.074) + baggy, rz: d(0.094, 0.08) + baggy, w: W1(th) },
        { p: [x, 0.58, 0.004], rx: d(0.07, 0.064) + baggy, rz: d(0.076, 0.068) + baggy, w: W2(th, sh, 0.15) },
        { p: [x, kneeY, 0.008], rx: d(0.064, 0.059) + baggy, rz: d(0.068, 0.063) + baggy, w: W2(th, sh, 0.5) },
        { p: [x, 0.44, -0.004], rx: d(0.064, 0.058) + baggy, rz: d(0.07, 0.064) + baggy, w: W2(th, sh, 0.9) },
        { p: [x, 0.39, -0.008], rx: d(0.066, 0.056) + baggy * 0.6, rz: d(0.072, 0.062) + baggy * 0.6, w: W1(sh) },
        { p: [x, 0.36, -0.008], rx: d(0.058, 0.05), rz: d(0.064, 0.055), w: W1(sh) },
      ];
      this.skin(tubeGeo(pants, 14, true, true), cloth(undefined, L.pants));
      const lowM = lw ? mat('#ffffff', { map: wrapTex(L.legwrap!), bump, bumpScale: 4, gloss: 0.05 }) : leather(L.boots);
      const boot: Ring[] = [
        { p: [x, 0.395, -0.008], rx: d(0.062, 0.057), rz: d(0.068, 0.062), w: W1(sh), v: 0 },
        { p: [x, 0.36, -0.01], rx: d(0.064, 0.058), rz: d(0.072, 0.063), w: W1(sh), v: 0.1 },
        { p: [x, 0.3, -0.012], rx: d(0.06, 0.053), rz: d(0.068, 0.058), w: W1(sh), v: 0.3 },
        { p: [x, 0.2, -0.008], rx: d(0.048, 0.045), rz: d(0.054, 0.05), w: W1(sh), v: 0.6 },
        { p: [x, 0.13, -0.002], rx: d(0.042, 0.04), rz: d(0.048, 0.046), w: W2(sh, ft, 0.3), v: 0.8 },
        { p: [x, ankY, 0.0], rx: d(0.042, 0.04), rz: d(0.052, 0.05), w: W2(sh, ft, 0.6), v: 0.94 },
        { p: [x, 0.05, 0.004], rx: d(0.044, 0.042), rz: d(0.056, 0.055), w: W1(ft), v: 1 },
      ];
      this.skin(tubeGeo(boot, 14, true, true), lowM);
      if (!lw) {
        this.skin(tubeGeo([
          { p: [x, 0.402, -0.008], rx: d(0.065, 0.06), rz: d(0.071, 0.065), w: W1(sh) },
          { p: [x, 0.374, -0.008], rx: d(0.066, 0.061), rz: d(0.072, 0.066), w: W1(sh) },
        ], 14, true, true), mat(L.trim, { gloss: 0.2 }));
      }
      const leg = s > 0 ? this.legL : this.legR;
      // 脚：鞋面 + 鞋底，足尖微翘
      const foot = ellipsoid(0.047 * bk, 0.04, 0.126, 16, 10);
      const fp = foot.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < fp.count; i++) {
        const z = fp.getZ(i), y = fp.getY(i);
        const t = Math.max(0, z / 0.126);
        fp.setY(i, Math.max(-0.03, y) * (1 - 0.4 * t) + 0.01 * t * t);
        fp.setX(i, fp.getX(i) * (1 - 0.16 * t * t));
      }
      foot.computeVertexNormals();
      leg.foot.add(mesh(foot, lw ? cloth(undefined, L.boots) : leather(L.boots), { p: [0, -0.046, 0.058] }));
      leg.foot.add(mesh(box(0.084 * bk, lw ? 0.01 : 0.016, 0.236), lw ? mat('#a8a190', { gloss: 0.05 }) : leather(shade(L.boots, 0.55)), { p: [0, lw ? -0.079 : -0.077, 0.058] }));
    }

    // ---- 躯干 ----
    const vOf = (y: number) => (1.585 - y) / (1.585 - 0.93);
    const prof: [number, number, number, number, [number, number][]][] = [
      [0.93, 0.152, 0.146, 0.106, W1(B.hips)], [0.99, 0.158, 0.15, 0.108, W1(B.hips)], [1.04, 0.148, 0.14, 0.1, W2(B.hips, B.spine, 0.5)],
      [1.09, 0.138, 0.127, 0.091, W1(B.spine)], [1.16, 0.146, 0.131, 0.093, W2(B.spine, B.chest, 0.3)], [1.235, 0.166, 0.146, 0.1, W2(B.spine, B.chest, 0.7)],
      [1.32, 0.186, 0.162, 0.107, W1(B.chest)], [1.4, 0.198, 0.172, 0.109, W1(B.chest)], [1.46, 0.202, 0.176, 0.103, W1(B.chest)],
      [1.505, 0.19, 0.168, 0.092, W1(B.chest)], [1.525, 0.17, 0.152, 0.084, W1(B.chest)], [1.543, 0.134, 0.118, 0.074, W1(B.chest)],
      [1.56, 0.082, 0.066, 0.058, W1(B.chest)], [1.585, 0.062, 0.052, 0.052, W2(B.chest, B.head, 0.35)],
    ];
    const depthK = S ? 1.16 : 1;
    const torso: Ring[] = prof.slice().reverse().map(([y, rs, rl, rz, w]) => ({
      p: [0, y, y > 1.3 ? 0.004 : 0] as [number, number, number], rx: (S ? rs : rl) * bk, rz: rz * depthK * bk * (y > 1.54 ? 1 / depthK : 1), w, v: vOf(y),
    }));
    const torsoGeo = tubeGeo(torso, 28, false, true);
    if (S) {
      // 胸肌、肩胛与背阔的起伏
      sculpt(torsoGeo, (x, y, z) => {
        const ax = Math.abs(x);
        if (z > 0) z += 0.024 * bk * Math.exp(-Math.pow((ax - 0.085 * bk) / 0.062, 2)) * Math.exp(-Math.pow((y - 1.4) / 0.06, 2));
        else z -= 0.014 * bk * Math.exp(-Math.pow((ax - 0.1 * bk) / 0.07, 2)) * Math.exp(-Math.pow((y - 1.38) / 0.09, 2));
        return [x, y, z];
      });
    }
    this.skin(torsoGeo, cloth(L.open ? vestTex(L) : robeTopTex(L)));
    // 颈
    const nr = S ? 0.054 : 0.042;
    this.skin(tubeGeo([
      { p: [0, 1.63, 0.008], rx: nr * 0.93, rz: nr, w: W1(B.head) },
      { p: [0, 1.585, 0.006], rx: nr, rz: nr * 1.04, w: W2(B.chest, B.head, 0.5) },
      { p: [0, 1.54, 0.002], rx: nr * 1.14, rz: nr * 1.1, w: W1(B.chest) },
    ], 14, false, false), skin);
    if (!L.open) {
      this.skin(tubeGeo([
        { p: [0, 1.598, 0.004], rx: nr + 0.005, rz: nr + 0.008, w: W2(B.chest, B.head, 0.3) },
        { p: [0, 1.566, 0.004], rx: nr + 0.015, rz: nr + 0.014, w: W1(B.chest) },
      ], 16, false, false), mat(L.inner ?? shade(L.trim, 0.55), { double: true, gloss: 0.14 }));
    }

    // ---- 腰带 ----
    const belt: Ring[] = [
      { p: [0, 1.14, 0], rx: d(0.152, 0.137), rz: 0.099 * depthK * bk + 0.004, w: W1(B.spine), v: 0 },
      { p: [0, 1.09, 0], rx: d(0.148, 0.136), rz: 0.099 * depthK * bk + 0.004, w: W1(B.spine), v: 0.5 },
      { p: [0, 1.035, 0], rx: d(0.158, 0.148), rz: 0.108 * depthK * bk + 0.004, w: W2(B.hips, B.spine, 0.5), v: 1 },
    ];
    this.skin(tubeGeo(belt, 24, false, false), mat('#ffffff', { map: beltTex(L), bump, bumpScale: 3, gloss: 0.2, double: true }));

    // ---- 手臂 ----
    const sTex = sleeveTex(L);
    for (const s of [1, -1]) {
      const ua = s > 0 ? B.uaL : B.uaR, fa = s > 0 ? B.faL : B.faR, hd = s > 0 ? B.hdL : B.hdR;
      const x = sx * s;
      const elbowY = SHOULDER_Y - UA, wristY = elbowY - FA;
      const bare = L.sleeve === 'bare', wide = L.sleeve === 'wide';
      const loose = bare ? 0 : 0.007;
      // 三角肌、肱二头/三头、前臂的粗细起伏
      const up: Ring[] = [
        { p: [x * 0.72, 1.53, 0], rx: 0.01, rz: 0.012, w: W2(B.chest, ua, 0.2), v: 0 },
        { p: [x * 0.86, 1.53, 0], rx: d(0.042, 0.036), rz: d(0.05, 0.042), w: W2(B.chest, ua, 0.25), v: 0.02 },
        { p: [x * 0.94, 1.514, 0], rx: d(0.066, 0.05) + loose * 0.5, rz: d(0.074, 0.056) + loose * 0.5, w: W2(B.chest, ua, 0.4), v: 0.04 },
        { p: [x * 0.99, 1.48, 0], rx: d(0.076, 0.055) + loose, rz: d(0.084, 0.06) + loose, w: W2(B.chest, ua, 0.6), v: 0.08 },
        { p: [x * 1.01, 1.44, 0], rx: d(0.072, 0.054) + loose, rz: d(0.08, 0.058) + loose, w: W1(ua), v: 0.14 },
        { p: [x, 1.405, 0.002], rx: d(0.058, 0.05) + loose, rz: d(0.066, 0.054) + loose, w: W1(ua), v: 0.2 },
        { p: [x, 1.36, 0.012], rx: d(0.06, 0.049) + loose, rz: d(0.076, 0.053) + loose, w: W1(ua), v: 0.3 },
        { p: [x, 1.31, 0.008], rx: d(0.056, 0.046) + loose, rz: d(0.068, 0.05) + loose, w: W1(ua), v: 0.4 },
        { p: [x, 1.25, 0], rx: d(0.046, 0.044) + loose, rz: d(0.05, 0.047) + loose, w: W2(ua, fa, 0.15), v: 0.5 },
        { p: [x, elbowY, 0], rx: d(0.044, 0.042) + loose, rz: d(0.047, 0.045) + loose, w: W2(ua, fa, 0.5), v: 0.56 },
      ];
      if (wide) {
        up.push(
          { p: [x, 1.14, 0], rx: 0.056 * bk, rz: 0.06 * bk, w: W2(ua, fa, 0.9), v: 0.7 },
          { p: [x, 1.05, 0.004], rx: 0.064 * bk, rz: 0.07 * bk, w: W1(fa), v: 0.82 },
          { p: [x, 0.97, 0.008], rx: 0.072 * bk, rz: 0.08 * bk, w: W1(fa), v: 0.94 },
          { p: [x, 0.93, 0.01], rx: 0.076 * bk, rz: 0.085 * bk, w: W1(fa), v: 1 },
        );
      } else {
        up.push(
          { p: [x, 1.15, 0.004], rx: d(0.055, 0.042) + loose, rz: d(0.06, 0.045) + loose, w: W2(ua, fa, 0.88), v: 0.66 },
          { p: [x, 1.09, 0.003], rx: d(0.052, 0.04) + loose * 0.7, rz: d(0.057, 0.043) + loose * 0.7, w: W1(fa), v: 0.78 },
          { p: [x, 1.0, 0], rx: d(0.04, 0.035), rz: d(0.043, 0.037), w: W1(fa), v: 0.94 },
          { p: [x, wristY, 0], rx: d(0.034, 0.03), rz: d(0.035, 0.031), w: W2(fa, hd, 0.3), v: 1 },
        );
      }
      this.skin(tubeGeo(up, 16, true, !wide), bare ? mat('#ffffff', { map: armTex(L), gloss: 0.2 }) : wide ? mat('#ffffff', { map: sTex, bump, bumpScale: 3, double: true, gloss: 0.14 }) : cloth(sTex));
      if (wide) {
        this.skin(tubeGeo([
          { p: [x, 1.16, 0], rx: 0.037, rz: 0.04, w: W2(ua, fa, 0.9) },
          { p: [x, 1.06, 0], rx: 0.034, rz: 0.037, w: W1(fa) },
          { p: [x, wristY, 0], rx: 0.029, rz: 0.03, w: W2(fa, hd, 0.3) },
        ], 12, false, true), skin);
      } else if (L.wraps !== undefined) {
        // 缠臂布
        this.skin(tubeGeo([
          { p: [x, 1.125, 0.003], rx: d(0.056, 0.044), rz: d(0.061, 0.047), w: W1(fa), v: 0 },
          { p: [x, 1.09, 0.003], rx: d(0.056, 0.044), rz: d(0.061, 0.047), w: W1(fa), v: 0.15 },
          { p: [x, 1.0, 0], rx: d(0.044, 0.039), rz: d(0.047, 0.041), w: W1(fa), v: 0.65 },
          { p: [x, 0.945, 0], rx: d(0.038, 0.034), rz: d(0.04, 0.035), w: W1(fa), v: 1 },
        ], 14, false, false), mat('#ffffff', { map: wrapTex(L.wraps), bump, bumpScale: 4, gloss: 0.05 }));
      } else {
        // 护腕
        this.skin(tubeGeo([
          { p: [x, 1.148, 0], rx: d(0.054, 0.046), rz: d(0.058, 0.049), w: W1(fa), v: 0 },
          { p: [x, 1.09, 0], rx: d(0.053, 0.045), rz: d(0.058, 0.048), w: W1(fa), v: 0.3 },
          { p: [x, 1.0, 0], rx: d(0.044, 0.039), rz: d(0.047, 0.041), w: W1(fa), v: 0.75 },
          { p: [x, 0.955, 0], rx: d(0.039, 0.034), rz: d(0.04, 0.036), w: W1(fa), v: 1 },
        ], 14, false, false), leather(L.bracer));
        for (const y of [1.132, 0.972]) {
          const r = y > 1.1 ? d(0.056, 0.05) : d(0.042, 0.038);
          this.skin(tubeGeo([
            { p: [x, y + 0.007, 0], rx: r, rz: r + 0.004, w: W1(fa) },
            { p: [x, y - 0.007, 0], rx: r, rz: r + 0.004, w: W1(fa) },
          ], 14, false, false), bare ? leather(shade(L.bracer, 0.7)) : silver);
        }
      }
      const a = s > 0 ? this.armL : this.armR;
      const hk = S ? 1.08 : 0.9;
      a.hand.add(mesh(fistGeo(hk * bk), skin, { p: [0, -0.052, 0.004] }));
      // 缠过虎口与手背的布条
      if (L.wraps !== undefined) a.hand.add(mesh(fistGeo(hk * bk * 1.06), mat('#ffffff', { map: wrapTex(L.wraps), bump, bumpScale: 4, gloss: 0.05 }), { p: [0, -0.036, 0.004], s: [1, 0.62, 1] }));
      a.hand.add(mesh(limb(0.0115 * hk, 0.0095 * hk, 0.036, 6), skin, { p: [0.03 * -s * bk * hk, -0.036, 0.018], r: [-55, 0, 18 * s] }));
    }
    this.weaponR.position.set(0, -0.075, 0.006);
    this.armR.hand.add(this.weaponR);
    this.weaponL.position.set(0, -0.075, 0.006);
    this.armL.hand.add(this.weaponL);

    if (L.mantle !== undefined) {
      const fur = mat(L.mantle, { kind: 'fur' });
      const r = rng(5);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.chest.add(mesh(ellipsoid(0.075 + r() * 0.02, 0.052 + r() * 0.015, 0.072 + r() * 0.02), fur, {
          p: [Math.sin(a) * (sx - 0.01), 0.285 - Math.abs(Math.sin(a)) * 0.035 + r() * 0.01, Math.cos(a) * 0.118 * bk], r: [r() * 40, r() * 90, 0],
        }));
      }
    }

    // ---- 下摆：三片布料（后、前左、前右） ----
    const wx = d(0.158, 0.15), wz = 0.108 * depthK * bk;
    if (L.skirt > 0) {
      const len = L.skirt;
      const m = mat('#ffffff', { map: skirtTex(L), bump, bumpScale: rough ? 5 : 3, double: true, gloss: rough ? 0.05 : 0.15 });
      const rows = Math.max(4, Math.round(len / 0.065) + 1);
      const mk = (a0: number, a1: number, cols: number, seed: number, grow = 0) => {
        const rest: THREE.Vector3[] = [];
        const r = rng(seed);
        const ph0 = r() * 6;
        for (let j = 0; j < rows; j++) {
          const t = j / (rows - 1);
          const flare = 1 + (len > 0.5 ? 0.72 : 0.42) * Math.pow(t, 0.85);
          for (let c = 0; c < cols; c++) {
            const u = c / (cols - 1);
            const ang = (a0 + (a1 - a0) * u) * DEG;
            const pleat = 1 + 0.07 * t * Math.sin(u * (cols - 1) * 1.9 + ph0);
            rest.push(new THREE.Vector3(Math.sin(ang) * (wx + grow) * flare * pleat, 1.045 - len * t, Math.cos(ang) * (wz + grow) * flare * pleat));
          }
        }
        this.sims.push(new Cloth(cols, rows, rest, this.hips, this.chainHolder, m, 0.92, 0.955));
      };
      mk(84, 276, 12, 5);
      mk(-2, 106, 8, 3, 0.006);
      mk(-106, 2, 8, 4, 0.006);
    }

    // ---- 颈间的旧围巾：绕颈一圈，余下一截垂在背后 ----
    if (L.scarf !== undefined) {
      const sm = mat(L.scarf, { bump, bumpScale: 5, double: true, gloss: 0.05, map: paint(`scarf|${L.scarf}`, 64, 256, (g, w, h) => {
        g.fillStyle = css(L.scarf!); g.fillRect(0, 0, w, h); folds(g, w, h, 23, 0.22, 8);
        g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 2; x < w; x += 6) g.fillRect(x, h - 22, 2, 22);
      }, 0.18, true) });
      this.skin(tubeGeo([
        { p: [0, 1.612, 0.006], rx: nr + 0.012, rz: nr + 0.016, w: W2(B.chest, B.head, 0.4) },
        { p: [0, 1.585, 0.006], rx: nr + 0.026, rz: nr + 0.03, w: W2(B.chest, B.head, 0.2) },
        { p: [0, 1.553, 0.004], rx: nr + 0.034, rz: nr + 0.036, w: W1(B.chest) },
        { p: [0, 1.53, 0.0], rx: nr + 0.026, rz: nr + 0.03, w: W1(B.chest) },
      ], 16, false, false), sm);
      const cols = 4, rows = 9, rest: THREE.Vector3[] = [];
      for (let j = 0; j < rows; j++) for (let c = 0; c < cols; c++) {
        rest.push(new THREE.Vector3(-0.02 + (c / (cols - 1) - 0.5) * 0.13, 1.56 - j * 0.066, -(nr + 0.036) - Math.min(j, 3) * 0.012));
      }
      this.sims.push(new Cloth(cols, rows, rest, this.chest, this.chainHolder, sm, 0.9, 0.95, 0.9));
    }

    // ---- 腰间的酒葫芦 ----
    if (L.gourd) {
      const gm = mat('#b07f38', { kind: 'flat', gloss: 0.42 });
      this.chains.push(new Chain(this.hips, new THREE.Vector3(-wx * 0.92, 0.055, wz * 0.55), 0.07, 2, this.chainHolder, (i) => {
        if (i === 0) return mesh(cyl(0.004, 0.004, 0.07, 5), mat('#7a2a20', { gloss: 0.1 }), { p: [0, -0.035, 0] });
        const g = lathe([[0.002, -0.158], [0.03, -0.15], [0.046, -0.118], [0.044, -0.09], [0.024, -0.068], [0.03, -0.05], [0.028, -0.032], [0.012, -0.018], [0.01, 0], [0.002, 0.004]], 16);
        return mesh(g, gm);
      }));
    } else if (L.crown !== undefined || L.hairStyle === 'flow') {
      const jade = mat('#8fd0b8', { kind: 'flat', gloss: 0.75 });
      this.chains.push(new Chain(this.hips, new THREE.Vector3(-wx * 0.7, 0.05, wz * 0.8), 0.06, 4, this.chainHolder, (i) => {
        if (i === 1) return mesh(new THREE.TorusGeometry(0.024, 0.009, 6, 14), jade, { p: [0, 0, 0] });
        if (i >= 2) return mesh(limb(0.008 + (i - 2) * 0.006, 0.012 + (i - 2) * 0.006, 0.06, 6), mat(L.ribbon ?? L.sash, { gloss: 0.2 }));
        return mesh(cyl(0.003, 0.003, 0.06, 4), mat('#d8d4c8', { kind: 'flat' }), { p: [0, -0.03, 0] });
      }));
    }

    this.buildHead(skin, hairM, hairM2, silver);
    this.buildWeapon(silver, depthK);
  }

  private buildHead(skin: THREE.Material, hairM: THREE.Material, hairM2: THREE.Material, silver: THREE.Material) {
    const L = this.look;
    const hc: [number, number, number] = [0, 0.118, 0.006];
    this.head.add(mesh(headGeo(this.strong ? 0.34 : 0.46), mat('#ffffff', { map: faceTex(L), gloss: 0.24 }), { p: hc }));
    for (const s of [-1, 1]) this.head.add(mesh(ellipsoid(0.01, 0.022, 0.014), skin, { p: [0.079 * s, hc[1] - 0.004, hc[2] - 0.004] }));
    if (L.mask !== undefined) {
      this.head.add(mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI * 0.53, Math.PI * 0.4).scale(0.074, 0.118, 0.099), mat(L.mask, { gloss: 0.06 }), { p: [hc[0], hc[1], hc[2] + 0.004] }));
    }
    const hairStyle = L.hairStyle;
    if (hairStyle !== 'bald') {
      const cap = new THREE.SphereGeometry(1, 36, 22, 0, Math.PI * 2, 0, 1.8);
      const cp = cap.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
        const lobe = 1 + 0.03 * Math.sin(Math.atan2(x, z) * 11) * Math.max(0, 1 - y) * Math.max(0, -z + 0.2);
        cp.setXYZ(i, x * 0.0872 * lobe, y * 0.1205, z * 0.106 * lobe);
      }
      cap.computeVertexNormals();
      this.head.add(mesh(cap, hairM, { p: [0, hc[1] + 0.006, hc[2] - 0.013], r: [-37, 0, 0] }));
      for (const s of [-1, 1]) this.head.add(mesh(ellipsoid(0.014, 0.05, 0.03), hairM, { p: [0.079 * s, hc[1] + 0.012, hc[2] + 0.022], r: [8, 0, 0] }));
    }
    const top: [number, number, number] = [0, hc[1] + 0.118, hc[2] - 0.03];
    const crown = L.crown ?? (hairStyle === 'flow' ? '#c4cad3' : undefined);
    if (hairStyle === 'flow' || hairStyle === 'topknot' || hairStyle === 'ponytail') {
      this.head.add(mesh(ellipsoid(0.036, 0.04, 0.038), hairM, { p: [top[0], top[1] + 0.014, top[2]] }));
      if (crown !== undefined) {
        const cm = mat(crown, { kind: 'metal', gloss: 0.92 });
        this.head.add(mesh(new THREE.TorusGeometry(0.031, 0.008, 6, 18), cm, { p: [top[0], top[1] - 0.008, top[2]], r: [90, 0, 0] }));
        this.head.add(mesh(cyl(0.0032, 0.0032, 0.13, 6), cm, { p: [top[0], top[1] + 0.014, top[2]], r: [0, 0, 90] }));
      } else {
        this.head.add(mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 16), mat(L.ribbon ?? L.trim, { gloss: 0.1 }), { p: [top[0], top[1] - 0.012, top[2]], r: [80, 0, 0] }));
      }
    }
    if (hairStyle === 'bun') {
      this.head.add(mesh(ellipsoid(0.046, 0.04, 0.046), hairM, { p: [0, hc[1] + 0.02, hc[2] - 0.112] }));
      if (L.hat !== 'douli') this.head.add(mesh(cyl(0.004, 0.004, 0.15, 6), silver, { p: [0, hc[1] + 0.026, hc[2] - 0.112], r: [0, 0, 70] }));
    }
    if (hairStyle === 'buns') {
      for (const s of [-1, 1]) this.head.add(mesh(ellipsoid(0.04, 0.04, 0.04), hairM, { p: [0.062 * s, hc[1] + 0.112, hc[2] - 0.03] }));
    }
    const strand = (lx: number, ly: number, lz: number, n: number, seg: number, w0: number, w1: number, out: THREE.Vector3, dir: THREE.Vector3, stiff = 2) => {
      this.sims.push(new Ribbon(this.head, new THREE.Vector3(lx, ly, lz), seg, n, this.chainHolder, hairM2,
        (t) => [w0 + (w1 - w0) * t, 0.011 - t * 0.006], out, dir, 0.94, stiff));
    };
    if (hairStyle === 'flow' || hairStyle === 'loose') {
      const N = 9;
      for (let i = 0; i < N; i++) {
        const a = ((i - (N - 1) / 2) / ((N - 1) / 2)) * 1.18;
        const x = Math.sin(a) * 0.083, z = -Math.cos(a) * 0.098 + hc[2] - 0.012;
        const edge = Math.abs(a) / 1.18;
        strand(x, hc[1] - 0.012 - edge * 0.008, z, 8 - Math.round(edge * 2), 0.07, 0.03, 0.016,
          new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), new THREE.Vector3(Math.sin(a) * 0.3, -1, -Math.cos(a) * 0.3), 2);
      }
    }
    if (hairStyle === 'ponytail') {
      for (let i = 0; i < 4; i++) {
        const a = (i - 1.5) * 0.5;
        strand(Math.sin(a) * 0.022, top[1] + 0.012, top[2] - 0.03 - Math.cos(a) * 0.012, 8, 0.07, 0.026, 0.012,
          new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), new THREE.Vector3(Math.sin(a) * 0.4, 0.2, -1), 2);
      }
    }
    if (hairStyle === 'flow' || hairStyle === 'ponytail') {
      for (const s of [-1, 1]) {
        strand(0.083 * s, hc[1] + 0.035, hc[2] + 0.04, 4, 0.058, 0.009, 0.005, new THREE.Vector3(s, 0, 0.3), new THREE.Vector3(s * 0.55, -1, 0.12), 1);
      }
    }
    if (L.ribbon !== undefined && hairStyle !== 'bald' && L.hat !== 'douli') {
      const ribM = mat(L.ribbon, { double: true, gloss: 0.12 });
      for (const s of [-1, 1]) {
        this.sims.push(new Ribbon(this.head, new THREE.Vector3(0.012 * s, top[1] - 0.03, top[2] - 0.04), 0.07, 6, this.chainHolder, ribM,
          (t) => [0.011 - t * 0.003, 0.002], new THREE.Vector3(0, 0, -1), new THREE.Vector3(s * 0.3, -0.6, -1).normalize(), 0.95, 1));
      }
    }
    if (L.hat === 'douli') {
      // 斗笠：宽檐压低，笠下露出鬓角与下颌；两根系绳勒在颌下
      const hm = mat('#ffffff', { map: hatTex(), bump: hatTex(), bumpScale: 4, double: true, gloss: 0.06 });
      const hat = group({ p: [0, hc[1] + 0.07, hc[2] - 0.004], r: [7, 0, 0] });
      hat.add(mesh(lathe([[0.288, 0], [0.28, 0.012], [0.19, 0.062], [0.096, 0.112], [0.03, 0.144], [0.002, 0.15]], 40), hm));
      hat.add(mesh(new THREE.TorusGeometry(0.286, 0.008, 6, 40), mat('#4a3418', { gloss: 0.08 }), { p: [0, 0.004, 0], r: [90, 0, 0] }));
      hat.add(mesh(ellipsoid(0.02, 0.014, 0.02), mat('#4a3418', { gloss: 0.08 }), { p: [0, 0.152, 0] }));
      this.head.add(hat);
      const cord = mat('#2a211a', { kind: 'flat', gloss: 0.05 });
      for (const s of [-1, 1]) {
        this.head.add(mesh(tube([[0.1 * s, hc[1] + 0.085, 0.012], [0.086 * s, hc[1] - 0.02, 0.03], [0.05 * s, hc[1] - 0.1, 0.062], [0, hc[1] - 0.124, 0.074]], 0.0045, 5, 14), cord));
      }
    }
    if (L.hat === 'bandana') {
      this.head.add(mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, 1.3).scale(0.09, 0.124, 0.11), mat(L.ribbon ?? L.sash, { gloss: 0.06 }), {
        p: [0, hc[1] + 0.008, hc[2] - 0.008], r: [-20, 0, 0],
      }));
    }
    if (L.hat === 'cap') {
      this.head.add(mesh(lathe([[0.09, 0], [0.088, 0.05], [0.06, 0.1], [0.01, 0.112]], 18), mat(L.ribbon ?? L.trim, { gloss: 0.08 }), { p: [0, hc[1] + 0.05, hc[2] - 0.012], s: [1, 1, 1.18] }));
    }
  }

  private buildWeapon(silver: THREE.Material, depthK: number) {
    const L = this.look;
    const rough = !!L.open;
    const ws = L.weaponScale ?? 1;
    const steel = mat(L.bladeColor ?? '#b9c4d0', { kind: 'metal', gloss: 0.97 });
    const gold = mat(rough ? '#6a5a3c' : '#b99a52', { kind: 'metal', gloss: rough ? 0.6 : 0.85 });
    const wood = mat('#4a2f1c', { kind: 'leather', gloss: 0.3 });
    const red = mat('#8a2a20', { gloss: 0.12 });
    const W = this.weaponR;
    W.scale.setScalar(ws);
    if (L.weapon === 'sword') {
      // 柄上缠了布条的朴素铁剑
      W.add(mesh(cyl(0.014, 0.013, 0.2, 8), mat('#ffffff', { map: wrapTex(rough ? '#4a4034' : '#23262e'), gloss: 0.1 }), { p: [0, 0, -0.012], r: [90, 0, 0] }));
      W.add(mesh(ellipsoid(0.018, 0.018, 0.02), silver, { p: [0, 0, -0.12] }));
      W.add(mesh(box(0.022, 0.1, 0.018), silver, { p: [0, 0, 0.094] }));
      const blade = cyl(0.019, 0.023, 0.8, 4); blade.rotateY(45 * DEG); blade.scale(0.24, 1, 1); blade.rotateX(90 * DEG);
      W.add(mesh(blade, steel, { p: [0, 0, 0.5] }));
      const tip = cyl(0.0, 0.019, 0.11, 4); tip.rotateY(45 * DEG); tip.scale(0.24, 1, 1); tip.rotateX(90 * DEG);
      W.add(mesh(tip, steel, { p: [0, 0, 0.955] }));
      if (!rough) {
        const tas = mat(L.ribbon ?? '#e8ecf0', { gloss: 0.2 });
        this.chains.push(new Chain(W, new THREE.Vector3(0, 0, -0.135), 0.05, 4, this.chainHolder, (i) => mesh(limb(0.005 + Math.max(0, i - 1) * 0.004, 0.006 + Math.max(0, i - 1) * 0.005, 0.05, 6), tas)));
      }
      this.addScabbard(rough ? '#3a2a1c' : '#22252c', 1.0, silver, depthK);
    } else if (L.weapon === 'saber') {
      W.add(mesh(cyl(0.016, 0.015, 0.2, 8), mat('#ffffff', { map: wrapTex('#4a1a16'), gloss: 0.1 }), { p: [0, 0, -0.02], r: [90, 0, 0] }));
      W.add(mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 14), gold, { p: [0, 0, -0.135], r: [0, 90, 0] }));
      W.add(mesh(cyl(0.044, 0.044, 0.012, 14), gold, { p: [0, 0, 0.086], r: [90, 0, 0] }));
      const s = new THREE.Shape();
      s.moveTo(0.09, 0.02);
      s.lineTo(0.56, 0.028);
      s.quadraticCurveTo(0.8, 0.042, 0.93, 0.105);
      s.quadraticCurveTo(0.82, -0.05, 0.62, -0.06);
      s.quadraticCurveTo(0.3, -0.058, 0.09, -0.028);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.012, bevelSegments: 1, curveSegments: 12 });
      g.translate(0, 0, -0.004);
      g.rotateY(-90 * DEG);
      W.add(mesh(g, steel));
      this.chains.push(new Chain(W, new THREE.Vector3(0, 0, -0.15), 0.055, 3, this.chainHolder, () => {
        const b = box(0.028, 0.055, 0.004); b.translate(0, -0.0275, 0); return mesh(b, mat('#8a2a20', { double: true, gloss: 0.1 }));
      }));
      this.addScabbard('#3a1512', 0.98, silver, depthK);
    } else if (L.weapon === 'spear') {
      W.add(mesh(cyl(0.014, 0.014, 2.1, 8), wood, { p: [0, 0, 0.22], r: [90, 0, 0] }));
      W.add(mesh(cyl(0.019, 0.015, 0.06, 8), silver, { p: [0, 0, -0.84], r: [90, 0, 0] }));
      W.add(mesh(cyl(0.019, 0.019, 0.05, 8), silver, { p: [0, 0, 1.24], r: [90, 0, 0] }));
      const head = cyl(0, 0.038, 0.32, 4); head.rotateY(45 * DEG); head.scale(0.28, 1, 1); head.rotateX(90 * DEG);
      W.add(mesh(head, steel, { p: [0, 0, 1.45] }));
      const neck = cyl(0.038, 0.015, 0.06, 4); neck.rotateY(45 * DEG); neck.scale(0.28, 1, 1); neck.rotateX(90 * DEG);
      W.add(mesh(neck, steel, { p: [0, 0, 1.275] }));
      W.add(mesh(lathe([[0.06, -0.11], [0.048, -0.05], [0.018, 0]], 12), mat('#8f241b', { double: true, gloss: 0.1 }), { p: [0, 0, 1.21], r: [-90, 0, 0] }));
      this.gripPoint = new THREE.Vector3(0, 0, 0.56);
    } else if (L.weapon === 'bow') {
      const Bw = this.weaponL;
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * 2 - 1, a = Math.abs(t);
        pts.push([0, 0.22 * t * t - (a > 0.75 ? (a - 0.75) * 0.3 : 0), t * 0.64]);
      }
      Bw.add(mesh(tube(pts, 0.012, 6, 32), wood));
      Bw.add(mesh(cyl(0.018, 0.018, 0.13, 8), red, { p: [0, 0, 0], r: [90, 0, 0] }));
      const strM = mat('#e9e2cf', { kind: 'flat' });
      const mk = () => { const g = cyl(0.0028, 0.0028, 1, 4); g.translate(0, 0.5, 0); return mesh(g, strM); };
      const topS = mk(), botS = mk();
      Bw.add(topS, botS);
      const arrow = group({},
        mesh(cyl(0.005, 0.005, 0.8, 5), mat('#c9b48a', { kind: 'flat' }), { p: [0, -0.4, 0] }),
        mesh(cyl(0, 0.012, 0.05, 4), steel, { p: [0, -0.82, 0], r: [180, 0, 0] }),
        mesh(box(0.004, 0.09, 0.036), mat('#eeeeee', { double: true }), { p: [0, -0.06, 0] }),
      );
      Bw.add(arrow);
      this.bowString = { top: topS, bot: botS, arrow, nock: new THREE.Vector3() };
      const bz = -0.11 * depthK - 0.03;
      this.chest.add(mesh(cyl(0.04, 0.035, 0.46, 10), mat('#4a3120', { kind: 'leather', gloss: 0.3 }), { p: [-0.06, 0.1, bz], r: [0, 0, 24] }));
      for (let i = 0; i < 4; i++) {
        this.chest.add(mesh(box(0.004, 0.08, 0.03), mat('#eeeeee', { double: true }), { p: [-0.165 + i * 0.012, 0.345 + (i % 2) * 0.02, bz + (i - 1.5) * 0.012], r: [0, i * 40, 24] }));
      }
    } else {
      // 拳：缠手布
      const wm = mat('#ffffff', { map: wrapTex(L.wraps ?? L.trim), gloss: 0.05 });
      for (const a of [this.armL, this.armR]) a.hand.add(mesh(ellipsoid(0.043, 0.034, 0.037), wm, { p: [0, -0.05, 0.004] }));
    }
  }

  /** 斜背在身后的鞘，以及勒过前胸的背带 */
  private addScabbard(color: Col, len: number, silver: THREE.Material, depthK: number) {
    const bk = this.look.bulk ?? 1;
    const bz = -0.112 * depthK * bk - 0.022;
    const g = group({ p: [0.02, 0.1, bz], r: [0, 0, 38] },
      mesh(cyl(0.019, 0.014, len * 0.86, 8), mat(color, { kind: 'leather', gloss: 0.3 }), { s: [0.55, 1, 1] }),
      mesh(cyl(0.021, 0.021, 0.05, 8), silver, { p: [0, len * 0.41, 0], s: [0.55, 1, 1] }),
      mesh(cyl(0.016, 0.01, 0.06, 8), silver, { p: [0, -len * 0.42, 0], s: [0.55, 1, 1] }),
    );
    this.chest.add(g);
    if (this.look.open) {
      const fz = 0.109 * depthK * bk, sx = this.shoulderX * bk, strap = mat('#3a2a1c', { kind: 'leather', gloss: 0.25 });
      this.chest.add(mesh(tube([[-sx * 0.62, 0.3, 0.05], [-sx * 0.3, 0.22, fz + 0.022], [sx * 0.2, 0.1, fz + 0.012], [sx * 0.68, -0.02, fz * 0.62]], 0.012, 6, 20), strap, { s: [1, 1, 1] }));
      this.chest.add(mesh(tube([[sx * 0.68, -0.02, -fz * 0.62], [sx * 0.2, 0.1, -fz - 0.012], [-sx * 0.3, 0.24, -fz - 0.016], [-sx * 0.62, 0.3, -0.04]], 0.012, 6, 20), strap));
    }
  }

  // -------------------- 姿势 --------------------
  setPose(p: Pose) {
    this.pose = p;
    this.hips.position.set(p.hip[0] * HIP_SCALE, HIP_Y + p.hip[1] * HIP_SCALE, p.hip[2] * HIP_SCALE);
    this.hips.rotation.set(p.hipRot[0] * DEG, p.hipRot[1] * DEG, p.hipRot[2] * DEG);
    this.spine.rotation.set(p.spine[0] * DEG, p.spine[1] * DEG, p.spine[2] * DEG);
    this.chest.rotation.set(p.chest[0] * DEG, p.chest[1] * DEG, p.chest[2] * DEG);
    this.head.rotation.set(p.head[0] * DEG, p.head[1] * DEG, p.head[2] * DEG);
    const arm = (a: Arm, v: [number, number, number, number], h: [number, number, number]) => {
      qy.setFromAxisAngle(AY, a.side * v[1] * DEG);
      qx.setFromAxisAngle(AX, -v[0] * DEG);
      qz.setFromAxisAngle(AY, a.side * v[2] * DEG);
      a.upper.quaternion.copy(qy).multiply(qx).multiply(qz);
      a.lower.rotation.set(-v[3] * DEG, 0, 0);
      a.hand.rotation.set(h[0] * DEG, a.side * h[1] * DEG, a.side * h[2] * DEG);
    };
    arm(this.armR, p.armR, p.handR);
    arm(this.armL, p.armL, p.handL);
    const leg = (l: Leg, v: [number, number, number, number], f: number) => {
      qz.setFromAxisAngle(AZ, l.side * v[1] * DEG);
      qx.setFromAxisAngle(AX, -v[0] * DEG);
      qy.setFromAxisAngle(AY, l.side * v[2] * DEG);
      l.upper.quaternion.copy(qz).multiply(qx).multiply(qy);
      l.lower.rotation.set(v[3] * DEG, 0, 0);
      l.foot.rotation.set(f * DEG, 0, 0);
    };
    leg(this.legR, p.legR, p.footR);
    leg(this.legL, p.legL, p.footL);
    this.root.updateMatrixWorld(true);

    if (this.bowString) this.updateBow(p.draw);
    if (p.grip > 0.5) {
      if (this.gripPoint) {
        const t = this.weaponR.localToWorld(this.gripPoint.clone());
        this.ikArm(this.armL, t);
      } else if (this.bowString) {
        const t = this.weaponL.localToWorld(this.bowString.nock.clone());
        this.ikArm(this.armR, t);
      }
      this.root.updateMatrixWorld(true);
    }
    this.skeleton.update();
  }

  private updateBow(draw: number) {
    const b = this.bowString!;
    const top = new THREE.Vector3(0, 0.145, 0.64), bot = new THREE.Vector3(0, 0.145, -0.64);
    b.nock.set(0, 0.145 + draw * 0.48, 0);
    const up = new THREE.Vector3(0, 1, 0);
    for (const [m, from] of [[b.top, top], [b.bot, bot]] as const) {
      const d = b.nock.clone().sub(from);
      m.position.copy(from);
      m.scale.set(1, d.length(), 1);
      m.quaternion.setFromUnitVectors(up, d.normalize());
    }
    b.arrow.visible = draw > 0.05;
    b.arrow.position.copy(b.nock);
    this.weaponL.updateMatrixWorld(true);
  }

  /** 两段骨骼解析 IK：让手腕到达世界坐标 target */
  private ikArm(a: Arm, target: THREE.Vector3) {
    const S = a.upper.getWorldPosition(new THREE.Vector3());
    const sc = this.body.scale.x;
    const la = this.upperLen * sc, lb = (this.lowerLen + 0.075) * sc;
    const to = target.clone().sub(S);
    let d = to.length();
    d = Math.min(la + lb - 1e-3, Math.max(Math.abs(la - lb) + 1e-3, d));
    const dir = to.normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const pole = new THREE.Vector3(a.side * 0.7, -0.7, -0.25).applyQuaternion(rootQ).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, pole).normalize();
    const upDir = dir.clone().applyAxisAngle(axis, alpha);
    const E = S.clone().addScaledVector(upDir, la);
    const fore = S.clone().addScaledVector(dir, d).sub(E).normalize();
    const y = upDir.clone().negate();
    const z = fore.clone().addScaledVector(upDir, -fore.dot(upDir)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    const qw = new THREE.Quaternion().setFromRotationMatrix(m);
    const pq = a.upper.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    a.upper.quaternion.copy(pq.multiply(qw));
    const cosG = (la * la + lb * lb - d * d) / (2 * la * lb);
    const flex = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosG)));
    a.lower.rotation.set(-flex, 0, 0);
  }

  // -------------------- 布料 / 发丝 / 穗子 --------------------
  private colliders(): Collider[] {
    const out: Collider[] = [];
    const pt = (o: THREE.Object3D, l: [number, number, number]) => {
      const c = new THREE.Vector3(...l);
      o.localToWorld(c);
      return this.chainHolder.worldToLocal(c);
    };
    const b = this.look.bulk ?? 1;
    out.push({ a: pt(this.head, [0, 0.118, 0.0]), r: 0.118 });
    out.push({ a: pt(this.chest, [0, 0.33, 0]), b: pt(this.head, [0, 0.03, 0]), r: 0.06 });
    const k = this.strong ? 1.14 : 1;
    out.push({ a: pt(this.chest, [-0.11 * b * k, 0.22, 0]), b: pt(this.chest, [0.11 * b * k, 0.22, 0]), r: 0.108 * b * k });
    out.push({ a: pt(this.chest, [0, 0.19, 0]), b: pt(this.spine, [0, 0.02, 0]), r: 0.128 * b * k });
    out.push({ a: pt(this.hips, [-0.06 * b, -0.02, 0]), b: pt(this.hips, [0.06 * b, -0.02, 0]), r: 0.118 * b * k });
    for (const l of [this.legL, this.legR]) {
      out.push({ a: pt(l.upper, [0, -0.02, 0]), b: pt(l.lower, [0, 0, 0]), r: 0.09 * b * k });
      out.push({ a: pt(l.lower, [0, 0, 0]), b: pt(l.foot, [0, 0.03, 0]), r: 0.072 * b * k });
    }
    for (const a of [this.armL, this.armR]) {
      out.push({ a: pt(a.upper, [0, 0, 0]), b: pt(a.lower, [0, 0, 0]), r: 0.06 * b });
    }
    return out;
  }
  resetChains() {
    this.root.updateMatrixWorld(true);
    for (const c of this.chains) { c.reset(); c.place(); }
    for (const s of this.sims) { s.reset(); s.place(); }
  }
  stepChains(dt: number, wind: THREE.Vector3) {
    const cols = this.colliders();
    const spheres = cols.filter((c) => !c.b).map((c) => ({ c: c.a, r: c.r }));
    // 胶囊近似成球，供刚性链使用
    for (const c of cols) if (c.b) spheres.push({ c: c.a.clone().add(c.b).multiplyScalar(0.5), r: c.r });
    for (const c of this.chains) c.step(dt, wind, spheres);
    for (const s of this.sims) s.step(dt, wind, cols);
  }
  /** 把模拟结果写回网格（实时运行时每帧步进后调用） */
  placeChains() {
    for (const c of this.chains) c.place();
    for (const s of this.sims) s.place();
  }
  saveChains(): number[][] { return [...this.chains.map((c) => c.save()), ...this.sims.map((s) => s.save())]; }
  loadChains(d: number[][]) {
    const n = this.chains.length;
    this.chains.forEach((c, i) => c.load(d[i]));
    this.sims.forEach((s, i) => s.load(d[n + i]));
  }
}
