/* The Quartermaster — the ten levels. */
(function (root) {
  const QM = (root.QM = root.QM || {});

  // step builders
  const issue = (who, item, mut, extra) => Object.assign({ op: 'issue', who, item, mut: !!mut, lock: true }, extra || {});
  const give = (from, to, extra) => Object.assign({ op: 'give', from, to, mut: false }, extra || {});
  const show = (from, to, extra) => Object.assign({ op: 'show', from, to }, extra || {});
  const lend = (from, to, extra) => Object.assign({ op: 'lend', from, to }, extra || {});
  const clone = (from, to, extra) => Object.assign({ op: 'clone', from, to, mut: false }, extra || {});
  const read = (who) => ({ op: 'read', who });
  const write = (who) => ({ op: 'write', who });
  const mission = (fn, who, extra) => Object.assign({ op: 'mission', fn, who, copy: false }, extra || {});
  const board = (who) => ({ op: 'board', who, lock: true });
  const depart = (who) => ({ op: 'depart', who, lock: true });

  const BOOK = 'https://doc.rust-lang.org/book/';
  const BROWN = 'https://rust-book.cs.brown.edu/';
  const ERR = (c) => ({ label: `rustc --explain ${c}`, url: `https://doc.rust-lang.org/error_codes/${c}.html` });

  const L = [];

  // ------------------------------------------------------------------ 1
  L.push({
    id: 1, title: 'One of a Kind', concept: 'Ownership & moves',
    holders: ['ada', 'nova', 'kai'],
    briefing: 'Every item aboard has exactly **one owner**. When you give an item away, it leaves your hands for good. Nova needs to study the Star Map, then Kai.',
    palette: ['give', 'read'],
    start: [issue('ada', 'map'), give('ada', 'nova'), read('nova'), give('ada', 'kai'), read('kai')],
    goals: [
      { t: 'event', ev: { op: 'read', who: 'nova', item: 'map' }, text: 'Nova reads the Star Map' },
      { t: 'order', seq: [{ op: 'read', who: 'nova', item: 'map' }, { op: 'read', who: 'kai', item: 'map' }], text: 'Then Kai reads it' },
    ],
    hints: ['Look at step 4. Who is holding the map by then?', 'Only the current holder can pass the map on. After step 2 that is Nova, so make step 4 “Nova gives it to Kai”.'],
    debrief: {
      rule: 'Assigning a non-Copy value **moves** it. The old variable is no longer usable.',
      text: '`let nova = ada;` transfers ownership of the `String`. Using `ada` afterwards is error **E0382** (use of moved value). Rust does this so exactly one variable is responsible for freeing the map’s heap memory, which rules out double frees.',
      links: [{ label: 'The Book §4.1: What is ownership?', url: BOOK + 'ch04-01-what-is-ownership.html' }, ERR('E0382')],
    },
    expect: { code: 'E0382', step: 3 },
    solutions: [[issue('ada', 'map'), give('ada', 'nova'), read('nova'), give('nova', 'kai'), read('kai')]],
  });

  // ------------------------------------------------------------------ 2
  L.push({
    id: 2, title: 'Copy That', concept: 'Copy vs. move',
    holders: ['ada', 'nova', 'kai', 'rio'],
    briefing: 'Some things are information, not objects. If Kai tells Nova the docking code, Kai still knows it. The Star Map is an object: hand it over and it’s gone. Both use the same verb, *give*.',
    palette: ['give', 'read'],
    start: [issue('kai', 'code'), issue('ada', 'map'), give('kai', 'nova'), read('nova'), read('kai'), give('ada', 'rio'), read('rio'), read('ada')],
    goals: [
      { t: 'event', ev: { op: 'read', who: 'nova', item: 'code' }, text: 'Nova checks the docking code' },
      { t: 'order', seq: [{ op: 'give', from: 'kai', item: 'code' }, { op: 'read', who: 'kai', item: 'code' }], text: 'Kai checks it after sharing it' },
      { t: 'event', ev: { op: 'read', who: 'rio', item: 'map' }, text: 'Rio reads the Star Map' },
      { t: 'event', ev: { op: 'read', who: 'ada', item: 'map' }, text: 'Ada reads the Star Map' },
    ],
    hints: ['The docking code stays with Kai after he shares it. The map does not stay with Ada.', 'Ada has to read the map *before* she gives it to Rio. Move her read up.'],
    debrief: {
      rule: 'Types that implement `Copy` are duplicated on assignment; everything else is moved.',
      text: '`u32` is `Copy`: `let nova = kai;` copies the number and both stay usable. `String` is not `Copy` because it owns heap memory. A plain bit-copy would give two variables the same buffer, and both would try to free it.',
      links: [{ label: 'std::marker::Copy', url: 'https://doc.rust-lang.org/std/marker/trait.Copy.html' }, { label: 'The Book §4.1: Stack-only data: Copy', url: BOOK + 'ch04-01-what-is-ownership.html#stack-only-data-copy' }],
    },
    expect: { code: 'E0382', step: 7 },
    solutions: [[issue('kai', 'code'), issue('ada', 'map'), give('kai', 'nova'), read('nova'), read('kai'), read('ada'), give('ada', 'rio'), read('rio')]],
  });

  // ------------------------------------------------------------------ 3
  L.push({
    id: 3, title: 'Just Looking', concept: 'Shared borrows (&)',
    holders: ['ada', 'nova', 'kai', 'rio'],
    briefing: 'Nova, Kai and Rio must study the Star Map **at the same time**, and Ada has to keep it. Giving it away won’t work. Showing it will. Watch Ada’s badges while the others look.',
    palette: ['give', 'show', 'read'],
    start: [issue('ada', 'map', true), give('ada', 'nova'), give('ada', 'kai'), give('ada', 'rio'), read('nova'), read('kai'), read('rio')],
    goals: [
      { t: 'together', who: ['nova', 'kai', 'rio'], item: 'map', text: 'Nova, Kai and Rio study the map at the same time' },
      { t: 'event', ev: { op: 'read', who: 'rio', item: 'map' }, text: 'Rio reads the map' },
      { t: 'owns', who: 'ada', item: 'map', text: 'Ada still owns the map at the end' },
    ],
    hints: ['After Ada gives the map to Nova she has nothing left to give Kai.', 'Switch the three gives to **shows** (`&ada`). Many crew can look at once.'],
    debrief: {
      rule: 'Any number of shared references `&T` may exist at once.',
      text: '`let nova = &ada;` borrows without taking ownership. While a shared borrow is live, Ada loses **W** and **O**: the map can’t change or leave while someone is looking at it. When the last reader is finished, the permissions come back.',
      links: [{ label: 'Brown Rust Book §4.2: References change permissions', url: BROWN + 'ch04-02-references-and-borrowing.html' }],
    },
    expect: { code: 'E0382', step: 2 },
    solutions: [[issue('ada', 'map', true), show('ada', 'nova'), show('ada', 'kai'), show('ada', 'rio'), read('nova'), read('kai'), read('rio')]],
  });

  // ------------------------------------------------------------------ 4
  L.push({
    id: 4, title: 'Ink Rights', concept: 'mut and &mut',
    holders: ['ada', 'nova'],
    briefing: 'Ada and Nova both need to add a waypoint, then Nova reads the finished map. But the map was issued **read-only**, and a view only lets you look.',
    palette: ['show', 'lend', 'write', 'read'],
    start: [issue('ada', 'map', false, { lock: 'partial', editable: ['mut'] }), write('ada'), show('ada', 'nova'), write('nova'), read('nova')],
    goals: [
      { t: 'event', ev: { op: 'write', who: 'ada', item: 'map' }, text: 'Ada adds a waypoint' },
      { t: 'event', ev: { op: 'write', who: 'nova', item: 'map' }, text: 'Nova adds a waypoint' },
      { t: 'order', seq: [{ op: 'write', who: 'nova', item: 'map' }, { op: 'read', who: 'nova', item: 'map' }], text: 'Nova reads the map after her waypoint' },
    ],
    hints: ['Issued items are read-only unless marked ✎ writable, which is `let mut`. Tick it on step 1.', 'A view (`&`) is read-only. To let Nova write, Ada must **lend** the map (`&mut`).'],
    debrief: {
      rule: 'Variables are immutable unless declared `let mut`; writing through a reference needs `&mut`.',
      text: 'Without `mut`, `ada.push_str(..)` fails with **E0596**. The same error code appears when writing through a shared reference (“behind a `&` reference”). `&mut ada` hands out write access, and it requires `ada` itself to be `mut`.',
      links: [{ label: 'The Book §4.2: Mutable references', url: BOOK + 'ch04-02-references-and-borrowing.html#mutable-references' }, ERR('E0596')],
    },
    expect: { code: 'E0596', step: 1 },
    solutions: [[issue('ada', 'map', true, { lock: 'partial', editable: ['mut'] }), write('ada'), lend('ada', 'nova'), write('nova'), read('nova')]],
  });

  // ------------------------------------------------------------------ 5
  L.push({
    id: 5, title: 'One Pen at a Time', concept: '&mut is exclusive',
    holders: ['ada', 'nova', 'kai'],
    briefing: 'Nova is writing today’s entry in Ada’s logbook. Kai wants to read the log, but only once Nova’s entry is in. The Quartermaster has opinions about who may look while a pen is out.',
    palette: ['show', 'lend', 'write', 'read'],
    start: [issue('ada', 'log', true), lend('ada', 'nova'), show('ada', 'kai'), write('nova'), read('kai')],
    goals: [
      { t: 'event', ev: { op: 'write', who: 'nova', item: 'log' }, text: 'Nova writes an entry' },
      { t: 'order', seq: [{ op: 'write', who: 'nova', item: 'log' }, { op: 'read', who: 'kai', item: 'log' }], text: 'Kai reads the log after Nova’s entry' },
    ],
    hints: ['While Nova holds the pen (`&mut`), nobody else may even look.', 'A borrow ends at its **last use**. Let Nova finish writing before Kai gets his view.'],
    debrief: {
      rule: 'Pointer Safety Principle: data may be aliased or mutated, but never both at once.',
      text: 'A `&mut` borrow is exclusive. Overlapping it with another borrow is **E0502** or **E0499**. Borrows end at their *last use*, not at the end of the block (non-lexical lifetimes), so reordering is often all a fix needs. Watch Ada’s badges come back after step 3.',
      links: [{ label: 'Brown Rust Book §4.2: Mutable references', url: BROWN + 'ch04-02-references-and-borrowing.html' }, ERR('E0502')],
    },
    expect: { code: 'E0502', step: 2 },
    solutions: [[issue('ada', 'log', true), lend('ada', 'nova'), write('nova'), show('ada', 'kai'), read('kai')]],
  });

  // ------------------------------------------------------------------ 6
  L.push({
    id: 6, title: 'Away Mission', concept: 'Functions & ownership',
    holders: ['ada', 'nova'],
    missions: ['scout', 'scout_and_return', 'survey'], missionType: 'String',
    briefing: 'The Star Map must go out on a mission, and Ada needs it back on the bridge afterwards. There are three ways to arrange it. The cheapest earns ★★★.',
    palette: ['mission', 'clone', 'read'],
    start: [issue('ada', 'map'), mission('scout', 'ada'), read('ada')],
    goals: [
      { t: 'event', ev: { op: 'mission', item: 'map' }, text: 'The map goes on a mission' },
      { t: 'order', seq: [{ op: 'mission', item: 'map' }, { op: 'read', who: 'ada', item: 'map' }], text: 'Ada reads the map after the mission' },
    ],
    energy: { star3: 0, star2: 1 },
    hints: ['A *Scout run* keeps whatever you send it. Is there a mission that only needs to look?', 'A *Survey* borrows the map (`&ada`): no energy, and Ada keeps it. Scout & return costs ⚡1, and a clone costs ⚡2.'],
    debrief: {
      rule: 'Passing a value to a function moves it, exactly like `let`.',
      text: 'To keep using the map you can (a) **borrow** it, `survey(&ada)`, which is the idiomatic fix; (b) have the function **return** it, which is clunky; or (c) **clone** it, which copies the whole thing. Reaching for `.clone()` to silence the borrow checker is a common beginner habit, so it costs energy here.',
      links: [{ label: 'The Book §4.1: Ownership and functions', url: BOOK + 'ch04-01-what-is-ownership.html#ownership-and-functions' }, { label: 'Brown Rust Book §4.3: Fixing ownership errors', url: BROWN + 'ch04-03-fixing-ownership-errors.html' }],
    },
    expect: { code: 'E0382', step: 2 },
    solutions: [
      [issue('ada', 'map'), mission('survey', 'ada'), read('ada')],
      [issue('ada', 'map'), mission('scout_and_return', 'ada'), read('ada')],
      [issue('ada', 'map'), mission('scout', 'ada', { copy: true }), read('ada')],
      [issue('ada', 'map'), clone('ada', 'nova'), mission('scout', 'nova'), read('ada')],
    ],
  });

  // ------------------------------------------------------------------ 7
  L.push({
    id: 7, title: 'The Shifting Hold', concept: 'Borrowing into a Vec',
    holders: ['hold', 'ada'],
    replay: 'realloc',
    briefing: 'Ada is checking Crate A when the dock tries to load Crate B, and the Quartermaster refuses. After you fix it, ask what would have happened without the Quartermaster.',
    palette: ['show', 'write', 'read'],
    start: [issue('hold', 'crates', true), show('hold', 'ada', { index: 0 }), write('hold'), read('ada')],
    goals: [
      { t: 'event', ev: { op: 'write', who: 'hold', item: 'crates' }, text: 'Crate B is loaded into the hold' },
      { t: 'event', ev: { op: 'read', who: 'ada', item: 'crates' }, text: 'Ada checks Crate A' },
    ],
    hints: ['Ada’s view of Crate A is still in use when the dock loads Crate B.', 'Let Ada finish checking before loading, or load first and look afterwards.'],
    debrief: {
      rule: 'A reference into a collection borrows the whole collection.',
      text: '`&hold[0]` borrows all of `hold`, because `push` may **reallocate**: when the Vec is full it moves every element to a bigger buffer and frees the old one. Ada’s reference would then point into freed memory (use-after-free). **E0502** prevents that.',
      links: [{ label: 'Brown Rust Book §4.3: Aliasing and mutating a data structure', url: BROWN + 'ch04-03-fixing-ownership-errors.html' }, ERR('E0502')],
    },
    expect: { code: 'E0502', step: 2 },
    solutions: [
      [issue('hold', 'crates', true), show('hold', 'ada', { index: 0 }), read('ada'), write('hold')],
      [issue('hold', 'crates', true), write('hold'), show('hold', 'ada', { index: 0 }), read('ada')],
    ],
  });

  // ------------------------------------------------------------------ 8
  const fixedAssign = { fixed: ['from', 'to'], ops: ['show', 'give'] };
  L.push({
    id: 8, title: 'Ghost Signal', concept: 'Lifetimes & scope',
    holders: ['vega', 'ada', 'nova'],
    replay: 'dangling',
    briefing: 'Vega, a visiting courier, brings the Nebula Chart aboard for a short stay. Nova reads it while Vega is here. Ada needs it **after Vega has left**. You can reorder steps and switch *shows* and *gives*.',
    palette: ['read'],
    start: [board('vega'), issue('vega', 'chart'), show('vega', 'nova', fixedAssign), read('nova'), show('vega', 'ada', fixedAssign), depart('vega'), read('ada')],
    goals: [
      { t: 'event', ev: { op: 'read', who: 'nova', item: 'chart' }, text: 'Nova reads the chart' },
      { t: 'order', seq: [{ op: 'depart', who: 'vega' }, { op: 'read', who: 'ada', item: 'chart' }], text: 'Ada reads it after Vega departs' },
    ],
    hints: ['When Vega departs, everything Vega still owns leaves too. A view of it would point at nothing.', 'Have Vega **give** the chart to Ada before leaving, once Nova is done looking.'],
    debrief: {
      rule: 'A reference must never outlive the value it points to.',
      text: 'At the end of Vega’s block, `vega` is dropped. Any reference to it still used afterwards would dangle: **E0597**, “does not live long enough”. The fix is to move ownership *out* of the scope instead of borrowing across it.',
      links: [{ label: 'The Book §4.2: Dangling references', url: BOOK + 'ch04-02-references-and-borrowing.html#dangling-references' }, ERR('E0597')],
    },
    expect: { code: 'E0597', step: 5 },
    solutions: [[board('vega'), issue('vega', 'chart'), show('vega', 'nova', fixedAssign), read('nova'), give('vega', 'ada', fixedAssign), depart('vega'), read('ada')]],
  });

  // ------------------------------------------------------------------ 9
  L.push({
    id: 9, title: 'The Cautious Quartermaster', concept: 'Fields & safe-but-rejected',
    holders: ['ship', 'kai', 'rio'],
    briefing: 'Hyperspace jump in 30 seconds. Kai must tune the engine while Rio boosts the shields, **both at once**. They work in different bays, so why does the Quartermaster refuse?',
    palette: ['lend', 'write', 'read'],
    start: [issue('ship', 'ship', true), lend('ship', 'kai', { field: 'engine', via: 'method' }), lend('ship', 'rio', { field: 'shields', via: 'method' }), write('kai'), write('rio')],
    goals: [
      { t: 'together', who: ['kai', 'rio'], item: 'ship', text: 'Kai and Rio work at the same time' },
      { t: 'event', ev: { op: 'write', who: 'kai', item: 'ship', field: 'engine' }, text: 'Kai tunes the engine' },
      { t: 'event', ev: { op: 'write', who: 'rio', item: 'ship', field: 'shields' }, text: 'Rio boosts the shields' },
    ],
    hints: ['Asking the ship’s computer calls `engine_bay(&mut self)`, which locks the **whole** ship. The Quartermaster only reads the method’s signature.', 'Have them walk into the bays directly (`&mut ship.engine`). Then the Quartermaster can see the two fields don’t overlap.'],
    debrief: {
      rule: 'Within one function Rust tracks fields separately; a `&mut self` method borrows everything.',
      text: '`&mut ship.engine` and `&mut ship.shields` can coexist. `ship.engine_bay()` borrows all of `ship`, because the checker only sees the method’s signature (**E0499**). The original plan was *safe*, but the checker couldn’t prove it. The Brown book calls this rejecting a safe program. The fix is to restructure the borrow, or write a method that returns both bays at once.',
      links: [{ label: 'Brown Rust Book §4.3: Fixing a safe program', url: BROWN + 'ch04-03-fixing-ownership-errors.html' }, ERR('E0499')],
    },
    expect: { code: 'E0499', step: 2 },
    solutions: [[issue('ship', 'ship', true), lend('ship', 'kai', { field: 'engine', via: 'direct' }), lend('ship', 'rio', { field: 'shields', via: 'direct' }), write('kai'), write('rio')]],
  });

  // ------------------------------------------------------------------ 10
  L.push({
    id: 10, title: 'The Refit', concept: 'Everything at once',
    holders: ['ada', 'nova', 'kai', 'rio'],
    missions: ['scout', 'chart'], missionType: 'String',
    briefing: 'Final inspection before launch. The intern’s refit plan breaks nearly every rule in the book. Fix it, and keep the energy cost low.',
    palette: ['give', 'show', 'lend', 'clone', 'write', 'read', 'mission'],
    start: [
      issue('ada', 'map', false, { lock: 'partial', editable: ['mut'] }), issue('kai', 'log', true),
      give('ada', 'nova'), mission('chart', 'ada'), show('kai', 'rio'), write('kai'), read('rio'), read('nova'), mission('scout', 'ada'), read('ada'),
    ],
    goals: [
      { t: 'order', seq: [{ op: 'mission', fn: 'chart', item: 'map' }, { op: 'read', who: 'nova', item: 'map' }], text: 'Nova reads the map after it’s been charted' },
      { t: 'order', seq: [{ op: 'write', who: 'kai', item: 'log' }, { op: 'read', who: 'rio', item: 'log' }], text: 'Rio reads the log after Kai’s entry' },
      { t: 'order', seq: [{ op: 'mission', fn: 'scout', item: 'map' }, { op: 'read', who: 'ada', item: 'map' }], text: 'Ada checks the map after the scout launches' },
      { t: 'owns', who: 'ada', item: 'map', text: 'Ada still owns the map at the end' },
    ],
    energy: { star3: 2, star2: 4 },
    hints: ['The Quartermaster reports the first problem only, so fix the plan top to bottom.', 'The scout run takes ownership. Send it a copy (⚡2) so Ada keeps the original.', 'Chart the map *before* showing it to Nova, and let Kai write *before* Rio looks.'],
    debrief: {
      rule: 'Moves, Copy, &, &mut, last-use lifetimes and functions, all in one plan.',
      text: 'The program on the right is real Rust and it compiles. Open it in the Rust Playground and try breaking it on purpose: every error you can make there, the Quartermaster has shown you here.',
      links: [{ label: 'Brown Rust Book: Ownership recap', url: BROWN + 'ch04-05-ownership-recap.html' }],
    },
    expect: { code: 'E0382', step: 3 },
    solutions: [[
      issue('ada', 'map', true, { lock: 'partial', editable: ['mut'] }), issue('kai', 'log', true),
      mission('chart', 'ada'), show('ada', 'nova'), read('nova'), write('kai'), show('kai', 'rio'), read('rio'), mission('scout', 'ada', { copy: true }), read('ada'),
    ]],
  });

  QM.LEVELS = L;
  QM.stepBuilders = { issue, give, show, lend, clone, read, write, mission, board, depart };
})(typeof window !== 'undefined' ? window : globalThis);
