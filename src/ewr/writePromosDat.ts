// src/ewr/writePromosDat.ts
// promos.dat (EWR 4.2) writer. Preserves unknown bytes by starting from the original record bytes.

import schema from "./promos_dat_schema.json";
import type { PromoRecord } from "./parsePromosDat";

type FieldDef = { type: string; offset: number; length?: number };

function field(name: keyof (typeof schema)["fields"]): FieldDef {
  return (schema as any).fields[name];
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function writeU8(dst: Uint8Array, offset: number, value: number) {
  dst[offset] = clampInt(value, 0, 255);
}

function writeU16(dst: Uint8Array, offset: number, value: number) {
  const v = clampInt(value, 0, 65535);
  dst[offset] = v & 0xff;
  dst[offset + 1] = (v >>> 8) & 0xff;
}

function writeU32(dst: Uint8Array, offset: number, value: number) {
  const v = Math.max(0, Math.min(0xffffffff, Math.floor(Number(value) || 0))) >>> 0;
  dst[offset] = v & 0xff;
  dst[offset + 1] = (v >>> 8) & 0xff;
  dst[offset + 2] = (v >>> 16) & 0xff;
  dst[offset + 3] = (v >>> 24) & 0xff;
}

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) {
  const s = (value ?? "").toString();
  // EWR uses space padded ASCII.
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < length; i++) dst[offset + i] = 0x20; // space
  for (let i = 0; i < Math.min(length, bytes.length); i++) dst[offset + i] = bytes[i];
}

function normalizeJpgBase(base: string): string {
  const t = (base ?? "").trim();
  if (!t) return "None";
  if (/^none$/i.test(t)) return "None";
  return t.replace(/\.jpg$/i, "");
}

function toJpgStored(base: string): string {
  const b = normalizeJpgBase(base);
  if (/^none$/i.test(b)) return "None";
  return `${b}.jpg`;
}

export function writePromosDat(promos: PromoRecord[], originalFileBytes?: Uint8Array): Uint8Array {
  const recordSize = (schema as any).recordSize as number;

  // --- promos.dat announcer offsets (confirmed via diffs) ---
  const ANN1_OFF = 265; // u16 staff id
  const ANN2_OFF = 267; // u16 staff id OR wrestler id depending on "use wrestler" flag
  const USEW1_OFF = 269; // u8 (0 or 255)
  const USEW2_OFF = 270; // u8 (duplicate)

  const maxRecords = (schema as any).maxRecords as number;

  const count = Math.min(promos.length, maxRecords);
  const out = new Uint8Array(recordSize * count);

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
    const rec = promos[i];
    const base = i * recordSize;

    // Preserve unknown bytes:
    // - Prefer record._raw if present
    // - Else fall back to originalFileBytes slice
    // - Else zero-filled record
    const seed = rec._raw?.length === recordSize
      ? rec._raw
      : originalFileBytes && originalFileBytes.length >= base + recordSize
        ? originalFileBytes.slice(base, base + recordSize)
        : new Uint8Array(recordSize);

    out.set(seed, base);

    // Strings
    writeAsciiFixed(out, base + fName.offset, fName.length!, (rec.name ?? "").slice(0, fName.length!));
    writeAsciiFixed(out, base + fInit.offset, fInit.length!, (rec.initials ?? "").slice(0, fInit.length!));
    writeAsciiFixed(out, base + fLogo.offset, fLogo.length!, toJpgStored(rec.logoBase).slice(0, fLogo.length!));
    writeAsciiFixed(out, base + fBanner.offset, fBanner.length!, toJpgStored(rec.bannerBase).slice(0, fBanner.length!));

    // Enums / numeric
    writeU8(out, base + fSize.offset, rec.size);
    writeU8(out, base + fBased.offset, rec.basedIn);
    writeU32(out, base + fMoney.offset, rec.money);
    writeU8(out, base + fImage.offset, rec.image);
    writeU8(out, base + fProd.offset, rec.production);
    writeU8(out, base + fRisk.offset, rec.risk);
    writeU8(out, base + fAd.offset, rec.advertising);
    writeU8(out, base + fMerch.offset, rec.merchandising);

    // Announcers (u16 ids; announcer2 can be staff or wrestler based on flag bytes)
    writeU16(out, base + ANN1_OFF, rec.announcer1StaffId ?? 0);

    const useW = !!rec.announcer2UseWrestler;
    writeU8(out, base + USEW1_OFF, useW ? 255 : 0);
    writeU8(out, base + USEW2_OFF, useW ? 255 : 0);
    writeU16(out, base + ANN2_OFF, useW ? (rec.announcer2WrestlerId ?? 0) : (rec.announcer2StaffId ?? 0));

    // Roster splits
    writeAsciiFixed(out, base + rs1.offset, rs1.length!, (rec.rosterSplits?.[0] ?? "").slice(0, rs1.length!));
    writeAsciiFixed(out, base + rs2.offset, rs2.length!, (rec.rosterSplits?.[1] ?? "").slice(0, rs2.length!));
    writeAsciiFixed(out, base + rs3.offset, rs3.length!, (rec.rosterSplits?.[2] ?? "").slice(0, rs3.length!));
    writeAsciiFixed(out, base + rs4.offset, rs4.length!, (rec.rosterSplits?.[3] ?? "").slice(0, rs4.length!));

    // Training/dev
    writeAsciiFixed(out, base + fTraining.offset, fTraining.length!, (rec.trainingCamp ?? "").slice(0, fTraining.length!));
    writeU8(out, base + fCampFac.offset, rec.campFacilities);
    writeU16(out, base + fTrainer.offset, rec.headTrainerStaffId);
    writeAsciiFixed(out, base + fDev.offset, fDev.length!, (rec.devTerritory ?? "").slice(0, fDev.length!));
    writeU16(out, base + fBooker.offset, rec.bookerStaffId);
  }

  return out;
}
