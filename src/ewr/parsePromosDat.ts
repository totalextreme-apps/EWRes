// src/ewr/parsePromosDat.ts
// promos.dat (EWR 4.2) parser for Promotions Editor.

import schema from "./promos_dat_schema.json";
import { validatePromosDatBytes } from "./validatePromosDat";

export type PromoSize = "Backyard" | "Small" | "Regional" | "Cult" | "National" | "Global";
export type PromoRegion = "America" | "Canada" | "Mexico";
export type CampFacilities = "None" | "Poor" | "Average" | "Good" | "Superb";

export type PromoRecord = {
  recordIndex: number;
  id: number;

  name: string;
  initials: string;
  logoBase: string; // base name without .jpg
  bannerBase: string; // base name without .jpg

  size: number; // file enum
  basedIn: number; // file enum
  money: number;
  image: number;
  production: number;
  risk: number;
  advertising: number;
  merchandising: number;
  announcer1StaffId: number; // u16 staff id (0=None)
  announcer2UseWrestler: boolean;
  announcer2StaffId: number;   // u16 staff id when Use Wrestler is OFF
  announcer2WrestlerId: number; // u16 wrestler id when Use Wrestler is ON

  rosterSplits: [string, string, string, string];
  devTerritory: string;
  trainingCamp: string;
  campFacilities: number;
  headTrainerStaffId: number;
  bookerStaffId: number;

  _raw: Uint8Array; // full 397-byte record (preserved for round-trip)
};

// Minimal promo type used by other editors (e.g., Staff employer dropdowns).
export type Promo = {
  id: number;
  name: string;
  shortName: string; // promotion initials
};

type FieldDef = { type: string; offset: number; length?: number };

function field(name: keyof (typeof schema)["fields"]): FieldDef {
  return (schema as any).fields[name];
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.slice(offset, offset + length);
  const zero = slice.indexOf(0);
  const clean = zero >= 0 ? slice.slice(0, zero) : slice;
  // EWR files are typically space padded.
  return new TextDecoder("ascii").decode(clean).replace(/\s+$/g, "").trim();
}

function readU8(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function stripJpg(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return "";
  if (/^none$/i.test(t)) return "None";
  return t.replace(/\.jpg$/i, "");
}

export function parsePromosDat(bytes: Uint8Array): { promos: Promo[]; records: PromoRecord[] } {
  // Validate marker + record size.
  validatePromosDatBytes(bytes);
  const recordSize = (schema as any).recordSize as number;

  // --- promos.dat announcer offsets (confirmed via diffs) ---
  const ANN1_OFF = 265; // u16 staff id
  const ANN2_OFF = 267; // u16 staff id OR wrestler id depending on flag
  const USEW1_OFF = 269; // u8 (0 or 255)

  const isTruthy = (v: number) => v !== 0;

  const maxRecords = (schema as any).maxRecords as number;

  const count = Math.min(Math.floor(bytes.length / recordSize), maxRecords);
  const records: PromoRecord[] = [];

  const fId = field("id");
  const fName = field("name");
  const fInit = field("initials");
  const fLogo = field("logo");
  const fBanner = field("banner");
  const fSize = field("size");
  const fBased = field("basedIn");
  const fMoney = field("money");
  const fImage = field("image");
  const fProd = field("production");
  const fRisk = field("risk");
  const fAd = field("advertising");
  const fMerch = field("merchandising");
  const rs1 = field("rosterSplit1");
  const rs2 = field("rosterSplit2");
  const rs3 = field("rosterSplit3");
  const rs4 = field("rosterSplit4");
  const fTraining = field("trainingCamp");
  const fCampFac = field("campFacilities");
  const fTrainer = field("headTrainerStaffId");
  const fDev = field("devTerritory");
  const fBooker = field("bookerStaffId");

  for (let i = 0; i < count; i++) {
    const base = i * recordSize;
    const rec = bytes.slice(base, base + recordSize);

    const id = readU16(rec, fId.offset);
    const name = readAscii(rec, fName.offset, fName.length!);
    const initials = readAscii(rec, fInit.offset, fInit.length!);
    const logoRaw = readAscii(rec, fLogo.offset, fLogo.length!);
    const bannerRaw = readAscii(rec, fBanner.offset, fBanner.length!);

    records.push({
      recordIndex: i,
      id,
      name,
      initials,
      logoBase: stripJpg(logoRaw),
      bannerBase: stripJpg(bannerRaw),

      size: readU8(rec, fSize.offset),
      basedIn: readU8(rec, fBased.offset),
      money: readU32(rec, fMoney.offset),
      image: readU8(rec, fImage.offset),
      production: readU8(rec, fProd.offset),
      risk: readU8(rec, fRisk.offset),
      advertising: readU8(rec, fAd.offset),
      merchandising: readU8(rec, fMerch.offset),

      announcer1StaffId: readU16(rec, ANN1_OFF),
      announcer2UseWrestler: isTruthy(rec[USEW1_OFF]),
      announcer2StaffId: isTruthy(rec[USEW1_OFF]) ? 0 : readU16(rec, ANN2_OFF),
      announcer2WrestlerId: isTruthy(rec[USEW1_OFF]) ? readU16(rec, ANN2_OFF) : 0,

      rosterSplits: [
        readAscii(rec, rs1.offset, rs1.length!),
        readAscii(rec, rs2.offset, rs2.length!),
        readAscii(rec, rs3.offset, rs3.length!),
        readAscii(rec, rs4.offset, rs4.length!),
      ],

      trainingCamp: readAscii(rec, fTraining.offset, fTraining.length!),
      campFacilities: readU8(rec, fCampFac.offset),
      headTrainerStaffId: readU16(rec, fTrainer.offset),

      devTerritory: readAscii(rec, fDev.offset, fDev.length!),
      bookerStaffId: readU16(rec, fBooker.offset),

      _raw: rec,
    });
  }

  const promos: Promo[] = records.map((r) => ({
    id: r.id,
    name: r.name,
    shortName: r.initials,
  }));

  // Sort by id for stable dropdowns.
  promos.sort((a, b) => a.id - b.id);

  return { promos, records };
}
