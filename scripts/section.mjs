// node scripts/section.mjs <selector> <p1,p2,...> <name-prefix> [w] [h] [outdir]
import {chromium} from '/workspace/3d-web-toolkit/tools/node_modules/playwright/index.mjs';
import {mkdirSync} from 'node:fs';
const [sel, ps, prefix, w = '1440', h = '900', out = 'qa'] = process.argv.slice(2);
mkdirSync(out, {recursive: true});
const BASE = process.env.BASE || 'http://127.0.0.1:4317/';
const b = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const mobile = +w < 600;
const p = await b.newPage({viewport: {width: +w, height: +h}, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile});
const errs = [];
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('response', (r) => r.status() >= 400 && errs.push(`HTTP ${r.status()} ${r.url()}`));
await p.goto(BASE + (process.env.HASH || ''), {waitUntil: 'load'});
await p.waitForSelector('[data-preloader]', {state: 'detached', timeout: 90000});
for (const [i, pr] of ps.split(',').map(Number).entries()) {
  if (sel !== 'none') {
    await p.evaluate(([sel, pr]) => {
      const s = document.querySelector(sel);
      window.scrollTo(0, Math.round(s.offsetTop + pr * Math.max(0, s.offsetHeight - innerHeight)));
    }, [sel, pr]);
  }
  await p.waitForTimeout(+(process.env.WAIT || 9000));
  await p.mouse.move(+w * 0.55, +h * 0.45);
  await p.waitForTimeout(800);
  await p.screenshot({path: `${out}/${prefix}-${i + 1}.png`, timeout: 180000});
}
console.log(JSON.stringify(errs));
await b.close();
