import type { AnimMeta } from '../../../src/shared/consts';
import { PPU } from '../../../src/shared/consts';
import { DIR_ANGLE, humanoidAnims, npcIdle, simulate } from './anims';
import type { Baker, BakeItem } from './core';
import { CREATURE_JOBS } from './creatures';
import { BUILD_JOBS } from './env/build';
import { NATURE_JOBS } from './env/nature';
import { Humanoid, Look, WeaponKind } from './humanoid';

export interface AtlasJob {
  name: string;
  ppu: number;
  ss: number;
  hScale: number;
  aoSamples?: number;
  shadowRes?: number;
  items: BakeItem[];
  anims?: Record<string, AnimMeta>;
  info?: Record<string, any>;
  /** 自定义流程（如地表平铺贴图）：存在时跳过默认的逐帧烘焙与图集打包 */
  custom?: (ctx: CustomCtx) => Promise<void>;
}

export interface CustomCtx {
  baker: Baker;
  /** 写文件：路径相对 public/assets/atlas；以 preview/ 开头则写到预览目录。w>0 时按 RGBA 原始像素编码为 PNG */
  save: (file: string, body: Uint8ClampedArray | string, w?: number, h?: number, rgb?: boolean) => Promise<void>;
  preview: boolean;
  query: URLSearchParams;
}

/** 主角：戴斗笠的江湖刀客——粗布短褐、敞襟赤臂、绑腿布鞋、腰悬酒葫芦 */
export const PLAYER_LOOK = (weapon: WeaponKind): Look => ({
  skin: '#b98a63', hair: '#15110e', hairStyle: 'bun', hat: 'douli', stubble: true, scar: true,
  top: '#3d4047', trim: '#26282d', pants: '#474237', boots: '#2b2723', sash: '#6b3a2b', bracer: '#3a2a1e',
  skirt: 0.34, sleeve: 'bare', open: true, wraps: '#8a8271', legwrap: '#8a8271', scarf: '#6b3a2b', gourd: true,
  bulk: 1.05, weapon, bladeColor: '#b4bdc8',
});

export function humanoidJob(name: string, look: Look, set: 'player' | 'mob', dirs = [0, 1, 2, 3, 4, 5, 6, 7]): AtlasJob {
  const h = new Humanoid(look);
  const defs = humanoidAnims(look.weapon, set);
  const frames: BakeItem['frames'] = [];
  const anims: Record<string, AnimMeta> = {};
  for (const a of defs) {
    const sim = simulate(h, a);
    anims[a.name] = { n: a.n, fps: a.fps, loop: a.loop, ...(a.hit !== undefined ? { hit: a.hit } : {}) };
    for (const d of dirs) {
      sim.forEach((s, f) => {
        frames.push({
          key: `${a.name}_${d}_${f}`,
          apply: () => {
            h.root.rotation.y = DIR_ANGLE(d);
            h.setPose(s.pose);
            h.loadChains(s.chains);
          },
        });
      });
    }
  }
  return { name, ppu: PPU, ss: 3, hScale: 3.2, aoSamples: 24, items: [{ root: h.root, frames }], anims };
}

// ---------------- 人形怪物 ----------------
const BANDIT: Look = {
  skin: '#c99a72', hair: '#15110f', hairStyle: 'bun', hat: 'bandana', mask: '#2a2624',
  top: '#3b3a3f', trim: '#7a1f1a', pants: '#2c2a2b', boots: '#1c1816', sash: '#7a1f1a', bracer: '#241d19', ribbon: '#8a2019',
  skirt: 0.3, sleeve: 'bare', weapon: 'saber', bladeColor: '#c9cfd6',
};
const BANDIT_SPEAR: Look = { ...BANDIT, top: '#4a4433', trim: '#2b2a20', sash: '#3b3a2a', ribbon: '#6b6a3a', mask: undefined, beard: '#1a1512', bulk: 1.08, weapon: 'spear' };
const BANDIT_BOW: Look = { ...BANDIT, top: '#5a4632', trim: '#33271b', sash: '#33271b', hat: 'cap', ribbon: '#3d3024', sleeve: 'tight', bracer: '#3a2a1c', bulk: 0.95, weapon: 'bow' };
const BOSS: Look = {
  skin: '#b98a64', hair: '#0f0c0a', hairStyle: 'bald', beard: '#0f0c0a', bulk: 1.3,
  top: '#5a1a16', trim: '#c9a44a', pants: '#231f1f', boots: '#15110f', sash: '#c9a44a', bracer: '#2a1d14', mantle: '#3a332c',
  skirt: 0.42, sleeve: 'bare', weapon: 'saber', weaponScale: 1.4, bladeColor: '#aeb4bc',
};

// ---------------- NPC（只烘待机，8 朝向） ----------------
const NPC_LOOKS: Record<string, Look> = {
  master: { skin: '#dcb590', hair: '#6d6a68', hairStyle: 'topknot', beard: '#77736f', top: '#2b3f66', trim: '#c9a44a', pants: '#1e2a44', boots: '#1b1714', sash: '#1a1a1c', bracer: '#1f2c48', skirt: 0.72, sleeve: 'wide', weapon: 'fist', bulk: 1.05 },
  smith: { skin: '#c08f68', hair: '#1a1512', hairStyle: 'bun', hat: 'bandana', ribbon: '#6a5a44', top: '#5a3d28', trim: '#2a1c12', pants: '#3a3028', boots: '#1b1714', sash: '#2a1c12', bracer: '#2a1c12', skirt: 0.5, sleeve: 'bare', weapon: 'fist', bulk: 1.2 },
  doctor: { build: 'slim', skin: '#edd0b4', hair: '#1a1410', hairStyle: 'bun', top: '#7fae8e', trim: '#f0ead8', pants: '#e8e2d0', boots: '#6a5140', sash: '#e9d9a8', bracer: '#7fae8e', skirt: 0.78, sleeve: 'wide', weapon: 'fist', bulk: 0.9, ribbon: '#e9d9a8' },
  innkeeper: { skin: '#e0b48c', hair: '#201814', hairStyle: 'bun', hat: 'cap', ribbon: '#3a2a22', top: '#7a3b2a', trim: '#d8b66a', pants: '#3a2a22', boots: '#1b1714', sash: '#d8b66a', bracer: '#7a3b2a', skirt: 0.7, sleeve: 'wide', weapon: 'fist', bulk: 1.24 },
  hunter: { skin: '#c9986c', hair: '#1a1410', hairStyle: 'ponytail', top: '#55653a', trim: '#2f3a20', pants: '#4a3c2a', boots: '#2a1f16', sash: '#2f3a20', bracer: '#3a2a1c', mantle: '#6a5a48', skirt: 0.32, sleeve: 'tight', weapon: 'bow', bulk: 1.06, ribbon: '#8a6a3a' },
  elder: { build: 'slim', skin: '#dcb898', hair: '#d8d4cc', hairStyle: 'bun', beard: '#e2ded6', top: '#8a8478', trim: '#3a3630', pants: '#5a554c', boots: '#2a2622', sash: '#3a3630', bracer: '#8a8478', skirt: 0.78, sleeve: 'wide', weapon: 'fist', bulk: 0.96 },
  vendor: { build: 'slim', skin: '#ecc9aa', hair: '#1c1410', hairStyle: 'buns', top: '#b8485a', trim: '#f0e0b8', pants: '#e6d8c0', boots: '#5a3a30', sash: '#f0c860', bracer: '#b8485a', skirt: 0.76, sleeve: 'wide', weapon: 'fist', bulk: 0.9, ribbon: '#f0c860' },
  kid: { build: 'slim', skin: '#f0cdaa', hair: '#1c1410', hairStyle: 'buns', top: '#d8943a', trim: '#b3322a', pants: '#3a5a7a', boots: '#2a2018', sash: '#b3322a', bracer: '#d8943a', skirt: 0.26, sleeve: 'tight', weapon: 'fist', scale: 0.66, ribbon: '#b3322a' },
  farmer: { skin: '#b88a60', hair: '#3a3028', hairStyle: 'bun', hat: 'douli', top: '#8a7a58', trim: '#5a4e38', pants: '#5a5244', boots: '#3a2e22', sash: '#5a4e38', bracer: '#5a4e38', skirt: 0.3, sleeve: 'bare', weapon: 'fist' },
  guard: { skin: '#c99a72', hair: '#15110f', hairStyle: 'topknot', hat: 'cap', ribbon: '#6a1a16', top: '#7a2a22', trim: '#2a2422', pants: '#2c2a2b', boots: '#1c1816', sash: '#2a2422', bracer: '#2a2422', skirt: 0.4, sleeve: 'tight', weapon: 'spear', bulk: 1.1 },
};

function npcJob(): AtlasJob {
  const items: BakeItem[] = [];
  const n = 4;
  for (const [id, look] of Object.entries(NPC_LOOKS)) {
    const h = new Humanoid(look);
    const a = npcIdle(look, id);
    const sim = simulate(h, a);
    const frames: BakeItem['frames'] = [];
    for (let d = 0; d < 8; d++) {
      sim.forEach((s, f) => frames.push({
        key: `${id}:idle_${d}_${f}`,
        apply: () => { h.root.rotation.y = DIR_ANGLE(d); h.setPose(s.pose); h.loadChains(s.chains); },
      }));
    }
    items.push({ root: h.root, frames });
  }
  return { name: 'npcs', ppu: PPU, ss: 3, hScale: 3.2, aoSamples: 24, items, anims: { idle: { n, fps: 3, loop: true } } };
}

export const JOBS: Record<string, () => AtlasJob> = {
  player_sword: () => humanoidJob('player_sword', PLAYER_LOOK('sword'), 'player'),
  player_saber: () => humanoidJob('player_saber', PLAYER_LOOK('saber'), 'player'),
  player_spear: () => humanoidJob('player_spear', PLAYER_LOOK('spear'), 'player'),
  player_bow: () => humanoidJob('player_bow', PLAYER_LOOK('bow'), 'player'),
  player_fist: () => humanoidJob('player_fist', PLAYER_LOOK('fist'), 'player'),
  mob_bandit: () => humanoidJob('mob_bandit', BANDIT, 'mob'),
  mob_bandit_spear: () => humanoidJob('mob_bandit_spear', BANDIT_SPEAR, 'mob'),
  mob_bandit_bow: () => humanoidJob('mob_bandit_bow', BANDIT_BOW, 'mob'),
  mob_boss: () => humanoidJob('mob_boss', BOSS, 'mob'),
  npcs: npcJob,
  ...CREATURE_JOBS,
  ...NATURE_JOBS,
  ...BUILD_JOBS,
};
