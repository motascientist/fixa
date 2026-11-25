'use strict';
/*
 * Card images and audio. They live in the browser's IndexedDB — on the device, like everything else.
 * (Card text lives in localStorage, which only holds about 5 MB; media needs more room.)
 */

const MediaStore = (() => {
  const NAME = 'fixa-media';
  const LEGACY_NAME = 'fixa-midia'; // database name used before v0.2.0
  let opening = null;

  const openDb = name => new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('m');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  // One-time move from the legacy database, so media saved by older versions is not lost.
  async function migrateLegacy(db) {
    if (!indexedDB.databases) return;
    const list = await indexedDB.databases().catch(() => []);
    if (!list.some(d => d.name === LEGACY_NAME)) return;
    const old = await openDb(LEGACY_NAME);
    const entries = await new Promise((resolve, reject) => {
      const out = [];
      const req = old.transaction('m', 'readonly').objectStore('m').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('m', 'readwrite');
      entries.forEach(([k, v]) => tx.objectStore('m').put(v, k));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    old.close();
    indexedDB.deleteDatabase(LEGACY_NAME); // only after everything was copied
  }

  function open() {
    return opening || (opening = openDb(NAME).then(async db => {
      try { await migrateLegacy(db); } catch (e) { /* the legacy database stays; nothing is lost */ }
      return db;
    }));
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('m', mode);
      const req = fn(t.objectStore('m'));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    put: (id, blob) => tx('readwrite', s => s.put(blob, id)),
    get: id => tx('readonly', s => s.get(id)),
    remove: id => tx('readwrite', s => s.delete(id)),
    clear: () => tx('readwrite', s => s.clear()),
    keys: () => tx('readonly', s => s.getAllKeys()),
  };
})();

const FACES = ['front', 'back'];
const KINDS = ['img', 'audio'];

// Media ids of a card, as a flat list.
function mediaIds(card) {
  const m = card && card.media;
  if (!m) return [];
  return FACES.flatMap(f => KINDS.map(k => m[f] && m[f][k])).filter(Boolean);
}
async function deleteMediaOf(cards) {
  for (const c of cards) for (const id of mediaIds(c)) await MediaStore.remove(id).catch(() => {});
}

// Phone photos are 4000 px wide; 1280 px is plenty to study from and takes a fraction of the space.
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp|bmp)$/.test(file.type) || !window.createImageBitmap) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 400e3) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const b = await new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
    return b && b.size < file.size ? b : file;
  } catch (e) {
    return file;
  }
}

/* ---------- Draft: the media being put together in a form ---------- */
// Shape: { front: { img: slot|null, audio: slot|null }, back: {...} }, slot = { id?, blob, url }

function newDraft() {
  return { front: { img: null, audio: null }, back: { img: null, audio: null } };
}
function releaseDraft(d) {
  if (!d) return;
  FACES.forEach(f => KINDS.forEach(k => { if (d[f][k]) URL.revokeObjectURL(d[f][k].url); }));
}
async function draftFromCard(card) {
  const d = newDraft();
  for (const f of FACES) for (const k of KINDS) {
    const id = card.media && card.media[f] && card.media[f][k];
    if (!id) continue;
    const blob = await MediaStore.get(id).catch(() => null);
    if (blob) d[f][k] = { id, blob, url: URL.createObjectURL(blob) };
  }
  return d;
}
const draftHasMedia = (d, face) => !!(d[face].img || d[face].audio);

// Writes the draft into the card: stores what is new, deletes what was removed.
async function commitDraft(card, d) {
  const before = card.media || {};
  const after = { front: {}, back: {} };
  let any = false;
  for (const f of FACES) for (const k of KINDS) {
    const slot = d[f][k];
    const oldId = before[f] && before[f][k];
    if (slot) {
      if (slot.id && slot.id === oldId) after[f][k] = slot.id;
      else { const id = uid(); await MediaStore.put(id, slot.blob); after[f][k] = id; }
      any = true;
    }
    if (oldId && after[f][k] !== oldId) await MediaStore.remove(oldId).catch(() => {});
  }
  if (any) card.media = after; else delete card.media;
}

/* ---------- Widget: Image / Audio / Record buttons + preview ---------- */

let recorder = null;

function mountMediaPicker(box, face, getDraft) {
  function render() {
    const s = getDraft()[face];
    const recordingHere = recorder && recorder.face === face && recorder.box === box;
    box.innerHTML = `
      <div class="media-bar">
        <label class="mini">${t('image')}<input type="file" accept="image/*" data-kind="img" hidden></label>
        <label class="mini">${t('audio')}<input type="file" accept="audio/*" data-kind="audio" hidden></label>
        <button type="button" class="mini" data-record>${recordingHere ? t('stop') : t('record')}</button>
      </div>
      ${s.img || s.audio ? `<div class="media-preview">
        ${s.img ? `<figure><img src="${s.img.url}" alt=""><button type="button" class="remove" data-remove="img" aria-label="${t('removeImage')}">×</button></figure>` : ''}
        ${s.audio ? `<div class="audio"><audio controls preload="metadata" src="${s.audio.url}"></audio><button type="button" class="remove" data-remove="audio" aria-label="${t('removeAudio')}">×</button></div>` : ''}
      </div>` : ''}`;
  }
  async function attach(kind, blob) {
    const d = getDraft();
    if (kind === 'img') blob = await shrinkImage(blob);
    if (d[face][kind] && !d[face][kind].id) URL.revokeObjectURL(d[face][kind].url);
    d[face][kind] = { blob, url: URL.createObjectURL(blob) };
    requestPersistence();
    render();
  }
  box.addEventListener('change', e => {
    const input = e.target.closest('input[type=file]');
    if (input && input.files[0]) attach(input.dataset.kind, input.files[0]);
  });
  box.addEventListener('click', async e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const d = getDraft();
      const kind = rm.dataset.remove;
      if (d[face][kind] && !d[face][kind].id) URL.revokeObjectURL(d[face][kind].url);
      d[face][kind] = null;
      return render();
    }
    if (e.target.closest('[data-record]')) {
      if (recorder) { recorder.rec.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) return toast(t('cantRecord'));
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (err) { return toast(t('noMicrophone')); }
      const chunks = [];
      const rec = new MediaRecorder(stream);
      recorder = { rec, face, box };
      rec.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop());
        recorder = null;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size) attach('audio', blob); else render();
      };
      rec.start();
      render();
    }
  });
  // Ctrl+V of a screenshot pastes it as the image of the face whose text field has focus
  const field = box.parentElement.querySelector('textarea');
  if (field) field.addEventListener('paste', e => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); attach('img', item.getAsFile()); }
  });
  return { render };
}

/* ---------- Backup: media goes along, as data URLs ---------- */

const blobToDataUrl = b => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(b);
});
async function mediaForBackup(cards) {
  const out = {};
  for (const c of cards) for (const id of mediaIds(c)) {
    const b = await MediaStore.get(id).catch(() => null);
    if (b) out[id] = await blobToDataUrl(b);
  }
  return out;
}
async function restoreMedia(map) {
  // Read everything from the backup first; only then clear the device. A bad backup destroys nothing.
  const ready = [];
  for (const [id, url] of Object.entries(map || {})) ready.push([id, await (await fetch(url)).blob()]);
  await MediaStore.clear();
  for (const [id, blob] of ready) await MediaStore.put(id, blob);
}
