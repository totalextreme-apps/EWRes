import { useMemo, useState } from "react";

import { open, save } from "@tauri-apps/plugin-dialog";
import {exists, readFile, writeFile, copyFile, mkdir} from "@tauri-apps/plugin-fs";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { IconPlus, IconImport, IconGrid, IconChecklist } from "./components/icons/EwrIcons";
import { EditorHeader } from "./components/rightpanel/EditorHeader";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";

import { parseAlterDat, type AlterEgoRecord } from "./ewr/parseAlterDat";
import { validateAlterDatBytes } from "./ewr/validateAlterDat";
import { writeAlterDat } from "./ewr/writeAlterDat";

import { alertWarning, confirmWarning } from "./utils/dialogs";
import { withUtf8Bom } from "./ewr/textEncoding";

// ---------- CSV helpers (External Editing) ----------
function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type CsvRecord = Record<string, string>;

function csvEscape(val: any): string {
  const s = String(val ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
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
        const next = line[i + 1];
        if (next === '"') {
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

function parseCsv(text: string): { headers: string[]; rows: CsvRecord[] } {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => String(h ?? "").trim());
  const rows: CsvRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: CsvRecord = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = String(cols[c] ?? "");
    }
    rows.push(row);
  }
  return { headers, rows };
}

function parseIntOrNull(v: any): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

type Props = {
  workspaceRoot: string;
  alterDataPath?: string;
};

function clampStr25(v: any): string {
  const s = String(v ?? "");
  return s.length <= 25 ? s : s.slice(0, 25);
}

function normalizeRecords(input: AlterEgoRecord[]): AlterEgoRecord[] {
  return input.map((r, i) => ({
    ...r,
    index: i,
  }));
}

function makeBlankRecord(index: number, headCarry: number): AlterEgoRecord {
  return { index, primaryName: "", alterEgos: Array(9).fill(""), _headCarry: headCarry & 0xff };
}

export default function AlterEgosEditor(props: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);

  const [records, setRecords] = useState<AlterEgoRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [search, setSearch] = useState<string>("");
  const [dirty, setDirty] = useState<boolean>(false);

  type SortMode = "id" | "name";
  const [sortMode, setSortMode] = useState<SortMode>("name");

  const [multiDeleteMode, setMultiDeleteMode] = useState<boolean>(false);
  const [multiDeleteSelected, setMultiDeleteSelected] = useState<Set<number>>(new Set());

  // Import (from another alter.dat)
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<
    Array<{
      sourceIndex: number;
      primaryName: string;
      record: AlterEgoRecord;
      blockedReason?: string;
    }>
  >([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());
  const [importSearch, setImportSearch] = useState<string>("");
  const [importInfo, setImportInfo] = useState<string>("");

  // External Editing (CSV)
  const [externalEditingOpen, setExternalEditingOpen] = useState<boolean>(false);

  const selected = records[selectedIndex] ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;

    return records.filter((r) => {
      const primary = (r.primaryName ?? "").toLowerCase();
      if (primary.includes(q)) return true;
      for (const a of r.alterEgos ?? []) {
        if (String(a ?? "").toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [records, search]);

  const listItems = useMemo(() => {
    const base = filtered.slice();
    if (sortMode === "name") {
      base.sort((a, b) => {
        const an = (a.primaryName ?? "").trim().toLowerCase();
        const bn = (b.primaryName ?? "").trim().toLowerCase();
        if (an === bn) return a.index - b.index;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn);
      });
    } else {
      base.sort((a, b) => a.index - b.index);
    }
    return base;
  }, [filtered, sortMode]);

  function exitMultiDeleteMode() {
    setMultiDeleteMode(false);
    setMultiDeleteSelected(new Set());
  }

  function toggleMultiDeleteSelection(i: number) {
    setMultiDeleteSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function deleteSelectedRecords() {
    if (!multiDeleteSelected.size) return;
    const ok = confirmWarning(
      `Delete ${multiDeleteSelected.size} Alter Ego record(s)?\n\nThis removes records from alter.dat (the file shrinks) and shifts record numbers.`
    );
    if (!ok) return;

    const toDelete = Array.from(multiDeleteSelected).sort((a, b) => b - a);
    setRecords((prev) => {
      const next = prev.slice();
      for (const idx of toDelete) {
        if (idx >= 0 && idx < next.length) next.splice(idx, 1);
      }
      return normalizeRecords(next);
    });

    setSelectedIndex((prev) => {
      const newLen = Math.max(0, records.length - toDelete.length);
      if (newLen <= 0) return 0;
      return Math.min(prev, newLen - 1);
    });

    setDirty(true);
    exitMultiDeleteMode();
  }

  // NOTE: Do NOT auto-load alter.dat when the user sets/opens the DATA folder.
  // Only load when the user clicks "Load from DATA".

  async function loadFromPath(path: string) {
    try {
      const ok = await exists(path);
      if (!ok) {
        alertWarning("alter.dat not found in the selected DATA folder.");
        return;
      }
      const u8 = await readFile(path);
      validateAlterDatBytes(u8);
      const parsed = parseAlterDat(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
      setFilePath(path);
      setRawBytes(u8);
      setRecords(parsed);
      setSelectedIndex(0);
      setDirty(false);
    } catch (e: any) {
      alertWarning(`Load failed: ${String(e?.message ?? e)}`);
    }
  }

  function recordHasDuplicates(r: AlterEgoRecord): boolean {
    const seen = new Set<string>();
    const vals = [r.primaryName, ...(r.alterEgos ?? [])]
      .map((s) => String(s ?? "").trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    for (const v of vals) {
      if (seen.has(v)) return true;
      seen.add(v);
    }
    return false;
  }

  // Import from another alter.dat (select records to append)
  async function onImportAlterEgos() {
    if (!rawBytes || !records.length) {
      alertWarning("Load alter.dat first.");
      return;
    }

    try {
      const picked = await open({
        title: "Import alter egos from another alter.dat",
        multiple: false,
        filters: [{ name: "EWR alter.dat", extensions: ["dat"] }],
      });
      if (!picked) return;
      const importPath = Array.isArray(picked) ? picked[0] : picked;
      if (typeof importPath !== "string") return;

      const bytes = await readFile(importPath);
      validateAlterDatBytes(bytes);
      const parsed = parseAlterDat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

      const existingNames = new Set(
        records
          .map((r) => String(r.primaryName ?? "").trim().toLowerCase())
          .filter((s) => !!s)
      );

      const rows = parsed.map((r) => {
        const primary = String(r.primaryName ?? "").trim();
        const key = primary.toLowerCase();
        let blockedReason: string | undefined;
        if (!primary) blockedReason = "Blank Primary Name";
        else if (existingNames.has(key)) blockedReason = "Primary Name already exists";
        else if (recordHasDuplicates(r)) blockedReason = "Duplicate names within record";
        return {
          sourceIndex: r.index,
          primaryName: primary,
          record: r,
          blockedReason,
        };
      });

      setImportSourcePath(importPath);
      setImportRows(rows);
      setImportSelection(new Set());
      setImportSearch("");
      setImportInfo("Select record(s) to import. Imported records will be appended as NEW records with NEW IDs.");
      setImportModalOpen(true);
    } catch (e: any) {
      alertWarning(`Import load failed: ${String(e?.message ?? e)}`);
    }
  }

  const importVisibleRows = useMemo(() => {
    const q = importSearch.trim().toLowerCase();
    if (!q) return importRows;
    return importRows.filter((r) => {
      if (String(r.primaryName ?? "").toLowerCase().includes(q)) return true;
      for (const a of r.record.alterEgos ?? []) {
        if (String(a ?? "").toLowerCase().includes(q)) return true;
      }
      return String(r.sourceIndex + 1).includes(q);
    });
  }, [importRows, importSearch]);

  function closeImportModal() {
    setImportModalOpen(false);
    setImportSelection(new Set());
    setImportSearch("");
    setImportInfo("");
  }

  function toggleImportSelection(sourceIndex: number, checked: boolean) {
    setImportSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceIndex);
      else next.delete(sourceIndex);
      return next;
    });
  }

  function commitImportSelected() {
    const pickedAll = importRows.filter((r) => importSelection.has(r.sourceIndex));
    const picked = pickedAll.filter((r) => !r.blockedReason);

    if (!pickedAll.length) {
      setImportInfo("Select at least one record.");
      return;
    }
    if (!picked.length) {
      setImportInfo("All selected records are blocked.");
      return;
    }

    setRecords((prev) => {
      const appended = picked.map((r) => ({
        ...r.record,
        index: 0, // will be normalized
      }));
      return normalizeRecords(prev.concat(appended));
    });
    setDirty(true);
    closeImportModal();
  }

  // ---------- External Editing (CSV) ----------
  const ALTER_CSV_HEADERS = [
    "Record Number",
    "Primary Name",
    "Alter Ego 1",
    "Alter Ego 2",
    "Alter Ego 3",
    "Alter Ego 4",
    "Alter Ego 5",
    "Alter Ego 6",
    "Alter Ego 7",
    "Alter Ego 8",
    "Alter Ego 9",
  ];

  function recordToCsvRow(r: AlterEgoRecord): string[] {
    const row: string[] = [];
    row.push(String(Number(r.index ?? 0)));
    row.push(String(r.primaryName ?? ""));
    for (let i = 0; i < 9; i++) row.push(String(r.alterEgos?.[i] ?? ""));
    return row;
  }

  async function onExportAlterCsv() {
    try {
      if (!rawBytes || !records.length) {
        alertWarning("Load alter.dat first.");
        return;
      }

      const defaultName = filePath ? filePath.replace(/\.dat$/i, ".csv") : "alter.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const lines: string[] = [];
      lines.push(ALTER_CSV_HEADERS.map(csvEscape).join(","));
      const sorted = [...records].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
      for (const r of sorted) {
        lines.push(recordToCsvRow(r).map(csvEscape).join(","));
      }

      await writeFile(String(outPath), withUtf8Bom(lines.join("\n")));
      setExternalEditingOpen(false);
    } catch (e: any) {
      console.error(e);
      alertWarning(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  function normalizeNameKey(s: string): string {
    return (s ?? "").trim().toLowerCase();
  }

  async function onImportAlterCsv() {
    try {
      if (!rawBytes || !records.length) {
        alertWarning("Load alter.dat first.");
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

      const actual = parsed.headers.map((h) => String(h ?? "").trim());
      const altHeaders = [
        [
          "recordNumber",
          "primaryName",
          "alterEgo1",
          "alterEgo2",
          "alterEgo3",
          "alterEgo4",
          "alterEgo5",
          "alterEgo6",
          "alterEgo7",
          "alterEgo8",
          "alterEgo9",
        ],
      ];
      const matchesPrimary = ALTER_CSV_HEADERS.every((h) => actual.includes(h));
      const matchesAlt = altHeaders.some((set) => set.every((h) => actual.includes(h)));
      if (!matchesPrimary && !matchesAlt) {
        alertWarning(
          `CSV headers do not match expected format. Expected: ${ALTER_CSV_HEADERS.join(", ")} (plus optional camelCase equivalents).`
        );
        setExternalEditingOpen(false);
        return;
      }

      const get = (row: CsvRecord, keyA: string, keyB?: string) => {
        const a = row[keyA];
        if (a !== undefined) return a;
        if (keyB) return row[keyB];
        return "";
      };

      const nextList: AlterEgoRecord[] = records.map((r) => ({
        ...r,
        alterEgos: [...(r.alterEgos ?? Array(9).fill(""))],
      }));

      const headCarryDefault = Number((nextList[0] as any)?._headCarry ?? 0x34) & 0xff;

      const primaryKeyToIndex = new Map<string, number>();
      for (let i = 0; i < nextList.length; i++) {
        const k = normalizeNameKey(String(nextList[i].primaryName ?? ""));
        if (k) primaryKeyToIndex.set(k, i);
      }

      let updated = 0;
      let added = 0;
      let skipped = 0;
      let firstTouched: number | null = null;

      for (const row of parsed.rows) {
        const recStr = matchesPrimary ? get(row, "Record Number", "recordNumber") : get(row, "recordNumber");
        const primStr = matchesPrimary ? get(row, "Primary Name", "primaryName") : get(row, "primaryName");

        const recNo = parseIntOrNull(recStr);
        const desiredPrimary = clampStr25(String(primStr ?? "").trim());

        const desiredAlts: string[] = [];
        for (let i = 0; i < 9; i++) {
          const pretty = `Alter Ego ${i + 1}`;
          const camel = `alterEgo${i + 1}`;
          const v = matchesPrimary ? get(row, pretty, camel) : get(row, camel);
          desiredAlts.push(clampStr25(String(v ?? "").trim()));
        }

        // Determine target record: prefer Record Number, else match by Primary Name.
        let targetIdx: number | null = null;
        if (recNo !== null && recNo >= 0 && recNo < nextList.length) {
          targetIdx = recNo;
        } else {
          const k = normalizeNameKey(desiredPrimary);
          if (k && primaryKeyToIndex.has(k)) targetIdx = primaryKeyToIndex.get(k) ?? null;
        }

        if (targetIdx !== null) {
          const cur = nextList[targetIdx];

          // Primary name uniqueness across dataset.
          const currentPrimaryKey = normalizeNameKey(String(cur.primaryName ?? ""));
          const desiredKey = normalizeNameKey(desiredPrimary);
          if (desiredPrimary) {
            const existingAt = desiredKey ? primaryKeyToIndex.get(desiredKey) : undefined;
            if (existingAt !== undefined && existingAt !== targetIdx) {
              skipped++;
              continue;
            }
          }

          // Apply patch (empty strings are allowed and mean clear)
          if (desiredPrimary !== String(cur.primaryName ?? "")) {
            if (currentPrimaryKey) primaryKeyToIndex.delete(currentPrimaryKey);
            if (desiredKey) primaryKeyToIndex.set(desiredKey, targetIdx);
            cur.primaryName = desiredPrimary;
          }
          cur.alterEgos = desiredAlts;

          updated++;
          if (firstTouched === null) firstTouched = targetIdx;
          continue;
        }

        // Add new record
        if (!desiredPrimary) {
          skipped++;
          continue;
        }
        const desiredKey = normalizeNameKey(desiredPrimary);
        if (!desiredKey || primaryKeyToIndex.has(desiredKey)) {
          skipped++;
          continue;
        }

        const newRec: AlterEgoRecord = {
          index: nextList.length,
          primaryName: desiredPrimary,
          alterEgos: desiredAlts,
          _headCarry: headCarryDefault,
        };
        nextList.push(newRec);
        primaryKeyToIndex.set(desiredKey, newRec.index);
        added++;
        if (firstTouched === null) firstTouched = newRec.index;
      }

      setRecords(normalizeRecords(nextList));
      if (firstTouched !== null) setSelectedIndex(Math.min(firstTouched, nextList.length - 1));
      if (updated || added) setDirty(true);

      // No global banner on success (matches other editors). Errors are alerts.
      if (skipped && !updated && !added) {
        alertWarning(`Import completed but all rows were skipped (${skipped}).`);
      }
      setExternalEditingOpen(false);
    } catch (e: any) {
      console.error(e);
      alertWarning(`Import CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onSaveFile() {
    try {
      if (!records.length) return;

      const bytes = writeAlterDat(records);
      const target =
        filePath ??
        (await save({
          filters: [{ name: "EWR DAT", extensions: ["dat"] }],
          defaultPath: "alter.dat",
        }));
      if (!target || typeof target !== "string") return;

      const bakPath = buildEwresBackupPath(target);
      try {
        const bakDir = bakPath.slice(0, bakPath.lastIndexOf("/"));
        await mkdir(bakDir, { recursive: true });
        const alreadyBak = await exists(bakPath);
        if (!alreadyBak) await copyFile(target, bakPath);
      } catch {
        // non-fatal
      }

      await writeFile(target, bytes);
      setFilePath(target);
      setRawBytes(bytes);
      setDirty(false);
    } catch (e: any) {
      alertWarning(`Save failed: ${String(e?.message ?? e)}`);
    }
  }

  async function onCloseFile() {
    if (!filePath && !records.length) return;

    if (dirty) {
      const ok = confirmWarning(
        "You have unsaved changes. Save before closing?\n\nOK = Save, Cancel = Close without saving"
      );
      if (ok) {
        await onSaveFile();
        // If still dirty, save was cancelled or failed.
        if (dirty) return;
      }
    }

    setFilePath(null);
    setRawBytes(null);
    setRecords([]);
    setSelectedIndex(0);
    setSearch("");
    setDirty(false);
    exitMultiDeleteMode();
  }

  function setRecPatch(index: number, patch: Partial<AlterEgoRecord>) {
    setRecords((prev) => {
      const next = prev.map((r, i) => (i === index ? ({ ...r, ...patch } as AlterEgoRecord) : r));
      return next;
    });
    setDirty(true);
  }

  function setAlterSlot(slot: number, value: string) {
    if (!selected) return;
    const next = [...(selected.alterEgos ?? [])];
    while (next.length < 9) next.push("");
    next[slot] = clampStr25(value);
    setRecPatch(selected.index, { alterEgos: next });
  }

  function deleteRecord(indexToDelete: number, confirmFirst = true) {
    if (confirmFirst) {
      const ok = confirmWarning(
        `Delete this Alter Ego record?\n\nThis removes the record from alter.dat (the file shrinks) and shifts record numbers.`
      );
      if (!ok) return;
    }

    const newLen = Math.max(0, records.length - 1);

    setRecords((prev) => {
      const next = prev.slice();
      next.splice(indexToDelete, 1);
      return normalizeRecords(next);
    });

    // Move selection to a valid index
    setSelectedIndex(() => {
      if (newLen <= 0) return 0;
      return Math.min(indexToDelete, newLen - 1);
    });

    setDirty(true);
  }

  function addNewRecord() {
    // Native editor's New creates a new record; we append one.
    const headCarry = records[0]?._headCarry ?? 0x34;
    const newIndex = records.length;
    setSelectedIndex(newIndex);
    setRecords((prev) => normalizeRecords(prev.concat([makeBlankRecord(newIndex, headCarry)])));
    setDirty(true);
  }

  return (
    <div className="ewr-app">
      {/* LEFT PANEL */}
      <div className="ewr-panel ewr-left">
        <div className="ewr-panelHeader">
          <LeftPanelFileActions
            title="Alter Egos"
            subtitle="alter.dat"
            loadFromData={{
              disabled: !props.workspaceRoot || !props.alterDataPath,
              onClick: () => props.alterDataPath && loadFromPath(props.alterDataPath),
              title: !props.workspaceRoot ? "Select a DATA folder first" : "Load alter.dat from selected DATA folder",
            }}
            closeFile={{ onClick: onCloseFile, label: "Close File" }}
            saveFile={{
              disabled: !records.length || !rawBytes || !dirty,
              onClick: onSaveFile,
              title: dirty ? "Save alter.dat" : "No changes to save",
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
              searchPlaceholder="Search (primary / alter ego / record #)"
              sortValue={sortMode}
              onSortChange={(v) => setSortMode(v as SortMode)}
              sortOptions={[
                { value: "id", label: "Sort: ID" },
                { value: "name", label: "Sort: Name" },
              ]}
              showingCount={listItems.length}
              totalCount={records.length}
            />

            <div style={{ padding: "10px 14px 14px" }}>
              {listItems.map((r) => {
                const label = (r.primaryName ?? "").trim() ? r.primaryName : `(Empty #${r.index + 1})`;
                const isSelected = r.index === selectedIndex;
                const checked = multiDeleteSelected.has(r.index);

                return (
                  <LeftPanelNameCard
                    key={r.index}
                    name={label}
                    isSelected={isSelected}
                    leading={
                      multiDeleteMode ? (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleMultiDeleteSelection(r.index);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${label} for deletion`}
                        />
                      ) : null
                    }
                    onSelect={() => {
                      if (multiDeleteMode) {
                        toggleMultiDeleteSelection(r.index);
                        return;
                      }
                      setSelectedIndex(r.index);
                    }}
                    onCopy={() => {
                      /* Copy disabled */
                    }}
                    onDelete={() => deleteRecord(r.index, false)}
                    copyTitle="Copy (disabled)"
                    deleteTitle="Delete record"
                    disableCopy
                  />
                );
              })}
            </div>
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              label: "Add New Alter Ego",
              icon: <IconPlus className="btnSvg" />,
              onClick: addNewRecord,
              disabled: !records.length && !rawBytes,
              title: "Add a new alter ego record",
            },
            {
              key: "multi",
              label:
                multiDeleteMode
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
                deleteSelectedRecords();
              },
              disabled: !records.length,
              title: !multiDeleteMode
                ? "Multi-delete alter ego records"
                : multiDeleteSelected.size
                  ? "Delete selected"
                  : "Cancel multi-delete",
            },
            {
              key: "import",
              label: "Import Alter Ego",
              icon: <IconImport className="btnSvg" />,
              onClick: onImportAlterEgos,
              disabled: !records.length || !rawBytes,
              title: !records.length || !rawBytes ? "Load alter.dat first" : "Import records from another alter.dat",
            },
            {
              key: "external",
              label: "External Editing",
              icon: <IconGrid className="btnSvg" />,
              className: "ewr-button ewr-buttonYellow",
              onClick: () => setExternalEditingOpen((v) => !v),
              disabled: !records.length,
              title: !records.length ? "Load alter.dat first" : "Export / import CSV for external editing",
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
                    onClick={() => setMultiDeleteSelected(new Set(listItems.map((it) => it.index)))}
                    disabled={!listItems.length}
                    title="Select all visible records"
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
                    onClick={() => onExportAlterCsv()}
                    disabled={!records.length}
                    title="Export alter egos to CSV"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="ewr-button ewr-buttonSmall"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => onImportAlterCsv()}
                    disabled={!records.length}
                    title="Import alter egos from a CSV"
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
            title={selected ? `Editing: ${(selected.primaryName ?? "").trim() || "(blank)"}` : "Alter Egos"}
            leftPills={[
              "Category: Alter Egos",
              <>
                Loaded: <b>{records.length || 0}</b>
              </>,
              selected ? `Record #${selected.index} — ID ${selected.index + 1}` : null,
            ]}
            rightPills={[dirty ? "Unsaved changes" : filePath ? "alter.dat loaded" : "No file loaded"]}
          />
        }
      >
        {!selected ? (
          <div className="ewr-muted">Load alter.dat to begin.</div>
        ) : (
          <>
            <div className="ewr-section">
              <div className="ewr-sectionHeader">
                <div className="ewr-sectionTitle">Primary Name</div>
              </div>
              <div className="ewr-sectionBody">
                <div className="ewr-grid ewr-gridAuto">
                  <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                    <div className="ewr-label">Primary Name (25)</div>
                    <input
                      className="ewr-input"
                      value={selected.primaryName ?? ""}
                      maxLength={25}
                      onChange={(e) => setRecPatch(selected.index, { primaryName: clampStr25(e.target.value) })}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="ewr-section">
              <div className="ewr-sectionHeader">
                <div className="ewr-sectionTitle">Alter Ego Slots</div>
              </div>
              <div className="ewr-sectionBody">
                <div className="ewr-grid ewr-gridAuto">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div className="ewr-field" key={i}>
                      <div className="ewr-label">Alter Ego {i + 1} (25)</div>
                      <input
                        className="ewr-input"
                        value={selected.alterEgos?.[i] ?? ""}
                        maxLength={25}
                        onChange={(e) => setAlterSlot(i, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </RightPanelShell>

      {importModalOpen ? (
        <div className="ewr-modalOverlay" onMouseDown={closeImportModal} role="dialog" aria-modal="true">
          <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ewr-modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">Import Alter Egos</div>
                <div className="ewr-modalSub">
                  Source alter.dat: <span className="ewr-mono">{importSourcePath ? importSourcePath.split(/[\\/]/).pop() : ""}</span>
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
                  placeholder="Filter records by primary / alter ego…"
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                />

                <button
                  className="ewr-button ewr-buttonSmall"
                  type="button"
                  onClick={() => {
                    const all = new Set(importVisibleRows.filter((r) => !r.blockedReason).map((r) => r.sourceIndex));
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
                {importVisibleRows.length === 0 ? (
                  <div className="ewr-muted">No records found.</div>
                ) : (
                  importVisibleRows.map((r) => {
                    const checked = importSelection.has(r.sourceIndex);
                    const disabled = !!r.blockedReason;
                    const badgeLabel = disabled ? "Blocked" : "Importable";
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
                      <label key={`imp-alter-${r.sourceIndex}`} className="ewr-importRow" style={{ opacity: disabled ? 0.55 : 1 }}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={checked}
                          onChange={(e) => toggleImportSelection(r.sourceIndex, e.target.checked)}
                        />
                        <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span>
                            {r.primaryName || "(blank name)"}
                            <span style={badgeStyle}>{badgeLabel}</span>
                            <span className="ewr-muted" style={{ marginLeft: 8, fontWeight: 500 }}>
                              #{r.sourceIndex + 1}
                            </span>
                          </span>
                          {r.blockedReason ? <span className="ewr-muted">{r.blockedReason}</span> : null}
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
                Selected: <b>{importSelection.size}</b> / {importRows.length}
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