import type { Stable } from "./parseStablesDat";
import { STABLES_LAYOUT } from "./validateStablesDat";

function writeU16(dst: Uint8Array, offset: number, v: number) {
  const vv = Math.max(0, Math.min(65535, v | 0));
  dst[offset] = vv & 0xff;
  dst[offset + 1] = (vv >> 8) & 0xff;
}

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) {
  const s = String(value ?? "").slice(0, length);
  for (let i = 0; i < length; i++) dst[offset + i] = 0x20;
  for (let i = 0; i < s.length; i++) dst[offset + i] = s.charCodeAt(i) & 0xff;
}

export function writeStablesDat(stables: Stable[]): Uint8Array {
  const out = new Uint8Array(stables.length * STABLES_LAYOUT.recordSize);
  for (let i = 0; i < stables.length; i++) {
    const start = i * STABLES_LAYOUT.recordSize;
    const dst = out.subarray(start, start + STABLES_LAYOUT.recordSize);
    const s = stables[i];

    if (s?._raw?.length === STABLES_LAYOUT.recordSize) dst.set(s._raw);
    else dst.fill(0);

    dst[STABLES_LAYOUT.markerOffset] = STABLES_LAYOUT.markerValue;
    writeAsciiFixed(dst, STABLES_LAYOUT.nameOffset, STABLES_LAYOUT.nameLength, s.stableName);
    writeU16(dst, STABLES_LAYOUT.promotionIdOffset, s.promotionId);
    writeU16(dst, STABLES_LAYOUT.leaderIdOffset, s.leaderId);
    for (let slot = 0; slot < STABLES_LAYOUT.memberCount; slot++) {
      writeU16(dst, STABLES_LAYOUT.membersOffset + slot * 2, Number(s.memberIds?.[slot] ?? 0));
    }
  }
  return out;
}
