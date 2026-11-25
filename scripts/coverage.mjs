// Screenshots of every coverage piece → qa/coverage/. Also collects console errors/warnings per shot.
// node scripts/coverage.mjs [only-name,...]
import {chromium} from '/workspace/3d-web-toolkit/tools/node_modules/playwright/index.mjs';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4317/';
const OUT = 'qa/coverage';
mkdirSync(OUT, {recursive: true});
const only = process.argv[2]?.split(',');
const b = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const W = 1440, H = 900;
const scrollSel = (p, sel, pr) =>
  p.evaluate(([sel, pr]) => {
    const s = document.querySelector(sel);
    window.scrollTo(0, Math.round(s.getBoundingClientRect().top + scrollY + pr * Math.max(0, s.offsetHeight - innerHeight)));
  }, [sel, pr]);
const sweep = async (p, pts, steps = 6) => {
  for (let i = 1; i < pts.length; i++) await p.mouse.move(pts[i][0], pts[i][1], {steps});
};
const SHOTS = {
  'hero-hold-swatches': {url: '#/', run: async (p) => p.waitForTimeout(9000)},
  'signatures-tabs-split': {url: '#/', run: async (p) => { await scrollSel(p, '#signatures', 0.3); await p.waitForTimeout(9000); }},
  'finder-cmdk': {url: '#/', run: async (p) => { await p.waitForTimeout(5000); await p.keyboard.press('Control+k'); await p.waitForTimeout(800); await p.keyboard.type('orv', {delay: 120}); await p.waitForTimeout(1500); }},
  'carte-otis-stretch': {url: '#/carte', run: async (p) => {
    await scrollSel(p, '#carte', 0.25); await p.waitForTimeout(12000);
    const box = await p.locator('[data-stretch]').boundingBox();
    const x = box.x + box.width * 0.5, y = box.y + box.height * 0.35;
    await p.mouse.move(x, y); await p.mouse.down();
    await p.mouse.move(x - 260, y - 120, {steps: 12});
    await p.waitForTimeout(1500);
  }, after: (p) => p.mouse.up()},
  'livre-spin-badge-nori': {url: '#/livre', run: async (p) => { await scrollSel(p, '#livre', 0.15); await p.waitForTimeout(14000); }},
  'livre-nori-emotion-love': {url: '#/livre', run: async (p) => {
    await scrollSel(p, '#livre', 0.15); await p.waitForTimeout(12000);
    const f = p.frames().find((f) => f.url().includes('/host-l2d/'));
    await f.evaluate(() => document.querySelector('#faces button[data-face="Love"]')?.click());
    await p.waitForTimeout(3000);
  }},
  'livre-live2d-nekomi': {url: '?host=live2d#/livre', run: async (p) => { await scrollSel(p, '#livre', 0.15); await p.waitForFunction(() => document.querySelector('iframe[data-host="live2d"]')?.contentWindow?.__ready, null, {timeout: 120000}); await p.mouse.move(W * 0.6, H * 0.3, {steps: 5}); await p.waitForTimeout(5000); }},
  'galerie-balaji-lens': {url: '#/galerie', run: async (p) => { await scrollSel(p, '#galerie', 0.12); await p.waitForTimeout(12000); await sweep(p, [[W * 0.45, H * 0.5], [W * 0.55, H * 0.45]]); await p.waitForTimeout(2500); }},
  'galerie-parallax-wall': {url: '#/galerie', run: async (p) => { await scrollSel(p, 'section[aria-label="Le mur des boissons"]', 0.4); await p.waitForTimeout(8000); }},
  'commande-qr-glow': {url: '#/commande', run: async (p) => { await p.waitForTimeout(10000); const q = p.locator('canvas[aria-label*="QR"], [data-qr]').first(); const bb = await q.boundingBox().catch(() => null); if (bb) await sweep(p, [[bb.x - 40, bb.y], [bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(1500); }},
  'venir-globe-intro': {url: '#/venir', run: async (p) => { await p.waitForTimeout(6000); }},
  'venir-map-pin': {url: '#/venir', run: async (p) => { await scrollSel(p, '#venir-map', 0.85); await p.waitForTimeout(12000); }},
  'footer-trailing-images': {url: '?qa#/venir', run: async (p) => {
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(9000);
    await p.mouse.move(100, 300);
    // freeze GSAP while sweeping, so the trail is still up when the slow software renderer captures it
    await p.evaluate(() => { window.__gsap.ticker.lagSmoothing(0); window.__gsap.globalTimeline.timeScale(0.08); });
    await sweep(p, [[100, 300], [400, 420], [700, 300], [1000, 450], [1300, 320]], 8);
    await p.evaluate(() => window.__gsap.globalTimeline.pause());
  }},
};
const report = existsSync(`${OUT}/errors.json`) ? JSON.parse(readFileSync(`${OUT}/errors.json`, 'utf8')) : {};
for (const [name, s] of Object.entries(SHOTS)) {
  if (only && !only.includes(name)) continue;
  const p = await b.newPage({viewport: {width: W, height: H}});
  const errs = [];
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(`${m.type()}: ${m.text().slice(0, 240)}`));
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('response', (r) => r.status() >= 400 && errs.push(`HTTP ${r.status()} ${r.url()}`));
  try {
    await p.goto(BASE + s.url, {waitUntil: 'load'});
    await p.waitForSelector('[data-preloader]', {state: 'detached', timeout: 90000});
    await s.run(p);
    await p.screenshot({path: `${OUT}/${name}.png`, timeout: 180000});
    await s.after?.(p);
  } catch (e) {
    errs.push('script: ' + e.message.split('\n')[0]);
  }
  report[name] = errs;
  console.log(name, JSON.stringify(errs));
  await p.close();
}
writeFileSync(`${OUT}/errors.json`, JSON.stringify(report, null, 2));
await b.close();
