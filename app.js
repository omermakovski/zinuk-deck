(function () {
  'use strict';
  const V = window.VOCAB || { groups: [], known: [] };
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keyOf = w => String(w).trim().toLowerCase();

  // ---------- word index ----------
  const WORDS = {};          // key -> {w, he, ex, exHe, note, units, group, quizlet:'l'|'k'}
  const seenK = {};
  V.groups.forEach(g => g.words.forEach(w => { seenK[keyOf(w.w)] = 1; if (!w.k) w.k = keyOf(w.w); WORDS[w.k] = Object.assign({ group: g.id, origin: 'l' }, w); }));
  V.known.forEach(w => { const k = keyOf(w.w); if (!WORDS[k]) WORDS[k] = Object.assign({ group: null, origin: 'k', units: [w.unit] }, w); });
  const GROUP_KEYS = Object.keys(WORDS).filter(k => WORDS[k].group);
  const TOTAL = GROUP_KEYS.length;

  // ---------- state & persistence ----------
  const LS = 'zinuk-deck-v1';
  let state = { s: {}, ex: {}, am: { runs: {}, cur: null }, as: {}, lv: 1, t: 0 };
  try { const raw = localStorage.getItem(LS); if (raw) state = Object.assign(state, JSON.parse(raw)); } catch (e) { }
  // Move progress saved under old position-based keys (word, word~2) to the permanent card ids.
  const LEGACY = {};
  V.groups.forEach(g => g.words.forEach(w => { if (w.legacy) LEGACY[w.legacy] = w.k; }));
  // Layout 2 regrouped groups 9+ into 25-card groups: their old exercise scores no longer match, so drop them.
  const LAYOUT = V.layout || 1;
  function migrate(st) {
    let changed = false;
    if (!st.am || typeof st.am !== 'object') { st.am = { runs: {}, cur: null }; changed = true; }
    if (!st.am.runs) { st.am.runs = {}; changed = true; }
    if (!st.as || typeof st.as !== 'object') { st.as = {}; changed = true; }
    if ((st.lv || 1) < LAYOUT) {
      Object.keys(st.ex || {}).forEach(id => { if (+id >= 9) delete st.ex[id]; });
      st.lv = LAYOUT; changed = true;
    }
    Object.keys(LEGACY).forEach(old => {
      if (old in st.s && !WORDS[old]) {
        const nk = LEGACY[old];
        if (!(nk in st.s)) st.s[nk] = st.s[old];
        delete st.s[old]; changed = true;
      }
    });
    return changed;
  }
  if (migrate(state)) { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { } }
  const status = k => state.s[k] || (WORDS[k] && WORDS[k].origin) || 'l';
  let db = null, docRef = null, saveTimer = null, saving = false, pending = false;
  const syncEl = $('#sync');

  function persist() {
    state.t = Date.now();
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { }
    if (docRef) { clearTimeout(saveTimer); saveTimer = setTimeout(pushRemote, 1200); syncEl.textContent = 'Saving…'; }
  }
  async function pushRemote() {
    if (saving) { pending = true; return; }
    saving = true;
    try { await docRef.set({ s: state.s, ex: state.ex, am: state.am, as: state.as, lv: state.lv, t: state.t }); syncEl.textContent = 'Synced to your account'; }
    catch (e) { syncEl.textContent = 'Saved on this device only'; }
    saving = false;
    if (pending) { pending = false; pushRemote(); }
  }
  // Hebrew memory hook the learner writes for a card, keyed by card id.
  const assoc = k => (state.as && state.as[k]) || '';
  function setAssoc(k, v) {
    v = String(v || '').trim();
    if (v) state.as[k] = v; else delete state.as[k];
    persist();
  }
  function setStatus(k, v) {
    if (v === ((WORDS[k] && WORDS[k].origin) || 'l')) delete state.s[k]; else state.s[k] = v;
    persist();
  }

  (async function connect() {
    try {
      if (!window.claude || !window.claude.use) return;
      const [d, u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!d || !u) return;
      const id = await u.id();
      if (!id) return;
      db = d; docRef = db.doc('data/users/' + id + '/progress');
      syncEl.textContent = 'Connecting…';
      const timer = setTimeout(() => { syncEl.textContent = 'Saved on this device (sync not reachable yet)'; }, 10000);
      const snap = await docRef.get();
      clearTimeout(timer);
      if (snap.exists) {
        const r = snap.data();
        if ((r.t || 0) >= (state.t || 0)) { state = { s: Object.assign({}, r.s || {}), ex: Object.assign({}, r.ex || {}), am: r.am || state.am, as: Object.assign({}, r.as || {}), lv: r.lv || 1, t: r.t || 0 }; migrate(state); try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { } render(); }
        else pushRemote();
        syncEl.textContent = 'Synced to your account';
      } else if (state.t) { pushRemote(); } else syncEl.textContent = 'Synced to your account';
    } catch (e) { syncEl.textContent = 'Saved on this device'; }
  })();

  // ---------- helpers ----------
  const groupStats = g => { let k = 0; g.words.forEach(w => { if (status(w.k) === 'k') k++; }); return { k, n: g.words.length }; };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hl = (sent, word) => {
    const b = word.toLowerCase().replace(/[-\s]+/g, '[-\\s]+');
    const stem = /\s|-/.test(word) ? b : (word.length > 5 ? b.slice(0, -2) : b.replace(/(e|y)$/, ''));
    const IRR = { strike: 'struck', break: 'broke', bear: 'bore|born', mean: 'meant', grind: 'ground', withstand: 'withstood', overcome: 'overcame', undertake: 'undertook', undergo: 'underwent', foresee: 'foresaw', forbid: 'forbade', mislead: 'misled', seek: 'sought', lay: 'laid', spill: 'spilt', spell: 'spelt', 'carry out': 'carried out|carries out', proof: '[a-z]*proof' };
    const alt = IRR[word.toLowerCase()] ? '|' + IRR[word.toLowerCase()] : '';
    return esc(sent).replace(new RegExp('\\b(' + stem + '[a-z]*' + alt + ')\\b', 'i'), '<b class="tw">$1</b>');
  };
  const pill = k => status(k) === 'k' ? '<span class="pill k">Know</span>' : '<span class="pill l">Learning</span>';

  // ---------- routing ----------
  let view = { name: 'home' };
  function parseHash() {
    const h = (location.hash || '#home').slice(1);
    let m;
    if ((m = h.match(/^g(\d+)$/))) return { name: 'group', id: +m[1] };
    if (h === 'known') return { name: 'known' };
    if (h === 'review') return { name: 'review' };
    if (h === 'amirnet') return { name: 'amirnet' };
    if (h === 'amirnet/run') return { name: 'amrun' };
    if (h === 'amirnet/progress') return { name: 'amprog' };
    if ((m = h.match(/^amirnet\/(r|d)\/([\w-]+)$/))) return { name: m[1] === 'r' ? 'amres' : 'amdeb', id: m[2] };
    return { name: 'home' };
  }
  window.addEventListener('hashchange', () => { view = parseHash(); tab = 'cards'; deck = null; render(); window.scrollTo(0, 0); });
  let tab = 'cards';
  let deck = null; // flashcard session

  function render() {
    hidePop(); amStopTimer();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === view.name || (view.name === 'group' && a.dataset.nav === 'home') || (/^am/.test(view.name) && a.dataset.nav === 'amirnet')));
    if (/^am/.test(view.name)) return renderAmirnet();
    if (view.name === 'group') return renderGroup();
    if (view.name === 'known') return renderKnown();
    if (view.name === 'review') return renderReview();
    renderHome();
  }

  // ---------- home ----------
  function renderHome() {
    let known = 0; GROUP_KEYS.forEach(k => { if (status(k) === 'k') known++; });
    const learning = TOTAL - known;
    const pct = TOTAL ? Math.round(known / TOTAL * 100) : 0;
    const moved = V.known.filter(w => status(keyOf(w.w)) === 'l').length;
    const exDone = Object.keys(state.ex).length;
    const now = new Date();
    const daysLeft = Math.round((new Date(2026, 11, 21) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    const exam = daysLeft > 1 ? `<b>${daysLeft}</b><span>ימים למבחן<small>המבחן ב־21.12</small></span>`
      : daysLeft === 1 ? `<b>1</b><span>יום אחד למבחן — מחר!<small>המבחן ב־21.12</small></span>`
      : daysLeft === 0 ? `<b>🎯</b><span>המבחן היום — בהצלחה!<small>המבחן ב־21.12</small></span>`
      : '';
    app.innerHTML = `
      ${exam ? `<div class="exam-count${daysLeft <= 7 ? ' soon' : ''}" dir="rtl">${exam}</div>` : ''}
      <section class="summary">
        <div>
          <div class="eyebrow">Zinuk units 1–24 + נפוצות א–ד · from your Quizlet</div>
          <h1>${known} of ${TOTAL} word cards learned</h1>
          <div class="muted">${Object.keys(seenK).length} words you didn't know · words with two meanings get a card for each</div>
        </div>
        <div class="bar" role="img" aria-label="${pct}% learned"><span style="width:${pct}%"></span></div>
        <div class="stats">
          <div class="stat k"><b>${known}</b>marked “I know it”</div>
          <div class="stat l"><b>${learning}</b>still learning</div>
          <div class="stat"><b>${V.known.length - moved}</b>already knew on Quizlet</div>
          <div class="stat"><b>${exDone}/${V.groups.length}</b>exercise sets done</div>
        </div>
        <div class="row"><a class="btn primary" href="#review" style="text-decoration:none">Review 20 mixed words</a>
          ${moved ? `<span class="muted">${moved} Quizlet word${moved > 1 ? 's' : ''} moved back to learning are in the mixed review.</span>` : ''}</div>
        <div class="row" style="border-top:1px solid var(--line);padding-top:14px">
          <span class="muted" style="font-size:13px">Your progress is saved in this browser. Keep a backup file in case browser data gets cleared.</span>
          <span class="spacer"></span>
          <button class="btn" id="bkExport">Download backup</button>
          <label class="btn" style="cursor:pointer">Load backup<input type="file" id="bkImport" accept=".json,application/json" hidden></label>
          <span id="bkMsg" class="muted" style="font-size:13px"></span>
        </div>
      </section>
      <div class="section-head"><h2>Word groups</h2><span class="muted">Grouped by meaning · groups 1–8: 20 cards, groups 9–${V.groups.length}: 25 cards</span></div>
      <div class="groups">${V.groups.map(g => {
        const st = groupStats(g); const best = state.ex[g.id];
        return `<a class="gcard${st.k === st.n ? ' done' : ''}" href="#g${g.id}" style="text-decoration:none;color:inherit">
          <span class="num">Group ${g.id}</span>
          <h3>${esc(g.title)}</h3>
          <span class="he muted" style="font-size:14px">${esc(g.titleHe)}</span>
          <span class="preview">${g.words.slice(0, 6).map(w => esc(w.w)).join(' · ')}…</span>
          <div class="bar" style="height:6px"><span style="width:${st.k / st.n * 100}%"></span></div>
          <span class="meta"><span>${st.k}/${st.n} known</span><span>${best != null ? 'Exercise ' + best + '/' + (g.exercises.length || 10) : 'Exercise not done'}</span></span>
        </a>`;
      }).join('')}</div>`;
  }

  // ---------- group ----------
  function renderGroup() {
    const g = V.groups.find(x => x.id === view.id);
    if (!g) { location.hash = '#home'; return; }
    const st = groupStats(g);
    app.innerHTML = `
      <a class="back" href="#home">← All groups</a>
      <div style="margin-top:10px" class="row"><div><div class="eyebrow">Group ${g.id} of ${V.groups.length} · ${st.k}/${st.n} known</div>
        <h1>${esc(g.title)}</h1><div class="he he-left muted" style="font-size:17px">${esc(g.titleHe)}</div></div></div>
      <div class="tabs" role="tablist">
        ${[['cards', 'Flashcards'], ['fill', 'Complete the sentence'], ['texts', 'Reading texts'], ['list', 'Word list']].map(([k, l]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}
      </div>
      <section id="pane"></section>`;
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; deck = null; renderGroup(); });
    const pane = $('#pane');
    if (tab === 'cards') renderDeck(pane, g.words.map(w => w.k), 'g' + g.id);
    else if (tab === 'fill') renderFill(pane, g);
    else if (tab === 'texts') renderTexts(pane, g);
    else renderList(pane, g.words.map(w => w.k));
  }

  // ---------- flashcards ----------
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(LS + '-prefs')) || {}; } catch (e) { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(LS + '-prefs', JSON.stringify(prefs)); } catch (e) { } };
  if (prefs.onlyLearning == null) prefs.onlyLearning = true;

  // ---------- pronunciation (browser text-to-speech) ----------
  const CAN_SPEAK = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  // Clearest voices first: neural/"Natural"/enhanced voices, then Google's, then well-known good system voices.
  const voiceScore = v => {
    let s = /en[-_]US/i.test(v.lang) ? 3 : /en[-_]GB/i.test(v.lang) ? 2 : 1;
    if (/natural|neural|premium|enhanced/i.test(v.name)) s += 20;
    if (/online/i.test(v.name)) s += 8;
    if (/google/i.test(v.name)) s += 10;
    if (/samantha|ava|allison|aria|jenny|guy|emma|andrew|brian|serena|daniel|karen|moira/i.test(v.name)) s += 5;
    if (/david|mark|zira|fred|albert|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|whisper|zarvox|superstar|wobble|junior|ralph|kathy|grandma|grandpa|rocko|shelley|sandy|eddy|flo|reed/i.test(v.name)) s -= 6;
    return s;
  };
  let VOICES = [];
  const loadVoices = () => {
    if (!CAN_SPEAK) return;
    VOICES = speechSynthesis.getVoices().filter(v => /^en([-_]|$)/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a));
    const sel = $('#optVoice'); if (sel) sel.innerHTML = voiceOptions();
  };
  const voiceLabel = v => v.name.replace(/^(Microsoft|Google|Apple)\s+/, '').replace(/\s*-\s*English.*$/, '').replace(/\s*\(.*?\)\s*$/, '') + (/natural|neural|premium|enhanced/i.test(v.name) ? ' (natural)' : '') + ' · ' + v.lang.replace('_', '-');
  const voiceOptions = () => `<option value="">Best available${VOICES[0] ? ' (' + esc(voiceLabel(VOICES[0])) + ')' : ''}</option>` +
    VOICES.map(v => `<option value="${esc(v.name)}" ${prefs.voice === v.name ? 'selected' : ''}>${esc(voiceLabel(v))}</option>`).join('');
  if (CAN_SPEAK) { loadVoices(); try { speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { } }
  function speak(text) {
    if (!CAN_SPEAK) return;
    try {
      speechSynthesis.cancel();
      const v = VOICES.find(x => x.name === prefs.voice) || VOICES[0] || null;
      const u = new SpeechSynthesisUtterance(String(text).replace(/\(.*?\)/g, '').trim());
      u.lang = v ? v.lang : 'en-US'; if (v) u.voice = v;
      u.rate = prefs.slow ? 0.6 : 0.85;
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  function buildDeck(keys, id) {
    let list = prefs.onlyLearning ? keys.filter(k => status(k) !== 'k') : keys.slice();
    if (prefs.shuffle) list = shuffle(list);
    deck = { id, keys, list, i: 0, flip: false, ans: [] };
  }

  function renderDeck(pane, keys, id) {
    if (!deck || deck.id !== id) buildDeck(keys, id);
    const d = deck;
    const opts = `<div class="opts">
        <label><input type="checkbox" id="optOnly" ${prefs.onlyLearning ? 'checked' : ''}> Only words I'm still learning</label>
        <label><input type="checkbox" id="optShuffle" ${prefs.shuffle ? 'checked' : ''}> Shuffle</label>
        <label><input type="checkbox" id="optRev" ${prefs.reverse ? 'checked' : ''}> Hebrew first</label>
      </div>${CAN_SPEAK ? `<div class="opts voice">
        <label>Voice <select id="optVoice" aria-label="Voice for hearing words">${voiceOptions()}</select></label>
        <label><input type="checkbox" id="optSlow" ${prefs.slow ? 'checked' : ''}> Speak slowly</label>
      </div>` : ''}`;
    d.k = d.ans.filter(v => v === 'k').length; d.l = d.ans.filter(v => v === 'l').length;
    const go = n => { d.i = Math.max(0, Math.min(d.list.length, d.i + n)); d.flip = false; d.showAs = false; renderDeck(pane, keys, id); };
    if (!d.list.length || d.i >= d.list.length) {
      const allKnown = !d.list.length;
      pane.innerHTML = `<div class="deck"><div class="endbox">
        <h2>${allKnown ? 'You know every word here' : 'Round finished'}</h2>
        ${allKnown ? '<p class="muted">Untick “Only words I\'m still learning” to go through them again.</p>' :
          `<p><span class="pill k">${d.k} know</span> &nbsp; <span class="pill l">${d.l} still learning</span></p>`}
        <div class="row" style="justify-content:center">
          ${!allKnown ? '<button class="btn" id="back">‹ Back to last card</button><button class="btn primary" id="again">Study again</button>' : ''}
          ${view.name === 'group' ? '<button class="btn" id="toFill">Go to the exercise →</button>' : ''}
        </div></div>${opts}</div>`;
      const b = $('#back'); if (b) b.onclick = () => go(-1);
      const a = $('#again'); if (a) a.onclick = () => { buildDeck(keys, id); renderDeck(pane, keys, id); };
      const f = $('#toFill'); if (f) f.onclick = () => { tab = 'fill'; deck = null; renderGroup(); };
      wireOpts(pane, keys, id); return;
    }
    const k = d.list[d.i], w = WORDS[k];
    const front = `<div class="word">${esc(w.w)}</div><div class="kbd">${(w.units || []).map(esc).join(' · ')}</div>`;
    const meaning = `<div class="mean">${esc(w.he)}</div>`;
    const a = assoc(k);
    const assocMark = a ? `<span class="as-mark${d.showAs ? ' open' : ''}" id="asMark" role="button" tabindex="0" aria-expanded="${!!d.showAs}" title="My association (A)"><span aria-hidden="true">💡</span>${d.showAs ? `<span class="he">${esc(a)}</span>` : '<span class="as-hint">association</span>'}</span>` : '';
    const back = `${prefs.reverse ? `<div class="word" style="font-size:clamp(26px,6vw,38px)">${esc(w.w)}</div>` : meaning}${assocMark}
      ${w.dEn ? `<div class="daily"><div class="den">${hl(w.dEn, w.w)}</div><div class="dhe he">${esc(w.dHe)}</div></div>` : ''}
      ${w.ex ? `<div class="ex">${esc(w.ex)}</div>` : ''}${w.exHe ? `<div class="exhe he">${esc(w.exHe)}</div>` : ''}
      ${w.other && w.other.length ? `<div class="note">Other meaning: <span class="he">${w.other.map(esc).join(' · ')}</span></div>` : ''}
      ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}`;
    pane.innerHTML = `<div class="deck">
      <div class="decknav">
        <button class="btn nav" id="prev" type="button" ${d.i === 0 ? 'disabled' : ''} aria-label="Previous card" title="Previous card (↑)">‹ Previous</button>
        <div class="counter">Card ${d.i + 1} of ${d.list.length} · ${pill(k)}${a ? ' <span title="This word has your association">💡</span>' : ''}</div>
        <button class="btn nav" id="next" type="button" aria-label="Next card without answering" title="Next card (↓)">Next ›</button>
      </div>
      <div class="cardwrap">
      <button class="card${d.flip ? ' flip' : ''}" id="card" aria-label="Flip card">
        <div class="inner"><div class="face">${prefs.reverse ? meaning : front}<div class="kbd">Tap to flip</div></div>
        <div class="face back">${back}</div></div>
      </button>
      ${CAN_SPEAK ? `<button class="say" id="say" type="button" aria-label="Hear the word" title="Hear the word (S)"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` : ''}
      </div>
      <div class="row" style="justify-content:center">
        <button class="btn learn" id="bL">Still learning</button>
        <button class="btn know" id="bK">I know it</button>
      </div>
      <div class="kbd">Keyboard: Space flips · ← still learning · → I know it · ↑ previous · ↓ next${CAN_SPEAK ? ' · S hears the word' : ''}${a ? ' · A shows your association' : ''}</div>
      ${opts}</div>`;
    const card = $('#card');
    card.onclick = () => { if (card._swiped) { card._swiped = false; return; } d.flip = !d.flip; card.classList.toggle('flip', d.flip); };
    // Swipe the card sideways to move between cards (left = next, right = previous).
    let sx = null, sy = 0;
    card.addEventListener('touchstart', ev => { const t = ev.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    card.addEventListener('touchend', ev => {
      if (sx === null) return; const t = ev.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { card._swiped = true; setTimeout(() => { card._swiped = false; }, 400); go(dx < 0 ? 1 : -1); }
    });
    $('#prev').onclick = () => go(-1);
    $('#next').onclick = () => go(1);
    const say = $('#say'); if (say) say.onclick = ev => { ev.stopPropagation(); speak(w.w); };
    const am = $('#asMark');
    if (am) { const tog = ev => { ev.stopPropagation(); ev.preventDefault(); d.showAs = !d.showAs; am.classList.toggle('open', d.showAs); am.setAttribute('aria-expanded', d.showAs); am.lastElementChild.outerHTML = d.showAs ? `<span class="he">${esc(a)}</span>` : '<span class="as-hint">association</span>'; };
      am.onclick = tog; am.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') tog(ev); }; }
    $('#bK').onclick = () => answer('k');
    $('#bL').onclick = () => answer('l');
    function answer(v) { setStatus(k, v); d.ans[d.i] = v; d.i++; d.flip = false; d.showAs = false; renderDeck(pane, keys, id); }
    wireOpts(pane, keys, id);
  }
  function wireOpts(pane, keys, id) {
    const on = (sel, key) => { const el = $(sel, pane); if (el) el.onchange = () => { prefs[key] = el.checked; savePrefs(); buildDeck(keys, id); renderDeck(pane, keys, id); }; };
    on('#optOnly', 'onlyLearning'); on('#optShuffle', 'shuffle'); on('#optRev', 'reverse');
    // Voice settings don't reshuffle the deck; they play a sample so the choice can be heard right away.
    const sample = () => speak(deck && deck.list[deck.i] && WORDS[deck.list[deck.i]] ? WORDS[deck.list[deck.i]].w : 'vocabulary');
    const vs = $('#optVoice', pane); if (vs) vs.onchange = () => { prefs.voice = vs.value; savePrefs(); sample(); };
    const sl = $('#optSlow', pane); if (sl) sl.onchange = () => { prefs.slow = sl.checked; savePrefs(); sample(); };
  }
  document.addEventListener('keydown', e => {
    if (deck && !$('#card') && e.key === 'ArrowUp' && $('#back') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#back').click(); return; }
    if (!deck || !$('#card') || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); $('#card').click(); }
    else if (e.key === 'ArrowRight') $('#bK').click();
    else if (e.key === 'ArrowLeft') $('#bL').click();
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!$('#prev').disabled) $('#prev').click(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); $('#next').click(); }
    else if ((e.key === 's' || e.key === 'S') && $('#say')) $('#say').click();
    else if ((e.key === 'a' || e.key === 'A') && $('#asMark')) { if (!$('#card').classList.contains('flip')) $('#card').click(); $('#asMark').click(); }
  });

  // ---------- fill in ----------
  const norm = s => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ').trim();
  function renderFill(pane, g) {
    const ex = g.exercises || [];
    if (!ex.length) { pane.innerHTML = '<div class="empty">The exercise for this group is still being written.</div>'; return; }
    // 4 choices per sentence: the answer + 3 other answers from this group's sentences (already in a fitting form),
    // topped up with other words of the group when there are not enough.
    const pool = [...new Map([...ex.map(e => e.answer), ...g.words.map(w => w.w)].map(a => [norm(a), a])).values()];
    const qs = ex.map(e => {
      const wrong = shuffle(pool.filter(a => norm(a) !== norm(e.answer) && norm(a) !== norm(e.base)));
      const fromEx = wrong.filter(a => ex.some(o => norm(o.answer) === norm(a)));
      const rest = wrong.filter(a => !fromEx.includes(a));
      return { e, opts: shuffle([e.answer, ...[...fromEx, ...rest].slice(0, 3)]) };
    });
    // Hebrew meaning for every option: an inflected answer ("mitigated") maps to its base word's card(s).
    const heOf = {};
    const senses = base => g.words.filter(x => keyOf(x.w) === keyOf(base)).map(x => x.he).filter(Boolean);
    g.words.forEach(w => { const n = norm(w.w); if (!heOf[n]) heOf[n] = senses(w.w).join(' / '); });
    ex.forEach(e => { const n = norm(e.answer); if (!heOf[n]) heOf[n] = senses(e.base).join(' / '); });
    const optHe = o => heOf[norm(o)] || '';
    pane.innerHTML = `<p class="muted">Choose the word that completes each sentence.</p>
      <div class="qs">${qs.map(({ e, opts }, i) => {
        const parts = esc(e.sentence).split('____');
        return `<div class="q" id="q${i}"><div class="s">${parts[0]}<span class="blank" id="bl${i}">&nbsp;</span>${parts.slice(1).join('____')}</div>
          <div class="mc">${opts.map(o => `<button class="opt" data-i="${i}" data-a="${esc(o)}"><span class="ow">${esc(o)}</span>${optHe(o) ? `<span class="ohe he" hidden>${esc(optHe(o))}</span>` : ''}</button>`).join('')}</div>
          <div class="fb" id="fb${i}" hidden></div></div>`;
      }).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn" id="reset">Start over</button><span class="spacer"></span><span class="score" id="score">0 / ${ex.length} answered</span></div>`;
    let answered = 0, score = 0;
    pane.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const i = +b.dataset.i, e = ex[i], q = $('#q' + i);
      if (q.classList.contains('ok') || q.classList.contains('no')) return;
      const ok = norm(b.dataset.a) === norm(e.answer);
      answered++; if (ok) score++;
      q.classList.add(ok ? 'ok' : 'no');
      q.querySelectorAll('.opt').forEach(o => {
        o.disabled = true;
        const h = o.querySelector('.ohe'); if (h) h.hidden = false;
        if (norm(o.dataset.a) === norm(e.answer)) o.classList.add('right');
        else if (o === b) o.classList.add('wrong');
      });
      $('#bl' + i).textContent = e.answer;
      const fb = $('#fb' + i); fb.hidden = false;
      fb.innerHTML = (ok ? '' : `Answer: <span class="ans">${esc(e.answer)}</span> · `) + `<span class="he">${esc(e.he)}</span>`;
      if (!ok) { const c = g.words.find(x => keyOf(x.w) === keyOf(e.base)); if (c) setStatus(c.k, 'l'); }
      if (answered < ex.length) { $('#score').textContent = `${answered} / ${ex.length} answered`; return; }
      $('#score').textContent = `${score} / ${ex.length}`;
      if (state.ex[g.id] == null || score > state.ex[g.id]) { state.ex[g.id] = score; persist(); }
    });
    $('#reset').onclick = () => renderFill(pane, g);
  }

  // ---------- texts ----------
  function findWord(token, g) {
    const nz = s => s.toLowerCase().replace(/[-\s]+/g, ' ').trim();
    const IRR = { struck: 'strike', broke: 'break', broken: 'break', bore: 'bear', borne: 'bear', born: 'bear', lain: 'lay', meant: 'mean', withstood: 'withstand', overcame: 'overcome', undertook: 'undertake', undertaken: 'undertake', underwent: 'undergo', undergone: 'undergo', foresaw: 'foresee', foreseen: 'foresee', forbade: 'forbid', forbidden: 'forbid', outdid: 'outdo', outdone: 'outdo', spelt: 'spell', spilt: 'spill', torn: 'torn', worn: 'worn', ground: 'grind', misled: 'mislead', fled: 'flee', sought: 'sought', forged: 'forge' };
    let t = nz(token);
    const exact = g.words.find(w => nz(w.w) === t);
    if (exact) return exact;
    if (IRR[t]) { const ir = g.words.find(w => nz(w.w) === IRR[t]); if (ir) return ir; }
    let best = null, bestLen = 0;
    g.words.forEach(w => { const b = nz(w.w); if (t.startsWith(b) && b.length > bestLen) { best = w; bestLen = b.length; } });
    if (best) return best;
    g.words.forEach(w => {
      const b = nz(w.w);
      const stem = b.length > 5 ? b.slice(0, b.length - 2) : b.replace(/e$/, '');
      const yi = /y$/.test(b) ? b.slice(0, -1) + 'i' : null;
      if ((t === b || t.startsWith(stem) || b.startsWith(t) || (yi && t.startsWith(yi))) && b.length > bestLen) { best = w; bestLen = b.length; }
    });
    return best;
  }
  function renderTexts(pane, g) {
    const tx = g.texts || [];
    if (!tx.length) { pane.innerHTML = '<div class="empty">The texts for this group are still being written.</div>'; return; }
    pane.innerHTML = `<p class="muted">Highlighted words are from this group. Tap one to see its meaning and mark whether you know it.</p>` + tx.map((t, i) => {
      const body = t.body.split(/\n\s*\n/).map(p => '<p>' + esc(p).replace(/\*\*(.+?)\*\*/g, (_, m) => {
        const w = findWord(m, g); const k = w ? w.k : '';
        return `<mark class="t${k && status(k) === 'k' ? ' k' : ''}" data-k="${esc(k)}" tabindex="0">${m}</mark>`;
      }) + '</p>').join('');
      return `<article class="article"><div class="eyebrow">Text ${i + 1}</div><h2>${esc(t.title)}</h2><div class="body">${body}</div>
        <div><button class="btn" data-tr="${i}">Show Hebrew translation</button></div><div class="trans" id="tr${i}" hidden>${esc(t.he)}</div></article>`;
    }).join('');
    pane.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { const el = $('#tr' + b.dataset.tr); el.hidden = !el.hidden; b.textContent = el.hidden ? 'Show Hebrew translation' : 'Hide Hebrew translation'; });
    pane.querySelectorAll('mark.t').forEach(m => {
      const open = ev => { ev.stopPropagation(); showPop(m); };
      m.onclick = open; m.onkeydown = ev => { if (ev.key === 'Enter') open(ev); };
    });
  }
  const pop = $('#pop');
  function showPop(m) {
    const k = m.dataset.k, w = WORDS[k];
    if (!w) { pop.innerHTML = `<div class="w">${esc(m.textContent)}</div>`; }
    else pop.innerHTML = `<div class="w">${esc(w.w)} ${pill(k)}</div><div class="m">${esc(w.he)}</div>${w.other && w.other.length ? `<div class="m" style="font-size:13px;opacity:.75">גם: ${w.other.map(esc).join(' · ')}</div>` : ''}${assoc(k) ? `<div class="m" style="font-size:14px">💡 ${esc(assoc(k))}</div>` : ''}
      <button id="popT">${status(k) === 'k' ? 'Move back to learning' : 'I know it'}</button>`;
    pop.hidden = false;
    const r = m.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = Math.min(Math.max(16, r.left), window.innerWidth - pw - 16), y = r.bottom + 8;
    if (y + ph > window.innerHeight - 8) y = r.top - ph - 8;
    pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px';
    const b = $('#popT');
    if (b) b.onclick = ev => {
      ev.stopPropagation(); setStatus(k, status(k) === 'k' ? 'l' : 'k');
      document.querySelectorAll(`mark.t[data-k="${CSS.escape(k)}"]`).forEach(x => x.classList.toggle('k', status(k) === 'k'));
      showPop(m);
    };
  }
  function hidePop() { pop.hidden = true; }
  document.addEventListener('click', e => { if (!pop.contains(e.target)) hidePop(); });
  window.addEventListener('scroll', hidePop, { passive: true });

  // ---------- word list ----------
  const LIST_FILTERS = [['all', 'All'], ['l', 'Still learning'], ['k', 'I know'], ['has', 'With association'], ['none', 'No association yet']];
  const assocView = k => assoc(k)
    ? `<button class="as-btn has" data-ak="${esc(k)}" title="Edit association"><span class="as-ic" aria-hidden="true">💡</span><span class="he">${esc(assoc(k))}</span></button>`
    : `<button class="as-btn add" data-ak="${esc(k)}" title="Add a Hebrew association">+ אסוציאציה</button>`;
  function renderList(pane, keys, opts) {
    opts = opts || {};
    const filters = opts.noStatusFilter ? LIST_FILTERS.filter(f => f[0] !== 'l' && f[0] !== 'k') : LIST_FILTERS;
    let f = prefs.listFilter || 'all';
    if (!filters.some(x => x[0] === f)) f = 'all';
    const match = k => f === 'all' ? true : f === 'has' ? !!assoc(k) : f === 'none' ? !assoc(k) : status(k) === f;
    const list = keys.filter(match);
    const count = id => keys.filter(k => id === 'all' ? true : id === 'has' ? !!assoc(k) : id === 'none' ? !assoc(k) : status(k) === id).length;
    pane.innerHTML = `<div class="chips" role="group" aria-label="Filter words">${filters.map(([id, l]) => `<button class="chip${f === id ? ' on' : ''}" data-f="${id}" aria-pressed="${f === id}">${l} <span>${count(id)}</span></button>`).join('')}</div>
      ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Word</th><th style="text-align:right">Meaning &amp; association</th><th>Everyday sentence</th><th>Status</th></tr></thead><tbody>
      ${list.map(k => { const w = WORDS[k]; return `<tr><td class="w">${esc(w.w)}</td><td class="he"><div>${esc(w.he)}</div><div class="as-cell">${assocView(k)}</div></td><td class="sent">${w.dEn ? `<div>${hl(w.dEn, w.w)}</div><div class="he muted">${esc(w.dHe)}</div>` : ''}</td><td><button class="toggle" data-k="${esc(k)}" title="Click to change">${pill(k)}</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">No words match this filter.</div>'}
      <p class="muted" style="font-size:13px">Click a status to switch it. Add an association – a Hebrew word, picture or story that helps you remember – and it shows as 💡 on the flashcard.</p>`;
    pane.querySelectorAll('.chip').forEach(b => b.onclick = () => { prefs.listFilter = b.dataset.f; savePrefs(); renderList(pane, keys, opts); });
    const recount = () => pane.querySelectorAll('.chip').forEach(c => { c.lastElementChild.textContent = count(c.dataset.f); });
    pane.querySelectorAll('.toggle').forEach(b => b.onclick = () => { const k = b.dataset.k; setStatus(k, status(k) === 'k' ? 'l' : 'k'); b.innerHTML = pill(k); recount(); });
    const wireAssoc = cell => { const b = cell.querySelector('.as-btn'); if (b) b.onclick = () => editAssoc(cell, b.dataset.ak); };
    function editAssoc(cell, k) {
      cell.innerHTML = `<div class="as-edit"><textarea class="he" dir="rtl" rows="2" maxlength="300" placeholder="מה עוזר לי לזכור את ${esc(WORDS[k].w)}?" aria-label="Association for ${esc(WORDS[k].w)}">${esc(assoc(k))}</textarea>
        <div class="row"><button class="btn primary sm" data-act="save">Save</button><button class="btn sm" data-act="cancel">Cancel</button>${assoc(k) ? '<button class="btn sm danger" data-act="del">Delete</button>' : ''}</div></div>`;
      const ta = cell.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const done = v => { if (v !== undefined) { setAssoc(k, v); recount(); } cell.innerHTML = assocView(k); wireAssoc(cell); };
      cell.querySelector('[data-act="save"]').onclick = () => done(ta.value);
      cell.querySelector('[data-act="cancel"]').onclick = () => done();
      const d = cell.querySelector('[data-act="del"]'); if (d) d.onclick = () => done('');
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(ta.value); } else if (e.key === 'Escape') done(); };
    }
    pane.querySelectorAll('.as-cell').forEach(wireAssoc);
  }

  // ---------- mixed review ----------
  function renderReview() {
    const pool = Object.keys(WORDS).filter(k => status(k) === 'l');
    app.innerHTML = `<div class="eyebrow">${pool.length} words still learning</div><h1>Mixed review</h1>
      <p class="muted">20 random words you're still learning, from all groups, plus Quizlet words you moved back.</p>
      <div class="row" style="margin-bottom:16px"><button class="btn" id="newMix">New set of 20</button></div><section id="pane"></section>`;
    if (!deck || deck.id !== 'mix') { const pick = shuffle(pool).slice(0, 20); deck = null; prefs._mix = pick; }
    renderDeck($('#pane'), prefs._mix || [], 'mix');
    $('#newMix').onclick = () => { deck = null; prefs._mix = shuffle(Object.keys(WORDS).filter(k => status(k) === 'l')).slice(0, 20); renderDeck($('#pane'), prefs._mix, 'mix'); };
  }

  // ---------- known words ----------
  function renderKnown() {
    const keys = Object.keys(WORDS).filter(k => status(k) === 'k').sort();
    const fromGroups = keys.filter(k => WORDS[k].group).length;
    app.innerHTML = `<div class="eyebrow">${keys.length} words</div><h1>Words I know</h1>
      <p class="muted">${keys.length - fromGroups} you already knew on Quizlet, plus ${fromGroups} you marked “I know it” here. Click a status to move a word back to learning.</p>
      <div class="row" style="margin:14px 0"><input class="search" id="q" placeholder="Search English or Hebrew" aria-label="Search known words"></div>
      <section id="pane"></section>`;
    const pane = $('#pane');
    const draw = q => {
      q = (q || '').trim().toLowerCase();
      const list = q ? keys.filter(k => k.includes(q) || (WORDS[k].he || '').includes(q)) : keys;
      if (!list.length) { pane.innerHTML = '<div class="empty">No known words match.</div>'; return; }
      renderList(pane, list, { noStatusFilter: true });
    };
    $('#q').oninput = e => draw(e.target.value);
    draw('');
  }

  // ---------- backup ----------
  document.addEventListener('click', e => {
    if (!e.target.closest('#bkExport')) return;
    const blob = new Blob([JSON.stringify({ app: 'zinuk-deck', saved: new Date().toISOString(), s: state.s, ex: state.ex, am: state.am, as: state.as, lv: state.lv, t: state.t })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zinuk-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  document.addEventListener('change', e => {
    if (e.target.id !== 'bkImport' || !e.target.files[0]) return;
    const msg = $('#bkMsg');
    e.target.files[0].text().then(txt => {
      const r = JSON.parse(txt);
      if (!r || r.app !== 'zinuk-deck' || typeof r.s !== 'object') throw new Error('bad');
      state = { s: r.s || {}, ex: r.ex || {}, am: r.am || { runs: {}, cur: null }, as: r.as || {}, lv: r.lv || 1, t: 0 }; migrate(state);
      persist(); render();
      const m = $('#bkMsg'); if (m) m.textContent = 'Backup loaded.';
    }).catch(() => { if (msg) msg.textContent = 'That file is not a Zinuk Deck backup.'; });
  });

  // ---------- AMIRNET simulations ----------
  // Same structure as the real test: 6 scored chapters with their own clocks; chapter 1 is medium (tier B) and each
  // later chapter is chosen easier (A), medium (B) or harder (C) from the ability estimated after the previous chapters.
  // Score: 3-parameter IRT ability estimate (EAP) mapped to the 50-150 scale. An approximation, not NITE's formula.
  const AM_CH = [{ type: 'sc', n: 4, min: 4 }, { type: 'sc', n: 4, min: 4 }, { type: 'rc', n: 5, min: 15 },
    { type: 'rs', n: 3, min: 6 }, { type: 'rs', n: 3, min: 6 }, { type: 'sc', n: 4, min: 4 }];
  const AM_TYPE = { sc: 'Sentence Completion', rs: 'Restatements', rc: 'Reading Comprehension' };
  const AM_TYPE_HE = { sc: 'השלמת משפטים', rs: 'ניסוח מחדש', rc: 'הבנת הנקרא' };
  const AM_INSTR = {
    sc: 'This section contains sentences with a word or phrase missing. Choose the answer that best completes the sentence.',
    rs: 'Each question contains a sentence followed by four possible ways of restating it. Choose the answer that best expresses the meaning of the original sentence.',
    rc: 'Read the passage below and answer the questions that follow. Choose the best answer to each question according to the passage.'
  };
  const AM_RS_Q = 'Which of the following best expresses the meaning of the sentence above?';
  const TIER_HE = { A: 'קל', B: 'בינוני', C: 'קשה' };
  const AM_B = { A: [-1.7, -0.6], B: [-0.45, 0.55], C: [0.7, 1.9] };
  const AM_DISC = { sc: 1.3, rs: 1.4, rc: 1.1 };
  const BANDS = [[50, 69, "טרום בסיסי א'"], [70, 84, "טרום בסיסי ב'"], [85, 99, 'בסיסי'], [100, 119, "מתקדמים א'"], [120, 133, "מתקדמים ב'"], [134, 150, 'פטור']];
  const KIND_HE = { main: 'רעיון מרכזי', detail: 'פרט מהקטע', inference: 'הסקה', purpose: 'מטרת פסקה/משפט', vocab: 'מילה בהקשר', attitude: 'עמדת הכותב', title: 'כותרת' };
  const TRAP_HE = {
    form: 'מילה שנראית או נשמעת דומה', sense: 'משמעות קרובה אבל לא מדויקת', topic: 'מתאימה לנושא, לא להיגיון המשפט',
    logic: 'מתעלמת ממילת הקישור / הניגוד', collocation: 'לא מתחברת למילים שלידה', opposite: 'הפוכה מהנדרש',
    scope: 'שינוי בהיקף או בכמות (חלק ↔ כולם)', time: 'שינוי בזמן או בסדר האירועים', reverse: 'היפוך סיבה ותוצאה / מי עשה מה',
    extra: 'מוסיפה מידע שאין במקור', missing: 'משמיטה תנאי או הסתייגות', degree: 'משנה את עוצמת הטענה או הוודאות',
    word_match: 'חוזרת על מילים מהמקור אבל אומרת משהו אחר', not_in_text: 'לא כתוב בקטע', extreme: 'גורפת / קיצונית מדי',
    detail: 'פרט נכון אבל לא מה שנשאל', partial: 'נכונה רק בחלקה', too_far: 'הסקה שהולכת רחוק מהכתוב'
  };
  const TRAP_TIP = {
    form: 'לפני שבוחרים, לקרוא את המילה אות-אות: מילים כמו adopt/adapt, affect/effect מכשילות בדיוק ברגע של לחץ.',
    sense: 'לבדוק שהמשמעות המדויקת מתאימה – לא רק "בערך". לנסות לתרגם את המשפט לעברית עם כל אחת מהאפשרויות.',
    topic: 'מילה מאותו עולם תוכן היא מסיח קלאסי. לשאול: מה המשפט צריך לומר כאן לוגית? רק אז לחפש את המילה.',
    logic: 'לסמן את מילת הקישור (although, despite, since, unless) ולהחליט מראש אם החלק החסר הוא המשך או ניגוד.',
    collocation: 'לשים לב למילה שלפני/אחרי החסר (מילת יחס, שם עצם) – יש צירופים קבועים שרק מילה אחת מתאימה להם.',
    opposite: 'לנסח במילים שלך את הכיוון (חיובי/שלילי) לפני שמסתכלים על התשובות.',
    scope: 'לבדוק מילים כמו some, most, all, only, few – כל שינוי בהיקף פוסל את התשובה.',
    time: 'לבדוק זמנים וסדר אירועים (before, after, until, no longer) – תשובה ששינתה את הזמן שגויה.',
    reverse: 'לשאול "מי גרם למה?" במשפט המקורי ולוודא שהתשובה שומרת על אותו כיוון.',
    extra: 'כל מידע שלא מופיע במשפט המקורי פוסל את התשובה, גם אם הוא הגיוני.',
    missing: 'לוודא שכל תנאי (if, unless, only when) והסתייגות מהמקור נשמרו.',
    degree: 'מילים כמו may, likely, certainly, considerably קובעות את עוצמת הטענה – גם הן חייבות להישמר.',
    word_match: 'תשובה שמעתיקה מילים מהמקור היא לא בהכרח נכונה – להשוות משמעות, לא מילים.',
    not_in_text: 'לענות רק לפי מה שכתוב בקטע, לא לפי ידע כללי או היגיון אישי.',
    extreme: 'להיזהר ממילים גורפות (always, never, only, completely) כשהקטע מסויג יותר.',
    detail: 'לחזור לשאלה: האם שאלו על רעיון מרכזי או על פרט? פרט נכון יכול להיות תשובה שגויה.',
    partial: 'לבדוק את כל חלקי התשובה – אם חצי ממנה לא נכון, היא נפסלת.',
    too_far: 'הסקה טובה נשענת ישירות על משפט בקטע. אם צריך כמה "קפיצות" – זו כנראה לא התשובה.'
  };
  const REASONS = [
    ['vocab_unknown', 'לא הכרתי את המילה / מילת המפתח', 'להכניס את המילים לכרטיסיות ולחזור עליהן; במבחן – לפסול לפי מה שכן מכירים.'],
    ['vocab_partial', 'הכרתי את המילה, אבל לא את המשמעות המדויקת או שהייתה לה משמעות אחרת', 'ללמוד מילים עם משפט דוגמה ולשים לב למשמעויות נוספות (כמו בקבוצות "משמעות נוספת").'],
    ['similar_word', 'התבלבלתי עם מילה שנראית או נשמעת דומה', 'לבנות רשימת "זוגות מבלבלים" ולתרגל אותם יחד.'],
    ['sentence', 'לא הבנתי את המשפט / הקטע', 'לפרק משפט ארוך: נושא, פועל, ומה מוסיפות הפסוקיות. לתרגם בראש את החלק העיקרי.'],
    ['connector', 'פספסתי מילת קישור, ניגוד או שלילה', 'לסמן בעיניים כל although / however / not / unless לפני שקוראים את התשובות.'],
    ['trap', 'בחרתי תשובה שנראתה נכונה אבל שינתה פרט (היקף, זמן, סיבה)', 'להשוות כל תשובה למקור פרט-פרט ולפסול, במקום לחפש "הכי דומה".'],
    ['outside', 'עניתי לפי ידע כללי או היגיון ולא לפי הכתוב', 'לחפש בקטע את המשפט שמוכיח את התשובה לפני שבוחרים.'],
    ['misread_q', 'לא קראתי נכון את השאלה', 'לקרוא את השאלה פעמיים, במיוחד NOT / EXCEPT / according to.'],
    ['two_left', 'התלבטתי בין שתי תשובות ובחרתי בלא נכונה', 'כשנשארות שתיים – לחפש את הפרט שפוסל אחת מהן, לא את מה שמחזק.'],
    ['guess', 'ניחשתי', 'ניחוש מושכל: קודם לפסול, ואז לנחש. ובכל מקרה לא להשאיר ריק.'],
    ['time', 'לחץ זמן / מיהרתי', 'לתרגל עם שעון: כ-דקה לשאלת השלמה, 2 דקות לניסוח מחדש. לא להיתקע על שאלה אחת.'],
    ['careless', 'ידעתי – ובחרתי בטעות / חוסר ריכוז', 'לפני מעבר לשאלה הבאה – מבט אחד נוסף על התשובה המסומנת.']
  ];
  const REASON = Object.fromEntries(REASONS.map(r => [r[0], { he: r[1], tip: r[2] }]));

  let AMD = window.AMIRNET || null, amLoading = null, amTimer = null, amShownAt = 0;
  function loadAmirnet() {
    if (AMD) return Promise.resolve(AMD);
    if (!amLoading) amLoading = new Promise((ok, no) => {
      const sc = document.createElement('script'); sc.src = 'amirnet.js'; sc.charset = 'utf-8';
      sc.onload = () => { AMD = window.AMIRNET || null; AMD ? ok(AMD) : no(); };
      sc.onerror = () => { amLoading = null; no(); };
      document.head.appendChild(sc);
    });
    return amLoading;
  }
  function amStopTimer() { if (amTimer) { clearInterval(amTimer); amTimer = null; } }
  const amForm = id => AMD && AMD.forms.find(f => f.id === id);
  const amItems = (form, ci, tier) => AM_CH[ci].type === 'rc' ? form.rc[tier].q : form[AM_CH[ci].type][(ci + 1) + tier];
  const amB = (ci, tier, j, n) => { const [lo, hi] = AM_B[tier]; return AM_CH[ci].type === 'rc' ? (lo + hi) / 2 : lo + (hi - lo) * (n > 1 ? j / (n - 1) : .5); };
  const amP = (th, a, b) => 0.2 + 0.8 / (1 + Math.exp(-1.7 * a * (th - b)));
  function amEAP(resp) { // resp: [{a,b,u}]
    let num = 0, den = 0;
    for (let th = -4; th <= 4.0001; th += 0.05) {
      let L = Math.exp(-th * th / 2);
      resp.forEach(r => { const p = amP(th, r.a, r.b); L *= r.u ? p : 1 - p; });
      num += th * L; den += L;
    }
    return den ? num / den : 0;
  }
  function amResp(run, upto) {
    const out = [];
    run.ch.forEach((ch, ci) => {
      if (ci >= upto || !ch) return;
      const items = amItems(amForm(run.form), ci, ch.tier);
      items.forEach((it, j) => out.push({ a: AM_DISC[AM_CH[ci].type], b: amB(ci, ch.tier, j, items.length), u: ch.ans[j] === it.a ? 1 : 0 }));
    });
    return out;
  }
  const amScore = th => Math.max(50, Math.min(150, Math.round(100 + 22 * th)));
  const amBand = sc => (BANDS.find(b => sc >= b[0] && sc <= b[1]) || BANDS[0])[2];
  const nextTier = th => th < -0.45 ? 'A' : th > 0.45 ? 'C' : 'B';
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const curRun = () => state.am.cur && state.am.runs[state.am.cur];

  function amOpenChapter(run, ci, tier) {
    const n = amItems(amForm(run.form), ci, tier).length;
    run.ch[ci] = { tier, start: Date.now(), end: null, ans: Array(n).fill(null), flag: Array(n).fill(false), qt: Array(n).fill(0), intro: true };
    run.cur = ci; run.q = 0;
  }
  function amStart(formId) {
    const run = { id: 'r' + Date.now().toString(36), form: formId, started: Date.now(), finished: null, ch: [], cur: 0, q: 0 };
    amOpenChapter(run, 0, 'B');
    state.am.runs[run.id] = run; state.am.cur = run.id; persist();
    location.hash = '#amirnet/run';
  }
  function amLogTime(run) {
    const ch = run.ch[run.cur];
    if (ch && !ch.intro && amShownAt) { ch.qt[run.q] += Math.round((Date.now() - amShownAt) / 1000); }
    amShownAt = Date.now();
  }
  function amCloseChapter(run) {
    amLogTime(run);
    const ch = run.ch[run.cur]; ch.end = Math.min(Date.now(), ch.start + AM_CH[run.cur].min * 60000); delete ch.intro;
    if (run.cur < AM_CH.length - 1) {
      const th = amEAP(amResp(run, run.cur + 1));
      amOpenChapter(run, run.cur + 1, nextTier(th));
      persist(); return false;
    }
    amFinish(run); return true;
  }
  function amFinish(run) {
    const form = amForm(run.form), items = [];
    run.ch.forEach((ch, ci) => amItems(form, ci, ch.tier).forEach((it, j, arr) => {
      const pick = ch.ans[j];
      items.push({ ci, j, type: AM_CH[ci].type, tier: ch.tier, kind: it.k || '', ok: pick === it.a ? 1 : 0, pick, trap: pick == null || pick === it.a ? '' : (it.t[pick] || ''), b: amB(ci, ch.tier, j, arr.length), t: ch.qt[j] });
    }));
    const th = amEAP(items.map(r => ({ a: AM_DISC[r.type], b: r.b, u: r.ok })));
    const score = amScore(th);
    run.res = { items, th: Math.round(th * 1000) / 1000, score, band: amBand(score), path: run.ch.map(c => c.tier).join('') };
    run.finished = Date.now(); state.am.cur = null; persist();
    location.hash = '#amirnet/r/' + run.id;
  }

  function renderAmirnet() {
    if (!AMD) {
      app.innerHTML = '<p class="muted">Loading the AMIRNET simulations…</p>';
      loadAmirnet().then(render).catch(() => { app.innerHTML = '<div class="empty">The simulations could not be loaded. Check the internet connection and reload.</div>'; });
      return;
    }
    if (view.name === 'amrun') return amRenderRun();
    if (view.name === 'amres') return amRenderResult();
    if (view.name === 'amdeb') return amRenderDebrief();
    if (view.name === 'amprog') return amRenderProgress();
    amRenderHome();
  }

  const finishedRuns = () => Object.values(state.am.runs).filter(r => r.finished && r.res).sort((a, b) => a.finished - b.finished);

  function amRenderHome() {
    const runs = finishedRuns(), cur = curRun();
    const last = runs[runs.length - 1];
    const byForm = {};
    runs.forEach(r => { (byForm[r.form] = byForm[r.form] || []).push(r); });
    app.innerHTML = `<div class="am" dir="rtl">
      <section class="summary">
        <div><div class="eyebrow">AMIRNET · סימולציות</div><h1>מבחני אמירנט לדוגמה</h1>
        <p class="muted" style="margin:.4em 0 0">${AMD.forms.length} סימולציות מלאות במבנה המבחן האמיתי: 6 פרקים, 23 שאלות, כ-39 דקות. הפרק הראשון בינוני, וכל פרק הבא קל יותר או קשה יותר לפי הביצועים שלך עד אליו – כמו במבחן המותאם (אדפטיבי) של מאל"ו. בסוף מקבלים ציון בסולם 50–150 ורמת סיווג.</p></div>
        ${cur ? `<div class="am-cur row"><b>יש מבחן בתהליך (סימולציה ${cur.form}, פרק ${cur.cur + 1})</b><span class="spacer"></span><a class="btn primary" href="#amirnet/run">חזרה למבחן</a><button class="btn" id="amAbandon">ביטול המבחן</button></div>` : ''}
        <div class="stats">
          <div class="stat"><b>${runs.length}</b>מבחנים שהושלמו</div>
          <div class="stat"><b>${last ? last.res.score : '–'}</b>ציון אחרון${last ? ' · ' + esc(last.res.band) : ''}</div>
          <div class="stat"><b>${runs.length ? Math.max(...runs.map(r => r.res.score)) : '–'}</b>הציון הגבוה ביותר</div>
          <div class="stat"><b>${runs.filter(r => r.db && r.db.done).length}</b>תחקירים שהושלמו</div>
        </div>
        <div class="row">${runs.length ? '<a class="btn primary" href="#amirnet/progress">רפלקציה ומגמות</a>' : ''}<button class="btn" id="amInfo">איך המבחן בנוי ואיך מחושב הציון</button></div>
        <div id="amInfoBox" hidden>${amInfoHtml()}</div>
      </section>
      <div class="section-head"><h2>הסימולציות</h2><span class="muted">אפשר לחזור על סימולציה, אבל השאלות יהיו מוכרות</span></div>
      <div class="groups">${AMD.forms.map(f => {
        const rs = byForm[f.id] || [], best = rs.length ? rs[rs.length - 1] : null;
        return `<div class="gcard${best ? ' done' : ''}">
          <span class="num">סימולציה ${f.id}</span>
          <h3>${best ? `ציון ${best.res.score} · ${esc(best.res.band)}` : 'עוד לא נעשתה'}</h3>
          <span class="meta"><span>${rs.length ? rs.length + ' ניסיונות' : '23 שאלות · 39 דק\''}</span>${best ? `<a href="#amirnet/r/${best.id}">תוצאות</a>` : ''}</span>
          <button class="btn${best ? '' : ' primary'}" data-start="${f.id}" ${cur ? 'disabled title="יש מבחן פתוח"' : ''}>${best ? 'לעשות שוב' : 'להתחיל'}</button>
        </div>`;
      }).join('')}</div></div>`;
    app.querySelectorAll('[data-start]').forEach(b => b.onclick = () => {
      if (!confirm('המבחן מתחיל מיד והשעון רץ כמו במבחן האמיתי (גם אם יוצאים מהעמוד). להתחיל?')) return;
      amStart(+b.dataset.start);
    });
    const ab = $('#amAbandon'); if (ab) ab.onclick = () => { if (confirm('לבטל את המבחן הפתוח? התשובות שלו יימחקו.')) { delete state.am.runs[state.am.cur]; state.am.cur = null; persist(); render(); } };
    $('#amInfo').onclick = () => { const b = $('#amInfoBox'); b.hidden = !b.hidden; };
  }
  function amInfoHtml() {
    return `<div class="am-info">
      <h3>מבנה המבחן (כמו באמירנט)</h3>
      <table><thead><tr><th>פרק</th><th>סוג</th><th>שאלות</th><th>זמן</th></tr></thead><tbody>
      ${AM_CH.map((c, i) => `<tr><td>${i + 1}</td><td>${AM_TYPE_HE[c.type]}</td><td>${c.n}</td><td>${c.min} דק'</td></tr>`).join('')}</tbody></table>
      <ul>
        <li>לכל פרק שעון משלו. אי אפשר להעביר זמן בין פרקים, ואי אפשר לחזור לפרק שהסתיים.</li>
        <li>בתוך פרק אפשר לעבור בין השאלות, לשנות תשובות ולסמן שאלה בדגל. כדי לסיים פרק מוקדם צריך לענות על כל השאלות; כשהזמן נגמר עוברים לפרק הבא אוטומטית.</li>
        <li>שאלה שלא נענתה נחשבת טעות – תמיד עדיף לנחש.</li>
        <li><b>אדפטיביות:</b> פרק 1 ברמה בינונית. אחרי כל פרק מחושבת הערכת יכולת מכל התשובות עד אז, והפרק הבא מגיע ברמה קלה, בינונית או קשה. קושי גבוה בהמשך הוא סימן טוב.</li>
        <li><b>ציון:</b> מחושב לפי מודל תורת התגובה לפריט (IRT): כל שאלה נשקלת לפי הקושי שלה, כך ששאלה קשה שנענתה נכון שווה יותר. התוצאה ממופה לסולם 50–150. מאל"ו לא מפרסמים את הנוסחה שלהם, לכן זה קירוב – לא ציון רשמי.</li>
      </ul>
      <h3>רמות הסיווג</h3>
      <table><tbody>${BANDS.map(b => `<tr><td>${b[0]}–${b[1]}</td><td>${b[2]}</td></tr>`).join('')}</tbody></table>
      <p class="muted">טבלת הסיווג המקובלת באוניברסיטאות (כל מוסד קובע לעצמו – כדאי לבדוק מול המוסד שלך).</p>
      <h3>מה לא מדומה כאן</h3>
      <ul><li>פרקי הניסוי (האזנה, מטלת כתיבה, דקדוק בהקשר, יצירת מילה) – כמעט לא משפיעים על הציון האמיתי ולא נכללו.</li>
      <li>השאלות נכתבו במיוחד בסגנון המבחן ולא נלקחו מהמאגר של מאל"ו, וכיול הקושי שלהן הוא הערכה ולא נתונים סטטיסטיים מנבחנים אמיתיים.</li></ul>
    </div>`;
  }

  // ----- taking a test -----
  function amRenderRun() {
    const run = curRun();
    if (!run || !amForm(run.form)) { location.hash = '#amirnet'; return; }
    const tick = () => {
      const ch = run.ch[run.cur], left = ch.start + AM_CH[run.cur].min * 60000 - Date.now();
      if (left <= 0) { if (!amCloseChapter(run)) amRenderRun(); return true; }
      const t = $('#amClock'); if (t) { t.textContent = fmt(left); t.classList.toggle('low', left < 60000); }
      return false;
    };
    if (tick()) return;
    const form = amForm(run.form), ci = run.cur, ch = run.ch[ci], def = AM_CH[ci], items = amItems(form, ci, ch.tier);
    const head = `<div class="am-head"><div><div class="eyebrow">Simulation ${run.form} · Section ${ci + 1} of ${AM_CH.length}</div><h2>${AM_TYPE[def.type]}</h2></div>
      <span class="spacer"></span><div class="clock" id="amClock" aria-live="off"></div></div>`;
    if (ch.intro) {
      app.innerHTML = `<div class="am-test">${head}<div class="am-instr"><p>${AM_INSTR[def.type]}</p>
        <p class="muted">${def.n} questions · ${def.min} minutes. The clock is already running.</p>
        <button class="btn primary" id="amGo">Start the section</button></div></div>`;
      $('#amGo').onclick = () => { delete ch.intro; amShownAt = Date.now(); persist(); amRenderRun(); };
      tick(); amTimer = setInterval(tick, 1000); return;
    }
    const j = run.q, it = items[j];
    const allDone = ch.ans.every(a => a != null);
    let stem = '';
    if (def.type === 'sc') stem = `<div class="am-stem">${esc(it.s).replace('____', '<span class="am-blank">________</span>')}</div>`;
    else if (def.type === 'rs') stem = `<div class="am-stem am-orig">${esc(it.s)}</div><div class="am-qline">${AM_RS_Q}</div>`;
    else stem = `<div class="am-stem">${esc(it.q)}</div>`;
    const passage = def.type === 'rc' ? `<article class="am-passage"><h3>${esc(form.rc[ch.tier].title)}</h3>${form.rc[ch.tier].p.map((p, i) => `<p><span class="pn">(${i + 1})</span> ${esc(p)}</p>`).join('')}</article>` : '';
    app.innerHTML = `<div class="am-test">${head}
      <div class="am-nav">${items.map((_, i) => `<button class="${i === j ? 'on ' : ''}${ch.ans[i] != null ? 'ans ' : ''}${ch.flag[i] ? 'flag' : ''}" data-go="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`).join('')}</div>
      <div class="${passage ? 'am-split' : ''}">${passage}
      <div class="am-qbox"><div class="eyebrow">Question ${j + 1} of ${items.length}</div>${stem}
        <div class="am-opts">${it.o.map((o, i) => `<button class="am-opt${ch.ans[j] === i ? ' sel' : ''}" data-pick="${i}"><span class="n">(${i + 1})</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div class="row am-ctl">
          <button class="btn" id="amPrev" ${j === 0 ? 'disabled' : ''}>← Previous</button>
          <button class="btn" id="amNext" ${j === items.length - 1 ? 'disabled' : ''}>Next →</button>
          <button class="btn${ch.flag[j] ? ' flagged' : ''}" id="amFlag">⚑ ${ch.flag[j] ? 'Flagged' : 'Flag'}</button>
          <span class="spacer"></span>
          <button class="btn primary" id="amEnd" ${allDone ? '' : 'disabled title="Answer every question to finish the section early"'}>${ci === AM_CH.length - 1 ? 'Finish the test' : 'End section'}</button>
        </div></div></div>
      <p class="muted am-note">You cannot return to this section after it ends. Unanswered questions count as wrong.</p></div>`;
    const go = i => { amLogTime(run); run.q = i; persist(); amRenderRun(); };
    app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
    app.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { ch.ans[j] = +b.dataset.pick; persist(); amRenderRun(); });
    $('#amPrev').onclick = () => go(j - 1);
    $('#amNext').onclick = () => go(j + 1);
    $('#amFlag').onclick = () => { ch.flag[j] = !ch.flag[j]; persist(); amRenderRun(); };
    $('#amEnd').onclick = () => {
      const fl = ch.flag.filter(Boolean).length;
      if (!confirm((fl ? `${fl} flagged question(s). ` : '') + 'End this section? You will not be able to come back to it.')) return;
      if (!amCloseChapter(run)) amRenderRun();
    };
    tick(); amTimer = setInterval(tick, 1000);
  }
  document.addEventListener('keydown', e => {
    if (view.name !== 'amrun' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const b = $(`[data-pick="${+e.key - 1}"]`); if (/^[1-4]$/.test(e.key) && b) b.click();
  });

  // ----- result -----
  function amItemHtml(form, r, it, opts) {
    opts = opts || {};
    const tier = r.tier;
    const stem = r.type === 'sc' ? esc(it.s).replace('____', `<span class="am-blank">${esc(it.o[it.a])}</span>`)
      : r.type === 'rs' ? `<span class="am-orig">${esc(it.s)}</span>` : esc(it.q);
    return `<div class="am-rev ${r.ok ? 'ok' : 'no'}">
      <div class="eyebrow">Section ${r.ci + 1} · ${AM_TYPE[r.type]} · ${TIER_HE[tier]}${r.kind ? ' · ' + KIND_HE[r.kind] : ''}</div>
      <div class="am-stem" dir="ltr">${stem}</div>
      <div class="am-opts" dir="ltr">${it.o.map((o, i) => `<div class="am-opt ro${i === it.a ? ' right' : ''}${i === r.pick && !r.ok ? ' wrong' : ''}${opts.retry === i ? ' retry' : ''}"><span class="n">(${i + 1})</span><span>${esc(o)}${it.oh ? ` <span class="he ohe">${esc(it.oh[i])}</span>` : ''}</span></div>`).join('')}</div>
      ${r.pick == null ? '<div class="am-tag">לא נענתה</div>' : (!r.ok && r.trap ? `<div class="am-tag">המלכודת שבחרת: ${esc(TRAP_HE[r.trap] || r.trap)}</div>` : '')}
      <div class="am-x">${esc(it.x)}</div>
      ${it.he ? `<div class="am-he muted">${esc(it.he)}</div>` : ''}
    </div>`;
  }
  const amItemOf = (form, run, r) => amItems(form, r.ci, run.ch[r.ci].tier)[r.j];

  function amRenderResult() {
    const run = state.am.runs[view.id];
    if (!run || !run.res) { location.hash = '#amirnet'; return; }
    const form = amForm(run.form), R = run.res;
    const byType = t => { const x = R.items.filter(i => i.type === t); return [x.filter(i => i.ok).length, x.length]; };
    const wrong = R.items.filter(i => !i.ok).length;
    const pos = (R.score - 50) / 100 * 100;
    app.innerHTML = `<div class="am" dir="rtl">
      <a class="back" href="#amirnet">→ כל הסימולציות</a>
      <section class="summary" style="margin-top:10px">
        <div><div class="eyebrow">סימולציה ${run.form} · ${new Date(run.finished).toLocaleDateString('he-IL')}</div>
          <div class="am-score"><b>${R.score}</b><span>${esc(R.band)}</span></div></div>
        <div class="am-scale" aria-hidden="true">${BANDS.map(b => `<span style="flex:${b[1] - b[0] + 1}">${b[2]}</span>`).join('')}<i style="right:${pos}%"></i></div>
        <div class="stats">
          ${['sc', 'rs', 'rc'].map(t => { const [k, n] = byType(t); return `<div class="stat"><b>${k}/${n}</b>${AM_TYPE_HE[t]}</div>`; }).join('')}
          <div class="stat"><b>${R.items.length - wrong}/${R.items.length}</b>סה"כ נכונות</div>
        </div>
        <div><b>מסלול הרמות:</b> <span class="am-path">${run.ch.map((c, i) => `<span class="t${c.tier}" title="פרק ${i + 1}">${i + 1}: ${TIER_HE[c.tier]}</span>`).join('')}</span>
          <p class="muted" style="margin:.3em 0 0">${amPathText(run)}</p></div>
        <div class="row">${wrong ? `<a class="btn primary" href="#amirnet/d/${run.id}">${run.db && run.db.done ? 'התחקיר שלך' : `תחקיר טעויות (${wrong})`}</a>` : '<span>אין טעויות – כל הכבוד!</span>'}
          <a class="btn" href="#amirnet/progress">רפלקציה ומגמות</a></div>
      </section>
      <div class="section-head"><h2>כל השאלות</h2><span class="muted">עם התשובה הנכונה, המלכודת שבחרת והסבר</span></div>
      <div class="am-filter row"><label><input type="checkbox" id="amOnlyWrong" checked> רק טעויות</label></div>
      <div id="amList"></div></div>`;
    const draw = () => {
      const only = $('#amOnlyWrong').checked;
      let html = '', lastCi = -1;
      R.items.forEach(r => {
        if (only && r.ok) return;
        if (r.ci !== lastCi && r.type === 'rc') {
          const t = form.rc[run.ch[r.ci].tier];
          html += `<details class="am-passage-rev"><summary>הקטע: ${esc(t.title)}</summary><div dir="ltr">${t.p.map((p, i) => `<p><span class="pn">(${i + 1})</span> ${esc(p)}</p>`).join('')}</div><p class="muted">${esc(t.he)}</p></details>`;
        }
        lastCi = r.ci;
        html += amItemHtml(form, r, amItemOf(form, run, r));
      });
      $('#amList').innerHTML = html || '<div class="empty">אין טעויות להצגה.</div>';
    };
    $('#amOnlyWrong').onchange = draw; draw();
  }
  function amPathText(run) {
    const p = run.ch.map(c => c.tier).join('');
    const up = (p.match(/C/g) || []).length, down = (p.match(/A/g) || []).length;
    if (up >= 4) return 'רוב המבחן הוצג לך ברמה הקשה – המבחן "חשב" שאת ברמה גבוהה. זה מה שמאפשר להגיע לציונים הגבוהים.';
    if (down >= 4) return 'רוב הפרקים הוצגו ברמה הקלה, ולכן התקרה של הציון נמוכה יותר. דיוק בפרקים הראשונים הוא המפתח לעלות רמה.';
    return 'המבחן נע בין הרמות לפי התשובות שלך. כל פרק שנענה טוב מעלה את רמת הפרק הבא – ושאלות קשות שנענו נכון שוות יותר בציון.';
  }

  // ----- debrief (תחקיר) -----
  function amRenderDebrief() {
    const run = state.am.runs[view.id];
    if (!run || !run.res) { location.hash = '#amirnet'; return; }
    const form = amForm(run.form);
    const db = run.db = run.db || { i: 0, items: {} };
    const mistakes = run.res.items.filter(r => !r.ok);
    if (!mistakes.length) { location.hash = '#amirnet/r/' + run.id; return; }
    if (db.done || db.i >= mistakes.length) return amRenderDebriefSummary(run, form, mistakes);
    const r = mistakes[db.i], it = amItemOf(form, run, r), key = r.ci + '.' + r.j;
    const d = db.items[key] = db.items[key] || {};
    const header = `<a class="back" href="#amirnet/r/${run.id}">→ לתוצאות</a>
      <div class="row" style="margin-top:10px"><div><div class="eyebrow">תחקיר · טעות ${db.i + 1} מתוך ${mistakes.length}</div><h1>למה טעיתי?</h1></div></div>
      <div class="bar" style="height:6px;margin:10px 0 16px"><span style="width:${db.i / mistakes.length * 100}%"></span></div>`;
    const passage = r.type === 'rc' ? (() => { const t = form.rc[r.tier]; return `<details class="am-passage-rev"><summary>הקטע: ${esc(t.title)}</summary><div dir="ltr">${t.p.map((p, i) => `<p><span class="pn">(${i + 1})</span> ${esc(p)}</p>`).join('')}</div></details>`; })() : '';
    if (d.retry == null) {
      // step 1: try again without the clock — tells a careless/time slip apart from a real gap
      const stem = r.type === 'sc' ? esc(it.s).replace('____', '<span class="am-blank">________</span>') : r.type === 'rs' ? `<span class="am-orig">${esc(it.s)}</span><div class="am-qline">${AM_RS_Q}</div>` : esc(it.q);
      app.innerHTML = `<div class="am" dir="rtl">${header}
        <div class="am-card"><p><b>שלב 1:</b> נסי לענות שוב, הפעם בלי שעון. ${r.pick == null ? 'בזמן המבחן לא ענית על השאלה הזו.' : 'התשובה שבחרת במבחן לא מסומנת כאן.'}</p>
        ${passage}<div class="am-stem" dir="ltr">${stem}</div>
        <div class="am-opts" dir="ltr">${it.o.map((o, i) => `<button class="am-opt" data-retry="${i}"><span class="n">(${i + 1})</span><span>${esc(o)}</span></button>`).join('')}</div></div></div>`;
      app.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => { d.retry = +b.dataset.retry; persist(); amRenderDebrief(); });
      return;
    }
    const retryOk = d.retry === it.a, fast = r.t > 0 && r.t < (r.type === 'sc' ? 15 : r.type === 'rs' ? 25 : 20);
    // evidence-based suggestions for the reasons list
    const sug = new Set();
    if (r.pick == null) sug.add('time');
    if (retryOk && r.pick != null) { sug.add(fast ? 'time' : 'careless'); }
    if (!retryOk) { if (r.type === 'sc') sug.add('vocab_unknown'); else sug.add('sentence'); }
    if (fast) sug.add('time');
    if (r.trap === 'form') sug.add('similar_word');
    if (r.trap === 'sense') sug.add('vocab_partial');
    if (r.trap === 'logic' || r.trap === 'opposite') sug.add('connector');
    if (['scope', 'time', 'reverse', 'extra', 'missing', 'degree', 'word_match', 'partial', 'extreme'].includes(r.trap)) sug.add('trap');
    if (['not_in_text', 'too_far'].includes(r.trap)) sug.add('outside');
    if (r.trap === 'detail') sug.add('misread_q');
    if (!d.reasons) d.reasons = [...sug];
    const probes = r.type === 'sc' ? [[it.a, 'התשובה הנכונה']].concat(r.pick != null && r.pick !== it.a ? [[r.pick, 'המילה שבחרת']] : []) : [];
    d.probe = d.probe || {};
    const probeHtml = probes.map(([oi, label]) => {
      const done = d.probe[oi];
      const choices = d['pc' + oi] = d['pc' + oi] || shuffle([0, 1, 2, 3]);
      return `<div class="am-probe"><b>${label}: מה פירוש "<span dir="ltr">${esc(it.o[oi])}</span>"?</b>
        <div class="mc">${choices.map(ci => `<button class="opt${done != null ? (ci === oi ? ' right' : ci === done ? ' wrong' : '') : ''}" data-probe="${oi}" data-c="${ci}" ${done != null ? 'disabled' : ''}><span class="he">${esc(it.oh[ci])}</span></button>`).join('')}</div>
        ${done != null ? `<div class="muted">${done === oi ? 'ידעת את המילה ✓' : 'כאן יש פער באוצר המילים – כדאי להוסיף אותה לתרגול.'}</div>` : ''}</div>`;
    }).join('');
    const deck = amDeckWords(it, r);
    app.innerHTML = `<div class="am" dir="rtl">${header}
      ${passage}${amItemHtml(form, r, it, { retry: d.retry })}
      <div class="am-card">
        <p><b>בניסיון החוזר:</b> ${retryOk ? (r.pick == null ? 'ענית נכון – כלומר הידע קיים, והבעיה הייתה הזמן.' : 'ענית נכון! כלומר הידע קיים – הטעות במבחן נבעה כנראה מלחץ זמן, ריכוז או מלכודת.') : 'גם עכשיו התשובה לא נכונה – יש כאן פער בהבנה או באוצר מילים, וזה מה שכדאי לחזק.'}
        ${r.t ? ` <span class="muted">(במבחן הקדשת לשאלה כ-${r.t} שניות${fast ? ' – מהר מאוד' : ''}.)</span>` : ''}</p>
        ${probeHtml ? `<p><b>שלב 2: בדיקת אוצר מילים</b></p>${probeHtml}` : ''}
        <p><b>${probeHtml ? 'שלב 3' : 'שלב 2'}: כמה היית בטוחה כשענית?</b></p>
        <div class="row am-chips">${[['sure', 'בטוחה'], ['half', 'התלבטתי'], ['guess', 'ניחשתי'], ['none', 'לא הספקתי']].map(([v, l]) => `<label><input type="radio" name="conf" value="${v}" ${d.conf === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <p><b>מה לדעתך הסיבה לטעות?</b> <span class="muted">(סימנתי מראש הצעות לפי מה שקרה – אפשר לשנות)</span></p>
        <div class="am-reasons">${REASONS.map(([k, l]) => `<label><input type="checkbox" value="${k}" ${d.reasons.includes(k) ? 'checked' : ''}> ${l}${sug.has(k) ? ' <span class="am-sug">הצעה</span>' : ''}</label>`).join('')}</div>
        ${deck.length ? `<p><b>מילים מהשאלה שנמצאות בכרטיסיות שלך:</b></p><div class="row">${deck.map(k => `<button class="btn am-addw" data-k="${esc(k)}">${esc(WORDS[k].w)} · ${status(k) === 'k' ? 'להחזיר ללמידה' : 'כבר בלמידה ✓'}</button>`).join('')}</div>` : ''}
        <p><b>מילים שלא הכרת בשאלה</b> <span class="muted">(לא חובה, מופרדות בפסיק)</span></p>
        <input class="search" id="amWords" dir="ltr" value="${esc(d.words || '')}" placeholder="e.g. tenuous, scrutinize">
        <div class="row" style="margin-top:14px">${db.i > 0 ? '<button class="btn" id="amBack">הקודמת</button>' : ''}<span class="spacer"></span><button class="btn primary" id="amNextM">${db.i === mistakes.length - 1 ? 'לסיכום התחקיר' : 'לטעות הבאה'}</button></div>
      </div></div>`;
    app.querySelectorAll('[data-probe]').forEach(b => b.onclick = () => { d.probe[b.dataset.probe] = +b.dataset.c; if (+b.dataset.c !== +b.dataset.probe && !d.reasons.includes('vocab_unknown') && +b.dataset.probe === it.a) d.reasons.push('vocab_unknown'); saveForm(); persist(); amRenderDebrief(); });
    app.querySelectorAll('.am-addw').forEach(b => b.onclick = () => { setStatus(b.dataset.k, 'l'); b.textContent = WORDS[b.dataset.k].w + ' · כבר בלמידה ✓'; });
    function saveForm() {
      const c = app.querySelector('input[name=conf]:checked'); if (c) d.conf = c.value;
      d.reasons = [...app.querySelectorAll('.am-reasons input:checked')].map(x => x.value);
      d.words = ($('#amWords') || {}).value || '';
    }
    $('#amNextM').onclick = () => { saveForm(); db.i++; if (db.i >= mistakes.length) db.done = Date.now(); persist(); amRenderDebrief(); window.scrollTo(0, 0); };
    const bk = $('#amBack'); if (bk) bk.onclick = () => { saveForm(); db.i--; persist(); amRenderDebrief(); window.scrollTo(0, 0); };
  }
  // words of the question that exist in the flashcard deck (sentence completion options)
  function amDeckWords(it, r) {
    if (r.type !== 'sc') return [];
    const out = [];
    it.o.forEach(o => { const k = keyOf(o); Object.keys(WORDS).forEach(x => { if ((x === k || x.startsWith(k + '~')) && WORDS[x].group && !out.includes(x)) out.push(x); }); });
    return out;
  }
  function amRenderDebriefSummary(run, form, mistakes) {
    const db = run.db, cnt = {}, traps = {};
    let retryOk = 0, vocabGap = 0;
    mistakes.forEach(r => {
      const d = db.items[r.ci + '.' + r.j] || {};
      (d.reasons || []).forEach(k => cnt[k] = (cnt[k] || 0) + 1);
      if (r.trap) traps[r.trap] = (traps[r.trap] || 0) + 1;
      const it = amItemOf(form, run, r);
      if (d.retry === it.a) retryOk++;
      if (d.probe && Object.entries(d.probe).some(([oi, c]) => +oi !== c)) vocabGap++;
    });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const topTraps = Object.entries(traps).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const words = mistakes.map(r => (db.items[r.ci + '.' + r.j] || {}).words || '').join(',').split(',').map(x => x.trim()).filter(Boolean);
    app.innerHTML = `<div class="am" dir="rtl"><a class="back" href="#amirnet/r/${run.id}">→ לתוצאות</a>
      <section class="summary" style="margin-top:10px"><div><div class="eyebrow">סיכום התחקיר · סימולציה ${run.form}</div><h1>מה למדנו מ-${mistakes.length} הטעויות</h1></div>
        <div class="stats">
          <div class="stat"><b>${retryOk}/${mistakes.length}</b>תוקנו בניסיון חוזר בלי שעון</div>
          <div class="stat"><b>${vocabGap}</b>טעויות עם פער באוצר מילים</div>
          <div class="stat"><b>${mistakes.filter(r => r.pick == null).length}</b>שאלות שלא נענו</div>
        </div>
        <p>${retryOk >= mistakes.length / 2 ? 'רוב הטעויות תוקנו כשלא היה לחץ זמן – כלומר הידע שלך גבוה מהציון. כדאי לעבוד על קצב, ריכוז וזיהוי מלכודות.' : 'רוב הטעויות נשארו גם בניסיון החוזר – כלומר יש פערי ידע אמיתיים (אוצר מילים / הבנת מבנים). כאן התרגול ישתלם הכי הרבה.'}</p>
      </section>
      ${top.length ? `<div class="section-head"><h2>הסיבות העיקריות</h2></div><div class="am-tips">${top.map(([k, n]) => `<div class="am-card"><b>${esc(REASON[k].he)}</b> <span class="muted">· ${n} פעמים</span><p>${esc(REASON[k].tip)}</p></div>`).join('')}</div>` : ''}
      ${topTraps.length ? `<div class="section-head"><h2>המלכודות שתפסו אותך</h2></div><div class="am-tips">${topTraps.map(([k, n]) => `<div class="am-card"><b>${esc(TRAP_HE[k] || k)}</b> <span class="muted">· ${n} פעמים</span><p>${esc(TRAP_TIP[k] || '')}</p></div>`).join('')}</div>` : ''}
      ${words.length ? `<div class="section-head"><h2>מילים שסימנת שלא הכרת</h2></div><p dir="ltr" style="text-align:right">${words.map(esc).join(', ')}</p>` : ''}
      <div class="row" style="margin-top:18px"><button class="btn" id="amRedo">לעבור על התחקיר שוב</button><a class="btn primary" href="#amirnet/progress">רפלקציה ומגמות</a></div></div>`;
    $('#amRedo').onclick = () => { db.i = 0; delete db.done; persist(); amRenderDebrief(); };
  }

  // ----- reflection across tests -----
  function amStats(runs) {
    // residual = actual - expected (given that test's ability): positive means stronger than your overall level on that kind of question
    const acc = {};
    const add = (key, r, th) => { const a = acc[key] = acc[key] || { n: 0, ok: 0, res: 0 }; a.n++; a.ok += r.ok; a.res += r.ok - amP(th, AM_DISC[r.type], r.b); };
    runs.forEach(run => run.res.items.forEach(r => {
      add('type:' + r.type, r, run.res.th);
      if (r.kind) add('kind:' + r.kind, r, run.res.th);
    }));
    return acc;
  }
  function amRenderProgress() {
    const runs = finishedRuns();
    if (!runs.length) { app.innerHTML = '<div class="am" dir="rtl"><a class="back" href="#amirnet">→ כל הסימולציות</a><div class="empty">עוד אין מבחנים שהושלמו. אחרי המבחן הראשון יופיעו כאן מגמות וחוזקות.</div></div>'; return; }
    const sc = runs.map(r => r.res.score), n = sc.length, last = runs[n - 1];
    const prev = n > 1 ? sc[n - 2] : null;
    const avgPrev = n > 1 ? sc.slice(0, -1).reduce((a, b) => a + b, 0) / (n - 1) : null;
    const k = Math.min(5, n), xs = sc.slice(-k);
    const slope = k > 1 ? (() => { const mx = (k - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / k; let nu = 0, de = 0; xs.forEach((y, i) => { nu += (i - mx) * (y - my); de += (i - mx) ** 2; }); return nu / de; })() : 0;
    const trend = k < 3 ? 'צריך לפחות 3 מבחנים כדי לזהות מגמה.' : slope > 1.5 ? `מגמת שיפור: בממוצע +${slope.toFixed(1)} נקודות למבחן ב-${k} המבחנים האחרונים.` : slope < -1.5 ? `מגמת ירידה: בממוצע ${slope.toFixed(1)} נקודות למבחן ב-${k} המבחנים האחרונים. כדאי לבדוק עייפות, קצב, או אם עברת לנושאים חדשים.` : `יציבות: הציונים ב-${k} המבחנים האחרונים נעים סביב ${Math.round(xs.reduce((a, b) => a + b, 0) / k)}.`;
    const recent = runs.slice(-5), st = amStats(recent), stLast = amStats([last]);
    const inRecent = recent.length === 1 ? 'במבחן הזה' : `ב-${recent.length} המבחנים האחרונים`;
    const line = (key, label) => { const a = st[key]; if (!a) return ''; const rr = a.res / a.n; return { label, pct: Math.round(a.ok / a.n * 100), rr, n: a.n }; };
    const types = ['sc', 'rs', 'rc'].map(t => line('type:' + t, AM_TYPE_HE[t])).filter(Boolean);
    const kinds = Object.keys(KIND_HE).map(t => line('kind:' + t, KIND_HE[t])).filter(x => x && x.n >= 2);
    const strong = [...types, ...kinds].filter(x => x.rr > 0.07).sort((a, b) => b.rr - a.rr);
    const weak = [...types, ...kinds].filter(x => x.rr < -0.07).sort((a, b) => a.rr - b.rr);
    const traps = {}, reasons = {}; let unanswered = 0, fastWrong = 0;
    recent.forEach(run => {
      run.res.items.forEach(r => { if (r.trap) traps[r.trap] = (traps[r.trap] || 0) + 1; if (r.pick == null) unanswered++; if (!r.ok && r.t && r.t < 15) fastWrong++; });
      if (run.db) Object.values(run.db.items || {}).forEach(d => (d.reasons || []).forEach(x => reasons[x] = (reasons[x] || 0) + 1));
    });
    const topTraps = Object.entries(traps).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topReasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const lastTypes = ['sc', 'rs', 'rc'].map(t => { const a = stLast['type:' + t]; return a ? `${AM_TYPE_HE[t]} ${a.ok}/${a.n}` : ''; }).filter(Boolean).join(' · ');
    const cmp = prev == null ? 'זה המבחן הראשון שלך – הוא נקודת הייחוס למבחנים הבאים.' :
      `לעומת המבחן הקודם: ${last.res.score - prev >= 0 ? '+' : ''}${last.res.score - prev} נקודות. לעומת הממוצע של המבחנים הקודמים (${Math.round(avgPrev)}): ${last.res.score - avgPrev >= 0 ? '+' : ''}${Math.round(last.res.score - avgPrev)}.`;
    app.innerHTML = `<div class="am" dir="rtl"><a class="back" href="#amirnet">→ כל הסימולציות</a>
      <section class="summary" style="margin-top:10px">
        <div><div class="eyebrow">רפלקציה · ${n === 1 ? 'מבחן אחד' : n + ' מבחנים'}</div><h1>איך המבחן האחרון ביחס לקודמים</h1></div>
        <div class="am-chart">${amChart(runs)}</div>
        <ul class="am-bul"><li><b>המבחן האחרון (סימולציה ${last.form}):</b> ${last.res.score} · ${esc(last.res.band)} · ${lastTypes}</li>
          <li>${cmp}</li><li>${trend}</li>
          ${unanswered ? `<li>${unanswered} שאלות לא נענו ${inRecent} – תמיד לנחש לפני שהזמן נגמר.</li>` : ''}
          ${fastWrong >= 3 ? `<li>${fastWrong} טעויות בשאלות שנענו בפחות מ-15 שניות – ייתכן שאת ממהרת מדי.</li>` : ''}</ul>
      </section>
      <div class="section-head"><h2>חוזקות וחולשות</h2><span class="muted">${inRecent}, ביחס לרמה הכללית שלך</span></div>
      <div class="am-tips">
        <div class="am-card"><b>חזק יותר</b>${strong.length ? `<ul>${strong.slice(0, 4).map(x => `<li>${esc(x.label)} – ${x.pct}% נכונות</li>`).join('')}</ul>` : '<p class="muted">אין עדיין סוג שאלה שבולט לטובה.</p>'}</div>
        <div class="am-card"><b>פחות חזק</b>${weak.length ? `<ul>${weak.slice(0, 4).map(x => `<li>${esc(x.label)} – ${x.pct}% נכונות</li>`).join('')}</ul>` : '<p class="muted">אין סוג שאלה שבולט לרעה.</p>'}</div>
      </div>
      <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>סוג שאלה</th><th>נכונות</th><th>ביחס לרמה שלך</th></tr></thead><tbody>
        ${[...types, ...kinds].map(x => `<tr><td>${esc(x.label)}</td><td>${x.pct}% (${x.n})</td><td>${amRelBar(x.rr)}</td></tr>`).join('')}</tbody></table></div>
      ${topTraps.length ? `<div class="section-head"><h2>המלכודות החוזרות</h2></div><div class="am-tips">${topTraps.map(([k, c]) => `<div class="am-card"><b>${esc(TRAP_HE[k] || k)}</b> <span class="muted">· ${c}</span><p>${esc(TRAP_TIP[k] || '')}</p></div>`).join('')}</div>` : ''}
      ${topReasons.length ? `<div class="section-head"><h2>הסיבות שציינת בתחקירים</h2></div><div class="am-tips">${topReasons.map(([k, c]) => `<div class="am-card"><b>${esc(REASON[k].he)}</b> <span class="muted">· ${c}</span><p>${esc(REASON[k].tip)}</p></div>`).join('')}</div>` : '<p class="muted">אחרי תחקיר טעויות יופיעו כאן גם הסיבות שסימנת.</p>'}
      <div class="section-head"><h2>כל המבחנים</h2></div>
      <div class="tablewrap"><table><thead><tr><th>תאריך</th><th>סימולציה</th><th>ציון</th><th>רמה</th><th>מסלול</th><th>תחקיר</th></tr></thead><tbody>
        ${runs.slice().reverse().map(r => `<tr><td>${new Date(r.finished).toLocaleDateString('he-IL')}</td><td><a href="#amirnet/r/${r.id}">${r.form}</a></td><td><b>${r.res.score}</b></td><td>${esc(r.res.band)}</td><td dir="ltr">${r.res.path}</td><td>${r.db && r.db.done ? '✓' : (r.res.items.some(i => !i.ok) ? `<a href="#amirnet/d/${r.id}">לעשות</a>` : '–')}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
  }
  function amRelBar(rr) {
    const w = Math.min(50, Math.abs(rr) * 160);
    return `<span class="am-rel"><i class="${rr >= 0 ? 'pos' : 'neg'}" style="width:${w}%;${rr >= 0 ? 'right:50%' : 'left:50%'}"></i></span>`;
  }
  function amChart(runs) {
    const W = 600, H = 220, pl = 34, pr = 12, pt = 12, pb = 26;
    const x = i => runs.length === 1 ? (pl + W - pr) / 2 : pl + (W - pl - pr) * i / (runs.length - 1);
    const y = v => pt + (H - pt - pb) * (1 - (v - 50) / 100);
    const grid = [50, 70, 85, 100, 120, 134, 150].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pl - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('');
    const pts = runs.map((r, i) => `${x(i)},${y(r.res.score)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scores over time" dir="ltr">
      <rect x="${pl}" y="${y(150)}" width="${W - pl - pr}" height="${y(134) - y(150)}" class="ex"/>
      ${grid}<polyline points="${pts}" class="ln"/>
      ${runs.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.res.score)}" r="4.5" class="pt"><title>סימולציה ${r.form}: ${r.res.score}</title></circle><text x="${x(i)}" y="${y(r.res.score) - 9}" text-anchor="middle" class="lb">${r.res.score}</text>`).join('')}
      <text x="${W - pr}" y="${y(150) + 13}" text-anchor="end" class="ax">פטור</text></svg>`;
  }

  view = parseHash();
  render();
})();
