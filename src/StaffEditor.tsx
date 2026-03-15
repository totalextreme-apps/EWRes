// src/StaffEditor.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { IconChecklist, IconGrid, IconImport, IconPlus } from "./components/icons/EwrIcons";
import EwrSelectCompat from "./components/inputs/EwrSelectCompat";
// Tauri v2 plugins
import { open, save } from "@tauri-apps/plugin-dialog";
import {readFile, writeFile, exists, copyFile, mkdir} from "@tauri-apps/plugin-fs";

import { parseStaffDat, type Staff, type StaffPosition, type OwnerStyle } from "./ewr/parseStaffDat";
import { validateStaffDatBytes, STAFF_LAYOUT } from "./ewr/validateStaffDat";
import { writeStaffDat } from "./ewr/writeStaffDat";

import { parsePromosDat, type Promo } from "./ewr/parsePromosDat";

function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

function norm(s: string) {
  return (s ?? "").trim().toLowerCase();
}


function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}


// ---------- CSV helpers (mirrors App.tsx wrestler external editor) ----------
type CsvRecord = Record<string, string>;

function csvEscape(value: any): string {
  const s = (value ?? "").toString();
  if (/[\",\n\r]/.test(s)) {
    return `"\${s.replace(/"/g, '""')}"`;
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
      continue; // handle CRLF by letting \n close the row
    }

    cur += ch;
  }

  // trailing
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((h) => (h ?? "").trim());
  const out: CsvRecord[] = [];

  for (const r of rows) {
    if (r.every((c) => (c ?? "").trim() === "")) continue;
    const rec: CsvRecord = {};
    for (let i = 0; i < headers.length; i++) rec[headers[i]] = r[i] ?? "";
    out.push(rec);
  }

  return { headers, rows: out };
}

function parseIntOrNull(v: any): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function boolToYesNo(v: any): "Yes" | "No" {
  if (v === true) return "Yes";
  const n = Number(v);
  if (Number.isFinite(n) && n !== 0) return "Yes";
  return "No";
}

function parseYesNo(v: any): boolean | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "yes" || s === "y" || s === "true" || s === "1") return true;
  if (s === "no" || s === "n" || s === "false" || s === "0") return false;
  return null;
}



function setU16LE(dst: Uint8Array, offset: number, value: number) {
  const v = Math.max(0, Math.min(0xffff, Math.floor(value)));
  dst[offset] = v & 0xff;
  dst[offset + 1] = (v >> 8) & 0xff;
}

function writeAsciiFixed(dst: Uint8Array, offset: number, length: number, value: string) {
  const s = (value ?? "").slice(0, length);
  for (let i = 0; i < length; i++) dst[offset + i] = 0x20;
  for (let i = 0; i < s.length; i++) dst[offset + i] = s.charCodeAt(i) & 0xff;
}

function concatBytes(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function stripEmploymentInStaffRecordBytes(rec: Uint8Array) {
  // Clear employer + contract so imported staff do not come in "signed"
  setU16LE(rec, STAFF_LAYOUT.employerIdOffset, 0);
  writeAsciiFixed(rec, STAFF_LAYOUT.contractOffset, 3, "Non");
}

// Photo-name helpers (match Wrestlers behavior)
function sanitizeAndTruncatePhotoBase(input: string): string {
  // keep letters/numbers/space/_/-
  const cleaned = (input ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9 _-]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 20);
  return cleaned;
}

function fullNameToUnderscore(fullName: string) {
  return (fullName ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 20);
}

const OWNER_STYLE_OPTIONS: OwnerStyle[] = [
  "Normal",
  "Prefers Brawling",
  "Prefers High Flying",
  "Prefers Technical Skill",
  "Prefers Characters",
  "Prefers T and A",
  "Prefers Veterans",
  "Prefers Mixed Martial Arts",
];

const MONTHS: { label: string; value: number }[] = [
  { label: "Unknown", value: 0 },
  { label: "January", value: 1 },
  { label: "February", value: 2 },
  { label: "March", value: 3 },
  { label: "April", value: 4 },
  { label: "May", value: 5 },
  { label: "June", value: 6 },
  { label: "July", value: 7 },
  { label: "August", value: 8 },
  { label: "September", value: 9 },
  { label: "October", value: 10 },
  { label: "November", value: 11 },
  { label: "December", value: 12 },
];


const MONTH_LABEL_TO_VALUE: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const it of MONTHS) m[(it.label ?? "").toLowerCase()] = it.value;
  return m;
})();

function birthMonthToLabel(v: number): string {
  const n = Number(v);
  const it = MONTHS.find((x) => x.value === n);
  return it ? it.label : String(n);
}

function parseBirthMonth(v: any): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const num = Number(s);
  if (Number.isFinite(num)) return Math.max(0, Math.min(12, Math.trunc(num)));
  const key = s.toLowerCase();
  if (key in MONTH_LABEL_TO_VALUE) return MONTH_LABEL_TO_VALUE[key];
  return null;
}

function parseStaffPosition(v: any): StaffPosition | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  const map: Record<string, StaffPosition> = {
    owner: "Owner",
    announcer: "Announcer",
    referee: "Referee",
    production: "Production",
    medical: "Medical",
    writer: "Writer",
    "road agent": "Road Agent",
    roadagent: "Road Agent",
    trainer: "Trainer",
    unknown: "Unknown",
  };
  return map[s] ?? null;
}


export default function StaffEditor({
  staffDataPath,
  promosDataPath,
}: {
  workspaceRoot: string;
  staffDataPath?: string | null;
  promosDataPath?: string | null;
}) {
  const [status, setStatus] = useState<string>("");
  const [dirty, setDirty] = useState<boolean>(false);

  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [staffBytes, setStaffBytes] = useState<Uint8Array | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [wageDraft, setWageDraft] = useState<string>("");

  // native-style delete/add/copy semantics
  const [multiDeleteMode, setMultiDeleteMode] = useState<boolean>(false);
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set());

  // promos
  const [promos, setPromos] = useState<Promo[]>([]);

  // Track promos.dat identity across reloads so staff employer IDs remain correct
  // when promotions are deleted/reordered.
  const promosKeyToIdRef = useRef<Map<string, number>>(new Map());

  function promoIdentityKey(p: { name?: string; shortName?: string }) {
    const name = (p.name ?? "").trim().toUpperCase();
    const init = (p.shortName ?? "").trim().toUpperCase();
    return `${name}__${init}`;
  }

  function remapStaffEmployerByPromos(prevStaff: Staff, idMap: Map<number, number>, newPromoCount: number): Staff {
    const s = { ...prevStaff } as Staff;
    const oldId = Number((s as any).employerId ?? 0) | 0;
    if (!oldId) return s;

    let newId = oldId;
    if (idMap.has(oldId)) newId = idMap.get(oldId) || 0;
    else if (oldId > newPromoCount) newId = 0;

    if (newId === 0) {
      (s as any).employerId = 0;
      (s as any).contract = "None";
    } else {
      (s as any).employerId = newId;
    }

    // If contract is Written but employer is None, normalize to None.
    if ((s as any).employerId === 0 && (s as any).contract === "Written") {
      (s as any).contract = "None";
    }

    return s;
  }
  const promosById = useMemo(() => {
    const m = new Map<number, Promo>();
    for (const p of promos) m.set(p.id, p);
    return m;
  }, [promos]);




// Import Staff (from another staff.dat)
const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
const [importSourcePath, setImportSourcePath] = useState<string>("");
const [importSourceBytes, setImportSourceBytes] = useState<Uint8Array | null>(null);
const [importSourceStaff, setImportSourceStaff] = useState<Staff[]>([]);
const [importSelection, setImportSelection] = useState<Set<number>>(new Set());
const [importSearch, setImportSearch] = useState<string>("");
const [importInfo, setImportInfo] = useState<string>("");

  // External Editing (CSV)
  const [externalEditingOpen, setExternalEditingOpen] = useState<boolean>(false);


const importVisibleStaff = useMemo(() => {
  const q = norm(importSearch);
  const list = importSourceStaff;
  if (!q) return list;
  return list.filter((s) => norm(s.name).includes(q));
}, [importSearch, importSourceStaff]);

// UI filters (match Sponsors/Wrestlers pattern)
type SortMode = "id" | "name";
type RoleFilter = "Everyone" | StaffPosition;

type StaffFilters = {
  gender: "Everyone" | "Male" | "Female";
  birthMonth: "Everyone" | "Unknown" | `${number}`; // 1..12
  ageMin: string;
  ageMax: string;
  wageMin: string;
  wageMax: string;
  talentMin: string;
  talentMax: string;
  backstageMin: string;
  backstageMax: string;
  worksFor: "any" | "none" | number;
  contractType: "any" | "None" | "Open" | "Written";
  role: RoleFilter;
  onlyBooker: boolean;
  onlyUnsackable: boolean;
  onlyTrainerRole: boolean;
};

const DEFAULT_FILTERS: StaffFilters = {
  gender: "Everyone",
  birthMonth: "Everyone",
  ageMin: "",
  ageMax: "",
  wageMin: "",
  wageMax: "",
  talentMin: "",
  talentMax: "",
  backstageMin: "",
  backstageMax: "",
  worksFor: "any",
  contractType: "any",
  role: "Everyone",
  onlyBooker: false,
  onlyUnsackable: false,
  onlyTrainerRole: false,
};

const [search, setSearch] = useState<string>("");
const [sortMode, setSortMode] = useState<SortMode>("name");

const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
const [filters, setFilters] = useState<StaffFilters>(DEFAULT_FILTERS);
const [draftFilters, setDraftFilters] = useState<StaffFilters>(DEFAULT_FILTERS);

const activeFilterCount = useMemo(() => {
  let n = 0;

  if (filters.gender !== "Everyone") n++;
  if (filters.birthMonth !== "Everyone") n++;

  if (filters.ageMin.trim() || filters.ageMax.trim()) n++;
  if (filters.wageMin.trim() || filters.wageMax.trim()) n++;
  if (filters.talentMin.trim() || filters.talentMax.trim()) n++;
  if (filters.backstageMin.trim() || filters.backstageMax.trim()) n++;

  if (filters.worksFor !== "any") n++;
  if (filters.contractType !== "any") n++;
  if (filters.role !== "Everyone") n++;

  if (filters.onlyBooker) n++;
  if (filters.onlyUnsackable) n++;
  if (filters.onlyTrainerRole) n++;

  return n;
}, [filters]);

function clearAllFilters() {
  setFilters(DEFAULT_FILTERS);
  setDraftFilters(DEFAULT_FILTERS);
}

const renderFilterPanel = (onClose: () => void) => (
  <div className="ewr-filterPanel">
    <div className="ewr-filterHeaderRow">
      <div className="ewr-filterTitle">Filter options</div>
      <div className="ewr-filterHeaderActions">
        <button
          type="button"
          className="ewr-button ewr-buttonSmall ewr-buttonApply"
          onClick={() => {
            setFilters(draftFilters);
            onClose();
          }}
        >
          Apply
        </button>

        <button
          type="button"
          className="ewr-button ewr-buttonSmall"
          onClick={() => {
            setDraftFilters(filters); // discard changes
            onClose();
          }}
        >
          Close
        </button>
      </div>
    </div>

    <div className="ewr-filterGrid">
      <div className="ewr-field">
        <div className="ewr-label">Gender</div>
        <EwrSelectCompat
          className="ewr-input"
          value={draftFilters.gender}
          onChange={(e) => setDraftFilters((p) => ({ ...p, gender: e.target.value as any }))}
        >
          <option value="Everyone">Any</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </EwrSelectCompat>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Birth Month</div>
        <EwrSelectCompat
          className="ewr-input"
          value={draftFilters.birthMonth}
          onChange={(e) => setDraftFilters((p) => ({ ...p, birthMonth: e.target.value as any }))}
        >
          <option value="Everyone">Any</option>
          <option value="Unknown">Unknown</option>
          <option value="1">January</option>
          <option value="2">February</option>
          <option value="3">March</option>
          <option value="4">April</option>
          <option value="5">May</option>
          <option value="6">June</option>
          <option value="7">July</option>
          <option value="8">August</option>
          <option value="9">September</option>
          <option value="10">October</option>
          <option value="11">November</option>
          <option value="12">December</option>
        </EwrSelectCompat>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Age (18-75)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={18}
            max={75}
            placeholder="Min"
            value={draftFilters.ageMin}
            onChange={(e) => setDraftFilters((p) => ({ ...p, ageMin: e.target.value }))}
          />
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={18}
            max={75}
            placeholder="Max"
            value={draftFilters.ageMax}
            onChange={(e) => setDraftFilters((p) => ({ ...p, ageMax: e.target.value }))}
          />
        </div>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Wage ($0-$100000)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            step={1000}
            placeholder="Min"
            value={draftFilters.wageMin}
            onChange={(e) => setDraftFilters((p) => ({ ...p, wageMin: e.target.value }))}
          />
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            step={1000}
            placeholder="Max"
            value={draftFilters.wageMax}
            onChange={(e) => setDraftFilters((p) => ({ ...p, wageMax: e.target.value }))}
          />
        </div>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Talent (0-100)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            placeholder="Min"
            value={draftFilters.talentMin}
            onChange={(e) => setDraftFilters((p) => ({ ...p, talentMin: e.target.value }))}
          />
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            placeholder="Max"
            value={draftFilters.talentMax}
            onChange={(e) => setDraftFilters((p) => ({ ...p, talentMax: e.target.value }))}
          />
        </div>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Backstage (0-100)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            placeholder="Min"
            value={draftFilters.backstageMin}
            onChange={(e) => setDraftFilters((p) => ({ ...p, backstageMin: e.target.value }))}
          />
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            placeholder="Max"
            value={draftFilters.backstageMax}
            onChange={(e) => setDraftFilters((p) => ({ ...p, backstageMax: e.target.value }))}
          />
        </div>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Works For</div>
        <EwrSelectCompat
          className="ewr-input"
          value={draftFilters.worksFor === "any" ? "any" : draftFilters.worksFor === "none" ? "none" : String(draftFilters.worksFor)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "any") setDraftFilters((p) => ({ ...p, worksFor: "any" }));
            else if (v === "none") setDraftFilters((p) => ({ ...p, worksFor: "none" }));
            else setDraftFilters((p) => ({ ...p, worksFor: Number(v) }));
          }}
        >
          <option value="any">Any</option>
          <option value="none">None</option>
          {promos
            .slice()
            .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }))
            .map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
        </EwrSelectCompat>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Contract Type</div>
        <EwrSelectCompat
          className="ewr-input"
          value={draftFilters.contractType}
          onChange={(e) => setDraftFilters((p) => ({ ...p, contractType: e.target.value as any }))}
        >
          <option value="any">Any</option>
          <option value="Written">Written</option>
          <option value="Open">Open</option>
          <option value="None">None</option>
        </EwrSelectCompat>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Role</div>
        <EwrSelectCompat
          className="ewr-input"
          value={draftFilters.role}
          onChange={(e) => setDraftFilters((p) => ({ ...p, role: e.target.value as any }))}
        >
          <option value="Everyone">Any</option>
          <option value="Owner">Owners</option>
          <option value="Announcer">Announcers</option>
          <option value="Referee">Referees</option>
          <option value="Production">Production</option>
          <option value="Medical">Medical</option>
          <option value="Writer">Writers</option>
          <option value="Road Agent">Road Agents</option>
          <option value="Trainer">Trainers</option>
        </EwrSelectCompat>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Attributes</div>
        <div className="ewr-filterTileGrid">
          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.onlyBooker}
              onChange={(e) => setDraftFilters((p) => ({ ...p, onlyBooker: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Booker</span>
          </label>

          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.onlyUnsackable}
              onChange={(e) => setDraftFilters((p) => ({ ...p, onlyUnsackable: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Unsackable</span>
          </label>

          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.onlyTrainerRole}
              onChange={(e) => setDraftFilters((p) => ({ ...p, onlyTrainerRole: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Trainer (role)</span>
          </label>
        </div>
      </div>
    </div>
  </div>
);

// Load promos automatically from workspace when available
  useEffect(() => {
    let cancelled = false;

    async function loadPromosFromWorkspace() {
      setPromos([]);
      if (!promosDataPath) return;
      try {
        if (!(await exists(promosDataPath))) return;
        const b = await readFile(promosDataPath);
        const u8 = new Uint8Array(b);
        const parsed = parsePromosDat(u8);
        if (cancelled) return;

        // Build identity mapping oldId -> newId so staff employerId stays attached to
        // the same promotion when promos.dat is deleted/reordered.
        const newKeyToId = new Map<string, number>();
        for (const p of parsed.promos) newKeyToId.set(promoIdentityKey(p), p.id);

        const oldKeyToId = promosKeyToIdRef.current;
        const idMap = new Map<number, number>();
        for (const [key, oldId] of oldKeyToId.entries()) {
          idMap.set(oldId, newKeyToId.get(key) || 0);
        }
        promosKeyToIdRef.current = newKeyToId;

        // Update promos used by dropdowns
        setPromos(parsed.promos);

        // Remap staff employer IDs; if an employer is deleted, clear employer + contract.
        setStaff((prev) => {
          if (!prev || prev.length === 0) return prev;
          return prev.map((s) => remapStaffEmployerByPromos(s, idMap, parsed.promos.length));
        });
      } catch (e) {
        console.warn("Failed to load promos.dat:", e);
      }
    }

    loadPromosFromWorkspace();
    return () => {
      cancelled = true;
    };
  }, [promosDataPath]);

  const selected = selectedIdx >= 0 && selectedIdx < staff.length ? staff[selectedIdx] : null;

  // Wage input: keep a string draft for typing; commit rounding on blur.
  useEffect(() => {
    if (!selected) {
      setWageDraft("");
      return;
    }
    if (selected.position === "Owner") {
      setWageDraft("0");
      return;
    }
    setWageDraft(String(selected.wageDollars ?? 0));
  }, [selectedIdx, staff.length]);

  
  const visibleIndices = useMemo(() => {
    const norm = (s: string) => (s || "").toLowerCase();
    const q = norm(search).trim();
  
    const toNum = (v: string, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
  
    const ageMin = filters.ageMin.trim() ? toNum(filters.ageMin, 18) : null;
    const ageMax = filters.ageMax.trim() ? toNum(filters.ageMax, 75) : null;
  
    const wageMin = filters.wageMin.trim() ? toNum(filters.wageMin, 0) : null;
    const wageMax = filters.wageMax.trim() ? toNum(filters.wageMax, 100000) : null;
  
    const talentMin = filters.talentMin.trim() ? toNum(filters.talentMin, 0) : null;
    const talentMax = filters.talentMax.trim() ? toNum(filters.talentMax, 100) : null;
  
    const backstageMin = filters.backstageMin.trim() ? toNum(filters.backstageMin, 0) : null;
    const backstageMax = filters.backstageMax.trim() ? toNum(filters.backstageMax, 100) : null;
  
    const out: number[] = [];
  
    for (let i = 0; i < staff.length; i++) {
      const s = staff[i];
  
      // search (name / id / record #)
      if (q) {
        const hay = `${norm(s.name)} ${s.id} ${s.index + 1}`;
        if (!hay.includes(q)) continue;
      }
  
      // gender
      if (filters.gender !== "Everyone" && s.gender !== filters.gender) continue;
  
      // birth month
      if (filters.birthMonth !== "Everyone") {
        if (filters.birthMonth === "Unknown") {
          if ((s.birthMonth ?? 0) !== 0) continue;
        } else {
          const bm = Number(filters.birthMonth);
          if ((s.birthMonth ?? 0) !== bm) continue;
        }
      }
  
      // age
      if (ageMin !== null && s.age < ageMin) continue;
      if (ageMax !== null && s.age > ageMax) continue;
  
      // wage
      if (wageMin !== null && s.wageDollars < wageMin) continue;
      if (wageMax !== null && s.wageDollars > wageMax) continue;
  
      // talent/backstage
      if (talentMin !== null && s.talent < talentMin) continue;
      if (talentMax !== null && s.talent > talentMax) continue;
  
      if (backstageMin !== null && s.backstage < backstageMin) continue;
      if (backstageMax !== null && s.backstage > backstageMax) continue;
  
      // works for
      if (filters.worksFor !== "any") {
        if (filters.worksFor === "none") {
          if ((s.employerId ?? 0) !== 0) continue;
        } else {
          const pid = Number(filters.worksFor) | 0;
          if ((s.employerId ?? 0) !== pid) continue;
        }
      }

      // contract type
      if (filters.contractType !== "any") {
        if (s.contract !== filters.contractType) continue;
      }

      // role
      if (filters.role !== "Everyone" && s.position !== filters.role) continue;
  
      // attributes
      if (filters.onlyBooker && !s.booker) continue;
      if (filters.onlyUnsackable && !s.unsackable) continue;
      if (filters.onlyTrainerRole && s.position !== "Trainer") continue;
  
      out.push(i);
    }
  
    // sort
    if (sortMode === "id") {
      out.sort((a, b) => staff[a].id - staff[b].id);
    } else {
      out.sort((a, b) => (staff[a].name || "").localeCompare(staff[b].name || "", undefined, { sensitivity: "base" }));
    }
  
    return out;
  }, [staff, promos, search, filters, sortMode]);

  
  // Keep selection valid if filters change
  useEffect(() => {
    if (!staff.length) {
      setSelectedIdx(-1);
      return;
    }
  
    if (selectedIdx < 0) {
      if (visibleIndices.length) setSelectedIdx(visibleIndices[0]);
      return;
    }
  
    const isVisible = visibleIndices.includes(selectedIdx);
    if (!isVisible) {
      if (visibleIndices.length) setSelectedIdx(visibleIndices[0]);
      else setSelectedIdx(-1);
    }
  }, [staff.length, selectedIdx, visibleIndices]);
  


  async function loadStaffFromPath(path: string) {
    setStatus("");
    try {
      const b = await readFile(path);
      const u8 = new Uint8Array(b);
      validateStaffDatBytes(u8);
      const parsed = parseStaffDat(u8);

      setStaffBytes(u8);
      setStaff(parsed.staff);
      setLoadedPath(path);
      setDirty(false);
      setStatus(`Loaded ${parsed.staff.length} staff from ${path}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Load failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onLoadFromData() {
    if (!staffDataPath) {
      setStatus("No staff.dat found in selected DATA folder.");
      return;
    }
    await loadStaffFromPath(staffDataPath);
  }

  async function onSave() {
    if (!loadedPath) {
      setStatus("No file loaded.");
      return;
    }

    setStatus("");
    try {
      const out = writeStaffDat(staff);
      // backup alongside file
      const backup = buildEwresBackupPath(loadedPath);
      try {
        const backupDir = backup.slice(0, backup.lastIndexOf("/"));
        await mkdir(backupDir, { recursive: true });
        if (await exists(loadedPath) && !(await exists(backup))) {
          await copyFile(loadedPath, backup);
        }
      } catch {
        // ignore
      }
      await writeFile(loadedPath, out);
      setDirty(false);
      setStatus(`Saved ${staff.length} records. Backup: ${backup}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Save failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onImportStaff() {
  try {
  if (!staffBytes) {
  setStatus("Load staff.dat first.");
  return;
  }

  const chosen = await open({
  multiple: false,
  filters: [{ name: "EWR staff.dat", extensions: ["dat"] }],
  });

  if (!chosen) return;

  const p = String(chosen);
  const bytes = await readFile(p);
  validateStaffDatBytes(bytes);

  const parsed = parseStaffDat(bytes).staff;
  // Mark importability (blank name / already exists) and sort importable first, then A→Z by name.
  const existingNames = new Set(staff.map((s) => String(s.name ?? "").trim().toLowerCase()));
  const annotated = parsed.map((s: any) => {
  const name = String(s.name ?? "").trim();
  if (!name) return { ...s, __importable: false, __importReason: "blank name" };
  if (existingNames.has(name.toLowerCase())) return { ...s, __importable: false, __importReason: "already exists" };
  return { ...s, __importable: true, __importReason: "" };
  });

  const sorted = [...annotated].sort((a: any, b: any) => {
  const ai = !!a.__importable;
  const bi = !!b.__importable;
  if (ai !== bi) return ai ? -1 : 1;
  return String(a.name ?? "").toLowerCase().localeCompare(String(b.name ?? "").toLowerCase());
  });

  setImportSourcePath(p);
  setImportSourceBytes(bytes);
  setImportSourceStaff(sorted);
  setImportSelection(new Set());
  setImportSearch("");
  setImportInfo("");
  setImportModalOpen(true);
  } catch (e: any) {
  console.error(e);
  setStatus(`Import load failed: ${e?.message ?? String(e)}`);
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
  setImportSourceStaff([]);
  setImportSourceBytes(null);
  setImportSourcePath("");
  }

  function commitImportSelected() {
  try {
  if (!staffBytes) {
  setStatus("Load staff.dat first.");
  return;
  }
  if (!importSourceBytes) {
  setImportInfo("No import file loaded.");
  return;
  }
  if (importSelection.size === 0) {
  setImportInfo("Select at least one staff record to import.");
  return;
  }

  const recordSize = STAFF_LAYOUT.recordSize;
  const markerOffset = STAFF_LAYOUT.markerOffset;
  const markerValue = STAFF_LAYOUT.markerValue;
  const idOffset = STAFF_LAYOUT.idOffset;

  const existingNames = new Set(staff.map((s) => String(s.name ?? "").trim().toLowerCase()));

  let nextBytes = staffBytes;
  let maxId = staff.reduce((m, s) => Math.max(m, Number(s.id ?? 0)), 0);

  const imported: Staff[] = [];
  const skippedDupes: string[] = [];
  const skippedEmpty: string[] = [];

  const selected = importSourceStaff.filter((s) => importSelection.has(s.index));
  for (const src of selected) {
  const name = String(src.name ?? "").trim();
  const key = name.toLowerCase();

  if (!name) {
  skippedEmpty.push("(unnamed)");
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
  rec[markerOffset] = markerValue & 0xff;
  setU16LE(rec, idOffset, newId);
  stripEmploymentInStaffRecordBytes(rec);

  nextBytes = concatBytes(nextBytes, rec);

  imported.push({
  ...src,
  index: newIndex,
  id: newId,
  employerId: 0,
  contract: "None",
  _raw: rec,
  });

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

  setStaffBytes(nextBytes);
  setStaff((prev) => [...prev, ...imported]);
  setSelectedIdx(imported[0].index);
  setDirty(true);

  const dupeMsg = skippedDupes.length ? ` Skipped duplicates: ${skippedDupes.join(", ")}.` : "";
  const emptyMsg = skippedEmpty.length ? ` Skipped unnamed/bad: ${skippedEmpty.join(", ")}.` : "";
  setStatus(`Imported ${imported.length} staff record(s).${dupeMsg}${emptyMsg} Click Save to write to disk.`);
  closeImportModal();
  } catch (e: any) {
  console.error(e);
  setImportInfo(`Import failed: ${e?.message ?? String(e)}`);
  }
  }


function smallestMissingPositiveId(existing: Staff[]) {
  const used = new Set<number>();
  for (const s of existing) {
    if (typeof s.id === "number" && s.id > 0) used.add(s.id);
  }
  let id = 1;
  while (used.has(id)) id++;
  return id;
}


  // ---------- External Editing (CSV) ----------
  const STAFF_CSV_HEADERS = [
    "Record Number",
    "Staff ID",
    "Staff Name",
    "Photo Name",
    "Birth Month",
    "Age",
    "Wage",
    "Position",
    "Booker (Yes/No)",
    "Unsackable (Yes/No)",
    "Talent",
    "Backstage",
  ];

  async function onExportStaffCsv() {
    try {
      if (!staffBytes) {
        setStatus("Load staff.dat first.");
        return;
      }

      const defaultName = loadedPath ? loadedPath.replace(/\.dat$/i, ".csv") : "staff.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const lines: string[] = [];
      lines.push(STAFF_CSV_HEADERS.map(csvEscape).join(","));

      const sorted = [...staff].sort((a: any, b: any) => Number(a.index ?? 0) - Number(b.index ?? 0));
      for (const s of sorted as any[]) {
        const recNo = Number(s.index ?? 0);
        const id = Number(s.id ?? 0);
        const name = String(s.name ?? "");
        const photo = String(s.picture ?? "");
        const birthMonth = birthMonthToLabel(Number(s.birthMonth ?? 0));
        const age = Number(s.age ?? 0);
        const wage = Number(s.wageDollars ?? 0);
        const position = String(s.position ?? "Unknown");
        const booker = boolToYesNo(Boolean(s.booker));
        const unsackable = boolToYesNo(Boolean(s.unsackable));
        const talent = Number(s.talent ?? 0);
        const backstage = Number(s.backstage ?? 0);

        const row = [
          recNo,
          id,
          name,
          photo,
          birthMonth,
          age,
          wage,
          position,
          booker,
          unsackable,
          talent,
          backstage,
        ]
          .map(csvEscape)
          .join(",");
        lines.push(row);
      }

      // Excel often mis-detects UTF-8 unless the CSV includes a UTF-8 BOM.
      // We intentionally export UTF-8 with BOM to preserve accented characters.
      await writeFile(outPath, new TextEncoder().encode("\uFEFF" + lines.join("\n")));
      setExternalEditingOpen(false);
      setStatus(`Exported CSV: ${outPath}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onImportStaffCsv() {
    try {
      if (!staffBytes) {
        setStatus("Load staff.dat first.");
        return;
      }

      const picked = await open({
        title: "Import CSV",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!picked) return;
      const csvPath = Array.isArray(picked) ? String(picked[0]) : String(picked);
      if (!csvPath) return;

      const bytes = await readFile(csvPath);
      // Strip UTF-8 BOM if present (common when editing/saving in Excel)
      const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
      const parsed = parseCsv(text);

      const actual = parsed.headers.map((h) => String(h ?? "").trim());
      const missing = STAFF_CSV_HEADERS.filter((h) => !actual.includes(h));
      if (missing.length) {
        setStatus(`CSV header mismatch. Missing: ${missing.join(", ")}`);
        setExternalEditingOpen(false);
        return;
      }

      // Build lookup maps for existing records
      const byIndex = new Map<number, Staff>();
      const byId = new Map<number, Staff>();
      for (const s of staff) {
        byIndex.set(Number(s.index), s);
        byId.set(Number(s.id), s);
      }

      const usedIds = new Set<number>(staff.map((s) => Number(s.id)).filter((n) => Number.isFinite(n) && n > 0));

      let updated = 0;
      let added = 0;

      const nextList: Staff[] = staff.map((s: any, i: number) => ({ ...s, index: i, _raw: new Uint8Array(s._raw) }));

      for (const row of parsed.rows) {
        const recNo = parseIntOrNull(row["Record Number"]);
        const idIn = parseIntOrNull(row["Staff ID"]);

        // Target selection: record number first, then Staff ID
        let targetIdx: number | null = null;
        if (recNo !== null && recNo >= 0 && recNo < nextList.length) targetIdx = recNo;
        else if (idIn !== null) {
          const found = nextList.findIndex((s) => Number(s.id) === idIn);
          if (found >= 0) targetIdx = found;
        }

        const nameStr = row["Staff Name"] ?? "";
        const photoStr = row["Photo Name"] ?? "";
        const birthStr = row["Birth Month"] ?? "";
        const ageStr = row["Age"] ?? "";
        const wageStr = row["Wage"] ?? "";
        const posStr = row["Position"] ?? "";
        const bookerStr = row["Booker (Yes/No)"] ?? "";
        const unsackStr = row["Unsackable (Yes/No)"] ?? "";
        const talentStr = row["Talent"] ?? "";
        const backstageStr = row["Backstage"] ?? "";

        const name = String(nameStr ?? "").trim();
        const photo = String(photoStr ?? "").trim();

        const birthMonthMaybe = parseBirthMonth(birthStr);
        const ageMaybe = parseIntOrNull(ageStr);
        const wageMaybe = parseIntOrNull(wageStr);
        const posMaybe = parseStaffPosition(posStr);
        const bookerMaybe = parseYesNo(bookerStr);
        const unsackMaybe = parseYesNo(unsackStr);
        const talentMaybe = parseIntOrNull(talentStr);
        const backstageMaybe = parseIntOrNull(backstageStr);

        if (targetIdx !== null) {
          // Update existing
          const cur = nextList[targetIdx];
          const next: Staff = { ...cur, _raw: new Uint8Array(cur._raw) };

          if (name !== "") next.name = name.slice(0, 25);
          if (photo !== "") next.picture = photo.slice(0, 20);

          if (birthMonthMaybe !== null) next.birthMonth = clamp(birthMonthMaybe, 0, 12);
          if (ageMaybe !== null) next.age = clamp(ageMaybe, 0, 65535);

          if (posMaybe) next.position = posMaybe;

          // Wage only meaningful when not Owner; keep zero for Owner.
          if (wageMaybe !== null) next.wageDollars = Math.max(0, Math.trunc(wageMaybe));
          if (next.position === "Owner") next.wageDollars = 0;

          if (bookerMaybe !== null) next.booker = bookerMaybe;
          if (unsackMaybe !== null) next.unsackable = unsackMaybe;

          if (talentMaybe !== null) next.talent = clamp(talentMaybe, 0, 100);
          if (backstageMaybe !== null) next.backstage = clamp(backstageMaybe, 0, 100);

          nextList[targetIdx] = next;
          updated++;
        } else {
          // Add new
          const template = nextList.length ? nextList[0]._raw : null;
          let newId: number;

          if (idIn !== null && idIn > 0 && !usedIds.has(idIn)) {
            newId = idIn;
          } else {
            newId = 1;
            while (usedIds.has(newId)) newId++;
          }
          usedIds.add(newId);

          const rec: Staff = {
            index: nextList.length,
            id: newId,
            name: name.slice(0, 25),
            gender: "Male",
            picture: photo.slice(0, 20),
            birthMonth: birthMonthMaybe !== null ? clamp(birthMonthMaybe, 0, 12) : 1,
            age: ageMaybe !== null ? clamp(ageMaybe, 0, 65535) : 18,
            employerId: 0,
            contract: "None",
            position: posMaybe ?? "Announcer",
            wageDollars: wageMaybe !== null ? Math.max(0, Math.trunc(wageMaybe)) : 0,
            ownerStyle: "Normal",
            talent: talentMaybe !== null ? clamp(talentMaybe, 0, 100) : 0,
            backstage: backstageMaybe !== null ? clamp(backstageMaybe, 0, 100) : 0,
            unsackable: unsackMaybe ?? false,
            booker: bookerMaybe ?? false,
            _raw: makeNewRecordRaw(template),
          };

          if (rec.position === "Owner") rec.wageDollars = 0;

          nextList.push(rec);
          added++;
        }
      }

      // Re-index
      for (let i = 0; i < nextList.length; i++) nextList[i].index = i;

      setStaff(nextList);
      setSelectedIdx(Math.min(selectedIdx >= 0 ? selectedIdx : 0, nextList.length - 1));
      setDirty(true);
      setExternalEditingOpen(false);
      setStatus(`Imported CSV: updated ${updated}, added ${added}. Click Save to write to disk.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import CSV failed: ${e?.message ?? String(e)}`);
      setExternalEditingOpen(false);
    }
  }


function makeUniqueName(existing: Staff[], baseName: string) {
  const base = (baseName ?? "").trim();
  if (!base) return "";
  const used = new Set(existing.map((s) => norm(s.name)));
  if (!used.has(norm(base))) return base;

  let n = 1;
  while (n < 9999) {
    const candidate = `${base} (${n})`;
    if (!used.has(norm(candidate))) return candidate;
    n++;
  }
  return `${base} (copy)`;
}

function makeNewRecordRaw(templateRaw?: Uint8Array | null) {
  const size = 79;
  const raw = templateRaw && templateRaw.length === size ? new Uint8Array(templateRaw) : new Uint8Array(size);
  // Ensure marker + id are set by writer via structured fields, but keep marker sane here too
  raw[0] = 0x34;
  return raw;
}

function deleteIndices(indices: number[]) {
  if (!indices.length) return;
  const toDelete = Array.from(new Set(indices)).filter((i) => i >= 0 && i < staff.length);
  if (!toDelete.length) return;

  // delete descending so indices remain valid
  toDelete.sort((a, b) => b - a);

  setStaff((prev) => {
    const next = prev.slice();
    for (const idx of toDelete) next.splice(idx, 1);
    return next;
  });

  // selection fixup
  const minDeleted = Math.min(...toDelete);
  setSelectedIdx((prevSel) => {
    if (prevSel < 0) return -1;
    if (toDelete.includes(prevSel)) {
      // select nearest surviving row
      const nextIdx = Math.min(minDeleted, staff.length - toDelete.length - 1);
      return nextIdx >= 0 ? nextIdx : -1;
    }
    // shift selection if rows before selection were deleted
    const shift = toDelete.filter((d) => d < prevSel).length;
    return prevSel - shift;
  });

  setDirty(true);
}

function onAddNewStaff() {
    let newIndex = 0;
    setStaff((prev) => {
      newIndex = prev.length;
    const id = smallestMissingPositiveId(prev);
    const template = prev.length ? prev[0]._raw : null;
    const rec: Staff = {
      index: newIndex,
      id,
      name: "",
      gender: "Male",
      picture: "",
      birthMonth: 1,
      age: 18,

      employerId: 0,
      contract: "None",

      position: "Announcer",
      wageDollars: 0,
      ownerStyle: "Normal",

      talent: 0,
      backstage: 0,

      unsackable: false,
      booker: false,

      _raw: makeNewRecordRaw(template),
    };
    return [...prev, rec];
  });

  setDirty(true);
  setMultiDeleteMode(false);
  setMultiSelected(new Set());
  // select new record (end)
  setSelectedIdx(newIndex);
  }

function onCopyStaffAtIndex(idx: number) {
  if (idx < 0 || idx >= staff.length) return;
  let newIndex = 0;
  setStaff((prev) => {
    newIndex = prev.length;
    const source = prev[idx];
    const id = smallestMissingPositiveId(prev);
    const copiedName = makeUniqueName(prev, source.name || "Staff");
    const rec: Staff = {
      ...source,
      index: newIndex,
      id,
      name: copiedName,
      _raw: new Uint8Array(source._raw),
    };
    return [...prev, rec];
  });
  setDirty(true);
  setMultiDeleteMode(false);
  setMultiSelected(new Set());
  setSelectedIdx(newIndex);
}

function onDeleteStaffAtIndex(idx: number) {
  if (idx < 0 || idx >= staff.length) return;
  deleteIndices([idx]);
}

function onToggleMultiDelete() {
  setMultiDeleteMode(true);
  setMultiSelected(new Set());
}

function onCancelMultiDelete() {
  setMultiDeleteMode(false);
  setMultiSelected(new Set());
}

function onMultiSelectAllVisible() {
  setMultiSelected(new Set(visibleIndices));
}

function onMultiSelectNone() {
  setMultiSelected(new Set());
}

function toggleMultiSelected(idx: number, checked: boolean) {
  setMultiSelected((prev) => {
    const next = new Set(prev);
    if (checked) next.add(idx);
    else next.delete(idx);
    return next;
  });
}

function onDeleteMultiSelected() {
  const indices = Array.from(multiSelected.values());
  if (!indices.length) return;
  if (indices.length >= staff.length) {
    setStatus("You cannot multi-delete all staff. At least one record must remain.");
    return;
  }
  deleteIndices(indices);
  setMultiSelected(new Set());
  setMultiDeleteMode(false);
}



  function updateSelected(patch: Partial<Staff>) {
    if (!selected) return;
    setStaff((prev) => {
      const next = prev.slice();
      next[selectedIdx] = { ...next[selectedIdx], ...patch };
      return next;
    });
    setDirty(true);
  }

  const employerLabel = useMemo(() => {
    if (!selected) return "";
    const pid = selected.employerId ?? 0;
    if (!pid) return "None";
    const p = promosById.get(pid);
    if (!p) return `ID ${pid}`;
    return p.shortName || p.name || `ID ${pid}`;
  }, [selected, promosById]);

  // 2x2 header layout per your mock
  const canSave = Boolean(loadedPath) && Boolean(staffBytes) && staff.length > 0 && dirty;

  const leftHeader = (
    <LeftPanelFileActions
      title="Staff"
      subtitle="staff.dat"
      loadFromData={{
        disabled: !staffDataPath,
        title: !staffDataPath ? "Select a DATA folder first" : "Load staff.dat from selected DATA folder",
        onClick: onLoadFromData,
        label: "Load from DATA",
      }}
      closeFile={{
        onClick: async () => {
          if (!loadedPath && !staff.length) return;
          if (dirty) {
            const ok = window.confirm("You have unsaved changes. Save before closing?\n\nOK = Save, Cancel = Close without saving");
            if (ok) {
              await onSave();
              if (dirty) return;
            }
          }
          setLoadedPath(null);
          setStaffBytes(null);
          setStaff([]);
          setSelectedIdx(-1);
          setSearch("");
          setDirty(false);
          setStatus("Closed file.");
        },
        label: "Close File",
        disabled: !loadedPath && !staff.length,
        title: !loadedPath && !staff.length ? "No file loaded" : "Close staff.dat",
      }}
      saveFile={{
        disabled: !canSave,
        title: !canSave ? "Load staff.dat first" : "Save changes to staff.dat",
        onClick: onSave,
        label: "Save File",
      }}
    />
  );


  return (
    <div className="ewr-app">
      {/* LEFT */}
      <div className="ewr-panel ewr-left">
        <div className="ewr-panelHeader">{leftHeader}</div>

        

<div className="ewr-leftMiddle ewr-scroll">
  <div style={{ padding: 10 }}>
    <div className="ewr-leftBody" style={{ padding: 0 }}>
      <LeftPanelSearchHeader
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search (name / id / record #)"
        sortValue={sortMode}
        onSortChange={setSortMode}
        sortOptions={[
          { value: "id", label: "Sort: ID" },
          { value: "name", label: "Sort: Name" },
        ]}
        showingCount={visibleIndices.length}
        totalCount={staff.length}
        filtersOpen={filtersOpen}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() =>
          setFiltersOpen((v) => {
            const next = !v;
            if (!v) setDraftFilters(filters);
            return next;
          })
        }
        onClearFilters={clearAllFilters}
        clearFiltersDisabled={activeFilterCount === 0}
      />

      {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
    </div>

    <div className="ewr-workerList" style={{ padding: 0, marginTop: 10 }}>
      {visibleIndices.map((idx) => {
        const s = staff[idx];
        const isActive = idx === selectedIdx;
        const checked = multiSelected.has(idx);

        return (
          <LeftPanelNameCard
            key={`staff-${idx}`}
            name={s.name || "(blank name)"}
            isSelected={isActive}
            onSelect={() => {
              if (multiDeleteMode) {
                toggleMultiSelected(idx, !checked);
                return;
              }
              setSelectedIdx(idx);
            }}
            leading={
              multiDeleteMode ? (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleMultiSelected(idx, e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 18, height: 18 }}
                  title="Select for multi-delete"
                />
              ) : null
            }
            // Keep copy/delete icons visible in multi-delete mode to match other editors.
            onCopy={() => onCopyStaffAtIndex(idx)}
            onDelete={() => onDeleteStaffAtIndex(idx)}
            copyTitle="Copy staff"
            deleteTitle="Delete staff"
          />
        );
      })}

{!visibleIndices.length ? (
  <div className="ewr-muted" style={{ padding: 12, opacity: 0.85 }}>
    No matching staff.
  </div>
) : null}
    </div>




          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              icon: <IconPlus className="btnSvg" />,
              label: "Add New Staff",
              onClick: onAddNewStaff,
              title: "Add a new staff member",
            },
            {
              key: "multi",
              icon: <IconChecklist className="btnSvg" />,
              label: !multiDeleteMode
                ? "Multi-Delete"
                : multiSelected.size === 0
                  ? "Cancel Multi-Delete"
                  : `Delete Selected (${multiSelected.size})`,
              className:
                multiDeleteMode && multiSelected.size > 0 ? "ewr-button ewr-buttonRed" : "ewr-button",
              onClick: () => {
                if (!multiDeleteMode) {
                  onToggleMultiDelete();
                  setStatus(
                    "Multi-Delete mode enabled: tick staff to delete, then click Multi-Delete again to commit.",
                  );
                  return;
                }

                if (multiSelected.size === 0) {
                  onCancelMultiDelete();
                  setStatus("Multi-Delete mode disabled.");
                  return;
                }

                const count = multiSelected.size;
                const ok = window.confirm(
                  `Delete ${count} staff record${count === 1 ? "" : "s"}?\n\nThis will permanently remove the selected records.`,
                );
                if (!ok) return;

                onDeleteMultiSelected();
                setStatus(`Deleted ${count} staff record${count === 1 ? "" : "s"}.`);
              },
              title:
                !multiDeleteMode
                  ? "Enable multi-delete selection"
                  : multiSelected.size
                    ? `Click again to delete selected (${multiSelected.size})`
                    : "Disable multi-delete (no selection)",
              disabled: !staff.length,
            },
            {
              key: "import",
              icon: <IconImport className="btnSvg" />,
              label: "Import Staff",
              onClick: onImportStaff,
              disabled: !staffBytes,
              title: staffBytes ? "Import staff from another staff.dat" : "Load staff.dat first",
            },
            {
              key: "external",
              icon: <IconGrid className="btnSvg" />,
              label: "External Editing",
              className: "ewr-button ewr-buttonYellow",
              onClick: () => setExternalEditingOpen((v) => !v),
              disabled: !staffBytes,
              title: staffBytes ? "Export / import CSV for external editing" : "Load staff.dat first",
            },
          ]}
          after={
            <>
              {multiDeleteMode ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={onMultiSelectAllVisible}
                    disabled={!visibleIndices.length}
                    title="Select all visible staff"
                  >
                    Select All
                  </button>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={onMultiSelectNone}
                    disabled={!multiSelected.size}
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
                    onClick={() => onExportStaffCsv()}
                    disabled={!staff.length}
                    title="Export staff to CSV"
                  >
                    Export CSV
                  </button>

                  <button
                    type="button"
                    className="ewr-button ewr-buttonSmall"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => onImportStaffCsv()}
                    disabled={!staff.length}
                    title="Import staff from a CSV"
                  >
                    Import CSV
                  </button>
                </div>
              ) : null}

</>
          }
        />
      </div>

      
{/* RIGHT */}
<RightPanelShell
  header={
    <>
      <div className="ewr-mainTitleBar">{selected ? `Editing: ${selected.name || "(blank)"}` : "Staff"}</div>

      <div className="ewr-mainMetaRow">
        <div className="ewr-pillRow">
          <div className="ewr-pill">Category: Staff</div>
          <div className="ewr-pill">
            Loaded: <b>{staff.length}</b>
          </div>
          {selected ? (
            <div className="ewr-pill">
              Record <b>#{selected.index + 1}</b> — Staff ID <b>{selected.id}</b>
            </div>
          ) : null}
        </div>

        <div className="ewr-pillRow">
          <div className="ewr-pill">{loadedPath ? "staff.dat loaded" : "staff.dat not loaded"}</div>
          <div className="ewr-pill">{promos.length ? "promos.dat loaded" : "promos.dat not loaded"}</div>
          {status ? <div className="ewr-pill">{status}</div> : null}
          <div className="ewr-pill">{dirty ? "Unsaved changes" : "Saved"}</div>
          <div className="ewr-pill">Staff Editor</div>
        </div>
      </div>
    </>
  }
>
    {!selected ? (
      <div className="ewr-muted">Open staff.dat, then select a staff member.</div>
    ) : (
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <h2 className="ewr-h2">{selected.name || "(blank name)"}</h2>
          <div className="ewr-muted">
            Record <b>#{selected.index + 1}</b> — Staff ID <b>{selected.id}</b>
          </div>
        </div>

        {/* Identity */}
        <div className="ewr-section">
          <div className="ewr-sectionHeader">
            <div className="ewr-sectionTitle">Identity</div>
          </div>
          <div className="ewr-sectionBody">
            <div className="ewr-grid ewr-gridAuto">
              <div className="ewr-field">
                <div className="ewr-label">Name (25)</div>
                <input
                  className="ewr-input"
                  value={selected.name}
                  maxLength={25}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                />
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Gender</div>
                <EwrSelectCompat
                  className="ewr-input"
                  value={selected.gender}
                  onChange={(e) => updateSelected({ gender: e.target.value as any })}
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </EwrSelectCompat>
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Birth Month</div>
                <EwrSelectCompat
                  className="ewr-input"
                  value={selected.birthMonth}
                  onChange={(e) => updateSelected({ birthMonth: Number(e.target.value) })}
                >
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </EwrSelectCompat>
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Profile Photo Name (20)</div>
                <input
                  className="ewr-input"
                  value={selected.picture}
                  maxLength={20}
                  onChange={(e) => updateSelected({ picture: e.target.value })}
                />
              

<div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
  <button
    type="button"
    className="ewr-button"
    onClick={() => {
      const full = (selected.name ?? "").trim();
      if (!full) return;
      const cleaned = sanitizeAndTruncatePhotoBase(full);
      updateSelected({ picture: cleaned });
    }}
  >
    Set as Staff Name
  </button>

  <button
    type="button"
    className="ewr-button"
    onClick={() => {
      const full = (selected.name ?? "").trim();
      if (!full) return;
      const underscored = fullNameToUnderscore(full);
      const cleaned = sanitizeAndTruncatePhotoBase(underscored);
      updateSelected({ picture: cleaned });
    }}
  >
    Set as Staff_Name
  </button>
</div></div>

              <div className="ewr-field">
                <div className="ewr-label">Age (18–75)</div>
                <input
                  className="ewr-input"
                  type="number"
                  min={18}
                  max={75}
                  value={selected.age}
                  onChange={(e) => updateSelected({ age: clamp(Number(e.target.value), 18, 75) })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Professional Details */}
        <div className="ewr-section">
          <div className="ewr-sectionHeader">
            <div className="ewr-sectionTitle">Professional Details</div>
          </div>
          <div className="ewr-sectionBody">
            <div className="ewr-grid ewr-gridAuto">
              <div className="ewr-field">
                <div className="ewr-label">Employer</div>
                {promos.length ? (
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selected.employerId}
                    onChange={(e) => {
                      const nextId = Number(e.target.value) | 0;
                      // Keep state sane: no employer should always mean Contract=None.
                      updateSelected(nextId === 0 ? { employerId: 0, contract: "None" } : { employerId: nextId });
                    }}
                  >
                    <option value={0}>None</option>
                    {promos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.shortName || p.name}
                      </option>
                    ))}
                  </EwrSelectCompat>
                ) : (
                  <input
                    className="ewr-input"
                    type="number"
                    value={selected.employerId}
                    min={0}
                    max={65535}
                    onChange={(e) => updateSelected({ employerId: clamp(Number(e.target.value), 0, 65535) })}
                  />
                )}
                <div className="ewr-muted" style={{ marginTop: 4 }}>
                  Current: {employerLabel}
                </div>
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Contract</div>
                <EwrSelectCompat
                  className="ewr-input"
                  value={selected.contract}
                  onChange={(e) => updateSelected({ contract: e.target.value as any })}
                >
                  <option value="None">None</option>
                  <option value="Written">Written</option>
                </EwrSelectCompat>
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Position</div>
                <EwrSelectCompat
                  className="ewr-input"
                  value={selected.position}
                  onChange={(e) => updateSelected({ position: e.target.value as any })}
                >
                  <option value="Owner">Owner</option>
                  <option value="Announcer">Announcer</option>
                  <option value="Referee">Referee</option>
                  <option value="Production">Production</option>
                  <option value="Medical">Medical</option>
                  <option value="Writer">Writer</option>
                  <option value="Road Agent">Road Agent</option>
                  <option value="Trainer">Trainer</option>
                </EwrSelectCompat>
              </div>

              {selected.position === "Owner" ? (
                <div className="ewr-field">
                  <div className="ewr-label">Style</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selected.ownerStyle}
                    onChange={(e) => updateSelected({ ownerStyle: e.target.value as any })}
                  >
                    {OWNER_STYLE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>
              ) : null }
            </div>
          </div>
        </div>

        {/* Wage */}
        <div className="ewr-section">
          <div className="ewr-sectionHeader">
            <div className="ewr-sectionTitle">Wage</div>
          </div>
          <div className="ewr-sectionBody">
            <div className="ewr-grid ewr-gridAuto">
              {selected.position === "Owner" ? (
                <div className="ewr-muted">Owners do not use Wage.</div>
              ) : (
                <div className="ewr-field">
                  <div className="ewr-label">Wage ($0–$100000)</div>
                  <input
                    className="ewr-input"
                    type="text"
                    inputMode="numeric"
                    value={wageDraft}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        setWageDraft("");
                        return;
                      }
                      const cleaned = v.replace(/[^0-9]/g, "");
                      setWageDraft(cleaned);
                    }}
                    onBlur={() => {
                      const raw = Number(wageDraft || "0");
                      const clamped = clamp(raw, 0, 100000);
                      const rounded = clamp(Math.round(clamped / 1000) * 1000, 0, 100000);
                      setWageDraft(String(rounded));
                      updateSelected({ wageDollars: rounded });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Skills */}
        <div className="ewr-section">
          <div className="ewr-sectionHeader">
            <div className="ewr-sectionTitle">Skills</div>
          </div>
          <div className="ewr-sectionBody">
            <div className="ewr-grid ewr-gridAuto">
              <div className="ewr-field">
                <div className="ewr-label">Talent (0–100)</div>
                <input
                  className="ewr-input"
                  type="number"
                  min={0}
                  max={100}
                  value={selected.talent}
                  onChange={(e) => updateSelected({ talent: clamp(Number(e.target.value), 0, 100) })}
                />
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Backstage (0–100)</div>
                <input
                  className="ewr-input"
                  type="number"
                  min={0}
                  max={100}
                  value={selected.backstage}
                  onChange={(e) => updateSelected({ backstage: clamp(Number(e.target.value), 0, 100) })}
                />
              </div>
            </div>
          </div>
        </div>
        {/* Attributes/Flags */}
        <div className="ewr-section">
          <div className="ewr-sectionHeader">
            <div className="ewr-sectionTitle">Attributes/Flags</div>
          </div>
          <div className="ewr-sectionBody">
            <div className="ewr-grid ewr-gridAuto">
              <div className="ewr-field">
                <div className="ewr-label">Booker</div>
                <label className="ewr-checkboxLabel">
                  <input
                    type="checkbox"
                    checked={selected.booker}
                    onChange={(e) => updateSelected({ booker: e.target.checked })}
                  />
                  <span>Booker</span>
                </label>
              </div>

              <div className="ewr-field">
                <div className="ewr-label">Unsackable</div>
                <label className="ewr-checkboxLabel">
                  <input
                    type="checkbox"
                    checked={selected.unsackable}
                    onChange={(e) => updateSelected({ unsackable: e.target.checked })}
                  />
                  <span>Unsackable</span>
                </label>
              </div>
            </div>
          </div>
        </div>

      </div>
    )}
 </RightPanelShell>

{importModalOpen ? (
  <div className="ewr-modalOverlay" onMouseDown={closeImportModal} role="dialog" aria-modal="true">
    <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ewr-modalHeader">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <div className="ewr-modalTitle">Import Staff</div>
          <div className="ewr-modalSub">
            Source:{" "}
            <span className="ewr-mono">
              {importSourcePath ? importSourcePath.split(/[\\/]/).pop() : ""}
            </span>
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
            placeholder="Filter staff by name…"
            value={importSearch}
            onChange={(e) => setImportSearch(e.target.value)}
          />

          <button
            className="ewr-button ewr-buttonSmall"
            type="button"
            onClick={() => {
              const all = new Set(importVisibleStaff.map((s) => s.index));
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
          {importVisibleStaff.length === 0 ? (
            <div className="ewr-muted">No staff found.</div>
          ) : (
            importVisibleStaff.map((s: any) => {
              const name = String(s.name || "(no name)").trim();
              const checked = importSelection.has(s.index);
              const importable = !!s.__importable;
              const reason = String(s.__importReason || "");
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
                <label
                  key={`imp-${s.index}-${s.id}`}
                  className="ewr-importRow"
                  style={{ opacity: disabled ? 0.55 : 1 }}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={(e) => toggleImportSelection(s.index, e.target.checked)}
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
          Selected: {importSelection.size} / {importSourceStaff.length}
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


    </div>
  );
}