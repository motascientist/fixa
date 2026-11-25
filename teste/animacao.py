"""Confere as animações do estudo (virar, responder, terminar) com movimento LIGADO, e que somem com ele desligado.

Rodar:  python teste/animacao.py [pasta-dos-prints]
"""
import sys
import json
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
PRINTS = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "teste" / "_prints"
PRINTS.mkdir(parents=True, exist_ok=True)


class Quieto(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quieto, directory=str(RAIZ)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/"

DADOS = {
    "decks": [{"id": "d1", "name": "Japonês"}],
    "cards": [
        {"id": "c1", "deckId": "d1", "front": "Watashi", "back": "Eu (neutro polido)", "created": 1, "state": "new"},
        {"id": "c2", "deckId": "d1", "front": "Arigatou", "back": "Obrigado", "created": 2, "state": "new"},
    ],
    "days": {}, "settings": {"newPerDay": 10, "retention": 0.9},
}
SEMEAR = f"if (!localStorage.getItem('fixa.v1')) localStorage.setItem('fixa.v1', {json.dumps(json.dumps(DADOS))});"

falhas, erros = [], []


def confere(nome, cond):
    print(("ok    " if cond else "FALHOU ") + nome)
    if not cond:
        falhas.append(nome)


rodando = "document.getAnimations().filter(a => a.playState === 'running').length"

with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)

    # 1) Movimento ligado
    pg = nav.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, reduced_motion="no-preference").new_page()
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.add_init_script(SEMEAR)
    pg.goto(URL)
    pg.click("#start-all")
    pg.wait_for_selector("#v-study:not([hidden])")
    pg.wait_for_timeout(400)

    pg.click("#front")
    pg.wait_for_timeout(60)
    confere("virar: cartão está girando", pg.evaluate(rodando) > 0)
    confere("virar: nota ainda escondida no meio do giro", not pg.is_visible("#grade"))
    pg.wait_for_timeout(130)
    pg.screenshot(path=str(PRINTS / "anim-1-girando.png"))
    pg.click("#reveal", force=True, no_wait_after=True) if pg.is_visible("#reveal") else None
    pg.wait_for_timeout(500)
    confere("virar: resposta aparece no fim", pg.is_visible("#answer") and pg.is_visible("#grade"))

    pg.click("[data-r='3']")
    pg.wait_for_timeout(120)
    flut = pg.locator(".flutua").all_inner_texts()
    confere(f"Lembrei: '+2 dias' sobe do botão ({flut})", flut == ["+2 dias"])
    confere("Lembrei: cartão sai animado", pg.evaluate(rodando) > 0)
    pg.screenshot(path=str(PRINTS / "anim-2-lembrei.png"))
    pg.wait_for_timeout(500)
    confere("próximo cartão entra e fica visível", pg.inner_text("#front") == "Arigatou"
            and pg.evaluate("getComputedStyle(document.querySelector('#flash')).opacity") == "1")

    pg.click("#front")
    pg.wait_for_timeout(600)
    pg.keyboard.press("1")  # Esqueci pelo teclado
    pg.keyboard.press("1")  # apertado de novo durante a animação: não pode contar duas vezes
    pg.wait_for_timeout(80)
    confere("Esqueci: '↺ 1 min' sobe do botão", "↺ 1 min" in pg.locator(".flutua").all_inner_texts())
    pg.wait_for_timeout(500)
    confere("tecla repetida no meio da animação não conta", pg.evaluate("db.cards.find(c => c.id === 'c2').reps") == 1)

    pg.click("#front")
    pg.wait_for_timeout(600)
    pg.click("[data-r='4']")
    pg.wait_for_timeout(500)
    confere("fim: tela de pronto", pg.is_visible("#done"))
    confere("fim: confete", pg.locator(".confete").count() > 0)
    pg.wait_for_timeout(250)
    pg.screenshot(path=str(PRINTS / "anim-3-confete.png"))
    pg.wait_for_timeout(1500)
    confere("confete se limpa sozinho", pg.locator(".confete").count() == 0 and pg.locator(".flutua").count() == 0)

    # 2) Quem desliga o movimento no sistema não vê animação nenhuma
    pg2 = nav.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce").new_page()
    pg2.on("pageerror", lambda e: erros.append(str(e)))
    pg2.add_init_script(SEMEAR)
    pg2.goto(URL)
    pg2.click("#start-all")
    pg2.wait_for_selector("#v-study:not([hidden])")
    pg2.click("#front")
    confere("sem movimento: resposta aparece na hora, sem giro", pg2.is_visible("#grade") and pg2.evaluate(rodando) == 0)
    pg2.wait_for_timeout(400)
    pg2.click("[data-r='3']")
    confere("sem movimento: nada flutua", pg2.locator(".flutua").count() == 0)
    nav.close()

srv.shutdown()
confere(f"sem erro no console {erros}", not erros)
sys.exit(1 if falhas else 0)
