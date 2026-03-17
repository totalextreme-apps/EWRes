# EWR 4.2 sponsor.dat schema (locked)

## Record layout
- Record size: 73 bytes
- Record marker: 0x34 (ASCII '4') at offset +0
- Sponsor ID: uint16 little-endian at offset +1
- Data start: offset +3

## Text fields (fixed ASCII, space padded)
- Sponsor Name: offset +3, length 20
- Slogan: offset +23, length 40

## Numeric fields
- Reserved: offset +63, u32le (observed 0)
- Morality: offset +67, u16le (0–100)
- Payment (thousands): offset +69, u16le (0–1000 => $0..$1,000,000)
- Reserved: offset +71, u16le (observed 0)

## Notes
- Preserve reserved fields as-is when writing (copy original bytes, only overwrite known fields).
