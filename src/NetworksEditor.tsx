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

import { parseNetworkDat, type NetworkRecord } from "./ewr/parseNetworkDat";
import { validateNetworkDatBytes } from "./ewr/validateNetworkDat";
import { writeNetworkDat } from "./ewr/writeNetworkDat";

function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type Props = {
  workspaceRoot: string;
  networkDataPath?: string;
};

type SortKey = "id" | "name";
type SlotKey = "early" | "prime" | "late" | "graveyard";
type CsvRecord = Record<string, string>;
type ImportNetworkRow = {
  sourceIndex: number;
  sourceId: number;
  name: string;
  record: NetworkRecord;
  duplicateName: boolean;
  duplicateInSource: boolean;
  blankName: boolean;
};

const NETWORKS_CSV_HEADERS = [
  "Record #",
  "Network Name",
  "Generic (Yes/No)",
  "Production Values",
  "Early Evening Potential Audience",
  "Early Evening Maximum Risk",
  "Prime Time Potential Audience",
  "Prime Time Maximum Risk",
  "Late Night Potential Audience",
  "Late Night Maximum Risk",
  "Graveyard Potential Audience",
  "Graveyard Maximum Risk",
] as const;

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeName(s: string) {
  return String(s ?? "").trim().toLowerCase();
}

function truncateAscii(s: string, maxLen: number) {
  const raw = String(s ?? "");
  return raw.length <= maxLen ? raw : raw.slice(0, maxLen);
}

function formatAudience(value: number) {
  return (clamp(Number(value) || 0, 0, 800) / 100).toFixed(2);
}

function parseAudienceInput(value: string) {
  const n = Number(value);
  return clamp(Math.round((Number.isFinite(n) ? n : 0) * 100), 0, 800);
}

function createBlankNetwork(index: number, nextId: number): NetworkRecord {
  const raw = new Uint8Array(43);
  raw[0] = 52;
  return {
    index,
    networkId: nextId,
    name: "New Network",
    earlyAudience: 0,
    primeAudience: 0,
    lateAudience: 0,
    graveyardAudience: 0,
    earlyRisk: 0,
    primeRisk: 0,
    lateRisk: 0,
    graveyardRisk: 0,
    productionValues: 0,
    generic: false,
    _raw: raw,
  };
}

function makeCopiedNetworkName(sourceName: string, existingNames: string[]) {
  const baseName = truncateAscii(String(sourceName ?? "").trim() || "New Network", 20);
  const normalizedExisting = new Set(existingNames.map((name) => normalizeName(name)));

  let suffix = 1;
  while (suffix < 1000) {
    const suffixText = ` (${suffix})`;
    const trimmedBase = truncateAscii(baseName, Math.max(0, 20 - suffixText.length));
    const candidate = `${trimmedBase}${suffixText}`;
    if (!normalizedExisting.has(normalizeName(candidate))) return candidate;
    suffix += 1;
  }

  return truncateAscii(baseName, 20);
}

function audienceFieldForSlot(slot: SlotKey): keyof NetworkRecord {
  switch (slot) {
    case "early": return "earlyAudience";
    case "prime": return "primeAudience";
    case "late": return "lateAudience";
    case "graveyard": return "graveyardAudience";
  }
}

function riskFieldForSlot(slot: SlotKey): keyof NetworkRecord {
  switch (slot) {
    case "early": return "earlyRisk";
    case "prime": return "primeRisk";
    case "late": return "lateRisk";
    case "graveyard": return "graveyardRisk";
  }
}

function slotTitle(slot: SlotKey) {
  switch (slot) {
    case "early": return "Early Evening Slot (6:00pm - 8:00pm)";
    case "prime": return "Prime Time Slot (8:00pm - 10:00pm)";
    case "late": return "Late Night Slot (10:00pm - 12:00am)";
    case "graveyard": return "Graveyard Slot (12:00am - 2:00am)";
  }
}

function csvEscape(value: any): string {
  const s = String(value ?? "");
  if (/[,"]|\n|\r/.test(s)) return `"${s.replace(/"/g, '""')}"`;
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

function NumericCell(props: {
  value: string;
  onCommit: (next: string) => void;
  inputMode?: "numeric" | "decimal";
}) {
  const [draft, setDraft] = useState(props.value);

  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  return (
    <input
      type="text"
      inputMode={props.inputMode ?? "numeric"}
      className="ewr-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => props.onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(props.value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export default function NetworksEditor(props: Props) {
  const [status, setStatus] = useState("");
  const [filePath, setFilePath] = useState(props.networkDataPath ?? "");
  const [dirty, setDirty] = useState(false);

  const [networks, setNetworks] = useState<NetworkRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [genericFilter, setGenericFilter] = useState<"" | "generic" | "standard">("");
  const [productionMinFilter, setProductionMinFilter] = useState("");
  const [productionMaxFilter, setProductionMaxFilter] = useState("");
  const [earlyAudienceMinFilter, setEarlyAudienceMinFilter] = useState("");
  const [earlyAudienceMaxFilter, setEarlyAudienceMaxFilter] = useState("");
  const [earlyRiskMinFilter, setEarlyRiskMinFilter] = useState("");
  const [earlyRiskMaxFilter, setEarlyRiskMaxFilter] = useState("");
  const [primeAudienceMinFilter, setPrimeAudienceMinFilter] = useState("");
  const [primeAudienceMaxFilter, setPrimeAudienceMaxFilter] = useState("");
  const [primeRiskMinFilter, setPrimeRiskMinFilter] = useState("");
  const [primeRiskMaxFilter, setPrimeRiskMaxFilter] = useState("");
  const [lateAudienceMinFilter, setLateAudienceMinFilter] = useState("");
  const [lateAudienceMaxFilter, setLateAudienceMaxFilter] = useState("");
  const [lateRiskMinFilter, setLateRiskMinFilter] = useState("");
  const [lateRiskMaxFilter, setLateRiskMaxFilter] = useState("");
  const [graveyardAudienceMinFilter, setGraveyardAudienceMinFilter] = useState("");
  const [graveyardAudienceMaxFilter, setGraveyardAudienceMaxFilter] = useState("");
  const [graveyardRiskMinFilter, setGraveyardRiskMinFilter] = useState("");
  const [graveyardRiskMaxFilter, setGraveyardRiskMaxFilter] = useState("");
  const [multiDeleteMode, setMultiDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState("");
  const [importInfo, setImportInfo] = useState("");
  const [importSearch, setImportSearch] = useState("");
  const [importRows, setImportRows] = useState<ImportNetworkRow[]>([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());

  const [externalEditingOpen, setExternalEditingOpen] = useState(false);

  const selectedNetwork = networks[selectedIndex] ?? null;

  async function ensureBakOnce(path: string) {
    const bak = buildEwresBackupPath(path);
    const bakDir = bak.slice(0, bak.lastIndexOf("/"));
    await mkdir(bakDir, { recursive: true });
    if (!(await exists(bak))) await copyFile(path, bak);
  }

  async function openNetworksFromPath(path: string) {
    setStatus("");
    try {
      const bytes = await readFile(path);
      validateNetworkDatBytes(bytes);
      const parsed = parseNetworkDat(bytes);
      setFilePath(path);
      setNetworks(parsed.networks);
      setSelectedIndex(0);
      setDirty(false);
      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
      setExternalEditingOpen(false);
    } catch (e: any) {
      console.error(e);
      setStatus(`Load failed: ${e?.message || e}`);
    }
  }

  useEffect(() => {
    if (props.networkDataPath && props.networkDataPath !== filePath) {
      openNetworksFromPath(props.networkDataPath);
    }
  }, [props.networkDataPath]);

  async function handleLoadFromData() {
    if (props.networkDataPath) return openNetworksFromPath(props.networkDataPath);
    const picked = await open({
      multiple: false,
      filters: [{ name: "DAT files", extensions: ["dat"] }],
    });
    if (typeof picked === "string") await openNetworksFromPath(picked);
  }

  function handleCloseFile() {
    setFilePath("");
    setNetworks([]);
    setSelectedIndex(0);
    setDirty(false);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());
    setImportModalOpen(false);
    setExternalEditingOpen(false);
    setStatus("Closed network.dat");
  }

  async function handleSave() {
    if (!filePath) {
      setStatus("No network.dat file is open.");
      return;
    }
    try {
      const normalized = networks.map((record, index) => ({ ...record, index }));
      const out = writeNetworkDat(normalized);
      await ensureBakOnce(filePath);
      await writeFile(filePath, out);
      setNetworks(normalized);
      setDirty(false);
      setStatus(`Saved: ${normalized.length} networks`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Save failed: ${e?.message || e}`);
    }
  }

  function patchSelected(mutator: (record: NetworkRecord) => NetworkRecord) {
    setNetworks((prev) => {
      if (!prev[selectedIndex]) return prev;
      const next = prev.slice();
      next[selectedIndex] = mutator({ ...next[selectedIndex] });
      return next;
    });
    setDirty(true);
  }

  function patchSelectedField<K extends keyof NetworkRecord>(key: K, value: NetworkRecord[K]) {
    patchSelected((record) => ({ ...record, [key]: value }));
  }

  function nextNetworkId(list = networks) {
    return list.reduce((max, record) => Math.max(max, Number(record.networkId || 0)), 0) + 1;
  }

  function handleAddNew() {
    setNetworks((prev) => {
      const next = [...prev, createBlankNetwork(prev.length, nextNetworkId(prev))];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setDirty(true);
    setStatus("Added new network.");
  }

  function handleCopyNetwork(recordIndex: number) {
    setNetworks((prev) => {
      const source = prev.find((record) => record.index === recordIndex);
      if (!source) return prev;

      const copied: NetworkRecord = {
        ...source,
        index: prev.length,
        networkId: nextNetworkId(prev),
        name: makeCopiedNetworkName(source.name, prev.map((record) => record.name)),
        _raw: new Uint8Array(source._raw ?? 43),
      };

      const next = [...prev, copied];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setDirty(true);
    setStatus("Copied network.");
  }

  function deleteNetworkByIndex(recordIndex: number) {
    const doomed = networks.find((record) => record.index === recordIndex);
    if (!doomed) return;

    setNetworks((prev) => prev.filter((record) => record.index !== recordIndex).map((record, index) => ({ ...record, index })));
    setSelectedIndex((prev) => {
      if (prev > recordIndex) return prev - 1;
      if (prev === recordIndex) return Math.max(0, prev - 1);
      return prev;
    });
    setDirty(true);
    setStatus(`Deleted network: ${doomed.name || `Record #${recordIndex}`}`);
  }

  function toggleMultiDeleteMode() {
    setMultiDeleteMode((prev) => !prev);
    setSelectedForDelete(new Set());
  }

  function toggleSelectedForDelete(recordIndex: number, checked: boolean) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (checked) next.add(recordIndex);
      else next.delete(recordIndex);
      return next;
    });
  }

  function commitMultiDelete() {
    if (!selectedForDelete.size) {
      toggleMultiDeleteMode();
      return;
    }

    const doomed = new Set(selectedForDelete);
    setNetworks((prev) => prev.filter((record) => !doomed.has(record.index)).map((record, index) => ({ ...record, index })));
    setSelectedIndex(0);
    setSelectedForDelete(new Set());
    setMultiDeleteMode(false);
    setDirty(true);
    setStatus(`Deleted ${doomed.size} networks.`);
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

  async function handleImportNetworks() {
    if (!networks.length) {
      setStatus("Load network.dat first.");
      return;
    }

    try {
      const picked = await open({
        title: "Import from another network.dat",
        multiple: false,
        filters: [{ name: "EWR network.dat", extensions: ["dat"] }],
      });
      if (!picked) return;
      const sourcePath = Array.isArray(picked) ? picked[0] : picked;
      const bytes = await readFile(sourcePath);
      validateNetworkDatBytes(bytes);
      const parsed = parseNetworkDat(bytes);
      const seenInSource = new Set<string>();
      const existingNames = new Set(networks.map((record) => normalizeName(record.name)));
      const rows: ImportNetworkRow[] = parsed.networks.map((record, idx) => {
        const normalized = normalizeName(record.name);
        const blankName = !normalized;
        const duplicateInSource = !!normalized && seenInSource.has(normalized);
        const duplicateExisting = !!normalized && existingNames.has(normalized);
        const duplicateName = blankName || duplicateExisting || duplicateInSource;
        if (normalized) seenInSource.add(normalized);
        return {
          sourceIndex: idx,
          sourceId: Number(record.networkId || 0),
          name: record.name,
          record,
          duplicateName,
          duplicateInSource,
          blankName,
        };
      });
      const importable = rows.filter((row) => !row.duplicateName).length;
      setImportSourcePath(sourcePath);
      setImportRows(rows);
      setImportSelection(new Set(rows.filter((row) => !row.duplicateName).map((row) => row.sourceIndex)));
      setImportInfo(`Loaded ${rows.length} networks from source. ${importable} can be imported.`);
      setImportSearch("");
      setImportModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import failed: ${e?.message ?? String(e)}`);
    }
  }

  function commitImportedNetworks() {
    const selectedRows = importRows.filter((row) => importSelection.has(row.sourceIndex) && !row.duplicateName);
    if (!selectedRows.length) {
      setStatus("No importable networks selected.");
      return;
    }

    setNetworks((prev) => {
      const next = prev.slice();
      let nextId = nextNetworkId(prev);
      const existingNames = new Set(prev.map((record) => normalizeName(record.name)));
      for (const row of selectedRows) {
        const name = truncateAscii(String(row.record.name ?? "").trim(), 20);
        const normalized = normalizeName(name);
        if (!normalized || existingNames.has(normalized)) continue;
        existingNames.add(normalized);
        next.push({
          ...row.record,
          index: next.length,
          networkId: nextId++,
          name,
          _raw: new Uint8Array(row.record._raw ?? 43),
        });
      }
      setSelectedIndex(next.length ? next.length - 1 : 0);
      return next.map((record, index) => ({ ...record, index }));
    });
    setDirty(true);
    setStatus(`Imported ${selectedRows.length} networks. Click Save to write to disk.`);
    closeImportModal();
  }

  async function handleExportNetworksCsv() {
    try {
      if (!networks.length) {
        setStatus("Load network.dat first.");
        return;
      }
      const defaultName = filePath ? filePath.replace(/\.dat$/i, ".csv") : "network.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const lines: string[] = [];
      lines.push(NETWORKS_CSV_HEADERS.map(csvEscape).join(","));
      const sorted = [...networks].sort((a, b) => Number(a.index) - Number(b.index));
      for (const record of sorted) {
        lines.push([
          Number(record.index ?? 0),
          String(record.name ?? ""),
          boolToYesNo(Boolean(record.generic)),
          clamp(Number(record.productionValues || 0), 0, 70),
          formatAudience(record.earlyAudience),
          clamp(Number(record.earlyRisk || 0), 0, 100),
          formatAudience(record.primeAudience),
          clamp(Number(record.primeRisk || 0), 0, 100),
          formatAudience(record.lateAudience),
          clamp(Number(record.lateRisk || 0), 0, 100),
          formatAudience(record.graveyardAudience),
          clamp(Number(record.graveyardRisk || 0), 0, 100),
        ].map(csvEscape).join(","));
      }

      await writeFile(outPath, new TextEncoder().encode("﻿" + lines.join("\n")));
      setExternalEditingOpen(false);
      setStatus(`Exported CSV: ${outPath}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function handleImportNetworksCsv() {
    try {
      if (!networks.length) {
        setStatus("Load network.dat first.");
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
      const text = new TextDecoder().decode(bytes);
      const parsed = parseCsv(text);
      const actual = parsed.headers.map((header) => String(header ?? "").trim());
      const missing = NETWORKS_CSV_HEADERS.filter((header) => !actual.includes(header));
      if (missing.length) {
        setStatus(`CSV header mismatch. Missing: ${missing.join(", ")}`);
        setExternalEditingOpen(false);
        return;
      }

      let updated = 0;
      let added = 0;
      let skipped = 0;
      const nextList = networks.map((record) => ({ ...record, _raw: new Uint8Array(record._raw ?? 43) }));
      const normalizedNameToIndex = new Map<string, number>();
      for (let i = 0; i < nextList.length; i++) {
        const normalized = normalizeName(nextList[i].name);
        if (normalized) normalizedNameToIndex.set(normalized, i);
      }
      let nextId = nextNetworkId(nextList);

      for (const row of parsed.rows) {
        const recNo = parseIntOrNull(row["Record #"]);
        const name = truncateAscii(String(row["Network Name"] ?? "").trim(), 20);
        const normalized = normalizeName(name);
        const generic = yesNoToBool(String(row["Generic (Yes/No)"] ?? ""));
        if (!normalized || generic === null) {
          skipped++;
          continue;
        }

        const productionValues = clamp(Number(row["Production Values"] ?? 0) || 0, 0, 70);
        const earlyAudience = parseAudienceInput(String(row["Early Evening Potential Audience"] ?? "0"));
        const earlyRisk = clamp(Number(row["Early Evening Maximum Risk"] ?? 0) || 0, 0, 100);
        const primeAudience = parseAudienceInput(String(row["Prime Time Potential Audience"] ?? "0"));
        const primeRisk = clamp(Number(row["Prime Time Maximum Risk"] ?? 0) || 0, 0, 100);
        const lateAudience = parseAudienceInput(String(row["Late Night Potential Audience"] ?? "0"));
        const lateRisk = clamp(Number(row["Late Night Maximum Risk"] ?? 0) || 0, 0, 100);
        const graveyardAudience = parseAudienceInput(String(row["Graveyard Potential Audience"] ?? "0"));
        const graveyardRisk = clamp(Number(row["Graveyard Maximum Risk"] ?? 0) || 0, 0, 100);

        const existingNameIndex = normalizedNameToIndex.get(normalized);
        if (recNo !== null && recNo >= 0 && recNo < nextList.length) {
          if (existingNameIndex !== undefined && existingNameIndex !== recNo) {
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
            generic,
            productionValues,
            earlyAudience,
            earlyRisk,
            primeAudience,
            primeRisk,
            lateAudience,
            lateRisk,
            graveyardAudience,
            graveyardRisk,
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
            networkId: nextId++,
            name,
            generic,
            productionValues,
            earlyAudience,
            earlyRisk,
            primeAudience,
            primeRisk,
            lateAudience,
            lateRisk,
            graveyardAudience,
            graveyardRisk,
            _raw: new Uint8Array(43),
          });
          normalizedNameToIndex.set(normalized, nextList.length - 1);
          added++;
        }
      }

      const finalList = nextList.map((record, index) => ({ ...record, index }));
      setNetworks(finalList);
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

  function clearAllFilters() {
    setGenericFilter("");
    setProductionMinFilter("");
    setProductionMaxFilter("");
    setEarlyAudienceMinFilter("");
    setEarlyAudienceMaxFilter("");
    setEarlyRiskMinFilter("");
    setEarlyRiskMaxFilter("");
    setPrimeAudienceMinFilter("");
    setPrimeAudienceMaxFilter("");
    setPrimeRiskMinFilter("");
    setPrimeRiskMaxFilter("");
    setLateAudienceMinFilter("");
    setLateAudienceMaxFilter("");
    setLateRiskMinFilter("");
    setLateRiskMaxFilter("");
    setGraveyardAudienceMinFilter("");
    setGraveyardAudienceMaxFilter("");
    setGraveyardRiskMinFilter("");
    setGraveyardRiskMaxFilter("");
  }

  const activeFilterCount = [
    genericFilter,
    productionMinFilter, productionMaxFilter,
    earlyAudienceMinFilter, earlyAudienceMaxFilter, earlyRiskMinFilter, earlyRiskMaxFilter,
    primeAudienceMinFilter, primeAudienceMaxFilter, primeRiskMinFilter, primeRiskMaxFilter,
    lateAudienceMinFilter, lateAudienceMaxFilter, lateRiskMinFilter, lateRiskMaxFilter,
    graveyardAudienceMinFilter, graveyardAudienceMaxFilter, graveyardRiskMinFilter, graveyardRiskMaxFilter,
  ].filter((value) => String(value).trim() !== "").length;

  function parseFilterBound(value: string, min: number, max: number, multiplier = 1) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return clamp(Math.round(n * multiplier), min, max);
  }

  const filteredNetworks = useMemo(() => {
    const q = normalizeName(search);
    let list = [...networks];

    const productionMin = parseFilterBound(productionMinFilter, 0, 70);
    const productionMax = parseFilterBound(productionMaxFilter, 0, 70);
    const earlyAudienceMin = parseFilterBound(earlyAudienceMinFilter, 0, 800, 100);
    const earlyAudienceMax = parseFilterBound(earlyAudienceMaxFilter, 0, 800, 100);
    const earlyRiskMin = parseFilterBound(earlyRiskMinFilter, 0, 100);
    const earlyRiskMax = parseFilterBound(earlyRiskMaxFilter, 0, 100);
    const primeAudienceMin = parseFilterBound(primeAudienceMinFilter, 0, 800, 100);
    const primeAudienceMax = parseFilterBound(primeAudienceMaxFilter, 0, 800, 100);
    const primeRiskMin = parseFilterBound(primeRiskMinFilter, 0, 100);
    const primeRiskMax = parseFilterBound(primeRiskMaxFilter, 0, 100);
    const lateAudienceMin = parseFilterBound(lateAudienceMinFilter, 0, 800, 100);
    const lateAudienceMax = parseFilterBound(lateAudienceMaxFilter, 0, 800, 100);
    const lateRiskMin = parseFilterBound(lateRiskMinFilter, 0, 100);
    const lateRiskMax = parseFilterBound(lateRiskMaxFilter, 0, 100);
    const graveyardAudienceMin = parseFilterBound(graveyardAudienceMinFilter, 0, 800, 100);
    const graveyardAudienceMax = parseFilterBound(graveyardAudienceMaxFilter, 0, 800, 100);
    const graveyardRiskMin = parseFilterBound(graveyardRiskMinFilter, 0, 100);
    const graveyardRiskMax = parseFilterBound(graveyardRiskMaxFilter, 0, 100);

    if (q) {
      list = list.filter((record) => normalizeName(record.name).includes(q) || String(record.networkId ?? "").includes(q));
    }

    if (genericFilter === "generic") list = list.filter((record) => !!record.generic);
    if (genericFilter === "standard") list = list.filter((record) => !record.generic);

    list = list.filter((record) => {
      const production = clamp(Number(record.productionValues || 0), 0, 70);
      const earlyAudience = clamp(Number(record.earlyAudience || 0), 0, 800);
      const earlyRisk = clamp(Number(record.earlyRisk || 0), 0, 100);
      const primeAudience = clamp(Number(record.primeAudience || 0), 0, 800);
      const primeRisk = clamp(Number(record.primeRisk || 0), 0, 100);
      const lateAudience = clamp(Number(record.lateAudience || 0), 0, 800);
      const lateRisk = clamp(Number(record.lateRisk || 0), 0, 100);
      const graveyardAudience = clamp(Number(record.graveyardAudience || 0), 0, 800);
      const graveyardRisk = clamp(Number(record.graveyardRisk || 0), 0, 100);

      if (productionMin !== null && production < productionMin) return false;
      if (productionMax !== null && production > productionMax) return false;
      if (earlyAudienceMin !== null && earlyAudience < earlyAudienceMin) return false;
      if (earlyAudienceMax !== null && earlyAudience > earlyAudienceMax) return false;
      if (earlyRiskMin !== null && earlyRisk < earlyRiskMin) return false;
      if (earlyRiskMax !== null && earlyRisk > earlyRiskMax) return false;
      if (primeAudienceMin !== null && primeAudience < primeAudienceMin) return false;
      if (primeAudienceMax !== null && primeAudience > primeAudienceMax) return false;
      if (primeRiskMin !== null && primeRisk < primeRiskMin) return false;
      if (primeRiskMax !== null && primeRisk > primeRiskMax) return false;
      if (lateAudienceMin !== null && lateAudience < lateAudienceMin) return false;
      if (lateAudienceMax !== null && lateAudience > lateAudienceMax) return false;
      if (lateRiskMin !== null && lateRisk < lateRiskMin) return false;
      if (lateRiskMax !== null && lateRisk > lateRiskMax) return false;
      if (graveyardAudienceMin !== null && graveyardAudience < graveyardAudienceMin) return false;
      if (graveyardAudienceMax !== null && graveyardAudience > graveyardAudienceMax) return false;
      if (graveyardRiskMin !== null && graveyardRisk < graveyardRiskMin) return false;
      if (graveyardRiskMax !== null && graveyardRisk > graveyardRiskMax) return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return Number(a.networkId || 0) - Number(b.networkId || 0);
    });

    return list;
  }, [
    networks, search, sortKey, genericFilter,
    productionMinFilter, productionMaxFilter,
    earlyAudienceMinFilter, earlyAudienceMaxFilter, earlyRiskMinFilter, earlyRiskMaxFilter,
    primeAudienceMinFilter, primeAudienceMaxFilter, primeRiskMinFilter, primeRiskMaxFilter,
    lateAudienceMinFilter, lateAudienceMaxFilter, lateRiskMinFilter, lateRiskMaxFilter,
    graveyardAudienceMinFilter, graveyardAudienceMaxFilter, graveyardRiskMinFilter, graveyardRiskMaxFilter,
  ]);

  const filteredImportRows = useMemo(() => {
    const q = normalizeName(importSearch);
    const visible = q
      ? importRows.filter((row) => normalizeName(row.name).includes(q) || String(row.sourceId).includes(q))
      : importRows;

    return [...visible].sort((a, b) => {
      const aGroup = a.duplicateName ? 1 : 0;
      const bGroup = b.duplicateName ? 1 : 0;
      if (aGroup !== bGroup) return aGroup - bGroup;
      const nameCompare = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
      if (nameCompare !== 0) return nameCompare;
      return a.sourceId - b.sourceId;
    });
  }, [importRows, importSearch]);

  const header = (
    <EditorHeader
      title={selectedNetwork ? `Editing: ${selectedNetwork.name || "(blank network name)"}` : "Networks Editor"}
      leftPills={selectedNetwork ? [
        `Category: Networks`,
        `Loaded: ${networks.length}`,
        `Record #${selectedNetwork.index}`,
        `Network ID: ${selectedNetwork.networkId}`,
        filePath ? `network.dat loaded` : `No file loaded`,
      ] : []}
      rightPills={status ? [status] : []}
    />
  );

  function renderFilterRangeField(label: string, minValue: string, maxValue: string, setMinValue: (value: string) => void, setMaxValue: (value: string) => void, inputMode: "numeric" | "decimal") {
    return (
      <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
        <div className="ewr-label">{label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <input className="ewr-input" type="text" inputMode={inputMode} placeholder="Min" value={minValue} onChange={(e) => setMinValue(e.target.value)} />
          <input className="ewr-input" type="text" inputMode={inputMode} placeholder="Max" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
        </div>
      </div>
    );
  }

  function renderFilterPanel() {
    return (
      <div className="ewr-section" style={{ marginTop: 12 }}>
        <div className="ewr-sectionHeader">
          <div className="ewr-sectionTitle">Filters</div>
        </div>
        <div className="ewr-sectionBody" style={{ display: "grid", gap: 14 }}>
          <div className="ewr-filterTileGrid">
            <label className="ewr-filterTile ewr-filterTileStack">
              <span className="ewr-filterTileLabel">Generic</span>
              <select className="ewr-input ewr-filterTileSelect" value={genericFilter} onChange={(e) => setGenericFilter(e.target.value as any)}>
                <option value="">Any</option>
                <option value="generic">Generic only</option>
                <option value="standard">Non-generic only</option>
              </select>
            </label>
          </div>

          <div className="ewr-field">
            {renderFilterRangeField("Production Values (0-70)", productionMinFilter, productionMaxFilter, setProductionMinFilter, setProductionMaxFilter, "numeric")}
          </div>

          <div className="ewr-section" style={{ marginTop: 0 }}>
            <div className="ewr-sectionHeader"><div className="ewr-sectionTitle">Early Evening</div></div>
            <div className="ewr-sectionBody" style={{ display: "grid", gap: 12 }}>
              {renderFilterRangeField("Potential Audience (0.00-8.00)", earlyAudienceMinFilter, earlyAudienceMaxFilter, setEarlyAudienceMinFilter, setEarlyAudienceMaxFilter, "decimal")}
              {renderFilterRangeField("Maximum Risk (0-100)", earlyRiskMinFilter, earlyRiskMaxFilter, setEarlyRiskMinFilter, setEarlyRiskMaxFilter, "numeric")}
            </div>
          </div>

          <div className="ewr-section" style={{ marginTop: 0 }}>
            <div className="ewr-sectionHeader"><div className="ewr-sectionTitle">Prime Time</div></div>
            <div className="ewr-sectionBody" style={{ display: "grid", gap: 12 }}>
              {renderFilterRangeField("Potential Audience (0.00-8.00)", primeAudienceMinFilter, primeAudienceMaxFilter, setPrimeAudienceMinFilter, setPrimeAudienceMaxFilter, "decimal")}
              {renderFilterRangeField("Maximum Risk (0-100)", primeRiskMinFilter, primeRiskMaxFilter, setPrimeRiskMinFilter, setPrimeRiskMaxFilter, "numeric")}
            </div>
          </div>

          <div className="ewr-section" style={{ marginTop: 0 }}>
            <div className="ewr-sectionHeader"><div className="ewr-sectionTitle">Late Night</div></div>
            <div className="ewr-sectionBody" style={{ display: "grid", gap: 12 }}>
              {renderFilterRangeField("Potential Audience (0.00-8.00)", lateAudienceMinFilter, lateAudienceMaxFilter, setLateAudienceMinFilter, setLateAudienceMaxFilter, "decimal")}
              {renderFilterRangeField("Maximum Risk (0-100)", lateRiskMinFilter, lateRiskMaxFilter, setLateRiskMinFilter, setLateRiskMaxFilter, "numeric")}
            </div>
          </div>

          <div className="ewr-section" style={{ marginTop: 0 }}>
            <div className="ewr-sectionHeader"><div className="ewr-sectionTitle">Graveyard</div></div>
            <div className="ewr-sectionBody" style={{ display: "grid", gap: 12 }}>
              {renderFilterRangeField("Potential Audience (0.00-8.00)", graveyardAudienceMinFilter, graveyardAudienceMaxFilter, setGraveyardAudienceMinFilter, setGraveyardAudienceMaxFilter, "decimal")}
              {renderFilterRangeField("Maximum Risk (0-100)", graveyardRiskMinFilter, graveyardRiskMaxFilter, setGraveyardRiskMinFilter, setGraveyardRiskMaxFilter, "numeric")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderSlotSection(slot: SlotKey) {
    if (!selectedNetwork) return null;
    const audienceField = audienceFieldForSlot(slot);
    const riskField = riskFieldForSlot(slot);
    const audience = Number(selectedNetwork[audienceField] || 0);
    const risk = Number(selectedNetwork[riskField] || 0);

    return (
      <div className="ewr-section" key={slot}>
        <div className="ewr-sectionHeader">
          <div className="ewr-sectionTitle">{slotTitle(slot)}</div>
        </div>
        <div className="ewr-sectionBody">
          <label className="ewr-field">
            <div className="ewr-label">Potential Audience (0.00-8.00)</div>
            <NumericCell
              value={formatAudience(audience)}
              inputMode="decimal"
              onCommit={(next) => patchSelectedField(audienceField, parseAudienceInput(next) as any)}
            />
          </label>

          <div style={{ marginTop: 14 }}>
            <label className="ewr-field">
              <div className="ewr-label">Maximum Risk (0-100)</div>
              <NumericCell
                value={String(clamp(risk, 0, 100))}
                inputMode="numeric"
                onCommit={(next) => patchSelectedField(riskField, clamp(Number(next) || 0, 0, 100) as any)}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ewr-app">
      <div className="ewr-panel ewr-left">
        <div style={{ padding: "12px 14px 0" }}>
          <LeftPanelFileActions
            title="TV Networks"
            subtitle="network.dat"
            loadFromData={{ onClick: handleLoadFromData, disabled: !props.networkDataPath && !props.workspaceRoot }}
            closeFile={{ onClick: handleCloseFile, disabled: !filePath }}
            saveFile={{ onClick: handleSave, disabled: !filePath || !dirty }}
          />
        </div>

        <div className="ewr-leftMiddle ewr-scroll">
          <div className="ewr-leftBody">
            <LeftPanelSearchHeader
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search networks"
              sortValue={sortKey}
              onSortChange={(value) => setSortKey(value as SortKey)}
              sortOptions={[
                { value: "id", label: "Sort: ID" },
                { value: "name", label: "Sort: Name" },
              ]}
              showingCount={filteredNetworks.length}
              totalCount={networks.length}
              filtersOpen={filtersOpen}
              onToggleFilters={() => setFiltersOpen((prev) => !prev)}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
            />

            {filtersOpen ? renderFilterPanel() : null}
          </div>

          <div style={{ padding: filtersOpen ? "6px 14px 14px" : "0 14px 14px" }}>
            {filteredNetworks.map((record) => {
              const checked = selectedForDelete.has(record.index);
              return (
                <LeftPanelNameCard
                  key={record.index}
                  name={record.name || "(blank network name)"}
                  isSelected={selectedNetwork?.index === record.index}
                  onSelect={() => setSelectedIndex(record.index)}
                  onDelete={() => deleteNetworkByIndex(record.index)}
                  deleteTitle="Delete"
                  showActions={true}
                  onCopy={() => handleCopyNetwork(record.index)}
                  copyTitle="Copy Network"
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
            {filteredNetworks.length === 0 ? <div className="ewr-muted">No networks found.</div> : null}
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              label: "Add New Network",
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
                  ? "Click again to delete selected networks"
                  : "Disable multi-delete (no selection)",
              className: "ewr-button",
              style: multiDeleteMode && selectedForDelete.size > 0
                ? { background: "rgba(255,70,70,0.18)", border: "1px solid rgba(255,70,70,0.60)" }
                : undefined,
            },
            {
              key: "import",
              label: "Import Network",
              icon: <IconImport className="btnSvg" />,
              disabled: !networks.length,
              title: "Import networks from another network.dat",
              onClick: handleImportNetworks,
              className: "ewr-button",
            },
            {
              key: "external",
              label: "External Editing",
              icon: <IconGrid className="btnSvg" />,
              disabled: !networks.length,
              title: "Export / import CSV for bulk edits",
              onClick: () => setExternalEditingOpen((prev) => !prev),
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
                    onClick={handleExportNetworksCsv}
                    disabled={!networks.length}
                    title="Export networks to CSV"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="ewr-button"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={handleImportNetworksCsv}
                    disabled={!networks.length}
                    title="Import networks from CSV"
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
                    onClick={() => setSelectedForDelete(new Set(filteredNetworks.map((record) => record.index)))}
                    disabled={!filteredNetworks.length}
                    title="Select all currently listed networks"
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
                <div className="ewr-modalTitle">Import Networks</div>
                <div className="ewr-modalSub">
                  Source: <span className="ewr-mono">{importSourcePath ? importSourcePath.split(/[\/]/).pop() : "network.dat"}</span>
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
                  placeholder="Filter networks by name…"
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                />

                <button
                  className="ewr-button ewr-buttonSmall"
                  type="button"
                  onClick={() => {
                    const all = new Set(filteredImportRows.filter((row) => !row.duplicateName).map((row) => row.sourceIndex));
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
                {filteredImportRows.length === 0 ? (
                  <div className="ewr-muted">No networks found.</div>
                ) : (
                  filteredImportRows.map((row) => {
                    const checked = importSelection.has(row.sourceIndex);
                    const disabled = row.duplicateName;
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
                      ? "Blank network name"
                      : row.duplicateInSource
                        ? "Duplicate in source file"
                        : "Duplicate network name";
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
                            {row.name || "(blank network name)"}
                            <span style={badgeStyle}>{badgeText}</span>
                          </span>
                          <span className="ewr-muted">
                            Source ID {row.sourceId}{disabled ? ` • ${blockedReason}` : ""}
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
                Selected: {importSelection.size} / {importRows.length}
              </div>

              <button className="ewr-button" type="button" onClick={closeImportModal}>
                Cancel
              </button>

              <button
                className="ewr-button ewr-buttonOrange"
                type="button"
                onClick={commitImportedNetworks}
                disabled={!Array.from(importSelection).some((sourceIndex) => importRows.some((row) => row.sourceIndex === sourceIndex && !row.duplicateName))}
              >
                Import Selected
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <RightPanelShell header={header}>
        <div style={{ paddingBottom: 24 }}>
          {!selectedNetwork ? (
            <div className="ewr-muted">Open a network.dat file to begin.</div>
          ) : (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 28, fontWeight: 950, lineHeight: 1.05 }}>{selectedNetwork.name || "(blank network name)"}</div>
                <div className="ewr-muted" style={{ marginTop: 6, fontSize: 16 }}>
                  {`Record #${selectedNetwork.index} — Network ID ${selectedNetwork.networkId}`}
                </div>
              </div>

              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Network Details</div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-formRow">
                    <label className="ewr-field">
                      <div className="ewr-label">Network Name (20)</div>
                      <input
                        className="ewr-input"
                        value={selectedNetwork.name}
                        onChange={(e) => patchSelectedField("name", truncateAscii(e.target.value, 20))}
                      />
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, alignItems: "end" }}>
                    <label className="ewr-field">
                      <div className="ewr-label">Production Values</div>
                      <NumericCell
                        value={String(clamp(selectedNetwork.productionValues, 0, 70))}
                        inputMode="numeric"
                        onCommit={(next) => patchSelectedField("productionValues", clamp(Number(next) || 0, 0, 70) as any)}
                      />
                    </label>

                    <label className="ewr-filterTile" style={{ alignSelf: "end", minWidth: 130 }}>
                      <input
                        type="checkbox"
                        checked={!!selectedNetwork.generic}
                        onChange={(e) => patchSelectedField("generic", e.target.checked as any)}
                      />
                      <span className="ewr-filterTileLabel">Generic</span>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                {(["early", "prime", "late", "graveyard"] as SlotKey[]).map((slot) => renderSlotSection(slot))}
              </div>
            </>
          )}
        </div>
      </RightPanelShell>
    </div>
  );
}
