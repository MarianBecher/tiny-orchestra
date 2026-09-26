# Credits

## Samples

All samples in `samples/` are edited excerpts (trimmed, mono, loudness
matched, with baked-in loops, encoded as MP3) from

**Versilian Studios Chamber Orchestra 2 - Community Edition (VSCO-2 CE)**
by Versilian Studios / Samuel Gossner and contributors

- https://github.com/sgossner/VSCO-2-CE
- https://vis.versilstudios.com/vsco-community.html

VSCO-2 CE is released under CC0 1.0 Universal (public domain dedication). The
edited versions here are released under CC0 1.0 as well. Attribution is not
required, but it is a nice thing to do - thank you, Versilian Studios.

### Folder mapping

Which folders of VSCO-2 CE became which instrument (the exact file selection
is in `scripts/instruments.ts`):

| VSCO-2 CE folder | Instrument(s) |
|---|---|
| `Strings/Violin Section/susVib`, `Strings/Violin Section/Pizz` | `violins`, `violinsPizz` |
| `Strings/Viola Section/susvib` | `violas` |
| `Strings/Cello Section/susvib`, `Strings/Cello Section/pizzT` | `celli`, `celliPizz` |
| `Strings/Solo Contrabass/SusNV` | `basses` |
| `Strings/Harp` | `harp` |
| `Woodwinds/Flute/susNV` | `flute` |
| `Woodwinds/Oboe/Sus` | `oboe` |
| `Woodwinds/Clarinet/susLong` | `clarinet` |
| `Woodwinds/Bassoon/sus` | `bassoon` |
| `Brass/F Horn/sus` | `horn` |
| `Brass/Trumpet/sus` | `trumpet` |
| `Brass/Tenor Trombone/sus` | `trombone` |
| `Brass/Tuba/sus` | `tuba` |
| `Percussion/Timpani`, `Percussion/Timpani/Rolls` | `timpani`, `timpaniRoll` |
| `Percussion/Glock` | `glockenspiel` |
| `Percussion/Marimba` | `marimba` |
| `Percussion` (crash and suspended cymbal, bass drum, snare, triangle) | `cymbal`, `bassdrum`, `snare`, `snareRoll`, `triangle` |
| `VSCO 1 Percussion/varWood` | `woodblock` |

## Code

The code in `src/`, `scripts/`, `demo/` and `test/` is released under
CC0 1.0 Universal as well. See `LICENSE`.
