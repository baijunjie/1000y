import { Actors } from './engine/actors';
import { Audio } from './engine/audio';
import { buildGround } from './engine/ground';
import { Renderer } from './engine/renderer';
import { Statics } from './engine/statics';
import { Game } from './game/game';
import { MapData, World } from './game/world';
import { loadPbr } from './models/geo';
import { STATIC_MAKERS } from './models/registry';
import { Overlay } from './ui/overlay';
import './ui/style.css';
import { UI } from './ui/ui';

const $ = (id: string) => document.getElementById(id)!;
const q = new URLSearchParams(location.search);
const nextFrame = () => new Promise<void>((res) => setTimeout(res, 0));

async function boot() {
  const canvas = $('game') as HTMLCanvasElement;
  const fill = $('boot-fill'), tip = $('boot-tip');
  if (q.has('nosave')) Game.clearSave();
  const r = new Renderer(canvas, {
    samples: q.has('msaa') ? +q.get('msaa')! : undefined,
    shadowLights: q.has('sl') ? +q.get('sl')! : undefined, plainLights: q.has('pl') ? +q.get('pl')! : undefined,
  });
  if (q.has('scale')) r.scale = +q.get('scale')!;
  const progress = (k: number, label: string) => { fill.style.width = `${k * 100}%`; tip.textContent = label; };

  const map: MapData = await (await fetch(import.meta.env.BASE_URL + 'assets/map/world.json')).json();
  progress(0.05, '展开舆图……');

  await loadPbr();
  progress(0.1, '研墨调色……');

  // 每种物件建模一次（程序化生成，没有模型文件），之后全部走实例化渲染
  const statics = new Statics(r);
  const infos: Record<string, Record<string, any>> = {};
  const keys = [...new Set([...map.objects.map((o) => o.k), ...map.gather.map((g) => g.k)])];
  for (let i = 0; i < keys.length; i++) {
    const mk = STATIC_MAKERS[keys[i]];
    if (!mk) continue;
    const m = mk();
    infos[keys[i]] = m.info;
    statics.addKind(keys[i], m.root, m.info);
    if (i % 3 === 0) { progress(0.1 + 0.55 * (i / keys.length), '描摹山川草木……'); await nextFrame(); }
  }
  const world = new World(map, infos);
  statics.place(world.placements);
  progress(0.7, '铺陈大地……');
  await buildGround(r, 'world', map.w, map.h);
  progress(0.9, '点起灯火……');
  const actors = new Actors(r);
  const game = new Game(r, world, statics, actors, map);
  await game.init();
  progress(1, '万事俱备');

  const ui = new UI(game);
  $('ui').style.visibility = 'hidden';
  const overlay = new Overlay($('overlay') as HTMLCanvasElement, game);
  const audio = new Audio();
  game.onSfx = (n, v) => audio.sfx(n, v);
  ui.onVolume = (v) => audio.setVolume(v);
  (window as any).game = game;

  if (q.has('x') && q.has('z')) { game.pe.x = +q.get('x')!; game.pe.z = +q.get('z')!; r.focus.set(game.pe.x, 0.9, game.pe.z); }
  if (q.has('hour')) game.hour = +q.get('hour')!;
  if (q.has('zoom')) { game.zoom = +q.get('zoom')!; r.zoom = game.zoom; }

  // ---------- 输入 ----------
  const pos = (e: MouseEvent) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] as const; };
  canvas.addEventListener('mousedown', (e) => {
    audio.start();
    const [x, y] = pos(e);
    game.mouse.x = x; game.mouse.y = y;
    if (ui.blocking) { ui.closeDialog(); return; }
    if (e.button === 0) { game.mouse.down = true; game.click(x, y); }
    else if (e.button === 2) game.useMove();
  });
  window.addEventListener('mouseup', () => { game.mouse.down = false; });
  canvas.addEventListener('mousemove', (e) => {
    const [x, y] = pos(e);
    game.mouse.x = x; game.mouse.y = y; game.mouse.inside = true;
  });
  canvas.addEventListener('mouseleave', () => { game.mouse.inside = false; game.hover = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    game.zoom = Math.min(2.2, Math.max(0.6, game.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'tab') { e.preventDefault(); game.selectNearest(); return; }
    if (k === ' ') { e.preventDefault(); game.useMove(); return; }
    if (k === 'z') { game.toggleSit(); return; }
    if (ui.key(k)) e.preventDefault();
  });
  window.addEventListener('resize', () => { r.resize(); overlay.resize(); });
  window.addEventListener('beforeunload', () => { if (!game.paused) game.save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });

  // ---------- 主循环 ----------
  let last = performance.now(), started = false, hoverT = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    r.resize();
    if (started) {
      game.update(dt);
      hoverT -= dt;
      if (hoverT <= 0 && game.mouse.inside) {
        hoverT = 0.06;
        game.hover = game.pick(game.mouse.x, game.mouse.y);
        canvas.style.cursor = game.hover ? 'pointer' : 'default';
      }
      ui.tick(dt);
      const px = game.pe.x, pz = game.pe.z;
      let water = 0;
      for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [9, 0], [-9, 0]]) {
        if (world.blocked(px + dx, pz + dz) && px + dx > 3 && pz + dz > 3 && px + dx < map.w - 3 && pz + dz < map.h - 3 && world.elevation(px + dx, pz + dz) === 0 && Math.abs(px + dx - 152) < 16) water += 0.2;
      }
      const fighting = game.mobs.some((m) => !m.dead && m.target === game.pe && (m.state === 'chase' || m.state === 'attack'));
      audio.update(dt, game.zoneMood(), game.env.night, Math.min(1, water), fighting);
    } else {
      // 标题画面：镜头在村子上空缓缓游移
      game.time += dt;
      game.hour = (game.hour + dt / 38) % 24;
    }
    game.submit();
    r.render(game.env, dt);
    if (started) overlay.draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const start = () => {
    if (started) return;
    started = true;
    $('ui').style.visibility = '';
    audio.start();
    $('boot').classList.add('hide');
    setTimeout(() => ($('boot').style.display = 'none'), 1000);
    ui.showArea(game.zone);
    if (!Game.hasSave()) {
      ui.log('你背着一柄木剑，来到栖云山下的落霞村。', 'sys');
      ui.log('这里没有等级：武功要靠一招一式练出来。', 'sys');
      ui.log('村长顾怀山（广场上，头顶有「!」）似乎有话要说。', 'quest');
    } else ui.log('旧地重游，江湖依旧。', 'sys');
  };
  tip.textContent = '';
  ($('boot-fill').parentElement as HTMLElement).style.visibility = 'hidden';
  $('boot').classList.add('ready');
  $('boot-actions').hidden = false;
  $('boot-help').hidden = false;
  const cont = $('btn-continue'), fresh = $('btn-new');
  if (Game.hasSave()) { cont.hidden = false; fresh.textContent = '重新开始'; }
  cont.onclick = start;
  fresh.onclick = () => {
    if (Game.hasSave()) { Game.clearSave(); game.paused = true; location.href = location.pathname + '?fresh=1'; return; }
    start();
  };
  if (q.has('autostart') || q.has('fresh')) start();
  (window as any).__readyAt = performance.now();
  (window as any).__ready = true;
}

boot().catch((e) => {
  console.error(e);
  $('boot-tip').textContent = '加载失败：' + (e?.message ?? e);
  (window as any).__error = String(e?.stack ?? e);
});
