// Demo page: every instrument to listen to, plus a short piece.
//
// The AudioContext is created right away (suspended, then) and the samples
// start loading at once - the first click only wakes it up. That also shows
// that loading and scheduling work while the context is suspended.
//
// Served by `npm run demo`, which builds dist/ first.

import { Orchestra } from '../dist/index.js';

const $ = (id) => document.getElementById(id);
const errors = [];
const showError = (msg) => {
  errors.push(String(msg));
  $('errors').textContent = errors.join('\n');
};
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason?.stack || e.reason));

const ctx = new AudioContext();
const master = ctx.createGain();
master.gain.value = 0.8;
master.connect(ctx.destination);
const orch = new Orchestra(ctx, { baseUrl: '../samples/', destination: master });
const music = orch.bus({ gain: 1, reverb: 0.28 });
const fx = orch.bus({ gain: 1, reverb: 0.2 });

const wake = () => (ctx.state === 'suspended' ? ctx.resume() : Promise.resolve());
const vel = () => Number($('vel').value) / 100;

// --- The piece ----------------------------------------------------------------
//
// Eight bars of C - a - F - G: string pad, harp arpeggio, flute melody,
// timpani on the downbeats, a soft cymbal and triangle for colour.

const CHORDS = [
  { root: 48, third: 52, fifth: 55, viola: 64, violins: [67, 72] },  // C
  { root: 45, third: 48, fifth: 52, viola: 64, violins: [69, 72] },  // a
  { root: 41, third: 45, fifth: 48, viola: 65, violins: [69, 72] },  // F
  { root: 43, third: 47, fifth: 50, viola: 62, violins: [67, 71] },  // G
];

/** @returns {import('../dist/index.js').Score} */
function demoScore() {
  const parts = {
    violins: [], violas: [], celli: [], basses: [], harp: [], flute: [], timpani: [], cymbal: [], triangle: [],
  };
  CHORDS.forEach((c, i) => {
    const b = i * 8;
    for (const m of c.violins) parts.violins.push([b, m, 8]);
    parts.violas.push([b, c.viola, 8]);
    parts.celli.push([b, c.root, 8]);
    parts.basses.push([b, c.root - 12, 8]);
    parts.timpani.push([b, c.root, 1, 0.8]);
    // harp: eighths, two octaves up and part of the way back
    const arp = [c.root, c.fifth, c.root + 12, c.third + 12, c.fifth + 12, c.root + 24, c.fifth + 12, c.third + 12];
    for (let bar = 0; bar < 2; bar++) {
      arp.forEach((m, k) => parts.harp.push([b + bar * 4 + k * 0.5, m, 0.5, k === 0 ? 0.75 : 0.55]));
    }
  });
  parts.flute = [
    [0, 76, 2], [2, 79, 1], [3, 76, 1], [4, 74, 3], [7, 72, 1],
    [8, 72, 2], [10, 76, 1], [11, 81, 1], [12, 79, 4],
    [16, 81, 2], [18, 84, 1], [19, 81, 1], [20, 79, 2], [22, 77, 2],
    [24, 74, 2], [26, 79, 1], [27, 83, 1], [28, 81, 2], [30, 79, 2],
  ];
  parts.cymbal.push([0, null, 2, 0.6, 'soft']);
  parts.triangle.push([16, null, 1, 0.5], [24, null, 1, 0.4]);

  const levels = { violins: 0.5, violas: 0.5, celli: 0.55, basses: 0.5, harp: 0.6, flute: 0.7, timpani: 0.6, cymbal: 0.5, triangle: 0.5 };
  const pans = { violins: -0.35, violas: 0.1, celli: 0.3, basses: 0.4, harp: -0.2, flute: 0.15, timpani: 0, cymbal: 0, triangle: 0.2 };
  return {
    bpm: 84,
    beatsPerBar: 4,
    lengthBeats: 32,
    parts: Object.entries(parts).map(([instrument, notes]) => ({
      instrument, notes, velocity: levels[instrument], pan: pans[instrument],
    })),
  };
}

let perf = null;
$('piece').onclick = async () => {
  await wake();
  if (perf) perf.stop(0.3);
  perf = orch.play(demoScore(), { bpm: Number($('bpm').value), loop: $('loop').checked, out: music, at: ctx.currentTime + 0.1 });
  perf.onEnd = () => { perf = null; };
  window.__demo.perf = perf;
};
$('stop').onclick = () => {
  if (perf) perf.stop(0.8);
  perf = null;
};
$('bpm').oninput = () => { $('bpmv').textContent = $('bpm').value; };
$('vel').oninput = () => { $('velv').textContent = vel().toFixed(2); };
$('vol').oninput = () => music.fade(Number($('vol').value) / 100, 0.1);

// Start the swelling cymbal so that its climax lands exactly on a timpani
// stroke - that is what `peak` in the manifest is for.
$('swell').onclick = async () => {
  await wake();
  const s = orch.manifest?.instruments.cymbal?.samples.find((x) => x.variant === 'swell');
  if (!s || s.peak === undefined) return;
  const hit = ctx.currentTime + s.peak + 0.2;
  orch.note({ instrument: 'cymbal', variant: 'swell', at: hit - s.peak, velocity: vel(), out: fx });
  orch.note({ instrument: 'timpani', midi: 43, at: hit, velocity: 0.9, out: fx });
  orch.note({ instrument: 'bassdrum', at: hit, velocity: 0.8, out: fx });
  orch.note({ instrument: 'cymbal', variant: 'crash', at: hit, velocity: 0.7, out: fx });
};

// --- Instruments --------------------------------------------------------------

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

function scale(name, lo, hi) {
  const t0 = ctx.currentTime + 0.05;
  // a major scale in the middle of the range, rounded to a C
  let start = Math.round(((lo + hi) / 2 - 6) / 12) * 12;
  if (start < lo - 2) start += 12;
  if (start + 12 > hi + 4) start -= 12;
  MAJOR.forEach((d, i) => orch.note({ instrument: name, midi: start + d, at: t0 + i * 0.32, duration: 0.3, velocity: vel(), out: fx }));
}

function everySample(name, def) {
  // every sample on its own note - to check whether one stands out
  const t0 = ctx.currentTime + 0.05;
  const seen = new Set();
  let i = 0;
  for (const s of def.samples) {
    if (seen.has(s.midi)) continue;
    seen.add(s.midi);
    orch.note({ instrument: name, midi: s.midi, at: t0 + i++ * 0.45, duration: 0.4, velocity: vel(), out: fx });
  }
}

function buildGrid(manifest) {
  const grid = $('grid');
  for (const [name, def] of Object.entries(manifest.instruments)) {
    const card = document.createElement('div');
    card.className = 'inst';
    card.id = `inst-${name}`;
    const info = def.pitched
      ? `${noteName(def.range[0])}-${noteName(def.range[1])}, ${def.samples.length} samples${def.sustain ? ', sustained' : ''}`
      : `variants: ${def.variants.join(', ')}`;
    const h = document.createElement('h3');
    h.textContent = name;
    const small = document.createElement('small');
    small.textContent = info;
    const btns = document.createElement('div');
    btns.className = 'btns';
    card.append(h, small, btns);
    const add = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = async () => { await wake(); fn(); };
      btns.append(b);
    };
    if (def.pitched) {
      add('scale', () => scale(name, def.range[0], def.range[1]));
      add('all samples', () => everySample(name, def));
      const mid = Math.round((def.range[0] + def.range[1]) / 2);
      if (def.sustain) {
        // longer than any file: the loop has to carry this
        add('hold 6 s', () => orch.note({ instrument: name, midi: mid, duration: 6, velocity: vel(), out: fx }));
        add('chord', () => [0, 4, 7].forEach((d) => orch.note({ instrument: name, midi: mid - 7 + d, duration: 2.5, velocity: vel() * 0.8, out: fx })));
      } else {
        add('single note', () => orch.note({ instrument: name, midi: mid, velocity: vel(), out: fx }));
      }
    } else {
      for (const v of def.variants) {
        add(v, () => orch.note({ instrument: name, variant: v, duration: def.sustain ? 3 : undefined, velocity: vel(), out: fx }));
      }
    }
    grid.append(card);
  }
}

// --- Loading ------------------------------------------------------------------

const t0 = performance.now();
const ready = (async () => {
  await orch.load();
  if (orch.manifest) buildGrid(orch.manifest);
  const missing = orch.instruments.filter((n) => !orch.has(n));
  for (const n of missing) $(`inst-${n}`)?.classList.add('missing');
  $('status').textContent = `${orch.instruments.length - missing.length}/${orch.instruments.length} instruments loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s` +
    (missing.length ? ` - missing: ${missing.join(', ')}` : '') + ` - context: ${ctx.state}`;
  for (const id of ['piece', 'stop', 'swell']) $(id).disabled = false;
  return { loaded: orch.instruments.filter((n) => orch.has(n)), missing };
})();

// For the automated browser check (scripts/browser-check.ts)
window.__demo = { ready, errors, orch, ctx, demoScore, perf: null };

setInterval(() => {
  if (perf) $('status').textContent = `bar ${Math.floor(perf.position / 4) + 1}, beat ${(perf.position % 4 + 1).toFixed(1)} - ${ctx.state}`;
}, 200);
