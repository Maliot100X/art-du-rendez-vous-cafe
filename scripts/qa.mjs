// QA for site v4: headless Chromium with WebGL (SwiftShader), localhost preview only.
// Writes qa/*.png, qa/hero.mp4 and qa/report.json. Usage: node scripts/qa.mjs [shots|video|all]
import {chromium} from '/workspace/3d-web-toolkit/tools/node_modules/playwright/index.mjs';
import {execSync} from 'node:child_process';
import {mkdirSync, writeFileSync, readdirSync, renameSync, rmSync, existsSync, readFileSync} from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4317/';
const MODE = process.argv[2] || 'all';
mkdirSync('qa', {recursive: true});
const report = existsSync('qa/report.json') ? JSON.parse(readFileSync('qa/report.json', 'utf8')) : {};
report.errors = MODE === 'video' ? report.errors ?? [] : [];
report.warnings = MODE === 'video' ? report.warnings ?? [] : [];
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const watch = (page, tag) => {
  page.on('console', (m) => {
    const e = `[${tag}] ${m.type()}: ${m.text().slice(0, 300)}`;
    if (m.type() === 'error') report.errors.push(e);
    else if (m.type() === 'warning') report.warnings.push(e);
  });
  page.on('pageerror', (e) => report.errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => report.errors.push(`[${tag}] requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && report.errors.push(`[${tag}] HTTP ${r.status()} ${r.url()}`));
};
const shot = (page, name) => page.screenshot({path: `qa/${name}.png`, timeout: 180000});
const ready = async (page) => {
  await page.goto(BASE, {waitUntil: 'load'});
  await page.waitForSelector('[data-preloader]', {state: 'detached', timeout: 90000});
  await page.waitForFunction(() => (window.__frames ?? 0) > 5, null, {timeout: 90000});
};
const stageY = (page, u) =>
  page.evaluate((u) => {
    const s = document.getElementById('film');
    return Math.round(s.offsetTop + u * (s.offsetHeight - window.innerHeight));
  }, u);
const sectionY = (page, sel, p = 0) =>
  page.evaluate(([sel, p]) => {
    const s = document.querySelector(sel);
    return Math.round(s.offsetTop + p * Math.max(0, s.offsetHeight - window.innerHeight));
  }, [sel, p]);
const scrollTo = async (page, y, wait = 7000) => {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(wait);
};
const wiggle = async (page, cx, cy, n = 10) => {
  for (let i = 0; i < n; i++) {
    await page.mouse.move(cx + Math.cos(i / 2) * 140, cy + Math.sin(i / 2) * 70);
    await page.waitForTimeout(60);
  }
};

if (MODE !== 'video') {
  // ---------------- desktop
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await ready(page);
  const f0 = await page.evaluate(() => window.__frames);
  await page.waitForTimeout(4000);
  report.fpsDesktop = ((await page.evaluate(() => window.__frames)) - f0) / 4;
  await wiggle(page, 820, 380);
  await page.waitForTimeout(1500);
  await shot(page, 'desktop-01-hero-top');
  for (const [u, name] of [
    [0.33, 'desktop-02-scroll-card1-latte'],
    [0.565, 'desktop-03-scroll-card2-chocolate'],
    [0.805, 'desktop-04-scroll-card3-irish'],
  ]) {
    await scrollTo(page, await stageY(page, u), 9000);
    await page.mouse.move(700 + Math.random() * 200, 420);
    await page.waitForTimeout(800);
    await shot(page, name);
  }
  // Signatures: grab and stretch the second drink while the shutter fires
  await scrollTo(page, (await sectionY(page, '#signatures')) + 120, 6000);
  const box = await page.locator('[data-stretch]').nth(1).boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(box.x + box.width * 0.5 + i * 14, box.y + box.height * 0.4 - i * 9);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(600);
    await shot(page, 'desktop-05-signatures-stretch');
    await page.mouse.up();
  }
  await scrollTo(page, await sectionY(page, '#carte', 0.36), 5000);
  await shot(page, 'desktop-06-carte-reel');
  report.carteItems = await page.locator('[data-drink]').count();
  await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight), 4000);
  await wiggle(page, 720, 500, 14);
  await page.waitForTimeout(1500);
  await shot(page, 'desktop-07-footer-fluid');
  await ctx.close();

  // ---------------- mobile
  const mctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await ready(m);
  await m.waitForTimeout(3000);
  await shot(m, 'mobile-01-hero-top');
  await scrollTo(m, await stageY(m, 0.33), 9000);
  await shot(m, 'mobile-02-card1');
  await mctx.close();
}

if (MODE !== 'shots') {
  // ---------------- video: real-time recording of the live page
  rmSync('qa/video-tmp', {recursive: true, force: true});
  const vctx = await browser.newContext({viewport: {width: 1280, height: 800}, deviceScaleFactor: 1, recordVideo: {dir: 'qa/video-tmp', size: {width: 1280, height: 800}}});
  const v = await vctx.newPage();
  watch(v, 'video');
  await ready(v);
  const t0 = Date.now();
  const f0 = await v.evaluate(() => window.__frames);
  // cursor orbit on the hero
  for (let i = 0; i < 24; i++) {
    await v.mouse.move(640 + Math.cos(i / 3) * 260, 330 + Math.sin(i / 3) * 120);
    await v.waitForTimeout(110);
  }
  // scroll down through the crane-up to the first card, cursor still moving
  const y1 = await stageY(v, 0.34);
  for (let i = 1; i <= 40; i++) {
    await v.evaluate((y) => window.scrollTo(0, y), Math.round((y1 * i) / 40));
    await v.mouse.move(640 + Math.sin(i / 4) * 200, 400 + Math.cos(i / 4) * 80);
    await v.waitForTimeout(160);
  }
  await v.waitForTimeout(2500);
  report.fpsVideo = ((await v.evaluate(() => window.__frames)) - f0) / ((Date.now() - t0) / 1000);
  await vctx.close();
  const webm = readdirSync('qa/video-tmp').find((f) => f.endsWith('.webm'));
  renameSync(`qa/video-tmp/${webm}`, 'qa/hero-raw.webm');
  rmSync('qa/video-tmp', {recursive: true, force: true});
  // skip the preloader seconds, keep ~14 s, H.264 for easy playback
  const dur = parseFloat(execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 qa/hero-raw.webm').toString());
  const start = Math.max(0, dur - 14.5);
  execSync(`ffmpeg -y -loglevel error -ss ${start.toFixed(2)} -i qa/hero-raw.webm -t 14.5 -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart qa/hero.mp4`);
  rmSync('qa/hero-raw.webm');
  report.video = {file: 'qa/hero.mp4', rawDuration: dur, trimmedFrom: start};
}
await browser.close();
writeFileSync('qa/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({errors: report.errors, warnings: report.warnings.length, fps: [report.fpsDesktop, report.fpsVideo], carte: report.carteItems}, null, 2));
