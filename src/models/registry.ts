import * as THREE from 'three';
import type { AnimMeta } from '../shared/consts';
import { humanoidAnims, npcIdle } from './anims';
import { makeChicken, makeDummy } from './creature_misc';
import { makeBoar, makeDeer, makeTiger, makeWolf } from './creature_species';
import type { Build } from './env/arch';
import * as B from './env/buildings';
import { TREES } from './env/nature';
import { PLANTS } from './env/plants';
import * as P from './env/props';
import { Humanoid, Look, WeaponKind } from './humanoid';
import { BANDIT, BANDIT_BOW, BANDIT_SPEAR, BOSS, NPC_LOOKS, PLAYER_LOOK } from './looks';

// ---------------------------------------------------------------- 静态物件
export interface StaticModel { root: THREE.Object3D; info: Record<string, any>; }

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const BUILDS: (() => Build)[] = [
  B.houseA, B.houseB, B.houseC, B.inn, B.smithy, B.clinic, B.dojo,
  B.gate, B.shrine, B.watchtower, B.tentA, B.tentB, B.palisadeH, B.palisadeGate, B.wallH,
  P.lanternPost, P.stoneLantern, P.well, P.stallA, P.stallB, P.barrel, P.crate, P.crates, P.cart, P.haystack, P.fenceH, P.fenceV,
  P.signPost, P.campfire, P.bridgeH, P.weaponRack, P.bench, P.table, P.flagA, P.boat, P.pier, P.woodpile, P.pot,
];

/** 物件 key（即地图 objects[].k）→ 建模函数 */
export const STATIC_MAKERS: Record<string, () => StaticModel> = {};
for (const mk of BUILDS) STATIC_MAKERS[snake(mk.name)] = () => { const b = mk(); return { root: b.root, info: b.info }; };
for (const d of [...TREES, ...PLANTS]) STATIC_MAKERS[d.key] = () => ({ root: d.build(), info: { ...d.info } });

// ---------------------------------------------------------------- 角色
export interface AnimDef {
  name: string; n: number; fps: number; loop: boolean; dur: number; hit?: number; wind?: number;
  pose: (t: number) => any;
}

/** 运行时骨架：人形、四足与木人桩共用的最小接口 */
export interface Rig {
  root: THREE.Object3D;
  setPose(p: any): void;
  resetChains(): void;
  stepChains(dt: number, wind: THREE.Vector3): void;
  placeChains(): void;
}

export interface ActorInst { rig: Rig; anims: Record<string, AnimDef>; }

export interface ActorDef {
  key: string;
  /** 动画时长等元数据（不需要先建模就能查） */
  meta: Record<string, AnimMeta>;
  make(): ActorInst;
  /** 兵器在握持节点局部坐标系里的刃段 [根, 尖]（沿 +z），用于刀光 */
  blade?: [number, number];
  weapon?: WeaponKind;
}

const toMap = (list: AnimDef[]) => Object.fromEntries(list.map((a) => [a.name, a]));
const toMeta = (list: AnimDef[]): Record<string, AnimMeta> =>
  Object.fromEntries(list.map((a) => [a.name, { n: a.n, fps: a.fps, loop: a.loop, ...(a.hit !== undefined ? { hit: a.hit } : {}) }]));

const BLADES: Partial<Record<WeaponKind, [number, number]>> = { sword: [0.2, 1.0], saber: [0.2, 0.93], spear: [1.22, 1.6] };

function humanoidDef(key: string, look: Look, set: 'player' | 'mob'): ActorDef {
  const anims = humanoidAnims(look.weapon, set) as AnimDef[];
  const ws = look.weaponScale ?? 1;
  const b = BLADES[look.weapon];
  return {
    key, meta: toMeta(anims), weapon: look.weapon,
    blade: b ? [b[0] * ws, b[1] * ws] : undefined,
    make: () => ({ rig: new Humanoid(look), anims: toMap(anims) }),
  };
}

function creatureDef(key: string, mk: () => { rig: Rig; anims: AnimDef[] }): ActorDef {
  // 动物的动画表要建一次模才拿得到；首个实例直接复用这次的结果
  let first: { rig: Rig; anims: AnimDef[] } | null = mk();
  return {
    key, meta: toMeta(first.anims),
    make: () => { const c = first ?? mk(); first = null; return { rig: c.rig, anims: toMap(c.anims) }; },
  };
}

const makers: Record<string, () => ActorDef> = {
  player_sword: () => humanoidDef('player_sword', PLAYER_LOOK('sword'), 'player'),
  player_saber: () => humanoidDef('player_saber', PLAYER_LOOK('saber'), 'player'),
  player_spear: () => humanoidDef('player_spear', PLAYER_LOOK('spear'), 'player'),
  player_bow: () => humanoidDef('player_bow', PLAYER_LOOK('bow'), 'player'),
  player_fist: () => humanoidDef('player_fist', PLAYER_LOOK('fist'), 'player'),
  mob_bandit: () => humanoidDef('mob_bandit', BANDIT, 'mob'),
  mob_bandit_spear: () => humanoidDef('mob_bandit_spear', BANDIT_SPEAR, 'mob'),
  mob_bandit_bow: () => humanoidDef('mob_bandit_bow', BANDIT_BOW, 'mob'),
  mob_boss: () => humanoidDef('mob_boss', BOSS, 'mob'),
  mob_wolf: () => creatureDef('mob_wolf', makeWolf as any),
  mob_boar: () => creatureDef('mob_boar', makeBoar as any),
  mob_tiger: () => creatureDef('mob_tiger', makeTiger as any),
  mob_deer: () => creatureDef('mob_deer', makeDeer as any),
  mob_chicken: () => creatureDef('mob_chicken', makeChicken as any),
  mob_dummy: () => creatureDef('mob_dummy', makeDummy as any),
};
for (const [id, look] of Object.entries(NPC_LOOKS)) {
  makers['npc:' + id] = () => {
    const a = npcIdle(look, id) as AnimDef;
    return { key: 'npc:' + id, meta: toMeta([a]), weapon: look.weapon, make: () => ({ rig: new Humanoid(look), anims: toMap([a]) }) };
  };
}

const defs = new Map<string, ActorDef>();
export function actorDef(key: string): ActorDef {
  let d = defs.get(key);
  if (!d) {
    const mk = makers[key];
    if (!mk) throw new Error('未知的角色模型: ' + key);
    d = mk();
    defs.set(key, d);
  }
  return d;
}

// ---------------------------------------------------------------- 姿势插值
/** 对任意「数字 / 数字数组」构成的姿势做线性插值（人形 Pose、四足 QPose、木人桩通用） */
export function lerpPose(a: any, b: any, t: number): any {
  if (typeof a === 'number') return a + (b - a) * t;
  if (Array.isArray(a)) { const o = new Array(a.length); for (let i = 0; i < a.length; i++) o[i] = lerpPose(a[i], b[i], t); return o; }
  const o: any = {};
  for (const k in a) o[k] = lerpPose(a[k], b[k], t);
  return o;
}
