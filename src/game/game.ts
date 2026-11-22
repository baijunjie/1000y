import type { Actors } from '../engine/actors';
import type { Env, Renderer } from '../engine/renderer';
import type { Statics } from '../engine/statics';
import { actorDef } from '../models/registry';
import type * as THREE from 'three';
import { ARTS, ITEMS, KIND_NAME, MOBS, MoveDef, NPCS, QUESTS, WeaponKind } from './data';
import { Entity, Mob, Npc, Sprite } from './entity';
import { envAt, FX, Particles } from './fx';
import { Player, PlayerSave } from './player';
import { MapData, World } from './world';

export interface Loot { id: number; x: number; z: number; items: [string, number][]; coins: number; t: number; }
export interface GatherNode { x: number; z: number; item: string; obj: { hidden: boolean; view: THREE.Object3D | null }; respawn: number; }
interface Shot {
  kind: 'arrow' | 'wave';
  x: number; y: number; z: number; vx: number; vz: number;
  life: number; from: Entity; target: Entity | null;
  onHit: (e: Entity) => void; hit: Set<number>; hostile: boolean;
}
export interface FloatText { x: number; y: number; z: number; text: string; color: string; t: number; size: number; vx: number; }

type Intent =
  | { type: 'attack'; mob: Mob }
  | { type: 'talk'; npc: Npc }
  | { type: 'loot'; loot: Loot }
  | { type: 'gather'; node: GatherNode }
  | null;

export type Pick = { type: 'mob'; e: Mob } | { type: 'npc'; e: Npc } | { type: 'loot'; l: Loot } | { type: 'gather'; n: GatherNode } | null;

const SAVE_KEY = 'qiyun-save-v1';
const HOUR_SEC = 38; // 现实秒 / 游戏时辰的一半（一小时）
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class Game {
  p = new Player();
  pe!: Entity;
  mobs: Mob[] = [];
  npcs: Npc[] = [];
  loots: Loot[] = [];
  nodes: GatherNode[] = [];
  shots: Shot[] = [];
  texts: FloatText[] = [];
  /** 击中瞬间的一闪（短促的点光，照亮周围） */
  flashes: { x: number; y: number; z: number; t: number; k: number }[] = [];
  parts = new Particles();
  hour = 9.5;
  env: Env = envAt(9.5);
  time = 0;
  target: Mob | null = null;
  hover: Pick = null;
  intent: Intent = null;
  state: 'normal' | 'sit' | 'dead' | 'dash' = 'normal';
  zone = '';
  zoom = 1;
  paused = false;
  shake = 0;
  moveCd = 0;
  deadT = 0;
  mouse = { x: 0, y: 0, down: false, inside: false };
  private atkAlt = false;
  private repathT = 0;
  private heldT = 0;
  private saveT = 0;
  private stepT = 0;
  private sitT = 0;
  private tipT = 0;
  private lootSeq = 1;
  private marker = { x: 0, z: 0, t: 9 };
  private dash = { t: 0, dur: 0, vx: 0, vz: 0 };

  // UI 回调
  onLog: (msg: string, cls?: string) => void = () => {};
  onChange: (what: string) => void = () => {};
  onDialog: (npc: Npc) => void = () => {};
  onArea: (name: string) => void = () => {};
  onDeath: () => void = () => {};
  onSfx: (name: string, vol?: number) => void = () => {};

  constructor(public r: Renderer, public world: World, public statics: Statics, public actors: Actors, public map: MapData) {}

  // ================================================================ 初始化
  async init() {
    const save = this.readSave();
    if (save) { this.p.load(save); this.hour = save.hour; }
    const sx = save?.x ?? this.map.spawn.x, sz = save?.z ?? this.map.spawn.z;
    const [fx, fz] = this.world.nearestFree(sx, sz);
    this.pe = new Entity('player', new Sprite(actorDef('player_' + this.p.weaponKind)), fx, fz);
    this.pe.name = '少侠'; this.pe.radius = 0.38;
    this.r.focus.set(fx, 0.9, fz);

    this.spawnMobs();
    for (const n of this.map.npcs) {
      const def = NPCS[n.id];
      if (!def) continue;
      this.npcs.push(new Npc(def, new Sprite(actorDef('npc:' + n.id)), n.x, n.z, n.dir));
    }
    for (const g of this.map.gather) {
      const view = this.statics.single(g.k, g.x, g.z, 1.15);
      this.nodes.push({ x: g.x, z: g.z, item: g.item, obj: { hidden: false, view }, respawn: 0 });
    }
    this.env = envAt(this.hour);
    this.checkZone(true);
  }

  spawnMobs() {
    for (const s of this.map.spawns) {
      const def = MOBS[s.mob];
      if (!def) continue;
      for (let k = 0; k < s.n; k++) {
        const [x, z] = this.randomNear(s.x, s.z, s.r);
        this.mobs.push(new Mob(def, new Sprite(actorDef(def.atlas)), { x: s.x, z: s.z, r: s.r }, x, z));
      }
    }
  }

  private randomNear(x: number, z: number, r: number): [number, number] {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!this.world.blocked(px, pz)) return [px, pz];
    }
    return this.world.nearestFree(x, z);
  }

  // ================================================================ 存档
  private readSave(): PlayerSave | null {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  }
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.p.save(this.pe.x, this.pe.z, this.hour))); } catch { /* 忽略 */ }
  }
  static hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  static clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* 忽略 */ } }

  // ================================================================ 输入
  pick(sx: number, sy: number): Pick {
    const r = this.r;
    let best: Pick = null, bd = Infinity;
    const test = (x: number, y: number, z: number, rad: number, mk: () => Pick, bias = 0) => {
      const [px, py] = r.worldToScreen(x, y, z);
      const k = r.pxPerMeter(x, y, z);
      const d = Math.hypot((sx - px) / (rad * k + 10), (sy - py) / (rad * k * 1.5 + 12));
      if (d < 1 && d + bias < bd) { bd = d + bias; best = mk(); }
    };
    for (const l of this.loots) test(l.x, 0.2, l.z, 0.45, () => ({ type: 'loot', l }), -0.5);
    for (const m of this.mobs) if (!m.dead) test(m.x, m.y + m.height * 0.45, m.z, Math.max(m.radius, m.height * 0.32), () => ({ type: 'mob', e: m }));
    for (const n of this.npcs) test(n.x, n.y + 0.9, n.z, 0.6, () => ({ type: 'npc', e: n }));
    for (const g of this.nodes) if (!g.obj.hidden) test(g.x, 0.25, g.z, 0.5, () => ({ type: 'gather', n: g }));
    return best;
  }

  click(sx: number, sy: number) {
    if (this.state === 'dead' || this.paused) return;
    const pk = this.pick(sx, sy);
    if (this.state === 'sit') this.stand();
    if (!pk) {
      const [x, z] = this.r.screenToGround(sx, sy);
      this.intent = null;
      this.moveTo(x, z, true);
      return;
    }
    if (pk.type === 'mob') {
      if (pk.e.def.aggro === 0 && pk.e.def.flee && this.target !== pk.e) { this.target = pk.e; this.intent = { type: 'attack', mob: pk.e }; }
      else { this.target = pk.e; this.intent = { type: 'attack', mob: pk.e }; }
    } else if (pk.type === 'npc') this.intent = { type: 'talk', npc: pk.e };
    else if (pk.type === 'loot') this.intent = { type: 'loot', loot: pk.l };
    else if (pk.type === 'gather') this.intent = { type: 'gather', node: pk.n };
    this.repathT = 0;
  }

  moveTo(x: number, z: number, mark = false) {
    if (this.state !== 'normal' || this.pe.atkT >= 0 || this.pe.stun > 0) return;
    const path = this.world.findPath(this.pe.x, this.pe.z, x, z);
    if (path) {
      this.pe.path = path;
      if (mark) { const e = path[path.length - 1]; this.marker = { x: e[0], z: e[1], t: 0 }; }
    }
  }

  stopActions() {
    this.intent = null; this.target = null; this.pe.path = null;
  }

  selectNearest() {
    let best: Mob | null = null, bd = 16;
    for (const m of this.mobs) {
      if (m.dead || m.def.still || m === this.target) continue;
      const d = m.dist(this.pe);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) { this.target = best; this.intent = { type: 'attack', mob: best }; this.repathT = 0; }
  }

  toggleSit() {
    if (this.state === 'sit') { this.stand(); return; }
    if (this.state !== 'normal' || this.pe.atkT >= 0) return;
    if (this.mobs.some((m) => m.target === this.pe && !m.dead && m.state !== 'return')) { this.onLog('强敌环伺，无法静心打坐。', 'warn'); return; }
    this.stopActions();
    this.state = 'sit';
    this.pe.spr.play('sit', true);
    this.onLog('你盘膝而坐，运转「' + ARTS[this.p.use.heart].name + '」。', 'sys');
  }
  stand() {
    if (this.state !== 'sit') return;
    this.state = 'normal';
    this.pe.spr.play('idle', true);
  }

  // ================================================================ 主循环
  frameDt = 0.016;
  update(dt: number) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.frameDt = dt;
    this.time += dt;
    const p = this.p;
    p.playT += dt;
    this.hour = (this.hour + dt / HOUR_SEC) % 24;
    this.env = envAt(this.hour);
    p.ageT += dt;
    if (p.ageT >= 330) {
      p.ageT = 0; p.age++;
      p.hpMax += 6; p.mpMax += 3; p.spMax += 3;
      this.onLog(`岁月如流，你已 ${p.age} 岁。气血、内力、体力上限有所增长。`, 'good');
      this.onChange('stats');
    }
    this.updatePlayer(dt);
    for (const m of this.mobs) this.updateMob(m, dt);
    for (const n of this.npcs) n.spr.update(dt);
    this.updateShots(dt);
    this.updateWorldBits(dt);
    this.ambient(dt);
    this.parts.update(dt);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt; t.y += dt * (1.3 - t.t * 0.9); t.x += t.vx * dt;
      if (t.t > 1.25) this.texts.splice(i, 1);
    }
    // 镜头
    const f = this.r.focus;
    const k = 1 - Math.exp(-dt * 7);
    f.x += (this.pe.x - f.x) * k; f.y += (this.pe.y + 0.9 - f.y) * k; f.z += (this.pe.z - f.z) * k;
    this.r.zoom += (this.zoom - this.r.zoom) * (1 - Math.exp(-dt * 10));
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.2);
    this.checkZone();
    this.saveT += dt;
    if (this.saveT > 15) { this.saveT = 0; this.save(); }
    this.marker.t += dt;
  }

  private checkZone(force = false) {
    const z = this.map.zones.find((q) => this.pe.x >= q.x0 && this.pe.x < q.x1 && this.pe.z >= q.z0 && this.pe.z < q.z1);
    const name = z?.name ?? '荒野';
    if (name !== this.zone || force) { this.zone = name; this.onArea(name); }
  }
  zoneMood(): string {
    return this.map.zones.find((q) => q.name === this.zone)?.mood ?? 'wild';
  }

  // ================================================================ 玩家
  private updatePlayer(dt: number) {
    const p = this.p, e = this.pe, w = this.world;
    e.spr.update(dt);
    e.flash = Math.max(0, e.flash - dt * 5);
    e.atkCd -= dt;
    this.moveCd -= dt;
    this.tipT -= dt;
    if (this.state === 'dead') {
      this.deadT += dt;
      return;
    }
    // 自然恢复
    const inFight = this.mobs.some((m) => m.target === e && !m.dead && (m.state === 'chase' || m.state === 'attack'));
    p.sp = Math.min(p.spMax, p.sp + dt * (this.state === 'sit' ? 9 : e.moving ? 1.2 : 4));
    if (!inFight) p.hp = Math.min(p.hpMax, p.hp + dt * 0.5);
    p.mp = Math.min(p.mpMax, p.mp + dt * 0.25);
    for (const k of ['head', 'arm', 'leg'] as const) p.parts[k] = Math.min(100, p.parts[k] + dt * (this.state === 'sit' ? 1.2 : 0.25));

    if (e.stun > 0) { e.stun -= dt; return; }
    if (e.kx || e.kz) this.applyKnock(e, dt);

    if (this.state === 'dash') {
      this.dash.t += dt;
      const nx = e.x + this.dash.vx * dt, nz = e.z + this.dash.vz * dt;
      if (!w.blocked(nx, nz)) { e.x = nx; e.z = nz; e.y = w.elevation(nx, nz); }
      this.dust(e.x, e.y, e.z, 1, 0.9);
      if (this.dash.t >= this.dash.dur) { this.state = 'normal'; e.spr.play('idle'); }
      return;
    }

    if (this.state === 'sit') {
      this.sitT += dt;
      const eff = p.kindEff('heart');
      p.mp = Math.min(p.mpMax, p.mp + dt * (2.2 + eff * 0.3));
      p.hp = Math.min(p.hpMax, p.hp + dt * (1.6 + eff * 0.22));
      if (this.sitT >= 1) {
        this.sitT = 0;
        const id = p.use.heart;
        const g = p.gain(id, 0.075, p.lv(id) + 4);
        p.mpMax += 0.06 + eff * 0.002;
        if (g.up) this.artUp(id, g.lv);
        this.onChange('stats');
      }
      return;
    }

    // 攻击动作进行中
    if (e.atkT >= 0) {
      e.atkT += dt;
      if (!e.atkHit && e.atkT >= e.atkHitAt) { e.atkHit = true; this.playerStrike(); }
      if (e.atkT >= e.atkDur) { e.atkT = -1; e.spr.play('idle'); }
      return;
    }

    // 按住鼠标持续移动
    if (this.mouse.down && this.mouse.inside && !this.intent) {
      this.heldT -= dt;
      if (this.heldT <= 0) {
        this.heldT = 0.12;
        const [x, z] = this.r.screenToGround(this.mouse.x, this.mouse.y);
        if (Math.hypot(x - e.x, z - e.z) > 0.5) this.moveTo(x, z);
      }
    }

    // 意图
    const it = this.intent;
    if (it) {
      if (it.type === 'attack') {
        const m = it.mob;
        if (m.dead) { this.intent = null; if (this.target === m) this.target = null; e.path = null; }
        else {
          const d = e.dist(m) - m.radius;
          const reach = p.reach;
          const los = p.weaponKind !== 'bow' || d < 2 || w.clear(e.x, e.z, m.x, m.z);
          if (d <= reach && los) {
            e.path = null; e.moving = false;
            e.faceTo(m.x, m.z);
            if (e.atkCd <= 0) this.startAttack(m);
          } else {
            this.repathT -= dt;
            if (this.repathT <= 0 || !e.path) {
              this.repathT = 0.35;
              const path = w.findPath(e.x, e.z, m.x, m.z, 5000);
              if (path) e.path = path;
            }
          }
        }
      } else {
        const tx = it.type === 'talk' ? it.npc.x : it.type === 'loot' ? it.loot.x : it.node.x;
        const tz = it.type === 'talk' ? it.npc.z : it.type === 'loot' ? it.loot.z : it.node.z;
        const need = it.type === 'talk' ? 2.3 : 1.25;
        const d = Math.hypot(tx - e.x, tz - e.z);
        if (d <= need) {
          e.path = null; e.moving = false;
          e.faceTo(tx, tz);
          this.intent = null;
          if (it.type === 'talk') { it.npc.faceTo(e.x, e.z); this.talk(it.npc); }
          else if (it.type === 'loot') this.takeLoot(it.loot);
          else this.gatherNode(it.node);
        } else if (!e.path) {
          const path = w.findPath(e.x, e.z, tx, tz);
          if (path) e.path = path; else this.intent = null;
        }
      }
    }

    // 移动
    const wasMoving = e.moving;
    const moving = e.step(w, p.moveSpeed, dt);
    if (moving) {
      e.spr.play('run', false, p.moveSpeed / 4.3);
      this.stepT += dt;
      if (this.stepT > 0.3) {
        this.stepT = 0;
        this.onSfx('step', 0.25);
        this.dust(e.x, e.y, e.z, 1, 0.3, 0.5);
        const id = p.use.step;
        const g = p.gain(id, 0.011, p.lv(id) + 4);
        if (g.up) this.artUp(id, g.lv);
      }
    } else if (wasMoving || e.spr.anim === 'run') e.spr.play('idle');
  }

  private startAttack(m: Mob) {
    const p = this.p, e = this.pe;
    const cost = p.art.stamina ?? 3;
    if (p.sp < cost) {
      if (this.tipT <= 0) { this.tipT = 2.5; this.onLog('体力不支，稍作喘息。', 'warn'); }
      return;
    }
    p.sp -= cost;
    p.spMax += 0.025;
    e.faceTo(m.x, m.z);
    this.atkAlt = !this.atkAlt;
    const anim = this.atkAlt && e.spr.has('atk2') ? 'atk2' : 'atk1';
    const meta = e.spr.meta(anim);
    if (!meta) return;
    const base = meta.n / meta.fps;
    const interval = p.interval;
    const speed = Math.max(1, base / (interval * 0.92));
    e.spr.play(anim, true, speed);
    e.atkT = 0; e.atkDur = base / speed; e.atkHitAt = ((meta.hit ?? 3) + 0.4) / meta.fps / speed; e.atkHit = false;
    e.atkCd = interval;
    this.onSfx(p.weaponKind === 'bow' ? 'bow' : p.weaponKind === 'fist' ? 'punch' : 'swing', 0.5);
  }

  /** 攻击动作打到命中帧 */
  private playerStrike() {
    const p = this.p, e = this.pe;
    const m = this.intent?.type === 'attack' ? this.intent.mob : this.target;
    const kind = p.weaponKind;
    if (kind !== 'bow') this.slashFx(e, kind);
    if (!m || m.dead) return;
    if (kind === 'bow') { this.fireArrow(e, m, (t) => this.playerHit(t as Mob, 1), false); return; }
    if (e.dist(m) - m.radius > p.reach * 1.35) return;
    this.playerHit(m, 1);
  }

  /** 扬尘：受环境光照亮的灰土色烟团 */
  private dust(x: number, y: number, z: number, n = 3, spread = 0.5, up = 0.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(0.3, 1.2) * spread;
      this.parts.spawn({
        x: x + Math.cos(a) * 0.15, y: y + 0.08, z: z + Math.sin(a) * 0.15, vx: Math.cos(a) * sp, vy: rand(0.15, 0.6) * up, vz: Math.sin(a) * sp,
        max: rand(0.5, 1.0), size: rand(0.25, 0.4), size2: rand(0.8, 1.3), cell: FX.SMOKE, r: 0.5, g: 0.45, b: 0.38, a: 0.22, add: 0, lit: true, drag: 2.5,
      });
    }
  }

  /** 金铁交击迸出的火星 */
  private sparks(x: number, y: number, z: number, n: number, dx = 0, dz = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(1.5, 5.5);
      this.parts.spawn({
        x, y, z, vx: Math.cos(a) * sp * 0.6 + dx * rand(1, 4), vy: rand(0.5, 4), vz: Math.sin(a) * sp * 0.6 + dz * rand(1, 4),
        max: rand(0.18, 0.42), size: rand(0.05, 0.09), size2: 0.01, cell: FX.SPARK, r: 3.2, g: 1.9, b: 0.7, a: 1, grav: 14, drag: 1.5,
      });
    }
  }

  /** 出手时脚下带起的一点尘土（刀光本身由渲染层按兵器的真实轨迹画出） */
  private slashFx(e: Entity, _kind: WeaponKind, scale = 1) {
    const a = e.faceAngle;
    this.dust(e.x + Math.sin(a) * 0.5, e.y, e.z + Math.cos(a) * 0.5, scale > 1 ? 4 : 1, 0.6 * scale, 0.4);
  }

  private playerHit(m: Mob, mult: number, o: { stun?: number; knock?: number; sure?: boolean } = {}): boolean {
    const p = this.p, e = this.pe;
    if (m.dead) return false;
    const chance = clamp(0.8 + (p.acc - m.def.evade) * 0.008, 0.3, 0.985);
    if (!o.sure && Math.random() > chance) {
      this.float(m.x, m.y + m.height, m.z, '落空', '#b8c0c8', 15);
      this.onSfx('miss', 0.3);
      this.provoke(m);
      return false;
    }
    const crit = Math.random() < 0.06 + p.artLv * 0.0016;
    let dmg = p.power * mult * rand(0.88, 1.12) * (crit ? 1.65 : 1) - m.def.def * 0.5;
    dmg = Math.max(1, Math.round(dmg));
    const art = p.art;
    const g = p.gain(art.id, 0.17, m.def.grade);
    if (g.up) this.artUp(art.id, g.lv);
    this.damageMob(m, dmg, crit, e);
    if (o.stun && !m.def.still) m.stun = Math.max(m.stun, m.def.boss ? o.stun * 0.4 : o.stun);
    if (o.knock && !m.def.still && !m.def.boss) { const d = Math.max(0.01, e.dist(m)); m.kx = ((m.x - e.x) / d) * o.knock; m.kz = ((m.z - e.z) / d) * o.knock; }
    this.onChange('arts');
    return true;
  }

  private provoke(m: Mob) {
    if (m.dead || m.def.still) return;
    if (m.def.flee) { m.state = 'flee'; m.timer = rand(3, 5); m.path = null; return; }
    if (m.state !== 'attack') { m.state = 'chase'; m.target = this.pe; m.repath = 0; }
    // 同伴呼应
    for (const o of this.mobs) {
      if (o !== m && !o.dead && o.def.aggro > 0 && o.state !== 'chase' && o.state !== 'attack' && o.dist(m) < 6 && o.def.atlas.startsWith('mob_bandit')) {
        o.state = 'chase'; o.target = this.pe; o.repath = 0;
      }
    }
  }

  private damageMob(m: Mob, dmg: number, crit: boolean, from: Entity) {
    m.hp -= dmg;
    m.flash = 1;
    m.hpShow = 6;
    this.float(m.x + rand(-0.2, 0.2), m.y + m.height * 0.9, m.z, String(dmg) + (crit ? '!' : ''), crit ? '#ffd24a' : '#ffffff', crit ? 26 : 19);
    this.onSfx(crit ? 'crit' : 'hit', crit ? 0.8 : 0.55);
    if (crit) this.shake = Math.max(this.shake, 0.35);
    const hd = Math.max(0.01, from.dist(m)), ux = (m.x - from.x) / hd, uz = (m.z - from.z) / hd;
    const hx = m.x - ux * m.radius * 0.6, hy = m.y + m.height * 0.55, hz = m.z - uz * m.radius * 0.6;
    const blade = from !== this.pe || this.p.weaponKind !== 'fist';
    // 兵刃入肉 / 击木：几点火星加一小团尘，不发光球
    if (blade) this.sparks(hx, hy, hz, crit ? 9 : 4, ux, uz);
    this.dust(hx, hy - 0.2, hz, crit ? 3 : 1, 0.7, 1.2);
    this.flashes.push({ x: hx, y: hy + 0.1, z: hz, t: 0, k: crit ? 1.5 : 0.9 });
    if (m.def.still) {
      m.spr.play('hit', true);
      if (m.hp < m.hpMax * 0.5) m.hp = m.hpMax;
      return;
    }
    if (m.hp <= 0) { this.killMob(m); return; }
    const d = Math.max(0.01, from.dist(m));
    m.kx += ((m.x - from.x) / d) * 1.6; m.kz += ((m.z - from.z) / d) * 1.6;
    if (m.atkT < 0 && m.spr.has('hit')) { m.spr.play('hit', true); m.timer = 0.22; }
    this.provoke(m);
  }

  private killMob(m: Mob) {
    const p = this.p;
    m.dead = true; m.state = 'dead'; m.hp = 0; m.path = null; m.target = null; m.atkT = -1;
    m.corpseT = 0; m.respawnT = m.def.respawn;
    m.spr.play('die', true);
    this.onSfx('die', 0.5);
    p.kills++;
    p.hpMax += 0.12 * Math.sqrt(m.def.grade);
    if (this.target === m) this.target = null;
    if (this.intent?.type === 'attack' && this.intent.mob === m) this.intent = null;
    const items: [string, number][] = [];
    for (const [id, ch, lo, hi] of m.def.drops) if (Math.random() < ch) items.push([id, Math.round(rand(lo ?? 1, hi ?? lo ?? 1))]);
    const coins = Math.round(rand(m.def.coins[0], m.def.coins[1]));
    if (items.length || coins > 0) this.loots.push({ id: this.lootSeq++, x: m.x, z: m.z, items, coins, t: 0 });
    const q = p.quest, qd = p.questDef();
    if (q?.active && qd && qd.goal.type === 'kill' && qd.goal.mobs.includes(m.def.id) && q.n < qd.goal.n) {
      q.n++;
      this.onLog(`${qd.name}：${p.questProgress()}`, 'quest');
      if (p.questReady()) this.onLog(`「${qd.name}」已达成，去找${NPCS[qd.turnIn].name}复命。`, 'quest');
      this.onChange('quest');
    }
    if (m.def.boss) this.onLog(`你击败了 ${m.def.name}！`, 'good');
    this.onChange('stats');
  }

  private artUp(id: string, lv: number) {
    const a = ARTS[id];
    this.onLog(`「${a.name}」修为精进至 ${Math.floor(lv)}.00`, 'good');
    this.onSfx('levelup', 0.7);
    const e = this.pe;
    this.float(e.x, e.y + 2.3, e.z, `${a.name} ${Math.floor(lv)}`, '#8fe3ff', 20);
    if (a.move && Math.floor(lv) === a.move.unlock) this.onLog(`领悟绝招「${a.move.name}」！按空格或鼠标右键施展。`, 'good');
    this.onChange('arts');
  }

  // ---------------- 绝招 ----------------
  moveCdLeft() { return Math.max(0, this.moveCd); }
  currentMove(): MoveDef | null {
    const a = this.p.art;
    return a.move && this.p.artLv >= a.move.unlock ? a.move : null;
  }
  useMove() {
    const p = this.p, e = this.pe;
    if (this.state !== 'normal' || e.atkT >= 0 || e.stun > 0) return;
    const a = p.art, mv = a.move;
    if (!mv) return;
    if (p.artLv < mv.unlock) { this.onLog(`「${a.name}」修为达到 ${mv.unlock}.00 方可施展「${mv.name}」。`, 'warn'); return; }
    if (this.moveCd > 0) { this.onLog(`「${mv.name}」尚需调息 ${this.moveCd.toFixed(1)} 秒。`, 'warn'); return; }
    if (p.mp < mv.inner) { this.onLog('内力不足。按 Z 打坐回气。', 'warn'); return; }
    const t = this.target && !this.target.dead ? this.target : null;
    let ang: number;
    if (t) { e.faceTo(t.x, t.z); ang = Math.atan2(t.x - e.x, t.z - e.z); }
    else { const [gx, gz] = this.r.screenToGround(this.mouse.x, this.mouse.y); e.faceTo(gx, gz); ang = Math.atan2(gx - e.x, gz - e.z); }
    const fx = Math.sin(ang), fz = Math.cos(ang);
    if (mv.kind === 'burst' && (!t || e.dist(t) - t.radius > p.reach * 1.6)) { this.onLog('需贴近目标方可施展。', 'warn'); return; }
    if (mv.kind === 'volley' && !t) { this.onLog('需要先选定目标。', 'warn'); return; }
    p.mp -= mv.inner;
    this.moveCd = mv.cd;
    e.path = null; e.moving = false;
    const anim = e.spr.has('atk2') ? 'atk2' : 'atk1';
    const meta = e.spr.meta(anim)!;
    e.spr.play(anim, true, 1.25);
    e.atkT = 0; e.atkDur = meta.n / meta.fps / 1.25; e.atkHit = true; e.atkCd = p.interval * 0.6;
    this.float(e.x, e.y + 2.4, e.z, mv.name, '#ffe9a8', 22);
    this.onSfx('skill', 0.8);
    this.shake = Math.max(this.shake, 0.3);
    if (mv.kind === 'wave') {
      this.shots.push({
        kind: 'wave', x: e.x + fx * 0.8, y: e.y + 1.0, z: e.z + fz * 0.8, vx: fx * 17, vz: fz * 17, life: 0.6, from: e, target: null,
        hit: new Set(), hostile: false, onHit: (m) => this.playerHit(m as Mob, mv.mult, { knock: 4, sure: true }),
      });
      this.slashFx(e, 'sword', 1.3);
    } else if (mv.kind === 'spin') {
      for (let i = 0; i < 10; i++) { const an = (i / 10) * Math.PI * 2; this.dust(e.x + Math.cos(an) * 1.4, e.y, e.z + Math.sin(an) * 1.4, 1, 1.6, 0.5); }
      for (const m of this.mobs) if (!m.dead && e.dist(m) - m.radius < 3.3) this.playerHit(m, mv.mult, { knock: 5, sure: true });
    } else if (mv.kind === 'pierce') {
      let len = 0;
      for (let s = 0.25; s <= 5; s += 0.25) { if (this.world.blocked(e.x + fx * s, e.z + fz * s)) break; len = s; }
      for (const m of this.mobs) {
        if (m.dead) continue;
        const dx = m.x - e.x, dz = m.z - e.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        if (along > -0.5 && along < len + 2.6 && side < 1.2 + m.radius) this.playerHit(m, mv.mult, { knock: 3, sure: true });
      }
      this.state = 'dash';
      this.dash = { t: 0, dur: 0.2, vx: (fx * len) / 0.2, vz: (fz * len) / 0.2 };
      e.spr.play('atk1', true, 1.6);
      e.atkT = -1;
      for (let d = 0; d < len; d += 0.6) this.dust(e.x + fx * d, e.y, e.z + fz * d, 1, 0.5, 0.6);
    } else if (mv.kind === 'burst' && t) {
      this.dust(t.x, t.y, t.z, 8, 1.8, 0.9);
      this.playerHit(t, mv.mult, { stun: 1.8, knock: 7, sure: true });
      this.shake = 0.7;
    } else if (mv.kind === 'volley' && t) {
      for (let i = 0; i < 3; i++) setTimeout(() => { if (!t.dead && this.state !== 'dead') { this.fireArrow(e, t, (m) => this.playerHit(m as Mob, mv.mult, { sure: i > 0 }), false); this.onSfx('bow', 0.4); } }, i * 130);
    }
    this.onChange('stats');
  }

  private fireArrow(from: Entity, to: Entity, onHit: (e: Entity) => void, hostile: boolean) {
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.max(0.01, Math.hypot(dx, dz));
    const sp = 24;
    this.shots.push({
      kind: 'arrow', x: from.x + (dx / d) * 0.7, y: from.y + 1.3, z: from.z + (dz / d) * 0.7, vx: (dx / d) * sp, vz: (dz / d) * sp,
      life: d / sp + 0.25, from, target: to, onHit, hit: new Set(), hostile,
    });
  }

  private updateShots(dt: number) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      s.x += s.vx * dt; s.z += s.vz * dt;
      let dead = s.life <= 0;
      if (s.kind === 'arrow') {
        const t = s.target;
        if (t && !t.dead) {
          // 轻微追踪，保证命中判定由数值决定
          const dx = t.x - s.x, dz = t.z - s.z, d = Math.hypot(dx, dz), sp = Math.hypot(s.vx, s.vz);
          if (d < 0.6 + t.radius) { s.onHit(t); dead = true; }
          else { s.vx = (dx / d) * sp; s.vz = (dz / d) * sp; }
          s.y += ((t.y + t.height * 0.55) - s.y) * Math.min(1, dt * 6);
        } else dead = true;
        if (this.world.blocked(s.x, s.z) && this.world.elevation(s.x, s.z) === 0 && Math.random() < 0.0) dead = true;
      } else {
        for (const m of this.mobs) {
          if (m.dead || s.hit.has(m.id)) continue;
          if (Math.hypot(m.x - s.x, m.z - s.z) < 1.3 + m.radius) { s.hit.add(m.id); s.onHit(m); }
        }
        if (Math.random() < dt * 40) this.dust(s.x, 0, s.z, 1, 0.6, 0.5);
      }
      if (dead) this.shots.splice(i, 1);
    }
  }

  // ================================================================ 怪物
  private applyKnock(e: Entity, dt: number) {
    const nx = e.x + e.kx * dt, nz = e.z + e.kz * dt;
    if (!this.world.blocked(nx, nz)) { e.x = nx; e.z = nz; }
    const k = Math.exp(-dt * 9);
    e.kx *= k; e.kz *= k;
    if (Math.abs(e.kx) + Math.abs(e.kz) < 0.05) { e.kx = 0; e.kz = 0; }
  }

  private updateMob(m: Mob, dt: number) {
    const w = this.world, pe = this.pe, def = m.def;
    m.spr.update(dt);
    m.flash = Math.max(0, m.flash - dt * 5);
    m.hpShow -= dt;
    m.atkCd -= dt;
    if (m.dead) {
      m.corpseT += dt;
      m.alpha = clamp(1 - (m.corpseT - 5) / 2, 0, 1);
      m.respawnT -= dt;
      if (m.respawnT <= 0 && pe.dist(m.home) > 14) {
        const [x, z] = this.randomNear(m.home.x, m.home.z, m.home.r);
        m.x = x; m.z = z; m.dead = false; m.state = 'idle'; m.hp = m.hpMax; m.alpha = 1; m.timer = rand(1, 4); m.kx = m.kz = 0; m.stun = 0;
        m.spr.play('idle', true);
      }
      return;
    }
    if (def.still) { if (m.spr.anim === 'hit' && m.spr.done) m.spr.play('idle'); return; }
    if (m.kx || m.kz) this.applyKnock(m, dt);
    if (m.stun > 0) {
      m.stun -= dt;
      return;
    }
    const pd = pe.dist(m);
    const playerAlive = this.state !== 'dead';
    const anim = (name: string, sp = 1) => { if (m.spr.anim === 'hit' && !m.spr.done && m.timer > 0) return; m.spr.play(m.spr.has(name) ? name : 'walk', false, sp); };
    if (m.timer > 0) m.timer -= dt;

    switch (m.state) {
      case 'idle':
      case 'wander': {
        if (def.aggro > 0 && playerAlive && pd < def.aggro * (1 + this.env.night * 0.25) && w.clear(m.x, m.z, pe.x, pe.z)) {
          m.state = 'chase'; m.target = pe; m.repath = 0;
          if (def.id === 'boss') this.onLog(`${def.name}：「哪来的小辈，敢闯我黑风寨！」`, 'warn');
          else if (def.id === 'tiger') this.onLog('一声虎啸震得林叶簌簌而落！', 'warn');
          break;
        }
        if (def.flee && playerAlive && pd < 3.2 && this.pe.moving) { m.state = 'flee'; m.timer = rand(2, 3.5); m.path = null; break; }
        if (m.state === 'idle') {
          anim('idle');
          if (m.timer <= 0) {
            const [x, z] = this.randomNear(m.home.x, m.home.z, Math.max(1.5, m.home.r));
            const path = Math.hypot(x - m.x, z - m.z) < 14 ? w.findPath(m.x, m.z, x, z, 1500) : null;
            if (path) { m.path = path; m.state = 'wander'; } else m.timer = rand(2, 5);
          }
        } else {
          anim('walk');
          if (!m.step(w, def.walk, dt)) { m.state = 'idle'; m.timer = rand(2.5, 7); }
        }
        break;
      }
      case 'flee': {
        anim('run', 1.1);
        if (!m.path || !m.path.length) {
          const a = Math.atan2(m.x - pe.x, m.z - pe.z) + rand(-0.7, 0.7);
          const [x, z] = w.nearestFree(m.x + Math.sin(a) * 7, m.z + Math.cos(a) * 7);
          m.path = w.findPath(m.x, m.z, x, z, 1200);
        }
        m.step(w, def.run, dt);
        if (m.timer <= 0 && pd > 7) { m.state = 'idle'; m.timer = rand(2, 4); m.path = null; }
        else if (m.timer <= 0) m.timer = 1.5;
        break;
      }
      case 'chase': {
        if (!playerAlive || Math.hypot(m.x - m.home.x, m.z - m.home.z) > 26 + m.home.r) { m.state = 'return'; m.target = null; m.path = null; break; }
        const d = pd - pe.radius;
        if (d <= def.reach && (!def.ranged || w.clear(m.x, m.z, pe.x, pe.z))) { m.state = 'attack'; m.path = null; break; }
        m.repath -= dt;
        if (m.repath <= 0 || !m.path) {
          m.repath = 0.45 + Math.random() * 0.2;
          // 围攻时稍微散开
          const a = (m.id * 2.399) % (Math.PI * 2), off = def.ranged ? 0 : 0.6;
          m.path = w.findPath(m.x, m.z, pe.x + Math.cos(a) * off, pe.z + Math.sin(a) * off, 3500);
        }
        anim('run');
        m.step(w, def.run, dt);
        break;
      }
      case 'attack': {
        m.faceTo(pe.x, pe.z);
        if (m.atkT >= 0) {
          m.atkT += dt;
          if (!m.atkHit && m.atkT >= m.atkHitAt) {
            m.atkHit = true;
            if (def.ranged) this.fireArrow(m, pe, () => this.mobHit(m), true);
            else if (pd - pe.radius <= def.reach * 1.4) this.mobHit(m);
          }
          if (m.atkT >= m.atkDur) { m.atkT = -1; m.spr.play('idle'); }
          break;
        }
        if (!playerAlive) { m.state = 'return'; m.target = null; break; }
        if (pd - pe.radius > def.reach * 1.15) { m.state = 'chase'; m.repath = 0; break; }
        if (m.atkCd <= 0) {
          const meta = m.spr.meta('atk1');
          if (meta) {
            m.spr.play('atk1', true);
            m.atkT = 0; m.atkDur = meta.n / meta.fps; m.atkHitAt = ((meta.hit ?? 3) + 0.4) / meta.fps; m.atkHit = false;
            m.atkCd = def.interval * rand(0.9, 1.15);
            if (!def.ranged) this.onSfx('swing', 0.3);
          }
        } else anim('idle');
        break;
      }
      case 'return': {
        m.hp = Math.min(m.hpMax, m.hp + m.hpMax * dt * 0.25);
        if (!m.path) m.path = w.findPath(m.x, m.z, m.home.x, m.home.z, 6000);
        anim('walk', 1.3);
        if (!m.path || !m.step(w, def.walk * 1.6, dt)) { m.state = 'idle'; m.timer = rand(1, 3); }
        break;
      }
    }
    // 互相推开，避免重叠
    for (const o of this.mobs) {
      if (o === m || o.dead || o.def.still) continue;
      const dx = m.x - o.x, dz = m.z - o.z, d = Math.hypot(dx, dz), min = m.radius + o.radius;
      if (d > 0.001 && d < min) {
        const push = ((min - d) / d) * 0.5 * Math.min(1, dt * 8);
        const nx = m.x + dx * push, nz = m.z + dz * push;
        if (!w.blocked(nx, nz)) { m.x = nx; m.z = nz; }
      }
    }
    m.y = w.elevation(m.x, m.z);
  }

  private mobHit(m: Mob) {
    const p = this.p, e = this.pe;
    if (this.state === 'dead' || m.dead) return;
    const ev = clamp(0.05 + (p.evade - m.def.acc) * 0.009, 0.03, 0.62);
    if (Math.random() < ev) {
      this.float(e.x, e.y + 2.0, e.z, '闪避', '#9fe0a8', 17);
      this.onSfx('miss', 0.3);
      const id = p.use.step;
      const g = p.gain(id, 0.2, m.def.grade);
      if (g.up) this.artUp(id, g.lv);
      return;
    }
    let dmg = m.def.atk * rand(0.85, 1.15) - p.def * 0.6;
    let absorbed = 0;
    if (p.mp >= 1) {
      absorbed = Math.max(0, dmg) * p.guardRate;
      const cost = absorbed * 0.3;
      if (p.mp >= cost) { p.mp -= cost; dmg -= absorbed; } else absorbed = 0;
      const id = p.use.guard;
      const g = p.gain(id, 0.2, m.def.grade);
      if (g.up) this.artUp(id, g.lv);
    }
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg;
    p.hpMax += dmg * 0.03;
    if (Math.random() < 0.3) {
      const k = (['head', 'arm', 'leg'] as const)[Math.floor(Math.random() * 3)];
      const before = p.parts[k];
      p.parts[k] = Math.max(0, p.parts[k] - dmg * 0.7);
      if (before >= 40 && p.parts[k] < 40) this.onLog(`你的${{ head: '头部', arm: '手臂', leg: '腿部' }[k]}受了伤，${{ head: '命中', arm: '出手', leg: '身法' }[k]}大受影响。可用跌打酒医治。`, 'warn');
    }
    e.flash = 0.8;
    this.shake = Math.max(this.shake, 0.4);
    this.float(e.x + rand(-0.2, 0.2), e.y + 1.9, e.z, '-' + dmg, '#ff6a5a', 19);
    this.onSfx('hurt', 0.6);
    if (this.state === 'sit') this.stand();
    if (!this.intent && !this.target && this.pe.atkT < 0 && !this.pe.moving) { this.target = m; this.intent = { type: 'attack', mob: m }; }
    if (p.hp <= 0) this.die();
    this.onChange('stats');
  }

  private die() {
    const p = this.p, e = this.pe;
    p.hp = 0;
    this.state = 'dead'; this.deadT = 0;
    this.stopActions();
    e.atkT = -1; e.path = null;
    e.spr.play('die', true);
    this.onSfx('die', 0.7);
    this.onLog('你倒下了……', 'warn');
    setTimeout(() => this.onDeath(), 1600);
  }
  respawn() {
    const p = this.p, e = this.pe;
    const lost = Math.floor(p.coins * 0.08);
    p.coins -= lost;
    p.hp = p.hpMax * 0.6; p.mp = p.mpMax * 0.5; p.sp = p.spMax;
    const [x, z] = this.world.nearestFree(this.map.spawn.x, this.map.spawn.z);
    e.x = x; e.z = z; e.y = 0; e.setDir(0); e.stun = 0; e.kx = e.kz = 0;
    this.state = 'normal';
    e.spr.play('idle', true);
    for (const m of this.mobs) if (m.target === e) { m.target = null; if (!m.dead) m.state = 'return'; m.path = null; }
    this.r.focus.set(x, 0.9, z);
    this.onLog(`你在落霞村醒来${lost ? `，丢了 ${lost} 文钱` : ''}。`, 'sys');
    this.onChange('all');
    this.save();
  }

  // ================================================================ 交互
  private talk(n: Npc) {
    const p = this.p, qd = p.questDef();
    if (p.quest?.active && qd && qd.goal.type === 'talk' && qd.goal.npc === n.def.id) { /* 由对话框完成交付 */ }
    this.onSfx('ui', 0.4);
    this.onDialog(n);
  }
  questOffer(npcId: string) { const q = this.p.quest, d = this.p.questDef(); return q && d && !q.active && d.giver === npcId ? d : null; }
  questTurnIn(npcId: string) { const q = this.p.quest, d = this.p.questDef(); return q && d && q.active && d.turnIn === npcId && this.p.questReady() ? d : null; }
  questPending(npcId: string) { const q = this.p.quest, d = this.p.questDef(); return q && d && q.active && d.turnIn === npcId && !this.p.questReady() ? d : null; }
  acceptQuest() {
    const q = this.p.quest, d = this.p.questDef();
    if (!q || !d || q.active) return;
    q.active = true; q.n = 0;
    this.onLog(`接受任务「${d.name}」：${d.desc}`, 'quest');
    this.onSfx('quest', 0.6);
    this.onChange('quest');
    this.save();
  }
  completeQuest() {
    const p = this.p, q = p.quest, d = p.questDef();
    if (!q || !d || !p.questReady()) return;
    if (d.goal.type === 'item') p.removeItem(d.goal.item, d.goal.n);
    p.coins += d.reward.coins ?? 0;
    const got: string[] = [];
    if (d.reward.coins) got.push(`${d.reward.coins} 文`);
    for (const [id, n] of d.reward.items ?? []) { p.addItem(id, n); got.push(`${ITEMS[id].name}×${n}`); }
    p.questDone.push(d.id);
    p.quest = d.next ? { id: d.next, active: false, n: 0 } : null;
    this.onLog(`完成任务「${d.name}」，获得 ${got.join('、')}。`, 'quest');
    const nd = p.questDef();
    if (nd) this.onLog(`新的委托：去找${NPCS[nd.giver].name}（${NPCS[nd.giver].title}）。`, 'quest');
    else this.onLog('黑风寨之患已除，落霞村重归安宁。江湖路远，后会有期。', 'good');
    this.onSfx('quest', 0.8);
    this.onChange('all');
    this.save();
  }

  private takeLoot(l: Loot) {
    const p = this.p;
    const i = this.loots.indexOf(l);
    if (i < 0) return;
    const got: string[] = [];
    if (l.coins) { p.coins += l.coins; got.push(`${l.coins} 文`); }
    const left: [string, number][] = [];
    for (const [id, n] of l.items) { if (p.addItem(id, n)) got.push(`${ITEMS[id].name}${n > 1 ? '×' + n : ''}`); else left.push([id, n]); }
    if (left.length) { l.items = left; l.coins = 0; this.onLog('行囊已满。', 'warn'); }
    else this.loots.splice(i, 1);
    if (got.length) this.onLog('拾取：' + got.join('、'), 'loot');
    this.onSfx('pick', 0.5);
    if (p.quest?.active && p.questDef()?.goal.type === 'item' && p.questReady()) this.onLog(`「${p.questDef()!.name}」已达成。`, 'quest');
    this.onChange('inv');
  }

  private gatherNode(g: GatherNode) {
    if (g.obj.hidden) return;
    const p = this.p;
    if (!p.addItem(g.item, 1)) { this.onLog('行囊已满。', 'warn'); return; }
    g.obj.hidden = true; g.respawn = 100;
    this.onLog(`采得${ITEMS[g.item].name}。`, 'loot');
    this.onSfx('pick', 0.5);
    for (let i = 0; i < 6; i++) this.parts.spawn({ x: g.x + rand(-0.2, 0.2), y: 0.3, z: g.z, vx: rand(-1, 1), vy: rand(1, 2.5), vz: rand(-0.6, 0.6), max: 0.7, size: 0.14, size2: 0.1, cell: FX.LEAF, r: 0.3, g: 0.6, b: 0.25, a: 1, add: 0, lit: true, grav: 6, vr: rand(-6, 6), rot: rand(0, 6) });
    const qd = p.questDef();
    if (p.quest?.active && qd?.goal.type === 'item') {
      this.onLog(`${qd.name}：${p.questProgress()}`, 'quest');
      if (p.questReady()) this.onLog(`「${qd.name}」已达成，去找${NPCS[qd.turnIn].name}复命。`, 'quest');
      this.onChange('quest');
    }
    this.onChange('inv');
  }

  private updateWorldBits(dt: number) {
    for (const g of this.nodes) {
      if (g.obj.hidden) { g.respawn -= dt; if (g.respawn <= 0) g.obj.hidden = false; }
      if (g.obj.view) g.obj.view.visible = !g.obj.hidden;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].t += dt; if (this.flashes[i].t > 0.12) this.flashes.splice(i, 1); }
    for (let i = this.loots.length - 1; i >= 0; i--) { this.loots[i].t += dt; if (this.loots[i].t > 150) this.loots.splice(i, 1); }
  }

  // ---------------- 物品 ----------------
  useItem(id: string) {
    const p = this.p, it = ITEMS[id];
    if (!it || p.count(id) <= 0 || this.state === 'dead') return;
    if (it.type === 'weapon') {
      const old = p.weapon;
      p.removeItem(id, 1);
      if (old) p.addItem(old, 1);
      p.weapon = id;
      this.onWeaponChanged();
      this.onLog(`装备了${it.name}。当前武功：「${p.art.name}」${p.artLv.toFixed(2)}`, 'sys');
    } else if (it.type === 'armor') {
      const old = p.armor;
      p.removeItem(id, 1);
      if (old) p.addItem(old, 1);
      p.armor = id;
      this.onLog(`穿上了${it.name}。`, 'sys');
    } else if (it.type === 'use' && it.heal) {
      const h = it.heal;
      if (h.hp && p.hp >= p.hpMax && !h.sp && !h.mp) { this.onLog('气血充盈，无需用药。', 'warn'); return; }
      p.removeItem(id, 1);
      if (h.hp) p.hp = Math.min(p.hpMax, p.hp + h.hp);
      if (h.mp) p.mp = Math.min(p.mpMax, p.mp + h.mp);
      if (h.sp) p.sp = Math.min(p.spMax, p.sp + h.sp);
      if (h.parts) for (const k of ['head', 'arm', 'leg'] as const) p.parts[k] = Math.min(100, p.parts[k] + h.parts);
      this.onLog(`使用了${it.name}。`, 'sys');
      const e = this.pe;
      this.onSfx('drink', 0.5);
    } else if (it.type === 'book' && it.teaches) {
      const a = ARTS[it.teaches];
      if (p.arts[a.id] !== undefined) { this.onLog(`你已习得「${a.name}」。`, 'warn'); return; }
      const baseLv = p.kindLv(a.kind);
      if (baseLv < 12) { this.onLog(`根基尚浅：需先将一门${KIND_NAME[a.kind]}练到 12.00，方能参悟「${a.name}」。`, 'warn'); return; }
      p.removeItem(id, 1);
      p.arts[a.id] = 1;
      p.use[a.kind] = a.id;
      this.onLog(`你研读${it.name}，习得上乘武功「${a.name}」！已自动运用。`, 'good');
      this.onSfx('levelup', 0.8);
    }
    this.onChange('all');
  }
  unequip(slot: 'weapon' | 'armor') {
    const p = this.p;
    const id = p[slot];
    if (!id) return;
    if (!p.addItem(id, 1)) { this.onLog('行囊已满。', 'warn'); return; }
    p[slot] = null;
    if (slot === 'weapon') this.onWeaponChanged();
    this.onChange('all');
  }
  private onWeaponChanged() {
    const kind = this.p.weaponKind;
    this.pe.spr.setDef(actorDef('player_' + kind));
    this.pe.atkT = -1;
    this.pe.spr.play('idle', true);
  }
  setArt(id: string) {
    const a = ARTS[id];
    if (!a || this.p.arts[id] === undefined) return;
    this.p.use[a.kind] = id;
    this.onLog(`运用「${a.name}」。`, 'sys');
    this.onChange('arts');
  }
  buy(id: string): boolean {
    const p = this.p, it = ITEMS[id];
    if (p.coins < it.price) { this.onLog('钱不够。', 'warn'); return false; }
    if (!p.addItem(id, 1)) { this.onLog('行囊已满。', 'warn'); return false; }
    p.coins -= it.price;
    this.onSfx('coin', 0.5);
    this.onChange('inv');
    return true;
  }
  sell(id: string) {
    const p = this.p, it = ITEMS[id];
    if (!p.removeItem(id, 1)) return;
    p.coins += Math.max(1, Math.floor(it.price * 0.4));
    this.onSfx('coin', 0.5);
    this.onChange('inv');
  }
  rest(cost: number) {
    const p = this.p;
    if (p.coins < cost) { this.onLog('钱不够。', 'warn'); return; }
    p.coins -= cost;
    p.hp = p.hpMax; p.mp = p.mpMax; p.sp = p.spMax; p.parts = { head: 100, arm: 100, leg: 100 };
    this.hour = 7;
    this.onLog('你在客栈歇了一宿，精神焕发。', 'good');
    this.onChange('all');
    this.save();
  }

  float(x: number, y: number, z: number, text: string, color: string, size = 18) {
    this.texts.push({ x, y, z, text, color, t: 0, size, vx: rand(-0.3, 0.3) });
  }

  // ================================================================ 环境粒子
  private ambT = 0;
  private ambient(dt: number) {
    const r = this.r, env = this.env;
    const [x0, z0, x1, z1] = r.viewBounds(2);
    // 落叶 / 花瓣
    this.ambT += dt;
    if (this.ambT > 0.09) {
      this.ambT = 0;
      const trees = this.world.trees;
      for (let i = 0; i < 5; i++) {
        const t = trees[Math.floor(Math.random() * trees.length)];
        if (!t || t.x < x0 || t.x > x1 || t.z < z0 || t.z > z1 + 6) continue;
        let col: [number, number, number] | null = null, cell = FX.LEAF;
        if (t.kind.startsWith('maple')) col = Math.random() < 0.5 ? [0.75, 0.16, 0.06] : [0.85, 0.38, 0.07];
        else if (t.kind.startsWith('peach')) { col = [0.95, 0.6, 0.68]; cell = FX.PETAL; }
        else if (t.kind.startsWith('tree') && Math.random() < 0.35) col = [0.5, 0.52, 0.12];
        else if (t.kind.startsWith('willow') && Math.random() < 0.3) col = [0.42, 0.55, 0.16];
        if (!col) continue;
        this.parts.spawn({
          x: t.x + rand(-2, 2), y: rand(2.5, 5.5), z: t.z + rand(-1.2, 1.2), vx: rand(0.2, 0.9), vy: rand(-0.9, -0.4), vz: rand(-0.1, 0.3),
          max: rand(4, 7), size: rand(0.1, 0.17), size2: 0.13, cell, r: col[0], g: col[1], b: col[2], a: 1, add: 0, lit: true,
          rot: rand(0, 6), vr: rand(-4, 4), sway: rand(0.5, 1.2), grav: 0.0001,
        });
        break;
      }
    }
    // 萤火
    if (env.night > 0.55 && Math.random() < dt * 5 * env.night) {
      const x = rand(x0, x1), z = rand(z0, z1);
      if (!this.world.blocked(x, z) || Math.random() < 0.3) {
        this.parts.spawn({ x, y: rand(0.4, 2.0), z, vx: rand(-0.3, 0.3), vy: rand(-0.1, 0.15), vz: rand(-0.2, 0.2), max: rand(3, 6), size: 0.1, size2: 0.1, cell: FX.SPARK, r: 0.9, g: 1.3, b: 0.4, a: 0.9, sway: 0.8, rot: rand(0, 6) });
      }
    }
    // 篝火
    for (const f of this.world.fires) {
      if (f.x < x0 - 2 || f.x > x1 + 2 || f.z < z0 - 2 || f.z > z1 + 4) continue;
      const k = f.k;
      for (let i = 0; i < 2; i++) {
        this.parts.spawn({ x: f.x + rand(-0.22, 0.22) * k, y: f.y + rand(0, 0.15), z: f.z + rand(-0.12, 0.12) * k + 0.1, vx: rand(-0.15, 0.15), vy: rand(1.1, 2.0) * k, max: rand(0.3, 0.6), size: rand(0.3, 0.46) * k, size2: 0.08 * k, cell: FX.GLOW, r: 2.0, g: 0.75, b: 0.16, a: 0.55 });
      }
      if (Math.random() < dt * 20) this.parts.spawn({ x: f.x + rand(-0.2, 0.2) * k, y: f.y + 0.4 * k, z: f.z + 0.1, vx: rand(-0.5, 0.5), vy: rand(1.5, 3.2), vz: rand(-0.3, 0.3), max: rand(0.8, 1.6), size: 0.09, size2: 0.02, cell: FX.SPARK, r: 2.4, g: 1.2, b: 0.4, a: 1, sway: 0.6 });
      if (f.big && Math.random() < dt * 5) this.parts.spawn({ x: f.x + rand(-0.15, 0.15), y: f.y + 1.2, z: f.z, vx: rand(0.1, 0.4), vy: rand(0.7, 1.1), max: rand(2, 3.2), size: 0.5, size2: 1.8, cell: FX.SMOKE, r: 0.35, g: 0.33, b: 0.32, a: 0.22, add: 0, lit: true });
    }
  }

  // ================================================================ 提交渲染
  submit() {
    const r = this.r, env = this.env, t = this.time, dt = this.frameDt;
    r.begin();
    this.actors.begin();
    r.shake = this.shake;
    // 镜头与主角之间的遮挡物（树冠、屋檐）挖空
    r.uniforms.uHoleB.value.set(this.pe.x, this.pe.y + 1.0, this.pe.z);
    this.world.submitLights(r, env.night, t);
    const [x0, z0, x1, z1] = r.viewBounds(5);
    const vis = (e: { x: number; z: number }) => e.x > x0 && e.x < x1 && e.z > z0 && e.z < z1;
    const hoverE = this.hover && (this.hover.type === 'mob' || this.hover.type === 'npc') ? this.hover.e : null;
    const draw = (e: Entity) => {
      if (!vis(e) || e.alpha <= 0.01) return;
      this.actors.draw(e, dt);
    };
    for (const m of this.mobs) draw(m);
    for (const n of this.npcs) draw(n);
    draw(this.pe);
    this.actors.end();

    // 目标圈、点击标记：贴地的细线圈，不发光
    if (this.target && !this.target.dead) {
      const m = this.target, d = m.radius * 2.6 + 0.5;
      r.fxFlat(m.x, m.y + 0.05, m.z, d, d, t * 0.8, FX.RING, 0.9, 0.16, 0.1, 0.8);
    }
    if (hoverE && hoverE !== this.target) {
      const d = hoverE.radius * 2.6 + 0.5, npc = hoverE.kind === 'npc';
      r.fxFlat(hoverE.x, hoverE.y + 0.05, hoverE.z, d, d, t * 0.8, FX.RING, npc ? 0.8 : 0.8, npc ? 0.65 : 0.35, npc ? 0.25 : 0.2, 0.5);
    }
    if (this.marker.t < 0.5) {
      const k = this.marker.t / 0.5;
      r.fxFlat(this.marker.x, this.world.elevation(this.marker.x, this.marker.z) + 0.05, this.marker.z, 0.4 + k * 0.7, 0.4 + k * 0.7, 0, FX.RING, 0.7, 0.7, 0.6, (1 - k) * 0.7);
    }
    // 掉落：一点金属反光似的闪烁，方便在暗处找到
    for (const l of this.loots) {
      if (!vis(l)) continue;
      const pulse = 0.6 + 0.4 * Math.sin(t * 4 + l.id);
      const rare = l.items.some(([id]) => ITEMS[id].type === 'book' || ITEMS[id].price >= 300);
      const c: [number, number, number] = rare ? [1.5, 1.2, 1.7] : [1.7, 1.4, 0.8];
      r.fxBillboard(l.x, 0.14, l.z, 0.22, FX.DOT, 0.5, 0.4, 0.22, 1, 0);
      r.fxBillboard(l.x, 0.22, l.z, 0.34 * pulse, FX.SPARK, c[0], c[1], c[2], pulse, 1, t * 2);
    }
    // 弹道
    for (const s of this.shots) {
      const sp = Math.hypot(s.vx, s.vz), dx = s.vx / sp, dz = s.vz / sp;
      if (s.kind === 'arrow') {
        const nx = -dz * 0.02, nz = dx * 0.02, L = 0.45;
        r.fxQuad([
          s.x - dx * L + nx, s.y + 0.02, s.z - dz * L + nz, s.x + dx * L + nx, s.y + 0.02, s.z + dz * L + nz,
          s.x - dx * L - nx, s.y - 0.02, s.z - dz * L - nz, s.x + dx * L - nx, s.y - 0.02, s.z + dz * L - nz,
        ], FX.DOT, 0.5, 0.4, 0.28, 1, 0);
      } else {
        // 剑气：一道贴着地面掠过的淡淡白弧，不带光晕
        const a = Math.atan2(s.vx, s.vz);
        r.fxFlat(s.x, s.y, s.z, 2.6, 1.5, a + Math.PI, FX.SLASH, 1.3, 1.4, 1.5, 0.7);
      }
    }
    // 击中的一闪
    this.flashes.forEach((f, i) => r.light('hit' + i, f.x, f.y, f.z, 4.5, [1.5, 1.35, 1.1], f.k * (1 - f.t / 0.12)));
    // 夜里主角身周一点微弱的补光，保证在暗处也认得出人
    if (env.night > 0.2) r.light('self', this.pe.x, this.pe.y + 2.6, this.pe.z + 1.6, 8, [0.66, 0.66, 0.74], env.night * 0.85);
    this.parts.draw(r, env);
  }
}
