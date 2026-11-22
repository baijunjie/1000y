import { ArtDef, ArtKind, ARTS, FIRST_QUEST, ITEMS, QUESTS, START_ARTS, WeaponKind } from './data';

export interface QuestState { id: string; active: boolean; n: number; }

export interface PlayerSave {
  v: number;
  age: number; ageT: number;
  hp: number; hpMax: number; mp: number; mpMax: number; sp: number; spMax: number;
  parts: { head: number; arm: number; leg: number };
  arts: Record<string, number>;
  use: Record<string, string>;
  weapon: string | null; armor: string | null;
  inv: { id: string; n: number }[];
  coins: number;
  quest: QuestState | null;
  questDone: string[];
  x: number; z: number; hour: number;
  kills: number; playT: number;
  hot: (string | null)[];
}

export const INV_SIZE = 30;

export class Player {
  age = 16; ageT = 0;
  hp = 110; hpMax = 110; mp = 40; mpMax = 40; sp = 100; spMax = 100;
  parts = { head: 100, arm: 100, leg: 100 };
  arts: Record<string, number> = {};
  use: Record<ArtKind, string> = {
    fist: 'changquan', sword: 'qingfeng', saber: 'pofeng', spear: 'liuhe', bow: 'liegong', step: 'taqing', heart: 'tuna', guard: 'tieyi',
  };
  weapon: string | null = 'sword1';
  armor: string | null = null;
  inv: { id: string; n: number }[] = [{ id: 'potion1', n: 5 }, { id: 'food1', n: 3 }, { id: 'saber1', n: 1 }, { id: 'spear1', n: 1 }, { id: 'bow1', n: 1 }];
  coins = 60;
  quest: QuestState | null = { id: FIRST_QUEST, active: false, n: 0 };
  questDone: string[] = [];
  kills = 0; playT = 0;
  /** 快捷栏：物品 id */
  hot: (string | null)[] = ['potion1', 'food1', 'mpotion1', 'wine1'];
  moveCd = 0;

  constructor() {
    for (const a of START_ARTS) this.arts[a] = 1;
  }

  get weaponKind(): WeaponKind { return this.weapon ? (ITEMS[this.weapon].weapon ?? 'fist') : 'fist'; }
  get art(): ArtDef { return ARTS[this.use[this.weaponKind]]; }
  lv(id: string): number { return this.arts[id] ?? 0; }
  get artLv(): number { return this.lv(this.art.id); }
  kindLv(k: ArtKind): number { return this.lv(this.use[k]); }
  kindEff(k: ArtKind): number { return this.kindLv(k) * (ARTS[this.use[k]].eff ?? 1); }

  get weaponAtk(): number { return this.weapon ? (ITEMS[this.weapon].atk ?? 0) : 0; }
  get power(): number {
    const armPen = this.parts.arm < 40 ? 0.85 : 1;
    return (5 + this.weaponAtk) * (this.art.power ?? 1) * (1 + 0.045 * this.artLv) * armPen;
  }
  get interval(): number {
    const armPen = this.parts.arm < 40 ? 1.15 : 1;
    return (this.art.speed ?? 1) * (1 - 0.35 * (this.artLv / 100)) * armPen;
  }
  get reach(): number { return this.art.reach ?? 1.6; }
  get acc(): number { return this.artLv * 1.0 + 8 - (this.parts.head < 40 ? 12 : 0); }
  get evade(): number { return 4 + this.kindEff('step') * 0.9; }
  get def(): number { return this.armor ? (ITEMS[this.armor].def ?? 0) : 0; }
  get moveSpeed(): number {
    const leg = this.parts.leg < 40 ? 0.78 : 1;
    return (4.3 + Math.min(1.9, this.kindEff('step') * 0.028)) * leg;
  }
  /** 护体：受击时化去伤害的比例 */
  get guardRate(): number { return Math.min(0.55, 0.08 + this.kindEff('guard') * 0.006); }

  /** 修炼收益：越练越慢，对手越强收益越高。返回是否跨过整数关口 */
  gain(id: string, base: number, grade: number): { up: boolean; lv: number } {
    const lv = this.lv(id);
    if (lv >= 99.99) return { up: false, lv };
    const diff = Math.min(1.5, Math.max(0.12, (grade + 4) / (lv + 4)));
    const g = (base * diff) / Math.pow(1 + lv / 6, 1.7);
    const nv = Math.min(99.99, lv + g);
    this.arts[id] = nv;
    return { up: Math.floor(nv) > Math.floor(lv), lv: nv };
  }

  count(id: string): number { return this.inv.reduce((s, i) => s + (i.id === id ? i.n : 0), 0); }
  addItem(id: string, n = 1): boolean {
    const it = this.inv.find((i) => i.id === id);
    const stack = ITEMS[id].type !== 'weapon' && ITEMS[id].type !== 'armor';
    if (it && stack) { it.n += n; return true; }
    if (stack) { if (this.inv.length >= INV_SIZE) return false; this.inv.push({ id, n }); return true; }
    for (let i = 0; i < n; i++) { if (this.inv.length >= INV_SIZE) return false; this.inv.push({ id, n: 1 }); }
    return true;
  }
  removeItem(id: string, n = 1): boolean {
    let left = n;
    for (let i = this.inv.length - 1; i >= 0 && left > 0; i--) {
      if (this.inv[i].id !== id) continue;
      const t = Math.min(left, this.inv[i].n);
      this.inv[i].n -= t; left -= t;
      if (this.inv[i].n <= 0) this.inv.splice(i, 1);
    }
    return left === 0;
  }

  questDef() { return this.quest ? QUESTS[this.quest.id] : null; }
  /** 任务目标是否已达成 */
  questReady(): boolean {
    const q = this.quest, d = this.questDef();
    if (!q || !d || !q.active) return false;
    const g = d.goal;
    if (g.type === 'talk') return true;
    if (g.type === 'kill') return q.n >= g.n;
    if (g.type === 'item') return this.count(g.item) >= g.n;
    if (g.type === 'art') return (['fist', 'sword', 'saber', 'spear', 'bow'] as const).some((k) => this.kindLv(k) >= g.lv);
    return false;
  }
  questProgress(): string {
    const q = this.quest, d = this.questDef();
    if (!q || !d) return '';
    const g = d.goal;
    if (g.type === 'kill') return `${g.label} ${Math.min(q.n, g.n)}/${g.n}`;
    if (g.type === 'item') return `${ITEMS[g.item].name} ${Math.min(this.count(g.item), g.n)}/${g.n}`;
    if (g.type === 'art') {
      const best = Math.max(...(['fist', 'sword', 'saber', 'spear', 'bow'] as const).map((k) => this.kindLv(k)));
      return `攻击武功修为 ${Math.min(best, g.lv).toFixed(2)}/${g.lv.toFixed(2)}`;
    }
    return '';
  }

  save(x: number, z: number, hour: number): PlayerSave {
    return {
      v: 1, age: this.age, ageT: this.ageT, hp: this.hp, hpMax: this.hpMax, mp: this.mp, mpMax: this.mpMax, sp: this.sp, spMax: this.spMax,
      parts: { ...this.parts }, arts: { ...this.arts }, use: { ...this.use }, weapon: this.weapon, armor: this.armor,
      inv: this.inv.map((i) => ({ ...i })), coins: this.coins, quest: this.quest ? { ...this.quest } : null, questDone: [...this.questDone],
      x, z, hour, kills: this.kills, playT: this.playT, hot: [...this.hot],
    };
  }
  load(s: PlayerSave) {
    Object.assign(this, {
      age: s.age, ageT: s.ageT, hp: s.hp, hpMax: s.hpMax, mp: s.mp, mpMax: s.mpMax, sp: s.sp, spMax: s.spMax,
      parts: s.parts, arts: s.arts, weapon: s.weapon, armor: s.armor, inv: s.inv, coins: s.coins, quest: s.quest,
      questDone: s.questDone, kills: s.kills, playT: s.playT, hot: s.hot ?? this.hot,
    });
    Object.assign(this.use, s.use);
    if (this.weapon && !ITEMS[this.weapon]) this.weapon = null;
    if (this.armor && !ITEMS[this.armor]) this.armor = null;
    this.inv = this.inv.filter((i) => ITEMS[i.id]);
  }
}
