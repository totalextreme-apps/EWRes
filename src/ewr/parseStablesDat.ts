import { decodeSingleByte } from "./textEncoding";
import { STABLES_LAYOUT, validateStablesDatBytes } from "./validateStablesDat";

export type Stable = {
  index: number;
  stableName: string;
  promotionId: number;
  leaderId: number;
  memberIds: number[]; // fixed 20 slots
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

export function parseStablesDat(bytes: Uint8Array): { stables: Stable[] } {
  const { recordCount } = validateStablesDatBytes(bytes);
  const stables: Stable[] = [];

  for (let i = 0; i < recordCount; i++) {
    const start = i * STABLES_LAYOUT.recordSize;
    const rec = bytes.subarray(start, start + STABLES_LAYOUT.recordSize);
    const memberIds: number[] = [];
    for (let slot = 0; slot < STABLES_LAYOUT.memberCount; slot++) {
      memberIds.push(readU16(rec, STABLES_LAYOUT.membersOffset + slot * 2));
    }
    stables.push({
      index: i,
      stableName: readAsciiFixed(rec, STABLES_LAYOUT.nameOffset, STABLES_LAYOUT.nameLength),
      promotionId: readU16(rec, STABLES_LAYOUT.promotionIdOffset),
      leaderId: readU16(rec, STABLES_LAYOUT.leaderIdOffset),
      memberIds,
      _raw: new Uint8Array(rec),
    });
  }

  return { stables };
}
