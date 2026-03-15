import type { TelevisionRecord, TvTimeSlot } from "./parseTvDat";
import { TV_LAYOUT } from "./validateTvDat";

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function writeU16(dst: Uint8Array, offset: number, value: number) {
  const v = clamp(Math.round(Number(value) || 0), 0, 65535);
  dst[offset] = v & 0xff;
  dst[offset + 1] = (v >> 8) & 0xff;
}

function writeI16(dst: Uint8Array, offset: number, value: number) {
  const v = Math.max(-32768, Math.min(32767, Math.round(Number(value) || 0)));
  const encoded = v < 0 ? 0x10000 + v : v;
  dst[offset] = encoded & 0xff;
  dst[offset + 1] = (encoded >> 8) & 0xff;
}

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) {
  const s = String(value ?? "").slice(0, length);
  for (let i = 0; i < length; i++) dst[offset + i] = 0x20;
  for (let i = 0; i < s.length; i++) dst[offset + i] = s.charCodeAt(i) & 0xff;
}

function normalizeSlot(value: string): TvTimeSlot {
  const slot = String(value ?? "").trim().toUpperCase();
  if (slot === "P" || slot === "L" || slot === "G") return slot;
  return "E";
}

export function writeTvDat(records: TelevisionRecord[]): Uint8Array {
  const out = new Uint8Array(records.length * TV_LAYOUT.recordSize);

  for (let i = 0; i < records.length; i++) {
    const start = i * TV_LAYOUT.recordSize;
    const dst = out.subarray(start, start + TV_LAYOUT.recordSize);
    const rec = records[i];

    if (rec?._raw?.length === TV_LAYOUT.recordSize) dst.set(rec._raw);
    else dst.fill(0);

    dst[TV_LAYOUT.markerOffset] = TV_LAYOUT.markerValue;
    writeAsciiFixed(dst, TV_LAYOUT.nameOffset, TV_LAYOUT.nameLength, rec.name);
    writeU16(dst, TV_LAYOUT.promotionIdOffset, rec.promotionId);
    writeAsciiFixed(dst, TV_LAYOUT.dayOffset, TV_LAYOUT.dayLength, rec.day);
    dst[TV_LAYOUT.timeSlotOffset] = normalizeSlot(rec.timeSlot).charCodeAt(0);
    writeU16(dst, TV_LAYOUT.networkIdOffset, rec.networkId);
    writeU16(dst, TV_LAYOUT.contractLengthWeeksOffset, rec.contractLengthWeeks);
    writeU16(dst, TV_LAYOUT.announcer1StaffIdOffset, rec.announcer1StaffId);
    const announcer2Id = rec.announcer2UseWrestler ? rec.announcer2WrestlerId : rec.announcer2StaffId;
    writeU16(dst, TV_LAYOUT.announcer2IdOffset, announcer2Id);
    writeI16(dst, TV_LAYOUT.announcer2UseWrestlerOffset, rec.announcer2UseWrestler ? -1 : 0);
  }

  return out;
}
