/* The Quartermaster — user interface. */
(function () {
  const QM = window.QM;
  const LEVELS = QM.LEVELS;
  const KEY = 'quartermaster.progress.v1';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ASSIGN_OPS = ['give', 'show', 'lend', 'clone'];
  const ownerPoss = (id) => (id === 'ship' ? 'the ship’s' : id === 'hold' ? 'the hold’s' : QM.holderName(id) + '’s');

  // ------------------------------------------------------------ progress
  function loadProgress() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  const P = Object.assign({ stars: {}, plans: {}, codes: [], intro: false, last: 0 }, loadProgress());
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* storage unavailable */ } }

  // ------------------------------------------------------------ state
  const S = { li: 0, level: null, plan: [], res: null, code: null, run: null, view: null, anim: null, hints: 0, history: [], attempts: 0, hit: [], mview: 'plan' };
  const appEl = document.getElementById('app');
  const phoneMQ = window.matchMedia ? window.matchMedia('(max-width: 760px)') : { matches: false };
  const isPhone = () => phoneMQ.matches;
  const stepsEl = $('#steps');
  const overlay = $('#overlay');
  const modal = $('#modal');
  let modalCleanup = null;

  const FACE = (id) => `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd690"/><stop offset="1" stop-color="#f0a12e"/></linearGradient></defs>
    <path d="M32 3 L57 17 L57 47 L32 61 L7 47 L7 17 Z" fill="#141d30" stroke="url(#${id})" stroke-width="2.5"/>
    <circle cx="32" cy="12.5" r="2.4" fill="#ffb648"/>
    <rect x="15" y="23" width="34" height="12" rx="6" fill="#0a0f1c" stroke="#ffb648" stroke-width="1.5"/>
    <rect class="visor" x="18.5" y="26.5" width="27" height="5" rx="2.5" fill="#ffb648"/>
    <path d="M23 45 h18" stroke="#ffb648" stroke-width="2" stroke-linecap="round" opacity=".7"/>
    <path d="M26 50 h12" stroke="#ffb648" stroke-width="2" stroke-linecap="round" opacity=".35"/></svg>`;

  const WRITE_LABEL = { map: 'adds a waypoint', log: 'writes an entry', chart: 'annotates it', crates: 'takes in a new crate' };
  const CODEX = [
    ['E0382', 'use of a moved value'], ['E0499', 'two mutable borrows at once'], ['E0502', 'shared and mutable borrows overlap'],
    ['E0503', 'use while mutably borrowed'], ['E0505', 'move out while borrowed'], ['E0596', 'mutation without `mut`, or through `&`'],
    ['E0597', 'borrowed value does not live long enough'], ['E0381', 'used before it was given a value'], ['E0425', 'name not found in this scope'],
    ['E0308', 'mismatched types'],
  ];

  // ------------------------------------------------------------ helpers
  const headerLen = (plan) => { let h = 0; while (h < plan.length && plan[h].lock) h++; return h; };
  const actorKey = (op) => (ASSIGN_OPS.includes(op) ? 'from' : 'who');
  function otherHolder(actor) {
    const hs = S.level.holders.filter((h) => h !== actor);
    return hs.find((h) => h !== 'ship' && h !== 'hold') || hs[0];
  }
  function normalize(s) {
    if (!ASSIGN_OPS.includes(s.op)) return s;
    if (!s.to || s.to === s.from) s.to = otherHolder(s.from);
    if ((s.op === 'show' || s.op === 'lend') && s.from === 'ship') {
      if (!s.field) s.field = 'engine';
      if (s.op === 'lend' && !s.via) s.via = 'direct';
      if (s.op === 'show') delete s.via;
    } else { delete s.field; delete s.via; }
    if (!(s.op === 'show' && s.from === 'hold')) delete s.index;
    return s;
  }
  function convertStep(s, op) {
    const actor = s.from || s.who;
    const keep = {};
    ['fixed', 'ops', 'lock', 'editable'].forEach((k) => { if (s[k] !== undefined) keep[k] = s[k]; });
    let n;
    if (ASSIGN_OPS.includes(op)) { n = { op, from: actor, to: s.to || otherHolder(actor) }; if (op === 'give' || op === 'clone') n.mut = false; if (op === 'show' && actor === 'hold') n.index = 0; }
    else if (op === 'mission') n = { op, who: actor, fn: S.level.missions[0], copy: false };
    else n = { op, who: actor };
    return normalize(Object.assign(n, keep));
  }
  function staticEnergy(plan) {
    let e = 0;
    for (const s of plan) {
      const M = s.op === 'mission' ? QM.MISSIONS[s.fn] : null;
      if (s.op === 'clone') e += QM.COST.clone;
      if (M && M.mode === 'move' && s.copy) e += QM.COST.clone;
      if (M && M.mode === 'return') e += QM.COST.returnTrip;
    }
    return e;
  }
  const starsHTML = (n, max = 3) => Array.from({ length: max }, (_, k) => `<span class="${k < n ? 'on' : ''}">★</span>`).join('');
  function addCode(code) { if (!P.codes.includes(code)) { P.codes.push(code); persist(); } if (!S.hit.includes(code)) S.hit.push(code); }

  // ------------------------------------------------------------ syntax highlight
  const TOK = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(#!?\[[^\]]*\])|\b(let|mut|fn|struct|impl|self|Self|pub|return|drop)\b|\b(String|Vec|u32|Ship)\b|\b([a-z_]+!)|\b(\d+)\b|(&)/g;
  function hl(text) {
    let out = '', last = 0, m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(text))) {
      out += esc(text.slice(last, m.index));
      const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'a' : m[4] ? 'k' : m[5] ? 't' : m[6] ? 'm' : m[7] ? 'n' : 'r';
      out += `<span class="tok-${cls}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
      if (m[0].length === 0) TOK.lastIndex++;
    }
    return out + esc(text.slice(last));
  }

  // ------------------------------------------------------------ phone views & back button
  let viewPushed = false, modalPushed = false, ignorePop = 0;
  function setView(v, opts) {
    opts = opts || {};
    S.mview = v;
    appEl.dataset.view = v;
    document.querySelectorAll('#mobile-nav button').forEach((b) => {
      const on = b.dataset.view === v;
      if (on) { b.setAttribute('aria-current', 'page'); b.classList.remove('dot', 'ok'); } else b.removeAttribute('aria-current');
    });
    if (!isPhone()) return;
    if (!opts.keepScroll) window.scrollTo({ top: 0 });
    if (opts.fromPop) { viewPushed = false; return; }
    if (opts.noHistory) return; // page loads and level switches don't add Back entries
    if (v !== 'plan' && !viewPushed) { try { history.pushState({ qm: 'view' }, ''); viewPushed = true; } catch (e) { /* ignore */ } }
    else if (v === 'plan' && viewPushed) { viewPushed = false; ignorePop++; history.back(); }
  }
  function markTabs(r) {
    if (!isPhone()) return;
    const mark = (view, ok) => {
      const b = document.querySelector(`#mobile-nav button[data-view="${view}"]`);
      if (b && S.mview !== view) { b.classList.add('dot'); b.classList.toggle('ok', !!ok); }
    };
    mark('crew', !r.error);
    if (r.error && r.error.code !== 'GAME') mark('code', false);
  }
  window.addEventListener('popstate', () => {
    if (ignorePop) { ignorePop--; return; }
    if (modalPushed && !overlay.hidden) { closeModal(true); return; }
    modalPushed = false;
    if (viewPushed) setView('plan', { fromPop: true });
  });

  // ------------------------------------------------------------ level lifecycle
  function validSaved(saved, level) {
    if (!Array.isArray(saved) || !saved.every((s) => s && typeof s.op === 'string')) return false;
    const lockedIn = (p) => p.filter((s) => s.lock).map((s) => s.op + (s.who || '') + (s.item || '')).join('|');
    return lockedIn(saved) === lockedIn(level.start);
  }
  function loadLevel(i) {
    if (S.anim) { clearTimeout(S.anim.timer); S.anim = null; }
    S.li = Math.max(0, Math.min(LEVELS.length - 1, i));
    S.level = LEVELS[S.li];
    const saved = P.plans[S.level.id];
    S.plan = validSaved(saved, S.level) ? clone(saved) : clone(S.level.start);
    S.run = null; S.view = null; S.hints = 0; S.history = []; S.attempts = 0; S.hit = [];
    P.last = S.li; persist();
    recompute();
    renderAll();
    window.scrollTo({ top: 0 });
    setView(isPhone() && !P.stars[S.level.id] && !(saved && saved.length) ? 'brief' : 'plan', { noHistory: true });
  }
  function recompute() {
    S.res = QM.analyze(S.level, S.plan);
    S.code = QM.render(S.level, S.plan, S.res.info);
  }
  function edit(fn) {
    if (S.anim) return;
    S.history.push(clone(S.plan));
    if (S.history.length > 80) S.history.shift();
    fn(S.plan);
    afterEdit();
  }
  function afterEdit() {
    P.plans[S.level.id] = S.plan; persist();
    S.run = null; S.view = null;
    recompute();
    renderPlan(); renderCode(); renderCrew(); renderQM(); renderBrief();
  }
  function undo() { if (S.anim || !S.history.length) return; S.plan = S.history.pop(); afterEdit(); }
  function resetLevel() { if (S.anim) return; S.history.push(clone(S.plan)); S.plan = clone(S.level.start); afterEdit(); }

  // ------------------------------------------------------------ render: header & brief
  function renderAll() { renderHead(); renderBrief(); renderPlan(); renderPalette(); renderCode(); renderCrew(); renderQM(); }

  function renderHead() {
    const L = S.level;
    $('#lvl-head').innerHTML = `<span class="lvl-num"><span class="long">Level ${L.id}/${LEVELS.length}</span><span class="short">L${L.id}</span></span><span class="lvl-title">${esc(L.title)}</span><span class="chip">${esc(L.concept)}</span><span class="stars" title="Best result">${starsHTML(P.stars[L.id] || 0)}</span>`;
  }

  function renderBrief() {
    const L = S.level;
    const r = S.run && !S.run.error ? S.run : null;
    const goals = L.goals.map((g, k) => {
      const met = r ? r.goals[k].met : null;
      const cls = met === true ? 'met' : met === false ? 'unmet' : '';
      return `<li class="${cls}"><span class="gbox">${met === true ? '✓' : met === false ? '✕' : ''}</span><span>${md(g.text)}</span></li>`;
    }).join('');
    let cost = '';
    if (L.energy) {
      const parts = [];
      if (L.palette.includes('clone') || L.palette.includes('mission')) parts.push('clone ⚡2');
      if ((L.missions || []).includes('scout_and_return')) parts.push('return trip ⚡1');
      cost = `<div class="cost-note">Energy: ${parts.join(' · ')}. ★★★ at ⚡${L.energy.star3} or less, ★★ at ⚡${L.energy.star2} or less.</div>`;
    }
    const hints = L.hints.slice(0, S.hints).map((h, k) => `<div class="hint"><b>Hint ${k + 1}</b>${md(h)}</div>`).join('');
    const more = S.hints < L.hints.length ? `<button class="btn ghost sm" data-act="hint">Show hint ${S.hints + 1} of ${L.hints.length}</button>` : '';
    $('#brief').innerHTML = `
      <div class="panel-h"><span class="ph-title">Briefing</span></div>
      <div class="panel-b">
        <div><span class="concept">${esc(L.concept)}</span><p>${md(L.briefing)}</p>${cost}</div>
        <div><div class="sect">Objectives</div><ul class="goals">${goals}</ul></div>
        <div><div class="sect">Hints</div><div class="hints">${hints}${more}</div></div>
        <button class="btn primary m-cta" data-act="goplan">Open the flight plan →</button>
      </div>`;
  }

  // ------------------------------------------------------------ render: plan
  function verbLabel(op, info, compact) {
    const it = info && info.item ? QM.ITEMS[info.item] : null;
    switch (op) {
      case 'give': return compact ? 'gives' : 'gives it to';
      case 'show': return compact ? 'shows' : 'shows it to';
      case 'lend': return compact ? 'lends ✎' : 'lends it ✎ to';
      case 'clone': return 'clones it ⚡2 for';
      case 'read': return (it ? it.read : 'reads') + ' it';
      case 'write':
        if (info && info.field) return QM.FIELDS[info.field].write.verb;
        return (it && WRITE_LABEL[info.item]) || 'writes in it';
      case 'mission': return 'sends it on a';
    }
    return op;
  }

  function itemChip(info) {
    if (!info || !info.kind) return '<span class="ichip none" title="nothing yet at this point">empty-handed</span>';
    const it = QM.ITEMS[info.item];
    let label = `${it.icon} ${esc(it.name)}`;
    if (info.field) label = `🚀 ${esc(QM.FIELDS[info.field].name)}`;
    else if (info.index != null) label = '📦 Crate A';
    if (info.kind === 'ref') {
      return `<span class="ichip ${info.refMut ? 'pen' : 'view'}" title="${info.refMut ? 'edit rights (&mut)' : 'a view (&)'} of ${esc(ownerPoss(info.owner))} item">${info.refMut ? '✎' : '👁'} ${label}</span>`;
    }
    return `<span class="ichip" title="declared as owning this item">${label}</span>`;
  }

  function sentenceHTML(i) {
    const s = S.plan[i], L = S.level;
    const info = (S.res && S.res.info[i]) || {};
    const fixed = s.fixed || [];
    const lockAll = s.lock === true;
    const editable = s.lock === 'partial' ? s.editable || [] : null;
    const dis = (k) => lockAll || (editable && !editable.includes(k)) || fixed.includes(k);
    const sel = (k, opts, val, cls) => `<select class="${cls || ''}" data-i="${i}" data-k="${k}" ${dis(k) ? 'disabled' : ''} aria-label="${k}">` +
      opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('') + '</select>';
    const holders = (excl) => L.holders.filter((h) => h !== excl).map((h) => [h, QM.holderName(h)]);
    const tog = (k, label, on) => {
      const d = dis(k);
      if (d && !on) return '';
      return `<label class="tog ${on ? 'on' : ''} ${d ? 'disabled' : ''}"><input type="checkbox" data-i="${i}" data-k="${k}" ${on ? 'checked' : ''} ${d ? 'disabled' : ''}>${esc(label)}</label>`;
    };
    const lockIco = lockAll ? '<span class="lockico" title="fixed by the level">🔒</span>' : '';

    if (s.op === 'issue') {
      const it = QM.ITEMS[s.item];
      const mutBit = dis('mut') ? `<span class="ichip">${s.mut ? '✎ writable' : 'read-only'}</span>` : tog('mut', ' ✎ writable', s.mut);
      return `${lockIco}<span>The Quartermaster issues the</span><span class="ichip">${it.icon} ${esc(it.name)}</span><span>to</span><b>${esc(QM.holderName(s.who))}</b>${mutBit}`;
    }
    if (s.op === 'board') return `${lockIco}<span>🛬 <b>${esc(QM.holderName(s.who))}</b> comes aboard</span><span class="ph-sub">her stay opens a block <code>{</code></span>`;
    if (s.op === 'depart') return `${lockIco}<span>🛫 <b>${esc(QM.holderName(s.who))}</b> departs</span><span class="ph-sub">block ends <code>}</code>; what she still owns leaves with her</span>`;

    const ak = actorKey(s.op);
    const actor = s[ak];
    let ops = s.ops || [s.op].concat(L.palette.filter((o) => o !== s.op));
    if (!L.missions) ops = ops.filter((o) => o !== 'mission');
    const compact = (s.op === 'show' || s.op === 'lend') && (actor === 'ship' || actor === 'hold');
    let h = lockIco + sel(ak, holders(null), actor, 'actor') + itemChip(info) + sel('op', ops.map((o) => [o, verbLabel(o, info, compact && (o === 'show' || o === 'lend'))]), s.op);
    switch (s.op) {
      case 'give':
      case 'clone': {
        const writes = L.palette.includes('write') || (L.missions || []).some((m) => QM.MISSIONS[m].mode === 'mut');
        h += sel('to', holders(actor), s.to) + (writes || s.mut ? tog('mut', ' ✎ writable', !!s.mut) : '');
        break;
      }
      case 'show':
      case 'lend':
        if (actor === 'ship') {
          h += sel('field', [['engine', 'the engine bay'], ['shields', 'the shield bay']], s.field || 'engine') + '<span>to</span>' + sel('to', holders(actor), s.to);
          if (s.op === 'lend') h += sel('via', [['direct', 'walking in directly'], ['method', 'through the ship’s computer']], s.via || 'direct');
        } else if (actor === 'hold' && s.op === 'show') {
          h += sel('index', [['0', 'Crate A (hold[0])'], ['all', 'the whole hold']], s.index != null ? '0' : 'all') + '<span>to</span>' + sel('to', holders(actor), s.to);
        } else h += sel('to', holders(actor), s.to);
        break;
      case 'mission': {
        h += sel('fn', (L.missions || []).map((m) => [m, `${QM.MISSIONS[m].name} (${QM.MISSIONS[m].note})`]), s.fn);
        const M = QM.MISSIONS[s.fn];
        if (M && M.mode === 'move') h += tog('copy', ' send a copy ⚡2', !!s.copy);
        break;
      }
    }
    return h;
  }

  function renderPlan() {
    const run = S.run;
    const err = run && run.error;
    const hdr = headerLen(S.plan);
    const lastRan = run ? (err ? err.step : S.plan.length - 1) : -1;
    stepsEl.classList.toggle('busy', !!S.anim);
    stepsEl.innerHTML = S.plan.map((s, i) => {
      const cls = ['step'];
      if (s.lock) cls.push('locked');
      if (run && !S.anim) {
        if (err && i === err.step) cls.push('err');
        else if (err && err.related.includes(i)) cls.push('rel');
        if (err && i > err.step) cls.push('after-err');
        else if (i <= lastRan && !(err && i === err.step)) cls.push('ok-ran');
      }
      if (S.view === i) cls.push('cur');
      const canUp = !s.lock && i - 1 >= hdr;
      const canDown = !s.lock && i + 1 < S.plan.length;
      const canDel = !s.lock && !s.fixed;
      let flag = '';
      if (run && !S.anim && err) {
        if (i === err.step) flag = `<div class="flag err">⛔ ${err.code === 'GAME' ? 'not possible here' : esc(err.code)}</div>`;
        else if (err.related.includes(i)) flag = '<div class="flag rel">⚑ involved in the denial</div>';
      }
      const rust = QM.renderStmt(S.level, S.plan, S.res.info, i);
      return `<li class="${cls.join(' ')}" data-i="${i}">
        <button class="step-n" data-act="view" data-i="${i}" title="${run ? 'Show the crew after this step' : 'Step ' + (i + 1)}" style="cursor:${run ? 'pointer' : 'default'}">${String(i + 1).padStart(2, '0')}</button>
        <div class="step-body"><div class="sentence">${sentenceHTML(i)}</div><div class="rust-line"><code>${hl(rust)}</code></div>${flag}</div>
        <div class="step-tools">
          <button class="tool" data-act="up" data-i="${i}" ${canUp ? '' : 'disabled'} aria-label="Move step ${i + 1} up">▲</button>
          <button class="tool" data-act="down" data-i="${i}" ${canDown ? '' : 'disabled'} aria-label="Move step ${i + 1} down">▼</button>
          <button class="tool" data-act="del" data-i="${i}" ${canDel ? '' : 'disabled'} aria-label="Delete step ${i + 1}">✕</button>
        </div></li>`;
    }).join('');
    const e = staticEnergy(S.plan);
    $('#energy').textContent = S.level.energy || e ? `⚡ ${e}` : '';
    $('#btn-undo').disabled = !S.history.length;
    $('#btn-run .run-label').innerHTML = S.anim ? 'Skip animation'
      : '<span class="long">Submit to the Quartermaster</span><span class="short">Submit plan</span>';
    renderRunStatus();
  }

  function renderRunStatus() {
    const el = $('#run-status');
    const r = S.run;
    if (!r || S.anim) { el.hidden = true; return; }
    el.hidden = false;
    if (r.error) { el.className = 'run-status deny'; el.textContent = r.error.code === 'GAME' ? `⛔ Step ${r.error.step + 1}` : `⛔ ${r.error.step + 1} · ${r.error.code}`; }
    else if (!r.complete) { el.className = 'run-status warn'; el.textContent = '◐ Not done'; }
    else { el.className = 'run-status ok'; el.textContent = '✓ Approved'; }
    el.title = 'Show the Quartermaster’s verdict';
  }

  function renderPalette() {
    const forms = { give: 'let b = a;', show: 'let b = &a;', lend: 'let b = &mut a;', clone: 'a.clone()', read: 'println!', write: 'push', mission: 'fn call' };
    const names = { give: 'Give', show: 'Show', lend: 'Lend ✎', clone: 'Clone', read: 'Read', write: 'Write', mission: 'Mission' };
    $('#palette').innerHTML = '<span class="lbl">Add step:</span>' + S.level.palette.map((op) =>
      `<button class="add" data-add="${op}" title="${esc(forms[op])}">+ ${names[op]}<code>${esc(forms[op])}</code></button>`).join('');
  }

  // ------------------------------------------------------------ render: code
  function renderCode() {
    const errStep = S.run && S.run.error ? S.run.error.step : null;
    const lines = S.code.lines.map((ln, k) => {
      const cls = ['cl'];
      if (ln.step != null) cls.push('stepline');
      if (S.view != null && ln.step === S.view) cls.push('cur');
      if (!S.anim && errStep != null && ln.step === errStep) cls.push('err');
      return `<div class="${cls.join(' ')}"><span class="ln">${k + 1}</span><span class="tx">${hl(ln.text) || ' '}</span></div>`;
    }).join('');
    const href = 'https://play.rust-lang.org/?version=stable&mode=debug&edition=2021&code=' + encodeURIComponent(S.code.code);
    $('#code').innerHTML = `
      <div class="panel-h"><span class="ph-title">Rust</span><span class="ph-sub">your plan, live</span>
        <div class="ph-tools code-actions">
          <button class="btn ghost sm" data-act="copy">Copy</button>
          <a class="btn ghost sm" href="${href}" target="_blank" rel="noopener" title="Compile it with the real rustc">Playground ↗</a>
        </div></div>
      <div class="code-wrap"><div class="code-lines">${lines}</div></div>`;
  }

  // ------------------------------------------------------------ render: crew
  function permBadges(perms, prev, showO) {
    const one = (k, title) => {
      if (k === 'O' && !showO) return '<span class="perm O na"></span>';
      const on = perms && perms[k];
      const changed = prev && perms && prev[k] !== perms[k];
      return `<span class="perm ${k} ${on ? 'on' : 'off'} ${changed ? 'changed' : ''}" title="${title}${on ? '' : ' (not now)'}">${k}</span>`;
    };
    return one('R', 'R: may read it') + one('W', 'W: may change it') + one('O', 'O: owns it, may give it away');
  }

  function crewCard(row, prev) {
    const H = QM.HOLDERS[row.id];
    const av = H.glyph ? `<span class="avatar glyph" style="background:${H.color}">${H.glyph}</span>` : `<span class="avatar" style="background:${H.color}">${esc(H.name[0])}</span>`;
    let holding = '', perms = '', fields = '', cls = '';
    const it = row.item ? QM.ITEMS[row.item] : null;
    switch (row.status) {
      case 'own':
        holding = `<div class="holding">${it.icon} <span>${esc(it.name)}</span><span class="sub">owns · ${row.mut ? '✎ writable' : 'read-only'}</span></div>`;
        perms = permBadges(row.perms, prev && prev.perms, true);
        if (row.fields) fields = `<div class="field-rows">${row.fields.map((f) => {
          const pf = prev && prev.fields ? prev.fields.find((x) => x.field === f.field) : null;
          return `<div class="field-row"><span>.${f.field}</span><span class="perms">${permBadges(f.perms, pf && pf.perms, true)}</span></div>`;
        }).join('')}</div>`;
        break;
      case 'ref': {
        const thing = row.field ? QM.FIELDS[row.field].name.toLowerCase() : row.index != null ? 'Crate A' : it.name;
        holding = `<div class="holding ${row.refMut ? 'pen' : 'view'} ${row.done ? 'done' : ''}">${row.refMut ? '✎' : '👁'} <span>${row.refMut ? 'editing' : 'viewing'} ${esc(ownerPoss(row.owner))} ${esc(thing)}</span>${row.done ? '<span class="sub">done</span>' : ''}</div>`;
        perms = permBadges(row.perms, prev && prev.perms, false);
        break;
      }
      case 'moved': {
        const to = QM.HOLDERS[row.movedTo] ? QM.holderName(row.movedTo) : row.movedTo;
        holding = `<div class="holding gone">${row.wasRef ? 'passed edit rights to' : 'handed over to'} ${esc(to)}</div>`;
        perms = permBadges({ R: false, W: false, O: false }, prev && prev.perms, true);
        break;
      }
      case 'absent': holding = '<div class="holding empty">not aboard</div>'; cls = 'absent'; break;
      case 'departed': holding = '<div class="holding gone">🛫 departed</div>'; cls = 'absent'; break;
      default: holding = '<div class="holding empty">empty hands</div>';
    }
    return `<div class="crew-card ${cls}"><div class="crew-top">${av}<div><div class="crew-name">${esc(H.name)}</div><div class="crew-role">${esc(H.role)}</div></div></div>${holding}${perms ? `<div class="perms">${perms}</div>` : ''}${fields}</div>`;
  }

  function renderCrew() {
    const L = S.level, run = S.run;
    let snap = null, prevSnap = null, label = 'before launch';
    if (run && S.view != null) {
      const k = S.view;
      if (k < run.snaps.length) { snap = run.snaps[k]; prevSnap = run.snaps[k - 1] || null; label = `after step ${k + 1}`; }
      else { snap = run.snaps[k - 1] || null; label = `just before step ${k + 1}`; }
    }
    const block = QM.engineInternals.blockInfo(S.plan);
    const rows = L.holders.map((id) => {
      if (snap) return { row: snap.rows.find((r) => r.id === id), prev: prevSnap ? prevSnap.rows.find((r) => r.id === id) : null };
      return { row: { id, status: block && block.visitor === id ? 'absent' : 'empty' }, prev: null };
    });
    let foot;
    if (run) {
      const last = run.error ? run.error.step : S.plan.length - 1;
      const tl = [];
      for (let k = 0; k <= last; k++) {
        const c = ['tl']; if (k === S.view) c.push('cur'); if (run.error && k === run.error.step) c.push('err');
        tl.push(`<button class="${c.join(' ')}" data-act="view" data-i="${k}" aria-label="after step ${k + 1}">${k + 1}</button>`);
      }
      foot = `<div class="timeline"><span class="tl-l">Step:</span>${tl.join('')}</div>`;
    } else foot = '<div class="legend-mini"><span>Submit the plan to watch everyone’s permissions change, step by step.</span></div>';
    $('#crew').innerHTML = `
      <div class="panel-h"><span class="ph-title">Crew status</span><span class="ph-sub">${label}</span>
        <div class="ph-tools legend-mini"><span><span class="perm R on">R</span>read</span><span><span class="perm W on">W</span>write</span><span><span class="perm O on">O</span>own</span></div></div>
      <div class="crew-grid">${rows.map((x) => crewCard(x.row, x.prev)).join('')}</div>
      <div class="crew-foot">${foot}</div>`;
  }

  // ------------------------------------------------------------ render: quartermaster
  function renderQM() {
    const el = $('#qm');
    const r = S.run;
    let cls = '', body;
    if (S.anim) body = `<p><span class="verdict warn">Checking</span> step ${S.view + 1} of ${S.plan.length}…</p>`;
    else if (!r) {
      body = S.attempts ? '<p>Plan changed. Submit it again when you’re ready.</p>'
        : '<p>Submit your plan when ready. I check every step <em>before</em> anyone moves, and I report the first problem I find.</p>';
    } else if (r.error) {
      const e = r.error;
      cls = 'deny';
      const isGame = e.code === 'GAME';
      const replay = S.level.replay && !isGame && ((S.level.replay === 'realloc' && e.code === 'E0502') || (S.level.replay === 'dangling' && e.code === 'E0597'));
      body = `<p><span class="verdict deny">${isGame ? 'Not possible' : 'Denied'}</span>at step ${e.step + 1}.</p>
        <p>${md(e.game.replace(/^Denied\.\s*/, ''))}</p>
        ${isGame ? '' : `<div class="rustc"><span class="ecode">error[${e.code}]</span>: ${esc(e.rust)}<a href="https://doc.rust-lang.org/error_codes/${e.code}.html" target="_blank" rel="noopener">explain ↗</a></div>`}
        ${replay ? `<div class="qm-actions"><button class="btn sm teal" data-act="replay">What if the Quartermaster weren’t here? ▸</button></div>` : ''}`;
    } else if (!r.complete) {
      const unmet = r.goals.filter((g) => !g.met).map((g) => `<li>${md(g.text)}</li>`).join('');
      body = `<p><span class="verdict warn">Safe, but not done.</span>No rule is broken, but the mission isn’t complete:</p><ul class="unmet-list">${unmet}</ul>`;
    } else {
      body = `<p><span class="verdict ok">Approved.</span>Every step is memory-safe and every objective is met. ${S.level.energy ? `Energy used: ⚡${r.energy}.` : ''}</p>`;
    }
    el.className = 'qm ' + cls;
    el.innerHTML = `<div class="qm-face">${FACE('qmf')}</div><div><div class="qm-name">The Quartermaster</div><div class="qm-msg">${body}</div></div>`;
  }

  // ------------------------------------------------------------ submit & animate
  function submit() {
    if (S.anim) { skipAnim(); return; }
    recompute();
    S.run = S.res;
    S.attempts++;
    const r = S.run;
    if (r.error && r.error.code !== 'GAME') addCode(r.error.code);
    const last = r.error ? r.error.step : S.plan.length - 1;
    if (reduced || last <= 0) { S.view = Math.max(0, last); finish(); return; }
    S.anim = { k: 0, last, timer: null };
    tick();
  }
  function tick() {
    const a = S.anim;
    S.view = a.k;
    renderPlan(); renderCrew(); renderCode(); renderQM();
    if (a.k >= a.last) { a.timer = setTimeout(finish, 260); return; }
    a.k++;
    a.timer = setTimeout(tick, 380);
  }
  function skipAnim() { clearTimeout(S.anim.timer); S.view = S.anim.last; finish(); }
  function finish() {
    S.anim = null;
    renderPlan(); renderCrew(); renderCode(); renderQM(); renderBrief();
    const r = S.run;
    markTabs(r);
    if (r.error) {
      const card = stepsEl.querySelector(`.step[data-i="${r.error.step}"]`);
      if (card) { card.classList.add('shake'); card.scrollIntoView({ block: isPhone() ? 'center' : 'nearest', behavior: reduced ? 'auto' : 'smooth' }); }
      if (navigator.vibrate && isPhone()) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
      return;
    }
    if (!r.complete && isPhone()) $('#qm').scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    if (r.complete) success();
  }
  function success() {
    const id = S.level.id;
    P.stars[id] = Math.max(P.stars[id] || 0, S.run.stars);
    persist();
    renderHead();
    const st = $('#stamp');
    st.innerHTML = '<span>Approved</span>';
    st.hidden = false;
    const token = S.run;
    setTimeout(() => { st.hidden = true; if (S.run === token) openDebrief(); }, reduced ? 300 : 1150);
  }

  // ------------------------------------------------------------ modals
  function openModal(html, cls, noHistory) {
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    modal.className = 'modal ' + (cls || '');
    modal.innerHTML = '<button class="btn ghost icon close" data-m="close" aria-label="Close">✕</button>' + html;
    overlay.hidden = false;
    modal.scrollTop = 0;
    modal.focus({ preventScroll: true });
    if (!modalPushed && !noHistory) { try { history.pushState({ qm: 'modal' }, ''); modalPushed = true; } catch (e) { /* ignore */ } }
  }
  function closeModal(fromPop) {
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    overlay.hidden = true;
    modal.innerHTML = '';
    if (modalPushed) { modalPushed = false; if (fromPop !== true) { ignorePop++; history.back(); } }
  }

  function legendHTML() {
    return `<div class="legend">
      <div><span class="perm R on">R</span><br><strong>Read.</strong> May look at it. Lost while someone else holds edit rights (<code>&amp;mut</code>).</div>
      <div><span class="perm W on">W</span><br><strong>Write.</strong> May change it. Needs <code>let mut</code>, and is lost while anyone else is borrowing it.</div>
      <div><span class="perm O on">O</span><br><strong>Own.</strong> May give it away, or let it leave. Lost while it’s borrowed, and gone for good once handed over.</div>
    </div>`;
  }

  function openTitle(atBoot) {
    const started = Object.keys(P.stars).length > 0;
    openModal(`
      <div class="title-hero">
        <div class="title-emblem">${FACE('qmt')}</div>
        <div class="big">The Quartermaster</div>
        <div class="tag">A game about Rust’s ownership &amp; borrowing</div>
      </div>
      <h3>The ship</h3>
      <p>Every item aboard the <em>Borrowed Time</em> exists exactly once. Before any plan runs, the Quartermaster checks it. A plan that would let two crew fight over an item, use something that’s already gone, or change something while someone else is reading it gets <strong>denied</strong>.</p>
      <p><strong>Your plans are real Rust, and the Quartermaster is the borrow checker.</strong> Every step you write is one line of a Rust program, shown live beside the plan. Open it in the Rust Playground at any time and the real compiler will agree.</p>
      <h3>Permissions</h3>
      ${legendHTML()}
      <div class="actions">
        <button class="btn ghost" data-m="help">How to play</button>
        <button class="btn" data-m="levels">Choose a level</button>
        <button class="btn primary" data-m="close">${started ? `Continue: level ${S.level.id}` : 'Start level 1'}</button>
      </div>`, '', atBoot === true);
  }

  function openHelp() {
    const rows = [
      ['gives it to', 'let nova = ada;', 'Moves ownership. Copy types (numbers) are duplicated instead.'],
      ['shows it to', 'let nova = &ada;', 'Shared borrow: a read-only view. Many at once.'],
      ['lends it ✎ to', 'let nova = &mut ada;', 'Mutable borrow: edit rights. Exclusive: nobody else may even look.'],
      ['clones it for', 'let nova = ada.clone();', 'A full independent copy. Costs ⚡2 energy.'],
      ['reads it', 'println!("{nova:?}");', 'Needs R.'],
      ['writes / adds…', 'nova.push_str(..)', 'Needs W.'],
      ['✎ writable', 'let mut ada = …;', 'Without it, nothing may change the item.'],
      ['sends it on a mission', 'scout(ada) / survey(&ada)', 'Function calls move or borrow, just like let.'],
    ];
    openModal(`
      <div class="kicker">How to play</div>
      <h2>Get the plan approved</h2>
      <p>Each level gives you a broken flight plan. Edit the steps with the dropdowns, reorder them with ▲▼, add steps from the palette, then <strong>Submit</strong>. The Quartermaster replays the plan step by step. It stops at the first rule that’s broken and tells you why, including the exact <code>rustc</code> error. When the plan is safe <em>and</em> meets every objective, it’s approved.</p>
      <p>After a run, click any step number to see everyone’s permissions at that moment. A borrow stays alive until its <strong>last use</strong>, so watch the badges come back.</p>
      <h3>Verbs and their Rust</h3>
      <table class="help-table">${rows.map((r) => `<tr><td>${esc(r[0])}</td><td><code>${esc(r[1])}</code></td><td>${esc(r[2])}</td></tr>`).join('')}</table>
      <h3>Permissions</h3>
      ${legendHTML()}
      <h3>Where this comes from</h3>
      <p>The R/W/O permission model follows Crichton, Gray &amp; Krishnamurthi, <em>A Grounded Conceptual Model for Ownership Types in Rust</em> (OOPSLA 2023), and the Brown University edition of the Rust Book. Every level was checked against the real Rust compiler.</p>
      <div class="actions"><button class="btn primary" data-m="close">Back to the plan</button></div>`);
  }

  function openLevels() {
    const cards = LEVELS.map((L, k) => `
      <button class="lvl-card ${k === S.li ? 'cur' : ''}" data-m="level" data-k="${k}">
        <span class="n">LEVEL ${L.id}</span><span class="t">${esc(L.title)}</span><span class="c">${esc(L.concept)}</span>
        <span class="stars">${starsHTML(P.stars[L.id] || 0)}</span>
      </button>`).join('');
    const codex = CODEX.map(([c, d]) => `<div class="codex-item ${P.codes.includes(c) ? 'found' : ''}"><code>${c}</code> ${P.codes.includes(c) ? md(d) : '???'}</div>`).join('');
    const total = LEVELS.reduce((a, L) => a + (P.stars[L.id] || 0), 0);
    openModal(`
      <div class="kicker">Mission board · ${total}/${LEVELS.length * 3} ★</div>
      <h2>Choose a level</h2>
      <div class="levels">${cards}</div>
      <h3>Error codex · ${P.codes.filter((c) => CODEX.some((x) => x[0] === c)).length}/${CODEX.length} discovered</h3>
      <p style="font-size:14px">Every denial teaches you a real <code>rustc</code> error. Collect them all by breaking things on purpose.</p>
      <div class="codex">${codex}</div>`, 'wide');
  }

  function openDebrief() {
    const L = S.level, r = S.run, D = L.debrief;
    const next = S.li < LEVELS.length - 1;
    const replay = L.replay ? `<button class="btn teal" data-m="replay">What if the Quartermaster weren’t here?</button>` : '';
    const hit = S.hit.length ? `<div class="codes">Errors you met on the way: ${S.hit.map((c) => `<code>${c}</code>`).join('')}</div>` : '';
    openModal(`
      <div class="kicker">Plan approved · Level ${L.id}</div>
      <h2>${esc(L.title)}</h2>
      <div class="debrief-meta"><span class="debrief-stars">${starsHTML(r.stars)}</span>${L.energy ? `<span>Energy used: ⚡${r.energy}${r.stars < 3 ? ' (there’s a cheaper plan)' : ''}</span>` : ''}</div>
      <div class="rule">${md(D.rule)}</div>
      <p>${md(D.text)}</p>
      ${hit}
      <h3>Your plan, in Rust</h3>
      <pre class="final">${S.code.lines.map((l) => hl(l.text)).join('\n')}</pre>
      <h3>Read more</h3>
      <div class="links">${D.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>
      <div class="actions">
        ${replay}
        <button class="btn ghost" data-m="close">Stay here</button>
        ${next ? `<button class="btn primary" data-m="next">Next: ${esc(LEVELS[S.li + 1].title)} →</button>` : '<button class="btn primary" data-m="finale">Finish</button>'}
      </div>`);
  }

  function openFinale() {
    const total = LEVELS.reduce((a, L) => a + (P.stars[L.id] || 0), 0);
    openModal(`
      <div class="title-hero"><div class="title-emblem">${FACE('qmz')}</div><div class="big">Cleared for launch</div>
      <div class="tag">${total}/${LEVELS.length * 3} ★ · ${P.codes.length} error codes discovered</div></div>
      <p>You’ve now worked through moves, <code>Copy</code>, shared and mutable borrows, last-use lifetimes, functions, clones, scopes and struct fields. Those are the ideas behind almost every borrow-checker error you’ll meet in real Rust.</p>
      <p>Next stop: the Rust Book’s chapters on structs, enums and lifetimes. When the compiler denies you, think of the Quartermaster: who owns it, who’s looking, and who still needs it later?</p>
      <div class="actions"><button class="btn" data-m="levels">Mission board</button><button class="btn primary" data-m="close">Done</button></div>`);
  }

  function openReplay() {
    const kind = S.level.replay;
    if (!kind) return;
    openModal(`<div class="kicker">Replay · undefined behaviour</div><h2>${esc(QM.REPLAYS[kind].title)}</h2><div id="replay-host"></div>
      <div class="actions"><button class="btn primary" data-m="close">Close</button></div>`, 'wide');
    modalCleanup = QM.mountReplay(kind, $('#replay-host'));
  }

  // ------------------------------------------------------------ events
  stepsEl.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset.k;
    if (!k) return;
    const i = +t.dataset.i;
    edit((plan) => {
      const s = plan[i];
      if (k === 'op') plan[i] = convertStep(s, t.value);
      else if (k === 'mut' || k === 'copy') s[k] = t.checked;
      else if (k === 'index') { if (t.value === 'all') delete s.index; else s.index = 0; }
      else if (k === 'from' || k === 'who') { s[k] = t.value; normalize(s); }
      else if (k === 'fn') { s.fn = t.value; if (QM.MISSIONS[s.fn].mode !== 'move') s.copy = false; }
      else s[k] = t.value;
    });
  });

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const op = add.dataset.add;
      const H = S.level.holders;
      const actor = op === 'write' && H[0] === 'ship' ? H[1] : H[0];
      edit((plan) => plan.push(convertStep({ from: actor, who: actor }, op)));
      const last = stepsEl.lastElementChild;
      if (last) last.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) {
      const a = b.dataset.act, i = +b.dataset.i;
      if (a === 'up') edit((p) => { [p[i - 1], p[i]] = [p[i], p[i - 1]]; });
      else if (a === 'down') edit((p) => { [p[i + 1], p[i]] = [p[i], p[i + 1]]; });
      else if (a === 'del') edit((p) => { p.splice(i, 1); });
      else if (a === 'view') {
        if (!S.run || S.anim) return;
        const last = S.run.error ? S.run.error.step : S.plan.length - 1;
        if (i <= last) { S.view = i; renderPlan(); renderCrew(); renderCode(); if (isPhone() && b.classList.contains('step-n')) setView('crew'); }
      } else if (a === 'goplan') setView('plan');
      else if (a === 'hint') { S.hints = Math.min(S.level.hints.length, S.hints + 1); renderBrief(); }
      else if (a === 'replay') openReplay();
      else if (a === 'copy') {
        const done = (ok) => { b.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); };
        try { navigator.clipboard.writeText(S.code.code).then(() => done(true), () => done(false)); } catch (err) { done(false); }
      }
      return;
    }
    const m = e.target.closest('[data-m]');
    if (m) {
      const a = m.dataset.m;
      if (a === 'close') closeModal();
      else if (a === 'help') openHelp();
      else if (a === 'levels') openLevels();
      else if (a === 'level') { closeModal(); loadLevel(+m.dataset.k); }
      else if (a === 'next') { closeModal(); loadLevel(S.li + 1); }
      else if (a === 'replay') openReplay();
      else if (a === 'finale') openFinale();
    }
  });

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  $('#btn-run').addEventListener('click', submit);
  $('#run-status').addEventListener('click', () => $('#qm').scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }));
  document.querySelectorAll('#mobile-nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-reset').addEventListener('click', resetLevel);
  $('#btn-levels').addEventListener('click', openLevels);
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-title').addEventListener('click', () => openTitle());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) { closeModal(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter' && overlay.hidden) { e.preventDefault(); submit(); }
    if (mod && (e.key === 'z' || e.key === 'Z') && overlay.hidden && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
  });

  // brand mark
  $('.brand-mark').innerHTML = FACE('qmb');

  // ------------------------------------------------------------ boot
  loadLevel(P.last || 0);
  if (!P.intro) { P.intro = true; persist(); openTitle(true); }

  // hooks for automated tests
  QM.ui = {
    loadLevel,
    setPlan(plan) { S.plan = clone(plan); afterEdit(); },
    reset: resetLevel,
    submit,
    skip() { if (S.anim) skipAnim(); },
    state: () => S,
  };
})();
