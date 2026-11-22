import * as THREE from 'three';
import type { Renderer } from './renderer';

const BASE = import.meta.env.BASE_URL + 'assets/';
/** 地表五层，顺序与 splat 图的通道对应：草（余量）、土 R、石板 G、沙 B、落叶 A */
const TILES = ['grass', 'dirt', 'paving', 'sand', 'leaves'];
const FALLBACK: [number, number, number][] = [[70, 88, 48], [104, 84, 62], [112, 110, 104], [150, 138, 108], [60, 54, 38]];
const S = 1024;
/** 水面高度与河床最深处 */
export const WATER_Y = -0.16;
const BED = 1.1;

async function loadPixels(url: string, size: number): Promise<Uint8ClampedArray | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0, size, size);
    bmp.close();
    return g.getImageData(0, 0, size, size).data;
  } catch { return null; }
}

function arrayTex(data: Uint8Array, srgb: boolean, aniso: number): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, S, S, TILES.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

async function loadMap(url: string): Promise<{ tex: THREE.Texture; data: Uint8ClampedArray; w: number; h: number }> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer), bmp.width, bmp.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  bmp.close();
  return { tex, data: img.data, w: cv.width, h: cv.height };
}

/** 地表（五层 PBR 材质按 splat 图混合、河床下陷）与水面 */
export async function buildGround(r: Renderer, mapName: string, mapW: number, mapH: number) {
  const aniso = Math.min(8, r.gl.capabilities.getMaxAnisotropy());
  const col = new Uint8Array(S * S * 4 * TILES.length), nr = new Uint8Array(S * S * 4 * TILES.length);
  await Promise.all(TILES.map(async (name, i) => {
    const [c, n, ro] = await Promise.all(['color', 'normal', 'rough'].map((k) => loadPixels(`${BASE}tex/${name}.${k}.webp`, S)));
    const o = i * S * S * 4;
    for (let p = 0; p < S * S; p++) {
      const q = p * 4;
      const cr = c ? c[q] : FALLBACK[i][0], cg = c ? c[q + 1] : FALLBACK[i][1], cb = c ? c[q + 2] : FALLBACK[i][2];
      col[o + q] = cr; col[o + q + 1] = cg; col[o + q + 2] = cb;
      // alpha 存一个「高度感」：亮处更凸，用于层与层之间的高度混合
      col[o + q + 3] = (cr * 0.3 + cg * 0.5 + cb * 0.2);
      nr[o + q] = n ? n[q] : 128; nr[o + q + 1] = n ? n[q + 1] : 128;
      nr[o + q + 2] = ro ? ro[q] : 220; nr[o + q + 3] = 255;
    }
  }));
  const tileC = arrayTex(col, true, aniso), tileN = arrayTex(nr, false, aniso);
  // splat 图的 alpha 通道是「落叶」的权重，大片为 0；经过 2D 画布会被预乘清掉 RGB，所以直接把位图交给 GPU
  const splatBmp = await createImageBitmap(await (await fetch(`${BASE}map/${mapName}.splat.png`)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const splatTex = new THREE.Texture(splatBmp as any);
  splatTex.premultiplyAlpha = false; splatTex.flipY = false; splatTex.generateMipmaps = false;
  splatTex.minFilter = splatTex.magFilter = THREE.LinearFilter;
  splatTex.colorSpace = THREE.NoColorSpace;
  splatTex.needsUpdate = true;
  const splat = { tex: splatTex };
  const aux = await loadMap(`${BASE}map/${mapName}.aux.png`);

  // ---- 地形网格：水域按水深下陷 ----
  const step = 0.5;
  const nx = Math.round(mapW / step), nz = Math.round(mapH / step);
  const waterAt = (x: number, z: number) => {
    const u = Math.min(aux.w - 1, Math.max(0, (x / mapW) * aux.w - 0.5)), v = Math.min(aux.h - 1, Math.max(0, (z / mapH) * aux.h - 0.5));
    const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(aux.w - 1, x0 + 1), y1 = Math.min(aux.h - 1, y0 + 1);
    const fx = u - x0, fy = v - y0;
    const s = (xx: number, yy: number) => aux.data[(yy * aux.w + xx) * 4] / 255;
    return (s(x0, y0) * (1 - fx) + s(x1, y0) * fx) * (1 - fy) + (s(x0, y1) * (1 - fx) + s(x1, y1) * fx) * fy;
  };
  const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const heightAt = (x: number, z: number) => -sm(0.36, 0.8, waterAt(x, z)) * BED;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const o = (j * (nx + 1) + i) * 3, x = i * step, z = j * step;
    pos[o] = x; pos[o + 1] = heightAt(x, z); pos[o + 2] = z;
  }
  const idx = new Uint32Array(nx * nz * 6);
  let k = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTileC: { value: tileC }, uTileN: { value: tileN }, uSplat: { value: splat.tex }, uAux: { value: aux.tex }, uNoise: { value: r.noise },
      uMap: { value: new THREE.Vector2(1 / mapW, 1 / mapH) },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nvarying vec3 vGN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = position;\nvGN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uTileC, uTileN;
        uniform sampler2D uSplat, uAux, uNoise;
        uniform vec2 uMap;
        varying vec3 vGW;
        varying vec3 vGN;
        vec3 gNrm; float gRough;
        void gLayer(float i, vec2 uv, out vec4 c, out vec4 n) { c = texture(uTileC, vec3(uv, i)); n = texture(uTileN, vec3(uv, i)); }`)
      .replace('#include <map_fragment>', `
        {
          vec2 w = vGW.xz;
          vec3 nzL = texture2D(uNoise, w * 0.021).rgb;
          vec3 nzM = texture2D(uNoise, w * 0.13).rgb;
          vec2 suv = (w + (nzM.xy - 0.5) * 1.1) * uMap;
          vec4 sp = texture2D(uSplat, suv);
          vec4 aux = texture2D(uAux, suv);
          float wg = max(0.0, 1.0 - sp.r - sp.g - sp.b - sp.a);
          vec4 c0, n0, c0b, n0b, c1, n1, c2, n2, c3, n3, c4, n4;
          gLayer(0.0, w * 0.31, c0, n0);
          // 草地再采一次（旋转 + 换尺度），打散平铺的重复感
          const mat2 R = mat2(0.3907, 0.9205, -0.9205, 0.3907);
          gLayer(0.0, R * w * 0.19 + 0.37, c0b, n0b);
          float gm = smoothstep(0.35, 0.65, nzM.b);
          c0 = mix(c0, c0b, gm);
          n0.xy = mix(n0.xy, (transpose(R) * (n0b.xy * 2.0 - 1.0)) * 0.5 + 0.5, gm);
          n0.z = mix(n0.z, n0b.z, gm);
          // 草地贴图本身偏枯黄：压掉一部分原色，换成沉一点的草绿，再按「丰茂度」在黄绿与深绿之间摆动
          { float gl = dot(c0.rgb, vec3(0.3, 0.55, 0.15));
            c0.rgb = mix(c0.rgb, gl * mix(vec3(1.25, 1.5, 0.5), vec3(0.75, 1.45, 0.55), aux.b), 0.62); }
          gLayer(1.0, w * 0.29, c1, n1);
          gLayer(2.0, w * 0.26, c2, n2);
          gLayer(3.0, w * 0.33, c3, n3);
          gLayer(4.0, w * 0.34, c4, n4);
          // 高度混合：层与层的交界沿着石缝、草根走，而不是一条模糊的渐变
          float b0 = wg > 0.003 ? wg + c0.a * 0.55 : 0.0;
          float b1 = sp.r > 0.003 ? sp.r + c1.a * 0.55 : 0.0;
          float b2 = sp.g > 0.003 ? sp.g + c2.a * 0.55 : 0.0;
          float b3 = sp.b > 0.003 ? sp.b + c3.a * 0.55 : 0.0;
          float b4 = sp.a > 0.003 ? sp.a + c4.a * 0.55 : 0.0;
          float ma = max(max(max(b0, b1), max(b2, b3)), b4) - 0.2;
          b0 = max(b0 - ma, 0.0); b1 = max(b1 - ma, 0.0); b2 = max(b2 - ma, 0.0); b3 = max(b3 - ma, 0.0); b4 = max(b4 - ma, 0.0);
          float bs = 1.0 / (b0 + b1 + b2 + b3 + b4 + 1e-5);
          vec3 col = (c0.rgb * b0 + c1.rgb * b1 + c2.rgb * b2 + c3.rgb * b3 + c4.rgb * b4) * bs;
          vec3 nr = (n0.xyz * b0 + n1.xyz * b1 + n2.xyz * b2 + n3.xyz * b3 + n4.xyz * b4) * bs;
          // 大尺度的明暗与冷暖起伏
          float macro = mix(1.0, mix(0.72, 1.16, nzL.g), 1.0 - 0.7 * b2 * bs);
          col *= macro * mix(vec3(1.06, 1.0, 0.92), vec3(0.94, 1.0, 1.06), nzL.r);
          // 水边打湿：颜色变深、变光滑
          float wet = smoothstep(0.2, 0.5, aux.r);
          col *= mix(1.0, 0.42, wet);
          col = mix(col, col * vec3(0.5, 0.62, 0.55), smoothstep(0.5, 0.9, aux.r));
          gRough = mix(nr.z, 0.28, wet * 0.85);
          vec2 nxy = (nr.xy * 2.0 - 1.0) * (1.0 - 0.6 * wet);
          gNrm = normalize(normalize(vGN) + vec3(nxy.x, 0.0, -nxy.y) * 1.15);
          diffuseColor.rgb *= col;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);');
  };
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.matrixAutoUpdate = false;
  r.scene.add(ground);

  // ---- 水面 ----
  const wmat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.008, 0.035, 0.042), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false, envMapIntensity: 3.2,
  });
  wmat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: r.noise };
    sh.uniforms.uTime = r.uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWW = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;\nuniform float uTime;\nvarying vec3 vWW;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 w = vWW.xz;
          vec3 a1 = texture2D(uNoise, w * 0.09 + vec2(uTime * 0.011, uTime * 0.019)).rgb;
          vec3 a2 = texture2D(uNoise, w * 0.21 - vec2(uTime * 0.021, -uTime * 0.013)).rgb;
          vec3 a3 = texture2D(uNoise, w * 0.55 + vec2(-uTime * 0.03, uTime * 0.024)).rgb;
          vec2 g = (a1.xy - 0.5) * 0.9 + (a2.xy - 0.5) * 0.7 + (a3.xy - 0.5) * 0.35;
          normal = normalize((viewMatrix * vec4(normalize(vec3(g.x * 0.42, 1.0, g.y * 0.42)), 0.0)).xyz);
        }`);
  };
  const wgeo = new THREE.PlaneGeometry(mapW, mapH).rotateX(-Math.PI / 2).translate(mapW / 2, WATER_Y, mapH / 2);
  const water = new THREE.Mesh(wgeo, wmat);
  water.receiveShadow = true;
  water.matrixAutoUpdate = false;
  water.renderOrder = 1;
  r.scene.add(water);
  return { ground, water };
}
