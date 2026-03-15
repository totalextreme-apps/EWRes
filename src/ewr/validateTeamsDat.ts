// src/ewr/validateTeamsDat.ts
//
// Validates EWR 4.2 teams.dat bytes against the locked 59-byte schema.

import schemaJson from "./teams_dat_schema.json";

type FieldType = "u8" | "u16le" | "ascii_fixed";

type SchemaField = {
  name: string;
  offset: number;
  type: FieldType;
  length?: number;
  value?: number;
};

type Schema = {
  recordSize: number;
  recordHeader: {
    marker: { offset: number; type: "u8"; value: number };
  };
  fields: SchemaField[];
};

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export const TEAMS_LAYOUT = {
  recordSize: 59,
  markerOffset: 0,
  markerValue: 52, // '4'
  teamNameOffset: 1,
  teamNameLength: 25,
  partner1IdOffset: 26,
  partner2IdOffset: 28,
  finisherOffset: 30,
  finisherLength: 25,
  experienceOffset: 55,
  activeFlagOffset: 57,
} as const;

export function validateTeamsDatBytes(bytes: Uint8Array): { recordCount: number } {
  const schema = schemaJson as unknown as Schema;

  assert(schema?.recordSize === 59, `Schema recordSize must be 59 (got ${schema?.recordSize})`);
  assert(schema?.recordHeader?.marker, "Schema missing recordHeader.marker");
  assert(Array.isArray(schema.fields), "Schema missing fields array");

  const fileSize = bytes.length;
  assert(fileSize >= schema.recordSize, `File too small: ${fileSize} bytes`);
  assert(fileSize % schema.recordSize === 0, `File size ${fileSize} not multiple of ${schema.recordSize}`);

  const totalRecords = fileSize / schema.recordSize;
  const markerOffset = schema.recordHeader.marker.offset;
  const markerValue = schema.recordHeader.marker.value;

  // Validate marker byte on every record
  for (let i = 0; i < totalRecords; i++) {
    const base = i * schema.recordSize;
    const marker = bytes[base + markerOffset];
    assert(
      marker === markerValue,
      `Invalid marker at record ${i} (abs ${base + markerOffset}). Expected ${markerValue}, got ${marker}`
    );
  }

  const checkField = (f: SchemaField) => {
    assert(f.offset >= 0, `Schema field "${f.name}" has negative offset`);
    if (f.type === "u8") {
      assert(f.offset <= schema.recordSize - 1, `Field "${f.name}" u8 out of record bounds`);
    } else if (f.type === "u16le") {
      assert(f.offset <= schema.recordSize - 2, `Field "${f.name}" u16le out of record bounds`);
    } else if (f.type === "ascii_fixed") {
      assert(typeof f.length === "number" && f.length > 0, `Field "${f.name}" ascii_fixed missing length`);
      assert(f.offset + f.length <= schema.recordSize, `Field "${f.name}" ascii_fixed out of record bounds`);
    } else {
      throw new Error(`Unsupported field type for "${f.name}"`);
    }
  };

  checkField({ name: "__marker", offset: schema.recordHeader.marker.offset, type: "u8" });
  for (const f of schema.fields) checkField(f);

  return { recordCount: totalRecords };
}
