import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";

import { RightPanelShell } from "./components/rightpanel/RightPanelShell";
import { EditorHeader } from "./components/rightpanel/EditorHeader";

import { IconPlus, IconChecklist, IconImport, IconGrid } from "./components/icons/EwrIcons";

import EwrSelectCompat from "./components/inputs/EwrSelectCompat";
// Tauri v2 plugins
import { open, save } from "@tauri-apps/plugin-dialog";
import {readFile, writeFile, exists, copyFile, readDir, mkdir} from "@tauri-apps/plugin-fs";

import { parsePromosDat, type PromoRecord } from "./ewr/parsePromosDat";
import { writePromosDat } from "./ewr/writePromosDat";
import { validatePromosDatBytes } from "./ewr/validatePromosDat";

import { parseStaffDat, type Staff } from "./ewr/parseStaffDat";
import { validateStaffDatBytes } from "./ewr/validateStaffDat";

import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { toArrayBuffer } from "./ewr/toArrayBuffer";
import { parseEventDat, type EventRecord } from "./ewr/parseEventDat";
import { parseTvDat, type TelevisionRecord } from "./ewr/parseTvDat";
import { parseNetworkDat, type NetworkRecord } from "./ewr/parseNetworkDat";

function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type PromoBeltRecord = {
  index: number;
  name: string;
  ownerPromoId: number;
  holder1Id: number;
  holder2Id: number;
  isSinglesTitle: boolean;
  image: number;
};

type SortMode = "record" | "name";
type FilterPick = "Everyone" | string;

type PromoFilters = {
  size: FilterPick;      // numeric string
  basedIn: FilterPick;   // numeric string
  moneyMin: string;
  moneyMax: string;

  imageMin: string;
  imageMax: string;
  riskMin: string;
  riskMax: string;
  productionMin: string;
  productionMax: string;
  advertisingMin: string;
  advertisingMax: string;
  merchandisingMin: string;
  merchandisingMax: string;

  campFacilities: FilterPick; // numeric string

  noLogo: boolean; // per spec: Banner is None/blank
  noBanner: boolean; // per spec: Logo is None/blank
  brandSplitActive: boolean;
  developmentalTerritory: boolean;
  noDevelopmentalTerritory: boolean;
  noDevelopmentalBooker: boolean;
  trainingCamp: boolean;
  noTrainingCamp: boolean;
  noHeadTrainer: boolean;
};

const PROMOS_MAX = 35;
const BELT_RECORD_SIZE = 457;
const EVENT_MONTH_LABELS: Record<number, string> = {1:"January",2:"February",3:"March",4:"April",5:"May",6:"June",7:"July",8:"August",9:"September",10:"October",11:"November",12:"December",13:"Weekly"};
const EVENT_TYPE_LABELS: Record<number, string> = {1:"Pay-Per-View",2:"Large",3:"Medium",4:"Small"};
const TV_DAY_ORDER: Record<string, number> = {Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6,Sunday:7};
const TV_SLOT_LABELS: Record<string, string> = {E:"Early Evening",P:"Prime Time",L:"Late Night",G:"Graveyard"};

function readU16LE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function parsePromoBelts(bytes: Uint8Array): PromoBeltRecord[] {
  if (!bytes?.length) return [];
  if (bytes.length % BELT_RECORD_SIZE !== 0) {
    throw new Error(`belt.dat size invalid: ${bytes.length} bytes (expected multiple of ${BELT_RECORD_SIZE})`);
  }

  const out: PromoBeltRecord[] = [];
  for (let i = 0; i < bytes.length / BELT_RECORD_SIZE; i++) {
    const base = i * BELT_RECORD_SIZE;
    const rawName = new TextDecoder("latin1").decode(bytes.slice(base + 1, base + 31));
    const name = (rawName ?? "").replace(/\u0000/g, "").trimEnd().trim() || "(blank title)";
    const isSinglesTitle = readU16LE(bytes, base + 31) === 0xffff;
    const ownerPromoId = readU16LE(bytes, base + 33);
    const holder1Id = readU16LE(bytes, base + 35);
    const holder2Id = readU16LE(bytes, base + 37);
    const image = readU16LE(bytes, base + 43);
    out.push({
      index: i,
      name,
      ownerPromoId,
      holder1Id,
      holder2Id: isSinglesTitle ? 0 : holder2Id,
      isSinglesTitle,
      image,
    });
  }
  return out;
}

function stripImageExtension(name: string): string {
  return String(name ?? "").replace(/\.(jpg|jpeg|png|gif|bmp)$/i, "");
}

function sanitizeAndTruncateImageBase(input: string, max = 20): string {
  const normalized = String(input ?? "").trim();
  if (!normalized) return "";
  if (/^none$/i.test(normalized)) return "None";
  return normalized.slice(0, max);
}

function joinPath(dir: string, fileName: string) {
  if (!dir) return fileName;
  return /[\/]$/.test(dir) ? `${dir}${fileName}` : `${dir}/${fileName}`;
}

function getBaseName(path: string) {
  return String(path ?? "").split(/[\/]/).pop() || "";
}

function getDirName(path: string) {
  const normalized = String(path ?? "").replace(/[\/]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return idx >= 0 ? normalized.slice(0, idx) : "";
}

function guessImageMimeFromPath(filePath: string): string {
  const lower = String(filePath ?? "").toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpeg') || lower.endsWith('.jpg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function deriveSiblingFolderFromWorkspace(workspaceRoot: string, folderName: string): string {
  const raw = String(workspaceRoot ?? "").trim().replace(/[\\/]+$/, "");
  if (!raw) return "";
  const sep = raw.includes("\\") ? "\\" : "/";
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return "";
  const lowerParts = parts.map((p) => p.toLowerCase());
  const dataIndex = lowerParts.lastIndexOf("data");
  if (dataIndex >= 0) {
    parts[dataIndex] = folderName;
    return parts.join(sep);
  }
  const last = lowerParts[lowerParts.length - 1] ?? "";
  if (/^s\d+$/i.test(last)) {
    return parts.slice(0, -1).concat(folderName).join(sep);
  }
  return parts.slice(0, -1).concat(folderName).join(sep);
}

function deriveLogosFolderFromWorkspace(workspaceRoot: string): string {
  return deriveSiblingFolderFromWorkspace(workspaceRoot, "LOGOS");
}

function deriveBannersFolderFromWorkspace(workspaceRoot: string): string {
  return deriveSiblingFolderFromWorkspace(workspaceRoot, "Banners");
}

async function findImageCandidateCaseInsensitive(dir: string, baseName: string): Promise<string> {
  const dirPath = String(dir ?? "").trim();
  const base = String(baseName ?? "").trim().toLowerCase();
  if (!dirPath || !base) return "";
  try {
    const entries = await readDir(dirPath);
    for (const entry of entries) {
      if (!entry?.isFile || !entry.name) continue;
      const entryBase = stripImageExtension(String(entry.name)).trim().toLowerCase();
      if (entryBase === base) {
        return joinPath(dirPath, String(entry.name));
      }
    }
  } catch {}
  return "";
}
const SIZE_OPTIONS: { label: string; value: number }[] = [
  // promos.dat stores sizes as: 1=Global, 2=National, 3=Cult, 4=Regional, 5=Small, 6=Backyard
  { label: "Backyard", value: 6 },
  { label: "Small", value: 5 },
  { label: "Regional", value: 4 },
  { label: "Cult", value: 3 },
  { label: "National", value: 2 },
  { label: "Global", value: 1 },
];

const BASED_IN_OPTIONS: { label: string; value: number }[] = [
  // promos.dat stores territories as: 1=America, 2=Canada, 3=Mexico
  { label: "America", value: 1 },
  { label: "Canada", value: 2 },
  { label: "Mexico", value: 3 },
];

const CAMP_FAC_OPTIONS: { label: string; value: number }[] = [
  { label: "None", value: 0 },
  { label: "Poor", value: 1 },
  { label: "Average", value: 2 },
  { label: "Good", value: 3 },
  { label: "Superb", value: 4 },
];

// ---------- small helpers ----------
function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function roundUpTo100k(n: number): number {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v <= 0) return 0;
  return Math.ceil(v / 100_000) * 100_000;
}

function normalizeSplit(s: string, max: number) {
  const t = (s ?? "").toString();
  const trimmed = t.trim();
  if (!trimmed) return "None";
  return trimmed.slice(0, max);
}

function promoDisplayName(p: PromoRecord): string {
  return (p.name ?? "").trim() || "(blank)";
}

function safeFilename(path: string) {
  return (path ?? "").split(/[\\/]/).pop() || path;
}

function writeU16le(bytes: Uint8Array, offset: number, value: number) {
  const v = clampInt(value, 0, 65535);
  bytes[offset] = v & 0xff;
  bytes[offset + 1] = (v >>> 8) & 0xff;
}

function normalizeBasedIn(raw: number): number {
  // Based In 0 is not a real game option and can corrupt. Normalize to America.
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  return 1;
}

function workerWorksForPromo(w: any, promoId: number): boolean {
  const e1 = Number(w?.employer1PromoId ?? 0) | 0;
  const e2 = Number(w?.employer2PromoId ?? 0) | 0;
  const e3 = Number(w?.employer3PromoId ?? 0) | 0;
  return e1 === promoId || e2 === promoId || e3 === promoId;
}

function workerHasActiveContract(w: any): boolean {
  const c = String(w?.contractCode ?? "").trim();
  // In your editor: Non / Opn / Wri
  return !!c;
}

function csvEscape(value: any): string {
  const s = (value ?? "").toString();
  if (/[\",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type CsvRecord = Record<string, string>;

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
      } else cur += ch;
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

    if (ch === "\r") continue;

    cur += ch;
  }

  row.push(cur);
  if (row.length > 1 || row[0].trim() !== "") rows.push(row);

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  // If the CSV was saved with UTF-8 BOM (common for Excel compatibility), strip it from the first header.
  if (headers.length && headers[0] && headers[0].charCodeAt(0) === 0xfeff) {
    headers[0] = headers[0].slice(1);
  }
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

export default function PromotionsEditor(props: {
  workspaceRoot: string;
  promosDataPath: string;
  staffDataPath: string;
  wrestlerDataPath: string;
  beltDataPath: string;
  eventDataPath: string;
  tvDataPath: string;
  networkDataPath: string;
  /**
   * Fires after promos.dat is loaded or saved successfully.
   * Used by the host app to keep other editors consistent when promotions shift/delete.
   */
  onPromosChanged?: (records: PromoRecord[]) => void;
}) {
  const { workspaceRoot, promosDataPath, staffDataPath, wrestlerDataPath, beltDataPath, eventDataPath, tvDataPath, networkDataPath, onPromosChanged } = props;

  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  // Track unsaved changes for the Close File prompt.
  const [dirty, setDirty] = useState<boolean>(false);

  const [path, setPath] = useState<string>("");
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [promos, setPromos] = useState<PromoRecord[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  const [search, setSearch] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);

  const [filters, setFilters] = useState<PromoFilters>({
    size: "Everyone",
    basedIn: "Everyone",
    moneyMin: "",
    moneyMax: "",

    imageMin: "",
    imageMax: "",
    riskMin: "",
    riskMax: "",
    productionMin: "",
    productionMax: "",
    advertisingMin: "",
    advertisingMax: "",
    merchandisingMin: "",
    merchandisingMax: "",

    campFacilities: "Everyone",

    noLogo: false,
    noBanner: false,
    brandSplitActive: false,
    developmentalTerritory: false,
    noDevelopmentalTerritory: false,
    noDevelopmentalBooker: false,
    trainingCamp: false,
    noTrainingCamp: false,
    noHeadTrainer: false,
  });
  const [draftFilters, setDraftFilters] = useState<PromoFilters>(filters);

  const [multiDeleteMode, setMultiDeleteMode] = useState<boolean>(false);
  const [multiDeleteSelected, setMultiDeleteSelected] = useState<Set<number>>(new Set());

  const [externalEditingOpen, setExternalEditingOpen] = useState<boolean>(false);

  // Import modal state (promos.dat -> append promotions)
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importSourcePath, setImportSourcePath] = useState<string>("");
  const [importSourcePromos, setImportSourcePromos] = useState<PromoRecord[]>([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());
  const [importSearch, setImportSearch] = useState<string>("");
  const [importInfo, setImportInfo] = useState<string>("");

  // Linked datasets (for announcer/booker/trainer dropdowns)
  const [staff, setStaff] = useState<Staff[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [belts, setBelts] = useState<PromoBeltRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [televisionShows, setTelevisionShows] = useState<TelevisionRecord[]>([]);
  const [networks, setNetworks] = useState<NetworkRecord[]>([]);
  const [linkedStatus, setLinkedStatus] = useState<string>("");

  const [logosFolderPath, setLogosFolderPath] = useState<string>(() => {
    try {
      return localStorage.getItem("ewr.promotions.logosFolder") || "";
    } catch {
      return "";
    }
  });
  const [logoPreviewPath, setLogoPreviewPath] = useState<string>("");
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string>("");
  const [logoPreviewStatus, setLogoPreviewStatus] = useState<string>("");
  const logoPreviewObjectUrlRef = useRef<string>("");

  const [bannersFolderPath, setBannersFolderPath] = useState<string>(() => {
    try {
      return localStorage.getItem("ewr.promotions.bannersFolder") || "";
    } catch {
      return "";
    }
  });
  const [bannerPreviewPath, setBannerPreviewPath] = useState<string>("");
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState<string>("");
  const [bannerPreviewStatus, setBannerPreviewStatus] = useState<string>("");
  const bannerPreviewObjectUrlRef = useRef<string>("");
  const effectiveLogosFolderPath = logosFolderPath || deriveLogosFolderFromWorkspace(workspaceRoot);
  const effectiveBannersFolderPath = bannersFolderPath || deriveBannersFolderFromWorkspace(workspaceRoot);

  const canLoadFromData = !!workspaceRoot && !!promosDataPath;
  const canSave = promos.length > 0 && !!rawBytes && dirty;

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.size !== "Everyone") n++;
    if (filters.basedIn !== "Everyone") n++;
    if (filters.moneyMin.trim()) n++;
    if (filters.moneyMax.trim()) n++;

    if (filters.imageMin.trim()) n++;
    if (filters.imageMax.trim()) n++;
    if (filters.riskMin.trim()) n++;
    if (filters.riskMax.trim()) n++;
    if (filters.productionMin.trim()) n++;
    if (filters.productionMax.trim()) n++;
    if (filters.advertisingMin.trim()) n++;
    if (filters.advertisingMax.trim()) n++;
    if (filters.merchandisingMin.trim()) n++;
    if (filters.merchandisingMax.trim()) n++;

    if (filters.campFacilities !== "Everyone") n++;

    if (filters.noLogo) n++;
    if (filters.noBanner) n++;
    if (filters.brandSplitActive) n++;
    if (filters.developmentalTerritory) n++;
    if (filters.noDevelopmentalTerritory) n++;
    if (filters.noDevelopmentalBooker) n++;
    if (filters.trainingCamp) n++;
    if (filters.noTrainingCamp) n++;
    if (filters.noHeadTrainer) n++;

    return n;
  }, [filters]);

  function clearAllFilters() {
    const cleared: PromoFilters = {
      size: "Everyone",
      basedIn: "Everyone",
      moneyMin: "",
      moneyMax: "",

      imageMin: "",
      imageMax: "",
      riskMin: "",
      riskMax: "",
      productionMin: "",
      productionMax: "",
      advertisingMin: "",
      advertisingMax: "",
      merchandisingMin: "",
      merchandisingMax: "",

      campFacilities: "Everyone",

      noLogo: false,
      noBanner: false,
      brandSplitActive: false,
      developmentalTerritory: false,
      noDevelopmentalTerritory: false,
      noDevelopmentalBooker: false,
      trainingCamp: false,
      noTrainingCamp: false,
      noHeadTrainer: false,
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
          <div className="ewr-label">Size</div>
          <EwrSelectCompat
            className="ewr-input"
            value={draftFilters.size}
            onChange={(e) => setDraftFilters((p) => ({ ...p, size: e.target.value }))}
          >
            <option value="Everyone">Any</option>
            {SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </EwrSelectCompat>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Based In</div>
          <EwrSelectCompat
            className="ewr-input"
            value={draftFilters.basedIn}
            onChange={(e) => setDraftFilters((p) => ({ ...p, basedIn: e.target.value }))}
          >
            <option value="Everyone">Any</option>
            {BASED_IN_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </EwrSelectCompat>
        </div>

        <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
          <div className="ewr-label">Money ($)</div>
          <div
            style={{
              display: "grid",
              // Prevent horizontal scroll: allow grid children to shrink within columns
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
              max={90_000_000}
              step={100_000}
              placeholder="Min"
              value={draftFilters.moneyMin}
              onChange={(e) => setDraftFilters((p) => ({ ...p, moneyMin: e.target.value }))}
            />
            <input
              className="ewr-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={90_000_000}
              step={100_000}
              placeholder="Max"
              value={draftFilters.moneyMax}
              onChange={(e) => setDraftFilters((p) => ({ ...p, moneyMax: e.target.value }))}
            />
          </div>
        </div>

        {[
          ["Image", "imageMin", "imageMax"],
          ["Risk", "riskMin", "riskMax"],
          ["Production", "productionMin", "productionMax"],
          ["Advertising", "advertisingMin", "advertisingMax"],
          ["Merchandising", "merchandisingMin", "merchandisingMax"],
        ].map(([label, minKey, maxKey]) => (
          <div key={label as string} className="ewr-field" style={{ gridColumn: "1 / -1" }}>
            <div className="ewr-label">{label} (0–100)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input
                className="ewr-input"
                type="number"
                min={0}
                max={100}
                step={1}
                placeholder="Min"
                value={(draftFilters as any)[minKey]}
                onChange={(e) => setDraftFilters((p) => ({ ...(p as any), [minKey]: e.target.value }))}
              />
              <input
                className="ewr-input"
                type="number"
                min={0}
                max={100}
                step={1}
                placeholder="Max"
                value={(draftFilters as any)[maxKey]}
                onChange={(e) => setDraftFilters((p) => ({ ...(p as any), [maxKey]: e.target.value }))}
              />
            </div>
          </div>
        ))}

        <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
          <div className="ewr-label">Camp Facilities</div>
          <EwrSelectCompat
            className="ewr-input"
            value={draftFilters.campFacilities}
            onChange={(e) => setDraftFilters((p) => ({ ...p, campFacilities: e.target.value }))}
          >
            <option value="Everyone">Any</option>
            {CAMP_FAC_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </EwrSelectCompat>
        </div>

        <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
          <div
            style={{
              display: "grid",
              // Prevent horizontal scroll: allow grid children to shrink within columns
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              width: "100%",
            }}
          >
            {[
              ["No Logo", "noLogo"],
              ["No Banner", "noBanner"],
              ["Brand Split Active", "brandSplitActive"],
              ["Developmental Territory", "developmentalTerritory"],
              ["No Developmental Territory", "noDevelopmentalTerritory"],
              ["No Developmental Booker", "noDevelopmentalBooker"],
              ["Training Camp", "trainingCamp"],
              ["No Training Camp", "noTrainingCamp"],
              ["No Head Trainer", "noHeadTrainer"],
            ].map(([label, key]) => (
              <label
                key={key as string}
                className="ewr-checkboxRow"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  lineHeight: 1.15,
                  width: "100%",
                  boxSizing: "border-box",
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: 18, height: 18 }}
                  checked={(draftFilters as any)[key]}
                  onChange={(e) => setDraftFilters((p) => ({ ...(p as any), [key]: e.target.checked }))}
                />
                <span
                  style={{
                    minWidth: 0,
                    overflowWrap: "anywhere",
                    fontSize: 13,
                    lineHeight: 1.12,
                    opacity: 0.95,
                  }}
                >
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ---------- linked data loading ----------
  async function tryLoadLinkedData() {
    try {
      if (!workspaceRoot) {
        setLinkedStatus("Workspace not linked (staff/wrestler/belt lists unavailable).");
        return;
      }

      const parts: string[] = [];
      let staffOk = false;
      let workersOk = false;
      let beltsOk = false;
      let eventsOk = false;
      let tvOk = false;
      let networksOk = false;

      if (staffDataPath && (await exists(staffDataPath))) {
        const staffBytes = await readFile(staffDataPath);
        validateStaffDatBytes(staffBytes);
        const parsed = parseStaffDat(staffBytes);
        setStaff(parsed.staff);
        staffOk = true;
        parts.push("staff.dat");
      } else {
        setStaff([]);
      }

      if (wrestlerDataPath && (await exists(wrestlerDataPath))) {
        const wBytes = await readFile(wrestlerDataPath);
        const ws = parseWrestlerDat(toArrayBuffer(wBytes));
        setWorkers(ws);
        workersOk = true;
        parts.push("wrestler.dat");
      } else {
        setWorkers([]);
      }

      if (beltDataPath && (await exists(beltDataPath))) {
        const beltBytes = await readFile(beltDataPath);
        const parsedBelts = parsePromoBelts(beltBytes);
        setBelts(parsedBelts);
        beltsOk = true;
        parts.push("belt.dat");
      } else {
        setBelts([]);
      }

      if (eventDataPath && (await exists(eventDataPath))) {
        const eventBytes = await readFile(eventDataPath);
        setEvents(parseEventDat(eventBytes).events);
        eventsOk = true;
        parts.push("event.dat");
      } else {
        setEvents([]);
      }

      if (tvDataPath && (await exists(tvDataPath))) {
        const tvBytes = await readFile(tvDataPath);
        setTelevisionShows(parseTvDat(tvBytes).television);
        tvOk = true;
        parts.push("tv.dat");
      } else {
        setTelevisionShows([]);
      }

      if (networkDataPath && (await exists(networkDataPath))) {
        const networkBytes = await readFile(networkDataPath);
        setNetworks(parseNetworkDat(networkBytes).networks);
        networksOk = true;
        parts.push("network.dat");
      } else {
        setNetworks([]);
      }

      if (parts.length) {
        setLinkedStatus(`Loaded ${parts.join(" + ")} for dropdowns and lookups.`);
      } else {
        setLinkedStatus("Linked lookup files not found (staff.dat / wrestler.dat / belt.dat / event.dat / tv.dat / network.dat).");
      }

      if (!staffOk && !workersOk && !beltsOk && !eventsOk && !tvOk && !networksOk) return;
    } catch (e: any) {
      console.error(e);
      setLinkedStatus(`Linked data load failed: ${e?.message ?? String(e)}`);
      setStaff([]);
      setWorkers([]);
      setBelts([]);
      setEvents([]);
      setTelevisionShows([]);
      setNetworks([]);
    }
  }

  // load linked data whenever the workspace changes and promos are loaded
  useEffect(() => {
    if (rawBytes && promos.length && workspaceRoot) {
      tryLoadLinkedData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot, staffDataPath, wrestlerDataPath, beltDataPath, eventDataPath, tvDataPath, networkDataPath, rawBytes]);

  // ---------- file I/O ----------
  function normalizeLoadedPromos(records: PromoRecord[]): PromoRecord[] {
    return records
      .slice(0, PROMOS_MAX)
      .map((r, idx) => ({
        ...r,
        recordIndex: idx,
        basedIn: normalizeBasedIn(Number(r.basedIn ?? 0)),
      }));
  }

  async function onLoadFromData() {
    try {
      setError("");
      setStatus("");

      if (!workspaceRoot) throw new Error("Select a DATA folder first");
      if (!promosDataPath) throw new Error("promos.dat not found in DATA folder");

      const ok = await exists(promosDataPath);
      if (!ok) throw new Error("promos.dat not found in DATA folder");

      const bytes = await readFile(promosDataPath);
      validatePromosDatBytes(bytes);
      const parsed = parsePromosDat(bytes);

      setRawBytes(bytes);
      const normalized = normalizeLoadedPromos(parsed.records);
      setPromos(normalized);
      onPromosChanged?.(normalized);
      setSelectedIdx(0);
      setPath(promosDataPath);
      setDirty(false);
      setStatus(`Loaded promos.dat (${bytes.length.toLocaleString("en-US")} bytes).`);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function onSaveFile() {
    try {
      setError("");
      setStatus("");
      if (!rawBytes || promos.length === 0) return;

      // Save: overwrite the loaded file path. If no path is loaded, fall back to Save As.
      let dest = path;
      if (!dest) {
        const picked = await save({
          defaultPath: "promos.dat",
          filters: [{ name: "EWR Promotions", extensions: ["dat"] }],
        });
        if (!picked) return;
        dest = String(picked);
      }

      const bakPath = buildEwresBackupPath(dest);
      try {
        const bakDir = bakPath.slice(0, bakPath.lastIndexOf("/"));
        await mkdir(bakDir, { recursive: true });
        const alreadyBak = await exists(bakPath);
        if (!alreadyBak) await copyFile(dest, bakPath);
      } catch {
        // non-fatal
      }

      const normalized = promos.map((p, i) => ({ ...p, recordIndex: i, money: clampInt(roundUpTo100k(p.money), 0, 90_000_000) }));

      // Block save if any two promotions share the same Name + Initials.
      {
        const seen = new Map<string, number>();
        const dups: string[] = [];
        for (let i = 0; i < normalized.length; i++) {
          const p: any = normalized[i] as any;
          const name = String(p.name ?? "").trim().toLowerCase();
          const init = String(p.initials ?? "").trim().toLowerCase();
          const key = name + "|||" + init;
          if (!name && !init) continue;
          if (seen.has(key)) {
            const j = seen.get(key)!;
            dups.push(`Records ${j + 1} and ${i + 1} share Name+Initials: "${String(p.name ?? "").trim()}" / "${String(p.initials ?? "").trim()}"`);
          } else {
            seen.set(key, i);
          }
        }
        if (dups.length) {
          setError(dups.join('\n'));
          setStatus("");
          return;
        }
      }

      const bytes = writePromosDat(normalized, rawBytes);
      await writeFile(dest, bytes);
      setPath(dest);
      setRawBytes(bytes);
      setPromos(normalized);
      onPromosChanged?.(normalized);
      setDirty(false);
      setStatus(`Saved ${safeFilename(dest)}.`);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  // ---------- list / selection ----------
  
  function isBlankOrNone(v: string) {
    const t = (v ?? "").trim();
    return !t || /^none$/i.test(t);
  }

  function clampNum(n: any, min: number, max: number) {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return max < min ? null : Math.max(min, Math.min(max, x));
  }

  function inRange(val: number, minStr: string, maxStr: string, minBound: number, maxBound: number) {
    const min = minStr.trim() ? clampNum(minStr, minBound, maxBound) : null;
    const max = maxStr.trim() ? clampNum(maxStr, minBound, maxBound) : null;
    if (min !== null && val < min) return false;
    if (max !== null && val > max) return false;
    return true;
  }

  function passesFilters(p: PromoRecord): boolean {
    if (filters.size !== "Everyone" && String(p.size) !== String(filters.size)) return false;
    if (filters.basedIn !== "Everyone" && String(p.basedIn) !== String(filters.basedIn)) return false;

    if (!inRange(Number(p.money ?? 0), filters.moneyMin, filters.moneyMax, 0, 90_000_000)) return false;

    if (!inRange(Number(p.image ?? 0), filters.imageMin, filters.imageMax, 0, 100)) return false;
    if (!inRange(Number(p.risk ?? 0), filters.riskMin, filters.riskMax, 0, 100)) return false;
    if (!inRange(Number(p.production ?? 0), filters.productionMin, filters.productionMax, 0, 100)) return false;
    if (!inRange(Number(p.advertising ?? 0), filters.advertisingMin, filters.advertisingMax, 0, 100)) return false;
    if (!inRange(Number(p.merchandising ?? 0), filters.merchandisingMin, filters.merchandisingMax, 0, 100)) return false;

    if (filters.campFacilities !== "Everyone" && String(p.campFacilities) !== String(filters.campFacilities)) return false;

    if (filters.noLogo) {
      if (!isBlankOrNone(p.bannerBase)) return false;
    }
    if (filters.noBanner) {
      if (!isBlankOrNone(p.logoBase)) return false;
    }
    if (filters.brandSplitActive) {
      const active = (p.rosterSplits ?? []).some((s) => !isBlankOrNone(s));
      if (!active) return false;
    }
    if (filters.developmentalTerritory) {
      if (isBlankOrNone(p.devTerritory)) return false;
    }
    if (filters.noDevelopmentalTerritory) {
      if (!isBlankOrNone(p.devTerritory)) return false;
    }
    if (filters.noDevelopmentalBooker) {
      if (Number(p.bookerStaffId ?? 0) != 0) return false;
    }
    if (filters.trainingCamp) {
      if (isBlankOrNone(p.trainingCamp)) return false;
    }
    if (filters.noTrainingCamp) {
      if (!isBlankOrNone(p.trainingCamp)) return false;
    }
    if (filters.noHeadTrainer) {
      if (Number(p.headTrainerStaffId ?? 0) != 0) return false;
    }

    return true;
  }


  const listItems = useMemo(() => {
    const q = (search ?? "").trim().toLowerCase();
    let out = promos
      .map((p, i) => ({
        arrayIndex: i,
        recordIndex: p.recordIndex,
        name: promoDisplayName(p),
        initials: (p.initials ?? "").trim(),
        promo: p,
      }))
      .filter((it) => passesFilters(it.promo));

    if (q) {
      out = out.filter((it) => {
        return (
          it.name.toLowerCase().includes(q) ||
          it.initials.toLowerCase().includes(q) ||
          String(it.recordIndex).includes(q) ||
          String(it.arrayIndex).includes(q)
        );
      });
    }

    out = [...out];
    if (sortMode === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else out.sort((a, b) => a.recordIndex - b.recordIndex);
    return out;
  }, [promos, search, sortMode, filters]);

  const selected = promos[selectedIdx];

  const workerNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const w of workers) {
      const id = Number((w as any).id ?? 0) | 0;
      if (!id) continue;
      m.set(id, String((w as any).fullName ?? "").trim() || `ID ${id}`);
    }
    return m;
  }, [workers]);

  const selectedPromoChampionships = useMemo(() => {
    const promoId = Number((selected as any)?.id ?? 0) | 0;
    if (!promoId) return [] as Array<{ key: string; title: string; holderText: string; image: number; recordIndex: number }>;
    return belts
      .filter((b) => (Number(b.ownerPromoId ?? 0) | 0) === promoId)
      .map((b) => {
        const h1 = Number(b.holder1Id ?? 0) | 0;
        const h2 = Number(b.holder2Id ?? 0) | 0;
        const image = Number(b.image ?? 0) | 0;
        const holderText = h1 === 0
          ? "Vacant"
          : b.isSinglesTitle
            ? (workerNameById.get(h1) || `ID ${h1}`)
            : `${workerNameById.get(h1) || `ID ${h1}`} / ${h2 ? (workerNameById.get(h2) || `ID ${h2}`) : "Vacant"}`;
        return {
          key: `${b.index}-${h1}-${h2}`,
          title: String(b.name ?? "").trim() || "(blank title)",
          holderText,
          image,
          recordIndex: Number(b.index ?? 0) | 0,
        };
      })
      .sort((a, b) => b.image - a.image || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.recordIndex - b.recordIndex);
  }, [belts, selected, workerNameById]);

  const networkNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const n of networks) {
      map.set(Number(n.networkId ?? 0) | 0, String(n.name ?? "").trim() || `ID ${Number(n.networkId ?? 0) | 0}`);
    }
    return map;
  }, [networks]);

  const selectedPromoEvents = useMemo(() => {
    const promoId = Number((selected as any)?.id ?? 0) | 0;
    if (!promoId) return [] as Array<{ key: string; name: string; monthLabel: string; showTypeLabel: string; monthOrder: number; recordIndex: number }>;
    return events
      .filter((e) => (Number(e.promotionId ?? 0) | 0) === promoId)
      .map((e) => ({
        key: `${e.index}-${e.month}-${e.showType}`,
        name: String(e.name ?? "").trim() || "(blank event)",
        monthLabel: EVENT_MONTH_LABELS[Number(e.month ?? 0) | 0] || `Month ${Number(e.month ?? 0) | 0}`,
        showTypeLabel: EVENT_TYPE_LABELS[Number(e.showType ?? 0) | 0] || `Type ${Number(e.showType ?? 0) | 0}`,
        monthOrder: Number(e.month ?? 999) | 0,
        recordIndex: Number(e.index ?? 0) | 0,
      }))
      .sort((a, b) => a.monthOrder - b.monthOrder || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.recordIndex - b.recordIndex);
  }, [events, selected]);

  const selectedPromoTelevisionShows = useMemo(() => {
    const promoId = Number((selected as any)?.id ?? 0) | 0;
    if (!promoId) return [] as Array<{ key: string; name: string; dayLabel: string; dayOrder: number; networkLabel: string; timeSlotLabel: string; recordIndex: number }>;
    return televisionShows
      .filter((show) => (Number(show.promotionId ?? 0) | 0) === promoId)
      .map((show) => {
        const dayLabel = String(show.day ?? "").trim() || "Monday";
        const slotKey = String(show.timeSlot ?? "E").trim().toUpperCase();
        return {
          key: `${show.index}-${show.networkId}-${slotKey}`,
          name: String(show.name ?? "").trim() || "(blank show)",
          dayLabel,
          dayOrder: TV_DAY_ORDER[dayLabel] ?? 999,
          networkLabel: networkNameById.get(Number(show.networkId ?? 0) | 0) || "None",
          timeSlotLabel: TV_SLOT_LABELS[slotKey] || "Early Evening",
          recordIndex: Number(show.index ?? 0) | 0,
        };
      })
      .sort((a, b) => a.dayOrder - b.dayOrder || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.recordIndex - b.recordIndex);
  }, [televisionShows, selected, networkNameById]);

  useEffect(() => {
    try {
      if (logosFolderPath) localStorage.setItem("ewr.promotions.logosFolder", logosFolderPath);
      else localStorage.removeItem("ewr.promotions.logosFolder");
    } catch {}
  }, [logosFolderPath]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const currentLogoBase = sanitizeAndTruncateImageBase(stripImageExtension(String(selected?.logoBase ?? "None")), 20);

      if (!effectiveLogosFolderPath) {
        if (!cancelled) {
          if (logoPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(logoPreviewObjectUrlRef.current);
            logoPreviewObjectUrlRef.current = "";
          }
          setLogoPreviewPath("");
          setLogoPreviewUrl("");
          setLogoPreviewStatus("Set the global LOGOS folder to preview promotion logos.");
        }
        return;
      }

      if (!currentLogoBase || currentLogoBase.toLowerCase() === "none") {
        if (!cancelled) {
          if (logoPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(logoPreviewObjectUrlRef.current);
            logoPreviewObjectUrlRef.current = "";
          }
          setLogoPreviewPath("");
          setLogoPreviewUrl("");
          setLogoPreviewStatus("This promotion is set to None for Logo.");
        }
        return;
      }

      const candidates = [
        joinPath(effectiveLogosFolderPath, `${currentLogoBase}.jpg`),
        joinPath(effectiveLogosFolderPath, `${currentLogoBase}.jpeg`),
        joinPath(effectiveLogosFolderPath, `${currentLogoBase}.png`),
        joinPath(effectiveLogosFolderPath, `${currentLogoBase}.gif`),
        joinPath(effectiveLogosFolderPath, `${currentLogoBase}.bmp`),
        joinPath(effectiveLogosFolderPath, currentLogoBase),
      ];

      let resolvedCandidate = "";

      for (const candidate of candidates) {
        try {
          if (await exists(candidate)) {
            resolvedCandidate = candidate;
            break;
          }
        } catch {}
      }

      if (!resolvedCandidate) {
        resolvedCandidate = await findImageCandidateCaseInsensitive(effectiveLogosFolderPath, currentLogoBase);
      }

      if (resolvedCandidate) {
        try {
          const bytes = await readFile(resolvedCandidate);
          const blob = new Blob([bytes], { type: guessImageMimeFromPath(resolvedCandidate) });
          const objectUrl = URL.createObjectURL(blob);

          if (!cancelled) {
            if (logoPreviewObjectUrlRef.current) URL.revokeObjectURL(logoPreviewObjectUrlRef.current);
            logoPreviewObjectUrlRef.current = objectUrl;
            setLogoPreviewPath(resolvedCandidate);
            setLogoPreviewUrl(objectUrl);
            setLogoPreviewStatus("");
          } else {
            URL.revokeObjectURL(objectUrl);
          }
          return;
        } catch {}
      }

      if (!cancelled) {
        if (logoPreviewObjectUrlRef.current) {
          URL.revokeObjectURL(logoPreviewObjectUrlRef.current);
          logoPreviewObjectUrlRef.current = "";
        }
        setLogoPreviewPath("");
        setLogoPreviewUrl("");
        setLogoPreviewStatus(`Image not found in LOGOS folder for "${currentLogoBase}".`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [logosFolderPath, selected]);

  useEffect(() => {
    return () => {
      if (logoPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(logoPreviewObjectUrlRef.current);
        logoPreviewObjectUrlRef.current = "";
      }
    };
  }, []);


  useEffect(() => {
    try {
      if (bannersFolderPath) localStorage.setItem("ewr.promotions.bannersFolder", bannersFolderPath);
      else localStorage.removeItem("ewr.promotions.bannersFolder");
    } catch {}
  }, [bannersFolderPath]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const currentBannerBase = sanitizeAndTruncateImageBase(stripImageExtension(String(selected?.bannerBase ?? "None")), 20);

      if (!effectiveBannersFolderPath) {
        if (!cancelled) {
          if (bannerPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(bannerPreviewObjectUrlRef.current);
            bannerPreviewObjectUrlRef.current = "";
          }
          setBannerPreviewPath("");
          setBannerPreviewUrl("");
          setBannerPreviewStatus("Set the global Banners folder to preview promotion banners.");
        }
        return;
      }

      if (!currentBannerBase || currentBannerBase.toLowerCase() === "none") {
        if (!cancelled) {
          if (bannerPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(bannerPreviewObjectUrlRef.current);
            bannerPreviewObjectUrlRef.current = "";
          }
          setBannerPreviewPath("");
          setBannerPreviewUrl("");
          setBannerPreviewStatus("This promotion is set to None for Banner.");
        }
        return;
      }

      const candidates = [
        joinPath(effectiveBannersFolderPath, `${currentBannerBase}.jpg`),
        joinPath(effectiveBannersFolderPath, `${currentBannerBase}.jpeg`),
        joinPath(effectiveBannersFolderPath, `${currentBannerBase}.png`),
        joinPath(effectiveBannersFolderPath, `${currentBannerBase}.gif`),
        joinPath(effectiveBannersFolderPath, `${currentBannerBase}.bmp`),
        joinPath(effectiveBannersFolderPath, currentBannerBase),
      ];

      let resolvedCandidate = "";

      for (const candidate of candidates) {
        try {
          if (await exists(candidate)) {
            resolvedCandidate = candidate;
            break;
          }
        } catch {}
      }

      if (!resolvedCandidate) {
        resolvedCandidate = await findImageCandidateCaseInsensitive(effectiveBannersFolderPath, currentBannerBase);
      }

      if (resolvedCandidate) {
        try {
          const bytes = await readFile(resolvedCandidate);
          const blob = new Blob([bytes], { type: guessImageMimeFromPath(resolvedCandidate) });
          const objectUrl = URL.createObjectURL(blob);

          if (!cancelled) {
            if (bannerPreviewObjectUrlRef.current) URL.revokeObjectURL(bannerPreviewObjectUrlRef.current);
            bannerPreviewObjectUrlRef.current = objectUrl;
            setBannerPreviewPath(resolvedCandidate);
            setBannerPreviewUrl(objectUrl);
            setBannerPreviewStatus("");
          } else {
            URL.revokeObjectURL(objectUrl);
          }
          return;
        } catch {}
      }

      if (!cancelled) {
        if (bannerPreviewObjectUrlRef.current) {
          URL.revokeObjectURL(bannerPreviewObjectUrlRef.current);
          bannerPreviewObjectUrlRef.current = "";
        }
        setBannerPreviewPath("");
        setBannerPreviewUrl("");
        setBannerPreviewStatus(`Image not found in Banners folder for "${currentBannerBase}".`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bannersFolderPath, selected]);

  useEffect(() => {
    return () => {
      if (bannerPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(bannerPreviewObjectUrlRef.current);
        bannerPreviewObjectUrlRef.current = "";
      }
    };
  }, []);

  const normKey = (v: any) => String(v ?? "").trim().toLowerCase();

  function hasDuplicateName(nextName: string, selfIndex: number) {
    const key = normKey(nextName);
    if (!key || key === "none") return false;
    return promos.some((p, i) => i !== selfIndex && normKey(p.name) === key);
  }

  function hasDuplicateInitials(nextInitials: string, selfIndex: number) {
    const key = normKey(nextInitials);
    if (!key || key === "none") return false;
    return promos.some((p, i) => i !== selfIndex && normKey(p.initials) === key);
  }

  function updatePromo(update: (p: PromoRecord) => PromoRecord) {
    setPromos((prev) => {
      if (!prev[selectedIdx]) return prev;
      const next = [...prev];
      next[selectedIdx] = update(next[selectedIdx]);
      return next.map((p, i) => ({ ...p, recordIndex: i }));
    });
    setDirty(true);
  }

  function setField<K extends keyof PromoRecord>(key: K, value: PromoRecord[K]) {
    // Enforce uniqueness rules: no two promotions may share the same Name or Initials (case-insensitive, trimmed).
    if (key === "name") {
      const nextName = String(value ?? "");
      if (hasDuplicateName(nextName, selectedIdx)) {
        setStatus('Duplicate Name is not allowed. Promotions cannot share the same name.');
        return;
      }
    }
    if (key === "initials") {
      const nextInit = String(value ?? "");
      if (hasDuplicateInitials(nextInit, selectedIdx)) {
        setStatus('Duplicate Initials are not allowed. Promotions cannot share the same initials.');
        return;
      }
    }
    updatePromo((p) => ({ ...p, [key]: value }));
  }


  function setRosterSplit(idx: 0 | 1 | 2 | 3, value: string) {
    updatePromo((p) => {
      const next: [string, string, string, string] = [...p.rosterSplits] as any;
      next[idx] = normalizeSplit(value, 10);
      return { ...p, rosterSplits: next };
    });
  }

  // ---------- add/copy/delete/multi-delete ----------
  function nextPromoId(current: PromoRecord[]): number {
    const used = new Set<number>(current.map((p) => Number(p.id ?? 0)).filter((n) => n > 0));
    let max = 0;
    for (const n of used) max = Math.max(max, n);
    let cand = max + 1;
    while (cand <= 65535 && used.has(cand)) cand++;
    if (cand <= 65535) return cand;

    // fallback: find first free
    for (let i = 1; i <= 65535; i++) {
      if (!used.has(i)) return i;
    }
    return 1;
  }

  function makeBlankPromoRecord(current: PromoRecord[]): PromoRecord {
    const recordSize = 397;
    const raw = new Uint8Array(recordSize);
    raw[0] = 0x34; // marker
    const id = nextPromoId(current);
    writeU16le(raw, 1, id);

    // Attempt to preserve any "seed" bytes from the currently loaded file if possible.
    // If promos.dat was loaded, clone the first record bytes as a template (keeps unknown bytes sane).
    if (rawBytes && rawBytes.length >= recordSize) {
      raw.set(rawBytes.slice(0, recordSize));
      raw[0] = 0x34;
      writeU16le(raw, 1, id);
    }

    return {
      recordIndex: current.length,
      id,
      name: "",
      initials: "",
      logoBase: "None",
      bannerBase: "None",
      size: 6,
      basedIn: 1,
      money: 0,
      image: 0,
      production: 0,
      risk: 0,
      advertising: 0,
      merchandising: 0,
      announcer1StaffId: 0,
      announcer2UseWrestler: false,
      announcer2StaffId: 0,
      announcer2WrestlerId: 0,
      rosterSplits: ["None", "None", "None", "None"],
      devTerritory: "",
      trainingCamp: "",
      campFacilities: 0,
      headTrainerStaffId: 0,
      bookerStaffId: 0,
      _raw: raw,
    };
  }

  function addNewPromotion() {
    setStatus("");
    if (promos.length >= PROMOS_MAX) {
      setStatus(`Limit reached (${PROMOS_MAX} promotions). Delete one to add another.`);
      return;
    }

    setPromos((prev) => {
      const next = [...prev, makeBlankPromoRecord(prev)].map((p, i) => ({ ...p, recordIndex: i }));
      onPromosChanged?.(next);
      return next;
    });
    setSelectedIdx(promos.length); // new index
  }

  function copyPromotionAt(idx: number) {
    setStatus("");
    if (promos.length >= PROMOS_MAX) {
      setStatus(`Limit reached (${PROMOS_MAX} promotions). Delete one to copy.`);
      return;
    }
    const src = promos[idx];
    if (!src) return;

    setPromos((prev) => {
      const base = prev[idx];
      if (!base) return prev;

      const nextId = nextPromoId(prev);
      const recordSize = 397;
      const raw = base._raw?.length === recordSize ? new Uint8Array(base._raw) : makeBlankPromoRecord(prev)._raw;

      raw[0] = 0x34;
      writeU16le(raw, 1, nextId);

      const copied: PromoRecord = {
        ...base,
        recordIndex: prev.length,
        id: nextId,
        name: `${(base.name ?? "").trim() || "Promotion"} (Copy)`.slice(0, 40),
        initials: "",
        basedIn: normalizeBasedIn(Number(base.basedIn ?? 1)),
        money: clampInt(roundUpTo100k(Number(base.money ?? 0)), 0, 90_000_000),
        _raw: raw,
      };

      const merged = [...prev, copied].map((p, i) => ({ ...p, recordIndex: i }));
      onPromosChanged?.(merged);
      return merged;
    });

    setSelectedIdx(promos.length);
  }

  function deletePromotionAt(idx: number) {
    const p = promos[idx];
    if (!p) return;

    const oldLen = promos.length;

    setPromos((prev) => {
      const next = prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, recordIndex: i }));
      onPromosChanged?.(next);
      return next;
    });

    setSelectedIdx((cur) => {
      if (idx < cur) return Math.max(0, cur - 1);
      if (idx === cur) {
        const nextLen = Math.max(0, oldLen - 1);
        if (nextLen <= 0) return 0;
        return Math.min(cur, nextLen - 1);
      }
      return cur;
    });
  }

  function toggleMultiDeleteSelection(i: number) {
    setMultiDeleteSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function exitMultiDeleteMode() {
    setMultiDeleteMode(false);
    setMultiDeleteSelected(new Set());
  }

  function deleteSelectedPromotions() {
    if (!multiDeleteSelected.size) {
      exitMultiDeleteMode();
      return;
    }
    if (multiDeleteSelected.size >= promos.length) {
      setStatus("You cannot multi-delete all promotions. At least one record must remain.");
      return;
    }

    const ok = window.confirm(
      `Delete ${multiDeleteSelected.size} promotion(s)?\n\nThis will also clear/remap wrestler & staff employers via your cascade logic.`
    );
    if (!ok) return;

    setPromos((prev) => {
      const toDelete = new Set(Array.from(multiDeleteSelected));
      const next = prev.filter((_, i) => !toDelete.has(i)).map((r, i) => ({ ...r, recordIndex: i }));
      onPromosChanged?.(next);
      return next;
    });

    exitMultiDeleteMode();
    setSelectedIdx(0);
  }

  // ---------- import promos.dat (append) ----------
  async function onImportPromotions() {
    setStatus("");
    if (!rawBytes || !promos.length) {
      setStatus("Load promos.dat first.");
      return;
    }
    if (promos.length >= PROMOS_MAX) {
      setStatus(`Limit reached (${PROMOS_MAX} promotions). Delete one to import.`);
      return;
    }

    try {
      const picked = await open({
        title: "Import promotions from another promos.dat",
        multiple: false,
        filters: [{ name: "EWR promos.dat", extensions: ["dat"] }],
      });
      if (!picked) return;
      const importPath = Array.isArray(picked) ? picked[0] : picked;

      const bytes = await readFile(importPath);
      validatePromosDatBytes(bytes);
      const parsed = parsePromosDat(bytes);

      const normalized = normalizeLoadedPromos(parsed.records);
      const remaining = PROMOS_MAX - promos.length;

      // Mirror other editors: mark rows as importable / blocked (blank name, duplicates, etc.)
      const existingNames = new Set(promos.map((p) => normKey(p.name)).filter((s) => !!s && s !== "none"));
      const existingInitials = new Set(promos.map((p) => normKey(p.initials)).filter((s) => !!s && s !== "none"));
      const annotated = normalized.map((r) => {
        const nm = promoDisplayName(r).trim();
        const key = normKey(nm);
        const blank = !nm || nm === "(blank)";
        const initKey = normKey((r as any).initials ?? "");
        const dupName = !!key && existingNames.has(key);
        const dupInit = !!initKey && existingInitials.has(initKey);

        const importable = !blank && !dupName && !dupInit;
        return {
          ...(r as any),
          __importable: importable,
          __importReason: blank ? "Blank promotion name" : dupName ? "Duplicate name already exists" : dupInit ? "Duplicate initials already exists" : "",
        } as any;
      });

      setImportSourcePath(importPath);
      setImportSourcePromos(annotated);
      setImportSelection(new Set());
      setImportSearch("");
      setImportInfo(
        `Select promotion(s) to import. Imported promotions will be appended as NEW records with NEW IDs. Remaining slots: ${remaining} (max ${PROMOS_MAX}).`
      );
      setImportModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import load failed: ${e?.message ?? String(e)}`);
    }
  }

  const importFilteredPromos = useMemo(() => {
    const q = importSearch.trim().toLowerCase();
    if (!q) return importSourcePromos;

    return importSourcePromos.filter((p) => {
      const nm = promoDisplayName(p).toLowerCase();
      const init = String(p.initials ?? "").toLowerCase();
      return nm.includes(q) || init.includes(q) || String(p.recordIndex).includes(q);
    });
  }, [importSourcePromos, importSearch]);


  function toggleImportSelection(sourceIndex: number, checked: boolean, disabled: boolean) {
    if (disabled) return;
    setImportSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceIndex);
      else next.delete(sourceIndex);
      return next;
    });
  }

  function closeImportModal() {
    setImportModalOpen(false);
    setImportSelection(new Set());
    setImportSearch("");
    setImportInfo("");
  }

  function commitImportSelected() {
    const pickedAll = importSourcePromos.filter((p: any) => importSelection.has(p.recordIndex));
    const picked = pickedAll.filter((p: any) => !!p.__importable);
    if (!pickedAll.length) {
      setImportInfo("Select at least one promotion.");
      return;
    }
    if (!picked.length) {
      setImportInfo("All selected promotions are blocked (blank or duplicate name).");
      return;
    }

    setPromos((prev) => {
      const remaining = PROMOS_MAX - prev.length;
      if (remaining <= 0) {
        setImportInfo(`Limit reached (${PROMOS_MAX}). Delete one to import.`);
        return prev;
      }

      const toTake = picked.slice(0, remaining);
      const recordSize = 397;

      const appended: PromoRecord[] = toTake.map((src) => {
        const id = nextPromoId(prev.concat([])); // rough; will be corrected below
        // seed unknown bytes from src._raw then rewrite marker+id
        const raw = src._raw?.length === recordSize ? new Uint8Array(src._raw) : makeBlankPromoRecord(prev)._raw;
        raw[0] = 0x34;
        writeU16le(raw, 1, id);

        return {
          ...src,
          recordIndex: 0,
          id,
          name: String(src.name ?? "").slice(0, 40),
          initials: String(src.initials ?? "").slice(0, 6),
          basedIn: normalizeBasedIn(Number(src.basedIn ?? 1)),
          money: clampInt(roundUpTo100k(Number(src.money ?? 0)), 0, 90_000_000),
          _raw: raw,
        };
      });

      // Fix IDs to be unique deterministically
      const used = new Set<number>(prev.map((p) => Number(p.id ?? 0)).filter((n) => n > 0));
      for (const a of appended) {
        let id = Number(a.id ?? 0) || 0;
        while (!id || used.has(id)) id = nextPromoId(prev.concat(appended));
        used.add(id);
        a.id = id;
        writeU16le(a._raw, 1, id);
      }

      const next = [...prev, ...appended].map((p, i) => ({ ...p, recordIndex: i }));
      onPromosChanged?.(next);

      if (picked.length > remaining) {
        setStatus(`Imported ${remaining} promotions. ${picked.length - remaining} were skipped (35-promo cap).`);
      } else {
        setStatus(`Imported ${picked.length} promotion(s).`);
      }

      return next;
    });

    closeImportModal();
  }

  // ---------- external editing: CSV ----------
  async function onExportPromosCsv() {
    setStatus("");
    if (!promos.length) {
      setStatus("Load promos.dat first.");
      return;
    }

    try {
      const dest = await save({
        title: "Export promotions to CSV",
        defaultPath: "promotions.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!dest) return;

      // Human-readable export (matches other editors): names/labels rather than numeric codes.
      const headers = [
        "ID",
        "Name",
        "Initials",
        "Logo",
        "Banner",
        "Size",
        "Based In",
        "Money",
        "Image",
        "Production",
        "Risk",
        "Advertising",
        "Merchandising",
        "Announcer 1",
        "Announcer 2",
        "Use Wrestler",
        "Roster Split 1",
        "Roster Split 2",
        "Roster Split 3",
        "Roster Split 4",
        "Dev Territory",
        "Dev Booker (Booker)",
        "Training Camp",
        "Camp Facilities",
        "Trainer",
      ];

      const staffById = new Map<number, string>();
      for (const s of staff) {
        const sid = Number((s as any).id ?? 0) || 0;
        if (sid) staffById.set(sid, String((s as any).name ?? "").trim());
      }
      const workerById = new Map<number, string>();
      for (const w of workers) {
        const wid = Number((w as any).id ?? 0) || 0;
        if (wid) workerById.set(wid, String((w as any).fullName ?? "").trim());
      }

      const sizeLabel = (v: number) => SIZE_OPTIONS.find((o) => o.value === Number(v))?.label ?? "";
      const basedLabel = (v: number) => BASED_IN_OPTIONS.find((o) => o.value === normalizeBasedIn(Number(v)))?.label ?? "";
      const campFacLabel = (v: number) => CAMP_FAC_OPTIONS.find((o) => o.value === Number(v))?.label ?? "";
      const staffNameOrNone = (id: number) => (id ? staffById.get(Number(id)) || "" : "None");
      const workerNameOrNone = (id: number) => (id ? workerById.get(Number(id)) || "" : "None");

      const lines: string[] = [];
      lines.push(headers.join(","));

      for (const p of promos) {
        const ann1 = staffNameOrNone(Number(p.announcer1StaffId ?? 0));
        const ann2 = p.announcer2UseWrestler
          ? workerNameOrNone(Number(p.announcer2WrestlerId ?? 0))
          : staffNameOrNone(Number(p.announcer2StaffId ?? 0));
        const useW = p.announcer2UseWrestler ? "Yes" : "No";

        const row = [
          Number(p.id ?? 0),
          String(p.name ?? ""),
          String(p.initials ?? ""),
          String(p.logoBase ?? ""),
          String(p.bannerBase ?? ""),
          sizeLabel(Number(p.size ?? 0)),
          basedLabel(Number(p.basedIn ?? 1)),
          clampInt(roundUpTo100k(Number(p.money ?? 0)), 0, 90_000_000),
          clampInt(Number(p.image ?? 0), 0, 100),
          clampInt(Number(p.production ?? 0), 0, 100),
          clampInt(Number(p.risk ?? 0), 0, 100),
          clampInt(Number(p.advertising ?? 0), 0, 100),
          clampInt(Number(p.merchandising ?? 0), 0, 100),
          ann1 || "None",
          ann2 || "None",
          useW,
          String(p.rosterSplits?.[0] ?? "None"),
          String(p.rosterSplits?.[1] ?? "None"),
          String(p.rosterSplits?.[2] ?? "None"),
          String(p.rosterSplits?.[3] ?? "None"),
          String(p.devTerritory ?? "None"),
          staffNameOrNone(Number(p.bookerStaffId ?? 0)) || "None",
          String(p.trainingCamp ?? "None"),
          campFacLabel(Number(p.campFacilities ?? 0)) || "None",
          staffNameOrNone(Number(p.headTrainerStaffId ?? 0)) || "None",
        ].map(csvEscape);
        lines.push(row.join(","));
      }

      // Excel (especially on Windows) frequently mis-detects UTF-8 unless a BOM is present.
      // Use UTF-8 with BOM so accented names (e.g., Andrés Maroñas) round-trip cleanly.
      const csvText = "\ufeff" + lines.join("\n");
      await writeFile(dest, new TextEncoder().encode(csvText));
      setStatus(`Exported CSV: ${safeFilename(dest)}.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`CSV export failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onImportPromosCsv() {
    setStatus("");
    if (!rawBytes || !promos.length) {
      setStatus("Load promos.dat first.");
      return;
    }

    try {
      const picked = await open({
        title: "Import promotions from CSV",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!picked) return;
      const csvPath = Array.isArray(picked) ? picked[0] : picked;

      const bytes = await readFile(csvPath);
      const text = new TextDecoder("utf-8").decode(bytes);
      const parsed = parseCsv(text);

      const norm = (s: any) => String(s ?? "").trim().toLowerCase();

      const staffByName = new Map<string, number>();
      const staffById = new Map<number, Staff>();
      for (const s of staff) {
        const sid = Number((s as any).id ?? 0) || 0;
        const nm = norm((s as any).name);
        if (sid) staffById.set(sid, s);
        if (nm && sid) staffByName.set(nm, sid);
      }
      const workerByName = new Map<string, number>();
      for (const w of workers) {
        const wid = Number((w as any).id ?? 0) || 0;
        const nm = norm((w as any).fullName);
        if (nm && wid) workerByName.set(nm, wid);
      }

      const parseSize = (v: any): number => {
        const n = Number(v);
        if (Number.isFinite(n)) return clampInt(n, 1, 6);
        const label = norm(v);
        const hit = SIZE_OPTIONS.find((o) => norm(o.label) === label);
        return hit ? hit.value : 6;
      };
      const parseBasedIn = (v: any): number => {
        const n = Number(v);
        if (Number.isFinite(n)) return normalizeBasedIn(n);
        const label = norm(v);
        const hit = BASED_IN_OPTIONS.find((o) => norm(o.label) === label);
        return normalizeBasedIn(hit ? hit.value : 1);
      };
      const parseCampFac = (v: any): number => {
        const n = Number(v);
        if (Number.isFinite(n)) return clampInt(n, 0, 4);
        const label = norm(v);
        const hit = CAMP_FAC_OPTIONS.find((o) => norm(o.label) === label);
        return hit ? hit.value : 0;
      };
      const parseYesNo = (v: any): boolean => {
        const t = norm(v);
        if (t === "1" || t === "true" || t === "yes" || t === "y") return true;
        return false;
      };
      const parseStaffIdByNameOrId = (v: any): number => {
        const t = String(v ?? "").trim();
        if (!t || norm(t) === "none") return 0;
        const n = Number(t);
        if (Number.isFinite(n)) return clampInt(n, 0, 65535);
        return clampInt(staffByName.get(norm(t)) ?? 0, 0, 65535);
      };
      const parseWorkerIdByNameOrId = (v: any): number => {
        const t = String(v ?? "").trim();
        if (!t || norm(t) === "none") return 0;
        const n = Number(t);
        if (Number.isFinite(n)) return clampInt(n, 0, 65535);
        return clampInt(workerByName.get(norm(t)) ?? 0, 0, 65535);
      };

      let updated = 0;
      let created = 0;
      let skipped = 0;

      setPromos((prev) => {
        let next = [...prev];

        for (const row of parsed.rows) {
          const id = Number(row.ID ?? row.Id ?? row.id ?? 0) | 0;
          const name = String(row.Name ?? row.name ?? "").slice(0, 40);
          const initials = String(row.Initials ?? row.initials ?? "").slice(0, 6);

          const size = parseSize(row.Size ?? row.size);
          const basedIn = parseBasedIn(row["Based In"] ?? row.BasedIn ?? row.basedIn);
          const money = clampInt(roundUpTo100k(Number(row.Money ?? row.money ?? 0)), 0, 90_000_000);

          const useW = parseYesNo(row["Use Wrestler"] ?? row.UseWrestler ?? row.announcer2UseWrestler);

          const ann1StaffId = parseStaffIdByNameOrId(row["Announcer 1"] ?? row.Announcer1StaffId ?? row.announcer1StaffId);
          const ann2StaffId = useW ? 0 : parseStaffIdByNameOrId(row["Announcer 2"] ?? row.Announcer2StaffId ?? row.announcer2StaffId ?? row.Announcer2Id);
          const ann2WrestlerId = useW ? parseWorkerIdByNameOrId(row["Announcer 2"] ?? row.Announcer2WrestlerId ?? row.announcer2WrestlerId ?? row.Announcer2Id) : 0;

          const patch: Partial<PromoRecord> = {
            name,
            initials,
            logoBase: String(row.Logo ?? row.logo ?? row.LogoBase ?? row.logoBase ?? "None").slice(0, 20),
            bannerBase: String(row.Banner ?? row.banner ?? row.BannerBase ?? row.bannerBase ?? "None").slice(0, 20),
            size,
            basedIn,
            money,
            image: clampInt(Number(row.Image ?? row.image ?? 0), 0, 100),
            production: clampInt(Number(row.Production ?? row.production ?? 0), 0, 100),
            risk: clampInt(Number(row.Risk ?? row.risk ?? 0), 0, 100),
            advertising: clampInt(Number(row.Advertising ?? row.advertising ?? 0), 0, 100),
            merchandising: clampInt(Number(row.Merchandising ?? row.merchandising ?? 0), 0, 100),
            announcer1StaffId: ann1StaffId,
            announcer2UseWrestler: useW,
            announcer2StaffId: ann2StaffId,
            announcer2WrestlerId: ann2WrestlerId,
            rosterSplits: [
              normalizeSplit(String(row["Roster Split 1"] ?? row.RosterSplit1 ?? row.rosterSplit1 ?? "None"), 10),
              normalizeSplit(String(row["Roster Split 2"] ?? row.RosterSplit2 ?? row.rosterSplit2 ?? "None"), 10),
              normalizeSplit(String(row["Roster Split 3"] ?? row.RosterSplit3 ?? row.rosterSplit3 ?? "None"), 10),
              normalizeSplit(String(row["Roster Split 4"] ?? row.RosterSplit4 ?? row.rosterSplit4 ?? "None"), 10),
            ] as any,
            devTerritory: String(row["Dev Territory"] ?? row.DevTerritory ?? row.devTerritory ?? "").slice(0, 35),
            trainingCamp: String(row["Training Camp"] ?? row.TrainingCamp ?? row.trainingCamp ?? "").slice(0, 25),
            campFacilities: parseCampFac(row["Camp Facilities"] ?? row.CampFacilities ?? row.campFacilities ?? 0),
            headTrainerStaffId: parseStaffIdByNameOrId(row.Trainer ?? row["Trainer"] ?? row.HeadTrainerStaffId ?? row.headTrainerStaffId ?? 0),
            bookerStaffId: parseStaffIdByNameOrId(row["Dev Booker (Booker)"] ?? row.BookerStaffId ?? row.bookerStaffId ?? 0),
          };

          const existingIdx = id ? next.findIndex((p) => Number(p.id ?? 0) === id) : -1;

          if (existingIdx >= 0) {            {
              const nameKey = norm(name);
              const initKey = norm(initials);
              const dupName = nameKey && nameKey !== "none" && next.some((p, i) => i !== existingIdx && norm(p.name) === nameKey);
              const dupInit = initKey && initKey !== "none" && next.some((p, i) => i !== existingIdx && norm(p.initials) === initKey);
              if (dupName || dupInit) {
                skipped += 1;
                continue;
              }
            }
            next[existingIdx] = { ...next[existingIdx], ...patch };
            updated += 1;
            continue;
          }

          // Fallback match by Name+Initials if no/unknown ID
          const fallbackIdx =
            !id && name
              ? next.findIndex(
                  (p) =>
                    String(p.name ?? "").trim().toLowerCase() === name.trim().toLowerCase() &&
                    String(p.initials ?? "").trim().toLowerCase() === initials.trim().toLowerCase()
                )
              : -1;

          if (fallbackIdx >= 0) {
            {
              const nameKey = norm(name);
              const initKey = norm(initials);
              const dupName = nameKey && nameKey !== "none" && next.some((p, i) => i !== fallbackIdx && norm(p.name) === nameKey);
              const dupInit = initKey && initKey !== "none" && next.some((p, i) => i !== fallbackIdx && norm(p.initials) === initKey);
              if (dupName || dupInit) {
                skipped += 1;
                continue;
              }
            }
            {
              const nameKey = norm(name);
              const initKey = norm(initials);
              const dupName = nameKey && nameKey !== "none" && next.some((p, i) => i !== fallbackIdx && norm(p.name) === nameKey);
              const dupInit = initKey && initKey !== "none" && next.some((p, i) => i !== fallbackIdx && norm(p.initials) === initKey);
              if (dupName || dupInit) {
                skipped += 1;
                continue;
              }
            }
            next[fallbackIdx] = { ...next[fallbackIdx], ...patch };
            updated += 1;
            continue;
          }

          if (next.length >= PROMOS_MAX) {
            skipped += 1;
            continue;
          }

                    {
            const nameKey = norm(name);
            const initKey = norm(initials);
            const dupName = nameKey && nameKey !== "none" && next.some((p) => norm(p.name) === nameKey);
            const dupInit = initKey && initKey !== "none" && next.some((p) => norm(p.initials) === initKey);
            if (dupName || dupInit) {
              skipped += 1;
              continue;
            }
          }

const blank = makeBlankPromoRecord(next);
          blank.name = patch.name ?? blank.name;
          blank.initials = patch.initials ?? blank.initials;
          blank.logoBase = patch.logoBase ?? blank.logoBase;
          blank.bannerBase = patch.bannerBase ?? blank.bannerBase;
          blank.size = patch.size ?? blank.size;
          blank.basedIn = patch.basedIn ?? blank.basedIn;
          blank.money = patch.money ?? blank.money;
          blank.image = patch.image ?? blank.image;
          blank.production = patch.production ?? blank.production;
          blank.risk = patch.risk ?? blank.risk;
          blank.advertising = patch.advertising ?? blank.advertising;
          blank.merchandising = patch.merchandising ?? blank.merchandising;
          blank.announcer1StaffId = patch.announcer1StaffId ?? blank.announcer1StaffId;
          blank.announcer2UseWrestler = patch.announcer2UseWrestler ?? blank.announcer2UseWrestler;
          blank.announcer2StaffId = patch.announcer2StaffId ?? blank.announcer2StaffId;
          blank.announcer2WrestlerId = patch.announcer2WrestlerId ?? blank.announcer2WrestlerId;
          blank.rosterSplits = patch.rosterSplits as any;
          blank.devTerritory = patch.devTerritory ?? blank.devTerritory;
          blank.trainingCamp = patch.trainingCamp ?? blank.trainingCamp;
          blank.campFacilities = patch.campFacilities ?? blank.campFacilities;
          blank.headTrainerStaffId = patch.headTrainerStaffId ?? blank.headTrainerStaffId;
          blank.bookerStaffId = patch.bookerStaffId ?? blank.bookerStaffId;

          next.push(blank);
          created += 1;
        }

        next = next.map((p, i) => ({ ...p, recordIndex: i }));
        onPromosChanged?.(next);
        return next;
      });

      if (updated > 0 || created > 0) {
        setDirty(true);
      }
      setStatus(`CSV import complete. Updated: ${updated}. Created: ${created}. Skipped: ${skipped}.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`CSV import failed: ${e?.message ?? String(e)}`);
    }
  }

  // ---------- announcer/booker/head trainer dropdowns ----------
  const staffForSelectedPromo = useMemo(() => {
    if (!selected) return [];
    const pid = Number(selected.id ?? 0);
    return staff.filter((s) => Number((s as any).employerId ?? 0) === pid);
  }, [staff, selected]);

  const staffAnnouncersForSelectedPromo = useMemo(() => {
    return staffForSelectedPromo.filter((s) => String((s as any).position ?? "") === "Announcer");
  }, [staffForSelectedPromo]);

  const staffTrainersForSelectedPromo = useMemo(() => {
    return staffForSelectedPromo.filter((s) => String((s as any).position ?? "") === "Trainer");
  }, [staffForSelectedPromo]);

  const staffBookersForSelectedPromo = useMemo(() => {
    return staffForSelectedPromo.filter((s) => !!(s as any).booker);
  }, [staffForSelectedPromo]);

  const wrestlerAnnouncersForSelectedPromo = useMemo(() => {
    if (!selected) return [];
    const pid = Number(selected.id ?? 0);
    return workers
      .filter((w) => {
        if (!workerWorksForPromo(w, pid) || !workerHasActiveContract(w)) return false;
        const ar = (w as any).announcerRaw;
        const at = (w as any).announcerTrait ?? (w as any).announcer;
        // Prefer strict raw flag when present; otherwise accept truthy trait.
        if (typeof ar === "number") return ar !== 0;
        if (typeof at === "boolean") return at;
        return true;
      })
      .sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? "")));
  }, [workers, selected]);

  // ---------- header ----------
  const headerTitle = selected ? `Editing: ${promoDisplayName(selected)}` : "Promotions";
  const fileStatus = rawBytes ? "promos.dat loaded" : "promos.dat not loaded";

  const selectedRecordLabel = selected
    ? `Record #${selected.recordIndex} — ${selected.initials?.trim() ? selected.initials.trim() : "(no initials)"}`
    : "—";

  // ---------- UI ----------
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
              title="Promotions"
              subtitle={workspaceRoot ? "Workspace linked" : "Workspace not linked"}
              loadFromData={{
                disabled: !canLoadFromData,
                title: !workspaceRoot
                  ? "Select a DATA folder first"
                  : !promosDataPath
                    ? "promos.dat not found in DATA folder"
                    : "Load promos.dat from DATA folder",
                onClick: onLoadFromData,
                label: "Load from DATA",
              }}              closeFile={{
                onClick: async () => {
                  if (!path && !promos.length) return;
                  if (dirty) {
                    const ok = window.confirm("You have unsaved changes. Save before closing?\n\nOK = Save, Cancel = Close without saving");
                    if (ok) {
                      await onSaveFile();
                      if (dirty) return;
                    }
                  }
                  setPath("");
                  setRawBytes(null);
                  setPromos([]);
                  setSelectedIdx(0);
                  setSearch("");
                  setDirty(false);
                  setStatus("Closed file.");
                },
                label: "Close File",
                disabled: !path && !promos.length,
                title: !path && !promos.length ? "No file loaded" : "Close promos.dat",
              }}
              saveFile={{
                disabled: !canSave,
                title: !canSave ? "Load promos.dat first" : "Save changes to promos.dat",
                onClick: onSaveFile,
                label: "Save File",
              }}
            />

            <div className="ewr-divider" />
          </div>

          <div className="ewr-leftMiddle ewr-scroll" style={{ overflowX: "hidden" }}>
            <div className="ewr-leftBody">
              <LeftPanelSearchHeader
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search (name / initials / record #)"
                sortValue={sortMode}
                onSortChange={(v) => setSortMode(v as SortMode)}
                sortOptions={[
                  { value: "record", label: "Sort: Record" },
                  { value: "name", label: "Sort: Name" },
                ]}
                showingCount={listItems.length}
                totalCount={promos.length}
                filtersOpen={filtersOpen}
                activeFilterCount={activeFilterCount}
                onToggleFilters={() => {
                  setDraftFilters(filters);
                  setFiltersOpen((v) => !v);
                }}
                onClearFilters={clearAllFilters}
                clearFiltersDisabled={activeFilterCount === 0}
              />

              {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
            </div>

            <div style={{ padding: "0 14px 14px" }}>
              {listItems.map((it) => {
                const isSelected = selectedIdx === it.arrayIndex;
                const checked = multiDeleteSelected.has(it.arrayIndex);

                return (
                  <LeftPanelNameCard
                    key={`${it.arrayIndex}-${it.recordIndex}`}
                    name={it.name}
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
                          aria-label={`Select ${it.name} for deletion`}
                        />
                      ) : null
                    }
                    onSelect={() => {
                      if (multiDeleteMode) {
                        toggleMultiDeleteSelection(it.arrayIndex);
                        return;
                      }
                      setSelectedIdx(it.arrayIndex);
                    }}
                    onCopy={() => copyPromotionAt(it.arrayIndex)}
                    onDelete={() => deletePromotionAt(it.arrayIndex)}
                    copyTitle={promos.length >= PROMOS_MAX ? `Copy (max ${PROMOS_MAX})` : "Copy promotion"}
                    deleteTitle="Delete promotion"
                    disableCopy={promos.length >= PROMOS_MAX}
                  />
                );
              })}

              {!promos.length ? <div className="ewr-muted" style={{ padding: "10px 4px" }}>Open promos.dat to begin.</div> : null}
            </div>
          </div>

          <LeftPanelActionGrid
            buttons={[
              {
                key: "add",
                label: "Add New Promotion",
                icon: <IconPlus className="btnSvg" />,
                onClick: () => addNewPromotion(),
                disabled: promos.length >= PROMOS_MAX,
                title: promos.length >= PROMOS_MAX ? `Limit reached (${PROMOS_MAX}).` : "Add a new promotion",
              },
              {
                key: "multi",
                label: multiDeleteMode
                  ? multiDeleteSelected.size > 0
                    ? `Delete Selected (${multiDeleteSelected.size})`
                    : "Cancel Multi-Delete"
                  : "Multi-Delete",
                icon: <IconChecklist className="btnSvg" />,
                style:
                  multiDeleteMode && multiDeleteSelected.size > 0
                    ? {
                        background: "rgba(255,70,70,0.18)",
                        border: "1px solid rgba(255,70,70,0.60)",
                      }
                    : undefined,
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
                  deleteSelectedPromotions();
                },
                disabled: !promos.length,
                title: !multiDeleteMode ? "Multi-delete promotions" : multiDeleteSelected.size ? "Delete selected" : "Cancel multi-delete",
              },
              {
                key: "import",
                label: "Import Promotion",
                icon: <IconImport className="btnSvg" />,
                onClick: () => onImportPromotions(),
                disabled: !promos.length || promos.length >= PROMOS_MAX,
                title: !promos.length ? "Load promos.dat first" : promos.length >= PROMOS_MAX ? `Limit reached (${PROMOS_MAX}).` : "Import from another promos.dat",
              },
              {
                key: "external",
                label: "External Editing",
                icon: <IconGrid className="btnSvg" />,
                className: "ewr-button ewr-buttonYellow",
                onClick: () => setExternalEditingOpen((v) => !v),
                disabled: !promos.length,
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
                      title="Select all visible promotions"
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
                      onClick={() => onExportPromosCsv()}
                      disabled={!promos.length}
                      title="Export promotions to CSV"
                    >
                      Export CSV
                    </button>

                    <button
                      type="button"
                      className="ewr-button ewr-buttonSmall"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={() => onImportPromosCsv()}
                      disabled={!promos.length}
                      title="Import promotions from CSV"
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
              title={headerTitle}
              leftPills={[
                "Category: Promotions",
                <>
                  Loaded: <b>{promos.length || 0}</b>
                </>,
                selected ? selectedRecordLabel : null,
              ]}
              rightPills={[fileStatus, linkedStatus ? linkedStatus : null, status ? status : null]}
            />
          }
        >
          {!selected ? (
            <div className="ewr-muted">Open promos.dat to begin.</div>
          ) : (
            <>
              <h2 className="ewr-h2">{selected.name || "(blank promotion)"}</h2>
              <div className="ewr-subtitle">
                Record #{selected.recordIndex} — Initials {selected.initials || "None"}
              </div>

              <div className="ewr-section ewr-workerPhotoSection">
                <div className="ewr-sectionHeader ewr-workerPhotoSectionHeader">
                  <div className="ewr-sectionTitle">Promotion Logo Details</div>
                  <div className="ewr-workerPhotoActions">
                    <button
                      type="button"
                      className="ewr-button ewr-buttonBlue"
                      onClick={async () => {
                        try {
                          const picked = await open({
                            directory: true,
                            multiple: false,
                            title: "Select EWR LOGOS folder",
                            defaultPath: effectiveLogosFolderPath || workspaceRoot || undefined,
                          });
                          if (!picked) return;
                          const dir = Array.isArray(picked) ? String(picked[0]) : String(picked);
                          setLogosFolderPath(dir);
                          setStatus(`LOGOS folder set: ${dir}`);
                        } catch (e: any) {
                          console.error(e);
                          setStatus(`Set LOGOS folder failed: ${e?.message ?? String(e)}`);
                        }
                      }}
                    >
                      Set LOGOS Folder
                    </button>
                    <button
                      type="button"
                      className="ewr-button ewr-buttonRed"
                      onClick={() => {
                        setLogosFolderPath("");
                        setStatus("Cleared LOGOS folder.");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-workerPhotoMeta ewr-hint" style={{ marginBottom: 14 }}>
                    <div>LOGOS folder: {effectiveLogosFolderPath ? effectiveLogosFolderPath : "Not set"}</div>
                    <div style={{ marginTop: 2 }}>
                      {logoPreviewStatus || (logoPreviewPath ? `Loaded: ${logoPreviewPath}` : "")}
                    </div>
                  </div>
                  <div className="ewr-workerPhotoLayout">
                    <div className="ewr-workerPhotoPreviewCol">
                      <div className="ewr-workerPhotoPreviewFrame">
                        {logoPreviewUrl ? (
                          <img
                            src={logoPreviewUrl}
                            alt={`${selected.name || "Promotion"} logo preview`}
                            className="ewr-workerPhotoPreviewImg"
                          />
                        ) : (
                          <div className="ewr-workerPhotoPreviewEmpty">No logo preview available.</div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ewr-button ewr-workerPhotoBrowseBtn"
                        onClick={async () => {
                          try {
                            const picked = await open({
                              multiple: false,
                              title: "Select promotion logo",
                              defaultPath: effectiveLogosFolderPath || workspaceRoot || undefined,
                              filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp"] }],
                            });
                            if (!picked) return;
                            const filePath = Array.isArray(picked) ? String(picked[0]) : String(picked);
                            const fileName = getBaseName(filePath);
                            const cleaned = sanitizeAndTruncateImageBase(stripImageExtension(fileName), 20);
                            if (!cleaned) {
                              setStatus("Selected logo file name is not valid for EWR.");
                              return;
                            }
                            setField("logoBase", cleaned as any);
                            const dir = getDirName(filePath);
                            if (dir) setLogosFolderPath(dir);
                            setStatus(`Logo set from selected image: ${cleaned}`);
                          } catch (e: any) {
                            console.error(e);
                            setStatus(`Browse logo failed: ${e?.message ?? String(e)}`);
                          }
                        }}
                      >
                        Browse…
                      </button>
                    </div>

                    <div className="ewr-workerPhotoMetaCol">
                      <div className="ewr-field">
                        <div className="ewr-label">Logo (base max 20 — .jpg appended)</div>
                        <input
                          className="ewr-input"
                          value={selected.logoBase}
                          maxLength={20}
                          onChange={(e) => setField("logoBase", sanitizeAndTruncateImageBase(stripImageExtension(e.target.value), 20) as any)}
                        />
                      </div>

                      <div className="ewr-hint" style={{ marginTop: 8 }}>
                        Base name only. If empty or “None”, native writes <b>None</b> (no .jpg). Otherwise “.jpg” is appended on save.
                      </div>

                      <div className="ewr-workerPhotoNameActions">
                        <button
                          type="button"
                          className="ewr-button"
                          onClick={() => setField("logoBase", sanitizeAndTruncateImageBase(`logo ${selected.initials || ""}`.trim(), 20) as any)}
                        >
                          Set to Logo Initials
                        </button>
                        <button
                          type="button"
                          className="ewr-button"
                          onClick={() => setField("logoBase", sanitizeAndTruncateImageBase(`logo_${selected.initials || ""}`.trim(), 20) as any)}
                        >
                          Set to Logo_Initials
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="ewr-section ewr-workerPhotoSection">
                <div className="ewr-sectionHeader ewr-workerPhotoSectionHeader">
                  <div className="ewr-sectionTitle">Promotion Banner Details</div>
                  <div className="ewr-workerPhotoActions">
                    <button
                      type="button"
                      className="ewr-button ewr-buttonBlue"
                      onClick={async () => {
                        try {
                          const picked = await open({
                            directory: true,
                            multiple: false,
                            title: "Select EWR Banners folder",
                            defaultPath: effectiveBannersFolderPath || workspaceRoot || undefined,
                          });
                          if (!picked) return;
                          const dir = Array.isArray(picked) ? String(picked[0]) : String(picked);
                          setBannersFolderPath(dir);
                          setStatus(`Banners folder set: ${dir}`);
                        } catch (e: any) {
                          console.error(e);
                          setStatus(`Set Banners folder failed: ${e?.message ?? String(e)}`);
                        }
                      }}
                    >
                      Set BANNERS Folder
                    </button>
                    <button
                      type="button"
                      className="ewr-button ewr-buttonRed"
                      onClick={() => {
                        setBannersFolderPath("");
                        setStatus("Cleared Banners folder.");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-workerPhotoMeta ewr-hint" style={{ marginBottom: 14 }}>
                    <div>Banners folder: {effectiveBannersFolderPath ? effectiveBannersFolderPath : "Not set"}</div>
                    <div style={{ marginTop: 2 }}>
                      {bannerPreviewStatus || (bannerPreviewPath ? `Loaded: ${bannerPreviewPath}` : "")}
                    </div>
                  </div>
                  <div className="ewr-workerPhotoPreviewFrame" style={{ width: 164, maxWidth: "100%", minHeight: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                    {bannerPreviewUrl ? (
                      <img
                        src={bannerPreviewUrl}
                        alt={`${selected.name || "Promotion"} banner preview`}
                        className="ewr-workerPhotoPreviewImg"
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    ) : (
                      <div className="ewr-workerPhotoPreviewEmpty">No banner preview available.</div>
                    )}
                  </div>
                  <div className="ewr-hint" style={{ marginBottom: 8 }}>
                    Stored as:{" "}
                    <span className="ewr-strong">
                      {(selected.bannerBase?.trim() || "None") +
                        (selected.bannerBase?.trim() && !/^none$/i.test(selected.bannerBase.trim()) ? ".jpg" : "")}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="ewr-button ewr-workerPhotoBrowseBtn"
                      onClick={async () => {
                        try {
                          const picked = await open({
                            multiple: false,
                            title: "Select promotion banner",
                            defaultPath: effectiveBannersFolderPath || workspaceRoot || undefined,
                            filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp"] }],
                          });
                          if (!picked) return;
                          const filePath = Array.isArray(picked) ? String(picked[0]) : String(picked);
                          const fileName = getBaseName(filePath);
                          const cleaned = sanitizeAndTruncateImageBase(stripImageExtension(fileName), 20);
                          if (!cleaned) {
                            setStatus("Selected banner file name is not valid for EWR.");
                            return;
                          }
                          setField("bannerBase", cleaned as any);
                          const dir = getDirName(filePath);
                          if (dir) setBannersFolderPath(dir);
                          setStatus(`Banner set from selected image: ${cleaned}`);
                        } catch (e: any) {
                          console.error(e);
                          setStatus(`Browse banner failed: ${e?.message ?? String(e)}`);
                        }
                      }}
                    >
                      Browse…
                    </button>
                    <button
                      type="button"
                      className="ewr-button"
                      onClick={() => setField("bannerBase", sanitizeAndTruncateImageBase(`banner ${selected.initials || ""}`.trim(), 20) as any)}
                    >
                      Set to Banner Initials
                    </button>
                    <button
                      type="button"
                      className="ewr-button"
                      onClick={() => setField("bannerBase", sanitizeAndTruncateImageBase(`banner_${selected.initials || ""}`.trim(), 20) as any)}
                    >
                      Set to Banner_Initials
                    </button>
                  </div>
                </div>
              </div>

              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Promotion Information</div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-grid ewr-gridAuto">
                    <div className="ewr-field">
                      <div className="ewr-label">Name (max 40)</div>
                      <input
                        className="ewr-input"
                        value={selected.name}
                        maxLength={40}
                        onChange={(e) => setField("name", e.target.value.slice(0, 40))}
                      />
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Initials (max 6)</div>
                      <input
                        className="ewr-input"
                        value={selected.initials}
                        maxLength={6}
                        onChange={(e) => setField("initials", e.target.value.slice(0, 6))}
                      />
                    </div>

                    <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div className="ewr-field" style={{ margin: 0 }}>
                          <div className="ewr-label">Size</div>
                          <EwrSelectCompat
                            className="ewr-input"
                            value={selected.size}
                            onChange={(e) => setField("size", Number(e.target.value) as any)}
                          >
                            {SIZE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </EwrSelectCompat>
                        </div>

                        <div className="ewr-field" style={{ margin: 0 }}>
                          <div className="ewr-label">Based In</div>
                          <EwrSelectCompat
                            className="ewr-input"
                            value={normalizeBasedIn(selected.basedIn)}
                            onChange={(e) => setField("basedIn", normalizeBasedIn(Number(e.target.value)) as any)}
                          >
                            {BASED_IN_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </EwrSelectCompat>
                          {Number(selected.basedIn) !== normalizeBasedIn(Number(selected.basedIn)) ? (
                            <div className="ewr-muted" style={{ marginTop: 6 }}>
                              Fixed invalid value to prevent corruption.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div className="ewr-field" style={{ margin: 0 }}>
                          <div className="ewr-label">Money ($0–$90,000,000)</div>
                          <input
                            className="ewr-input"
                            type="number"
                            value={selected.money}
                            min={0}
                            max={90_000_000}
                            step={1}
                            onChange={(e) => setField("money", clampInt(Number(e.target.value), 0, 90_000_000) as any)}
                            onBlur={() => {
                              const rounded = clampInt(roundUpTo100k(selected.money), 0, 90_000_000);
                              setField("money", rounded as any);
                            }}
                          />
                          <div className="ewr-muted" style={{ marginTop: 6 }}>
                            Rounded up to $100,000 increments
                          </div>
                        </div>

                        <div className="ewr-field" style={{ margin: 0 }}>
                          <div className="ewr-label">Image (0–100)</div>
                          <input
                            className="ewr-input"
                            type="number"
                            value={selected.image}
                            min={0}
                            max={100}
                            onChange={(e) => setField("image", clampInt(Number(e.target.value), 0, 100) as any)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              
              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Broadcast & Infrastructure</div>
                </div>

                <div className="ewr-sectionBody">
                  {/* Large Event Announcers */}
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      letterSpacing: 0.3,
                      opacity: 0.9,
                      marginBottom: 8,
                    }}
                  >
                    Large Event Announcers
                  </div>

                  <div className="ewr-grid ewr-gridAuto" style={{ marginTop: 0 }}>
                    <div className="ewr-field">
                      <div className="ewr-label">Announcer 1</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={selected.announcer1StaffId}
                        onChange={(e) =>
                          setField(
                            "announcer1StaffId",
                            clampInt(Number(e.target.value), 0, 65535) as any
                          )
                        }
                      >
                        <option value={0}>None</option>
                        {staffAnnouncersForSelectedPromo.map((s) => (
                          <option key={String((s as any).id ?? s.index)} value={Number((s as any).id ?? 0)}>
                            {s.name}
                          </option>
                        ))}
                      </EwrSelectCompat>
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Announcer 2</div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        {!selected.announcer2UseWrestler ? (
                          <EwrSelectCompat
                            className="ewr-input"
                            style={{ flex: 1 }}
                            value={selected.announcer2StaffId}
                            onChange={(e) =>
                              setField(
                                "announcer2StaffId",
                                clampInt(Number(e.target.value), 0, 65535) as any
                              )
                            }
                          >
                            <option value={0}>None</option>
                            {staffAnnouncersForSelectedPromo.map((s) => (
                              <option key={String((s as any).id ?? s.index)} value={Number((s as any).id ?? 0)}>
                                {s.name}
                              </option>
                            ))}
                          </EwrSelectCompat>
                        ) : (
                          <EwrSelectCompat
                            className="ewr-input"
                            style={{ flex: 1 }}
                            value={selected.announcer2WrestlerId}
                            onChange={(e) =>
                              setField(
                                "announcer2WrestlerId",
                                clampInt(Number(e.target.value), 0, 65535) as any
                              )
                            }
                          >
                            <option value={0}>None</option>
                            {wrestlerAnnouncersForSelectedPromo.map((w) => (
                              <option key={w.id} value={w.id}>
                                {String((w as any).fullName ?? "").trim() || `Worker #${w.id}`}
                              </option>
                            ))}
                          </EwrSelectCompat>
                        )}

                        <label style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                          <input
                            type="checkbox"
                            checked={!!selected.announcer2UseWrestler}
                            onChange={(e) => {
                              const on = !!e.target.checked;
                              setField("announcer2UseWrestler", on as any);
                              if (on) {
                                setField("announcer2StaffId", 0 as any);
                              } else {
                                setField("announcer2WrestlerId", 0 as any);
                              }
                            }}
                          />
                          Use Wrestler?
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Roster Split */}
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      letterSpacing: 0.3,
                      opacity: 0.9,
                      marginTop: 18,
                      marginBottom: 8,
                    }}
                  >
                    Roster Split
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="ewr-field" style={{ margin: 0 }}>
                        <div className="ewr-label">Split {i + 1}</div>
                        <input
                          className="ewr-input"
                          value={selected.rosterSplits[i as 0 | 1 | 2 | 3]}
                          maxLength={10}
                          onChange={(e) => setRosterSplit(i as any, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Settings */}
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      letterSpacing: 0.3,
                      opacity: 0.9,
                      marginTop: 18,
                      marginBottom: 8,
                    }}
                  >
                    Settings
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Risk (0–100)</div>
                      <input
                        className="ewr-input"
                        type="number"
                        value={selected.risk}
                        min={0}
                        max={100}
                        onChange={(e) => setField("risk", clampInt(Number(e.target.value), 0, 100) as any)}
                      />
                    </div>

                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Production (0–100)</div>
                      <input
                        className="ewr-input"
                        type="number"
                        value={selected.production}
                        min={0}
                        max={100}
                        onChange={(e) =>
                          setField("production", clampInt(Number(e.target.value), 0, 100) as any)
                        }
                      />
                    </div>

                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Advertising (0–100)</div>
                      <input
                        className="ewr-input"
                        type="number"
                        value={selected.advertising}
                        min={0}
                        max={100}
                        onChange={(e) =>
                          setField("advertising", clampInt(Number(e.target.value), 0, 100) as any)
                        }
                      />
                    </div>

                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Merchandising (0–100)</div>
                      <input
                        className="ewr-input"
                        type="number"
                        value={selected.merchandising}
                        min={0}
                        max={100}
                        onChange={(e) =>
                          setField("merchandising", clampInt(Number(e.target.value), 0, 100) as any)
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

<div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Development & Training</div>
                </div>
                <div className="ewr-sectionBody">
                  
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Development Territory (max 35)</div>
                      <input
                        className="ewr-input"
                        value={selected.devTerritory}
                        maxLength={35}
                        onChange={(e) => {
                          const v = e.target.value.slice(0, 35);
                          setField("devTerritory", v as any);
                          if (!v.trim()) setField("bookerStaffId", 0 as any);
                        }}
                      />
                    </div>

                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Booker (Staff)</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={selected.bookerStaffId}
                        disabled={!String(selected.devTerritory ?? "").trim()}
                        onChange={(e) => setField("bookerStaffId", clampInt(Number(e.target.value), 0, 65535) as any)}
                      >
                        <option value={0}>None</option>
                        {staffBookersForSelectedPromo.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </EwrSelectCompat>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Training Camp (max 35)</div>
                      <input
                        className="ewr-input"
                        value={selected.trainingCamp}
                        maxLength={35}
                        onChange={(e) => {
                          const v = e.target.value.slice(0, 35);
                          setField("trainingCamp", v as any);
                          if (!v.trim()) setField("headTrainerStaffId", 0 as any);
                        }}
                      />
                    </div>

                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Camp Facilities</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={selected.campFacilities}
                        disabled={!String(selected.trainingCamp ?? "").trim()}
                        onChange={(e) => setField("campFacilities", Number(e.target.value) as any)}
                      >
                        {CAMP_FAC_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </EwrSelectCompat>
                    </div>

                    <div className="ewr-field" style={{ margin: 0 }}>
                      <div className="ewr-label">Head Trainer (Staff)</div>
                      <EwrSelectCompat
                        className="ewr-input"
                        value={selected.headTrainerStaffId}
                        disabled={!String(selected.trainingCamp ?? "").trim()}
                        onChange={(e) => setField("headTrainerStaffId", clampInt(Number(e.target.value), 0, 65535) as any)}
                      >
                        <option value={0}>None</option>
                        {staffTrainersForSelectedPromo.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </EwrSelectCompat>
                    </div>
                  </div>

                </div>
              </div>

              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Championships</div>
                </div>
                <div className="ewr-sectionBody">
                  {selectedPromoChampionships.length === 0 ? (
                    <div className="ewr-muted">No titles owned by this promotion were found in belt.dat.</div>
                  ) : (
                    <div className="ewr-tagTeamsTable ewr-championshipsTable" role="table" aria-label="Promotion Championships">
                      <div className="ewr-tagTeamsRow ewr-tagTeamsHeader ewr-championshipsRow" role="row">
                        <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="columnheader">Belt Name</div>
                        <div className="ewr-tagTeamsCell" role="columnheader">Image</div>
                        <div className="ewr-tagTeamsCell" role="columnheader">Holder(s)</div>
                      </div>
                      {selectedPromoChampionships.map((belt) => (
                        <div key={belt.key} className="ewr-tagTeamsRow ewr-championshipsRow" role="row">
                          <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="cell">{belt.title}</div>
                          <div className="ewr-tagTeamsCell" role="cell">
                            <span className="ewr-mono">{belt.image}</span>
                          </div>
                          <div className="ewr-tagTeamsCell" role="cell">{belt.holderText}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Events</div>
                </div>
                <div className="ewr-sectionBody">
                  {selectedPromoEvents.length === 0 ? (
                    <div className="ewr-muted">No events for this promotion were found in event.dat.</div>
                  ) : (
                    <div className="ewr-tagTeamsTable ewr-championshipsTable" role="table" aria-label="Promotion Events">
                      <div className="ewr-tagTeamsRow ewr-tagTeamsHeader ewr-championshipsRow" role="row">
                        <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="columnheader">Event Name</div>
                        <div className="ewr-tagTeamsCell" role="columnheader">Month</div>
                        <div className="ewr-tagTeamsCell" role="columnheader">Type of Show</div>
                      </div>
                      {selectedPromoEvents.map((eventRow) => (
                        <div key={eventRow.key} className="ewr-tagTeamsRow ewr-championshipsRow" role="row">
                          <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="cell">{eventRow.name}</div>
                          <div className="ewr-tagTeamsCell" role="cell">{eventRow.monthLabel}</div>
                          <div className="ewr-tagTeamsCell" role="cell">{eventRow.showTypeLabel}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Television Shows</div>
                </div>
                <div className="ewr-sectionBody">
                  {selectedPromoTelevisionShows.length === 0 ? (
                    <div className="ewr-muted">No television shows for this promotion were found in tv.dat.</div>
                  ) : (
                    <div className="ewr-tagTeamsTable ewr-championshipsTable" role="table" aria-label="Promotion Television Shows">
                      <div
                        className="ewr-tagTeamsRow ewr-tagTeamsHeader ewr-championshipsRow"
                        role="row"
                        style={{ gridTemplateColumns: "minmax(0, 1.8fr) minmax(120px, 0.7fr) minmax(180px, 1fr) minmax(160px, 0.9fr)" }}
                      >
                        <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="columnheader">Show Name</div>
                        <div className="ewr-tagTeamsCell" role="columnheader">Day</div>
                        <div className="ewr-tagTeamsCell" role="columnheader">Network</div>
                        <div className="ewr-tagTeamsCell" role="columnheader">Time Slot</div>
                      </div>
                      {selectedPromoTelevisionShows.map((showRow) => (
                        <div
                          key={showRow.key}
                          className="ewr-tagTeamsRow ewr-championshipsRow"
                          role="row"
                          style={{ gridTemplateColumns: "minmax(0, 1.8fr) minmax(120px, 0.7fr) minmax(180px, 1fr) minmax(160px, 0.9fr)" }}
                        >
                          <div className="ewr-tagTeamsCell ewr-tagTeamsCell--name" role="cell">{showRow.name}</div>
                          <div className="ewr-tagTeamsCell" role="cell">{showRow.dayLabel}</div>
                          <div className="ewr-tagTeamsCell" role="cell">{showRow.networkLabel}</div>
                          <div className="ewr-tagTeamsCell" role="cell">{showRow.timeSlotLabel}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </RightPanelShell>
      </div>

      {/* IMPORT MODAL */}
      {importModalOpen
        ? createPortal(
            <div className="ewr-modalOverlay" onMouseDown={closeImportModal} role="dialog" aria-modal="true">
              <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="ewr-modalHeader">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div className="ewr-modalTitle">Import Promotions</div>
                    <div className="ewr-modalSub">
                      Source: <span className="ewr-mono">{importSourcePath ? safeFilename(importSourcePath) : ""}</span>
                    </div>
                  </div>

                  <button type="button" className="ewr-iconBtn" title="Close" onClick={closeImportModal} aria-label="Close">
                    ×
                  </button>
                </div>

                <div className="ewr-modalBody">
                  <div className="ewr-hint" style={{ marginBottom: 10 }}>
                    {importInfo}
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      className="ewr-input"
                      placeholder="Filter promotions by name…"
                      value={importSearch}
                      onChange={(e) => setImportSearch(e.target.value)}
                      style={{ flex: 1 }}
                    />

                    <button
                      type="button"
                      className="ewr-button ewr-buttonSmall"
                      onClick={() => setImportSelection(new Set(importFilteredPromos.map((p) => p.recordIndex)))}
                      disabled={!importFilteredPromos.length}
                    >
                      Select All
                    </button>

                    <button
                      type="button"
                      className="ewr-button ewr-buttonSmall"
                      onClick={() => {
                        setImportSelection(new Set());
                      }}
                      disabled={!importSelection.size}
                    >
                      Select None
                    </button>
                  </div>

                  
                  <div className="ewr-modalList">
                    {importFilteredPromos.map((p: any) => {
                      const name = promoDisplayName(p).trim() || "(blank)";
                      const checked = importSelection.has(p.recordIndex);
                      const importable = !!p.__importable;
                      const reason = String(p.__importReason || "");
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
                          };

                      return (
                        <label key={String(p.recordIndex)} className="ewr-importRow" style={{ opacity: disabled ? 0.55 : 1 }}>
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={checked}
                            onChange={(e) => toggleImportSelection(p.recordIndex, e.target.checked, disabled)}
                          />
                          <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {name}
                              </span>
                              <span style={badgeStyle}>{badgeLabel}</span>
                            </span>

                            <span className="ewr-muted" style={{ marginTop: 2 }}>
                              Initials: <span className="ewr-mono">{String(p.initials ?? "").trim() || "—"}</span> · Source Record #{p.recordIndex}
                            </span>

                            {disabled && reason ? <span className="ewr-muted">{reason}</span> : null}
                          </span>
                        </label>
                      );
                    })}

                    {!importFilteredPromos.length ? (
                      <div className="ewr-muted" style={{ padding: 10 }}>
                        No promotions match this filter.
                      </div>
                    ) : null}
                  </div>


                  <div className="ewr-modalFooter">
                    <button type="button" className="ewr-button" onClick={closeImportModal}>
                      Cancel
                    </button>

                    <button type="button" className="ewr-button ewr-buttonGreen" onClick={commitImportSelected}>
                      Import Selected ({importSelection.size})
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
