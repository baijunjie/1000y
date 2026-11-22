import type { Look, WeaponKind } from './humanoid';

/** 主角：戴斗笠的江湖刀客——粗布短褐、敞襟赤臂、绑腿布鞋、腰悬酒葫芦 */
export const PLAYER_LOOK = (weapon: WeaponKind): Look => ({
  skin: '#b98a63', hair: '#15110e', hairStyle: 'bun', hat: 'douli', stubble: true, scar: true,
  top: '#3d4047', trim: '#26282d', pants: '#474237', boots: '#2b2723', sash: '#6b3a2b', bracer: '#3a2a1e',
  skirt: 0.34, sleeve: 'bare', open: true, wraps: '#8a8271', legwrap: '#8a8271', scarf: '#6b3a2b', gourd: true,
  bulk: 1.05, weapon, bladeColor: '#b4bdc8',
});

// ---------------- 人形怪物 ----------------
export const BANDIT: Look = {
  skin: '#c99a72', hair: '#15110f', hairStyle: 'bun', hat: 'bandana', mask: '#2a2624',
  top: '#3b3a3f', trim: '#7a1f1a', pants: '#2c2a2b', boots: '#1c1816', sash: '#7a1f1a', bracer: '#241d19', ribbon: '#8a2019',
  skirt: 0.3, sleeve: 'bare', weapon: 'saber', bladeColor: '#c9cfd6',
};
export const BANDIT_SPEAR: Look = { ...BANDIT, top: '#4a4433', trim: '#2b2a20', sash: '#3b3a2a', ribbon: '#6b6a3a', mask: undefined, beard: '#1a1512', bulk: 1.08, weapon: 'spear' };
export const BANDIT_BOW: Look = { ...BANDIT, top: '#5a4632', trim: '#33271b', sash: '#33271b', hat: 'cap', ribbon: '#3d3024', sleeve: 'tight', bracer: '#3a2a1c', bulk: 0.95, weapon: 'bow' };
export const BOSS: Look = {
  skin: '#b98a64', hair: '#0f0c0a', hairStyle: 'bald', beard: '#0f0c0a', bulk: 1.3,
  top: '#5a1a16', trim: '#c9a44a', pants: '#231f1f', boots: '#15110f', sash: '#c9a44a', bracer: '#2a1d14', mantle: '#3a332c',
  skirt: 0.42, sleeve: 'bare', weapon: 'saber', weaponScale: 1.4, bladeColor: '#aeb4bc',
};

// ---------------- NPC ----------------
export const NPC_LOOKS: Record<string, Look> = {
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
