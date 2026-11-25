"""Teste de ponta a ponta do Fixa num Chrome sem janela (tamanho de celular).

Sobe um servidor local, cola cartões, estuda, confere os números e tira prints.
Rodar:  python teste/fluxo.py [pasta-dos-prints]
"""
import sys
import wave
import struct
import math
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
PRINTS = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "teste" / "_prints"
PRINTS.mkdir(parents=True, exist_ok=True)

CARTOES = """#separator:tab
A fatura está atrasada\tThe invoice is overdue
Eu concordo com você\tI agree with you
Vamos marcar uma reunião | Let's schedule a meeting
Pode me mandar o relatório? | Could you send me the report?
Isso depende do cliente | It depends on the client
linha sem verso
"""

class Quieto(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


handler = functools.partial(Quieto, directory=str(RAIZ))
srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/"

erros = []
falhas = []


def aba(pg, nome):
    pg.click(f"a[data-tab={nome}]")
    pg.wait_for_selector(f"#v-{nome}:not([hidden])")


def confere(nome, cond):
    print(("ok    " if cond else "FALHOU ") + nome)
    if not cond:
        falhas.append(nome)


with sync_playwright() as p:
    nav = p.chromium.launch(headless=True, args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = nav.new_context(accept_downloads=True, reduced_motion="reduce", viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="pt-BR",
                          timezone_id="America/Sao_Paulo")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and erros.append(m.text))

    pg.goto(URL)
    pg.wait_for_selector("#v-home:not([hidden])")
    confere("app nasce sem baralho", pg.evaluate("db.decks.length") == 0)
    confere("início vazio pede baralho", "Criar baralho" in pg.inner_text("#start-all"))
    confere("início vazio não mostra número nem gráfico", not pg.is_visible("#today-n") and not pg.is_visible("#forecast") and not pg.is_visible("#sec-decks"))
    pg.screenshot(path=str(PRINTS / "1-inicio-vazio.png"))
    aba(pg, "add")
    confere("Adicionar sem baralho pede baralho", pg.is_visible("#add-sem-baralho") and not pg.is_visible("#add-form"))
    pg.click("#add-criar-baralho")
    pg.fill("#deck-name", "Inglês")
    pg.click("#deck-dlg button[value=ok]")
    pg.wait_for_selector("#add-form:not([hidden])")
    aba(pg, "home")
    pg.click("#new-deck")
    pg.fill("#deck-name", "Japonês")
    pg.click("#deck-dlg button[value=ok]")
    pg.wait_for_function("db.decks.length === 2")

    # Adicionar um a um
    aba(pg, "add")
    pg.select_option("#add-deck", label="Inglês")
    pg.fill("#add-front", "Estou sem tempo hoje")
    pg.fill("#add-back", "I'm short on time today")
    pg.click("#add-form button[type=submit]")
    confere("cartão salvo e campos limpos", pg.input_value("#add-front") == "")

    # Colar vários (tabulação + barra)
    pg.click("#bulk summary")
    pg.fill("#bulk-text", CARTOES)
    pg.screenshot(path=str(PRINTS / "2-adicionar.png"))
    pg.click("#bulk-add")
    pg.wait_for_timeout(100)
    total = pg.evaluate("db.cards.length")
    confere(f"6 cartões no total (veio {total})", total == 6)
    confere("avisou linha sem verso", "1 linha sem verso" in pg.inner_text("#toast"))
    pg.fill("#bulk-text", "Eu concordo com você\tI agree with you")
    pg.click("#bulk-add")
    confere("repetido ignorado", pg.evaluate("db.cards.length") == 6)

    # Início com números
    aba(pg, "home")
    confere("6 para hoje", pg.inner_text("#today-n") == "6")
    pg.screenshot(path=str(PRINTS / "3-inicio.png"))

    # Estudar
    pg.click("#start-all")
    pg.wait_for_selector("#v-study:not([hidden])")
    confere("barra de abas some no estudo", not pg.is_visible("#tabbar"))
    confere("cartão novo vem marcado", pg.is_visible("#flash-novo"))
    confere("baralho só pede o nome", pg.locator("#deck-form select").count() == 0)
    confere("cartão sem áudio não tem alto-falante", not pg.is_visible(".speak[data-face=front]"))
    cx = pg.locator("#reveal").bounding_box()
    confere("botões presos embaixo da tela", cx["y"] + cx["height"] > 844 - 110)
    pg.screenshot(path=str(PRINTS / "4-frente.png"))
    pg.click("#front")  # tocar no cartão mostra a resposta
    confere("tocar no cartão mostra a resposta", pg.is_visible("#answer"))
    pg.click("[data-r='3']")  # toque duplo: cai no botão que acabou de aparecer
    confere("toque duplo não vira nota", pg.evaluate("db.cards.every(c => c.state === 'new')"))
    pg.wait_for_timeout(400)
    i3, i4 = pg.inner_text("#i3"), pg.inner_text("#i4")
    confere(f"cartão novo: Lembrei = 2 dias ({i3}), Fácil = 8 dias ({i4})", i3 == "em 2 dias" and i4 == "em 8 dias")
    pg.screenshot(path=str(PRINTS / "5-verso.png"))

    pg.click("[data-r='1']")  # Esqueci
    confere("Esqueci mantém na sessão (6 restantes)", pg.inner_text("#left") == "6 restantes")
    pg.click("#undo")
    confere("Desfazer volta o mesmo cartão", pg.evaluate("db.cards.every(c => c.state === 'new')"))

    # Corrigir um erro de digitação sem sair do estudo
    pg.keyboard.press("e")
    pg.wait_for_selector("#card-dlg[open]")
    antes = pg.input_value("#card-front")
    pg.fill("#card-front", antes + " (corrigido)")
    pg.click("#card-dlg button[value=ok]")
    pg.wait_for_function("!document.querySelector('#card-dlg').open")
    confere("editar no estudo volta ao mesmo cartão", pg.inner_text("#front") == antes + " (corrigido)" and pg.is_visible("#v-study"))

    for _ in range(30):
        if pg.is_visible("#done"):
            break
        pg.keyboard.press("Space")
        pg.keyboard.press("2")
    confere("sessão termina", pg.is_visible("#done"))
    pg.screenshot(path=str(PRINTS / "6-pronto.png"))
    st = pg.evaluate("db.cards.map(c => [c.state, Math.round((c.due - Date.now()) / 864e5)])")
    confere(f"todos em revisão para daqui ~2 dias {st}", all(s == "review" and 1 <= d <= 3 for s, d in st))

    # Volta e confere previsão
    pg.click("#done-home")
    pg.wait_for_selector("#v-home:not([hidden])")
    confere("nada para hoje depois", pg.inner_text("#today-n") == "0")
    confere("sequência de 1 dia", pg.inner_text("#streak") == "1 dia seguido")
    pg.screenshot(path=str(PRINTS / "7-inicio-depois.png"))

    # Lista e ajustes
    aba(pg, "cards")
    confere("lista mostra 6", "6 cartões" in pg.inner_text("#cards-info"))
    pg.screenshot(path=str(PRINTS / "8-cartoes.png"))
    aba(pg, "settings")
    pg.screenshot(path=str(PRINTS / "9-ajustes.png"), full_page=True)


    # Mídia: imagem + áudio de arquivo + gravação, no baralho Japonês
    confere("tem os baralhos Inglês e Japonês", pg.evaluate("db.decks.map(d => d.name).join(',')") == "Inglês,Japonês")
    wav = PRINTS / "_som.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(i / 8))) for i in range(4000)))
    aba(pg, "add")
    pg.select_option("#add-deck", label="Japonês")
    pg.fill("#add-front", "食べる")
    pg.set_input_files("#add-form .midia[data-face=front] input[data-k=img]", str(RAIZ / "icons" / "icon-512.png"))
    pg.wait_for_selector("#add-form .midia[data-face=front] img")
    pg.set_input_files("#add-form .midia[data-face=front] input[data-k=audio]", str(wav))
    pg.wait_for_selector("#add-form .midia[data-face=front] audio")
    pg.click("#add-form .midia[data-face=back] [data-gravar]")
    pg.wait_for_timeout(1200)
    pg.click("#add-form .midia[data-face=back] [data-gravar]")
    pg.wait_for_selector("#add-form .midia[data-face=back] audio", timeout=5000)
    pg.fill("#add-back", "taberu — comer")
    pg.screenshot(path=str(PRINTS / "11-adicionar-midia.png"), full_page=True)
    pg.click("#add-form button[type=submit]")
    pg.wait_for_function("db.cards.length === 7 && !!db.cards[6].midia")
    m = pg.evaluate("db.cards[6].midia")
    confere(f"cartão guardou imagem, áudio e gravação {m}", bool(m and m["front"].get("img") and m["front"].get("audio") and m["back"].get("audio")))
    chaves = pg.evaluate("Midia.chaves().then(k => k.length)")
    confere(f"3 arquivos no IndexedDB (veio {chaves})", chaves == 3)
    confere("formulário limpou a mídia", pg.locator("#add-form .midia img").count() == 0)

    pg.evaluate("db.settings.newPerDay = 6; save()")  # Inglês já gastou os 6 de hoje; Japonês tem a cota dele
    aba(pg, "home")
    confere("cota de novos é por baralho", pg.evaluate("counts().news") == 1)
    pg.evaluate("db.settings.newPerDay = 10; save()")
    pg.click("[data-deck] >> text=Japonês")
    pg.wait_for_selector("#front-img:not([hidden])")
    confere("estudo mostra a imagem na frente", pg.is_visible("#front-img"))
    confere("cartão com áudio tem alto-falante", pg.is_visible(".speak[data-face=front]"))
    pg.screenshot(path=str(PRINTS / "12-estudo-midia.png"))
    pg.keyboard.press("Space")
    pg.screenshot(path=str(PRINTS / "13-verso-midia.png"))
    pg.click("#quit")

    # Backup leva a mídia junto
    with pg.expect_download() as dl:
        aba(pg, "settings")
        pg.click("#export")
    import json
    bk = json.loads(Path(dl.value.path()).read_text(encoding="utf-8"))
    confere("Ajustes passa a dizer quando foi o backup", "Último backup: hoje" in pg.inner_text("#backup-info"))
    confere(f"backup tem os 3 arquivos de mídia (veio {len(bk.get('midia', {}))})", len(bk.get("midia", {})) == 3)

    # Editar: tirar a imagem apaga o arquivo
    aba(pg, "cards")
    pg.click("[data-card] >> text=食べる")
    pg.wait_for_selector("#card-dlg .midia[data-face=front] img")
    pg.screenshot(path=str(PRINTS / "14-editar-midia.png"))
    pg.click("#card-dlg .midia[data-face=front] [data-tirar=img]")
    pg.click("#card-dlg button[value=ok]")
    pg.wait_for_function("!document.querySelector('#card-dlg').open")
    chaves = pg.evaluate("Midia.chaves().then(k => k.length)")
    confere(f"tirar a imagem apagou o arquivo (sobraram {chaves})", chaves == 2)

    # Modo escuro
    pg.emulate_media(color_scheme="dark")
    aba(pg, "home")
    pg.screenshot(path=str(PRINTS / "10-inicio-escuro.png"))

    # Instalável: manifest e service worker
    pg.reload()
    pg.wait_for_timeout(800)
    sw = pg.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
    confere("service worker registrado (funciona offline)", sw >= 1)
    nav.close()

srv.shutdown()
confere(f"sem erro no console {erros}", not erros)
print(f"\nprints em {PRINTS}")
sys.exit(1 if falhas else 0)
