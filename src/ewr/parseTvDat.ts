import { decodeSingleByte } from "./textEncoding";
import { TV_LAYOUT, validateTvDatBytes } from "./validateTvDat";

export type TvTimeSlot = "E" | "P" | "L" | "G";

export type TelevisionRecord = {
  index: number;
  name: string;
  promotionId: number;
  day: string;
  timeSlot: TvTimeSlot;
  networkId: number;
  contractLengthWeeks: number;
  announcer1StaffId: number;
  announcer2StaffId: number;
  announcer2WrestlerId: number;
  announcer2UseWrestler: boolean;
  _raw: Uint8Array;
};

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readI16(bytes: Uint8Array, offset: number): number {
  const value = readU16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function readAsciiFixed(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    const b = bytes[i] ?? 0;
    if (b === 0x00) break;
    out += String.fromCharCode(b);
  }
  return out.trimEnd();
}

function normalizeDay(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  return trimmed || "Monday";
}

function normalizeTimeSlot(raw: string): TvTimeSlot {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "P" || value === "L" || value === "G") return value;
  return "E";
}

export function parseTvDat(bytes: Uint8Array): { television: TelevisionRecord[] } {
  const { recordCount } = validateTvDatBytes(bytes);
  const television: TelevisionRecord[] = [];

  for (let i = 0; i < recordCount; i++) {
    const start = i * TV_LAYOUT.recordSize;
    const rec = bytes.subarray(start, start + TV_LAYOUT.recordSize);
    const useWrestler = readI16(rec, TV_LAYOUT.announcer2UseWrestlerOffset) !== 0;
    const announcer2Id = readU16(rec, TV_LAYOUT.announcer2IdOffset);

    television.push({
      index: i,
      name: readAsciiFixed(rec, TV_LAYOUT.nameOffset, TV_LAYOUT.nameLength),
      promotionId: readU16(rec, TV_LAYOUT.promotionIdOffset),
      day: normalizeDay(readAsciiFixed(rec, TV_LAYOUT.dayOffset, TV_LAYOUT.dayLength)),
      timeSlot: normalizeTimeSlot(String.fromCharCode(rec[TV_LAYOUT.timeSlotOffset] ?? 0x45)),
      networkId: readU16(rec, TV_LAYOUT.networkIdOffset),
      contractLengthWeeks: readU16(rec, TV_LAYOUT.contractLengthWeeksOffset),
      announcer1StaffId: readU16(rec, TV_LAYOUT.announcer1StaffIdOffset),
      announcer2StaffId: useWrestler ? 0 : announcer2Id,
      announcer2WrestlerId: useWrestler ? announcer2Id : 0,
      announcer2UseWrestler: useWrestler,
      _raw: new Uint8Array(rec),
    });
  }

  return { television };
}
