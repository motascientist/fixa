"""Gera as telas do README (docs/telas/) num Chrome sem janela, com dados de exemplo.

Rodar:  python ferramentas/telas.py
"""
import json
import time
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "docs" / "telas"
SAIDA.mkdir(parents=True, exist_ok=True)


class Quieto(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quieto, directory=str(RAIZ)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

agora = int(time.time() * 1000)
DIA = 86400000


def revisao(i, deck, f, b, em_dias, s):
    return {"id": f"r{deck}{i}", "deckId": deck, "front": f, "back": b, "created": i, "state": "review",
            "s": s, "d": 5, "reps": 3, "due": agora + em_dias * DIA, "last": agora - DIA}


cartoes = [
    {"id": "n1", "deckId": "jp", "front": "Watashi", "back": "Eu (neutro, polido)", "created": 100, "state": "new"},
    {"id": "n2", "deckId": "jp", "front": "Arigatou", "back": "Obrigado", "created": 101, "state": "new"},
    {"id": "n3", "deckId": "en", "front": "Estou sem tempo hoje", "back": "I'm short on time today", "created": 102, "state": "new"},
]
exemplos = [("Taberu", "Comer"), ("Nomu", "Beber"), ("Iku", "Ir"), ("Miru", "Ver"), ("Kaku", "Escrever")]
for i, (f, b) in enumerate(exemplos):
    cartoes.append(revisao(i, "jp", f, b, [-1, -1, 1, 2, 4][i], 3))
for i, (f, b) in enumerate([("A fatura está atrasada", "The invoice is overdue"), ("Eu concordo", "I agree"),
                            ("Vamos marcar uma reunião", "Let's schedule a meeting"), ("Depende do cliente", "It depends on the client")]):
    cartoes.append(revisao(i, "en", f, b, [-1, 1, 3, 5][i], 4))

DADOS = {"decks": [{"id": "jp", "name": "Japonês"}, {"id": "en", "name": "Inglês"}], "cards": cartoes,
         "days": {}, "settings": {"newPerDay": 10, "retention": 0.9}}
hoje = (agora - 4 * 3600000 - 3 * 3600000) // DIA
for k in range(5):
    DADOS["days"][str(hoje - k)] = 20
SEMEAR = f"if (!localStorage.getItem('fixa.v1')) localStorage.setItem('fixa.v1', {json.dumps(json.dumps(DADOS))});"

with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    for tema in ("light", "dark"):
        ctx = nav.new_context(viewport={"width": 390, "height": 760}, device_scale_factor=2, locale="pt-BR",
                              timezone_id="America/Sao_Paulo", color_scheme=tema, reduced_motion="no-preference")
        pg = ctx.new_page()
        pg.add_init_script(SEMEAR)
        pg.goto(f"http://127.0.0.1:{srv.server_port}/")
        pg.wait_for_selector("#v-home:not([hidden])")
        pg.wait_for_timeout(300)
        if tema == "dark":
            pg.screenshot(path=str(SAIDA / "inicio-escuro.png"))
            continue
        pg.screenshot(path=str(SAIDA / "inicio.png"))
        pg.click("[data-deck] >> text=Japonês")
        pg.wait_for_selector("#v-study:not([hidden])")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(SAIDA / "frente.png"))
        pg.click("#front")
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(SAIDA / "verso.png"))
        pg.click("[data-r='3']")
        pg.wait_for_timeout(110)
        pg.screenshot(path=str(SAIDA / "lembrei.png"))
        # termina a sessão para mostrar o fim
        while True:
            pg.wait_for_timeout(450)
            if pg.is_visible("#done"):
                break
            pg.click("#front")
            pg.wait_for_timeout(650)
            pg.click("[data-r='3']")
            for _ in range(40):  # espera o fim aparecer, para fotografar o confete no auge
                pg.wait_for_timeout(25)
                if pg.is_visible("#done"):
                    break
            if pg.is_visible("#done"):
                break
        pg.wait_for_timeout(380)
        pg.screenshot(path=str(SAIDA / "fim.png"))
        ctx.close()
    nav.close()
srv.shutdown()
print("telas em", SAIDA)
