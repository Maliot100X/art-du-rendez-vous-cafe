import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation'
import type { VRM } from '@pixiv/three-vrm'

/**
 * Real VRM animation clips for Vita (fix pass 11) — open-vrma, CC0.
 *
 * Source: Hugging Face dataset Sanami/open-vrma — the Quaternius
 * Universal Animation Library converted to .vrma. Licence per clip:
 * CC0-1.0, attribution in each clip's .motion.json
 * ("Universal Animation Library by Quaternius (CC0 1.0)"); the credit
 * line is also rendered in the site footer (FOOTER.animCredit).
 * The clips live in public/vrma/ — the four CC0 files ONLY. The VRoid
 * motion pack (vroid/) is NOT shipped: its terms prohibit
 * distributing the motions in a way that can be rigged or extracted,
 * and a raw .vrma served from public/ is downloadable. Local testing
 * only for that pack.
 *
 * All four clips are body-only (humanoid bone tracks, 52 bones; no
 * expression/morph tracks, no lookAt track) — so the viseme lip-sync
 * in VrmModel.tsx keeps driving the mouth, and the clips never fight
 * it. VRMA is a VRM 1.0 spec, but three-vrm-animation retargets by
 * humanoid bone name, and airi plays .vrma clips on VRM 0.x avatars —
 * Vita is VRM 0.x and the same retarget applies here.
 *
 * Loading is once per page lifetime (module-level promise, same
 * pattern as vrmCache): the VRM object is shared across mounts, and
 * createVRMAnimationClip binds the tracks to that VRM's normalized
 * bone nodes, so one set of clips serves every mount. A failure
 * (missing file, bad parse) resolves to null and VrmModel falls back
 * to its procedural walk/idle/reading — the site must never break
 * because a clip failed.
 */

export type VrmClipName = 'idle' | 'talking' | 'walk' | 'walkCarry'

export type VrmClips = Record<VrmClipName, THREE.AnimationClip>

const CLIP_URLS: Record<VrmClipName, string> = {
  idle: '/vrma/Idle_Loop.vrma',
  talking: '/vrma/Idle_Talking_Loop.vrma',
  walk: '/vrma/Walk_Loop.vrma',
  walkCarry: '/vrma/Walk_Carry_Loop.vrma',
}

let clipsPromise: Promise<VrmClips | null> | null = null

async function loadOne(
  loader: GLTFLoader,
  url: string,
  vrm: VRM,
): Promise<THREE.AnimationClip> {
  const gltf = await loader.loadAsync(url)
  const anim = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0]
  if (!anim) throw new Error(`No VRMAnimation in ${url}`)
  return createVRMAnimationClip(anim, vrm)
}

/**
 * Load + retarget the four clips onto `vrm`, or null on any failure.
 * Also ensures the VRMLookAtQuaternionProxy exists as a direct child
 * of vrm.scene (createVRMAnimationClip warns without one when a clip
 * carries a lookAt track; ours carry none, but the proxy is the
 * documented setup and costs nothing — it only applies when rotated).
 */
export function loadVrmClips(vrm: VRM): Promise<VrmClips | null> {
  if (!clipsPromise) {
    clipsPromise = (async () => {
      try {
        if (
          vrm.lookAt &&
          !vrm.scene.children.some((o) => o instanceof VRMLookAtQuaternionProxy)
        ) {
          const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
          proxy.name = 'VRMLookAtQuaternionProxy'
          vrm.scene.add(proxy)
        }
        const loader = new GLTFLoader()
        loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
        const entries = await Promise.all(
          (Object.keys(CLIP_URLS) as VrmClipName[]).map(
            async (name) => [name, await loadOne(loader, CLIP_URLS[name], vrm)] as const,
          ),
        )
        const out = {} as VrmClips
        for (const [name, clip] of entries) out[name] = clip
        return out
      } catch (err) {
        console.warn('[vrmClips] VRMA clips failed to load — procedural motion stays on:', err)
        return null
      }
    })()
  }
  return clipsPromise
}
