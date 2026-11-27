"""Shuffled sessions, free practice (which must never touch the schedule) and the small reading line.

Run:  python tests/practice_and_order.py [screenshot-folder]
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

WORDS = ["sumaho", "tegami", "neko", "inu", "mizu", "hon", "kuruma", "eki", "sensei", "gakkou",
         "taberu", "nomu", "miru", "iku", "kaku", "yomu", "hanasu", "kiku", "matsu", "kau"]
DATA = {
    "decks": [{"id": "jp", "name": "Japanese"}, {"id": "es", "name": "Spanish"}],
    "cards": [{"id": f"c{i}", "deckId": "jp", "front": w, "back": f"meaning {i}", "created": i + 1, "state": "new"}
              for i, w in enumerate(WORDS)]
             + [{"id": "s1", "deckId": "es", "front": "hola", "back": "hello", "created": 100, "state": "new"}],
    "days": {}, "settings": {"newPerDay": 30, "retention": 0.9, "lang": "en"},
}
SEED = f"if (!localStorage.getItem('fixa.v1')) localStorage.setItem('fixa.v1', {json.dumps(json.dumps(DATA))});"


def answer(pg, key):
    pg.keyboard.press("Space")
    pg.wait_for_selector("#grade:not([hidden])")  # a person cannot press the next key in the same instant
    pg.keyboard.press(key)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    pg = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce", locale="en-US").new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script(SEED)
    pg.goto(URL)
    pg.wait_for_selector("#v-home:not([hidden])")

    # 1) The session does not follow the order the cards were added
    pg.click("[data-deck] >> text=Japanese")
    pg.wait_for_selector("#v-study:not([hidden])")
    seen = []
    for _ in range(len(WORDS)):
        seen.append(pg.inner_text("#front"))
        answer(pg, "2")
        pg.wait_for_timeout(30)
    check(f"all 20 cards were shown once ({len(set(seen))} distinct)", sorted(seen) == sorted(WORDS))
    check(f"order differs from the order they were added (first five: {seen[:5]})", seen != WORDS)
    in_place = sum(1 for a, b in zip(seen, WORDS) if a == b)
    check(f"barely any card in its original position ({in_place} of 20)", in_place <= 6)
    pg.click("#done-home")
    pg.wait_for_selector("#v-home:not([hidden])")

    # 2) Free practice: unlimited, and it leaves the schedule alone
    pg.click("[data-deck] >> text=Spanish")  # finish the other deck too, so Home is "all caught up"
    pg.wait_for_selector("#v-study:not([hidden])")
    answer(pg, "2")
    pg.click("#done-home")
    pg.wait_for_selector("#v-home:not([hidden])")
    check("when all caught up, Home offers free practice", pg.inner_text("#start-all") == "Free practice" and pg.is_enabled("#start-all"))
    before = pg.evaluate("JSON.stringify({ cards: db.cards, days: db.days })")
    streak_before = pg.inner_text("#streak")

    pg.click("a[data-tab=practice]")
    pg.wait_for_selector("#v-practice:not([hidden])")
    rows = pg.locator("#practice-list [data-practice]").all_inner_texts()
    check(f"Practice tab lists all decks plus 'All decks' ({len(rows)} rows)", len(rows) == 3 and rows[0].startswith("All decks"))
    pg.screenshot(path=str(SHOTS / "practice-tab.png"))
    pg.click("[data-practice='jp']")
    pg.wait_for_selector("#v-study:not([hidden])")
    pg.keyboard.press("Space")
    pg.wait_for_selector("#grade:not([hidden])")
    check("practice: Forgot and Remembered visible, Easy hidden",
          pg.is_visible("#grade [data-r='1']") and pg.is_visible("#grade [data-r='3']") and not pg.is_visible("#grade [data-r='4']"))
    check("practice: labels say what happens", pg.inner_text("#i1") == "comes back soon" and pg.inner_text("#i3") == "goes to the end")
    pg.screenshot(path=str(SHOTS / "practice-card.png"))
    forgotten = pg.inner_text("#front")
    pg.keyboard.press("1")  # Forgot
    pg.wait_for_timeout(30)
    upcoming = []
    for _ in range(4):
        upcoming.append(pg.inner_text("#front"))
        answer(pg, "2")
        pg.wait_for_timeout(30)
    check(f"a forgotten card comes back within the next 4 cards ({upcoming})", forgotten in upcoming)
    for _ in range(40):  # two full rounds of the 20-card deck: practice never ends on its own
        answer(pg, "2")
        pg.wait_for_timeout(15)
    check("practice keeps going after the deck runs out", pg.is_visible("#flash") and not pg.is_visible("#done"))
    check(f"practice counter counts every answer ({pg.inner_text('#left')})", pg.inner_text("#left") == "Practice · 45 done")
    pg.click("#quit")
    pg.wait_for_selector("#v-home:not([hidden])")
    after = pg.evaluate("JSON.stringify({ cards: db.cards, days: db.days })")
    check("practice changed nothing in the schedule or the streak", before == after and pg.inner_text("#streak") == streak_before)
    check("Home numbers unchanged", pg.inner_text("#today-n") == "0")

    # 3) Small reading line: romaji with hiragana underneath
    pg.click("a[data-tab=add]")
    pg.wait_for_selector("#add-form:not([hidden])")
    pg.select_option("#add-deck", label="Japanese")
    pg.fill("#add-front", "tomodachi")
    pg.click("#add-form .kana[data-source='add-front'][data-kana='hira']")
    check("あ fills the small line with hiragana", pg.input_value("#add-front-sub") == "ともだち")
    pg.fill("#add-back", "friend")
    pg.screenshot(path=str(SHOTS / "reading-line-add.png"))
    pg.click("#add-form button[type=submit]")
    pg.wait_for_function("db.cards.some(c => c.front === 'tomodachi' && c.frontSub === 'ともだち')")
    check("form clears the small lines too", pg.input_value("#add-front-sub") == "")
    pg.fill("#add-front", "sumaho")
    pg.click("#add-form .kana[data-source='add-front'][data-kana='kata']")
    check("ア fills it with katakana", pg.input_value("#add-front-sub") == "スマホ")
    pg.fill("#add-front", "")
    pg.fill("#add-front-sub", "")

    pg.click("#bulk summary")
    pg.fill("#bulk-text", "neko2 | cat | ねこ\ninu2\tdog\tいぬ\tlittle dog")
    pg.click("#bulk-add")
    subs = pg.evaluate("db.cards.filter(c => c.front.endsWith('2')).map(c => [c.frontSub || '', c.backSub || ''])")
    check(f"pasting reads the 3rd and 4th columns ({subs})", subs == [["ねこ", ""], ["いぬ", "little dog"]])

    pg.click("a[data-tab=home]")
    pg.wait_for_selector("#v-home:not([hidden])")
    pg.evaluate("startPractice(null)")
    pg.wait_for_selector("#v-study:not([hidden])")
    for _ in range(30):
        if pg.inner_text("#front") == "tomodachi":
            break
        answer(pg, "2")
        pg.wait_for_timeout(15)
    check("study shows the hiragana under the romaji", pg.inner_text("#front-sub") == "ともだち" and pg.is_visible("#front-sub"))
    pg.screenshot(path=str(SHOTS / "reading-line-study.png"))
    pg.keyboard.press("e")
    pg.wait_for_selector("#card-dialog[open]")
    check("edit dialog shows the small line", pg.input_value("#card-front-sub") == "ともだち")
    pg.fill("#card-front-sub", "ともだち!")
    pg.click("#card-dialog button[value=ok]")
    pg.wait_for_function("!document.querySelector('#card-dialog').open")
    check("editing the small line saves it", pg.inner_text("#front-sub") == "ともだち!")
    browser.close()

srv.shutdown()
check(f"no console errors {errors}", not errors)
sys.exit(check.exit_code)
