"""Confere o lado do site que conversa com o APK, simulando a ponte window.FixaAndroid no navegador.

Não substitui o teste no celular: prova só que, dentro do APK, o site chama a ponte certa
(backup) e não tenta registrar o service worker.
Rodar:  python teste/apk_ponte.py
"""
import sys
import json
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent


class Quieto(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quieto, directory=str(RAIZ)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

PONTE = """
window.__chamadas = [];
window.FixaAndroid = {
  salvarBackup: (n, c) => window.__chamadas.push(['salvarBackup', n, c]),
};
"""
falhas = []
erros = []


def confere(nome, cond):
    print(("ok    " if cond else "FALHOU ") + nome)
    if not cond:
        falhas.append(nome)


with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    pg = nav.new_context(viewport={"width": 390, "height": 844}, locale="pt-BR").new_page()
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.add_init_script(PONTE)
    pg.goto(f"http://127.0.0.1:{srv.server_port}/")
    pg.wait_for_selector("#v-home:not([hidden])")
    pg.wait_for_timeout(500)
    confere("no APK não registra service worker", pg.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)") == 0)

    pg.click("#start-all")  # Criar baralho
    pg.fill("#deck-name", "Japonês")
    pg.click("#deck-dlg button[value=ok]")
    pg.click("a[data-tab=add]")
    pg.wait_for_selector("#add-form:not([hidden])")
    pg.fill("#add-front", "食べる")
    pg.fill("#add-back", "comer")
    pg.click("#add-form button[type=submit]")
    pg.wait_for_function("db.cards.length === 1")

    pg.click("a[data-tab=settings]")
    pg.wait_for_selector("#v-settings:not([hidden])")
    confere("cartão 'Instalar no celular' some dentro do APK", not pg.is_visible("#card-instalar"))
    pg.click("#export")
    pg.wait_for_function("window.__chamadas.some(c => c[0] === 'salvarBackup')")
    nome, conteudo = [c for c in pg.evaluate("window.__chamadas") if c[0] == "salvarBackup"][0][1:]
    bk = json.loads(conteudo)
    confere(f"backup vai para o Android como arquivo .json ({nome})", nome.startswith("fixa-backup-") and nome.endswith(".json") and len(bk["cards"]) == 1)
    confere("antes de o Android confirmar, não diz que salvou", "Último backup" not in pg.inner_text("#backup-info"))
    pg.evaluate("window.backupSalvo(true)")
    confere("depois da confirmação, registra o backup", "Último backup: hoje" in pg.inner_text("#backup-info"))
    nav.close()

srv.shutdown()
confere(f"sem erro no console {erros}", not erros)
sys.exit(1 if falhas else 0)
