// The showcase site: the piece from piece.js as a score view that follows
// the playback, and its code, which can be edited and played again.
//
// The code runs as a real ES module (a blob URL, with 'tiny-orchestra'
// resolved by the import map in index.html), so what you see is what an app
// would write.

import { Orchestra, encodeWav, midiToNote, nextBarBeat, scoreLength, toMidi } from 'tiny-orchestra';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'tiny-orchestra-site:draft';
const PX_PER_BEAT = 22;
const RULER = 28;

const FAMILY = {
  flute: 'winds', oboe: 'winds', clarinet: 'winds', bassoon: 'winds',
  horn: 'brass', trumpet: 'brass', trombone: 'brass', tuba: 'brass',
  timpani: 'percussion', timpaniRoll: 'percussion', cymbal: 'percussion', bassdrum: 'percussion',
  snare: 'percussion', snareRoll: 'percussion', triangle: 'percussion', woodblock: 'percussion',
  glockenspiel: 'keys', marimba: 'keys', harp: 'keys',
  violins: 'strings', violas: 'strings', celli: 'strings', basses: 'strings', violinsPizz: 'strings', celliPizz: 'strings',
};

const ctx = new AudioContext();
const orch = new Orchestra(ctx, { baseUrl: './samples/', limiter: true });
const bus = orch.bus({ gain: 0.9, reverb: 0.3 });

let original = '';
let score = null;
let perf = null;
let noteEls = [];
const muted = new Set();

// --- Code: evaluate as a module -------------------------------------------

async function compile(code) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const mod = await import(url);
    const s = mod.default;
    if (!s || !Array.isArray(s.parts) || !(s.bpm > 0)) {
      throw new Error('The module has to export a score as its default: export default { bpm, parts: [...] }.');
    }
    return s;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function showError(err) {
  const box = $('error');
  if (!err) { box.hidden = true; return; }
  box.textContent = `This code does not play: ${err instanceof Error ? err.message : String(err)}`;
  box.hidden = false;
}

// --- The score view --------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

function drawScore(s) {
  const length = scoreLength(s);
  const bar = s.beatsPerBar || 4;
  const width = Math.ceil(length * PX_PER_BEAT) + 40;
  const row = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row')) || 44;
  const height = RULER + s.parts.length * row;
  const svg = $('notes');
  svg.replaceChildren();
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // ruler: bar numbers, beat lines, tempo changes
  for (let b = 0; b <= length; b++) {
    const x = b * PX_PER_BEAT;
    const isBar = b % bar === 0;
    el('line', { x1: x, x2: x, y1: isBar ? 14 : RULER - 4, y2: height, class: isBar ? 'ruler-line' : 'beat-line' }, svg);
    if (isBar && b < length) el('text', { x: x + 4, y: 12, class: 'ruler-text' }, svg).textContent = String(b / bar + 1);
  }
  for (const [beat, , ramp] of s.tempo ?? []) {
    if (ramp) el('text', { x: beat * PX_PER_BEAT - 4, y: RULER - 8, 'text-anchor': 'end', class: 'tempo-text' }, svg).textContent = 'rit.';
  }

  const names = $('names');
  names.replaceChildren();
  noteEls = [];
  s.parts.forEach((part, i) => {
    const family = FAMILY[part.instrument] ?? 'keys';
    const color = `var(--${family})`;
    const top = RULER + i * row;
    const g = el('g', { style: `--family: ${color}`, 'data-part': i }, svg);
    el('line', { x1: 0, x2: width, y1: top + row, y2: top + row, class: 'row-line' }, g);

    // the dynamics as a faint area behind the notes
    if (part.dynamics?.length) {
      const pts = [...part.dynamics].sort((a, b) => a[0] - b[0]);
      let d = `M0 ${top + row}`;
      let level = pts[0][1];
      d += ` L0 ${top + row - level * (row - 4)}`;
      for (const [beat, l, ramp] of pts) {
        if (!ramp) d += ` L${beat * PX_PER_BEAT} ${top + row - level * (row - 4)}`;
        level = l;
        d += ` L${beat * PX_PER_BEAT} ${top + row - level * (row - 4)}`;
      }
      d += ` L${length * PX_PER_BEAT} ${top + row - level * (row - 4)} L${length * PX_PER_BEAT} ${top + row} Z`;
      el('path', { d, class: 'dynamics' }, g);
    }

    // pitch within the row, from the part's own lowest to highest note
    const pitches = part.notes.map((n) => toMidi(n[1])).filter((m) => m !== null && Number.isFinite(m));
    const lo = Math.min(...pitches), hi = Math.max(...pitches);
    const span = Math.max(1, hi - lo);
    for (const n of part.notes) {
      const [beat, pitch, len = 1] = n;
      const m = toMidi(pitch);
      const h = m === null ? row - 16 : 4;
      const y = m === null ? top + 8 : top + 6 + (1 - (pitches.length > 1 ? (m - lo) / span : 0.5)) * (row - 16);
      const rect = el('rect', {
        x: beat * PX_PER_BEAT + 1, y, width: Math.max(3, len * PX_PER_BEAT - 2), height: h, rx: 2, class: 'note',
      }, g);
      if (m !== null) el('title', {}, rect).textContent = `${part.name ?? part.instrument}: ${midiToNote(m)}`;
      noteEls.push({ rect, start: beat, end: beat + len, on: false });
    }

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'lane-name';
    name.style.setProperty('--family', color);
    name.setAttribute('aria-pressed', String(muted.has(i)));
    name.innerHTML = '<span></span><small></small>';
    name.firstChild.textContent = part.name ?? part.instrument;
    name.lastChild.textContent = part.instrument;
    name.onclick = () => toggleMute(i, name, g);
    names.append(name);
    g.classList.toggle('muted', muted.has(i));
  });
  $('playhead').style.transform = 'translateX(0)';
}

function toggleMute(i, button, group) {
  if (muted.has(i)) muted.delete(i);
  else muted.add(i);
  const on = muted.has(i);
  button.setAttribute('aria-pressed', String(on));
  group.classList.toggle('muted', on);
  perf?.part(i)?.fade(on ? 0 : 1, 0.15);
}

// --- Playback -------------------------------------------------------------

const bpm = () => Number($('tempo').value);

function start(s, options = {}) {
  const p = orch.play(s, { out: bus, bpm: bpm(), loop: $('loop').checked, ...options });
  for (const i of muted) p.part(i)?.set(0);
  p.onEnd = () => { if (perf === p) stopped(); };
  return p;
}

async function play() {
  await ctx.resume();
  perf?.stop(0.1);
  perf = start(score);
  $('play').disabled = true;
  $('stop').disabled = false;
  $('playhead').hidden = false;
  follow = true;
  requestAnimationFrame(frame);
}

function stopped() {
  perf = null;
  $('play').disabled = false;
  $('stop').disabled = true;
  $('playhead').hidden = true;
  for (const n of noteEls) if (n.on) { n.on = false; n.rect.classList.remove('on'); }
}

$('play').onclick = play;
$('stop').onclick = () => {
  perf?.stop(0.6);
  stopped();
};

function setTempo(value) {
  $('tempo').value = String(value);
  $('tempo-value').textContent = $('tempo').value;
}

$('tempo').oninput = () => {
  $('tempo-value').textContent = $('tempo').value;
  perf?.setTempo(bpm());
};

// Keep the playhead in view, unless the reader scrolls away on purpose.
let follow = true;
$('roll').addEventListener('wheel', () => { follow = false; }, { passive: true });
$('roll').addEventListener('pointerdown', () => { follow = false; });

function frame() {
  if (!perf) return;
  const pos = perf.position;
  const x = pos * PX_PER_BEAT;
  $('playhead').style.transform = `translateX(${x}px)`;
  for (const n of noteEls) {
    const on = pos >= n.start && pos < n.end;
    if (on !== n.on) { n.on = on; n.rect.classList.toggle('on', on); }
  }
  const roll = $('roll');
  if (follow && (x < roll.scrollLeft || x > roll.scrollLeft + roll.clientWidth * 0.7)) {
    roll.scrollLeft = Math.max(0, x - roll.clientWidth * 0.25);
  }
  const bar = score.beatsPerBar || 4;
  $('status').textContent = `Bar ${Math.floor(pos / bar) + 1} of ${Math.ceil(scoreLength(score) / bar)}`;
  requestAnimationFrame(frame);
}

// --- Changing the code ----------------------------------------------------

async function runChanges() {
  let next;
  try {
    next = await compile($('source').value);
  } catch (err) {
    showError(err);
    return;
  }
  showError(null);
  await loadFor(next);
  if (next.bpm !== score.bpm) setTempo(next.bpm);
  score = next;
  drawScore(score);
  if (!perf) return;
  // Hand over at the next bar line: the old version fades out there, the
  // new one starts at the same beat.
  const old = perf;
  const beat = nextBarBeat(old.position + 0.1, score.beatsPerBar || 4, scoreLength(score), old.loop);
  const at = old.timeOf(beat);
  old.onEnd = null;
  old.stop(0.08, at);
  perf = start(score, { at, from: old.loop ? beat % scoreLength(score) : beat });
}

$('run').onclick = runChanges;
$('reset').onclick = () => {
  $('source').value = original;
  saveDraft();
  highlight();
  void runChanges();
};

// --- The editor: highlighting, tab, Ctrl+Enter, draft -----------------------

const KEYWORDS = /\b(?:import|from|export|default|const|let|var|return|new|true|false|null|undefined|function|if|else|for|of)\b/;
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b)/g;
const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function highlight() {
  const code = $('source').value;
  let html = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    html += escape(code.slice(last, m.index));
    const [text, comment, string, number, word] = m;
    const cls = comment ? 'comment' : string ? 'string' : number ? 'number' : word && KEYWORDS.test(word) ? 'keyword' : '';
    html += cls ? `<span class="tok-${cls}">${escape(text)}</span>` : escape(text);
    last = m.index + text.length;
  }
  // a trailing newline needs something after it to take up a line
  $('highlight').innerHTML = html + escape(code.slice(last)) + '\n ';
  syncScroll();
}

function syncScroll() {
  $('highlight').scrollTop = $('source').scrollTop;
  $('highlight').scrollLeft = $('source').scrollLeft;
}

let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      const code = $('source').value;
      if (code === original) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, code);
    } catch { /* no storage: the draft is simply not kept */ }
  }, 300);
}

$('source').addEventListener('input', () => { highlight(); saveDraft(); });
$('source').addEventListener('scroll', syncScroll);
$('source').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void runChanges();
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    document.execCommand('insertText', false, '  ');
  }
});

// --- Loading ----------------------------------------------------------------

async function loadFor(s) {
  const names = [...new Set(s.parts.map((p) => p.instrument))];
  if (names.includes('timpani')) names.push('timpaniRoll');
  const wanted = names.filter((n) => !orch.has(n));
  if (!wanted.length) return;
  $('progress').hidden = false;
  await orch.load(wanted, {
    onProgress: (loaded, total) => {
      $('progress').value = loaded / total;
      $('status').textContent = `Loading the instruments… ${Math.round((loaded / total) * 100)} %`;
    },
  });
  $('progress').hidden = true;
}

$('wav').onclick = async () => {
  $('wav').disabled = true;
  const label = $('wav').textContent;
  $('wav').textContent = 'Rendering…';
  try {
    const buffer = await orch.render(score, { bpm: bpm(), tail: 4, bus: { reverb: 0.3 } });
    const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tiny-orchestra.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    showError(err);
  } finally {
    $('wav').textContent = label;
    $('wav').disabled = false;
  }
};

async function init() {
  original = await (await fetch('./piece.js')).text();
  let code = original;
  try { code = localStorage.getItem(DRAFT_KEY) ?? original; } catch { /* no storage */ }
  $('source').value = code;
  highlight();
  try {
    score = await compile(code);
  } catch (err) {
    // a broken draft: show it with the error, play the original
    showError(err);
    score = await compile(original);
  }
  setTempo(score.bpm);
  drawScore(score);
  await loadFor(score);
  for (const id of ['play', 'tempo', 'wav', 'run', 'reset']) $(id).disabled = false;
  $('status').textContent = 'Ready';
}

// For the automated check (scripts/browser-check.ts)
window.__site = { ready: init(), orch, ctx, get perf() { return perf; }, runChanges };
