// src/ewr/validateSponsorDat.ts
//
// Option 1: sponsor.dat uses a local validator because it includes u32le,
// which we are not adding to the shared wrestler schema validator.

import schemaJson from "./sponsor_dat_schema.json";

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

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function validateSponsorDatBytes(bytes: Uint8Array): void {
  const schema = schemaJson as unknown as Schema;

  assert(schema?.recordSize === 73, `Schema recordSize must be 73 (got ${schema?.recordSize})`);
  assert(schema?.recordHeader?.marker, "Schema missing recordHeader.marker");
  assert(schema?.recordHeader?.sponsorId, "Schema missing recordHeader.sponsorId");
  assert(Array.isArray(schema.fields), "Schema missing fields array");

  const fileSize = bytes.length;
  assert(fileSize >= schema.recordSize, `File too small: ${fileSize} bytes`);
  assert(fileSize % schema.recordSize === 0, `File size ${fileSize} not multiple of ${schema.recordSize}`);

  const totalRecords = fileSize / schema.recordSize;
  const markerOffset = schema.recordHeader.marker.offset;
  const markerValue = schema.recordHeader.marker.value;

  // Validate each record marker is correct
  for (let i = 0; i < totalRecords; i++) {
    const base = i * schema.recordSize;
    const marker = bytes[base + markerOffset];
    assert(
      marker === markerValue,
      `Invalid marker at record ${i} (abs ${base + markerOffset}). Expected ${markerValue}, got ${marker}`
    );
  }

  // Validate schema offsets are always in-bounds for ANY record
  const checkField = (f: SchemaField) => {
    assert(f.offset >= 0, `Schema field "${f.name}" has negative offset`);
    if (f.type === "u8") {
      assert(f.offset <= schema.recordSize - 1, `Field "${f.name}" u8 out of record bounds`);
    } else if (f.type === "u16le") {
      assert(f.offset <= schema.recordSize - 2, `Field "${f.name}" u16le out of record bounds`);
    } else if (f.type === "u32le") {
      assert(f.offset <= schema.recordSize - 4, `Field "${f.name}" u32le out of record bounds`);
    } else if (f.type === "ascii_fixed") {
      assert(typeof f.length === "number" && f.length > 0, `Field "${f.name}" ascii_fixed missing length`);
      assert(f.offset + f.length <= schema.recordSize, `Field "${f.name}" ascii_fixed out of record bounds`);
    } else {
      throw new Error(`Unsupported field type for "${f.name}"`);
    }
  };

  // Header fields too
  checkField({ name: "__marker", offset: schema.recordHeader.marker.offset, type: "u8" });
  checkField({ name: "__sponsorId", offset: schema.recordHeader.sponsorId.offset, type: "u16le" });

  for (const f of schema.fields) checkField(f);
}
