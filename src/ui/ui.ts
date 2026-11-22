import { ArtKind, ARTS, ITEMS, KIND_ICON, KIND_NAME, NPCS, QUESTS } from '../game/data';
import type { Npc } from '../game/entity';
import { hourName } from '../game/fx';
import type { Game } from '../game/game';
import { INV_SIZE } from '../game/player';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const KIND_COLOR: Record<ArtKind, string> = {
  fist: '#b0703a', sword: '#3f8fb8', saber: '#b8483a', spear: '#5a9a5a', bow: '#8a6fb8', step: '#3a9a8a', heart: '#4a6fc0', guard: '#a8883a',
};
const TYPE_NAME: Record<string, string> = { weapon: '兵器', armor: '护具', use: '消耗品', mat: '材料', book: '秘籍' };
const WEAPON_NAME: Record<string, string> = { fist: '拳套', sword: '剑', saber: '刀', spear: '枪', bow: '弓' };

const icon = (ch: string, color: string, extra = '', cls = '') => `<div class="icon ${cls}" style="--c:${color}">${ch}${extra}</div>`;
const itemIcon = (id: string, n = 0, cls = '', key = '') => {
  const it = ITEMS[id];
  return `<div class="icon ${cls}" style="--c:${it.color}" data-item="${id}">${it.icon}${n > 1 ? `<span class="n">${n}</span>` : ''}${key ? `<span class="k">${key}</span>` : ''}</div>`;
};

export class UI {
  root = $('#ui');
  private open = new Set<string>();
  private dialogNpc: Npc | null = null;
  private shopNpc: Npc | null = null;
  private mini!: HTMLCanvasElement;
  private miniImg = new Image();
  private hoverItem: string | null = null;
  private areaT = 0;
  private refreshT = 0;
  onVolume: (v: number) => void = () => {};
  volume = 0.6;

  constructor(private g: Game) {
    this.root.innerHTML = `
      <div class="panel" id="status">
        <div class="row1"><div class="face">侠</div><div><div class="nm">少侠</div><div class="sub" id="st-sub"></div></div></div>
        <div class="bar hp"><b>气血</b><i id="b-hp"></i><span id="t-hp"></span></div>
        <div class="bar mp"><b>内力</b><i id="b-mp"></i><span id="t-mp"></span></div>
        <div class="bar sp"><b>体力</b><i id="b-sp"></i><span id="t-sp"></span></div>
        <div class="parts" id="st-parts"></div>
      </div>
      <div class="panel" id="target" hidden><div class="nm" id="tg-nm"></div><div class="bar hp"><i id="tg-hp"></i><span id="tg-t"></span></div></div>
      <div class="panel" id="mini"><canvas width="360" height="300"></canvas><div class="info"><span class="zone" id="mn-zone"></span><span class="dim" id="mn-time"></span></div></div>
      <div class="panel" id="tracker"></div>
      <div id="log"></div>
      <div class="panel" id="hotbar"></div>
      <div id="menu">
        <div class="mb" data-win="char">人<small>C</small></div><div class="mb" data-win="arts">武<small>K</small></div>
        <div class="mb" data-win="bag">囊<small>B</small></div><div class="mb" data-win="quest">事<small>L</small></div>
        <div class="mb" data-win="map">图<small>M</small></div><div class="mb" data-win="sys">设<small>Esc</small></div>
      </div>
      <div class="panel win" id="win-char" hidden></div>
      <div class="panel win" id="win-arts" hidden></div>
      <div class="panel win" id="win-bag" hidden></div>
      <div class="panel win" id="win-quest" hidden></div>
      <div class="panel win" id="win-map" hidden></div>
      <div class="panel win" id="win-sys" hidden></div>
      <div class="panel" id="shop" hidden></div>
      <div class="panel" id="dialog" hidden></div>
      <div id="area"></div>
      <div id="death" hidden><div class="big">胜败兵家常事</div><div class="btn" id="btn-respawn">回落霞村疗伤</div></div>
      <div id="tip" hidden></div>`;
    this.mini = $('#mini canvas');
    this.miniImg.src = import.meta.env.BASE_URL + 'assets/map/world.mini.png';

    g.onLog = (m, c) => this.log(m, c);
    g.onChange = (w) => this.refresh(w);
    g.onDialog = (n) => this.showDialog(n);
    g.onArea = (n) => this.showArea(n);
    g.onDeath = () => { $('#death').hidden = false; };

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onRightClick(e); });
    this.root.addEventListener('mousemove', (e) => this.onHover(e));
    this.root.addEventListener('mouseleave', () => this.hideTip());
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.refresh('all');
  }

  // ------------------------------------------------------------ 事件
  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const g = this.g, p = g.p;
    const mb = t.closest<HTMLElement>('[data-win]');
    if (mb) { this.toggle(mb.dataset.win!); return; }
    const x = t.closest<HTMLElement>('[data-close]');
    if (x) { this.close(x.dataset.close!); return; }
    const act = t.closest<HTMLElement>('[data-act]');
    if (act) {
      const a = act.dataset.act!, v = act.dataset.v ?? '';
      if (a === 'art') g.setArt(v);
      else if (a === 'unequip') g.unequip(v as any);
      else if (a === 'buy') { if (g.buy(v)) this.log(`买下了${ITEMS[v].name}。`, 'loot'); this.renderShop(); }
      else if (a === 'accept') { g.acceptQuest(); this.closeDialog(); }
      else if (a === 'complete') { g.completeQuest(); if (this.dialogNpc) this.showDialog(this.dialogNpc); }
      else if (a === 'shop') this.openShop(this.dialogNpc!);
      else if (a === 'rest') { g.rest(+v); this.closeDialog(); }
      else if (a === 'bye') this.closeDialog();
      else if (a === 'move') g.useMove();
      else if (a === 'hot') { const id = p.hot[+v]; if (id) g.useItem(id); }
      else if (a === 'vol') { this.volume = +v; this.onVolume(this.volume); this.renderSys(); }
      else if (a === 'newgame') { if (confirm('确定要抛下现在的一切，重新开始吗？')) { (g.constructor as any).clearSave(); g.paused = true; location.reload(); } }
      else if (a === 'savenow') { g.save(); this.log('进度已保存。', 'sys'); }
      return;
    }
    const it = t.closest<HTMLElement>('[data-item]');
    if (it && it.closest('#win-bag')) {
      const id = it.dataset.item!;
      if (this.shopNpc) { g.sell(id); this.renderShop(); } else g.useItem(id);
      this.hideTip();
      return;
    }
    if (t.id === 'btn-respawn') { $('#death').hidden = true; g.respawn(); }
    if (t.closest('#mini')) this.toggle('map');
  }
  private onRightClick(e: MouseEvent) {
    const it = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
    if (it && it.closest('#win-bag') && ITEMS[it.dataset.item!].type === 'use') {
      // 右键把消耗品放进第一个空快捷栏（或轮换）
      const id = it.dataset.item!, hot = this.g.p.hot;
      if (hot.includes(id)) return;
      let i = hot.indexOf(null);
      if (i < 0) i = 3;
      hot[i] = id;
      this.renderHotbar();
      this.log(`已将${ITEMS[id].name}放入快捷栏 ${i + 1}。`, 'sys');
    }
  }
  private onHover(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const it = t.closest<HTMLElement>('[data-item]'), tp = t.closest<HTMLElement>('[data-tip]');
    this.hoverItem = it?.dataset.item ?? null;
    if (it) this.showTip(this.itemTip(it.dataset.item!, !!it.closest('#win-bag'), !!it.closest('#shop')), e);
    else if (tp) this.showTip(tp.dataset.tip!, e);
    else this.hideTip();
  }
  private itemTip(id: string, inBag: boolean, inShop: boolean): string {
    const it = ITEMS[id], p = this.g.p;
    let s = `<div class="tt">${it.name}</div><div class="ty">${TYPE_NAME[it.type]}${it.weapon ? ' · ' + WEAPON_NAME[it.weapon] : ''}</div>`;
    if (it.atk) s += `<div class="st">攻击 +${it.atk}${p.weapon && inBag ? `（当前 +${ITEMS[p.weapon].atk ?? 0}）` : ''}</div>`;
    if (it.def) s += `<div class="st">防御 +${it.def}${p.armor && inBag ? `（当前 +${ITEMS[p.armor].def ?? 0}）` : ''}</div>`;
    s += `<div>${it.desc}</div>`;
    if (inShop) s += `<div class="hint">售价 ${it.price} 文</div>`;
    else if (inBag) {
      const verb = it.type === 'weapon' || it.type === 'armor' ? '装备' : it.type === 'use' ? '使用' : it.type === 'book' ? '研读' : '';
      s += `<div class="hint">${this.shopNpc ? `左键出售（${Math.max(1, Math.floor(it.price * 0.4))} 文）` : verb ? '左键' + verb : '可卖给商人'}${it.type === 'use' && !this.shopNpc ? ' · 右键放入快捷栏' : ''}</div>`;
    }
    return s;
  }
  private showTip(html: string, e: MouseEvent) {
    const tip = $('#tip');
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 16) + 'px';
    tip.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, e.clientY - r.height - 10)) + 'px';
  }
  private hideTip() { $('#tip').hidden = true; this.hoverItem = null; }

  /** 返回 true 表示按键已被界面消费 */
  key(k: string): boolean {
    const map: Record<string, string> = { c: 'char', k: 'arts', b: 'bag', l: 'quest', m: 'map' };
    if (map[k]) { this.toggle(map[k]); return true; }
    if (k === 'escape') {
      if (this.dialogNpc || this.shopNpc) { this.closeDialog(); return true; }
      if (this.open.size) { for (const w of [...this.open]) this.close(w); return true; }
      this.toggle('sys');
      return true;
    }
    if (/^[1-4]$/.test(k)) {
      if (this.hoverItem && ITEMS[this.hoverItem].type === 'use' && this.open.has('bag')) { this.g.p.hot[+k - 1] = this.hoverItem; this.renderHotbar(); }
      else { const id = this.g.p.hot[+k - 1]; if (id) this.g.useItem(id); }
      return true;
    }
    return false;
  }

  toggle(w: string) { this.open.has(w) ? this.close(w) : this.show(w); }
  show(w: string) {
    if (w === 'char' && this.open.has('arts')) this.close('arts');
    if (w === 'arts' && this.open.has('char')) this.close('char');
    this.open.add(w);
    $('#win-' + w).hidden = false;
    document.querySelector(`.mb[data-win="${w}"]`)?.classList.add('on');
    this.renderWin(w);
  }
  close(w: string) {
    this.open.delete(w);
    $('#win-' + w).hidden = true;
    document.querySelector(`.mb[data-win="${w}"]`)?.classList.remove('on');
    this.hideTip();
  }
  get blocking() { return !!this.dialogNpc || !!this.shopNpc; }

  // ------------------------------------------------------------ 刷新
  refresh(what: string) {
    this.renderStatus();
    if (what === 'all' || what === 'quest') this.renderTracker();
    if (what === 'all' || what === 'inv' || what === 'arts' || what === 'equip') this.renderHotbar();
    for (const w of this.open) {
      if (what === 'stats' && (w === 'bag' || w === 'quest' || w === 'map' || w === 'sys' || w === 'arts')) continue;
      this.renderWin(w);
    }
    if (this.shopNpc && (what === 'inv' || what === 'all')) this.renderShop();
  }
  private renderWin(w: string) {
    if (w === 'char') this.renderChar();
    else if (w === 'arts') this.renderArts();
    else if (w === 'bag') this.renderBag();
    else if (w === 'quest') this.renderQuest();
    else if (w === 'map') this.renderMap();
    else if (w === 'sys') this.renderSys();
  }
  private head(title: string, id: string) { return `<div class="panel-head"><span>${title}</span><span class="x" data-close="${id}">×</span></div>`; }

  private renderStatus() {
    const p = this.g.p;
    const set = (id: string, v: number, max: number) => {
      $('#b-' + id).style.width = Math.max(0, Math.min(100, (v / max) * 100)) + '%';
      $('#t-' + id).textContent = `${Math.max(0, Math.floor(v))} / ${Math.floor(max)}`;
    };
    set('hp', p.hp, p.hpMax); set('mp', p.mp, p.mpMax); set('sp', p.sp, p.spMax);
    $('#st-sub').textContent = `${p.age} 岁 · ${p.coins} 文`;
    const pt = (n: string, v: number) => `${n} <em class="${v < 40 ? 'bad' : ''}">${v >= 80 ? '无恙' : v >= 40 ? '轻伤' : '重伤'}</em>`;
    $('#st-parts').innerHTML = `${pt('头', p.parts.head)}${pt('臂', p.parts.arm)}${pt('腿', p.parts.leg)}`;
  }

  private renderTracker() {
    const p = this.g.p, q = p.quest, d = p.questDef(), el = $('#tracker');
    if (!q || !d) { el.innerHTML = `<div class="t">江湖路远</div><div class="d dim">主线委托已全部完成。四处走走，继续修炼吧。</div>`; return; }
    if (!q.active) { el.innerHTML = `<div class="t">新的委托</div><div class="d">去找 <span class="gold">${NPCS[d.giver].name}</span>（${NPCS[d.giver].title}）谈谈。</div>`; return; }
    const ready = p.questReady();
    el.innerHTML = `<div class="t">${d.name}</div><div class="d">${d.desc}</div>` +
      (ready ? `<div class="p">已达成 · 找${NPCS[d.turnIn].name}复命</div>` : `<div class="p">${p.questProgress()}</div>`);
  }

  private renderHotbar() {
    const g = this.g, p = g.p, a = p.art, lv = p.artLv, mv = a.move;
    const unlocked = !!mv && lv >= mv.unlock;
    const slots = p.hot.map((id, i) => id && ITEMS[id]
      ? `<div class="slot ${p.count(id) ? '' : 'empty'}" data-act="hot" data-v="${i}">${itemIcon(id, p.count(id), '', String(i + 1))}</div>`
      : `<div class="slot empty">${icon('', '#2a2520', `<span class="k">${i + 1}</span>`)}</div>`).join('');
    $('#hotbar').innerHTML = `
      <div class="art" data-win="arts" data-tip="<div class='tt'>${a.name}</div><div class='ty'>${KIND_NAME[a.kind]} · 当前运用</div><div>${a.desc}</div><div class='hint'>修为靠实战一点点磨出来：对手越强，长进越快。</div>">
        ${icon(KIND_ICON[a.kind], KIND_COLOR[a.kind])}
        <div><div><span class="nm">${a.name}</span><span class="lv" id="hb-lv">${lv.toFixed(2)}</span></div><div class="xp"><i id="hb-xp" style="width:${(lv % 1) * 100}%"></i></div></div>
      </div>
      <div class="sep"></div>
      <div class="slots">
        <div class="slot move ${unlocked ? '' : 'locked'}" data-act="move" data-tip="<div class='tt'>${mv?.name ?? ''}</div><div class='ty'>绝招 · 空格 / 右键</div><div>${mv?.desc ?? ''}</div><div class='st'>消耗内力 ${mv?.inner ?? 0} · 调息 ${mv?.cd ?? 0} 秒</div>${unlocked ? '' : `<div class='hint'>「${a.name}」修为达到 ${mv?.unlock}.00 后领悟</div>`}">
          <div class="icon" style="--c:${unlocked ? '#7a4bb0' : '#3a3530'}">${mv ? mv.name[0] : ''}<span class="k">空格</span><div class="cd" id="hb-cd" hidden></div></div>
        </div>
        ${slots}
      </div>`;
  }

  private renderChar() {
    const p = this.g.p;
    const eq = (slot: 'weapon' | 'armor', label: string) => {
      const id = p[slot];
      return `<div class="eq" ${id ? `data-act="unequip" data-v="${slot}"` : ''}>${id ? itemIcon(id) : icon(label[0], '#2a2520', '', 'none')}<div><div>${id ? ITEMS[id].name : '未装备'}</div><div class="dim" style="font-size:11.5px">${label}${id ? ' · 点击卸下' : ''}</div></div></div>`;
    };
    const kv = (k: string, v: string) => `<div><span>${k}</span><span>${v}</span></div>`;
    $('#win-char').innerHTML = this.head('人物', 'char') + `<div class="panel-body">
      <div class="equip">${eq('weapon', '兵器')}${eq('armor', '护具')}</div>
      <div class="kv">
        ${kv('年岁', p.age + ' 岁')}${kv('银钱', p.coins + ' 文')}
        ${kv('气血上限', p.hpMax.toFixed(0))}${kv('内力上限', p.mpMax.toFixed(0))}
        ${kv('体力上限', p.spMax.toFixed(0))}${kv('斩敌', String(p.kills))}
        ${kv('攻击', p.power.toFixed(1))}${kv('出手间隔', p.interval.toFixed(2) + ' 秒')}
        ${kv('命中', p.acc.toFixed(1))}${kv('闪避', p.evade.toFixed(1))}
        ${kv('防御', String(p.def))}${kv('护体化劲', (p.guardRate * 100).toFixed(0) + '%')}
        ${kv('身法', p.moveSpeed.toFixed(2) + ' 米/秒')}${kv('攻击距离', p.reach.toFixed(1) + ' 米')}
      </div>
      <h4>成长之道</h4>
      <div class="dim" style="line-height:1.75;font-size:12px">
        这里没有等级。每门武功各有修为（0.00–99.99），用它出手、命中，才会精进；对手越强，长进越快，欺负弱小几乎不长功夫。<br />
        气血上限在受伤与杀敌中增长，内力上限靠打坐，体力上限靠出手；年岁渐长，根基自厚。
      </div></div>`;
  }

  private renderArts() {
    const p = this.g.p;
    const kinds: ArtKind[] = ['fist', 'sword', 'saber', 'spear', 'bow', 'step', 'heart', 'guard'];
    let html = '';
    for (const k of kinds) {
      const list = Object.values(ARTS).filter((a) => a.kind === k && p.arts[a.id] !== undefined);
      if (!list.length) continue;
      html += `<h4>${KIND_NAME[k]}</h4>`;
      for (const a of list) {
        const lv = p.lv(a.id), on = p.use[k] === a.id;
        const mv = a.move ? ` · 绝招「${a.move.name}」${lv >= a.move.unlock ? '' : `（${a.move.unlock}.00 领悟）`}` : '';
        html += `<div class="art-row ${on ? 'on' : ''}">${icon(KIND_ICON[k], KIND_COLOR[k], '', 'sm')}
          <div class="mid"><div class="nm">${a.name}<small>${a.tier === 2 ? '上乘' : '入门'}${on ? ' · 运用中' : ''}</small></div>
          <div class="xp"><i style="width:${(lv % 1) * 100}%"></i></div><div class="ds" data-tip="${a.desc}${mv}">${a.desc}${mv}</div></div>
          <div class="lv">${lv.toFixed(2)}</div>${on ? '' : `<span class="btn small" data-act="art" data-v="${a.id}">运用</span>`}</div>`;
      }
    }
    $('#win-arts').innerHTML = this.head('武功', 'arts') + `<div class="panel-body"><div class="arts-scroll">${html}</div>
      <div class="dim" style="margin-top:10px;font-size:12px;line-height:1.7">攻击武功随手中兵器切换；步法在奔行与闪避中精进，心法靠打坐（Z），护体功在挨打时磨炼。上乘武功需研读秘籍习得。</div></div>`;
  }

  private renderBag() {
    const p = this.g.p;
    let cells = '';
    for (let i = 0; i < INV_SIZE; i++) {
      const it = p.inv[i];
      cells += `<div class="cell">${it ? itemIcon(it.id, it.n) : ''}</div>`;
    }
    $('#win-bag').innerHTML = this.head('行囊', 'bag') + `<div class="panel-body"><div class="grid">${cells}</div>
      <div class="bag-foot"><span>${this.shopNpc ? '点击物品出售' : '左键使用 / 装备'}</span><span class="gold">${p.coins} 文</span></div></div>`;
  }

  private renderQuest() {
    const p = this.g.p, q = p.quest, d = p.questDef();
    let cur = '<div class="dim">眼下没有委托。</div>';
    if (q && d) {
      cur = q.active
        ? `<div class="gold" style="font-family:var(--serif);font-size:16px;letter-spacing:2px">${d.name}</div><div style="margin:6px 0;line-height:1.7">${d.desc}</div><div style="color:#9fe0a8">${p.questReady() ? '已达成，找' + NPCS[d.turnIn].name + '复命' : p.questProgress()}</div>`
        : `<div>去找 <span class="gold">${NPCS[d.giver].name}</span>（${NPCS[d.giver].title}）接取新的委托。</div>`;
    }
    const done = p.questDone.map((id) => `<span class="dim">${QUESTS[id]?.name ?? id}</span>`).join('　');
    $('#win-quest').innerHTML = this.head('江湖事', 'quest') + `<div class="panel-body">${cur}<h4>已了结</h4><div style="line-height:1.9">${done || '<span class="dim">尚无</span>'}</div></div>`;
  }

  private renderSys() {
    const vols = [0, 0.3, 0.6, 1].map((v) => `<span class="btn small" data-act="vol" data-v="${v}" style="${Math.abs(this.volume - v) < 0.01 ? 'border-color:var(--gold);color:#fff' : ''}">${v === 0 ? '静音' : Math.round(v * 100) + '%'}</span>`).join(' ');
    $('#win-sys').innerHTML = this.head('设置', 'sys') + `<div class="panel-body">
      <div style="margin-bottom:12px">音量　${vols}</div>
      <div style="display:flex;gap:8px"><span class="btn" data-act="savenow">保存进度</span><span class="btn" data-act="newgame">重新开始</span></div>
      <h4>操作</h4><div class="dim" style="line-height:1.8;font-size:12px">左键：移动 / 攻击 / 对话 / 拾取 / 采集（可按住持续移动）<br />空格 / 右键：绝招　Z：打坐　Tab：选最近的敌人<br />C 人物　K 武功　B 行囊　L 任务　M 地图<br />1–4：快捷物品（行囊里指着消耗品按数字可指定）<br />滚轮：缩放镜头</div></div>`;
  }

  private renderMap() {
    const el = $('#win-map');
    if (!el.querySelector('canvas')) el.innerHTML = this.head('舆图', 'map') + `<div class="panel-body"><canvas width="1628" height="1302"></canvas></div>`;
    this.drawMap($('canvas', el) as HTMLCanvasElement, false);
  }

  private drawMap(cv: HTMLCanvasElement, mini: boolean) {
    const g = this.g, c = cv.getContext('2d')!, W = cv.width, H = cv.height, map = g.map;
    c.fillStyle = '#1a1612'; c.fillRect(0, 0, W, H);
    if (!this.miniImg.complete || !this.miniImg.naturalWidth) return;
    const view = mini ? 62 : map.w;         // 可见宽度（米）
    const s = W / view;
    const cx = mini ? Math.min(map.w - view / 2, Math.max(view / 2, g.pe.x)) : map.w / 2;
    const vh = H / s;
    const cz = mini ? Math.min(map.h - vh / 2, Math.max(vh / 2, g.pe.z)) : map.h / 2;
    const tx = (x: number) => (x - cx) * s + W / 2, tz = (z: number) => (z - cz) * s + H / 2;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.miniImg, tx(0), tz(0), map.w * s, map.h * s);
    const dot = (x: number, z: number, r: number, col: string, stroke = '#000') => {
      c.beginPath(); c.arc(tx(x), tz(z), r, 0, Math.PI * 2); c.fillStyle = col; c.fill(); c.lineWidth = 1.5; c.strokeStyle = stroke; c.stroke();
    };
    if (!mini) {
      c.font = `${26}px "Kaiti SC","STKaiti",serif`; c.textAlign = 'center';
      for (const z of map.zones) {
        const x = tx((z.x0 + z.x1) / 2), y = tz((z.z0 + z.z1) / 2);
        c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.strokeText(z.name, x, y);
        c.fillStyle = z.mood === 'danger' ? '#ffb39a' : '#fff0c8'; c.fillText(z.name, x, y);
      }
    }
    for (const m of g.mobs) if (!m.dead && !m.def.still && (!mini || Math.abs(m.x - cx) < view / 2)) {
      if (mini || m.def.boss) dot(m.x, m.z, m.def.boss ? 6 : 3.2, m.def.aggro > 0 ? '#e0483a' : '#d8cfa8');
    }
    const qd = g.p.questDef(), q = g.p.quest;
    for (const n of g.npcs) {
      const mark = q && qd && ((!q.active && qd.giver === n.def.id) || (q.active && qd.turnIn === n.def.id));
      dot(n.x, n.z, mark ? 7 : 4.5, mark ? '#ffe14a' : '#7fd0ff');
      if (!mini) {
        c.font = '19px "PingFang SC",sans-serif'; c.textAlign = 'center';
        c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(n.def.title, tx(n.x), tz(n.z) - 11);
        c.fillStyle = '#d8ecff'; c.fillText(n.def.title, tx(n.x), tz(n.z) - 11);
      }
    }
    // 玩家朝向箭头
    const a = g.pe.faceAngle, px = tx(g.pe.x), pz = tz(g.pe.z), r = mini ? 9 : 12;
    c.save(); c.translate(px, pz); c.rotate(-a);
    c.beginPath(); c.moveTo(0, r); c.lineTo(r * 0.62, -r * 0.7); c.lineTo(0, -r * 0.3); c.lineTo(-r * 0.62, -r * 0.7); c.closePath();
    c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#000'; c.stroke();
    c.restore();
  }

  // ------------------------------------------------------------ 对话 / 商店
  showDialog(n: Npc) {
    const g = this.g, d = n.def;
    this.dialogNpc = n;
    const el = $('#dialog');
    const turn = g.questTurnIn(d.id), offer = g.questOffer(d.id), pend = g.questPending(d.id);
    let say = d.talk[Math.floor(Math.random() * d.talk.length)], rew = '', opts = '';
    const rewText = (q: typeof turn) => [q!.reward.coins ? q!.reward.coins + ' 文' : '', ...(q!.reward.items ?? []).map(([id, k]) => `${ITEMS[id].name}×${k}`)].filter(Boolean).join('、');
    if (turn) { say = turn.done; rew = '酬谢：' + rewText(turn); opts += `<span class="btn" data-act="complete">交付「${turn.name}」</span>`; }
    else if (offer) { say = offer.start; rew = `委托「${offer.name}」 · 酬谢：${rewText(offer)}`; opts += `<span class="btn" data-act="accept">接下委托</span>`; }
    else if (pend) say = `「${pend.name}」还没办妥呢。${g.p.questProgress()}`;
    if (d.shop) opts += `<span class="btn" data-act="shop">看看货物</span>`;
    if (d.rest) opts += `<span class="btn" data-act="rest" data-v="${d.rest}">住店歇息（${d.rest} 文）</span>`;
    opts += `<span class="btn" data-act="bye">告辞</span>`;
    el.innerHTML = `<div class="panel-body"><div class="who">${d.name}<small>${d.title}</small></div><div class="say">${say}</div>${rew ? `<div class="rew">${rew}</div>` : ''}<div class="opts">${opts}</div></div>`;
    el.hidden = false;
  }
  closeDialog() {
    this.dialogNpc = null; this.shopNpc = null;
    $('#dialog').hidden = true; $('#shop').hidden = true;
    if (this.open.has('bag')) this.renderBag();
    this.hideTip();
  }
  private openShop(n: Npc) {
    this.shopNpc = n;
    $('#dialog').hidden = true;
    this.renderShop();
    if (!this.open.has('bag')) this.show('bag'); else this.renderBag();
  }
  private renderShop() {
    const n = this.shopNpc;
    if (!n) return;
    const p = this.g.p;
    const rows = (n.def.shop ?? []).map((id) => {
      const it = ITEMS[id];
      return `<div class="shop-row">${itemIcon(id, 0, 'sm')}<div class="mid"><div>${it.name}</div><div class="ds">${it.desc}</div></div><div class="pr">${it.price} 文</div><span class="btn small" data-act="buy" data-v="${id}" ${p.coins < it.price ? 'disabled' : ''}>买</span></div>`;
    }).join('');
    const el = $('#shop');
    el.innerHTML = `<div class="panel-head"><span>${n.def.name}的铺子</span><span class="x" data-act="bye">×</span></div><div class="panel-body"><div class="shop-list">${rows}</div>
      <div class="bag-foot"><span>在行囊里点击物品可出售</span><span class="gold">${p.coins} 文</span></div></div>`;
    el.hidden = false;
    if (this.open.has('bag')) this.renderBag();
  }

  // ------------------------------------------------------------ 消息 / 区域
  log(msg: string, cls = 'sys') {
    const el = $('#log');
    const d = document.createElement('div');
    d.className = cls; d.textContent = msg;
    el.appendChild(d);
    while (el.children.length > 9) el.removeChild(el.firstChild!);
    setTimeout(() => d.classList.add('old'), 7000);
  }
  showArea(name: string) {
    const el = $('#area');
    const mood = this.g.zoneMood();
    el.innerHTML = `${name}<small>${{ town: '炊烟人家', calm: '风和日暖', wild: '山野多险', danger: '杀机四伏' }[mood] ?? ''}</small>`;
    el.classList.add('show');
    this.areaT = 3.2;
    $('#mn-zone').textContent = name;
  }

  /** 每帧调用：轻量的数值刷新 */
  tick(dt: number) {
    const g = this.g, p = g.p;
    if (this.areaT > 0) { this.areaT -= dt; if (this.areaT <= 0) $('#area').classList.remove('show'); }
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.12;
    this.renderStatus();
    const lv = p.artLv;
    const hl = document.getElementById('hb-lv'), hx = document.getElementById('hb-xp'), cd = document.getElementById('hb-cd');
    if (hl) hl.textContent = lv.toFixed(2);
    if (hx) hx.style.width = (lv % 1) * 100 + '%';
    if (cd) { const left = g.moveCdLeft(); cd.hidden = left <= 0; if (left > 0) cd.textContent = left.toFixed(1); }
    const t = g.target, te = $('#target');
    if (t && !t.dead) {
      te.hidden = false;
      const nm = $('#tg-nm');
      nm.textContent = t.def.name; nm.className = 'nm' + (t.def.boss ? ' boss' : '');
      $('#tg-hp').style.width = Math.max(0, (t.hp / t.hpMax) * 100) + '%';
      $('#tg-t').textContent = t.def.still ? '' : `${Math.max(0, Math.ceil(t.hp))} / ${t.hpMax}`;
    } else te.hidden = true;
    const h = g.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    $('#mn-time').textContent = `${hourName(h)} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.drawMap(this.mini, true);
    if (this.open.has('map')) this.renderMap();
    if (this.open.has('char')) this.renderChar();
  }
}
