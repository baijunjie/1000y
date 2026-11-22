import { ITEMS } from '../game/data';
import type { Game } from '../game/game';

/** 画在世界之上的 2D 标注：名字、血条、飘字、任务标记 */
export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  constructor(private cv: HTMLCanvasElement, private g: Game) {
    this.ctx = cv.getContext('2d')!;
    this.resize();
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.round(this.cv.clientWidth * this.dpr);
    this.cv.height = Math.round(this.cv.clientHeight * this.dpr);
  }
  private text(s: string, x: number, y: number, color: string, size: number, font = '"PingFang SC","Microsoft YaHei",sans-serif', weight = '500') {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${font}`;
    c.lineWidth = Math.max(2.5, size / 5.5);
    c.strokeStyle = 'rgba(0,0,0,0.82)';
    c.strokeText(s, x, y);
    c.fillStyle = color;
    c.fillText(s, x, y);
  }
  draw() {
    const g = this.g, c = this.ctx, r = g.r;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.cv.clientWidth, this.cv.clientHeight);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    const on = (x: number, y: number) => x > -60 && x < W + 60 && y > -40 && y < H + 60;
    const hoverE = g.hover && (g.hover.type === 'mob' || g.hover.type === 'npc') ? g.hover.e : null;
    const p = g.p, q = p.quest, qd = p.questDef();

    for (const n of g.npcs) {
      const [x, y] = r.worldToScreen(n.x, n.y + 2.0, n.z);
      if (!on(x, y)) continue;
      this.text(n.def.name, x, y, '#ffe9a8', 13.5);
      this.text(n.def.title, x, y - 16, '#b9d8ee', 11);
      let mark = '', col = '#ffe14a';
      if (q && qd) {
        if (!q.active && qd.giver === n.def.id) mark = '!';
        else if (q.active && qd.turnIn === n.def.id) { mark = '?'; col = p.questReady() ? '#ffe14a' : '#9a9a9a'; }
      }
      if (mark) this.text(mark, x, y - 34 + Math.sin(g.time * 3) * 2.5, col, 26, '"Songti SC","STSong",serif', '900');
    }
    for (const m of g.mobs) {
      if (m.dead) continue;
      const show = m === g.target || m === hoverE || m.hpShow > 0;
      if (!show) continue;
      const [x, y] = r.worldToScreen(m.x, m.y + m.height + 0.15, m.z);
      if (!on(x, y)) continue;
      const hostile = m.def.aggro > 0;
      this.text(m.def.name, x, y - 9, m.def.boss ? '#ffd24a' : hostile ? '#ffb0a0' : '#e8e2d0', m.def.boss ? 15 : 13);
      if (!m.def.still) {
        const w = m.def.boss ? 92 : 54, k = Math.max(0, m.hp / m.hpMax);
        c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(x - w / 2 - 1, y - 5, w + 2, 6);
        c.fillStyle = k > 0.5 ? '#d8483a' : k > 0.25 ? '#e08a2a' : '#e8c02a'; c.fillRect(x - w / 2, y - 4, w * k, 4);
      }
    }
    for (const l of g.loots) {
      if (Math.hypot(l.x - g.pe.x, l.z - g.pe.z) > 9 && !(g.hover?.type === 'loot' && g.hover.l === l)) continue;
      const [x, y] = r.worldToScreen(l.x, 0.75, l.z);
      if (!on(x, y)) continue;
      const first = l.items[0];
      const name = first ? ITEMS[first[0]].name + (l.items.length > 1 ? ' 等' : '') : `${l.coins} 文`;
      const rare = l.items.some(([id]) => ITEMS[id].type === 'book' || ITEMS[id].price >= 300);
      this.text(name, x, y, rare ? '#e9a8ff' : '#f3dfa6', 12);
    }
    if (g.hover?.type === 'gather') {
      const n = g.hover.n, [x, y] = r.worldToScreen(n.x, 0.9, n.z);
      this.text('草药（点击采集）', x, y, '#b8f09a', 12);
    }
    for (const t of g.texts) {
      const [x, y] = r.worldToScreen(t.x, t.y, t.z);
      if (!on(x, y)) continue;
      const a = t.t < 0.9 ? 1 : Math.max(0, 1 - (t.t - 0.9) / 0.35);
      const pop = t.t < 0.12 ? 0.6 + (t.t / 0.12) * 0.6 : t.t < 0.2 ? 1.2 - ((t.t - 0.12) / 0.08) * 0.2 : 1;
      c.globalAlpha = a;
      this.text(t.text, x, y, t.color, t.size * pop, '"Songti SC","STSong","PingFang SC",serif', '900');
      c.globalAlpha = 1;
    }
  }
}
