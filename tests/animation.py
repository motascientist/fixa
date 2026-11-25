"""Checks the study animations (flip, rate, finish) with motion ON, and that they disappear with motion reduced.

Run:  python tests/animation.py [screenshot-folder]
"""
import sys
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from _server import ROOT, start_server, Checks

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tests" / "_shots"
SHOTS.mkdir(parents=True, exist_ok=True)

srv, URL = start_server()
check = Checks()
errors = []

DATA = {
    "decks": [{"id": "d1", "name": "Japanese"}],
    "cards": [
        {"id": "c1", "deckId": "d1", "front": "Watashi", "back": "I (neutral, polite)", "created": 1, "state": "new"},
        {"id": "c2", "deckId": "d1", "front": "Arigatou", "back": "Thank you", "created": 2, "state": "new"},
    ],
    "days": {}, "settings": {"newPerDay": 10, "retention": 0.9, "lang": "en"},
}
SEED = f"if (!localStorage.getItem('fixa.v1')) localStorage.setItem('fixa.v1', {json.dumps(json.dumps(DATA))});"
RUNNING = "document.getAnimations().filter(a => a.playState === 'running').length"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # 1) Motion on
    pg = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, reduced_motion="no-preference").new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script(SEED)
    pg.goto(URL)
    pg.click("#start-all")
    pg.wait_for_selector("#v-study:not([hidden])")
    pg.wait_for_timeout(400)

    pg.click("#front")
    pg.wait_for_timeout(60)
    check("flip: the card is turning", pg.evaluate(RUNNING) > 0)
    check("flip: ratings still hidden mid-turn", not pg.is_visible("#grade"))
    pg.wait_for_timeout(130)
    pg.screenshot(path=str(SHOTS / "anim-1-flipping.png"))
    pg.wait_for_timeout(500)
    check("flip: answer shows at the end", pg.is_visible("#answer") and pg.is_visible("#grade"))

    pg.click("[data-r='3']")
    pg.wait_for_timeout(120)
    labels = pg.locator(".float-label").all_inner_texts()
    check(f"Remembered: '+2 days' rises from the button ({labels})", labels == ["+2 days"])
    check("Remembered: the card leaves animated", pg.evaluate(RUNNING) > 0)
    pg.screenshot(path=str(SHOTS / "anim-2-remembered.png"))
    pg.wait_for_timeout(500)
    check("next card enters and is fully visible", pg.inner_text("#front") == "Arigatou"
          and pg.evaluate("getComputedStyle(document.querySelector('#flash')).opacity") == "1")

    pg.click("#front")
    pg.wait_for_timeout(600)
    pg.keyboard.press("1")  # Forgot, by keyboard
    pg.keyboard.press("1")  # pressed again mid-animation: must not count twice
    pg.wait_for_timeout(80)
    check("Forgot: '↺ 1 min' rises from the button", "↺ 1 min" in pg.locator(".float-label").all_inner_texts())
    pg.wait_for_timeout(500)
    check("a key repeated mid-animation does not count", pg.evaluate("db.cards.find(c => c.id === 'c2').reps") == 1)

    pg.click("#front")
    pg.wait_for_timeout(600)
    pg.click("[data-r='4']")
    pg.wait_for_timeout(500)
    check("finish: done screen", pg.is_visible("#done"))
    check("finish: confetti", pg.locator(".confetti").count() > 0)
    pg.wait_for_timeout(250)
    pg.screenshot(path=str(SHOTS / "anim-3-confetti.png"))
    pg.wait_for_timeout(1500)
    check("confetti cleans itself up", pg.locator(".confetti").count() == 0 and pg.locator(".float-label").count() == 0)

    # 2) Users who turn motion off in the system see no animation at all
    pg2 = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce").new_page()
    pg2.on("pageerror", lambda e: errors.append(str(e)))
    pg2.add_init_script(SEED)
    pg2.goto(URL)
    pg2.click("#start-all")
    pg2.wait_for_selector("#v-study:not([hidden])")
    pg2.click("#front")
    check("reduced motion: answer shows at once, no turn", pg2.is_visible("#grade") and pg2.evaluate(RUNNING) == 0)
    pg2.wait_for_timeout(400)
    pg2.click("[data-r='3']")
    check("reduced motion: nothing floats", pg2.locator(".float-label").count() == 0)
    browser.close()

srv.shutdown()
check(f"no console errors {errors}", not errors)
sys.exit(check.exit_code)
