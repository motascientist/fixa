"""End-to-end test of Fixa in a headless Chrome (phone-sized), in English.

Starts a local server, picks the language, creates decks, pastes cards, studies, checks the numbers,
attaches media and takes screenshots.
Run:  python tests/flow.py [screenshot-folder]
"""
import sys
import json
import math
import wave
import struct
from pathlib import Path
from playwright.sync_api import sync_playwright
from _server import ROOT, start_server, Checks

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tests" / "_shots"
SHOTS.mkdir(parents=True, exist_ok=True)

CARDS = """#separator:tab
The invoice is overdue\tLa factura está vencida
I agree with you\tEstoy de acuerdo contigo
Let's schedule a meeting | Programemos una reunión
Could you send me the report? | ¿Me puedes enviar el informe?
It depends on the client | Depende del cliente
a line without a back
"""

srv, URL = start_server()
check = Checks()
errors = []


def tab(pg, name):
    pg.click(f"a[data-tab={name}]")
    pg.wait_for_selector(f"#v-{name}:not([hidden])")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=[
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(accept_downloads=True, reduced_motion="reduce", viewport={"width": 390, "height": 844},
                              device_scale_factor=2, locale="en-US", timezone_id="America/Sao_Paulo")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))

    # First run: language
    pg.goto(URL)
    pg.wait_for_selector("#welcome:not([hidden])")
    check("first run asks for the language, in the device language", pg.inner_text(".welcome-title") == "What's your language?")
    check("nothing else shows behind the language picker", not pg.is_visible("#tabbar") and not pg.is_visible("#v-home"))
    pg.screenshot(path=str(SHOTS / "0-welcome.png"))
    pg.click("[data-lang=en]")
    pg.wait_for_selector("#v-home:not([hidden])")
    check("choice is saved", pg.evaluate("db.settings.lang") == "en")

    # Empty start
    check("app starts with no deck", pg.evaluate("db.decks.length") == 0)
    check("empty home asks for a deck", "Create deck" in pg.inner_text("#start-all"))
    check("empty home shows no number or chart", not pg.is_visible("#today-n") and not pg.is_visible("#forecast") and not pg.is_visible("#sec-decks"))
    pg.screenshot(path=str(SHOTS / "1-home-empty.png"))
    tab(pg, "add")
    check("Add without a deck asks for one", pg.is_visible("#add-no-deck") and not pg.is_visible("#add-form"))
    pg.click("#add-create-deck")
    pg.fill("#deck-name", "Spanish")
    check("deck dialog only asks for a name", pg.locator("#deck-form select").count() == 0)
    pg.click("#deck-dialog button[value=ok]")
    pg.wait_for_selector("#add-form:not([hidden])")
    tab(pg, "home")
    pg.click("#new-deck")
    pg.fill("#deck-name", "Japanese")
    pg.click("#deck-dialog button[value=ok]")
    pg.wait_for_function("db.decks.length === 2")

    # Add one by one
    tab(pg, "add")
    pg.select_option("#add-deck", label="Spanish")
    pg.fill("#add-front", "I'm short on time today")
    pg.fill("#add-back", "Hoy tengo poco tiempo")
    pg.click("#add-form button[type=submit]")
    pg.wait_for_function("db.cards.length === 1")  # saving is async: wait for it instead of racing it
    check("card saved and fields cleared", pg.input_value("#add-front") == "")

    # Paste many (tab + pipe)
    pg.click("#bulk summary")
    pg.fill("#bulk-text", CARDS)
    pg.screenshot(path=str(SHOTS / "2-add.png"))
    pg.click("#bulk-add")
    pg.wait_for_function("db.cards.length >= 6")
    total = pg.evaluate("db.cards.length")
    check(f"6 cards in total (got {total})", total == 6)
    check("reports the line without a back", "1 line without a back" in pg.inner_text("#toast"))
    pg.fill("#bulk-text", "I agree with you\tEstoy de acuerdo contigo")
    pg.click("#bulk-add")
    check("duplicate skipped", pg.evaluate("db.cards.length") == 6)

    # Home with numbers
    tab(pg, "home")
    check("6 for today", pg.inner_text("#today-n") == "6")
    pg.screenshot(path=str(SHOTS / "3-home.png"))

    # Study
    pg.click("#start-all")
    pg.wait_for_selector("#v-study:not([hidden])")
    check("tab bar hides while studying", not pg.is_visible("#tabbar"))
    check("new card is marked", pg.is_visible("#flash-new"))
    check("card without audio has no speaker", not pg.is_visible(".play[data-face=front]"))
    box = pg.locator("#reveal").bounding_box()
    check("buttons pinned to the bottom of the screen", box["y"] + box["height"] > 844 - 110)
    pg.screenshot(path=str(SHOTS / "4-front.png"))
    pg.click("#front")  # tapping the card shows the answer
    check("tapping the card shows the answer", pg.is_visible("#answer"))
    pg.click("[data-r='3']")  # double tap: lands on the button that just appeared
    check("a double tap does not become a rating", pg.evaluate("db.cards.every(c => c.state === 'new')"))
    pg.wait_for_timeout(400)
    i3, i4 = pg.inner_text("#i3"), pg.inner_text("#i4")
    check(f"new card: Remembered = 2 days ({i3}), Easy = 8 days ({i4})", i3 == "in 2 days" and i4 == "in 8 days")
    pg.screenshot(path=str(SHOTS / "5-back.png"))

    pg.click("[data-r='1']")  # Forgot
    check("Forgot keeps it in the session (6 left)", pg.inner_text("#left") == "6 left")
    pg.click("#undo")
    check("Undo brings the same card back", pg.evaluate("db.cards.every(c => c.state === 'new')"))

    # Fix a typo without leaving the session
    pg.keyboard.press("e")
    pg.wait_for_selector("#card-dialog[open]")
    before = pg.input_value("#card-front")
    pg.fill("#card-front", before + " (fixed)")
    pg.click("#card-dialog button[value=ok]")
    pg.wait_for_function("!document.querySelector('#card-dialog').open")
    check("editing mid-session returns to the same card", pg.inner_text("#front") == before + " (fixed)" and pg.is_visible("#v-study"))

    for _ in range(30):
        if pg.is_visible("#done"):
            break
        pg.keyboard.press("Space")
        pg.keyboard.press("2")
    check("session ends", pg.is_visible("#done"))
    pg.screenshot(path=str(SHOTS / "6-done.png"))
    states = pg.evaluate("db.cards.map(c => [c.state, Math.round((c.due - Date.now()) / 864e5)])")
    check(f"all in review, due in ~2 days {states}", all(s == "review" and 1 <= d <= 3 for s, d in states))

    pg.click("#done-home")
    pg.wait_for_selector("#v-home:not([hidden])")
    check("nothing left for today", pg.inner_text("#today-n") == "0")
    check("1-day streak", pg.inner_text("#streak") == "1-day streak")
    pg.screenshot(path=str(SHOTS / "7-home-after.png"))

    tab(pg, "cards")
    check("list shows 6", "6 cards" in pg.inner_text("#cards-info"))
    pg.screenshot(path=str(SHOTS / "8-cards.png"))
    tab(pg, "settings")
    pg.screenshot(path=str(SHOTS / "9-settings.png"), full_page=True)

    # Media: image + audio file + recording, in the Japanese deck
    wav = SHOTS / "_tone.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(i / 8))) for i in range(4000)))
    tab(pg, "add")
    pg.select_option("#add-deck", label="Japanese")
    pg.fill("#add-front", "食べる")
    pg.set_input_files("#add-form .media[data-face=front] input[data-kind=img]", str(ROOT / "icons" / "icon-512.png"))
    pg.wait_for_selector("#add-form .media[data-face=front] img")
    pg.set_input_files("#add-form .media[data-face=front] input[data-kind=audio]", str(wav))
    pg.wait_for_selector("#add-form .media[data-face=front] audio")
    pg.click("#add-form .media[data-face=back] [data-record]")
    pg.wait_for_timeout(1200)
    pg.click("#add-form .media[data-face=back] [data-record]")
    pg.wait_for_selector("#add-form .media[data-face=back] audio", timeout=5000)
    pg.fill("#add-back", "taberu — to eat")
    pg.screenshot(path=str(SHOTS / "11-add-media.png"), full_page=True)
    pg.click("#add-form button[type=submit]")
    pg.wait_for_function("db.cards.length === 7 && !!db.cards[6].media")
    m = pg.evaluate("db.cards[6].media")
    check(f"card stored image, audio and recording {m}", bool(m and m["front"].get("img") and m["front"].get("audio") and m["back"].get("audio")))
    keys = pg.evaluate("MediaStore.keys().then(k => k.length)")
    check(f"3 files in IndexedDB (got {keys})", keys == 3)
    check("form cleared the media", pg.locator("#add-form .media img").count() == 0)

    pg.evaluate("db.settings.newPerDay = 6; save()")  # Spanish already used its 6; Japanese has its own allowance
    tab(pg, "home")
    check("new-card allowance is per deck", pg.evaluate("counts().news") == 1)
    pg.evaluate("db.settings.newPerDay = 10; save()")
    pg.click("[data-deck] >> text=Japanese")
    pg.wait_for_selector("#front-img:not([hidden])")
    check("study shows the image on the front", pg.is_visible("#front-img"))
    check("card with audio has a speaker", pg.is_visible(".play[data-face=front]"))
    pg.screenshot(path=str(SHOTS / "12-study-media.png"))
    pg.keyboard.press("Space")
    pg.screenshot(path=str(SHOTS / "13-back-media.png"))
    pg.click("#quit")

    # Backup carries the media
    with pg.expect_download() as dl:
        tab(pg, "settings")
        pg.click("#export")
    backup = json.loads(Path(dl.value.path()).read_text(encoding="utf-8"))
    check("Settings now says when the last backup was", "Last backup: today" in pg.inner_text("#backup-info"))
    check(f"backup holds the 3 media files (got {len(backup.get('media', {}))})", len(backup.get("media", {})) == 3)

    # Edit: removing the image deletes the file
    tab(pg, "cards")
    pg.click("[data-card] >> text=食べる")
    pg.wait_for_selector("#card-dialog .media[data-face=front] img")
    pg.screenshot(path=str(SHOTS / "14-edit-media.png"))
    pg.click("#card-dialog .media[data-face=front] [data-remove=img]")
    pg.click("#card-dialog button[value=ok]")
    pg.wait_for_function("!document.querySelector('#card-dialog').open")
    keys = pg.evaluate("MediaStore.keys().then(k => k.length)")
    check(f"removing the image deleted the file ({keys} left)", keys == 2)

    # Dark mode
    pg.emulate_media(color_scheme="dark")
    tab(pg, "home")
    pg.screenshot(path=str(SHOTS / "10-home-dark.png"))

    # Installable: service worker
    pg.reload()
    pg.wait_for_timeout(800)
    sw = pg.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
    check("service worker registered (works offline)", sw >= 1)
    browser.close()

srv.shutdown()
wav.unlink(missing_ok=True)
check(f"no console errors {errors}", not errors)
print(f"\nscreenshots in {SHOTS}")
sys.exit(check.exit_code)
