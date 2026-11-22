// 从 Poly Haven 下载 CC0 PBR 贴图，转成游戏用的 1024² WebP，并生成 CREDITS.md。
// 用法：node tools/tex/fetch.mjs [--only=grass,dirt] [--refresh]
//   --only     只处理指定材质（CREDITS.md 仍按全表生成，缺缓存的会顺带请求一次 info）
//   --refresh  忽略 tmp/tex-cache 里的缓存，重新下载
// 每个材质输出三张：<name>.color.webp（sRGB 底色）、<name>.normal.webp（OpenGL 法线，即 nor_gl）、
// <name>.rough.webp（粗糙度灰度图）。原图缓存在 tmp/tex-cache/<id>/，重跑不会重复下载。
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// 游戏按 name 加载贴图；想换素材只改 id（Poly Haven 的 asset id）后重跑即可。
const MATERIALS = [
  // 地面
  { name: 'grass', id: 'grass_ground' }, // 偏干的短草地，色调灰绿，无明显重复特征
  { name: 'dirt', id: 'dirt' }, // 夯实土路
  { name: 'paving', id: 'grey_stone_path' }, // 不规则灰色旧石板
  { name: 'sand', id: 'dense_sand' }, // 细沙；想要带卵石的河滩可换 river_small_rocks
  { name: 'leaves', id: 'forest_leaves_03' }, // 深色落叶林地
  // 建筑与道具
  { name: 'planks', id: 'dark_wooden_planks' }, // 深色旧木板
  { name: 'wood', id: 'fine_grained_wood' }, // 无拼缝的深色木纹，法线很平；想要开裂的老木料可换 rough_wood
  { name: 'plaster', id: 'painted_plaster_wall' }, // 旧白灰墙
  { name: 'rooftile', id: 'plastered_wall_05' }, // 青灰粗糙面，只给瓦片提供表面细节（瓦垄由几何体表现）；想要带瓦片接缝的可换 grey_roof_01
  { name: 'thatch', id: 'thatch_roof_angled' }, // 茅草屋顶
  { name: 'stonewall', id: 'japanese_stone_wall' }, // 灰色粗石块墙
  { name: 'brick', id: 'brick_wall_08' }, // 青灰砖墙
  { name: 'bark', id: 'bark_willow_02' }, // 阔叶树皮
  { name: 'pinebark', id: 'pine_bark' }, // 松树皮
  { name: 'rock', id: 'marble_cliff_05' }, // 灰色天然岩壁
  { name: 'linen', id: 'hessian_230' }, // 粗麻布
  { name: 'leather', id: 'brown_leather' }, // 棕色皮革
  { name: 'steel', id: 'concrete_floor_worn_001' }, // 替代品：Poly Haven 没有不带漆、不带锈的裸钢，用带细划痕的中性深灰面代替
];

const SIZE = 1024;
const RES = '1k';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/assets/tex');
const CACHE = path.join(ROOT, 'tmp/tex-cache');
const API = 'https://api.polyhaven.com';
const HEADERS = { 'User-Agent': 'texture-fetch-script' };

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)];
}));
const only = opt.only ? new Set(opt.only.split(',')) : null;
const refresh = !!opt.refresh;

const exists = (p) => fs.access(p).then(() => true, () => false);

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw new Error(`GET ${url} 失败：${e.message}`);
      await new Promise((res) => setTimeout(res, 800 * attempt));
    }
  }
}

async function cachedJson(id, kind) {
  const file = path.join(CACHE, id, `${kind}.json`);
  if (!refresh && await exists(file)) return JSON.parse(await fs.readFile(file, 'utf8'));
  const buf = await get(`${API}/${kind}/${id}`);
  const json = JSON.parse(buf.toString('utf8'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return json;
}

// 在 files 接口的返回里按候选贴图名、候选格式挑一个 1k 文件。
function pick(files, id, maps, formats) {
  for (const map of maps) {
    for (const fmt of formats) {
      const f = files[map]?.[RES]?.[fmt];
      if (f?.url) return { map, fmt, ...f };
    }
  }
  throw new Error(`${id}：找不到 ${maps.join('/')} 的 ${RES} ${formats.join('/')} 文件（现有：${Object.keys(files).join(', ')}）`);
}

async function download(id, f) {
  const file = path.join(CACHE, id, `${f.map}.${f.fmt}`);
  if (!refresh && await exists(file)) return file;
  const buf = await get(f.url);
  if (f.md5 && createHash('md5').update(buf).digest('hex') !== f.md5) throw new Error(`${id}：${f.map} 的 md5 校验失败`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return file;
}

const square = (file) => sharp(file).resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' });

async function build({ name, id }) {
  const files = await cachedJson(id, 'files');
  const color = pick(files, id, ['Diffuse', 'diff', 'Color'], ['jpg', 'png']);
  // 法线优先取 PNG，避免 JPEG 再压一次 WebP 的二次损失。
  const normal = pick(files, id, ['nor_gl'], ['png', 'jpg']);
  // 没有单独的 Rough 就用 ARM（AO/Rough/Metal 打包图）的 G 通道。
  const rough = pick(files, id, ['Rough', 'rough', 'arm'], ['jpg', 'png']);
  const [colorSrc, normalSrc, roughSrc] = await Promise.all([download(id, color), download(id, normal), download(id, rough)]);

  const out = (kind) => path.join(OUT, `${name}.${kind}.webp`);
  await Promise.all([
    square(colorSrc).removeAlpha().webp({ quality: 88, effort: 6 }).toFile(out('color')),
    // 有损 WebP 的色度抽样会把法线的 XY 分量搅在一起（实测 q95 平均偏 4°~11°），所以用 near-lossless：
    // quality 60 平均偏 0.8°、单张约 0.5~1.8 MB；想再省体积可降到 40（约 1.6°，小 25% 左右）。
    square(normalSrc).removeAlpha().webp({ nearLossless: true, quality: 60, effort: 6 }).toFile(out('normal')),
    square(roughSrc).extractChannel(rough.map === 'arm' ? 'green' : 0).webp({ quality: 85, effort: 6 }).toFile(out('rough')),
  ]);
  return rough.map === 'arm' ? 'arm.G' : 'Rough';
}

async function pool(items, limit, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: limit }, async () => {
    for (let item; (item = queue.shift());) await fn(item);
  }));
}

async function writeCredits() {
  const rows = [];
  for (const { name, id } of MATERIALS) {
    const info = await cachedJson(id, 'info');
    const authors = Object.entries(info.authors ?? {}).map(([who, role]) => (role && role !== 'All' ? `${who} (${role})` : who)).join(', ');
    rows.push(`| \`${name}\` | \`${id}\` | https://polyhaven.com/a/${id} | ${authors} | CC0 |`);
  }
  const text = [
    '# Texture credits',
    '',
    'All textures in this folder come from [Poly Haven](https://polyhaven.com) and are licensed',
    '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Each material ships as',
    `\`<name>.color.webp\`, \`<name>.normal.webp\` (OpenGL convention) and \`<name>.rough.webp\`, resized to ${SIZE}x${SIZE}.`,
    '',
    'This file is generated by `tools/tex/fetch.mjs`; edit the table at the top of that script, not this file.',
    '',
    '| Material | Poly Haven asset id | Asset page | Author(s) | License |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  await fs.writeFile(path.join(OUT, 'CREDITS.md'), text);
}

async function verify() {
  let total = 0;
  let bad = 0;
  for (const { name } of MATERIALS) {
    const cells = [];
    for (const kind of ['color', 'normal', 'rough']) {
      const file = path.join(OUT, `${name}.${kind}.webp`);
      if (!await exists(file)) { cells.push(`${kind} 缺失`); bad++; continue; }
      const [{ width, height }, { size }] = await Promise.all([sharp(file).metadata(), fs.stat(file)]);
      total += size;
      if (width !== SIZE || height !== SIZE) { cells.push(`${kind} 尺寸 ${width}x${height}`); bad++; continue; }
      cells.push(`${kind} ${(size / 1024).toFixed(0)}K`);
    }
    console.log(`  ${name.padEnd(10)} ${cells.join('  ')}`);
  }
  console.log(`共 ${(total / 1048576).toFixed(2)} MB（不含 CREDITS.md）`);
  return bad;
}

const names = MATERIALS.map((m) => m.name);
if (new Set(names).size !== names.length) throw new Error('MATERIALS 里有重复的 name');
const todo = MATERIALS.filter((m) => !only || only.has(m.name));
if (only && todo.length !== only.size) throw new Error(`--only 里有未知材质：${[...only].filter((n) => !names.includes(n)).join(', ')}`);

await fs.mkdir(OUT, { recursive: true });
const failed = [];
await pool(todo, 4, async (m) => {
  try {
    const roughFrom = await build(m);
    console.log(`✓ ${m.name} ← ${m.id}（粗糙度取自 ${roughFrom}）`);
  } catch (e) {
    failed.push(m.name);
    console.error(`✗ ${m.name} ← ${m.id}：${e.message}`);
  }
});
await writeCredits();
const bad = await verify();
if (failed.length || bad) {
  console.error(`未完成：${failed.join(', ') || `${bad} 个文件缺失或尺寸不对`}`);
  process.exit(1);
}
