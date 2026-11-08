/* The Quartermaster — "what if the Quartermaster weren't here?" replays.
 * Each replay is an SVG whose elements change by frame (data-f on the root);
 * captions explain the undefined behaviour the borrow checker prevented. */
(function (root) {
  const QM = (root.QM = root.QM || {});

  const REALLOC = {
    title: 'Without the Quartermaster: the shifting hold',
    frames: [
      'The hold has room for exactly <b>one</b> crate. Ada takes a view of Crate A: <code>let ada = &amp;hold[0];</code>',
      'The dock loads Crate B, but there’s no room. The Vec allocates a bigger bay somewhere else in memory.',
      'Crate A is moved across and Crate B goes in beside it. <code>hold</code> now points at the new bay. Ada’s view does not.',
      'The old bay is freed and its memory goes back to the allocator, where it can be reused for anything.',
      'Ada reads “her crate” through a view that still points at the old bay. She gets garbage, or the program crashes. This is a <b>use-after-free</b>.',
      'In C or C++ this compiles without a warning. In Rust it’s error <b>E0502</b>, caught before the program ever runs.',
    ],
    svg: `
<svg viewBox="0 0 680 280" class="rp" role="img" aria-label="Vector reallocation leaves a dangling reference">
  <defs>
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="8" height="8" fill="#1c0d15"/><line x1="0" y1="0" x2="0" y2="8" stroke="#ff5a76" stroke-width="2" opacity=".55"/>
    </pattern>
    <marker id="arrA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#3ee6c4"/></marker>
    <marker id="arrR" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff5a76"/></marker>
    <marker id="arrH" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ffb648"/></marker>
  </defs>
  <text x="24" y="24" class="lbl">stack</text>
  <text x="560" y="24" class="lbl">heap</text>
  <line x1="170" y1="20" x2="170" y2="262" stroke="#1f2e4d" stroke-dasharray="4 5"/>

  <rect x="24" y="52" width="120" height="40" rx="6" fill="#16243f" stroke="#2b3f66"/>
  <text x="38" y="77">hold</text>
  <rect x="24" y="190" width="120" height="40" rx="6" fill="#0b1a2c" stroke="#3c6a99" stroke-dasharray="4 3"/>
  <text x="38" y="215">ada: &amp;</text>

  <g class="bayA">
    <rect x="200" y="60" width="150" height="110" rx="8" fill="#0e1a30" stroke="#2b3f66"/>
    <text x="200" y="52" class="lbl">bay A · cap 1</text>
  </g>
  <g class="crateA">
    <rect x="222" y="82" width="106" height="66" rx="6" fill="#3a2a10" stroke="#e3b778"/>
    <text x="242" y="120">Crate A</text>
  </g>
  <g class="freed hide">
    <rect x="200" y="60" width="150" height="110" rx="8" fill="url(#hatch)" stroke="#ff5a76"/>
    <text x="246" y="120" class="big" fill="#ff5a76">FREED</text>
  </g>
  <g class="garbage hide">
    <rect x="222" y="82" width="106" height="66" rx="6" fill="#2a0f18" stroke="#ff5a76"/>
    <text x="236" y="120" fill="#ff8fa3">▓▒░?#%</text>
  </g>

  <g class="bayB hide">
    <rect x="400" y="60" width="256" height="110" rx="8" fill="#0e1a30" stroke="#2b3f66"/>
    <text x="400" y="52" class="lbl">bay B · cap 2</text>
  </g>
  <g class="crateA2 hide">
    <rect x="418" y="82" width="106" height="66" rx="6" fill="#3a2a10" stroke="#e3b778"/>
    <text x="438" y="120">Crate A</text>
  </g>
  <g class="crateB hide">
    <rect x="534" y="82" width="106" height="66" rx="6" fill="#3a2a10" stroke="#e3b778"/>
    <text x="554" y="120">Crate B</text>
  </g>

  <path class="holdA" d="M144 72 C 170 72, 180 70, 200 70" stroke="#ffb648" stroke-width="2.5" fill="none" marker-end="url(#arrH)"/>
  <path class="holdB hide" d="M144 66 C 230 -12, 350 -12, 396 100" stroke="#ffb648" stroke-width="2.5" fill="none" marker-end="url(#arrH)"/>
  <path class="adaArrow" d="M144 210 C 210 210, 270 200, 274 152" stroke="#3ee6c4" stroke-width="2.5" fill="none" marker-end="url(#arrA)"/>

  <g class="boom hide">
    <text x="196" y="250" class="big" fill="#ff5a76">use-after-free</text>
  </g>
  <g class="shield hide">
    <rect x="380" y="214" width="276" height="44" rx="8" fill="#0b2321" stroke="#3ee6c4"/>
    <text x="396" y="242" fill="#3ee6c4">rustc: error[E0502], denied</text>
  </g>
</svg>`,
    apply(svg, f) {
      const show = (sel, on) => svg.querySelector(sel).classList.toggle('hide', !on);
      show('.bayB', f >= 1);
      show('.crateA2', f >= 2); show('.crateB', f >= 2);
      show('.holdA', f < 2); show('.holdB', f >= 2);
      show('.crateA', f < 2);
      show('.freed', f === 3);
      show('.garbage', f >= 4);
      show('.boom', f >= 4);
      show('.shield', f >= 5);
      const a = svg.querySelector('.adaArrow');
      a.setAttribute('stroke', f >= 3 ? '#ff5a76' : '#3ee6c4');
      a.setAttribute('marker-end', f >= 3 ? 'url(#arrR)' : 'url(#arrA)');
    },
  };

  const DANGLING = {
    title: 'Without the Quartermaster: the ghost signal',
    frames: [
      'Vega is docked in bay 3 with the Nebula Chart. Ada gets a view of it: <code>ada = &amp;vega;</code>',
      'Vega’s stay ends (her block closes), and the chart leaves with her.',
      'Ada’s view still points at bay 3, which is now empty. It is a <b>dangling reference</b>.',
      'Something else docks in bay 3. When Ada “reads the chart” she gets whatever is there now.',
      'Rust rejects this as error <b>E0597</b>: <code>vega</code> does not live long enough. The fix is to move the chart out of Vega’s block instead of borrowing it.',
    ],
    svg: `
<svg viewBox="0 0 680 280" class="rp" role="img" aria-label="A reference outlives the value it points to">
  <defs>
    <marker id="arrDR" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff5a76"/></marker>
    <marker id="arrD" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#3ee6c4"/></marker>
  </defs>
  <rect x="250" y="40" width="190" height="130" rx="10" fill="#0e1a30" stroke="#2b3f66" stroke-dasharray="6 5"/>
  <text x="262" y="188" class="lbl">docking bay 3</text>
  <g class="ship">
    <path d="M270 70 L380 70 L420 105 L380 140 L270 140 Z" fill="#12301f" stroke="#7ee787" stroke-width="2"/>
    <text x="284" y="99">Vega</text>
    <rect x="282" y="108" width="98" height="22" rx="4" fill="#1d1336" stroke="#a58bff"/>
    <text x="290" y="124" style="font-size:11.5px">Nebula Chart</text>
  </g>
  <g class="junk hide">
    <rect x="285" y="80" width="120" height="60" rx="6" fill="#2a1a10" stroke="#e3b778"/>
    <text x="303" y="115">ion scrap</text>
  </g>
  <circle cx="110" cy="210" r="22" fill="#3ee6c4"/>
  <text x="98" y="215" style="fill:#08101d;font-weight:700">Ada</text>
  <path class="view" d="M132 202 C 200 190, 270 170, 320 132" stroke="#3ee6c4" stroke-width="2.5" fill="none" stroke-dasharray="6 4" marker-end="url(#arrD)"/>
  <g class="dangle hide"><text x="160" y="260" class="big" fill="#ff5a76">dangling reference</text></g>
  <g class="reads hide">
    <rect x="448" y="190" width="216" height="46" rx="8" fill="#1c0d15" stroke="#ff5a76"/>
    <text x="460" y="218" fill="#ff8fa3">Ada reads: “ion scrap”?!</text>
  </g>
  <g class="shield hide">
    <rect x="460" y="190" width="200" height="46" rx="8" fill="#0b2321" stroke="#3ee6c4"/>
    <text x="474" y="218" fill="#3ee6c4">rustc: E0597, denied</text>
  </g>
</svg>`,
    apply(svg, f) {
      const show = (sel, on) => svg.querySelector(sel).classList.toggle('hide', !on);
      svg.querySelector('.ship').style.transform = f >= 1 ? 'translateX(420px)' : '';
      svg.querySelector('.ship').style.opacity = f >= 1 ? '0' : '1';
      show('.dangle', f >= 2);
      show('.junk', f >= 3);
      show('.reads', f === 3);
      show('.shield', f >= 4);
      const v = svg.querySelector('.view');
      v.setAttribute('stroke', f >= 2 ? '#ff5a76' : '#3ee6c4');
      v.setAttribute('marker-end', f >= 2 ? 'url(#arrDR)' : 'url(#arrD)');
    },
  };

  QM.REPLAYS = { realloc: REALLOC, dangling: DANGLING };

  /** Mount a replay into `host`; returns a cleanup function. */
  QM.mountReplay = function (kind, host) {
    const R = QM.REPLAYS[kind];
    let f = 0, timer = null;
    host.innerHTML = `
      <div class="replay">
        ${R.svg}
        <div class="cap"></div>
        <div class="ctrls">
          <button class="btn sm" data-r="prev">◀ Back</button>
          <button class="btn sm teal" data-r="play">▶ Play</button>
          <button class="btn sm" data-r="next">Next ▶</button>
          <div class="dots">${R.frames.map(() => '<i></i>').join('')}</div>
        </div>
      </div>`;
    const svg = host.querySelector('svg');
    const cap = host.querySelector('.cap');
    const dots = [...host.querySelectorAll('.dots i')];
    const draw = () => {
      R.apply(svg, f);
      cap.innerHTML = R.frames[f];
      dots.forEach((d, k) => d.classList.toggle('on', k <= f));
      host.querySelector('[data-r=prev]').disabled = f === 0;
      host.querySelector('[data-r=next]').disabled = f === R.frames.length - 1;
    };
    const stop = () => { clearInterval(timer); timer = null; host.querySelector('[data-r=play]').textContent = '▶ Play'; };
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      const a = b.dataset.r;
      if (a === 'prev') { stop(); f = Math.max(0, f - 1); }
      if (a === 'next') { stop(); f = Math.min(R.frames.length - 1, f + 1); }
      if (a === 'play') {
        if (timer) { stop(); return; }
        if (f === R.frames.length - 1) f = 0;
        b.textContent = '❚❚ Pause';
        timer = setInterval(() => { if (f < R.frames.length - 1) { f++; draw(); } else stop(); }, 2600);
      }
      draw();
    });
    draw();
    return stop;
  };
})(typeof window !== 'undefined' ? window : globalThis);
