// src/App.tsx

import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { List, type RowComponentProps } from "react-window";

import schemaJson from "./ewr/wrestler_dat_schema.json";
import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { validateWrestlerDatBytes } from "./ewr/validateWrestlerDat";
import { writeWrestlerDat } from "./ewr/writeWrestlerDat";
import { GIMMICKS } from "./ewr/gimmicks";
import { GIMMICK_REQUIREMENT_RULES, type GimmickRequirementRule } from "./ewr/gimmickRequirements";
import { parsePromosDat, type Promo, type PromoRecord } from "./ewr/parsePromosDat";

import EwrSelectCompat from "./components/inputs/EwrSelectCompat";
// Tauri v2 plugins
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, exists, copyFile, mkdir } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";

// Logo
import ewrLogo from "./assets/ewr_edit_logo.png";

import homeLogo from "./assets/logo_transparent.png";
import joshBio from "./assets/josh_bio.jpg";
import trackingBanner from "./assets/banner_tracking.png";
import skinPreview from "./assets/skin_preview.png";
import SponsorEditor from "./SponsorEditor";
import StaffEditor from "./StaffEditor";
import TeamsEditor from "./TeamsEditor";
import StablesEditor from "./StablesEditor";
import PromotionsEditor from "./PromotionsEditor";
import AlterEgosEditor from "./AlterEgosEditor";
import RelationshipsEditor from "./RelationshipsEditor";
import BeltsEditor from "./BeltsEditor";
import NetworksEditor from "./NetworksEditor";
import EventsEditor from "./EventsEditor";
import TelevisionEditor from "./TelevisionEditor";
import GameInfoEditor from "./GameInfoEditor";
import CrankyVinceEditor from "./CrankyVinceEditor";

import { parseTeamsDat, type Team } from "./ewr/parseTeamsDat";
import { validateTeamsDatBytes } from "./ewr/validateTeamsDat";
import { parseRelateDat, type RelateRecord } from "./ewr/parseRelateDat";
import { validateRelateDatBytes } from "./ewr/validateRelateDat";
import { writeTeamsDat } from "./ewr/writeTeamsDat";
import { parseStablesDat, type Stable } from "./ewr/parseStablesDat";
import { validateStablesDatBytes } from "./ewr/validateStablesDat";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";

// Gimmick dropdown: display by name and sort alphabetically, while keeping IDs intact.
// If multiple gimmicks share the same name, append the ID to disambiguate.
const GIMMICKS_ALPHA: { id: number; name: string }[] = (() => {
  const counts = new Map<string, number>();
  for (const g of GIMMICKS as any) {
    const nm = String((g as any).name ?? "").trim();
    counts.set(nm, (counts.get(nm) ?? 0) + 1);
  }

  const arr = [...(GIMMICKS as any)].map((g) => ({ id: Number(g.id) | 0, name: String(g.name ?? "").trim() }));
  arr.sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an === "none" && bn !== "none") return -1;
    if (bn === "none" && an !== "none") return 1;
    return an.localeCompare(bn);
  });
  return arr.map((g) => {
    const c = counts.get(g.name) ?? 0;
    return c > 1 ? { ...g, name: `${g.name} (ID ${g.id})` } : g;
  });
})();

const NATIONALITY_LABEL_TO_VALUE: Record<string, number> = { Other: 0, American: 1, Australian: 2, British: 3, Canadian: 4, European: 5, Japanese: 6, Mexican: 7 };
const WEIGHT_LABEL_TO_VALUE: Record<string, number> = { Heavyweight: 72, Lightweight: 76 };
const DISPOSITION_LABEL_TO_CODE: Record<string, string> = { Face: "F", Heel: "H", Tweener: "T" };
const POSITION_LABEL_TO_VALUE: Record<string, number> = { "Main Event": 1, Manager: 50 };

type GimmickRecommendationRow = {
  rule: GimmickRequirementRule;
  unmet: string[];
  employmentFixes: string[];
  profileFixes: string[];
  notes: string[];
  qualifiesNow: boolean;
  employmentOnly: boolean;
  autoDispositionCode?: string;
  autoPositionValue?: number;
};

// --- emergency crash overlay (shows errors inside the window) ---
// IMPORTANT: must be AFTER imports in ESM/TS projects.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("error", (e) => {
    document.body.innerHTML = `<pre style="white-space:pre-wrap;padding:16px;font-family:monospace;color:#fff;background:#000">
RUNTIME ERROR:
${String((e as any).message || (e as any).error || e)}
</pre>`;
  });

  window.addEventListener("unhandledrejection", (e: any) => {
    document.body.innerHTML = `<pre style="white-space:pre-wrap;padding:16px;font-family:monospace;color:#fff;background:#000">
UNHANDLED PROMISE:
${String(e?.reason?.message || e?.reason || e)}
</pre>`;
  });
}

const schema: any = schemaJson;


// ---------- helpers ----------
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// Concatenate two Uint8Arrays (used when appending new fixed-size records)
function concatByteArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}


function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function isTruthy16(v: any) {
  return Number(v) !== 0;
}

function setBool16(checked: boolean) {
  return checked ? 65535 : 0;
}

function setLowByteU16(oldVal: number, lowByte: number) {
  const hi = (oldVal & 0xff00) >>> 0;
  const lo = lowByte & 0xff;
  return (hi | lo) & 0xffff;
}

function truncateAscii(s: string, maxLen: number): string {
  if (!s) return "";
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

function sanitizePhotoBaseName(input: string): string {
  const s = (input ?? "").trim();
  const stripped = s.replace(/[.:*?"<>|\/\\]/g, "");
  return stripped.replace(/\s+/g, " ").trim();
}

function sanitizeAndTruncatePhotoBase(input: string): string {
  const sanitized = sanitizePhotoBaseName(input);
  return truncateAscii(sanitized, 20);
}

function stripImageExtension(name: string): string {
  const s = (name ?? "").trim();
  return s.replace(/\.(jpg|jpeg|png|gif)$/i, "");
}

/**
 * Native behavior observed:
 * - if base is empty OR base equals "None" (case-insensitive), write "None" exactly (no .jpg)
 * - otherwise append .jpg
 */
function normalizePhotoNameForWrite(inputBase: string) {
  const base = sanitizeAndTruncatePhotoBase(stripImageExtension(inputBase));
  if (!base) return "None";
  if (base.toLowerCase() === "none") return "None";
  return `${base}.jpg`;
}

function fullNameToUnderscore(fullName: string) {
  return (fullName ?? "").trim().replace(/\s+/g, "_");
}

const BELT_RECORD_SIZE = 457;

function readU16LE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function parseBeltDatForWrestlers(bytes: Uint8Array) {
  if (!bytes?.length) return [] as Array<{
    index: number;
    name: string;
    ownerPromoId: number;
    holder1Id: number;
    holder2Id: number;
    isSinglesTitle: boolean;
    womensTitle: boolean;
    lightweightTitle: boolean;
    suspended: boolean;
    image: number;
  }>;
  if (bytes.length % BELT_RECORD_SIZE !== 0) {
    throw new Error(`belt.dat size invalid: ${bytes.length} bytes (expected multiple of ${BELT_RECORD_SIZE})`);
  }

  const out: Array<{
    index: number;
    name: string;
    ownerPromoId: number;
    holder1Id: number;
    holder2Id: number;
    isSinglesTitle: boolean;
    womensTitle: boolean;
    lightweightTitle: boolean;
    suspended: boolean;
    image: number;
  }> = [];

  for (let i = 0; i < bytes.length / BELT_RECORD_SIZE; i++) {
    const base = i * BELT_RECORD_SIZE;
    const rawName = new TextDecoder("latin1").decode(bytes.slice(base + 1, base + 31));
    const name = (rawName ?? "").replace(/\u0000/g, "").trimEnd().trim() || "(blank name)";
    const isSinglesTitle = readU16LE(bytes, base + 31) === 0xffff;
    const ownerPromoId = readU16LE(bytes, base + 33);
    const holder1Id = readU16LE(bytes, base + 35);
    const holder2Id = readU16LE(bytes, base + 37);
    const lightweightTitle = readU16LE(bytes, base + 39) === 0xffff;
    const womensTitle = readU16LE(bytes, base + 41) === 0xffff;
    const image = clamp(readU16LE(bytes, base + 43), 0, 100);
    const suspended = readU16LE(bytes, base + 45) === 0xffff;
    out.push({
      index: i,
      name,
      ownerPromoId,
      holder1Id,
      holder2Id: isSinglesTitle ? 0 : holder2Id,
      isSinglesTitle,
      womensTitle,
      lightweightTitle,
      suspended,
      image,
    });
  }
  return out;
}

// ---------- finisher type ----------
function decodeFinisherTypeFromABC(Araw: number, Braw: number, Craw: number): string {
  const a = Araw !== 0;
  const b = Braw !== 0;
  const c = Craw !== 0;

  if (!a && !b && !c) return "Impact";
  if (a && !b && !c) return "Submission";
  if (a && b && !c) return "Top Rope Standing";
  if (!a && b && !c) return "Top Rope";
  if (!a && !b && c) return "Ground";
  if (!a && b && c) return "Corner";

  return "Impact";
}

function encodeFinisherTypeToABC(type: string): { A: number; B: number; C: number } {
  switch (type) {
    case "Submission":
      return { A: 65535, B: 0, C: 0 };
    case "Top Rope Standing":
      return { A: 65535, B: 65535, C: 0 };
    case "Top Rope":
      return { A: 0, B: 65535, C: 0 };
    case "Ground":
      return { A: 0, B: 0, C: 65535 };
    case "Corner":
      return { A: 0, B: 65535, C: 65535 };
    case "Impact":
    default:
      return { A: 0, B: 0, C: 0 };
  }
}

// ---------- CSV helpers ----------
type CsvRecord = Record<string, string>;

function csvEscape(value: any): string {
  const s = (value ?? "").toString();
  if (/[",\n\r]/.test(s)) {
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

function makeReverseMap(map: Record<string, string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    out[String(v).trim().toLowerCase()] = Number(k);
  }
  return out;
}

function parseYesNo(v: string): boolean | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  // Accept numeric truthy/falsey (e.g. legacy exports using 255 / 65535)
  const asNum = Number(s);
  if (Number.isFinite(asNum)) return asNum !== 0;
  if (["y", "yes", "true", "1"].includes(s)) return true;
  if (["n", "no", "false", "0"].includes(s)) return false;
  return null;
}

function makeOptionsFromMapping(mapping: Record<string, any> | undefined, fallback: Record<string, string>) {
  const obj = mapping && Object.keys(mapping).length ? mapping : fallback;
  return Object.entries(obj)
    .map(([k, v]) => ({ value: Number(k), label: String(v) }))
    .sort((a, b) => a.value - b.value);
}

const fallbackBirthMonths: Record<string, string> = {
  "0": "Unknown",
  "1": "January",
  "2": "February",
  "3": "March",
  "4": "April",
  "5": "May",
  "6": "June",
  "7": "July",
  "8": "August",
  "9": "September",
  "10": "October",
  "11": "November",
  "12": "December",
};

const fallbackNationalities: Record<string, string> = {
  "0": "Other",
  "1": "American",
  "2": "Australian",
  "3": "British",
  "4": "Canadian",
  "5": "European",
  "6": "Japanese",
  "7": "Mexican",
};

const weightOptions = [
  { value: 72, label: "Heavyweight" },
  { value: 76, label: "Lightweight" },
];

const finisherTypeOptions = ["Impact", "Submission", "Top Rope Standing", "Top Rope", "Ground", "Corner"];

// Key helpers
function getNum(w: any, ...keys: string[]): number {
  for (const k of keys) {
    if (w && k in w && typeof w[k] === "number") return Number(w[k]);
  }
  return 0;
}
function getStr(w: any, ...keys: string[]): string {
  for (const k of keys) {
    if (w && k in w && typeof w[k] === "string") return String(w[k]);
  }
  return "";
}
function hasKey(w: any, key: string) {
  return w && Object.prototype.hasOwnProperty.call(w, key);
}
function setNumPatch(w: any, preferred: string, fallback: string, value: number) {
  if (hasKey(w, preferred)) return { [preferred]: value };
  if (hasKey(w, fallback)) return { [fallback]: value };
  return { [preferred]: value };
}
function setStrPatch(w: any, preferred: string, fallback: string, value: string) {
  if (hasKey(w, preferred)) return { [preferred]: value };
  if (hasKey(w, fallback)) return { [fallback]: value };
  return { [preferred]: value };
}

// Numeric input that supports typing + arrows (commit on blur/enter)
function NumberInput(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  const { value, min, max, step = 1, onChange, className } = props;
  const [draft, setDraft] = useState<string>(String(value));

  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      type="number"
      className={className}
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        const clamped = clamp(n, min, max);
        setDraft(String(clamped));
        onChange(clamped);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

// ---------- small "grid cell" inputs (commit on blur/enter, low overhead) ----------
type GridNavRequest =
  | { kind: "tab"; shift: boolean }
  | { kind: "enter"; shift: boolean }
  | { kind: "arrow"; key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" };

function GridNumberCell(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;

  // spreadsheet nav
  gridRowPos?: number; // row index in gridRows
  gridColPos?: number; // col index in editable columns
  onNav?: (rowPos: number, colPos: number, req: GridNavRequest) => void;
}) {
  const { value, min, max, step = 1, onCommit, gridRowPos, gridColPos, onNav } = props;
  const [draft, setDraft] = useState<string>(String(value));

  React.useEffect(() => setDraft(String(value)), [value]);

  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      data-grid-row={gridRowPos}
      data-grid-col={gridColPos}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        const clamped = clamp(n, min, max);
        setDraft(String(clamped));
        onCommit(clamped);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(String(value));
          (e.target as HTMLInputElement).blur();
          return;
        }

        if (e.key === "Tab" && onNav != null && gridRowPos != null && gridColPos != null) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          requestAnimationFrame(() => onNav(gridRowPos, gridColPos, { kind: "tab", shift: e.shiftKey }));
          return;
        }

        if (e.key === "Enter" && onNav != null && gridRowPos != null && gridColPos != null) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          requestAnimationFrame(() => onNav(gridRowPos, gridColPos, { kind: "enter", shift: e.shiftKey }));
          return;
        }

        const isNavChord =
          (e.ctrlKey || e.metaKey) &&
          (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight");
        if (isNavChord && onNav != null && gridRowPos != null && gridColPos != null) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          requestAnimationFrame(() => onNav(gridRowPos, gridColPos, { kind: "arrow", key: e.key as any }));
          return;
        }
      }}
      style={{
        width: "100%",
        height: 30,
        borderRadius: 10,
        padding: "6px 10px",
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.95)",
        outline: "none",
      }}
    />
  );
}

function GridTextCell(props: {
  value: string;
  maxLen: number;
  onCommit: (next: string) => void;

  // spreadsheet nav
  gridRowPos?: number;
  gridColPos?: number;
  onNav?: (rowPos: number, colPos: number, req: GridNavRequest) => void;
}) {
  const { value, maxLen, onCommit, gridRowPos, gridColPos, onNav } = props;
  const [draft, setDraft] = useState<string>(value);

  React.useEffect(() => setDraft(value), [value]);

  return (
    <input
      type="text"
      value={draft}
      maxLength={maxLen}
      data-grid-row={gridRowPos}
      data-grid-col={gridColPos}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = truncateAscii(draft ?? "", maxLen);
        setDraft(next);
        onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
          return;
        }

        if (e.key === "Tab" && onNav != null && gridRowPos != null && gridColPos != null) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          requestAnimationFrame(() => onNav(gridRowPos, gridColPos, { kind: "tab", shift: e.shiftKey }));
          return;
        }

        if (e.key === "Enter" && onNav != null && gridRowPos != null && gridColPos != null) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          requestAnimationFrame(() => onNav(gridRowPos, gridColPos, { kind: "enter", shift: e.shiftKey }));
          return;
        }

        const isNavChord =
          (e.ctrlKey || e.metaKey) &&
          (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight");
        if (isNavChord && onNav != null && gridRowPos != null && gridColPos != null) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          requestAnimationFrame(() => onNav(gridRowPos, gridColPos, { kind: "arrow", key: e.key as any }));
          return;
        }
      }}
      style={{
        width: "100%",
        height: 30,
        borderRadius: 10,
        padding: "6px 10px",
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.95)",
        outline: "none",
      }}
    />
  );
}

// ---------- icons ----------

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


function IconScissors(props: { className?: string }) {
  const { className } = props;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7a3 3 0 1 0 6 0a3 3 0 0 0-6 0Z" stroke="currentColor" strokeWidth="2" />
      <path d="M4 17a3 3 0 1 0 6 0a3 3 0 0 0-6 0Z" stroke="currentColor" strokeWidth="2" />
      <path d="M10 8.5l10 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 15.5l10-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconBack(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ---------- bytes helpers ----------
function setU16LE(bytes: Uint8Array, abs: number, value: number) {
  const v = clamp(Math.trunc(value), 0, 65535);
  bytes[abs] = v & 0xff;
  bytes[abs + 1] = (v >> 8) & 0xff;
}

function concatBytes(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sliceRemove(bytes: Uint8Array, start: number, end: number) {
  const out = new Uint8Array(bytes.length - (end - start));
  out.set(bytes.slice(0, start), 0);
  out.set(bytes.slice(end), start);
  return out;
}

/**
 * Employment strip offsets (record-local)
 * Derived from wrestler_employed.dat vs wrestler_unemployed.dat diff.
 */
const EMPLOYMENT_CLEAR: Array<{ off: number; value: number }> = [
  { off: 65, value: 0 },
  { off: 67, value: 0 },
  { off: 69, value: 0 },
  { off: 71, value: 78 },
  { off: 72, value: 111 },
  { off: 82, value: 0 },
  { off: 84, value: 0 },
  { off: 86, value: 0 },
  { off: 167, value: 0 },
  { off: 169, value: 0 },
  { off: 171, value: 0 },
];

function stripEmploymentInRecordBytes(recordBytes: Uint8Array) {
  for (const e of EMPLOYMENT_CLEAR) {
    if (e.off >= 0 && e.off < recordBytes.length) recordBytes[e.off] = e.value & 0xff;
  }
}

// ---------- copy naming ----------
function makeUniqueFullName(base: string, existing: Set<string>) {
  const trimmed = (base ?? "").trim();
  const b = trimmed || "New Worker";
  if (!existing.has(b.toLowerCase())) return b;

  for (let i = 1; i < 999; i++) {
    const candidate = `${b} (${i})`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${b} (copy)`;
}

// ---------- hook: measure element size (for list height) ----------
// Robust against environments where ResizeObserver can be flaky/late.
// We measure immediately (layout), on window resize, and via ResizeObserver when available.
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.floor(r.width);
    const h = Math.floor(r.height);
    if (w !== size.width || h !== size.height) setSize({ width: w, height: h });
  }, [size.width, size.height]);

  React.useLayoutEffect(() => {
    measure();

    const onWinResize = () => measure();
    window.addEventListener("resize", onWinResize);

    // Some WebViews don't fire ResizeObserver for flex children immediately;
    // keep RO but don't depend on it exclusively.
    let ro: ResizeObserver | null = null;
    const el = ref.current;

    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }

    // One extra tick after layout to catch late font/layout changes.
    const raf = requestAnimationFrame(() => measure());

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onWinResize);
      try {
        ro?.disconnect();
      } catch {}
    };
  }, [measure]);

  return { ref, size };
}


const SKILLS_ANALYSIS_FIELDS = [
  { key: "brawling", raw: "brawlingRaw", label: "Brawling" },
  { key: "speed", raw: "speedRaw", label: "Speed" },
  { key: "technical", raw: "technicalRaw", label: "Technical" },
  { key: "stiffness", raw: "stiffnessRaw", label: "Stiffness" },
  { key: "selling", raw: "sellingRaw", label: "Selling" },
  { key: "overness", raw: "overnessRaw", label: "Overness" },
  { key: "charisma", raw: "charismaRaw", label: "Charisma" },
  { key: "attitude", raw: "attitudeRaw", label: "Attitude" },
  { key: "behaviour", raw: "behaviourRaw", label: "Behavior" },
] as const;

type SkillsAnalysisPoint = {
  label: string;
  value: number;
  percentile: number;
};

function buildRadarPolygon(points: SkillsAnalysisPoint[], cx: number, cy: number, radius: number) {
  if (!points.length) return "";
  return points
    .map((point, index) => {
      const angle = (-Math.PI / 2) + (index / points.length) * Math.PI * 2;
      const scaled = radius * (clamp(point.percentile, 0, 100) / 100);
      const x = cx + Math.cos(angle) * scaled;
      const y = cy + Math.sin(angle) * scaled;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function SkillsAnalysisBarChart(props: { points: SkillsAnalysisPoint[]; workerName: string }) {
  const { points, workerName } = props;
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(18,34,87,0.96), rgba(8,20,58,0.98))",
        border: "1px solid rgba(110,150,255,0.35)",
        borderRadius: 18,
        padding: 18,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(255,255,255,0.96)" }}>{workerName}'s Skills Ratings</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.64)", textTransform: "uppercase", letterSpacing: 0.8 }}>
          Raw 0–100
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {points.map((point) => (
          <div
            key={point.label}
            style={{
              display: "grid",
              gridTemplateColumns: "170px minmax(0,1fr)",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(255,255,255,0.94)" }}>{point.label}</div>
            <div
              style={{
                position: "relative",
                height: 24,
                borderRadius: 0,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  width: `${clamp(point.value, 0, 100)}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, rgba(226,18,42,0.98), rgba(245,0,24,0.98))",
                  boxShadow: "0 0 12px rgba(255,0,40,0.2)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 8,
                  fontSize: 13,
                  fontWeight: 900,
                  color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                }}
              >
                {point.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsAnalysisRadarChart(props: { points: SkillsAnalysisPoint[] }) {
  const { points } = props;
  const size = 380;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 132;
  const rings = [20, 40, 60, 80, 100];
  const polygon = buildRadarPolygon(points, cx, cy, radius);

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(18,34,87,0.96), rgba(8,20,58,0.98))",
        border: "1px solid rgba(110,150,255,0.35)",
        borderRadius: 18,
        padding: 18,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(255,255,255,0.96)" }}>Percentile vs Loaded Wrestlers</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.64)", textTransform: "uppercase", letterSpacing: 0.8 }}>
          wrestler.dat file
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 132px", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: 360, height: "auto", overflow: "visible" }}>
            {rings.map((pct) => {
              const r = radius * (pct / 100);
              const pts = points
                .map((_, index) => {
                  const angle = (-Math.PI / 2) + (index / points.length) * Math.PI * 2;
                  const x = cx + Math.cos(angle) * r;
                  const y = cy + Math.sin(angle) * r;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ");
              return <polygon key={pct} points={pts} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />;
            })}

            {points.map((point, index) => {
              const angle = (-Math.PI / 2) + (index / points.length) * Math.PI * 2;
              const x = cx + Math.cos(angle) * radius;
              const y = cy + Math.sin(angle) * radius;
              const labelX = cx + Math.cos(angle) * (radius + 24);
              const labelY = cy + Math.sin(angle) * (radius + 24);
              const anchor = Math.abs(Math.cos(angle)) < 0.15 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
              return (
                <g key={point.label}>
                  <line x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
                  <text
                    x={labelX}
                    y={labelY}
                    fill="rgba(255,255,255,0.9)"
                    fontSize="11"
                    fontWeight="800"
                    textAnchor={anchor}
                    dominantBaseline="middle"
                  >
                    {point.label}
                  </text>
                </g>
              );
            })}

            <polygon points={polygon} fill="rgba(235, 19, 48, 0.28)" stroke="rgba(255, 62, 87, 0.96)" strokeWidth="3" />

            {points.map((point, index) => {
              const angle = (-Math.PI / 2) + (index / points.length) * Math.PI * 2;
              const scaled = radius * (clamp(point.percentile, 0, 100) / 100);
              const x = cx + Math.cos(angle) * scaled;
              const y = cy + Math.sin(angle) * scaled;
              return <circle key={`${point.label}-dot`} cx={x} cy={y} r={4.5} fill="#fff" stroke="rgba(255, 62, 87, 0.96)" strokeWidth="2" />;
            })}
          </svg>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {points.map((point) => (
            <div
              key={`${point.label}-legend`}
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.16)",
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(255,255,255,0.92)" }}>{point.label}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>{point.percentile}th percentile</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Comparative Skills Grid types ----------
type ViewMode = "profile" | "grid";

type GridSortKey =
  | "index"
  | "id"
  | "fullName"
  | "shortName"
  | "brawling"
  | "speed"
  | "technical"
  | "stiffness"
  | "selling"
  | "overness"
  | "charisma"
  | "attitude"
  | "behaviour";

type GridColumn = {
  key: GridSortKey;
  label: string;
  width: number;
  kind: "num" | "text";
  maxLen?: number;
  min?: number;
  max?: number;
};


// ---------- Left-panel Filters ----------
type GenderFilter = "" | "male" | "female";


type TriState = "" | "yes" | "no";
type SkillFilterKey = Exclude<GridSortKey, "index" | "id" | "fullName" | "shortName">;

type SkillRangeFilter = {
  id: string;
  key: SkillFilterKey;
  min: string; // allow empty while typing
  max: string; // allow empty while typing
};

const SKILL_FILTER_META: { key: SkillFilterKey; raw: string; label: string }[] = [
  { key: "brawling", raw: "brawlingRaw", label: "Brawling" },
  { key: "speed", raw: "speedRaw", label: "Speed" },
  { key: "technical", raw: "technicalRaw", label: "Technical" },
  { key: "stiffness", raw: "stiffnessRaw", label: "Stiffness" },
  { key: "selling", raw: "sellingRaw", label: "Selling" },
  { key: "overness", raw: "overnessRaw", label: "Overness" },
  { key: "charisma", raw: "charismaRaw", label: "Charisma" },
  { key: "attitude", raw: "attitudeRaw", label: "Attitude" },
  { key: "behaviour", raw: "behaviourRaw", label: "Behaviour" },
];

const FLAG_FILTER_META: { key: string; raw: string; label: string; divaOnly?: boolean }[] = [
  { key: "superstarLook", raw: "superstarLookRaw", label: "Superstar Look" },
  { key: "menacing", raw: "menacingRaw", label: "Menacing" },
  { key: "fonzFactor", raw: "fonzFactorRaw", label: "Fonz Factor" },
  { key: "highSpots", raw: "highSpotsRaw", label: "High Spots" },
  { key: "shootingAbility", raw: "shootingAbilityRaw", label: "Shooting Ability" },
  { key: "trainer", raw: "trainerRaw", label: "Trainer" },
  { key: "announcer", raw: "announcerRaw", label: "Announcer" },
  { key: "booker", raw: "bookerRaw", label: "Booker" },
  { key: "diva", raw: "divaRaw", label: "Diva", divaOnly: true },
];

type MassEditAction =
  | "photo_worker_name"
  | "photo_worker_underscore"
  | "set_birth_month"
  | "set_age"
  | "increase_age"
  | "decrease_age"
  | "clear_employment"
  | "set_gender"
  | "set_weight"
  | "set_nationality"
  | "set_speaks"
  | "set_wage"
  | "set_skill"
  | "increase_skill"
  | "decrease_skill"
  | "set_flag"
  | "set_short_term_morale_100"
  | "set_long_term_morale_100"
  | "set_condition_100";

const WRESTLER_FIELD_HELP: Record<string, string> = {
  "Short-Term Morale": "How happy the worker is right now. Higher morale helps keep workers content and performing well.",
  "Long-Term Morale": "How happy the worker is overall over time. Strong long-term morale makes them more likely to stay and less likely to become difficult.",
  "Condition": "How physically healthy the worker is. Low condition hurts match quality and increases injury risk.",
  "Brawling": "How good the worker is at producing strong brawling-style matches.",
  "Speed": "How good the worker is at producing strong speed-style matches.",
  "Technical": "How good the worker is at producing strong technical-style matches.",
  "Stiffness": "How hard and realistic their offense looks. Too high can hurt people, too low can look fake.",
  "Selling": "How well the worker makes the opponent's offense look painful and believable.",
  "Overness": "How much the crowd reacts to the worker. 0 means unknown, 100 means worldwide fame.",
  "Charisma": "Innate charisma covering promos, facial expressions, body language, and presence.",
  "Attitude": "The worker's in-ring attitude. Better attitude means they are easier to work with and more willing to do business.",
  "Behaviour": "The worker's out-of-ring behavior and how troublesome they are backstage or in public.",
  "Speaks": "Workers who cannot speak cannot do interviews.",
  "Nationality": "The worker's nationality. This affects gimmick fit and what promotions are more likely to hire them.",
  "Trainer": "If enabled, the worker may become a trainer after retirement.",
  "Superstar Look": "If enabled, the worker has more chance of getting over because they look like a star.",
  "Diva": "Female-only flag indicating the worker is photogenic.",
  "Announcer": "If enabled, the worker can do color commentary and may become a full-time announcer after retirement.",
  "Shooting Ability": "Indicates the worker has shoot fighting experience.",
  "Menacing": "Indicates the worker has an intimidating or threatening look. This mainly affects gimmicks.",
  "Fonz Factor": "Indicates a naturally cool charisma that makes the worker come off effortlessly cool.",
  "Booker": "If enabled, the worker may become an owner or road agent after retirement.",
  "High Spots": "If enabled, the worker is willing to take wild bumps and do dangerous stunts.",
};

const MASS_EDIT_ACTION_OPTIONS: { value: MassEditAction; label: string }[] = [
  { value: "photo_worker_name", label: 'Photo Name Becomes "Worker Name.jpg"' },
  { value: "photo_worker_underscore", label: 'Photo Name Becomes "Worker_Name.jpg"' },
  { value: "set_birth_month", label: "Set Birth Month" },
  { value: "set_age", label: "Set Wrestler Age" },
  { value: "increase_age", label: "Increase Wrestler Age By" },
  { value: "decrease_age", label: "Decrease Wrestler Age By" },
  { value: "clear_employment", label: "Clear Employment" },
  { value: "set_gender", label: "Set Gender" },
  { value: "set_weight", label: "Set Weight" },
  { value: "set_nationality", label: "Set Nationality" },
  { value: "set_speaks", label: "Set Speaks" },
  { value: "set_wage", label: "Set Wage" },
  { value: "set_skill", label: "Set [Skill]" },
  { value: "increase_skill", label: "Increase [Skill] By" },
  { value: "decrease_skill", label: "Decrease [Skill] By" },
  { value: "set_flag", label: "Set [Attribute Flag]" },
  { value: "set_short_term_morale_100", label: "Short-Term Morale = 100" },
  { value: "set_long_term_morale_100", label: "Long-Term Morale = 100" },
  { value: "set_condition_100", label: "Condition = 100" },
];

function computeStrictPhotoBaseFromFullName(fullName: string, useUnderscore: boolean): { ok: boolean; value?: string; reason?: string } {
  const source = useUnderscore ? fullNameToUnderscore(fullName) : String(fullName ?? "").trim();
  if (!source) return { ok: false, reason: "Full Name is empty." };
  const sanitized = sanitizePhotoBaseName(stripImageExtension(source));
  if (!sanitized) return { ok: false, reason: "Full Name becomes empty after sanitizing invalid filename characters." };
  if (sanitized.length > 20) return { ok: false, reason: `Profile Photo Name exceeds 20 characters after sanitizing (${sanitized.length}/20).` };
  return { ok: true, value: sanitized };
}

function parseMaybeInt(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function getWrestlerFieldHelp(label: string): string | null {
  return WRESTLER_FIELD_HELP[label] ?? null;
}
const GRID_COLUMNS: GridColumn[] = [
  { key: "index", label: "Record #", width: 90, kind: "num", min: 0, max: 99999 },
  { key: "id", label: "Worker ID", width: 90, kind: "num", min: 0, max: 65535 },
  { key: "fullName", label: "Full Name", width: 220, kind: "text", maxLen: 25 },
  { key: "shortName", label: "Short Name", width: 140, kind: "text", maxLen: 10 },
  { key: "brawling", label: "Brawling", width: 110, kind: "num", min: 0, max: 100 },
  { key: "speed", label: "Speed", width: 110, kind: "num", min: 0, max: 100 },
  { key: "technical", label: "Technical", width: 110, kind: "num", min: 0, max: 100 },
  { key: "stiffness", label: "Stiffness", width: 110, kind: "num", min: 0, max: 100 },
  { key: "selling", label: "Selling", width: 110, kind: "num", min: 0, max: 100 },
  { key: "overness", label: "Overness", width: 110, kind: "num", min: 0, max: 100 },
  { key: "charisma", label: "Charisma", width: 110, kind: "num", min: 0, max: 100 },
  { key: "attitude", label: "Attitude", width: 110, kind: "num", min: 0, max: 100 },
  { key: "behaviour", label: "Behaviour", width: 120, kind: "num", min: 0, max: 100 },
];

const GRID_TOTAL_WIDTH = GRID_COLUMNS.reduce((sum, c) => sum + c.width, 0);

// --- Employment enums (confirmed via wrestler.dat diffs) ---
const CONTRACT_OPTIONS: { label: string; code: string }[] = [
  { label: "None", code: "Non" },
  { label: "Open", code: "Opn" },
  { label: "Written", code: "Wri" },
];

// Touring codes are stored as 2 ASCII chars at recordStart+76. "None" is spaces (parsed as empty string).
// Confirmed codes: AJ, BJ, MP, NJ, NO, OP, PR, TM, WM, WJ, Z1
// NOTE: BattleArts and FMW may not persist in the native editor due to hidden stat requirements;
// we still include them for completeness.
const TOURING_OPTIONS: { label: string; code: string }[] = [
  { label: "None", code: "" },
  { label: "AJPW", code: "AJ" },
  { label: "BattleArts", code: "BA" },
  { label: "BJPW", code: "BJ" },
  { label: "FMW", code: "FM" },
  { label: "Michinoku Pro", code: "MP" },
  { label: "NJPW", code: "NJ" },
  { label: "NOAH", code: "NO" },
  { label: "Osaka Pro", code: "OP" },
  { label: "PRIDE", code: "PR" },
  { label: "Toryumon", code: "TM" },
  { label: "WMF", code: "WM" },
  { label: "World Japan", code: "WJ" },
  { label: "Zero-One", code: "Z1" },
];


// Employer slot enums (confirmed via wrestler.dat diffs)
const DISPOSITION_OPTIONS: { label: string; code: string }[] = [
  { label: "Face", code: "F" },
  { label: "Heel", code: "H" },
  { label: "Tweener", code: "T" },
];

// Position dropdown values are stored as a u8 at recordStart+82 for Employer #1
const POSITION_OPTIONS: { label: string; value: number }[] = [
  { label: "None", value: 0 },
  { label: "Main Event", value: 1 },
  { label: "Upper Midcard", value: 2 },
  { label: "Midcard", value: 3 },
  { label: "Lower Midcard", value: 4 },
  { label: "Opener", value: 5 },
  { label: "Jobber", value: 6 },
  { label: "Developmental Deal", value: 7 },
  { label: "Non-wrestler", value: 25 },
  { label: "Manager", value: 50 },
];


// Only the editable columns participate in spreadsheet-style navigation.
const GRID_EDITABLE_KEYS: GridSortKey[] = [
  "fullName",
  "shortName",
  "brawling",
  "speed",
  "technical",
  "stiffness",
  "selling",
  "overness",
  "charisma",
  "attitude",
  "behaviour",
];

const GRID_EDIT_COL_COUNT = GRID_EDITABLE_KEYS.length;

// ---------- component ----------
export default function App() {
  const birthMonthOptions = useMemo(
    () => makeOptionsFromMapping(schema?.mappings?.birthMonthRaw_lowByte, fallbackBirthMonths),
    []
  );
  const nationalityOptions = useMemo(
    () => makeOptionsFromMapping(schema?.mappings?.nationalityRaw, fallbackNationalities),
    []
  );

  const [filePath, setFilePath] = useState<string | null>(null);
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [wrestlersDirty, setWrestlersDirty] = useState<boolean>(false);
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number>(0);

  const workerNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const w of workers) {
      const anyW: any = w as any;
      const id = Number(anyW.id ?? 0) | 0;
      if (!id) continue;
      const name = String(anyW.fullName || anyW.shortName || `ID ${id}`).trim();
      m.set(id, name);
    }
    return m;
  }, [workers]);

  // Wrestler Profile: Overness quick-set UI
  const [overnessQuickSet, setOvernessQuickSet] = useState<string>("");

  useEffect(() => {
    // Reset Quick Set selection when switching records (avoids applying the wrong tier accidentally)
    setOvernessQuickSet("");
  }, [selectedRecordIndex]);

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"id" | "name">("name");

  // Filters (applied in addition to Search/Sort)
  const [filterNationality, setFilterNationality] = useState<number | "">("");
  const [filterGender, setFilterGender] = useState<GenderFilter>("");
  const [skillRangeFilters, setSkillRangeFilters] = useState<SkillRangeFilter[]>([
    { id: "sf-1", key: "brawling", min: "", max: "" },
  ]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);

  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);

  const [filterWageMin, setFilterWageMin] = useState<string>("");
  const [filterWageMax, setFilterWageMax] = useState<string>("");

  const [filterAgeMin, setFilterAgeMin] = useState<string>("");
  const [filterAgeMax, setFilterAgeMax] = useState<string>("");

  const [filterWeight, setFilterWeight] = useState<number | "">("");
  const [filterBirthMonth, setFilterBirthMonth] = useState<number | "">("");

  const [filterSpeaks, setFilterSpeaks] = useState<TriState>("");

  const [filterPrimaryFinisherType, setFilterPrimaryFinisherType] = useState<string>("");
  const [filterSecondaryFinisherType, setFilterSecondaryFinisherType] = useState<string>("");

  // Employment filters (Wrestlers)
  // Works For: "any" (no filter), "none" (no employers), or a promotion id
  const [filterWorksFor, setFilterWorksFor] = useState<"any" | "none" | number>("any");
  // Contract Type: "any" or internal codes "Wri" / "Opn" / "Non"
  const [filterContractType, setFilterContractType] = useState<"any" | "Wri" | "Opn" | "Non">("any");
  // Touring With: "any" (no filter), "none" (no touring), "jp_any" (any touring), or a specific 2-char code
  const [filterTouringWith, setFilterTouringWith] = useState<"any" | "none" | "jp_any" | string>("any");


  const [flagFilters, setFlagFilters] = useState<Record<string, TriState>>({
    superstarLook: "",
    menacing: "",
    fonzFactor: "",
    highSpots: "",
    shootingAbility: "",
    trainer: "",
    announcer: "",
    booker: "",
    diva: "",
  });

  const [status, setStatus] = useState<string>("");
  const [hoverHelp, setHoverHelp] = useState<{ label: string; text: string; x: number; y: number } | null>(null);
  const [photoWarn, setPhotoWarn] = useState<string>("");

  const [multiDeleteMode, setMultiDeleteMode] = useState<boolean>(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());
  const [massEditMode, setMassEditMode] = useState<boolean>(false);
  const [selectedForMassEdit, setSelectedForMassEdit] = useState<Set<number>>(new Set());
  const [massEditAutoOpenPending, setMassEditAutoOpenPending] = useState<boolean>(false);
  const [massEditAction, setMassEditAction] = useState<MassEditAction>("photo_worker_name");
  const [massEditValue, setMassEditValue] = useState<string>("");
  const [massEditAuxValue, setMassEditAuxValue] = useState<string>("brawling");
  const [massEditReportOpen, setMassEditReportOpen] = useState<boolean>(false);
  const [massEditReportTitle, setMassEditReportTitle] = useState<string>("");
  const [massEditReportRows, setMassEditReportRows] = useState<Array<{ name: string; reason: string }>>([]);

  const [viewMode, setViewMode] = useState<ViewMode>("profile");
  type Section =
    | "wrestlers"
    | "promotions"
    | "staff"| "belts"
    | "events"
    | "tagTeams"
    | "stables"
    | "tvNetworks"
    | "television"
    | "alterEgos"
    | "relationships"
    | "sponsors"
    | "gameInfo"
    | "crankyVince"
    | "home";

  /**
   * Top-level navigation.
   *
   * NOTE: Vite/esbuild does not typecheck by default, so a typo like using `s.id`
   * instead of `s.key` can slip through and break navigation at runtime.
   */
  const CORE_NAV: { key: Section; label: string }[] = [
    { key: "alterEgos", label: "Alter Egos" },
    { key: "belts", label: "Belts" },
    { key: "events", label: "Events" },
    { key: "promotions", label: "Promotions" },
    { key: "relationships", label: "Relationships" },
    { key: "sponsors", label: "Sponsors" },
    { key: "staff", label: "Staff" },
    { key: "stables", label: "Stables" },
    { key: "tagTeams", label: "Tag Teams" },
    { key: "television", label: "Television" },
    { key: "tvNetworks", label: "TV Networks" },
    { key: "wrestlers", label: "Wrestlers" },
  ];

  const BONUS_NAV: { key: Section; label: string }[] = [
    { key: "gameInfo", label: "Game Info" },
    { key: "crankyVince", label: "Cranky Vince" },
  ];


  const [section, setSection] = useState<Section>("home");
  const [visitedSections, setVisitedSections] = useState<Set<Section>>(() => new Set<Section>(["home"]));

  function activateSection(next: Section) {
    setSection(next);
    setVisitedSections((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
  }

// Workspace (DATA folder / save folder)
const [workspaceRoot, setWorkspaceRoot] = useState<string>("");
const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, string>>({});
const [isSaveWorkspace, setIsSaveWorkspace] = useState<boolean>(false);

  // promos.dat is used by Wrestlers Employment for employer names and roster splits.
  const [employmentPromos, setEmploymentPromos] = useState<Promo[]>([]);
  const [employmentPromoRecords, setEmploymentPromoRecords] = useState<PromoRecord[]>([]);
  const [gimmickRecSlot, setGimmickRecSlot] = useState<1 | 2 | 3 | null>(null);

  // teams.dat is used by Wrestlers Editor (Tag Teams section)
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoadError, setTeamsLoadError] = useState<string>("");

  // stables.dat is used by Wrestlers Editor (Stables section)
  const [stables, setStables] = useState<Stable[]>([]);
  const [stablesLoadError, setStablesLoadError] = useState<string>("");

  // belt.dat is used by Wrestlers Editor (Current Championships section)
  const [beltRecords, setBeltRecords] = useState<any[]>([]);
  const [beltLoadError, setBeltLoadError] = useState<string>("");

  // relate.dat is used by Wrestlers Editor (Relationships read-only section)
  const [relateRecords, setRelateRecords] = useState<RelateRecord[]>([]);
  const [relateLoadError, setRelateLoadError] = useState<string>("");

  const [picsFolderPath, setPicsFolderPath] = useState<string>("");
  const [photoPreviewPath, setPhotoPreviewPath] = useState<string>("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string>("");
  const [photoPreviewStatus, setPhotoPreviewStatus] = useState<string>("");
  const [saveContractFixStatusAction, setSaveContractFixStatusAction] = useState<"no_change" | "Available" | "Sitting Out Contract">("no_change");
  const [skillsAnalysisCollapsed, setSkillsAnalysisCollapsed] = useState(false);
  const photoPreviewObjectUrlRef = useRef<string>("");
  const promosKeyToIdRef = useRef<Map<string, number>>(new Map());
  const employmentPromoOptionsAlpha = useMemo(() => {
    const list = [...employmentPromos];
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
    return list;
  }, [employmentPromos]);

  const promosById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of employmentPromos) {
      const id = Number((p as any)?.id ?? 0) | 0;
      if (!id) continue;
      const name = String((p as any)?.name || (p as any)?.shortName || `ID ${id}`).trim();
      m.set(id, name);
    }
    return m;
  }, [employmentPromos]);

  function promoIdentityKey(p: { name?: string; shortName?: string }) {
    const name = (p.name ?? "").trim().toUpperCase();
    const init = (p.shortName ?? "").trim().toUpperCase();
    return `${name}__${init}`;
  }

  function clearEmploymentSlot(next: any, slot: 1 | 2 | 3) {
    next[`employer${slot}PromoId`] = 0;
    next[`employer${slot}PositionRaw`] = 0;
    next[`employer${slot}DispositionRaw`] = "F";
    next[`employer${slot}RosterRaw`] = "None";
    next[`employer${slot}ManagerId`] = 0;
    next[`employer${slot}GimmickId`] = 0;
  }

  function remapWorkerEmployersByPromos(prevWorker: any, idMap: Map<number, number>, newPromoCount: number) {
    const w = { ...prevWorker } as any;

    const contract = (String(w.contractCode ?? "Non")).trim();

    for (const slot of [1, 2, 3] as const) {
      const key = `employer${slot}PromoId`;
      const oldId = Number(w[key] ?? 0) | 0;
      if (!oldId) continue;

      let newId = oldId;
      if (idMap.has(oldId)) newId = idMap.get(oldId) || 0;
      else if (oldId > newPromoCount) newId = 0;

      if (newId === 0) {
        clearEmploymentSlot(w, slot);
      } else {
        w[key] = newId;
      }
    }

    const e1 = Number(w.employer1PromoId ?? 0) | 0;
    const e2 = Number(w.employer2PromoId ?? 0) | 0;
    const e3 = Number(w.employer3PromoId ?? 0) | 0;
    const anyEmployed = e1 || e2 || e3;

    // Mirror native behavior you observed:
    // - Contract None + any employer => Open
    // - Contract Written requires exclusive employer #1
    if (contract === "Non" && anyEmployed) {
      w.contractCode = "Opn";
    }

    if ((String(w.contractCode ?? "Non")).trim() === "Wri") {
      // Written: force slots 2/3 empty
      clearEmploymentSlot(w, 2);
      clearEmploymentSlot(w, 3);
      // If employer #1 was cleared, Written is invalid; fall back to None.
      if ((Number(w.employer1PromoId ?? 0) | 0) === 0) {
        w.contractCode = "Non";
      }
      // Touring not allowed for Written
      w.touringCode = "";
    }

    return w;
  }

  function handlePromosChanged(records: PromoRecord[]) {
    // Build the new Promo list used by dropdowns.
    const newPromos: Promo[] = records.map((r, i) => ({
      id: i + 1,
      name: (r.name ?? "").trim(),
      shortName: (r.initials ?? "").trim(),
    }));

    // Build key->id for the new file.
    const newKeyToId = new Map<string, number>();
    for (const p of newPromos) newKeyToId.set(promoIdentityKey(p), p.id);

    // Build oldId->newId mapping using identity keys.
    const oldKeyToId = promosKeyToIdRef.current;
    const idMap = new Map<number, number>();
    for (const [key, oldId] of oldKeyToId.entries()) {
      idMap.set(oldId, newKeyToId.get(key) || 0);
    }

    // Save snapshot for next remap.
    promosKeyToIdRef.current = newKeyToId;

    // Update promo state.
    setEmploymentPromoRecords(records);
    setEmploymentPromos(newPromos);

    // Remap wrestler employers to stay consistent when promotions are deleted/reordered.
    setWorkers((prev) => {
      if (!prev || prev.length === 0) return prev;
      return prev.map((w) => remapWorkerEmployersByPromos(w as any, idMap, records.length)) as any;
    });
  }


const WORKSPACE_VARIANTS: Record<string, string[]> = {
  wrestler: ["wrestler.dat", "wrestlers.dat"],
  sponsor: ["sponsor.dat", "sponsors.dat"],
  staff: ["staff.dat"],
  promos: ["promos.dat", "promo.dat"],
  teams: ["teams.dat", "team.dat"],
  stables: ["stables.dat", "stable.dat"],
  tv: ["tv.dat"],
  network: ["network.dat"],
  event: ["event.dat", "events.dat"],
  belt: ["belt.dat", "belts.dat"],
  alter: ["alter.dat", "alteregos.dat"],
  related: ["relate.dat", "related.dat", "relationships.dat", "relationship.dat"],
};

function wsHas(key: string) {
  return !!workspaceFiles[key];
}

function wsPath(key: string) {
  return workspaceFiles[key] || "";
}

async function cascadeDeleteTeamsByWorkerIds(workerIds: number[]): Promise<number> {
  try {
    if (!workspaceRoot) return 0;
    if (!wsHas("teams")) return 0;
    const teamsPath = wsPath("teams");
    if (!teamsPath) return 0;
    if (!workerIds?.length) return 0;

    const bytes = await readFile(teamsPath);
    validateTeamsDatBytes(bytes);
    const { teams } = parseTeamsDat(bytes);
    const idSet = new Set(workerIds);

    const filtered = teams.filter((t) => !idSet.has(t.partner1Id) && !idSet.has(t.partner2Id));
    const removed = teams.length - filtered.length;
    if (!removed) return 0;

    const nextBytes = writeTeamsDat(
      filtered.map((t, i) => ({ ...t, index: i })),
      bytes
    );
    await writeFile(teamsPath, nextBytes);
    return removed;
  } catch (e) {
    console.error(e);
    return 0;
  }
}

function joinPath(dir: string, fileName: string) {
  if (!dir) return fileName;
  const sep = dir.endsWith("/") || dir.endsWith("\\") ? "" : "/";
  return `${dir}${sep}${fileName}`;
}

function getDirName(filePath: string) {
  const s = String(filePath ?? "").trim();
  if (!s) return "";
  const normalized = s.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : "";
}

function getBaseName(filePath: string) {
  const s = String(filePath ?? "").trim();
  if (!s) return "";
  const normalized = s.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function stripExtension(fileName: string) {
  return String(fileName ?? "").replace(/\.[^.]+$/, "");
}

function guessImageMimeFromPath(filePath: string): string {
  const lower = String(filePath ?? "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  return "application/octet-stream";
}

async function findSiblingPicsFolder(dataDir: string): Promise<string> {
  const normalized = String(dataDir ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";

  const directSwap = normalized.replace(/\/DATA$/i, "/PICS");
  if (directSwap !== normalized) {
    try {
      if (await exists(directSwap)) return directSwap;
    } catch {
      // ignore
    }
  }

  const parent = getDirName(normalized);
  if (!parent) return "";
  for (const name of ["PICS", "Pics", "pics"]) {
    const candidate = joinPath(parent, name);
    try {
      if (await exists(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return "";
}

async function openDataFolder() {
  setStatus("");
  try {
    const picked = await open({ directory: true, multiple: false, title: "Select EWR DATA folder" });
    if (!picked) return;
    const dir = Array.isArray(picked) ? String(picked[0]) : String(picked);

    const found: Record<string, string> = {};
    for (const [key, variants] of Object.entries(WORKSPACE_VARIANTS)) {
      for (const fname of variants) {
        const full = joinPath(dir, fname);
        try {
          if (await exists(full)) {
            found[key] = full;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    setWorkspaceRoot(dir);
    setWorkspaceFiles(found);
  } catch (e: any) {
    console.error(e);
    setStatus(`Open DATA folder failed: ${e?.message ?? String(e)}`);
  }
}

  useEffect(() => {
    let cancelled = false;

    async function detectWorkspaceType() {
      if (!workspaceRoot) {
        setIsSaveWorkspace(false);
        return;
      }
      try {
        const gameInfoPath = joinPath(workspaceRoot, "gameinfo.dat");
        const hasGameInfo = await exists(gameInfoPath);
        if (!cancelled) setIsSaveWorkspace(!!hasGameInfo);
      } catch {
        if (!cancelled) setIsSaveWorkspace(false);
      }
    }

    void detectWorkspaceType();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  useEffect(() => {
    setSaveContractFixStatusAction("no_change");
  }, [selectedRecordIndex, section, filePath]);

  function toggleSelectedForMassEdit(recordIndex: number, checked: boolean) {
    setSelectedForMassEdit((prev) => {
      const next = new Set(prev);
      if (checked) next.add(recordIndex);
      else next.delete(recordIndex);
      return next;
    });
  }

  function clearEmploymentPatchForWorker() {
    const patch: any = {};
    patch.contractCode = "Non";
    patch.touringCode = "";
    patch.unsackableRaw = 0;
    patch.creativeControlRaw = 0;
    for (const slot of [1, 2, 3] as const) {
      patch[`employer${slot}PromoId`] = 0;
      patch[`employer${slot}PositionRaw`] = 0;
      patch[`employer${slot}Disposition`] = "F";
      patch[`employer${slot}Roster`] = "None";
      patch[`employer${slot}ManagerId`] = 0;
      patch[`employer${slot}GimmickId`] = 0;
    }
    return patch;
  }

  function closeMassEditModal() {
    setMassEditValue("");
    setMassEditAuxValue("brawling");
  }

  function openMassEditMode() {
    if (multiDeleteMode) {
      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
    }
    setMassEditMode(true);
    setSelectedForMassEdit(new Set());
    setMassEditAutoOpenPending(false);
    setStatus("Mass Edit mode enabled: tick workers to edit, then use the Mass Edit panel below.");
  }

  function closeMassEditMode() {
    setMassEditMode(false);
    setSelectedForMassEdit(new Set());
    setMassEditAutoOpenPending(false);
    setStatus("Mass Edit mode disabled.");
  }

  function applyMassEdit() {
    if (selectedForMassEdit.size === 0) {
      setStatus("Select at least one worker for Mass Edit.");
      return;
    }

    const selectedIndexes = new Set(selectedForMassEdit);
    const reportRows: Array<{ name: string; reason: string }> = [];
    let changedCount = 0;

    setWorkers((prev) => {
      const next = prev.map((worker: any) => {
        if (!selectedIndexes.has(worker.index)) return worker;
        const patch: any = {};
        let changed = false;
        const name = String(worker.fullName || worker.shortName || `Record #${worker.index}`).trim();

        const applyNum = (preferred: string, fallback: string, value: number) => {
          Object.assign(patch, setNumPatch(worker, preferred, fallback, value));
          changed = true;
        };
        const applyStr = (preferred: string, fallback: string, value: string) => {
          Object.assign(patch, setStrPatch(worker, preferred, fallback, value));
          changed = true;
        };

        switch (massEditAction) {
          case "photo_worker_name": {
            const result = computeStrictPhotoBaseFromFullName(getStr(worker, "fullName"), false);
            if (!result.ok || !result.value) {
              reportRows.push({ name, reason: result.reason || "Unable to generate Profile Photo Name." });
            } else {
              applyStr("photoName", "photoName", result.value);
            }
            break;
          }
          case "photo_worker_underscore": {
            const result = computeStrictPhotoBaseFromFullName(getStr(worker, "fullName"), true);
            if (!result.ok || !result.value) {
              reportRows.push({ name, reason: result.reason || "Unable to generate Profile Photo Name." });
            } else {
              applyStr("photoName", "photoName", result.value);
            }
            break;
          }
          case "set_birth_month":
            applyNum("birthMonthRaw", "birthMonth", clamp(Number(massEditValue) || 0, 0, 12));
            break;
          case "set_age":
            applyNum("ageRaw", "age", clamp(Number(massEditValue) || 0, 0, 70));
            break;
          case "increase_age":
            applyNum("ageRaw", "age", clamp((getNum(worker, "ageRaw", "age") & 0xff) + (Number(massEditValue) || 0), 0, 70));
            break;
          case "decrease_age":
            applyNum("ageRaw", "age", clamp((getNum(worker, "ageRaw", "age") & 0xff) - (Number(massEditValue) || 0), 0, 70));
            break;
          case "clear_employment":
            Object.assign(patch, clearEmploymentPatchForWorker());
            changed = true;
            break;
          case "set_gender": {
            const genderValue = massEditValue === "male" ? 65535 : 0;
            applyNum("genderRaw", "gender", genderValue);
            if (genderValue === 65535) applyNum("divaRaw", "diva", 0);
            break;
          }
          case "set_weight":
            applyNum("weightRaw", "weight", Number(massEditValue) || 72);
            break;
          case "set_nationality":
            applyNum("nationalityRaw", "nationality", Number(massEditValue) || 0);
            break;
          case "set_speaks":
            applyNum("speaksRaw", "speaks", setBool16(massEditValue === "yes"));
            break;
          case "set_wage": {
            const dollars = clamp(Number(massEditValue) || 0, 0, 300000);
            const thousands = Math.trunc(dollars / 1000);
            patch.wageDollars = dollars;
            Object.assign(patch, setNumPatch(worker, "wageThousandsRaw", "wageRaw", thousands));
            changed = true;
            break;
          }
          case "set_skill":
          case "increase_skill":
          case "decrease_skill": {
            const skillMeta = SKILL_FILTER_META.find((m) => m.key === massEditAuxValue);
            if (skillMeta) {
              const current = clamp(getNum(worker, skillMeta.raw, skillMeta.key), 0, 100);
              const delta = Number(massEditValue) || 0;
              const nextValue = massEditAction === "set_skill"
                ? clamp(delta, 0, 100)
                : massEditAction === "increase_skill"
                  ? clamp(current + delta, 0, 100)
                  : clamp(current - delta, 0, 100);
              applyNum(skillMeta.raw, skillMeta.key, nextValue);
            }
            break;
          }
          case "set_short_term_morale_100":
            applyNum("shortTermMorale", "shortTermMorale", 100);
            break;
          case "set_long_term_morale_100":
            applyNum("longTermMorale", "longTermMorale", 100);
            break;
          case "set_condition_100":
            applyNum("conditionRaw", "condition", 100);
            break;
          case "set_flag": {
            const flagMeta = FLAG_FILTER_META.find((m) => m.key === massEditAuxValue);
            if (flagMeta) {
              const boolValue = massEditValue === "yes";
              if (flagMeta.divaOnly && boolValue && getNum(worker, "genderRaw", "gender") === 65535) {
                reportRows.push({ name, reason: `${flagMeta.label} can only be enabled for female workers.` });
              } else {
                applyNum(flagMeta.raw, flagMeta.key, setBool16(boolValue));
              }
            }
            break;
          }
        }

        if (!changed) return worker;
        changedCount += 1;
        const updated = { ...worker, ...patch };
        return updated;
      });
      return next as any;
    });

    if (changedCount > 0) setWrestlersDirty(true);
    closeMassEditModal();
    closeMassEditMode();

    if (reportRows.length) {
      setMassEditReportTitle("Mass Edit report");
      setMassEditReportRows(reportRows);
      setMassEditReportOpen(true);
    }

    setStatus(
      reportRows.length
        ? `Mass Edit applied to ${changedCount} worker(s). ${reportRows.length} worker(s) were skipped.`
        : `Mass Edit applied to ${changedCount} worker(s).`
    );
  }

  useEffect(() => {
    if (!massEditMode && massEditAutoOpenPending) {
      setMassEditAutoOpenPending(false);
    }
  }, [massEditMode, massEditAutoOpenPending]);

function clearDataFolder() {
  setWorkspaceRoot("");
  setWorkspaceFiles({});
}

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("ewr_wrestlers_pics_folder") || "";
      if (stored) setPicsFolderPath(stored);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      if (picsFolderPath) window.localStorage.setItem("ewr_wrestlers_pics_folder", picsFolderPath);
      else window.localStorage.removeItem("ewr_wrestlers_pics_folder");
    } catch {
      // ignore
    }
  }, [picsFolderPath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (picsFolderPath || !workspaceRoot) return;
      const found = await findSiblingPicsFolder(workspaceRoot);
      if (!cancelled && found) setPicsFolderPath(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, picsFolderPath]);

  // Auto-load promos.dat (if present) so Wrestlers employment dropdowns can show real names/splits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const promosPath = wsPath("promos");
        if (!promosPath) {
          if (!cancelled) {
            setEmploymentPromos([]);
            setEmploymentPromoRecords([]);
          }
          return;
        }

        const bytes = await readFile(promosPath);
        const { records } = parsePromosDat(bytes);

        if (!cancelled) {
          // Use the same handler the Promotions editor uses so we keep a snapshot for remapping.
          handlePromosChanged(records);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setEmploymentPromos([]);
          setEmploymentPromoRecords([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFiles]);

  // Auto-load teams.dat (if present) so Wrestlers editor can show Tag Teams for the selected worker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const teamsPath = wsPath("teams");
        if (!teamsPath) {
          if (!cancelled) {
            setTeams([]);
            setTeamsLoadError("");
          }
          return;
        }

        const bytes = await readFile(teamsPath);
        validateTeamsDatBytes(bytes);
        const parsed = parseTeamsDat(bytes);

        if (!cancelled) {
          setTeams(parsed.teams);
          setTeamsLoadError("");
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setTeams([]);
          setTeamsLoadError(e?.message ? String(e.message) : "Failed to load teams.dat");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFiles]);

  // Auto-load stables.dat (if present) so Wrestlers editor can show Stables for the selected worker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stablesPath = wsPath("stables");
        if (!stablesPath) {
          if (!cancelled) {
            setStables([]);
            setStablesLoadError("");
          }
          return;
        }

        const bytes = await readFile(stablesPath);
        validateStablesDatBytes(bytes);
        const parsed = parseStablesDat(bytes);

        if (!cancelled) {
          setStables(parsed.stables);
          setStablesLoadError("");
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setStables([]);
          setStablesLoadError(e?.message ? String(e.message) : "Failed to load stables.dat");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFiles]);

  // Auto-load belt.dat (if present) so Wrestlers editor can show Current Championships for the selected worker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const beltPath = wsPath("belt");
        if (!beltPath) {
          if (!cancelled) {
            setBeltRecords([]);
            setBeltLoadError("");
          }
          return;
        }

        const bytes = await readFile(beltPath);
        const parsed = parseBeltDatForWrestlers(bytes);
        if (!cancelled) {
          setBeltRecords(parsed);
          setBeltLoadError("");
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setBeltRecords([]);
          setBeltLoadError(e?.message ? String(e.message) : "Failed to load belt.dat");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFiles]);

  // Auto-load relate.dat (if present) so Wrestlers editor can show Relationships for the selected worker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const relatePath = wsPath("related");
        if (!relatePath) {
          if (!cancelled) {
            setRelateRecords([]);
            setRelateLoadError("");
          }
          return;
        }

        const bytes = await readFile(relatePath);
        validateRelateDatBytes(bytes);
        const parsed = parseRelateDat(bytes);

        if (!cancelled) {
          setRelateRecords(parsed);
          setRelateLoadError("");
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setRelateRecords([]);
          setRelateLoadError(e?.message ? String(e.message) : "Failed to load relate.dat");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFiles]);


  const [gridSearch, setGridSearch] = useState<string>("");
  const [gridFiltersOpen, setGridFiltersOpen] = useState<boolean>(false);
  const [gridSort, setGridSort] = useState<{ key: GridSortKey; dir: "asc" | "desc" }>({ key: "id", dir: "asc" });

  // Skills comparison (Profile view)
  const [compareInput, setCompareInput] = useState<string>("None");
  const [compareRecordIndex, setCompareRecordIndex] = useState<number | null>(null);
  const [compareOpen, setCompareOpen] = useState<boolean>(false);
  const [compareActive, setCompareActive] = useState<number>(0);
  const compareInputRef = useRef<HTMLInputElement | null>(null);

  // Prevent mis-positioned dropdowns when scrolling/resize (and avoid WebKit stacking quirks)
  useEffect(() => {
    if (!compareOpen) return;
    const close = () => setCompareOpen(false);
    // capture scroll from any nested container
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [compareOpen]);


  // Import Worker (from another wrestler.dat)
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importSourcePath, setImportSourcePath] = useState<string>("");
  const [importSourceBytes, setImportSourceBytes] = useState<Uint8Array | null>(null);
  const [importSourceWorkers, setImportSourceWorkers] = useState<Worker[]>([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());
  const [importSearch, setImportSearch] = useState<string>("");
  const [importInfo, setImportInfo] = useState<string>("");


  // External Editing (CSV)
  const [externalEditingOpen, setExternalEditingOpen] = useState<boolean>(false);

  type CsvRowError = { row: number; field: string; message: string };
  type CsvUpdatePlan = { targetIndex: number; patch: Partial<Worker> };
  type CsvNewRowPlan = { data: Partial<Worker> & { fullName: string } };

  const [csvModalOpen, setCsvModalOpen] = useState<boolean>(false);
  const [csvSourcePath, setCsvSourcePath] = useState<string>("");
  const [csvRowCount, setCsvRowCount] = useState<number>(0);
  const [csvPlannedUpdates, setCsvPlannedUpdates] = useState<CsvUpdatePlan[]>([]);
  const [csvPlannedNewRows, setCsvPlannedNewRows] = useState<CsvNewRowPlan[]>([]);
  const [csvSkippedDuplicates, setCsvSkippedDuplicates] = useState<string[]>([]);
  const [csvInvalidRows, setCsvInvalidRows] = useState<CsvRowError[]>([]);
  const [csvImportInfo, setCsvImportInfo] = useState<string>("");

  const selectedWorker = useMemo(() => {
    const found = workers.find((w: any) => w.index === selectedRecordIndex);
    return found ?? workers[0] ?? null;
  }, [workers, selectedRecordIndex]);

  const skillsAnalysisData = useMemo<SkillsAnalysisPoint[]>(() => {
    if (!selectedWorker) return [];

    return SKILLS_ANALYSIS_FIELDS.map((field) => {
      const value = clamp(getNum(selectedWorker as any, field.raw, field.key), 0, 100);
      const values = workers
        .map((worker) => clamp(getNum(worker as any, field.raw, field.key), 0, 100))
        .filter((n) => Number.isFinite(n));

      if (!values.length) {
        return { label: field.label, value, percentile: 0 };
      }

      const belowOrEqual = values.filter((n) => n <= value).length;
      const percentile = clamp(Math.round((belowOrEqual / values.length) * 100), 0, 100);
      return { label: field.label, value, percentile };
    });
  }, [selectedWorker, workers]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const currentPhotoName = String((selectedWorker as any)?.photoName ?? "").trim();
      const normalizedBase = sanitizeAndTruncatePhotoBase(stripImageExtension(currentPhotoName));

      if (!picsFolderPath) {
        if (!cancelled) {
          if (photoPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(photoPreviewObjectUrlRef.current);
            photoPreviewObjectUrlRef.current = "";
          }
          setPhotoPreviewPath("");
          setPhotoPreviewUrl("");
          setPhotoPreviewStatus("Set the global PICS folder to preview worker images.");
        }
        return;
      }

      if (!normalizedBase || normalizedBase.toLowerCase() === "none") {
        if (!cancelled) {
          if (photoPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(photoPreviewObjectUrlRef.current);
            photoPreviewObjectUrlRef.current = "";
          }
          setPhotoPreviewPath("");
          setPhotoPreviewUrl("");
          setPhotoPreviewStatus("This worker is set to None for Profile Photo Name.");
        }
        return;
      }

      const candidates = [
        joinPath(picsFolderPath, `${normalizedBase}.jpg`),
        joinPath(picsFolderPath, `${normalizedBase}.jpeg`),
        joinPath(picsFolderPath, `${normalizedBase}.png`),
        joinPath(picsFolderPath, `${normalizedBase}.gif`),
        joinPath(picsFolderPath, `${normalizedBase}.bmp`),
        joinPath(picsFolderPath, normalizedBase),
      ];

      for (const candidate of candidates) {
        try {
          if (await exists(candidate)) {
            const bytes = await readFile(candidate);
            const blob = new Blob([bytes], { type: guessImageMimeFromPath(candidate) });
            const objectUrl = URL.createObjectURL(blob);

            if (!cancelled) {
              if (photoPreviewObjectUrlRef.current) {
                URL.revokeObjectURL(photoPreviewObjectUrlRef.current);
              }
              photoPreviewObjectUrlRef.current = objectUrl;
              setPhotoPreviewPath(candidate);
              setPhotoPreviewUrl(objectUrl);
              setPhotoPreviewStatus("");
            } else {
              URL.revokeObjectURL(objectUrl);
            }
            return;
          }
        } catch {
          // ignore
        }
      }

      if (!cancelled) {
        if (photoPreviewObjectUrlRef.current) {
          URL.revokeObjectURL(photoPreviewObjectUrlRef.current);
          photoPreviewObjectUrlRef.current = "";
        }
        setPhotoPreviewPath("");
        setPhotoPreviewUrl("");
        setPhotoPreviewStatus(`Image not found in PICS folder for "${normalizedBase}".`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [picsFolderPath, selectedWorker]);

  useEffect(() => {
    return () => {
      if (photoPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(photoPreviewObjectUrlRef.current);
        photoPreviewObjectUrlRef.current = "";
      }
    };
  }, []);

  const compareWorker = useMemo(() => {
    if (compareRecordIndex == null) return null;
    const w = workers.find((x: any) => x.index === compareRecordIndex) ?? null;
    if (!w) return null;
    if (selectedWorker && (w as any).index === (selectedWorker as any).index) return null;
    return w;
  }, [compareRecordIndex, workers, selectedWorker]);

  const compareCatalog = useMemo(() => {
    const names: string[] = [];
    const map = new Map<string, number>();
    for (const w of workers as any[]) {
      if (selectedWorker && (w as any).index === (selectedWorker as any).index) continue;
      const name = String(getStr(w as any, "fullName")).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, (w as any).index);
        names.push(name);
      }
    }
    names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return { names, map };
  }, [workers, selectedWorker]);

  const applyCompareName = (rawName: string) => {
    const name = String(rawName ?? "").trim();
    if (!name || name.toLowerCase() === "none") {
      setCompareInput("None");
      setCompareRecordIndex(null);
      setCompareOpen(false);
      setCompareActive(0);
      return;
    }
    const idx = compareCatalog.map.get(name.toLowerCase());
    if (idx == null) {
      // Keep the typed value but do not set a comparison worker until it matches a real name.
      setCompareInput(name);
      setCompareRecordIndex(null);
      setCompareOpen(true);
      return;
    }
    const canonical = compareCatalog.names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? name;
    setCompareInput(canonical);
    setCompareRecordIndex(idx);
    setCompareOpen(false);
    setCompareActive(0);
  };

  const getCompareFilteredNames = () => {
    const q = String(compareInput ?? "").trim().toLowerCase();
    const all = ["None", ...compareCatalog.names];
    const filtered = q && q !== "none" ? all.filter((n) => n.toLowerCase().includes(q)) : all;
    return filtered.slice(0, 60);
  };



  const profileFilteredWorkers = useMemo(() => {
    let list = workers;

    // Profile field filters
    if (filterNationality !== "") {
      const nat = Number(filterNationality);
      list = list.filter((w: any) => getNum(w, "nationalityRaw", "nationality") === nat);
    }

    if (filterGender) {
      const wantMale = filterGender === "male";
      list = list.filter((w: any) => {
        const g = getNum(w, "genderRaw", "gender");
        if (wantMale) return g === 65535;
        return g === 0;
      });
    }

    // Skill range filters (all must match)
    const preparedSkillRanges = skillRangeFilters
      .map((f) => {
        const meta = SKILL_FILTER_META.find((m) => m.key === f.key);
        const minN = parseMaybeInt(f.min);
        const maxN = parseMaybeInt(f.max);
        return {
          key: f.key,
          raw: meta?.raw ?? "",
          min: minN === null ? null : clamp(minN, 0, 100),
          max: maxN === null ? null : clamp(maxN, 0, 100),
        };
      })
      .filter((f) => !!f.raw && (f.min !== null || f.max !== null));

    if (preparedSkillRanges.length) {
      list = list.filter((w: any) => {
        for (const r of preparedSkillRanges) {
          const v = clamp(getNum(w, r.raw, r.key), 0, 100);
          if (r.min !== null && v < r.min) return false;
          if (r.max !== null && v > r.max) return false;
        }
        return true;
      });
    }

    // Numeric / enum filters
    const wageMinN = parseMaybeInt(filterWageMin);
    const wageMaxN = parseMaybeInt(filterWageMax);
    const ageMinN = parseMaybeInt(filterAgeMin);
    const ageMaxN = parseMaybeInt(filterAgeMax);

    if (wageMinN !== null || wageMaxN !== null) {
      const minW = wageMinN === null ? null : clamp(wageMinN, 0, 300000);
      const maxW = wageMaxN === null ? null : clamp(wageMaxN, 0, 300000);
      list = list.filter((w: any) => {
        const wageThousands = getNum(w, "wageThousandsRaw", "wageRaw");
        const wageDollars = getNum(w, "wageDollars") || wageThousands * 1000;
        const v = clamp(wageDollars, 0, 300000);
        if (minW !== null && v < minW) return false;
        if (maxW !== null && v > maxW) return false;
        return true;
      });
    }

    if (ageMinN !== null || ageMaxN !== null) {
      const minA = ageMinN === null ? null : clamp(ageMinN, 0, 70);
      const maxA = ageMaxN === null ? null : clamp(ageMaxN, 0, 70);
      list = list.filter((w: any) => {
        const raw = getNum(w, "age", "ageRaw");
        const v = clamp(raw & 0xff, 0, 70);
        if (minA !== null && v < minA) return false;
        if (maxA !== null && v > maxA) return false;
        return true;
      });
    }

    if (filterWeight !== "") {
      const want = Number(filterWeight) & 0xff;
      list = list.filter((w: any) => (getNum(w, "weight", "weightRaw") & 0xff) === want);
    }

    if (filterBirthMonth !== "") {
      const want = Number(filterBirthMonth) & 0xff;
      list = list.filter((w: any) => (getNum(w, "birthMonth", "birthMonthRaw") & 0xff) === want);
    }

    if (filterSpeaks) {
      const wantYes = filterSpeaks === "yes";
      list = list.filter((w: any) => {
        const v = isTruthy16(getNum(w, "speaksRaw", "speaks"));
        return wantYes ? v : !v;
      });
    }

    if (filterPrimaryFinisherType) {
      list = list.filter((w: any) => {
        const t = decodeFinisherTypeFromABC(
          getNum(w, "pfTypeFlagA", "primaryFinisherTypeFlagA"),
          getNum(w, "pfTypeFlagB", "primaryFinisherTypeFlagB"),
          getNum(w, "pfTypeFlagC", "primaryFinisherTypeFlagC")
        );
        return t === filterPrimaryFinisherType;
      });
    }

    if (filterSecondaryFinisherType) {
      list = list.filter((w: any) => {
        const t = decodeFinisherTypeFromABC(
          getNum(w, "sfTypeFlagA", "secondaryFinisherTypeFlagA"),
          getNum(w, "sfTypeFlagB", "secondaryFinisherTypeFlagB"),
          getNum(w, "sfTypeFlagC", "secondaryFinisherTypeFlagC")
        );
        return t === filterSecondaryFinisherType;
      });
    }



    // Employment filters
    if (filterWorksFor !== "any") {
      list = list.filter((w: any) => {
        const e1 = getNum(w, "employer1PromoId") | 0;
        const e2 = getNum(w, "employer2PromoId") | 0;
        const e3 = getNum(w, "employer3PromoId") | 0;
        if (filterWorksFor === "none") {
          return e1 === 0 && e2 === 0 && e3 === 0;
        }
        const want = Number(filterWorksFor) | 0;
        return e1 === want || e2 === want || e3 === want;
      });
    }

    if (filterContractType !== "any") {
      list = list.filter((w: any) => {
        const c = (getStr(w, "contractCode") || "Non").trim();
        return c === filterContractType;
      });
    }

    if (filterTouringWith !== "any") {
      list = list.filter((w: any) => {
        const t = (getStr(w, "touringCode") || "").trim();
        if (filterTouringWith === "none") return !t;
        if (filterTouringWith === "jp_any") return !!t;
        return t === filterTouringWith;
      });
    }
    // Attribute / role flags (tri-state). All active flags must match (AND).
    const activeFlags = FLAG_FILTER_META.filter((m) => !!flagFilters[m.key]);
    if (activeFlags.length) {
      list = list.filter((w: any) => {
        const g = getNum(w, "genderRaw", "gender");
        const isMale = g === 65535;
        for (const f of activeFlags) {
          const wantYes = flagFilters[f.key] === "yes";
          const v = isTruthy16(getNum(w, f.raw, f.key));
          if (f.divaOnly && wantYes) {
            // Diva only applies to female: require female AND flag true.
            if (isMale) return false;
            if (!v) return false;
            continue;
          }
          // For non-diva flags (or diva == no), treat as normal tri-state.
          if (wantYes && !v) return false;
          if (!wantYes && v) return false;
        }
        return true;
      });
    }
    return list;
  }, [workers, filterNationality, filterGender, filterBirthMonth, filterWeight, filterSpeaks, filterPrimaryFinisherType, filterSecondaryFinisherType, filterWorksFor, filterContractType, filterTouringWith, filterAgeMin, filterAgeMax, filterWageMin, filterWageMax, flagFilters, skillRangeFilters]);

  const filteredWorkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = profileFilteredWorkers;

    // Text search (name / short / ID)
    if (q) {
      list = list.filter((w: any) => {
        const name = String(w.fullName ?? "").toLowerCase();
        const shortName = String(w.shortName ?? "").toLowerCase();
        const id = String(w.id ?? "");
        return name.includes(q) || shortName.includes(q) || id.includes(q);
      });
    }

    const sorted = [...list].sort((a: any, b: any) => {
      if (sortMode === "id") return (a.id ?? 0) - (b.id ?? 0);
      return String(a.fullName ?? "")
        .toLowerCase()
        .localeCompare(String(b.fullName ?? "").toLowerCase());
    });

    return sorted;
  }, [profileFilteredWorkers, search, sortMode]);




  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterNationality !== "") n++;
    if (filterGender) n++;
    for (const f of skillRangeFilters) {
      if (String(f.min ?? "").trim() || String(f.max ?? "").trim()) n++;
    }
    if (String(filterWageMin).trim() || String(filterWageMax).trim()) n++;
    if (String(filterAgeMin).trim() || String(filterAgeMax).trim()) n++;
    if (filterWeight !== "") n++;
    if (filterBirthMonth !== "") n++;
    if (filterSpeaks) n++;
    if (filterPrimaryFinisherType) n++;
    if (filterSecondaryFinisherType) n++;
    if (filterWorksFor !== "any") n++;
    if (filterContractType !== "any") n++;
    if (filterTouringWith !== "any") n++;
    for (const meta of FLAG_FILTER_META) {
      if (flagFilters[meta.key]) n++;
    }
    return n;
  }, [
    filterNationality,
    filterGender,
    skillRangeFilters,
    filterWageMin,
    filterWageMax,
    filterAgeMin,
    filterAgeMax,
    filterWeight,
    filterBirthMonth,
    filterSpeaks,
    filterPrimaryFinisherType,
    filterSecondaryFinisherType,
    filterWorksFor,
    filterContractType,
    filterTouringWith,
    flagFilters,
  ]);

  const importVisibleWorkers = useMemo(() => {
    const q = importSearch.trim().toLowerCase();
    if (!q) return importSourceWorkers;
    return importSourceWorkers.filter((w: any) => String(w.fullName ?? "").toLowerCase().includes(q));
  }, [importSourceWorkers, importSearch]);

  function clearAllFilters() {
    setFilterNationality("");
    setFilterGender("");
    setSkillRangeFilters([{ id: "sf-1", key: "brawling", min: "", max: "" }]);
    setShowAdvancedFilters(false);

    setFilterWageMin("");
    setFilterWageMax("");
    setFilterAgeMin("");
    setFilterAgeMax("");
    setFilterWeight("");
    setFilterBirthMonth("");
    setFilterSpeaks("");
    setFilterPrimaryFinisherType("");
    setFilterSecondaryFinisherType("");

    setFilterWorksFor("any");
    setFilterContractType("any");
    setFilterTouringWith("any");

    setFlagFilters({
      superstarLook: "",
      menacing: "",
      fonzFactor: "",
      highSpots: "",
      shootingAbility: "",
      trainer: "",
      announcer: "",
      booker: "",
      diva: "",
    });
  }

  function updateSkillRangeFilter(id: string, patch: Partial<SkillRangeFilter>) {
    setSkillRangeFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function removeSkillRangeFilter(id: string) {
    setSkillRangeFilters((prev) => {
      const next = prev.filter((f) => f.id !== id);
      return next.length ? next : [{ id: "sf-1", key: "brawling", min: "", max: "" }];
    });
  }

  function addSkillRangeFilter() {
    setSkillRangeFilters((prev) => [
      ...prev,
      { id: `sf-${Date.now()}-${Math.floor(Math.random() * 100000)}`, key: "brawling", min: "", max: "" },
    ]);
  }

  function computePhotoWarn(raw: string) {
    const base = stripImageExtension(raw);
    const sanitized = sanitizePhotoBaseName(base);
    const truncated = truncateAscii(sanitized, 20);

    const removedIllegal = base !== sanitized;
    const wasTruncated = sanitized.length !== truncated.length;

    if (!removedIllegal && !wasTruncated) return "";

    const parts: string[] = [];
    if (removedIllegal) parts.push('removed illegal characters (., : * ? " < > | and / \\)');
    if (wasTruncated) parts.push("truncated to 20 characters");

    return `Sanitized: ${parts.join(" + ")}.`;
  }

async function openWrestlersFromPath(path: string) {
  setStatus("");
  try {
    const bytes = await readFile(path);

      validateWrestlerDatBytes(bytes);

      const parsed = parseWrestlerDat(toArrayBuffer(bytes));

      const normalized = parsed.map((w: any) => {
        const out = { ...w };
        if (typeof out.photoName === "string") {
          const base = stripImageExtension(out.photoName);
          const clean = sanitizeAndTruncatePhotoBase(base);
          out.photoName = clean || "None";
        } else {
          out.photoName = "None";
        }
        return out;
      });

      setFilePath(path);
      setRawBytes(bytes);
      setWorkers(normalized as any);
      setWrestlersDirty(false);

      setSelectedRecordIndex((normalized[0] as any)?.index ?? 0);
      setPhotoWarn("");
      setStatus(`Loaded: ${normalized.length} workers`);

      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
      setViewMode("profile");

      // Refresh dependent read-only data sources when wrestler.dat is reloaded.
      // This keeps the Wrestlers editor sections in sync if files like stables.dat
      // were changed externally after the DATA folder was first opened.
      try {
        const stablesPath = wsPath("stables");
        if (stablesPath) {
          const stablesBytes = await readFile(stablesPath);
          validateStablesDatBytes(stablesBytes);
          const parsedStables = parseStablesDat(stablesBytes);
          setStables(parsedStables.stables);
          setStablesLoadError("");
        } else {
          setStables([]);
          setStablesLoadError("");
        }
      } catch (e: any) {
        console.error(e);
        setStables([]);
        setStablesLoadError(e?.message ? String(e.message) : "Failed to load stables.dat");
      }

  } catch (e: any) {
    console.error(e);
    setStatus(`Open failed: ${e?.message ?? String(e)}`);
  }
}

async function onLoadFromData(_kind?: string) {
  if (!workspaceRoot || !wsHas("wrestler")) return;
  setStatus("");
  try {
    await openWrestlersFromPath(wsPath("wrestler"));
  } catch (e: any) {
    console.error(e);
    setStatus(`Load from DATA failed: ${e?.message ?? String(e)}`);
  }
}

  function updateSelected(patch: Partial<Worker>) {
    if (!selectedWorker) return;
    const recordIndex = (selectedWorker as any).index;
    setWrestlersDirty(true);

    setWorkers((prev) => {
      const next = prev.map((w: any) => {
        if (w.index !== recordIndex) return w;
        const cur = { ...w };
        Object.assign(cur, patch);
        return cur;
      });
      return next as any;
    });
  }

  const renderFieldHelp = (label: string) => {
    const help = getWrestlerFieldHelp(label);
    if (!help) return null;

    const openHelpAt = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      setHoverHelp({
        label,
        text: help,
        x: Math.min(window.innerWidth - 380, rect.right + 12),
        y: Math.max(16, rect.top - 6),
      });
      setStatus(help);
    };

    const closeHelp = () => {
      setHoverHelp((prev) => (prev?.label === label ? null : prev));
    };

    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <button
          type="button"
          aria-label={`${label} help`}
          onMouseEnter={(e) => openHelpAt(e.currentTarget)}
          onMouseLeave={closeHelp}
          onFocus={(e) => openHelpAt(e.currentTarget)}
          onBlur={closeHelp}
          onClick={(e) => {
            const el = e.currentTarget;
            setHoverHelp((prev) =>
              prev?.label === label
                ? null
                : {
                    label,
                    text: help,
                    x: Math.min(window.innerWidth - 380, el.getBoundingClientRect().right + 12),
                    y: Math.max(16, el.getBoundingClientRect().top - 6),
                  }
            );
            setStatus(help);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            marginLeft: 6,
            borderRadius: 999,
            border: "1px solid rgba(84, 255, 150, 0.7)",
            background: "rgba(10, 70, 30, 0.98)",
            color: "#d9ffe8",
            fontSize: 11,
            fontWeight: 900,
            lineHeight: 1,
            cursor: "help",
            padding: 0,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.25) inset",
          }}
        >
          ?
        </button>
      </span>
    );
  };

  function updateWorkerByIndex(recordIndex: number, patch: Partial<Worker>) {
    setWrestlersDirty(true);
    setWorkers((prev) => {
      const next = prev.map((w: any) => {
        if (w.index !== recordIndex) return w;
        const cur = { ...w };
        Object.assign(cur, patch);
        return cur;
      });
      return next as any;
    });
  }

  async function onSave(_kind?: string) {
    setStatus("");
    try {
      if (!filePath || !rawBytes) throw new Error("No file loaded.");
      if (!workers.length) throw new Error("No workers loaded.");

      const normalized = workers.map((w: any) => {
        const copy = { ...w };

        if (typeof copy.photoName === "string") {
          copy.photoName = normalizePhotoNameForWrite(copy.photoName);
        } else {
          copy.photoName = "None";
        }

        const ageVal = getNum(copy, "ageRaw", "age");
        Object.assign(copy, setNumPatch(copy, "ageRaw", "age", clamp(ageVal, 0, 70)));

        // Wage normalization: UI uses wageDollars, file stores wageThousandsRaw/wageRaw (thousands)
        const wageThousands = getNum(copy, "wageThousandsRaw", "wageRaw");
        const wageDollarsExisting = getNum(copy, "wageDollars");
        const dollars = clamp(wageDollarsExisting !== 0 ? wageDollarsExisting : wageThousands * 1000, 0, 300000);
        const thousands = clamp(Math.round(dollars / 1000), 0, 300);
        copy.wageDollars = dollars;
        Object.assign(copy, setNumPatch(copy, "wageThousandsRaw", "wageRaw", thousands));

        const skillKeys = [
          ["brawlingRaw", "brawling"],
          ["speedRaw", "speed"],
          ["technicalRaw", "technical"],
          ["stiffnessRaw", "stiffness"],
          ["sellingRaw", "selling"],
          ["overnessRaw", "overness"],
          ["charismaRaw", "charisma"],
          ["attitudeRaw", "attitude"],
          ["behaviourRaw", "behaviour"],
        ] as const;

        for (const [pref, fb] of skillKeys) {
          const v = getNum(copy, pref, fb);
          Object.assign(copy, setNumPatch(copy, pref, fb, clamp(v, 0, 100)));
        }

        const gender = getNum(copy, "genderRaw", "gender");
        if (gender === 65535) {
          Object.assign(copy, setNumPatch(copy, "divaRaw", "diva", 0));
        }

        return copy;
      });

      const outBytes = writeWrestlerDat(rawBytes, normalized as any);
      validateWrestlerDatBytes(outBytes);

      const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
      const bakPath = buildEwresBackupPath(filePath, `.${ts}`);
      const bakDir = bakPath.slice(0, bakPath.lastIndexOf("/"));
      await mkdir(bakDir, { recursive: true });

      const alreadyBak = await exists(bakPath);
      if (!alreadyBak) await copyFile(filePath, bakPath);

      await writeFile(filePath, outBytes);
      setRawBytes(outBytes);
      setWrestlersDirty(false);

      setStatus(`Saved OK. Backup: ${bakPath}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Save failed: ${e?.message ?? String(e)}`);
    }
  }



  async function onImportWrestler() {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }

      const chosen = await open({
        multiple: false,
        filters: [{ name: "EWR wrestler.dat", extensions: ["dat"] }],
      });

      if (!chosen) return;

      const p = String(chosen);
      const bytes = await readFile(p);
      validateWrestlerDatBytes(bytes);

      const parsed = parseWrestlerDat(toArrayBuffer(bytes));
      // Mark importability (blank name / already exists) and sort importable first, then A→Z by name.
      const existingNames = new Set(workers.map((w: any) => String(w.fullName ?? "").trim().toLowerCase()));
      const annotated = parsed.map((w: any) => {
        const name = String(w.fullName ?? "").trim();
        if (!name) return { ...w, __importable: false, __importReason: "blank name" };
        if (existingNames.has(name.toLowerCase())) return { ...w, __importable: false, __importReason: "already exists" };
        return { ...w, __importable: true, __importReason: "" };
      });

      const sorted = [...annotated].sort((a: any, b: any) => {
        const ai = !!a.__importable;
        const bi = !!b.__importable;
        if (ai !== bi) return ai ? -1 : 1;
        return String(a.fullName ?? "").toLowerCase().localeCompare(String(b.fullName ?? "").toLowerCase());
      });

      setImportSourcePath(p);
      setImportSourceBytes(bytes);
      setImportSourceWorkers(sorted);
      setImportSelection(new Set());
      setImportSearch("");
      setImportInfo("");
      setImportModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import load failed: ${e?.message ?? String(e)}`);
    }
  }


  // ---------- External Editing: CSV ----------
  const CSV_COLUMNS: { key: string; label?: string }[] = [
    // Requested header order (labels / Yes-No flags)
    { key: "recordNumber" },
    { key: "workerId" },
    { key: "fullName" },
    { key: "shortName" },
    { key: "photoName" },
    { key: "gender" },
    { key: "nationality" },
    { key: "birthMonth" },
    { key: "age" },
    { key: "weight" },
    { key: "speaks" },
    { key: "wage" },

    // Skills (0-100)
    { key: "brawling" },
    { key: "speed" },
    { key: "technical" },
    { key: "stiffness" },
    { key: "selling" },
    { key: "overness" },
    { key: "charisma" },
    { key: "attitude" },
    { key: "behaviour" },
    { key: "shortTermMorale" },
    { key: "longTermMorale" },
    { key: "condition" },

    // Flags (Yes/No)
    { key: "highSpots" },
    { key: "superstarLook" },
    { key: "announcer" },
    { key: "shootingAbility" },
    { key: "diva" },
    { key: "booker" },
    { key: "fonzFactor" },
    { key: "menacing" },
    { key: "trainer" },

    // Finishers
    { key: "primaryFinisherName" },
    { key: "primaryFinisherType" },
    { key: "secondaryFinisherName" },
    { key: "secondaryFinisherType" },
  ];

  const mapGender = schema?.mappings?.gender as Record<string, string> | undefined;
  const mapNationality = schema?.mappings?.nationality as Record<string, string> | undefined;
  const mapBirthMonth = schema?.mappings?.birthMonth as Record<string, string> | undefined;
  const mapWeight = schema?.mappings?.weight as Record<string, string> | undefined;

  const revGender = useMemo(() => makeReverseMap(mapGender), [mapGender]);
  const revNationality = useMemo(() => makeReverseMap(mapNationality), [mapNationality]);
  const revBirthMonth = useMemo(() => makeReverseMap(mapBirthMonth), [mapBirthMonth]);
  const revWeight = useMemo(() => makeReverseMap(mapWeight), [mapWeight]);

  function labelFromMap(map: Record<string, string> | undefined, raw: number): string {
    if (!map) return "";
    return map[String(raw)] ?? "";
  }

  function lowByte(n: number): number {
    return (Number(n) & 0xff) >>> 0;
  }

  function buildEwresBackupPath(path: string, suffix = ""): string {
    const normalized = String(path ?? "").replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
    const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    return `${dir}/EWRes/backups/${base}${suffix}.bak`;
  }

  function skillToCsv(w: any, rawKey: string): number {
    return lowByte(getNum(w, rawKey));
  }

  function boolToCsv(v: any): string {
    return isTruthy16(v) ? "Yes" : "No";
  }

  async function onExportCsv() {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }

      const defaultName = filePath
        ? filePath.replace(/\.dat$/i, ".csv")
        : "wrestlers.csv";

      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!outPath) return;

      const header = CSV_COLUMNS.map((c) => csvEscape(c.key)).join(",");
      const lines: string[] = [header];

      const sorted = [...workers].sort((a: any, b: any) => Number(a.index ?? 0) - Number(b.index ?? 0));

      for (const w of sorted as any[]) {
        const genderRaw = getNum(w, "genderRaw", "gender");
        const natRaw = lowByte(getNum(w, "nationalityRaw", "nationality"));
        const monthRaw = lowByte(getNum(w, "birthMonthRaw", "birthMonth"));
        const weightRaw = lowByte(getNum(w, "weightRaw", "weight"));
        const wageDollars =
          getNum(w, "wageDollars") || (getNum(w, "wageThousandsRaw") ? getNum(w, "wageThousandsRaw") * 1000 : 0);

        const pfType = decodeFinisherTypeFromABC(getNum(w, "pfTypeFlagA"), getNum(w, "pfTypeFlagB"), getNum(w, "pfTypeFlagC"));
        const sfType = decodeFinisherTypeFromABC(getNum(w, "sfTypeFlagA"), getNum(w, "sfTypeFlagB"), getNum(w, "sfTypeFlagC"));

        const rec: Record<string, any> = {
          recordNumber: getNum(w, "index"),
          workerId: getNum(w, "id"),
          fullName: getStr(w, "fullName"),
          shortName: getStr(w, "shortName"),
          gender: labelFromMap(mapGender, genderRaw) || (genderRaw === 65535 ? "Male" : "Female"),
          nationality: labelFromMap(mapNationality, natRaw),
          birthMonth: labelFromMap(mapBirthMonth, monthRaw),
          age: lowByte(getNum(w, "ageRaw", "age")),
          weight: labelFromMap(mapWeight, weightRaw),
          speaks: boolToCsv(getNum(w, "speaksRaw")),
          photoName: getStr(w, "photoName"),
          wage: wageDollars,

          brawling: skillToCsv(w, "brawlingRaw"),
          speed: skillToCsv(w, "speedRaw"),
          technical: skillToCsv(w, "technicalRaw"),
          stiffness: skillToCsv(w, "stiffnessRaw"),
          selling: skillToCsv(w, "sellingRaw"),
          overness: skillToCsv(w, "overnessRaw"),
          charisma: skillToCsv(w, "charismaRaw"),
          attitude: skillToCsv(w, "attitudeRaw"),
          behaviour: skillToCsv(w, "behaviourRaw"),
          shortTermMorale: getNum(w, "shortTermMorale"),
          longTermMorale: getNum(w, "longTermMorale"),
          condition: getNum(w, "conditionRaw", "condition"),

          // Flags (Yes/No)
          highSpots: boolToCsv(getNum(w, "highSpotsRaw")),

          superstarLook: boolToCsv(getNum(w, "superstarLookRaw")),
          menacing: boolToCsv(getNum(w, "menacingRaw")),
          fonzFactor: boolToCsv(getNum(w, "fonzFactorRaw")),
          trainer: boolToCsv(getNum(w, "trainerRaw")),
          announcer: boolToCsv(getNum(w, "announcerRaw")),
          booker: boolToCsv(getNum(w, "bookerRaw")),
          diva: boolToCsv(getNum(w, "divaRaw")),

          shootingAbility: boolToCsv(getNum(w, "shootingAbilityRaw")),

          primaryFinisherName: getStr(w, "primaryFinisherName"),
          primaryFinisherType: pfType,
          secondaryFinisherName: getStr(w, "secondaryFinisherName"),
          secondaryFinisherType: sfType,
        };

        const line = CSV_COLUMNS.map((c) => csvEscape(rec[c.key] ?? "")).join(",");
        lines.push(line);
      }

      // Excel often mis-detects UTF-8 unless the CSV includes a UTF-8 BOM.
      // We intentionally export UTF-8 with BOM to preserve accented characters.
      await writeFile(outPath, new TextEncoder().encode("\uFEFF" + lines.join("\n")));
      setStatus(`Exported CSV: ${outPath}`);
      setExternalEditingOpen(false);
    } catch (e: any) {
      console.error(e);
      setStatus(`Export CSV failed: ${e?.message || e}`);
    }
  }

  function parseLabelOrNumber(v: string, rev: Record<string, number>): number | null {
    const s = (v ?? "").trim();
    if (!s) return null;
    const num = Number(s);
    if (Number.isFinite(num)) return num;
    const key = s.toLowerCase();
    if (key in rev) return rev[key];
    return null;
  }

  function parseSkill(v: string): number | null {
    const s = (v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return Math.trunc(n);
  }

  async function onImportCsv() {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }

      const picked = await open({
        title: "Import CSV",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;

      const bytes = await readFile(path);
      // Strip UTF-8 BOM if present (common when editing/saving in Excel)
      const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
      const parsed = parseCsv(text);
      const rows = parsed.rows;


// ---- CSV header validation (strict) ----
const expectedHeaders = CSV_COLUMNS.map((c) => c.key);
const actualHeaders = parsed.headers.map((h) => String(h ?? "").trim());
const missingHeaders = expectedHeaders.filter((h) => !actualHeaders.includes(h));
const extraHeaders = actualHeaders.filter((h) => h && !expectedHeaders.includes(h));
const orderMismatch =
  missingHeaders.length === 0 &&
  extraHeaders.length === 0 &&
  (actualHeaders.length !== expectedHeaders.length ||
    actualHeaders.some((h, idx) => h !== expectedHeaders[idx]));

if (missingHeaders.length || extraHeaders.length || orderMismatch) {
  const parts: string[] = [];
  if (missingHeaders.length) parts.push(`Missing: ${missingHeaders.join(", ")}`);
  if (extraHeaders.length) parts.push(`Extra: ${extraHeaders.join(", ")}`);
  if (orderMismatch && !missingHeaders.length && !extraHeaders.length) parts.push("Column order mismatch.");
  parts.push(`Expected order: ${expectedHeaders.join(", ")}`);

  setCsvSourcePath(path);
  setCsvRowCount(rows.length);
  setCsvPlannedUpdates([]);
  setCsvPlannedNewRows([]);
  setCsvSkippedDuplicates([]);
  setCsvInvalidRows([{ row: 1, field: "header", message: `CSV header mismatch. ${parts.join(" ")}` }]);
  setCsvImportInfo(
    "CSV header mismatch — import blocked. Fix the header row to match the expected columns exactly."
  );
  setCsvModalOpen(true);
  setExternalEditingOpen(false);
  return;
}

      const byId = new Map<number, any>();
      const byIndex = new Map<number, any>();
      const nameSet = new Set<string>();
      for (const w of workers as any[]) {
        byId.set(Number(w.id), w);
        byIndex.set(Number(w.index), w);
        nameSet.add(String(w.fullName ?? "").trim().toLowerCase());
      }

      const errors: CsvRowError[] = [];
      const skipped: string[] = [];
      const updates: CsvUpdatePlan[] = [];
      const newRows: CsvNewRowPlan[] = [];

      // schema lengths
      const lenFull = (schema?.fields ?? []).find((f: any) => f.name === "fullName")?.length ?? 25;
      const lenShort = (schema?.fields ?? []).find((f: any) => f.name === "shortName")?.length ?? 10;
      const lenPhoto = (schema?.fields ?? []).find((f: any) => f.name === "photoName")?.length ?? 20;
      const lenFin = (schema?.fields ?? []).find((f: any) => f.name === "primaryFinisherName")?.length ?? 25;

      const FIN_TYPES = new Set(["Impact", "Submission", "Top Rope Standing", "Top Rope", "Ground", "Corner"]);

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // header is row 1
        const r = rows[i];
        let rowBad = false;

        const rowErr = (field: string, message: string) => {
          errors.push({ row: rowNum, field, message });
          rowBad = true;
        };

        const fullName = (r.fullName ?? "").trim();
        if (!fullName) {
          rowErr("fullName", "FullName is required.");
          continue;
        }
        if (fullName.length > lenFull) {
          rowErr("fullName", `FullName too long (${fullName.length} > ${lenFull}).`);
          continue;
        }

        const workerIdVal = (r.workerId ?? "").trim();
        const recordNumVal = (r.recordNumber ?? "").trim();

        const workerId = workerIdVal ? Number(workerIdVal) : null;
        const recordNumber = recordNumVal ? Number(recordNumVal) : null;

        const matchById = workerId != null && Number.isFinite(workerId) ? byId.get(workerId) : undefined;
        const matchByIndex =
          !matchById && recordNumber != null && Number.isFinite(recordNumber) ? byIndex.get(recordNumber) : undefined;

        const matchByName =
          !matchById && !matchByIndex
            ? (workers as any[]).find((w) => String(w.fullName ?? "").trim().toLowerCase() === fullName.toLowerCase())
            : undefined;

        const target = matchById || matchByIndex || matchByName;

        const patch: any = {};

        // Strings (optional)
        const shortName = (r.shortName ?? "").trim();
        if (shortName && shortName.length > lenShort) rowErr("shortName", `ShortName too long (${shortName.length} > ${lenShort}).`);
        if (shortName) patch.shortName = shortName;

        const photoName = (r.photoName ?? "").trim();
        if (photoName && photoName.length > lenPhoto) rowErr("photoName", `PhotoName too long (${photoName.length} > ${lenPhoto}).`);
        if (photoName) patch.photoName = photoName;

        const pfName = (r.primaryFinisherName ?? "").trim();
        if (pfName && pfName.length > lenFin) rowErr("primaryFinisherName", `Primary finisher name too long (${pfName.length} > ${lenFin}).`);
        if (pfName) patch.primaryFinisherName = pfName;

        const sfName = (r.secondaryFinisherName ?? "").trim();
        if (sfName && sfName.length > lenFin) rowErr("secondaryFinisherName", `Secondary finisher name too long (${sfName.length} > ${lenFin}).`);
        if (sfName) patch.secondaryFinisherName = sfName;

        // Enums / numeric fields (labels)
        if ((r.gender ?? "").trim()) {
          const g = parseLabelOrNumber(r.gender, revGender);
          if (g == null || Number.isNaN(g)) rowErr("gender", `Invalid gender "${r.gender}".`);
          else patch.genderRaw = g;
        }

        if ((r.nationality ?? "").trim()) {
          const n = parseLabelOrNumber(r.nationality, revNationality);
          if (n == null || Number.isNaN(n)) rowErr("nationality", `Invalid nationality "${r.nationality}".`);
          else {
            patch.nationalityRaw = lowByte(n);
            patch.nationality = lowByte(n);
          }
        }

        if ((r.birthMonth ?? "").trim()) {
          const bm = parseLabelOrNumber(r.birthMonth, revBirthMonth);
          if (bm == null || Number.isNaN(bm)) rowErr("birthMonth", `Invalid birthMonth "${r.birthMonth}".`);
          else {
            patch.birthMonthRaw = lowByte(bm);
            patch.birthMonth = lowByte(bm);
          }
        }

        if ((r.weight ?? "").trim()) {
          const wv = parseLabelOrNumber(r.weight, revWeight);
          if (wv == null || Number.isNaN(wv)) rowErr("weight", `Invalid weight "${r.weight}".`);
          else {
            patch.weightRaw = lowByte(wv);
            patch.weight = lowByte(wv);
          }
        }

        if ((r.age ?? "").trim()) {
          const a = parseSkill(r.age);
          if (a == null) {
            // ignore
          } else if (Number.isNaN(a) || a < 0 || a > 70) rowErr("age", `Age must be 0-70.`);
          else {
            patch.ageRaw = lowByte(a);
            patch.age = lowByte(a);
          }
        }

        if ((r.wage ?? "").trim()) {
          const w = parseSkill(r.wage);
          if (w == null) {
            // ignore
          } else if (Number.isNaN(w) || w < 0 || w > 300000) rowErr("wage", `Wage must be 0-300000.`);
          else {
            patch.wageThousandsRaw = Math.trunc(w / 1000);
            patch.wageDollars = w;
          }
        }

        // speaks Yes/No
        if ((r.speaks ?? "").trim()) {
          const b = parseYesNo(r.speaks);
          if (b === null) rowErr("speaks", `Speaks must be Yes/No.`);
          else patch.speaksRaw = setBool16(b);
        }

        // Finisher types (labels)
        if ((r.primaryFinisherType ?? "").trim()) {
          const t = (r.primaryFinisherType ?? "").trim();
          if (!FIN_TYPES.has(t)) rowErr("primaryFinisherType", `Invalid primary finisher type "${t}".`);
          else {
            const enc = encodeFinisherTypeToABC(t);
            patch.pfTypeFlagA = enc.A;
            patch.pfTypeFlagB = enc.B;
            patch.pfTypeFlagC = enc.C;
          }
        }

        if ((r.secondaryFinisherType ?? "").trim()) {
          const t = (r.secondaryFinisherType ?? "").trim();
          if (!FIN_TYPES.has(t)) rowErr("secondaryFinisherType", `Invalid secondary finisher type "${t}".`);
          else {
            const enc = encodeFinisherTypeToABC(t);
            patch.sfTypeFlagA = enc.A;
            patch.sfTypeFlagB = enc.B;
            patch.sfTypeFlagC = enc.C;
          }
        }

        // Skills 0-100
        const skillMap: { col: string; raw: string }[] = [
          { col: "brawling", raw: "brawlingRaw" },
          { col: "speed", raw: "speedRaw" },
          { col: "technical", raw: "technicalRaw" },
          { col: "stiffness", raw: "stiffnessRaw" },
          { col: "selling", raw: "sellingRaw" },
          { col: "overness", raw: "overnessRaw" },
          { col: "charisma", raw: "charismaRaw" },
          { col: "attitude", raw: "attitudeRaw" },
          { col: "behaviour", raw: "behaviourRaw" },
          { col: "shortTermMorale", raw: "shortTermMorale" },
          { col: "longTermMorale", raw: "longTermMorale" },
          { col: "condition", raw: "conditionRaw" },
        ];

        for (const sm of skillMap) {
          const val = (r as any)[sm.col];
          if (!val) continue;
          const n = parseSkill(val);
          if (n == null) continue;
          if (Number.isNaN(n) || n < 0 || n > 100) rowErr(sm.col, `${sm.col} must be 0-100.`);
          else patch[sm.raw] = n;
        }

        // Flags Yes/No
        const flagCols: { col: string; raw: string }[] = [
          { col: "highSpots", raw: "highSpotsRaw" },
          { col: "superstarLook", raw: "superstarLookRaw" },
          { col: "menacing", raw: "menacingRaw" },
          { col: "fonzFactor", raw: "fonzFactorRaw" },
          { col: "trainer", raw: "trainerRaw" },
          { col: "announcer", raw: "announcerRaw" },
          { col: "booker", raw: "bookerRaw" },
          { col: "diva", raw: "divaRaw" },
          { col: "shootingAbility", raw: "shootingAbilityRaw" },
        ];

        for (const fc of flagCols) {
          const val = (r as any)[fc.col];
          if (!val) continue;
          const b = parseYesNo(val);
          if (b === null) rowErr(fc.col, `${fc.col} must be Yes/No.`);
          else patch[fc.raw] = setBool16(b);
        }

        // fullName updates
        patch.fullName = fullName;

        // If diva is set and gender is explicitly male, mark invalid
        const explicitGender = (r.gender ?? "").trim() ? patch.genderRaw : undefined;
        if (patch.divaRaw === 65535 && explicitGender === 65535) {
          rowErr("diva", "Diva can only be Yes for Female workers.");
        }

        if (rowBad) continue;

        // Determine if new row or update
        if (target) {
          // Prevent renaming to collide with another worker
          const oldName = String(target.fullName ?? "").trim().toLowerCase();
          const newName = String(fullName).trim().toLowerCase();
          if (newName && newName !== oldName && nameSet.has(newName)) {
            errors.push({ row: rowNum, field: "fullName", message: `Cannot rename to "${fullName}" — name already exists.` });
            continue;
          }
          updates.push({ targetIndex: Number(target.index), patch });
        } else {
          // new worker: skip duplicates
          const key = fullName.toLowerCase();
          if (nameSet.has(key)) {
            skipped.push(fullName);
            continue;
          }
          newRows.push({ data: patch as any });
          nameSet.add(key); // reserve so same import file can't add dup twice
        }
      }

      setCsvSourcePath(path);
      setCsvRowCount(rows.length);
      setCsvPlannedUpdates(updates);
      setCsvPlannedNewRows(newRows);
      setCsvSkippedDuplicates(skipped);
      setCsvInvalidRows(errors);

      setCsvImportInfo(
        `Loaded ${rows.length} row(s): ${updates.length} update(s), ${newRows.length} new, ${skipped.length} skipped duplicates, ${errors.length} invalid row(s).`
      );

      setCsvModalOpen(true);
      setExternalEditingOpen(false);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import CSV failed: ${e?.message || e}`);
    }
  }

  function closeCsvModal() {
    setCsvModalOpen(false);
    setCsvSourcePath("");
    setCsvRowCount(0);
    setCsvPlannedUpdates([]);
    setCsvPlannedNewRows([]);
    setCsvSkippedDuplicates([]);
    setCsvInvalidRows([]);
    setCsvImportInfo("");
  }

  function applyCsvImport() {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }

      const recordSize = schema?.recordSize ?? 307;
      const markerOffset = schema?.recordHeader?.marker?.offset ?? 0;
      const markerValue = schema?.recordHeader?.marker?.value ?? 52;

      // Build name set / maxId fresh at apply time
      const existingNameSet = new Set<string>();
      let maxId = 0;
      for (const w of workers as any[]) {
        existingNameSet.add(String(w.fullName ?? "").trim().toLowerCase());
        maxId = Math.max(maxId, Number(w.id ?? 0));
      }

      // Apply updates
      const updatesByIndex = new Map<number, Partial<Worker>>();
      for (const u of csvPlannedUpdates) updatesByIndex.set(u.targetIndex, u.patch);

      let nextWorkers: any[] = (workers as any[]).map((w) => {
        const p = updatesByIndex.get(Number(w.index));
        if (!p) return w;

        const copy: any = { ...w };

        // Skills: preserve high byte if existing
        const skillKeys = [
          "brawlingRaw",
          "technicalRaw",
          "speedRaw",
          "stiffnessRaw",
          "sellingRaw",
          "overnessRaw",
          "charismaRaw",
          "attitudeRaw",
          "behaviourRaw",
        ];
        for (const k of skillKeys) {
          if (k in p) {
            const n = Number((p as any)[k]);
            copy[k] = setLowByteU16(Number(copy[k] ?? 0), n);
          }
        }

        // Merge non-skill fields
        for (const [k, v] of Object.entries(p)) {
          if (skillKeys.includes(k)) continue;
          copy[k] = v as any;
        }

        // Enforce diva off for male
        const g = getNum(copy, "genderRaw", "gender");
        if (g === 65535) copy.divaRaw = 0;

        return copy;
      });

      // Add new workers (auto-assign)
      let nextBytes = new Uint8Array(rawBytes);
      let totalRecords = nextBytes.length / recordSize;

      const addedNames: string[] = [];
      for (const n of csvPlannedNewRows) {
        const data = n.data as any;
        const fullName = String(data.fullName ?? "").trim();
        if (!fullName) continue;

        const key = fullName.toLowerCase();
        if (existingNameSet.has(key)) continue; // safety

        const newIndex = totalRecords;
        totalRecords += 1;
        const newId = maxId + 1;
        maxId = newId;

        // build blank record bytes
        const rec = new Uint8Array(recordSize);
        rec.fill(0);
        rec[markerOffset] = markerValue & 0xff;
        setU16LE(rec, 1, newId);

        const photoField = (schema?.fields ?? []).find((f: any) => f.name === "photoName");
        if (photoField?.offset != null && photoField?.length) {
          const txt = "None";
          for (let i = 0; i < photoField.length; i++) {
            rec[photoField.offset + i] = i < txt.length ? txt.charCodeAt(i) : 0x20;
          }
        }

        stripEmploymentInRecordBytes(rec);

        nextBytes = concatByteArrays(nextBytes, rec);

        // create worker object
        const w: any = { index: newIndex, id: newId };

        // Apply provided fields
        // Default gender: Male if unspecified
        w.genderRaw = typeof data.genderRaw === "number" ? data.genderRaw : 65535;

        w.fullName = fullName;
        if (data.shortName) w.shortName = data.shortName;
        if (data.photoName) w.photoName = data.photoName;

        if (typeof data.nationalityRaw === "number") {
          w.nationalityRaw = lowByte(data.nationalityRaw);
          w.nationality = lowByte(data.nationalityRaw);
        }
        if (typeof data.birthMonthRaw === "number") {
          w.birthMonthRaw = lowByte(data.birthMonthRaw);
          w.birthMonth = lowByte(data.birthMonthRaw);
        }
        if (typeof data.weightRaw === "number") {
          w.weightRaw = lowByte(data.weightRaw);
          w.weight = lowByte(data.weightRaw);
        }
        if (typeof data.ageRaw === "number") {
          w.ageRaw = lowByte(data.ageRaw);
          w.age = lowByte(data.ageRaw);
        }
        if (typeof data.speaksRaw === "number") w.speaksRaw = data.speaksRaw;

        if (typeof data.wageThousandsRaw === "number") {
          w.wageThousandsRaw = data.wageThousandsRaw;
          w.wageDollars = data.wageDollars ?? data.wageThousandsRaw * 1000;
        }

        // Skills
        const skillKeys = [
          "brawlingRaw",
          "technicalRaw",
          "speedRaw",
          "stiffnessRaw",
          "sellingRaw",
          "overnessRaw",
          "charismaRaw",
          "attitudeRaw",
          "behaviourRaw",
        ];
        for (const k of skillKeys) {
          if (k in data) w[k] = Number(data[k]);
        }

        // Flags
        const flagKeys = ["superstarLookRaw", "menacingRaw", "fonzFactorRaw", "trainerRaw", "announcerRaw", "bookerRaw", "divaRaw"];
        for (const k of flagKeys) {
          if (k in data) w[k] = Number(data[k]);
        }

        // Finishers
        if (data.primaryFinisherName) w.primaryFinisherName = data.primaryFinisherName;
        if (data.secondaryFinisherName) w.secondaryFinisherName = data.secondaryFinisherName;

        if ("pfTypeFlagA" in data) w.pfTypeFlagA = data.pfTypeFlagA;
        if ("pfTypeFlagB" in data) w.pfTypeFlagB = data.pfTypeFlagB;
        if ("pfTypeFlagC" in data) w.pfTypeFlagC = data.pfTypeFlagC;

        if ("sfTypeFlagA" in data) w.sfTypeFlagA = data.sfTypeFlagA;
        if ("sfTypeFlagB" in data) w.sfTypeFlagB = data.sfTypeFlagB;
        if ("sfTypeFlagC" in data) w.sfTypeFlagC = data.sfTypeFlagC;

        // Enforce diva off for male
        if (w.genderRaw === 65535) w.divaRaw = 0;

        existingNameSet.add(key);
        addedNames.push(fullName);
        nextWorkers.push(w);
      }

      // Finally, re-index sort for UI stability
      nextWorkers = [...nextWorkers].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));

      setRawBytes(nextBytes);
      setWorkers(nextWorkers as any);
      if (csvPlannedUpdates.length > 0 || addedNames.length > 0) setWrestlersDirty(true);

// ---- Post-import sanity check ----
const lenFull = (schema?.fields ?? []).find((f: any) => f.name === "fullName")?.length ?? 25;

const totalRecs = nextBytes.length / recordSize;
const recMisalign = nextBytes.length % recordSize !== 0;

let maxWorkerId = 0;
const nameCounts = new Map<string, number>();
const tooLongNames: string[] = [];
let badSkillCount = 0;

const skillRawKeys = [
  "brawlingRaw",
  "technicalRaw",
  "speedRaw",
  "stiffnessRaw",
  "sellingRaw",
  "overnessRaw",
  "charismaRaw",
  "attitudeRaw",
  "behaviourRaw",
];

for (const w of nextWorkers as any[]) {
  maxWorkerId = Math.max(maxWorkerId, Number(w.id ?? 0));
  const n = String(w.fullName ?? "").trim();
  const key = n.toLowerCase();
  if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  if (n && n.length > lenFull) tooLongNames.push(n);

  // detect any skills outside 0-100 (low-byte)
  for (const k of skillRawKeys) {
    const v = lowByte(getNum(w, k));
    if (v < 0 || v > 100) {
      badSkillCount++;
      break;
    }
  }
}

const duplicateNames = Array.from(nameCounts.entries())
  .filter(([, c]) => c > 1)
  .map(([k]) => k);

const sanity = `Sanity: records=${totalRecs}${recMisalign ? "(!)" : ""}, maxId=${maxWorkerId}, dupNames=${duplicateNames.length}, longNames=${tooLongNames.length}, badSkills=${badSkillCount}`;

setStatus(
  `CSV import applied: ${csvPlannedUpdates.length} update(s), ${addedNames.length} new, ${csvSkippedDuplicates.length} skipped duplicates, ${csvInvalidRows.length} invalid. ${sanity}`
);

closeCsvModal();

    } catch (e: any) {
      console.error(e);
      setStatus(`Apply CSV failed: ${e?.message || e}`);
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
    setImportSourceWorkers([]);
    setImportSourceBytes(null);
    setImportSourcePath("");
  }

  function commitImportSelected() {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }
      if (!importSourceBytes) {
        setImportInfo("No import file loaded.");
        return;
      }
      if (importSelection.size === 0) {
        setImportInfo("Select at least one worker to import.");
        return;
      }

      const recordSize = schema?.recordSize ?? 307;
      const markerOffset = schema?.recordHeader?.marker?.offset ?? 0;
      const markerValue = schema?.recordHeader?.marker?.value ?? 52;

      // Determine existing names (fullName only, case-insensitive)
      const existingNames = new Set(workers.map((w: any) => String(w.fullName ?? "").trim().toLowerCase()));

      let nextBytes = rawBytes;
      let maxId = workers.reduce((m: number, w: any) => Math.max(m, Number(w.id ?? 0)), 0);

      const importedWorkers: any[] = [];
      const skippedDupes: string[] = [];
      const skippedEmpty: string[] = [];

      const selected = importSourceWorkers.filter((w: any) => importSelection.has(w.index));
      for (const src of selected) {
        const name = String(src.fullName ?? "").trim();
        const key = name.toLowerCase();

        if (!name) {
          skippedEmpty.push(String(src.shortName ?? "(unnamed)").trim() || "(unnamed)");
          continue;
        }
        if (existingNames.has(key)) {
          skippedDupes.push(name);
          continue;
        }

        const totalRecordsNow = nextBytes.length / recordSize;
        const newIndex = totalRecordsNow;
        const newId = maxId + 1;
        maxId = newId;

        const srcStart = src.index * recordSize;
        const srcEnd = srcStart + recordSize;
        if (srcEnd > importSourceBytes.length) {
          skippedEmpty.push(`${name} (out of bounds)`);
          continue;
        }

        const rec = new Uint8Array(importSourceBytes.slice(srcStart, srcEnd));

        // reset marker + new ID
        rec[markerOffset] = markerValue & 0xff;
        setU16LE(rec, 1, newId);

        // remove employment, so imports don't come in "signed"
        stripEmploymentInRecordBytes(rec);

        nextBytes = concatBytes(nextBytes, rec);

        // Clone worker object and patch id/index
        const out: any = { ...src, index: newIndex, id: newId };
        importedWorkers.push(out);

        existingNames.add(key);
      }

      if (importedWorkers.length === 0) {
        const msg =
          skippedDupes.length || skippedEmpty.length
            ? `Nothing imported. Duplicates: ${skippedDupes.length}. Skipped: ${skippedEmpty.length}.`
            : "Nothing imported.";
        setImportInfo(msg);
        return;
      }

      setRawBytes(nextBytes);
      setWorkers((prev) => [...prev, ...importedWorkers]);
      setSelectedRecordIndex(importedWorkers[0].index);

      const dupeMsg = skippedDupes.length ? ` Skipped duplicates: ${skippedDupes.join(", ")}.` : "";
      const emptyMsg = skippedEmpty.length ? ` Skipped unnamed/bad: ${skippedEmpty.join(", ")}.` : "";
      setStatus(`Imported ${importedWorkers.length} worker(s).${dupeMsg}${emptyMsg} Click Save to write to disk.`);
      closeImportModal();
    } catch (e: any) {
      console.error(e);
      setImportInfo(`Import failed: ${e?.message ?? String(e)}`);
    }
  }


  function onAddNewWorker() {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }

      const recordSize = schema?.recordSize ?? 307;
      const markerOffset = schema?.recordHeader?.marker?.offset ?? 0;
      const markerValue = schema?.recordHeader?.marker?.value ?? 52;

      const totalRecords = rawBytes.length / recordSize;
      const newIndex = totalRecords;

      const maxId = workers.reduce((m: number, w: any) => Math.max(m, Number(w.id ?? 0)), 0);
      const newId = maxId + 1;

      const rec = new Uint8Array(recordSize);
      rec.fill(0);
      rec[markerOffset] = markerValue & 0xff;
      setU16LE(rec, 1, newId);

      const photoField = (schema?.fields ?? []).find((f: any) => f.name === "photoName");
      if (photoField?.offset != null && photoField?.length) {
        const txt = "None";
        for (let i = 0; i < photoField.length; i++) {
          rec[photoField.offset + i] = i < txt.length ? txt.charCodeAt(i) : 0x20;
        }
      }

      stripEmploymentInRecordBytes(rec);

      const nextBytes = concatBytes(rawBytes, rec);
      setRawBytes(nextBytes);

      const w: any = { index: newIndex, id: newId };
      for (const f of schema?.fields ?? []) {
        if (f.type === "ascii_fixed") w[f.name] = f.name === "photoName" ? "None" : "";
        else w[f.name] = 0;
      }

      w.birthMonth = 0;
      w.age = 0;
      w.weight = 72;
      w.wageDollars = 0;

      setWorkers((prev) => [...prev, w]);
      setSelectedRecordIndex(newIndex);
      setStatus(`Added new worker record #${newIndex} (ID ${newId}). Click Save to write to disk.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Add failed: ${e?.message ?? String(e)}`);
    }
  }

  function onCopyWorker(recordIndex: number) {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }

      const recordSize = schema?.recordSize ?? 307;
      const markerOffset = schema?.recordHeader?.marker?.offset ?? 0;
      const markerValue = schema?.recordHeader?.marker?.value ?? 52;

      const src = workers.find((w: any) => w.index === recordIndex);
      if (!src) return;

      const totalRecords = rawBytes.length / recordSize;
      const newIndex = totalRecords;

      const maxId = workers.reduce((m: number, w: any) => Math.max(m, Number(w.id ?? 0)), 0);
      const newId = maxId + 1;

      const srcStart = recordIndex * recordSize;
      const srcEnd = srcStart + recordSize;
      const rec = new Uint8Array(rawBytes.slice(srcStart, srcEnd));

      rec[markerOffset] = markerValue & 0xff;
      setU16LE(rec, 1, newId);

      stripEmploymentInRecordBytes(rec);

      const nextBytes = concatBytes(rawBytes, rec);
      setRawBytes(nextBytes);

      const out: any = { ...src, index: newIndex, id: newId };

      out.photoName = (() => {
        const s = String(out.photoName ?? "None");
        const base = stripImageExtension(s);
        const clean = sanitizeAndTruncatePhotoBase(base);
        return clean || "None";
      })();

      const existing = new Set(workers.map((w: any) => String(w.fullName ?? "").trim().toLowerCase()));
      const baseName = String(out.fullName ?? "").trim() || String(out.shortName ?? "").trim() || "New Worker";
      out.fullName = makeUniqueFullName(baseName, existing);

      setWorkers((prev) => [...prev, out]);
      setSelectedRecordIndex(newIndex);
      setStatus(`Copied worker to new record #${newIndex} (ID ${newId}). Employment cleared. Click Save to write.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Copy failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onDeleteWorker(recordIndex: number) {
    try {
      if (!rawBytes) return;

      const deletedId = (workers.find((w: any) => w.index === recordIndex) as any)?.id;

      const recordSize = schema?.recordSize ?? 307;
      const totalRecords = rawBytes.length / recordSize;
      if (recordIndex < 0 || recordIndex >= totalRecords) return;

      const start = recordIndex * recordSize;
      const end = start + recordSize;

      const nextBytes = sliceRemove(rawBytes, start, end);
      setRawBytes(nextBytes);

      const nextWorkers = workers
        .filter((w: any) => w.index !== recordIndex)
        .map((w: any) => {
          if (w.index > recordIndex) return { ...w, index: w.index - 1 };
          return w;
        });

      setWorkers(nextWorkers as any);

      const newTotal = nextBytes.length / recordSize;
      const nextSel = clamp(recordIndex, 0, Math.max(0, newTotal - 1));
      setSelectedRecordIndex(nextSel);

      setSelectedForDelete((prev) => {
        if (!prev.size) return prev;
        const next = new Set<number>();
        for (const idx of prev) {
          if (idx === recordIndex) continue;
          if (idx > recordIndex) next.add(idx - 1);
          else next.add(idx);
        }
        return next;
      });

      // If teams.dat exists in the current workspace, cascade delete dependent teams.
      const removedTeams = deletedId ? await cascadeDeleteTeamsByWorkerIds([deletedId]) : 0;
      setStatus(
        removedTeams
          ? `Deleted record #${recordIndex} (Worker ID ${deletedId}) and removed ${removedTeams} dependent tag team(s) from teams.dat. Click Save to write wrestler.dat.`
          : `Deleted record #${recordIndex}. Click Save to write to disk.`
      );
    } catch (e: any) {
      console.error(e);
      setStatus(`Delete failed: ${e?.message ?? String(e)}`);
    }
  }

  function toggleMultiDelete() {
    setStatus("");
    setMultiDeleteMode((prev) => {
      const next = !prev;
      if (!next) setSelectedForDelete(new Set());
      return next;
    });
  }

  function toggleSelectedForDelete(recordIndex: number, checked: boolean) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (checked) next.add(recordIndex);
      else next.delete(recordIndex);
      return next;
    });
  }

  async function commitMultiDelete() {
    try {
      if (!rawBytes) {
        setStatus("Load wrestler.dat first.");
        return;
      }
      if (!selectedForDelete.size) {
        setStatus("No workers selected for deletion.");
        return;
      }
      if (selectedForDelete.size >= workers.length) {
        setStatus("You cannot multi-delete all workers. At least one record must remain.");
        return;
      }

      const recordSize = schema?.recordSize ?? 307;
      const indicesDesc = Array.from(selectedForDelete).sort((a, b) => b - a);

      const ok = window.confirm(
        `Delete ${indicesDesc.length} worker(s)? This cannot be undone (until you close without saving).`
      );
      if (!ok) return;

      // Capture worker IDs before indices shift.
      const idsToDelete = indicesDesc
        .map((idx) => (workers.find((w: any) => w.index === idx) as any)?.id)
        .filter((v) => typeof v === "number") as number[];

      let bytes = rawBytes;
      let nextWorkers = [...workers];

      for (const idx of indicesDesc) {
        const start = idx * recordSize;
        const end = start + recordSize;
        bytes = sliceRemove(bytes, start, end);

        nextWorkers = nextWorkers
          .filter((w: any) => w.index !== idx)
          .map((w: any) => {
            if (w.index > idx) return { ...w, index: w.index - 1 };
            return w;
          });
      }

      setRawBytes(bytes);
      setWorkers(nextWorkers as any);

      const newTotal = bytes.length / recordSize;
      const nextSel = clamp(selectedRecordIndex, 0, Math.max(0, newTotal - 1));
      setSelectedRecordIndex(nextSel);

      setSelectedForDelete(new Set());
      setMultiDeleteMode(false);

      const removedTeams = idsToDelete.length ? await cascadeDeleteTeamsByWorkerIds(idsToDelete) : 0;
      setStatus(
        removedTeams
          ? `Multi-deleted ${indicesDesc.length} record(s) and removed ${removedTeams} dependent tag team(s) from teams.dat. Click Save to write wrestler.dat.`
          : `Multi-deleted ${indicesDesc.length} record(s). Click Save to write to disk.`
      );
    } catch (e: any) {
      console.error(e);
      setStatus(`Multi-delete failed: ${e?.message ?? String(e)}`);
    }
  }

  const gimmickRecommendationData = useMemo(() => {
    if (!selectedWorker || !gimmickRecSlot) return null;
    const slot = gimmickRecSlot;
    const promoId = getNum(selectedWorker as any, `employer${slot}PromoId` as any) | 0;
    const promo = employmentPromos.find((p) => Number((p as any).id || 0) === promoId) ?? null;
    const currentDisposition = String((selectedWorker as any)[`employer${slot}DispositionCode`] ?? "");
    const currentPosition = getNum(selectedWorker as any, `employer${slot}PositionRaw` as any) | 0;
    const currentGimmickId = getNum(selectedWorker as any, `employer${slot}GimmickId` as any) | 0;
    const workerName = getStr(selectedWorker as any, "fullName") || getStr(selectedWorker as any, "shortName") || "This worker";
    const genderRaw = getNum(selectedWorker as any, "genderRaw", "gender");
    const nationalityRaw = getNum(selectedWorker as any, "nationalityRaw", "nationality");
    const weightRaw = getNum(selectedWorker as any, "weightRaw", "weight");
    const ageRaw = getNum(selectedWorker as any, "ageRaw", "age") & 0xff;
    const overnessRaw = getNum(selectedWorker as any, "overnessRaw", "overness");
    const charismaRaw = getNum(selectedWorker as any, "charismaRaw", "charisma");
    const speedRaw = getNum(selectedWorker as any, "speedRaw", "speed");
    const technicalRaw = getNum(selectedWorker as any, "technicalRaw", "technical");
    const brawlingRaw = getNum(selectedWorker as any, "brawlingRaw", "brawling");
    const menacingRaw = getNum(selectedWorker as any, "menacingRaw");
    const superstarLookRaw = getNum(selectedWorker as any, "superstarLookRaw");
    const highSpotsRaw = getNum(selectedWorker as any, "highSpotsRaw");
    const divaRaw = getNum(selectedWorker as any, "divaRaw");
    const risk = Number((promo as any)?.risk ?? 0) || 0;
    const rows: GimmickRecommendationRow[] = GIMMICK_REQUIREMENT_RULES.filter((rule) => rule.id > 0).map((rule) => {
      const unmet: string[] = [];
      const employmentFixes: string[] = [];
      const profileFixes: string[] = [];
      const notes = [...(rule.notes || [])];
      let autoDispositionCode: string | undefined;
      let autoPositionValue: number | undefined;
      if (!rule.assignable) {
        unmet.push("Cannot be directly assigned in the editor.");
      }
      for (const req of rule.requirements || []) {
        switch (req.kind) {
          case "riskMin": {
            const onlyIf = String((req as any).onlyIf || "");
            const applies = !onlyIf || (onlyIf === "Males" && genderRaw === 65535) || (onlyIf === "Females" && genderRaw !== 65535) || (onlyIf === "Face or Tweener" && ["F","T"].includes(currentDisposition)) || (onlyIf === "Heel" && currentDisposition === "H");
            if (applies && risk < req.value) unmet.push(`Promotion risk must be at least ${req.value}.`);
            break;
          }
          case "gender": {
            const wantsMale = req.value === "Male";
            if ((wantsMale && genderRaw !== 65535) || (!wantsMale && genderRaw === 65535)) profileFixes.push(`Gender must be ${req.value}.`);
            break;
          }
          case "ageMax": if (ageRaw > req.value) profileFixes.push(`Age must be ${req.value} or less.`); break;
          case "ageMin": if (ageRaw < req.value) profileFixes.push(`Age must be ${req.value} or higher.`); break;
          case "nationality": if (nationalityRaw !== (NATIONALITY_LABEL_TO_VALUE[req.value] ?? -999)) profileFixes.push(`Nationality must be ${req.value}.`); break;
          case "nationalityNot": if (nationalityRaw === (NATIONALITY_LABEL_TO_VALUE[req.value] ?? -999)) profileFixes.push(`Nationality must not be ${req.value}.`); break;
          case "nationalityAny": if (!(req.values || []).some((v) => nationalityRaw === (NATIONALITY_LABEL_TO_VALUE[v] ?? -999))) profileFixes.push(`Nationality must be ${req.values.join(" or ")}.`); break;
          case "dispositionAny": if (!(req.values || []).some((v) => currentDisposition === (DISPOSITION_LABEL_TO_CODE[v] || v))) { employmentFixes.push(`Set disposition to ${req.values.join(" or ")}.`); autoDispositionCode = DISPOSITION_LABEL_TO_CODE[req.values[0]] || req.values[0]; } break;
          case "weight": if (weightRaw !== (WEIGHT_LABEL_TO_VALUE[req.value] ?? -999)) profileFixes.push(`Weight must be ${req.value}.`); break;
          case "position": if (currentPosition !== (POSITION_LABEL_TO_VALUE[req.value] ?? -999)) { employmentFixes.push(`Set position to ${req.value}.`); autoPositionValue = POSITION_LABEL_TO_VALUE[req.value]; } break;
          case "statMin": {
            const current = req.field === "overness" ? overnessRaw : req.field === "charisma" ? charismaRaw : req.field === "speed" ? speedRaw : req.field === "technical" ? technicalRaw : brawlingRaw;
            if (current < req.value) profileFixes.push(`${req.field[0].toUpperCase() + req.field.slice(1)} must be ${req.value} or higher.`);
            break;
          }
          case "statMax": {
            const current = req.field === "overness" ? overnessRaw : req.field === "charisma" ? charismaRaw : req.field === "speed" ? speedRaw : req.field === "technical" ? technicalRaw : brawlingRaw;
            if (current > req.value) profileFixes.push(`${req.field[0].toUpperCase() + req.field.slice(1)} must be ${req.value} or less.`);
            break;
          }
          case "flagTrue": {
            const current = req.field === "menacing" ? menacingRaw : req.field === "superstarLook" ? superstarLookRaw : req.field === "highSpots" ? highSpotsRaw : divaRaw;
            if (!current) profileFixes.push(`${req.field === "superstarLook" ? "Superstar Look" : req.field === "highSpots" ? "High Spots" : req.field[0].toUpperCase() + req.field.slice(1)} is required.`);
            break;
          }
          case "flagFalse": {
            const current = req.field === "menacing" ? menacingRaw : req.field === "superstarLook" ? superstarLookRaw : req.field === "highSpots" ? highSpotsRaw : divaRaw;
            if (!!current) profileFixes.push(`${req.field === "superstarLook" ? "Superstar Look" : req.field === "highSpots" ? "High Spots" : req.field[0].toUpperCase() + req.field.slice(1)} must be off.`);
            break;
          }
          case "nameEquals": if (workerName.trim().toLowerCase() !== req.value.trim().toLowerCase()) profileFixes.push(`Name must literally be ${req.value}.`); break;
        }
      }
      const allUnmet = [...unmet, ...employmentFixes, ...profileFixes];
      return { rule, unmet: allUnmet, employmentFixes, profileFixes, notes, qualifiesNow: allUnmet.length === 0, employmentOnly: allUnmet.length > 0 && profileFixes.length === 0 && unmet.length === 0, autoDispositionCode, autoPositionValue };
    }).sort((a,b) => {
      const ar = a.qualifiesNow ? 0 : a.employmentOnly ? 1 : 2;
      const br = b.qualifiesNow ? 0 : b.employmentOnly ? 1 : 2;
      return ar - br || a.unmet.length - b.unmet.length || a.rule.name.localeCompare(b.rule.name);
    });
    return {
      slot,
      promoId,
      promo,
      currentGimmickId,
      qualifiesNow: rows.filter((r) => r.qualifiesNow),
      employmentOnly: rows.filter((r) => !r.qualifiesNow && r.employmentOnly),
      nearMisses: rows.filter((r) => !r.qualifiesNow && !r.employmentOnly),
    };
  }, [selectedWorker, gimmickRecSlot, employmentPromos]);

  function applyGimmickRecommendation(row: GimmickRecommendationRow) {
    if (!selectedWorker || !gimmickRecommendationData) return;
    const slot = gimmickRecommendationData.slot;
    const patch: any = { ...(selectedWorker as any) };
    patch[`employer${slot}GimmickId`] = row.rule.id;
    if (row.autoDispositionCode) patch[`employer${slot}DispositionCode`] = row.autoDispositionCode;
    if (typeof row.autoPositionValue === "number") patch[`employer${slot}PositionRaw`] = row.autoPositionValue;
    updateSelected(patch);
    setGimmickRecSlot(null);
    setStatus(`Applied gimmick recommendation: ${row.rule.name} to Employment #${slot}.`);
  }

  const isMale = selectedWorker ? getNum(selectedWorker as any, "genderRaw", "gender") === 65535 : false;

  const headerTitle = selectedWorker
    ? `Editing: ${getStr(selectedWorker as any, "fullName") || getStr(selectedWorker as any, "shortName") || "Worker"}`
    : "No worker selected";

  // ---------- grid view derived rows ----------
  const gridRows = useMemo(() => {
    const q = gridSearch.trim().toLowerCase();
    let list = profileFilteredWorkers;

    if (q) {
      list = list.filter((w: any) => {
        const name = String(w.fullName ?? "").toLowerCase();
        const shortName = String(w.shortName ?? "").toLowerCase();
        const id = String(w.id ?? "");
        const idx = String(w.index ?? "");
        return name.includes(q) || shortName.includes(q) || id.includes(q) || idx.includes(q);
      });
    }

    function skillVal(w: any, key: GridSortKey): number {
      switch (key) {
        case "brawling":
          return getNum(w, "brawlingRaw", "brawling");
        case "speed":
          return getNum(w, "speedRaw", "speed");
        case "technical":
          return getNum(w, "technicalRaw", "technical");
        case "stiffness":
          return getNum(w, "stiffnessRaw", "stiffness");
        case "selling":
          return getNum(w, "sellingRaw", "selling");
        case "overness":
          return getNum(w, "overnessRaw", "overness");
        case "charisma":
          return getNum(w, "charismaRaw", "charisma");
        case "attitude":
          return getNum(w, "attitudeRaw", "attitude");
        case "behaviour":
          return getNum(w, "behaviourRaw", "behaviour");
        default:
          return 0;
      }
    }

    const dir = gridSort.dir === "asc" ? 1 : -1;
    const key = gridSort.key;

    const sorted = [...list].sort((a: any, b: any) => {
      let av: any;
      let bv: any;

      if (key === "index") {
        av = Number(a.index ?? 0);
        bv = Number(b.index ?? 0);
      } else if (key === "id") {
        av = Number(a.id ?? 0);
        bv = Number(b.id ?? 0);
      } else if (key === "fullName") {
        av = String(a.fullName ?? "").toLowerCase();
        bv = String(b.fullName ?? "").toLowerCase();
      } else if (key === "shortName") {
        av = String(a.shortName ?? "").toLowerCase();
        bv = String(b.shortName ?? "").toLowerCase();
      } else {
        av = skillVal(a, key);
        bv = skillVal(b, key);
      }

      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });

    return sorted;
  }, [profileFilteredWorkers, gridSearch, gridSort]);

  function toggleGridSort(key: GridSortKey) {
    setGridSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  }

  // ---------- grid list sizing ----------
  const { ref: gridWrapRef, size: gridWrapSize } = useElementSize<HTMLDivElement>();

  // Robust height fallback: some WebViews report 0 until after first paint.
  const gridWrapMeasuredHeight =
    gridWrapSize.height ||
    Math.floor(gridWrapRef.current?.getBoundingClientRect?.().height ?? 0) ||
    Math.floor(gridWrapRef.current?.clientHeight ?? 0);

  // ✅ IMPORTANT: do not fallback to a random constant here — only the MIN floor prevents "0" failures.
  const gridListHeight = Math.max(320, Math.floor(gridWrapMeasuredHeight || 0));
  const gridRenderWidth = Math.max(GRID_TOTAL_WIDTH, Math.floor(gridWrapSize.width || gridWrapRef.current?.clientWidth || 0));
  const GRID_TEMPLATE = `${GRID_COLUMNS.map((c) => `${c.width}px`).join(" ")} 1fr`;

  // Sync header/body horizontal scroll
  const gridHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const gridBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncLock = useRef<"header" | "body" | null>(null);

  function syncScroll(from: "header" | "body") {
    if (scrollSyncLock.current && scrollSyncLock.current !== from) return;
    scrollSyncLock.current = from;

    const h = gridHeaderScrollRef.current;
    const b = gridBodyScrollRef.current;
    if (!h || !b) {
      scrollSyncLock.current = null;
      return;
    }

    if (from === "header") {
      if (b.scrollLeft !== h.scrollLeft) b.scrollLeft = h.scrollLeft;
    } else {
      if (h.scrollLeft !== b.scrollLeft) h.scrollLeft = b.scrollLeft;
    }

    queueMicrotask(() => {
      scrollSyncLock.current = null;
    });
  }

  // ---------- Spreadsheet-like navigation ----------
  const gridListRef = useRef<any>(null);
  const VirtualList: any = List;

  function focusGridCell(rowPos: number, colPos: number, doScroll: boolean) {
    const r = clamp(rowPos, 0, Math.max(0, gridRows.length - 1));
    const c = clamp(colPos, 0, Math.max(0, GRID_EDIT_COL_COUNT - 1));

    const selector = `[data-grid-row="${r}"][data-grid-col="${c}"]`;
    const el = document.querySelector(selector) as HTMLInputElement | null;

    if (el) {
      el.focus();
      try {
        el.select?.();
      } catch {}
      return;
    }

    if (!doScroll) return;

    const api = gridListRef.current;
    if (api) {
      if (typeof api.scrollToRow === "function") api.scrollToRow(r);
      else if (typeof api.scrollToItem === "function") api.scrollToItem(r);
    }

    requestAnimationFrame(() => {
      const el2 = document.querySelector(selector) as HTMLInputElement | null;
      if (el2) {
        el2.focus();
        try {
          el2.select?.();
        } catch {}
      }
    });
  }

  function navFromCell(rowPos: number, colPos: number, req: GridNavRequest) {
    const rowMax = Math.max(0, gridRows.length - 1);
    const colMax = Math.max(0, GRID_EDIT_COL_COUNT - 1);

    let nextRow = rowPos;
    let nextCol = colPos;

    if (req.kind === "tab") {
      if (!req.shift) {
        if (nextCol < colMax) nextCol += 1;
        else {
          nextCol = 0;
          nextRow = clamp(nextRow + 1, 0, rowMax);
        }
      } else {
        if (nextCol > 0) nextCol -= 1;
        else {
          nextCol = colMax;
          nextRow = clamp(nextRow - 1, 0, rowMax);
        }
      }
    } else if (req.kind === "enter") {
      nextRow = clamp(req.shift ? nextRow - 1 : nextRow + 1, 0, rowMax);
    } else if (req.kind === "arrow") {
      if (req.key === "ArrowUp") nextRow = clamp(nextRow - 1, 0, rowMax);
      if (req.key === "ArrowDown") nextRow = clamp(nextRow + 1, 0, rowMax);
      if (req.key === "ArrowLeft") nextCol = clamp(nextCol - 1, 0, colMax);
      if (req.key === "ArrowRight") nextCol = clamp(nextCol + 1, 0, colMax);
    }

    focusGridCell(nextRow, nextCol, true);
  }

  // ---------- grid row renderer ----------
  type GridRowProps = RowComponentProps<{
    rows: any[];
    onOpenProfile: (recordIndex: number) => void;
    updateWorkerByIndex: (recordIndex: number, patch: Partial<Worker>) => void;
    onNav: (rowPos: number, colPos: number, req: GridNavRequest) => void;
  }>;

  const GridRow = ({ index, style, rows, onOpenProfile, updateWorkerByIndex, onNav }: GridRowProps) => {
    const w = rows[index];
    if (!w) return null;

    const recordIndex = Number(w.index ?? 0);

    const vBrawling = getNum(w, "brawlingRaw", "brawling");
    const vSpeed = getNum(w, "speedRaw", "speed");
    const vTechnical = getNum(w, "technicalRaw", "technical");
    const vStiffness = getNum(w, "stiffnessRaw", "stiffness");
    const vSelling = getNum(w, "sellingRaw", "selling");
    const vOverness = getNum(w, "overnessRaw", "overness");
    const vCharisma = getNum(w, "charismaRaw", "charisma");
    const vAttitude = getNum(w, "attitudeRaw", "attitude");
    const vBehaviour = getNum(w, "behaviourRaw", "behaviour");

    const rowBg = index % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.02)";

    const COL_FULL = 0;
    const COL_SHORT = 1;
    const COL_BRAWL = 2;
    const COL_SPEED = 3;
    const COL_TECH = 4;
    const COL_STIFF = 5;
    const COL_SELL = 6;
    const COL_OVER = 7;
    const COL_CHAR = 8;
    const COL_ATT = 9;
    const COL_BEH = 10;

    return (
      <div style={{ ...style, width: gridRenderWidth }}>
        <div
          style={{
            width: gridRenderWidth,
            display: "grid",
            gridTemplateColumns: GRID_TEMPLATE,
            gap: 0,
            alignItems: "center",
            padding: "8px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background: rowBg,
          }}
          onMouseDown={(e) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === "input" || tag === "select" || tag === "button" || tag === "textarea") return;
            onOpenProfile(recordIndex);
          }}
          title="Click row (not the inputs) to open this worker in Profile Editor"
        >
          <div style={{ paddingRight: 10, fontWeight: 900, opacity: 0.95 }}>{recordIndex}</div>
          <div style={{ paddingRight: 10, fontWeight: 900, opacity: 0.95 }}>{Number(w.id ?? 0)}</div>

          <div style={{ paddingRight: 10 }}>
            <GridTextCell
              value={String(w.fullName ?? "")}
              maxLen={25}
              gridRowPos={index}
              gridColPos={COL_FULL}
              onNav={onNav}
              onCommit={(next) => updateWorkerByIndex(recordIndex, setStrPatch(w, "fullName", "fullName", next) as any)}
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridTextCell
              value={String(w.shortName ?? "")}
              maxLen={10}
              gridRowPos={index}
              gridColPos={COL_SHORT}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setStrPatch(w, "shortName", "shortName", next) as any)
              }
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vBrawling}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_BRAWL}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setNumPatch(w, "brawlingRaw", "brawling", next) as any)
              }
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vSpeed}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_SPEED}
              onNav={onNav}
              onCommit={(next) => updateWorkerByIndex(recordIndex, setNumPatch(w, "speedRaw", "speed", next) as any)}
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vTechnical}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_TECH}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setNumPatch(w, "technicalRaw", "technical", next) as any)
              }
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vStiffness}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_STIFF}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setNumPatch(w, "stiffnessRaw", "stiffness", next) as any)
              }
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vSelling}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_SELL}
              onNav={onNav}
              onCommit={(next) => updateWorkerByIndex(recordIndex, setNumPatch(w, "sellingRaw", "selling", next) as any)}
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vOverness}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_OVER}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setNumPatch(w, "overnessRaw", "overness", next) as any)
              }
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vCharisma}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_CHAR}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setNumPatch(w, "charismaRaw", "charisma", next) as any)
              }
            />
          </div>

          <div style={{ paddingRight: 10 }}>
            <GridNumberCell
              value={vAttitude}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_ATT}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setNumPatch(w, "attitudeRaw", "attitude", next) as any)
              }
            />
          </div>

          <div style={{ paddingRight: 0 }}>
            <GridNumberCell
              value={vBehaviour}
              min={0}
              max={100}
              gridRowPos={index}
              gridColPos={COL_BEH}
              onNav={onNav}
              onCommit={(next) =>
                updateWorkerByIndex(recordIndex, setNumPatch(w, "behaviourRaw", "behaviour", next) as any)
              }
            />
          </div>

          <div />
        </div>
      </div>
    );
  };

  function openProfileFromGrid(recordIndex: number) {
    setSelectedRecordIndex(recordIndex);
    setViewMode("profile");
    setStatus(`Opened Record #${recordIndex} in Profile editor.`);
  }

  // ---------- render ----------

  // Overness quick-set presets (midpoint of each push tier range)
  const OVERNESS_QUICK_SET: { label: string; min: number; max: number }[] = [
    // Global
    { label: "Global: Main Eventer (91–100)", min: 91, max: 100 },
    { label: "Global: Upper Midcarder (81–90)", min: 81, max: 90 },
    { label: "Global: Midcarder (61–80)", min: 61, max: 80 },
    { label: "Global: Lower Midcarder (41–60)", min: 41, max: 60 },
    { label: "Global: Opener (21–40)", min: 21, max: 40 },
    { label: "Global: Jobber (0–20)", min: 0, max: 20 },

    // National
    { label: "National: Main Eventer (81–100)", min: 81, max: 100 },
    { label: "National: Upper Midcarder (71–80)", min: 71, max: 80 },
    { label: "National: Midcarder (56–70)", min: 56, max: 70 },
    { label: "National: Lower Midcarder (41–55)", min: 41, max: 55 },
    { label: "National: Opener (21–40)", min: 21, max: 40 },
    { label: "National: Jobber (0–20)", min: 0, max: 20 },

    // Cult
    { label: "Cult: Main Eventer (66–100)", min: 66, max: 100 },
    { label: "Cult: Upper Midcarder (51–65)", min: 51, max: 65 },
    { label: "Cult: Midcarder (41–50)", min: 41, max: 50 },
    { label: "Cult: Lower Midcarder (21–40)", min: 21, max: 40 },
    { label: "Cult: Opener (11–20)", min: 11, max: 20 },
    { label: "Cult: Jobber (0–10)", min: 0, max: 10 },

    // Regional
    { label: "Regional: Main Eventer (56–70)", min: 56, max: 70 },
    { label: "Regional: Upper Midcarder (46–55)", min: 46, max: 55 },
    { label: "Regional: Midcarder (36–45)", min: 36, max: 45 },
    { label: "Regional: Lower Midcarder (21–35)", min: 21, max: 35 },
    { label: "Regional: Opener (11–20)", min: 11, max: 20 },
    { label: "Regional: Jobber (0–10)", min: 0, max: 10 },

    // Small
    { label: "Small: Main Eventer (36–50)", min: 36, max: 50 },
    { label: "Small: Upper Midcarder (21–35)", min: 21, max: 35 },
    { label: "Small: Midcarder (11–20)", min: 11, max: 20 },
    { label: "Small: Lower Midcarder (6–10)", min: 6, max: 10 },
    { label: "Small: Opener (0–5)", min: 0, max: 5 },

    // Backyard
    { label: "Backyard: Main Eventer (21–30)", min: 21, max: 30 },
    { label: "Backyard: Upper Midcarder (11–20)", min: 11, max: 20 },
    { label: "Backyard: Midcarder (6–10)", min: 6, max: 10 },
    { label: "Backyard: Lower Midcarder (0–5)", min: 0, max: 5 },
  ];
  const renderFilterPanel = (onClose: () => void, compact?: boolean) => (
    <div className={"ewr-filterPanel" + (compact ? " ewr-filterPanelCompact" : "")}>
              <div className="ewr-filterHeaderRow">
                <div className="ewr-filterTitle">Filter options</div>
                <div className="ewr-filterHeaderActions">
                  <button
                    type="button"
                    className="ewr-button ewr-buttonSmall"
                    onClick={() => setShowAdvancedFilters((v) => !v)}
                  >
                    {showAdvancedFilters ? "Hide" : "Advanced"}
                  </button>
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
                  <div className="ewr-label" style={{ display: "flex", alignItems: "center" }}>Nationality{renderFieldHelp("Nationality")}</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={filterNationality}
                    onChange={(e) => setFilterNationality(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">Any</option>
                    {nationalityOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Gender</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={filterGender}
                    onChange={(e) => {
                      const v = e.target.value as GenderFilter;
                      setFilterGender(v);
                      if (v === "male") setFlagFilters((prev) => ({ ...prev, diva: "" }));
                    }}
                  >
                    <option value="">Any</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Birth month</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={filterBirthMonth}
                    onChange={(e) => setFilterBirthMonth(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">Any</option>
                    {birthMonthOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Weight class</div>
                  <EwrSelectCompat className="ewr-input" value={filterWeight} onChange={(e) => setFilterWeight(e.target.value === "" ? "" : Number(e.target.value))}>
                    <option value="">Any</option>
                    {weightOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Speaks</div>
                  <EwrSelectCompat className="ewr-input" value={filterSpeaks} onChange={(e) => setFilterSpeaks(e.target.value as any)}>
                    <option value="">Any</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Age</div>
                  <div className="ewr-filterInline">
                    <input className="ewr-input" type="number" inputMode="numeric" min={0} max={70} placeholder="Min" value={filterAgeMin} onChange={(e) => setFilterAgeMin(e.target.value)} />
                    <input className="ewr-input" type="number" inputMode="numeric" min={0} max={70} placeholder="Max" value={filterAgeMax} onChange={(e) => setFilterAgeMax(e.target.value)} />
                  </div>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Wage ($)</div>
                  <div className="ewr-filterInline">
                    <input className="ewr-input" type="number" inputMode="numeric" min={0} max={300000} step={1000} placeholder="Min" value={filterWageMin} onChange={(e) => setFilterWageMin(e.target.value)} />
                    <input className="ewr-input" type="number" inputMode="numeric" min={0} max={300000} step={1000} placeholder="Max" value={filterWageMax} onChange={(e) => setFilterWageMax(e.target.value)} />
                  </div>
                </div>


                <div className="ewr-field">
                  <div className="ewr-label">Works For</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={filterWorksFor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "any" || v === "none") setFilterWorksFor(v as any);
                      else setFilterWorksFor(Number(v));
                    }}
                  >
                    <option value="any">Any</option>
                    <option value="none">None</option>
                    {employmentPromoOptionsAlpha.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Contract Type</div>
                  <EwrSelectCompat className="ewr-input" value={filterContractType} onChange={(e) => setFilterContractType(e.target.value as any)}>
                    <option value="any">Any</option>
                    <option value="Wri">Written</option>
                    <option value="Opn">Open</option>
                    <option value="Non">None</option>
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Touring With</div>
                  <EwrSelectCompat className="ewr-input" value={filterTouringWith} onChange={(e) => setFilterTouringWith(e.target.value as any)}>
                    <option value="any">Any</option>
                    <option value="jp_any">Any (Japan touring)</option>
                    <option value="none">None</option>
                    {TOURING_OPTIONS.filter((t) => t.code).map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                                <div className="ewr-field">
                  <div className="ewr-label">Works For</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={
                      filterWorksFor === "any"
                        ? "any"
                        : filterWorksFor === "none"
                        ? "none"
                        : String(filterWorksFor)
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "any") setFilterWorksFor("any");
                      else if (v === "none") setFilterWorksFor("none");
                      else setFilterWorksFor(Number(v));
                    }}
                  >
                    <option value="any">Any</option>
                    <option value="none">None</option>
                    {employmentPromoOptionsAlpha.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Contract Type</div>
                  <EwrSelectCompat className="ewr-input" value={filterContractType} onChange={(e) => setFilterContractType(e.target.value as any)}>
                    <option value="any">Any</option>
                    <option value="Wri">Written</option>
                    <option value="Opn">Open</option>
                    <option value="Non">None</option>
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Touring With</div>
                  <EwrSelectCompat className="ewr-input" value={filterTouringWith} onChange={(e) => setFilterTouringWith(e.target.value)}>
                    <option value="any">Any</option>
                    <option value="jp_any">Any (Japan touring)</option>
                    <option value="none">None</option>
                    {TOURING_OPTIONS.filter((t) => t.code !== "").map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

<div className="ewr-field">
                  <div className="ewr-label">Primary finisher type</div>
                  <EwrSelectCompat className="ewr-input" value={filterPrimaryFinisherType} onChange={(e) => setFilterPrimaryFinisherType(e.target.value)}>
                    <option value="">Any</option>
                    {finisherTypeOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Secondary finisher type</div>
                  <EwrSelectCompat className="ewr-input" value={filterSecondaryFinisherType} onChange={(e) => setFilterSecondaryFinisherType(e.target.value)}>
                    <option value="">Any</option>
                    {finisherTypeOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>
              </div>

              <div className="ewr-filterSkills">
                <div className="ewr-filterSubTitle">Skill ranges</div>

                {skillRangeFilters.map((f) => (
                  <div key={f.id} className="ewr-filterSkillRow">
                    <EwrSelectCompat className="ewr-input" style={{ width: 150 }} value={f.key} onChange={(e) => updateSkillRangeFilter(f.id, { key: e.target.value as any })}>
                      {SKILL_FILTER_META.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </EwrSelectCompat>

                    <input className="ewr-input" type="number" inputMode="numeric" min={0} max={100} placeholder="Min" value={f.min} onChange={(e) => updateSkillRangeFilter(f.id, { min: e.target.value })} style={{ width: 78 }} />
                    <input className="ewr-input" type="number" inputMode="numeric" min={0} max={100} placeholder="Max" value={f.max} onChange={(e) => updateSkillRangeFilter(f.id, { max: e.target.value })} style={{ width: 78 }} />

                    {showAdvancedFilters ? (
                      <button type="button" className="ewr-button ewr-buttonSmall" onClick={() => removeSkillRangeFilter(f.id)} disabled={skillRangeFilters.length === 1} title="Remove range">
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}

                {showAdvancedFilters ? (
                  <div className="ewr-filterActionsRow">
                    <button type="button" className="ewr-button ewr-buttonSmall" onClick={addSkillRangeFilter}>
                      + Add range
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="ewr-filterSection">
                <div className="ewr-filterSubTitle">Attributes / roles</div>

                <div className="ewr-filterTileGrid">
                  {FLAG_FILTER_META.map((f) => {
                    const disabled = !!f.divaOnly && filterGender === "male";
                    return (
                      <label
                        key={f.key}
                        className={"ewr-filterTile ewr-filterTileStack" + (disabled ? " ewr-filterTileDisabled" : "")}
                        title={disabled ? "Diva filter requires Female or Any gender." : undefined}
                      >
                        <span className="ewr-filterTileLabel">
                          {f.label}
                          {f.divaOnly ? <span className="ewr-filterTiny"> (female only)</span> : null}
                        </span>
                        <EwrSelectCompat
                          className="ewr-input ewr-filterTileSelect"
                          value={flagFilters[f.key] ?? ""}
                          onChange={(e) => setFlagFilters((prev) => ({ ...prev, [f.key]: e.target.value as any }))}
                          disabled={disabled}
                        >
                          <option value="">Any</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </EwrSelectCompat>
                      </label>
                    );
                  })}
                </div>
              </div>
              
    </div>
  );

  // Simple inline icon so we don't need an extra dependency for sidebar icons.
  // Styled via CSS to match the "file" look from the reference sidebar.
  const SideNavFileIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M14 2H7a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );

  const sideNav = (
    <aside className="ewr-sideNav">
      <div className="ewr-sideNavTop">
        <img className="ewr-sideLogo" src={ewrLogo} alt="EWR Editor" />
      </div>

      <div className="ewr-sideNavActions">
        <button className="ewr-sideActionBtn ewr-sideActionBtn--blue" onClick={openDataFolder} title="Choose a DATA folder workspace">
          Open Data Folder
        </button>

        <button
          className={`ewr-sideActionBtn ewr-sideActionBtn--blueDark ${workspaceRoot ? "" : "ewr-sideActionBtn--disabled"}`}
          onClick={() => {
            if (!workspaceRoot) return;
            clearDataFolder();
          }}
          title={workspaceRoot ? "Reset / unlink current DATA folder" : "No DATA folder linked"}
        >
          Reset Path
        </button>

        <div className="ewr-sidePath" title={workspaceRoot || "No workspace linked"}>
          {workspaceRoot ? workspaceRoot : "No workspace linked"}
        </div>
      </div>

      <nav className="ewr-sideNavList" aria-label="Sections">
        <button
          className={`ewr-sideNavBtn ${section === "home" ? "ewr-sideNavBtn--active" : ""}`}
          onClick={() => activateSection("home")}
          title="Home"
        >
          <span className="ewr-sideNavIcon" aria-hidden="true">
            <SideNavFileIcon className="ewr-sideNavIconSvg" />
          </span>
          <span className="ewr-sideNavText">Home</span>
        </button>

        <div className="ewr-sideNavGroupLabel">CORE EDITORS</div>

        {CORE_NAV.map((s) => (
          <button
            key={s.key}
            className={`ewr-sideNavBtn ${section === s.key ? "ewr-sideNavBtn--active" : ""}`}
            onClick={() => activateSection(s.key)}
            title={s.label}
          >
            <span className="ewr-sideNavIcon" aria-hidden="true">
              <SideNavFileIcon className="ewr-sideNavIconSvg" />
            </span>
            <span className="ewr-sideNavText">{s.label}</span>
          </button>
        ))}

        <div className="ewr-sideNavGroupLabel">EXTRAS</div>

        {BONUS_NAV.map((s) => (
          <button
            key={s.key}
            className={`ewr-sideNavBtn ${section === s.key ? "ewr-sideNavBtn--active" : ""}`}
            onClick={() => activateSection(s.key)}
            title={s.label}
          >
            <span className="ewr-sideNavIcon" aria-hidden="true">
              <SideNavFileIcon className="ewr-sideNavIconSvg" />
            </span>
            <span className="ewr-sideNavText">{s.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );


// Keep editors mounted when switching tabs so loaded/edited files are not lost.
  // We only toggle visibility. (This is intentionally simple until more sections are implemented.)
  return (
    <div className="ewr-root">
      <div className="ewr-shell">
        {sideNav}
        <div className="ewr-main">

      <div style={{ display: section === "home" ? "block" : "none" }}>
        <div className="ewr-app">
          <div className="ewr-panel ewr-left ewr-scroll">
            <div className="ewr-panelBody" style={{ display: "grid", gap: 12, paddingBottom: 22 }}>
              <div className="ewr-groupCard" style={{ overflow: "hidden", padding: 0 }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 18, fontWeight: 900, letterSpacing: 0.4 }}>
                  ABOUT THE DEVELOPER
                </div>
                <div style={{ padding: 14, display: "grid", gap: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 12, alignItems: "center" }}>
                    <img src={joshBio} alt="Josh" style={{ width: 92, height: 92, objectFit: "cover", borderRadius: "50%", border: "3px solid rgba(255,255,255,0.92)" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 0.95 }}>JOSH</div>
                      <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.15, whiteSpace: "nowrap" }}>iDOL / totalextremeapps@gmail.com</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 15, lineHeight: 1.45 }}>
                    Designing digital grails and building editors for 20 year old wrestling sims is my jam. I have Graphic Design background and a dangerous obsession with 90s/00s nerd culture, pro wrestling, and the grainy warmth of horror VHS.
                    <br /><br />
                    When I’m not on the hunt to build my collection or perfecting a CRT glow, I’m building the tools I wish existed. Whether it’s giving your library a worn slipcover with the Tracking app or fine-tuning .dat files in the EWR Editing Suite, I’m always up to something to stay busy.
                    <br /><br />
                    If my projects helped you organize your stacks, waste away hours in TEW or finally fix that EWR mod, consider tossing a coffee my way. Every bit goes straight into the "Rare Horror Tape & Energy Drink" fund.
                  </div>

                  <button
                    className="ewr-button ewr-buttonOrange"
                    type="button"
                    onClick={() => { void openUrl("https://ko-fi.com/N4N31UKK6D"); }}
                    style={{ justifyContent: "center", fontSize: 22, fontWeight: 900, background: "linear-gradient(180deg, #f7a21b 0%, #d97b00 100%)", borderColor: "rgba(255,190,90,0.75)" }}
                  >
                    BUY ME A COFFEE
                  </button>
                </div>
              </div>

              <div className="ewr-groupCard" style={{ overflow: "hidden", padding: 0 }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 18, fontWeight: 900, letterSpacing: 0.4 }}>
                  DO YOU COLLECT PHYSICAL MEDIA?
                </div>
                <button
                  type="button"
                  onClick={() => { void openUrl("https://mediatracking.app"); }}
                  style={{ all: "unset", display: "block", cursor: "pointer", padding: 14 }}
                >
                  <div style={{ fontSize: 15, lineHeight: 1.45, marginBottom: 12 }}>
                    Check out the Tracking Web App. Track your media across multiple formats and editions right on your phone.
                  </div>
                  <img src={trackingBanner} alt="Tracking" style={{ width: "100%", display: "block", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }} />
                </button>
              </div>
            </div>
          </div>

          <div className="ewr-panel ewr-right ewr-scroll">
            <div className="ewr-panelBody" style={{ display: "grid", gap: 18, paddingBottom: 22 }}>
              <div className="ewr-groupCard" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 22, fontWeight: 900, letterSpacing: 0.4 }}>
                  WELCOME!
                </div>
                <div style={{ padding: 22, display: "grid", gap: 18 }}>
                  <img src={homeLogo} alt="EWR Editing Suite" style={{ width: "min(100%, 312px)", justifySelf: "center", display: "block" }} />
                </div>
              </div>

              <div className="ewr-groupCard" style={{ padding: 18 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18 }}>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div className="ewr-muted" style={{ fontSize: 14, lineHeight: 1.65 }}>
                      EWR Editing Suite is a modern editor for Extreme Warfare Revenge 4.2 data files. It was built to give mod makers and database creators a cleaner, more practical way to manage EWR data than the original editing process allows.
                    </div>

                    <div className="ewr-sectionTitle" style={{ margin: "6px 0 0" }}>What It Does</div>
                    <div className="ewr-muted" style={{ fontSize: 14, lineHeight: 1.65 }}>
                      The suite allows you to load, view, edit, and save EWR DAT files through a structured workspace designed for large-scale database work. Instead of fighting through rigid menus and outdated workflows, you can move between editor sections and manage your data in a way that is faster, clearer, and easier to control.
                      <br /><br />
                      Depending on the section, you can work with wrestlers, promotions, championships, staff, relationships, sponsors, television, stables, and more. The editor is designed to support both simple record updates and larger database management tasks.
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div className="ewr-sectionTitle" style={{ margin: 0 }}>Why It Was Built</div>
                    <div className="ewr-muted" style={{ fontSize: 14, lineHeight: 1.65 }}>
                      EWR’s original editing process works, but it is slow, restrictive, and difficult to manage when you are making a large number of changes. For modders building custom worlds, historical scenarios, or major database overhauls, that becomes a problem quickly.
                      <br /><br />
                      EWR Editing Suite was built to solve that problem. The goal is to preserve compatibility with the original game data while providing a workspace that is more readable, more efficient, and better suited for serious editing.
                    </div>

                    <div className="ewr-sectionTitle" style={{ margin: "6px 0 0" }}>How the Workspace Works</div>
                    <div className="ewr-muted" style={{ fontSize: 14, lineHeight: 1.65 }}>
                      The suite uses a consistent layout across editor sections so that once you learn the flow, the rest of the app feels familiar.
                      <br /><br />
                      The left panel is your record browser. This is where you search, filter, and select the entry you want to work on.
                      <br /><br />
                      The right panel is your detail editor. Once a record is selected, its full information appears here for viewing and editing.
                      <br /><br />
                      This creates a simple workflow: browse on the left, edit on the right, save when finished.
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div className="ewr-sectionTitle" style={{ margin: 0 }}>Getting Started</div>
                    <div className="ewr-muted" style={{ fontSize: 14, lineHeight: 1.65 }}>
                      To begin, load your EWR data folder so the suite can read your DAT files. Once your data is loaded, choose an editor section from the navigation menu.
                      <br /><br />
                      From there, use the left panel to find the record you want to work on. Select it to open its full profile in the right panel, make your changes, and save them back to the data files when you are done.
                      <br /><br />
                      Some sections also include advanced tools such as importing, multi-delete, external editing, and record management features for larger editing jobs.
                    </div>

                    <div className="ewr-sectionTitle" style={{ margin: "6px 0 0" }}>A Better Way to Edit EWR</div>
                    <div className="ewr-muted" style={{ fontSize: 14, lineHeight: 1.65 }}>
                      EWR Editing Suite was built for users who want more control over their data and a smoother editing experience. Whether you are updating an existing database, cleaning up old data, or building a full mod from scratch, the suite is designed to make that work easier to manage.
                      <br /><br />
                      If you are here to build, fix, organize, or expand an EWR database, this is where to start.
                    </div>
                  </div>
                </div>
              </div>

              <div className="ewr-groupCard" style={{ overflow: "hidden", padding: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr", alignItems: "stretch" }}>
                  <div style={{ padding: 18, display: "grid", gap: 12 }}>
                    <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.05 }}>LOOKING FOR EWR MODS?</div>
                    <div className="ewr-muted" style={{ fontSize: 15, lineHeight: 1.55 }}>
                      Check out the Mega Folder packed full of Historical & Fantasy Mods, Real World Monthly Updates, EWR Utilities, Skins, Graphic Packs and More. Updated regularly with content from myself and the fine folks over at the Extreme Warfare Battleground Forums.
                    </div>
                    <button
                      className="ewr-button ewr-buttonRed"
                      type="button"
                      onClick={() => { void openUrl("https://mega.nz/folder/qPxz3aja#q9qFcid2c3NtslrZghBorA"); }}
                      style={{ justifySelf: "start", minWidth: 360, justifyContent: "center", fontSize: 22, fontWeight: 900 }}
                    >
                      iDOL'S MEGA FOLDER
                    </button>
                  </div>
                  <div style={{ padding: 16, display: "grid", alignItems: "end" }}>
                    <img src={skinPreview} alt="Skin preview" style={{ width: "100%", display: "block", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>


      {visitedSections.has("wrestlers") ? (
      <div style={{ display: section === "wrestlers" ? "block" : "none" }}>
        <div className="ewr-app">
      {/* LEFT PANEL */}
      <div className="ewr-panel ewr-left ewr-scroll">
        <div className="ewr-panelHeader">
                    <LeftPanelFileActions
            title="Wrestlers"
            subtitle="wrestler.dat"
            loadFromData={{
              disabled: !workspaceRoot || !wsHas("wrestler"),
              onClick: () => onLoadFromData("wrestler"),
              title: !workspaceRoot ? "Select a DATA folder first" : "Load wrestler.dat from selected DATA folder",
            }}
            closeFile={{
              onClick: async () => {
                if (!filePath && !workers.length) return;
                if (wrestlersDirty) {
                  const ok = window.confirm("You have unsaved changes. Save before closing?\n\nOK = Save, Cancel = Close without saving");
                  if (ok) {
                    await onSave("wrestler");
                    if (wrestlersDirty) return;
                  }
                }
                setFilePath(null);
                setRawBytes(null);
                setWorkers([]);
                setSelectedRecordIndex(0);
                setStatus("Closed file.");
                setPhotoWarn("");
                setMultiDeleteMode(false);
                setSelectedForDelete(new Set());
                setMassEditMode(false);
                setSelectedForMassEdit(new Set());
                            setViewMode("profile");
                setSearch("");
                setWrestlersDirty(false);
              },
              label: "Close File",
              disabled: !filePath && !workers.length,
              title: !filePath && !workers.length ? "No file loaded" : "Close wrestler.dat",
            }}
            saveFile={{
              disabled: !filePath || !workers.length || !rawBytes || !wrestlersDirty,
              onClick: () => onSave("wrestler"),
              title: !filePath || !workers.length || !rawBytes ? "Load wrestler.dat first" : "Save changes to wrestler.dat",
            }}
          />

<div className="ewr-divider" />

        </div>

        <div className="ewr-leftMiddle ewr-scroll">
          <div className="ewr-leftBody">
                        <LeftPanelSearchHeader
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search (name / short / ID)"
              sortValue={sortMode}
              onSortChange={setSortMode}
              sortOptions={[{ value: "id", label: "Sort: ID" }, { value: "name", label: "Sort: Name" }]}
              showingCount={filteredWorkers.length}
              totalCount={workers.length}
              filtersOpen={filtersOpen}
              onToggleFilters={() => setFiltersOpen((v) => !v)}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
            />

{filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}

          </div>

          <div style={{ padding: "0 14px 14px" }}>
          {filteredWorkers.map((w: any) => {
            const isSelected = selectedWorker && w.index === (selectedWorker as any).index;
            const displayName = String(w.fullName || w.shortName || "(no name)").trim();
            const checked = selectedForDelete.has(w.index);

                        return (
              <LeftPanelNameCard
                key={`${w.index}-${w.id}`}
                name={displayName}
                isSelected={!!isSelected}
                onSelect={() => {
                  setSelectedRecordIndex(w.index);
                  setPhotoWarn("");
                }}
                leading={
                  massEditMode ? (
                    <input
                      type="checkbox"
                      checked={selectedForMassEdit.has(w.index)}
                      onChange={(e) => toggleSelectedForMassEdit(w.index, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 18, height: 18 }}
                      title="Select for mass edit"
                    />
                  ) : multiDeleteMode ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleSelectedForDelete(w.index, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 18, height: 18 }}
                      title="Select for multi-delete"
                    />
                  ) : null
                }
                onCopy={() => onCopyWorker(w.index)}
                onDelete={() => onDeleteWorker(w.index)}
                copyTitle="Copy worker"
                deleteTitle="Delete worker"
              />
            );
          })}
          </div>
        </div>


        {massEditMode ? (
          <div className="ewr-leftFooter">
            <button
              className="ewr-button"
              type="button"
              style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}
              onClick={closeMassEditMode}
              title="Exit Mass Edit mode"
            >
              {selectedForMassEdit.size > 0 ? `Cancel Mass Edit (${selectedForMassEdit.size} selected)` : "Cancel Mass Edit"}
            </button>

            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <button
                className="ewr-button ewr-buttonSmall"
                type="button"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setSelectedForMassEdit(new Set(filteredWorkers.map((w: any) => w.index)))}
                title="Select all currently listed workers for Mass Edit"
              >
                Select All
              </button>
              <button
                className="ewr-button ewr-buttonSmall"
                type="button"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setSelectedForMassEdit(new Set())}
                title="Clear Mass Edit selection"
              >
                Select None
              </button>
            </div>

            <div className="ewr-panelCard" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="ewr-sectionTitle" style={{ fontSize: 20, margin: 0 }}>Mass Edit Options</div>
                <div className="ewr-muted">Selected workers: {selectedForMassEdit.size}</div>
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Mass Edit Option</div>
                <EwrSelectCompat className="ewr-input" value={massEditAction} onChange={(e) => { setMassEditAction(e.target.value as MassEditAction); setMassEditValue(""); setMassEditAuxValue("brawling"); }}>
                  {MASS_EDIT_ACTION_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </EwrSelectCompat>
              </div>

              {massEditAction === "set_birth_month" ? (
                <div className="ewr-field">
                  <div className="ewr-label">Birth Month</div>
                  <EwrSelectCompat className="ewr-input" value={massEditValue || "0"} onChange={(e) => setMassEditValue(e.target.value)}>
                    {birthMonthOptions.filter((opt) => Number(opt.value) >= 0 && Number(opt.value) <= 12).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </EwrSelectCompat>
                </div>
              ) : null}

              {["set_age", "increase_age", "decrease_age", "set_wage", "set_skill", "increase_skill", "decrease_skill"].includes(massEditAction) ? (
                <div className="ewr-grid ewr-grid2">
                  {["set_skill", "increase_skill", "decrease_skill"].includes(massEditAction) ? (
                    <div className="ewr-field">
                      <div className="ewr-label">Skill</div>
                      <EwrSelectCompat className="ewr-input" value={massEditAuxValue} onChange={(e) => setMassEditAuxValue(e.target.value)}>
                        {SKILL_FILTER_META.map((meta) => <option key={meta.key} value={meta.key}>{meta.label}</option>)}
                      </EwrSelectCompat>
                    </div>
                  ) : null}
                  <div className="ewr-field">
                    <div className="ewr-label">Value</div>
                    <input className="ewr-input" type="number" value={massEditValue} onChange={(e) => setMassEditValue(e.target.value)} />
                  </div>
                </div>
              ) : null}

              {massEditAction === "set_gender" ? (
                <div className="ewr-field">
                  <div className="ewr-label">Gender</div>
                  <EwrSelectCompat className="ewr-input" value={massEditValue || "male"} onChange={(e) => setMassEditValue(e.target.value)}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </EwrSelectCompat>
                </div>
              ) : null}

              {massEditAction === "set_weight" ? (
                <div className="ewr-field">
                  <div className="ewr-label">Weight</div>
                  <EwrSelectCompat className="ewr-input" value={massEditValue || "72"} onChange={(e) => setMassEditValue(e.target.value)}>
                    {weightOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </EwrSelectCompat>
                </div>
              ) : null}

              {massEditAction === "set_nationality" ? (
                <div className="ewr-field">
                  <div className="ewr-label" style={{ display: "flex", alignItems: "center" }}>Nationality{renderFieldHelp("Nationality")}</div>
                  <EwrSelectCompat className="ewr-input" value={massEditValue || String(nationalityOptions[0]?.value ?? 0)} onChange={(e) => setMassEditValue(e.target.value)}>
                    {nationalityOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </EwrSelectCompat>
                </div>
              ) : null}

              {massEditAction === "set_speaks" ? (
                <div className="ewr-field">
                  <div className="ewr-label">Speaks</div>
                  <EwrSelectCompat className="ewr-input" value={massEditValue || "yes"} onChange={(e) => setMassEditValue(e.target.value)}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </EwrSelectCompat>
                </div>
              ) : null}

              {massEditAction === "set_flag" ? (
                <div className="ewr-grid ewr-grid2">
                  <div className="ewr-field">
                    <div className="ewr-label">Flag</div>
                    <EwrSelectCompat className="ewr-input" value={massEditAuxValue} onChange={(e) => setMassEditAuxValue(e.target.value)}>
                      {FLAG_FILTER_META.map((meta) => <option key={meta.key} value={meta.key}>{meta.label}</option>)}
                    </EwrSelectCompat>
                  </div>
                  <div className="ewr-field">
                    <div className="ewr-label">Value</div>
                    <EwrSelectCompat className="ewr-input" value={massEditValue || "yes"} onChange={(e) => setMassEditValue(e.target.value)}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </EwrSelectCompat>
                  </div>
                </div>
              ) : null}

              {["photo_worker_name", "photo_worker_underscore", "clear_employment"].includes(massEditAction) ? (
                <div className="ewr-muted">
                  This action will apply native field limits and preserve existing worker rules. Workers that cannot be updated will be reported.
                </div>
              ) : null}

              <button
                className="ewr-button ewr-buttonApply"
                type="button"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={applyMassEdit}
                disabled={selectedForMassEdit.size === 0}
                title={selectedForMassEdit.size === 0 ? "Select at least one worker first" : "Apply Mass Edit"}
              >
                Apply Mass Edit
              </button>
            </div>
          </div>
        ) : (
          <LeftPanelActionGrid
            buttons={[
              {
                key: "add",
                icon: <IconPlus className="btnSvg" />,
                label: "Add New Worker",
                onClick: onAddNewWorker,
                title: "Add a new worker",
              },
              {
                key: "multi",
                icon: <IconChecklist className="btnSvg" />,
                label: multiDeleteMode
                  ? selectedForDelete.size > 0
                    ? `Delete Selected (${selectedForDelete.size})`
                    : "Cancel Multi-Delete"
                  : "Multi-Delete",
                onClick: () => {
                  if (massEditMode) {
                    setStatus("Disable Mass Edit mode before using Multi-Delete.");
                    return;
                  }
                  if (!multiDeleteMode) {
                    toggleMultiDelete();
                    setStatus("Multi-Delete mode enabled: tick workers to delete, then click Multi-Delete again to commit.");
                    return;
                  }
                  if (selectedForDelete.size === 0) {
                    toggleMultiDelete();
                    setStatus("Multi-Delete mode disabled.");
                    return;
                  }
                  commitMultiDelete();
                },
                title:
                  !multiDeleteMode
                    ? "Enable multi-delete selection"
                    : selectedForDelete.size > 0
                      ? "Click again to delete selected workers"
                      : "Disable multi-delete (no selection)",
                style: {
                  background: multiDeleteMode && selectedForDelete.size > 0 ? "rgba(255,70,70,0.18)" : undefined,
                  border: multiDeleteMode && selectedForDelete.size > 0 ? "1px solid rgba(255,70,70,0.60)" : undefined,
                },
              },
              {
                key: "import",
                icon: <IconImport className="btnSvg" />,
                label: "Import Worker",
                onClick: onImportWrestler,
                title: "Import worker(s) from another wrestler.dat",
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
                <button
                  className="ewr-button"
                  type="button"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={openMassEditMode}
                  title="Enable Mass Edit mode"
                >
                  Mass Edit
                </button>

                {multiDeleteMode ? (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      className="ewr-button ewr-buttonSmall"
                      type="button"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => setSelectedForDelete(new Set(filteredWorkers.map((w: any) => w.index)))}
                      title="Select all currently listed workers"
                    >
                      Select All
                    </button>
                    <button
                      className="ewr-button ewr-buttonSmall"
                      type="button"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => setSelectedForDelete(new Set())}
                      title="Clear selection"
                    >
                      Select None
                    </button>
                  </div>
                ) : null}

                {externalEditingOpen ? (
                  <div className="ewr-externalMenu">
                    <button
                      className="ewr-button ewr-buttonSmall"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={onExportCsv}
                    >
                      Export CSV
                    </button>
                    <button
                      className="ewr-button ewr-buttonSmall"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={onImportCsv}
                    >
                      Import CSV
                    </button>
                  </div>
                ) : null}
              </>
            }
          />
        )}
      </div>

      {/* RIGHT PANEL */}
      <RightPanelShell
        header={<>          <div className="ewr-mainTitleBar">{headerTitle}</div>

          <div className="ewr-mainMetaRow">
            <div className="ewr-pillRow">
              <div className="ewr-pill">Category: Workers</div>
              <div className="ewr-pill">
                Loaded: <b>{workers.length}</b>
              </div>
              {selectedWorker ? (
                <div className="ewr-pill">
                  Record <b>#{(selectedWorker as any).index}</b> — ID <b>{(selectedWorker as any).id}</b>
                </div>
              ) : null}
            </div>

            <div className="ewr-pillRow">
              <div className="ewr-pill">{filePath ? "wrestler.dat loaded" : "No file loaded"}</div>
              {status ? <div className="ewr-pill">{status}</div> : null}
              <div className="ewr-pill">{viewMode === "profile" ? "Profile Editor" : "Skills Grid"}</div>
            </div>
          </div>
        </>}
        bodyClassName={viewMode === "grid" ? "ewr-mainBody ewr-mainBodyGrid" : "ewr-mainBody ewr-mainBodyScroll"}
      >
          {!selectedWorker ? (
            <div className="ewr-muted">Open wrestler.dat to begin.</div>
          ) : viewMode === "grid" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minHeight: 0,
                flex: 1,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="ewr-button" onClick={() => setViewMode("profile")} title="Back to Profile editor">
                  <IconBack className="btnSvg" />
                  Back to Profile
                </button>

                <div style={{ flex: 1, minWidth: 280 }}>
                  <input
                    className="ewr-input"
                    value={gridSearch}
                    onChange={(e) => setGridSearch(e.target.value)}
                    placeholder="Grid search (name / short / ID / record #)"
                  />
                </div>

                <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className="ewr-button ewr-buttonSmall"
                    onClick={() => setGridFiltersOpen((v) => !v)}
                  >
                    {gridFiltersOpen ? "Hide Filters" : "Filters"}
                    {activeFilterCount ? ` (${activeFilterCount})` : ""}
                  </button>
                  <button
                    type="button"
                    className="ewr-button ewr-buttonSmall"
                    onClick={clearAllFilters}
                    disabled={activeFilterCount === 0}
                  >
                    Clear
                  </button>
                </div>

                <div className="ewr-muted" style={{ fontWeight: 900 }}>
                  Rows: <span className="ewr-strong">{gridRows.length}</span>
                </div>
              </div>

              {gridFiltersOpen ? renderFilterPanel(() => setGridFiltersOpen(false), true) : null}

              <div
                style={{
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  background: "rgba(0,0,0,0.18)",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  flex: 1,
                }}
              >
                {/* HEADER */}
                <div
                  ref={gridHeaderScrollRef}
                  onScroll={() => syncScroll("header")}
                  style={{
                    overflowX: "auto",
                    overflowY: "hidden",
                    borderBottom: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <div
                    style={{
                      width: gridRenderWidth,
                      display: "grid",
                      gridTemplateColumns: GRID_TEMPLATE,
                      gap: 0,
                      padding: "10px 10px",
                      position: "relative",
                    }}
                  >
                    {GRID_COLUMNS.map((col) => {
                      const active = gridSort.key === col.key;
                      const arrow = active ? (gridSort.dir === "asc" ? "▲" : "▼") : "";
                      return (
                        <button
                          key={col.key}
                          type="button"
                          onClick={() => toggleGridSort(col.key)}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            paddingRight: 10,
                            fontSize: 12,
                            fontWeight: 950,
                            letterSpacing: 0.2,
                            opacity: active ? 1 : 0.88,
                            color: "rgba(255,255,255,0.95)",
                          }}
                          title="Click to sort (click again toggles Asc/Desc)"
                        >
                          {col.label} {arrow}
                        </button>
                      );
                    })}

                    <div />
                  </div>
                </div>

                {/* BODY */}
                <div
                  ref={gridWrapRef}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                  }}
                >
                  <div
                    ref={gridBodyScrollRef}
                    onScroll={() => syncScroll("body")}
                    style={{
                      height: "100%",
                      overflowX: "auto",
                      overflowY: "hidden",
                    }}
                  >
                    <VirtualList
                      key={`grid-${gridRows.length}-${gridListHeight}-${gridRenderWidth}`}
                      ref={gridListRef}
                      rowComponent={GridRow}
                      rowCount={gridRows.length}
                      rowHeight={54}
                      rowProps={{
                        rows: gridRows,
                        onOpenProfile: openProfileFromGrid,
                        updateWorkerByIndex,
                        onNav: navFromCell,
                      }}
                      overscanCount={8}
                      defaultHeight={gridListHeight}
                      style={{
                        height: gridListHeight,
                        width: gridRenderWidth,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ marginTop: "auto" }} className="ewr-hint">
                Tip: Tab/Shift+Tab moves across cells. Enter/Shift+Enter moves up/down. Ctrl/Cmd + arrows navigates
                cells.
              </div>
            </div>
          ) : (
            <>
              <h2 className="ewr-h2">
                {getStr(selectedWorker as any, "fullName") || getStr(selectedWorker as any, "shortName") || "Worker"}
              </h2>
              <div className="ewr-subtitle">
                Record #{(selectedWorker as any).index} — Worker ID {(selectedWorker as any).id}
              </div>

              <div className="ewr-section ewr-workerPhotoSection">
                <div className="ewr-sectionHeader ewr-workerPhotoSectionHeader">
                  <div>
                    <div className="ewr-sectionTitle">Profile Photo Details</div>
                  </div>
                  <div className="ewr-workerPhotoActions">
                    <button
                      type="button"
                      className="ewr-button ewr-buttonBlue"
                      onClick={async () => {
                        try {
                          const picked = await open({
                            directory: true,
                            multiple: false,
                            title: "Select EWR PICS folder",
                            defaultPath: picsFolderPath || workspaceRoot || undefined,
                          });
                          if (!picked) return;
                          const dir = Array.isArray(picked) ? String(picked[0]) : String(picked);
                          setPicsFolderPath(dir);
                          setStatus(`PICS folder set: ${dir}`);
                        } catch (e: any) {
                          console.error(e);
                          setStatus(`Set PICS folder failed: ${e?.message ?? String(e)}`);
                        }
                      }}
                    >
                      Set PICS Folder
                    </button>
                    <button
                      type="button"
                      className="ewr-button ewr-buttonRed"
                      onClick={() => {
                        setPicsFolderPath("");
                        setStatus("Cleared PICS folder.");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-workerPhotoMeta ewr-hint" style={{ marginBottom: 14 }}>
                    <div>PICS folder: {picsFolderPath ? picsFolderPath : "Not set"}</div>
                    <div style={{ marginTop: 2 }}>
                      {photoPreviewStatus || (photoPreviewPath ? `Loaded: ${photoPreviewPath}` : "")}
                    </div>
                  </div>
                  <div className="ewr-workerPhotoLayout">
                    <div className="ewr-workerPhotoPreviewCol">
                      <div className="ewr-workerPhotoPreviewFrame">
                        {photoPreviewUrl ? (
                          <img
                            src={photoPreviewUrl}
                            alt={`${getStr(selectedWorker as any, "fullName") || getStr(selectedWorker as any, "shortName") || "Worker"} preview`}
                            className="ewr-workerPhotoPreviewImg"
                          />
                        ) : (
                          <div className="ewr-workerPhotoPreviewEmpty">No image preview available.</div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ewr-button ewr-workerPhotoBrowseBtn"
                        onClick={async () => {
                          try {
                            const picked = await open({
                              multiple: false,
                              title: "Select worker image",
                              defaultPath: picsFolderPath || workspaceRoot || undefined,
                              filters: [
                                { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp"] },
                              ],
                            });
                            if (!picked) return;
                            const filePath = Array.isArray(picked) ? String(picked[0]) : String(picked);
                            const fileName = getBaseName(filePath);
                            const cleaned = sanitizeAndTruncatePhotoBase(stripExtension(fileName));
                            if (!cleaned) {
                              setStatus("Selected image file name is not valid for EWR.");
                              return;
                            }
                            updateSelected(setStrPatch(selectedWorker as any, "photoName", "photoName", cleaned) as any);
                            setPhotoWarn(computePhotoWarn(fileName));
                            const dir = getDirName(filePath);
                            if (dir) setPicsFolderPath(dir);
                            setStatus(`Photo Name set from selected image: ${cleaned}`);
                          } catch (e: any) {
                            console.error(e);
                            setStatus(`Browse image failed: ${e?.message ?? String(e)}`);
                          }
                        }}
                      >
                        Browse…
                      </button>
                    </div>

                    <div className="ewr-workerPhotoMetaCol">
                      <div className="ewr-field">
                        <div className="ewr-label">Profile Photo Name (20)</div>
                        <input
                          className="ewr-input"
                          value={getStr(selectedWorker as any, "photoName")}
                          maxLength={20}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const cleaned = sanitizeAndTruncatePhotoBase(stripImageExtension(raw));
                            updateSelected(setStrPatch(selectedWorker as any, "photoName", "photoName", cleaned) as any);
                            setPhotoWarn(computePhotoWarn(raw));
                          }}
                        />
                      </div>

                      <div className="ewr-hint" style={{ marginTop: 8 }}>
                        Base name only. If empty or “None”, native writes <b>None</b> (no .jpg). Otherwise “.jpg” is appended on save.
                      </div>

                      <div className="ewr-workerPhotoNameActions">
                        <button
                          type="button"
                          className="ewr-button"
                          onClick={() => {
                            const full = getStr(selectedWorker as any, "fullName").trim();
                            if (!full) {
                              setStatus("Full Name is empty — cannot set photo name from it.");
                              return;
                            }
                            const cleaned = sanitizeAndTruncatePhotoBase(full);
                            updateSelected(setStrPatch(selectedWorker as any, "photoName", "photoName", cleaned) as any);
                            setPhotoWarn(computePhotoWarn(full));
                            setStatus("Photo Name set to Full Name (Worker Name).");
                          }}
                        >
                          Set as Worker Name
                        </button>

                        <button
                          type="button"
                          className="ewr-button"
                          onClick={() => {
                            const full = getStr(selectedWorker as any, "fullName");
                            const underscored = fullNameToUnderscore(full);
                            if (!underscored) {
                              setStatus("Full Name is empty — cannot set photo name from it.");
                              return;
                            }
                            const cleaned = sanitizeAndTruncatePhotoBase(underscored);
                            updateSelected(setStrPatch(selectedWorker as any, "photoName", "photoName", cleaned) as any);
                            setPhotoWarn(computePhotoWarn(underscored));
                            setStatus("Photo Name set to Full Name with underscores (Worker_Name).");
                          }}
                        >
                          Set as Worker_Name
                        </button>
                      </div>

                      {photoWarn ? <div className="ewr-warn">{photoWarn}</div> : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* IDENTITY */}
              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Identity</div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-grid ewr-gridAuto">
                    <div className="ewr-field">
                      <div className="ewr-label">Full Name (25)</div>
                      <input
                        className="ewr-input"
                        value={getStr(selectedWorker as any, "fullName")}
                        maxLength={25}
                        onChange={(e) =>
                          updateSelected(setStrPatch(selectedWorker as any, "fullName", "fullName", e.target.value) as any)
                        }
                      />
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Short Name (10)</div>
                      <input
                        className="ewr-input"
                        value={getStr(selectedWorker as any, "shortName")}
                        maxLength={10}
                        onChange={(e) =>
                          updateSelected(
                            setStrPatch(selectedWorker as any, "shortName", "shortName", e.target.value) as any
                          )
                        }
                      />
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Gender</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={isMale ? "Male" : "Female"}
                        onChange={(e) => {
                          const next = e.target.value === "Male" ? 65535 : 0;
                          const patch: any = setNumPatch(selectedWorker as any, "genderRaw", "gender", next);
                          if (next === 65535) Object.assign(patch, setNumPatch(selectedWorker as any, "divaRaw", "diva", 0));
                          updateSelected(patch);
                        }}
                      >
                        <option value="Female">Female</option>
                        <option value="Male">Male</option>
                      </EwrSelectCompat>
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Birth Month</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={getNum(selectedWorker as any, "birthMonthRaw", "birthMonth") & 0xff}
                        onChange={(e) => {
                          const v = Number(e.target.value) & 0xff;
                          const oldRaw = getNum(selectedWorker as any, "birthMonthRaw", "birthMonth");
                          updateSelected(
                            setNumPatch(
                              selectedWorker as any,
                              "birthMonthRaw",
                              "birthMonth",
                              setLowByteU16(oldRaw, v)
                            ) as any
                          );
                        }}
                      >
                        {birthMonthOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </EwrSelectCompat>
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Age (0–70)</div>
                      <NumberInput
                        className="ewr-input"
                        value={getNum(selectedWorker as any, "ageRaw", "age")}
                        min={0}
                        max={70}
                        step={1}
                        onChange={(next) => updateSelected(setNumPatch(selectedWorker as any, "ageRaw", "age", next) as any)}
                      />
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Weight</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={getNum(selectedWorker as any, "weightRaw", "weight") & 0xff}
                        onChange={(e) => {
                          const v = Number(e.target.value) & 0xff;
                          const oldRaw = getNum(selectedWorker as any, "weightRaw", "weight");
                          updateSelected(
                            setNumPatch(selectedWorker as any, "weightRaw", "weight", setLowByteU16(oldRaw, v)) as any
                          );
                        }}
                      >
                        {weightOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </EwrSelectCompat>
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Nationality</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={getNum(selectedWorker as any, "nationalityRaw", "nationality") & 0xff}
                        onChange={(e) =>
                          updateSelected(
                            setNumPatch(
                              selectedWorker as any,
                              "nationalityRaw",
                              "nationality",
                              Number(e.target.value) & 0xff
                            ) as any
                          )
                        }
                      >
                        {nationalityOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </EwrSelectCompat>
                    </div>

                    <div className="ewr-field" style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 22 }}>
                      <input
                        type="checkbox"
                        checked={isTruthy16(getNum(selectedWorker as any, "speaksRaw", "speaks"))}
                        onChange={(e) =>
                          updateSelected(
                            setNumPatch(selectedWorker as any, "speaksRaw", "speaks", setBool16(e.target.checked)) as any
                          )
                        }
                      />
                      <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 900, display: "flex", alignItems: "center" }}>Speaks{renderFieldHelp("Speaks")}</div>
                    </div>

                  </div>
                </div>
              </div>

              {/* SKILLS ANALYSIS */}
              <div className="ewr-section">
                <div
                  className="ewr-sectionHeader"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                >
                  <div className="ewr-sectionTitle">Skills Analysis</div>
                  <button
                    type="button"
                    className="ewr-button"
                    onClick={() => setSkillsAnalysisCollapsed((prev) => !prev)}
                    title={skillsAnalysisCollapsed ? "Expand Skills Analysis" : "Collapse Skills Analysis"}
                    style={{ minWidth: 112 }}
                  >
                    {skillsAnalysisCollapsed ? "Expand" : "Collapse"}
                  </button>
                </div>
                {!skillsAnalysisCollapsed ? (
                  <div className="ewr-sectionBody">
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr)",
                        gridTemplateRows: "auto auto",
                        gap: 16,
                        alignItems: "start",
                      }}
                    >
                      <SkillsAnalysisBarChart
                        points={skillsAnalysisData}
                        workerName={String(selectedWorker?.fullName || selectedWorker?.shortName || "Selected Wrestler")}
                      />
                      <SkillsAnalysisRadarChart points={skillsAnalysisData} />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* SKILLS (with Skills Grid button in-header, like the old version) */}
              {/* NOTE: overflow visible so the compare dropdown can render over the next section */}
              <div className="ewr-section ewr-sectionOverflowVisible">
                <div
                  className="ewr-sectionHeader"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <div className="ewr-sectionTitle">Skills</div>

                  <button
                    type="button"
                    className="ewr-button"
                    onClick={() => {
                      setViewMode("grid");
                      setStatus("Opened Skills Grid for bulk balancing.");
                    }}
                    title="Open the comparative skills grid"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    <IconGrid className="btnSvg" />
                    Open Skills Grid
                  </button>
                </div>

                <div className="ewr-sectionBody">
                  <div className="ewr-grid ewr-gridAuto">
                    {[
                      ["Brawling", "brawlingRaw", "brawling"],
                      ["Speed", "speedRaw", "speed"],
                      ["Technical", "technicalRaw", "technical"],
                      ["Stiffness", "stiffnessRaw", "stiffness"],
                      ["Selling", "sellingRaw", "selling"],
                      ["Overness", "overnessRaw", "overness"],
                      ["Charisma", "charismaRaw", "charisma"],
                      ["Attitude", "attitudeRaw", "attitude"],
                      ["Behaviour", "behaviourRaw", "behaviour"],
                    ].map(([label, pref, fb]) => (
                      <div className="ewr-field" key={label}>
                        <div className="ewr-label" style={{ display: "flex", alignItems: "center" }}>{label} (0–100){renderFieldHelp(label)}</div>
                        <NumberInput
                          className="ewr-input"
                          value={getNum(selectedWorker as any, pref, fb)}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(next) =>
                            updateSelected(setNumPatch(selectedWorker as any, pref, fb, next) as any)
                          }
                        />

                        {label === "Overness" ? (
                          <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                            <div className="ewr-muted" style={{ fontWeight: 900, minWidth: 70 }}>
                              Quick Set
                            </div>
                            <EwrSelectCompat
                              className="ewr-input"
                              value={overnessQuickSet}
                              onChange={(e) => {
                                const v = e.target.value;
                                setOvernessQuickSet(v);
                                if (!v) return;

                                const opt = OVERNESS_QUICK_SET.find((o) => o.label === v);
                                if (!opt) return;
                                const mid = Math.round((opt.min + opt.max) / 2);
                                updateSelected(
                                  setNumPatch(selectedWorker as any, "overnessRaw", "overness", clamp(mid, 0, 100)) as any
                                );
                              }}
                              title="Set Overness to the midpoint of the selected push tier range"
                            >
                              <option value="">Select tier…</option>
                              {OVERNESS_QUICK_SET.map((o) => (
                                <option key={o.label} value={o.label}>
                                  {o.label}
                                </option>
                              ))}
                            </EwrSelectCompat>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  {/* Compare skills */}
                  <div className="ewr-compareBlock">
                    <div className="ewr-compareRow">
                      <div className="ewr-compareLabel">Compare to the Skills of</div>
                      <div className="ewr-compareCombo">
                      <input
                        ref={compareInputRef}
                        className="ewr-input ewr-compareInput"
                        value={compareInput}
                        onFocus={() => {
                          setCompareOpen(true);
                          setCompareActive(0);
                        }}
                        onBlur={() => {
                          // delay so option clicks (mouseDown) can run before close
                          window.setTimeout(() => setCompareOpen(false), 120);
                        }}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCompareInput(v);
                          setCompareOpen(true);
                          setCompareActive(0);

                          const norm = String(v ?? "").trim();
                          if (!norm || norm.toLowerCase() === "none") {
                            setCompareRecordIndex(null);
                            return;
                          }
                          const idx = compareCatalog.map.get(norm.toLowerCase());
                          setCompareRecordIndex(idx ?? null);
                        }}
                        onKeyDown={(e) => {
                          const names = getCompareFilteredNames();
                          if (!compareOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                            setCompareOpen(true);
                            return;
                          }
                          if (e.key === "Escape") {
                            setCompareOpen(false);
                            return;
                          }
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setCompareActive((i) => Math.min(i + 1, Math.max(0, names.length - 1)));
                            return;
                          }
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setCompareActive((i) => Math.max(i - 1, 0));
                            return;
                          }
                          if (e.key === "Enter") {
                            if (compareOpen && names.length) {
                              e.preventDefault();
                              const picked = names[Math.min(compareActive, names.length - 1)];
                              applyCompareName(picked);
                            } else {
                              applyCompareName(compareInput);
                            }
                          }
                        }}
                      />

                      {compareOpen
                        ? (() => {
                            const el = compareInputRef.current;
                            if (!el) return null;
                            const r = el.getBoundingClientRect();
                            const top = Math.round(r.bottom + 6);
                            const left = Math.round(r.left);
                            const width = Math.round(r.width);
                            return createPortal(
                              <div
                                className="ewr-compareDropdown ewr-compareDropdownPortal"
                                style={{ top, left, width }}
                                onMouseDown={(ev) => {
                                  // keep focus behavior stable so option clicks work even though dropdown is portaled
                                  ev.preventDefault();
                                }}
                              >
                                {getCompareFilteredNames().map((name, i) => (
                                  <div
                                    key={name}
                                    className={
                                      "ewr-compareOption" + (i === compareActive ? " isActive" : "")
                                    }
                                    onMouseDown={(ev) => {
                                      ev.preventDefault();
                                      applyCompareName(name);
                                    }}
                                    onMouseEnter={() => setCompareActive(i)}
                                  >
                                    {name}
                                  </div>
                                ))}
                              </div>,
                              document.body
                            );
                          })()
                        : null}
                    </div>
                    </div>

                    {compareWorker ? (
                      <div className="ewr-comparePanel">
                        <div className="ewr-comparePanelTitle">
                          Compared worker: <b>{getStr(compareWorker as any, "fullName")}</b>
                        </div>
                        <div className="ewr-grid ewr-gridAuto">
                          {[
                            ["Brawling", "brawlingRaw", "brawling"],
                            ["Speed", "speedRaw", "speed"],
                            ["Technical", "technicalRaw", "technical"],
                            ["Stiffness", "stiffnessRaw", "stiffness"],
                            ["Selling", "sellingRaw", "selling"],
                            ["Overness", "overnessRaw", "overness"],
                            ["Charisma", "charismaRaw", "charisma"],
                            ["Attitude", "attitudeRaw", "attitude"],
                            ["Behaviour", "behaviourRaw", "behaviour"],
                          ].map(([label, pref, fb]) => {
                            const cur = getNum(selectedWorker as any, pref, fb);
                            const cmp = getNum(compareWorker as any, pref, fb);
                            const delta = cur - cmp;
                            const deltaText = delta > 0 ? `+${delta}` : String(delta);
                            return (
                              <div className="ewr-field" key={`cmp-${label}`}>
                                <div className="ewr-label">{label}</div>
                                <div className="ewr-compareStat">
                                  <span className="ewr-compareValue">{cmp}</span>
                                  <span className="ewr-compareDelta" data-sign={delta === 0 ? "zero" : delta > 0 ? "pos" : "neg"}>
                                    Δ {deltaText}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* HIDDEN SAVE STATS */}
              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Hidden Save Stats</div>
                </div>
                <div className="ewr-sectionBody">
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      border: "1px solid rgba(255, 90, 90, 0.22)",
                      background: "linear-gradient(135deg, rgba(140, 10, 10, 0.28) 0%, rgba(55, 0, 0, 0.14) 35%, rgba(0, 0, 0, 0.04) 100%)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                    }}
                  >
                    <div className="ewr-hint" style={{ marginBottom: 12, lineHeight: 1.45 }}>
                      These values are primarily intended for <b>save-file wrestler.dat</b> editing. EWR randomly assigns these values upon game creation of a new save.
                    </div>
                    <div className="ewr-grid ewr-gridAuto">
                      <div className="ewr-field">
                        <div className="ewr-label" style={{ display: "flex", alignItems: "center" }}>Short-Term Morale{renderFieldHelp("Short-Term Morale")}</div>
                        <NumberInput
                          className="ewr-input"
                          value={getNum(selectedWorker as any, "shortTermMorale")}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(next) => updateSelected(setNumPatch(selectedWorker as any, "shortTermMorale", "shortTermMorale", next) as any)}
                        />
                      </div>

                      <div className="ewr-field">
                        <div className="ewr-label" style={{ display: "flex", alignItems: "center" }}>Long-Term Morale{renderFieldHelp("Long-Term Morale")}</div>
                        <NumberInput
                          className="ewr-input"
                          value={getNum(selectedWorker as any, "longTermMorale")}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(next) => updateSelected(setNumPatch(selectedWorker as any, "longTermMorale", "longTermMorale", next) as any)}
                        />
                      </div>

                      <div className="ewr-field">
                        <div className="ewr-label" style={{ display: "flex", alignItems: "center" }}>Condition{renderFieldHelp("Condition")}</div>
                        <NumberInput
                          className="ewr-input"
                          value={getNum(selectedWorker as any, "conditionRaw", "condition")}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(next) => updateSelected(setNumPatch(selectedWorker as any, "conditionRaw", "condition", next) as any)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

	              {/* ATTRIBUTES / FLAGS (restored: not just Diva) */}
              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Attributes / Flags</div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-grid ewr-gridAuto">
                    {[
                      ["Superstar Look", "superstarLookRaw", "superstarLook"],
                      ["Menacing", "menacingRaw", "menacing"],
                      ["Fonz Factor", "fonzFactorRaw", "fonzFactor"],
                      ["High Spots", "highSpotsRaw", "highSpots"],
                      ["Shooting Ability", "shootingAbilityRaw", "shootingAbility"],
                      ["Trainer", "trainerRaw", "trainer"],
                      ["Announcer", "announcerRaw", "announcer"],
                      ["Booker", "bookerRaw", "booker"],
                    ]
                      .filter(([, pref, fb]) => hasKey(selectedWorker as any, pref) || hasKey(selectedWorker as any, fb))
                      .map(([label, pref, fb]) => {
                        const checked = isTruthy16(getNum(selectedWorker as any, pref, fb));
                        return (
                          <label
                            key={label}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(14,18,28,0.72)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                updateSelected(
                                  setNumPatch(selectedWorker as any, pref, fb, setBool16(e.target.checked)) as any
                                )
                              }
                            />
                            <span style={{ fontSize: 13, opacity: 0.92, fontWeight: 900, display: "inline-flex", alignItems: "center" }}>{label}{renderFieldHelp(label)}</span>
                          </label>
                        );
                      })}

                    {/* Diva (female only) */}
                    {(hasKey(selectedWorker as any, "divaRaw") || hasKey(selectedWorker as any, "diva")) && (
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.10)",
                          background: "rgba(14,18,28,0.72)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={isTruthy16(getNum(selectedWorker as any, "divaRaw", "diva"))}
                            disabled={isMale}
                            onChange={(e) =>
                              updateSelected(
                                setNumPatch(selectedWorker as any, "divaRaw", "diva", setBool16(e.target.checked)) as any
                              )
                            }
                          />
                          <span style={{ fontSize: 13, opacity: 0.92, fontWeight: 900, display: "inline-flex", alignItems: "center" }}>Diva (female only){renderFieldHelp("Diva")}</span>
                        </div>

                        {isMale ? (
                          <div style={{ fontSize: 12, fontWeight: 950, color: "#ff4d4d" }}>
                            Disabled because Gender is Male.
                          </div>
                        ) : null}
                      </label>
                    )}
                  </div>
                </div>
              </div>


              {/* WORKER EMPLOYMENT DETAILS */}
              <div className="ewr-section">
                <div className="ewr-sectionHeader" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="ewr-sectionTitle">Worker Employment Details</div>
                  <div style={{ marginLeft: "auto" }}>
                    <button
                      type="button"
                      className="ewr-button ewr-buttonRed"
                      onClick={() => {
                        const patch: any = {};
                        patch.contractCode = "Non";
                        patch.touringCode = "";
                        patch.unsackableRaw = 0;
                        patch.creativeControlRaw = 0;

                        for (const slot of [1, 2, 3] as const) {
                          patch[`employer${slot}PromoId`] = 0;
                          patch[`employer${slot}PositionRaw`] = 0;
                          patch[`employer${slot}Disposition`] = "F";
                          patch[`employer${slot}Roster`] = "None";
                          patch[`employer${slot}ManagerId`] = 0;
                          patch[`employer${slot}GimmickId`] = 0;
                        }

                        updateSelected(patch);
                        setStatus("Cleared all employment fields.");
                      }}
                      title="Clear all employment fields"
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <IconScissors className="btnSvg" />
                        Clear All Employment
                      </span>
                    </button>
                  </div>
                </div>
                <div className="ewr-sectionBody">

                  <div className="ewr-grid ewr-gridAuto">
                    <div className="ewr-field">
                      <div className="ewr-label">Contract Type</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={getStr(selectedWorker as any, "contractCode") || "Non"}
                        onChange={(e) => {
                          const next = e.target.value;

                          const employer1 = Number((selectedWorker as any).employer1PromoId ?? 0) | 0;
                          const employer2 = Number((selectedWorker as any).employer2PromoId ?? 0) | 0;
                          const employer3 = Number((selectedWorker as any).employer3PromoId ?? 0) | 0;
                          const anyEmployer = employer1 !== 0 || employer2 !== 0 || employer3 !== 0;

                          // Native behavior: if any employer slot is set, "None" snaps to Open.
                          if (next === "Non" && anyEmployer) {
                            updateSelected(setStrPatch(selectedWorker as any, "contractCode", "contractCode", "Opn") as any);
                            setStatus('Native behavior: Contract "None" is not allowed when employed — switched to Open.');
                            return;
                          }

                          const patch: any = setStrPatch(selectedWorker as any, "contractCode", "contractCode", next);

                          // If switching to Written, force Touring to None and clear Employer #2/#3 (native: Written is exclusive).
                          if (next === "Wri") {
                            patch.touringCode = "";

                            patch.employer2PromoId = 0;
                            patch.employer2PositionRaw = 0;
                            patch.employer2Disposition = "F";
                            patch.employer2Roster = "None";
                            patch.employer2ManagerId = 0;
                            patch.employer2GimmickId = 0;

                            patch.employer3PromoId = 0;
                            patch.employer3PositionRaw = 0;
                            patch.employer3Disposition = "F";
                            patch.employer3Roster = "None";
                            patch.employer3ManagerId = 0;
                            patch.employer3GimmickId = 0;
                          }

                          updateSelected(patch);
                        }}
                      >
                        {CONTRACT_OPTIONS.map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </EwrSelectCompat>
                      <div className="ewr-hint">
                        Touring in Japan requires Contract Type <b>None</b> or <b>Open</b>. Written forces Touring to None.
                      </div>
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Touring With</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={getStr(selectedWorker as any, "touringCode")}
                        onChange={(e) => {
                          const next = e.target.value;

                          // If user selects a touring promotion while Written, switch to Open.
                          const contract = (getStr(selectedWorker as any, "contractCode") || "Non").trim();
                          const patch: any = {};
                          patch.touringCode = next;
                          if (next && contract === "Wri") {
                            patch.contractCode = "Opn";
                            setStatus('Touring requires None/Open contracts — switched Contract Type to Open.');
                          }
                          updateSelected(patch);
                        }}
                      >
                        {TOURING_OPTIONS.map((o) => (
                          <option key={o.label} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </EwrSelectCompat>
                      <div className="ewr-hint">
                        Note: Some touring options may not persist in the native editor unless the worker meets hidden stat requirements.
                      </div>
                    </div>

                    <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
                        <label className="ewr-checkboxRow" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={getNum(selectedWorker as any, "unsackableRaw") === 65535}
                            onChange={(e) => {
                              const v = e.target.checked ? 65535 : 0;
                              updateSelected(setNumPatch(selectedWorker as any, "unsackableRaw", "unsackableRaw", v) as any);
                            }}
                          />
                          <span style={{ fontWeight: 800 }}>Unsackable</span>
                        </label>

                        <label className="ewr-checkboxRow" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={getNum(selectedWorker as any, "creativeControlRaw") === 65535}
                            onChange={(e) => {
                              const v = e.target.checked ? 65535 : 0;
                              updateSelected(setNumPatch(selectedWorker as any, "creativeControlRaw", "creativeControlRaw", v) as any);
                            }}
                          />
                          <span style={{ fontWeight: 800 }}>Creative Control</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const contract = (getStr(selectedWorker as any, "contractCode") || "Non").trim();
                    const isWritten = contract === "Wri";

                    const getPromoSplits = (promoId: number): string[] => {
                      if (!promoId) return [];
                      const rec = employmentPromoRecords.find((r) => r.id === promoId);
                      if (!rec) return [];
                      return (rec.rosterSplits || [])
                        .map((s) => (s ?? "").trim())
                        .filter((s) => s && s.toLowerCase() !== "none");
                    };

                    const getManagersForPromo = (promoId: number) => {
                      if (!promoId) return [];
                      const list = (workers ?? [])
                        .filter((w) => {
                          const wAny: any = w as any;
                          const isManager =
                            getNum(wAny, "employer1PositionRaw") === 50 ||
                            getNum(wAny, "employer2PositionRaw") === 50 ||
                            getNum(wAny, "employer3PositionRaw") === 50;
                          if (!isManager) return false;
                          const hasSameEmployer =
                            getNum(wAny, "employer1PromoId") === promoId ||
                            getNum(wAny, "employer2PromoId") === promoId ||
                            getNum(wAny, "employer3PromoId") === promoId;
                          return hasSameEmployer;
                        })
                        .sort((a, b) => (getStr(a as any, "fullName") || "").localeCompare(getStr(b as any, "fullName") || ""));
                      return list;
                    };

                    const renderRosterField = (slot: 1 | 2 | 3, disabled: boolean) => {
                      const promoId = getNum(selectedWorker as any, `employer${slot}PromoId` as any) | 0;
                      const splits = getPromoSplits(promoId);
                      const fieldName = `employer${slot}Roster` as any;
                      const current = (getStr(selectedWorker as any, fieldName) || "None").trim() || "None";

                      if (splits.length) {
                        return (
                          <EwrSelectCompat
                            className="ewr-input"
                            disabled={disabled}
                            value={current}
                            onChange={(e) => {
                              const v = e.target.value || "None";
                              updateSelected(setStrPatch(selectedWorker as any, fieldName, fieldName, truncateAscii(v, 10)) as any);
                            }}
                          >
                            <option value="None">None</option>
                            {splits.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </EwrSelectCompat>
                        );
                      }

                      return (
                        <input
                          className="ewr-input"
                          disabled={disabled}
                          value={current}
                          maxLength={10}
                          onChange={(e) => {
                            const v = (e.target.value || "None").trim();
                            updateSelected(setStrPatch(selectedWorker as any, fieldName, fieldName, truncateAscii(v || "None", 10)) as any);
                          }}
                        />
                      );
                    };

                    const renderEmployerSelect = (slot: 1 | 2 | 3, disabled: boolean) => {
                      const fieldName = `employer${slot}PromoId` as any;
                      const cur = getNum(selectedWorker as any, fieldName) | 0;
                      const other1 = slot === 1 ? (getNum(selectedWorker as any, "employer2PromoId") | 0) : (getNum(selectedWorker as any, "employer1PromoId") | 0);
                      const other2 = slot === 3 ? (getNum(selectedWorker as any, "employer2PromoId") | 0) : (getNum(selectedWorker as any, "employer3PromoId") | 0);

                      const promoOptions = [...employmentPromos].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                      return (
                        <EwrSelectCompat
                          className="ewr-input"
                          disabled={disabled}
                          value={cur}
                          onChange={(e) => {
                            const id = Number(e.target.value) | 0;

                            // no duplicates across slots when Open.
                            if (id !== 0 && (id === other1 || id === other2)) {
                              setStatus("A worker cannot have the same promotion in multiple employer slots.");
                              return;
                            }

                            const patch: any = {};
                            patch[fieldName] = id;

                            // Native behavior: if any employer is set while Contract is None, it snaps to Open.
                            const c = (getStr(selectedWorker as any, "contractCode") || "Non").trim();
                            if (id !== 0 && c === "Non") {
                              patch.contractCode = "Opn";
                              setStatus('Native behavior: employed workers cannot have Contract "None" — switched to Open.');
                            }

                            updateSelected(patch);
                          }}
                        >
                          <option value={0}>None</option>
                          {promoOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </EwrSelectCompat>
                      );
                    };

                    const globalContractLength = clamp(getNum(selectedWorker as any, "contractLength1"), 0, 60);
                    const globalSalaryThousands = clamp(getNum(selectedWorker as any, "salary1"), 0, 300);
                    const globalSalaryDollars = globalSalaryThousands * 1000;
                    const rawEmploymentStatusCode = String(getStr(selectedWorker as any, "employmentStatusCode") || "Nor").trim();
                    const normalizedEmploymentStatusCode = rawEmploymentStatusCode || "Nor";
                    const currentEmploymentStatusLabel = normalizedEmploymentStatusCode === "Hom"
                      ? "Sitting Out Contract"
                      : normalizedEmploymentStatusCode === "Nor"
                        ? "Available"
                        : `Special (${normalizedEmploymentStatusCode})`;
                    const saveContractFixDisabled = !isSaveWorkspace;

                    const renderSlot = (slot: 1 | 2 | 3) => {
                      const disabled = isWritten && slot !== 1;
                      const promoId = getNum(selectedWorker as any, `employer${slot}PromoId` as any) | 0;

                      return (
                        <>
                          <div
                            style={{
                              marginTop: slot === 1 ? 14 : 18,
                              padding: 12,
                              borderRadius: 14,
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                              <div style={{ fontWeight: 800 }}>
                                Employer Slot #{slot}{disabled ? " (Disabled for Written)" : ""}
                              </div>
                              <button
                                type="button"
                                className="ewr-button ewr-buttonRed"
                                style={{ padding: "6px 10px" }}
                                onClick={() => {
                                  const patch: any = {};
                                  // Clearing an employment slot while Written should snap to Open (matches your spec).
                                  const c = (getStr(selectedWorker as any, "contractCode") || "Non").trim();
                                  // IMPORTANT: Only Employment #1 should snap Written -> Open.
                                  if (slot === 1 && c === "Wri") patch.contractCode = "Opn";

                                  patch[`employer${slot}PromoId`] = 0;
                                  patch[`employer${slot}PositionRaw`] = 0;
                                  patch[`employer${slot}Disposition`] = "F";
                                  patch[`employer${slot}Roster`] = "None";
                                  patch[`employer${slot}ManagerId`] = 0;
                                  patch[`employer${slot}GimmickId`] = 0;

                                  updateSelected(patch);
                                  setStatus(`Cleared Employment #${slot}.`);
                                }}
                                title={`Clear Employment #${slot}`}
                              >
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                  <IconScissors className="btnSvg" />
                                  Clear Employment #{slot}
                                </span>
                              </button>
                            </div>

                            <div className="ewr-grid ewr-gridAuto">
                            <div className="ewr-field">
                              <div className="ewr-label">Employer</div>
                              {renderEmployerSelect(slot, disabled)}
                              <div className="ewr-hint">Promotions are loaded from promos.dat in your DATA folder.</div>
                            </div>

                            <div className="ewr-field">
                              <div className="ewr-label">Position</div>
                              <EwrSelectCompat
                                className="ewr-input"
                                disabled={disabled}
                                value={getNum(selectedWorker as any, `employer${slot}PositionRaw` as any) | 0}
                                onChange={(e) => {
                                  const v = Number(e.target.value) | 0;
                                  updateSelected(setNumPatch(selectedWorker as any, `employer${slot}PositionRaw` as any, `employer${slot}PositionRaw` as any, v) as any);
                                }}
                              >
                                {POSITION_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </EwrSelectCompat>
                            </div>

                            <div className="ewr-field">
                              <div className="ewr-label">Disposition</div>
                              <EwrSelectCompat
                                className="ewr-input"
                                disabled={disabled}
                                value={getStr(selectedWorker as any, `employer${slot}Disposition` as any) || "F"}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  updateSelected(setStrPatch(selectedWorker as any, `employer${slot}Disposition` as any, `employer${slot}Disposition` as any, v) as any);
                                }}
                              >
                                {DISPOSITION_OPTIONS.map((o) => (
                                  <option key={o.code} value={o.code}>
                                    {o.label}
                                  </option>
                                ))}
                              </EwrSelectCompat>
                            </div>

                            <div className="ewr-field">
                              <div className="ewr-label">Roster Split</div>
                              {renderRosterField(slot, disabled)}
                            </div>

                            <div className="ewr-field">
                              <div className="ewr-label">Manager</div>
                              <EwrSelectCompat
                                className="ewr-input"
                                disabled={disabled}
                                value={getNum(selectedWorker as any, `employer${slot}ManagerId` as any) | 0}
                                onChange={(e) => {
                                  const v = Number(e.target.value) | 0;
                                  updateSelected(setNumPatch(selectedWorker as any, `employer${slot}ManagerId` as any, `employer${slot}ManagerId` as any, v) as any);
                                }}
                              >
                                <option value={0}>None</option>
                                {getManagersForPromo(promoId).map((m) => (
                                  <option key={(m as any).id} value={(m as any).id}>
                                    {getStr(m as any, "fullName") || `Worker ${(m as any).id}`}
                                  </option>
                                ))}
                              </EwrSelectCompat>
                            </div>

                            <div className="ewr-field">
                              <div className="ewr-label">Gimmick</div>
                              <EwrSelectCompat
                                className="ewr-input"
                                disabled={disabled}
                                value={getNum(selectedWorker as any, `employer${slot}GimmickId` as any) | 0}
                                onChange={(e) => {
                                  const v = Number(e.target.value) | 0;
                                  updateSelected(setNumPatch(selectedWorker as any, `employer${slot}GimmickId` as any, `employer${slot}GimmickId` as any, v) as any);
                                }}
                              >
                                {GIMMICKS_ALPHA.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </EwrSelectCompat>
                              <button
                                type="button"
                                className="ewr-button"
                                style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
                                disabled={disabled || !promoId}
                                onClick={() => setGimmickRecSlot(slot)}
                              >
                                Gimmick Recommendation
                              </button>
                            </div>

                          </div>
                          </div>
                        </>
                      );
                    };

                    return (
                      <>
                        <div
                          style={{
                            marginTop: 14,
                            padding: 12,
                            borderRadius: 14,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                            <div style={{ fontWeight: 800 }}>Save File Contract Fix</div>
                            <div className="ewr-hint" style={{ margin: 0 }}>
                              {isSaveWorkspace ? "Active in save-folder wrestler.dat workspaces." : "Inactive in DATA folder workspaces."}
                            </div>
                          </div>
                          <div
                            style={{
                              width: "100%",
                              display: "grid",
                              gap: 10,
                              padding: 14,
                              borderRadius: 16,
                              border: "1px solid rgba(255, 90, 90, 0.22)",
                              background: "linear-gradient(135deg, rgba(140, 10, 10, 0.28) 0%, rgba(55, 0, 0, 0.14) 35%, rgba(0, 0, 0, 0.04) 100%)",
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                              opacity: saveContractFixDisabled ? 0.55 : 1,
                            }}
                          >
                            <div style={{ fontSize: 12, lineHeight: 1.45, color: "rgba(255,240,240,0.92)" }}>
                              Save-file only. Salary is shown in full dollars but stored internally in thousands. Status actions target only the selected wrestler. Leave Status on Do Not Change to edit contract length and salary without changing status.
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, width: "100%" }}>
                              <div className="ewr-field" style={{ marginBottom: 0 }}>
                                <div className="ewr-label">Contract Length (Months)</div>
                                <input
                                  className="ewr-input"
                                  type="number"
                                  min={0}
                                  max={60}
                                  step={1}
                                  disabled={saveContractFixDisabled}
                                  value={globalContractLength}
                                  onChange={(e) => {
                                    const raw = Number(e.target.value || 0);
                                    const next = clamp(Math.round(raw), 0, 60);
                                    updateSelected(setNumPatch(selectedWorker as any, "contractLength1", "contractLength1", next) as any);
                                  }}
                                />
                              </div>

                              <div className="ewr-field" style={{ marginBottom: 0 }}>
                                <div className="ewr-label">Salary ($ per month / appearance)</div>
                                <input
                                  className="ewr-input"
                                  type="number"
                                  min={0}
                                  max={300000}
                                  step={1000}
                                  disabled={saveContractFixDisabled}
                                  value={globalSalaryDollars}
                                  onChange={(e) => {
                                    const raw = Number(e.target.value || 0);
                                    const dollars = clamp(Math.round(raw / 1000) * 1000, 0, 300000);
                                    const thousands = clamp(Math.round(dollars / 1000), 0, 300);
                                    updateSelected(setNumPatch(selectedWorker as any, "salary1", "salary1", thousands) as any);
                                  }}
                                />
                              </div>

                              <div className="ewr-field" style={{ marginBottom: 0 }}>
                                <div className="ewr-label">Status</div>
                                <EwrSelectCompat
                                  className="ewr-input"
                                  disabled={saveContractFixDisabled}
                                  value={saveContractFixStatusAction}
                                  onChange={(e) => {
                                    const action = e.target.value as "no_change" | "Available" | "Sitting Out Contract";
                                    setSaveContractFixStatusAction(action);
                                    if (action === "no_change") return;
                                    const next = action === "Sitting Out Contract" ? "Hom" : "Nor";
                                    updateSelected({
                                      ...setStrPatch(selectedWorker as any, "employmentStatusCode", "employmentStatusCode", next),
                                      employmentStatusLabel: next === "Hom" ? "Sitting Out Contract" : "Available",
                                    } as any);
                                    setSaveContractFixStatusAction("no_change");
                                  }}
                                >
                                  <option value="no_change">Do Not Change</option>
                                  <option value="Available">Set to Available</option>
                                  <option value="Sitting Out Contract">Set to Sitting Out Contract</option>
                                </EwrSelectCompat>
                                <div className="ewr-hint" style={{ marginTop: 6, marginBottom: 0 }}>
                                  Current stored status: <b>{currentEmploymentStatusLabel}</b> ({normalizedEmploymentStatusCode || "Nor"})
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {renderSlot(1)}
                        {renderSlot(2)}
                        {renderSlot(3)}

                        {isWritten ? (
                          <div className="ewr-hint" style={{ marginTop: 10 }}>
                            Contract Type is <b>Written</b>: Employer Slots #2 and #3 are visible but disabled.
                          </div>
                        ) : (
                          <div className="ewr-hint" style={{ marginTop: 10 }}>
                            Contract Type is <b>{contract === "Opn" ? "Open" : "None"}</b>: up to three employer slots can be used, but each slot must have a different promotion.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* WAGE (separate section, like the old working version) */}
              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Wage</div>
                </div>
                <div className="ewr-sectionBody">
                  <div style={{ maxWidth: 420 }}>
                    <div className="ewr-label">Wage ($) (0–300000)</div>
                    <NumberInput
                      className="ewr-input"
                      value={Number(
                        (selectedWorker as any).wageDollars ??
                          getNum(selectedWorker as any, "wageThousandsRaw", "wageRaw") * 1000
                      )}
                      min={0}
                      max={300000}
                      step={1000}
                      onChange={(next) => {
                        const clamped = clamp(next, 0, 300000);
                        const roundedDollars = clamp(Math.round(clamped / 1000) * 1000, 0, 300000);
                        const thousands = clamp(Math.round(roundedDollars / 1000), 0, 300);
                        updateSelected({
                          wageDollars: roundedDollars,
                          ...setNumPatch(selectedWorker as any, "wageThousandsRaw", "wageRaw", thousands),
                        } as any);
                      }}
                    />
                    <div className="ewr-hint">
                      Note: EWR stores wage in <b>$1000</b> units internally.
                    </div>
                  </div>
                </div>
              </div>


              {/* FINISHERS (supports old primary/secondary keys OR the newer generic keys) */}
              {(() => {
                const hasPrimary =
                  hasKey(selectedWorker as any, "primaryFinisherName") ||
                  hasKey(selectedWorker as any, "pfName") ||
                  hasKey(selectedWorker as any, "pfTypeFlagA") ||
                  hasKey(selectedWorker as any, "primaryFinisherTypeFlagA");

                const hasSecondary =
                  hasKey(selectedWorker as any, "secondaryFinisherName") ||
                  hasKey(selectedWorker as any, "sfName") ||
                  hasKey(selectedWorker as any, "sfTypeFlagA") ||
                  hasKey(selectedWorker as any, "secondaryFinisherTypeFlagA");

                // Generic fallback (your newer defensive keys)
                const nameKey =
                  hasKey(selectedWorker, "finisherName")
                    ? "finisherName"
                    : hasKey(selectedWorker, "finisher")
                    ? "finisher"
                    : hasKey(selectedWorker, "finisherMove")
                    ? "finisherMove"
                    : null;

                const AKey =
                  hasKey(selectedWorker, "finisherARaw")
                    ? "finisherARaw"
                    : hasKey(selectedWorker, "finisherA")
                    ? "finisherA"
                    : null;

                const BKey =
                  hasKey(selectedWorker, "finisherBRaw")
                    ? "finisherBRaw"
                    : hasKey(selectedWorker, "finisherB")
                    ? "finisherB"
                    : null;

                const CKey =
                  hasKey(selectedWorker, "finisherCRaw")
                    ? "finisherCRaw"
                    : hasKey(selectedWorker, "finisherC")
                    ? "finisherC"
                    : null;

                const shouldRender = hasPrimary || hasSecondary || nameKey || (AKey && BKey && CKey);
                if (!shouldRender) return null;

                return (
                  <div className="ewr-section">
                    <div className="ewr-sectionHeader">
                      <div className="ewr-sectionTitle">Finishers</div>
                    </div>

                    <div className="ewr-sectionBody">
                      {/* Old schema layout (primary/secondary) */}
                      {hasPrimary || hasSecondary ? (
                        <div className="ewr-grid" style={{ gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
                          {hasPrimary ? (
                            <>
                              <div className="ewr-field">
                                <div className="ewr-label">Primary Finisher Name (25)</div>
                                <input
                                  className="ewr-input"
                                  value={getStr(selectedWorker as any, "primaryFinisherName", "pfName")}
                                  maxLength={25}
                                  onChange={(e) =>
                                    updateSelected(
                                      setStrPatch(
                                        selectedWorker as any,
                                        hasKey(selectedWorker as any, "primaryFinisherName")
                                          ? "primaryFinisherName"
                                          : "pfName",
                                        hasKey(selectedWorker as any, "primaryFinisherName")
                                          ? "primaryFinisherName"
                                          : "pfName",
                                        e.target.value
                                      ) as any
                                    )
                                  }
                                />
                              </div>

                              <div className="ewr-field">
                                <div className="ewr-label">Primary Finisher Type</div>
                                <EwrSelectCompat
                                  className="ewr-input"
                                  value={decodeFinisherTypeFromABC(
                                    getNum(selectedWorker as any, "pfTypeFlagA", "primaryFinisherTypeFlagA"),
                                    getNum(selectedWorker as any, "pfTypeFlagB", "primaryFinisherTypeFlagB"),
                                    getNum(selectedWorker as any, "pfTypeFlagC", "primaryFinisherTypeFlagC")
                                  )}
                                  onChange={(e) => {
                                    const next = encodeFinisherTypeToABC(e.target.value);
                                    updateSelected({
                                      ...setNumPatch(
                                        selectedWorker as any,
                                        "pfTypeFlagA",
                                        "primaryFinisherTypeFlagA",
                                        next.A
                                      ),
                                      ...setNumPatch(
                                        selectedWorker as any,
                                        "pfTypeFlagB",
                                        "primaryFinisherTypeFlagB",
                                        next.B
                                      ),
                                      ...setNumPatch(
                                        selectedWorker as any,
                                        "pfTypeFlagC",
                                        "primaryFinisherTypeFlagC",
                                        next.C
                                      ),
                                    } as any);
                                  }}
                                >
                                  {finisherTypeOptions.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                </EwrSelectCompat>
                              </div>
                            </>
                          ) : null}

                          {hasSecondary ? (
                            <>
                              <div className="ewr-field">
                                <div className="ewr-label">Secondary Finisher Name (25)</div>
                                <input
                                  className="ewr-input"
                                  value={getStr(selectedWorker as any, "secondaryFinisherName", "sfName")}
                                  maxLength={25}
                                  onChange={(e) =>
                                    updateSelected(
                                      setStrPatch(
                                        selectedWorker as any,
                                        hasKey(selectedWorker as any, "secondaryFinisherName")
                                          ? "secondaryFinisherName"
                                          : "sfName",
                                        hasKey(selectedWorker as any, "secondaryFinisherName")
                                          ? "secondaryFinisherName"
                                          : "sfName",
                                        e.target.value
                                      ) as any
                                    )
                                  }
                                />
                              </div>

                              <div className="ewr-field">
                                <div className="ewr-label">Secondary Finisher Type</div>
                                <EwrSelectCompat
                                  className="ewr-input"
                                  value={decodeFinisherTypeFromABC(
                                    getNum(selectedWorker as any, "sfTypeFlagA", "secondaryFinisherTypeFlagA"),
                                    getNum(selectedWorker as any, "sfTypeFlagB", "secondaryFinisherTypeFlagB"),
                                    getNum(selectedWorker as any, "sfTypeFlagC", "secondaryFinisherTypeFlagC")
                                  )}
                                  onChange={(e) => {
                                    const next = encodeFinisherTypeToABC(e.target.value);
                                    updateSelected({
                                      ...setNumPatch(
                                        selectedWorker as any,
                                        "sfTypeFlagA",
                                        "secondaryFinisherTypeFlagA",
                                        next.A
                                      ),
                                      ...setNumPatch(
                                        selectedWorker as any,
                                        "sfTypeFlagB",
                                        "secondaryFinisherTypeFlagB",
                                        next.B
                                      ),
                                      ...setNumPatch(
                                        selectedWorker as any,
                                        "sfTypeFlagC",
                                        "secondaryFinisherTypeFlagC",
                                        next.C
                                      ),
                                    } as any);
                                  }}
                                >
                                  {finisherTypeOptions.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                </EwrSelectCompat>
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}

                      {/* Generic fallback (only if old keys aren't present) */}
                      {!hasPrimary && !hasSecondary && (nameKey || (AKey && BKey && CKey)) ? (
                        <div className="ewr-grid ewr-gridAuto" style={{ marginTop: hasPrimary || hasSecondary ? 16 : 0 }}>
                          {nameKey ? (
                            <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                              <div className="ewr-label">Finisher Name</div>
                              <input
                                className="ewr-input"
                                value={getStr(selectedWorker as any, nameKey)}
                                maxLength={40}
                                onChange={(e) =>
                                  updateSelected(
                                    setStrPatch(selectedWorker as any, nameKey, nameKey, e.target.value) as any
                                  )
                                }
                              />
                            </div>
                          ) : null}

                          {AKey && BKey && CKey ? (
                            <div className="ewr-field">
                              <div className="ewr-label">Finisher Type</div>
                              <EwrSelectCompat
                                className="ewr-input"
                                value={decodeFinisherTypeFromABC(
                                  getNum(selectedWorker as any, AKey),
                                  getNum(selectedWorker as any, BKey),
                                  getNum(selectedWorker as any, CKey)
                                )}
                                onChange={(e) => {
                                  const enc = encodeFinisherTypeToABC(e.target.value);
                                  updateSelected({ [AKey]: enc.A, [BKey]: enc.B, [CKey]: enc.C } as any);
                                }}
                              >
                                {finisherTypeOptions.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </EwrSelectCompat>
                              <div className="ewr-hint">Stored via A/B/C flags (EWR style).</div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })()}

              

              {/* CURRENT CHAMPIONSHIPS (read-only listing from belt.dat) */}
              {(() => {
                const workerId = Number((selectedWorker as any)?.id ?? 0) | 0;
                if (!workerId) return null;

                if (!wsHas("belt")) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Current Championships</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-muted">belt.dat not found in the selected DATA folder.</div>
                      </div>
                    </div>
                  );
                }

                if (beltLoadError) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Current Championships</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-warn">Failed to load belt.dat: {beltLoadError}</div>
                      </div>
                    </div>
                  );
                }

                const rows = (beltRecords || [])
                  .filter((b: any) => b.holder1Id === workerId || b.holder2Id === workerId)
                  .map((b: any) => ({
                    key: `${b.index}-${b.holder1Id}-${b.holder2Id}`,
                    beltName: (b.name || "(blank name)").trim(),
                    ownerName: promosById.get(Number(b.ownerPromoId) | 0) || "None",
                    partnerName:
                      Number(b.holder2Id) > 0
                        ? workerNameById.get(Number(b.holder1Id) === workerId ? Number(b.holder2Id) : Number(b.holder1Id)) ||
                          `ID ${Number(b.holder1Id) === workerId ? Number(b.holder2Id) : Number(b.holder1Id)}`
                        : "—",
                  }))
                  .sort((a: any, b: any) => a.beltName.localeCompare(b.beltName, undefined, { sensitivity: "base" }));

                return (
                  <div className="ewr-section">
                    <div className="ewr-sectionHeader">
                      <div className="ewr-sectionTitle">Current Championships</div>
                    </div>
                    <div className="ewr-sectionBody">
                      {rows.length === 0 ? (
                        <div className="ewr-muted">This worker does not currently hold any belts.</div>
                      ) : (
                        <div className="ewr-tagTeamsTable ewr-championshipsTable" role="table" aria-label="Current Championships">
                          <div className="ewr-tagTeamsRow ewr-tagTeamsHeader ewr-championshipsRow" role="row">
                            <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="columnheader">Championship</div>
                            <div className="ewr-tagTeamsCell" role="columnheader">Promotion</div>
                            <div className="ewr-tagTeamsCell" role="columnheader">Partner</div>
                          </div>
                          {rows.map((r: any) => (
                            <div key={r.key} className="ewr-tagTeamsRow ewr-championshipsRow" role="row">
                              <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="cell">{r.beltName}</div>
                              <div className="ewr-tagTeamsCell" role="cell">{r.ownerName}</div>
                              <div className="ewr-tagTeamsCell" role="cell">{r.partnerName}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* RELATIONSHIPS (read-only listing from relate.dat) */}
              {(() => {
                const workerId = Number((selectedWorker as any)?.id ?? 0) | 0;
                if (!workerId) return null;

                if (!wsHas("related")) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Relationships</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-muted">relate.dat not found in the selected DATA folder.</div>
                      </div>
                    </div>
                  );
                }

                if (relateLoadError) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Relationships</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-warn">Failed to load relate.dat: {relateLoadError}</div>
                      </div>
                    </div>
                  );
                }

                const rows = (relateRecords || [])
                  .filter((r) => r.personAId === workerId || r.personBId === workerId)
                  .map((r) => {
                    const otherId = r.personAId === workerId ? r.personBId : r.personAId;
                    const otherName = workerNameById.get(otherId) || (otherId ? `ID ${otherId}` : "Unknown");
                    return {
                      key: `${r.index}-${r.personAId}-${r.personBId}-${r.type}`,
                      otherName,
                      type: r.type,
                    };
                  })
                  .sort((a, b) => {
                    const n = a.otherName.localeCompare(b.otherName, undefined, { sensitivity: "base" });
                    if (n !== 0) return n;
                    return String(a.type).localeCompare(String(b.type), undefined, { sensitivity: "base" });
                  });

                return (
                  <div className="ewr-section">
                    <div className="ewr-sectionHeader">
                      <div className="ewr-sectionTitle">Relationships</div>
                    </div>
                    <div className="ewr-sectionBody">
                      {rows.length === 0 ? (
                        <div className="ewr-muted">No relationships found for this worker.</div>
                      ) : (
                        <div className="ewr-tagTeamsTable" role="table" aria-label="Relationships">
                          <div className="ewr-tagTeamsRow ewr-tagTeamsHeader" role="row">
                            <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="columnheader">Other Worker</div>
                            <div className="ewr-tagTeamsCell" role="columnheader">Type</div>
                          </div>
                          {rows.map((rr) => (
                            <div key={rr.key} className="ewr-tagTeamsRow" role="row">
                              <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="cell">{rr.otherName}</div>
                              <div className="ewr-tagTeamsCell" role="cell">{rr.type}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
{/* TAG TEAMS (read-only listing from teams.dat) */}
              {(() => {
                const workerId = Number((selectedWorker as any)?.id ?? 0) | 0;
                if (!workerId) return null;

                if (!wsHas("teams")) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Tag Teams</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-muted">teams.dat not found in the selected DATA folder.</div>
                      </div>
                    </div>
                  );
                }

                if (teamsLoadError) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Tag Teams</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-warn">Failed to load teams.dat: {teamsLoadError}</div>
                      </div>
                    </div>
                  );
                }

                const rows = (teams || [])
                  .filter((t) => t.partner1Id === workerId || t.partner2Id === workerId)
                  .map((t) => {
                    const otherId = t.partner1Id === workerId ? t.partner2Id : t.partner1Id;
                    const partnerName = workerNameById.get(otherId) || (otherId ? `ID ${otherId}` : "Unknown");
                    return {
                      key: `${t.index}-${t.partner1Id}-${t.partner2Id}`,
                      teamName: (t.teamName || "(no name)").trim(),
                      partnerName,
                      active: t.active ? "Yes" : "No",
                    };
                  })
                  .sort((a, b) => {
                    if (a.active !== b.active) return a.active === "Yes" ? -1 : 1;
                    return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: "base" });
                  });

                return (
                  <div className="ewr-section">
                    <div className="ewr-sectionHeader">
                      <div className="ewr-sectionTitle">Tag Teams</div>
                    </div>
                    <div className="ewr-sectionBody">
                      {rows.length === 0 ? (
                        <div className="ewr-muted">No tag teams found for this worker.</div>
                      ) : (
                        <div className="ewr-tagTeamsTable" role="table" aria-label="Tag Teams">
                          <div className="ewr-tagTeamsRow ewr-tagTeamsHeader" role="row">
                            <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="columnheader">
                              Team
                            </div>
                            <div className="ewr-tagTeamsCell" role="columnheader">
                              Partner
                            </div>
                            <div className="ewr-tagTeamsCell" role="columnheader">
                              Active
                            </div>
                          </div>

                          {rows.map((r) => (
                            <div key={r.key} className="ewr-tagTeamsRow" role="row">
                              <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="cell">
                                {r.teamName}
                              </div>
                              <div className="ewr-tagTeamsCell" role="cell">
                                {r.partnerName}
                              </div>
                              <div className="ewr-tagTeamsCell" role="cell">
                                {r.active}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* STABLES (read-only listing from stables.dat) */}
              {(() => {
                const workerId = Number((selectedWorker as any)?.id ?? 0) | 0;
                if (!workerId) return null;

                if (!wsHas("stables")) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Stables</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-muted">stables.dat not found in the selected DATA folder.</div>
                      </div>
                    </div>
                  );
                }

                if (stablesLoadError) {
                  return (
                    <div className="ewr-section">
                      <div className="ewr-sectionHeader">
                        <div className="ewr-sectionTitle">Stables</div>
                      </div>
                      <div className="ewr-sectionBody">
                        <div className="ewr-warn">Failed to load stables.dat: {stablesLoadError}</div>
                      </div>
                    </div>
                  );
                }

                const rows = (stables || [])
                  .flatMap((stable) => {
                    const isLeader = Number(stable.leaderId ?? 0) === workerId;
                    const isMember = (stable.memberIds || []).some((memberId) => Number(memberId ?? 0) === workerId);
                    if (!isLeader && !isMember) return [];
                    return [{
                      key: `${stable.index}-${isLeader ? "leader" : "member"}`,
                      stableName: (stable.stableName || "(no name)").trim(),
                      role: isLeader ? "Leader" : "Member",
                    }];
                  })
                  .sort((a, b) => {
                    const n = a.stableName.localeCompare(b.stableName, undefined, { sensitivity: "base" });
                    if (n !== 0) return n;
                    if (a.role === b.role) return 0;
                    return a.role === "Leader" ? -1 : 1;
                  });

                return (
                  <div className="ewr-section">
                    <div className="ewr-sectionHeader">
                      <div className="ewr-sectionTitle">Stables</div>
                    </div>
                    <div className="ewr-sectionBody">
                      {rows.length === 0 ? (
                        <div className="ewr-muted">No stables found for this worker.</div>
                      ) : (
                        <div className="ewr-tagTeamsTable" role="table" aria-label="Stables">
                          <div className="ewr-tagTeamsRow ewr-tagTeamsHeader" role="row" style={{ gridTemplateColumns: "1.6fr 0.8fr" }}>
                            <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="columnheader">Stable Name</div>
                            <div className="ewr-tagTeamsCell" role="columnheader">Role</div>
                          </div>
                          {rows.map((row) => (
                            <div key={row.key} className="ewr-tagTeamsRow" role="row" style={{ gridTemplateColumns: "1.6fr 0.8fr" }}>
                              <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="cell">{row.stableName}</div>
                              <div className="ewr-tagTeamsCell" role="cell">{row.role}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div style={{ height: 18 }} />
            
      {hoverHelp && typeof document !== "undefined"
        ? createPortal(
            <div
              style={{
                position: "fixed",
                left: hoverHelp.x,
                top: hoverHelp.y,
                minWidth: 240,
                maxWidth: 360,
                padding: "10px 12px",
                borderRadius: 12,
                border: "2px solid rgba(84, 255, 150, 0.95)",
                background: "#07110b",
                color: "#f4fff8",
                boxShadow: "0 16px 40px rgba(0,0,0,0.65)",
                fontSize: 12,
                lineHeight: 1.45,
                zIndex: 2147483647,
                pointerEvents: "none",
                whiteSpace: "normal",
              }}
            >
              {hoverHelp.text}
            </div>,
            document.body
          )
        : null}
</>
          )}
      </RightPanelShell>


      

      {massEditReportOpen ? (
        <div className="ewr-modalOverlay" onMouseDown={() => setMassEditReportOpen(false)} role="dialog" aria-modal="true">
          <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ewr-modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">{massEditReportTitle || "Mass Edit report"}</div>
                <div className="ewr-modalSub">Skipped workers: {massEditReportRows.length}</div>
              </div>
              <button className="ewr-iconBtn" title="Close" onClick={() => setMassEditReportOpen(false)} aria-label="Close mass edit report">×</button>
            </div>
            <div className="ewr-modalBody">
              <div className="ewr-modalList">
                {massEditReportRows.map((row, idx) => (
                  <div key={`${row.name}-${idx}`} className="ewr-importRow" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>{row.name}</div>
                    <div className="ewr-muted">{row.reason}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="ewr-modalFooter">
              <button className="ewr-button" type="button" onClick={() => setMassEditReportOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {csvModalOpen ? (
        <div className="ewr-modalOverlay" onMouseDown={closeCsvModal} role="dialog" aria-modal="true">
          <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ewr-modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">Import CSV</div>
                <div className="ewr-modalSub">
                  <span style={{ opacity: 0.85 }}>{csvSourcePath || ""}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="ewr-button" onClick={closeCsvModal} title="Close">
                  Close
                </button>
              </div>
            </div>

            <div className="ewr-modalBody" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="ewr-importSummary">
                <div><b>Rows:</b> {csvRowCount}</div>
                <div><b>Updates:</b> {csvPlannedUpdates.length}</div>
                <div><b>New:</b> {csvPlannedNewRows.length}</div>
                <div><b>Skipped duplicates:</b> {csvSkippedDuplicates.length}</div>
                <div><b>Invalid:</b> {csvInvalidRows.length}</div>
              </div>

              {csvImportInfo ? <div style={{ opacity: 0.9 }}>{csvImportInfo}</div> : null}

              {csvSkippedDuplicates.length ? (
                <div className="ewr-importBox">
                  <div className="ewr-importBoxTitle">Skipped duplicate names</div>
                  <div className="ewr-importScroll">
                    {csvSkippedDuplicates.map((n) => (
                      <div key={n} style={{ padding: "2px 0" }}>{n}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              {csvInvalidRows.length ? (
                <div className="ewr-importBox">
                  <div className="ewr-importBoxTitle">Invalid rows</div>
                  <div className="ewr-importScroll">
                    {csvInvalidRows.map((e, idx) => (
                      <div key={`${e.row}-${e.field}-${idx}`} style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontWeight: 850 }}>Row {e.row} — {e.field}</div>
                        <div style={{ opacity: 0.9 }}>{e.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button className="ewr-button" onClick={closeCsvModal}>Cancel</button>
                <button
                  className="ewr-button ewr-buttonApply"
                  onClick={applyCsvImport}
                  disabled={csvPlannedUpdates.length === 0 && csvPlannedNewRows.length === 0}
                  title="Apply valid updates and additions"
                >
                  Apply Import
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

{importModalOpen ? (
        <div className="ewr-modalOverlay" onMouseDown={closeImportModal} role="dialog" aria-modal="true">
          <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ewr-modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">Import Worker</div>
                <div className="ewr-modalSub">
                  Source: <span className="ewr-mono">{importSourcePath ? importSourcePath.split(/[\\/]/).pop() : ""}</span>
                </div>
              </div>
              <button className="ewr-iconBtn" title="Close" onClick={closeImportModal} aria-label="Close import">
                ×
              </button>
            </div>

            <div className="ewr-modalBody">
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="ewr-input"
                  style={{ flex: 1, minWidth: 220 }}
                  placeholder="Filter workers by name…"
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                />

                <button
                  className="ewr-button ewr-buttonSmall"
                  type="button"
                  onClick={() => {
                    const all = new Set(importVisibleWorkers.map((w: any) => w.index));
                    setImportSelection(all);
                  }}
                >
                  Select All
                </button>

                <button
                  className="ewr-button ewr-buttonSmall"
                  type="button"
                  onClick={() => setImportSelection(new Set())}
                >
                  Clear
                </button>
              </div>

              <div className="ewr-modalList">
                {importVisibleWorkers.length === 0 ? (
                  <div className="ewr-muted">No workers found.</div>
                ) : (
                  importVisibleWorkers.map((w: any) => {
                    const name = String(w.fullName || w.shortName || "(no name)").trim();
                    const checked = importSelection.has(w.index);
                    const importable = !!w.__importable;
                    const reason = String(w.__importReason || "");
                    const disabled = !importable;
                    const badgeLabel = disabled ? "Blocked" : "Importable";
                    const badgeStyle: CSSProperties = disabled
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
                      <label
                        key={`imp-${w.index}-${w.id}`}
                        className="ewr-importRow"
                        style={{ opacity: disabled ? 0.55 : 1 }}
                      >
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={checked}
                          onChange={(e) => toggleImportSelection(w.index, e.target.checked)}
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
                  })
                )}
              </div>

              {importInfo ? <div className="ewr-importInfo">{importInfo}</div> : null}
            </div>

            <div className="ewr-modalFooter">
              <div className="ewr-muted" style={{ marginRight: "auto" }}>
                Selected: {importSelection.size} / {importSourceWorkers.length}
              </div>

              <button className="ewr-button" type="button" onClick={closeImportModal}>
                Cancel
              </button>

              <button
                className="ewr-button ewr-buttonOrange"
                type="button"
                onClick={commitImportSelected}
                disabled={importSelection.size === 0}
              >
                Import Selected
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Minimal SVG sizing + remove number spinners so manual entry is clean */}
      <style>{`
        .btnSvg { width: 22px; height: 22px; margin-right: 8px; display: inline-block; }
        .iconBtnSvg { width: 22px; height: 22px; display: inline-block; }

        /* Remove number spinners (Chrome/Safari/Edge) */
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        /* Remove number spinners (Firefox) */
        input[type="number"] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>
        </div>
      </div>
      ) : null}

      {visitedSections.has("sponsors") ? (
      <div style={{ display: section === "sponsors" ? "block" : "none" }}>
        <SponsorEditor workspaceRoot={workspaceRoot} sponsorDataPath={wsPath("sponsor")} />
      </div>

      ) : null}

      {visitedSections.has("staff") ? (
      <div style={{ display: section === "staff" ? "block" : "none" }}>
        <StaffEditor workspaceRoot={workspaceRoot} staffDataPath={wsPath("staff")} promosDataPath={wsPath("promos")} />
      </div>

      ) : null}

      {visitedSections.has("tagTeams") ? (
      <div style={{ display: section === "tagTeams" ? "block" : "none" }}>
        <TeamsEditor workspaceRoot={workspaceRoot} teamsDataPath={wsPath("teams")} wrestlerDataPath={wsPath("wrestler")} />
      </div>

      ) : null}

      {visitedSections.has("stables") ? (
      <div style={{ display: section === "stables" ? "block" : "none" }}>
        <StablesEditor
          workspaceRoot={workspaceRoot}
          stablesDataPath={wsPath("stables")}
          wrestlerDataPath={wsPath("wrestler")}
          promosDataPath={wsPath("promos")}
        />
      </div>

      ) : null}

      {visitedSections.has("promotions") ? (
      <div style={{ display: section === "promotions" ? "block" : "none" }}>
        <PromotionsEditor
          workspaceRoot={workspaceRoot}
          promosDataPath={wsPath("promos")}
          staffDataPath={wsPath("staff")}
          wrestlerDataPath={wsPath("wrestler")}
          beltDataPath={wsPath("belt")}
          eventDataPath={wsPath("event")}
          tvDataPath={wsPath("tv")}
          networkDataPath={wsPath("network")}
          onPromosChanged={handlePromosChanged}
        />
      </div>

      ) : null}

      {visitedSections.has("alterEgos") ? (
      <div style={{ display: section === "alterEgos" ? "block" : "none" }}>
        <AlterEgosEditor workspaceRoot={workspaceRoot} alterDataPath={wsPath("alter")} />
      </div>

      ) : null}

      {visitedSections.has("relationships") ? (
      <div style={{ display: section === "relationships" ? "block" : "none" }}>
        <RelationshipsEditor workspaceRoot={workspaceRoot} relatedDataPath={wsPath("related")} wrestlerDataPath={wsPath("wrestler")} />
      </div>

      ) : null}

      {visitedSections.has("belts") ? (
      <div style={{ display: section === "belts" ? "block" : "none" }}>
        <BeltsEditor
          workspaceRoot={workspaceRoot}
          beltDataPath={wsPath("belt")}
          wrestlerDataPath={wsPath("wrestler")}
          promosDataPath={wsPath("promos")}
        />
      </div>
      ) : null}

      {visitedSections.has("events") ? (
      <div style={{ display: section === "events" ? "block" : "none" }}>
        <EventsEditor
          workspaceRoot={workspaceRoot}
          eventDataPath={wsPath("event")}
          promosDataPath={wsPath("promos")}
        />
      </div>
      ) : null}

      {visitedSections.has("gameInfo") ? (
      <div style={{ display: section === "gameInfo" ? "block" : "none" }}>
        <GameInfoEditor workspaceRoot={workspaceRoot} />
      </div>
      ) : null}

      {visitedSections.has("crankyVince") ? (
      <div style={{ display: section === "crankyVince" ? "block" : "none" }}>
        <CrankyVinceEditor
          workspaceRoot={workspaceRoot}
          onClose={() => setSection("home")}
        />
      </div>
      ) : null}

      {visitedSections.has("television") ? (
      <div style={{ display: section === "television" ? "block" : "none" }}>
        <TelevisionEditor
          workspaceRoot={workspaceRoot}
          tvDataPath={wsPath("tv")}
          promosDataPath={wsPath("promos")}
          networkDataPath={wsPath("network")}
          staffDataPath={wsPath("staff")}
          wrestlerDataPath={wsPath("wrestler")}
        />
      </div>
      ) : null}

      {visitedSections.has("tvNetworks") ? (
      <div style={{ display: section === "tvNetworks" ? "block" : "none" }}>
        <NetworksEditor
          workspaceRoot={workspaceRoot}
          networkDataPath={wsPath("network")}
        />
      </div>
      ) : null}



      {gimmickRecSlot && gimmickRecommendationData ? createPortal(
        <div className="ewr-modalOverlay" onMouseDown={() => setGimmickRecSlot(null)} role="dialog" aria-modal="true">
          <div
            className="ewr-modal"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              maxWidth: 980,
              width: "min(980px, calc(100vw - 40px))",
              maxHeight: "min(90vh, calc(100vh - 40px))",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="ewr-modalHeader" style={{ flex: "0 0 auto" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">Gimmick Recommendation</div>
                <div className="ewr-modalSub">Employment #{gimmickRecommendationData.slot} • {gimmickRecommendationData.promo?.name || "No promotion selected"}</div>
              </div>
              <button type="button" className="ewr-iconBtn" title="Close" onClick={() => setGimmickRecSlot(null)} aria-label="Close">×</button>
            </div>
            <div className="ewr-modalBody" style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 auto", minHeight: 0, overflowY: "auto", paddingRight: 6, paddingBottom: 6 }}>
              <div className="ewr-hint" style={{ flex: "0 0 auto" }}>This looks at the worker, the selected employment slot, and the promotion risk level, then shows gimmicks that already work, gimmicks that only need employment changes, and gimmicks that are blocked by profile/stat requirements.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, alignItems: "start" }}>
                <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="ewr-sectionTitle" style={{ margin: 0 }}>Works Now</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {gimmickRecommendationData.qualifiesNow.length === 0 ? <div className="ewr-muted">No direct fits were found.</div> : gimmickRecommendationData.qualifiesNow.map((row) => (
                      <div key={row.rule.id} className="ewr-nameCard" style={{ padding: 12, display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 800 }}>{row.rule.name}</div>
                        <div className="ewr-muted" style={{ fontSize: 12 }}>Already qualifies with the current worker and employment settings.</div>
                        <button type="button" className="ewr-button ewr-buttonGreen" onClick={() => applyGimmickRecommendation(row)}>Apply</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="ewr-sectionTitle" style={{ margin: 0 }}>Employment Fixes</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {gimmickRecommendationData.employmentOnly.length === 0 ? <div className="ewr-muted">No one-step employment fixes found.</div> : gimmickRecommendationData.employmentOnly.map((row) => (
                      <div key={row.rule.id} className="ewr-nameCard" style={{ padding: 12, display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 800 }}>{row.rule.name}</div>
                        <div className="ewr-muted" style={{ fontSize: 12 }}>{row.employmentFixes.join(" ")}</div>
                        <button type="button" className="ewr-button ewr-buttonBlue" onClick={() => applyGimmickRecommendation(row)}>Apply + Fix Employment</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="ewr-sectionTitle" style={{ margin: 0 }}>Blocked / Near Misses</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {gimmickRecommendationData.nearMisses.length === 0 ? <div className="ewr-muted">Nothing notable here.</div> : gimmickRecommendationData.nearMisses.map((row) => (
                      <div key={row.rule.id} className="ewr-nameCard" style={{ padding: 12, display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 800 }}>{row.rule.name}</div>
                        <div className="ewr-muted" style={{ fontSize: 12 }}>{[...row.unmet, ...row.notes].join(" ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
        </div>
      </div>
    </div>
  );
}
