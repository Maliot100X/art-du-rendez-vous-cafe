import * as THREE from 'three'
import { MENU, type MenuCategory } from '../content'

/**
 * Vita's hand book — the SMALL book she holds in her left hand in the
 * menu tab. This is a separate prop from the big 3D book tab
 * (MenuBook + src/lib/bookPages.ts): a pocket-sized book (13 × 19 cm
 * pages) parented to her leftHand bone, drawn from the same MENU data
 * in src/content.ts — prices are never retyped.
 *
 * The book is built once (covers, page blocks, flip leaf) and its page
 * faces are CanvasTextures re-rendered per category when she starts
 * reading: spread 0 is the category title + first 5 items, later
 * spreads continue the items (5 per page). The flip leaf's front shows
 * the current right page and its back the next spread's left page, so
 * a page turn reveals the next right page underneath.
 *
 * Measured attach: the book's local offset/quaternion for the rest
 * pose come from scripts/measure-hand-book.mjs (hand bone world
 * position/quaternion in the posed VRM, replicated from the GLB) —
 * but VrmModel also re-aims the book in world space every frame, so
 * the facing stays camera-readable whatever the arm does.
 */

export const HAND_BOOK_PAGE_W = 0.13
export const HAND_BOOK_PAGE_H = 0.19
export const HAND_BOOK_THICKNESS = 0.016

const TEX_W = 512
const TEX_H = 748

const PAPER = '#ece5da'
const INK = '#171210'
const AMBER_DARK = '#9a6a1a'
const GOLD = '#e8a33d'
const MIST = '#8a7d6c'
const GREEN = '#0b2a1e'

/** Items per hand-book page — 5 keeps names + prices legible at this size. */
const ITEMS_PER_PAGE = 5

type HandPage =
  | { kind: 'title'; category: MenuCategory; index: number }
  | { kind: 'items'; category: MenuCategory; items: MenuCategory['items']; startNo: number; index: number }
  | { kind: 'closing'; category: MenuCategory }

export interface HandBookSpread {
  left: HTMLCanvasElement
  right: HTMLCanvasElement
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function paperBase(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  ctx.strokeStyle = 'rgba(23,18,16,0.28)'
  ctx.lineWidth = 2
  ctx.strokeRect(26, 26, TEX_W - 52, TEX_H - 52)
}

function pageHeader(ctx: CanvasRenderingContext2D, index: number) {
  ctx.textAlign = 'left'
  ctx.fillStyle = AMBER_DARK
  ctx.font = '500 22px "Martian Mono", monospace'
  ctx.fillText(`LA CARTE — ${String(index + 1).padStart(2, '0')} / ${String(MENU.length).padStart(2, '0')}`, 48, 84)
}

function drawTitlePage(ctx: CanvasRenderingContext2D, page: Extract<HandPage, { kind: 'title' }>) {
  paperBase(ctx)
  pageHeader(ctx, page.index)
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  let size = 62
  ctx.font = `700 ${size}px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif`
  const labelLines = wrapText(ctx, page.category.label, TEX_W - 96)
  // The label must fit: shrink until the longest line fits.
  while (labelLines.some((l) => ctx.measureText(l).width > TEX_W - 96) && size > 40) {
    size -= 4
    ctx.font = `700 ${size}px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif`
  }
  labelLines.forEach((line, i) => ctx.fillText(line, 48, 180 + i * (size + 12)))
  const ruleY = 180 + labelLines.length * (size + 12) + 18
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(48, ruleY)
  ctx.lineTo(200, ruleY)
  ctx.stroke()
  ctx.fillStyle = 'rgba(23,18,16,0.75)'
  ctx.font = 'italic 400 30px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif'
  wrapText(ctx, page.category.blurb, TEX_W - 96).forEach((line, i) => {
    ctx.fillText(line, 48, ruleY + 58 + i * 44)
  })
  ctx.textAlign = 'center'
  ctx.fillStyle = AMBER_DARK
  ctx.font = '500 22px "Martian Mono", monospace'
  ctx.fillText('ART DU RENDEZ-VOUS', TEX_W / 2, TEX_H - 92)
  ctx.fillStyle = MIST
  ctx.font = '500 19px "Martian Mono", monospace'
  ctx.fillText('CAFÉ · BRUXELLES', TEX_W / 2, TEX_H - 58)
}

function drawItemsPage(ctx: CanvasRenderingContext2D, page: Extract<HandPage, { kind: 'items' }>) {
  paperBase(ctx)
  pageHeader(ctx, page.index)
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = '700 42px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif'
  ctx.fillText(page.category.label, 48, 138)
  ctx.strokeStyle = 'rgba(23,18,16,0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(48, 162)
  ctx.lineTo(TEX_W - 48, 162)
  ctx.stroke()

  const top = 200
  const bottom = TEX_H - 84
  const rowH = (bottom - top) / page.items.length
  page.items.forEach((item, i) => {
    const rowY = top + i * rowH
    const midY = rowY + rowH * 0.5
    ctx.fillStyle = MIST
    ctx.font = '500 19px "Martian Mono", monospace'
    ctx.fillText(String(page.startNo + i + 1).padStart(2, '0'), 48, midY + 7)
    let size = 29
    ctx.font = `700 ${size}px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif`
    const nameX = 92
    const maxName = TEX_W - 48 - 150 - nameX
    while (ctx.measureText(item.name).width > maxName && size > 19) {
      size -= 2
      ctx.font = `700 ${size}px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif`
    }
    const nameW = ctx.measureText(item.name).width
    const nameY = item.note ? rowY + rowH * 0.42 : midY + size * 0.36
    ctx.fillStyle = INK
    ctx.fillText(item.name, nameX, nameY)
    ctx.font = '500 25px "Martian Mono", monospace'
    const priceW = ctx.measureText(item.price).width
    ctx.fillStyle = AMBER_DARK
    ctx.fillText(item.price, TEX_W - 48 - priceW, nameY)
    const dotStart = nameX + nameW + 12
    const dotEnd = TEX_W - 48 - priceW - 12
    if (dotEnd > dotStart) {
      ctx.fillStyle = 'rgba(23,18,16,0.35)'
      for (let dx = dotStart; dx < dotEnd; dx += 13) {
        ctx.beginPath()
        ctx.arc(dx, nameY - 8, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (item.note) {
      ctx.fillStyle = MIST
      ctx.font = '500 17px "Martian Mono", monospace'
      ctx.fillText(item.note.toUpperCase(), nameX, rowY + rowH * 0.84)
    }
    ctx.strokeStyle = 'rgba(23,18,16,0.14)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(48, rowY + rowH - 5)
    ctx.lineTo(TEX_W - 48, rowY + rowH - 5)
    ctx.stroke()
  })

  ctx.fillStyle = MIST
  ctx.font = '500 18px "Martian Mono", monospace'
  ctx.fillText('PRIX EN EUROS, TAXES COMPRISES', 48, TEX_H - 52)
}

function drawClosingPage(ctx: CanvasRenderingContext2D, page: Extract<HandPage, { kind: 'closing' }>) {
  paperBase(ctx)
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = '700 54px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif'
  ctx.fillText('ART DU', TEX_W / 2, 300)
  ctx.fillText('RENDEZ-VOUS', TEX_W / 2, 368)
  ctx.fillStyle = GOLD
  ctx.font = 'italic 400 62px "Bodoni Moda Variable", "Bodoni Moda", Georgia, serif'
  ctx.fillText('Café', TEX_W / 2, 452)
  ctx.fillStyle = 'rgba(23,18,16,0.75)'
  ctx.font = '400 23px "Albert Sans Variable", "Albert Sans", sans-serif'
  ctx.fillText('Rue de Malines 21, 1000 Bruxelles, Belgium', TEX_W / 2, 540)
  ctx.fillStyle = AMBER_DARK
  ctx.font = '500 21px "Martian Mono", monospace'
  ctx.fillText('MERCI — À BIENTÔT', TEX_W / 2, 620)
  void page
}

function drawHandPage(canvas: HTMLCanvasElement, page: HandPage) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, TEX_W, TEX_H)
  switch (page.kind) {
    case 'title':
      drawTitlePage(ctx, page)
      break
    case 'items':
      drawItemsPage(ctx, page)
      break
    case 'closing':
      drawClosingPage(ctx, page)
      break
  }
}

function buildSpreads(category: MenuCategory): HandBookSpread[] {
  const index = MENU.indexOf(category)
  const pages: HandPage[] = [{ kind: 'title', category, index }]
  for (let i = 0; i < category.items.length; i += ITEMS_PER_PAGE) {
    pages.push({
      kind: 'items',
      category,
      items: category.items.slice(i, i + ITEMS_PER_PAGE),
      startNo: i,
      index,
    })
  }
  if (pages.length % 2 === 1) pages.push({ kind: 'closing', category })
  const spreads: HandBookSpread[] = []
  for (let i = 0; i < pages.length; i += 2) {
    const left = document.createElement('canvas')
    left.width = TEX_W
    left.height = TEX_H
    drawHandPage(left, pages[i])
    const right = document.createElement('canvas')
    right.width = TEX_W
    right.height = TEX_H
    drawHandPage(right, pages[i + 1])
    spreads.push({ left, right })
  }
  return spreads
}

export interface HandBookRig {
  group: THREE.Group
  /**
   * The CLOSED book she would carry at her side when idle — one page
   * wide (13 cm), green cover out, gold spine. Fix pass 6: it is built
   * but NEVER SHOWN (VrmModel sets carry.visible = false every frame).
   * At rest it read as a flat half-green billboard hanging below her
   * hand — the open spread is 26 cm wide even with its cover shut (the
   * cover only covers the right page, the left page stays bare paper),
   * so showing the spread at rest reads as a flat slab at her hip, and
   * the closed carry reads no better. Hands empty at idle beats a
   * slab; the open spread during reading is the book that matters.
   */
  carry: THREE.Group
  coverPivot: THREE.Group
  flipPivot: THREE.Group
  spreadCount: number
  /** Re-render all page textures for a category and open at spread 0. */
  setSpreadsForCategory: (categoryId: string) => void
  /** Show spread i on the static pages + the flip leaf. */
  showSpread: (i: number) => void
  /** Swap the static right page to spread i (mid-flip, leaf hides it). */
  setRightPage: (i: number) => void
  /** Swap the static left page to spread i (flip just landed). */
  setLeftPage: (i: number) => void
  dispose: () => void
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function blankPageTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, TEX_W, TEX_H)
  }
  return canvasTexture(canvas)
}

/**
 * Build the prop. Local axes: X = page width (spine at x = 0, right page
 * +X), Y = page height, Z = thickness (front cover faces +Z, the camera).
 * The front cover pivots on the spine (rotation.y 0 = closed over the
 * right page, ≈ +2.6 = open, swung behind the left page); the flip leaf
 * pivots the same way (0 = lying on the right page, -π = turned left).
 */
export function createHandBook(): HandBookRig {
  const W = HAND_BOOK_PAGE_W
  const H = HAND_BOOK_PAGE_H
  const T = HAND_BOOK_THICKNESS

  const group = new THREE.Group()
  const coverMat = new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.55, metalness: 0.05 })
  const pageMat = new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.9 })
  const goldMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 0.7 })

  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = group) => {
    mesh.frustumCulled = false
    parent.add(mesh)
    return mesh
  }

  // Back cover under the whole open spread.
  const backCover = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, 0.003), coverMat)
  backCover.position.set(0, 0, -T / 2 + 0.0015)
  add(backCover)

  // Page blocks under each page of the spread.
  for (const side of [1, -1]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(W - 0.004, H - 0.004, 0.01), pageMat)
    block.position.set((side * W) / 2, 0, 0)
    add(block)
    // Gold fore-edge on each block.
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.0015, H - 0.004, 0.008), goldMat)
    edge.position.set(side * (W - 0.002), 0, 0)
    add(edge)
  }

  // Gold spine strip.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.006, H + 0.002, T + 0.002), goldMat)
  spine.position.set(0, 0, 0)
  add(spine)

  // Static page faces.
  const leftPageMat = new THREE.MeshBasicMaterial({ map: blankPageTexture() })
  const rightPageMat = new THREE.MeshBasicMaterial({ map: blankPageTexture() })
  const leftPage = new THREE.Mesh(new THREE.PlaneGeometry(W, H), leftPageMat)
  leftPage.position.set(-W / 2, 0, 0.0055)
  add(leftPage)
  const rightPage = new THREE.Mesh(new THREE.PlaneGeometry(W, H), rightPageMat)
  rightPage.position.set(W / 2, 0, 0.0055)
  add(rightPage)

  // Front cover, pivoted on the spine. It swings BEHIND the book
  // (rotation.y +2.6): at +90° it is edge-on, at +149° it lies behind
  // the left page, hidden from the front camera — the open spread stays
  // readable. The wrong sign (-2.6) would swing it toward the camera
  // and park the green cover in front of the left page.
  const coverPivot = new THREE.Group()
  coverPivot.position.set(0, 0, 0.0055)
  group.add(coverPivot)
  const cover = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.003), coverMat)
  cover.position.set(W / 2, 0, 0)
  cover.frustumCulled = false
  coverPivot.add(cover)

  // Flip leaf, pivoted on the spine: front = current right page,
  // back (rotated π) = next spread's left page.
  const flipPivot = new THREE.Group()
  flipPivot.position.set(0, 0, 0.0062)
  group.add(flipPivot)
  const flipFrontMat = new THREE.MeshBasicMaterial({ map: blankPageTexture() })
  const flipBackMat = new THREE.MeshBasicMaterial({ map: blankPageTexture() })
  const flipFront = new THREE.Mesh(new THREE.PlaneGeometry(W, H), flipFrontMat)
  flipFront.position.set(W / 2, 0, 0.0004)
  flipFront.frustumCulled = false
  flipPivot.add(flipFront)
  const flipBack = new THREE.Mesh(new THREE.PlaneGeometry(W, H), flipBackMat)
  flipBack.position.set(W / 2, 0, -0.0004)
  flipBack.rotation.y = Math.PI
  flipBack.frustumCulled = false
  flipPivot.add(flipBack)

  // Closed carry book (see the `carry` field above): back cover +
  // paper block + front cover + gold spine and fore-edge, origin at
  // its centre — the same convention as the open spread, so the loop
  // can drive both props from one hand-relative centre.
  const carry = new THREE.Group()
  const carryBack = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.0025), coverMat)
  carryBack.position.set(0, 0, -T / 2 + 0.0012)
  carryBack.frustumCulled = false
  carry.add(carryBack)
  const carryBlock = new THREE.Mesh(new THREE.BoxGeometry(W - 0.006, H - 0.006, T - 0.005), pageMat)
  carryBlock.position.set(0.001, 0, 0)
  carryBlock.frustumCulled = false
  carry.add(carryBlock)
  const carryFront = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.0025), coverMat)
  carryFront.position.set(0, 0, T / 2 - 0.0012)
  carryFront.frustumCulled = false
  carry.add(carryFront)
  const carrySpine = new THREE.Mesh(new THREE.BoxGeometry(0.006, H + 0.001, T + 0.001), goldMat)
  carrySpine.position.set(-W / 2 + 0.003, 0, 0)
  carrySpine.frustumCulled = false
  carry.add(carrySpine)
  const carryEdge = new THREE.Mesh(new THREE.BoxGeometry(0.0015, H - 0.006, T - 0.005), goldMat)
  carryEdge.position.set(W / 2 - 0.002, 0, 0)
  carryEdge.frustumCulled = false
  carry.add(carryEdge)

  let spreads: { left: THREE.CanvasTexture; right: THREE.CanvasTexture }[] = []
  let current = 0

  const applyMaps = () => {
    const s = spreads[current]
    if (!s) return
    const next = spreads[Math.min(current + 1, spreads.length - 1)]
    leftPageMat.map = s.left
    rightPageMat.map = s.right
    flipFrontMat.map = s.right
    flipBackMat.map = next.left
    leftPageMat.needsUpdate = true
    rightPageMat.needsUpdate = true
    flipFrontMat.needsUpdate = true
    flipBackMat.needsUpdate = true
  }

  const rig: HandBookRig = {
    group,
    carry,
    coverPivot,
    flipPivot,
    spreadCount: 0,
    setSpreadsForCategory(categoryId: string) {
      const category = MENU.find((c) => c.id === categoryId) ?? MENU[0]
      spreads.forEach((s) => {
        s.left.dispose()
        s.right.dispose()
      })
      spreads = buildSpreads(category).map((s) => ({
        left: canvasTexture(s.left),
        right: canvasTexture(s.right),
      }))
      rig.spreadCount = spreads.length
      current = 0
      flipPivot.rotation.y = 0
      applyMaps()
    },
    showSpread(i: number) {
      if (spreads.length === 0) return
      current = THREE.MathUtils.clamp(i, 0, spreads.length - 1)
      applyMaps()
    },
    setRightPage(i: number) {
      const s = spreads[THREE.MathUtils.clamp(i, 0, spreads.length - 1)]
      if (!s) return
      rightPageMat.map = s.right
      rightPageMat.needsUpdate = true
    },
    setLeftPage(i: number) {
      const s = spreads[THREE.MathUtils.clamp(i, 0, spreads.length - 1)]
      if (!s) return
      leftPageMat.map = s.left
      leftPageMat.needsUpdate = true
    },
    dispose() {
      spreads.forEach((s) => {
        s.left.dispose()
        s.right.dispose()
      })
      spreads = []
      group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
          const disposeMat = (m: THREE.Material) => {
            const basic = m as THREE.MeshBasicMaterial
            basic.map?.dispose()
            m.dispose()
          }
          if (Array.isArray(mat)) mat.forEach(disposeMat)
          else if (mat) disposeMat(mat)
        }
      })
      carry.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose()
        }
      })
    },
  }
  return rig
}
