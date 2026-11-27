"""Generates the README screenshots (docs/screens/) in a headless Chrome, with sample data, in English.

Run:  python tools/screenshots.py
"""
import sys
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tests"))
from _server import ROOT, start_server  # noqa: E402

OUT = ROOT / "docs" / "screens"
OUT.mkdir(parents=True, exist_ok=True)
srv, URL = start_server()

now = int(time.time() * 1000)
DAY = 86400000


def review(i, deck, front, back, due_in_days, stability):
    return {"id": f"r{deck}{i}", "deckId": deck, "front": front, "back": back, "created": i, "state": "review",
            "s": stability, "d": 5, "reps": 3, "due": now + due_in_days * DAY, "last": now - DAY}


cards = [
    {"id": "n1", "deckId": "jp", "front": "Watashi", "frontSub": "わたし", "back": "I (neutral, polite)", "created": 100, "state": "new"},
    {"id": "n2", "deckId": "jp", "front": "Arigatou", "back": "Thank you", "created": 101, "state": "new"},
    {"id": "n3", "deckId": "es", "front": "I'm short on time today", "back": "Hoy tengo poco tiempo", "created": 102, "state": "new"},
]
for i, (f, sub, b) in enumerate([("Taberu", "たべる", "To eat"), ("Nomu", "のむ", "To drink"), ("Iku", "いく", "To go"),
                                 ("Miru", "みる", "To see"), ("Kaku", "かく", "To write")]):
    cards.append({**review(i, "jp", f, b, [-1, -1, 1, 2, 4][i], 3), "frontSub": sub})
for i, (f, b) in enumerate([("The invoice is overdue", "La factura está vencida"), ("I agree", "Estoy de acuerdo"),
                            ("Let's schedule a meeting", "Programemos una reunión"), ("It depends on the client", "Depende del cliente")]):
    cards.append(review(i, "es", f, b, [-1, 1, 3, 5][i], 4))

DATA = {"decks": [{"id": "jp", "name": "Japanese"}, {"id": "es", "name": "Spanish"}], "cards": cards,
        "days": {}, "settings": {"newPerDay": 10, "retention": 0.9, "lang": "en"}}
today = (now - 4 * 3600000 - 3 * 3600000) // DAY
for k in range(5):
    DATA["days"][str(today - k)] = 20
SEED = f"if (!localStorage.getItem('fixa.v1')) localStorage.setItem('fixa.v1', {json.dumps(json.dumps(DATA))});"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Language picker, as a Brazilian phone sees it on first run
    pg = browser.new_context(viewport={"width": 390, "height": 760}, device_scale_factor=2, locale="pt-BR").new_page()
    pg.goto(URL)
    pg.wait_for_selector("#welcome:not([hidden])")
    pg.screenshot(path=str(OUT / "welcome.png"))

    for theme in ("light", "dark"):
        ctx = browser.new_context(viewport={"width": 390, "height": 760}, device_scale_factor=2, locale="en-US",
                                  timezone_id="America/Sao_Paulo", color_scheme=theme, reduced_motion="no-preference")
        pg = ctx.new_page()
        pg.add_init_script(SEED)
        pg.goto(URL)
        pg.wait_for_selector("#v-home:not([hidden])")
        pg.wait_for_timeout(300)
        if theme == "dark":
            pg.screenshot(path=str(OUT / "home-dark.png"))
            continue
        pg.screenshot(path=str(OUT / "home.png"))
        pg.click("[data-deck] >> text=Japanese")
        pg.wait_for_selector("#v-study:not([hidden])")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(OUT / "front.png"))
        pg.click("#front")
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(OUT / "back.png"))
        pg.click("[data-r='3']")
        pg.wait_for_timeout(110)
        pg.screenshot(path=str(OUT / "remembered.png"))
        # finish the session to show the end screen
        while True:
            pg.wait_for_timeout(450)
            if pg.is_visible("#done"):
                break
            pg.click("#front")
            pg.wait_for_timeout(650)
            pg.click("[data-r='3']")
            for _ in range(40):  # wait for the end screen, to catch the confetti at its peak
                pg.wait_for_timeout(25)
                if pg.is_visible("#done"):
                    break
            if pg.is_visible("#done"):
                break
        pg.wait_for_timeout(380)
        pg.screenshot(path=str(OUT / "done.png"))
        # free practice, from the end screen
        pg.wait_for_timeout(1500)
        pg.click("#done-practice")
        pg.wait_for_selector("#v-study:not([hidden])")
        pg.wait_for_timeout(400)
        pg.click("#front")
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(OUT / "practice.png"))
        ctx.close()
    browser.close()
srv.shutdown()
print("screenshots in", OUT)
