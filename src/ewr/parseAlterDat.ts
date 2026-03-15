import { decodeSingleByte } from "./textEncoding";
// src/ewr/parseAlterDat.ts
//
// EWR 4.2 alter.dat
// Record layout (confirmed by file size vs native editor):
// - 10 fixed ASCII fields, 25 bytes each:
//   [0] Primary Name
//   [1..9] Alter Ego slots (9)
// - 1 trailing padding byte (observed as 0x20 in vanilla data)
//
// Total: 251 bytes per record.

export type AlterEgoRecord = {
  index: number; // 0-based record index
  primaryName: string;
  alterEgos: string[]; // length 9
  // Raw chaining byte used by the EWR format.
  // The format stores 25 visible characters per field by chaining the 25th
  // character into the next field's first byte (and the last into the record tail).
  _headCarry: number; // first byte of field 0 (carry-in from previous record)
};

const RECORD_SIZE = 251;
const FIELD_LEN = 25;
const FIELD_COUNT = 10;

function byteToChar(b: number): string {
  return decodeSingleByte(new Uint8Array([b & 0xff]));
}

function readVisibleString25(bytes: Uint8Array, base: number, fieldIndex: number): string {
  // Visible string is 24 bytes from this field (bytes 1..24) + 1 carry byte from next field (or tail).
  const fieldBase = base + fieldIndex * FIELD_LEN;

  let s = "";
  for (let i = 1; i < FIELD_LEN; i++) {
    const b = bytes[fieldBase + i];
    if (b !== 0x00) s += byteToChar(b);
  }

  const carry =
    fieldIndex < FIELD_COUNT - 1 ? bytes[base + (fieldIndex + 1) * FIELD_LEN + 0] : bytes[base + 250];
  if (carry !== 0x00) s += byteToChar(carry);

  // Trim right padding spaces + nulls.
  return s.replace(/\x00/g, "").replace(/\s+$/g, "");
}

export function parseAlterDat(arrayBuffer: ArrayBuffer): AlterEgoRecord[] {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length % RECORD_SIZE !== 0) {
    throw new Error(`alter.dat size ${bytes.length} is not a multiple of ${RECORD_SIZE}.`);
  }

  const count = bytes.length / RECORD_SIZE;
  const out: AlterEgoRecord[] = [];

  for (let i = 0; i < count; i++) {
    const base = i * RECORD_SIZE;

    const fields: string[] = [];
    for (let f = 0; f < FIELD_COUNT; f++) {
      fields.push(readVisibleString25(bytes, base, f));
    }

    const headCarry = bytes[base + 0];

    out.push({
      index: i,
      primaryName: fields[0] ?? "",
      alterEgos: fields.slice(1, 10).map((s) => s ?? ""),
      _headCarry: headCarry,
    });
  }

  return out;
}

export const ALTER_LAYOUT = {
  recordSize: RECORD_SIZE,
  fieldLen: FIELD_LEN,
  fieldCount: FIELD_COUNT,
  primaryOffset: 0,
  primaryLen: FIELD_LEN,
  alterOffset0: FIELD_LEN,
  alterCount: 9,
  tailOffset: 250,
};
