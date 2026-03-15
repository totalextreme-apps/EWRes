import { encodeSingleByteFixed, writeSingleByteFixed } from "./textEncoding";
import type { NetworkRecord } from "./parseNetworkDat";
import { NETWORK_LAYOUT } from "./validateNetworkDat";

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

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) { const [dst, offset, value, length] = [arguments[0], arguments[1], arguments[2], arguments[3]] as any; writeSingleByteFixed(dst, offset, value, length); }

export function writeNetworkDat(records: NetworkRecord[]): Uint8Array {
  const out = new Uint8Array(records.length * NETWORK_LAYOUT.recordSize);

  for (let i = 0; i < records.length; i++) {
    const start = i * NETWORK_LAYOUT.recordSize;
    const dst = out.subarray(start, start + NETWORK_LAYOUT.recordSize);
    const rec = records[i];

    if (rec?._raw?.length === NETWORK_LAYOUT.recordSize) dst.set(rec._raw);
    else dst.fill(0);

    dst[NETWORK_LAYOUT.markerOffset] = NETWORK_LAYOUT.markerValue;
    writeU16(dst, NETWORK_LAYOUT.idOffset, rec.networkId);
    writeAsciiFixed(dst, NETWORK_LAYOUT.nameOffset, NETWORK_LAYOUT.nameLength, rec.name);
    writeU16(dst, NETWORK_LAYOUT.earlyAudienceOffset, rec.earlyAudience);
    writeU16(dst, NETWORK_LAYOUT.primeAudienceOffset, rec.primeAudience);
    writeU16(dst, NETWORK_LAYOUT.lateAudienceOffset, rec.lateAudience);
    writeU16(dst, NETWORK_LAYOUT.graveyardAudienceOffset, rec.graveyardAudience);
    writeU16(dst, NETWORK_LAYOUT.earlyRiskOffset, rec.earlyRisk);
    writeU16(dst, NETWORK_LAYOUT.primeRiskOffset, rec.primeRisk);
    writeU16(dst, NETWORK_LAYOUT.lateRiskOffset, rec.lateRisk);
    writeU16(dst, NETWORK_LAYOUT.graveyardRiskOffset, rec.graveyardRisk);
    writeU16(dst, NETWORK_LAYOUT.productionValuesOffset, rec.productionValues);
    writeI16(dst, NETWORK_LAYOUT.genericFlagOffset, rec.generic ? -1 : 0);
  }

  return out;
}
