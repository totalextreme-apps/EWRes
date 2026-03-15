import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";

// Tauri v2 plugins
import { open, save } from "@tauri-apps/plugin-dialog";
import {readFile, writeFile, exists, copyFile, mkdir} from "@tauri-apps/plugin-fs";

import { parseSponsorDat, type Sponsor } from "./ewr/parseSponsorDat";
import { writeSponsorDat } from "./ewr/writeSponsorDat";
import { validateSponsorDatBytes } from "./ewr/validateSponsorDat";
import EwrSelectCompat from "./components/inputs/EwrSelectCompat";
import { withUtf8Bom } from "./ewr/textEncoding";

// Rendered within the app's global section navigation (App.tsx provides the top header nav).

// ---------- helpers ----------
function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function currency(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toLocaleString("en-US")}`;
}

function paymentDollarsFromSponsor(s: Sponsor): number {
  // Preferred normalized field from parser
  const normalized = Number((s as any).paymentDollars);
  if (Number.isFinite(normalized) && normalized >= 0) return normalized;

  // Fallback: thousands stored in file
  const thousands = Number((s as any).paymentThousandsRaw);
  if (Number.isFinite(thousands) && thousands >= 0) return thousands * 1000;

  return 0;
}

function sponsorNameFromSponsor(s: Sponsor): string {
  // Locked schema field name is sponsorName
  const n = (s as any).sponsorName;
  return typeof n === "string" ? n : "";
}

function normalizeNameForUniq(name: string): string {
  return (name ?? "").trim().toLowerCase();
}

function stripTrailingCopySuffix(name: string): string {
  // If the source already ends with " (N)", strip it so copies increment cleanly.
  // Example: copying "Sega (1)" should produce "Sega (2)".
  const trimmed = (name ?? "").trim();
  const m = trimmed.match(/^(.*)\s\((\d+)\)$/);
  if (!m) return trimmed;
  const base = (m[1] ?? "").trim();
  return base;
}

// ---------- CSV helpers (mirrors App.tsx wrestler external editor) ----------
type CsvRecord = Record<string, string>;

function csvEscape(value: any): string {
  const s = (value ?? "").toString();
  if (/[\",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// RFC4180-ish parser: handles quoted fields, commas, CRLF/LF.
function parseCsv(text: string): { headers: string[]; rows: CsvRecord[] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    if (ch === "\r") {
      // ignore; handle CRLF by letting \n close the row
      continue;
    }

    cur += ch;
  }

  // flush tail
  row.push(cur);
  if (row.length > 1 || row[0].trim() !== "") rows.push(row);

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  const out: CsvRecord[] = [];

  for (const r of rows) {
    if (r.every((c) => (c ?? "").trim() === "")) continue;
    const rec: CsvRecord = {};
    for (let i = 0; i < headers.length; i++) {
      const k = headers[i];
      if (!k) continue;
      rec[k] = (r[i] ?? "").trim();
    }
    out.push(rec);
  }

  return { headers, rows: out };
}

function parseIntOrNull(v: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

function IconPlus(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconChecklist(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 18h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M3.5 6l1.5 1.5L7.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 12l1.5 1.5L7.5 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 18l1.5 1.5L7.5 17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconImport(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7a2 2 0 0 1 2-2h6l2 2h4a2 2 0 0 1 2 2v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M4 10h16v10H4V10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 12v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9.5 14.5 12 12l2.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconGrid(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h7v7H4V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M13 4h7v7h-7V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M4 13h7v7H4v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M13 13h7v7h-7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}


type SortMode = "index" | "name";

type MoralityPreset = "" | "low" | "normal" | "high";

type MoralityBucket = "High" | "Normal" | "Low";

function moralityBucket(m: number): MoralityBucket {
  const v = clampInt(m, 0, 100);
  if (v >= 67) return "High";
  if (v <= 33) return "Low";
  return "Normal";
}

function paymentBucketIndex(p: number): number {
  const v = clampInt(p, 0, 1_000_000);
  if (v >= 800_000) return 0; // $1,000,000 - $800,000
  if (v >= 600_000) return 1; // $800,000 - $600,000
  if (v >= 400_000) return 2; // $600,000 - $400,000
  if (v >= 200_000) return 3; // $400,000 - $200,000
  return 4; // $200,000 - $0
}

const PAYMENT_BUCKET_LABELS = [
  "$1,000,000 - $800,000",
  "$800,000 - $600,000",
  "$600,000 - $400,000",
  "$400,000 - $200,000",
  "$200,000 - $0",
];

export default function SponsorEditor({ workspaceRoot = "", sponsorDataPath = "" }: { workspaceRoot?: string; sponsorDataPath?: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | null>(null);

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [dirty, setDirty] = useState<boolean>(false);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("name");

  // Multi-delete mode (matches wrestler editor behavior)
  const [multiDeleteMode, setMultiDeleteMode] = useState<boolean>(false);
  const [multiDeleteSelected, setMultiDeleteSelected] = useState<Set<number>>(new Set());

  // Filters (applied in addition to Search)
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [filterPaymentMin, setFilterPaymentMin] = useState<string>("");
  const [filterPaymentMax, setFilterPaymentMax] = useState<string>("");
  const [filterMoralityMin, setFilterMoralityMin] = useState<string>("");
  const [filterMoralityMax, setFilterMoralityMax] = useState<string>("");
  const [filterMoralityPreset, setFilterMoralityPreset] = useState<MoralityPreset>("");

  // Import Sponsor (from another sponsor.dat) — mirrors Wrestler Import behavior.
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importSourcePath, setImportSourcePath] = useState<string>("");
  const [importSourceBytes, setImportSourceBytes] = useState<Uint8Array | null>(null);
  const [importSourceSponsors, setImportSourceSponsors] = useState<Sponsor[]>([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());
  const [importSearch, setImportSearch] = useState<string>("");
  const [importInfo, setImportInfo] = useState<string>("");

  // External Editing (CSV) — mirrors Wrestler external editor behavior.
  const [externalEditingOpen, setExternalEditingOpen] = useState<boolean>(false);

  // Keep a text buffer for payment so users can type freely.
  // If we round to $1000 units on every keystroke, the value snaps and WebKit
  // (Tauri on macOS) may drop focus.
  const [paymentText, setPaymentText] = useState<string>("");

  const selected = sponsors[selectedIdx] ?? null;
  const canSave = Boolean(path && originalBytes && sponsors.length > 0 && dirty);

  // Sync payment text buffer whenever the selection or sponsor list changes.
  React.useEffect(() => {
    if (!selected) {
      setPaymentText("");
      return;
    }
    setPaymentText(String(paymentDollarsFromSponsor(selected)));
  }, [selectedIdx, sponsors]);

  function deleteSponsorAt(arrayIndex: number) {
    const target = sponsors[arrayIndex];
    if (!target) return;

    setSponsors((prev) => {
      setDirty(true);
      // Hard-delete: remove the record entirely (sponsor.dat is a simple
      // array of fixed-size records; the native editor compacts the file).
      const next = prev.filter((_, i) => i !== arrayIndex).map((s: any, i: number) => ({ ...s, index: i }));
      return next as any;
    });

    // Adjust selection to a valid row after deletion.
    setSelectedIdx((prevIdx) => {
      if (prevIdx < arrayIndex) return prevIdx;
      // If we deleted the currently-selected row (or a row before it), move up.
      const nextIdx = Math.max(0, prevIdx - 1);
      return Math.min(nextIdx, Math.max(0, sponsors.length - 2));
    });
  }

  function toggleMultiDeleteSelection(arrayIndex: number) {
    setMultiDeleteSelected((prev) => {
      const next = new Set(prev);
      if (next.has(arrayIndex)) next.delete(arrayIndex);
      else next.add(arrayIndex);
      return next;
    });
  }

  function exitMultiDeleteMode() {
    setMultiDeleteMode(false);
    setMultiDeleteSelected(new Set());
  }

  function deleteSelectedSponsors() {
    if (!multiDeleteSelected.size) {
      exitMultiDeleteMode();
      return;
    }

    const toDelete = new Set(multiDeleteSelected);

    setSponsors((prev) => {
      setDirty(true);
      const next = prev.filter((_, i) => !toDelete.has(i)).map((s: any, i: number) => ({ ...s, index: i }));
      return next as any;
    });

    // Move selection to the nearest valid record.
    setSelectedIdx((prevIdx) => {
      // How many deleted indices were before the current selection?
      let removedBefore = 0;
      toDelete.forEach((idx) => {
        if (idx < prevIdx) removedBefore++;
      });
      const nextIdx = Math.max(0, prevIdx - removedBefore);
      const nextLen = Math.max(0, sponsors.length - toDelete.size);
      return Math.min(nextIdx, Math.max(0, nextLen - 1));
    });

    exitMultiDeleteMode();
  }


  function addNewSponsor() {
    // Native EWR behavior: append a new 73-byte record at the end of the file,
    // but assign the smallest missing positive ID (fills gaps).
    if (!sponsors.length) {
      setError("Open sponsor.dat before adding a new sponsor.");
      return;
    }

    const used = new Set<number>();
    for (const s of sponsors) {
      const id = Number((s as any).id);
      if (Number.isFinite(id) && id > 0) used.add(id);
    }

    let nextId = 1;
    while (used.has(nextId)) nextId++;

    const newIndex = sponsors.length;

    const s: any = {
      index: newIndex,
      id: nextId,

      sponsorName: "",
      slogan: "",

      reservedU32_63: 0,
      moralityRaw: 0,
      paymentThousandsRaw: 0,
      reservedU16_71: 0,

      // Convenience normalized fields (match parser expectations)
      morality: 0,
      paymentDollars: 0,
    };

    setSponsors((prev) => [...prev, s]);
    setDirty(true);
    exitMultiDeleteMode();
    setSelectedIdx(newIndex);
    setPaymentText("0");
  }

  function copySponsorAt(arrayIndex: number) {
    const src = sponsors[arrayIndex];
    if (!src) return;

    if (!sponsors.length) {
      setError("Open sponsor.dat before copying a sponsor.");
      return;
    }

    // Assign smallest missing positive ID (same as Add New).
    const used = new Set<number>();
    for (const s of sponsors) {
      const id = Number((s as any).id);
      if (Number.isFinite(id) && id > 0) used.add(id);
    }
    let nextId = 1;
    while (used.has(nextId)) nextId++;

    // Create a unique sponsor name (EWR does not allow duplicates).
    const existing = new Set<string>(sponsors.map((s) => normalizeNameForUniq(sponsorNameFromSponsor(s))));
    const base = stripTrailingCopySuffix(sponsorNameFromSponsor(src));
    let newName = base;
    if (base.trim() !== "") {
      let k = 1;
      while (existing.has(normalizeNameForUniq(`${base} (${k})`))) k++;
      newName = `${base} (${k})`;
    }

    const newIndex = sponsors.length;

    const moralityRaw = clampInt(Number((src as any).moralityRaw), 0, 100);
    const paymentThousandsRaw = clampInt(Number((src as any).paymentThousandsRaw), 0, 1000);

    const copied: any = {
      // Keep schema-compatible keys
      index: newIndex,
      id: nextId,

      sponsorName: newName,
      slogan: String((src as any).slogan ?? ""),

      // Preserve reserved/unknown fields from the source record (safe)
      reservedU32_63: Number((src as any).reservedU32_63) || 0,
      moralityRaw,
      paymentThousandsRaw,
      reservedU16_71: Number((src as any).reservedU16_71) || 0,

      // Convenience normalized fields
      morality: moralityRaw,
      paymentDollars: paymentThousandsRaw * 1000,
    };

    setSponsors((prev) => [...prev, copied]);
    setDirty(true);
    exitMultiDeleteMode();
    setSelectedIdx(newIndex);
    setPaymentText(String(paymentDollarsFromSponsor(copied)));
  }

async function openSponsorsFromPath(p: string) {
  setError(null);
  try {
    const bytes = await readFile(p);
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    validateSponsorDatBytes(u8);

    const parsed = parseSponsorDat(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));

    setPath(p);
    setOriginalBytes(u8);
    setSponsors(parsed);
    exitMultiDeleteMode();

    // Populate payment field immediately on initial load.
    // Otherwise, when selectedIdx stays at 0, the selection-sync effect won't fire.
    setPaymentText(String(paymentDollarsFromSponsor(parsed[0] ?? ({} as any))));
    setSelectedIdx(0);
  } catch (e: any) {
    setError(e?.message ? String(e.message) : String(e));
  }
}

async function onLoadFromData() {
  if (!workspaceRoot || !sponsorDataPath) return;
  setError("");
  try {
    await openSponsorsFromPath(sponsorDataPath);
  } catch (e: any) {
    console.error(e);
    setError(`Load from DATA failed: ${e?.message ?? String(e)}`);
  }
}

  async function onSaveFile() {
    if (!originalBytes) return;
    setError(null);

    try {
      if (!path) throw new Error("No file loaded.");
      if (!sponsors.length) throw new Error("No sponsors loaded.");

      const outBytes = writeSponsorDat(originalBytes, sponsors);
      validateSponsorDatBytes(outBytes);

      // Match wrestler.dat behavior: create a timestamped backup in the same folder,
      // then overwrite the loaded file path.
      const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
      const bakPath = buildEwresBackupPath(path, `.${ts}`);
      const bakDir = bakPath.slice(0, bakPath.lastIndexOf("/"));
      await mkdir(bakDir, { recursive: true });
      const alreadyBak = await exists(bakPath);
      if (!alreadyBak) await copyFile(path, bakPath);

      await writeFile(path, outBytes);
      setOriginalBytes(outBytes);
      setDirty(false);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
    }
  }

  async function onImportSponsor() {
    try {
      if (!originalBytes || !sponsors.length) {
        setError("Load sponsor.dat first.");
        return;
      }

      const chosen = await open({
        title: "Import Sponsor(s)",
        multiple: false,
        filters: [{ name: "EWR sponsor.dat", extensions: ["dat"] }],
      });

      if (!chosen) return;
      const p = String(chosen);
      const bytes = await readFile(p);
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

      validateSponsorDatBytes(u8);
      const parsed = parseSponsorDat(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));

      // Mark importability (blank name / already exists) and sort importable first, then A→Z by name.
      const existingNames = new Set(sponsors.map((s) => normalizeNameForUniq(sponsorNameFromSponsor(s))));
      const annotated = parsed.map((s: any) => {
        const name = sponsorNameFromSponsor(s).trim();
        if (!name) return { ...s, __importable: false, __importReason: "blank name" };
        if (existingNames.has(normalizeNameForUniq(name))) return { ...s, __importable: false, __importReason: "already exists" };
        return { ...s, __importable: true, __importReason: "" };
      });

      const sorted = [...annotated].sort((a: any, b: any) => {
        const ai = !!a.__importable;
        const bi = !!b.__importable;
        if (ai !== bi) return ai ? -1 : 1;
        return sponsorNameFromSponsor(a).toLowerCase().localeCompare(sponsorNameFromSponsor(b).toLowerCase());
      });

      setImportSourcePath(p);
      setImportSourceBytes(u8);
      setImportSourceSponsors(sorted);
      setImportSelection(new Set());
      setImportSearch("");
      setImportInfo("");
      setImportModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setError(`Import load failed: ${e?.message ?? String(e)}`);
    }
  }

  function toggleImportSelection(sourceIndex: number, checked: boolean) {
    setImportSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceIndex);
      else next.delete(sourceIndex);
      return next;
    });
  }

  function closeImportModal() {
    setImportModalOpen(false);
    setImportInfo("");
    setImportSelection(new Set());
    setImportSearch("");
    setImportSourceSponsors([]);
    setImportSourceBytes(null);
    setImportSourcePath("");
  }

  function commitImportSelected() {
    try {
      if (!originalBytes || !sponsors.length) {
        setError("Load sponsor.dat first.");
        return;
      }
      if (!importSourceBytes) {
        setImportInfo("No import file loaded.");
        return;
      }
      if (importSelection.size === 0) {
        setImportInfo("Select at least one sponsor to import.");
        return;
      }

      const existingNames = new Set(sponsors.map((s) => normalizeNameForUniq(sponsorNameFromSponsor(s))));

      // IDs: native behavior uses smallest missing positive ID (fills gaps)
      const usedIds = new Set<number>();
      for (const s of sponsors) {
        const id = Number((s as any).id);
        if (Number.isFinite(id) && id > 0) usedIds.add(id);
      }
      let nextId = 1;
      while (usedIds.has(nextId)) nextId++;

      const selected = importSourceSponsors.filter((s: any) => importSelection.has(s.index));

      const imported: any[] = [];
      const skippedDupes: string[] = [];
      const skippedEmpty: string[] = [];

      for (const src of selected) {
        const name = sponsorNameFromSponsor(src).trim();
        const key = normalizeNameForUniq(name);

        if (!name) {
          skippedEmpty.push("(blank)");
          continue;
        }
        if (existingNames.has(key)) {
          skippedDupes.push(name);
          continue;
        }

        // Find next available id
        while (usedIds.has(nextId)) nextId++;
        const id = nextId;
        usedIds.add(id);
        nextId++;

        const moralityRaw = clampInt(Number((src as any).moralityRaw), 0, 100);
        const paymentThousandsRaw = clampInt(Number((src as any).paymentThousandsRaw), 0, 1000);

        const out: any = {
          index: sponsors.length + imported.length,
          id,

          sponsorName: name,
          slogan: String((src as any).slogan ?? ""),

          reservedU32_63: Number((src as any).reservedU32_63) || 0,
          moralityRaw,
          paymentThousandsRaw,
          reservedU16_71: Number((src as any).reservedU16_71) || 0,

          morality: moralityRaw,
          paymentDollars: paymentThousandsRaw * 1000,
        };

        imported.push(out);
        existingNames.add(key);
      }

      if (imported.length === 0) {
        const msg =
          skippedDupes.length || skippedEmpty.length
            ? `Nothing imported. Duplicates: ${skippedDupes.length}. Skipped: ${skippedEmpty.length}.`
            : "Nothing imported.";
        setImportInfo(msg);
        return;
      }

      setSponsors((prev) => [...prev, ...imported]);
      setDirty(true);
      exitMultiDeleteMode();
      setSelectedIdx(imported[0].index);
      setPaymentText(String(paymentDollarsFromSponsor(imported[0])));

      // Match Wrestler import UX: do not show a global banner on successful import.
      // Users can simply hit Save File when ready.
      // (We still keep importInfo for validation errors inside the modal.)
      setError(null);
      closeImportModal();
    } catch (e: any) {
      console.error(e);
      setImportInfo(`Import failed: ${e?.message ?? String(e)}`);
    }
  }

  // ---------- External Editing (CSV) ----------
  // Header names are user-facing (more readable than camelCase) while still
  // matching the Wrestler editor concept of including Record # and ID.
  const CSV_HEADERS = ["Record Number", "Sponsor ID", "Sponsor Name", "Slogan", "Morality Level", "Payment"]; 

  function buildUsedSponsorIds(list: Sponsor[]): Set<number> {
    const used = new Set<number>();
    for (const s of list) {
      const id = Number((s as any).id);
      if (Number.isFinite(id) && id > 0) used.add(id);
    }
    return used;
  }

  function smallestMissingPositive(used: Set<number>): number {
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  function makeUniqueSponsorName(desired: string, existingLower: Set<string>, excludeIndex: number | null): string {
    const baseTrim = (desired ?? "").trim();
    if (!baseTrim) return "";

    const taken = new Set(existingLower);
    if (excludeIndex !== null) {
      const current = sponsors[excludeIndex];
      if (current) taken.delete(normalizeNameForUniq(sponsorNameFromSponsor(current)));
    }

    const key = normalizeNameForUniq(baseTrim);
    if (!taken.has(key)) return baseTrim;

    // If already ends with (N), strip so we can increment cleanly.
    const stem = stripTrailingCopySuffix(baseTrim);
    let k = 1;
    while (taken.has(normalizeNameForUniq(`${stem} (${k})`))) k++;
    return `${stem} (${k})`;
  }

  async function onExportSponsorCsv() {
    try {
      if (!originalBytes || !sponsors.length) {
        setError("Load sponsor.dat first.");
        return;
      }

      const defaultName = path ? path.replace(/\.dat$/i, ".csv") : "sponsors.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!outPath) return;

      const lines: string[] = [];
      lines.push(CSV_HEADERS.map(csvEscape).join(","));

      const sorted = [...sponsors].sort((a: any, b: any) => Number(a.index ?? 0) - Number(b.index ?? 0));
      for (const s of sorted as any[]) {
        const recNo = Number(s.index ?? 0);
        const id = Number(s.id ?? 0);
        const name = sponsorNameFromSponsor(s);
        const slogan = String(s.slogan ?? "");
        const morality = clampInt(Number(s.moralityRaw ?? 0), 0, 100);
        const pay = clampInt(paymentDollarsFromSponsor(s), 0, 1_000_000);

        const row = [recNo, id, name, slogan, morality, pay].map(csvEscape).join(",");
        lines.push(row);
      }

      await writeFile(outPath, withUtf8Bom(lines.join("\n")));
      setExternalEditingOpen(false);
      setError(null);
    } catch (e: any) {
      console.error(e);
      setError(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onImportSponsorCsv() {
    try {
      if (!originalBytes || !sponsors.length) {
        setError("Load sponsor.dat first.");
        return;
      }

      const picked = await open({
        title: "Import CSV",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!picked) return;
      const csvPath = Array.isArray(picked) ? picked[0] : picked;
      if (!csvPath) return;

      const bytes = await readFile(String(csvPath));
      const text = new TextDecoder().decode(bytes);
      const parsed = parseCsv(text);

      // Accept either the readable headers or camelCase equivalents.
      const actual = parsed.headers.map((h) => String(h ?? "").trim());

      const altHeaders = [
        ["recordNumber", "workerId", "sponsorName", "slogan", "moralityLevel", "payment"],
        ["recordNumber", "sponsorId", "sponsorName", "slogan", "moralityLevel", "payment"],
      ];

      const matchesPrimary = CSV_HEADERS.every((h) => actual.includes(h));
      const matchAlt = altHeaders.find((set) => set.every((h) => actual.includes(h))) ?? null;
      if (!matchesPrimary && !matchAlt) {
        throw new Error(
          `CSV headers do not match expected format. Expected: ${CSV_HEADERS.join(", ")} (plus optional camelCase equivalents).`
        );
      }

      const get = (row: CsvRecord, keyA: string, keyB?: string) => {
        const a = row[keyA];
        if (a !== undefined) return a;
        if (keyB) return row[keyB];
        return "";
      };

      const usedIds = buildUsedSponsorIds(sponsors);
      const existingNamesLower = new Set<string>(sponsors.map((s) => normalizeNameForUniq(sponsorNameFromSponsor(s))));

      let updated = 0;
      let added = 0;

      const nextList: any[] = sponsors.map((s: any, i: number) => ({ ...s, index: i }));

      for (const row of parsed.rows) {
        // Column lookup (supports both header styles)
        const recStr = matchesPrimary ? get(row, "Record Number", "recordNumber") : get(row, "recordNumber");
        const idStr = matchesPrimary ? get(row, "Sponsor ID", "sponsorId") : get(row, "sponsorId", "workerId");
        const nameStr = matchesPrimary ? get(row, "Sponsor Name", "sponsorName") : get(row, "sponsorName");
        const sloganStr = matchesPrimary ? get(row, "Slogan", "slogan") : get(row, "slogan");
        const moralityStr = matchesPrimary ? get(row, "Morality Level", "moralityLevel") : get(row, "moralityLevel");
        const paymentStr = matchesPrimary ? get(row, "Payment", "payment") : get(row, "payment");

        const recNo = parseIntOrNull(recStr);
        const sponsorId = parseIntOrNull(idStr);

        // Determine target record (prefer record number, then ID)
        let targetIdx: number | null = null;
        if (recNo !== null && Number.isFinite(recNo) && recNo >= 0 && recNo < nextList.length) {
          targetIdx = recNo;
        } else if (sponsorId !== null && Number.isFinite(sponsorId) && sponsorId > 0) {
          const found = nextList.findIndex((s) => Number((s as any).id) === sponsorId);
          if (found >= 0) targetIdx = found;
        }

        const moralityParsed = parseIntOrNull(moralityStr);
        const paymentParsed = parseIntOrNull(paymentStr);

        if (targetIdx !== null) {
          const cur = nextList[targetIdx];
          const patch: any = { ...cur };

          // Sponsor ID: update if provided and not colliding
          if (sponsorId !== null && Number.isFinite(sponsorId) && sponsorId > 0) {
            const currentId = Number((cur as any).id);
            if (sponsorId !== currentId && !usedIds.has(sponsorId)) {
              usedIds.delete(currentId);
              usedIds.add(sponsorId);
              patch.id = sponsorId;
            }
          }

          // Name: if provided, update and ensure uniqueness
          const desiredName = (nameStr ?? "").trim();
          if (desiredName) {
            const unique = makeUniqueSponsorName(desiredName, existingNamesLower, targetIdx);
            existingNamesLower.delete(normalizeNameForUniq(sponsorNameFromSponsor(cur)));
            existingNamesLower.add(normalizeNameForUniq(unique));
            patch.sponsorName = unique;
          }

          if ((sloganStr ?? "").trim() !== "") patch.slogan = sloganStr;

          if (moralityParsed !== null && Number.isFinite(moralityParsed)) {
            const m = clampInt(moralityParsed, 0, 100);
            patch.moralityRaw = m;
            patch.morality = m;
          }

          if (paymentParsed !== null && Number.isFinite(paymentParsed)) {
            const dollars = clampInt(paymentParsed, 0, 1_000_000);
            const thousands = clampInt(Math.round(dollars / 1000), 0, 1000);
            patch.paymentThousandsRaw = thousands;
            patch.paymentDollars = thousands * 1000;
          }

          nextList[targetIdx] = patch;
          updated++;
          continue;
        }

        // Create new record
        const desiredName = (nameStr ?? "").trim();
        if (!desiredName) {
          // A new record without a name is useless; skip silently.
          continue;
        }

        let idToUse: number;
        if (sponsorId !== null && Number.isFinite(sponsorId) && sponsorId > 0 && !usedIds.has(sponsorId)) {
          idToUse = sponsorId;
        } else {
          idToUse = smallestMissingPositive(usedIds);
        }
        usedIds.add(idToUse);

        const uniqueName = makeUniqueSponsorName(desiredName, existingNamesLower, null);
        existingNamesLower.add(normalizeNameForUniq(uniqueName));

        const m = moralityParsed !== null && Number.isFinite(moralityParsed) ? clampInt(moralityParsed, 0, 100) : 0;
        const dollars = paymentParsed !== null && Number.isFinite(paymentParsed) ? clampInt(paymentParsed, 0, 1_000_000) : 0;
        const thousands = clampInt(Math.round(dollars / 1000), 0, 1000);

        const out: any = {
          index: nextList.length,
          id: idToUse,
          sponsorName: uniqueName,
          slogan: String(sloganStr ?? ""),
          reservedU32_63: 0,
          moralityRaw: m,
          paymentThousandsRaw: thousands,
          reservedU16_71: 0,
          morality: m,
          paymentDollars: thousands * 1000,
        };

        nextList.push(out);
        added++;
      }

      // Re-index
      for (let i = 0; i < nextList.length; i++) nextList[i].index = i;

      setSponsors(nextList as any);
      if (updated > 0 || added > 0) {
        setDirty(true);
      }
      exitMultiDeleteMode();
      setSelectedIdx(0);
      setPaymentText(String(paymentDollarsFromSponsor(nextList[0] ?? ({} as any))));
      setExternalEditingOpen(false);
      setError(null);

      // Keep behavior quiet like Wrestlers; no banner.
      // (If you want a subtle pill later, we can add it.)
      void updated;
      void added;
    } catch (e: any) {
      console.error(e);
      setError(`Import CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  function updateField<K extends keyof Sponsor>(key: K, value: Sponsor[K]) {
    if (!selected) return;

    setSponsors((prev) => {
      setDirty(true);
      const next = prev.slice();
      next[selectedIdx] = { ...next[selectedIdx], [key]: value };
      return next;
    });
  }

  function setMoralityPercent(v: number) {
    updateField("moralityRaw", clampInt(v, 0, 100));
  }

  function setPaymentDollars(v: number) {
    // sponsor.dat stores payment in $1000 units (u16). Keep UI in dollars.
    const dollars = clampInt(v, 0, 1_000_000);
    const thousands = clampInt(Math.round(dollars / 1000), 0, 1000);
    updateField("paymentThousandsRaw", thousands);
  }

  function commitPaymentText() {
    if (!selected) return;
    const raw = String(paymentText ?? "");
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(parsed)) {
      // Revert on invalid input.
      setPaymentText(String(paymentDollarsFromSponsor(selected)));
      return;
    }
    setPaymentDollars(parsed);
    // After commit, snap display to the normalized dollars value.
    setPaymentText(String(clampInt(parsed, 0, 1_000_000)));
  }

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterPaymentMin.trim() !== "") n++;
    if (filterPaymentMax.trim() !== "") n++;
    if (filterMoralityMin.trim() !== "") n++;
    if (filterMoralityMax.trim() !== "") n++;
    if (filterMoralityPreset) n++;
    return n;
  }, [filterPaymentMin, filterPaymentMax, filterMoralityMin, filterMoralityMax, filterMoralityPreset]);

  function clearAllFilters() {
    setFilterPaymentMin("");
    setFilterPaymentMax("");
    setFilterMoralityMin("");
    setFilterMoralityMax("");
    setFilterMoralityPreset("");
  }

  const renderFilterPanel = (onClose: () => void) => (
    <div className="ewr-filterPanel">
      <div className="ewr-filterHeaderRow">
        <div className="ewr-filterTitle">Filter options</div>
        <div className="ewr-filterHeaderActions">
          <button type="button" className="ewr-button ewr-buttonSmall ewr-buttonApply" onClick={onClose}>
            Apply
          </button>
          <button type="button" className="ewr-button ewr-buttonSmall" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="ewr-filterGrid">
        <div className="ewr-field">
          <div className="ewr-label">Payment ($) (0–1,000,000)</div>
          <div className="ewr-rangeRow">
            <input
              className="ewr-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={1_000_000}
              step={1000}
              placeholder="Min"
              value={filterPaymentMin}
              onChange={(e) => setFilterPaymentMin(e.target.value)}
            />
            <input
              className="ewr-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={1_000_000}
              step={1000}
              placeholder="Max"
              value={filterPaymentMax}
              onChange={(e) => setFilterPaymentMax(e.target.value)}
            />
          </div>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Morality preset</div>
          <EwrSelectCompat
            className="ewr-input"
            value={filterMoralityPreset}
            onChange={(e) => {
              const v = e.target.value as MoralityPreset;
              setFilterMoralityPreset(v);
              if (v === "low") {
                setFilterMoralityMin("0");
                setFilterMoralityMax("33");
              } else if (v === "normal") {
                setFilterMoralityMin("34");
                setFilterMoralityMax("66");
              } else if (v === "high") {
                setFilterMoralityMin("67");
                setFilterMoralityMax("100");
              }
            }}
          >
            <option value="">Any</option>
            <option value="low">Low Morality (0–33)</option>
            <option value="normal">Normal Morality (34–66)</option>
            <option value="high">High Morality (67–100)</option>
          </EwrSelectCompat>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Morality (0–100)</div>
          <div className="ewr-rangeRow">
            <input
              className="ewr-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              placeholder="Min"
              value={filterMoralityMin}
              onChange={(e) => {
                setFilterMoralityMin(e.target.value);
                if (filterMoralityPreset) setFilterMoralityPreset("");
              }}
            />
            <input
              className="ewr-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              placeholder="Max"
              value={filterMoralityMax}
              onChange={(e) => {
                setFilterMoralityMax(e.target.value);
                if (filterMoralityPreset) setFilterMoralityPreset("");
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const listItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    const base = sponsors.map((s, arrayIndex) => {
      const name = sponsorNameFromSponsor(s);
      const slogan = String(s.slogan ?? "");
      const payment = paymentDollarsFromSponsor(s);
      const morality = Number(s.moralityRaw ?? 0);
      const recIndex = Number((s as any).index ?? arrayIndex);
      return { arrayIndex, recIndex, name, slogan, payment, morality };
    });

    // Search
    let filtered = q
      ? base.filter((it) => (it.name + " " + it.slogan + " " + it.recIndex).toLowerCase().includes(q))
      : base;

    // Filters
    const pMin = filterPaymentMin.trim() === "" ? null : clampInt(Number(filterPaymentMin), 0, 1_000_000);
    const pMax = filterPaymentMax.trim() === "" ? null : clampInt(Number(filterPaymentMax), 0, 1_000_000);
    const mMin = filterMoralityMin.trim() === "" ? null : clampInt(Number(filterMoralityMin), 0, 100);
    const mMax = filterMoralityMax.trim() === "" ? null : clampInt(Number(filterMoralityMax), 0, 100);

    if (pMin !== null) filtered = filtered.filter((it) => it.payment >= pMin);
    if (pMax !== null) filtered = filtered.filter((it) => it.payment <= pMax);
    if (mMin !== null) filtered = filtered.filter((it) => it.morality >= mMin);
    if (mMax !== null) filtered = filtered.filter((it) => it.morality <= mMax);

    const sorted = filtered.slice().sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      return a.arrayIndex - b.arrayIndex;
    });

    return sorted;
  }, [sponsors, search, sortMode, filterPaymentMin, filterPaymentMax, filterMoralityMin, filterMoralityMax, filterMoralityPreset]);

  const importFilteredSponsors = useMemo(() => {
    const q = importSearch.trim().toLowerCase();
    if (!q) return importSourceSponsors;
    return importSourceSponsors.filter((s: any) => {
      const name = sponsorNameFromSponsor(s);
      const slogan = String((s as any).slogan ?? "");
      const line = `${name} ${slogan} ${(s as any).index ?? ""}`.toLowerCase();
      return line.includes(q);
    });
  }, [importSourceSponsors, importSearch]);

  // EWR's native editor appears to display a *dense* sponsor ID that increments only
  // for non-empty records (skipping blank/deleted slots). We keep the raw header ID
  // intact for writing, but present this computed ID in the UI to match the native.
  const denseEwrIds = useMemo(() => {
    let next = 0;
    return sponsors.map((s) => {
      const name = String((s as any).sponsorName ?? (s as any).name ?? "").trim();
      const slogan = String((s as any).slogan ?? "").trim();
      const paymentThousands = Number((s as any).paymentThousandsRaw ?? (s as any).paymentThousands ?? 0);
      const morality = Number((s as any).moralityRaw ?? (s as any).morality ?? 0);

      // A "blank" record in sponsor.dat is typically all zeros / empty strings.
      const isBlank = name === "" && slogan === "" && paymentThousands === 0 && morality === 0;
      if (isBlank) return null;

      next += 1;
      return next;
    });
  }, [sponsors]);

  const sponsorAnalysis = useMemo(() => {
    // counts[bucketIndex][morality]
    const counts: Array<{ High: number; Normal: number; Low: number }> = Array.from({ length: 5 }, () => ({
      High: 0,
      Normal: 0,
      Low: 0,
    }));

    for (const s of sponsors) {
      const name = String((s as any).sponsorName ?? (s as any).name ?? "").trim();
      const slogan = String((s as any).slogan ?? "").trim();
      const paymentThousands = Number((s as any).paymentThousandsRaw ?? (s as any).paymentThousands ?? 0);
      const mor = Number((s as any).moralityRaw ?? (s as any).morality ?? 0);

      const isBlank = name === "" && slogan === "" && paymentThousands === 0 && mor === 0;
      if (isBlank) continue;

      const pay = paymentThousands * 1000;
      const b = paymentBucketIndex(pay);
      const m = moralityBucket(mor);
      counts[b][m] += 1;
    }

    return counts.map((row, idx) => ({
      range: PAYMENT_BUCKET_LABELS[idx],
      high: row.High,
      normal: row.Normal,
      low: row.Low,
    }));
  }, [sponsors]);

  const headerTitle = selected ? `Editing: ${sponsorNameFromSponsor(selected).trim() || "(blank)"}` : "Sponsors";
  const fileStatus = path ? "sponsor.dat loaded" : "No file loaded";

  return (
    <>
      {error ? (
        <div className="ewr-error" style={{ margin: "12px 16px 0" }}>
          <div className="ewr-error-title">Error</div>
          <div className="ewr-error-body">{error}</div>
        </div>
      ) : null}

      <div className="ewr-app">
        {/* LEFT PANEL */}
        <div className="ewr-panel ewr-left">
          <div className="ewr-panelHeader">
            <LeftPanelFileActions
              title="Sponsors"
              subtitle="sponsor.dat"
              loadFromData={{
                disabled: !workspaceRoot || !sponsorDataPath,
                title: !workspaceRoot
                  ? "Select a DATA folder first"
                  : !sponsorDataPath
                    ? "sponsor.dat not found in DATA folder"
                    : "Load sponsor.dat from DATA folder",
                onClick: onLoadFromData,
                label: "Load from DATA",
              }}              closeFile={{
                onClick: async () => {
                  if (!path && !sponsors.length) return;
                  if (dirty) {
                    const ok = window.confirm("You have unsaved changes. Save before closing?\n\nOK = Save, Cancel = Close without saving");
                    if (ok) {
                      await onSaveFile();
                      if (dirty) return;
                    }
                  }
                  setPath(null);
                  setOriginalBytes(null);
                  setSponsors([]);
                  setSelectedIdx(0);
                  setSearch("");
                  setError(null);
                  setDirty(false);
                },
                label: "Close File",
                disabled: !path && !sponsors.length,
                title: !path && !sponsors.length ? "No file loaded" : "Close sponsor.dat",
              }}
              saveFile={{
                disabled: !canSave,
                title: !canSave ? "Load sponsor.dat first" : "Save changes to sponsor.dat",
                onClick: onSaveFile,
                label: "Save File",
              }}
            />

<div className="ewr-divider" />

          </div>

          <div className="ewr-leftMiddle ewr-scroll">
            <div className="ewr-leftBody">
              <LeftPanelSearchHeader
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search (name / slogan / index)"
                sortValue={sortMode}
                onSortChange={(v) => setSortMode(v as SortMode)}
                sortOptions={[
                  { value: "index", label: "Sort: Index" },
                  { value: "name", label: "Sort: Name" },
                ]}
                showingCount={listItems.length}
                totalCount={sponsors.length}
                filtersOpen={filtersOpen}
                activeFilterCount={activeFilterCount}
                onToggleFilters={() => setFiltersOpen((v) => !v)}
                onClearFilters={clearAllFilters}
                clearFiltersDisabled={activeFilterCount === 0}
              />

              {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
            </div>

            

            <div style={{ padding: "0 14px 14px" }}>
              {listItems.map((it) => {
                const isSelected = selectedIdx === it.arrayIndex;
                const name = it.name.trim() || "(blank)";
                const checked = multiDeleteSelected.has(it.arrayIndex);

                return (
                  <LeftPanelNameCard
                    key={`${it.arrayIndex}-${it.recIndex}`}
                    name={name}
                    isSelected={isSelected}
                    leading={
                      multiDeleteMode ? (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleMultiDeleteSelection(it.arrayIndex);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${name} for deletion`}
                        />
                      ) : null
                    }
                    onSelect={() => {
                      setSelectedIdx(it.arrayIndex);
                    }}
                    onCopy={() => {
                      copySponsorAt(it.arrayIndex);
                    }}
                    onDelete={() => {
                      deleteSponsorAt(it.arrayIndex);
                    }}
                    copyTitle="Copy sponsor"
                    deleteTitle="Delete sponsor"
                    showActions={true}
                  />
                );
              })}

              {!sponsors.length ? <div className="ewr-muted" style={{ padding: "10px 4px" }}>Open sponsors.dat to begin.</div> : null}
            </div>
          </div>

<LeftPanelActionGrid
  buttons={[
    {
      key: "add",
      icon: <IconPlus className="btnSvg" />,
      label: "Add New Sponsor",
      onClick: () => addNewSponsor(),
      title: "Add a new sponsor",
    },
    {
      key: "multi",
      icon: <IconChecklist className="btnSvg" />,
      label: multiDeleteMode
        ? multiDeleteSelected.size > 0
          ? `Delete Selected (${multiDeleteSelected.size})`
          : "Cancel Multi-Delete"
        : "Multi-Delete",
      onClick: () => {
        if (!multiDeleteMode) {
          setMultiDeleteMode(true);
          setMultiDeleteSelected(new Set());
          return;
        }

        if (multiDeleteSelected.size === 0) {
          exitMultiDeleteMode();
          return;
        }

        deleteSelectedSponsors();
      },
      title: !multiDeleteMode
        ? "Enable multi-delete selection"
        : multiDeleteSelected.size > 0
          ? "Click again to delete selected sponsors"
          : "Disable multi-delete (no selection)",
      style: multiDeleteMode && multiDeleteSelected.size > 0
        ? { background: "rgba(255,70,70,0.18)", border: "1px solid rgba(255,70,70,0.60)" }
        : undefined,
    },
    {
      key: "import",
      icon: <IconImport className="btnSvg" />,
      label: "Import Sponsor",
      onClick: () => onImportSponsor(),
      title: "Import sponsor(s) from another sponsor.dat",
    },
    {
      key: "external",
      icon: <IconGrid className="btnSvg" />,
      label: "External Editing",
      className: "ewr-button ewr-buttonYellow",
      onClick: () => setExternalEditingOpen((v) => !v),
      title: "Export / import CSV for external editing",
    },
  ]}
  after={
    <>
      {multiDeleteMode ? (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="ewr-button ewr-buttonSmall"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => setMultiDeleteSelected(new Set(listItems.map((it) => it.arrayIndex)))}
            disabled={!listItems.length}
            title="Select all visible sponsors"
          >
            Select All
          </button>
          <button
            type="button"
            className="ewr-button ewr-buttonSmall"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => setMultiDeleteSelected(new Set())}
            disabled={!multiDeleteSelected.size}
            title="Clear selection"
          >
            Select None
          </button>
        </div>
      ) : null}

      {externalEditingOpen ? (
        <div className="ewr-externalMenu">
          <button
            type="button"
            className="ewr-button ewr-buttonSmall"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => onExportSponsorCsv()}
            disabled={!sponsors.length}
            title="Export sponsors to CSV"
          >
            Export CSV
          </button>

          <button
            type="button"
            className="ewr-button ewr-buttonSmall"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => onImportSponsorCsv()}
            disabled={!sponsors.length}
            title="Import sponsors from a CSV"
          >
            Import CSV
          </button>
        </div>
      ) : null}
    </>
  }
/>

        </div>

        {/* RIGHT PANEL */}
        <div className="ewr-panel ewr-main">
          <div className="ewr-mainHeader">
            <div className="ewr-mainTitleBar">{headerTitle}</div>

            <div className="ewr-mainMetaRow">
              <div className="ewr-pillRow">
                <div className="ewr-pill">Category: Sponsors</div>
                <div className="ewr-pill">
                  Loaded: <b>{sponsors.length}</b>
                </div>
                {selected ? (
                  <div className="ewr-pill">
                    Record <b>#{selectedIdx}</b> — ID{" "}
                    <b title={`Raw ID: ${Number((selected as any).id ?? 0)}`}>{denseEwrIds[selectedIdx] ?? "—"}</b>
                  </div>
                ) : null}
              </div>

              <div className="ewr-pillRow">
                <div className="ewr-pill">{fileStatus}</div>
                <div className="ewr-pill">Sponsor Editor</div>
              </div>
            </div>
          </div>

          <div className="ewr-mainBody ewr-mainBodyScroll">
            {!selected ? (
              <div className="ewr-muted">Open sponsors.dat to begin.</div>
            ) : (
              <>
                <div className="ewr-section">
                  <div className="ewr-sectionHeader">
                    <div className="ewr-sectionTitle">Identity</div>
                  </div>
                  <div className="ewr-sectionBody">
                    <div className="ewr-grid ewr-gridAuto">
                      <div className="ewr-field">
                        <div className="ewr-label">Sponsor Name (20)</div>
                        <input
                          className="ewr-input"
                          value={sponsorNameFromSponsor(selected)}
                          onChange={(e) => updateField("sponsorName" as any, e.target.value)}
                          maxLength={20}
                        />
                      </div>

                      <div className="ewr-field">
                        <div className="ewr-label">Slogan (40)</div>
                        <input
                          className="ewr-input"
                          value={String(selected.slogan ?? "")}
                          onChange={(e) => updateField("slogan", e.target.value)}
                          maxLength={40}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ewr-section">
                  <div className="ewr-sectionHeader">
                    <div className="ewr-sectionTitle">Contract</div>
                  </div>
                  <div className="ewr-sectionBody">
                    <div className="ewr-grid ewr-gridAuto">
                      <div className="ewr-field">
                        <div className="ewr-label">Morality (0–100)</div>
                        <input
                          className="ewr-input"
                          type="number"
                          inputMode="numeric"
                          value={Number(selected.moralityRaw ?? 0)}
                          onChange={(e) => setMoralityPercent(Number(e.target.value))}
                          min={0}
                          max={100}
                        />
                        <div className="ewr-hint">Higher morality = cleaner sponsor.</div>
                      </div>

                      <div className="ewr-field">
                        <div className="ewr-label">Payment ($) (0–1,000,000)</div>
                        <input
                          className="ewr-input"
                          type="number"
                          inputMode="numeric"
                          value={paymentText}
                          onChange={(e) => {
                            // Let users type freely; commit on blur/enter.
                            setPaymentText(e.target.value);
                          }}
                          onBlur={() => commitPaymentText()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              commitPaymentText();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          min={0}
                          max={1_000_000}
                          step={1000}
                        />
                        <div className="ewr-hint">
                          Stored as u16le thousands ($1000 units). Display: {currency(paymentDollarsFromSponsor(selected))}.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ewr-section">
                  <div className="ewr-sectionHeader">
                    <div className="ewr-sectionTitle">Sponsor Analysis</div>
                  </div>
                  <div className="ewr-sectionBody">
                    <div className="ewr-analysisTable" role="table" aria-label="Sponsor analysis table">
                      <div className="ewr-analysisRow ewr-analysisHeader" role="row">
                        <div className="ewr-analysisCell ewr-analysisCell--range" role="columnheader">
                          Payment
                        </div>
                        <div className="ewr-analysisCell" role="columnheader">
                          High Morality
                        </div>
                        <div className="ewr-analysisCell" role="columnheader">
                          Normal Morality
                        </div>
                        <div className="ewr-analysisCell" role="columnheader">
                          Low Morality
                        </div>
                      </div>

                      {sponsorAnalysis.map((r) => (
                        <div className="ewr-analysisRow" role="row" key={r.range}>
                          <div className="ewr-analysisCell ewr-analysisCell--range" role="cell">
                            {r.range}
                          </div>
                          <div className="ewr-analysisCell" role="cell">
                            {r.high}
                          </div>
                          <div className="ewr-analysisCell" role="cell">
                            {r.normal}
                          </div>
                          <div className="ewr-analysisCell" role="cell">
                            {r.low}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="ewr-hint" style={{ marginTop: 10 }}>
                      Morality buckets: High (67–100), Normal (34–66), Low (0–33). Payment buckets match the original EWR
                      editor ranges.
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {importModalOpen ? createPortal(
        <div className="ewr-modalOverlay" onMouseDown={closeImportModal} role="dialog" aria-modal="true">
          <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ewr-modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">Import Sponsor</div>
                <div className="ewr-modalSub">
                  Source:{" "}
                  <span className="ewr-mono">
                    {importSourcePath ? importSourcePath.split(/[\\/]/).pop() : ""}
                  </span>
                </div>
              </div>

              <button type="button" className="ewr-iconBtn" title="Close" onClick={closeImportModal} aria-label="Close">
                ×
              </button>
            </div>

            <div className="ewr-modalBody">
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  className="ewr-input"
                  placeholder="Filter sponsors by name…"
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                  style={{ flex: 1 }}
                />

                <button
                  type="button"
                  className="ewr-button ewr-buttonSmall"
                  onClick={() => setImportSelection(new Set(importFilteredSponsors.map((s: any) => Number(s.index))))}
                  disabled={!importFilteredSponsors.length}
                >
                  Select All
                </button>

                <button
                  type="button"
                  className="ewr-button ewr-buttonSmall"
                  onClick={() => {
                    setImportSearch("");
                    setImportSelection(new Set());
                  }}
                  disabled={!importSearch && !importSelection.size}
                >
                  Clear
                </button>
              </div>

              <div className="ewr-modalList">
                {importFilteredSponsors.map((s: any) => {
                  const name = sponsorNameFromSponsor(s).trim() || "(blank)";
                  const checked = importSelection.has(Number(s.index));
                  const importable = !!(s as any).__importable;
                  const reason = String((s as any).__importReason || "");
                  const disabled = !importable;
                  const badgeLabel = disabled ? "Blocked" : "Importable";
                  const badgeStyle: React.CSSProperties = disabled
                    ? {
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontWeight: 900,
                        fontSize: 11,
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: "rgba(220, 38, 38, 0.18)",
                        color: "rgba(255,255,255,0.95)",
                        marginLeft: 10,
                      }
                    : {
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontWeight: 900,
                        fontSize: 11,
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: "rgba(34, 197, 94, 0.16)",
                        color: "rgba(255,255,255,0.95)",
                        marginLeft: 10,
                      };
                  return (
                    <label key={String(s.index)} className="ewr-importRow" style={{ opacity: disabled ? 0.55 : 1 }}>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        onChange={(e) => toggleImportSelection(Number(s.index), e.target.checked)}
                      />
                      <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span>
                          {name}
                          <span style={badgeStyle}>{badgeLabel}</span>
                        </span>
                        {disabled && reason ? <span className="ewr-muted">{reason}</span> : null}
                      </span>
                    </label>
                  );
                })}

                {!importFilteredSponsors.length ? (
                  <div className="ewr-muted" style={{ padding: 10 }}>
                    No matches.
                  </div>
                ) : null}
              </div>

              {importInfo ? <div className="ewr-importInfo">{importInfo}</div> : null}
            </div>

            <div className="ewr-modalFooter">
              <div className="ewr-muted" style={{ marginRight: "auto" }}>
                Selected: {importSelection.size} / {importSourceSponsors.length}
              </div>
              <button type="button" className="ewr-button" onClick={closeImportModal}>
                Cancel
              </button>

              <button
                type="button"
                className="ewr-button ewr-buttonOrange"
                onClick={commitImportSelected}
                disabled={importSelection.size === 0}
              >
                Import Selected
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}