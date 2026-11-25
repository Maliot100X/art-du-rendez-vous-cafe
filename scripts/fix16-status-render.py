#!/usr/bin/env python3
"""FIX PASS 16, GROUP 3 — rendered check (headless Chromium, Playwright).

Run by scripts/fix16-status-probe.mjs against a probe-only build that
has a DUMMY LLM key baked in (VITE_LLM_API_KEY=probe-dummy-key) and is
served locally. The LLM endpoint is INTERCEPTED here and answered with
a canned reply, so no real key and no network are involved — but the
page under test is the REAL built site, with the REAL Agent chat,
pill and LA CARTE banner.

Asserts, in order:
  0. Fresh load, offline agreement: the Agent pill says the chat is
     available and the LA CARTE banner says the brain is offline.
  (a) After one live brain reply (intercepted LLM call), the Agent
      pill AND the LA CARTE banner AND the chat hint all report
      connected — one truth, three surfaces.
  (b) After tab navigation away (LA CARTE -> Accueil -> Agent) the
      pill still says connected — no revert on remount.
  (c) The rendered page contains no "en direct" (any case) anywhere
      in its visible text, before or after going live.

Usage: python3 scripts/fix16-status-render.py <base-url>
Exit 0 = all rendered checks pass; exit 1 = any failure.
"""
import re
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/")
LLM_TEXT = "Bien sûr ! Pour un vin rouge, je vous conseille le Bordeaux 75 CL à 9,00 €."

failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def body_text(page):
    return page.evaluate("() => document.body.innerText")


def no_en_direct(page, where):
    text = body_text(page)
    hits = [m for m in re.finditer(r"en direct", text, re.IGNORECASE)]
    check(f'no "en direct" in rendered text ({where})', len(hits) == 0,
          f"{len(hits)} hit(s)" if hits else "")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    # The brain calls the LLM endpoint only when a key is configured
    # (the probe build bakes in a dummy one). Intercept it and answer
    # with a canned LLM reply — the page believes the brain is live.
    llm_calls = []

    def handle_llm(route):
        llm_calls.append(route.request.url)
        route.fulfill(
            status=200,
            content_type="application/json",
            body='{"choices": [{"message": {"role": "assistant", "content": "%s"}, "finish_reason": "stop"}]}'
            % LLM_TEXT.replace('"', '\\"'),
        )

    page.route("**/chat/completions", handle_llm)

    page.goto(BASE + "/#agent", wait_until="networkidle")
    # The Agent tab is a lazy chunk (Live2D + Cubism init is slow):
    # wait for the pill to exist instead of a fixed sleep.
    try:
        page.get_by_text("chat disponible").first.wait_for(timeout=20000)
        pill_offline = True
    except Exception:
        pill_offline = False
    # 0. Offline agreement on a fresh load (before any chat).
    check("fresh load: Agent pill says chat available (offline)", pill_offline)
    check("fresh load: status hint visible (brain offline)",
          page.get_by_text("se branchent bientôt").first.is_visible())
    no_en_direct(page, "fresh load, Agent tab")

    # Go to LA CARTE and check the banner agrees (offline).
    page.locator('[role="tab"]:visible', has_text="La Carte").first.click(force=True)
    try:
        page.get_by_text("sont hors ligne").first.wait_for(timeout=10000)
        banner_offline = True
    except Exception:
        banner_offline = False
    check("fresh load: LA CARTE banner says brain offline", banner_offline)
    no_en_direct(page, "fresh load, LA CARTE tab")

    # (a) One live brain reply in the Agent chat.
    page.locator('[role="tab"]:visible', has_text="Agent").first.click(force=True)
    page.wait_for_timeout(800)
    chat_input = page.get_by_placeholder("Écrivez ici")
    check("Agent chat input present", chat_input.is_visible())
    chat_input.fill("quel vin rouge conseilles-tu ?")
    page.get_by_role("button", name="Envoyer").click()
    try:
        page.get_by_text("Cerveau connecté").first.wait_for(timeout=15000)
        pill_live = True
    except Exception:
        pill_live = False
    check("after live reply: Agent pill says 'Cerveau connecté'", pill_live)
    check("after live reply: exactly one LLM call was made",
          len(llm_calls) == 1, f"{len(llm_calls)} call(s)")
    check("after live reply: LLM reply text shown in chat",
          page.get_by_text("Bordeaux 75 CL").first.is_visible())
    check("after live reply: offline status hint is gone",
          page.get_by_text("se branchent bientôt").count() == 0)
    no_en_direct(page, "live, Agent tab")

    # (a, continued) The LA CARTE banner agrees — same session, no
    # new chat needed on that tab.
    page.locator('[role="tab"]:visible', has_text="La Carte").first.click(force=True)
    page.wait_for_timeout(800)
    try:
        page.get_by_text("Cerveau LLM en ligne").first.wait_for(timeout=5000)
        banner_live = True
    except Exception:
        banner_live = False
    check("after live reply: LA CARTE banner says brain is live", banner_live)
    check("after live reply: banner no longer says hors ligne",
          page.get_by_text("sont hors ligne").count() == 0)
    no_en_direct(page, "live, LA CARTE tab")

    # (b) Tab navigation away and back — the connected state persists.
    page.locator('[role="tab"]:visible', has_text="Accueil").first.click(force=True)
    page.wait_for_timeout(800)
    page.locator('[role="tab"]:visible', has_text="Agent").first.click(force=True)
    page.wait_for_timeout(800)
    try:
        page.get_by_text("Cerveau connecté").first.wait_for(timeout=5000)
        pill_still_live = True
    except Exception:
        pill_still_live = False
    check("after tab navigation away and back: pill STILL says 'Cerveau connecté'",
          pill_still_live)
    check("after tab navigation: pill does NOT revert to offline",
          page.get_by_text("chat disponible").count() == 0)
    no_en_direct(page, "live after navigation, Agent tab")

    browser.close()

print("\nALL RENDERED CHECKS PASSED" if not failures else f"\n{len(failures)} RENDERED CHECK(S) FAILED")
sys.exit(0 if not failures else 1)
