# EWR 4.2 Finisher Type Mapping (3-flag locked layout)

This mapping is derived empirically from `wrestler_toprope.dat` using known wrestlers whose finisher types were set in-game.

## Raw storage
Each finisher has **three** u16le flags:
- Flag A at +214 (primary) / +245 (secondary)
- Flag B at +216 (primary) / +247 (secondary)
- Flag C at +218 (primary) / +249 (secondary)

Each flag is a boolean:
- `0x0000` = off
- `0xFFFF` (65535) = on

## Label mapping (confirmed)
| Label | Flag A | Flag B | Flag C | Example (from data) |
|---|---:|---:|---:|---|
| Impact | 0 | 0 | 0 | Steve Austin (Stunner) |
| Submission | 1 | 0 | 0 | Chris Benoit (Crossface) |
| Top Rope | 0 | 1 | 0 | Jeff Hardy (Swanton Bomb) |
| Ground | 0 | 0 | 1 | Scott Taylor (Hot Drop) |
| Top Rope Standing | 1 | 1 | 0 | Billy Gunn (Legdrop) / Bill Goldberg |
| Corner | 0 | 1 | 1 | Chris Jericho (Lion Tamer) |

### Notes
- There is **no "Other"** type in this layout.
- Secondary finisher types in the sample data only used the single-flag combos (Impact/Submission/Top Rope/Ground), but the mapping applies the same way.
- Any **unexpected combo** (e.g., A+C) should be treated as **Impact** for display and left untouched when writing unless you explicitly decide a label for it.
