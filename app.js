'use strict';
/* Fixa — revisão espaçada com o algoritmo FSRS-6. Dados só no aparelho (localStorage + IndexedDB). */

const KEY = 'fixa.v1';
const DEFAULTS = { newPerDay: 10, maxReviews: 200, retention: 0.9, lastDeck: null };
const ROLL = 4 * 3600e3;   // o dia vira às 4h: estudar à 1h da manhã ainda conta como "hoje"
const DAY = 864e5;
const SEG_POR_CARTAO = 8;  // estimativa para "uns N min"

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Dentro do APK existe window.FixaAndroid (ver android/). No navegador, não.
const NO_APK = !!window.FixaAndroid;

/* ---------- Dados ---------- */

let db = load();

function fresh() {
  // O app nasce vazio: baralhos e cartões são todos do dono.
  return { decks: [], cards: [], days: {}, settings: { ...DEFAULTS } };
}
function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      d.settings = { ...DEFAULTS, ...d.settings };
      d.days = d.days || {};
      d.decks = d.decks || [];
      d.cards = d.cards || [];
      return d;
    }
  } catch (e) {
    // dado ilegível: guarda uma cópia antes de recomeçar, para não perder nada
    try { if (raw) localStorage.setItem(KEY + '.ilegivel.' + Date.now(), raw); } catch (_) { /* sem espaço */ }
  }
  return fresh();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Não consegui salvar neste aparelho (sem espaço?).'); }
}
let pediuPersistencia = false;
function pedirPersistencia() {
  if (pediuPersistencia) return;
  pediuPersistencia = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

const deckById = id => db.decks.find(d => d.id === id);
const cardById = id => db.cards.find(c => c.id === id);

/* ---------- Tempo ---------- */

function dayIdx(ms = Date.now()) {
  const d = new Date(ms - ROLL);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}
function dayStart(idx) {
  const u = new Date(idx * DAY);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 4).getTime();
}
function fmtDias(d) {
  if (d < 30) return plural(d, 'dia', 'dias');
  if (d < 365) return plural(Math.round(d / 30), 'mês', 'meses');
  const y = d / 365;
  return y < 10 ? `${y.toFixed(1).replace('.', ',')} ${y < 2 ? 'ano' : 'anos'}` : `${Math.round(y)} anos`;
}
function quando(d) {
  if (d <= 0) return 'ainda hoje';
  if (d === 1) return 'amanhã';
  return 'em ' + fmtDias(d);
}

/* ---------- Agendamento (FSRS-6) ---------- */

// O que acontece com o cartão se a nota for r — sem gravar nada.
function plan(card, r, now = Date.now()) {
  const today = dayIdx(now);
  const dt = card.last ? Math.max(0, today - dayIdx(card.last)) : 0;
  const mem = FSRS.step(card.s ? { s: card.s, d: card.d } : null, r, dt);
  if (r === 1) return { s: mem.s, d: mem.d, due: now + 60e3, ivl: 0 };
  const ivl = Math.min(FSRS.S_MAX, Math.max(1, Math.round(FSRS.nextInterval(mem.s, db.settings.retention))));
  return { s: mem.s, d: mem.d, due: dayStart(today + ivl), ivl };
}

function answer(card, r) {
  const now = Date.now();
  const today = dayIdx(now);
  const p = plan(card, r, now);
  if (card.state === 'new') card.introduced = today;
  if (r === 1 && card.state === 'review') card.lapses = (card.lapses || 0) + 1;
  card.state = r === 1 ? (card.state === 'review' || card.state === 'relearning' ? 'relearning' : 'learning') : 'review';
  Object.assign(card, { s: p.s, d: p.d, due: p.due, last: now, reps: (card.reps || 0) + 1 });
  db.days[today] = (db.days[today] || 0) + 1;
  save();
}

// Quantos cartões novos o baralho ainda pode mostrar hoje. O limite é por baralho:
// estudar Inglês não gasta a cota do Japonês.
function novosPermitidos(deckId, today = dayIdx()) {
  const vistos = db.cards.filter(c => c.deckId === deckId && c.introduced === today).length;
  return Math.max(0, db.settings.newPerDay - vistos);
}

function counts(deckId = null) {
  const now = Date.now();
  const today = dayIdx(now);
  const out = { due: 0, news: 0, totalNovos: 0, total: 0 };
  for (const id of deckId ? [deckId] : db.decks.map(d => d.id)) {
    const pool = db.cards.filter(c => c.deckId === id);
    const novos = pool.filter(c => c.state === 'new').length;
    out.due += pool.filter(c => c.state !== 'new' && c.due <= now).length;
    out.news += Math.min(novos, novosPermitidos(id, today));
    out.totalNovos += novos;
    out.total += pool.length;
  }
  return out;
}

function proximoTexto() {
  const now = Date.now();
  const futuros = db.cards.filter(c => c.state !== 'new' && c.due > now).sort((a, b) => a.due - b.due);
  const { totalNovos, news } = counts();
  if (totalNovos > 0 && news === 0) return 'Você já viu os novos de hoje. Amanhã tem mais.';
  if (!futuros.length) return 'Adicione cartões para começar.';
  const d = dayIdx(futuros[0].due) - dayIdx(now);
  const n = futuros.filter(c => dayIdx(c.due) === dayIdx(futuros[0].due)).length;
  return `Próximos: ${plural(n, 'cartão', 'cartões')} ${quando(d)}.`;
}

function sequencia() {
  let t = dayIdx();
  if (!db.days[t]) t--;
  let n = 0;
  while (db.days[t]) { n++; t--; }
  return n;
}

/* ---------- Navegação ---------- */

const VIEWS = ['home', 'study', 'add', 'cards', 'settings'];
function go(v) {
  if (location.hash !== '#' + v) location.hash = v;
  else route();
}
function route() {
  let v = location.hash.slice(1) || 'home';
  if (!VIEWS.includes(v)) v = 'home';
  if (v === 'study' && !sess) v = 'home';
  VIEWS.forEach(x => { $('#v-' + x).hidden = x !== v; });
  $$('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === v));
  document.body.classList.toggle('studying', v === 'study');
  if (v !== 'study') {
    sess = null;
    soltarEstudo();
  }
  ({ home: renderHome, add: renderAdd, cards: renderCards, settings: renderSettings, study: () => {} })[v]();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

// Botão perigoso: o primeiro toque arma, o segundo confirma.
function confirmar(btn, rotulo, fn) {
  if (btn.dataset.armed) {
    clearTimeout(btn._t);
    btn.textContent = btn.dataset.orig;
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    fn();
    return;
  }
  btn.dataset.orig = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = rotulo;
  btn.classList.add('armed');
  btn._t = setTimeout(() => {
    btn.textContent = btn.dataset.orig;
    delete btn.dataset.armed;
    btn.classList.remove('armed');
  }, 4000);
}

/* ---------- Início ---------- */

function renderHome() {
  const { due, news } = counts();
  const n = due + news;
  $('#today-n').textContent = n;
  $('#today-unit').textContent = n === 1 ? 'cartão' : 'cartões';
  const btn = $('#start-all');
  // Sem cartões não há número nem gráfico para mostrar: a tela fica só com o próximo passo.
  $('.hero').classList.toggle('vazio', !db.cards.length);
  $('#sec-decks').hidden = $('#deck-list').hidden = !db.decks.length;
  $('#sec-forecast').hidden = $('#forecast').hidden = !db.cards.some(c => c.state !== 'new');
  if (!db.decks.length) {
    $('#today-sub').textContent = 'Comece criando um baralho.';
    btn.textContent = 'Criar baralho';
    btn.disabled = false;
    btn.onclick = () => abrirBaralho(null);
  } else if (!db.cards.length) {
    $('#today-sub').textContent = 'Ainda não há cartões. Comece adicionando alguns.';
    btn.textContent = 'Adicionar cartões';
    btn.disabled = false;
    btn.onclick = () => go('add');
  } else if (!n) {
    $('#today-sub').textContent = 'Tudo em dia. ' + proximoTexto();
    btn.textContent = 'Tudo em dia';
    btn.disabled = true;
    btn.onclick = null;
  } else {
    const min = Math.max(1, Math.round((n * SEG_POR_CARTAO) / 60));
    $('#today-sub').textContent = [due && `${due} para revisar`, news && plural(news, 'novo', 'novos'), `uns ${min} min`]
      .filter(Boolean).join(' · ');
    btn.textContent = 'Começar';
    btn.disabled = false;
    btn.onclick = () => start(null);
  }

  const s = sequencia();
  const chip = $('#streak');
  chip.hidden = !s;
  chip.textContent = `${plural(s, 'dia seguido', 'dias seguidos')}`;

  const ul = $('#deck-list');
  ul.innerHTML = !db.decks.length ? '<li class="empty">Nenhum baralho ainda.</li>' : db.decks.map(d => {
    const c = counts(d.id);
    return `<li class="deck">
      <button class="row" data-deck="${d.id}">
        <span><b>${esc(d.name)}</b><small>${plural(c.total, 'cartão', 'cartões')}</small></span>
        <span class="pills">${
          !c.total ? '<span class="pill zero">vazio</span>'
          : !c.due && !c.news ? '<span class="pill zero">em dia</span>'
          : (c.due ? `<span class="pill due">${c.due} revisar</span>` : '') + (c.news ? `<span class="pill new">${plural(c.news, 'novo', 'novos')}</span>` : '')
        }</span>
      </button>
      <button class="icon-btn" data-edit-deck="${d.id}" aria-label="Ajustar baralho ${esc(d.name)}">
        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button></li>`;
  }).join('');

  renderForecast();
}

function renderForecast() {
  const today = dayIdx();
  const fim = dayStart(today + 1);
  const dias = Array.from({ length: 7 }, (_, i) => {
    const n = db.cards.filter(c => c.state !== 'new' && (i === 0 ? c.due < fim : dayIdx(c.due) === today + i)).length;
    const rot = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : new Date(dayStart(today + i)).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return { n, rot };
  });
  const max = Math.max(1, ...dias.map(d => d.n));
  $('#forecast').innerHTML = dias.map((d, i) =>
    `<div class="fc ${i === 0 ? 'today' : ''}"><span class="n">${d.n}</span><span class="b" style="height:${Math.round((d.n / max) * 64)}px"></span><span>${d.rot}</span></div>`
  ).join('');
}

$('#deck-list').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit-deck]');
  if (ed) return abrirBaralho(ed.dataset.editDeck);
  const row = e.target.closest('[data-deck]');
  if (row) start(row.dataset.deck);
});
$('#new-deck').addEventListener('click', () => abrirBaralho(null));
$('#add-criar-baralho').addEventListener('click', () => abrirBaralho(null));

/* ---------- Baralho (diálogo) ---------- */

let deckEditando = null;
function abrirBaralho(id) {
  deckEditando = id;
  const d = id ? deckById(id) : { name: '' };
  $('#deck-title').textContent = id ? 'Ajustar baralho' : 'Novo baralho';
  $('#deck-name').value = d.name;
  $('#deck-del').hidden = !id;
  $('#deck-dlg').showModal();
  if (!id) $('#deck-name').focus();
}
$('#deck-form').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  const name = $('#deck-name').value.trim();
  if (!name) return;
  if (deckEditando) deckById(deckEditando).name = name;
  else {
    const novo = { id: uid(), name };
    db.decks.push(novo);
    db.settings.lastDeck = novo.id; // o próximo cartão já cai nele
  }
  save();
  route(); // redesenha a tela em que ele está (Início ou Adicionar)
});
$('#deck-del').addEventListener('click', e => {
  const n = db.cards.filter(c => c.deckId === deckEditando).length;
  confirmar(e.currentTarget, n ? `Apagar com ${plural(n, 'cartão', 'cartões')}?` : 'Confirmar', () => {
    apagarMidiaDe(db.cards.filter(c => c.deckId === deckEditando));
    db.cards = db.cards.filter(c => c.deckId !== deckEditando);
    db.decks = db.decks.filter(d => d.id !== deckEditando);
    if (db.settings.lastDeck === deckEditando) db.settings.lastDeck = null;
    save();
    $('#deck-dlg').close();
    renderHome();
    toast('Baralho apagado.');
  });
});

/* ---------- Estudo ---------- */

let sess = null;

function start(deckId) {
  const now = Date.now();
  const today = dayIdx(now);
  const ids = deckId ? [deckId] : db.decks.map(d => d.id);
  const due = db.cards.filter(c => ids.includes(c.deckId) && c.state !== 'new' && c.due <= now).sort((a, b) => a.due - b.due);
  const novos = ids.flatMap(id => db.cards.filter(c => c.deckId === id && c.state === 'new')
    .sort((a, b) => a.created - b.created).slice(0, novosPermitidos(id, today)));
  // mistura: três revisões, um novo
  const queue = [];
  let i = 0, j = 0;
  while (i < due.length || j < novos.length) {
    for (let k = 0; k < 3 && i < due.length; k++) queue.push(due[i++].id);
    if (j < novos.length) queue.push(novos[j++].id);
  }
  if (!queue.length) return toast('Nada para revisar neste baralho agora.');
  sess = { queue, learning: [], done: 0, cur: null, undo: null };
  $('#undo').hidden = true;
  $('#done').hidden = true;
  $('#flash').hidden = false;
  $('#actions').hidden = false;
  go('study');
  mostrar(escolher());
}

function escolher() {
  const now = Date.now();
  sess.learning = sess.learning.filter(id => cardById(id));
  const errados = sess.learning.map(cardById).sort((a, b) => a.due - b.due);
  if (errados.length && errados[0].due <= now) return errados[0];
  while (sess.queue.length) {
    const c = cardById(sess.queue[0]);
    if (c) return c;
    sess.queue.shift();
  }
  return errados[0] || null; // só sobrou o que errou: mostra já, sem fazer esperar
}

// Mídia do cartão na tela: URLs temporárias que se soltam a cada cartão.
const player = new Audio();
let estudoMidia = { front: {}, back: {} };
let vezDoCartao = 0;

function soltarEstudo() {
  FACES.forEach(f => TIPOS.forEach(k => { if (estudoMidia[f][k]) URL.revokeObjectURL(estudoMidia[f][k]); }));
  estudoMidia = { front: {}, back: {} };
  player.pause();
}

function tocar(face) {
  const url = estudoMidia[face].audio;
  if (!url) return false;
  player.src = url;
  player.currentTime = 0;
  player.play().catch(() => {});
  return true;
}

/* ---------- Animações ---------- */
// Curtas de propósito (< 0,5 s): recompensa, não espera. Quem pede "reduzir movimento" no sistema não vê nenhuma.
const SEM_MOVIMENTO = matchMedia('(prefers-reduced-motion: reduce)');
let animando = false;   // enquanto o cartão gira ou sai, toque e tecla não contam
let saida = null;       // animação de saída do cartão anterior (presa no fim até o próximo entrar)

function animar(el, quadros, opcoes) {
  if (SEM_MOVIMENTO.matches || !el.animate) return { finished: Promise.resolve(), cancel() {} };
  const a = el.animate(quadros, opcoes);
  a.finished.catch(() => {});
  return a;
}

const SAIDAS = {
  1: [ // Esqueci: tremidinha e sai para o lado
    { transform: 'translateX(0)', opacity: 1 },
    { transform: 'translateX(-12px)', offset: 0.25 },
    { transform: 'translateX(10px)', offset: 0.5 },
    { transform: 'translateX(-60px)', opacity: 0 },
  ],
  3: [ // Lembrei: sobe e some
    { transform: 'none', opacity: 1 },
    { transform: 'translateY(-36px) scale(.97)', opacity: 0 },
  ],
  4: [ // Fácil: pulinho e voa
    { transform: 'none', opacity: 1 },
    { transform: 'translateY(-10px) scale(1.04)', opacity: 1, offset: 0.35 },
    { transform: 'translateY(-70px) scale(1.04)', opacity: 0 },
  ],
};

// O "+3 dias" que sobe do botão apertado.
function flutuar(btn, texto, r) {
  if (SEM_MOVIMENTO.matches) return;
  const box = btn.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'flutua r' + r;
  s.textContent = texto;
  s.style.left = box.left + box.width / 2 + 'px';
  s.style.top = box.top - 6 + 'px';
  document.body.appendChild(s);
  s.animate([
    { transform: 'translate(-50%, 0) scale(.8)', opacity: 0 },
    { transform: 'translate(-50%, -28px) scale(1.1)', opacity: 1, offset: 0.3 },
    { transform: 'translate(-50%, -80px) scale(1)', opacity: 0 },
  ], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.then(() => s.remove(), () => s.remove());
}

// Fim da sessão: confete saindo do visto.
function confete() {
  if (SEM_MOVIMENTO.matches) return;
  const alvo = $('.done-mark');
  const cores = ['var(--accent)', 'var(--easy)', 'var(--again)', 'var(--warn)'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('i');
    p.className = 'confete';
    p.style.background = cores[i % cores.length];
    alvo.appendChild(p);
    const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 60;
    const x = Math.cos(ang) * dist, y = Math.sin(ang) * dist;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(.6)', opacity: 1 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${Math.random() * 360}deg) scale(1)`, opacity: 1, offset: 0.7 },
      { transform: `translate(calc(-50% + ${x * 1.1}px), calc(-50% + ${y * 1.1 + 24}px)) scale(.8)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.1,.8,.3,1)', delay: 120 }).finished.then(() => p.remove(), () => p.remove());
  }
}

async function mostrar(c) {
  if (!c) return terminar();
  const vez = ++vezDoCartao;
  soltarEstudo();
  sess.cur = c.id;
  // Entrada do cartão novo. A saída do anterior só é solta depois que esta começa, para não piscar.
  animar($('#flash'), [
    { transform: 'translateY(18px) scale(.97)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (saida) { saida.cancel(); saida = null; }
  const deck = deckById(c.deckId);
  $('#flash-deck').textContent = deck ? deck.name : '';
  $('#flash-novo').hidden = c.state !== 'new';
  $('#flash').classList.remove('aberto');
  $$('.speak').forEach(b => { b.hidden = true; });
  $('#front').textContent = c.front;
  $('#back').textContent = c.back;
  $('#front-img').hidden = true;
  $('#back-img').hidden = true;
  $('#answer').hidden = true;
  $('#reveal').hidden = false;
  $('#grade').hidden = true;
  const resta = sess.queue.length + sess.learning.length;
  const total = sess.done + resta;
  $('#prog').style.width = (total ? (sess.done / total) * 100 : 0) + '%';
  $('#left').textContent = resta === 1 ? '1 restante' : `${resta} restantes`;

  for (const f of FACES) for (const k of TIPOS) {
    const id = c.midia && c.midia[f] && c.midia[f][k];
    if (!id) continue;
    const blob = await Midia.get(id).catch(() => null);
    if (vez !== vezDoCartao) return; // já passou para o próximo
    if (blob) estudoMidia[f][k] = URL.createObjectURL(blob);
  }
  $$('.speak').forEach(b => {
    const f = b.dataset.face;
    b.hidden = !estudoMidia[f].audio; // o alto-falante só existe quando o cartão tem áudio
  });
  FACES.forEach(f => {
    const img = $(`#${f}-img`);
    img.hidden = !estudoMidia[f].img;
    if (estudoMidia[f].img) img.src = estudoMidia[f].img;
  });
  tocar('front'); // o áudio gravado toca sozinho
}

let reveladoEm = 0;
async function revelar() {
  if (!sess || animando || !$('#answer').hidden) return;
  const c = cardById(sess.cur);
  if (!c) return;
  const flash = $('#flash');
  animando = true;
  // Gira até ficar de lado (some), troca o conteúdo e volta girando do outro lado, com um leve passo a mais.
  await animar(flash, [
    { transform: 'perspective(900px) rotateY(0deg)' },
    { transform: 'perspective(900px) rotateY(90deg)' },
  ], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)' }).finished;
  if (!sess || sess.cur !== c.id) { animando = false; return; }
  flash.classList.add('aberto');
  $('#answer').hidden = false;
  $('#reveal').hidden = true;
  $('#grade').hidden = false;
  reveladoEm = performance.now(); // a trava de toque duplo conta de quando os botões aparecem
  $('#i1').textContent = '1 min';
  $('#i3').textContent = 'em ' + fmtDias(plan(c, 3).ivl);
  $('#i4').textContent = 'em ' + fmtDias(plan(c, 4).ivl);
  animar($('#grade'), [
    { transform: 'translateY(10px)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  tocar('back');
  await animar(flash, [
    { transform: 'perspective(900px) rotateY(-90deg)' },
    { transform: 'perspective(900px) rotateY(10deg)', offset: 0.7 },
    { transform: 'perspective(900px) rotateY(0deg)' },
  ], { duration: 320, easing: 'cubic-bezier(0,0,.2,1)' }).finished;
  animando = false;
}

async function notar(r) {
  if (!sess || animando || $('#grade').hidden) return;
  const c = cardById(sess.cur);
  if (!c) return mostrar(escolher());
  const btn = $(`#grade [data-r="${r}"]`);
  const rotulo = r === 1 ? '↺ 1 min' : $('#i' + r).textContent.replace(/^em /, '+');
  sess.undo = { card: JSON.parse(JSON.stringify(c)), queue: [...sess.queue], learning: [...sess.learning], done: sess.done, day: dayIdx() };
  answer(c, r);
  sess.queue = sess.queue.filter(id => id !== c.id);
  sess.learning = sess.learning.filter(id => id !== c.id);
  if (r === 1) sess.learning.push(c.id);
  else sess.done++;
  $('#undo').hidden = false;

  animando = true;
  flutuar(btn, rotulo, r);
  animar(btn, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  saida = animar($('#flash'), SAIDAS[r], { duration: r === 1 ? 300 : 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
  await saida.finished;
  animando = false;
  mostrar(escolher());
}

function desfazer() {
  const u = sess && sess.undo;
  if (!u || animando) return;
  const i = db.cards.findIndex(x => x.id === u.card.id);
  if (i >= 0) db.cards[i] = u.card;
  db.days[u.day] = (db.days[u.day] || 1) - 1;
  if (db.days[u.day] <= 0) delete db.days[u.day];
  Object.assign(sess, { queue: u.queue, learning: u.learning, done: u.done, undo: null });
  save();
  $('#undo').hidden = true;
  $('#done').hidden = true;
  $('#flash').hidden = false;
  $('#actions').hidden = false;
  mostrar(db.cards[i]);
}

function terminar() {
  soltarEstudo();
  if (saida) { saida.cancel(); saida = null; }
  $('#flash').hidden = true;
  $('#actions').hidden = true;
  $('#done').hidden = false;
  $('#prog').style.width = '100%';
  $('#left').textContent = '';
  $('#done-sub').textContent = `Você revisou ${plural(sess.done, 'cartão', 'cartões')}. ${proximoTexto()}`;
  $('#undo').hidden = true;
  animar($('#done'), [{ transform: 'translateY(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
  animar($('.done-mark'), [
    { transform: 'scale(0)' }, { transform: 'scale(1.2)', offset: 0.6 }, { transform: 'scale(1)' },
  ], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)', delay: 80, fill: 'backwards' });
  if (sess.done) confete();
}

$('#reveal').addEventListener('click', revelar);
// Tocar no próprio cartão também mostra a resposta (alvo grande, no meio da tela).
$('#flash').addEventListener('click', e => { if (!e.target.closest('button')) revelar(); });
$('#grade').addEventListener('click', e => {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  // Os botões de nota aparecem onde estava "Mostrar resposta": um toque duplo não pode virar nota sem querer.
  if (performance.now() - reveladoEm < 350) return;
  notar(+b.dataset.r);
});
$('#flash-edit').addEventListener('click', () => { const c = sess && cardById(sess.cur); if (c) abrirCartao(c); });
$('#undo').addEventListener('click', desfazer);
$('#quit').addEventListener('click', () => go('home'));
$('#done-home').addEventListener('click', () => go('home'));
$$('.speak').forEach(b => b.addEventListener('click', () => tocar(b.dataset.face)));

document.addEventListener('keydown', e => {
  if ($('#v-study').hidden || !sess || e.target.closest('input, textarea, select, dialog')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); revelar(); }
  else if (e.key === '1') notar(1);
  else if (e.key === '2') notar(3);
  else if (e.key === '3') notar(4);
  else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) desfazer();
  else if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) { const c = cardById(sess.cur); if (c) abrirCartao(c); }
});

/* ---------- Adicionar ---------- */

function opcoesBaralho(sel, atual) {
  sel.innerHTML = db.decks.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  if (atual && deckById(atual)) sel.value = atual;
}

let addR = novoRascunho();
const addMidia = $$('#add-form .midia').map(cx => montarMidia(cx, cx.dataset.face, () => addR));

function renderAdd() {
  const semBaralho = !db.decks.length;
  $('#add-sem-baralho').hidden = !semBaralho;
  $('#add-form').hidden = semBaralho;
  $('#bulk').hidden = semBaralho;
  if (semBaralho) return;
  opcoesBaralho($('#add-deck'), db.settings.lastDeck);
  addMidia.forEach(m => m.render());
  setTimeout(() => $('#add-front').focus(), 50);
}

const montarCartao = (deckId, front, back) => ({ id: uid(), deckId, front, back, created: Date.now(), state: 'new' });
function novoCartao(deckId, front, back) {
  const c = montarCartao(deckId, front, back);
  db.cards.push(c);
  return c;
}

let salvando = false;
$('#add-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (salvando) return;
  const front = $('#add-front').value.trim();
  const back = $('#add-back').value.trim();
  if (!front && !temMidia(addR, 'front')) return toast('A frente precisa de texto, imagem ou áudio.');
  if (!back && !temMidia(addR, 'back')) return toast('O verso precisa de texto, imagem ou áudio.');
  const deckId = $('#add-deck').value;
  salvando = true;
  try {
    const c = montarCartao(deckId, front, back);
    await gravarRascunho(c, addR); // a mídia primeiro: se falhar, não fica cartão pela metade
    db.cards.push(c);
    db.settings.lastDeck = deckId;
    save();
  } catch (err) {
    toast('Não consegui guardar a mídia neste aparelho.');
    return;
  } finally {
    salvando = false;
  }
  pedirPersistencia();
  soltarRascunho(addR);
  addR = novoRascunho();
  addMidia.forEach(m => m.render());
  $('#add-front').value = '';
  $('#add-back').value = '';
  $('#add-front').focus();
  toast(`Salvo em ${deckById(deckId).name}.`);
});
// Ctrl+Enter salva de qualquer campo
$('#add-form').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#add-form').requestSubmit(); }
});

function limparCampo(s) {
  s = s.trim();
  if (/^"[\s\S]*"$/.test(s)) s = s.slice(1, -1).replace(/""/g, '"');
  if (/<[a-z][\s\S]*>|&[a-z#0-9]+;/i.test(s)) { // HTML vindo de outro app de cartões
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n');
    s = new DOMParser().parseFromString(s, 'text/html').body.textContent || '';
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function lerVarios(texto) {
  const ok = [];
  let ruins = 0;
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim() || linha.startsWith('#')) continue; // linhas de cabeçalho: #separator:tab etc.
    let f, b;
    if (linha.includes('\t')) [f, b] = linha.split('\t');
    else if (linha.includes('|')) { const p = linha.split('|'); f = p[0]; b = p.slice(1).join('|'); }
    f = f && limparCampo(f);
    b = b && limparCampo(b);
    if (f && b) ok.push({ front: f, back: b }); else ruins++;
  }
  return { ok, ruins };
}

$('#bulk-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  $('#bulk-text').value = await f.text();
  e.target.value = '';
  const { ok } = lerVarios($('#bulk-text').value);
  toast(`${plural(ok.length, 'cartão lido', 'cartões lidos')}. Confira e toque em Adicionar todos.`);
});

$('#bulk-add').addEventListener('click', () => {
  const { ok, ruins } = lerVarios($('#bulk-text').value);
  if (!ok.length) return toast('Não achei nenhuma linha no formato frente | verso.');
  const deckId = $('#add-deck').value;
  const ja = new Set(db.cards.filter(c => c.deckId === deckId).map(c => c.front + '\u0000' + c.back));
  let novos = 0, repetidos = 0;
  for (const c of ok) {
    const k = c.front + '\u0000' + c.back;
    if (ja.has(k)) { repetidos++; continue; }
    ja.add(k);
    novoCartao(deckId, c.front, c.back);
    novos++;
  }
  db.settings.lastDeck = deckId;
  save();
  pedirPersistencia();
  $('#bulk-text').value = '';
  const extra = [
    repetidos && plural(repetidos, 'repetido ignorado', 'repetidos ignorados'),
    ruins && plural(ruins, 'linha sem verso', 'linhas sem verso'),
  ].filter(Boolean).join(', ');
  toast(novos ? `${plural(novos, 'cartão adicionado', 'cartões adicionados')}${extra ? ' · ' + extra : ''}.`
    : `Nada novo: ${extra || 'nenhum cartão'}.`);
});

/* ---------- Cartões ---------- */

function etiqueta(c) {
  if (c.state === 'new') return ['novo', 'new'];
  if (c.due <= Date.now()) return ['para hoje', 'due'];
  return [quando(dayIdx(c.due) - dayIdx()), ''];
}

function renderCards() {
  const sel = $('#cards-deck');
  const atual = sel.value;
  sel.innerHTML = `<option value="">Todos</option>` + db.decks.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  sel.value = deckById(atual) ? atual : '';
  listarCartoes();
}

function listarCartoes() {
  const deckId = $('#cards-deck').value;
  const q = $('#cards-q').value.trim().toLowerCase();
  let lista = db.cards.filter(c => (!deckId || c.deckId === deckId) && (!q || (c.front + ' ' + c.back).toLowerCase().includes(q)));
  lista = lista.sort((a, b) => b.created - a.created);
  const LIM = 300;
  $('#cards-info').textContent = lista.length > LIM
    ? `Mostrando os ${LIM} mais recentes de ${lista.length}. Use a busca.`
    : plural(lista.length, 'cartão', 'cartões');
  $('#card-list').innerHTML = lista.length
    ? lista.slice(0, LIM).map(c => {
      const [t, cls] = etiqueta(c);
      const m = c.midia || {};
      const extras = [(m.front && m.front.img) || (m.back && m.back.img) ? 'imagem' : '', (m.front && m.front.audio) || (m.back && m.back.audio) ? 'áudio' : '']
        .filter(Boolean).join(' + ');
      return `<li><button class="citem" data-card="${c.id}"><span class="f"><span>${esc(c.front || '(só mídia)')}</span><span class="tag ${cls}">${t}</span></span><span class="b">${esc(c.back || '(só mídia)')}${extras ? ` · <span class="tag">${extras}</span>` : ''}</span></button></li>`;
    }).join('')
    : `<li class="empty">${db.cards.length ? 'Nada encontrado.' : 'Nenhum cartão ainda.'}</li>`;
}
$('#cards-deck').addEventListener('change', listarCartoes);
$('#cards-q').addEventListener('input', listarCartoes);

let cardEditando = null;
let editR = novoRascunho();
const editMidia = $$('#card-form .midia').map(cx => montarMidia(cx, cx.dataset.face, () => editR));
$('#card-dlg').addEventListener('close', () => { soltarRascunho(editR); editR = novoRascunho(); });

$('#card-list').addEventListener('click', e => {
  const b = e.target.closest('[data-card]');
  const c = b && cardById(b.dataset.card);
  if (c) abrirCartao(c);
});

// Depois de editar: na lista, redesenha a lista; no meio do estudo, volta ao cartão (ou ao próximo, se ele saiu).
function depoisDeEditar() {
  if (!sess) return listarCartoes();
  const c = cardById(sess.cur);
  mostrar(c && sess.queue.concat(sess.learning).includes(c.id) ? c : escolher());
}

async function abrirCartao(c) {
  cardEditando = c.id;
  soltarRascunho(editR);
  editR = await rascunhoDoCartao(c);
  editMidia.forEach(m => m.render());
  opcoesBaralho($('#card-deck'), c.deckId);
  $('#card-front').value = c.front;
  $('#card-back').value = c.back;
  $('#card-meta').textContent = c.state === 'new'
    ? 'Ainda não estudado.'
    : `Revisado ${plural(c.reps || 0, 'vez', 'vezes')} · esqueceu ${plural(c.lapses || 0, 'vez', 'vezes')} · volta ${etiqueta(c)[0]} · estabilidade ${fmtDias(Math.max(1, Math.round(c.s)))}`;
  $('#card-dlg').showModal();
}
$('#card-form').addEventListener('submit', async e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  e.preventDefault(); // fecha só depois de guardar a mídia
  const c = cardById(cardEditando);
  const front = $('#card-front').value.trim();
  const back = $('#card-back').value.trim();
  if (!c) return $('#card-dlg').close();
  if (!front && !temMidia(editR, 'front')) return toast('A frente precisa de texto, imagem ou áudio.');
  if (!back && !temMidia(editR, 'back')) return toast('O verso precisa de texto, imagem ou áudio.');
  try { await gravarRascunho(c, editR); }
  catch (err) { return toast('Não consegui guardar a mídia neste aparelho.'); }
  Object.assign(c, { front, back, deckId: $('#card-deck').value });
  save();
  $('#card-dlg').close();
  depoisDeEditar();
});
$('#card-del').addEventListener('click', e => confirmar(e.currentTarget, 'Confirmar', () => {
  apagarMidiaDe(db.cards.filter(c => c.id === cardEditando));
  db.cards = db.cards.filter(c => c.id !== cardEditando);
  if (sess) { // apagado no meio do estudo: sai da fila
    sess.queue = sess.queue.filter(id => id !== cardEditando);
    sess.learning = sess.learning.filter(id => id !== cardEditando);
    sess.undo = null;
    $('#undo').hidden = true;
  }
  save();
  $('#card-dlg').close();
  depoisDeEditar();
  toast('Cartão apagado.');
}));
$('#card-reset').addEventListener('click', e => confirmar(e.currentTarget, 'Zerar o progresso?', () => {
  const c = cardById(cardEditando);
  if (!c) return;
  ['s', 'd', 'due', 'last', 'reps', 'lapses', 'introduced'].forEach(k => delete c[k]);
  c.state = 'new';
  save();
  $('#card-dlg').close();
  depoisDeEditar();
  toast('O cartão volta como novo.');
}));

/* ---------- Ajustes ---------- */

function textoRetencao(r) {
  const p = Math.round(r * 100);
  const media = FSRS.nextInterval(10, r) / 10; // quanto o intervalo muda em relação aos 90%
  const ritmo = media >= 1 ? `intervalos ${media.toFixed(1).replace('.', ',')}× maiores` : `revisões ${(1 / media).toFixed(1).replace('.', ',')}× mais frequentes`;
  if (p === 90) return 'De cada 10 cartões, você lembra 9 na hora da revisão. É o valor recomendado.';
  return `De cada 100 cartões, você lembra ${p} na hora da revisão — ${ritmo} que no padrão (90%).`;
}

function textoBackup() {
  if (!db.cards.length) return '';
  const quando = db.settings.lastBackup;
  if (!quando) return 'Você ainda não baixou nenhum backup. Os cartões só existem neste aparelho.';
  const d = dayIdx() - dayIdx(quando);
  return 'Último backup: ' + (d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`) + '.';
}

function renderSettings() {
  $('#card-instalar').hidden = NO_APK; // dentro do APK já está instalado
  $('#set-new').value = db.settings.newPerDay;
  $('#backup-info').textContent = textoBackup();
  $('#set-ret').value = db.settings.retention;
  $('#ret-val').textContent = Math.round(db.settings.retention * 100) + '%';
  $('#ret-help').textContent = textoRetencao(db.settings.retention);
  $('#import-msg').textContent = '';
}
$('#set-new').addEventListener('change', e => {
  db.settings.newPerDay = Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0));
  e.target.value = db.settings.newPerDay;
  save();
});
$('#set-ret').addEventListener('input', e => {
  db.settings.retention = Math.round(parseFloat(e.target.value) * 100) / 100;
  $('#ret-val').textContent = Math.round(db.settings.retention * 100) + '%';
  $('#ret-help').textContent = textoRetencao(db.settings.retention);
  save();
});

$('#export').addEventListener('click', async () => {
  const midia = await midiaParaBackup(db.cards);
  const json = JSON.stringify({ app: 'fixa', versao: 2, salvoEm: new Date().toISOString(), ...db, midia });
  const nome = `fixa-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (NO_APK) return FixaAndroid.salvarBackup(nome, json); // o Android abre "salvar como"; a resposta vem em backupSalvo
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  backupSalvo(true);
});
// Chamado aqui (navegador) e pelo APK depois de gravar o arquivo.
window.backupSalvo = backupSalvo;
function backupSalvo(ok) {
  if (!ok) return toast('Não consegui salvar o backup.');
  db.settings.lastBackup = Date.now();
  save();
  $('#backup-info').textContent = textoBackup();
  if (NO_APK) toast('Backup salvo.');
}

let backupPendente = null;
$('#import').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.cards) || !Array.isArray(d.decks)) throw new Error('formato');
    backupPendente = d;
    $('#import-msg').innerHTML = `Backup com ${plural(d.cards.length, 'cartão', 'cartões')} em ${plural(d.decks.length, 'baralho', 'baralhos')}. ` +
      `<button class="btn danger" id="import-ok">Substituir o que está aqui</button>`;
    $('#import-ok').addEventListener('click', ev => confirmar(ev.currentTarget, 'Confirmar substituição', async () => {
      const b = backupPendente;
      backupPendente = null;
      try { await restaurarMidia(b.midia); }
      catch (err) { return toast('Não consegui restaurar a mídia; nada foi trocado.'); }
      db = { decks: b.decks, cards: b.cards, days: b.days || {}, settings: { ...DEFAULTS, ...b.settings } };
      save();
      renderSettings();
      toast('Backup restaurado.');
    }));
  } catch (err) {
    $('#import-msg').textContent = 'Esse arquivo não é um backup do Fixa.';
  }
});

$('#wipe').addEventListener('click', e => confirmar(e.currentTarget, `Apagar ${plural(db.decks.length, 'baralho', 'baralhos')} e ${plural(db.cards.length, 'cartão', 'cartões')}?`, () => {
  Midia.limpar().catch(() => {});
  db = fresh();
  save();
  toast('Tudo apagado.');
}));

let pedidoInstalar = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  pedidoInstalar = e;
  $('#install-btn').hidden = false;
});
$('#install-btn').addEventListener('click', async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice.catch(() => {});
  pedidoInstalar = null;
  $('#install-btn').hidden = true;
});

/* ---------- Partida ---------- */

if (!NO_APK && 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  // Quando uma versão nova assume, recarrega uma vez, para ninguém ficar preso na versão guardada.
  const jaTinhaVersao = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaTinhaVersao || recarregou) return;
    recarregou = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Voltou para o app no dia seguinte: atualiza os números.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('#v-home').hidden) renderHome();
});
route();
