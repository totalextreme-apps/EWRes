import { decodeSingleByte } from "./textEncoding";
import { NETWORK_LAYOUT, validateNetworkDatBytes } from "./validateNetworkDat";

export type NetworkRecord = {
  index: number;
  networkId: number;
  name: string;
  earlyAudience: number;
  primeAudience: number;
  lateAudience: number;
  graveyardAudience: number;
  earlyRisk: number;
  primeRisk: number;
  lateRisk: number;
  graveyardRisk: number;
  productionValues: number;
  generic: boolean;
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

export function parseNetworkDat(bytes: Uint8Array): { networks: NetworkRecord[] } {
  const { recordCount } = validateNetworkDatBytes(bytes);
  const networks: NetworkRecord[] = [];

  for (let i = 0; i < recordCount; i++) {
    const start = i * NETWORK_LAYOUT.recordSize;
    const rec = bytes.subarray(start, start + NETWORK_LAYOUT.recordSize);

    networks.push({
      index: i,
      networkId: readU16(rec, NETWORK_LAYOUT.idOffset),
      name: readAsciiFixed(rec, NETWORK_LAYOUT.nameOffset, NETWORK_LAYOUT.nameLength),
      earlyAudience: readU16(rec, NETWORK_LAYOUT.earlyAudienceOffset),
      primeAudience: readU16(rec, NETWORK_LAYOUT.primeAudienceOffset),
      lateAudience: readU16(rec, NETWORK_LAYOUT.lateAudienceOffset),
      graveyardAudience: readU16(rec, NETWORK_LAYOUT.graveyardAudienceOffset),
      earlyRisk: readU16(rec, NETWORK_LAYOUT.earlyRiskOffset),
      primeRisk: readU16(rec, NETWORK_LAYOUT.primeRiskOffset),
      lateRisk: readU16(rec, NETWORK_LAYOUT.lateRiskOffset),
      graveyardRisk: readU16(rec, NETWORK_LAYOUT.graveyardRiskOffset),
      productionValues: readU16(rec, NETWORK_LAYOUT.productionValuesOffset),
      generic: readI16(rec, NETWORK_LAYOUT.genericFlagOffset) !== 0,
      _raw: new Uint8Array(rec),
    });
  }

  return { networks };
}
