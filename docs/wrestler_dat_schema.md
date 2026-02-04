# EWR 4.2 wrestler.dat schema (locked)

## Record layout
- Record size: 307 bytes
- Record marker: 0x34 (ASCII '4') at offset +0
- Worker ID: uint16 little-endian at offset +1
- Data start: offset +3

## Names (fixed ASCII, space padded)
- Full Name: offset +3, length 25
- Short Name: offset +28, length 10
- Photo Name: offset +45, length 20

## Core fields (raw storage)
- Gender (u16le): offset +38
  - raw values: 0 = Female, 65535 = Male
- Birth Month (u16le): offset +40
  - note: low byte is 0..12; high byte usually 0
  - low byte mapping: 0 = Unknown, 1..12 = Jan..Dec
- Age (u8): offset +42
- Weight (u8): offset +44
  - stored as u8 (72 = Heavyweight, 76 = Lightweight)
- Wage (thousands) (u16le): offset +80
  - represents $0..$300,000 if 0..300

## Skills (0-100) (u8)
- Brawling: offset +147
- Technical: offset +149
- Speed: offset +151
- Stiffness: offset +153
- Selling: offset +155
- Overness: offset +157
- Charisma: offset +159
- Attitude: offset +163
- Behaviour: offset +255

## Other fields (raw)
- Speaks (u16le): offset +187
  - raw values: 0 = No, 65535 = Yes
- Nationality (u8): offset +275
  - 0 Other, 1 American, 2 Australian, 3 British, 4 Canadian, 5 European, 6 Japanese, 7 Mexican

## Finishers
Primary Finisher Name:
- Offset +189
- ASCII length 25

Primary Finisher Type flags (raw u16le):
- Flag A: offset +214
- Flag B: offset +216
- Flag C: offset +218
- Note: only 3 flags exist in this locked layout; there is no space for a 4th flag without overlapping the secondary finisher name.

Secondary Finisher Name:
- Offset +220
- ASCII length 25

Secondary Finisher Type flags (raw u16le):
- Flag A: offset +245
- Flag B: offset +247
- Flag C: offset +249

## Checkbox flags (raw u16le bool: 0/65535)
- High Spots: offset +161
- Shooting Ability: offset +165
- Trainer: offset +271
- Superstar Look: offset +273
- Menacing: offset +277
- Fonz Factor: offset +279
- Announcer: offset +281
- Booker: offset +283
- Diva: offset +293

## Notes
- All u16le boolean flags use 0x0000 for off and 0xFFFF (65535) for on.
- birthMonthRaw behaves like u16le where only the low byte is used in practice.
- Finisher “types” are represented by multiple u16 flags; compute the UI label based on which flags are set.
