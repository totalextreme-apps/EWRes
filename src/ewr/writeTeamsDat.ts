import { encodeSingleByteFixed, writeSingleByteFixed } from "./textEncoding";
// src/ewr/writeTeamsDat.ts
//
// Writes teams.dat (59-byte fixed records) from parsed Team objects.
// Unknown bytes are preserved via _raw where possible.

import { TEAMS_LAYOUT, validateTeamsDatBytes } from "./validateTeamsDat";
import type { Team } from "./parseTeamsDat";

function writeU16(dst: Uint8Array, offset: number, v: number) {
  const vv = Math.max(0, Math.min(65535, v | 0));
  dst[offset] = vv & 0xff;
  dst[offset + 1] = (vv >> 8) & 0xff;
}

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) {
  writeSingleByteFixed(dst, offset, value, length);
}

export function writeTeamsDat(teams: Team[], originalBytes?: Uint8Array): Uint8Array {
  // If an original file was provided, validate it so we don't round-trip garbage.
  if (originalBytes) validateTeamsDatBytes(originalBytes);

  const out = new Uint8Array(teams.length * TEAMS_LAYOUT.recordSize);

  for (let i = 0; i < teams.length; i++) {
    const start = i * TEAMS_LAYOUT.recordSize;
    const dst = out.subarray(start, start + TEAMS_LAYOUT.recordSize);
    const t = teams[i];

    // Start from raw bytes if available to preserve unknowns; otherwise zero fill.
    if (t?._raw?.length === TEAMS_LAYOUT.recordSize) {
      dst.set(t._raw);
    } else {
      dst.fill(0);
    }

    dst[TEAMS_LAYOUT.markerOffset] = TEAMS_LAYOUT.markerValue;

    writeAsciiFixed(dst, TEAMS_LAYOUT.teamNameOffset, TEAMS_LAYOUT.teamNameLength, t.teamName);
    writeU16(dst, TEAMS_LAYOUT.partner1IdOffset, t.partner1Id);
    writeU16(dst, TEAMS_LAYOUT.partner2IdOffset, t.partner2Id);
    writeAsciiFixed(dst, TEAMS_LAYOUT.finisherOffset, TEAMS_LAYOUT.finisherLength, t.finisher);
    writeU16(dst, TEAMS_LAYOUT.experienceOffset, Math.max(0, Math.min(100, t.experience | 0)));
    writeU16(dst, TEAMS_LAYOUT.activeFlagOffset, t.active ? 0xffff : 0x0000);
  }

  return out;
}
