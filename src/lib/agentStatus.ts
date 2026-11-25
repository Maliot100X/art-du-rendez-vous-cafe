/**
 * FIX PASS 16, GROUP 3 — single source of truth for agent status.
 *
 * ROOT CAUSE (fix-15 pixel check, 22:01–22:10 CET): THREE different
 * truths about the brain existed at once.
 *   - Agent.tsx kept its OWN `useState(false)` brainLive, flipped only
 *     by its own chat send(). App.tsx mounts only the active tab, so
 *     leaving the Agent tab unmounted the component and its state
 *     reset to false — the pill reverted to "chat disponible" on every
 *     return, even though the brain had already answered live.
 *   - MenuGuide.tsx (LA CARTE banner) kept a SECOND, separate
 *     `useState(false)` brainLive, flipped only by its own mini-chat
 *     sends. A live reply in the Agent chat never reached it, so the
 *     banner kept saying "Deepgram et le cerveau LLM sont hors ligne"
 *     while the pill said the brain was connected.
 *   - brain.ts already had a module-level `brainLive` flag + the
 *     brainWasLive() getter — the truth existed, but NO component
 *     ever read it. Each surface re-derived its own copy instead.
 *
 * This store is the one place the truth lives. It follows the same
 * pattern as the fix-14 reading store (src/lib/readingStore.ts):
 * module-level state + subscription, outliving every tab-shell
 * unmount, so a brain that went live stays live for the session.
 *
 * Rules:
 * - brainLive is STICKY and session-scoped: it flips to true only
 *   when the LLM brain has actually answered (brain.ts calls
 *   markBrainLive() on a successful askBrain() call) and there is NO
 *   reset path — no component, tab switch or remount can turn it back
 *   off. A full page reload still resets it.
 * - voiceLive is the Deepgram voice-call state (live/connecting vs
 *   idle/ended), written ONLY by the Agent tab, which owns the voice
 *   client (src/lib/voiceAgent.ts). It is NOT sticky: a call ending
 *   (or the Agent tab unmounting and stopping the client) clears it.
 *   It lives here rather than in Agent's local state so any surface
 *   that needs it reads the same value instead of a second copy.
 * - No React, no window access at import time and no imports except
 *   React's useSyncExternalStore, so this module is importable from a
 *   plain node probe (see scripts/fix16-status-probe.mjs).
 */

import { useSyncExternalStore } from 'react'

export interface AgentStatus {
  /** True only after the LLM brain has answered live at least once. */
  brainLive: boolean
  /** True while a Deepgram voice call is live or connecting. */
  voiceLive: boolean
}

type Listener = () => void

const listeners = new Set<Listener>()

/** The single snapshot every surface reads. Replaced, never mutated,
    so useSyncExternalStore's getSnapshot stays referentially stable
    between changes. */
let snapshot: AgentStatus = { brainLive: false, voiceLive: false }

function notify(): void {
  listeners.forEach((cb) => {
    try {
      cb()
    } catch {
      // A failing subscriber must never break the store for the rest.
    }
  })
}

function subscribe(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): AgentStatus {
  return snapshot
}

/** Current status — what a freshly mounted surface reads first. */
export function getAgentStatus(): AgentStatus {
  return snapshot
}

/**
 * Mark the brain live. Called ONLY by src/lib/brain.ts on a
 * successful LLM call. Sticky: once true it never goes back to false
 * in this page lifetime — there is deliberately no unmark/reset.
 */
export function markBrainLive(): void {
  if (snapshot.brainLive) return
  snapshot = { ...snapshot, brainLive: true }
  notify()
}

/**
 * Set the voice-call state. Called ONLY by the Agent tab from the
 * voice client's onStatus (live/connecting → true, anything else →
 * false) and from stopVoice / unmount cleanup.
 */
export function setVoiceLive(live: boolean): void {
  if (snapshot.voiceLive === live) return
  snapshot = { ...snapshot, voiceLive: live }
  notify()
}

/**
 * React hook — every status surface (Agent pill, LA CARTE banner,
 * chat hint) reads through this, so they can never disagree and a
 * remount re-reads the same session truth instead of a fresh false.
 */
export function useAgentStatus(): AgentStatus {
  return useSyncExternalStore(subscribe, getSnapshot)
}
