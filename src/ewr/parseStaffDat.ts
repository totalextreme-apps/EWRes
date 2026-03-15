// src/ewr/parseStaffDat.ts
//
// Parses EWR 4.2 staff.dat using a locked 79-byte schema.
// Unknown bytes are preserved via _raw for safe round-trip writes.

import { STAFF_LAYOUT, validateStaffDatBytes, type StaffDatLayout } from "./validateStaffDat";

export type StaffPosition =
  | "Owner"
  | "Announcer"
  | "Referee"
  | "Production"
  | "Medical"
  | "Writer"
  | "Road Agent"
  | "Trainer"
  | "Unknown";

export type OwnerStyle =
  | "Normal"
  | "Prefers Brawling"
  | "Prefers High Flying"
  | "Prefers Technical Skill"
  | "Prefers Characters"
  | "Prefers T and A"
  | "Prefers Veterans"
  | "Prefers Mixed Martial Arts";

export type ContractType = "None" | "Written";

export type Staff = {
  index: number;      // record number (0-based)
  id: number;         // staff id (u16le)
  name: string;

  gender: "Male" | "Female";
  birthMonth: number; // 0..12
  age: number;        // 0..65535 (UI clamps)

  picture: string;

  employerId: number; // promotion id (u16le)
  contract: ContractType;

  position: StaffPosition;

  wageDollars: number; // displayed as dollars; stored as $1,000 units in a shared byte
  ownerStyle: OwnerStyle;

  talent: number;     // 0..100
  backstage: number;  // 0..100

  unsackable: boolean;
  booker: boolean;

  _raw: Uint8Array;
};

function readU8(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readAsciiFixed(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  let s = "";
  for (const b of slice) {
    if (b === 0x00) break;
    s += String.fromCharCode(b);
  }
  return s.trimEnd();
}

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) {
  const s = (value ?? "").slice(0, length);
  for (let i = 0; i < length; i++) dst[offset + i] = 0x20; // space pad
  for (let i = 0; i < s.length; i++) dst[offset + i] = s.charCodeAt(i) & 0xff;
}

function posFromU16(v: number): StaffPosition {
  switch (v) {
    case 1: return "Owner";
    case 2: return "Announcer";
    case 3: return "Referee";
    case 4: return "Production";
    case 5: return "Medical";
    case 6: return "Writer";
    case 7: return "Road Agent";
    case 8: return "Trainer";
    default: return "Unknown";
  }
}

function posToU16(p: StaffPosition): number {
  switch (p) {
    case "Owner": return 1;
    case "Announcer": return 2;
    case "Referee": return 3;
    case "Production": return 4;
    case "Medical": return 5;
    case "Writer": return 6;
    case "Road Agent": return 7;
    case "Trainer": return 8;
    default: return 0;
  }
}

const OWNER_STYLES: OwnerStyle[] = [
  "Normal",
  "Prefers Brawling",
  "Prefers High Flying",
  "Prefers Technical Skill",
  "Prefers Characters",
  "Prefers T and A",
  "Prefers Veterans",
  "Prefers Mixed Martial Arts",
];

function ownerStyleFromU8(v: number): OwnerStyle {
  return OWNER_STYLES[v] ?? "Normal";
}

function ownerStyleToU8(s: OwnerStyle): number {
  const idx = OWNER_STYLES.indexOf(s);
  return idx >= 0 ? idx : 0;
}

function contractFromBytes(rec: Uint8Array, layout: StaffDatLayout): ContractType {
  const code = readAsciiFixed(rec, layout.contractOffset, 3);
  return code === "Wri" ? "Written" : "None";
}

function contractToCode(c: ContractType): string {
  return c === "Written" ? "Wri" : "Non";
}

export function parseStaffDat(bytes: Uint8Array): { staff: Staff[]; layout: StaffDatLayout } {
  const { layout, recordCount } = validateStaffDatBytes(bytes);
  const staff: Staff[] = [];

  for (let i = 0; i < recordCount; i++) {
    const start = i * layout.recordSize;
    const rec = bytes.subarray(start, start + layout.recordSize);
    const rawCopy = new Uint8Array(rec); // preserve record

    const id = readU16(rec, layout.idOffset);
    const name = readAsciiFixed(rec, layout.nameOffset, layout.nameLength);

    const gender = readU16(rec, layout.genderOffset) === 0xffff ? "Male" : "Female";
    const birthMonth = readU16(rec, layout.birthMonthOffset);
    const age = readU16(rec, layout.ageOffset);

    const picture = readAsciiFixed(rec, layout.pictureOffset, layout.pictureLength);

    const employerId = readU16(rec, layout.employerIdOffset);
    const contract = contractFromBytes(rec, layout);    const position = posFromU16(readU16(rec, layout.positionOffset));

const shared = readU8(rec, layout.ownerStyleOffset);

const ownerStyle = position === "Owner" ? ownerStyleFromU8(shared) : "Normal";
const wageDollars = position === "Owner" ? 0 : shared * 1000;

    const talent = readU16(rec, layout.talentOffset);
    const backstage = readU16(rec, layout.backstageOffset);

    const unsackable = readU16(rec, layout.unsackableOffset) === 0xffff;
    const booker = readU16(rec, layout.bookerOffset) === 0xffff;

    staff.push({
      index: i,
      id,
      name,
      gender,
      birthMonth,
      age,
      picture,
      employerId,
      contract,
      position,
      wageDollars,
      ownerStyle,
      talent,
      backstage,
      unsackable,
      booker,
      _raw: rawCopy,
    });
  }

  return { staff, layout: STAFF_LAYOUT };
}

export const StaffEnums = {
  OWNER_STYLES,
  contractToCode,
  posToU16,
  ownerStyleToU8,
  writeAsciiFixed,
};
