'use strict';
/* Fixa — spaced repetition with the FSRS-6 algorithm. Data stays on the device (localStorage + IndexedDB). */

const STORAGE_KEY = 'fixa.v1';
const DEFAULTS = { newPerDay: 10, retention: 0.9, lastDeck: null, lang: 'auto' };
const DAY_ROLLOVER = 4 * 3600e3; // the day changes at 4 a.m.: studying at 1 a.m. still counts as "today"
const DAY = 864e5;
const SECONDS_PER_CARD = 8;      // estimate behind "about N min"

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// Fisher–Yates. Cards never come in the order they were added: otherwise you learn the order, not the cards.
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Inside the APK there is window.FixaAndroid (see android/). In a browser there isn't.
const IN_APK = !!window.FixaAndroid;

/* ---------- Data ---------- */

let db = load();

function fresh() {
  // The app starts empty: every deck and card belongs to the user.
  return { decks: [], cards: [], days: {}, settings: { ...DEFAULTS } };
}

// Accepts data saved by older versions (and old backups) and brings it to the current shape.
function normalize(d) {
  d.settings = { ...DEFAULTS, ...d.settings };
  d.days = d.days || {};
  d.decks = (d.decks || []).map(({ id, name }) => ({ id, name }));
  d.cards = d.cards || [];
  for (const c of d.cards) {
    if (c.midia && !c.media) c.media = c.midia; // field renamed in v0.2.0
    delete c.midia;
  }
  return d;
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    // unreadable data: keep a copy before starting over, so nothing is lost
    try { if (raw) localStorage.setItem(STORAGE_KEY + '.unreadable.' + Date.now(), raw); } catch (_) { /* no room */ }
  }
  return fresh();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch (e) { toast(t('saveFailed')); }
}
let persistenceRequested = false;
function requestPersistence() {
  if (persistenceRequested) return;
  persistenceRequested = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

const deckById = id => db.decks.find(d => d.id === id);
const cardById = id => db.cards.find(c => c.id === id);

/* ---------- Time ---------- */

function dayIndex(ms = Date.now()) {
  const d = new Date(ms - DAY_ROLLOVER);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}
function dayStart(idx) {
  const u = new Date(idx * DAY);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 4).getTime();
}
function formatDays(d) {
  if (d < 30) return tn('days', d);
  if (d < 365) return tn('months', Math.round(d / 30));
  const y = d / 365;
  if (y >= 10) return tn('years', 2, { x: Math.round(y) });
  const x = formatDecimal(y);
  const singular = LANG === 'pt' ? y < 2 : x === formatDecimal(1);
  return tn('years', singular ? 1 : 2, { x });
}
function whenText(daysAhead) {
  if (daysAhead <= 0) return t('laterToday');
  if (daysAhead === 1) return t('tomorrow');
  return t('inDuration', { d: formatDays(daysAhead) });
}

/* ---------- Scheduling (FSRS-6) ---------- */

// What would happen to the card if it got rating r — without saving anything.
function plan(card, r, now = Date.now()) {
  const today = dayIndex(now);
  const elapsed = card.last ? Math.max(0, today - dayIndex(card.last)) : 0;
  const mem = FSRS.step(card.s ? { s: card.s, d: card.d } : null, r, elapsed);
  if (r === 1) return { s: mem.s, d: mem.d, due: now + 60e3, ivl: 0 };
  const ivl = Math.min(FSRS.S_MAX, Math.max(1, Math.round(FSRS.nextInterval(mem.s, db.settings.retention))));
  return { s: mem.s, d: mem.d, due: dayStart(today + ivl), ivl };
}

function answer(card, r) {
  const now = Date.now();
  const today = dayIndex(now);
  const p = plan(card, r, now);
  if (card.state === 'new') card.introduced = today;
  if (r === 1 && card.state === 'review') card.lapses = (card.lapses || 0) + 1;
  card.state = r === 1 ? (card.state === 'review' || card.state === 'relearning' ? 'relearning' : 'learning') : 'review';
  Object.assign(card, { s: p.s, d: p.d, due: p.due, last: now, reps: (card.reps || 0) + 1 });
  db.days[today] = (db.days[today] || 0) + 1;
  save();
}

// How many new cards a deck can still show today. The limit is per deck:
// studying one deck does not use up another deck's new cards.
function newAllowed(deckId, today = dayIndex()) {
  const seen = db.cards.filter(c => c.deckId === deckId && c.introduced === today).length;
  return Math.max(0, db.settings.newPerDay - seen);
}

function counts(deckId = null) {
  const now = Date.now();
  const today = dayIndex(now);
  const out = { due: 0, news: 0, totalNew: 0, total: 0 };
  for (const id of deckId ? [deckId] : db.decks.map(d => d.id)) {
    const pool = db.cards.filter(c => c.deckId === id);
    const fresh = pool.filter(c => c.state === 'new').length;
    out.due += pool.filter(c => c.state !== 'new' && c.due <= now).length;
    out.news += Math.min(fresh, newAllowed(id, today));
    out.totalNew += fresh;
    out.total += pool.length;
  }
  return out;
}

function nextUpText() {
  const now = Date.now();
  const upcoming = db.cards.filter(c => c.state !== 'new' && c.due > now).sort((a, b) => a.due - b.due);
  const { totalNew, news } = counts();
  if (totalNew > 0 && news === 0) return t('seenNewToday');
  if (!upcoming.length) return t('addToStart');
  const firstDay = dayIndex(upcoming[0].due);
  const n = upcoming.filter(c => dayIndex(c.due) === firstDay).length;
  return t('nextUp', { cards: tn('cards', n), when: whenText(firstDay - dayIndex(now)) });
}

function streakDays() {
  let d = dayIndex();
  if (!db.days[d]) d--;
  let n = 0;
  while (db.days[d]) { n++; d--; }
  return n;
}

/* ---------- Navigation ---------- */

const VIEWS = ['home', 'study', 'practice', 'add', 'cards', 'settings'];
function go(v) {
  if (location.hash !== '#' + v) location.hash = v;
  else route();
}
function route() {
  let v = location.hash.slice(1) || 'home';
  if (!VIEWS.includes(v)) v = 'home';
  if (v === 'study' && !session) v = 'home';
  VIEWS.forEach(x => { $('#v-' + x).hidden = x !== v; });
  $$('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === v));
  document.body.classList.toggle('studying', v === 'study');
  document.body.classList.toggle('practicing', v === 'study' && !!session && session.mode === 'practice');
  if (v !== 'study') {
    session = null;
    releaseStudyMedia();
  }
  ({ home: renderHome, practice: renderPractice, add: renderAdd, cards: renderCards, settings: renderSettings, study: () => {} })[v]();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Dangerous button: the first tap arms it, the second confirms.
function confirmTap(btn, label, fn) {
  if (btn.dataset.armed) {
    clearTimeout(btn._timer);
    btn.textContent = btn.dataset.label;
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    fn();
    return;
  }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  btn.classList.add('armed');
  btn._timer = setTimeout(() => {
    btn.textContent = btn.dataset.label;
    delete btn.dataset.armed;
    btn.classList.remove('armed');
  }, 4000);
}

/* ---------- Home ---------- */

function renderHome() {
  const { due, news } = counts();
  const n = due + news;
  $('#today-n').textContent = n;
  $('#today-unit').textContent = tn('cardUnit', n);
  const btn = $('#start-all');
  // With no cards there is no number or chart to show: the screen only offers the next step.
  $('.hero').classList.toggle('empty', !db.cards.length);
  $('#sec-decks').hidden = $('#deck-list').hidden = !db.decks.length;
  $('#sec-forecast').hidden = $('#forecast').hidden = !db.cards.some(c => c.state !== 'new');
  if (!db.decks.length) {
    $('#today-sub').textContent = t('startByCreatingDeck');
    btn.textContent = t('createDeck');
    btn.disabled = false;
    btn.onclick = () => openDeckDialog(null);
  } else if (!db.cards.length) {
    $('#today-sub').textContent = t('noCardsYet');
    btn.textContent = t('addCards');
    btn.disabled = false;
    btn.onclick = () => go('add');
  } else if (!n) {
    // The schedule is done for today, but motivation is not: offer practice, which leaves the schedule alone.
    $('#today-sub').textContent = t('allCaughtUp') + '. ' + nextUpText();
    btn.textContent = t('freePractice');
    btn.disabled = false;
    btn.onclick = () => startPractice(null);
  } else {
    const min = Math.max(1, Math.round((n * SECONDS_PER_CARD) / 60));
    $('#today-sub').textContent = [due && t('toReview', { n: due }), news && tn('newCards', news), t('aboutMinutes', { n: min })]
      .filter(Boolean).join(' · ');
    btn.textContent = t('start');
    btn.disabled = false;
    btn.onclick = () => startSession(null);
  }

  const s = streakDays();
  const chip = $('#streak');
  chip.hidden = !s;
  chip.textContent = tn('streak', s);

  $('#deck-list').innerHTML = db.decks.map(d => {
    const c = counts(d.id);
    return `<li class="deck">
      <button class="row" data-deck="${d.id}">
        <span><b>${esc(d.name)}</b><small>${tn('cards', c.total)}</small></span>
        <span class="pills">${
          !c.total ? `<span class="pill zero">${t('pillEmpty')}</span>`
          : !c.due && !c.news ? `<span class="pill zero">${t('pillDone')}</span>`
          : (c.due ? `<span class="pill due">${t('pillDue', { n: c.due })}</span>` : '') + (c.news ? `<span class="pill new">${tn('newCards', c.news)}</span>` : '')
        }</span>
      </button>
      <button class="icon-btn" data-edit-deck="${d.id}" aria-label="${esc(t('editDeck', { name: d.name }))}">
        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button></li>`;
  }).join('');

  renderForecast();
}

function renderForecast() {
  const today = dayIndex();
  const endOfToday = dayStart(today + 1);
  const days = Array.from({ length: 7 }, (_, i) => {
    const n = db.cards.filter(c => c.state !== 'new' && (i === 0 ? c.due < endOfToday : dayIndex(c.due) === today + i)).length;
    const label = i === 0 ? t('today') : i === 1 ? t('tomorrow')
      : new Date(dayStart(today + i)).toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '');
    return { n, label };
  });
  const max = Math.max(1, ...days.map(d => d.n));
  $('#forecast').innerHTML = days.map((d, i) =>
    `<div class="fc ${i === 0 ? 'today' : ''}"><span class="n">${d.n}</span><span class="b" style="height:${Math.round((d.n / max) * 64)}px"></span><span>${d.label}</span></div>`
  ).join('');
}

/* ---------- Practice ---------- */

function renderPractice() {
  const withCards = db.decks.map(d => ({ d, n: db.cards.filter(c => c.deckId === d.id).length })).filter(x => x.n);
  if (!withCards.length) {
    $('#practice-list').innerHTML = `<li class="empty">${t('practiceNoCards')}</li>`;
    return;
  }
  const row = (id, name, n) => `<li class="deck"><button class="row" data-practice="${id}">
      <span><b>${esc(name)}</b><small>${tn('cards', n)}</small></span></button></li>`;
  $('#practice-list').innerHTML = (withCards.length > 1 ? row('', t('practiceAllDecks'), db.cards.length) : '')
    + withCards.map(x => row(x.d.id, x.d.name, x.n)).join('');
}
$('#practice-list').addEventListener('click', e => {
  const b = e.target.closest('[data-practice]');
  if (b) startPractice(b.dataset.practice || null);
});

$('#deck-list').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit-deck]');
  if (edit) return openDeckDialog(edit.dataset.editDeck);
  const row = e.target.closest('[data-deck]');
  if (row) startSession(row.dataset.deck);
});
$('#new-deck').addEventListener('click', () => openDeckDialog(null));
$('#add-create-deck').addEventListener('click', () => openDeckDialog(null));

/* ---------- Deck dialog ---------- */

let editingDeck = null;
function openDeckDialog(id) {
  editingDeck = id;
  const d = id ? deckById(id) : { name: '' };
  $('#deck-title').textContent = id ? t('editDeckTitle') : t('newDeck');
  $('#deck-name').value = d.name;
  $('#deck-delete').hidden = !id;
  $('#deck-dialog').showModal();
  if (!id) $('#deck-name').focus();
}
$('#deck-form').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  const name = $('#deck-name').value.trim();
  if (!name) return;
  if (editingDeck) deckById(editingDeck).name = name;
  else {
    const deck = { id: uid(), name };
    db.decks.push(deck);
    db.settings.lastDeck = deck.id; // the next card goes straight into it
  }
  save();
  route(); // redraw whichever screen is open (Home or Add)
});
$('#deck-delete').addEventListener('click', e => {
  const n = db.cards.filter(c => c.deckId === editingDeck).length;
  confirmTap(e.currentTarget, n ? t('deleteDeckWith', { cards: tn('cards', n) }) : t('confirm'), () => {
    deleteMediaOf(db.cards.filter(c => c.deckId === editingDeck));
    db.cards = db.cards.filter(c => c.deckId !== editingDeck);
    db.decks = db.decks.filter(d => d.id !== editingDeck);
    if (db.settings.lastDeck === editingDeck) db.settings.lastDeck = null;
    save();
    $('#deck-dialog').close();
    renderHome();
    toast(t('deckDeleted'));
  });
});

/* ---------- Study ---------- */

let session = null;

function startSession(deckId) {
  const now = Date.now();
  const today = dayIndex(now);
  const ids = deckId ? [deckId] : db.decks.map(d => d.id);
  const due = db.cards.filter(c => ids.includes(c.deckId) && c.state !== 'new' && c.due <= now);
  // Which new cards enter today follows the order they were added (so a deck is learned front to back),
  // but the session itself is shuffled: neither reviews nor new cards come in a predictable order.
  const fresh = ids.flatMap(id => db.cards.filter(c => c.deckId === id && c.state === 'new')
    .sort((a, b) => a.created - b.created).slice(0, newAllowed(id, today)));
  const queue = shuffle([...due, ...fresh].map(c => c.id));
  if (!queue.length) return toast(t('nothingToReview'));
  session = { mode: 'review', deckId, queue, learning: [], done: 0, current: null, undo: null };
  openStudyScreen();
}

// Free practice: every card of the deck(s), shuffled, round after round, for as long as you want.
// Nothing is saved: the schedule, the streak and the numbers on Home stay exactly as they were.
function startPractice(deckId) {
  const ids = db.cards.filter(c => !deckId || c.deckId === deckId).map(c => c.id);
  if (!ids.length) return toast(t(deckId ? 'deckHasNoCards' : 'practiceNoCards'));
  session = { mode: 'practice', deckId, queue: shuffle(ids), learning: [], done: 0, current: null, undo: null,
    practiced: 0, roundSize: ids.length, roundDone: 0 };
  openStudyScreen();
}

function openStudyScreen() {
  $('#undo').hidden = true;
  $('#done').hidden = true;
  $('#flash').hidden = false;
  $('#actions').hidden = false;
  go('study');
  document.body.classList.toggle('practicing', session.mode === 'practice');
  $('#keys').textContent = t(session.mode === 'practice' ? 'keysHintPractice' : 'keysHint');
  showCard(pickNext());
}

// Next practice round: reshuffle everything, without starting with the card that was just seen.
function refillPractice(lastId) {
  const ids = db.cards.filter(c => !session.deckId || c.deckId === session.deckId).map(c => c.id);
  let next = shuffle(ids);
  if (next.length > 1 && next[0] === lastId) next.push(next.shift());
  session.queue = next;
  session.roundSize = next.length;
  session.roundDone = 0;
}

function pickNext() {
  if (session.mode === 'practice') {
    while (session.queue.length && !cardById(session.queue[0])) session.queue.shift();
    if (!session.queue.length) refillPractice(null);
    return cardById(session.queue[0]) || null;
  }
  const now = Date.now();
  session.learning = session.learning.filter(id => cardById(id));
  const missed = session.learning.map(cardById).sort((a, b) => a.due - b.due);
  if (missed.length && missed[0].due <= now) return missed[0];
  while (session.queue.length) {
    const c = cardById(session.queue[0]);
    if (c) return c;
    session.queue.shift();
  }
  return missed[0] || null; // only missed cards left: show them now instead of making the user wait
}

// Card media on screen: temporary URLs, released at every card.
const player = new Audio();
let studyMedia = { front: {}, back: {} };
let showToken = 0;

function releaseStudyMedia() {
  FACES.forEach(f => KINDS.forEach(k => { if (studyMedia[f][k]) URL.revokeObjectURL(studyMedia[f][k]); }));
  studyMedia = { front: {}, back: {} };
  player.pause();
}

function play(face) {
  const url = studyMedia[face].audio;
  if (!url) return false;
  player.src = url;
  player.currentTime = 0;
  player.play().catch(() => {});
  return true;
}

/* ---------- Animations ---------- */
// Short on purpose (< 0.5 s): a reward, not a wait. Users who ask the system to reduce motion see none.
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
let animating = false; // while the card flips or leaves, taps and keys are ignored
let leaving = null;    // exit animation of the previous card (held at its end until the next card enters)

function animate(el, frames, options) {
  if (REDUCED_MOTION.matches || !el.animate) return { finished: Promise.resolve(), cancel() {} };
  const a = el.animate(frames, options);
  a.finished.catch(() => {});
  return a;
}

const EXITS = {
  1: [ // Forgot: a little shake, then out to the side
    { transform: 'translateX(0)', opacity: 1 },
    { transform: 'translateX(-12px)', offset: 0.25 },
    { transform: 'translateX(10px)', offset: 0.5 },
    { transform: 'translateX(-60px)', opacity: 0 },
  ],
  3: [ // Remembered: rises and fades
    { transform: 'none', opacity: 1 },
    { transform: 'translateY(-36px) scale(.97)', opacity: 0 },
  ],
  4: [ // Easy: a hop, then flies off
    { transform: 'none', opacity: 1 },
    { transform: 'translateY(-10px) scale(1.04)', opacity: 1, offset: 0.35 },
    { transform: 'translateY(-70px) scale(1.04)', opacity: 0 },
  ],
};

// The "+3 days" label that rises from the pressed button.
function floatLabel(btn, text, r) {
  if (REDUCED_MOTION.matches) return;
  const box = btn.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'float-label r' + r;
  el.textContent = text;
  el.style.left = box.left + box.width / 2 + 'px';
  el.style.top = box.top - 6 + 'px';
  document.body.appendChild(el);
  el.animate([
    { transform: 'translate(-50%, 0) scale(.8)', opacity: 0 },
    { transform: 'translate(-50%, -28px) scale(1.1)', opacity: 1, offset: 0.3 },
    { transform: 'translate(-50%, -80px) scale(1)', opacity: 0 },
  ], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.then(() => el.remove(), () => el.remove());
}

// End of session: confetti bursting from the check mark.
function confetti() {
  if (REDUCED_MOTION.matches) return;
  const target = $('.done-mark');
  const colors = ['var(--accent)', 'var(--easy)', 'var(--again)', 'var(--warn)'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.background = colors[i % colors.length];
    target.appendChild(p);
    const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 60;
    const x = Math.cos(angle) * dist, y = Math.sin(angle) * dist;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(.6)', opacity: 1 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${Math.random() * 360}deg) scale(1)`, opacity: 1, offset: 0.7 },
      { transform: `translate(calc(-50% + ${x * 1.1}px), calc(-50% + ${y * 1.1 + 24}px)) scale(.8)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.1,.8,.3,1)', delay: 120 }).finished.then(() => p.remove(), () => p.remove());
  }
}

async function showCard(c) {
  if (!c) return session && session.mode === 'practice' ? go('home') : finishSession();
  const token = ++showToken;
  releaseStudyMedia();
  session.current = c.id;
  // The new card enters. The previous card's exit is only released after this starts, so nothing flickers.
  animate($('#flash'), [
    { transform: 'translateY(18px) scale(.97)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (leaving) { leaving.cancel(); leaving = null; }
  const deck = deckById(c.deckId);
  $('#flash-deck').textContent = deck ? deck.name : '';
  $('#flash-new').hidden = c.state !== 'new';
  $('#flash').classList.remove('open');
  $$('.play').forEach(b => { b.hidden = true; });
  $('#front').textContent = c.front;
  $('#back').textContent = c.back;
  for (const f of FACES) { // the small line under each face (e.g. hiragana under romaji)
    const sub = $(`#${f}-sub`);
    sub.textContent = c[f + 'Sub'] || '';
    sub.hidden = !c[f + 'Sub'];
  }
  $('#front-img').hidden = true;
  $('#back-img').hidden = true;
  $('#answer').hidden = true;
  $('#reveal').hidden = false;
  $('#grade').hidden = true;
  if (session.mode === 'practice') {
    $('#progress').style.width = (session.roundSize ? (session.roundDone / session.roundSize) * 100 : 0) + '%';
    $('#left').textContent = tn('practiceCount', session.practiced);
  } else {
    const remaining = session.queue.length + session.learning.length;
    const total = session.done + remaining;
    $('#progress').style.width = (total ? (session.done / total) * 100 : 0) + '%';
    $('#left').textContent = tn('left', remaining);
  }

  for (const f of FACES) for (const k of KINDS) {
    const id = c.media && c.media[f] && c.media[f][k];
    if (!id) continue;
    const blob = await MediaStore.get(id).catch(() => null);
    if (token !== showToken) return; // already moved on to the next card
    if (blob) studyMedia[f][k] = URL.createObjectURL(blob);
  }
  $$('.play').forEach(b => { b.hidden = !studyMedia[b.dataset.face].audio; }); // the speaker only exists when the card has audio
  FACES.forEach(f => {
    const img = $(`#${f}-img`);
    img.hidden = !studyMedia[f].img;
    if (studyMedia[f].img) img.src = studyMedia[f].img;
  });
  play('front'); // recorded audio plays on its own
}

let revealedAt = 0;
async function reveal() {
  if (!session || animating || !$('#answer').hidden) return;
  const c = cardById(session.current);
  if (!c) return;
  const flash = $('#flash');
  animating = true;
  // Turn until edge-on (invisible), swap the content, turn back from the other side with a small overshoot.
  await animate(flash, [
    { transform: 'perspective(900px) rotateY(0deg)' },
    { transform: 'perspective(900px) rotateY(90deg)' },
  ], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)' }).finished;
  if (!session || session.current !== c.id) { animating = false; return; }
  flash.classList.add('open');
  $('#answer').hidden = false;
  $('#reveal').hidden = true;
  $('#grade').hidden = false;
  revealedAt = performance.now(); // the double-tap guard counts from when the buttons appear
  if (session.mode === 'practice') {
    $('#i1').textContent = t('practiceAgain');
    $('#i3').textContent = t('practiceLater');
  } else {
    session.intervals = { 3: plan(c, 3).ivl, 4: plan(c, 4).ivl };
    $('#i1').textContent = t('oneMinute');
    $('#i3').textContent = t('inDuration', { d: formatDays(session.intervals[3]) });
    $('#i4').textContent = t('inDuration', { d: formatDays(session.intervals[4]) });
  }
  animate($('#grade'), [
    { transform: 'translateY(10px)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  play('back');
  await animate(flash, [
    { transform: 'perspective(900px) rotateY(-90deg)' },
    { transform: 'perspective(900px) rotateY(10deg)', offset: 0.7 },
    { transform: 'perspective(900px) rotateY(0deg)' },
  ], { duration: 320, easing: 'cubic-bezier(0,0,.2,1)' }).finished;
  animating = false;
}

async function rate(r) {
  if (!session || animating || $('#grade').hidden) return;
  const c = cardById(session.current);
  if (!c) return showCard(pickNext());
  const btn = $(`#grade [data-r="${r}"]`);
  if (session.mode === 'practice') return practiceRate(c, r, btn);
  const label = r === 1 ? '↺ ' + t('oneMinute') : '+' + formatDays(session.intervals[r]);
  session.undo = { card: JSON.parse(JSON.stringify(c)), queue: [...session.queue], learning: [...session.learning], done: session.done, day: dayIndex() };
  answer(c, r);
  session.queue = session.queue.filter(id => id !== c.id);
  session.learning = session.learning.filter(id => id !== c.id);
  if (r === 1) session.learning.push(c.id);
  else session.done++;
  $('#undo').hidden = false;

  animating = true;
  floatLabel(btn, label, r);
  animate(btn, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  leaving = animate($('#flash'), EXITS[r], { duration: r === 1 ? 300 : 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
  await leaving.finished;
  animating = false;
  showCard(pickNext());
}

// Practice answer: nothing is written to the card. Forgot puts it back a few cards ahead; Remembered sends it
// to the end of the round. When the round ends, a new shuffled round begins.
async function practiceRate(c, r, btn) {
  if (r !== 1 && r !== 3) return;
  session.practiced++;
  session.queue = session.queue.filter(id => id !== c.id);
  if (r === 1) session.queue.splice(Math.min(3, session.queue.length), 0, c.id);
  else session.roundDone++;
  if (!session.queue.length) refillPractice(c.id);

  animating = true;
  floatLabel(btn, r === 1 ? '↺' : '✓', r);
  animate(btn, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  leaving = animate($('#flash'), EXITS[r], { duration: r === 1 ? 300 : 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
  await leaving.finished;
  animating = false;
  if (session) showCard(pickNext());
}

function undoLast() {
  const u = session && session.undo;
  if (!u || animating) return;
  const i = db.cards.findIndex(x => x.id === u.card.id);
  if (i >= 0) db.cards[i] = u.card;
  db.days[u.day] = (db.days[u.day] || 1) - 1;
  if (db.days[u.day] <= 0) delete db.days[u.day];
  Object.assign(session, { queue: u.queue, learning: u.learning, done: u.done, undo: null });
  save();
  $('#undo').hidden = true;
  $('#done').hidden = true;
  $('#flash').hidden = false;
  $('#actions').hidden = false;
  showCard(db.cards[i]);
}

function finishSession() {
  releaseStudyMedia();
  if (leaving) { leaving.cancel(); leaving = null; }
  $('#flash').hidden = true;
  $('#actions').hidden = true;
  $('#done').hidden = false;
  $('#progress').style.width = '100%';
  $('#left').textContent = '';
  $('#done-sub').textContent = t('doneSub', { cards: tn('cards', session.done), next: nextUpText() });
  $('#undo').hidden = true;
  animate($('#done'), [{ transform: 'translateY(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
  animate($('.done-mark'), [
    { transform: 'scale(0)' }, { transform: 'scale(1.2)', offset: 0.6 }, { transform: 'scale(1)' },
  ], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)', delay: 80, fill: 'backwards' });
  if (session.done) confetti();
}

$('#reveal').addEventListener('click', reveal);
// Tapping the card itself also shows the answer (a big target, in the middle of the screen).
$('#flash').addEventListener('click', e => { if (!e.target.closest('button')) reveal(); });
$('#grade').addEventListener('click', e => {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  // The rating buttons appear where "Show answer" was: a double tap must not turn into a rating by accident.
  if (performance.now() - revealedAt < 350) return;
  rate(+b.dataset.r);
});
$('#flash-edit').addEventListener('click', () => { const c = session && cardById(session.current); if (c) openCardDialog(c); });
$('#undo').addEventListener('click', undoLast);
$('#quit').addEventListener('click', () => go('home'));
$('#done-home').addEventListener('click', () => go('home'));
$('#done-practice').addEventListener('click', () => startPractice(session ? session.deckId : null));
$$('.play').forEach(b => b.addEventListener('click', () => play(b.dataset.face)));

document.addEventListener('keydown', e => {
  if ($('#v-study').hidden || !session || e.target.closest('input, textarea, select, dialog')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
  else if (e.key === '1') rate(1);
  else if (e.key === '2') rate(3);
  else if (e.key === '3' && session.mode !== 'practice') rate(4);
  else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) undoLast();
  else if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) { const c = cardById(session.current); if (c) openCardDialog(c); }
});

/* ---------- Add ---------- */

function fillDeckSelect(select, current) {
  select.innerHTML = db.decks.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  if (current && deckById(current)) select.value = current;
}

let addDraft = newDraft();
const addPickers = $$('#add-form .media').map(box => mountMediaPicker(box, box.dataset.face, () => addDraft));

function renderAdd() {
  const noDeck = !db.decks.length;
  $('#add-no-deck').hidden = !noDeck;
  $('#add-form').hidden = noDeck;
  $('#bulk').hidden = noDeck;
  if (noDeck) return;
  fillDeckSelect($('#add-deck'), db.settings.lastDeck);
  addPickers.forEach(p => p.render());
  setTimeout(() => $('#add-front').focus(), 50);
}

function buildCard(deckId, front, back, frontSub = '', backSub = '') {
  const c = { id: uid(), deckId, front, back, created: Date.now(), state: 'new' };
  if (frontSub) c.frontSub = frontSub;
  if (backSub) c.backSub = backSub;
  return c;
}
function setSubs(card, frontSub, backSub) {
  if (frontSub) card.frontSub = frontSub; else delete card.frontSub;
  if (backSub) card.backSub = backSub; else delete card.backSub;
}

// あ / ア buttons: fill the small line with the face's text converted to hiragana or katakana (editable afterwards).
document.addEventListener('click', e => {
  const b = e.target.closest('.kana[data-source]');
  if (!b) return;
  const source = $('#' + b.dataset.source);
  const target = $('#' + b.dataset.source + '-sub');
  target.value = toKana(source.value.trim(), b.dataset.kana === 'kata');
  target.focus();
});

let saving = false;
$('#add-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (saving) return;
  const front = $('#add-front').value.trim();
  const back = $('#add-back').value.trim();
  if (!front && !draftHasMedia(addDraft, 'front')) return toast(t('frontNeedsContent'));
  if (!back && !draftHasMedia(addDraft, 'back')) return toast(t('backNeedsContent'));
  const deckId = $('#add-deck').value;
  saving = true;
  try {
    const c = buildCard(deckId, front, back, $('#add-front-sub').value.trim(), $('#add-back-sub').value.trim());
    await commitDraft(c, addDraft); // media first: if it fails, no half-saved card is left behind
    db.cards.push(c);
    db.settings.lastDeck = deckId;
    save();
  } catch (err) {
    toast(t('mediaSaveFailed'));
    return;
  } finally {
    saving = false;
  }
  requestPersistence();
  releaseDraft(addDraft);
  addDraft = newDraft();
  addPickers.forEach(p => p.render());
  ['#add-front', '#add-back', '#add-front-sub', '#add-back-sub'].forEach(s => { $(s).value = ''; });
  $('#add-front').focus();
  toast(t('savedTo', { deck: deckById(deckId).name }));
});
// Ctrl+Enter saves from any field
$('#add-form').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#add-form').requestSubmit(); }
});

function cleanField(s) {
  s = s.trim();
  if (/^"[\s\S]*"$/.test(s)) s = s.slice(1, -1).replace(/""/g, '"');
  if (/<[a-z][\s\S]*>|&[a-z#0-9]+;/i.test(s)) { // HTML exported by other flashcard apps
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n');
    s = new DOMParser().parseFromString(s, 'text/html').body.textContent || '';
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function parseMany(text) {
  const ok = [];
  let bad = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue; // header lines such as #separator:tab
    // columns: front, back, then optionally the small line under the front and under the back
    const cols = line.includes('\t') ? line.split('\t') : line.includes('|') ? line.split('|') : [line];
    const [f, b, fs, bs] = cols.map(x => (x ? cleanField(x) : ''));
    if (f && b) ok.push({ front: f, back: b, frontSub: fs || '', backSub: bs || '' }); else bad++;
  }
  return { ok, bad };
}

$('#bulk-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  $('#bulk-text').value = await f.text();
  e.target.value = '';
  toast(tn('cardsRead', parseMany($('#bulk-text').value).ok.length));
});

$('#bulk-add').addEventListener('click', () => {
  const { ok, bad } = parseMany($('#bulk-text').value);
  if (!ok.length) return toast(t('noLinesFound'));
  const deckId = $('#add-deck').value;
  const existing = new Set(db.cards.filter(c => c.deckId === deckId).map(c => c.front + '\u0000' + c.back));
  let added = 0, dupes = 0;
  for (const c of ok) {
    const k = c.front + '\u0000' + c.back;
    if (existing.has(k)) { dupes++; continue; }
    existing.add(k);
    db.cards.push(buildCard(deckId, c.front, c.back, c.frontSub, c.backSub));
    added++;
  }
  db.settings.lastDeck = deckId;
  save();
  requestPersistence();
  $('#bulk-text').value = '';
  const extra = [dupes && tn('duplicatesSkipped', dupes), bad && tn('linesWithoutBack', bad)].filter(Boolean).join(', ');
  toast(added ? `${tn('cardsAdded', added)}${extra ? ' · ' + extra : ''}.` : t('nothingNew', { what: extra || t('noCards') }));
});

/* ---------- Cards ---------- */

function statusTag(c) {
  if (c.state === 'new') return [t('tagNew'), 'new'];
  if (c.due <= Date.now()) return [t('tagDue'), 'due'];
  return [whenText(dayIndex(c.due) - dayIndex()), ''];
}

function renderCards() {
  const select = $('#cards-deck');
  const current = select.value;
  select.innerHTML = `<option value="">${t('allDecks')}</option>` + db.decks.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  select.value = deckById(current) ? current : '';
  listCards();
}

function listCards() {
  const deckId = $('#cards-deck').value;
  const q = $('#cards-q').value.trim().toLowerCase();
  const list = db.cards
    .filter(c => (!deckId || c.deckId === deckId) && (!q || [c.front, c.back, c.frontSub, c.backSub].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.created - a.created);
  const LIMIT = 300;
  $('#cards-info').textContent = list.length > LIMIT ? t('showingRecent', { lim: LIMIT, n: list.length }) : tn('cards', list.length);
  $('#card-list').innerHTML = list.length
    ? list.slice(0, LIMIT).map(c => {
      const [tag, cls] = statusTag(c);
      const m = c.media || {};
      const extras = [
        (m.front && m.front.img) || (m.back && m.back.img) ? t('imageTag') : '',
        (m.front && m.front.audio) || (m.back && m.back.audio) ? t('audioTag') : '',
      ].filter(Boolean).join(' + ');
      return `<li><button class="card-item" data-card="${c.id}"><span class="front-line"><span>${esc(c.front || t('mediaOnly'))}${c.frontSub ? ` <small class="muted">${esc(c.frontSub)}</small>` : ''}</span><span class="tag ${cls}">${tag}</span></span><span class="back-line">${esc(c.back || t('mediaOnly'))}${extras ? ` · <span class="tag">${extras}</span>` : ''}</span></button></li>`;
    }).join('')
    : `<li class="empty">${db.cards.length ? t('nothingFound') : t('noCardsList')}</li>`;
}
$('#cards-deck').addEventListener('change', listCards);
$('#cards-q').addEventListener('input', listCards);

let editingCard = null;
let editDraft = newDraft();
const editPickers = $$('#card-form .media').map(box => mountMediaPicker(box, box.dataset.face, () => editDraft));
$('#card-dialog').addEventListener('close', () => { releaseDraft(editDraft); editDraft = newDraft(); });

$('#card-list').addEventListener('click', e => {
  const b = e.target.closest('[data-card]');
  const c = b && cardById(b.dataset.card);
  if (c) openCardDialog(c);
});

// After editing: in the list, redraw the list; mid-session, go back to the card (or the next one, if it left).
function afterEdit() {
  if (!session) return listCards();
  const c = cardById(session.current);
  showCard(c && session.queue.concat(session.learning).includes(c.id) ? c : pickNext());
}

async function openCardDialog(c) {
  editingCard = c.id;
  releaseDraft(editDraft);
  editDraft = await draftFromCard(c);
  editPickers.forEach(p => p.render());
  fillDeckSelect($('#card-deck'), c.deckId);
  $('#card-front').value = c.front;
  $('#card-back').value = c.back;
  $('#card-front-sub').value = c.frontSub || '';
  $('#card-back-sub').value = c.backSub || '';
  $('#card-meta').textContent = c.state === 'new'
    ? t('notStudied')
    : t('cardMeta', {
      reps: tn('times', c.reps || 0),
      lapses: tn('times', c.lapses || 0),
      when: statusTag(c)[0],
      stability: formatDays(Math.max(1, Math.round(c.s))),
    });
  $('#card-dialog').showModal();
}
$('#card-form').addEventListener('submit', async e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  e.preventDefault(); // close only after the media is stored
  const c = cardById(editingCard);
  const front = $('#card-front').value.trim();
  const back = $('#card-back').value.trim();
  if (!c) return $('#card-dialog').close();
  if (!front && !draftHasMedia(editDraft, 'front')) return toast(t('frontNeedsContent'));
  if (!back && !draftHasMedia(editDraft, 'back')) return toast(t('backNeedsContent'));
  try { await commitDraft(c, editDraft); }
  catch (err) { return toast(t('mediaSaveFailed')); }
  Object.assign(c, { front, back, deckId: $('#card-deck').value });
  setSubs(c, $('#card-front-sub').value.trim(), $('#card-back-sub').value.trim());
  save();
  $('#card-dialog').close();
  afterEdit();
});
$('#card-delete').addEventListener('click', e => confirmTap(e.currentTarget, t('confirm'), () => {
  deleteMediaOf(db.cards.filter(c => c.id === editingCard));
  db.cards = db.cards.filter(c => c.id !== editingCard);
  if (session) { // deleted mid-session: drop it from the queue
    session.queue = session.queue.filter(id => id !== editingCard);
    session.learning = session.learning.filter(id => id !== editingCard);
    session.undo = null;
    $('#undo').hidden = true;
  }
  save();
  $('#card-dialog').close();
  afterEdit();
  toast(t('cardDeleted'));
}));
$('#card-reset').addEventListener('click', e => confirmTap(e.currentTarget, t('resetConfirm'), () => {
  const c = cardById(editingCard);
  if (!c) return;
  ['s', 'd', 'due', 'last', 'reps', 'lapses', 'introduced'].forEach(k => delete c[k]);
  c.state = 'new';
  save();
  $('#card-dialog').close();
  afterEdit();
  toast(t('cardReset'));
}));

/* ---------- Settings ---------- */

function retentionText(r) {
  const p = Math.round(r * 100);
  if (p === 90) return t('retention90');
  const ratio = FSRS.nextInterval(10, r) / 10; // how the interval changes compared with 90%
  const pace = ratio >= 1 ? t('longerIntervals', { x: formatDecimal(ratio) }) : t('moreFrequent', { x: formatDecimal(1 / ratio) });
  return t('retentionOther', { p, pace });
}

function backupText() {
  if (!db.cards.length) return '';
  const last = db.settings.lastBackup;
  if (!last) return t('noBackupYet');
  const d = dayIndex() - dayIndex(last);
  return t('lastBackup', { when: d <= 0 ? t('today') : d === 1 ? t('yesterday') : t('daysAgo', { n: d }) });
}

function renderSettings() {
  $('#install-card').hidden = IN_APK; // inside the APK it is already installed
  $('#set-lang').value = db.settings.lang;
  $('#set-new').value = db.settings.newPerDay;
  $('#backup-info').textContent = backupText();
  $('#set-ret').value = db.settings.retention;
  $('#ret-val').textContent = Math.round(db.settings.retention * 100) + '%';
  $('#ret-help').textContent = retentionText(db.settings.retention);
  $('#import-msg').textContent = '';
}
$('#set-lang').addEventListener('change', e => {
  db.settings.lang = e.target.value;
  save();
  setLanguage(db.settings.lang);
  renderSettings();
});
$('#set-new').addEventListener('change', e => {
  db.settings.newPerDay = Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0));
  e.target.value = db.settings.newPerDay;
  save();
});
$('#set-ret').addEventListener('input', e => {
  db.settings.retention = Math.round(parseFloat(e.target.value) * 100) / 100;
  $('#ret-val').textContent = Math.round(db.settings.retention * 100) + '%';
  $('#ret-help').textContent = retentionText(db.settings.retention);
  save();
});

$('#export').addEventListener('click', async () => {
  const media = await mediaForBackup(db.cards);
  const json = JSON.stringify({ app: 'fixa', version: 3, savedAt: new Date().toISOString(), ...db, media });
  const name = `fixa-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (IN_APK) return FixaAndroid.saveBackup(name, json); // Android opens "save as"; the answer comes back in onBackupSaved
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  onBackupSaved(true);
});
// Called here (browser) and by the APK after it writes the file.
window.onBackupSaved = onBackupSaved;
function onBackupSaved(ok) {
  if (!ok) return toast(t('backupSaveFailed'));
  db.settings.lastBackup = Date.now();
  save();
  $('#backup-info').textContent = backupText();
  if (IN_APK) toast(t('backupSaved'));
}

let pendingBackup = null;
$('#import').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.cards) || !Array.isArray(d.decks)) throw new Error('format');
    pendingBackup = d;
    $('#import-msg').innerHTML = esc(t('backupContains', { cards: tn('cards', d.cards.length), decks: tn('deckCount', d.decks.length) })) +
      ` <button class="btn danger" id="import-ok">${esc(t('replaceHere'))}</button>`;
    $('#import-ok').addEventListener('click', ev => confirmTap(ev.currentTarget, t('confirmReplace'), async () => {
      const b = pendingBackup;
      pendingBackup = null;
      try { await restoreMedia(b.media || b.midia); } // older backups called the field "midia"
      catch (err) { return toast(t('restoreFailed')); }
      const lang = db.settings.lang;
      db = normalize({ decks: b.decks, cards: b.cards, days: b.days, settings: b.settings });
      db.settings.lang = lang; // the language is a preference of this device, not of the backup
      save();
      renderSettings();
      toast(t('backupRestored'));
    }));
  } catch (err) {
    $('#import-msg').textContent = t('notABackup');
  }
});

$('#wipe').addEventListener('click', e => confirmTap(e.currentTarget, t('wipeConfirm', { decks: tn('deckCount', db.decks.length), cards: tn('cards', db.cards.length) }), () => {
  MediaStore.clear().catch(() => {});
  const lang = db.settings.lang;
  db = fresh();
  db.settings.lang = lang;
  save();
  toast(t('wiped'));
}));

let installPrompt = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('#install-btn').hidden = false;
});
$('#install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('#install-btn').hidden = true;
});

/* ---------- Start-up ---------- */

if (!IN_APK && 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  // When a new version takes over, reload once, so nobody is stuck on the cached one.
  const hadVersion = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadVersion || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Came back to the app the next day: refresh the numbers.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('#v-home').hidden) renderHome();
});
setLanguage(db.settings.lang);
if (db.settings.lang === 'pt' || db.settings.lang === 'en') {
  route();
} else {
  // First run: ask for the language before anything else. The question is shown in the device language.
  $('#welcome').hidden = false;
  document.body.classList.add('welcoming');
}
$('#welcome').addEventListener('click', e => {
  const b = e.target.closest('[data-lang]');
  if (!b) return;
  db.settings.lang = b.dataset.lang;
  save();
  setLanguage(db.settings.lang);
  $('#welcome').hidden = true;
  document.body.classList.remove('welcoming');
  route();
});
