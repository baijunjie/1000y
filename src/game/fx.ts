import type { Env, Renderer } from '../engine/renderer';
import { SUN_DIR } from '../shared/consts';

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

export const FX = { GLOW: 0, SPARK: 1, SMOKE: 2, SLASH: 3, RING: 4, LEAF: 5, PETAL: 6, DOT: 7 };

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
interface Key { h: number; sun: V3; sky: V3; gnd: V3; refl: V3; fog: [number, number, number, number]; night: number; shadow: number; exp: number; tint: V3; sat: number; }

const KEYS: Key[] = [
  { h: 0, sun: [0.16, 0.22, 0.38], sky: [0.075, 0.1, 0.19], gnd: [0.03, 0.04, 0.07], refl: [0.1, 0.14, 0.26], fog: [0.1, 0.13, 0.22, 0.34], night: 1, shadow: 0.55, exp: 1.25, tint: [0.92, 0.97, 1.1], sat: 0.9 },
  { h: 4.6, sun: [0.16, 0.22, 0.38], sky: [0.075, 0.1, 0.19], gnd: [0.03, 0.04, 0.07], refl: [0.1, 0.14, 0.26], fog: [0.1, 0.13, 0.22, 0.4], night: 1, shadow: 0.55, exp: 1.25, tint: [0.92, 0.97, 1.1], sat: 0.9 },
  { h: 6.2, sun: [0.95, 0.52, 0.34], sky: [0.26, 0.26, 0.38], gnd: [0.1, 0.08, 0.1], refl: [0.75, 0.55, 0.5], fog: [0.62, 0.5, 0.5, 0.62], night: 0.35, shadow: 0.6, exp: 1.08, tint: [1.04, 0.98, 0.96], sat: 1 },
  { h: 8.5, sun: [1.42, 1.24, 0.97], sky: [0.27, 0.33, 0.45], gnd: [0.16, 0.15, 0.12], refl: [0.6, 0.75, 0.95], fog: [0.7, 0.76, 0.82, 0.15], night: 0, shadow: 0.95, exp: 1, tint: [1, 1, 1], sat: 1.06 },
  { h: 12.5, sun: [1.62, 1.5, 1.27], sky: [0.3, 0.37, 0.5], gnd: [0.18, 0.17, 0.13], refl: [0.55, 0.75, 1.0], fog: [0.75, 0.8, 0.86, 0.1], night: 0, shadow: 1, exp: 0.98, tint: [1, 1, 1], sat: 1.08 },
  { h: 16.2, sun: [1.58, 1.2, 0.8], sky: [0.28, 0.31, 0.42], gnd: [0.18, 0.15, 0.11], refl: [0.75, 0.72, 0.8], fog: [0.82, 0.74, 0.62, 0.16], night: 0, shadow: 0.96, exp: 1, tint: [1.02, 1, 0.97], sat: 1.08 },
  { h: 18.3, sun: [1.2, 0.56, 0.28], sky: [0.3, 0.25, 0.36], gnd: [0.14, 0.09, 0.09], refl: [0.95, 0.55, 0.4], fog: [0.75, 0.48, 0.4, 0.4], night: 0.3, shadow: 0.7, exp: 1.05, tint: [1.06, 0.98, 0.94], sat: 1.05 },
  { h: 19.6, sun: [0.3, 0.26, 0.42], sky: [0.12, 0.13, 0.24], gnd: [0.05, 0.05, 0.08], refl: [0.2, 0.2, 0.36], fog: [0.2, 0.2, 0.32, 0.36], night: 0.9, shadow: 0.55, exp: 1.18, tint: [0.95, 0.97, 1.08], sat: 0.94 },
  { h: 21, sun: [0.16, 0.22, 0.38], sky: [0.075, 0.1, 0.19], gnd: [0.03, 0.04, 0.07], refl: [0.1, 0.14, 0.26], fog: [0.1, 0.13, 0.22, 0.3], night: 1, shadow: 0.55, exp: 1.25, tint: [0.92, 0.97, 1.1], sat: 0.9 },
  { h: 24, sun: [0.16, 0.22, 0.38], sky: [0.075, 0.1, 0.19], gnd: [0.03, 0.04, 0.07], refl: [0.1, 0.14, 0.26], fog: [0.1, 0.13, 0.22, 0.34], night: 1, shadow: 0.55, exp: 1.25, tint: [0.92, 0.97, 1.1], sat: 0.9 },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export function envAt(hour: number): Env {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = (hour - a.h) / (b.h - a.h);
  t = t * t * (3 - 2 * t);
  return {
    sunDir: SUN_DIR,
    sunCol: mix3(a.sun, b.sun, t), ambSky: mix3(a.sky, b.sky, t), ambGnd: mix3(a.gnd, b.gnd, t), skyRefl: mix3(a.refl, b.refl, t),
    fog: [mix(a.fog[0], b.fog[0], t), mix(a.fog[1], b.fog[1], t), mix(a.fog[2], b.fog[2], t), mix(a.fog[3], b.fog[3], t)],
    shadowK: mix(a.shadow, b.shadow, t), exposure: mix(a.exp, b.exp, t), bloom: 0.55 + mix(a.night, b.night, t) * 0.35,
    sat: mix(a.sat, b.sat, t), tint: mix3(a.tint, b.tint, t), vignette: 0.32, night: mix(a.night, b.night, t),
  };
}

export function hourName(h: number): string {
  const names = ['子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时'];
  return names[Math.floor((((h + 1) % 24) + 24) % 24 / 2)];
}
