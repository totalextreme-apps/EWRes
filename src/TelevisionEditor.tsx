import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {copyFile, exists, readFile, writeFile, mkdir} from "@tauri-apps/plugin-fs";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";
import { EditorHeader } from "./components/rightpanel/EditorHeader";
import { IconChecklist, IconGrid, IconImport, IconPlus } from "./components/icons/EwrIcons";

import { parseTvDat, type TelevisionRecord, type TvTimeSlot } from "./ewr/parseTvDat";
import { validateTvDatBytes } from "./ewr/validateTvDat";
import { writeTvDat } from "./ewr/writeTvDat";
import { parsePromosDat, type Promo } from "./ewr/parsePromosDat";
import { parseNetworkDat, type NetworkRecord } from "./ewr/parseNetworkDat";
import { parseStaffDat, type Staff } from "./ewr/parseStaffDat";
import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { toArrayBuffer } from "./ewr/toArrayBuffer";
import EwrSelectCompat from "./components/inputs/EwrSelectCompat";

function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type Props = {
  workspaceRoot: string;
  tvDataPath?: string;
  promosDataPath?: string;
  networkDataPath?: string;
  staffDataPath?: string;
  wrestlerDataPath?: string;
};

type SortKey = "record" | "name";
type DayName = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
type LookupOption = { id: number; name: string };
type CsvRecord = Record<string, string>;

type ImportTvRow = {
  sourceIndex: number;
  name: string;
  record: TelevisionRecord;
  duplicateName: boolean;
  duplicateInSource: boolean;
  blankName: boolean;
  missingPromotion: boolean;
};


type TelevisionFilters = {
  day: string;
  timeSlot: string;
  promotion: string;
  announcer1: string;
  announcer2: string;
};

const DAY_OPTIONS: DayName[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_SLOT_OPTIONS: { value: TvTimeSlot; label: string }[] = [
  { value: "E", label: "Early Evening" },
  { value: "P", label: "Prime Time" },
  { value: "L", label: "Late Night" },
  { value: "G", label: "Graveyard" },
];

const TV_CSV_HEADERS = [
  "Record #",
  "Show Name",
  "Promotion",
  "Day",
  "Network",
  "Time Slot",
  "Announcer 1",
  "Use Wrestler?",
  "Announcer 2",
] as const;

const EMPTY_FILTERS: TelevisionFilters = {
  day: "",
  timeSlot: "",
  promotion: "",
  announcer1: "",
  announcer2: "",
};

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function truncateUiName(s: string) {
  const value = String(s ?? "");
  return value.length <= 32 ? value : value.slice(0, 32);
}

function normalizeName(s: string) {
  return String(s ?? "").trim().toLowerCase();
}

function workerWorksForPromo(worker: any, promoId: number): boolean {
  const e1 = Number(worker?.employer1PromoId ?? 0) | 0;
  const e2 = Number(worker?.employer2PromoId ?? 0) | 0;
  const e3 = Number(worker?.employer3PromoId ?? 0) | 0;
  return e1 === promoId || e2 === promoId || e3 === promoId;
}

function workerHasActiveContract(worker: any): boolean {
  const code = String(worker?.contractCode ?? "").trim();
  return !!code;
}

function workerHasAnnouncerTrait(worker: Worker): boolean {
  const raw = (worker as any).announcerRaw;
  const trait = (worker as any).announcerTrait ?? (worker as any).announcer;
  if (typeof raw === "number") return raw !== 0;
  if (typeof trait === "boolean") return trait;
  return true;
}

function createBlankTelevision(index: number, existingNames: string[]): TelevisionRecord {
  const raw = new Uint8Array(51);
  raw[0] = 52;
  const name = makeUniqueShowName("New Show", existingNames);
  return {
    index,
    name,
    promotionId: 0,
    day: "Monday",
    timeSlot: "E",
    networkId: 0,
    contractLengthWeeks: 0,
    announcer1StaffId: 0,
    announcer2StaffId: 0,
    announcer2WrestlerId: 0,
    announcer2UseWrestler: false,
    _raw: raw,
  };
}

function makeUniqueShowName(baseName: string, existingNames: string[]) {
  const base = truncateUiName(String(baseName ?? "").trim() || "New Show");
  const taken = new Set(existingNames.map((name) => normalizeName(name)));
  if (!taken.has(normalizeName(base))) return base;

  let suffix = 2;
  while (suffix < 1000) {
    const suffixText = ` ${suffix}`;
    const head = base.slice(0, Math.max(0, 32 - suffixText.length));
    const candidate = `${head}${suffixText}`;
    if (!taken.has(normalizeName(candidate))) return candidate;
    suffix += 1;
  }

  return base.slice(0, 32);
}

function makeCopiedShowName(sourceName: string, existingNames: string[]) {
  const baseSource = String(sourceName ?? "").trim() || "Show";
  const base = truncateUiName(baseSource);
  const taken = new Set(existingNames.map((name) => normalizeName(name)));

  let suffix = 1;
  while (suffix < 1000) {
    const suffixText = ` (${suffix})`;
    const head = base.slice(0, Math.max(0, 32 - suffixText.length));
    const candidate = `${head}${suffixText}`;
    if (!taken.has(normalizeName(candidate))) return candidate;
    suffix += 1;
  }

  return base.slice(0, 32);
}

function timeSlotLabel(value: TvTimeSlot) {
  return TIME_SLOT_OPTIONS.find((opt) => opt.value === value)?.label ?? "Early Evening";
}

function promotionNameById(list: Promo[], id: number) {
  return list.find((item) => Number(item.id) === Number(id))?.name ?? "None";
}

function promotionInitialsById(list: Promo[], id: number) {
  const promo = list.find((item) => Number(item.id) === Number(id));
  return String((promo as any)?.shortName ?? (promo as any)?.initials ?? "").trim() || "None";
}

function networkNameById(list: NetworkRecord[], id: number) {
  return list.find((item) => Number(item.networkId) === Number(id))?.name ?? "None";
}

function csvEscape(value: any): string {
  const s = String(value ?? "");
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
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
    } else if (ch === ',') {
      out.push(cur);
      cur = "";
    } else if (ch === '"') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): { headers: string[]; rows: CsvRecord[] } {
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((cell) => cell.trim());
  const rows: CsvRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: CsvRecord = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function parseIntOrNull(value: any): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function yesNoToBool(value: string): boolean | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return null;
}

function boolToYesNo(value: boolean): "Yes" | "No" {
  return value ? "Yes" : "No";
}

function parseTvTimeSlot(value: string): TvTimeSlot | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "e" || normalized === "early evening") return "E";
  if (normalized === "p" || normalized === "prime time") return "P";
  if (normalized === "l" || normalized === "late night") return "L";
  if (normalized === "g" || normalized === "graveyard") return "G";
  return null;
}

function normalizeWorkerName(worker: Worker) {
  return normalizeName(String((worker as any).fullName ?? "").trim());
}

export default function TelevisionEditor(props: Props) {
  const [status, setStatus] = useState("");
  const [filePath, setFilePath] = useState(props.tvDataPath ?? "");
  const [dirty, setDirty] = useState(false);

  const [shows, setShows] = useState<TelevisionRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<TelevisionFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<TelevisionFilters>(EMPTY_FILTERS);
  const [multiDeleteMode, setMultiDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState("");
  const [importInfo, setImportInfo] = useState("");
  const [importSearch, setImportSearch] = useState("");
  const [importRows, setImportRows] = useState<ImportTvRow[]>([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());
  const [externalEditingOpen, setExternalEditingOpen] = useState(false);
  const [isSaveWorkspace, setIsSaveWorkspace] = useState(false);

  const [promos, setPromos] = useState<Promo[]>([]);
  const [networks, setNetworks] = useState<NetworkRecord[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);

  const selectedShow = shows[selectedIndex] ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const root = String(props.workspaceRoot ?? "").trim();
      if (!root) {
        if (!cancelled) setIsSaveWorkspace(false);
        return;
      }
      try {
        const hasGameInfo = await exists(`${root}/gameinfo.dat`);
        if (!cancelled) setIsSaveWorkspace(!!hasGameInfo);
      } catch {
        if (!cancelled) setIsSaveWorkspace(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.workspaceRoot]);

  async function ensureBakOnce(path: string) {
    const bak = buildEwresBackupPath(path);
    const bakDir = bak.slice(0, bak.lastIndexOf("/"));
    await mkdir(bakDir, { recursive: true });
    if (!(await exists(bak))) await copyFile(path, bak);
  }

  async function loadLookups() {
    try {
      if (props.promosDataPath && await exists(props.promosDataPath)) {
        const bytes = await readFile(props.promosDataPath);
        setPromos(parsePromosDat(bytes).promos);
      } else {
        setPromos([]);
      }
    } catch {
      setPromos([]);
    }

    try {
      if (props.networkDataPath && await exists(props.networkDataPath)) {
        const bytes = await readFile(props.networkDataPath);
        setNetworks(parseNetworkDat(bytes).networks);
      } else {
        setNetworks([]);
      }
    } catch {
      setNetworks([]);
    }

    try {
      if (props.staffDataPath && await exists(props.staffDataPath)) {
        const bytes = await readFile(props.staffDataPath);
        setStaff(parseStaffDat(bytes).staff);
      } else {
        setStaff([]);
      }
    } catch {
      setStaff([]);
    }

    try {
      if (props.wrestlerDataPath && await exists(props.wrestlerDataPath)) {
        const bytes = await readFile(props.wrestlerDataPath);
        setWorkers(parseWrestlerDat(toArrayBuffer(bytes)));
      } else {
        setWorkers([]);
      }
    } catch {
      setWorkers([]);
    }
  }

  async function openTvFromPath(path: string) {
    setStatus("");
    try {
      const bytes = await readFile(path);
      validateTvDatBytes(bytes);
      const parsed = parseTvDat(bytes);
      setFilePath(path);
      setShows(parsed.television);
      setSelectedIndex(0);
      setDirty(false);
      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
      await loadLookups();
    } catch (e: any) {
      console.error(e);
      setStatus(`Load failed: ${e?.message || e}`);
    }
  }

  useEffect(() => {
    if (props.tvDataPath && props.tvDataPath !== filePath) {
      openTvFromPath(props.tvDataPath);
    }
  }, [props.tvDataPath]);

  useEffect(() => {
    loadLookups();
  }, [props.promosDataPath, props.networkDataPath, props.staffDataPath, props.wrestlerDataPath]);

  async function handleLoadFromData() {
    if (props.tvDataPath) return openTvFromPath(props.tvDataPath);
    const picked = await open({
      multiple: false,
      filters: [{ name: "DAT files", extensions: ["dat"] }],
    });
    if (typeof picked === "string") await openTvFromPath(picked);
  }

  function handleCloseFile() {
    setFilePath("");
    setShows([]);
    setSelectedIndex(0);
    setDirty(false);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());
    setExternalEditingOpen(false);
    setStatus("Closed tv.dat");
  }

  async function handleSave() {
    if (!filePath) {
      setStatus("No tv.dat file is open.");
      return;
    }
    try {
      const normalized = shows.map((record, index) => ({ ...record, index }));
      const out = writeTvDat(normalized);
      await ensureBakOnce(filePath);
      await writeFile(filePath, out);
      setShows(normalized);
      setDirty(false);
      setStatus(`Saved: ${normalized.length} television shows`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Save failed: ${e?.message || e}`);
    }
  }

  function patchSelected(mutator: (record: TelevisionRecord) => TelevisionRecord) {
    setShows((prev) => {
      if (!prev[selectedIndex]) return prev;
      const next = prev.slice();
      next[selectedIndex] = mutator({ ...next[selectedIndex] });
      return next;
    });
    setDirty(true);
  }

  function patchSelectedField<K extends keyof TelevisionRecord>(key: K, value: TelevisionRecord[K]) {
    patchSelected((record) => ({ ...record, [key]: value }));
  }

  function handleCopyShow(recordIndex: number) {
    setShows((prev) => {
      const source = prev.find((record) => record.index === recordIndex);
      if (!source) return prev;
      const copied: TelevisionRecord = {
        ...source,
        index: prev.length,
        name: makeCopiedShowName(source.name, prev.map((record) => record.name)),
        _raw: new Uint8Array(source._raw ?? 51),
      };
      const next = [...prev, copied];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setDirty(true);
    setStatus("Copied television show.");
  }

  function deleteShowByIndex(index: number) {
    setShows((prev) => {
      const next = prev.filter((record) => record.index !== index).map((record, newIndex) => ({ ...record, index: newIndex }));
      setSelectedIndex((current) => clamp(current >= next.length ? next.length - 1 : current, 0, Math.max(next.length - 1, 0)));
      return next;
    });
    setSelectedForDelete((prev) => {
      const next = new Set<number>();
      Array.from(prev).forEach((value) => {
        if (value === index) return;
        next.add(value > index ? value - 1 : value);
      });
      return next;
    });
    setDirty(true);
  }

  function handleAddNew() {
    setShows((prev) => {
      const next = [...prev, createBlankTelevision(prev.length, prev.map((item) => item.name))];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setDirty(true);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());
  }


  function closeImportModal() {
    setImportModalOpen(false);
    setImportSourcePath("");
    setImportInfo("");
    setImportSearch("");
    setImportRows([]);
    setImportSelection(new Set());
  }

  function toggleImportSelection(sourceIndex: number, checked: boolean) {
    setImportSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceIndex);
      else next.delete(sourceIndex);
      return next;
    });
  }

  async function handleImportTvShow() {
    if (!shows.length) {
      setStatus("Load tv.dat first.");
      return;
    }

    try {
      const picked = await open({
        title: "Import from another tv.dat",
        multiple: false,
        filters: [{ name: "EWR tv.dat", extensions: ["dat"] }],
      });
      if (!picked) return;
      const sourcePath = Array.isArray(picked) ? picked[0] : picked;
      const bytes = await readFile(sourcePath);
      validateTvDatBytes(bytes);
      const parsed = parseTvDat(bytes);

      const seenInSource = new Set<string>();
      const existingNames = new Set(shows.map((record) => normalizeName(record.name)));
      const promoIds = new Set(promos.map((promo) => Number(promo.id)));

      const rows: ImportTvRow[] = parsed.television.map((record, idx) => {
        const name = truncateUiName(String(record.name ?? "").trim());
        const normalized = normalizeName(name);
        const blankName = !normalized;
        const duplicateInSource = !!normalized && seenInSource.has(normalized);
        const duplicateExisting = !!normalized && existingNames.has(normalized);
        const duplicateName = blankName || duplicateExisting || duplicateInSource;
        if (normalized) seenInSource.add(normalized);

        return {
          sourceIndex: idx,
          name,
          record: { ...record, name },
          duplicateName,
          duplicateInSource,
          blankName,
          missingPromotion: !promoIds.has(Number(record.promotionId)),
        };
      });

      const importable = rows.filter((row) => !row.duplicateName && !row.missingPromotion).length;
      setImportSourcePath(sourcePath);
      setImportRows(rows);
      setImportSelection(new Set(rows.filter((row) => !row.duplicateName && !row.missingPromotion).map((row) => row.sourceIndex)));
      setImportInfo(`Loaded ${rows.length} TV shows from source. ${importable} can be imported.`);
      setImportSearch("");
      setImportModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import failed: ${e?.message ?? String(e)}`);
    }
  }

  function commitImportedTvShows() {
    const selectedRows = importRows.filter((row) => importSelection.has(row.sourceIndex) && !row.duplicateName && !row.missingPromotion);
    if (!selectedRows.length) {
      setStatus("No importable TV shows selected.");
      return;
    }

    setShows((prev) => {
      const next = prev.slice();
      const existingNames = new Set(prev.map((record) => normalizeName(record.name)));
      const networkIds = new Set(networks.map((network) => Number(network.networkId)));
      const firstNetworkId = networks.length ? Number(networks[0].networkId) : 0;
      const staffIds = new Set(staff.map((item) => Number(item.id)));
      const wrestlerIds = new Set(workers.map((item) => Number(item.id)));

      for (const row of selectedRows) {
        const normalized = normalizeName(row.name);
        if (!normalized || existingNames.has(normalized)) continue;
        existingNames.add(normalized);

        const useWrestler = !!row.record.announcer2UseWrestler;
        const announcer1StaffId = staffIds.has(Number(row.record.announcer1StaffId)) ? Number(row.record.announcer1StaffId) : 0;
        const announcer2StaffId = !useWrestler && staffIds.has(Number(row.record.announcer2StaffId)) ? Number(row.record.announcer2StaffId) : 0;
        const announcer2WrestlerId = useWrestler && wrestlerIds.has(Number(row.record.announcer2WrestlerId)) ? Number(row.record.announcer2WrestlerId) : 0;

        next.push({
          ...row.record,
          index: next.length,
          name: row.name,
          networkId: networkIds.has(Number(row.record.networkId)) ? Number(row.record.networkId) : firstNetworkId,
          announcer1StaffId,
          announcer2StaffId,
          announcer2WrestlerId,
          _raw: row.record._raw ? new Uint8Array(row.record._raw) : new Uint8Array(51),
        });
      }

      setSelectedIndex(next.length ? next.length - 1 : 0);
      return next.map((record, index) => ({ ...record, index }));
    });

    setDirty(true);
    setStatus(`Imported ${selectedRows.length} TV shows. Click Save to write to disk.`);
    closeImportModal();
  }

  async function handleExportTelevisionCsv() {
    try {
      if (!shows.length) {
        setStatus("Load tv.dat first.");
        return;
      }
      const defaultName = filePath ? filePath.replace(/\.dat$/i, ".csv") : "tv.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const lines: string[] = [];
      lines.push(TV_CSV_HEADERS.map(csvEscape).join(","));
      const sorted = [...shows].sort((a, b) => Number(a.index) - Number(b.index));
      for (const record of sorted) {
        const ann1 = staff.find((item) => Number(item.id) === Number(record.announcer1StaffId))?.name ?? "";
        const ann2 = record.announcer2UseWrestler
          ? (workers.find((item) => Number(item.id) === Number(record.announcer2WrestlerId)) as any)?.fullName ?? ""
          : staff.find((item) => Number(item.id) === Number(record.announcer2StaffId))?.name ?? "";
        lines.push([
          Number(record.index ?? 0),
          truncateUiName(String(record.name ?? "")),
          promotionNameById(promos, record.promotionId),
          String(record.day ?? "Monday"),
          networkNameById(networks, record.networkId),
          timeSlotLabel(record.timeSlot),
          ann1,
          boolToYesNo(Boolean(record.announcer2UseWrestler)),
          ann2,
        ].map(csvEscape).join(","));
      }

      await writeFile(outPath, new TextEncoder().encode("\ufeff" + lines.join("\n")));
      setExternalEditingOpen(false);
      setStatus(`Exported CSV: ${outPath}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function handleImportTelevisionCsv() {
    try {
      if (!shows.length) {
        setStatus("Load tv.dat first.");
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
      const parsed = parseCsv(new TextDecoder().decode(bytes));
      const actual = parsed.headers.map((header) => String(header ?? "").trim());
      const missing = TV_CSV_HEADERS.filter((header) => !actual.includes(header));
      if (missing.length) {
        setStatus(`CSV header mismatch. Missing: ${missing.join(", ")}`);
        setExternalEditingOpen(false);
        return;
      }

      const nextList = shows.map((record) => ({ ...record, _raw: new Uint8Array(record._raw ?? 51) }));
      const normalizedNameToIndex = new Map<string, number>();
      for (let i = 0; i < nextList.length; i++) {
        const normalized = normalizeName(nextList[i].name);
        if (normalized) normalizedNameToIndex.set(normalized, i);
      }

      const promoNameToId = new Map<string, number>();
      promos.forEach((promo) => {
        const normalized = normalizeName(promo.name);
        if (normalized) promoNameToId.set(normalized, Number(promo.id));
      });
      const networkNameToId = new Map<string, number>();
      networks.forEach((network) => {
        const normalized = normalizeName(network.name);
        if (normalized) networkNameToId.set(normalized, Number(network.networkId));
      });
      const staffNameToId = new Map<string, number>();
      staff.forEach((item) => {
        const normalized = normalizeName(item.name);
        if (normalized && !staffNameToId.has(normalized)) staffNameToId.set(normalized, Number(item.id));
      });
      const workerNameToId = new Map<string, number>();
      workers.forEach((item) => {
        const normalized = normalizeWorkerName(item);
        if (normalized && !workerNameToId.has(normalized)) workerNameToId.set(normalized, Number(item.id));
      });

      const firstNetworkId = networks.length ? Number(networks[0].networkId) : 0;
      let updated = 0;
      let added = 0;
      let skipped = 0;

      for (const row of parsed.rows) {
        const recNo = parseIntOrNull(row["Record #"]);
        const name = truncateUiName(String(row["Show Name"] ?? "").trim());
        const normalized = normalizeName(name);
        if (!normalized) {
          skipped++;
          continue;
        }

        const promotionId = promoNameToId.get(normalizeName(row["Promotion"]));
        if (!promotionId) {
          skipped++;
          continue;
        }

        const dayRaw = String(row["Day"] ?? "").trim();
        const day = DAY_OPTIONS.find((option) => normalizeName(option) === normalizeName(dayRaw)) ?? "Monday";
        const timeSlot = parseTvTimeSlot(String(row["Time Slot"] ?? "")) ?? "E";
        const networkId = networkNameToId.get(normalizeName(row["Network"])) ?? firstNetworkId;
        const useWrestler = yesNoToBool(String(row["Use Wrestler?"] ?? "")) ?? false;
        const announcer1StaffId = staffNameToId.get(normalizeName(row["Announcer 1"])) ?? 0;
        const announcer2StaffId = useWrestler ? 0 : (staffNameToId.get(normalizeName(row["Announcer 2"])) ?? 0);
        const announcer2WrestlerId = useWrestler ? (workerNameToId.get(normalizeName(row["Announcer 2"])) ?? 0) : 0;

        const existingNameIndex = normalizedNameToIndex.get(normalized);
        if (recNo !== null && recNo >= 0 && recNo < nextList.length) {
          if (existingNameIndex !== undefined && existingNameIndex != recNo) {
            skipped++;
            continue;
          }
          const current = nextList[recNo];
          const oldNormalized = normalizeName(current.name);
          if (oldNormalized && normalizedNameToIndex.get(oldNormalized) === recNo) {
            normalizedNameToIndex.delete(oldNormalized);
          }
          nextList[recNo] = {
            ...current,
            name,
            promotionId,
            day,
            networkId,
            timeSlot,
            announcer1StaffId,
            announcer2UseWrestler: useWrestler,
            announcer2StaffId,
            announcer2WrestlerId,
          };
          normalizedNameToIndex.set(normalized, recNo);
          updated++;
        } else {
          if (existingNameIndex !== undefined) {
            skipped++;
            continue;
          }
          nextList.push({
            index: nextList.length,
            name,
            promotionId,
            day,
            networkId,
            contractLengthWeeks: 0,
            timeSlot,
            announcer1StaffId,
            announcer2UseWrestler: useWrestler,
            announcer2StaffId,
            announcer2WrestlerId,
            _raw: new Uint8Array(51),
          });
          normalizedNameToIndex.set(normalized, nextList.length - 1);
          added++;
        }
      }

      const finalList = nextList.map((record, index) => ({ ...record, index }));
      setShows(finalList);
      setSelectedIndex(finalList.length ? Math.min(selectedIndex, finalList.length - 1) : 0);
      if (updated || added) {
        setDirty(true);
        setStatus(`Imported CSV. Updated: ${updated}. Added: ${added}. Skipped: ${skipped}. Click Save to write to disk.`);
      } else {
        setStatus(`No changes applied from CSV. Skipped: ${skipped}.`);
      }
      setExternalEditingOpen(false);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  function handleExternalEditing() {
    setExternalEditingOpen((prev) => !prev);
  }

  function toggleMultiDeleteMode() {
    setMultiDeleteMode((prev) => !prev);
    setSelectedForDelete(new Set());
  }

  function toggleSelectedForDelete(index: number, checked: boolean) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function commitMultiDelete() {
    if (!selectedForDelete.size) {
      setMultiDeleteMode(false);
      return;
    }
    setShows((prev) => prev.filter((record) => !selectedForDelete.has(record.index)).map((record, index) => ({ ...record, index })));
    setSelectedIndex(0);
    setSelectedForDelete(new Set());
    setMultiDeleteMode(false);
    setDirty(true);
  }

  function clearAllFilters() {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
  }

  const activeFilterCount = Object.values(filters)
    .filter((value) => String(value).trim() !== "").length;

  const filteredShows = useMemo(() => {
    const q = normalizeName(search);
    const next = shows.filter((record) => {
      const promoName = promotionNameById(promos, record.promotionId);
      const networkName = networkNameById(networks, record.networkId);

      if (q) {
        const matchesSearch = [record.name, record.day, promoName, networkName, timeSlotLabel(record.timeSlot)]
          .some((value) => normalizeName(value).includes(q));
        if (!matchesSearch) return false;
      }

      if (filters.day && record.day !== filters.day) return false;
      if (filters.timeSlot && record.timeSlot !== filters.timeSlot) return false;
      if (filters.promotion && String(record.promotionId) !== filters.promotion) return false;
      if (filters.announcer1 === "none" && Number(record.announcer1StaffId || 0) !== 0) return false;
      const announcer2Filled = record.announcer2UseWrestler
        ? Number(record.announcer2WrestlerId || 0) !== 0
        : Number(record.announcer2StaffId || 0) !== 0;
      if (filters.announcer2 === "none" && announcer2Filled) return false;

      return true;
    });

    next.sort((a, b) => {
      if (sortKey === "name") {
        return a.name.localeCompare(b.name) || a.index - b.index;
      }
      return a.index - b.index || a.name.localeCompare(b.name);
    });

    return next;
  }, [
    shows, promos, networks, search, sortKey, filters,
  ]);

  function renderFilterPanel(onClose: () => void) {
    return (
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
            <div className="ewr-label">Day</div>
            <EwrSelectCompat className="ewr-input" value={draftFilters.day} onChange={(e) => setDraftFilters((p) => ({ ...p, day: e.target.value }))}>
              <option value="">Any</option>
              {DAY_OPTIONS.map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </EwrSelectCompat>
          </div>

          <div className="ewr-field">
            <div className="ewr-label">Time Slot</div>
            <EwrSelectCompat className="ewr-input" value={draftFilters.timeSlot} onChange={(e) => setDraftFilters((p) => ({ ...p, timeSlot: e.target.value }))}>
              <option value="">Any</option>
              {TIME_SLOT_OPTIONS.map((slot) => (
                <option key={slot.value} value={slot.value}>{slot.label}</option>
              ))}
            </EwrSelectCompat>
          </div>

          <div className="ewr-field">
            <div className="ewr-label">Promotion</div>
            <EwrSelectCompat className="ewr-input" value={draftFilters.promotion} onChange={(e) => setDraftFilters((p) => ({ ...p, promotion: e.target.value }))}>
              <option value="">Any</option>
              {promos.map((promo) => (
                <option key={promo.id} value={String(promo.id)}>{promo.name}</option>
              ))}
            </EwrSelectCompat>
          </div>

          <div className="ewr-field">
            <div className="ewr-label">Announcer 1</div>
            <EwrSelectCompat className="ewr-input" value={draftFilters.announcer1} onChange={(e) => setDraftFilters((p) => ({ ...p, announcer1: e.target.value }))}>
              <option value="">Any</option>
              <option value="none">None</option>
            </EwrSelectCompat>
          </div>

          <div className="ewr-field">
            <div className="ewr-label">Announcer 2</div>
            <EwrSelectCompat className="ewr-input" value={draftFilters.announcer2} onChange={(e) => setDraftFilters((p) => ({ ...p, announcer2: e.target.value }))}>
              <option value="">Any</option>
              <option value="none">None</option>
            </EwrSelectCompat>
          </div>
        </div>
      </div>
    );
  }

  const filteredImportRows = useMemo(() => {
    const q = normalizeName(importSearch);
    const visible = q
      ? importRows.filter((row) => normalizeName(row.name).includes(q))
      : importRows;

    return [...visible].sort((a, b) => {
      const aBlocked = a.duplicateName || a.missingPromotion ? 1 : 0;
      const bBlocked = b.duplicateName || b.missingPromotion ? 1 : 0;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      const byName = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
      return a.sourceIndex - b.sourceIndex;
    });
  }, [importRows, importSearch]);

  const staffAnnouncersForSelectedPromo = useMemo(() => {
    if (!selectedShow) return [] as Staff[];
    return staff
      .filter((item) => Number(item.employerId) === Number(selectedShow.promotionId) && String(item.position) === "Announcer")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, selectedShow]);

  const wrestlerAnnouncersForSelectedPromo = useMemo(() => {
    if (!selectedShow) return [] as Worker[];
    return workers
      .filter((worker) => workerWorksForPromo(worker, Number(selectedShow.promotionId)) && workerHasActiveContract(worker) && workerHasAnnouncerTrait(worker))
      .sort((a, b) => String((a as any).fullName ?? "").localeCompare(String((b as any).fullName ?? "")));
  }, [workers, selectedShow]);

  const promotionOptions: LookupOption[] = useMemo(
    () => [{ id: 0, name: "None" }, ...promos.map((promo) => ({ id: Number(promo.id), name: promo.name }))],
    [promos]
  );

  const networkOptions: LookupOption[] = useMemo(
    () => [{ id: 0, name: "None" }, ...networks.map((network) => ({ id: Number(network.networkId), name: network.name }))],
    [networks]
  );

  const header = (
    <EditorHeader
      title={selectedShow ? `Editing: ${selectedShow.name || "(blank show name)"}` : "Television"}
      leftPills={[
        selectedShow ? (selectedShow.name || "(blank show name)") : "No selection",
        selectedShow ? `Record #${selectedShow.index} — ${promotionInitialsById(promos, selectedShow.promotionId)}` : null,
      ]}
      rightPills={[
        filePath ? "tv.dat loaded" : "tv.dat not loaded",
        ...(status ? [status] : []),
      ]}
    />
  );

  return (
    <div className="ewr-app">
      <div className="ewr-panel ewr-left">
        <div style={{ padding: "12px 14px 0" }}>
          <LeftPanelFileActions
            title="Television"
            subtitle="tv.dat"
            loadFromData={{ onClick: handleLoadFromData, disabled: !props.tvDataPath && !props.workspaceRoot }}
            closeFile={{ onClick: handleCloseFile, disabled: !filePath }}
            saveFile={{ onClick: handleSave, disabled: !filePath || !dirty }}
          />
        </div>

        <div className="ewr-leftMiddle ewr-scroll">
          <div className="ewr-leftBody">
            <LeftPanelSearchHeader
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search television"
              sortValue={sortKey}
              onSortChange={(value) => setSortKey(value as SortKey)}
              sortOptions={[
                { value: "record", label: "Sort: Record" },
                { value: "name", label: "Sort: Name" },
              ]}
              showingCount={filteredShows.length}
              totalCount={shows.length}
              filtersOpen={filtersOpen}
              onToggleFilters={() => setFiltersOpen((prev) => {
                const next = !prev;
                if (next) setDraftFilters(filters);
                return next;
              })}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
            />
            {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
          </div>

          <div style={{ padding: filtersOpen ? "6px 14px 14px" : "0 14px 14px" }}>
            {filteredShows.map((record) => {
              const checked = selectedForDelete.has(record.index);
              return (
                <LeftPanelNameCard
                  key={record.index}
                  name={record.name || "(blank show name)"}
                  isSelected={selectedShow?.index === record.index}
                  onSelect={() => setSelectedIndex(record.index)}
                  onCopy={() => handleCopyShow(record.index)}
                  onDelete={() => deleteShowByIndex(record.index)}
                  copyTitle="Copy Show"
                  deleteTitle="Delete Show"
                  showActions={true}
                  leading={multiDeleteMode ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleSelectedForDelete(record.index, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 18, height: 18 }}
                      title="Select for multi-delete"
                    />
                  ) : undefined}
                />
              );
            })}
            {filteredShows.length === 0 ? <div className="ewr-muted">No television shows found.</div> : null}
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              label: "Add New Show",
              icon: <IconPlus className="btnSvg" />,
              onClick: handleAddNew,
              className: "ewr-button",
            },
            {
              key: "multi",
              label: multiDeleteMode
                ? (selectedForDelete.size > 0 ? `Delete Selected (${selectedForDelete.size})` : "Cancel Multi-Delete")
                : "Multi-Delete",
              icon: <IconChecklist className="btnSvg" />,
              onClick: multiDeleteMode
                ? (selectedForDelete.size > 0 ? commitMultiDelete : toggleMultiDeleteMode)
                : toggleMultiDeleteMode,
              title: !multiDeleteMode
                ? "Enable multi-delete selection"
                : selectedForDelete.size > 0
                  ? "Click again to delete selected television shows"
                  : "Disable multi-delete (no selection)",
              className: "ewr-button",
              style: multiDeleteMode && selectedForDelete.size > 0
                ? { background: "rgba(255,70,70,0.18)", border: "1px solid rgba(255,70,70,0.60)" }
                : undefined,
            },
            {
              key: "import",
              label: "Import TV Show",
              icon: <IconImport className="btnSvg" />,
              onClick: handleImportTvShow,
              className: "ewr-button",
            },
            {
              key: "external",
              label: "External Editing",
              icon: <IconGrid className="btnSvg" />,
              onClick: handleExternalEditing,
              className: "ewr-button ewr-buttonYellow",
              style: externalEditingOpen
                ? { background: "rgba(255,190,70,0.12)", border: "1px solid rgba(255,190,70,0.55)" }
                : undefined,
            },
          ]}
          after={
            <>
              {externalEditingOpen ? (
                <div className="ewr-footerGrid" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="ewr-button"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={handleExportTelevisionCsv}
                    disabled={!shows.length}
                    title="Export television shows to CSV"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="ewr-button"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={handleImportTelevisionCsv}
                    disabled={!shows.length}
                    title="Import television shows from CSV"
                  >
                    Import CSV
                  </button>
                </div>
              ) : null}

              {multiDeleteMode ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => setSelectedForDelete(new Set(filteredShows.map((record) => record.index)))}
                    disabled={!filteredShows.length}
                    title="Select all currently listed television shows"
                  >
                    Select All
                  </button>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => setSelectedForDelete(new Set())}
                    disabled={!selectedForDelete.size}
                    title="Clear selection"
                  >
                    Select None
                  </button>
                </div>
              ) : null}
            </>
          }
        />
      </div>

      {importModalOpen ? (
        <div className="ewr-modalOverlay" onMouseDown={closeImportModal} role="dialog" aria-modal="true">
          <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ewr-modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">Import TV Shows</div>
                <div className="ewr-modalSub">
                  Source: <span className="ewr-mono">{importSourcePath ? importSourcePath.split(/[\\/]/).pop() : "tv.dat"}</span>
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
                  placeholder="Filter TV shows by name..."
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                />

                <button
                  className="ewr-button ewr-buttonSmall"
                  type="button"
                  onClick={() => {
                    const all = new Set(filteredImportRows.filter((row) => !row.duplicateName && !row.missingPromotion).map((row) => row.sourceIndex));
                    setImportSelection(all);
                  }}
                >
                  Select All
                </button>

                <button
                  className="ewr-button ewr-buttonSmall"
                  type="button"
                  onClick={() => setImportSearch("")}
                >
                  Clear
                </button>
              </div>

              <div className="ewr-modalList">
                {filteredImportRows.length === 0 ? (
                  <div className="ewr-muted">No TV shows found.</div>
                ) : (
                  filteredImportRows.map((row) => {
                    const checked = importSelection.has(row.sourceIndex);
                    const disabled = row.duplicateName || row.missingPromotion;
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
                    const blockedReason = row.blankName
                      ? "Blank TV show name"
                      : row.duplicateInSource
                        ? "Duplicate in source file"
                        : row.duplicateName
                          ? "Duplicate TV show name"
                          : "Promotion not present in current data";
                    const badgeText = disabled ? (row.duplicateInSource ? "Duplicate" : "Blocked") : "Importable";
                    return (
                      <label key={row.sourceIndex} className="ewr-importRow" style={{ opacity: disabled ? 0.55 : 1 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(e) => toggleImportSelection(row.sourceIndex, e.target.checked)}
                        />
                        <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span>
                            {row.name || "(blank TV show name)"}
                            <span style={badgeStyle}>{badgeText}</span>
                          </span>
                          <span className="ewr-muted">
                            Source record #{row.sourceIndex}{disabled ? ` • ${blockedReason}` : ""}
                          </span>
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
                Selected: {Array.from(importSelection).filter((sourceIndex) => importRows.some((row) => row.sourceIndex === sourceIndex && !row.duplicateName && !row.missingPromotion)).length} / {importRows.length}
              </div>

              <button className="ewr-button" type="button" onClick={closeImportModal}>
                Cancel
              </button>

              <button
                className="ewr-button ewr-buttonOrange"
                type="button"
                onClick={commitImportedTvShows}
                disabled={!Array.from(importSelection).some((sourceIndex) => importRows.some((row) => row.sourceIndex === sourceIndex && !row.duplicateName && !row.missingPromotion))}
              >
                Import Selected
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <RightPanelShell header={header}>
        {!selectedShow ? (
          <div className="ewr-muted">Load tv.dat to edit television shows.</div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1.05 }}>{selectedShow.name || "(blank show name)"}</div>
              <div className="ewr-muted" style={{ fontSize: 18, marginTop: 8 }}>
                Record #{selectedShow.index} — {promotionInitialsById(promos, selectedShow.promotionId)}
              </div>
            </div>

            <div className="ewr-sectionTitle">Broadcast Details</div>

            <div className="ewr-grid" style={{ gap: 14, marginTop: 12 }}>
              <label className="ewr-field">
                <div className="ewr-label">Show Name (32)</div>
                <input
                  className="ewr-input"
                  value={selectedShow.name}
                  maxLength={32}
                  onChange={(e) => patchSelectedField("name", truncateUiName(e.target.value) as any)}
                />
              </label>

              <div className="ewr-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <label className="ewr-field">
                  <div className="ewr-label">Promotion</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selectedShow.promotionId}
                    onChange={(e) => patchSelected((record) => ({
                      ...record,
                      promotionId: clamp(Number(e.target.value) || 0, 0, 65535),
                      announcer1StaffId: 0,
                      announcer2StaffId: 0,
                      announcer2WrestlerId: 0,
                    }))}
                  >
                    {promotionOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </EwrSelectCompat>
                </label>

                <label className="ewr-field">
                  <div className="ewr-label">Day</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selectedShow.day}
                    onChange={(e) => patchSelectedField("day", e.target.value as any)}
                  >
                    {DAY_OPTIONS.map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </EwrSelectCompat>
                </label>

                <label className="ewr-field">
                  <div className="ewr-label">Network</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selectedShow.networkId}
                    onChange={(e) => patchSelectedField("networkId", clamp(Number(e.target.value) || 0, 0, 65535) as any)}
                  >
                    {networkOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </EwrSelectCompat>
                </label>

                <label className="ewr-field">
                  <div className="ewr-label">Time Slot</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selectedShow.timeSlot}
                    onChange={(e) => patchSelectedField("timeSlot", e.target.value as TvTimeSlot)}
                  >
                    {TIME_SLOT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </EwrSelectCompat>
                </label>
              </div>
            </div>

            <div
              style={{
                marginTop: 18,
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(255,90,90,0.35)",
                background: "linear-gradient(135deg, rgba(140, 10, 10, 0.28) 0%, rgba(55, 0, 0, 0.14) 35%, rgba(0, 0, 0, 0.04) 100%)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
                opacity: isSaveWorkspace ? 1 : 0.72,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Save File Contract Fix</div>
                  <div className="ewr-hint" style={{ marginTop: 4 }}>
                    {isSaveWorkspace ? "Active in save-folder tv.dat workspaces." : "Inactive in DATA folder workspaces."}
                  </div>
                </div>
              </div>

              <div className="ewr-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
                <label className="ewr-field">
                  <div className="ewr-label">Contract Length (Weeks)</div>
                  <input
                    className="ewr-input"
                    type="number"
                    min={0}
                    max={65535}
                    step={1}
                    disabled={!isSaveWorkspace}
                    value={Number(selectedShow.contractLengthWeeks ?? 0)}
                    onChange={(e) => patchSelectedField("contractLengthWeeks", clamp(Number(e.target.value) || 0, 0, 65535) as any)}
                  />
                  <div className="ewr-hint" style={{ marginTop: 6 }}>
                    Save-file only. This matches the in-game television contract length shown in weeks.
                  </div>
                </label>
              </div>
            </div>

            <div className="ewr-sectionTitle" style={{ marginTop: 22 }}>Announce Team</div>
            <div className="ewr-grid" style={{ gridTemplateColumns: "1fr 1fr 220px", gap: 14, marginTop: 12, alignItems: "end" }}>
              <label className="ewr-field">
                <div className="ewr-label">Announcer 1</div>
                <EwrSelectCompat
                  className="ewr-input"
                  value={selectedShow.announcer1StaffId}
                  onChange={(e) => patchSelectedField("announcer1StaffId", clamp(Number(e.target.value) || 0, 0, 65535) as any)}
                >
                  <option value={0}>None</option>
                  {staffAnnouncersForSelectedPromo.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </EwrSelectCompat>
              </label>

              <label className="ewr-field">
                <div className="ewr-label">Announcer 2</div>
                {!selectedShow.announcer2UseWrestler ? (
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selectedShow.announcer2StaffId}
                    onChange={(e) => patchSelected((record) => ({
                      ...record,
                      announcer2StaffId: clamp(Number(e.target.value) || 0, 0, 65535),
                      announcer2WrestlerId: 0,
                    }))}
                  >
                    <option value={0}>None</option>
                    {staffAnnouncersForSelectedPromo.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </EwrSelectCompat>
                ) : (
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selectedShow.announcer2WrestlerId}
                    onChange={(e) => patchSelected((record) => ({
                      ...record,
                      announcer2WrestlerId: clamp(Number(e.target.value) || 0, 0, 65535),
                      announcer2StaffId: 0,
                    }))}
                  >
                    <option value={0}>None</option>
                    {wrestlerAnnouncersForSelectedPromo.map((item) => (
                      <option key={item.id} value={item.id}>{String((item as any).fullName ?? "").trim() || `Worker #${item.id}`}</option>
                    ))}
                  </EwrSelectCompat>
                )}
              </label>

              <label className="ewr-field">
                <div className="ewr-label">Use Wrestler</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 42 }}>
                  <input
                    type="checkbox"
                    checked={!!selectedShow.announcer2UseWrestler}
                    onChange={(e) => {
                      const on = !!e.target.checked;
                      patchSelected((record) => ({
                        ...record,
                        announcer2UseWrestler: on,
                        announcer2StaffId: 0,
                        announcer2WrestlerId: 0,
                      }));
                    }}
                  />
                  <span>{selectedShow.announcer2UseWrestler ? "Yes" : "No"}</span>
                </label>
              </label>
            </div>
                    </>
        )}
      </RightPanelShell>
    </div>
  );
}
