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
  let state = { s: {}, ex: {}, t: 0 };
  try { const raw = localStorage.getItem(LS); if (raw) state = Object.assign(state, JSON.parse(raw)); } catch (e) { }
  // Move progress saved under old position-based keys (word, word~2) to the permanent card ids.
  const LEGACY = {};
  V.groups.forEach(g => g.words.forEach(w => { if (w.legacy) LEGACY[w.legacy] = w.k; }));
  function migrate(st) {
    let changed = false;
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
    try { await docRef.set({ s: state.s, ex: state.ex, t: state.t }); syncEl.textContent = 'Synced to your account'; }
    catch (e) { syncEl.textContent = 'Saved on this device only'; }
    saving = false;
    if (pending) { pending = false; pushRemote(); }
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
        if ((r.t || 0) >= (state.t || 0)) { state = { s: Object.assign({}, r.s || {}), ex: Object.assign({}, r.ex || {}), t: r.t || 0 }; migrate(state); try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { } render(); }
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
    return { name: 'home' };
  }
  window.addEventListener('hashchange', () => { view = parseHash(); tab = 'cards'; deck = null; render(); window.scrollTo(0, 0); });
  let tab = 'cards';
  let deck = null; // flashcard session

  function render() {
    hidePop();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === view.name || (view.name === 'group' && a.dataset.nav === 'home')));
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
    app.innerHTML = `
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
      <div class="section-head"><h2>Word groups</h2><span class="muted">Grouped by meaning, 20 cards each</span></div>
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

  function buildDeck(keys, id) {
    let list = prefs.onlyLearning ? keys.filter(k => status(k) !== 'k') : keys.slice();
    if (prefs.shuffle) list = shuffle(list);
    deck = { id, keys, list, i: 0, flip: false, k: 0, l: 0 };
  }

  function renderDeck(pane, keys, id) {
    if (!deck || deck.id !== id) buildDeck(keys, id);
    const d = deck;
    const opts = `<div class="opts">
        <label><input type="checkbox" id="optOnly" ${prefs.onlyLearning ? 'checked' : ''}> Only words I'm still learning</label>
        <label><input type="checkbox" id="optShuffle" ${prefs.shuffle ? 'checked' : ''}> Shuffle</label>
        <label><input type="checkbox" id="optRev" ${prefs.reverse ? 'checked' : ''}> Hebrew first</label>
      </div>`;
    if (!d.list.length || d.i >= d.list.length) {
      const allKnown = !d.list.length;
      pane.innerHTML = `<div class="deck"><div class="endbox">
        <h2>${allKnown ? 'You know every word here' : 'Round finished'}</h2>
        ${allKnown ? '<p class="muted">Untick “Only words I\'m still learning” to go through them again.</p>' :
          `<p><span class="pill k">${d.k} know</span> &nbsp; <span class="pill l">${d.l} still learning</span></p>`}
        <div class="row" style="justify-content:center">
          ${!allKnown ? '<button class="btn primary" id="again">Study again</button>' : ''}
          ${view.name === 'group' ? '<button class="btn" id="toFill">Go to the exercise →</button>' : ''}
        </div></div>${opts}</div>`;
      const a = $('#again'); if (a) a.onclick = () => { buildDeck(keys, id); renderDeck(pane, keys, id); };
      const f = $('#toFill'); if (f) f.onclick = () => { tab = 'fill'; deck = null; renderGroup(); };
      wireOpts(pane, keys, id); return;
    }
    const k = d.list[d.i], w = WORDS[k];
    const front = `<div class="word">${esc(w.w)}</div><div class="kbd">${(w.units || []).map(esc).join(' · ')}</div>`;
    const meaning = `<div class="mean">${esc(w.he)}</div>`;
    const back = `${prefs.reverse ? `<div class="word" style="font-size:clamp(26px,6vw,38px)">${esc(w.w)}</div>` : meaning}
      ${w.dEn ? `<div class="daily"><div class="den">${hl(w.dEn, w.w)}</div><div class="dhe he">${esc(w.dHe)}</div></div>` : ''}
      ${w.ex ? `<div class="ex">${esc(w.ex)}</div>` : ''}${w.exHe ? `<div class="exhe he">${esc(w.exHe)}</div>` : ''}
      ${w.other && w.other.length ? `<div class="note">Other meaning: <span class="he">${w.other.map(esc).join(' · ')}</span></div>` : ''}
      ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}`;
    pane.innerHTML = `<div class="deck">
      <div class="counter">Card ${d.i + 1} of ${d.list.length} · ${pill(k)}</div>
      <button class="card${d.flip ? ' flip' : ''}" id="card" aria-label="Flip card">
        <div class="inner"><div class="face">${prefs.reverse ? meaning : front}<div class="kbd">Tap to flip</div></div>
        <div class="face back">${back}</div></div>
      </button>
      <div class="row" style="justify-content:center">
        <button class="btn learn" id="bL">Still learning</button>
        <button class="btn know" id="bK">I know it</button>
      </div>
      <div class="kbd">Keyboard: Space flips · ← still learning · → I know it</div>
      ${opts}</div>`;
    $('#card').onclick = () => { d.flip = !d.flip; $('#card').classList.toggle('flip', d.flip); };
    $('#bK').onclick = () => answer('k');
    $('#bL').onclick = () => answer('l');
    function answer(v) { setStatus(k, v); d[v]++; d.i++; d.flip = false; renderDeck(pane, keys, id); }
    wireOpts(pane, keys, id);
  }
  function wireOpts(pane, keys, id) {
    const on = (sel, key) => { const el = $(sel, pane); if (el) el.onchange = () => { prefs[key] = el.checked; savePrefs(); buildDeck(keys, id); renderDeck(pane, keys, id); }; };
    on('#optOnly', 'onlyLearning'); on('#optShuffle', 'shuffle'); on('#optRev', 'reverse');
  }
  document.addEventListener('keydown', e => {
    if (!deck || !$('#card') || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); $('#card').click(); }
    else if (e.key === 'ArrowRight') $('#bK').click();
    else if (e.key === 'ArrowLeft') $('#bL').click();
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
    pane.innerHTML = `<p class="muted">Choose the word that completes each sentence.</p>
      <div class="qs">${qs.map(({ e, opts }, i) => {
        const parts = esc(e.sentence).split('____');
        return `<div class="q" id="q${i}"><div class="s">${parts[0]}<span class="blank" id="bl${i}">&nbsp;</span>${parts.slice(1).join('____')}</div>
          <div class="mc">${opts.map(o => `<button class="opt" data-i="${i}" data-a="${esc(o)}">${esc(o)}</button>`).join('')}</div>
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
    else pop.innerHTML = `<div class="w">${esc(w.w)} ${pill(k)}</div><div class="m">${esc(w.he)}</div>${w.other && w.other.length ? `<div class="m" style="font-size:13px;opacity:.75">גם: ${w.other.map(esc).join(' · ')}</div>` : ''}
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
  function renderList(pane, keys) {
    pane.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Word</th><th style="text-align:right">Meaning</th><th>Everyday sentence</th><th>Status</th></tr></thead><tbody>
      ${keys.map(k => { const w = WORDS[k]; return `<tr><td class="w">${esc(w.w)}</td><td class="he">${esc(w.he)}</td><td class="sent">${w.dEn ? `<div>${hl(w.dEn, w.w)}</div><div class="he muted">${esc(w.dHe)}</div>` : ''}</td><td><button class="toggle" data-k="${esc(k)}" title="Click to change">${pill(k)}</button></td></tr>`; }).join('')}
      </tbody></table></div><p class="muted" style="font-size:13px">Click a status to switch it.</p>`;
    pane.querySelectorAll('.toggle').forEach(b => b.onclick = () => { const k = b.dataset.k; setStatus(k, status(k) === 'k' ? 'l' : 'k'); b.innerHTML = pill(k); });
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
      renderList(pane, list);
    };
    $('#q').oninput = e => draw(e.target.value);
    draw('');
  }

  // ---------- backup ----------
  document.addEventListener('click', e => {
    if (!e.target.closest('#bkExport')) return;
    const blob = new Blob([JSON.stringify({ app: 'zinuk-deck', saved: new Date().toISOString(), s: state.s, ex: state.ex, t: state.t })], { type: 'application/json' });
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
      state = { s: r.s || {}, ex: r.ex || {}, t: 0 }; migrate(state);
      persist(); render();
      const m = $('#bkMsg'); if (m) m.textContent = 'Backup loaded.';
    }).catch(() => { if (msg) msg.textContent = 'That file is not a Zinuk Deck backup.'; });
  });

  view = parseHash();
  render();
})();
