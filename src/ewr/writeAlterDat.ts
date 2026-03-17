import { encodeSingleByteFixed, writeSingleByteFixed } from "./textEncoding";
// src/ewr/writeAlterDat.ts
//
// Writes alter.dat records back to bytes (251 bytes per record).
//
// IMPORTANT: EWR stores 25 visible characters per field by chaining the 25th
// character into the *next field's first byte* inside the SAME record.
// The first byte of field 0 is a non-visible prefix byte (commonly '4') and
// is NOT part of the visible string. The last field's 25th character is stored
// in the record tail byte (offset 250).

import type { AlterEgoRecord } from "./parseAlterDat";
import { ALTER_LAYOUT } from "./parseAlterDat";

function toLatin1Bytes25(value: string): number[] {
  const s = String(value ?? "");
  const clipped = s.length <= 25 ? s : s.slice(0, 25);
  const out: number[] = [];
  for (let i = 0; i < 25; i++) {
    const ch = i < clipped.length ? clipped.charCodeAt(i) : 0x20;
    out.push(ch & 0xff);
  }
  return out;
}

export function writeAlterDat(records: AlterEgoRecord[]): Uint8Array {
  const bytes = new Uint8Array(records.length * ALTER_LAYOUT.recordSize);

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const base = i * ALTER_LAYOUT.recordSize;

    const visibleFields: string[] = [rec.primaryName, ...(rec.alterEgos ?? [])];
    while (visibleFields.length < 10) visibleFields.push("");

    // Preserve the record's leading prefix byte (not visible in the UI).
    // Default to 0x34 ('4') if missing.
    bytes[base + 0] = ((rec as any)?._headCarry ?? 0x34) & 0xff;

    for (let f = 0; f < 10; f++) {
      const fieldBase = base + f * ALTER_LAYOUT.fieldLen;
      const vis = toLatin1Bytes25(visibleFields[f] ?? "");

      // Write visible chars 1..24 into bytes 1..24 of this field.
      for (let j = 0; j < 24; j++) {
        bytes[fieldBase + 1 + j] = vis[j] & 0xff;
      }

      const carry = vis[24] & 0xff;

      if (f < 9) {
        // Chain into next field's byte 0.
        bytes[base + (f + 1) * ALTER_LAYOUT.fieldLen + 0] = carry;
      } else {
        // Last field chains into tail byte.
        bytes[base + ALTER_LAYOUT.tailOffset] = carry;
      }
    }
  }

  return bytes;
}
