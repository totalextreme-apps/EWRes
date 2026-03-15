import { decodeSingleByte } from "./textEncoding";
import { EVENT_LAYOUT, validateEventDatBytes } from "./validateEventDat";

export type EventShowType = 1 | 2 | 3 | 4;
export type EventMonthId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export type EventRecord = {
  index: number;
  name: string;
  promotionId: number;
  month: EventMonthId;
  showType: EventShowType;
  eventDate: string | null;
  _raw: Uint8Array;
};

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
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

function readOleAutomationDate(bytes: Uint8Array, offset: number): string | null {
  if (offset < 0 || offset + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = view.getFloat64(offset, true);
  if (!Number.isFinite(value) || value <= 0) return null;
  const wholeDays = Math.floor(value);
  const ms = Math.round((value - wholeDays) * 86400000);
  const baseUtc = Date.UTC(1899, 11, 30);
  const date = new Date(baseUtc + wholeDays * 86400000 + ms);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeMonth(value: number): EventMonthId {
  if (value >= 1 && value <= 13) return value as EventMonthId;
  return 1;
}

function normalizeShowType(value: number): EventShowType {
  if (value >= 1 && value <= 4) return value as EventShowType;
  return 1;
}

export function parseEventDat(bytes: Uint8Array): { events: EventRecord[] } {
  const { recordCount } = validateEventDatBytes(bytes);
  const events: EventRecord[] = [];

  for (let i = 0; i < recordCount; i++) {
    const start = i * EVENT_LAYOUT.recordSize;
    const rec = bytes.subarray(start, start + EVENT_LAYOUT.recordSize);
    events.push({
      index: i,
      name: readAsciiFixed(rec, EVENT_LAYOUT.nameOffset, EVENT_LAYOUT.nameLength),
      promotionId: readU16(rec, EVENT_LAYOUT.promotionIdOffset),
      month: normalizeMonth(readU16(rec, EVENT_LAYOUT.monthOffset)),
      showType: normalizeShowType(readU16(rec, EVENT_LAYOUT.typeOffset)),
      eventDate: readOleAutomationDate(rec, EVENT_LAYOUT.reservedOffset),
      _raw: new Uint8Array(rec),
    });
  }

  return { events };
}
