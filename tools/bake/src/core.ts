import * as THREE from 'three';
import { COS, SIN, SUN_DIR, SHADOW_SCALE } from '../../../src/shared/consts';

export interface BakeFrame {
  key: string;
  /** 设置姿势/朝向 */
  apply?: () => void;
}

export interface BakeItem {
  root: THREE.Object3D;
  frames: BakeFrame[];
  /** 是否烘焙地面阴影（默认 true） */
  shadow?: boolean;
  /** 是否额外烘焙自发光帧 */
  emissive?: boolean;
  /** 附加信息（写入 atlas info[key]） */
  info?: Record<string, any>;
}

export interface FrameResult {
  key: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  color: Uint8ClampedArray; // 直通 alpha 的 sRGB
  normal: Uint8ClampedArray; // (nx, ny, height, 255)
  shadow?: { w: number; h: number; ax: number; ay: number; data: Uint8ClampedArray };
  emissive?: { w: number; h: number; ax: number; ay: number; color: Uint8ClampedArray; normal: Uint8ClampedArray };
}

const K_FLOOR = 0.3; // 环境光下限（未被天空照到的部分）

function fibHemisphere(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    // 均匀分布于上半球（y ∈ (0.04, 1]）
    const y = 0.04 + (0.96 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return out;
}

const linToSrgb = (v: number) => {
  v = Math.min(1, Math.max(0, v));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

export class Baker {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  light = new THREE.DirectionalLight(0xffffff, 1);
  amb = new THREE.AmbientLight(0xffffff, 0);
  ground: THREE.Mesh;
  rtPass: THREE.WebGLRenderTarget;
  rtAccum: THREE.WebGLRenderTarget;
  blitScene = new THREE.Scene();
  blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blitMat: THREE.ShaderMaterial;
  heightMat: THREE.ShaderMaterial;
  blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  normalMats = new Map<THREE.Material, THREE.MeshNormalMaterial>();
  emisMats = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  dirI = 1; // 让白色朝上表面被正上方平行光照成 1 的强度
  ambI = 1;
  aoDirs: THREE.Vector3[];
  groundDirs: THREE.Vector3[];
  hScale = 3;

  constructor(public aoSamples = 28, public shadowRes = 1024) {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.aoDirs = fibHemisphere(aoSamples);
    this.groundDirs = fibHemisphere(Math.round(aoSamples * 2.5));

    this.light.castShadow = true;
    this.light.shadow.mapSize.set(shadowRes, shadowRes);
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.012;
    this.scene.add(this.light, this.light.target, this.amb);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.scene.add(this.ground);

    const opt = {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    } as const;
    this.rtPass = new THREE.WebGLRenderTarget(4, 4, opt);
    this.rtAccum = new THREE.WebGLRenderTarget(4, 4, { ...opt, depthBuffer: false });

    this.blitMat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, w: { value: new THREE.Vector4(1, 1, 1, 1) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tex; uniform vec4 w; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tex, vUv) * w; }',
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat));

    this.heightMat = new THREE.ShaderMaterial({
      uniforms: { hScale: { value: 3 } },
      vertexShader: `
        #include <common>
        #include <skinning_pars_vertex>
        varying float vH;
        void main(){
          #include <skinbase_vertex>
          #include <begin_vertex>
          #include <skinning_vertex>
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vH = wp.y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: 'uniform float hScale; varying float vH; void main(){ gl_FragColor = vec4(clamp(vH / hScale, 0.0, 1.0), 0.0, 0.0, 1.0); }',
      side: THREE.DoubleSide,
    });
    this.calibrate();
  }

  /** 标定灯光强度，避免依赖 three 的光照单位约定 */
  calibrate() {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    this.scene.add(plane);
    this.setRT(8, 8);
    const cam = this.cam;
    cam.left = -0.5; cam.right = 0.5; cam.top = 0.5; cam.bottom = -0.5;
    cam.position.set(0, 50, 0.0001);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    const read = () => {
      const buf = new Float32Array(4);
      this.renderer.readRenderTargetPixels(this.rtPass, 4, 4, 1, 1, buf);
      return buf[0];
    };
    this.light.castShadow = false;
    this.light.position.set(0, 10, 0);
    this.light.target.position.set(0, 0, 0);
    this.light.intensity = 1;
    this.amb.intensity = 0;
    this.renderPass();
    this.dirI = 1 / Math.max(1e-4, read());
    this.light.visible = false;
    this.amb.intensity = 1;
    this.renderPass();
    this.ambI = 1 / Math.max(1e-4, read());
    this.light.visible = true;
    this.light.castShadow = true;
    this.amb.intensity = 0;
    this.scene.remove(plane);
  }

  setRT(w: number, h: number) {
    if (this.rtPass.width !== w || this.rtPass.height !== h) {
      this.rtPass.setSize(w, h);
      this.rtAccum.setSize(w, h);
    }
  }

  renderPass() {
    const r = this.renderer;
    r.setRenderTarget(this.rtPass);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.cam);
  }

  clearAccum() {
    const r = this.renderer;
    r.setRenderTarget(this.rtAccum);
    r.setClearColor(0x000000, 0);
    r.clear();
  }

  addToAccum(wRgb: number, wA: number) {
    this.blitMat.uniforms.tex.value = this.rtPass.texture;
    this.blitMat.uniforms.w.value.set(wRgb, wRgb, wRgb, wA);
    this.renderer.setRenderTarget(this.rtAccum);
    this.renderer.render(this.blitScene, this.blitCam);
  }

  read(rt: THREE.WebGLRenderTarget): Float32Array {
    const buf = new Float32Array(rt.width * rt.height * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    return buf;
  }

  /** 盒式降采样并上下翻转（GL 行序 → 图像行序） */
  down(src: Float32Array, W: number, H: number, ss: number): Float32Array {
    const w = W / ss, h = H / ss;
    const out = new Float32Array(w * h * 4);
    const inv = 1 / (ss * ss);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let j = 0; j < ss; j++) {
          const row = (H - 1 - (y * ss + j)) * W;
          for (let i = 0; i < ss; i++) {
            const p = (row + x * ss + i) * 4;
            r += src[p]; g += src[p + 1]; b += src[p + 2]; a += src[p + 3];
          }
        }
        const o = (y * w + x) * 4;
        out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv; out[o + 3] = a * inv;
      }
    }
    return out;
  }

  /** 以投影像素矩形设置相机（left/top 为最终像素坐标，原点 = 世界原点） */
  setCam(left: number, top: number, w: number, h: number, ppu: number) {
    const cam = this.cam;
    cam.left = left / ppu;
    cam.right = (left + w) / ppu;
    cam.top = -top / ppu;
    cam.bottom = -(top + h) / ppu;
    const D = 150;
    cam.position.set(0, D * SIN, D * COS);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  setLight(dir: THREE.Vector3, center: THREE.Vector3, radius: number, intensity: number, farExtra = 0) {
    const l = this.light;
    l.intensity = intensity;
    l.position.copy(center).addScaledVector(dir, radius + 2);
    l.target.position.copy(center);
    l.target.updateMatrixWorld();
    const c = l.shadow.camera;
    c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
    // farExtra：地面接收点可能落在包围球之外（高物体的投影），需要把远裁面推远
    c.near = 0.5; c.far = radius * 2 + 4 + farExtra;
    c.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  collectMaterials(root: THREE.Object3D): THREE.Material[] {
    const set = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => set.add(x));
      else set.add(m);
    });
    return [...set];
  }

  swapMaterials(root: THREE.Object3D, fn: (m: THREE.Material) => THREE.Material): () => void {
    const saved: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      saved.push([mesh, mesh.material]);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fn) : fn(mesh.material);
    });
    return () => saved.forEach(([m, mat]) => (m.material = mat));
  }

  normalMatFor = (m: THREE.Material): THREE.MeshNormalMaterial => {
    let n = this.normalMats.get(m);
    if (!n) {
      const src = m as THREE.MeshLambertMaterial;
      n = new THREE.MeshNormalMaterial({
        side: src.side,
        flatShading: src.flatShading,
        bumpMap: src.bumpMap ?? null,
        bumpScale: src.bumpScale ?? 1,
        normalMap: src.normalMap ?? null,
      });
      if (src.normalScale) n.normalScale.copy(src.normalScale);
      this.normalMats.set(m, n);
    }
    return n;
  };

  glossMats = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  glossMatFor = (m: THREE.Material): THREE.Material => {
    let b = this.glossMats.get(m);
    if (!b) {
      const g = Math.min(1, Math.max(0, (m.userData.gloss as number | undefined) ?? 0));
      b = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(g, g, g, THREE.LinearSRGBColorSpace), side: m.side });
      this.glossMats.set(m, b);
    }
    return b;
  };

  emisMatFor = (m: THREE.Material): THREE.Material => {
    const e = m.userData.emissive as number | string | undefined;
    if (e === undefined) return this.blackMat;
    let b = this.emisMats.get(m);
    if (!b) {
      b = new THREE.MeshBasicMaterial({ color: e as any, side: m.side, map: (m as any).emissiveMap ?? null });
      this.emisMats.set(m, b);
    }
    return b;
  };

  bakeFrame(item: BakeItem, frame: BakeFrame, ppu: number, ss: number): FrameResult | null {
    const root = item.root;
    if (root.parent !== this.scene) this.scene.add(root);
    root.visible = true;
    frame.apply?.();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.userData.noShadow) { mesh.castShadow = false; mesh.receiveShadow = true; }
        else { mesh.castShadow = true; mesh.receiveShadow = true; }
      }
    });
    root.traverse((o) => {
      const sk = o as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) { sk.skeleton.update(); sk.computeBoundingBox(); sk.computeBoundingSphere(); }
    });
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    // 投影包围矩形
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? box.max.x : box.min.x;
      const y = i & 2 ? box.max.y : box.min.y;
      const z = i & 4 ? box.max.z : box.min.z;
      const sy = z * SIN - y * COS;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    const left = Math.floor(minX * ppu) - 2, top = Math.floor(minY * ppu) - 2;
    const w = Math.ceil(maxX * ppu) + 2 - left, h = Math.ceil(maxY * ppu) + 2 - top;
    const W = w * ss, H = h * ss;
    this.setRT(W, H);
    this.setCam(left, top, w, h, ppu);

    const mats = this.collectMaterials(root);
    const N = this.aoDirs.length;
    const radius = sphere.radius * 1.02 + 0.05;

    // ---- 颜色（天空遮蔽累积） ----
    this.ground.visible = false;
    this.clearAccum();
    this.amb.intensity = 0;
    this.light.visible = true;
    for (const d of this.aoDirs) {
      this.setLight(d, sphere.center, radius, ((1 - K_FLOOR) * 2 * this.dirI) / N);
      this.renderPass();
      this.addToAccum(1, 0);
    }
    this.light.visible = false;
    this.amb.intensity = K_FLOOR * this.ambI;
    this.renderPass();
    this.addToAccum(1, 1);
    this.light.visible = true;
    this.amb.intensity = 0;
    const col = this.down(this.read(this.rtAccum), W, H, ss);

    // ---- 法线 ----
    let restore = this.swapMaterials(root, this.normalMatFor);
    this.renderPass();
    restore();
    const nrm = this.down(this.read(this.rtPass), W, H, ss);

    // ---- 高度 ----
    this.heightMat.uniforms.hScale.value = this.hScale;
    this.scene.overrideMaterial = this.heightMat;
    this.renderPass();
    this.scene.overrideMaterial = null;
    const hgt = this.down(this.read(this.rtPass), W, H, ss);

    // ---- 光泽 ----
    restore = this.swapMaterials(root, this.glossMatFor);
    this.renderPass();
    restore();
    const gls = this.down(this.read(this.rtPass), W, H, ss);
    for (let i = 0; i < hgt.length; i += 4) hgt[i + 1] = gls[i];

    const res = this.compose(frame.key, col, nrm, hgt, w, h, -left, -top);
    if (!res) return null;

    // ---- 自发光 ----
    if (item.emissive) {
      restore = this.swapMaterials(root, this.emisMatFor);
      this.renderPass();
      restore();
      const em = this.down(this.read(this.rtPass), W, H, ss);
      // alpha = 亮度覆盖
      for (let i = 0; i < em.length; i += 4) {
        const m = Math.max(em[i], em[i + 1], em[i + 2]);
        em[i + 3] = Math.min(em[i + 3], m > 0.004 ? Math.min(1, m * 1.5 + 0.2) : 0);
        const a = em[i + 3];
        // 转成预乘
        em[i] = Math.min(1, em[i]) * (a > 0 ? 1 : 0);
        em[i + 1] = Math.min(1, em[i + 1]) * (a > 0 ? 1 : 0);
        em[i + 2] = Math.min(1, em[i + 2]) * (a > 0 ? 1 : 0);
        em[i] *= a; em[i + 1] *= a; em[i + 2] *= a;
      }
      const e = this.compose(frame.key + '@e', em, nrm, hgt, w, h, -left, -top, true);
      if (e) res.emissive = { w: e.w, h: e.h, ax: e.ax, ay: e.ay, color: e.color, normal: e.normal };
    }

    // ---- 地面阴影：R = 日光投影，G = 环境遮蔽 ----
    if (item.shadow !== false) {
      const sp = ppu * SHADOW_SCALE;
      const hgtMax = Math.max(0.05, box.max.y);
      const m = Math.min(2.2, Math.max(0.3, hgtMax * 0.55));
      const ox = (-SUN_DIR[0] / SUN_DIR[1]) * hgtMax, oz = (-SUN_DIR[2] / SUN_DIR[1]) * hgtMax;
      const gx0 = box.min.x - m + Math.min(0, ox), gx1 = box.max.x + m + Math.max(0, ox);
      const gz0 = box.min.z - m + Math.min(0, oz), gz1 = box.max.z + m + Math.max(0, oz);
      const sl = Math.floor(gx0 * sp) - 1, st = Math.floor(gz0 * SIN * sp) - 1;
      const sw = Math.ceil(gx1 * sp) + 1 - sl, sh = Math.ceil(gz1 * SIN * sp) + 1 - st;
      const sss = 2;
      this.setRT(sw * sss, sh * sss);
      this.setCam(sl, st, sw, sh, sp);
      for (const mt of mats) { mt.colorWrite = false; mt.depthWrite = false; }
      this.ground.visible = true;
      this.clearAccum();
      const gN = this.groundDirs.length;
      for (const d of this.groundDirs) {
        // 余弦加权的天空辐照度：无遮挡时累积值 ≈ 1
        this.setLight(d, sphere.center, radius, (2 * this.dirI) / gN, Math.min(60, hgtMax / d.y));
        this.renderPass();
        this.addToAccum(1, 0);
      }
      const ao = blur(this.down(this.read(this.rtAccum), sw * sss, sh * sss, sss), sw, sh, 2);
      const sun = new THREE.Vector3(...SUN_DIR);
      this.setLight(sun, sphere.center, radius, this.dirI / sun.y, hgtMax / sun.y);
      this.renderPass();
      const sv = this.down(this.read(this.rtPass), sw * sss, sh * sss, sss);
      this.ground.visible = false;
      for (const mt of mats) { mt.colorWrite = true; mt.depthWrite = true; }

      const data = new Uint8ClampedArray(sw * sh * 4);
      let bx0 = sw, by0 = sh, bx1 = -1, by1 = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const p = (y * sw + x) * 4;
          const s = Math.round((1 - Math.min(1, sv[p])) * 255);
          // 减去一个小阈值：去掉低角度天光造成的远场微弱遮蔽（否则高物体会带一大片淡淡的矩形暗区）
          // 靠近烘焙区域边界时把遮蔽渐隐到 0：大物体的遮蔽晕会超出区域，直接裁掉会在地面上留下一条直边
          const fadePx = Math.max(4, Math.min(28, Math.min(sw, sh) * 0.12));
          const fade = Math.min(1, Math.min(x, sw - 1 - x, y, sh - 1 - y) / fadePx);
          const a = Math.round(Math.min(1, Math.max(0, 1 - ao[p] - 0.035) * 1.2) * fade * 255);
          data[p] = s; data[p + 1] = a; data[p + 2] = 0; data[p + 3] = 255;
          if (s > 5 || a > 5) {
            if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
            if (y < by0) by0 = y; if (y > by1) by1 = y;
          }
        }
      }
      if (bx1 >= bx0) {
        const tw = bx1 - bx0 + 1, th = by1 - by0 + 1;
        const out = new Uint8ClampedArray(tw * th * 4);
        for (let y = 0; y < th; y++) {
          out.set(data.subarray(((y + by0) * sw + bx0) * 4, ((y + by0) * sw + bx0 + tw) * 4), y * tw * 4);
        }
        res.shadow = { w: tw, h: th, ax: -sl - bx0, ay: -st - by0, data: out };
      }
    }
    return res;
  }

  /** 浮点缓冲 → 8 位贴图，裁剪并做边缘外扩 */
  compose(
    key: string, col: Float32Array, nrm: Float32Array, hgt: Float32Array,
    w: number, h: number, ax: number, ay: number, premultSrgb = false,
  ): FrameResult | null {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (col[(y * w + x) * 4 + 3] > 2.5 / 255) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0) return null;
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1);
    x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    const color = new Uint8ClampedArray(tw * th * 4);
    const normal = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const s = ((y + y0) * w + x + x0) * 4, o = (y * tw + x) * 4;
        const a = col[s + 3];
        if (a > 1 / 255) {
          // 颜色以「线性空间预乘 alpha 后再做 sRGB 编码」存储：运行时按 sRGB 纹理采样即得预乘的线性颜色，
          // 双线性过滤与 mipmap 都正确，也不依赖透明像素下的 RGB（有损压缩可以随意清零）
          color[o] = Math.round(linToSrgb(col[s]) * 255);
          color[o + 1] = Math.round(linToSrgb(col[s + 1]) * 255);
          color[o + 2] = Math.round(linToSrgb(col[s + 2]) * 255);
          color[o + 3] = Math.round(Math.min(1, a) * 255);
        }
        const na = nrm[s + 3];
        if (na > 1 / 255) {
          let nx = (nrm[s] / na) * 2 - 1, ny = (nrm[s + 1] / na) * 2 - 1, nz = (nrm[s + 2] / na) * 2 - 1;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l; ny /= l; nz /= l;
          if (nz < 0) { const l2 = Math.hypot(nx, ny) || 1; nx /= l2; ny /= l2; }
          normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
          normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
          normal[o + 2] = Math.round(Math.min(1, Math.max(0, hgt[s] / Math.max(1e-4, hgt[s + 3]))) * 255);
          // alpha 存「1 − 光泽」：没有 alpha 通道的旧图集读出来就是光泽 0
          normal[o + 3] = 255 - Math.round(Math.min(0.97, Math.max(0, hgt[s + 1] / Math.max(1e-4, hgt[s + 3]))) * 255);
        }
      }
    }
    dilate(color, normal, tw, th, 6);
    return { key, w: tw, h: th, ax: ax - x0, ay: ay - y0, color, normal };
  }
}

/** 对 R 通道做两遍盒式模糊 */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = src[i * 4];
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += a[y * w + xx]; c++; } }
      b[y * w + x] = s / c;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += b[yy * w + x]; c++; } }
      a[y * w + x] = s / c;
    }
  }
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out[i * 4] = a[i];
  return out;
}

/** 把不透明像素的法线/高度/光泽向透明区域外扩，避免线性过滤取到垃圾值（颜色是预乘的，不需要） */
function dilate(color: Uint8ClampedArray, normal: Uint8ClampedArray, w: number, h: number, iters: number) {
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = color[i * 4 + 3] > 0 ? 1 : 0;
  for (let it = 0; it < iters; it++) {
    const next = filled.slice();
    let any = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, nx = 0, ny = 0, nh = 0, ng = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (!filled[j]) continue;
            r += color[j * 4]; g += color[j * 4 + 1]; b += color[j * 4 + 2];
            nx += normal[j * 4]; ny += normal[j * 4 + 1]; nh += normal[j * 4 + 2]; ng += normal[j * 4 + 3];
            c++;
          }
        }
        if (c) {
          normal[i * 4] = nx / c; normal[i * 4 + 1] = ny / c; normal[i * 4 + 2] = nh / c; normal[i * 4 + 3] = ng / c;
          next[i] = 1;
          any = true;
        }
      }
    }
    filled = next;
    if (!any) break;
  }
}
