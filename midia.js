'use strict';
/*
 * Imagem e áudio dos cartões. Ficam no IndexedDB do navegador — no próprio aparelho, como o resto.
 * (O texto fica no localStorage, que só aguenta uns 5 MB; mídia precisa de mais espaço.)
 */

const Midia = (() => {
  let aberto = null;
  function abrir() {
    return aberto || (aberto = new Promise((ok, erro) => {
      const r = indexedDB.open('fixa-midia', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('m');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
    }));
  }
  async function tx(modo, fn) {
    const db = await abrir();
    return new Promise((ok, erro) => {
      const t = db.transaction('m', modo);
      const req = fn(t.objectStore('m'));
      t.oncomplete = () => ok(req ? req.result : undefined);
      t.onerror = () => erro(t.error);
      t.onabort = () => erro(t.error);
    });
  }
  return {
    put: (id, blob) => tx('readwrite', s => s.put(blob, id)),
    get: id => tx('readonly', s => s.get(id)),
    del: id => tx('readwrite', s => s.delete(id)),
    limpar: () => tx('readwrite', s => s.clear()),
    chaves: () => tx('readonly', s => s.getAllKeys()),
  };
})();

const FACES = ['front', 'back'];
const TIPOS = ['img', 'audio'];

// Ids de mídia de um cartão, em lista.
function idsDaMidia(c) {
  const m = c && c.midia;
  if (!m) return [];
  return FACES.flatMap(f => TIPOS.map(k => m[f] && m[f][k])).filter(Boolean);
}
async function apagarMidiaDe(cartoes) {
  for (const c of cartoes) for (const id of idsDaMidia(c)) await Midia.del(id).catch(() => {});
}

// Foto de celular tem 4000 px; para estudar, 1280 px basta e ocupa uma fração.
async function encolherImagem(arquivo) {
  if (!/^image\/(jpeg|png|webp|bmp)$/.test(arquivo.type) || !window.createImageBitmap) return arquivo;
  try {
    const bmp = await createImageBitmap(arquivo);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    if (k === 1 && arquivo.size < 400e3) return arquivo;
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k);
    cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const tipo = arquivo.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const b = await new Promise(ok => cv.toBlob(ok, tipo, 0.85));
    return b && b.size < arquivo.size ? b : arquivo;
  } catch (e) {
    return arquivo;
  }
}

/* ---------- Rascunho: a mídia que está sendo montada num formulário ---------- */
// Formato: { front: { img: slot|null, audio: slot|null }, back: {...} }, slot = { id?, blob, url }

function novoRascunho() {
  return { front: { img: null, audio: null }, back: { img: null, audio: null } };
}
function soltarRascunho(r) {
  if (!r) return;
  FACES.forEach(f => TIPOS.forEach(k => { if (r[f][k]) URL.revokeObjectURL(r[f][k].url); }));
}
async function rascunhoDoCartao(c) {
  const r = novoRascunho();
  for (const f of FACES) for (const k of TIPOS) {
    const id = c.midia && c.midia[f] && c.midia[f][k];
    if (!id) continue;
    const blob = await Midia.get(id).catch(() => null);
    if (blob) r[f][k] = { id, blob, url: URL.createObjectURL(blob) };
  }
  return r;
}
const temMidia = (r, f) => !!(r[f].img || r[f].audio);

// Grava o rascunho no cartão: guarda o que é novo, apaga o que saiu.
async function gravarRascunho(card, r) {
  const antigo = card.midia || {};
  const novo = { front: {}, back: {} };
  let algum = false;
  for (const f of FACES) for (const k of TIPOS) {
    const v = r[f][k];
    const idAntigo = antigo[f] && antigo[f][k];
    if (v) {
      if (v.id && v.id === idAntigo) novo[f][k] = v.id;
      else { const id = uid(); await Midia.put(id, v.blob); novo[f][k] = id; }
      algum = true;
    }
    if (idAntigo && novo[f][k] !== idAntigo) await Midia.del(idAntigo).catch(() => {});
  }
  if (algum) card.midia = novo; else delete card.midia;
}

/* ---------- Componente: botões Imagem / Áudio / Gravar + prévia ---------- */

let gravador = null;

function montarMidia(caixa, face, pegarRascunho) {
  function render() {
    const r = pegarRascunho();
    const s = r[face];
    caixa.innerHTML = `
      <div class="midia-bar">
        <label class="mini">Imagem<input type="file" accept="image/*" data-k="img" hidden></label>
        <label class="mini">Áudio<input type="file" accept="audio/*" data-k="audio" hidden></label>
        <button type="button" class="mini" data-gravar>${gravador && gravador.face === face && gravador.caixa === caixa ? '■ Parar' : '● Gravar'}</button>
      </div>
      ${s.img || s.audio ? `<div class="midia-prev">
        ${s.img ? `<figure><img src="${s.img.url}" alt=""><button type="button" class="tirar" data-tirar="img" aria-label="Tirar imagem">×</button></figure>` : ''}
        ${s.audio ? `<div class="aud"><audio controls preload="metadata" src="${s.audio.url}"></audio><button type="button" class="tirar" data-tirar="audio" aria-label="Tirar áudio">×</button></div>` : ''}
      </div>` : ''}`;
  }
  async function colocar(k, blob) {
    const r = pegarRascunho();
    if (k === 'img') blob = await encolherImagem(blob);
    if (r[face][k] && !r[face][k].id) URL.revokeObjectURL(r[face][k].url);
    r[face][k] = { blob, url: URL.createObjectURL(blob) };
    pedirPersistencia();
    render();
  }
  caixa.addEventListener('change', e => {
    const inp = e.target.closest('input[type=file]');
    if (inp && inp.files[0]) colocar(inp.dataset.k, inp.files[0]);
  });
  caixa.addEventListener('click', async e => {
    const t = e.target.closest('[data-tirar]');
    if (t) {
      const r = pegarRascunho();
      const k = t.dataset.tirar;
      if (r[face][k] && !r[face][k].id) URL.revokeObjectURL(r[face][k].url);
      r[face][k] = null;
      return render();
    }
    if (e.target.closest('[data-gravar]')) {
      if (gravador) { gravador.rec.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Este navegador não grava áudio.');
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (err) { return toast('Sem acesso ao microfone.'); }
      const pedacos = [];
      const rec = new MediaRecorder(stream);
      gravador = { rec, face, caixa };
      rec.ondataavailable = ev => { if (ev.data.size) pedacos.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop());
        gravador = null;
        const blob = new Blob(pedacos, { type: rec.mimeType || 'audio/webm' });
        if (blob.size) colocar('audio', blob); else render();
      };
      rec.start();
      render();
    }
  });
  // Ctrl+V de um print cola como imagem da face em que o cursor está
  const campo = caixa.closest('label, .face-campo') && caixa.parentElement.querySelector('textarea');
  if (campo) campo.addEventListener('paste', e => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); colocar('img', item.getAsFile()); }
  });
  return { render };
}

/* ---------- Backup: mídia vai junto, como texto ---------- */

const blobParaDataURL = b => new Promise((ok, erro) => {
  const fr = new FileReader();
  fr.onload = () => ok(fr.result);
  fr.onerror = () => erro(fr.error);
  fr.readAsDataURL(b);
});
async function midiaParaBackup(cartoes) {
  const out = {};
  for (const c of cartoes) for (const id of idsDaMidia(c)) {
    const b = await Midia.get(id).catch(() => null);
    if (b) out[id] = await blobParaDataURL(b);
  }
  return out;
}
async function restaurarMidia(mapa) {
  // Primeiro lê tudo do backup; só depois apaga o que está no aparelho. Backup ruim não destrói nada.
  const prontos = [];
  for (const [id, url] of Object.entries(mapa || {})) prontos.push([id, await (await fetch(url)).blob()]);
  await Midia.limpar();
  for (const [id, blob] of prontos) await Midia.put(id, blob);
}
