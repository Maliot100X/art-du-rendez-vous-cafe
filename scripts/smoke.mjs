import {chromium} from '/workspace/3d-web-toolkit/tools/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:4317/';
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('response', (r) => r.status() >= 400 && errs.push(`HTTP ${r.status()} ${r.url()}`));
await page.goto(BASE, {waitUntil: 'load'});
await page.waitForTimeout(9000);
await page.mouse.move(900, 380);
await page.waitForTimeout(1500);
await page.screenshot({path: 'qa/smoke-top.png', timeout: 120000});
const ys = (process.env.YS || '').split(',').filter(Boolean).map(Number);
for (const y of ys) {
  await page.evaluate((y) => window.scrollTo(0, y * document.documentElement.scrollHeight), y);
  await page.waitForTimeout(4000);
  await page.screenshot({path: `qa/smoke-${y}.png`, timeout: 120000});
}
console.log(JSON.stringify(errs, null, 1));
await browser.close();
