// End-to-end voice test on the Commande tab: server grant token → agent websocket →
// typed order → spoken reply streamed into Nori (Layer2D) → phoneme lip-sync.
// Writes qa/voice-test.mp4 + qa/voice-test.json. The API key never leaves the server.
import {chromium} from '/workspace/3d-web-toolkit/tools/node_modules/playwright/index.mjs';
import {execSync} from 'node:child_process';
import {mkdirSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4317/';
rmSync('qa/vt-tmp', {recursive: true, force: true});
const b = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
const ctx = await b.newContext({viewport: {width: 1280, height: 800}, recordVideo: {dir: 'qa/vt-tmp', size: {width: 1280, height: 800}}});
const p = await ctx.newPage();
const log = {errors: [], ws: [], samples: []};
p.on('console', (m) => m.type() === 'error' && log.errors.push(m.text().slice(0, 300)));
p.on('pageerror', (e) => log.errors.push(e.message));
p.on('websocket', (ws) => {
  log.ws.push({url: ws.url(), opened: Date.now()});
  let up = 0, down = 0, downBin = 0;
  ws.on('framesent', (f) => up++);
  ws.on('framereceived', (f) => {
    down++;
    if (typeof f.payload !== 'string') downBin += f.payload.length;
    else {
      try {
        const m = JSON.parse(f.payload);
        if (['Welcome', 'SettingsApplied', 'ConversationText', 'FunctionCallRequest', 'AgentAudioDone', 'Error'].includes(m.type)) log.ws.push({type: m.type, role: m.role, content: m.content, at: Date.now()});
      } catch {}
    }
  });
  ws.on('close', () => log.ws.push({closed: Date.now(), framesUp: up, framesDown: down, audioBytesDown: downBin}));
});
const T0 = Date.now();
await p.goto(BASE + '#/commande', {waitUntil: 'load'});
await p.waitForSelector('[data-preloader]', {state: 'detached', timeout: 90000});
await p.waitForFunction(() => {
  const f = document.querySelector('iframe[data-host]');
  return f && f.contentWindow && f.contentWindow.__ready;
}, null, {timeout: 120000});
await p.waitForTimeout(3000);
const tStart = (Date.now() - T0) / 1000;
const tokenRes = await p.evaluate(async () => {
  const r = await fetch('/api/deepgram/token', {method: 'POST'});
  const j = await r.json();
  return {status: r.status, hasToken: !!j.access_token, tokenLength: (j.access_token || '').length, expires_in: j.expires_in};
});
log.grant = tokenRes;
await p.fill('input[aria-label="Message à l’hôte"]', 'Bonjour Nori ! Une Orval et un café latte, s’il vous plaît.');
await p.click('button[type="submit"]');
const frame = p.frames().find((f) => f.url().includes('/host-l2d/'));
// high-rate probe inside the player: its own analyser RMS + the vowel its lip-sync picks
await frame.evaluate(() => {
  window.__lip = {maxRms: 0, vowels: {}, ticks: 0};
  setInterval(() => {
    /* global obsAudio, ctl */
    const L = window.__lip;
    L.ticks++;
    if (obsAudio.analyser) {
      const t = new Float32Array(obsAudio.analyser.fftSize);
      obsAudio.analyser.getFloatTimeDomainData(t);
      let s = 0;
      for (const v of t) s += v * v;
      L.maxRms = Math.max(L.maxRms, Math.sqrt(s / t.length));
    }
    if (ctl.vowel) L.vowels[ctl.vowel] = (L.vowels[ctl.vowel] || 0) + 1;
  }, 40);
});
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(600);
  const st = await frame.evaluate(() => {
    const s = window.__obsLinkState?.();
    return s ? {tunnel: s.audioTunnelActive, phoneme: s.phoneme, vowel: s.vowel, ctx: s.obsAudioCtxState} : null;
  });
  const peak = await p.evaluate(() => window.__voicePeak || 0);
  log.samples.push({t: +((Date.now() - T0) / 1000).toFixed(1), ...st, peak: +peak.toFixed(3)});
}
log.voiceLog = await p.evaluate(() => window.__voiceLog);
log.noriLip = await frame.evaluate(() => window.__lip);
log.bag = await p.evaluate(() => [...document.querySelectorAll('[data-line]')].map((li) => li.getAttribute('data-line') + ' x' + li.querySelector('.tabular-nums')?.textContent));
await p.screenshot({path: 'qa/voice-test-end.png', timeout: 180000});
await ctx.close();
await b.close();
const webm = readdirSync('qa/vt-tmp').find((f) => f.endsWith('.webm'));
renameSync(`qa/vt-tmp/${webm}`, 'qa/voice-test-raw.webm');
rmSync('qa/vt-tmp', {recursive: true, force: true});
const D = (Date.now() - T0) / 1000 - tStart;
const k = Math.min(1, 15 / D);
execSync(`ffmpeg -y -loglevel error -ss ${tStart.toFixed(2)} -i qa/voice-test-raw.webm -vf "setpts=${k.toFixed(4)}*PTS" -r 25 -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart qa/voice-test.mp4`);
const vowels = Object.values(log.noriLip.vowels).reduce((a, b) => a + b, 0);
log.summary = {grantOk: tokenRes.hasToken, wsConnected: log.ws.some((w) => w.type === 'SettingsApplied'), replies: log.ws.filter((w) => w.type === 'ConversationText' && w.role === 'assistant').map((w) => w.content), functionCalls: log.ws.filter((w) => w.type === 'FunctionCallRequest').length, noriAudioTunnel: log.samples.some((s) => s.tunnel), noriInputRms: +log.noriLip.maxRms.toFixed(3), noriVowelTicks: vowels, noriVowels: log.noriLip.vowels, peakLevel: Math.max(...log.samples.map((s) => s.peak)), bag: log.bag, consoleErrors: log.errors.length};
writeFileSync('qa/voice-test.json', JSON.stringify(log, null, 2));
console.log(JSON.stringify(log.summary, null, 2));
