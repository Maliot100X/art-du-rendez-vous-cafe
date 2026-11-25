// Throwaway check for the staged Nekomi model (NOT site code — do not import from src/).
// Verifies: Furry.model3.json parses, every file it references exists in
// public/live2d/nekomi/, and both textures are 2048x4096.
// Run: node scripts/verify-nekomi.mjs   (from ~/workspace/web-design/pro-studio)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public/live2d/nekomi');
let ok = true;
const fail = (msg) => { ok = false; console.error('FAIL:', msg); };

const modelPath = path.join(dir, 'Furry.model3.json');
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
console.log('model3.json parses OK, Version', model.Version);

const refs = [
  model.FileReferences.Moc,
  ...(model.FileReferences.Textures ?? []),
  model.FileReferences.Physics,
  model.FileReferences.DisplayInfo,
  ...Object.values(model.Motions ?? {}).flat().map((m) => m.File),
  ...(model.Expressions ?? []).map((e) => e.File),
];
for (const ref of new Set(refs)) {
  const p = path.join(dir, ref);
  if (fs.existsSync(p)) {
    console.log(`  exists: ${ref} (${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
  } else {
    fail(`missing referenced file: ${ref}`);
  }
}

for (const tex of model.FileReferences.Textures ?? []) {
  const meta = await sharp(path.join(dir, tex)).metadata();
  console.log(`  ${tex}: ${meta.width}x${meta.height} ${meta.format}`);
  if (meta.width !== 2048 || meta.height !== 4096) fail(`${tex} is not 2048x4096`);
}

// Staging hygiene: the 4096 originals and VTube Studio config must NOT be here.
for (const banned of ['Furry.vtube.json', 'Furry.4096']) {
  if (fs.existsSync(path.join(dir, banned))) fail(`should not be staged: ${banned}`);
}
console.log('No Furry.vtube.json / Furry.4096 in public/live2d/nekomi/:',
  !fs.existsSync(path.join(dir, 'Furry.vtube.json')));

console.log(ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED');
process.exit(ok ? 0 : 1);
