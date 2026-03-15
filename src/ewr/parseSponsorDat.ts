// src/ewr/parseSponsorDat.ts
//
// Parses EWR 4.2 sponsor.dat using a locked schema file.
// Option 1: supports u32le locally (no changes to shared schema tooling).

import schemaJson from "./sponsor_dat_schema.json";
import { validateSponsorDatBytes } from "./validateSponsorDat";

export type Sponsor = {
  index: number;
  id: number;
  [key: string]: any;
};

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

class Bin {
  private view: DataView;
  private bytes: Uint8Array;

  constructor(arrayBuffer: ArrayBuffer) {
    this.view = new DataView(arrayBuffer);
    this.bytes = new Uint8Array(arrayBuffer);
  }

  size(): number {
    return this.bytes.length;
  }

  u8(offset: number): number {
    return this.view.getUint8(offset);
  }

  u16le(offset: number): number {
    return this.view.getUint16(offset, true);
  }

  u32le(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  asciiFixed(offset: number, length: number): string {
    const slice = this.bytes.slice(offset, offset + length);

    let s = "";
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      if (c === 0x00) break;
      s += String.fromCharCode(c);
    }

    return s.replace(/\0/g, "").trim();
  }
}

export function parseSponsorDat(arrayBuffer: ArrayBuffer): Sponsor[] {
  const schema = schemaJson as unknown as Schema;

  // Hard validation of file bytes and schema bounds
  validateSponsorDatBytes(new Uint8Array(arrayBuffer));

  const bin = new Bin(arrayBuffer);

  const recordSize = schema.recordSize;
  const markerOffset = schema.recordHeader.marker.offset;
  const markerValue = schema.recordHeader.marker.value;
  const idOffset = schema.recordHeader.sponsorId.offset;

  const fileSize = bin.size();
  const totalRecords = fileSize / recordSize;

  const sponsors: Sponsor[] = [];

  for (let index = 0; index < totalRecords; index++) {
    const recordStart = index * recordSize;

    const marker = bin.u8(recordStart + markerOffset);
    if (marker !== markerValue) {
      throw new Error(
        `Invalid record marker at index ${index} (offset ${recordStart + markerOffset}). Expected ${markerValue}, got ${marker}.`
      );
    }

    const id = bin.u16le(recordStart + idOffset);
    const s: Sponsor = { index, id };

    for (const f of schema.fields) {
      const abs = recordStart + f.offset;

      if (f.type === "u8") {
        s[f.name] = bin.u8(abs);
      } else if (f.type === "u16le") {
        s[f.name] = bin.u16le(abs);
      } else if (f.type === "u32le") {
        s[f.name] = bin.u32le(abs);
      } else if (f.type === "ascii_fixed") {
        const len = f.length ?? 0;
        s[f.name] = bin.asciiFixed(abs, len);
      } else {
        throw new Error(`Unsupported field type "${(f as any).type}"`);
      }
    }

    // Convenience normalized fields (non-destructive)
    if (typeof s.moralityRaw === "number") s.morality = s.moralityRaw & 0xffff;
    if (typeof s.paymentThousandsRaw === "number") s.paymentDollars = (s.paymentThousandsRaw & 0xffff) * 1000;

    sponsors.push(s);
  }

  return sponsors;
}
