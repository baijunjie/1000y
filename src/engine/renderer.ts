import { AtlasMeta, COS, FrameMeta, SIN } from '../shared/consts';
import { GL, makeFBO, makeTex, Program } from './gl';
import {
  BLOOM_DOWN_FS, BLOOM_UP_FS, BLUR_FS, COMPOSITE_FS, FULLSCREEN_VS, FX_FS, FX_VS, GROUND_FS, LIGHT_FS,
  MAX_LIGHTS, SHADOW_FS, SPRITE_EMIS_FS, SPRITE_FS, SPRITE_VS,
} from './shaders';

export interface Atlas {
  meta: AtlasMeta;
  color: WebGLTexture;
  normal: WebGLTexture;
  shadow: WebGLTexture | null;
  id: number;
}

export interface Env {
  sunDir: [number, number, number];
  sunCol: [number, number, number];
  ambSky: [number, number, number];
  ambGnd: [number, number, number];
  skyRefl: [number, number, number];
  fog: [number, number, number, number];
  shadowK: number;
  exposure: number;
  bloom: number;
  sat: number;
  tint: [number, number, number];
  vignette: number;
  /** 0 = 白天，1 = 深夜（自发光贴图强度） */
  night: number;
}

export interface GroundTex {
  tileC: WebGLTexture;
  tileN: WebGLTexture;
  splat: WebGLTexture;
  aux: WebGLTexture;
  mapW: number;
  mapH: number;
}

const INST = 16; // 每个精灵实例的 float 数

class InstBuf {
  data: Float32Array;
  n = 0;
  constructor(cap: number) { this.data = new Float32Array(cap * INST); }
  ensure() {
    if ((this.n + 1) * INST > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
  }
}

interface SpriteCmd { key: number; atlas: Atlas; off: number; }

export class Renderer {
  gl: GL;
  cam = { x: 0, y: 0, ppm: 80 };
  W = 1; H = 1;
  time = 0;
  hdrOK = true;
  /** 调试视图：1 阴影遮罩 2 反照率 3 法线/高度 */
  debug = 0;

  private pGround: Program; private pSprite: Program; private pEmis: Program; private pShadow: Program;
  private pBlur: Program; private pLight: Program; private pFx: Program; private pDown: Program; private pUp: Program; private pComp: Program;
  private vaoInst: WebGLVertexArrayObject; private instVbo: WebGLBuffer;
  private vaoFx: WebGLVertexArrayObject; private fxVbo: WebGLBuffer; private fxIbo: WebGLBuffer;
  private vaoEmpty: WebGLVertexArrayObject;

  private tAlbedo!: WebGLTexture; private tNormal!: WebGLTexture; private tMat!: WebGLTexture; private tDepth!: WebGLTexture; private tHdr!: WebGLTexture;
  private fGbuf!: WebGLFramebuffer; private fHdr!: WebGLFramebuffer;
  private tSh: WebGLTexture[] = []; private fSh: WebGLFramebuffer[] = []; private shW = 1; private shH = 1;
  private bloomT: WebGLTexture[] = []; private bloomF: WebGLFramebuffer[] = []; private bloomS: [number, number][] = [];

  noise: WebGLTexture;
  fxTex: WebGLTexture;
  ground: GroundTex | null = null;

  // 每帧队列
  private sprites = new InstBuf(2048);
  private spriteCmds: SpriteCmd[] = [];
  private emis = new InstBuf(256);
  private emisCmds: SpriteCmd[] = [];
  private shadows = new InstBuf(1024);
  private shadowCmds: SpriteCmd[] = [];
  private fxData = new Float32Array(4096 * 4 * 9);
  private fxN = 0;
  private lightPos = new Float32Array(MAX_LIGHTS * 4);
  private lightCol = new Float32Array(MAX_LIGHTS * 4);
  private lightList: { x: number; y: number; z: number; r: number; c: [number, number, number]; w: number }[] = [];
  private atlasSeq = 0;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('浏览器不支持 WebGL2');
    this.gl = gl;
    this.hdrOK = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');

    this.pGround = new Program(gl, FULLSCREEN_VS, GROUND_FS);
    this.pSprite = new Program(gl, SPRITE_VS, SPRITE_FS);
    this.pEmis = new Program(gl, SPRITE_VS, SPRITE_EMIS_FS);
    this.pShadow = new Program(gl, SPRITE_VS, SHADOW_FS);
    this.pBlur = new Program(gl, FULLSCREEN_VS, BLUR_FS);
    this.pLight = new Program(gl, FULLSCREEN_VS, LIGHT_FS);
    this.pFx = new Program(gl, FX_VS, FX_FS);
    this.pDown = new Program(gl, FULLSCREEN_VS, BLOOM_DOWN_FS);
    this.pUp = new Program(gl, FULLSCREEN_VS, BLOOM_UP_FS);
    this.pComp = new Program(gl, FULLSCREEN_VS, COMPOSITE_FS);

    this.vaoEmpty = gl.createVertexArray()!;
    this.vaoInst = gl.createVertexArray()!;
    this.instVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vaoInst);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, INST * 4, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    this.vaoFx = gl.createVertexArray()!;
    this.fxVbo = gl.createBuffer()!;
    this.fxIbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vaoFx);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fxVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
    const idx = new Uint16Array(8192 * 6);
    for (let i = 0; i < 8192; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fxIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.noise = this.makeNoise();
    this.fxTex = this.makeFxTex();
    this.resize();
  }

  // ------------------------------------------------------------ 资源
  private makeNoise(): WebGLTexture {
    const gl = this.gl, S = 256;
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
    for (let c = 0; c < 4; c++) {
      const octs = [4, 8, 16, 32].map((p, i) => lattice(977 + c * 131 + i * 17, p));
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          let v = 0, amp = 0.5, tot = 0;
          octs.forEach((f, i) => { const p = [4, 8, 16, 32][i]; v += f((x / S) * p, (y / S) * p) * amp; tot += amp; amp *= 0.5; });
          v /= tot;
          data[(y * S + x) * 4 + c] = Math.min(255, Math.max(0, ((v - 0.5) * 1.9 + 0.5) * 255));
        }
      }
    }
    const t = makeTex(gl, { w: S, h: S, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data, wrap: gl.REPEAT });
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    return t;
  }

  /** 特效小图集（4×2 格，每格 128px）：0 柔光圆 1 火星 2 烟团 3 月牙刀光 4 圆环 5 叶片 6 花瓣 7 实心圆 */
  private makeFxTex(): WebGLTexture {
    const gl = this.gl, C = 128;
    const cv = document.createElement('canvas');
    cv.width = C * 4; cv.height = C * 2;
    const g = cv.getContext('2d')!;
    const cell = (i: number, fn: (cx: number, cy: number) => void) => {
      g.save();
      g.beginPath(); g.rect((i % 4) * C, Math.floor(i / 4) * C, C, C); g.clip();
      fn((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2);
      g.restore();
    };
    cell(0, (x, y) => {
      const r = g.createRadialGradient(x, y, 0, x, y, C / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      r.addColorStop(0.6, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(x - C / 2, y - C / 2, C, C);
    });
    cell(1, (x, y) => {
      const r = g.createRadialGradient(x, y, 0, x, y, C / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.12, 'rgba(255,255,255,0.9)');
      r.addColorStop(0.3, 'rgba(255,255,255,0.15)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(x - C / 2, y - C / 2, C, C);
    });
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
      // 月牙：外弧亮、向内渐隐，两端收尖
      for (let i = 0; i < 26; i++) {
        const t = i / 25;
        g.beginPath();
        g.arc(x, y + 34, 86 - t * 30, Math.PI * 1.17, Math.PI * 1.83);
        g.strokeStyle = `rgba(255,255,255,${(1 - t) * (1 - t) * 0.5})`;
        g.lineWidth = 2.4;
        g.stroke();
      }
      const m = g.createLinearGradient(x - C / 2, 0, x + C / 2, 0);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.3, 'rgba(0,0,0,0)'); m.addColorStop(0.7, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = m; g.fillRect(x - C / 2, y - C / 2, C, C);
      g.globalCompositeOperation = 'source-over';
    });
    cell(4, (x, y) => {
      for (let i = 0; i < 10; i++) {
        g.beginPath(); g.arc(x, y, 52 - i * 1.2, 0, Math.PI * 2);
        g.strokeStyle = `rgba(255,255,255,${0.5 - Math.abs(i - 3) * 0.06})`; g.lineWidth = 1.6; g.stroke();
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
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  registerAtlas(meta: AtlasMeta, color: WebGLTexture, normal: WebGLTexture, shadow: WebGLTexture | null): Atlas {
    return { meta, color, normal, shadow, id: ++this.atlasSeq };
  }

  resize(scale = 1) {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const W = Math.max(2, Math.round(c.clientWidth * dpr)), H = Math.max(2, Math.round(c.clientHeight * dpr));
    if (W === this.W && H === this.H && this.tAlbedo) return;
    this.W = c.width = W; this.H = c.height = H;
    const del = (t?: WebGLTexture) => t && gl.deleteTexture(t);
    [this.tAlbedo, this.tNormal, this.tMat, this.tDepth, this.tHdr, ...this.tSh, ...this.bloomT].forEach(del);
    [this.fGbuf, this.fHdr, ...this.fSh, ...this.bloomF].forEach((f) => f && gl.deleteFramebuffer(f));
    this.tAlbedo = makeTex(gl, { w: W, h: H, internal: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST });
    this.tNormal = makeTex(gl, { w: W, h: H, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST });
    this.tMat = makeTex(gl, { w: W, h: H, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST });
    this.tDepth = makeTex(gl, { w: W, h: H, internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, filter: gl.NEAREST });
    const hdrI = this.hdrOK ? gl.RGBA16F : gl.RGBA8, hdrT = this.hdrOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    this.tHdr = makeTex(gl, { w: W, h: H, internal: hdrI, format: gl.RGBA, type: hdrT });
    this.fGbuf = makeFBO(gl, [this.tAlbedo, this.tNormal, this.tMat], this.tDepth);
    this.fHdr = makeFBO(gl, [this.tHdr], this.tDepth);
    this.shW = Math.ceil(W / 2); this.shH = Math.ceil(H / 2);
    this.tSh = [0, 1].map(() => makeTex(gl, { w: this.shW, h: this.shH, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }));
    this.fSh = this.tSh.map((t) => makeFBO(gl, [t]));
    this.bloomT = []; this.bloomF = []; this.bloomS = [];
    let bw = W, bh = H;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      const t = makeTex(gl, { w: bw, h: bh, internal: hdrI, format: gl.RGBA, type: hdrT });
      this.bloomT.push(t); this.bloomF.push(makeFBO(gl, [t])); this.bloomS.push([bw, bh]);
    }
  }

  // ------------------------------------------------------------ 坐标换算
  /** 屏幕像素（canvas 内 CSS 像素）→ 地面世界坐标 */
  screenToGround(sx: number, sy: number): [number, number] {
    const k = this.W / this.canvas.clientWidth;
    const X = this.cam.x + (sx * k - this.W / 2) / this.cam.ppm;
    const Yp = this.cam.y + (sy * k - this.H / 2) / this.cam.ppm;
    return [X, Yp / SIN];
  }
  /** 世界坐标 → 屏幕 CSS 像素 */
  worldToScreen(x: number, y: number, z: number): [number, number] {
    const k = this.canvas.clientWidth / this.W;
    return [((x - this.cam.x) * this.cam.ppm + this.W / 2) * k, ((z * SIN - y * COS - this.cam.y) * this.cam.ppm + this.H / 2) * k];
  }
  /** 可见范围（世界 x / z，含余量） */
  viewBounds(margin = 0): [number, number, number, number] {
    const hw = this.W / 2 / this.cam.ppm + margin, hh = this.H / 2 / this.cam.ppm;
    return [this.cam.x - hw, (this.cam.y - hh) / SIN - margin, this.cam.x + hw, (this.cam.y + hh) / SIN + margin];
  }

  // ------------------------------------------------------------ 每帧提交
  begin() {
    this.sprites.n = 0; this.spriteCmds.length = 0;
    this.emis.n = 0; this.emisCmds.length = 0;
    this.shadows.n = 0; this.shadowCmds.length = 0;
    this.fxN = 0;
    this.lightList.length = 0;
  }

  private pushInst(buf: InstBuf, atlasW: number, atlasH: number, fx: number, fy: number, fw: number, fh: number,
    x0: number, y0: number, x1: number, y1: number, p0: number, p1: number, p2: number, p3: number,
    r: number, g: number, b: number, a: number, flip: boolean): number {
    buf.ensure();
    const d = buf.data, o = buf.n * INST;
    d[o] = x0; d[o + 1] = y0; d[o + 2] = x1; d[o + 3] = y1;
    const u0 = fx / atlasW, u1 = (fx + fw) / atlasW;
    d[o + 4] = flip ? u1 : u0; d[o + 5] = fy / atlasH; d[o + 6] = flip ? u0 : u1; d[o + 7] = (fy + fh) / atlasH;
    d[o + 8] = p0; d[o + 9] = p1; d[o + 10] = p2; d[o + 11] = p3;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = a;
    return buf.n++;
  }

  /**
   * 提交一个世界精灵。x/y/z 为锚点世界坐标，scale 为缩放。
   * opts: tint 颜色乘子，alpha，flash 受击闪白 0..1，flip 水平镜像，shadow 是否投影（'static' | 'dynamic' | false），sortBias 排序偏移
   */
  sprite(atlas: Atlas, frame: FrameMeta, x: number, y: number, z: number, scale = 1,
    o: { tint?: [number, number, number]; alpha?: number; flash?: number; flip?: boolean; shadow?: 'static' | 'dynamic' | false; sortBias?: number; shadowK?: number; emissive?: number } = {}) {
    const m = atlas.meta, k = scale / m.ppu;
    const yp = z * SIN - y * COS;
    const [fx, fy, fw, fh] = frame.r, [ax, ay] = frame.a;
    const flip = !!o.flip;
    const x0 = flip ? x - (fw - ax) * k : x - ax * k;
    const t = o.tint;
    const off = this.pushInst(this.sprites, m.size[0], m.size[1], fx, fy, fw, fh,
      x0, yp - ay * k, x0 + fw * k, yp + (fh - ay) * k,
      y, m.hScale * scale, flip ? -1 : 1, o.flash ?? 0,
      t ? t[0] : 1, t ? t[1] : 1, t ? t[2] : 1, o.alpha ?? 1, flip);
    this.spriteCmds.push({ key: z + (o.sortBias ?? 0), atlas, off });
    if (o.shadow !== false && frame.s && atlas.shadow && m.shadowSize) {
      const [sx, sy, sw, sh, sax, say] = frame.s;
      const sk = scale / (m.shadowPpu ?? m.ppu / 2);
      const gy = z * SIN;
      const sx0 = flip ? x - (sw - sax) * sk : x - sax * sk;
      const so = this.pushInst(this.shadows, m.shadowSize[0], m.shadowSize[1], sx, sy, sw, sh,
        sx0, gy - say * sk, sx0 + sw * sk, gy + (sh - say) * sk,
        o.shadow === 'static' ? 1 : 0, (o.shadowK ?? 1) * (o.alpha ?? 1), 0, 0, 1, 1, 1, 1, flip);
      this.shadowCmds.push({ key: 0, atlas, off: so });
    }
    if (frame.e && (o.emissive ?? 0) > 0.01) {
      const [ex, ey, ew, eh, eax, eay] = frame.e;
      const e = o.emissive!;
      const ex0 = flip ? x - (ew - eax) * k : x - eax * k;
      const eo = this.pushInst(this.emis, m.size[0], m.size[1], ex, ey, ew, eh,
        ex0, yp - eay * k, ex0 + ew * k, yp + (eh - eay) * k,
        y, m.hScale * scale, flip ? -1 : 1, 0, e, e, e, 1, flip);
      this.emisCmds.push({ key: z, atlas, off: eo });
    }
  }

  light(x: number, y: number, z: number, radius: number, c: [number, number, number], k = 1) {
    const [x0, z0, x1, z1] = this.viewBounds(radius);
    if (x < x0 || x > x1 || z < z0 - radius || z > z1 + radius) return;
    const lum = (c[0] + c[1] + c[2]) * k * radius;
    this.lightList.push({ x, y, z, r: radius, c: [c[0] * k, c[1] * k, c[2] * k], w: lum });
  }

  /** 特效四边形：四角世界坐标（左上、右上、左下、右下），cell 为特效图集格子，颜色为线性 RGB，add=1 纯加色 */
  fxQuad(p: number[], cell: number, r: number, g: number, b: number, alpha: number, add = 1) {
    if (this.fxN >= 8192) return;
    if ((this.fxN + 1) * 36 > this.fxData.length) {
      const d = new Float32Array(this.fxData.length * 2); d.set(this.fxData); this.fxData = d;
    }
    const d = this.fxData;
    const cu = (cell % 4) * 0.25, cv = Math.floor(cell / 4) * 0.5;
    const pad = 0.004;
    const uv = [cu + pad, cv + pad, cu + 0.25 - pad, cv + pad, cu + pad, cv + 0.5 - pad, cu + 0.25 - pad, cv + 0.5 - pad];
    let o = this.fxN * 36;
    for (let i = 0; i < 4; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      d[o++] = x; d[o++] = z * SIN - y * COS; d[o++] = z + 0.06;
      d[o++] = uv[i * 2]; d[o++] = uv[i * 2 + 1];
      d[o++] = r * alpha; d[o++] = g * alpha; d[o++] = b * alpha; d[o++] = alpha * (1 - add);
    }
    this.fxN++;
  }

  /** 面向镜头的粒子 */
  fxBillboard(x: number, y: number, z: number, size: number, cell: number, r: number, g: number, b: number, alpha: number, add = 1, rot = 0) {
    const s = size / 2;
    const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
    // 屏幕平面内的两个轴：右 = (1,0,0)，上 = (0,COS,-SIN)
    const ax = [c, sn * COS, -sn * SIN], ay = [-sn, c * COS, -c * SIN];
    this.fxQuad([
      x - ax[0] + ay[0], y - ax[1] + ay[1], z - ax[2] + ay[2],
      x + ax[0] + ay[0], y + ax[1] + ay[1], z + ax[2] + ay[2],
      x - ax[0] - ay[0], y - ax[1] - ay[1], z - ax[2] - ay[2],
      x + ax[0] - ay[0], y + ax[1] - ay[1], z + ax[2] - ay[2],
    ], cell, r, g, b, alpha, add);
  }

  /** 水平面上的贴片（刀光、脚下光环等），rot 为绕 Y 的朝向角 */
  fxFlat(x: number, y: number, z: number, w: number, d: number, rot: number, cell: number, r: number, g: number, b: number, alpha: number, add = 1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = w / 2, hz = d / 2;
    const pt = (lx: number, lz: number) => [x + lx * c + lz * s, y, z - lx * s + lz * c];
    this.fxQuad([...pt(-hx, -hz), ...pt(hx, -hz), ...pt(-hx, hz), ...pt(hx, hz)], cell, r, g, b, alpha, add);
  }

  // ------------------------------------------------------------ 渲染
  private drawInst(buf: InstBuf, cmds: SpriteCmd[], prog: Program, shadowTex = false) {
    const gl = this.gl;
    if (!cmds.length) return;
    // 把排序后的实例重排到连续缓冲
    const out = new Float32Array(cmds.length * INST);
    for (let i = 0; i < cmds.length; i++) out.set(buf.data.subarray(cmds[i].off * INST, cmds[i].off * INST + INST), i * INST);
    gl.bindVertexArray(this.vaoInst);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    let start = 0;
    while (start < cmds.length) {
      const atlas = cmds[start].atlas;
      let end = start + 1;
      while (end < cmds.length && cmds[end].atlas === atlas) end++;
      if (shadowTex) prog.tex('uColor', 0, atlas.shadow);
      else { prog.tex('uColor', 0, atlas.color); prog.tex('uNormal', 1, atlas.normal); }
      for (let i = 0; i < 4; i++) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, INST * 4, start * INST * 4 + i * 16);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - start);
      start = end;
    }
    gl.bindVertexArray(null);
  }

  render(env: Env, dt: number) {
    const gl = this.gl, W = this.W, H = this.H;
    this.time += dt;
    const cam = this.cam;
    // 镜头对齐像素，避免精灵抖动
    const cx = Math.round(cam.x * cam.ppm) / cam.ppm, cy = Math.round(cam.y * cam.ppm) / cam.ppm;
    const R = H / 2 / cam.ppm / SIN + 24;
    const zNear = cy / SIN + R, dK = 1 / (2 * R);
    const setCam = (p: Program) => { p.v4('uCam', cx, cy, cam.ppm, 0).v2('uRes', W, H); };

    // ---- G-Buffer ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fGbuf);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clearColor(0.02, 0.03, 0.02, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.ground) {
      const g = this.ground, p = this.pGround.use();
      setCam(p);
      p.v4('uMap', 1 / g.mapW, 1 / g.mapH, 0, 0).v2('uDepth', zNear, dK);
      p.tex('uSplat', 0, g.splat).tex('uAux', 1, g.aux).tex('uNoise', 2, this.noise);
      p.tex('uTileC', 3, g.tileC, gl.TEXTURE_2D_ARRAY).tex('uTileN', 4, g.tileN, gl.TEXTURE_2D_ARRAY);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.spriteCmds.sort((a, b) => a.key - b.key || a.atlas.id - b.atlas.id);
    {
      const p = this.pSprite.use();
      setCam(p);
      p.v2('uDepth', zNear, dK);
      this.drawInst(this.sprites, this.spriteCmds, p);
    }

    // ---- 阴影遮罩 ----
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fSh[0]);
    gl.viewport(0, 0, this.shW, this.shH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    {
      const p = this.pShadow.use();
      setCam(p);
      this.shadowCmds.sort((a, b) => a.atlas.id - b.atlas.id);
      this.drawInst(this.shadows, this.shadowCmds, p, true);
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaoEmpty);
    {
      const p = this.pBlur.use();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fSh[1]);
      p.tex('uTex', 0, this.tSh[0]).v2('uDir', 0.6 / this.shW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fSh[0]);
      p.tex('uTex', 0, this.tSh[1]).v2('uDir', 0, 0.6 / this.shH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- 光照 ----
    this.lightList.sort((a, b) => b.w - a.w);
    const nL = Math.min(MAX_LIGHTS, this.lightList.length);
    for (let i = 0; i < nL; i++) {
      const l = this.lightList[i];
      this.lightPos.set([l.x, l.y, l.z, l.r], i * 4);
      this.lightCol.set([l.c[0], l.c[1], l.c[2], 0], i * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fHdr);
    gl.viewport(0, 0, W, H);
    {
      const p = this.pLight.use();
      setCam(p);
      const g = this.ground;
      p.v4('uMap', g ? 1 / g.mapW : 1, g ? 1 / g.mapH : 1, 0, 0);
      p.tex('uAlbedo', 0, this.tAlbedo).tex('uNormalH', 1, this.tNormal).tex('uShadow', 2, this.tSh[0]).tex('uNoise', 3, this.noise);
      p.tex('uAux', 4, g ? g.aux : this.noise).tex('uMat', 5, this.tMat);
      p.v3('uSunDir', ...env.sunDir).v3('uSunCol', ...env.sunCol).v3('uAmbSky', ...env.ambSky).v3('uAmbGnd', ...env.ambGnd).v3('uSkyRefl', ...env.skyRefl);
      p.f('uTime', this.time).f('uShadowK', env.shadowK).i('uNumLights', nL);
      p.fv4('uLightPos[0]', this.lightPos).fv4('uLightCol[0]', this.lightCol);
      p.v4('uFog', ...env.fog);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- 自发光与特效（带深度测试，不写深度） ----
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.emisCmds.length) {
      const p = this.pEmis.use();
      setCam(p);
      p.v2('uDepth', zNear, dK);
      this.emisCmds.sort((a, b) => a.atlas.id - b.atlas.id);
      this.drawInst(this.emis, this.emisCmds, p);
    }
    if (this.fxN) {
      const p = this.pFx.use();
      setCam(p);
      p.v2('uDepth', zNear, dK).tex('uTex', 0, this.fxTex);
      gl.bindVertexArray(this.vaoFx);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fxVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.fxData.subarray(0, this.fxN * 36), gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, this.fxN * 6, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaoEmpty);

    // ---- 泛光 ----
    {
      const p = this.pDown.use();
      let src = this.tHdr, sw = W, sh = H;
      for (let i = 0; i < this.bloomT.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomF[i]);
        gl.viewport(0, 0, this.bloomS[i][0], this.bloomS[i][1]);
        p.tex('uTex', 0, src).v2('uTexel', 1 / sw, 1 / sh).f('uThreshold', i === 0 ? 1.0 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = this.bloomT[i]; [sw, sh] = this.bloomS[i];
      }
      const u = this.pUp.use();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.bloomT.length - 1; i > 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomF[i - 1]);
        gl.viewport(0, 0, this.bloomS[i - 1][0], this.bloomS[i - 1][1]);
        u.tex('uTex', 0, this.bloomT[i]).v2('uTexel', 1 / this.bloomS[i][0], 1 / this.bloomS[i][1]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    // ---- 合成 ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    {
      const p = this.pComp.use();
      p.tex('uHdr', 0, this.tHdr).tex('uBloom', 1, this.bloomT[0]);
      p.tex('uDbg', 2, this.debug === 1 ? this.tSh[0] : this.debug === 2 ? this.tAlbedo : this.tNormal).f('uDebug', this.debug);
      p.f('uBloomK', env.bloom).f('uExposure', env.exposure).f('uSat', env.sat).f('uTime', this.time).f('uVignette', env.vignette);
      p.v3('uTint', ...env.tint);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
}
