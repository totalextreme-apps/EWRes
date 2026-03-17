export const NETWORK_LAYOUT = {
  recordSize: 43,
  markerOffset: 0,
  markerValue: 52, // '4'
  idOffset: 1,
  nameOffset: 3,
  nameLength: 20,
  earlyAudienceOffset: 23,
  primeAudienceOffset: 25,
  lateAudienceOffset: 27,
  graveyardAudienceOffset: 29,
  earlyRiskOffset: 31,
  primeRiskOffset: 33,
  lateRiskOffset: 35,
  graveyardRiskOffset: 37,
  productionValuesOffset: 39,
  genericFlagOffset: 41,
} as const;

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function validateNetworkDatBytes(bytes: Uint8Array): { recordCount: number } {
  const size = bytes?.length ?? 0;
  assert(size > 0, "File is empty");
  assert(size % NETWORK_LAYOUT.recordSize === 0, `File size ${size} not multiple of ${NETWORK_LAYOUT.recordSize}`);

  const recordCount = Math.floor(size / NETWORK_LAYOUT.recordSize);
  for (let i = 0; i < recordCount; i++) {
    const base = i * NETWORK_LAYOUT.recordSize;
    const marker = bytes[base + NETWORK_LAYOUT.markerOffset];
    assert(
      marker === NETWORK_LAYOUT.markerValue,
      `Invalid marker at record ${i}. Expected ${NETWORK_LAYOUT.markerValue}, got ${marker}`
    );
  }

  return { recordCount };
}
