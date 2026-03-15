import { encodeSingleByteFixed, writeSingleByteFixed } from "./textEncoding";
// src/ewr/writeSponsorDat.ts
//
// Writes EWR 4.2 sponsor.dat records using the locked schema.
// Option 1: u32le supported locally; no changes to shared schema tooling.

import schemaJson from "./sponsor_dat_schema.json";
import type { Sponsor } from "./parseSponsorDat";
import { validateSponsorDatBytes } from "./validateSponsorDat";

type FieldType = "u8" | "u16le" | "u32le" | "ascii_fixed";

type SchemaField = {
  name: string;
  offset: number;
  type: FieldType;
  length?: number;
};

type Schema = {
  recordSize: number;
  recordHeader: {
    marker: { offset: number; type: "u8"; value: number };
    sponsorId: { offset: number; type: "u16le" };
  };
  fields: SchemaField[];
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function writeU8(bytes: Uint8Array, abs: number, v: number) {
  bytes[abs] = clampInt(v, 0, 255);
}

function writeU16LE(bytes: Uint8Array, abs: number, v: number) {
  const n = clampInt(v, 0, 65535);
  bytes[abs] = n & 0xff;
  bytes[abs + 1] = (n >> 8) & 0xff;
}

function writeU32LE(bytes: Uint8Array, abs: number, v: number) {
  const n = clampInt(v, 0, 0xffffffff);
  bytes[abs] = n & 0xff;
  bytes[abs + 1] = (n >> 8) & 0xff;
  bytes[abs + 2] = (n >> 16) & 0xff;
  bytes[abs + 3] = (n >> 24) & 0xff;
}

function toAsciiFixedBytes(value: unknown, length: number): Uint8Array {
  return encodeSingleByteFixed(value, length);
}

function validateOutputMarkers(out: Uint8Array, recordSize: number, markerOffset: number, markerValue: number) {
  if (out.length % recordSize !== 0) {
    throw new Error(`Output size ${out.length} not multiple of recordSize ${recordSize}`);
  }
  const total = out.length / recordSize;
  for (let i = 0; i < total; i++) {
    const start = i * recordSize;
    if (out[start + markerOffset] !== markerValue) {
      throw new Error(`Output corruption: marker mismatch at record ${i}`);
    }
  }
}

export function writeSponsorDat(originalBytes: Uint8Array, sponsors: Sponsor[]): Uint8Array {
  const schema = schemaJson as unknown as Schema;

  // Validate schema bounds. The *output* may legitimately have a different
  // record count than the originalBytes (EWR's native editor compacts the file
  // when deleting). We still validate the original bytes for safety if present.
  if (originalBytes?.length) validateSponsorDatBytes(originalBytes);

  const recordSize = schema.recordSize;
  const markerOffset = schema.recordHeader.marker.offset;
  const markerValue = schema.recordHeader.marker.value;

  // Create a new file sized to the current sponsor list.
  // This matches the native editor behavior (deleting a sponsor removes one record).
  const out = new Uint8Array(sponsors.length * recordSize);

  for (let index = 0; index < sponsors.length; index++) {
    const s = sponsors[index] as any;
    const recordStart = index * recordSize;

    // Marker + header id
    out[recordStart + markerOffset] = markerValue;
    writeU16LE(out, recordStart + schema.recordHeader.sponsorId.offset, Number(s.id ?? 0));

    for (const f of schema.fields) {
      // If the field isn't present on the object, write a safe default.
      // (This also ensures reserved fields exist in output.)

      const abs = recordStart + f.offset;

      if (f.type === "u8") {
        writeU8(out, abs, Number(s[f.name] ?? 0));
      } else if (f.type === "u16le") {
        writeU16LE(out, abs, Number(s[f.name] ?? 0));
      } else if (f.type === "u32le") {
        writeU32LE(out, abs, Number(s[f.name] ?? 0));
      } else if (f.type === "ascii_fixed") {
        const len = f.length ?? 0;
        const bytes = toAsciiFixedBytes(s[f.name], len);
        out.set(bytes, abs);
      } else {
        throw new Error(`Unsupported field type "${(f as any).type}"`);
      }
    }
  }

  validateOutputMarkers(out, recordSize, markerOffset, markerValue);
  return out;
}
