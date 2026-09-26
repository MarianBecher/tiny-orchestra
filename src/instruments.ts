// The instruments bundled in samples/ - exactly the keys of
// samples/manifest.json, in the same order (a test keeps them in sync).

export const INSTRUMENT_NAMES = [
  'violins', 'violas', 'celli', 'basses', 'violinsPizz', 'celliPizz', 'harp',
  'flute', 'oboe', 'clarinet', 'bassoon',
  'horn', 'trumpet', 'trombone', 'tuba',
  'glockenspiel', 'marimba', 'timpani', 'timpaniRoll',
  'cymbal', 'bassdrum', 'snareRoll', 'snare', 'triangle', 'woodblock',
] as const;

/** Name of a bundled instrument. A typo like `'violin'` is a compile error. */
export type InstrumentName = (typeof INSTRUMENT_NAMES)[number];
