// Captures the tab curtain mid-transition (Accueil → La carte) into qa/tabs/.
import {chromium} from '/workspace/3d-web-toolkit/tools/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:4317/';
const b = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const p = await b.newPage({viewport: {width: 1440, height: 900}});
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(BASE + '#/venir', {waitUntil: 'load'});
await p.waitForSelector('[data-preloader]', {state: 'detached', timeout: 90000});
await p.waitForTimeout(6000);
await p.click('nav[aria-label="Principal"] a[href="#/carte"]');
await p.waitForTimeout(+(process.env.AT || 150));
await p.screenshot({path: 'qa/tabs/transition-curtain.png', timeout: 180000});
await p.waitForTimeout(9000);
console.log(JSON.stringify({route: await p.evaluate(() => location.hash), errs}));
await b.close();
