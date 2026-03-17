import { encodeSingleByteFixed, writeSingleByteFixed } from "./textEncoding";
import type { EventRecord, EventMonthId, EventShowType } from "./parseEventDat";
import { EVENT_LAYOUT } from "./validateEventDat";

const DEFAULT_RESERVED = Uint8Array.from([0, 0, 0, 0, 64, 137, 220, 64]);

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function writeU16(dst: Uint8Array, offset: number, value: number) {
  const v = clamp(Math.round(Number(value) || 0), 0, 65535);
  dst[offset] = v & 0xff;
  dst[offset + 1] = (v >> 8) & 0xff;
}

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) {
  writeSingleByteFixed(dst, offset, value, length);
}

function normalizeMonth(value: number): EventMonthId {
  if (value >= 1 && value <= 13) return value as EventMonthId;
  return 1;
}

function normalizeShowType(value: number): EventShowType {
  if (value >= 1 && value <= 4) return value as EventShowType;
  return 1;
}

function normalizeEventDate(value: string | null | undefined): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() != day) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function writeOleAutomationDate(dst: Uint8Array, offset: number, value: string | null | undefined) {
  const normalized = normalizeEventDate(value);
  if (!normalized) return;
  const [year, month, day] = normalized.split("-").map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  const baseUtc = Date.UTC(1899, 11, 30);
  const ole = (utcMs - baseUtc) / 86400000;
  const view = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
  view.setFloat64(offset, ole, true);
}

export function writeEventDat(records: EventRecord[]): Uint8Array {
  const out = new Uint8Array(records.length * EVENT_LAYOUT.recordSize);

  for (let i = 0; i < records.length; i++) {
    const start = i * EVENT_LAYOUT.recordSize;
    const dst = out.subarray(start, start + EVENT_LAYOUT.recordSize);
    const rec = records[i];

    if (rec?._raw?.length === EVENT_LAYOUT.recordSize) dst.set(rec._raw);
    else {
      dst.fill(0);
      dst.set(DEFAULT_RESERVED, EVENT_LAYOUT.reservedOffset);
    }

    dst[EVENT_LAYOUT.markerOffset] = EVENT_LAYOUT.markerValue;
    writeAsciiFixed(dst, EVENT_LAYOUT.nameOffset, EVENT_LAYOUT.nameLength, rec.name);
    writeU16(dst, EVENT_LAYOUT.promotionIdOffset, rec.promotionId);
    writeU16(dst, EVENT_LAYOUT.monthOffset, normalizeMonth(rec.month));
    writeU16(dst, EVENT_LAYOUT.typeOffset, normalizeShowType(rec.showType));
    writeOleAutomationDate(dst, EVENT_LAYOUT.reservedOffset, rec.eventDate);
  }

  return out;
}
