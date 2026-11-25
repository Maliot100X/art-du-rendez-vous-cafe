// Records the Livre tab: Nori idling + page flips (buttons + drag swipe).
// Writes qa/phase2/livre-flip.mp4 and qa/avatar/host-idle.mp4 (cropped on the host).
import {chromium} from '/workspace/3d-web-toolkit/tools/node_modules/playwright/index.mjs';
import {execSync} from 'node:child_process';
import {mkdirSync, readdirSync, renameSync, rmSync} from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4317/';
mkdirSync('qa/phase2', {recursive: true});
mkdirSync('qa/avatar', {recursive: true});
rmSync('qa/rec-tmp', {recursive: true, force: true});
const b = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']});
const ctx = await b.newContext({viewport: {width: 1280, height: 800}, recordVideo: {dir: 'qa/rec-tmp', size: {width: 1280, height: 800}}});
const p = await ctx.newPage();
const errs = [];
const labels = [];
const lab = async () => labels.push(await p.evaluate(() => [...document.querySelectorAll('#livre span.label')].map((e) => e.textContent).find((t) => /Pages|Couverture/.test(t))));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
p.on('pageerror', (e) => errs.push(e.message));
const T0 = Date.now();
await p.goto(BASE + '#/livre', {waitUntil: 'load'});
await p.waitForSelector('[data-preloader]', {state: 'detached', timeout: 90000});
await p.evaluate(() => {
  const s = document.querySelector('#livre');
  window.scrollTo(0, Math.round(s.offsetTop + 0.4 * (s.offsetHeight - innerHeight)));
});
await p.waitForTimeout(+(process.env.WARM || 15000));
const start = (Date.now() - T0) / 1000;
for (let i = 0; i < 20; i++) {
  await p.mouse.move(640 + Math.cos(i / 3) * 300, 380 + Math.sin(i / 3) * 140);
  await p.waitForTimeout(150);
}
for (let k = 0; k < 2; k++) {
  await p.click('button[aria-label="Page suivante"]');
  await p.waitForTimeout(3500);
  await lab();
}
// drag swipe right-to-left across the book
await p.mouse.move(1000, 480);
await p.mouse.down();
for (let i = 0; i <= 20; i++) {
  await p.mouse.move(1000 - i * 25, 480 - Math.sin(i / 6) * 30);
  await p.waitForTimeout(60);
}
await p.mouse.up();
await p.waitForTimeout(4000);
await lab();
await p.click('button[aria-label="Page précédente"]');
await p.waitForTimeout(2500);
await ctx.close();
await b.close();
const webm = readdirSync('qa/rec-tmp').find((f) => f.endsWith('.webm'));
renameSync(`qa/rec-tmp/${webm}`, 'qa/phase2/livre-raw.webm');
rmSync('qa/rec-tmp', {recursive: true, force: true});
execSync(`ffmpeg -y -loglevel error -ss ${start.toFixed(2)} -i qa/phase2/livre-raw.webm -t 15 -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart qa/phase2/livre-flip.mp4`);
execSync(`ffmpeg -y -loglevel error -ss ${start.toFixed(2)} -i qa/phase2/livre-raw.webm -t 10 -vf "crop=480:560:0:180" -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart qa/avatar/host-idle.mp4`);
console.log(JSON.stringify({start, labels, errs}));
