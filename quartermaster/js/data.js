/* The Quartermaster — core definitions: types, items, crew, missions. */
(function (root) {
  const QM = (root.QM = root.QM || {});

  QM.TYPES = {
    String:    { rust: 'String',      copy: false, writable: true },
    VecString: { rust: 'Vec<String>', copy: false, writable: true },
    U32:       { rust: 'u32',         copy: true,  writable: false },
    Ship:      { rust: 'Ship',        copy: false, writable: false, fields: ['engine', 'shields'], fieldType: 'VecString' },
  };

  QM.ITEMS = {
    map:    { name: 'Star Map',     icon: '🗺️', type: 'String',    init: 'Star Map',
              read: 'reads', write: { verb: 'adds a waypoint to', text: ' +waypoint' } },
    log:    { name: 'Logbook',      icon: '📓', type: 'VecString', init: ['Day 1: launch'],
              read: 'reads', write: { verb: 'writes an entry in', text: 'New entry' } },
    code:   { name: 'Docking Code', icon: '🔢', type: 'U32',       init: 4471,
              read: 'checks' },
    chart:  { name: 'Nebula Chart', icon: '🌌', type: 'String',    init: 'Nebula Chart',
              read: 'reads', write: { verb: 'annotates', text: ' +note' } },
    crates: { name: 'Cargo',        icon: '📦', type: 'VecString', init: ['Crate A'],
              read: 'checks', write: { verb: 'loads a new crate into', text: 'Crate B' } },
    ship:   { name: 'Ship systems', icon: '🚀', type: 'Ship',
              read: 'inspects' },
  };

  QM.FIELDS = {
    engine:  { name: 'Engine bay', short: 'engine',  method: 'engine_bay', write: { verb: 'tunes the engine',   text: 'tuned' } },
    shields: { name: 'Shield bay', short: 'shields', method: 'shield_bay', write: { verb: 'boosts the shields', text: 'boosted' } },
  };

  QM.HOLDERS = {
    ada:  { name: 'Ada',        role: 'Navigator',        color: '#3ee6c4' },
    nova: { name: 'Nova',       role: 'Pilot',            color: '#ffb648' },
    kai:  { name: 'Kai',        role: 'Engineer',         color: '#a58bff' },
    rio:  { name: 'Rio',        role: 'Comms officer',    color: '#ff7eb6' },
    vega: { name: 'Vega',       role: 'Visiting courier', color: '#7ee787' },
    ship: { name: 'The Ship',   role: 'hull & systems',   color: '#8fb3ff', glyph: '🚀' },
    hold: { name: 'Cargo Hold', role: 'deck 3',           color: '#e3b778', glyph: '📦' },
  };

  QM.MISSIONS = {
    scout:            { mode: 'move',   name: 'Scout run',      note: 'keeps whatever it carries' },
    scout_and_return: { mode: 'return', name: 'Scout & return', note: 'brings it back (⚡1 fuel)' },
    survey:           { mode: 'ref',    name: 'Survey',         note: 'only needs to look' },
    chart:            { mode: 'mut',    name: 'Charting run',   note: 'adds routes to it' },
  };

  QM.COST = { clone: 2, returnTrip: 1 };

  QM.holderName = (id) => (QM.HOLDERS[id] ? QM.HOLDERS[id].name : id);
  QM.itemName = (key) => (QM.ITEMS[key] ? QM.ITEMS[key].name : key);
})(typeof window !== 'undefined' ? window : globalThis);
