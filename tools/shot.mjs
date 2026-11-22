// 在无头 Chrome 里打开游戏并截图，用于验证画面。
// 用法：node tools/shot.mjs --out=tmp/shot.png [--x=100 --z=110 --hour=10 --zoom=1] [--w=1600 --h=900] [--wait=1500] [--eval="js 代码"] [--dpr=1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)];
}));
const CHROME = process.env.CHROME_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/MyApp/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

const server = await createServer({ root: ROOT, logLevel: 'warn', server: { port: 5188, host: '127.0.0.1' } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: +(opt.w ?? 1600), height: +(opt.h ?? 900) }, deviceScaleFactor: +(opt.dpr ?? 1) });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 600)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const q = new URLSearchParams({ nosave: '1' });
  if (!opt.title) q.set('autostart', '1');
  for (const k of ['x', 'z', 'hour', 'zoom']) if (opt[k]) q.set(k, opt[k]);
  await page.goto(`${base}?${q}`);
  await page.waitForFunction('window.__ready === true || !!window.__error', null, { timeout: 120000 });
  const err = await page.evaluate('window.__error');
  if (err) { console.log('[boot error]', err); code = 1; }
  await page.waitForTimeout(+(opt.wait ?? 1500));
  if (opt.eval) {
    const out = await page.evaluate(opt.eval);
    if (out !== undefined) console.log('[eval]', JSON.stringify(out));
    await page.waitForTimeout(+(opt.wait2 ?? 600));
  }
  if (opt.fps) console.log('[load ms]', Math.round(await page.evaluate('window.__readyAt')));
  if (opt.fps) {
    const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 2000) res(n / 2); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    console.log('[fps]', fps);
  }
  const out = path.resolve(opt.out ?? 'tmp/shot.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log('截图:', out);
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
