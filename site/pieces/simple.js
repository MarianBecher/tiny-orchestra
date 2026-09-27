// "Frère Jacques" on the flute, over a plucked C in the celli.
// Change anything and press "Play changes" (or Ctrl+Enter).

import { sequence } from 'tiny-orchestra';

export default {
  bpm: 100,
  parts: [
    {
      name: 'Flute',
      instrument: 'flute',
      notes: sequence(`
        C5 D5 E5 C5 | C5 D5 E5 C5 |
        E5 F5 G5:2 | E5:1 F5 G5:2 |
        G5:1/2 A5 G5 F5 E5:1 C5 | G5:1/2 A5 G5 F5 E5:1 C5 |
        C5 G4 C5:2 | C5:1 G4 C5:2
      `),
    },
    {
      name: 'Celli',
      instrument: 'celliPizz',
      velocity: 0.5,
      notes: sequence('C3:4 | C3 | C3 | C3 | C3 | C3 | C3 | C3'),
    },
  ],
};
