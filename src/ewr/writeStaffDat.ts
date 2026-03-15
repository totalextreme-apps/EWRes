// src/ewr/writeStaffDat.ts
//
// Writes staff.dat using the locked schema.
// We preserve unknown bytes by starting from each record's _raw bytes.

import { STAFF_LAYOUT, type StaffDatLayout } from "./validateStaffDat";
import { StaffEnums, type Staff } from "./parseStaffDat";

function writeU16(dst: Uint8Array, offset: number, value: number) {
  const v = Math.max(0, Math.min(0xffff, Math.floor(value)));
  dst[offset] = v & 0xff;
  dst[offset + 1] = (v >> 8) & 0xff;
}
function writeU8(rec: Uint8Array, offset: number, value: number) {
  rec[offset] = value & 0xff;
}


function writeBoolU16(dst: Uint8Array, offset: number, on: boolean) {
  writeU16(dst, offset, on ? 0xffff : 0x0000);
}

export function writeStaffDat(staff: Staff[], layout: StaffDatLayout = STAFF_LAYOUT): Uint8Array {
  const out = new Uint8Array(staff.length * layout.recordSize);

  for (let i = 0; i < staff.length; i++) {
    const recStart = i * layout.recordSize;
    const src = staff[i]._raw?.length === layout.recordSize ? staff[i]._raw : new Uint8Array(layout.recordSize);

    // copy raw
    out.set(src, recStart);

    const rec = out.subarray(recStart, recStart + layout.recordSize);

    // marker
    rec[layout.markerOffset] = layout.markerValue;

    // id
    writeU16(rec, layout.idOffset, staff[i].id);

    // name + picture
    StaffEnums.writeAsciiFixed(rec, layout.nameOffset, layout.nameLength, staff[i].name ?? "");
    StaffEnums.writeAsciiFixed(rec, layout.pictureOffset, layout.pictureLength, staff[i].picture ?? "");

    // gender / birthMonth / age
    writeU16(rec, layout.genderOffset, staff[i].gender === "Male" ? 0xffff : 0x0000);
    writeU16(rec, layout.birthMonthOffset, staff[i].birthMonth ?? 0);
    writeU16(rec, layout.ageOffset, staff[i].age ?? 0);

    // employer + contract
    writeU16(rec, layout.employerIdOffset, staff[i].employerId ?? 0);
    StaffEnums.writeAsciiFixed(rec, layout.contractOffset, 3, StaffEnums.contractToCode(staff[i].contract));
// owner style + position
writeU16(rec, layout.positionOffset, StaffEnums.posToU16(staff[i].position));

// Shared byte at ownerStyleOffset:
// - when position == Owner: stores owner style enum (0..7)
// - otherwise: stores wage in $1,000 units (0..100)
if (staff[i].position === "Owner") {
  writeU8(rec, layout.ownerStyleOffset, StaffEnums.ownerStyleToU8(staff[i].ownerStyle));
} else {
  const dollars = staff[i].wageDollars ?? 0;
  const thousands = Math.max(0, Math.min(100, Math.round(dollars / 1000)));
  writeU8(rec, layout.ownerStyleOffset, thousands);
}    // wage is stored in the shared byte at ownerStyleOffset when position != Owner (written above).

    writeU16(rec, layout.talentOffset, staff[i].talent ?? 0);    writeU16(rec, layout.backstageOffset, staff[i].backstage ?? 0);
    // flags
    writeBoolU16(rec, layout.unsackableOffset, !!staff[i].unsackable);
    writeBoolU16(rec, layout.bookerOffset, !!staff[i].booker);
  }

  return out;
}
