export type GL = WebGL2RenderingContext;

function compile(gl: GL, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`着色器编译失败:\n${log}\n${lines}`);
  }
  return s;
}

export class Program {
  prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: GL, vs: string, fs: string) {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
    this.prog = p;
  }
  use() { this.gl.useProgram(this.prog); return this; }
  loc(name: string) {
    let l = this.locs.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.prog, name); this.locs.set(name, l); }
    return l;
  }
  i(name: string, v: number) { this.gl.uniform1i(this.loc(name), v); return this; }
  f(name: string, v: number) { this.gl.uniform1f(this.loc(name), v); return this; }
  v2(name: string, a: number, b: number) { this.gl.uniform2f(this.loc(name), a, b); return this; }
  v3(name: string, a: number, b: number, c: number) { this.gl.uniform3f(this.loc(name), a, b, c); return this; }
  v4(name: string, a: number, b: number, c: number, d: number) { this.gl.uniform4f(this.loc(name), a, b, c, d); return this; }
  fv4(name: string, arr: Float32Array) { this.gl.uniform4fv(this.loc(name), arr); return this; }
  tex(name: string, unit: number, t: WebGLTexture | null, target?: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target ?? gl.TEXTURE_2D, t);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
}

export interface TexOpts {
  w: number;
  h: number;
  internal: number;
  format: number;
  type: number;
  filter?: number;
  wrap?: number;
  data?: ArrayBufferView | null;
}

export function makeTex(gl: GL, o: TexOpts): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internal, o.w, o.h, 0, o.format, o.type, (o.data ?? null) as any);
  const f = o.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  const w = o.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  return t;
}

export function makeFBO(gl: GL, colors: WebGLTexture[], depth?: WebGLTexture): WebGLFramebuffer {
  const f = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  colors.forEach((c, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c, 0));
  if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO 不完整: 0x' + st.toString(16));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return f;
}

export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/** 把位图上传为纹理。srgb 为 true 时采样结果自动转线性。 */
export function texFromBitmap(gl: GL, bmp: ImageBitmap | HTMLCanvasElement | ImageData, o: { srgb?: boolean; mips?: boolean; repeat?: boolean; maxLevel?: number } = {}): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp as any);
  if (o.mips) {
    if (o.maxLevel !== undefined) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, o.maxLevel);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const w = o.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  return t;
}
