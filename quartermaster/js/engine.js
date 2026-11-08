/* The Quartermaster — a borrow checker for crew plans.
 *
 * A plan is a list of straight-line statements. The checker models Rust's
 * ownership rules with the permissions model of Crichton, Gray & Krishnamurthi
 * (OOPSLA 2023): every place has R (read), W (write) and O (own) permissions;
 * borrows remove permissions from the owner while they are live, and a borrow
 * is live until the last use of the reference (non-lexical lifetimes).
 *
 * Phases mirror rustc: A = name resolution (E0425), B = types / game rules
 * (E0308, GAME), C = borrow checking (E0381, E0382, E0499, E0502, E0503,
 * E0505, E0596, E0597). Pass 1 resolves names/types and records every use of
 * every loan; pass 2 replays the plan and checks borrows using that liveness.
 */
(function (root) {
  const QM = (root.QM = root.QM || {});
  const nm = (id) => QM.holderName(id);
  const iname = (k) => QM.itemName(k);

  // ---------------------------------------------------------------- helpers
  function blockInfo(plan) {
    let start = -1, end = -1, visitor = null;
    plan.forEach((s, i) => {
      if (s.op === 'board') { start = i; visitor = s.who; }
      if (s.op === 'depart') end = i;
    });
    if (start < 0) return null;
    return { start, end: end < 0 ? plan.length : end, visitor };
  }

  function assignTarget(s) {
    if (s.op === 'issue') return s.who;
    if (s.op === 'give' || s.op === 'show' || s.op === 'lend' || s.op === 'clone') return s.to;
    if (s.op === 'mission' && QM.MISSIONS[s.fn] && QM.MISSIONS[s.fn].mode === 'return') return s.who;
    return null;
  }

  function firstAssignments(plan) {
    const first = {};
    plan.forEach((s, i) => {
      const t = assignTarget(s);
      if (t && first[t] === undefined) first[t] = i;
    });
    return first;
  }

  /** Where each name is declared. Names first assigned inside the visitor's
   *  block are hoisted to `let name;` just before the block opens. */
  function declPositions(plan, block) {
    const first = firstAssignments(plan);
    const decl = {}, hoisted = [];
    for (const [name, i] of Object.entries(first)) {
      if (block && name !== block.visitor && i > block.start && i < block.end) {
        decl[name] = block.start;
        hoisted.push({ name, first: i });
      } else decl[name] = i;
    }
    hoisted.sort((a, b) => a.first - b.first);
    return { decl, hoisted, first };
  }

  function E(code, phase, rust, game, extra) {
    return Object.assign({ code, phase, rust, game, related: [] }, extra || {});
  }
  function gameRule(msg) {
    return E('GAME', 'B', 'game rule', msg);
  }

  function actorOf(s) {
    switch (s.op) {
      case 'give': case 'show': case 'lend': case 'clone': return s.from;
      case 'read': case 'write': case 'mission': case 'depart': case 'issue': case 'board': return s.who;
      default: return null;
    }
  }

  // ---------------------------------------------------------------- state
  function newState() {
    return {
      cur: {}, versions: [], loans: [], values: [],
      uses: new Map(),   // loan id -> [steps]  (first entry = creation)
      events: [], energy: 0, snaps: [], info: [], errors: [],
    };
  }
  function newValue(S, item, type) {
    const v = { id: S.values.length, item, type: type || QM.ITEMS[item].type };
    S.values.push(v);
    return v;
  }
  function bind(S, name, holds, mut, i) {
    const v = { id: S.versions.length, name, holds, mut: !!mut, at: i, moved: false, uses: [] };
    S.versions.push(v);
    S.cur[name] = v;
    return v;
  }
  function newLoan(S, o) {
    const L = Object.assign({ id: S.loans.length }, o);
    S.loans.push(L);
    S.uses.set(L.id, [o.created]);
    return L;
  }
  function useLoan(S, v, i) {
    const L = v.holds.loan;
    S.uses.get(L.id).push(i);
    v.uses.push(i);
  }
  function itemOf(v) {
    if (!v || !v.holds) return null;
    return v.holds.k === 'own' ? v.holds.val.item : v.holds.loan.item;
  }

  // liveness (pass 2 uses the complete picture gathered in pass 1)
  function lastUse(live, L) { const u = live.uses.get(L.id); return u[u.length - 1]; }
  function nextUse(live, L, i) { const u = live.uses.get(L.id); for (const s of u) if (s > i) return s; return null; }
  function liveAt(live, L, i) { return L.created < i && lastUse(live, L) > i; }
  function liveAfter(live, L, i) { return L.created <= i && lastUse(live, L) > i; }
  function vLastUse(live, v) { const u = live.vuses.get(v.id); return u && u.length ? u[u.length - 1] : -1; }

  function overlaps(L, field) { return L.field == null || field == null || L.field === field; }

  /** first live loan on (owner, field) that conflicts with an access of `kind` */
  function conflict(S, live, owner, field, i, kind) {
    for (const L of S.loans) {
      if (L.owner !== owner || !overlaps(L, field) || !liveAt(live, L, i)) continue;
      if (kind === 'read' || kind === 'copy') { if (L.mut) return L; }
      else return L; // 'write' and 'move' conflict with every live loan
    }
    return null;
  }

  // ---------------------------------------------------------------- errors
  function thingOf(L) {
    if (L.field) return 'the ' + QM.FIELDS[L.field].name.toLowerCase();
    if (L.targetField) return 'the whole ship (the computer locked all of it for the ' + QM.FIELDS[L.targetField].name.toLowerCase() + ')';
    if (L.index != null) return 'Crate A';
    return 'the ' + iname(L.item);
  }
  function placeStr(v, field) { return field ? v.name + '.' + field : v.name; }

  function errMoved(v, kind) {
    const what = kind === 'use' ? 'use' : 'borrow';
    const isRef = v.holds.k === 'ref';
    const toHolder = v.movedTo && QM.HOLDERS[v.movedTo];
    const where = !v.movedTo ? '' : toHolder ? ` (to ${nm(v.movedTo)})` : ` (it went on the ${v.movedTo})`;
    const game = isRef
      ? `Denied. ${nm(v.name)} already passed their edit rights on at step ${v.movedAt + 1}${where}.`
      : `Denied. ${nm(v.name)} already handed the ${iname(itemOf(v))} over at step ${v.movedAt + 1}${where}. ${nm(v.name)} doesn't have it any more.`;
    return E('E0382', 'C', `${what} of moved value: \`${v.name}\``, game, { related: [v.movedAt] });
  }
  function errMoveWhileBorrowed(live, v, L, i) {
    const nu = nextUse(live, L, i);
    return E('E0505', 'C', `cannot move out of \`${v.name}\` because it is borrowed`,
      `Denied. ${nm(L.holder)} is still ${L.mut ? 'editing' : 'looking at'} ${thingOf(L)} (step ${nu + 1}), so ${nm(v.name)} can't hand it over yet.`,
      { related: [L.created, nu] });
  }
  function errUseWhileMut(live, v, L, i) {
    const nu = nextUse(live, L, i);
    return E('E0503', 'C', `cannot use \`${v.name}\` because it was mutably borrowed`,
      `Denied. ${nm(L.holder)} has ${thingOf(L)} out for editing until step ${nu + 1}.`,
      { related: [L.created, nu] });
  }
  function errConflict(live, v, field, L, wantMut, i) {
    const nu = nextUse(live, L, i);
    const place = placeStr(v, field);
    let rust, game;
    if (wantMut && L.mut) {
      rust = `cannot borrow \`${place}\` as mutable more than once at a time`;
      game = `Denied. ${nm(L.holder)} already has edit rights on ${thingOf(L)} until step ${nu + 1}. Only one editor at a time.`;
      return E('E0499', 'C', rust, game, { related: [L.created, nu] });
    }
    if (wantMut) {
      rust = `cannot borrow \`${place}\` as mutable because it is also borrowed as immutable`;
      game = `Denied. ${nm(L.holder)} is still looking at ${thingOf(L)} (until step ${nu + 1}). It can't be changed while someone is reading it.`;
    } else {
      rust = `cannot borrow \`${place}\` as immutable because it is also borrowed as mutable`;
      game = `Denied. ${nm(L.holder)} has ${thingOf(L)} out for editing until step ${nu + 1}. Nobody else may look at it until they're done.`;
    }
    return E('E0502', 'C', rust, game, { related: [L.created, nu] });
  }
  function errNotMut(v, field) {
    const rust = field
      ? `cannot borrow \`${v.name}.${field}\` as mutable, as \`${v.name}\` is not declared as mutable`
      : `cannot borrow \`${v.name}\` as mutable, as it is not declared as mutable`;
    return E('E0596', 'C', rust,
      `Denied. ${nm(v.name)} holds the ${iname(itemOf(v))} read-only. Changing it needs a writable binding: tick ✎ writable (\`let mut\`) where ${nm(v.name)} receives it.`,
      { related: [v.at] });
  }
  function errBehindShared(v) {
    const L = v.holds.loan;
    return E('E0596', 'C', `cannot borrow \`*${v.name}\` as mutable, as it is behind a \`&\` reference`,
      `Denied. ${nm(v.name)} only has a view of the ${iname(L.item)}. To let ${nm(v.name)} change it, ${nm(L.owner.name)} must lend it (✎ &mut), not just show it.`,
      { related: [L.created] });
  }
  function errDangling(live, v, L, i) {
    const nu = nextUse(live, L, i);
    return E('E0597', 'C', `\`${v.name}\` does not live long enough`,
      `Denied. ${nm(v.name)} leaves the ship here and takes the ${iname(itemOf(v))} along, but ${nm(L.holder)} still needs to look at it at step ${nu + 1}. That view would point at nothing.`,
      { related: [L.created, nu], replayable: true });
  }

  // ---------------------------------------------------------------- resolve
  function resolve(ctx, S, name, i) {
    const b = ctx.block;
    if (!name || !QM.HOLDERS[name]) return { err: gameRule('Pick a crew member for this step.') };
    if (b && name === b.visitor) {
      const v = S.cur[name];
      if (i <= b.start || i >= b.end || !v || v.dropped) {
        const msg = i >= b.end || (v && v.dropped) ? `${nm(name)} has already left the ship.` : `${nm(name)} isn't aboard yet.`;
        return { err: E('E0425', 'A', `cannot find value \`${name}\` in this scope`, msg) };
      }
      return { v };
    }
    const v = S.cur[name];
    if (!v) {
      const d = ctx.decl.decl[name];
      if (d !== undefined && d < i)
        return { err: E('E0381', 'C', `used binding \`${name}\` isn't initialized`, `${nm(name)} hasn't been handed anything yet at this point.`) };
      return { err: E('E0425', 'A', `cannot find value \`${name}\` in this scope`, `${nm(name)} isn't holding anything at this point.`) };
    }
    return { v };
  }

  function stepInfo(ctx, S, s, i) {
    const a = actorOf(s);
    const info = { actor: a };
    if (s.op === 'issue') { info.kind = 'own'; info.item = s.item; info.type = QM.ITEMS[s.item].type; return info; }
    const v = a ? S.cur[a] : null;
    const b = ctx.block;
    const visible = v && !(b && a === b.visitor && (i <= b.start || i >= b.end || v.dropped));
    if (!visible) return info;
    info.mut = v.mut;
    if (v.holds.k === 'own') { info.kind = 'own'; info.item = v.holds.val.item; info.type = v.holds.val.type; }
    else {
      const L = v.holds.loan;
      info.kind = 'ref'; info.item = L.item; info.type = L.targetType; info.field = L.targetField;
      info.refMut = L.mut; info.owner = L.owner.name; info.index = L.index;
    }
    return info;
  }

  // ---------------------------------------------------------------- exec
  function exec(ctx, S, s, i, pass, live) {
    const chk = pass === 2;
    const ev = (o) => S.events.push(Object.assign({ step: i }, o));

    switch (s.op) {
      case 'issue': {
        const val = newValue(S, s.item);
        bind(S, s.who, { k: 'own', val }, s.mut, i);
        ev({ op: 'issue', who: s.who, item: s.item });
        return null;
      }
      case 'board':
        ev({ op: 'board', who: s.who });
        return null;
      case 'depart': {
        const v = S.cur[s.who];
        if (v && !v.dropped) {
          if (chk && v.holds.k === 'own' && !v.moved) {
            const L = conflict(S, live, v, null, i, 'move');
            if (L) return errDangling(live, v, L, i);
          }
          v.dropped = true;
        }
        ev({ op: 'depart', who: s.who });
        return null;
      }
      case 'give': {
        const r = resolve(ctx, S, s.from, i); if (r.err) return r.err;
        const src = r.v;
        if (!s.to || !QM.HOLDERS[s.to]) return gameRule('Pick who receives it.');
        if (chk && src.moved) return errMoved(src, 'use');
        const item = itemOf(src);
        if (src.holds.k === 'own') {
          const val = src.holds.val;
          if (QM.TYPES[val.type].copy) {
            if (chk) { const L = conflict(S, live, src, null, i, 'copy'); if (L) return errUseWhileMut(live, src, L, i); }
            bind(S, s.to, { k: 'own', val: newValue(S, val.item, val.type) }, s.mut, i);
            ev({ op: 'give', from: s.from, to: s.to, item, copy: true });
          } else {
            if (chk) { const L = conflict(S, live, src, null, i, 'move'); if (L) return errMoveWhileBorrowed(live, src, L, i); }
            src.moved = true; src.movedAt = i; src.movedTo = s.to;
            bind(S, s.to, { k: 'own', val }, s.mut, i);
            ev({ op: 'give', from: s.from, to: s.to, item });
          }
        } else {
          const L = src.holds.loan;
          useLoan(S, src, i);
          if (L.mut) { src.moved = true; src.movedAt = i; src.movedTo = s.to; }
          bind(S, s.to, { k: 'ref', loan: L }, s.mut, i);
          ev({ op: 'give', from: s.from, to: s.to, item, ref: true });
        }
        return null;
      }
      case 'show':
      case 'lend': {
        const r = resolve(ctx, S, s.from, i); if (r.err) return r.err;
        const src = r.v;
        if (!s.to || !QM.HOLDERS[s.to]) return gameRule('Pick who receives it.');
        if (src.holds.k !== 'own')
          return gameRule(`${nm(s.from)} only holds a ${src.holds.loan.mut ? 'pen' : 'view'}, not the item. In this game only an item's owner can ${s.op} it. (Rust can re-borrow through a reference; that's a later chapter.)`);
        const val = src.holds.val, T = QM.TYPES[val.type];
        const mut = s.op === 'lend';
        let field = null, targetField = null, targetType = val.type, index = null;
        if (T.fields) {
          if (!s.field || !T.fields.includes(s.field)) return gameRule('Pick which bay of the ship.');
          targetField = s.field; targetType = T.fieldType;
          field = mut && s.via === 'method' ? null : s.field; // a `&mut self` method borrows the whole ship
        } else if (s.index != null) {
          if (val.type !== 'VecString' || mut) return gameRule('Only a look at a single crate is possible here.');
          index = s.index; targetType = 'String';
        }
        if (chk) {
          if (src.moved) return errMoved(src, 'borrow');
          if (mut && !src.mut) return errNotMut(src, field ? field : null);
          const L = conflict(S, live, src, field, i, mut ? 'write' : 'read');
          if (L) return errConflict(live, src, field, L, mut, i);
        }
        const L = newLoan(S, { owner: src, field, mut, created: i, holder: s.to, targetField, targetType, item: val.item, index });
        bind(S, s.to, { k: 'ref', loan: L }, false, i);
        ev({ op: s.op, from: s.from, to: s.to, item: val.item, field: targetField });
        return null;
      }
      case 'clone': {
        const r = resolve(ctx, S, s.from, i); if (r.err) return r.err;
        const src = r.v;
        if (!s.to || !QM.HOLDERS[s.to]) return gameRule('Pick who receives the clone.');
        const t = src.holds.k === 'own' ? src.holds.val.type : src.holds.loan.targetType;
        if (t === 'Ship') return gameRule("The ship can't be cloned.");
        if (chk && src.moved) return errMoved(src, 'borrow');
        const item = itemOf(src);
        if (src.holds.k === 'own') {
          if (chk) { const L = conflict(S, live, src, null, i, 'read'); if (L) return errConflict(live, src, null, L, false, i); }
        } else useLoan(S, src, i);
        bind(S, s.to, { k: 'own', val: newValue(S, item, t) }, s.mut, i);
        S.energy += QM.COST.clone;
        ev({ op: 'clone', from: s.from, to: s.to, item });
        return null;
      }
      case 'read': {
        const r = resolve(ctx, S, s.who, i); if (r.err) return r.err;
        const v = r.v;
        if (chk && v.moved) return errMoved(v, 'borrow');
        if (v.holds.k === 'own') {
          if (chk) { const L = conflict(S, live, v, null, i, 'read'); if (L) return errConflict(live, v, null, L, false, i); }
          ev({ op: 'read', who: s.who, item: v.holds.val.item });
        } else {
          useLoan(S, v, i);
          ev({ op: 'read', who: s.who, item: v.holds.loan.item, field: v.holds.loan.targetField });
        }
        return null;
      }
      case 'write': {
        const r = resolve(ctx, S, s.who, i); if (r.err) return r.err;
        const v = r.v;
        if (v.holds.k === 'own') {
          const val = v.holds.val;
          if (!QM.TYPES[val.type].writable) return gameRule(`There's nothing to write in the ${iname(val.item)}.`);
          if (chk) {
            if (v.moved) return errMoved(v, 'borrow');
            if (!v.mut) return errNotMut(v, null);
            const L = conflict(S, live, v, null, i, 'write');
            if (L) return errConflict(live, v, null, L, true, i);
          }
          ev({ op: 'write', who: s.who, item: val.item });
        } else {
          const L = v.holds.loan;
          if (!QM.TYPES[L.targetType].writable) return gameRule(`There's nothing to write in the ${iname(L.item)}.`);
          if (chk) {
            if (v.moved) return errMoved(v, 'borrow');
            if (!L.mut) return errBehindShared(v);
          }
          useLoan(S, v, i);
          ev({ op: 'write', who: s.who, item: L.item, field: L.targetField });
        }
        return null;
      }
      case 'mission': {
        const M = QM.MISSIONS[s.fn];
        if (!M) return gameRule('Pick a mission.');
        const r = resolve(ctx, S, s.who, i); if (r.err) return r.err;
        const v = r.v;
        if (v.holds.k !== 'own') return gameRule(`${nm(s.who)} only holds a ${v.holds.loan.mut ? 'pen' : 'view'}. In this game only an item's owner can send it on a mission.`);
        const val = v.holds.val, want = ctx.level.missionType || 'String';
        if (val.type !== want)
          return E('E0308', 'B', `mismatched types: expected \`${QM.TYPES[want].rust}\`, found \`${QM.TYPES[val.type].rust}\``,
            `The ${M.name} is equipped to carry a ${QM.TYPES[want].rust}, not the ${iname(val.item)}.`);
        const copy = M.mode === 'move' && !!s.copy;
        if (chk && v.moved) return errMoved(v, (M.mode === 'move' || M.mode === 'return') && !copy ? 'use' : 'borrow');
        if (copy) {
          if (chk) { const L = conflict(S, live, v, null, i, 'read'); if (L) return errConflict(live, v, null, L, false, i); }
          S.energy += QM.COST.clone;
        } else if (M.mode === 'move' || M.mode === 'return') {
          if (chk) { const L = conflict(S, live, v, null, i, 'move'); if (L) return errMoveWhileBorrowed(live, v, L, i); }
          v.moved = true; v.movedAt = i; v.movedTo = M.name;
          if (M.mode === 'return') { bind(S, s.who, { k: 'own', val }, v.mut, i); S.energy += QM.COST.returnTrip; }
        } else if (M.mode === 'ref') {
          if (chk) { const L = conflict(S, live, v, null, i, 'read'); if (L) return errConflict(live, v, null, L, false, i); }
        } else if (M.mode === 'mut') {
          if (chk) {
            if (!v.mut) return errNotMut(v, null);
            const L = conflict(S, live, v, null, i, 'write');
            if (L) return errConflict(live, v, null, L, true, i);
          }
        }
        ev({ op: 'mission', fn: s.fn, who: s.who, item: val.item, copy });
        return null;
      }
      default:
        return gameRule('Unknown step.');
    }
  }

  // ---------------------------------------------------------------- snapshot
  function ownerPerms(S, live, v, field, i) {
    let any = false, mutL = false;
    for (const L of S.loans) {
      if (L.owner !== v) continue;
      if (field != null && !overlaps(L, field)) continue;
      if (!liveAfter(live, L, i)) continue;
      any = true; if (L.mut) mutL = true;
    }
    return { R: !mutL, W: v.mut && !any, O: !any };
  }

  function snapshot(ctx, S, live, i) {
    const b = ctx.block;
    const rows = ctx.level.holders.map((id) => {
      const v = S.cur[id];
      const row = { id };
      const isVisitor = b && b.visitor === id;
      if (isVisitor && (i < b.start || !v)) row.status = 'absent';
      else if (isVisitor && v.dropped) row.status = 'departed';
      else if (!v) row.status = 'empty';
      else if (v.moved) { row.status = 'moved'; row.movedTo = v.movedTo; row.item = itemOf(v); row.wasRef = v.holds.k === 'ref'; }
      else if (v.holds.k === 'own') {
        const val = v.holds.val;
        row.status = 'own'; row.item = val.item; row.mut = v.mut;
        row.perms = ownerPerms(S, live, v, null, i);
        const T = QM.TYPES[val.type];
        if (T.fields) row.fields = T.fields.map((f) => ({ field: f, perms: ownerPerms(S, live, v, f, i) }));
      } else {
        const L = v.holds.loan;
        row.status = 'ref'; row.refMut = L.mut; row.item = L.item; row.owner = L.owner.name;
        row.field = L.targetField; row.index = L.index;
        row.done = !(vLastUse(live, v) > i);
        row.perms = row.done ? { R: false, W: false, O: false } : { R: true, W: L.mut, O: false };
      }
      return row;
    });
    return { step: i, rows };
  }

  // ---------------------------------------------------------------- goals
  function match(e, pat) {
    for (const k of Object.keys(pat)) {
      const want = pat[k];
      if (Array.isArray(want)) { if (!want.includes(e[k])) return false; }
      else if (e[k] !== want) return false;
    }
    return true;
  }

  function intervals(S, live, who, item, endStep) {
    const out = [];
    for (const v of S.versions) {
      if (v.name !== who) continue;
      if (v.holds.k === 'ref') {
        if (v.holds.loan.item !== item) continue;
        const last = vLastUse(live, v);
        if (last > v.at) out.push([v.at, last]);
      } else if (v.holds.val.item === item) {
        out.push([v.at, v.moved ? v.movedAt : endStep]);
      }
    }
    return out;
  }

  function checkGoal(g, S, live, nSteps) {
    switch (g.t) {
      case 'event': return S.events.some((e) => match(e, g.ev));
      case 'order': {
        let k = 0;
        for (const e of S.events) { if (k < g.seq.length && match(e, g.seq[k])) k++; }
        return k === g.seq.length;
      }
      case 'owns': {
        const v = S.cur[g.who];
        return !!(v && !v.moved && !v.dropped && v.holds.k === 'own' && v.holds.val.item === g.item);
      }
      case 'together': {
        const all = g.who.map((w) => intervals(S, live, w, g.item, nSteps));
        if (all.some((iv) => iv.length === 0)) return false;
        const cands = [].concat(...all.map((iv) => iv.map((x) => x[0])));
        return cands.some((t) => all.every((iv) => iv.some(([a, b]) => a <= t && t <= b)));
      }
      default: return false;
    }
  }

  function starsFor(level, energy) {
    const e = level.energy || { star3: 0, star2: 2 };
    if (energy <= e.star3) return 3;
    if (energy <= e.star2) return 2;
    return 1;
  }

  // ---------------------------------------------------------------- driver
  function run(ctx, pass, live) {
    const S = newState();
    const plan = ctx.plan;
    for (let i = 0; i < plan.length; i++) {
      const s = plan[i];
      if (pass === 1) S.info[i] = stepInfo(ctx, S, s, i);
      const err = exec(ctx, S, s, i, pass, live);
      if (err) {
        err.step = i;
        if (pass === 2) { S.errors.push(err); break; }
        if (err.phase !== 'C') S.errors.push(err); // borrow errors wait for pass 2
        continue;
      }
      if (pass === 2) S.snaps.push(snapshot(ctx, S, live, i));
    }
    return S;
  }

  function analyze(level, plan) {
    const block = blockInfo(plan);
    const ctx = { level, plan, block, decl: declPositions(plan, block) };
    const p1 = run(ctx, 1, null);
    const live = { uses: p1.uses, vuses: new Map(p1.versions.map((v) => [v.id, v.uses])) };
    const pending = level.goals.map((g) => ({ text: g.text, met: null }));
    const early = p1.errors.find((e) => e.phase === 'A') || p1.errors.find((e) => e.phase === 'B');
    if (early) return { ok: false, error: early, info: p1.info, snaps: [], events: [], energy: 0, goals: pending, complete: false, stars: 0 };

    const p2 = run(ctx, 2, live);
    const error = p2.errors[0] || null;
    const res = { ok: !error, error, info: p1.info, snaps: p2.snaps, events: p2.events, energy: p2.energy };
    if (error) { res.goals = pending; res.complete = false; res.stars = 0; return res; }
    res.goals = level.goals.map((g) => ({ text: g.text, met: checkGoal(g, p2, live, plan.length) }));
    res.complete = res.goals.every((g) => g.met);
    res.stars = res.complete ? starsFor(level, p2.energy) : 0;
    return res;
  }

  QM.analyze = analyze;
  QM.engineInternals = { blockInfo, declPositions, actorOf, firstAssignments };
})(typeof window !== 'undefined' ? window : globalThis);
