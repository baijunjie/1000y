import { loadAtlas, loadGround } from './engine/assets';
import { Audio } from './engine/audio';
import type { Atlas } from './engine/renderer';
import { Renderer } from './engine/renderer';
import { Game } from './game/game';
import { MapData, World } from './game/world';
import { Overlay } from './ui/overlay';
import './ui/style.css';
import { UI } from './ui/ui';

/** 进入游戏前必须就绪的图集：场景、NPC、村里的木人桩与鸡 */
const ATLASES = ['env_trees', 'env_trees2', 'env_nature', 'env_build', 'env_build2', 'env_props', 'npcs', 'mob_dummy', 'mob_chicken'];
/** 野外怪物：进入游戏后在后台依次加载（由近及远），加载完即刷出 */
const DEFERRED = ['mob_wolf', 'mob_deer', 'mob_boar', 'mob_bandit', 'mob_bandit_spear', 'mob_bandit_bow', 'mob_tiger', 'mob_boss'];

const $ = (id: string) => document.getElementById(id)!;
const q = new URLSearchParams(location.search);

async function boot() {
  const canvas = $('game') as HTMLCanvasElement;
  const fill = $('boot-fill'), tip = $('boot-tip');
  if (q.has('nosave')) Game.clearSave();
  const r = new Renderer(canvas);
  let done = 0;
  const total = ATLASES.length + 3;
  const step = (label: string) => { done++; fill.style.width = `${(done / total) * 100}%`; tip.textContent = label; };

  const map: MapData = await (await fetch(import.meta.env.BASE_URL + 'assets/map/world.json')).json();
  step('展开舆图……');
  const atlases: Record<string, Atlas> = {};
  await Promise.all(ATLASES.map(async (name) => {
    try { atlases[name] = await loadAtlas(r, name); } catch { /* 可选图集缺失时跳过 */ }
    step('描摹山川草木……');
  }));
  r.ground = await loadGround(r, 'world', map.w, map.h);
  step('铺陈大地……');
  const world = new World(map, atlases);
  const game = new Game(r, world, atlases, map);
  await game.init();
  step('万事俱备');

  (async () => {
    for (const name of DEFERRED) {
      try { atlases[name] = await loadAtlas(r, name); game.spawnMobs(); } catch { /* 缺失的图集跳过 */ }
    }
  })();

  const ui = new UI(game);
  $('ui').style.visibility = 'hidden';
  const overlay = new Overlay($('overlay') as HTMLCanvasElement, game);
  const audio = new Audio();
  game.onSfx = (n, v) => audio.sfx(n, v);
  ui.onVolume = (v) => audio.setVolume(v);
  (window as any).game = game;

  if (q.has('x') && q.has('z')) { game.pe.x = +q.get('x')!; game.pe.z = +q.get('z')!; r.cam.x = game.pe.x; r.cam.y = game.pe.z * Math.SQRT1_2; }
  if (q.has('hour')) game.hour = +q.get('hour')!;
  if (q.has('zoom')) game.zoom = +q.get('zoom')!;

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
    game.zoom = Math.min(1.3, Math.max(0.62, game.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
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
