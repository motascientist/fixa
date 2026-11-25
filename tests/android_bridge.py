"""Checks the web side of the APK bridge by simulating window.FixaAndroid in a browser.

Not a replacement for a test on a phone: it only proves that, inside the APK, the web app calls the right bridge
(backup) and does not try to register the service worker.
Run:  python tests/android_bridge.py
"""
import sys
import json
from playwright.sync_api import sync_playwright
from _server import start_server, Checks

srv, URL = start_server()
check = Checks()
errors = []

BRIDGE = """
window.__calls = [];
window.FixaAndroid = {
  saveBackup: (name, content) => window.__calls.push(['saveBackup', name, content]),
};
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    pg = browser.new_context(viewport={"width": 390, "height": 844}, locale="en-US").new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script(BRIDGE)
    pg.goto(URL)
    pg.click("[data-lang=en]")
    pg.wait_for_selector("#v-home:not([hidden])")
    pg.wait_for_timeout(500)
    check("inside the APK no service worker is registered", pg.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)") == 0)

    pg.click("#start-all")  # Create deck
    pg.fill("#deck-name", "Japanese")
    pg.click("#deck-dialog button[value=ok]")
    pg.click("a[data-tab=add]")
    pg.wait_for_selector("#add-form:not([hidden])")
    pg.fill("#add-front", "食べる")
    pg.fill("#add-back", "to eat")
    pg.click("#add-form button[type=submit]")
    pg.wait_for_function("db.cards.length === 1")

    pg.click("a[data-tab=settings]")
    pg.wait_for_selector("#v-settings:not([hidden])")
    check("'Install on your phone' is hidden inside the APK", not pg.is_visible("#install-card"))
    pg.click("#export")
    pg.wait_for_function("window.__calls.some(c => c[0] === 'saveBackup')")
    name, content = [c for c in pg.evaluate("window.__calls") if c[0] == "saveBackup"][0][1:]
    backup = json.loads(content)
    check(f"backup goes to Android as a .json file ({name})", name.startswith("fixa-backup-") and name.endswith(".json") and len(backup["cards"]) == 1)
    check("until Android confirms, it does not claim it saved", "Last backup" not in pg.inner_text("#backup-info"))
    pg.evaluate("window.onBackupSaved(true)")
    check("after the confirmation, the backup is recorded", "Last backup: today" in pg.inner_text("#backup-info"))
    browser.close()

srv.shutdown()
check(f"no console errors {errors}", not errors)
sys.exit(check.exit_code)
