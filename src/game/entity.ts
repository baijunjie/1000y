import type { Atlas } from '../engine/renderer';
import type { AnimMeta, FrameMeta } from '../shared/consts';
import type { MobDef, NpcDef } from './data';
import type { World } from './world';

/** 角色动画精灵：帧 key 为 `${prefix}${anim}_${dir}_${frame}` */
export class Sprite {
  anim = 'idle';
  t = 0;
  speed = 1;
  done = false;
  private cache = new Map<string, FrameMeta[][]>();
  constructor(public atlas: Atlas, public prefix = '') {}

  setAtlas(a: Atlas) { if (a !== this.atlas) { this.atlas = a; this.cache.clear(); } }
  meta(anim = this.anim): AnimMeta | undefined { return this.atlas.meta.anims?.[anim]; }
  has(anim: string) { return !!this.meta(anim); }
  duration(anim = this.anim): number { const m = this.meta(anim); return m ? m.n / m.fps : 0; }

  play(anim: string, restart = false, speed = 1) {
    if (!this.has(anim)) return;
    if (anim !== this.anim || restart) { this.anim = anim; this.t = 0; this.done = false; }
    this.speed = speed;
  }
  update(dt: number) {
    const m = this.meta();
    if (!m) return;
    this.t += dt * this.speed;
    const dur = m.n / m.fps;
    if (m.loop) this.t %= dur;
    else if (this.t >= dur) { this.t = dur - 1e-4; this.done = true; }
  }
  frameIndex(): number {
    const m = this.meta();
    return m ? Math.min(m.n - 1, Math.floor(this.t * m.fps)) : 0;
  }
  frame(dir: number): FrameMeta | undefined {
    const m = this.meta();
    if (!m) return undefined;
    let tb = this.cache.get(this.anim);
    if (!tb) {
      tb = [];
      const fr = this.atlas.meta.frames;
      for (let d = 0; d < 8; d++) {
        const row: FrameMeta[] = [];
        for (let f = 0; f < m.n; f++) {
          const k = fr[`${this.prefix}${this.anim}_${d}_${f}`] ?? fr[`${this.prefix}${this.anim}_0_${f}`];
          if (k) row.push(k);
        }
        tb.push(row);
      }
      this.cache.set(this.anim, tb);
    }
    const row = tb[dir];
    return row[Math.min(row.length - 1, this.frameIndex())];
  }
}
export type EKind = 'player' | 'mob' | 'npc';
let nextId = 1;

export class Entity {
  id = nextId++;
  y = 0;
  dir = 0;
  scale = 1;
  tint?: [number, number, number];
  radius = 0.4;
  height = 1.85;
  name = '';
  hp = 1; hpMax = 1;
  dead = false;
  flash = 0;
  alpha = 1;
  path: [number, number][] | null = null;
  moving = false;
  stun = 0;
  atkCd = 0;
  /** 攻击动作进行中的已用时间；<0 表示不在攻击 */
  atkT = -1;
  atkDur = 0;
  atkHitAt = 0;
  atkHit = false;
  /** 被击退的速度 */
  kx = 0; kz = 0;
  constructor(public kind: EKind, public spr: Sprite, public x: number, public z: number) {}

  faceTo(tx: number, tz: number) {
    const dx = tx - this.x, dz = tz - this.z;
    if (dx * dx + dz * dz < 1e-6) return;
    this.dir = ((Math.round(Math.atan2(dx, dz) / (Math.PI / 4)) % 8) + 8) % 8;
  }
  get faceAngle() { return this.dir * (Math.PI / 4); }

  /** 沿路径移动，返回是否仍在移动 */
  step(world: World, speed: number, dt: number): boolean {
    if (!this.path || !this.path.length) { this.moving = false; return false; }
    let left = speed * dt;
    while (left > 0 && this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
      if (d < 1e-3) { this.path.shift(); continue; }
      this.faceTo(tx, tz);
      const s = Math.min(left, d);
      const nx = this.x + (dx / d) * s, nz = this.z + (dz / d) * s;
      if (!world.blocked(nx, nz)) { this.x = nx; this.z = nz; }
      else if (!world.blocked(nx, this.z)) this.x = nx;
      else if (!world.blocked(this.x, nz)) this.z = nz;
      else { this.path = null; this.moving = false; return false; }
      left -= s;
      if (s >= d - 1e-3) this.path.shift();
    }
    this.moving = !!this.path && this.path.length > 0;
    this.y = world.elevation(this.x, this.z);
    return this.moving;
  }

  dist(o: { x: number; z: number }) { return Math.hypot(o.x - this.x, o.z - this.z); }
}

export type MobState = 'idle' | 'wander' | 'chase' | 'attack' | 'return' | 'flee' | 'dead';

export class Mob extends Entity {
  state: MobState = 'idle';
  timer = Math.random() * 3;
  target: Entity | null = null;
  repath = 0;
  respawnT = 0;
  corpseT = 0;
  hpShow = 0;
  constructor(public def: MobDef, spr: Sprite, public home: { x: number; z: number; r: number }, x: number, z: number) {
    super('mob', spr, x, z);
    this.name = def.name; this.hp = this.hpMax = def.hp; this.scale = def.scale; this.tint = def.tint;
    this.radius = def.radius * def.scale; this.height = def.height * def.scale;
    this.dir = Math.floor(Math.random() * 8);
  }
}

export class Npc extends Entity {
  constructor(public def: NpcDef, spr: Sprite, x: number, z: number, dir: number) {
    super('npc', spr, x, z);
    this.name = def.name; this.dir = dir; this.radius = 0.45;
  }
}
