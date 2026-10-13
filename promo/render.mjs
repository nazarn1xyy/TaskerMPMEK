// Renders promo/index.html with Playwright.
//   node render.mjs stills out/stills 0 0.42 0.92 ...   → one PNG per time (seconds)
//   node render.mjs beats  out/beats                    → one PNG per beat (settled: beat + 0.42 s) + a contact sheet
//   node render.mjs full   out/frames [workers]         → 14 s × 240 fps (4 subframes per 60 fps frame)
// Every frame is a pure function of t, so workers can render any range in any order.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(here, 'index.html')).href;
const [mode = 'beats', outDir = 'out/beats', ...rest] = process.argv.slice(2);
const out = path.resolve(here, outDir);
mkdirSync(out, { recursive: true });
const T = 14, FPS = 60, SUB = 4;

async function page(browser) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1440 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.error('PAGE ERROR', e.message));
  p.on('console', m => m.type() === 'error' && console.error('CONSOLE', m.text()));
  await p.goto(url);
  await p.evaluate(() => window.ready);
  return p;
}
const shot = async (p, t, file) => {
  await p.evaluate(t => window.seek(t), t);
  await p.screenshot({ path: file, type: 'png' });
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--font-render-hinting=none'] });
if (mode === 'stills' || mode === 'beats') {
  const p = await page(browser);
  const times = mode === 'beats' ? Array.from({ length: 28 }, (_, i) => +(i * 0.5 + 0.42).toFixed(3)) : rest.map(Number);
  for (const t of times) await shot(p, t, path.join(out, `t${t.toFixed(3).padStart(6, '0')}.png`));
  if (mode === 'beats') writeFileSync(path.join(out, 'sounds.json'), JSON.stringify(await p.evaluate(() => window.SOUNDS)));
  console.log(`${times.length} stills → ${out}`);
} else if (mode === 'full') {
  const workers = +(rest[0] || 4), N = T * FPS * SUB;
  let next = 0, done = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: workers }, async () => {
    const p = await page(browser);
    for (;;) {
      const i = next++;
      if (i >= N) break;
      // subframe i covers t = (i - 1.5) / 240, so each 60 fps frame blends a window centred on its own time
      await shot(p, (i - (SUB - 1) / 2) / (FPS * SUB), path.join(out, `f${String(i).padStart(5, '0')}.png`));
      if (++done % 240 === 0) console.log(`${done}/${N}  ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
  }));
  writeFileSync(path.join(out, '..', 'sounds.json'), JSON.stringify(await (await page(browser)).evaluate(() => window.SOUNDS)));
  console.log(`done ${N} subframes in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
await browser.close();
