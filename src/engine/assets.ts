import type { AtlasMeta } from '../shared/consts';
import { loadBitmap, texFromBitmap } from './gl';
import type { Atlas, GroundTex, Renderer } from './renderer';

const BASE = import.meta.env.BASE_URL + 'assets/';
const cache = new Map<string, Promise<Atlas>>();

export function loadAtlas(r: Renderer, name: string): Promise<Atlas> {
  let p = cache.get(name);
  if (!p) {
    p = (async () => {
      const meta: AtlasMeta = await (await fetch(`${BASE}atlas/${name}.json`)).json();
      const [c, n, s] = await Promise.all([
        loadBitmap(`${BASE}atlas/${name}.color.webp`),
        loadBitmap(`${BASE}atlas/${name}.normal.webp`),
        meta.shadowSize ? loadBitmap(`${BASE}atlas/${name}.shadow.webp`) : Promise.resolve(null),
      ]);
      const gl = r.gl;
      const color = texFromBitmap(gl, c, { srgb: true, mips: true, maxLevel: 2 });
      const normal = texFromBitmap(gl, n, { mips: true, maxLevel: 2 });
      const shadow = s ? texFromBitmap(gl, s) : null;
      c.close(); n.close(); s?.close();
      return r.registerAtlas(meta, color, normal, shadow);
    })();
    cache.set(name, p);
  }
  return p;
}

export const TILE_NAMES = ['grass', 'dirt', 'stone', 'sand', 'leaf'];
const FALLBACK: [number, number, number][] = [[86, 110, 58], [122, 98, 70], [128, 126, 118], [176, 160, 122], [70, 62, 42]];

function flat(size: number, rgb: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  g.fillRect(0, 0, size, size);
  return c;
}

export async function loadGround(r: Renderer, mapName: string, mapW: number, mapH: number): Promise<GroundTex> {
  const gl = r.gl, S = 512;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const loadTiles = (suffix: string, srgb: boolean) => Promise.all(TILE_NAMES.map(async (name, i) => {
    try {
      const b = await loadBitmap(`${BASE}ground/${name}.${suffix}.png`);
      if (b.width !== S) throw new Error('size');
      return b as ImageBitmap | HTMLCanvasElement;
    } catch {
      return flat(S, srgb ? FALLBACK[i] : [128, 128, 128]);
    }
  }));
  const mk = (srcs: (ImageBitmap | HTMLCanvasElement)[], srgb: boolean) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 10, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, S, S, TILE_NAMES.length);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    srcs.forEach((src, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, S, S, 1, gl.RGBA, gl.UNSIGNED_BYTE, src as any));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return t;
  };
  const [cs, ns, splatB, auxB] = await Promise.all([
    loadTiles('color', true), loadTiles('normal', false),
    loadBitmap(`${BASE}map/${mapName}.splat.png`), loadBitmap(`${BASE}map/${mapName}.aux.png`),
  ]);
  const tileC = mk(cs, true), tileN = mk(ns, false);
  const splat = texFromBitmap(gl, splatB);
  const aux = texFromBitmap(gl, auxB);
  return { tileC, tileN, splat, aux, mapW, mapH };
}
