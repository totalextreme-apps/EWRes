// src/ewr/validateStaffDat.ts
//
// Locked staff.dat layout (EWR 4.2) based on byte-level diffs vs the native editor.
// Record size: 79 bytes, 156 records in sample dataset.
//
// IMPORTANT: We preserve unknown bytes on write by keeping _raw on each record
// and only touching offsets we have verified.

export type StaffDatLayout = {
  recordSize: number;
  markerOffset: number;
  markerValue: number;

  idOffset: number;          // u16le
  nameOffset: number;        // ASCII fixed
  nameLength: number;

  genderOffset: number;      // u16le (0xFFFF male, 0x0000 female)
  birthMonthOffset: number;  // u16le (0 = unknown, 1-12 = Jan..Dec)
  ageOffset: number;         // u16le

  pictureOffset: number;     // ASCII fixed
  pictureLength: number;

  employerIdOffset: number;  // u16le (promotion id)
  contractOffset: number;    // ASCII fixed (3) "Non" / "Wri"

  ownerStyleOffset: number;  // u16le (0..7)
  positionOffset: number;    // u16le

  talentOffset: number;      // u16le (0..100)
  backstageOffset: number;   // u16le (0..100)

  unsackableOffset: number;  // u16le (0xFFFF/0x0000)
  bookerOffset: number;      // u16le (0xFFFF/0x0000)
};

export const STAFF_LAYOUT: StaffDatLayout = {
  recordSize: 79,
  markerOffset: 0,
  markerValue: 0x34, // '4'

  idOffset: 1,
  nameOffset: 3,
  nameLength: 25,

  genderOffset: 28,
  birthMonthOffset: 30,
  ageOffset: 32,

  pictureOffset: 34,
  pictureLength: 20,

  employerIdOffset: 54,
  contractOffset: 58,

  ownerStyleOffset: 61, // shared byte: ownerStyle when position=Owner, wageThousands when position!=Owner // shared byte: ownerStyle when position=Owner, wageThousands when position!=Owner
  positionOffset: 65,

  talentOffset: 67,
  backstageOffset: 71,

  unsackableOffset: 75,
  bookerOffset: 77,
};

export function validateStaffDatBytes(bytes: Uint8Array) {
  const layout = STAFF_LAYOUT;

  if (bytes.length % layout.recordSize !== 0) {
    throw new Error(
      `staff.dat length ${bytes.length} is not divisible by record size ${layout.recordSize}.`
    );
  }

  const recordCount = bytes.length / layout.recordSize;

  // Basic marker sanity
  for (let i = 0; i < recordCount; i++) {
    const off = i * layout.recordSize + layout.markerOffset;
    if (bytes[off] !== layout.markerValue) {
      throw new Error(
        `staff.dat marker mismatch at record ${i} (offset ${off}). Expected 0x${layout.markerValue.toString(
          16
        )}, got 0x${bytes[off].toString(16)}`
      );
    }
  }

  return { layout, recordCount };
}
