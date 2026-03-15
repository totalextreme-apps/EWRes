// /Users/mac1/Desktop/ewr_editor/src/ewr/parseWrestlerDat.ts

import schemaJson from "./wrestler_dat_schema.json";
import { validateWrestlerDatSchema, type WrestlerDatSchema } from "./schemaValidate";

export type Worker = {
  index: number;
  id: number;
  [key: string]: any;
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

  i16le(offset: number): number {
    return this.view.getInt16(offset, true);
  }

  asciiFixed(offset: number, length: number): string {
    const slice = this.bytes.slice(offset, offset + length);
    const zero = slice.indexOf(0);
    const clean = zero >= 0 ? slice.slice(0, zero) : slice;
    return new TextDecoder("latin1").decode(clean).replace(/\0/g, "").trim();
  }
}

export function parseWrestlerDat(arrayBuffer: ArrayBuffer): Worker[] {
  const schema = schemaJson as unknown as WrestlerDatSchema;

  // ✅ Hard validation: bounds + overlaps + header ranges
  validateWrestlerDatSchema(schema);

  const bin = new Bin(arrayBuffer);

  const recordSize = schema.recordSize;
  const markerOffset = schema.recordHeader.marker.offset;
  const markerValue = schema.recordHeader.marker.value;
  const idOffset = schema.recordHeader.workerId.offset;

  const fileSize = bin.size();
  if (fileSize < recordSize) {
    throw new Error(`File too small: ${fileSize} bytes (expected at least ${recordSize})`);
  }
  if (fileSize % recordSize !== 0) {
    throw new Error(`File size ${fileSize} is not a multiple of recordSize ${recordSize}.`);
  }

  const totalRecords = fileSize / recordSize;
  const workers: Worker[] = [];

  for (let index = 0; index < totalRecords; index++) {
    const recordStart = index * recordSize;

    const marker = bin.u8(recordStart + markerOffset);
    if (marker !== markerValue) {
      throw new Error(
        `Invalid record marker at index ${index} (offset ${recordStart + markerOffset}). Expected ${markerValue}, got ${marker}.`
      );
    }

    const id = bin.u16le(recordStart + idOffset);

    const w: Worker = { index, id };

    for (const f of schema.fields) {
      const abs = recordStart + f.offset;

      if (f.type === "u8") {
        w[f.name] = bin.u8(abs);
      } else if (f.type === "u16le") {
        w[f.name] = bin.u16le(abs);
      } else if (f.type === "ascii_fixed") {
        const len = f.length ?? 0;
        w[f.name] = bin.asciiFixed(abs, len);
      } else {
        throw new Error(`Unsupported field type "${(f as any).type}"`);
      }
    }

    // Convenience normalized fields (non-destructive)
    if (typeof w.birthMonthRaw === "number") w.birthMonth = w.birthMonthRaw & 0xff;
    if (typeof w.weightRaw === "number") w.weight = w.weightRaw & 0xff;
    if (typeof w.ageRaw === "number") w.age = w.ageRaw & 0xff;
    if (typeof w.wageThousandsRaw === "number") w.wageDollars = w.wageThousandsRaw * 1000;

    // Hidden / save-oriented wrestler state fields near the end of the 307-byte record.
    // These are meaningful during save-game editing, but we expose them in all workspaces
    // with a warning so advanced users can edit at their own risk.
    w.conditionRaw = bin.i16le(recordStart + 0xFB);
    w.condition = w.conditionRaw;
    w.contractLength1 = bin.i16le(recordStart + 0x4A);
    w.salary1 = bin.i16le(recordStart + 0x50);
    w.shortTermMorale = bin.i16le(recordStart + 0xFD);
    w.longTermMorale = bin.i16le(recordStart + 0xFF);
    w.employmentStatusCode = bin.asciiFixed(recordStart + 0x7F, 3);
    w.employmentStatusLabel = (w.employmentStatusCode === "Hom"
      ? "Sitting Out Contract"
      : w.employmentStatusCode === "Nor"
        ? "Available"
        : `Special (${w.employmentStatusCode || "---"})`);

    // Save-oriented contract values verified from wrestler.dat screenshots / file evidence.
    w.employer1ContractLengthMonthsRaw = bin.u16le(recordStart + 0x4A);
    w.employer1ContractLengthMonths = w.employer1ContractLengthMonthsRaw;
    if (typeof w.wageThousandsRaw === "number") {
      w.employer1SalaryThousandsRaw = w.wageThousandsRaw;
      w.employer1SalaryDollars = w.wageThousandsRaw * 1000;
    }

    workers.push(w);
  }

  return workers;
}
