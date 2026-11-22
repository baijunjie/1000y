// 校验地图可玩性：NPC/刷怪点没有被压在障碍里，出生点到各关键位置都走得通。
// 用法：node tools/map/check-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A = path.join(ROOT, 'public/assets');
const map = JSON.parse(fs.readFileSync(path.join(A, 'map/world.json'), 'utf8'));
const atlases = {};
for (const f of fs.readdirSync(path.join(A, 'atlas'))) if (f.endsWith('.json')) atlases[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(A, 'atlas', f), 'utf8'));

const { gw, gh, cell } = map;
const grid = new Uint8Array(gw * gh);
const bits = Buffer.from(map.grid, 'base64');
for (let i = 0; i < grid.length; i++) grid[i] = (bits[i >> 3] >> (i & 7)) & 1;
const stamp = (x0, z0, x1, z1, v, pad = 0.28) => {
  const i0 = Math.max(0, Math.floor((x0 - pad) / cell)), i1 = Math.min(gw - 1, Math.floor((x1 + pad) / cell));
  const j0 = Math.max(0, Math.floor((z0 - pad) / cell)), j1 = Math.min(gh - 1, Math.floor((z1 + pad) / cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * gw + i] = v;
};
const infoOf = (o) => (atlases[o.a]?.frames[o.k] ? atlases[o.a] : atlases[o.a + '2'])?.info?.[o.k] ?? {};
const clear = [];
let missing = 0;
for (const o of map.objects) {
  const at = atlases[o.a]?.frames[o.k] ? atlases[o.a] : atlases[o.a + '2'];
  if (!at?.frames[o.k]) { missing++; continue; }
  const info = infoOf(o), s = o.s ?? 1, mx = o.f ? -1 : 1;
  for (const r of info.solid ?? []) { const xa = o.x + r[0] * s * mx, xb = o.x + r[2] * s * mx; stamp(Math.min(xa, xb), o.z + r[1] * s, Math.max(xa, xb), o.z + r[3] * s, 1); }
  if (info.deck) clear.push([o, [o.x + info.deck.x0, o.z + info.deck.z0, o.x + info.deck.x1, o.z + info.deck.z1]]);
  if (info.walk) clear.push([null, [o.x + info.walk[0], o.z + info.walk[1], o.x + info.walk[2], o.z + info.walk[3]]]);
}
for (const [, r] of clear) stamp(r[0], r[1], r[2], r[3], 0, 0);
for (const [o] of clear) if (o) for (const r of infoOf(o).solid ?? []) stamp(o.x + r[0], o.z + r[1], o.x + r[2], o.z + r[3], 1, 0);

const blocked = (x, z) => { const i = Math.floor(x / cell), j = Math.floor(z / cell); return i < 0 || j < 0 || i >= gw || j >= gh || grid[j * gw + i] === 1; };
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
let bad = 0;
const fail = (msg) => { bad++; console.log('✗', msg); };
if (missing) fail(`${missing} 个物件引用了不存在的精灵`);
if (blocked(map.spawn.x, map.spawn.z)) fail('出生点被挡住');
for (const n of map.npcs) { if (blocked(n.x, n.z)) console.log('·', `NPC ${n.id} 站在障碍格上（可对话，但建议挪开）`); if (!reach(n.x, n.z)) fail(`走不到 NPC ${n.id}`); }
for (const s of map.spawns) if (!reach(s.x, s.z, Math.max(2.5, s.r))) fail(`走不到刷怪点 ${s.mob} (${s.x}, ${s.z})`);
for (const g of map.gather) if (!reach(g.x, g.z, 1.5)) fail(`走不到采集点 (${g.x}, ${g.z})`);
for (const [name, x, z] of [['桥东', 160, 104], ['寨门外', 76, 40], ['寨内', 75, 24], ['虎啸崖', 186, 22], ['小庙', 185, 132], ['草甸', 34, 56]]) if (!reach(x, z)) fail(`走不到 ${name}`);
const free = seen.reduce((s, v) => s + v, 0);
console.log(bad ? `发现 ${bad} 个问题` : `地图校验通过：可达格 ${free} / ${gw * gh}`);
process.exit(bad ? 1 : 0);
