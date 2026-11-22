// 校验地图可玩性：NPC/刷怪点没有被压在障碍里，出生点到各关键位置都走得通。
// 物件的碰撞信息来自建模代码（运行时才有），所以这里在无头 Chrome 里把游戏真跑起来，直接拿它压好的碰撞网格来查。
// 用法：node tools/map/check-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/MyApp/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

const server = await createServer({ root: ROOT, logLevel: 'warn', server: { port: 5189, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let result;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${server.resolvedUrls.local[0]}?nosave=1&autostart=1&scale=0.25`);
  await page.waitForFunction('window.__ready === true || !!window.__error', null, { timeout: 120000 });
  const err = await page.evaluate('window.__error');
  if (err) throw new Error(err);
  result = await page.evaluate(() => {
    const g = window.game, map = g.map, w = g.world;
    const { gw, gh, cell, grid } = w;
    const out = [];
    let bad = 0;
    const fail = (msg) => { bad++; out.push('✗ ' + msg); };
    const known = new Set(w.placements.map((p) => p.key));
    const missing = map.objects.filter((o) => !known.has(o.k)).length;
    if (missing) fail(`${missing} 个物件引用了不存在的模型`);
    // 从出生点洪泛
    const seen = new Uint8Array(gw * gh);
    const q = [Math.floor(map.spawn.z / cell) * gw + Math.floor(map.spawn.x / cell)];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop(), ci = c % gw, cj = (c / gw) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const n = nj * gw + ni;
        if (seen[n] || grid[n]) continue;
        seen[n] = 1; q.push(n);
      }
    }
    const reach = (x, z, r = 2.5) => {
      for (let dz = -r; dz <= r; dz += cell) for (let dx = -r; dx <= r; dx += cell) {
        const i = Math.floor((x + dx) / cell), j = Math.floor((z + dz) / cell);
        if (i >= 0 && j >= 0 && i < gw && j < gh && seen[j * gw + i]) return true;
      }
      return false;
    };
    if (w.blocked(map.spawn.x, map.spawn.z)) fail('出生点被挡住');
    for (const n of map.npcs) {
      if (w.blocked(n.x, n.z)) out.push(`· NPC ${n.id} 站在障碍格上（可对话，但建议挪开）`);
      if (!reach(n.x, n.z)) fail(`走不到 NPC ${n.id}`);
    }
    for (const s of map.spawns) if (!reach(s.x, s.z, Math.max(2.5, s.r))) fail(`走不到刷怪点 ${s.mob} (${s.x}, ${s.z})`);
    for (const p of map.gather) if (!reach(p.x, p.z, 1.5)) fail(`走不到采集点 (${p.x}, ${p.z})`);
    for (const [name, x, z] of [['桥东', 160, 104], ['寨门外', 76, 40], ['寨内', 75, 24], ['虎啸崖', 186, 22], ['小庙', 185, 132], ['草甸', 34, 56]]) if (!reach(x, z)) fail(`走不到 ${name}`);
    const free = seen.reduce((s, v) => s + v, 0);
    out.push(bad ? `发现 ${bad} 个问题` : `地图校验通过：可达格 ${free} / ${gw * gh}`);
    return { bad, out };
  });
} finally {
  await browser.close();
  await server.close();
}
for (const l of result.out) console.log(l);
process.exit(result.bad ? 1 : 0);
