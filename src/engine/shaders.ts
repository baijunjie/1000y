import { COS, SIN } from '../shared/consts';

export const HMAX = 16;
export const MAX_LIGHTS = 24;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2DArray;
const float SIN = ${SIN.toFixed(8)};
const float COS = ${COS.toFixed(8)};
const float HMAX = ${HMAX.toFixed(1)};
`;

export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- 地表
export const GROUND_FS = HEAD + `
uniform vec4 uCam;    // camX, camYp, ppm
uniform vec2 uRes;
uniform vec4 uMap;    // 1/mapW, 1/mapH
uniform vec2 uDepth;  // zNear, 1/(2R)
uniform sampler2D uSplat, uAux, uNoise;
uniform sampler2DArray uTileC, uTileN;
in vec2 vUv;
layout(location=0) out vec4 oA;
layout(location=1) out vec4 oN;
layout(location=2) out vec4 oM;

void layer(float i, vec2 uv, out vec3 c, out vec3 n) {
  c = texture(uTileC, vec3(uv, i)).rgb;
  n = texture(uTileN, vec3(uv, i)).rgb;
}

void main(){
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  float X = uCam.x + (px.x - uRes.x * 0.5) / uCam.z;
  float Yp = uCam.y + (px.y - uRes.y * 0.5) / uCam.z;
  float Z = Yp / SIN;
  vec2 w = vec2(X, Z);
  vec3 nzL = texture(uNoise, w * 0.021).rgb;
  vec3 nzM = texture(uNoise, w * 0.13).rgb;
  vec2 suv = (w + (nzM.xy - 0.5) * 1.1) * uMap.xy;
  vec4 sp = texture(uSplat, suv);
  vec4 aux = texture(uAux, suv);
  float wg = max(0.0, 1.0 - sp.r - sp.g - sp.b - sp.a);

  vec2 uv = w * 0.25;
  vec3 c0, n0, c1, n1, c2, n2, c3, n3, c4, n4, c0b, n0b;
  layer(0.0, uv, c0, n0);
  // 草地第二次采样（旋转 + 缩放）打散平铺感
  const mat2 R = mat2(0.3907, 0.9205, -0.9205, 0.3907);
  layer(0.0, R * uv * 0.77 + 0.37, c0b, n0b);
  vec2 n0bxz = transpose(R) * (n0b.xy * 2.0 - 1.0);
  float gm = smoothstep(0.38, 0.62, nzM.b);
  c0 = mix(c0, c0b, gm);
  n0 = vec3(mix(n0.xy, n0bxz * 0.5 + 0.5, gm), mix(n0.z, n0b.z, gm));
  c0 *= mix(vec3(1.1, 1.0, 0.72), vec3(0.86, 1.04, 0.92), aux.b);
  layer(1.0, uv, c1, n1);
  layer(2.0, uv, c2, n2);
  c2 *= vec3(0.74, 0.72, 0.68);
  layer(3.0, uv, c3, n3);
  layer(4.0, uv, c4, n4);

  // 高度混合
  float b0 = wg > 0.003 ? wg + n0.z * 0.6 : 0.0;
  float b1 = sp.r > 0.003 ? sp.r + n1.z * 0.6 : 0.0;
  float b2 = sp.g > 0.003 ? sp.g + n2.z * 0.6 : 0.0;
  float b3 = sp.b > 0.003 ? sp.b + n3.z * 0.6 : 0.0;
  float b4 = sp.a > 0.003 ? sp.a + n4.z * 0.6 : 0.0;
  float ma = max(max(max(b0, b1), max(b2, b3)), b4) - 0.22;
  b0 = max(b0 - ma, 0.0); b1 = max(b1 - ma, 0.0); b2 = max(b2 - ma, 0.0); b3 = max(b3 - ma, 0.0); b4 = max(b4 - ma, 0.0);
  float bs = 1.0 / (b0 + b1 + b2 + b3 + b4 + 1e-5);
  vec3 col = (c0 * b0 + c1 * b1 + c2 * b2 + c3 * b3 + c4 * b4) * bs;
  vec2 nxz = ((n0.xy * b0 + n1.xy * b1 + n2.xy * b2 + n3.xy * b3 + n4.xy * b4) * bs) * 2.0 - 1.0;
  // 宏观明暗/色相变化：草地明显，石板收敛
  float macro = mix(1.0, mix(0.8, 1.14, nzL.g), 1.0 - 0.75 * b2 * bs);
  col *= macro * mix(vec3(1.05, 1.0, 0.94), vec3(0.95, 1.0, 1.05), nzL.r);

  // 水
  float wm = aux.r;
  float wet = smoothstep(0.22, 0.5, wm);
  col *= mix(1.0, 0.55, wet);
  float water = step(0.5, wm);
  float deep = smoothstep(0.5, 0.92, wm);
  vec3 wcol = mix(col * vec3(0.42, 0.66, 0.6), vec3(0.02, 0.085, 0.095), deep);
  col = mix(col, wcol, water);
  nxz *= 1.0 - water;

  vec3 n = vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y);
  vec2 nv = vec2(n.x, n.y * COS - n.z * SIN);
  gl_FragDepth = clamp((uDepth.x - Z) * uDepth.y, 0.0, 1.0);
  oA = vec4(col, 1.0 - water * 0.5);
  oN = vec4(nv * 0.5 + 0.5, 0.0, 1.0);
  // 石板略带光泽，其余地表为哑光
  oM = vec4(0.16 * b2 * bs + 0.05 * wet, 0.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- 精灵（实例化）
export const SPRITE_VS = `#version 300 es
layout(location=0) in vec4 aRect;
layout(location=1) in vec4 aUv;
layout(location=2) in vec4 aParams;   // baseY, hScale, flipSign, flash
layout(location=3) in vec4 aTint;
uniform vec4 uCam;
uniform vec2 uRes;
out vec2 vUv;
out vec4 vParams;
out vec4 vTint;
out float vYp;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = mix(aRect.xy, aRect.zw, c);
  vUv = mix(aUv.xy, aUv.zw, c);
  vParams = aParams;
  vTint = aTint;
  vYp = p.y;
  vec2 s = (p - uCam.xy) * uCam.z;
  gl_Position = vec4(s.x / (uRes.x * 0.5), -s.y / (uRes.y * 0.5), 0.0, 1.0);
}`;

export const SPRITE_FS = HEAD + `
uniform sampler2D uColor, uNormal;
uniform vec2 uDepth;
in vec2 vUv;
in vec4 vParams;
in vec4 vTint;
in float vYp;
layout(location=0) out vec4 oA;
layout(location=1) out vec4 oN;
layout(location=2) out vec4 oM;
void main(){
  vec4 c = texture(uColor, vUv);
  float a = c.a * vTint.a;
  if (a < 0.08) discard;
  vec4 n = texture(uNormal, vUv);
  float h = vParams.x + n.b * vParams.y;
  float z = (vYp + h * COS) / SIN;
  gl_FragDepth = clamp((uDepth.x - z) * uDepth.y, 0.0, 1.0);
  float nx = (n.r * 2.0 - 1.0) * vParams.z;
  // 颜色贴图为预乘 alpha
  vec3 col = mix(c.rgb * vTint.rgb, vec3(1.0, 0.95, 0.85) * c.a, vParams.w);
  oA = vec4(col * vTint.a, a);
  oN = vec4(vec3(nx * 0.5 + 0.5, n.g, clamp(h / HMAX, 0.0, 1.0)) * a, a);
  // 法线图 alpha 存的是「1 − 光泽」
  oM = vec4((1.0 - n.a) * a, 0.0, 0.0, a);
}`;

/** 自发光精灵：加色叠加到 HDR 缓冲，用同样的逐像素深度 */
export const SPRITE_EMIS_FS = HEAD + `
uniform sampler2D uColor, uNormal;
uniform vec2 uDepth;
in vec2 vUv;
in vec4 vParams;
in vec4 vTint;
in float vYp;
out vec4 o;
void main(){
  vec4 c = texture(uColor, vUv);
  float a = c.a * vTint.a;
  if (a < 0.02) discard;
  vec3 n = texture(uNormal, vUv).rgb;
  float h = vParams.x + n.b * vParams.y;
  float z = (vYp + h * COS) / SIN;
  gl_FragDepth = clamp((uDepth.x - z) * uDepth.y - 0.0004, 0.0, 1.0);
  o = vec4(c.rgb * vTint.rgb * vTint.a, 0.0);
}`;

/** 阴影精灵：R = 静态日影，G = 环境遮蔽，B = 动态日影 */
export const SHADOW_FS = HEAD + `
uniform sampler2D uColor;
in vec2 vUv;
in vec4 vParams;   // x: 1 = 静态，y: 强度
in vec4 vTint;
out vec4 o;
void main(){
  vec2 s = texture(uColor, vUv).rg * vParams.y;
  o = vec4(s.r * vParams.x, s.g, s.r * (1.0 - vParams.x), 1.0);
}`;

export const BLUR_FS = HEAD + `
uniform sampler2D uTex;
uniform vec2 uDir;
in vec2 vUv;
out vec4 o;
void main(){
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  c += (texture(uTex, vUv + uDir * 1.3846153846) + texture(uTex, vUv - uDir * 1.3846153846)) * 0.3162162162;
  c += (texture(uTex, vUv + uDir * 3.2307692308) + texture(uTex, vUv - uDir * 3.2307692308)) * 0.0702702703;
  o = c;
}`;

// ---------------------------------------------------------------- 延迟光照
export const LIGHT_FS = HEAD + `
#define MAXL ${MAX_LIGHTS}
uniform sampler2D uAlbedo, uNormalH, uShadow, uNoise, uAux, uMat;
uniform vec4 uCam;
uniform vec2 uRes;
uniform vec4 uMap;
uniform vec3 uSunDir, uSunCol, uAmbSky, uAmbGnd, uSkyRefl;
uniform float uTime, uShadowK;
uniform int uNumLights;
uniform vec4 uLightPos[MAXL];   // xyz, radius
uniform vec4 uLightCol[MAXL];   // rgb
uniform vec4 uFog;              // rgb, 浓度
in vec2 vUv;
out vec4 o;

void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(uAlbedo, ip, 0);
  vec4 Nh = texelFetch(uNormalH, ip, 0);
  float h = Nh.b * HMAX;
  vec2 nxy = Nh.rg * 2.0 - 1.0;
  float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  vec3 N = normalize(vec3(nxy.x, nxy.y * COS + nz * SIN, -nxy.y * SIN + nz * COS));
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  float X = uCam.x + (px.x - uRes.x * 0.5) / uCam.z;
  float Yp = uCam.y + (px.y - uRes.y * 0.5) / uCam.z;
  vec3 P = vec3(X, h, (Yp + h * COS) / SIN);
  float water = clamp((1.0 - A.a) * 2.0, 0.0, 1.0);

  // 阴影
  vec3 mLow = texture(uShadow, vUv).rgb;
  vec3 mGnd = texture(uShadow, vUv - vec2(0.0, h * COS * uCam.z / uRes.y)).rgb;
  float lowK = 1.0 - smoothstep(0.12, 0.6, h);
  float sunSh = mix(mGnd.r * 0.85, max(mLow.r, mLow.b), lowK) * uShadowK;
  float ao = mLow.g * lowK;

  vec3 V = vec3(0.0, SIN, COS);
  vec3 col;
  vec3 amb = mix(uAmbGnd, uAmbSky, N.y * 0.5 + 0.5) * (1.0 - ao * 0.8);

  if (water > 0.01) {
    vec2 wuv = P.xz;
    vec3 a1 = texture(uNoise, wuv * 0.09 + vec2(uTime * 0.011, uTime * 0.019)).rgb;
    vec3 a2 = texture(uNoise, wuv * 0.21 - vec2(uTime * 0.021, -uTime * 0.013)).rgb;
    vec3 a3 = texture(uNoise, wuv * 0.55 + vec2(-uTime * 0.03, uTime * 0.024)).rgb;
    vec2 g = (a1.xy - 0.5) * 0.9 + (a2.xy - 0.5) * 0.7 + (a3.xy - 0.5) * 0.35;
    vec3 Nw = normalize(vec3(g.x * 0.5, 1.0, g.y * 0.5));
    float ndl = max(dot(Nw, uSunDir), 0.0);
    vec3 base = A.rgb * (amb + uSunCol * ndl * (1.0 - sunSh * 0.7));
    vec3 Rf = reflect(-V, Nw);
    float fres = 0.1 + 0.5 * pow(1.0 - max(dot(Nw, V), 0.0), 2.0);
    vec3 sky = uSkyRefl * (0.4 + 0.5 * Rf.y) * (0.75 + 0.4 * a2.b);
    col = mix(base, sky, fres * water);
    vec3 Hs = normalize(uSunDir + V);
    col += uSunCol * pow(max(dot(Nw, Hs), 0.0), 220.0) * 2.5 * (1.0 - sunSh);
    for (int i = 0; i < MAXL; i++) {
      if (i >= uNumLights) break;
      vec3 Lv = uLightPos[i].xyz - P;
      float d2 = dot(Lv, Lv);
      float r = uLightPos[i].w;
      float att = clamp(1.0 - d2 / (r * r), 0.0, 1.0);
      vec3 Ln = Lv * inversesqrt(d2 + 1e-4);
      vec3 Hl = normalize(Ln + V);
      col += uLightCol[i].rgb * att * att * (pow(max(dot(Nw, Hl), 0.0), 60.0) * 1.6 + 0.12 * max(dot(Nw, Ln), 0.0) * A.rgb);
    }
    // 岸边细浪
    float shore = texture(uAux, (P.xz + (a2.xy - 0.5) * 0.5) * uMap.xy).r;
    float foam = smoothstep(0.62, 0.5, shore) * smoothstep(0.35, 0.75, a3.b + 0.25 * sin(uTime * 1.3 + shore * 40.0));
    col += (amb + uSunCol * 0.6) * foam * 0.14;
  } else {
    float gloss = texelFetch(uMat, ip, 0).r;
    float shin = 10.0 + gloss * gloss * 170.0;
    float specK = gloss * (0.22 + gloss * 1.5);
    float ndl = max(dot(N, uSunDir) * 0.92 + 0.08, 0.0);
    vec3 light = amb + uSunCol * ndl * (1.0 - sunSh);
    vec3 spec = uSunCol * pow(max(dot(N, normalize(uSunDir + V)), 0.0), shin) * (1.0 - sunSh);
    for (int i = 0; i < MAXL; i++) {
      if (i >= uNumLights) break;
      vec3 Lv = uLightPos[i].xyz - P;
      float d2 = dot(Lv, Lv);
      float r = uLightPos[i].w;
      float att = clamp(1.0 - d2 / (r * r), 0.0, 1.0);
      att = att * att / (1.0 + d2 * 0.35);
      vec3 Ln = Lv * inversesqrt(d2 + 1e-4);
      float nl = max(dot(N, Ln) * 0.8 + 0.2, 0.0);
      light += uLightCol[i].rgb * (att * nl);
      spec += uLightCol[i].rgb * att * pow(max(dot(N, normalize(Ln + V)), 0.0), shin);
    }
    // 天光在掠射角上的反光：让发丝、绸缎、金属的轮廓亮起来
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * step(0.02, h);
    col = A.rgb * light + spec * specK + uAmbSky * rim * (0.25 + gloss * 1.6) * (1.0 - ao);
  }

  // 轮廓处的接触暗边：比邻近像素矮（或在其后）的一侧略微压暗，把人物、树木从背景里托出来
  float hN = max(max(texelFetch(uNormalH, ip + ivec2(2, 0), 0).b, texelFetch(uNormalH, ip - ivec2(2, 0), 0).b),
                 max(texelFetch(uNormalH, ip + ivec2(0, 2), 0).b, texelFetch(uNormalH, ip - ivec2(0, 2), 0).b)) * HMAX;
  col *= 1.0 - 0.3 * clamp((hN - h - 0.12) * 2.2, 0.0, 1.0);

  // 贴地流动的薄雾
  float f1 = texture(uNoise, P.xz * 0.016 + vec2(uTime * 0.004, uTime * 0.0025)).g;
  float f2 = texture(uNoise, P.xz * 0.045 - vec2(uTime * 0.006, 0.0)).b;
  float fog = uFog.a * (0.12 + 0.88 * smoothstep(0.4, 0.9, f1 * 0.65 + f2 * 0.35)) * exp(-h * 0.45) * 0.6;
  col = mix(col, uFog.rgb, clamp(fog, 0.0, 0.85));
  o = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- 特效（粒子/刀光/光晕/贴地标记）
export const FX_VS = `#version 300 es
layout(location=0) in vec3 aPos;    // 投影坐标 x, yp 与世界 z（用于深度）
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 aCol;    // 预乘颜色，a = 不透明度（0 = 纯加色）
uniform vec4 uCam;
uniform vec2 uRes;
uniform vec2 uDepth;
out vec2 vUv;
out vec4 vCol;
void main(){
  vUv = aUv;
  vCol = aCol;
  vec2 s = (aPos.xy - uCam.xy) * uCam.z;
  float d = clamp((uDepth.x - aPos.z) * uDepth.y, 0.0, 1.0);
  gl_Position = vec4(s.x / (uRes.x * 0.5), -s.y / (uRes.y * 0.5), d * 2.0 - 1.0, 1.0);
}`;

export const FX_FS = HEAD + `
uniform sampler2D uTex;
in vec2 vUv;
in vec4 vCol;
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUv);
  o = vec4(vCol.rgb * t.rgb * t.a, vCol.a * t.a);
}`;

// ---------------------------------------------------------------- 后期
export const BLOOM_DOWN_FS = HEAD + `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
out vec4 o;
void main(){
  vec3 c = texture(uTex, vUv).rgb * 4.0;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.125;
  if (uThreshold > 0.0) {
    float l = max(c.r, max(c.g, c.b));
    c *= smoothstep(uThreshold * 0.7, uThreshold * 1.6, l);
    c = min(c, vec3(12.0));
  }
  o = vec4(c, 1.0);
}`;

export const BLOOM_UP_FS = HEAD + `
uniform sampler2D uTex;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 o;
void main(){
  vec3 c = texture(uTex, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture(uTex, vUv + uTexel * vec2(1.0, 0.0)).rgb
         + texture(uTex, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture(uTex, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  c += (texture(uTex, vUv + uTexel * vec2(-0.7, -0.7)).rgb + texture(uTex, vUv + uTexel * vec2(0.7, -0.7)).rgb
      + texture(uTex, vUv + uTexel * vec2(-0.7, 0.7)).rgb + texture(uTex, vUv + uTexel * vec2(0.7, 0.7)).rgb);
  o = vec4(c * 0.125, 1.0);
}`;

export const COMPOSITE_FS = HEAD + `
uniform sampler2D uHdr, uBloom, uDbg;
uniform float uBloomK, uExposure, uSat, uTime, uVignette, uDebug;
uniform vec3 uTint;
in vec2 vUv;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  if (uDebug > 0.5) { o = vec4(texture(uDbg, vUv).rgb, 1.0); return; }
  vec3 c = texture(uHdr, vUv).rgb + texture(uBloom, vUv).rgb * uBloomK;
  c *= uExposure * uTint;
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.95, dot(q, q) * 2.2);
  // ACES 近似
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = pow(c, vec3(1.0 / 2.2));
  c += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
