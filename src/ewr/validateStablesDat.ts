export const STABLES_LAYOUT = {
  recordSize: 70,
  markerOffset: 0,
  markerValue: 52, // '4'
  nameOffset: 1,
  nameLength: 25,
  promotionIdOffset: 26,
  leaderIdOffset: 28,
  membersOffset: 30,
  memberCount: 20,
} as const;

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function validateStablesDatBytes(bytes: Uint8Array): { recordCount: number } {
  const size = bytes?.length ?? 0;
  assert(size > 0, "File is empty");
  assert(size % STABLES_LAYOUT.recordSize === 0, `File size ${size} not multiple of ${STABLES_LAYOUT.recordSize}`);
  const recordCount = Math.floor(size / STABLES_LAYOUT.recordSize);
  for (let i = 0; i < recordCount; i++) {
    const marker = bytes[i * STABLES_LAYOUT.recordSize + STABLES_LAYOUT.markerOffset];
    assert(marker === STABLES_LAYOUT.markerValue, `Invalid marker at record ${i}. Expected ${STABLES_LAYOUT.markerValue}, got ${marker}`);
  }
  return { recordCount };
}
