// tiny-orchestra - a tiny orchestra for the browser.
//
// A dependency-free sampler on Web Audio plus the pure helpers it is built
// from (sample choice, pitch math, beats -> time), which are exported so they
// can be tested and reused without an AudioContext.

export { Orchestra, type LoadedSample } from './orchestra.ts';
export { INSTRUMENT_NAMES, type InstrumentName } from './instruments.ts';
export { midiToFreq, playbackRate, velocityGain, pickLayer, pickSample, pickVariant, type PitchedSample } from './pitch.ts';
export {
  beatToTime, timeToBeat, scoreLength, flattenScore, collectEvents, wrapPosition,
  type ScoreEvent, type ScoreShape, type FlattenOptions, type Occurrence,
} from './score.ts';
export { tempoMap, repeating, LiveTimeline, type TempoChange, type TempoMap, type Timeline } from './tempo.ts';
export { noteToMidi, midiToNote, toMidi, sequence, type SequenceOptions } from './notes.ts';
export { startScheduler, LOOKAHEAD, LOOKAHEAD_HIDDEN, TICK_MS, type Scheduler, type SchedulerOptions } from './scheduler.ts';
export { detectOnset, decoderShift, MP3_PRIMING } from './onset.ts';
export { makeImpulse, type ImpulseOptions } from './reverb.ts';
export type {
  Manifest, ManifestFormat, ManifestInstrument, ManifestSample,
  Score, Part, ScoreNote,
  Bus, BusOptions, Output, NoteOptions, Voice, PlayOptions, Performance, OrchestraOptions,
} from './types.ts';
