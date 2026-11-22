import * as THREE from 'three';
import { EMISSIVE_MATS } from '../models/geo';
import { FOG_LIGHTS, Post } from './post';

type V3 = [number, number, number];

/** 一帧的环境参数（由时辰插值得到）。颜色都是线性空间、已含强度。 */
export interface Env {
  /** 指向主光（日 / 月）的单位方向 */
  sunDir: V3;
  sunCol: V3;
  /** 天光与地面反光（半球环境光） */
  ambSky: V3;
  ambGnd: V3;
  /** 环境贴图（高光反射）强度 */
  envK: number;
  fogCol: V3;
  fogDensity: number;
  fogFalloff: number;
  /** 日光光束强度 */
  shaftK: number;
  exposure: number;
  bloom: number;
  sat: number;
  contrast: number;
  tint: V3;
  vignette: number;
  /** 0 = 白天，1 = 深夜（灯火与自发光的强度） */
  night: number;
}

/** 俯角与视场：窄视场 + 较远机位，接近等距视角但保留透视纵深 */
const PITCH = (50 * Math.PI) / 180;
const FOV = 30;
const CAM_DIST = 25;
/** three 的漫反射带 1/π，这里把「期望的出射亮度」换算成光源强度 */
const PI = Math.PI;
const POINT_K = 2.4;

// 点光源的距离衰减改成「带软核」的平方反比：贴近灯的墙面不至于过曝，稍远处仍按 1/d² 落下去
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(
  'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );',
  'float distanceFalloff = 1.0 / ( pow( lightDistance, decayExponent ) + 0.8 );',
);

let N_SHADOW = 3;
let N_PLAIN = 9;

interface LightReq { key: string; x: number; y: number; z: number; r: number; c: V3; k: number; shadow: boolean; score: number; }
interface Slot { light: THREE.PointLight; key: string | null; fade: number; shadow: boolean; req: LightReq | null; }

export class Renderer {
  gl: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 1, 400);
  post: Post;
  W = 2; H = 2;
  time = 0;
  /** 镜头注视点（世界坐标）与缩放 */
  focus = new THREE.Vector3();
  zoom = 1;
  shake = 0;
  /** 调试视图：1 遮蔽 2 雾的散射 3 雾的透过率 */
  debug = 0;
  /** 渲染分辨率倍率（相对 CSS 像素 × devicePixelRatio） */
  scale = 1;
  noise: THREE.DataTexture;
  fxTex: THREE.CanvasTexture;
  /** 所有打过补丁的材质共用的 uniform */
  uniforms = {
    uTime: { value: 0 },
    uHoleA: { value: new THREE.Vector3() },
    uHoleB: { value: new THREE.Vector3(0, -100, 0) },
    uHoleR: { value: 1.25 },
  };

  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  private slots: Slot[] = [];
  private reqs: LightReq[] = [];
  private fogLightPos = new Float32Array(FOG_LIGHTS * 4);
  private fogLightCol = new Float32Array(FOG_LIGHTS * 3);
  private fogLightN = 0;

  private fxGeo = new THREE.BufferGeometry();
  private fxPos: THREE.BufferAttribute; private fxUv: THREE.BufferAttribute; private fxCol: THREE.BufferAttribute;
  private fxN = 0;
  private static FX_MAX = 8192;
  private lastNight = -1;
  private frame = 0;
  private camRight = new THREE.Vector3(); private camUp = new THREE.Vector3();
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3();
  private sunDirV = new THREE.Vector3(0.4, 0.8, 0.4);

  constructor(public canvas: HTMLCanvasElement, opts: { samples?: number; shadowLights?: number; plainLights?: number } = {}) {
    N_SHADOW = opts.shadowLights ?? N_SHADOW; N_PLAIN = opts.plainLights ?? N_PLAIN;
    const gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    this.gl = gl;
    gl.setPixelRatio(1);
    gl.toneMapping = THREE.NoToneMapping;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.info.autoReset = false;

    this.noise = makeNoise();
    this.fxTex = makeFxTex();
    this.post = new Post(gl, this.noise, opts.samples ?? 4);

    // ---- 主光与环境光 ----
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(4096, 4096);
    s.shadow.bias = -0.0003;
    s.shadow.normalBias = 0.05;
    s.shadow.radius = 2.4;
    this.scene.add(s, s.target, this.hemi);
    this.scene.environment = makeEnvMap(gl);
    this.scene.background = null;

    // ---- 点光源池：数量固定，避免着色器因灯数变化而重编译 ----
    for (let i = 0; i < N_SHADOW + N_PLAIN; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 8, 2);
      const shadow = i < N_SHADOW;
      if (shadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(768, 768);
        light.shadow.bias = -0.003;
        light.shadow.normalBias = 0.04;
        light.shadow.radius = 2.5;
        light.shadow.camera.near = 0.08;
        light.shadow.autoUpdate = false;
      }
      light.position.set(0, -50, 0);
      this.scene.add(light);
      this.slots.push({ light, key: null, fade: 0, shadow, req: null });
    }

    // ---- 特效批次 ----
    const N = Renderer.FX_MAX;
    this.fxPos = new THREE.BufferAttribute(new Float32Array(N * 4 * 3), 3);
    this.fxUv = new THREE.BufferAttribute(new Float32Array(N * 4 * 2), 2);
    this.fxCol = new THREE.BufferAttribute(new Float32Array(N * 4 * 4), 4);
    for (const a of [this.fxPos, this.fxUv, this.fxCol]) a.setUsage(THREE.DynamicDrawUsage);
    this.fxGeo.setAttribute('position', this.fxPos);
    this.fxGeo.setAttribute('uv', this.fxUv);
    this.fxGeo.setAttribute('aCol', this.fxCol);
    const idx = new Uint32Array(N * 6);
    for (let i = 0; i < N; i++) idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 2, i * 4 + 3, i * 4 + 1], i * 6);
    this.fxGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    const fxMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: this.fxTex } },
      vertexShader: 'attribute vec4 aCol; varying vec2 vUv; varying vec4 vCol; void main(){ vUv = uv; vCol = aCol; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D uTex; varying vec2 vUv; varying vec4 vCol; void main(){ vec4 t = texture2D(uTex, vUv); gl_FragColor = vec4(vCol.rgb * t.rgb * t.a, vCol.a * t.a); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const fx = new THREE.Mesh(this.fxGeo, fxMat);
    fx.frustumCulled = false;
    fx.renderOrder = 10;
    this.scene.add(fx);

    this.resize();
    this.updateCamera();
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    const W = Math.max(2, Math.round(c.clientWidth * dpr)), H = Math.max(2, Math.round(c.clientHeight * dpr));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.gl.setSize(W, H, false);
    this.post.resize(W, H);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ 镜头与坐标换算
  private updateCamera() {
    const d = CAM_DIST / this.zoom;
    const cam = this.camera;
    cam.position.set(this.focus.x, this.focus.y + Math.sin(PITCH) * d, this.focus.z + Math.cos(PITCH) * d);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.22;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.focus.x, this.focus.y, this.focus.z);
    cam.near = Math.max(0.5, d * 0.25); cam.far = d + 220;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    this.camUp.setFromMatrixColumn(cam.matrixWorld, 1);
  }

  /** 屏幕 CSS 像素 → 高度为 y 的水平面上的世界坐标 [x, z] */
  screenToGround(sx: number, sy: number, y = 0): [number, number] {
    const cam = this.camera;
    const v = this.tmp.set((sx / this.canvas.clientWidth) * 2 - 1, -((sy / this.canvas.clientHeight) * 2 - 1), 0.5).unproject(cam);
    const o = cam.position;
    v.sub(o);
    const t = v.y < -1e-5 ? (y - o.y) / v.y : 400;
    return [o.x + v.x * t, o.z + v.z * t];
  }
  /** 世界坐标 → 屏幕 CSS 像素 */
  worldToScreen(x: number, y: number, z: number): [number, number] {
    const v = this.tmp.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -0.1) return [-9999, -9999];
    v.applyMatrix4(this.camera.projectionMatrix);
    return [(v.x * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - v.y * 0.5) * this.canvas.clientHeight];
  }
  /** 某个世界位置上 1 米对应多少 CSS 像素 */
  pxPerMeter(x: number, y: number, z: number): number {
    const d = this.tmp.set(x, y, z).distanceTo(this.camera.position);
    return this.canvas.clientHeight / (2 * Math.tan((FOV * Math.PI) / 360) * Math.max(1, d));
  }
  /** 地面上的可见范围 [x0, z0, x1, z1]（含余量） */
  viewBounds(margin = 0): [number, number, number, number] {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const [x, z] = this.screenToGround(sx, sy);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    return [x0 - margin, z0 - margin, x1 + margin, z1 + margin];
  }

  // ------------------------------------------------------------ 每帧提交
  begin() {
    this.fxN = 0;
    this.reqs.length = 0;
  }

  /**
   * 提交一盏点光源。key 用来在帧间认出同一盏灯（阴影槽位据此保持稳定）；
   * shadow 表示它值得投影（离镜头近时才会真的分到带阴影的槽位）。
   */
  light(key: string, x: number, y: number, z: number, radius: number, c: V3, k = 1, shadow = false) {
    if (k <= 0.004) return;
    const dx = x - this.focus.x, dz = z - this.focus.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > (42 + radius) * (42 + radius)) return;
    const lum = c[0] + c[1] + c[2];
    // 只有离注视点够近的灯才值得投影：远处的影子看不见，却要整整渲染六个面
    this.reqs.push({ key, x, y, z, r: radius, c, k, shadow: shadow && d2 < 26 * 26, score: (lum * k * radius) / (9 + d2) });
  }

  private commitLights(dt: number) {
    const reqs = this.reqs, slots = this.slots;
    const cur = new Map<string, Slot>();
    for (const s of slots) if (s.key) cur.set(s.key, s);
    for (const q of reqs) if (cur.has(q.key)) q.score *= 1.35;
    reqs.sort((a, b) => b.score - a.score);
    const wantShadow = reqs.filter((q) => q.shadow).slice(0, N_SHADOW);
    const ws = new Set(wantShadow.map((q) => q.key));
    const wantPlain = reqs.filter((q) => !ws.has(q.key)).slice(0, N_PLAIN);
    for (const s of slots) s.req = null;
    const assign = (list: LightReq[], shadow: boolean) => {
      const pending: LightReq[] = [];
      for (const q of list) {
        const s = cur.get(q.key);
        if (s && s.shadow === shadow) s.req = q; else pending.push(q);
      }
      for (const q of pending) {
        const free = slots.find((s) => s.shadow === shadow && s.key === null);
        if (free) { free.key = q.key; free.req = q; free.fade = 0; }
      }
    };
    assign(wantShadow, true);
    assign(wantPlain, false);
    this.fogLightN = 0;
    for (const s of slots) {
      const l = s.light, q = s.req;
      if (q) {
        s.fade = Math.min(1, s.fade + dt * 6);
        l.position.set(q.x, q.y, q.z);
        l.distance = q.r;
        l.color.setRGB(q.c[0], q.c[1], q.c[2]);
        l.intensity = q.k * s.fade * PI * POINT_K;
      } else if (s.key) {
        s.fade -= dt * 6;
        if (s.fade <= 0) { s.fade = 0; s.key = null; l.intensity = 0; l.position.y = -50; }
        else l.intensity *= Math.max(0, 1 - dt * 6 / Math.max(0.05, s.fade + dt * 6));
      }
      if (s.shadow) l.shadow.camera.far = Math.max(1, l.distance);
      if (l.intensity > 0 && this.fogLightN < FOG_LIGHTS) {
        const i = this.fogLightN++;
        this.fogLightPos.set([l.position.x, l.position.y, l.position.z, l.distance], i * 4);
        const k = l.intensity / (PI * POINT_K);
        this.fogLightCol.set([l.color.r * k, l.color.g * k, l.color.b * k], i * 3);
      }
    }
  }

  /**
   * 点光源的阴影贴图轮流更新：离注视点最近的那盏每帧都更新（主角的影子不能卡），其余的隔帧轮换。
   * 一盏灯的阴影要渲染立方体的六个面，三盏全更新就是每帧十八遍场景。
   */
  private updatePointShadows() {
    const act = this.slots.filter((s) => s.shadow && s.light.intensity > 0);
    for (const s of this.slots) if (s.shadow) s.light.shadow.needsUpdate = false;
    if (!act.length) return;
    const d2 = (s: Slot) => (s.light.position.x - this.focus.x) ** 2 + (s.light.position.z - this.focus.z) ** 2;
    act.sort((a, b) => d2(a) - d2(b));
    act[0].light.shadow.needsUpdate = true;
    if (act.length > 1) act[1 + (this.frame % (act.length - 1))].light.shadow.needsUpdate = true;
    // 刚分到槽位的灯必须先渲染一次，否则会带着上一盏灯的影子亮起来
    for (const s of act) if (s.fade < 0.2) s.light.shadow.needsUpdate = true;
  }

  /** 特效四边形：四角世界坐标（左上、右上、左下、右下）。颜色为线性 RGB，add=1 纯加色；a1 给定时左右两侧不透明度分别为 alpha 与 a1 */
  fxQuad(p: number[], cell: number, r: number, g: number, b: number, alpha: number, add = 1, a1 = alpha) {
    if (this.fxN >= Renderer.FX_MAX) return;
    const cu = (cell % 4) * 0.25, cv = 1 - Math.floor(cell / 4) / 3;
    const pad = 0.004, ch = 1 / 3;
    const u0 = cu + pad, u1 = cu + 0.25 - pad, v0 = cv - pad, v1 = cv - ch + pad;
    const o = this.fxN * 4;
    const P = this.fxPos.array as Float32Array, U = this.fxUv.array as Float32Array, C = this.fxCol.array as Float32Array;
    for (let i = 0; i < 4; i++) {
      P[(o + i) * 3] = p[i * 3]; P[(o + i) * 3 + 1] = p[i * 3 + 1]; P[(o + i) * 3 + 2] = p[i * 3 + 2];
      U[(o + i) * 2] = i & 1 ? u1 : u0; U[(o + i) * 2 + 1] = i & 2 ? v1 : v0;
      const a = i & 1 ? a1 : alpha;
      C[(o + i) * 4] = r * a; C[(o + i) * 4 + 1] = g * a; C[(o + i) * 4 + 2] = b * a; C[(o + i) * 4 + 3] = a * (1 - add);
    }
    this.fxN++;
  }

  /** 面向镜头的粒子 */
  fxBillboard(x: number, y: number, z: number, size: number, cell: number, r: number, g: number, b: number, alpha: number, add = 1, rot = 0) {
    const s = size / 2, c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
    const R = this.camRight, U = this.camUp;
    const ax = R.x * c + U.x * sn, ay = R.y * c + U.y * sn, az = R.z * c + U.z * sn;
    const bx = -R.x * sn + U.x * c, by = -R.y * sn + U.y * c, bz = -R.z * sn + U.z * c;
    this.fxQuad([
      x - ax + bx, y - ay + by, z - az + bz, x + ax + bx, y + ay + by, z + az + bz,
      x - ax - bx, y - ay - by, z - az - bz, x + ax - bx, y + ay - by, z + az - bz,
    ], cell, r, g, b, alpha, add);
  }

  /** 水平面上的贴片（脚下光环、点击标记等），rot 为绕 Y 的朝向角 */
  fxFlat(x: number, y: number, z: number, w: number, d: number, rot: number, cell: number, r: number, g: number, b: number, alpha: number, add = 1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = w / 2, hz = d / 2;
    const pt = (lx: number, lz: number) => [x + lx * c + lz * s, y, z - lx * s + lz * c];
    this.fxQuad([...pt(-hx, -hz), ...pt(hx, -hz), ...pt(-hx, hz), ...pt(hx, hz)], cell, r, g, b, alpha, add);
  }

  // ------------------------------------------------------------ 渲染
  render(env: Env, dt: number) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.updateCamera();
    const cam = this.camera;
    this.uniforms.uHoleA.value.copy(cam.position);

    // 主光：阴影相机跟随注视点，并按阴影贴图的像素对齐，避免移动时闪烁
    const dir = this.sunDirV.set(env.sunDir[0], env.sunDir[1], env.sunDir[2]).normalize();
    const sun = this.sun;
    const ext = Math.min(70, 30 / this.zoom + 8);
    const sc = sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 320;
    sc.updateProjectionMatrix();
    const lookM = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    const rx = this.tmp.setFromMatrixColumn(lookM, 0), ry = this.tmp2.setFromMatrixColumn(lookM, 1);
    const texel = (ext * 2) / sun.shadow.mapSize.x;
    const fx = Math.round(this.focus.dot(rx) / texel) * texel, fy = Math.round(this.focus.dot(ry) / texel) * texel;
    const fz = this.focus.dot(dir);
    sun.target.position.set(0, 0, 0).addScaledVector(rx, fx).addScaledVector(ry, fy).addScaledVector(dir, fz);
    sun.position.copy(sun.target.position).addScaledVector(dir, 160);
    sun.target.updateMatrixWorld();
    sun.color.setRGB(env.sunCol[0], env.sunCol[1], env.sunCol[2]);
    sun.intensity = PI;
    this.hemi.color.setRGB(env.ambSky[0], env.ambSky[1], env.ambSky[2]);
    this.hemi.groundColor.setRGB(env.ambGnd[0], env.ambGnd[1], env.ambGnd[2]);
    this.hemi.intensity = PI;
    this.scene.environmentIntensity = env.envK;
    if (Math.abs(env.night - this.lastNight) > 0.01) {
      this.lastNight = env.night;
      for (const m of EMISSIVE_MATS) m.emissiveIntensity = env.night * 1.25;
    }

    this.commitLights(dt);
    this.frame++;
    this.updatePointShadows();

    this.fxGeo.setDrawRange(0, this.fxN * 6);
    if (this.fxN) {
      for (const a of [this.fxPos, this.fxUv, this.fxCol]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.fxN * 4 * a.itemSize); a.needsUpdate = true; }
    }

    const gl = this.gl;
    gl.info.reset();
    gl.setRenderTarget(this.post.rtScene);
    gl.setClearColor(new THREE.Color(env.fogCol[0] * 0.6, env.fogCol[1] * 0.6, env.fogCol[2] * 0.6), 1);
    gl.clear();
    gl.render(this.scene, cam);

    this.post.render({
      camera: cam, sun, sunDir: dir,
      sunCol: new THREE.Color(env.sunCol[0], env.sunCol[1], env.sunCol[2]),
      fogCol: new THREE.Color(env.fogCol[0], env.fogCol[1], env.fogCol[2]),
      fogDensity: env.fogDensity, fogFalloff: env.fogFalloff, shaftK: env.shaftK, glowK: 0.3, aoK: 0.95,
      bloom: env.bloom, exposure: env.exposure, sat: env.sat, contrast: env.contrast,
      tint: new THREE.Color(env.tint[0], env.tint[1], env.tint[2]), vignette: env.vignette, time: this.time,
      numLights: this.fogLightN, lightPos: this.fogLightPos, lightCol: this.fogLightCol, debug: this.debug,
    });
  }
}

// ---------------------------------------------------------------- 资源
/** 可平铺的四通道分形噪声 */
function makeNoise(): THREE.DataTexture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const lattice = (seed: number, period: number) => {
    const g = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const p = (a: number, b: number) => g[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
      return p(xi, yi) * (1 - u) * (1 - v) + p(xi + 1, yi) * u * (1 - v) + p(xi, yi + 1) * (1 - u) * v + p(xi + 1, yi + 1) * u * v;
    };
  };
  const P = [4, 8, 16, 32];
  for (let c = 0; c < 4; c++) {
    const octs = P.map((p, i) => lattice(977 + c * 131 + i * 17, p));
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let v = 0, amp = 0.5, tot = 0;
        octs.forEach((f, i) => { v += f((x / S) * P[i], (y / S) * P[i]) * amp; tot += amp; amp *= 0.5; });
        v /= tot;
        data[(y * S + x) * 4 + c] = Math.min(255, Math.max(0, ((v - 0.5) * 1.9 + 0.5) * 255));
      }
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * 特效小图集（4×3 格，每格 128px）：
 * 0 柔光圆 1 火星 2 烟团 3 弧形刃光 4 圆环 5 叶片 6 花瓣 7 实心圆 8 刀光拖尾（纵向渐隐）9 细长火花
 */
function makeFxTex(): THREE.CanvasTexture {
  const C = 128;
  const cv = document.createElement('canvas');
  cv.width = C * 4; cv.height = C * 3;
  const g = cv.getContext('2d')!;
  const cell = (i: number, fn: (cx: number, cy: number) => void) => {
    g.save();
    g.beginPath(); g.rect((i % 4) * C, Math.floor(i / 4) * C, C, C); g.clip();
    fn((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2);
    g.restore();
  };
  const radial = (x: number, y: number, stops: [number, number][]) => {
    const r = g.createRadialGradient(x, y, 0, x, y, C / 2);
    for (const [t, a] of stops) r.addColorStop(t, `rgba(255,255,255,${a})`);
    g.fillStyle = r; g.fillRect(x - C / 2, y - C / 2, C, C);
  };
  cell(0, (x, y) => radial(x, y, [[0, 1], [0.25, 0.55], [0.6, 0.12], [1, 0]]));
  cell(1, (x, y) => radial(x, y, [[0, 1], [0.12, 0.9], [0.3, 0.15], [1, 0]]));
  cell(2, (x, y) => {
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, d = i ? 18 + (i % 3) * 7 : 0, rr = 30 - (i % 4) * 4;
      const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
      const r = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      r.addColorStop(0, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    }
  });
  cell(3, (x, y) => {
    // 细而利的弧：外缘一道亮线，向内很快隐去
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      g.beginPath();
      g.arc(x, y + 34, 86 - t * 14, Math.PI * 1.17, Math.PI * 1.83);
      g.strokeStyle = `rgba(255,255,255,${Math.pow(1 - t, 3) * 0.7})`;
      g.lineWidth = 1.6;
      g.stroke();
    }
    const m = g.createLinearGradient(x - C / 2, 0, x + C / 2, 0);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.35, 'rgba(0,0,0,0)'); m.addColorStop(0.65, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = m; g.fillRect(x - C / 2, y - C / 2, C, C);
    g.globalCompositeOperation = 'source-over';
  });
  cell(4, (x, y) => {
    for (let i = 0; i < 6; i++) {
      g.beginPath(); g.arc(x, y, 54 - i * 1.0, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${0.5 - Math.abs(i - 2) * 0.12})`; g.lineWidth = 1.4; g.stroke();
    }
  });
  cell(5, (x, y) => {
    g.translate(x, y); g.rotate(0.5);
    g.beginPath(); g.moveTo(-44, 0); g.quadraticCurveTo(0, -30, 44, 0); g.quadraticCurveTo(0, 30, -44, 0);
    g.fillStyle = 'rgba(255,255,255,1)'; g.fill();
    g.beginPath(); g.moveTo(-40, 0); g.lineTo(40, 0); g.strokeStyle = 'rgba(160,160,160,1)'; g.lineWidth = 3; g.stroke();
  });
  cell(6, (x, y) => {
    g.translate(x, y);
    g.beginPath(); g.moveTo(0, -40); g.bezierCurveTo(34, -30, 30, 26, 0, 40); g.bezierCurveTo(-30, 26, -34, -30, 0, -40);
    const r = g.createLinearGradient(0, -40, 0, 40);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(215,215,215,1)');
    g.fillStyle = r; g.fill();
  });
  cell(7, (x, y) => { g.beginPath(); g.arc(x, y, 56, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); });
  cell(8, (x, y) => {
    // 拖尾：上缘（刃尖一侧）最亮，向刃根渐隐
    const r = g.createLinearGradient(0, y - C / 2, 0, y + C / 2);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.05, 'rgba(255,255,255,1)'); r.addColorStop(0.16, 'rgba(255,255,255,0.3)');
    r.addColorStop(0.5, 'rgba(255,255,255,0.06)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(x - C / 2, y - C / 2, C, C);
  });
  cell(9, (x, y) => {
    const r = g.createLinearGradient(x - C / 2, 0, x + C / 2, 0);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.8, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(x - C / 2, y - 3, C, 6);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.premultiplyAlpha = false;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** 环境贴图：一片灰白的阴天天穹，只为给金属与湿润表面提供可反射的东西 */
function makeEnvMap(gl: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = mix(vec3(0.95, 0.97, 1.0), vec3(0.42, 0.5, 0.62), smoothstep(0.0, 0.9, h));
        vec3 gnd = vec3(0.07, 0.065, 0.06);
        vec3 c = mix(gnd, sky, smoothstep(-0.08, 0.06, h));
        // 一块更亮的云隙，给刀刃留一道可以「闪」的高光
        c += vec3(2.6, 2.4, 2.1) * pow(max(dot(d, normalize(vec3(-0.45, 0.75, 0.35))), 0.0), 24.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
  const pm = new THREE.PMREMGenerator(gl);
  const tex = pm.fromScene(s, 0.02, 0.1, 100).texture;
  pm.dispose();
  return tex;
}
