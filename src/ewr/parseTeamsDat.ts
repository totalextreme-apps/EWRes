import { decodeSingleByte } from "./textEncoding";
// src/ewr/parseTeamsDat.ts
//
// teams.dat is a flat array of 59-byte records (no file header).
// Record layout (0-based offsets):
// 0   u8   marker 0x34 ('4')
// 1   str  team name (25)
// 26  u16  partner1 worker id
// 28  u16  partner2 worker id
// 30  str  finisher (25) or "None"
// 55  u16  experience (0..100)
// 57  u16  active flag (0xFFFF = true, 0x0000 = false)

import { TEAMS_LAYOUT, validateTeamsDatBytes } from "./validateTeamsDat";

export type Team = {
  index: number; // record number (0-based)
  teamName: string;
  partner1Id: number;
  partner2Id: number;
  finisher: string;
  experience: number; // 0..100
  active: boolean;
  _raw: Uint8Array;
};

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readAsciiFixed(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  let s = "";
  for (const b of slice) {
    if (b === 0x00) break;
    s += String.fromCharCode(b);
  }
  return s.trimEnd();
}

export function parseTeamsDat(bytes: Uint8Array): { teams: Team[] } {
  const { recordCount } = validateTeamsDatBytes(bytes);
  const teams: Team[] = [];

  for (let i = 0; i < recordCount; i++) {
    const start = i * TEAMS_LAYOUT.recordSize;
    const rec = bytes.subarray(start, start + TEAMS_LAYOUT.recordSize);
    const rawCopy = new Uint8Array(rec);

    const teamName = readAsciiFixed(rec, TEAMS_LAYOUT.teamNameOffset, TEAMS_LAYOUT.teamNameLength);
    const partner1Id = readU16(rec, TEAMS_LAYOUT.partner1IdOffset);
    const partner2Id = readU16(rec, TEAMS_LAYOUT.partner2IdOffset);
    const finisher = readAsciiFixed(rec, TEAMS_LAYOUT.finisherOffset, TEAMS_LAYOUT.finisherLength);
    const experience = readU16(rec, TEAMS_LAYOUT.experienceOffset);
    const activeFlag = readU16(rec, TEAMS_LAYOUT.activeFlagOffset);

    teams.push({
      index: i,
      teamName,
      partner1Id,
      partner2Id,
      finisher,
      experience,
      active: activeFlag === 0xffff,
      _raw: rawCopy,
    });
  }

  return { teams };
}
