import { MENU, CAFE, VISIT, type MenuCategory } from '../content';

/**
 * The menu book's pages — one model, two renderers.
 *
 * The 3D book (Three.js canvas textures) and the reduced-motion / no-WebGL
 * fallback (static DOM spreads) both read from this file, which reads from
 * content.ts MENU — prices are never retyped anywhere in the book.
 *
 * Page sequence (16 pages = 8 leaves; leaf i front = pages[2i],
 * back = pages[2i+1]):
 *   cover | chaudes intro, chaudes items | bières intro, bières items |
 *   … | alcools intro, alcools items | back cover
 */

export const PAGE_W = 1024;
export const PAGE_H = 1420;
export const PAGE_ASPECT = PAGE_W / PAGE_H;

export type BookPage =
  | { kind: 'cover' }
  | { kind: 'intro'; category: MenuCategory; index: number }
  | { kind: 'items'; category: MenuCategory; index: number }
  | { kind: 'back' };

export function buildPages(): BookPage[] {
  const pages: BookPage[] = [{ kind: 'cover' }];
  MENU.forEach((category, i) => {
    pages.push({ kind: 'intro', category, index: i });
    pages.push({ kind: 'items', category, index: i });
  });
  pages.push({ kind: 'back' });
  return pages;
}

export interface LeafDef {
  front: BookPage;
  back: BookPage;
}

export function buildLeaves(): LeafDef[] {
  const pages = buildPages();
  const leaves: LeafDef[] = [];
  for (let i = 0; i < pages.length / 2; i++) {
    leaves.push({ front: pages[2 * i], back: pages[2 * i + 1] });
  }
  return leaves;
}

/** Leaf count — the flip state runs 0 (closed on the cover) to 8 (closed on the back). */
export const LEAF_COUNT = 8;

/** Human label for a flip state: the cover, a category spread, or the back. */
export function spreadLabel(flipped: number): string {
  if (flipped <= 0) return 'Couverture';
  if (flipped >= LEAF_COUNT) return 'Dos de la couverture';
  return MENU[flipped - 1].label;
}

/* ------------------------------------------------------------------ */
/* Canvas drawing — one page face per 1024×1420 canvas.               */
/* Colours are the site tokens, inlined: the canvas cannot see CSS.   */
/* ------------------------------------------------------------------ */

const INK = '#171210';
const INK_2 = '#221a15';
const BONE = '#ece5da';
const AMBER = '#e8a33d';
const AMBER_DARK = '#9a6a1a';
const MIST = '#8a7d6c';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paperBase(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = BONE;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = 'rgba(23,18,16,0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, PAGE_W - 60, PAGE_H - 60);
}

function inkBase(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = 'rgba(236,229,218,0.30)';
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, PAGE_W - 60, PAGE_H - 60);
}

function drawCover(ctx: CanvasRenderingContext2D) {
  inkBase(ctx);
  ctx.textAlign = 'center';
  ctx.fillStyle = AMBER;
  ctx.font = '500 30px "Martian Mono", monospace';
  ctx.fillText('BRUXELLES · DEPUIS TOUJOURS', PAGE_W / 2, 300);
  ctx.fillStyle = BONE;
  // The title must fit the canvas: "RENDEZ-VOUS" at 150px Bodoni (or its
  // Georgia fallback, which is wider) can exceed the 1024px page and clip
  // at the edges — shrink the title until it fits with margin.
  const titleFont = (size: number) => `700 ${size}px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif`;
  let titleSize = 150;
  ctx.font = titleFont(titleSize);
  while (ctx.measureText('RENDEZ-VOUS').width > PAGE_W - 120 && titleSize > 90) {
    titleSize -= 4;
    ctx.font = titleFont(titleSize);
  }
  ctx.fillText('ART DU', PAGE_W / 2, 520);
  ctx.fillText('RENDEZ-VOUS', PAGE_W / 2, 680);
  ctx.fillStyle = AMBER;
  ctx.font = 'italic 400 150px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif';
  ctx.fillText('Café', PAGE_W / 2, 850);
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAGE_W / 2 - 180, 930);
  ctx.lineTo(PAGE_W / 2 + 180, 930);
  ctx.stroke();
  ctx.fillStyle = BONE;
  ctx.font = '500 34px "Martian Mono", monospace';
  ctx.fillText('LA CARTE DES BOISSONS', PAGE_W / 2, 1010);
  ctx.fillStyle = 'rgba(236,229,218,0.65)';
  ctx.font = '400 28px "Albert Sans Variable", "Albert Sans", sans-serif';
  ctx.fillText('Sept familles, des prix affichés, rien d’autre.', PAGE_W / 2, 1080);
  ctx.font = '500 24px "Martian Mono", monospace';
  ctx.fillStyle = 'rgba(236,229,218,0.5)';
  ctx.fillText('PRIX EN EUROS, TAXES COMPRISES', PAGE_W / 2, PAGE_H - 90);
}

function drawBack(ctx: CanvasRenderingContext2D) {
  inkBase(ctx);
  ctx.textAlign = 'center';
  ctx.fillStyle = BONE;
  ctx.font = '700 84px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif';
  ctx.fillText('ART DU', PAGE_W / 2, 420);
  ctx.fillText('RENDEZ-VOUS', PAGE_W / 2, 520);
  ctx.fillStyle = AMBER;
  ctx.font = 'italic 400 84px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif';
  ctx.fillText('Café', PAGE_W / 2, 640);
  ctx.fillStyle = 'rgba(236,229,218,0.75)';
  ctx.font = '400 34px "Albert Sans Variable", "Albert Sans", sans-serif';
  ctx.fillText(CAFE.address, PAGE_W / 2, 790);
  ctx.font = '500 26px "Martian Mono", monospace';
  ctx.fillStyle = AMBER;
  ctx.fillText('HORAIRES', PAGE_W / 2, 920);
  ctx.fillStyle = 'rgba(236,229,218,0.8)';
  ctx.font = '400 30px "Albert Sans Variable", "Albert Sans", sans-serif';
  VISIT.hours.forEach((h, i) => {
    ctx.fillText(`${h.days} — ${h.time}`, PAGE_W / 2, 980 + i * 52);
  });
  ctx.fillStyle = 'rgba(236,229,218,0.5)';
  ctx.font = '500 24px "Martian Mono", monospace';
  ctx.fillText('PRIX EN EUROS, TAXES COMPRISES', PAGE_W / 2, PAGE_H - 90);
}

function drawIntro(
  ctx: CanvasRenderingContext2D,
  page: Extract<BookPage, { kind: 'intro' }>,
  images: Map<string, HTMLImageElement | null>,
) {
  paperBase(ctx);
  const img = images.get(page.category.image);
  const imgTop = 0;
  const imgH = 780;
  if (img) {
    // Cover-crop the photo into the top band.
    const scale = Math.max(PAGE_W / img.naturalWidth, imgH / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, imgTop, PAGE_W, imgH);
    ctx.clip();
    ctx.drawImage(img, (PAGE_W - dw) / 2, imgTop + (imgH - dh) / 2, dw, dh);
    const grad = ctx.createLinearGradient(0, imgH - 220, 0, imgH);
    grad.addColorStop(0, 'rgba(236,229,218,0)');
    grad.addColorStop(1, BONE);
    ctx.fillStyle = grad;
    ctx.fillRect(0, imgH - 220, PAGE_W, 220);
    ctx.restore();
  } else {
    ctx.fillStyle = INK_2;
    ctx.fillRect(0, imgTop, PAGE_W, imgH);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER_DARK;
  ctx.font = '500 30px "Martian Mono", monospace';
  ctx.fillText(`LA CARTE — ${String(page.index + 1).padStart(2, '0')} / ${String(MENU.length).padStart(2, '0')}`, 72, 900);
  ctx.fillStyle = INK;
  ctx.font = '700 96px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif';
  const labelLines = wrapText(ctx, page.category.label, PAGE_W - 144);
  labelLines.forEach((line, i) => ctx.fillText(line, 72, 1010 + i * 104));
  const blurbY = 1010 + labelLines.length * 104 + 40;
  ctx.fillStyle = 'rgba(23,18,16,0.75)';
  ctx.font = 'italic 400 38px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif';
  wrapText(ctx, page.category.blurb, PAGE_W - 144).forEach((line, i) => {
    ctx.fillText(line, 72, blurbY + i * 52);
  });
  ctx.fillStyle = MIST;
  ctx.font = '500 26px "Martian Mono", monospace';
  ctx.fillText('LES PRIX — PAGE SUIVANTE →', 72, PAGE_H - 90);
}

function drawItems(ctx: CanvasRenderingContext2D, page: Extract<BookPage, { kind: 'items' }>) {
  paperBase(ctx);
  const x = 72;
  const right = PAGE_W - 72;
  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER_DARK;
  ctx.font = '500 28px "Martian Mono", monospace';
  ctx.fillText(`LA CARTE — ${String(page.index + 1).padStart(2, '0')} / ${String(MENU.length).padStart(2, '0')}`, x, 130);
  ctx.fillStyle = INK;
  ctx.font = '700 72px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif';
  ctx.fillText(page.category.label, x, 220);
  ctx.strokeStyle = 'rgba(23,18,16,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 258);
  ctx.lineTo(right, 258);
  ctx.stroke();

  const items = page.category.items;
  const notesCount = items.filter((it) => it.note).length;
  const top = 300;
  const bottom = PAGE_H - 110;
  const effN = items.length + 0.45 * notesCount;
  const rowH = Math.min(88, (bottom - top) / effN);
  const nameSize = Math.min(38, rowH * 0.52);
  const priceSize = Math.min(32, rowH * 0.46);

  items.forEach((item, i) => {
    const rowY = top + i * rowH;
    const midY = rowY + rowH * 0.5;
    // Row number.
    ctx.fillStyle = MIST;
    ctx.font = '500 22px "Martian Mono", monospace';
    ctx.fillText(String(i + 1).padStart(2, '0'), x, midY + 8);
    // Name — shrink to fit if the row is long.
    let size = nameSize;
    ctx.font = `700 ${size}px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif`;
    const nameX = x + 64;
    const maxName = right - 200;
    while (ctx.measureText(item.name).width > maxName && size > 24) {
      size -= 2;
      ctx.font = `700 ${size}px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif`;
    }
    const nameW = ctx.measureText(item.name).width;
    const nameY = item.note ? rowY + rowH * 0.42 : midY + size * 0.36;
    ctx.fillStyle = INK;
    ctx.fillText(item.name, nameX, nameY);
    // Price.
    ctx.font = `500 ${priceSize}px "Martian Mono", monospace`;
    const priceW = ctx.measureText(item.price).width;
    ctx.fillStyle = AMBER_DARK;
    ctx.fillText(item.price, right - priceW, nameY);
    // Dotted leader between name and price.
    const dotStart = nameX + nameW + 16;
    const dotEnd = right - priceW - 16;
    if (dotEnd > dotStart) {
      ctx.fillStyle = 'rgba(23,18,16,0.35)';
      for (let dx = dotStart; dx < dotEnd; dx += 15) {
        ctx.beginPath();
        ctx.arc(dx, nameY - priceSize * 0.28, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Note (bottle price for wines, « telle qu’imprimée » for the soups).
    if (item.note) {
      ctx.fillStyle = MIST;
      ctx.font = '500 21px "Martian Mono", monospace';
      ctx.fillText(item.note.toUpperCase(), nameX, rowY + rowH * 0.82);
    }
    // Hairline under the row.
    ctx.strokeStyle = 'rgba(23,18,16,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, rowY + rowH - 6);
    ctx.lineTo(right, rowY + rowH - 6);
    ctx.stroke();
  });

  ctx.fillStyle = MIST;
  ctx.font = '500 24px "Martian Mono", monospace';
  ctx.fillText('PRIX EN EUROS, TAXES COMPRISES', x, PAGE_H - 70);
}

/** Draw one page face onto its canvas. `images` maps category image src → loaded element (or null). */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  page: BookPage,
  images: Map<string, HTMLImageElement | null>,
) {
  ctx.clearRect(0, 0, PAGE_W, PAGE_H);
  switch (page.kind) {
    case 'cover':
      drawCover(ctx);
      break;
    case 'intro':
      drawIntro(ctx, page, images);
      break;
    case 'items':
      drawItems(ctx, page);
      break;
    case 'back':
      drawBack(ctx);
      break;
  }
}

/** Load one image; resolves null on failure (the page draws a fallback block). */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
