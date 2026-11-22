// 离线烘焙：在无头 Chrome 里用 three.js 把 3D 模型渲染成 2D 图集。
// 用法：
//   node tools/bake/bake.mjs <job> [<job>...]            烘焙并写入 public/assets/atlas
//   node tools/bake/bake.mjs <job> --preview [--filter=正则] [--cols=8] [--zoom=1] [--as=名字] [--out=目录]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const jobs = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const OUT = path.join(ROOT, 'public/assets/atlas');
const PREVIEW_OUT = opt.out ? path.resolve(opt.out) : path.join(ROOT, 'tmp/preview');
const CHROME = process.env.CHROME_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/MyApp/Google Chrome.app/Contents/MacOS/Google Chrome']
    .find((p) => fs.existsSync(p));

if (!jobs.length) {
  console.error('用法: node tools/bake/bake.mjs <job>... [--preview] [--filter=正则]');
  process.exit(1);
}

function savePlugin() {
  return {
    name: 'bake-save',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const u = new URL(req.url, 'http://x');
        const file = u.searchParams.get('file');
        const w = +u.searchParams.get('w'), h = +u.searchParams.get('h');
        const rgb = u.searchParams.get('rgb') === '1';
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
          try {
            const buf = Buffer.concat(chunks);
            const isPrev = file.startsWith('preview/');
            const dest = path.join(isPrev ? PREVIEW_OUT : OUT, isPrev ? file.slice(8) : file);
            await fs.promises.mkdir(path.dirname(dest), { recursive: true });
            if (w > 0) {
              let img = sharp(buf, { raw: { width: w, height: h, channels: 4 }, limitInputPixels: false });
              if (rgb) img = img.removeAlpha();
              if (dest.endsWith('.webp')) {
                // 颜色（预乘 alpha）：有损；法线/高度/光泽：近无损，alpha 通道保持无损；阴影：有损
                if (dest.endsWith('.color.webp')) await img.webp({ quality: 90, alphaQuality: 100, effort: 4, smartSubsample: true }).toFile(dest);
                else if (dest.endsWith('.normal.webp')) await img.webp({ nearLossless: true, quality: 70, effort: 4 }).toFile(dest);
                else await img.webp({ quality: 82, effort: 4 }).toFile(dest);
              } else {
                // 注意：sharp 的 png({ effort }) 会隐式开启调色板量化（≤256 色），必须显式关闭
                await img.png({ compressionLevel: 9, palette: false }).toFile(dest);
              }
            } else {
              await fs.promises.writeFile(dest, buf);
            }
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

const server = await createServer({
  root: path.join(ROOT, 'tools/bake'),
  configFile: false,
  logLevel: 'warn',
  // 关掉热更新与文件监听：烘焙进行中若有源码被改动，页面不会被整页重载而从头再来
  server: { port: 5199, host: '127.0.0.1', fs: { allow: [ROOT] }, hmr: false, watch: null },
  plugins: [savePlugin()],
});
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let failed = false;
try {
  for (const job of jobs) {
    const page = await browser.newPage();
    page.on('console', (m) => console.log(m.text()));
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    const q = new URLSearchParams({ job });
    for (const k of ['filter', 'cols', 'zoom', 'as', 'ppu']) if (opt[k]) q.set(k, opt[k]);
    if (opt.preview) q.set('preview', '1');
    console.log(`烘焙 ${job}${opt.preview ? '（预览）' : ''}`);
    await page.goto(`${base}?${q}`);
    await page.waitForFunction('window.__done === true || !!window.__error', null, { timeout: 0 });
    const err = await page.evaluate('window.__error');
    if (err) { console.error(err); failed = true; }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (opt.preview) console.log('预览输出目录:', PREVIEW_OUT);
process.exit(failed ? 1 : 0);
