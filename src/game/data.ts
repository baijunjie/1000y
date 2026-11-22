// 静态数据：武功、物品、怪物、NPC、任务。

export type WeaponKind = 'fist' | 'sword' | 'saber' | 'spear' | 'bow';
export type ArtKind = WeaponKind | 'step' | 'heart' | 'guard';

export const KIND_NAME: Record<ArtKind, string> = {
  fist: '拳法', sword: '剑法', saber: '刀法', spear: '枪法', bow: '弓术', step: '步法', heart: '心法', guard: '护体',
};
export const KIND_ICON: Record<ArtKind, string> = {
  fist: '拳', sword: '剑', saber: '刀', spear: '枪', bow: '弓', step: '步', heart: '心', guard: '护',
};
export const WEAPON_KINDS: WeaponKind[] = ['fist', 'sword', 'saber', 'spear', 'bow'];

export interface MoveDef {
  name: string;
  desc: string;
  /** 修为达到多少可用 */
  unlock: number;
  inner: number;
  cd: number;
  kind: 'wave' | 'spin' | 'pierce' | 'burst' | 'volley';
  mult: number;
}

export interface ArtDef {
  id: string;
  name: string;
  kind: ArtKind;
  tier: 1 | 2;
  desc: string;
  /** 攻击类：伤害倍率、出手间隔（秒）、攻击距离（米）、每次消耗体力 */
  power?: number;
  speed?: number;
  reach?: number;
  stamina?: number;
  move?: MoveDef;
  /** 辅助类的效力倍率 */
  eff?: number;
}

export const ARTS: Record<string, ArtDef> = {
  changquan: { id: 'changquan', name: '长拳', kind: 'fist', tier: 1, desc: '江湖上人人会两手的入门拳脚，出手快，伤敌浅。', power: 0.8, speed: 0.72, reach: 1.5, stamina: 2.5,
    move: { name: '崩山劲', desc: '蓄力一拳，重创并震晕对手。', unlock: 8, inner: 14, cd: 7, kind: 'burst', mult: 2.6 } },
  fuhu: { id: 'fuhu', name: '伏虎拳', kind: 'fist', tier: 2, desc: '刚猛无俦的上乘拳法，拳出如虎扑。', power: 1.15, speed: 0.66, reach: 1.6, stamina: 3.5,
    move: { name: '崩山劲', desc: '蓄力一拳，重创并震晕对手。', unlock: 5, inner: 18, cd: 6, kind: 'burst', mult: 3.2 } },
  qingfeng: { id: 'qingfeng', name: '清风剑法', kind: 'sword', tier: 1, desc: '轻灵迅捷的入门剑法，讲究以快打慢。', power: 1.0, speed: 0.92, reach: 2.1, stamina: 3.5,
    move: { name: '剑气纵横', desc: '凝气于剑，斩出一道破空剑气。', unlock: 8, inner: 16, cd: 6, kind: 'wave', mult: 2.4 } },
  qiyun: { id: 'qiyun', name: '栖云剑诀', kind: 'sword', tier: 2, desc: '栖云山失传已久的剑诀，剑意如云卷云舒。', power: 1.38, speed: 0.82, reach: 2.2, stamina: 4.5,
    move: { name: '剑气纵横', desc: '凝气于剑，斩出一道破空剑气。', unlock: 5, inner: 20, cd: 5, kind: 'wave', mult: 3.0 } },
  pofeng: { id: 'pofeng', name: '破风刀法', kind: 'saber', tier: 1, desc: '大开大阖的入门刀法，势大力沉。', power: 1.28, speed: 1.18, reach: 2.0, stamina: 4.5,
    move: { name: '回风斩', desc: '旋身一刀，横扫周身之敌。', unlock: 8, inner: 18, cd: 8, kind: 'spin', mult: 1.9 } },
  duanyue: { id: 'duanyue', name: '断岳刀法', kind: 'saber', tier: 2, desc: '一刀既出，有断岳分江之势。', power: 1.7, speed: 1.1, reach: 2.1, stamina: 5.5,
    move: { name: '回风斩', desc: '旋身一刀，横扫周身之敌。', unlock: 5, inner: 22, cd: 7, kind: 'spin', mult: 2.5 } },
  liuhe: { id: 'liuhe', name: '六合枪法', kind: 'spear', tier: 1, desc: '一寸长一寸强，中规中矩的入门枪法。', power: 1.12, speed: 1.08, reach: 2.9, stamina: 4,
    move: { name: '贯日', desc: '挺枪直进，贯穿一线之敌。', unlock: 8, inner: 16, cd: 7, kind: 'pierce', mult: 2.2 } },
  youlong: { id: 'youlong', name: '游龙枪', kind: 'spear', tier: 2, desc: '枪走如游龙，点、崩、扎变化无穷。', power: 1.5, speed: 0.98, reach: 3.0, stamina: 5,
    move: { name: '贯日', desc: '挺枪直进，贯穿一线之敌。', unlock: 5, inner: 20, cd: 6, kind: 'pierce', mult: 2.8 } },
  liegong: { id: 'liegong', name: '猎弓术', kind: 'bow', tier: 1, desc: '猎户代代相传的射术，可于远处伤敌。', power: 0.9, speed: 1.3, reach: 10.5, stamina: 3.5,
    move: { name: '连珠箭', desc: '一息之间连发三矢。', unlock: 8, inner: 16, cd: 8, kind: 'volley', mult: 1.1 } },
  chuanyun: { id: 'chuanyun', name: '穿云箭', kind: 'bow', tier: 2, desc: '弓开如满月，箭去似流星。', power: 1.25, speed: 1.2, reach: 12, stamina: 4.5,
    move: { name: '连珠箭', desc: '一息之间连发三矢。', unlock: 5, inner: 20, cd: 7, kind: 'volley', mult: 1.4 } },
  taqing: { id: 'taqing', name: '踏青步', kind: 'step', tier: 1, desc: '入门步法。奔行时修炼，提升身法与闪避。', eff: 1 },
  liuyun: { id: 'liuyun', name: '流云步', kind: 'step', tier: 2, desc: '身如流云，飘忽不定。', eff: 1.5 },
  tuna: { id: 'tuna', name: '吐纳诀', kind: 'heart', tier: 1, desc: '入门心法。打坐时修炼，恢复内力与气血。', eff: 1 },
  qiyunxin: { id: 'qiyunxin', name: '栖云心经', kind: 'heart', tier: 2, desc: '栖云山内功心法，气息绵长。', eff: 1.6 },
  tieyi: { id: 'tieyi', name: '铁衣功', kind: 'guard', tier: 1, desc: '入门护体功夫。受击时以内力化去部分伤害。', eff: 1 },
  panshi: { id: 'panshi', name: '磐石功', kind: 'guard', tier: 2, desc: '身如磐石，刀剑难伤。', eff: 1.5 },
};

export const START_ARTS = ['changquan', 'qingfeng', 'pofeng', 'liuhe', 'liegong', 'taqing', 'tuna', 'tieyi'];

// ---------------------------------------------------------------- 物品
export interface ItemDef {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'use' | 'mat' | 'book';
  icon: string;
  color: string;
  desc: string;
  price: number;
  weapon?: WeaponKind;
  atk?: number;
  def?: number;
  heal?: { hp?: number; mp?: number; sp?: number; parts?: number };
  teaches?: string;
}

const W = (id: string, name: string, weapon: WeaponKind, atk: number, price: number, desc: string, icon: string, color = '#9fb4c9'): ItemDef =>
  ({ id, name, type: 'weapon', weapon, atk, price, desc, icon, color });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(([
  W('sword1', '木剑', 'sword', 4, 30, '练功用的木剑，聊胜于无。', '剑', '#b08a5a'),
  W('sword2', '铁剑', 'sword', 10, 220, '寻常铁匠铺打的铁剑。', '剑'),
  W('sword3', '青锋剑', 'sword', 19, 900, '百炼精钢，剑身泛青。', '剑', '#7fd0c8'),
  W('sword4', '栖云剑', 'sword', 30, 3000, '剑脊隐有云纹，据说出自栖云山。', '剑', '#e8c66a'),
  W('saber1', '柴刀', 'saber', 5, 30, '劈柴的刀，也能劈人。', '刀', '#b08a5a'),
  W('saber2', '朴刀', 'saber', 12, 240, '刀身宽厚，分量十足。', '刀'),
  W('saber3', '雁翎刀', 'saber', 22, 950, '形如雁翎，锋锐无匹。', '刀', '#7fd0c8'),
  W('spear1', '竹枪', 'spear', 5, 30, '削尖的老竹。', '枪', '#b08a5a'),
  W('spear2', '铁枪', 'spear', 11, 230, '白蜡杆配铁枪头。', '枪'),
  W('spear3', '点钢枪', 'spear', 20, 920, '枪尖点钢，寒芒逼人。', '枪', '#7fd0c8'),
  W('bow1', '竹弓', 'bow', 4, 40, '孩童练手的竹弓。', '弓', '#b08a5a'),
  W('bow2', '猎弓', 'bow', 9, 240, '猎户惯用的桑木弓。', '弓'),
  W('bow3', '铁胎弓', 'bow', 17, 960, '弓身嵌铁，非膂力过人者不能开。', '弓', '#7fd0c8'),
  W('fist2', '皮护手', 'fist', 4, 120, '牛皮缝制，护住指节。', '拳'),
  W('fist3', '铁指套', 'fist', 11, 700, '拳拳到肉。', '拳', '#7fd0c8'),
  { id: 'armor1', name: '粗布衣', type: 'armor', def: 2, price: 40, desc: '寻常布衣。', icon: '衣', color: '#b08a5a' },
  { id: 'armor2', name: '皮甲', type: 'armor', def: 6, price: 320, desc: '鞣制兽皮缝成的轻甲。', icon: '甲', color: '#9fb4c9' },
  { id: 'armor3', name: '锁子甲', type: 'armor', def: 12, price: 1200, desc: '铁环相扣，刀砍不入。', icon: '甲', color: '#7fd0c8' },
  { id: 'potion1', name: '金创药', type: 'use', heal: { hp: 70 }, price: 18, desc: '止血生肌。恢复 70 点气血。', icon: '药', color: '#d66a5a' },
  { id: 'potion2', name: '大还丹', type: 'use', heal: { hp: 240 }, price: 90, desc: '恢复 240 点气血。', icon: '丹', color: '#e04a3a' },
  { id: 'mpotion1', name: '回气散', type: 'use', heal: { mp: 60 }, price: 26, desc: '调理内息。恢复 60 点内力。', icon: '散', color: '#5a8ad6' },
  { id: 'food1', name: '干粮', type: 'use', heal: { sp: 80, hp: 12 }, price: 8, desc: '几块面饼。恢复 80 点体力。', icon: '粮', color: '#c9a45a' },
  { id: 'wine1', name: '跌打酒', type: 'use', heal: { parts: 60 }, price: 30, desc: '活血化瘀，医治头、臂、腿的伤势。', icon: '酒', color: '#c98a3a' },
  { id: 'herb', name: '草药', type: 'mat', price: 6, desc: '山野常见的草药，药铺收。', icon: '草', color: '#6aa85a' },
  { id: 'chicken', name: '鸡肉', type: 'mat', price: 4, desc: '新鲜的鸡肉。', icon: '肉', color: '#c9a48a' },
  { id: 'deerhide', name: '鹿皮', type: 'mat', price: 22, desc: '柔软的鹿皮。', icon: '皮', color: '#c99a6a' },
  { id: 'dogfang', name: '犬牙', type: 'mat', price: 5, desc: '野狗的牙。', icon: '牙', color: '#d8d2c0' },
  { id: 'wolfhide', name: '狼皮', type: 'mat', price: 26, desc: '完整的灰狼皮。', icon: '皮', color: '#9a9a9a' },
  { id: 'tusk', name: '野猪獠牙', type: 'mat', price: 34, desc: '又弯又利的獠牙。', icon: '牙', color: '#e8dcc0' },
  { id: 'tigerbone', name: '虎骨', type: 'mat', price: 320, desc: '名贵药材。', icon: '骨', color: '#e8c66a' },
  { id: 'token', name: '黑风令', type: 'mat', price: 40, desc: '黑风寨喽啰的腰牌。', icon: '令', color: '#8a5a9a' },
  { id: 'book_qiyun', name: '《栖云剑诀》', type: 'book', teaches: 'qiyun', price: 2400, desc: '研读后习得上乘剑法「栖云剑诀」。', icon: '诀', color: '#e8c66a' },
  { id: 'book_duanyue', name: '《断岳刀谱》', type: 'book', teaches: 'duanyue', price: 2400, desc: '研读后习得上乘刀法「断岳刀法」。', icon: '谱', color: '#e8c66a' },
  { id: 'book_youlong', name: '《游龙枪谱》', type: 'book', teaches: 'youlong', price: 2400, desc: '研读后习得上乘枪法「游龙枪」。', icon: '谱', color: '#e8c66a' },
  { id: 'book_fuhu', name: '《伏虎拳经》', type: 'book', teaches: 'fuhu', price: 2400, desc: '研读后习得上乘拳法「伏虎拳」。', icon: '经', color: '#e8c66a' },
  { id: 'book_chuanyun', name: '《穿云箭诀》', type: 'book', teaches: 'chuanyun', price: 2400, desc: '研读后习得上乘弓术「穿云箭」。', icon: '诀', color: '#e8c66a' },
  { id: 'book_liuyun', name: '《流云步》', type: 'book', teaches: 'liuyun', price: 1600, desc: '研读后习得上乘步法「流云步」。', icon: '步', color: '#e8c66a' },
  { id: 'book_qiyunxin', name: '《栖云心经》', type: 'book', teaches: 'qiyunxin', price: 1600, desc: '研读后习得上乘心法「栖云心经」。', icon: '经', color: '#e8c66a' },
  { id: 'book_panshi', name: '《磐石功》', type: 'book', teaches: 'panshi', price: 1600, desc: '研读后习得上乘护体功「磐石功」。', icon: '功', color: '#e8c66a' },
] as ItemDef[]).map((i) => [i.id, i]));

// ---------------------------------------------------------------- 怪物
export interface MobDef {
  id: string;
  name: string;
  atlas: string;
  scale: number;
  tint?: [number, number, number];
  /** 强度品阶：决定修炼收益 */
  grade: number;
  hp: number;
  atk: number;
  def: number;
  acc: number;
  evade: number;
  walk: number;
  run: number;
  /** 主动攻击的察觉半径，0 = 不主动 */
  aggro: number;
  flee?: boolean;
  still?: boolean;
  reach: number;
  interval: number;
  ranged?: boolean;
  boss?: boolean;
  radius: number;
  height: number;
  drops: [string, number, number?, number?][];
  coins: [number, number];
  respawn: number;
}

export const MOBS: Record<string, MobDef> = {
  dummy: { id: 'dummy', name: '木人桩', atlas: 'mob_dummy', scale: 1, grade: 4, hp: 99999, atk: 0, def: 0, acc: 0, evade: -50, walk: 0, run: 0, aggro: 0, still: true,
    reach: 0, interval: 9, radius: 0.45, height: 1.9, drops: [], coins: [0, 0], respawn: 1 },
  chicken: { id: 'chicken', name: '芦花鸡', atlas: 'mob_chicken', scale: 1, grade: 1, hp: 14, atk: 0, def: 0, acc: 0, evade: 0, walk: 0.8, run: 3.2, aggro: 0, flee: true,
    reach: 0, interval: 9, radius: 0.25, height: 0.55, drops: [['chicken', 0.9]], coins: [0, 0], respawn: 40 },
  deer: { id: 'deer', name: '梅花鹿', atlas: 'mob_deer', scale: 1, grade: 3, hp: 46, atk: 0, def: 1, acc: 0, evade: 8, walk: 1.0, run: 5.6, aggro: 0, flee: true,
    reach: 0, interval: 9, radius: 0.5, height: 1.5, drops: [['deerhide', 0.7]], coins: [0, 0], respawn: 70 },
  dog: { id: 'dog', name: '野狗', atlas: 'mob_wolf', scale: 0.82, tint: [1.15, 0.92, 0.7], grade: 3, hp: 42, atk: 7, def: 1, acc: 4, evade: 4, walk: 1.2, run: 4.0, aggro: 5.5,
    reach: 1.25, interval: 1.7, radius: 0.42, height: 0.95, drops: [['dogfang', 0.55]], coins: [1, 6], respawn: 45 },
  wolf: { id: 'wolf', name: '灰狼', atlas: 'mob_wolf', scale: 1, grade: 10, hp: 120, atk: 17, def: 4, acc: 12, evade: 12, walk: 1.3, run: 4.8, aggro: 8,
    reach: 1.4, interval: 1.5, radius: 0.5, height: 1.1, drops: [['wolfhide', 0.5], ['potion1', 0.08]], coins: [4, 14], respawn: 55 },
  boar: { id: 'boar', name: '野猪', atlas: 'mob_boar', scale: 1, grade: 17, hp: 230, atk: 27, def: 9, acc: 16, evade: 6, walk: 1.1, run: 4.6, aggro: 7,
    reach: 1.45, interval: 1.9, radius: 0.6, height: 1.15, drops: [['tusk', 0.45], ['food1', 0.15]], coins: [8, 22], respawn: 60 },
  bandit: { id: 'bandit', name: '黑风喽啰', atlas: 'mob_bandit', scale: 1, grade: 24, hp: 300, atk: 36, def: 12, acc: 24, evade: 16, walk: 1.3, run: 4.2, aggro: 8.5,
    reach: 1.9, interval: 1.6, radius: 0.4, height: 1.9, drops: [['token', 0.5], ['potion1', 0.25], ['saber2', 0.03]], coins: [14, 40], respawn: 75 },
  bandit_spear: { id: 'bandit_spear', name: '黑风枪手', atlas: 'mob_bandit_spear', scale: 1.03, grade: 30, hp: 380, atk: 46, def: 15, acc: 30, evade: 14, walk: 1.3, run: 4.0, aggro: 8.5,
    reach: 2.7, interval: 1.8, radius: 0.4, height: 1.95, drops: [['token', 0.6], ['potion1', 0.3], ['spear2', 0.03], ['mpotion1', 0.12]], coins: [18, 50], respawn: 80 },
  bandit_bow: { id: 'bandit_bow', name: '黑风弓手', atlas: 'mob_bandit_bow', scale: 0.98, grade: 28, hp: 250, atk: 40, def: 9, acc: 34, evade: 18, walk: 1.3, run: 4.0, aggro: 11,
    reach: 9.5, interval: 2.3, ranged: true, radius: 0.4, height: 1.9, drops: [['token', 0.6], ['bow2', 0.04], ['food1', 0.3]], coins: [16, 44], respawn: 80 },
  tiger: { id: 'tiger', name: '吊睛猛虎', atlas: 'mob_tiger', scale: 1.05, grade: 44, hp: 1500, atk: 78, def: 22, acc: 44, evade: 22, walk: 1.4, run: 5.6, aggro: 10, boss: true,
    reach: 1.9, interval: 1.6, radius: 0.8, height: 1.5, drops: [['tigerbone', 1], ['book_fuhu', 0.6], ['potion2', 1, 1, 3]], coins: [160, 300], respawn: 240 },
  boss: { id: 'boss', name: '寨主·屠千仞', atlas: 'mob_boss', scale: 1.28, grade: 56, hp: 3200, atk: 96, def: 30, acc: 52, evade: 20, walk: 1.3, run: 4.4, aggro: 10, boss: true,
    reach: 2.5, interval: 1.7, radius: 0.55, height: 2.4, drops: [['book_duanyue', 1], ['sword4', 1], ['potion2', 1, 2, 4], ['book_liuyun', 0.5]], coins: [400, 700], respawn: 420 },
};

// ---------------------------------------------------------------- NPC
export interface NpcDef {
  id: string;
  name: string;
  title: string;
  talk: string[];
  shop?: string[];
  rest?: number;
}

export const NPCS: Record<string, NpcDef> = {
  master: { id: 'master', name: '陆沉舟', title: '武馆馆主', talk: ['拳怕少壮，功怕日久。武功是一招一式磨出来的，没有捷径。', '院里的木人桩随你打。记住——只有对上比你强的对手，功夫才长得快。'],
    shop: ['book_liuyun', 'book_qiyunxin', 'book_panshi', 'book_youlong', 'book_chuanyun', 'sword1', 'saber1', 'spear1', 'bow1'] },
  smith: { id: 'smith', name: '雷老铁', title: '铁匠', talk: ['好钢要千锤百炼，人也一样。', '看看有什么趁手的？'],
    shop: ['sword2', 'sword3', 'saber2', 'saber3', 'spear2', 'spear3', 'bow2', 'bow3', 'fist2', 'fist3', 'armor2', 'armor3'] },
  doctor: { id: 'doctor', name: '苏半夏', title: '药铺掌柜', talk: ['行走江湖，药可不能断。', '山里的草药我都收，有多少要多少。'],
    shop: ['potion1', 'potion2', 'mpotion1', 'wine1'] },
  innkeeper: { id: 'innkeeper', name: '钱满仓', title: '客栈掌柜', talk: ['客官打尖还是住店？', '歇一晚，什么伤都好了。'], shop: ['food1', 'armor1'], rest: 20 },
  hunter: { id: 'hunter', name: '阿蛮', title: '猎户', talk: ['过了桥就是红枫林，狼多，夜里尤其凶。', '北边苍松岭的野猪皮糙肉厚，没两下子别去招惹。'] },
  elder: { id: 'elder', name: '顾怀山', title: '村长', talk: ['落霞村世代安宁，如今北山来了一伙强人，自称黑风寨……', '少侠若有余力，还望为乡亲们除此一害。'] },
  vendor: { id: 'vendor', name: '柳三娘', title: '货郎', talk: ['南来北往的小玩意儿，看看吧。'], shop: ['food1', 'potion1', 'mpotion1', 'wine1', 'bow1'] },
  kid: { id: 'kid', name: '小石头', title: '村童', talk: ['我长大了也要当大侠！', '听说虎啸崖上有只大老虎，眼睛像灯笼那么大！'] },
  farmer: { id: 'farmer', name: '田老汉', title: '农夫', talk: ['野狗老来祸害我的鸡……', '西边竹林清静，就是路不好走。'] },
  guard: { id: 'guard', name: '赵铁柱', title: '村口乡勇', talk: ['北边的路不太平，少侠小心。', '黑风寨的人见过血，别小看他们。'] },
};

// ---------------------------------------------------------------- 任务
export type Goal =
  | { type: 'talk'; npc: string }
  | { type: 'kill'; mobs: string[]; n: number; label: string }
  | { type: 'item'; item: string; n: number }
  | { type: 'art'; lv: number };

export interface QuestDef {
  id: string;
  name: string;
  giver: string;
  turnIn: string;
  desc: string;
  start: string;
  done: string;
  goal: Goal;
  reward: { coins?: number; items?: [string, number][] };
  next?: string;
}

export const QUESTS: Record<string, QuestDef> = {
  q1: { id: 'q1', name: '初入江湖', giver: 'elder', turnIn: 'master', desc: '去村东北的武馆拜见馆主陆沉舟。',
    start: '少侠初来乍到，不妨先去武馆见见陆馆主。他为人方正，定肯指点一二。', done: '顾老让你来的？好。习武先立身，从最笨的功夫练起吧。',
    goal: { type: 'talk', npc: 'master' }, reward: { coins: 30, items: [['potion1', 3]] }, next: 'q2' },
  q2: { id: 'q2', name: '木人桩', giver: 'master', turnIn: 'master', desc: '在武馆前院击打木人桩，把任意一门攻击武功练到 3.00。',
    start: '院里有木人桩。挑一门兵器，把它练到三成火候再来见我。按 Z 可以打坐回气。', done: '不错，有些样子了。这把铁剑拿去防身。',
    goal: { type: 'art', lv: 3 }, reward: { coins: 60, items: [['sword2', 1], ['food1', 5]] }, next: 'q3' },
  q3: { id: 'q3', name: '野狗为患', giver: 'master', turnIn: 'farmer', desc: '村外的野狗祸害家禽。清剿 5 只野狗，再去村西找田老汉。',
    start: '木桩不会还手。村外野狗成群，正好拿来试招——杀五只，去村西告诉田老汉一声。', done: '哎呀，可算清净了！一点心意，少侠别嫌弃。',
    goal: { type: 'kill', mobs: ['dog'], n: 5, label: '野狗' }, reward: { coins: 120, items: [['armor1', 1], ['potion1', 4]] }, next: 'q4' },
  q4: { id: 'q4', name: '采药', giver: 'doctor', turnIn: 'doctor', desc: '为药铺的苏半夏采 5 株草药。草药生在林间野地，走近点击即可采集。',
    start: '药铺的草药见底了。少侠若在山野里见到开白花的药草，替我采五株回来可好？', done: '品相很好。这几服药你带着。',
    goal: { type: 'item', item: 'herb', n: 5 }, reward: { coins: 100, items: [['potion2', 2], ['mpotion1', 3], ['wine1', 2]] }, next: 'q5' },
  q5: { id: 'q5', name: '红枫狼踪', giver: 'hunter', turnIn: 'hunter', desc: '过桥进入红枫林，猎杀 6 头灰狼。',
    start: '狼群越来越靠近村子了。过了桥往东，替我杀六头，皮子归你。', done: '好身手！这张弓和皮甲送你，北边用得上。',
    goal: { type: 'kill', mobs: ['wolf'], n: 6, label: '灰狼' }, reward: { coins: 260, items: [['armor2', 1], ['bow2', 1]] }, next: 'q6' },
  q6: { id: 'q6', name: '苍松野猪', giver: 'hunter', turnIn: 'elder', desc: '去北边苍松岭猎 5 头野猪，再向村长复命。',
    start: '苍松岭的野猪拱坏了山田。猎五头，然后去见村长，他有要事相托。', done: '少侠果然了得。老朽正有一事相求……',
    goal: { type: 'kill', mobs: ['boar'], n: 5, label: '野猪' }, reward: { coins: 420, items: [['potion2', 3]] }, next: 'q7' },
  q7: { id: 'q7', name: '黑风寨', giver: 'elder', turnIn: 'elder', desc: '沿北路上山，剿灭 10 名黑风寨匪徒（喽啰、枪手、弓手皆可）。',
    start: '北山黑风寨的强人劫掠过往客商。先剪其羽翼——除掉十个匪徒。', done: '大快人心！只是那寨主屠千仞一日不除，终是祸患。',
    goal: { type: 'kill', mobs: ['bandit', 'bandit_spear', 'bandit_bow'], n: 10, label: '黑风寨匪徒' }, reward: { coins: 800, items: [['armor3', 1], ['book_qiyunxin', 1]] }, next: 'q8' },
  q8: { id: 'q8', name: '寨主屠千仞', giver: 'elder', turnIn: 'elder', desc: '深入黑风寨，击败寨主屠千仞。',
    start: '屠千仞一口鬼头大刀，手下从无活口。少侠此去千万小心。', done: '落霞村上下，永感少侠大德！这本剑诀是先祖从栖云山带回的，今日物归其主。',
    goal: { type: 'kill', mobs: ['boss'], n: 1, label: '屠千仞' }, reward: { coins: 2000, items: [['book_qiyun', 1]] } },
};
export const FIRST_QUEST = 'q1';
