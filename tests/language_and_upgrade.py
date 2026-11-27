"""Language picker, live language switch, and upgrade from data saved by v0.1.0.

Run:  python tests/language_and_upgrade.py
"""
import sys
import json
from playwright.sync_api import sync_playwright
from _server import start_server, Checks

srv, URL = start_server()
check = Checks()
errors = []

# Data exactly as v0.1.0 saved it: the media field was called "midia", there was no language setting,
# and the media lived in an IndexedDB database named "fixa-midia".
LEGACY = {
    "decks": [{"id": "d1", "name": "Japonês", "lang": "ja-JP", "vozLado": "front"}],
    "cards": [{"id": "c1", "deckId": "d1", "front": "Watashi", "back": "Eu", "created": 1, "state": "new",
               "midia": {"front": {"img": "img1"}, "back": {}}}],
    "days": {}, "settings": {"newPerDay": 10, "retention": 0.9, "maxReviews": 200},
}
SEED_LEGACY = f"""
if (!localStorage.getItem('fixa.v1')) {{
  localStorage.setItem('fixa.v1', {json.dumps(json.dumps(LEGACY))});
  const r = indexedDB.open('fixa-midia', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('m');
  r.onsuccess = () => {{
    const tx = r.result.transaction('m', 'readwrite');
    tx.objectStore('m').put(new Blob(['legacy image bytes'], {{ type: 'image/png' }}), 'img1');
    tx.oncomplete = () => {{ r.result.close(); window.__legacySeeded = true; }};
  }};
}} else {{ window.__legacySeeded = true; }}
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # 1) A Brazilian phone: the question comes in Portuguese
    pg = browser.new_context(locale="pt-BR", viewport={"width": 390, "height": 844}).new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector("#welcome:not([hidden])")
    check("pt-BR phone: question in Portuguese", pg.inner_text(".welcome-title") == "Qual é o seu idioma?")
    pg.click("[data-lang=pt]")
    pg.wait_for_selector("#v-home:not([hidden])")
    check("chose Português: interface in Portuguese", pg.inner_text("#start-all") == "Criar baralho" and pg.inner_text("a[data-tab=settings]") == "Ajustes")
    check("page language follows the choice", pg.evaluate("document.documentElement.lang") == "pt-BR")
    pg.reload()
    pg.wait_for_selector("#v-home:not([hidden])")
    check("question is asked only once", not pg.is_visible("#welcome"))

    # 2) Switch to English in Settings: everything changes at once, no reload
    pg.click("a[data-tab=settings]")
    pg.wait_for_selector("#v-settings:not([hidden])")
    pg.select_option("#set-lang", "en")
    check("switching in Settings changes the screen", pg.inner_text("#v-settings h1") == "Settings" and pg.inner_text("a[data-tab=home]") == "Home")
    pg.click("a[data-tab=home]")
    pg.wait_for_selector("#v-home:not([hidden])")
    check("…and the other screens", pg.inner_text("#start-all") == "Create deck")

    # 3) A US phone that picks Portuguese anyway
    pg2 = browser.new_context(locale="en-US").new_page()
    pg2.on("pageerror", lambda e: errors.append(str(e)))
    pg2.goto(URL)
    pg2.wait_for_selector("#welcome:not([hidden])")
    check("en-US phone: question in English", pg2.inner_text(".welcome-title") == "What's your language?")
    pg2.click("[data-lang=pt]")
    check("the choice wins over the phone language", pg2.inner_text("#start-all") == "Criar baralho")

    # 4) Upgrade from v0.1.0 data: nothing is lost
    pg3 = browser.new_context(locale="pt-BR").new_page()
    pg3.on("pageerror", lambda e: errors.append(str(e)))
    pg3.add_init_script(SEED_LEGACY)
    pg3.goto(URL)
    pg3.wait_for_function("window.__legacySeeded === true")
    pg3.reload()  # the app now starts on top of the legacy data
    pg3.wait_for_selector("#welcome:not([hidden])")
    check("upgraded user is asked the language once", pg3.inner_text(".welcome-title") == "Qual é o seu idioma?")
    pg3.click("[data-lang=pt]")
    card = pg3.evaluate("db.cards[0]")
    check("card media field moved to the new name", card.get("media", {}).get("front", {}).get("img") == "img1" and "midia" not in card)
    check("old deck voice fields dropped", pg3.evaluate("db.decks[0]") == {"id": "d1", "name": "Japonês"})
    blob_size = pg3.evaluate("MediaStore.get('img1').then(b => b ? b.size : -1)")
    check(f"image moved from the old database ({blob_size} bytes)", blob_size == len("legacy image bytes"))
    pg3.wait_for_timeout(300)
    dbs = pg3.evaluate("indexedDB.databases().then(l => l.map(d => d.name).sort())")
    check(f"old database removed after the move {dbs}", dbs == ["fixa-media"])
    browser.close()

srv.shutdown()
check(f"no console errors {errors}", not errors)
sys.exit(check.exit_code)
