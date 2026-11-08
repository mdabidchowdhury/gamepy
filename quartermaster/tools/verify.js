#!/usr/bin/env node
/* Verifies the Quartermaster against real rustc.
 *   node tools/verify.js [casesPerLevel=150] [seed=1]
 * 1. Every level's start plan must fail with the expected code at the expected step,
 *    and rustc must report that code.
 * 2. Every listed solution must pass the engine (goals met) and compile with rustc.
 * 3. Random mutations of each level's plans: engine verdict and first error code
 *    must agree with rustc.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
for (const f of ['data.js', 'engine.js', 'render.js', 'levels.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), { filename: f });
const QM = globalThis.QM;

const N = parseInt(process.argv[2] || '150', 10);
let seed = parseInt(process.argv[3] || '1', 10);
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rand() * a.length)];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
let fileNo = 0;

function rustc(code) {
  const f = path.join(TMP, `c${fileNo++}.rs`);
  fs.writeFileSync(f, code);
  return new Promise((resolve) => {
    execFile('rustc', ['--edition', '2021', '--crate-type', 'bin', '--emit=metadata', '-o', f + '.rmeta', '--error-format=json', f],
      { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
        const errors = [];
        for (const line of stderr.split('\n')) {
          if (!line.trim().startsWith('{')) continue;
          let d; try { d = JSON.parse(line); } catch { continue; }
          if (d.level !== 'error' || !d.code) continue;
          const sp = (d.spans || []).find((s) => s.is_primary) || (d.spans || [])[0];
          errors.push({ code: d.code.code, line: sp ? sp.line_start : 0, msg: d.message });
        }
        errors.sort((a, b) => a.line - b.line);
        resolve({ ok: errors.length === 0 && !err, errors, raw: errors.length ? '' : stderr });
      });
  });
}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let k = 0;
  async function worker() { while (k < tasks.length) { const i = k++; out[i] = await tasks[i](); } }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

const clonePlan = (p) => JSON.parse(JSON.stringify(p));
const isLocked = (s) => s.lock === true;
const headerLen = (plan) => { let h = 0; while (h < plan.length && plan[h].lock === true) h++; return h; };

function newStep(level, op) {
  const H = level.holders;
  const two = () => { const a = pick(H); let b = pick(H); let g = 0; while (b === a && g++ < 10) b = pick(H); return [a, b]; };
  switch (op) {
    case 'give': case 'clone': { const [a, b] = two(); return { op, from: a, to: b, mut: rand() < 0.3 }; }
    case 'show': { const [a, b] = two(); const s = { op, from: a, to: b }; if (H.includes('hold') && rand() < 0.7) s.index = 0; if (H.includes('ship')) s.field = pick(['engine', 'shields']); return s; }
    case 'lend': { const [a, b] = two(); const s = { op, from: a, to: b }; if (H.includes('ship')) { s.field = pick(['engine', 'shields']); s.via = pick(['method', 'direct']); } return s; }
    case 'read': case 'write': return { op, who: pick(H) };
    case 'mission': return { op, fn: pick(level.missions), who: pick(H), copy: rand() < 0.3 };
  }
}

function mutate(level, plan) {
  const p = clonePlan(plan);
  const h = headerLen(p);
  const free = () => p.map((s, i) => i).filter((i) => i >= h && !isLocked(p[i]));
  const kind = pick(['swap', 'swap', 'op', 'holder', 'holder', 'mut', 'add', 'del', 'extra']);
  const fi = free();
  if (kind === 'swap' && fi.length) {
    const i = pick(fi), j = i + (rand() < 0.5 ? -1 : 1);
    if (j >= h && j < p.length) [p[i], p[j]] = [p[j], p[i]];
  } else if (kind === 'op' && fi.length) {
    const i = pick(fi), s = p[i];
    if (s.lock === 'partial') return p;
    const ops = s.ops || level.palette;
    const op = pick(ops);
    if (s.fixed) { p[i] = Object.assign({}, s, { op }); }
    else { const n = newStep(level, op); if (s.from && n.from) n.from = s.from; if (s.who && n.who) n.who = s.who; p[i] = n; }
  } else if (kind === 'holder' && fi.length) {
    const i = pick(fi), s = p[i];
    if (s.lock === 'partial') return p;
    const keys = ['from', 'to', 'who'].filter((k) => s[k] && !(s.fixed || []).includes(k));
    if (keys.length) { const k = pick(keys); s[k] = pick(level.holders); }
  } else if (kind === 'mut') {
    const c = p.map((s, i) => i).filter((i) => (p[i].lock === 'partial' && (p[i].editable || []).includes('mut')) || (!isLocked(p[i]) && (p[i].op === 'give' || p[i].op === 'clone')));
    if (c.length) { const i = pick(c); p[i].mut = !p[i].mut; }
  } else if (kind === 'add') {
    const op = pick(level.palette);
    const at = h + Math.floor(rand() * (p.length - h + 1));
    p.splice(at, 0, newStep(level, op));
  } else if (kind === 'del') {
    const c = fi.filter((i) => p[i].lock !== 'partial' && !p[i].fixed);
    if (c.length) p.splice(pick(c), 1);
  } else if (kind === 'extra' && fi.length) {
    const i = pick(fi), s = p[i];
    if (s.op === 'mission') { if (rand() < 0.5) s.fn = pick(level.missions); else s.copy = !s.copy; }
    if ((s.op === 'lend' || s.op === 'show') && s.field) { if (rand() < 0.5) s.field = pick(['engine', 'shields']); else s.via = s.via === 'method' ? 'direct' : 'method'; }
    if (s.op === 'show' && level.holders.includes('hold')) s.index = s.index == null ? 0 : undefined;
  }
  // no self-assignment
  for (const s of p) if (s.from && s.to && s.from === s.to) return plan;
  return p;
}

function engineVerdict(level, plan) {
  const r = QM.analyze(level, plan);
  if (r.error && r.error.code === 'GAME') return null; // game rules have no rustc counterpart
  return r;
}

(async () => {
  let failures = 0;
  const report = [];
  const fail = (msg, extra) => { failures++; report.push(Object.assign({ msg }, extra || {})); console.log('  ✗ ' + msg); };

  console.log('== canonical plans');
  for (const level of QM.LEVELS) {
    const s = QM.analyze(level, level.start);
    const code = QM.render(level, level.start, s.info).code;
    const rc = await rustc(code);
    const ok1 = s.error && s.error.code === level.expect.code && s.error.step === level.expect.step;
    const ok2 = !rc.ok && rc.errors.some((e) => e.code === level.expect.code);
    console.log(`L${level.id} start: engine ${s.error ? s.error.code + '@' + s.error.step : 'ok'}  rustc ${rc.ok ? 'ok' : rc.errors.map((e) => e.code).join(',')}`);
    if (!ok1) fail(`L${level.id} start: engine gave ${s.error ? s.error.code + '@' + s.error.step : 'ok'}, expected ${level.expect.code}@${level.expect.step}`);
    if (!ok2) fail(`L${level.id} start: rustc gave ${rc.ok ? 'ok' : rc.errors.map((e) => e.code)}`, { code });
    for (const [k, sol] of level.solutions.entries()) {
      const r = QM.analyze(level, sol);
      const c = QM.render(level, sol, r.info).code;
      const rr = await rustc(c);
      console.log(`L${level.id} solution ${k}: engine ${r.ok ? 'ok' : r.error.code} goals ${r.complete ? 'met' : 'UNMET'} stars ${r.stars} energy ${r.energy}  rustc ${rr.ok ? 'ok' : rr.errors.map((e) => e.code).join(',')}`);
      if (!r.ok || !r.complete) fail(`L${level.id} solution ${k}: engine ${r.ok ? 'goals unmet ' + JSON.stringify(r.goals) : r.error.code + ' ' + r.error.game}`);
      if (!rr.ok) fail(`L${level.id} solution ${k}: rustc errors ${JSON.stringify(rr.errors)}`, { code: c });
    }
  }

  console.log(`\n== fuzz (${N} plans per level)`);
  const cases = [];
  for (const level of QM.LEVELS) {
    const seen = new Set();
    const bases = [level.start, ...level.solutions];
    let tries = 0;
    while (cases.filter((c) => c.level === level).length < N && tries++ < N * 40) {
      let p = clonePlan(pick(bases));
      const k = 1 + Math.floor(rand() * 4);
      for (let j = 0; j < k; j++) p = mutate(level, p);
      const key = JSON.stringify(p);
      if (seen.has(key)) continue;
      seen.add(key);
      const r = engineVerdict(level, p);
      if (!r) continue;
      cases.push({ level, plan: p, r, code: QM.render(level, p, r.info).code });
    }
  }
  const results = await pool(cases.map((c) => () => rustc(c.code)), Math.max(2, os.cpus().length));
  const stats = {};
  cases.forEach((c, i) => {
    const rc = results[i];
    const st = (stats[c.level.id] = stats[c.level.id] || { n: 0, ok: 0, err: 0, verdict: 0, code: 0, order: 0 });
    st.n++;
    if (c.r.ok) st.ok++; else st.err++;
    if (c.r.ok !== rc.ok) { st.verdict++; fail(`L${c.level.id} verdict: engine ${c.r.ok ? 'ok' : c.r.error.code + '@' + c.r.error.step} vs rustc ${rc.ok ? 'ok' : JSON.stringify(rc.errors)}`, { plan: c.plan, code: c.code }); return; }
    if (!c.r.ok) {
      const codes = rc.errors.map((e) => e.code);
      if (!codes.includes(c.r.error.code)) { st.code++; fail(`L${c.level.id} code: engine ${c.r.error.code}@${c.r.error.step} vs rustc ${JSON.stringify(rc.errors)}`, { plan: c.plan, code: c.code }); }
      else if (codes[0] !== c.r.error.code) st.order++;
    }
  });
  console.log('level  cases  engine-ok  engine-err  verdict-mismatch  code-mismatch  (first-code differs)');
  for (const [id, st] of Object.entries(stats))
    console.log(`L${id.padEnd(5)} ${String(st.n).padEnd(6)} ${String(st.ok).padEnd(10)} ${String(st.err).padEnd(11)} ${String(st.verdict).padEnd(17)} ${String(st.code).padEnd(14)} ${st.order}`);
  fs.writeFileSync(path.join(__dirname, 'verify-report.json'), JSON.stringify(report, null, 2));
  console.log(failures ? `\n${failures} FAILURE(S) — see tools/verify-report.json` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
