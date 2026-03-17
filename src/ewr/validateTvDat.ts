export const TV_LAYOUT = {
  recordSize: 51,
  markerOffset: 0,
  markerValue: 52, // '4'
  nameOffset: 1,
  nameLength: 20,
  promotionIdOffset: 21,
  dayOffset: 23,
  dayLength: 9,
  timeSlotOffset: 32,
  networkIdOffset: 33,
  contractLengthWeeksOffset: 35,
  announcer1StaffIdOffset: 37,
  announcer2IdOffset: 39,
  announcer2UseWrestlerOffset: 41,
  reservedOffset: 43,
  reservedLength: 8,
} as const;

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function validateTvDatBytes(bytes: Uint8Array): { recordCount: number } {
  const size = bytes?.length ?? 0;
  assert(size > 0, "File is empty");
  assert(size % TV_LAYOUT.recordSize === 0, `File size ${size} is not a multiple of ${TV_LAYOUT.recordSize}`);

  const recordCount = Math.floor(size / TV_LAYOUT.recordSize);
  for (let i = 0; i < recordCount; i++) {
    const base = i * TV_LAYOUT.recordSize;
    const marker = bytes[base + TV_LAYOUT.markerOffset];
    assert(marker === TV_LAYOUT.markerValue, `Invalid marker at record ${i}. Expected ${TV_LAYOUT.markerValue}, got ${marker}`);
  }

  return { recordCount };
}
