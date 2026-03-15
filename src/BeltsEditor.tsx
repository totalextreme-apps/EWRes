import { useEffect, useMemo, useState } from "react";

import {exists, readFile, writeFile, copyFile, mkdir} from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { IconGrid, IconImport, IconPlus, IconChecklist } from "./components/icons/EwrIcons";
import { EditorHeader } from "./components/rightpanel/EditorHeader";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";

import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { parsePromosDat, type PromoRecord } from "./ewr/parsePromosDat";
import { alertWarning, confirmWarning } from "./utils/dialogs";

// ---------------- CSV helpers (kept local to match other editors) ----------------
function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type CsvRow = Record<string, string>;

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => String(h ?? "").trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: CsvRow = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = String(cols[c] ?? "");
    rows.push(row);
  }
  return { headers, rows };
}

function boolToYesNo(b: boolean) {
  return b ? "Yes" : "No";
}

function yesNoToBool(s: string) {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "yes" || v === "y" || v === "true" || v === "1") return true;
  if (v === "no" || v === "n" || v === "false" || v === "0") return false;
  return false;
}

function parseIntOrNull(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return null;
  return n;
}

function normalizeFullName(s: string) {
  return (s ?? "").trim();
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

type Props = {
  workspaceRoot: string;
  beltDataPath?: string;
  wrestlerDataPath?: string;
  promosDataPath?: string;
};

type BeltRecord = {
  index: number;
  name: string;
  ownerPromoId: number; // promo id (u16)
  holder1Id: number; // wrestler id
  holder2Id: number; // wrestler id (0 for singles)
  isSinglesTitle: boolean; // UI state (until singles flag offset is fully verified)
  womensTitle: boolean;
  lightweightTitle: boolean;
  suspended: boolean;
  image: number; // 0-100
};

const BELT_RECORD_SIZE = 457;

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function asciiTrim(s: string) {
  return (s ?? "").replace(/\0/g, "").trimEnd().trim();
}

function readU16LE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function writeU16LE(bytes: Uint8Array, offset: number, value: number) {
  const v = value & 0xffff;
  bytes[offset] = v & 0xff;
  bytes[offset + 1] = (v >> 8) & 0xff;
}

function encodeLatin1Fixed(s: string, width: number) {
  const out = new Uint8Array(width);
  const str = (s ?? "").slice(0, width).padEnd(width, " ");
  for (let i = 0; i < width; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function parseBeltDat(bytes: Uint8Array): BeltRecord[] {
  if (!bytes?.length) return [];
  if (bytes.length % BELT_RECORD_SIZE !== 0) {
    throw new Error(`belt.dat size invalid: ${bytes.length} bytes (expected multiple of ${BELT_RECORD_SIZE})`);
  }

  const count = bytes.length / BELT_RECORD_SIZE;
  const out: BeltRecord[] = [];
  for (let i = 0; i < count; i++) {
    const base = i * BELT_RECORD_SIZE;
    // Name is fixed-width. Observed: record starts with ASCII '4' then the name.
    const rawName = new TextDecoder("latin1").decode(bytes.slice(base + 1, base + 31));
    const name = asciiTrim(rawName) || "(blank name)";

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

function normQuery(q: string) {
  return q.trim().toLowerCase();
}

function normalizeNameForUniq(name: string) {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default function BeltsEditor(props: Props) {
  const [status, setStatus] = useState<string>("");
  const [filePath, setFilePath] = useState<string>(props.beltDataPath ?? "");
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);

  const [records, setRecords] = useState<BeltRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [imageDraft, setImageDraft] = useState<string>("0");
  const [dirty, setDirty] = useState<boolean>(false);

  // Lookups
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [promos, setPromos] = useState<PromoRecord[]>([]);
  const promosById = useMemo(() => {
    const m = new Map<number, string>();
    for (let i = 0; i < promos.length; i++) {
      const p = promos[i];
      m.set(Number(p.id) | 0, (p.name ?? "").trim() || `Promotion ${Number(p.id) | 0}`);
    }
    return m;
  }, [promos]);

  // Left panel
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<"record" | "name">("name");
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);


type BeltFilters = {
  ownerId: string; // "Everyone" or promoId string
  singlesOnly: boolean;
  tagOnly: boolean;
  vacantOnly: boolean;
  womensOnly: boolean;
  lightweightOnly: boolean;
  suspendedOnly: boolean;
  imageMin: string;
  imageMax: string;
};

const [filters, setFilters] = useState<BeltFilters>({
  ownerId: "Everyone",
  singlesOnly: false,
  tagOnly: false,
  vacantOnly: false,
  womensOnly: false,
  lightweightOnly: false,
  suspendedOnly: false,
  imageMin: "",
  imageMax: "",
});

const [draftFilters, setDraftFilters] = useState<BeltFilters>(filters);

const activeFilterCount = useMemo(() => {
  let n = 0;
  if (filters.ownerId !== "Everyone") n++;
  if (filters.singlesOnly) n++;
  if (filters.tagOnly) n++;
  if (filters.vacantOnly) n++;
  if (filters.womensOnly) n++;
  if (filters.lightweightOnly) n++;
  if (filters.suspendedOnly) n++;
  if (filters.imageMin.trim()) n++;
  if (filters.imageMax.trim()) n++;
  return n;
}, [filters]);

function clearAllFilters() {
  const cleared: BeltFilters = {
    ownerId: "Everyone",
    singlesOnly: false,
    tagOnly: false,
    vacantOnly: false,
    womensOnly: false,
    lightweightOnly: false,
    suspendedOnly: false,
    imageMin: "",
    imageMax: "",
  };
  setFilters(cleared);
  setDraftFilters(cleared);
}

const renderFilterPanel = (onClose: () => void) => (
  <div className="ewr-filterPanel" style={{ overflowX: "hidden" }}>
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
            setDraftFilters(filters);
            onClose();
          }}
        >
          Close
        </button>
      </div>
    </div>

    <div className="ewr-filterGrid">
      <div className="ewr-field">
        <div className="ewr-label">Belt Owner</div>
        <select
          className="ewr-input"
          value={draftFilters.ownerId}
          onChange={(e) => setDraftFilters((p) => ({ ...p, ownerId: e.target.value }))}
        >
          <option value="Everyone">Any</option>
          {[...promos]
            .slice()
            .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }))
            .map((p) => (
              <option key={`promo-${p.id}`} value={String(p.id)}>
                {p.name}
              </option>
            ))}
        </select>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Title Type</div>
        <div className="ewr-filterTileGrid" style={{ paddingTop: 6 }}>
          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.singlesOnly}
              onChange={(e) => setDraftFilters((p) => ({ ...p, singlesOnly: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Singles Title</span>
          </label>

          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.tagOnly}
              onChange={(e) => setDraftFilters((p) => ({ ...p, tagOnly: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Tag Title</span>
          </label>
        </div>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Status</div>
        <div className="ewr-filterTileGrid" style={{ paddingTop: 6 }}>
          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.vacantOnly}
              onChange={(e) => setDraftFilters((p) => ({ ...p, vacantOnly: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Vacant</span>
          </label>

          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.suspendedOnly}
              onChange={(e) => setDraftFilters((p) => ({ ...p, suspendedOnly: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Suspended</span>
          </label>
        </div>
      </div>

      <div className="ewr-field">
        <div className="ewr-label">Eligibility Flags</div>
        <div className="ewr-filterTileGrid" style={{ paddingTop: 6 }}>
          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.womensOnly}
              onChange={(e) => setDraftFilters((p) => ({ ...p, womensOnly: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Women&apos;s Title</span>
          </label>

          <label className="ewr-checkboxRow ewr-filterTile">
            <input
              className="ewr-filterTileControl"
              type="checkbox"
              checked={draftFilters.lightweightOnly}
              onChange={(e) => setDraftFilters((p) => ({ ...p, lightweightOnly: e.target.checked }))}
            />
            <span className="ewr-filterTileLabel">Lightweight Title</span>
          </label>
        </div>
      </div>

      <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
        <div className="ewr-label">Image (0-100)</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
            width: "100%",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            placeholder="Min"
            value={draftFilters.imageMin}
            onChange={(e) => setDraftFilters((p) => ({ ...p, imageMin: e.target.value }))}
          />
          <input
            className="ewr-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            placeholder="Max"
            value={draftFilters.imageMax}
            onChange={(e) => setDraftFilters((p) => ({ ...p, imageMax: e.target.value }))}
          />
        </div>
      </div>
    </div>
  </div>
);

  // Multi-delete
  const [multiDeleteMode, setMultiDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());


// Import (from another belt.dat) — mirrors other editor import modals.
const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
const [importSourcePath, setImportSourcePath] = useState<string>("");
const [importSourceBytes, setImportSourceBytes] = useState<Uint8Array | null>(null);
const [importSourceRecords, setImportSourceRecords] = useState<any[]>([]);
const [importSelection, setImportSelection] = useState<Set<number>>(new Set());
const [importSearch, setImportSearch] = useState<string>("");
const [importInfo, setImportInfo] = useState<string>("");

  // External Editing (CSV) - matches Teams/Wrestlers pattern
  const [externalEditingOpen, setExternalEditingOpen] = useState<boolean>(false);

  
const filtered = useMemo(() => {
  const q = normQuery(search);
  let list = records.map((r) => ({ r, label: r.name }));

  // Text search
  if (q) {
    list = list.filter((x) => normQuery(x.label).includes(q));
  }

  // Filters
  const ownerFilter = filters.ownerId !== "Everyone" ? (Number(filters.ownerId) | 0) : 0;
  const imgMin = filters.imageMin.trim() ? Number(filters.imageMin) : null;
  const imgMax = filters.imageMax.trim() ? Number(filters.imageMax) : null;

  list = list.filter(({ r }) => {
    if (ownerFilter && (Number(r.ownerPromoId) | 0) !== ownerFilter) return false;

    // Singles / Tag filters: if both are checked, treat as no type filter (show all).
    if (filters.singlesOnly && !filters.tagOnly) {
      if (!r.isSinglesTitle) return false;
    } else if (filters.tagOnly && !filters.singlesOnly) {
      if (r.isSinglesTitle) return false;
    }

    if (filters.vacantOnly) {
      if ((Number(r.holder1Id) | 0) !== 0) return false;
    }

    if (filters.womensOnly && !r.womensTitle) return false;
    if (filters.lightweightOnly && !r.lightweightTitle) return false;
    if (filters.suspendedOnly && !r.suspended) return false;

    const img = Number(r.image) | 0;
    if (imgMin !== null && !Number.isNaN(imgMin) && img < imgMin) return false;
    if (imgMax !== null && !Number.isNaN(imgMax) && img > imgMax) return false;

    return true;
  });

  // Sort
  if (sortKey === "name") {
    list.sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" }));
  } else {
    list.sort((a, b) => a.r.index - b.r.index);
  }

  return list;
}, [records, search, sortKey, filters]);




  const selected = records[selectedIndex] ?? null;
  useEffect(() => {
    if (!selected) return;
    setImageDraft(String(selected.image ?? 0));
  }, [selected?.index]);


  // Load dependent files (wrestler/promos) so dropdowns work.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wPath = props.wrestlerDataPath;
        if (!wPath) {
          if (!cancelled) setWorkers([]);
          return;
        }
        const bytes = await readFile(wPath);
        // plugin-fs returns Uint8Array; wrestler parser expects ArrayBuffer
        const parsed = parseWrestlerDat(toArrayBuffer(bytes));
        if (!cancelled) setWorkers(parsed);
      } catch (e) {
        console.error(e);
        if (!cancelled) setWorkers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.wrestlerDataPath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pPath = props.promosDataPath;
        if (!pPath) {
          if (!cancelled) setPromos([]);
          return;
        }
        const bytes = await readFile(pPath);
        const parsed = parsePromosDat(bytes);
        if (!cancelled) setPromos(parsed.records);
      } catch (e) {
        console.error(e);
        if (!cancelled) setPromos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.promosDataPath]);

  async function loadFromPath(path: string) {
    setStatus("");
    try {
      const bytes = await readFile(path);
      const parsed = parseBeltDat(bytes);
      setFilePath(path);
      setRawBytes(bytes);
      setRecords(parsed);
      setSelectedIndex(0);
      setStatus(`Loaded ${parsed.length} belts.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Load failed: ${e?.message ?? String(e)}`);
    }
  }

  async function handleLoadFromData() {
    const p = props.beltDataPath;
    if (!p) {
      setStatus("belt.dat not found in DATA folder.");
      return;
    }
    if (!(await exists(p))) {
      setStatus("belt.dat not found in DATA folder.");
      return;
    }
    await loadFromPath(p);
  }

  function closeFile() {
    setStatus("");
    setFilePath("");
    setRawBytes(null);
    setRecords([]);
    setSelectedIndex(0);
    setImageDraft("0");
    setDirty(false);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());
  }

  function handleCloseFile() {
    if (dirty) {
      const ok = confirmWarning("You have unsaved changes. Close without saving?");
      if (!ok) return;
    }
    closeFile();
  }


  
async function onImportBelts() {
  try {
    if (!rawBytes || !records.length || !filePath) {
      await alertWarning("Load belt.dat first.");
      return;
    }

    const chosen = await open({
      title: "Import Belt(s)",
      multiple: false,
      filters: [{ name: "EWR belt.dat", extensions: ["dat"] }],
    });

    if (!chosen) return;
    const p = String(chosen);
    const bytes = await readFile(p);
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    const parsed = parseBeltDat(u8);

    // Workspace promo name -> promo ID map
    const workspacePromoNameToId = new Map<string, number>();
    for (const pr of promos) {
      const key = normalizeNameForUniq((pr as any)?.name ?? "");
      const id = Number((pr as any)?.id ?? 0) | 0;
      if (key && id) workspacePromoNameToId.set(key, id);
    }
    const firstWorkspacePromoId = promos.length ? (Number((promos[0] as any)?.id ?? 0) | 0) : 0;

    // Source promo ID -> normalized promo name map (from source folder's promos.dat)
    const srcDir = p.replace(/[/\\][^/\\]+$/, "");
    const srcPromosPath = srcDir ? `${srcDir}/promos.dat` : "promos.dat";
    const srcPromoIdToName = new Map<number, string>();
    try {
      if (await exists(srcPromosPath)) {
        const pbytes = await readFile(srcPromosPath);
        const pu8 = pbytes instanceof Uint8Array ? pbytes : new Uint8Array(pbytes);
        const parsedPromos = parsePromosDat(pu8);
        for (const pr of parsedPromos.records ?? []) {
          const id = Number((pr as any)?.id ?? 0) | 0;
          const key = normalizeNameForUniq((pr as any)?.name ?? "");
          if (id && key) srcPromoIdToName.set(id, key);
        }
      }
    } catch (e) {
      console.error(e);
      // If source promos can't be read, we'll block belts based on owner name not being resolvable.
    }

    const existingNames = new Set(records.map((r) => normalizeNameForUniq(r.name)));

    const annotated = parsed.map((r: any) => {
      const name = (r.name ?? "").trim();

      if (!name || name === "(blank name)") return { ...r, __importable: false, __importReason: "blank name" };
      if (existingNames.has(normalizeNameForUniq(name)))
        return { ...r, __importable: false, __importReason: "name already exists" };

      const srcOwnerId = Number(r.ownerPromoId ?? 0) | 0;
      const srcOwnerNameKey = srcPromoIdToName.get(srcOwnerId) ?? "";
      if (!srcOwnerNameKey) {
        return { ...r, __importable: false, __importReason: "owner promotion not found in source promos.dat" };
      }

      const workspaceOwnerId = workspacePromoNameToId.get(srcOwnerNameKey) ?? 0;
      if (!workspaceOwnerId) {
        return { ...r, __importable: false, __importReason: "owner promotion not found in workspace promos.dat" };
      }

      return {
        ...r,
        __importable: true,
        __importReason: "",
        __workspaceOwnerId: workspaceOwnerId || firstWorkspacePromoId || 0,
      };
    });

    const sorted = [...annotated].sort((a: any, b: any) => {
      const ai = !!a.__importable;
      const bi = !!b.__importable;
      if (ai !== bi) return ai ? -1 : 1;
      return (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase());
    });

    setImportSourcePath(p);
    setImportSourceBytes(u8);
    setImportSourceRecords(sorted);
    setImportSelection(new Set());
    setImportSearch("");
    setImportInfo("");
    setImportModalOpen(true);
  } catch (e: any) {
    console.error(e);
    await alertWarning(`Import load failed: ${e?.message ?? String(e)}`);
  }
}

function closeImportModal() {
  setImportModalOpen(false);
  setImportInfo("");
  setImportSelection(new Set());
  setImportSearch("");
  setImportSourceRecords([]);
  setImportSourceBytes(null);
  setImportSourcePath("");
}

function toggleImportSelection(sourceIndex: number, checked: boolean) {
  setImportSelection((prev) => {
    const next = new Set(prev);
    if (checked) next.add(sourceIndex);
    else next.delete(sourceIndex);
    return next;
  });
}

const importVisible = useMemo(() => {
  const q = normalizeNameForUniq(importSearch);
  let list = importSourceRecords as any[];
  if (q) list = list.filter((r) => normalizeNameForUniq(r.name).includes(q));
  return list;
}, [importSourceRecords, importSearch]);

function commitImportSelected() {
  try {
    if (!rawBytes || !records.length) {
      setImportInfo("Load belt.dat first.");
      return;
    }
    if (!importSourceBytes) {
      setImportInfo("No import file loaded.");
      return;
    }
    if (importSelection.size === 0) {
      setImportInfo("Select at least one belt to import.");
      return;
    }

    const existingNames = new Set(records.map((r) => normalizeNameForUniq(r.name)));
    const promoIds = new Set<number>(promos.map((p: any) => Number(p.id) | 0));
    const defaultPromoId = promos.length ? (Number(promos[0].id) | 0) : 1;

    const selected = (importSourceRecords as any[]).filter((r) => importSelection.has(r.index));

    const appendedSlices: Uint8Array[] = [];
    const skipped: string[] = [];

    for (const src of selected) {
      const name = String(src.name ?? "").trim();
      const key = normalizeNameForUniq(name);
      if (!name || name === "(blank name)") {
        skipped.push("(blank)");
        continue;
      }
      if (existingNames.has(key)) {
        skipped.push(name);
        continue;
      }

      const srcBase = (Number(src.index) | 0) * BELT_RECORD_SIZE;
      const slice = importSourceBytes.slice(srcBase, srcBase + BELT_RECORD_SIZE);

      // Import rule: belt owner must match a workspace promotion by NAME.
      // onImportBelts annotates each importable record with __workspaceOwnerId.
      const matchedOwner = Number((src as any).__workspaceOwnerId ?? 0) | 0;
      if (promos.length) {
        writeU16LE(slice, 33, matchedOwner && promoIds.has(matchedOwner) ? matchedOwner : defaultPromoId);
      } else {
        // If promos.dat isn't loaded, fall back to 1 to avoid invalid 0 owner.
        writeU16LE(slice, 33, 1);
      }

      // Import rule: holders are always imported as Vacant.
      writeU16LE(slice, 35, 0);
      writeU16LE(slice, 37, 0);

      // Copy name bytes (clamp visible to 25), keep record control byte [0]
      const safeName = name.slice(0, 25);
      const nameBytes = encodeLatin1Fixed(safeName, 30);
      slice.set(nameBytes, 1);

      appendedSlices.push(slice);
      existingNames.add(key);
    }

    if (!appendedSlices.length) {
      setImportInfo(skipped.length ? `Nothing imported. Skipped: ${skipped.length}.` : "Nothing imported.");
      return;
    }

    const newBytes = new Uint8Array(rawBytes.length + appendedSlices.length * BELT_RECORD_SIZE);
    newBytes.set(rawBytes, 0);
    let off = rawBytes.length;
    for (const s of appendedSlices) {
      newBytes.set(s, off);
      off += BELT_RECORD_SIZE;
    }

    const nextRecords = parseBeltDat(newBytes);
    setRawBytes(newBytes);
    setRecords(nextRecords);
    setDirty(true);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());

    setSelectedIndex(records.length);
    setStatus(`Imported ${appendedSlices.length} belt(s).`);
    closeImportModal();
  } catch (e: any) {
    console.error(e);
    setImportInfo(`Import failed: ${e?.message ?? String(e)}`);
  }
}
function addNewBelt() {
    if (!rawBytes) {
      alertWarning("No belt.dat loaded.");
      return;
    }

    const ownerDefault = (promos[0]?.id ? (Number(promos[0].id) | 0) : 1) | 0;
    const newIndex = records.length;

    // Extend raw bytes by one record so unknown bytes are preserved for existing records.
    setRawBytes((prev) => {
      const cur = prev ?? new Uint8Array(0);
      const out = new Uint8Array(cur.length + BELT_RECORD_SIZE);
      out.set(cur);

      const base = cur.length;

      // Native belt records appear to start with ASCII '4' as a control byte.
      out[base + 0] = 0x34;

      // Blank name (25 chars max shown in editor). Stored at bytes 1..25 as space-padded.
      for (let i = 0; i < 25; i++) out[base + 1 + i] = 0x20;

      // Defaults (match native-style defaults; name starts blank per user requirement)
      writeU16LE(out, base + 31, 0xffff); // singles on
      writeU16LE(out, base + 33, ownerDefault); // owner promo id
      writeU16LE(out, base + 35, 0x0000); // holder vacant
      writeU16LE(out, base + 37, 0x0000); // partner vacant
      writeU16LE(out, base + 39, 0x0000); // lightweight off
      writeU16LE(out, base + 41, 0x0000); // womens off
      writeU16LE(out, base + 43, 50); // image default
      writeU16LE(out, base + 45, 0x0000); // suspended off

      return out;
    });

    const rec: BeltRecord = {
      index: newIndex,
      name: "",
      ownerPromoId: ownerDefault,
      holder1Id: 0,
      holder2Id: 0,
      isSinglesTitle: true,
      womensTitle: false,
      lightweightTitle: false,
      suspended: false,
      image: 50,
    };

    setRecords((prev) => [...prev, rec]);
    setSelectedIndex(newIndex);
    setDirty(true);
    setStatus("Added new belt (unsaved).");
  }


  function makeUniqueCopyName(existing: BeltRecord[], sourceName: string) {
    const used = new Set(existing.map((r) => asciiTrim(r.name).toLowerCase()).filter(Boolean));
    const baseRaw = asciiTrim(sourceName);
    const base = baseRaw && baseRaw !== "(blank name)" ? baseRaw : "New Belt";

    // Produce "Base (n)" while keeping within 25 chars and staying unique (case-insensitive).
    for (let n = 1; n < 10000; n++) {
      const suffix = ` (${n})`;
      const maxBaseLen = Math.max(0, 25 - suffix.length);
      const trimmedBase = base.slice(0, maxBaseLen).trimEnd();
      const candidate = (trimmedBase + suffix).slice(0, 25);
      const key = candidate.toLowerCase();
      if (!used.has(key)) return candidate;
    }
    // Fallback (should never hit)
    return base.slice(0, 25);
  }

  function copyBelt(sourceIndex: number) {
    if (!rawBytes) return;
    const src = records[sourceIndex];
    if (!src) return;

    const newIndex = records.length;
    const newName = makeUniqueCopyName(records, src.name);

    const rec: BeltRecord = {
      index: newIndex,
      name: newName,
      ownerPromoId: src.ownerPromoId,
      holder1Id: 0, // Vacant
      holder2Id: 0, // Vacant
      isSinglesTitle: src.isSinglesTitle,
      womensTitle: src.womensTitle,
      lightweightTitle: src.lightweightTitle,
      suspended: src.suspended,
      image: src.image,
    };

    setRecords((prev) => [...prev, rec]);
    setSelectedIndex(newIndex);
    setDirty(true);
    setStatus(`Copied belt: ${asciiTrim(src.name) || "(blank name)"} → ${newName}`);
  }


  async function onSaveFile(): Promise<boolean> {
    setStatus("");
    try {
      if (!filePath) {
        alertWarning("No file loaded.");
        return false;
      }
      if (!rawBytes) {
        alertWarning("No belt.dat bytes loaded.");
        return false;
      }
      if (!records.length) {
        alertWarning("Nothing to save.");
        return false;
      }

      // Safety: tag titles cannot have same wrestler in both slots
      for (const r of records) {
        if (!r.isSinglesTitle && r.holder1Id && r.holder2Id && r.holder1Id === r.holder2Id) {
          alertWarning(`Invalid holders on "${r.name}": Holder and Partner cannot be the same wrestler.`);
          return false;
        }
      }

      // Belt names must be non-empty and unique (enforced on save)
      const seen = new Map<string, number>();
      for (let i = 0; i < records.length; i++) {
        const n = asciiTrim(records[i].name);
        if (!n) {
          alertWarning(`Belt name cannot be blank (record ${i + 1}).`);
          return false;
        }
        const key = n.toLowerCase();
        const prior = seen.get(key);
        if (prior !== undefined) {
          alertWarning(`Belt names must be unique. Duplicate: "${n}" (records ${prior + 1} and ${i + 1}).`);
          return false;
        }
        seen.set(key, i);
      // Belt owner must be set (no "Vacant" owner in EWR native editor)
      for (let i = 0; i < records.length; i++) {
        const owner = Number(records[i].ownerPromoId || 0) | 0;
        if (!owner) {
          alertWarning(`Belt owner must be set (record ${i + 1}: "${records[i].name}").`);
          return false;
        }
        if (promosById.size > 0 && !promosById.has(owner)) {
          alertWarning(`Belt owner promo not found in promos.dat (record ${i + 1}: "${records[i].name}").`);
          return false;
        }
      }

      }

      const outLen = records.length * BELT_RECORD_SIZE;
      const out = new Uint8Array(outLen);
      out.set(rawBytes.subarray(0, Math.min(rawBytes.length, outLen)));
      // Ensure control byte is set for any newly-added records
      const existingCount = Math.floor(rawBytes.length / BELT_RECORD_SIZE);
      for (let i = existingCount; i < records.length; i++) {
        const base = i * BELT_RECORD_SIZE;
        out[base + 0] = out[base + 0] || 0x34;
        // If name bytes are all zero, initialize to spaces
        let anyNameByte = false;
        for (let k = 0; k < 25; k++) {
          if (out[base + 1 + k] !== 0) { anyNameByte = true; break; }
        }
        if (!anyNameByte) {
          for (let k = 0; k < 25; k++) out[base + 1 + k] = 0x20;
        }
      }


      for (const r of records) {
        const base = r.index * BELT_RECORD_SIZE;

        // Preserve byte 0 (observed control byte). Write name into bytes 1..30 (30 bytes).
        const nameBytes = encodeLatin1Fixed((r.name ?? "").slice(0, 25), 30);
        out.set(nameBytes, base + 1);

        writeU16LE(out, base + 31, r.isSinglesTitle ? 0xffff : 0x0000);
        writeU16LE(out, base + 33, Number(r.ownerPromoId || 0) & 0xffff);
        writeU16LE(out, base + 35, Number(r.holder1Id || 0) & 0xffff);
        writeU16LE(out, base + 37, r.isSinglesTitle ? 0 : (Number(r.holder2Id || 0) & 0xffff));

        writeU16LE(out, base + 39, r.lightweightTitle ? 0xffff : 0x0000);
        writeU16LE(out, base + 41, r.womensTitle ? 0xffff : 0x0000);
        writeU16LE(out, base + 43, clamp(Number(r.image || 0) | 0, 0, 100));
        writeU16LE(out, base + 45, r.suspended ? 0xffff : 0x0000);
      }

      const bakPath = buildEwresBackupPath(filePath);
      const bakDir = bakPath.slice(0, bakPath.lastIndexOf("/"));
      await mkdir(bakDir, { recursive: true });
      const bakExists = await exists(bakPath);
      if (!bakExists) {
        await copyFile(filePath, bakPath);
      }

      await writeFile(filePath, out);
      setRawBytes(out);
      setDirty(false);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());
      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
      setStatus("Saved.");
      return true;
    } catch (err: any) {
      console.error(err);
      alertWarning(`Save failed: ${String(err?.message ?? err)}`);
      return false;
    }
  }

  function updateSelected(patch: Partial<BeltRecord>) {
    setRecords((prev) => {
      const next = [...prev];
      const cur = next[selectedIndex];
      if (!cur) return prev;
      next[selectedIndex] = { ...cur, ...patch };
      setDirty(true);
      return next;
    });
  }

  
  function toggleMultiDelete() {
    setMultiDeleteMode((prev) => {
      const next = !prev;
      if (next) {
        setSelectedForDelete(new Set());
      } else {
        setSelectedForDelete(new Set());
      }
      return next;
    });
  }

  function toggleOneForDelete(idx: number, checked: boolean) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (checked) next.add(idx);
      else next.delete(idx);
      return next;
    });
  }

  function commitMultiDelete() {
    if (!selectedForDelete.size) {
      setStatus("No belts selected for deletion.");
      return;
    }
    const indicesDesc = Array.from(selectedForDelete).sort((a, b) => b - a);
    const ok = window.confirm(`Delete ${indicesDesc.length} belt(s)?`);
    if (!ok) return;

    setRecords((prev) => prev.filter((b) => !selectedForDelete.has(b.index)).map((b, i) => ({ ...b, index: i })));
    setSelectedForDelete(new Set());
    setMultiDeleteMode(false);
    setSelectedIndex(0);
    setDirty(true);
    setStatus(`Deleted ${indicesDesc.length} belt(s). Click Save to write to disk.`);
  }

  function selectAllVisibleForDelete() {
    const indices = filtered.map(({ r }) => r.index);
    setSelectedForDelete(new Set(indices));
  }

  function selectNoneForDelete() {
    setSelectedForDelete(new Set());
  }

  function deleteSingleBelt(beltIndex: number) {
    const b = records[beltIndex];
    if (!b) return;
    const name = b.name?.trim() || "(blank name)";

    setRecords((prev) => prev.filter((x) => x.index !== beltIndex).map((x, i) => ({ ...x, index: i })));
    setDirty(true);
    setStatus(`Deleted belt: ${name}. Click Save to write to disk.`);

    setSelectedIndex((prevSel) => {
      if (prevSel === beltIndex) return 0;
      if (prevSel > beltIndex) return prevSel - 1;
      return prevSel;
    });
  }

  // ---------- External Editing (CSV) ----------
  const BELTS_CSV_HEADERS = [
    "Record #",
    "Belt Name",
    "Belt Owner",
    "Singles Title (Yes/No)",
    "Holder",
    "Partner",
    "Womens Title (Yes/No)",
    "Lightweight Title (Yes/No)",
    "Suspended (Yes/No)",
    "Image (0-100)",
  ];

  async function onExportBeltsCsv() {
    try {
      if (!rawBytes) {
        setStatus("Load belt.dat first.");
        return;
      }
      const defaultName = filePath ? filePath.replace(/\.dat$/i, ".csv") : "belt.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const promoById = new Map<number, PromoRecord>();
      for (const p of promos) promoById.set(Number((p as any).id ?? 0), p);

      const workerById = new Map<number, Worker>();
      for (const w of workers) workerById.set(Number((w as any).id ?? 0), w);

      const lines: string[] = [];
      lines.push(BELTS_CSV_HEADERS.map(csvEscape).join(","));
      const sorted = [...records].sort((a, b) => Number(a.index) - Number(b.index));
      for (const b of sorted) {
        const ownerName = normalizeFullName((promoById.get(Number(b.ownerPromoId ?? 0)) as any)?.name ?? "");
        const h1 = Number(b.holder1Id ?? 0) ? workerById.get(Number(b.holder1Id ?? 0)) : null;
        const h2 = Number(b.holder2Id ?? 0) ? workerById.get(Number(b.holder2Id ?? 0)) : null;
        const row = [
          Number(b.index ?? 0),
          String(b.name ?? ""),
          String(ownerName ?? ""),
          boolToYesNo(Boolean(b.isSinglesTitle)),
          Number(b.holder1Id ?? 0) === 0 ? "Vacant" : normalizeFullName((h1 as any)?.fullName ?? ""),
          Number(b.holder2Id ?? 0) === 0 ? "Vacant" : normalizeFullName((h2 as any)?.fullName ?? ""),
          boolToYesNo(Boolean(b.womensTitle)),
          boolToYesNo(Boolean(b.lightweightTitle)),
          boolToYesNo(Boolean(b.suspended)),
          clamp(Number(b.image ?? 0), 0, 100),
        ]
          .map(csvEscape)
          .join(",");
        lines.push(row);
      }

      // UTF-8 BOM for Excel accent safety
      const outText = "\uFEFF" + lines.join("\n");
      await writeFile(outPath, new TextEncoder().encode(outText));
      setExternalEditingOpen(false);
      setStatus(`Exported CSV: ${outPath}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onImportBeltsCsv() {
    try {
      if (!rawBytes) {
        setStatus("Load belt.dat first.");
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
      const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
      const parsed = parseCsv(text);
      const actual = parsed.headers.map((h) => String(h ?? "").trim());
      const missing = BELTS_CSV_HEADERS.filter((h) => !actual.includes(h));
      if (missing.length) {
        setStatus(`CSV header mismatch. Missing: ${missing.join(", ")}`);
        setExternalEditingOpen(false);
        return;
      }

      const defaultPromoId = promos.length ? (Number((promos[0] as any).id ?? 1) | 0) : 1;
      const promoNameToId = new Map<string, number>();
      for (const p of promos) {
        const k = normalizeFullName((p as any).name ?? "").toLowerCase();
        if (k) promoNameToId.set(k, Number((p as any).id ?? 0));
      }

      const workerNameToIds = new Map<string, number[]>();
      for (const w of workers) {
        const k = normalizeFullName((w as any).fullName ?? "").toLowerCase();
        if (!k) continue;
        const arr = workerNameToIds.get(k) ?? [];
        arr.push(Number((w as any).id ?? 0));
        workerNameToIds.set(k, arr);
      }

      const nextRecords: BeltRecord[] = records.map((r) => ({ ...r }));
      let nextBytes = new Uint8Array(rawBytes);

      const usedNames = new Set(nextRecords.map((r) => asciiTrim(r.name).toLowerCase()).filter(Boolean));

      function makeUniqueName(base: string) {
        const raw = asciiTrim(base).slice(0, 25);
        if (!raw) return "";
        const key = raw.toLowerCase();
        if (!usedNames.has(key)) return raw;
        for (let n = 1; n < 10000; n++) {
          const suffix = ` (${n})`;
          const maxBaseLen = Math.max(0, 25 - suffix.length);
          const trimmed = raw.slice(0, maxBaseLen).trimEnd();
          const cand = (trimmed + suffix).slice(0, 25);
          const k = cand.toLowerCase();
          if (!usedNames.has(k)) return cand;
        }
        return "";
      }

      function resolveWorkerId(name: string) {
        const n = normalizeFullName(name);
        if (!n) return 0;
        if (n.toLowerCase() === "vacant") return 0;
        const ids = workerNameToIds.get(n.toLowerCase()) ?? [];
        return ids.length === 1 ? Number(ids[0] ?? 0) : 0;
      }

      function writeRecordToBytes(idx: number, r: BeltRecord) {
        const base = idx * BELT_RECORD_SIZE;
        // keep control byte [0]
        nextBytes[base + 0] = 0x34;

        const safeName = (r.name ?? "").slice(0, 25);
        const nameBytes = encodeLatin1Fixed(safeName, 30);
        nextBytes.set(nameBytes, base + 1);

        writeU16LE(nextBytes, base + 31, r.isSinglesTitle ? 0xffff : 0x0000);
        writeU16LE(nextBytes, base + 33, Number(r.ownerPromoId || defaultPromoId) & 0xffff);
        writeU16LE(nextBytes, base + 35, Number(r.holder1Id || 0) & 0xffff);
        writeU16LE(nextBytes, base + 37, r.isSinglesTitle ? 0 : (Number(r.holder2Id || 0) & 0xffff));
        writeU16LE(nextBytes, base + 39, r.lightweightTitle ? 0xffff : 0x0000);
        writeU16LE(nextBytes, base + 41, r.womensTitle ? 0xffff : 0x0000);
        writeU16LE(nextBytes, base + 43, clamp(Number(r.image || 0) | 0, 0, 100));
        writeU16LE(nextBytes, base + 45, r.suspended ? 0xffff : 0x0000);
      }

      let updated = 0;
      let added = 0;
      let skipped = 0;

      for (const row of parsed.rows) {
        const recNo = parseIntOrNull(row["Record #"]);
        const nameRaw = String(row["Belt Name"] ?? "");
        const ownerNameRaw = String(row["Belt Owner"] ?? "");
        const singlesRaw = String(row["Singles Title (Yes/No)"] ?? "");
        const holderNameRaw = String(row["Holder"] ?? "");
        const partnerNameRaw = String(row["Partner"] ?? "");
        const womensRaw = String(row["Womens Title (Yes/No)"] ?? "");
        const lwRaw = String(row["Lightweight Title (Yes/No)"] ?? "");
        const suspRaw = String(row["Suspended (Yes/No)"] ?? "");
        const imgRaw = parseIntOrNull(row["Image (0-100)"]);

        const proposedName = asciiTrim(nameRaw).slice(0, 25);
        if (!proposedName) {
          skipped++;
          continue;
        }

        // Find existing target: prefer Record #, else by name.
        let targetIdx: number | null = null;
        if (recNo !== null && recNo >= 0 && recNo < nextRecords.length) targetIdx = recNo;
        if (targetIdx === null) {
          const key = proposedName.toLowerCase();
          const found = nextRecords.find((r) => asciiTrim(r.name).toLowerCase() === key);
          if (found) targetIdx = found.index;
        }

        const ownerKey = normalizeFullName(ownerNameRaw).toLowerCase();
        const ownerId = ownerKey ? promoNameToId.get(ownerKey) ?? 0 : 0;
        const singles = yesNoToBool(singlesRaw);
        const womens = yesNoToBool(womensRaw);
        const lw = yesNoToBool(lwRaw);
        const susp = yesNoToBool(suspRaw);
        const img = clamp(Number(imgRaw ?? 0), 0, 100);

        const h1 = resolveWorkerId(holderNameRaw);
        const h2 = singles ? 0 : resolveWorkerId(partnerNameRaw);
        const safeOwnerId = ownerId || defaultPromoId;

        if (targetIdx !== null) {
          // Update
          const existing = nextRecords[targetIdx];
          // handle rename uniqueness
          const existingKey = asciiTrim(existing.name).toLowerCase();
          const newKey = proposedName.toLowerCase();
          if (newKey !== existingKey) {
            if (usedNames.has(newKey)) {
              skipped++;
              continue;
            }
            usedNames.delete(existingKey);
            usedNames.add(newKey);
          }
          const updatedRec: BeltRecord = {
            ...existing,
            name: proposedName,
            ownerPromoId: safeOwnerId,
            isSinglesTitle: singles,
            holder1Id: h1,
            holder2Id: h2,
            womensTitle: womens,
            lightweightTitle: lw,
            suspended: susp,
            image: img,
          };
          nextRecords[targetIdx] = updatedRec;
          writeRecordToBytes(targetIdx, updatedRec);
          updated++;
        } else {
          // Add new
          const uniqueName = makeUniqueName(proposedName);
          if (!uniqueName) {
            skipped++;
            continue;
          }
          usedNames.add(uniqueName.toLowerCase());

          const newIdx = nextRecords.length;
          const extended = new Uint8Array(nextBytes.length + BELT_RECORD_SIZE);
          extended.set(nextBytes);
          nextBytes = extended;

          const newRec: BeltRecord = {
            index: newIdx,
            name: uniqueName,
            ownerPromoId: safeOwnerId,
            isSinglesTitle: singles,
            holder1Id: h1,
            holder2Id: h2,
            womensTitle: womens,
            lightweightTitle: lw,
            suspended: susp,
            image: img,
          };
          nextRecords.push(newRec);
          writeRecordToBytes(newIdx, newRec);
          added++;
        }
      }

      setRawBytes(nextBytes);
      setRecords(nextRecords);
      setDirty(true);
      setExternalEditingOpen(false);
      setStatus(`CSV import: updated ${updated}, added ${added}, skipped ${skipped}.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import CSV failed: ${e?.message ?? String(e)}`);
    }
  }


  // Eligible holders depend on belt owner + filters.
  // Employment promo ids in wrestler.dat are stored as u8 (promo id values fit in <=255 in practice),
  // while belts store owner promo id as u16. Compare numerically.
  const eligibleHolders = useMemo(() => {
    if (!selected) return [] as Worker[];

    const owner = Number(selected.ownerPromoId || 0) | 0;
    let list = [...workers] as any[];

    // If no owner set, don't apply employment filtering.
    if (owner) {
      list = list.filter((w: any) => {
        const e1 = Number(w.employer1PromoId ?? 0) | 0;
        const e2 = Number(w.employer2PromoId ?? 0) | 0;
        const e3 = Number(w.employer3PromoId ?? 0) | 0;
        return e1 === owner || e2 === owner || e3 === owner;
      });
    }

    // Women's / Lightweight eligibility rules (match EWR behavior):
    // - If Women's is checked: only female are eligible.
    // - If Women's is NOT checked and Lightweight is checked: BOTH genders who are lightweight are eligible.
    // - If Women's is checked and Lightweight is checked: only female lightweights are eligible.
    // - If both are off: all employees are eligible.
    // Wrestler schema uses genderRaw u16le (0=female) and weightRaw u8 (76=Lightweight).
    const womensOn = !!selected.womensTitle;
    const lightweightOn = !!selected.lightweightTitle;

    if (womensOn) {
      list = list.filter((w: any) => Number(w.genderRaw ?? w.gender ?? 0) === 0);
    }

    if (lightweightOn) {
      list = list.filter((w: any) => (Number(w.weightRaw ?? w.weight ?? 0) & 0xff) === 76);
    }

    list.sort((a: any, b: any) =>
      (a.fullName || a.name || "").localeCompare(b.fullName || b.name || "", undefined, { sensitivity: "base" })
    );

    return list as Worker[];
  }, [selected, workers]);

  const title = "Belts";
  const subtitle = "belt.dat";

  return (
    <div className="ewr-app">
      {/* LEFT PANEL */}
      <div className="ewr-panel ewr-left">
        <div className="ewr-panelHeader">
          <LeftPanelFileActions
            title={title}
            subtitle={subtitle}
            loadFromData={{
              disabled: !props.beltDataPath,
              title: !props.workspaceRoot
                ? "Select a DATA folder first"
                : !props.beltDataPath
                  ? "belt.dat not found in DATA folder"
                  : "Load belt.dat from DATA folder",
              onClick: handleLoadFromData,
              label: "Load from DATA",
            }}
            closeFile={{
              onClick: handleCloseFile,
              disabled: !filePath && records.length === 0,
              label: "Close File",
              title: "Close the loaded file",
            }}
            saveFile={{
              onClick: onSaveFile,
              disabled: !dirty || !filePath || records.length === 0,
              label: "Save File",
              title: dirty ? "Save changes" : "No changes to save",
            }}
          />

          <div className="ewr-divider" />
        </div>

        <div className="ewr-leftMiddle ewr-scroll" style={{ overflowX: "hidden" }}>
          <div className="ewr-leftBody">

            <LeftPanelSearchHeader
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search belts..."
              sortValue={sortKey}
              onSortChange={(v) => setSortKey(v)}
              sortOptions={[
                { value: "record", label: "Record" },
                { value: "name", label: "Name" },
              ]}
              filtersOpen={filtersOpen}
              onToggleFilters={() => {
                setDraftFilters(filters);
                setFiltersOpen((v) => !v);
              }}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
              showingCount={filtered.length}
              totalCount={records.length}
            />

            {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}


            <div className="ewr-leftList" style={{ marginTop: 10 }}>
              {filtered.length === 0 ? (
                <div className="ewr-muted" style={{ padding: "10px 4px" }}>
                  {rawBytes ? "No belts match your search." : "Load from DATA to begin."}
                </div>
              ) : (
                filtered.map(({ r }) => {
                  const isSelected = r.index === selectedIndex;
                  const checked = selectedForDelete.has(r.index);

                  return (
                    <LeftPanelNameCard
                      key={`belt-${r.index}`}
                      name={r.name}
                      isSelected={isSelected}
                      onSelect={() => setSelectedIndex(r.index)}
                      leading={
                        multiDeleteMode ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleOneForDelete(r.index, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 18, height: 18 }}
                            title="Select for multi-delete"
                          />
                        ) : null
                      }
                      // Match Wrestlers multi-delete behavior: keep copy/delete buttons visible.
                      showActions
                      onCopy={() => copyBelt(r.index)}
                      copyTitle="Copy belt"
                      onDelete={() => deleteSingleBelt(r.index)}
                      deleteTitle="Delete belt"
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              label: "Add New Belt",
              icon: <IconPlus className="btnSvg" />,
              onClick: () => addNewBelt(),
              disabled: !rawBytes,
              title: !rawBytes ? "Load belt.dat first" : "Add a new belt",
            },
            {
              key: "multi",
              label: multiDeleteMode
                ? selectedForDelete.size
                  ? `Delete Selected (${selectedForDelete.size})`
                  : "Cancel Multi-Delete"
                : "Multi-Delete",
              icon: <IconChecklist className="btnSvg" />,
              onClick: () => {
                if (!rawBytes) return;
                if (!multiDeleteMode) return toggleMultiDelete();
                if (!selectedForDelete.size) return toggleMultiDelete();
                return commitMultiDelete();
              },
              disabled: !rawBytes,
              title: !rawBytes ? "Load belt.dat first" : "Select multiple belts to delete",
              className: "ewr-button",
              style:
                multiDeleteMode && selectedForDelete.size > 0
                  ? { background: "rgba(255,70,70,0.18)", border: "1px solid rgba(255,70,70,0.60)" }
                  : undefined,
            },
            {
              key: "import",
              label: "Import Belt(s)",
              icon: <IconImport className="btnSvg" />,
              onClick: () => onImportBelts(),
              disabled: !rawBytes,
              title: !rawBytes ? "Load belt.dat first" : "Import belt records from another belt.dat",
            },
            {
              key: "external",
              label: "External Editing",
              icon: <IconGrid className="btnSvg" />,
              disabled: !rawBytes,
              title: !rawBytes ? "Load belt.dat first" : "Export / Import via CSV",
              onClick: () => {
                if (!rawBytes) return;
                setExternalEditingOpen((p) => !p);
              },
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
                    onClick={selectAllVisibleForDelete}
                    title="Select all currently listed belts"
                  >
                    Select All
                  </button>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={selectNoneForDelete}
                    title="Clear selection"
                  >
                    Select None
                  </button>
                </div>
              ) : null}

              {externalEditingOpen ? (
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={onExportBeltsCsv}
                    title="Export belts to CSV"
                  >
                    Export CSV
                  </button>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={onImportBeltsCsv}
                    title="Import belts from CSV"
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
      <RightPanelShell
        header={
          <EditorHeader
            title={selected ? `Editing: ${selected.name?.trim() || "(blank)"}` : "Belts"}
            leftPills={[
              "Category: Belts",
              <>
                Loaded: <b>{records.length || 0}</b>
              </>,
              selected ? `Record #${selected.index} — ID ${selected.index + 1}` : null,
            ]}
            rightPills={[filePath ? "belt.dat loaded" : "No file loaded", status ? status : null]}
          />
        }
      >
        {!selected ? (
          <div className="ewr-muted">Load from DATA to begin.</div>
        ) : (
          <div className="ewr-section">
            <div className="ewr-sectionHeader">
              <div className="ewr-sectionTitle">Belt</div>
            </div>
            <div className="ewr-sectionBody">
              <div className="ewr-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                  <div className="ewr-label">Belt Name (25)</div>
                  <input
                    className="ewr-input"
                    value={selected.name}
                    maxLength={25}
                    onChange={(e) => updateSelected({ name: e.target.value.slice(0, 25) })}
                    placeholder="25 character max"
                  />
                  <div className="ewr-muted" style={{ marginTop: 6 }}>
                    {selected.name.length}/25
                  </div>
                </div>

                <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                  <div className="ewr-label">Belt Owner</div>
                  <select
                    className="ewr-input"
                    value={selected.ownerPromoId}
                    disabled={promosById.size === 0}
                    onChange={(e) => updateSelected({ ownerPromoId: Number(e.target.value) || 0 })}
                  >
                                        {promosById.size === 0 ? <option value={selected.ownerPromoId}>Load promos.dat to choose</option> : null}
                    {Array.from(promosById.entries())
                      .sort((a, b) => (a[1] || "").localeCompare(b[1] || "", undefined, { sensitivity: "base" }))
                      .map(([id, name]) => (
                        <option key={`p-${id}`} value={id}>
                          {name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!selected.isSinglesTitle}
                      onChange={(e) => {
                        const isSingles = e.target.checked;
                        updateSelected({
                          isSinglesTitle: isSingles,
                          holder2Id: isSingles ? 0 : selected.holder2Id,
                        });
                      }}
                    />
                    <span>Singles Title</span>
                  </label>
                </div>

                <div className="ewr-field">
                  <div className="ewr-label">Holder</div>
                      <select
                    className="ewr-input"
                    value={String(selected.holder1Id ?? 0)}
                    onChange={(e) => {
                      const id = Number(e.target.value) || 0;
                      const partner = selected.holder2Id;
                      updateSelected({ holder1Id: id === partner ? selected.holder1Id : id });
                    }}
                  >
                    <option value="0">Vacant</option>
                                        {eligibleHolders.filter((w: any) => Number(w.id) !== Number(selected.holder2Id || 0)).map((w: any) => (
                      <option key={`w-${w.id}`} value={String(w.id)}>
                        {w.fullName || w.shortName || `ID ${w.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                {selected.isSinglesTitle ? null : (
                  <div className="ewr-field">
                    <div className="ewr-label">Partner</div>
                      <select
                      className="ewr-input"
                      value={String(selected.holder2Id ?? 0)}
                      onChange={(e) => {
                        const id = Number(e.target.value) || 0;
                        const holder = selected.holder1Id;
                        updateSelected({ holder2Id: id === holder ? selected.holder2Id : id });
                      }}
                    >
                      <option value="0">Vacant</option>
                                            {eligibleHolders.filter((w: any) => Number(w.id) !== Number(selected.holder1Id || 0)).map((w: any) => (
                        <option key={`p-${w.id}`} value={String(w.id)}>
                          {w.fullName || w.shortName || `ID ${w.id}`}
                        </option>
                      ))}
                    </select>
                    {selected.holder1Id && selected.holder2Id && selected.holder1Id === selected.holder2Id ? (
                      <div className="ewr-muted" style={{ marginTop: 8 }}>
                        Holder and Partner cannot be the same wrestler.
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input type="checkbox" checked={selected.womensTitle} onChange={(e) => updateSelected({ womensTitle: e.target.checked })} />
                      <span>Woman&apos;s Title</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={selected.lightweightTitle}
                        onChange={(e) => updateSelected({ lightweightTitle: e.target.checked })}
                      />
                      <span>Lightweight Title</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input type="checkbox" checked={selected.suspended} onChange={(e) => updateSelected({ suspended: e.target.checked })} />
                      <span>Suspended</span>
                    </label>
                  </div>
                </div>

                <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                  <div className="ewr-label">Image (0–100)</div>
                  <input
                    className="ewr-input"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={imageDraft}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        setImageDraft("");
                        return;
                      }
                      setImageDraft(v);
                    }}
                    onBlur={() => {
                      const n = clamp(Number(imageDraft || 0), 0, 100);
                      setImageDraft(String(n));
                      updateSelected({ image: n });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    }}
                  />
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
              <div className="ewr-modalTitle">Import Belts</div>
              <div className="ewr-modalSub">
                Source belt.dat:{" "}
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
                style={{ flex: 1, minWidth: 240 }}
                placeholder="Filter belts by name…"
                value={importSearch}
                onChange={(e) => setImportSearch(e.target.value)}
              />

              <button
                className="ewr-button ewr-buttonSmall"
                type="button"
                onClick={() => {
                  const all = new Set(importVisible.filter((r: any) => !!r.__importable).map((r: any) => r.index));
                  setImportSelection(all);
                }}
              >
                Select All
              </button>

              <button className="ewr-button ewr-buttonSmall" type="button" onClick={() => setImportSelection(new Set())}>
                Clear
              </button>
            </div>

            <div className="ewr-modalList">
              {importVisible.length === 0 ? (
                <div className="ewr-muted">No belts found.</div>
              ) : (
                importVisible.map((r: any) => {
                  const checked = importSelection.has(r.index);
                  const disabled = !r.__importable;

                  const badgeStyle = disabled
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
                      key={`imp-belt-${r.index}`}
                      className="ewr-importRow"
                      style={{ opacity: disabled ? 0.55 : 1 }}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        onChange={(e) => toggleImportSelection(r.index, e.target.checked)}
                      />
                      <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span>
                          {r.name || "(no name)"}
                          <span style={badgeStyle}>{disabled ? "Blocked" : "Importable"}</span>
                        </span>
                        {r.__importReason ? <span className="ewr-muted">{r.__importReason}</span> : null}
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            {importInfo ? <div className="ewr-importInfo">{importInfo}</div> : null}
          </div>

          <div className="ewr-modalFooter">
            <div className="ewr-muted" style={{ flex: 1 }}>
              Selected: <b>{importSelection.size}</b> / {importSourceRecords.length}
            </div>

            <button className="ewr-button" type="button" onClick={closeImportModal}>
              Cancel
            </button>

            <button className="ewr-button ewr-buttonApply" type="button" onClick={commitImportSelected}>
              Import Selected
            </button>
          </div>
        </div>
      </div>
    ) : null}

    </div>
  );
}