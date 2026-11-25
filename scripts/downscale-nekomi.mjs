// Downscale the Nekomi Live2D textures from 4096x8192 to 2048x4096 for the web.
// Source: ~/workspace/web-design/incoming/agent-kits/nekomi-vtuber/Nekomi Vtuber Transform by FinfiWorks/Furry.4096/
// Output: public/live2d/nekomi/texture_00.png + texture_01.png
// Run: node scripts/downscale-nekomi.mjs   (from ~/workspace/web-design/pro-studio)
// PNG resize is lossless apart from the resample itself; sharp's default
// Lanczos3 kernel keeps the face detail. Do NOT ship the 4096 originals.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(fileURLToPath(import.meta.url)); // scripts/
const studio = path.resolve(root, '..');
const srcDir = path.join(
  process.env.HOME,
  'workspace/web-design/incoming/agent-kits/nekomi-vtuber',
  'Nekomi Vtuber Transform by FinfiWorks',
  'Furry.4096',
);
const outDir = path.join(studio, 'public/live2d/nekomi');
fs.mkdirSync(outDir, { recursive: true });

for (const name of ['texture_00.png', 'texture_01.png']) {
  const src = path.join(srcDir, name);
  const dst = path.join(outDir, name);
  const meta = await sharp(src).metadata();
  console.log(`${name}: source ${meta.width}x${meta.height} ${meta.format}`);
  await sharp(src)
    .resize(2048, 4096, { fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(dst);
  const out = await sharp(dst).metadata();
  const size = fs.statSync(dst).size;
  console.log(`  -> ${dst}: ${out.width}x${out.height}, ${(size / 1024 / 1024).toFixed(2)} MB`);
}
console.log('Done.');
