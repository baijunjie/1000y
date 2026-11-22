import * as THREE from 'three';

/** 体积雾里参与散射的点光源上限 */
export const FOG_LIGHTS = 12;

const VS = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
in vec2 vUv;
out vec4 o;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const DEPTH = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProjInv;
vec3 viewPos(vec2 uv){
  float d = texture(tDepth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}`;

// ---------------------------------------------------------------- 环境光遮蔽（只用深度，法线由深度重建）
const AO_FS = COMMON + DEPTH + /* glsl */ `
uniform mat4 uProj;
uniform vec2 uTexel;
uniform float uRadius;
void main(){
  float d = texture(tDepth, vUv).x;
  if (d >= 0.99999) { o = vec4(1.0, 1000.0, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 Pr = viewPos(vUv + vec2(uTexel.x, 0.0)), Pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 Pu = viewPos(vUv + vec2(0.0, uTexel.y)), Pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  vec3 t = normalize(abs(N.y) < 0.95 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(N, t);
  float phi = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  const int NS = 12;
  for (int i = 0; i < NS; i++) {
    float fi = (float(i) + 0.5) / float(NS);
    float r = sqrt(fi), a = float(i) * 2.39996323 + phi;
    vec3 dir = t * (cos(a) * r) + b * (sin(a) * r) + N * sqrt(max(0.0, 1.0 - r * r));
    float len = uRadius * mix(0.12, 1.0, fract(float(i) * 0.618 + phi));
    vec3 S = P + dir * len + N * 0.02;
    vec4 c = uProj * vec4(S, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    float sz = viewPos(uv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(1e-3, abs(P.z - sz)));
    occ += step(S.z + 0.03, sz) * range;
  }
  float ao = 1.0 - occ / float(NS);
  o = vec4(ao, -P.z, 0.0, 1.0);
}`;

const AO_BLUR_FS = COMMON + /* glsl */ `
uniform sampler2D tAo;
uniform vec2 uDir;
void main(){
  vec2 c = texture(tAo, vUv).rg;
  float sum = c.r * 0.227, w = 0.227;
  const float G[3] = float[3](0.194, 0.121, 0.054);
  for (int i = 1; i <= 3; i++) {
    for (int s = -1; s <= 1; s += 2) {
      vec2 v = texture(tAo, vUv + uDir * float(i * s)).rg;
      float k = G[i - 1] * max(0.0, 1.0 - abs(v.g - c.g) / (0.04 * c.g + 0.05));
      sum += v.r * k; w += k;
    }
  }
  o = vec4(sum / w, c.g, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- 体积雾：贴地雾气、日光光束、点光源光晕
const FOG_FS = COMMON + DEPTH + /* glsl */ `
#define NL ${FOG_LIGHTS}
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform sampler2DShadow tSunShadow;
uniform mat4 uSunMatrix;
uniform float uSunShadowOn;
uniform sampler2D tNoise;
uniform vec3 uSunDir, uSunCol, uFogCol;
uniform float uDensity, uFalloff, uTime, uShaftK, uGlowK;
uniform int uNumLights;
uniform vec4 uLightPos[NL];
uniform vec3 uLightCol[NL];
void main(){
  vec3 Pv = viewPos(vUv);
  vec3 Pw = (uCamWorld * vec4(Pv, 1.0)).xyz;
  vec3 ray = Pw - uCamPos;
  float L = length(ray);
  vec3 dir = ray / L;
  L = min(L, 140.0);
  float jit = ign(gl_FragCoord.xy);
  const int NSTEP = 16;
  float stepLen = L / float(NSTEP);
  // 前向散射：逆光看时光束更亮
  float cosT = dot(dir, uSunDir);
  float g = 0.55;
  float phase = mix(0.6, (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5), 0.6);
  vec3 ins = vec3(0.0);
  float T = 1.0;
  float densAcc = 0.0;
  for (int i = 0; i < NSTEP; i++) {
    vec3 p = uCamPos + dir * ((float(i) + jit) * stepLen);
    float h = max(p.y, 0.0);
    float n1 = texture(tNoise, p.xz * 0.021 + uTime * vec2(0.006, 0.003)).r;
    float n2 = texture(tNoise, p.xz * 0.06 - uTime * vec2(0.009, 0.0)).g;
    float dens = uDensity * exp(-h * uFalloff) * (0.35 + 1.5 * smoothstep(0.3, 0.8, n1 * 0.65 + n2 * 0.35));
    float vis = 1.0;
    if (uSunShadowOn > 0.5) {
      vec4 sc = uSunMatrix * vec4(p, 1.0);
      sc.xyz /= sc.w;
      if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) vis = texture(tSunShadow, vec3(sc.xy, sc.z - 0.0008));
    }
    // 光束不随高度衰减得那么快：高处也有悬浮的尘
    float air = uDensity * 0.1 * exp(-h * 0.12);
    float a = 1.0 - exp(-(dens + air * 0.25) * stepLen);
    vec3 Lin = uFogCol + uSunCol * vis * phase * uShaftK;
    ins += T * a * Lin;
    ins += T * (1.0 - exp(-air * stepLen)) * uSunCol * vis * phase * uShaftK;
    T *= 1.0 - a;
    densAcc += dens;
  }
  // 点光源在雾里的散射：沿视线对 1/d² 的解析积分
  float avg = uDensity * 0.5 + densAcc / float(NSTEP) * 0.5;
  for (int i = 0; i < NL; i++) {
    if (i >= uNumLights) break;
    vec3 q = uCamPos - uLightPos[i].xyz;
    float r = uLightPos[i].w;
    float bq = dot(q, dir);
    float c2 = dot(q, q) - bq * bq;
    float c = sqrt(c2 + 0.35);
    float I = (atan((L + bq) / c) - atan(bq / c)) / c;
    float win = clamp(1.0 - c2 / (r * r), 0.0, 1.0);
    ins += uLightCol[i] * (I * win * win * uGlowK * avg);
  }
  o = vec4(ins, T);
}`;

const FOG_BLUR_FS = COMMON + /* glsl */ `
uniform sampler2D tFog;
uniform vec2 uDir;
void main(){
  vec4 c = texture(tFog, vUv) * 0.2270270270;
  c += (texture(tFog, vUv + uDir * 1.3846153846) + texture(tFog, vUv - uDir * 1.3846153846)) * 0.3162162162;
  c += (texture(tFog, vUv + uDir * 3.2307692308) + texture(tFog, vUv - uDir * 3.2307692308)) * 0.0702702703;
  o = c;
}`;

// ---------------------------------------------------------------- 合成、泛光、调色
const COMBINE_FS = COMMON + /* glsl */ `
uniform sampler2D tScene, tAo, tFog;
uniform float uAoK;
void main(){
  vec3 c = texture(tScene, vUv).rgb;
  float ao = texture(tAo, vUv).r;
  // 亮处少压一些：遮蔽只该作用在环境光上
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(1.0, ao, uAoK * (1.0 - 0.5 * smoothstep(0.4, 2.0, lum)));
  vec4 f = texture(tFog, vUv);
  o = vec4(c * f.a + f.rgb, 1.0);
}`;

const BLOOM_DOWN_FS = COMMON + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
void main(){
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.125;
  if (uThreshold > 0.0) {
    float l = max(c.r, max(c.g, c.b));
    c *= smoothstep(uThreshold * 0.6, uThreshold * 1.8, l);
    c = min(c, vec3(16.0));
  }
  o = vec4(c, 1.0);
}`;

const BLOOM_UP_FS = COMMON + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main(){
  vec3 c = texture(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb
         + texture(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-0.7, -0.7)).rgb + texture(tSrc, vUv + uTexel * vec2(0.7, -0.7)).rgb
     + texture(tSrc, vUv + uTexel * vec2(-0.7, 0.7)).rgb + texture(tSrc, vUv + uTexel * vec2(0.7, 0.7)).rgb;
  o = vec4(c * 0.125, 1.0);
}`;

const FINAL_FS = COMMON + /* glsl */ `
uniform sampler2D tHdr, tBloom, tDbg;
uniform float uBloomK, uExposure, uSat, uContrast, uTime, uVignette, uDebug;
uniform vec3 uTint;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  if (uDebug > 0.5) { vec4 d = texture(tDbg, vUv); o = vec4(uDebug > 2.5 ? vec3(d.a) : uDebug > 1.5 ? d.rgb : vec3(d.r), 1.0); return; }
  vec3 c = texture(tHdr, vUv).rgb + texture(tBloom, vUv).rgb * uBloomK;
  c *= uExposure * uTint;
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.18, 0.9, dot(q, q) * 2.0);
  // ACES 近似
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  // 对比度：以中灰为轴的 S 曲线
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c = pow(c, vec3(1.0 / 2.2));
  c += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * (2.2 / 255.0);
  o = vec4(c, 1.0);
}`;

export interface PostParams {
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  sunCol: THREE.Color;
  fogCol: THREE.Color;
  fogDensity: number;
  fogFalloff: number;
  shaftK: number;
  glowK: number;
  aoK: number;
  bloom: number;
  exposure: number;
  sat: number;
  contrast: number;
  tint: THREE.Color;
  vignette: number;
  time: number;
  numLights: number;
  lightPos: Float32Array;
  lightCol: Float32Array;
  debug: number;
}

/** 后期处理链：遮蔽 → 体积雾 → 合成 → 泛光 → 色调映射与调色 */
export class Post {
  rtScene!: THREE.WebGLRenderTarget;
  private rtAo: THREE.WebGLRenderTarget[] = [];
  private rtFog: THREE.WebGLRenderTarget[] = [];
  private rtComb!: THREE.WebGLRenderTarget;
  private bloom: THREE.WebGLRenderTarget[] = [];
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private mAo: THREE.ShaderMaterial; private mAoBlur: THREE.ShaderMaterial;
  private mFog: THREE.ShaderMaterial; private mFogBlur: THREE.ShaderMaterial;
  private mComb: THREE.ShaderMaterial; private mDown: THREE.ShaderMaterial; private mUp: THREE.ShaderMaterial; private mFinal: THREE.ShaderMaterial;
  W = 2; H = 2;

  constructor(private r: THREE.WebGLRenderer, noise: THREE.Texture, private samples = 4) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mk = (fs: string, uniforms: Record<string, any>, blending: THREE.Blending = THREE.NoBlending) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, blending,
      uniforms: Object.fromEntries(Object.entries(uniforms).map(([k, v]) => [k, { value: v }])),
    });
    const m4 = () => new THREE.Matrix4(), v2 = () => new THREE.Vector2(), v3 = () => new THREE.Vector3();
    this.mAo = mk(AO_FS, { tDepth: null, uProjInv: m4(), uProj: m4(), uTexel: v2(), uRadius: 0.7 });
    this.mAoBlur = mk(AO_BLUR_FS, { tAo: null, uDir: v2() });
    this.mFog = mk(FOG_FS, {
      tDepth: null, uProjInv: m4(), uCamWorld: m4(), uCamPos: v3(), tSunShadow: null, uSunMatrix: m4(), uSunShadowOn: 0, tNoise: noise,
      uSunDir: v3(), uSunCol: v3(), uFogCol: v3(), uDensity: 0, uFalloff: 0.5, uTime: 0, uShaftK: 1, uGlowK: 1,
      uNumLights: 0, uLightPos: new Float32Array(FOG_LIGHTS * 4), uLightCol: new Float32Array(FOG_LIGHTS * 3),
    });
    this.mFogBlur = mk(FOG_BLUR_FS, { tFog: null, uDir: v2() });
    this.mComb = mk(COMBINE_FS, { tScene: null, tAo: null, tFog: null, uAoK: 1 });
    this.mDown = mk(BLOOM_DOWN_FS, { tSrc: null, uTexel: v2(), uThreshold: 0 });
    this.mUp = mk(BLOOM_UP_FS, { tSrc: null, uTexel: v2() }, THREE.AdditiveBlending);
    this.mFinal = mk(FINAL_FS, {
      tHdr: null, tBloom: null, tDbg: null, uBloomK: 0.5, uExposure: 1, uSat: 1, uContrast: 0, uTime: 0, uVignette: 0.3, uDebug: 0, uTint: v3(),
    });
  }

  resize(W: number, H: number) {
    if (W === this.W && H === this.H && this.rtScene) return;
    this.W = W; this.H = H;
    [this.rtScene, ...this.rtAo, ...this.rtFog, this.rtComb, ...this.bloom].forEach((t) => t?.dispose());
    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false } as const;
    const depth = new THREE.DepthTexture(W, H);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rtScene = new THREE.WebGLRenderTarget(W, H, { ...hdr, depthBuffer: true, depthTexture: depth, samples: this.samples });
    const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
    this.rtAo = [0, 1].map(() => new THREE.WebGLRenderTarget(hw, hh, hdr));
    this.rtFog = [0, 1].map(() => new THREE.WebGLRenderTarget(hw, hh, hdr));
    this.rtComb = new THREE.WebGLRenderTarget(W, H, hdr);
    this.bloom = [];
    let bw = W, bh = H;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      this.bloom.push(new THREE.WebGLRenderTarget(bw, bh, hdr));
    }
  }

  private pass(m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  render(p: PostParams) {
    const r = this.r, cam = p.camera, depth = this.rtScene.depthTexture!;
    const u = (m: THREE.ShaderMaterial) => m.uniforms;
    r.autoClear = false;

    // ---- 遮蔽 ----
    let a = u(this.mAo);
    a.tDepth.value = depth; a.uProjInv.value.copy(cam.projectionMatrixInverse); a.uProj.value.copy(cam.projectionMatrix);
    a.uTexel.value.set(1 / this.W, 1 / this.H);
    this.pass(this.mAo, this.rtAo[0]);
    a = u(this.mAoBlur);
    a.tAo.value = this.rtAo[0].texture; a.uDir.value.set(1 / this.rtAo[0].width, 0);
    this.pass(this.mAoBlur, this.rtAo[1]);
    a.tAo.value = this.rtAo[1].texture; a.uDir.value.set(0, 1 / this.rtAo[0].height);
    this.pass(this.mAoBlur, this.rtAo[0]);

    // ---- 体积雾 ----
    const f = u(this.mFog);
    f.tDepth.value = depth; f.uProjInv.value.copy(cam.projectionMatrixInverse); f.uCamWorld.value.copy(cam.matrixWorld);
    f.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    const sm = p.sun.shadow.map;
    f.tSunShadow.value = sm ? sm.depthTexture : null;
    f.uSunShadowOn.value = sm && p.sun.castShadow ? 1 : 0;
    f.uSunMatrix.value.copy(p.sun.shadow.matrix);
    f.uSunDir.value.copy(p.sunDir); f.uSunCol.value.set(p.sunCol.r, p.sunCol.g, p.sunCol.b); f.uFogCol.value.set(p.fogCol.r, p.fogCol.g, p.fogCol.b);
    f.uDensity.value = p.fogDensity; f.uFalloff.value = p.fogFalloff; f.uTime.value = p.time; f.uShaftK.value = p.shaftK; f.uGlowK.value = p.glowK;
    f.uNumLights.value = p.numLights; f.uLightPos.value = p.lightPos; f.uLightCol.value = p.lightCol;
    this.pass(this.mFog, this.rtFog[0]);
    const fb = u(this.mFogBlur);
    fb.tFog.value = this.rtFog[0].texture; fb.uDir.value.set(1 / this.rtFog[0].width, 0);
    this.pass(this.mFogBlur, this.rtFog[1]);
    fb.tFog.value = this.rtFog[1].texture; fb.uDir.value.set(0, 1 / this.rtFog[0].height);
    this.pass(this.mFogBlur, this.rtFog[0]);

    // ---- 合成 ----
    const c = u(this.mComb);
    c.tScene.value = this.rtScene.texture; c.tAo.value = this.rtAo[0].texture; c.tFog.value = this.rtFog[0].texture; c.uAoK.value = p.aoK;
    this.pass(this.mComb, this.rtComb);

    // ---- 泛光 ----
    const d = u(this.mDown);
    let src = this.rtComb;
    for (let i = 0; i < this.bloom.length; i++) {
      d.tSrc.value = src.texture; d.uTexel.value.set(1 / src.width, 1 / src.height); d.uThreshold.value = i === 0 ? 1.0 : 0;
      this.pass(this.mDown, this.bloom[i]);
      src = this.bloom[i];
    }
    const up = u(this.mUp);
    for (let i = this.bloom.length - 1; i > 0; i--) {
      up.tSrc.value = this.bloom[i].texture; up.uTexel.value.set(1 / this.bloom[i].width, 1 / this.bloom[i].height);
      this.pass(this.mUp, this.bloom[i - 1]);
    }

    // ---- 输出 ----
    const o = u(this.mFinal);
    o.tHdr.value = this.rtComb.texture; o.tBloom.value = this.bloom[0].texture;
    o.tDbg.value = p.debug === 1 ? this.rtAo[0].texture : this.rtFog[0].texture; o.uDebug.value = p.debug;
    o.uBloomK.value = p.bloom; o.uExposure.value = p.exposure; o.uSat.value = p.sat; o.uContrast.value = p.contrast;
    o.uTime.value = p.time; o.uVignette.value = p.vignette; o.uTint.value.set(p.tint.r, p.tint.g, p.tint.b);
    this.pass(this.mFinal, null);
    r.autoClear = true;
  }
}
