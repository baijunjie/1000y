import type { Env, Renderer } from '../engine/renderer';

export interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; size2: number;
  cell: number;
  r: number; g: number; b: number; a: number;
  add: number;
  rot: number; vr: number;
  grav: number; drag: number;
  /** 受环境光影响（非发光粒子） */
  lit: boolean;
  /** 贴地（水平面）粒子 */
  flat?: boolean;
  sway?: number;
}

export const FX = { GLOW: 0, SPARK: 1, SMOKE: 2, SLASH: 3, RING: 4, LEAF: 5, PETAL: 6, DOT: 7, TRAIL: 8, STREAK: 9 };

export class Particles {
  list: Particle[] = [];
  spawn(p: Partial<Particle> & { x: number; y: number; z: number; max: number }) {
    if (this.list.length > 1800) return;
    this.list.push({
      vx: 0, vy: 0, vz: 0, life: 0, size: 0.2, size2: p.size ?? 0.2, cell: FX.GLOW, r: 1, g: 1, b: 1, a: 1, add: 1,
      rot: 0, vr: 0, grav: 0, drag: 0, lit: false, ...p,
    } as Particle);
  }
  update(dt: number) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life += dt;
      if (p.life >= p.max) { l[i] = l[l.length - 1]; l.pop(); continue; }
      p.vy -= p.grav * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.sway) { p.x += Math.sin(p.life * 2.3 + p.rot) * p.sway * dt; p.z += Math.cos(p.life * 1.7 + p.rot) * p.sway * dt * 0.6; }
      if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vx *= 0.3; p.vz *= 0.3; p.vy = 0; p.vr = 0; }
      p.rot += p.vr * dt;
    }
  }
  draw(r: Renderer, env: Env) {
    const lum: [number, number, number] = [
      env.ambSky[0] + env.sunCol[0] * 0.55, env.ambSky[1] + env.sunCol[1] * 0.55, env.ambSky[2] + env.sunCol[2] * 0.55,
    ];
    for (const p of this.list) {
      const t = p.life / p.max;
      const fade = Math.min(1, t * 8) * Math.min(1, (1 - t) * 3.5);
      const size = p.size + (p.size2 - p.size) * t;
      const k = p.lit ? lum : [1, 1, 1];
      if (p.flat) r.fxFlat(p.x, p.y, p.z, size, size, p.rot, p.cell, p.r * k[0], p.g * k[1], p.b * k[2], p.a * fade, p.add);
      else r.fxBillboard(p.x, p.y, p.z, size, p.cell, p.r * k[0], p.g * k[1], p.b * k[2], p.a * fade, p.add, p.rot);
    }
  }
}

// ---------------------------------------------------------------- 昼夜
type V3 = [number, number, number];
interface Key {
  h: number; sun: V3; sky: V3; gnd: V3; envK: number; fog: V3; fogD: number; shaft: number;
  night: number; exp: number; tint: V3; sat: number; contrast: number; bloom: number;
}

/** 日出与日落：这两个时刻主光强度压到近乎为零，日月在此交接（方向突变不可见） */
const DAWN = 5.5, DUSK = 19;

const NIGHT: Omit<Key, 'h'> = {
  sun: [0.1, 0.15, 0.27], sky: [0.02, 0.028, 0.055], gnd: [0.008, 0.01, 0.016], envK: 0.06, fog: [0.02, 0.03, 0.06], fogD: 0.03, shaft: 0.6,
  night: 1, exp: 1.3, tint: [0.94, 0.97, 1.08], sat: 0.8, contrast: 0.3, bloom: 0.8,
};

/**
 * 整体基调偏暗：白天是阴沉、低饱和、明暗对比强的天光，黄昏与夜晚主要靠灯火。
 * 环境光故意压得很低，暗部才沉得下去，灯火与日光光束才显得出来。
 */
const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 4.6, ...NIGHT },
  { h: DAWN, sun: [0.015, 0.015, 0.02], sky: [0.045, 0.05, 0.08], gnd: [0.016, 0.016, 0.022], envK: 0.1, fog: [0.06, 0.06, 0.09], fogD: 0.04, shaft: 0.5, night: 0.75, exp: 1.25, tint: [0.96, 0.98, 1.06], sat: 0.82, contrast: 0.3, bloom: 0.75 },
  { h: 6.5, sun: [1.1, 0.55, 0.3], sky: [0.085, 0.085, 0.13], gnd: [0.035, 0.028, 0.03], envK: 0.18, fog: [0.16, 0.12, 0.11], fogD: 0.026, shaft: 1.0, night: 0.3, exp: 1.1, tint: [1.04, 0.98, 0.95], sat: 0.9, contrast: 0.34, bloom: 0.65 },
  { h: 8.5, sun: [1.45, 1.22, 0.95], sky: [0.11, 0.135, 0.185], gnd: [0.045, 0.042, 0.035], envK: 0.24, fog: [0.14, 0.16, 0.18], fogD: 0.011, shaft: 1.3, night: 0, exp: 0.9, tint: [0.98, 1, 1.02], sat: 0.8, contrast: 0.4, bloom: 0.5 },
  { h: 12.5, sun: [1.55, 1.42, 1.2], sky: [0.13, 0.155, 0.205], gnd: [0.052, 0.048, 0.04], envK: 0.27, fog: [0.17, 0.19, 0.21], fogD: 0.009, shaft: 1.1, night: 0, exp: 0.86, tint: [0.97, 1, 1.03], sat: 0.78, contrast: 0.42, bloom: 0.45 },
  { h: 16.2, sun: [1.55, 1.12, 0.7], sky: [0.11, 0.12, 0.165], gnd: [0.05, 0.04, 0.032], envK: 0.24, fog: [0.17, 0.15, 0.12], fogD: 0.011, shaft: 1.4, night: 0, exp: 0.9, tint: [1.01, 1, 0.98], sat: 0.82, contrast: 0.4, bloom: 0.5 },
  { h: 18.2, sun: [1.25, 0.5, 0.2], sky: [0.085, 0.068, 0.105], gnd: [0.035, 0.024, 0.024], envK: 0.18, fog: [0.17, 0.1, 0.07], fogD: 0.024, shaft: 1.1, night: 0.45, exp: 1.08, tint: [1.05, 0.98, 0.94], sat: 0.92, contrast: 0.34, bloom: 0.65 },
  { h: DUSK, sun: [0.015, 0.012, 0.02], sky: [0.04, 0.038, 0.07], gnd: [0.014, 0.013, 0.02], envK: 0.09, fog: [0.05, 0.045, 0.075], fogD: 0.036, shaft: 0.5, night: 0.85, exp: 1.25, tint: [0.96, 0.97, 1.06], sat: 0.84, contrast: 0.3, bloom: 0.75 },
  { h: 19.9, ...NIGHT },
  { h: 24, ...NIGHT },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** 主光方向：白天是太阳（东升西落，偏南），夜里是月亮（从北面照过来，人与屋舍多是逆光的剪影） */
export function sunDirAt(hour: number): V3 {
  let v: V3;
  if (hour >= DAWN && hour < DUSK) {
    const a = ((hour - DAWN) / (DUSK - DAWN)) * Math.PI;
    v = [Math.cos(a) * 0.85, 0.22 + 0.62 * Math.sin(a), 0.42];
  } else {
    const a = ((((hour - DUSK) % 24) + 24) % 24 / (24 - DUSK + DAWN)) * Math.PI;
    v = [Math.cos(a) * 0.7, 0.4 + 0.4 * Math.sin(a), -0.38];
  }
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function envAt(hour: number): Env {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = (hour - a.h) / (b.h - a.h);
  t = t * t * (3 - 2 * t);
  return {
    sunDir: sunDirAt(hour),
    sunCol: mix3(a.sun, b.sun, t), ambSky: mix3(a.sky, b.sky, t), ambGnd: mix3(a.gnd, b.gnd, t), envK: mix(a.envK, b.envK, t),
    fogCol: mix3(a.fog, b.fog, t), fogDensity: mix(a.fogD, b.fogD, t), fogFalloff: 0.5, shaftK: mix(a.shaft, b.shaft, t),
    exposure: mix(a.exp, b.exp, t), bloom: mix(a.bloom, b.bloom, t), sat: mix(a.sat, b.sat, t), contrast: mix(a.contrast, b.contrast, t),
    tint: mix3(a.tint, b.tint, t), vignette: 0.42, night: mix(a.night, b.night, t),
  };
}

export function hourName(h: number): string {
  const names = ['子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时'];
  return names[Math.floor((((h + 1) % 24) + 24) % 24 / 2)];
}
