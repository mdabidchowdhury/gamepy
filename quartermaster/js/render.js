/* The Quartermaster — turns a plan into the real Rust program it stands for. */
(function (root) {
  const QM = (root.QM = root.QM || {});
  const IND = '    ';

  function ctor(itemKey) {
    const it = QM.ITEMS[itemKey];
    switch (it.type) {
      case 'String': return `String::from("${it.init}")`;
      case 'VecString': return `vec![${it.init.map((s) => `String::from("${s}")`).join(', ')}]`;
      case 'U32': return String(it.init);
      case 'Ship': return 'Ship { engine: vec![String::from("idle")], shields: vec![String::from("idle")] }';
      default: return '()';
    }
  }

  function missionFn(fn, T) {
    const t = QM.TYPES[T].rust;
    switch (QM.MISSIONS[fn].mode) {
      case 'move': return `fn ${fn}(item: ${t}) { drop(item); }`;
      case 'return': return `fn ${fn}(item: ${t}) -> ${t} { item }`;
      case 'ref': return `fn ${fn}(item: &${t}) { println!("{item:?}"); }`;
      case 'mut': return `fn ${fn}(item: &mut ${t}) { item.push_str(" +route"); }`;
    }
    return '';
  }

  const SHIP_DEF = [
    '#[derive(Debug)]',
    'struct Ship {',
    '    engine: Vec<String>,',
    '    shields: Vec<String>,',
    '}',
    '',
    'impl Ship {',
    '    fn engine_bay(&mut self) -> &mut Vec<String> { &mut self.engine }',
    '    fn shield_bay(&mut self) -> &mut Vec<String> { &mut self.shields }',
    '}',
  ];

  function writeStmt(who, info) {
    const field = info && info.field;
    const type = info && info.type;
    let text = ' +note';
    if (field) text = QM.FIELDS[field].write.text;
    else if (info && info.item && QM.ITEMS[info.item].write) text = QM.ITEMS[info.item].write.text;
    if (type === 'VecString') return `${who}.push(String::from("${text}"));`;
    return `${who}.push_str("${text}");`;
  }

  /** Rust statement for one step. `firstHoisted` = this step assigns a name
   *  that was declared earlier with `let name;`. */
  function stmt(level, s, info, firstHoisted) {
    const bindTo = (name, expr, mut) => (firstHoisted ? `${name} = ${expr};` : `${mut ? 'let mut ' : 'let '}${name} = ${expr};`);
    switch (s.op) {
      case 'issue': {
        const it = QM.ITEMS[s.item];
        if (it.type === 'U32' && !firstHoisted) return `${s.mut ? 'let mut ' : 'let '}${s.who}: u32 = ${ctor(s.item)};`;
        return bindTo(s.who, ctor(s.item), s.mut);
      }
      case 'give': return bindTo(s.to, s.from, s.mut);
      case 'show': {
        let p = s.from;
        if (s.field) p += '.' + s.field;
        else if (s.index != null) p += `[${s.index}]`;
        return bindTo(s.to, '&' + p, false);
      }
      case 'lend': {
        if (s.field && s.via === 'method') return bindTo(s.to, `${s.from}.${QM.FIELDS[s.field].method}()`, false);
        return bindTo(s.to, '&mut ' + s.from + (s.field ? '.' + s.field : ''), false);
      }
      case 'clone': return bindTo(s.to, `${s.from}.clone()`, s.mut);
      case 'read': return `println!("{${s.who}:?}");`;
      case 'write': return writeStmt(s.who, info);
      case 'mission': {
        const M = QM.MISSIONS[s.fn];
        if (!M) return '// (no mission chosen)';
        switch (M.mode) {
          case 'move': return s.copy ? `${s.fn}(${s.who}.clone());` : `${s.fn}(${s.who});`;
          case 'return': return `${info && info.mut ? 'let mut ' : 'let '}${s.who} = ${s.fn}(${s.who});`;
          case 'ref': return `${s.fn}(&${s.who});`;
          case 'mut': return `${s.fn}(&mut ${s.who});`;
        }
        return '';
      }
      default: return '';
    }
  }

  /**
   * render(level, plan, info) -> { lines: [{text, step}], stepLine: [], code }
   * `info` is the per-step actor info from QM.analyze (used for write calls).
   */
  function render(level, plan, info) {
    info = info || [];
    const lines = [];
    const push = (text, step) => lines.push({ text, step: step == null ? null : step });
    const { blockInfo, declPositions } = QM.engineInternals;
    const block = blockInfo(plan);
    const decl = declPositions(plan, block);
    const hoistFirst = new Set(decl.hoisted.map((h) => h.first));

    push('#![allow(unused)]');
    const usesShip = level.holders.includes('ship');
    if (usesShip) { push(''); SHIP_DEF.forEach((l) => push(l)); }
    if (level.missions && level.missions.length) {
      push('');
      level.missions.forEach((m) => push(missionFn(m, level.missionType || 'String')));
    }
    push('');
    push('fn main() {');
    let depth = 1;
    const stepLine = [];
    plan.forEach((s, i) => {
      if (s.op === 'board') {
        decl.hoisted.forEach((h) => {
          const m = plan[h.first].mut ? 'mut ' : '';
          push(IND.repeat(depth) + `let ${m}${h.name};`);
        });
        push(IND.repeat(depth) + `{ // ${QM.holderName(s.who)} boards`, i);
        depth++;
      } else if (s.op === 'depart') {
        depth = Math.max(1, depth - 1);
        push(IND.repeat(depth) + `} // ${QM.holderName(s.who)} departs`, i);
      } else {
        push(IND.repeat(depth) + stmt(level, s, info[i], hoistFirst.has(i)), i);
      }
      stepLine[i] = lines.length - 1;
    });
    push('}');
    return { lines, stepLine, code: lines.map((l) => l.text).join('\n') + '\n' };
  }

  QM.render = render;
  QM.renderStmt = (level, plan, info, i) => {
    const { blockInfo, declPositions } = QM.engineInternals;
    const s = plan[i];
    if (s.op === 'board') return `{ // ${QM.holderName(s.who)} boards`;
    if (s.op === 'depart') return `} // ${QM.holderName(s.who)} departs`;
    const decl = declPositions(plan, blockInfo(plan));
    const hoisted = decl.hoisted.some((h) => h.first === i);
    return stmt(level, s, info && info[i], hoisted);
  };
})(typeof window !== 'undefined' ? window : globalThis);
