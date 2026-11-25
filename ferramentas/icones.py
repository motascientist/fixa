"""Gera os ícones do Fixa (dois cartões sobrepostos, verde da marca). Rodar: python ferramentas/icones.py"""
from pathlib import Path
from PIL import Image, ImageDraw

VERDE = (46, 94, 78)
PAPEL = (244, 241, 234)
SAIDA = Path(__file__).resolve().parent.parent / "icons"


def icone(tam: int, escala_conteudo: float, cantos: bool) -> Image.Image:
    g = tam * 4  # desenha grande e reduz, para borda lisa
    img = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if cantos:
        d.rounded_rectangle([0, 0, g - 1, g - 1], radius=int(g * 0.22), fill=VERDE)
    else:
        d.rectangle([0, 0, g, g], fill=VERDE)
    c = g * escala_conteudo  # lado do quadrado útil
    ox = (g - c) / 2
    w, h, r = c * 0.56, c * 0.70, c * 0.09
    # cartão de trás (contorno)
    x0, y0 = ox + c * 0.12, ox + c * 0.22
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=r, outline=PAPEL, width=int(c * 0.06))
    # cartão da frente (cheio)
    x1, y1 = ox + c * 0.34, ox + c * 0.08
    d.rounded_rectangle([x1, y1, x1 + w, y1 + h], radius=r, fill=PAPEL)
    return img.resize((tam, tam), Image.LANCZOS)


SAIDA.mkdir(exist_ok=True)
icone(192, 0.62, False).save(SAIDA / "icon-192.png")
icone(512, 0.62, False).save(SAIDA / "icon-512.png")
icone(512, 0.50, False).save(SAIDA / "maskable-512.png")  # zona segura do Android
icone(180, 0.62, False).convert("RGB").save(SAIDA / "apple-touch-icon.png")
print("ícones em", SAIDA)
