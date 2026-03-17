export const EVENT_LAYOUT = {
  recordSize: 47,
  markerOffset: 0,
  markerValue: 52, // '4'
  nameOffset: 1,
  nameLength: 32,
  promotionIdOffset: 33,
  monthOffset: 35,
  typeOffset: 37,
  reservedOffset: 39,
  reservedLength: 8,
} as const;

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function validateEventDatBytes(bytes: Uint8Array): { recordCount: number } {
  const size = bytes?.length ?? 0;
  assert(size > 0, "File is empty");
  assert(size % EVENT_LAYOUT.recordSize === 0, `File size ${size} not multiple of ${EVENT_LAYOUT.recordSize}`);

  const recordCount = Math.floor(size / EVENT_LAYOUT.recordSize);
  for (let i = 0; i < recordCount; i++) {
    const base = i * EVENT_LAYOUT.recordSize;
    const marker = bytes[base + EVENT_LAYOUT.markerOffset];
    assert(marker === EVENT_LAYOUT.markerValue, `Invalid marker at record ${i}. Expected ${EVENT_LAYOUT.markerValue}, got ${marker}`);
  }

  return { recordCount };
}
