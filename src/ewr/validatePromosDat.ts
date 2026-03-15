// src/ewr/validatePromosDat.ts
//
// promos.dat layout (EWR 4.2) - minimal fields needed for staff employer dropdown/filter.
//
// Confirmed from sample promos.dat:
// - fixed record size: 397 bytes
// - record marker byte: 0x34 ('4') at offset 0 of each record
// - id: u16le at offset 1
// - full name: ascii at offset 3 (length appears to be 40 in sample)
// - short name: ascii at offset 43 (length 6)
//
// We only rely on marker/id/shortName for now.

export type PromosDatLayout = {
  recordSize: number;
  markerOffset: number;
  markerValue: number;
  idOffset: number;
  shortNameOffset: number;
  shortNameLength: number;
  nameOffset: number;
  nameLength: number;
};

export const PROMOS_LAYOUT: PromosDatLayout = {
  recordSize: 397,
  markerOffset: 0,
  markerValue: 0x34,
  idOffset: 1,
  nameOffset: 3,
  nameLength: 40,
  shortNameOffset: 43,
  shortNameLength: 6,
};

export function validatePromosDatBytes(bytes: Uint8Array): PromosDatLayout {
  const { recordSize, markerOffset, markerValue } = PROMOS_LAYOUT;

  if (bytes.length === 0 || bytes.length % recordSize !== 0) {
    throw new Error(`promos.dat size must be a multiple of ${recordSize} bytes (got ${bytes.length})`);
  }

  const count = bytes.length / recordSize;
  for (let i = 0; i < count; i++) {
    const base = i * recordSize;
    if (bytes[base + markerOffset] !== markerValue) {
      throw new Error(`promos.dat record ${i} missing marker 0x34 at offset 0`);
    }
  }

  return PROMOS_LAYOUT;
}
