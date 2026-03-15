import { useEffect, useMemo, useRef, useState } from "react";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";
import { EditorHeader } from "./components/rightpanel/EditorHeader";
import { IconPlus, IconImport, IconGrid, IconChecklist } from "./components/icons/EwrIcons";

import { open, save } from "@tauri-apps/plugin-dialog";
import {readFile, writeFile, exists, readDir, copyFile, mkdir} from "@tauri-apps/plugin-fs";

import { alertWarning, confirmWarning } from "./utils/dialogs";

import { parseRelateDat, RELATIONSHIP_TYPE_OPTIONS, type RelateRecord, type RelationshipType } from "./ewr/parseRelateDat";
import { writeRelateDat } from "./ewr/writeRelateDat";
import { validateRelateDatBytes } from "./ewr/validateRelateDat";

import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { validateWrestlerDatBytes } from "./ewr/validateWrestlerDat";

import EwrSelectCompat from "./components/inputs/EwrSelectCompat";
// ----------------- small helpers -----------------
function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// (intentionally no fs-path normalization helpers here; other editors handle dialog paths)

function normalize(s: string) {
  return (s ?? "").toString().trim();
}

function normalizeFullNameKey(s: string) {
  // Exact full-name match, but tolerant of padding / double-spaces from fixed-length DAT strings.
  return normalize(s).replace(/\s+/g, " ");
}

function pairKey(a: number, b: number) {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}|${y}`;
}

function stripParenSuffix(name: string) {
  return normalize(name).replace(/\s*\(\d+\)\s*$/i, "").trim();
}

function nextNameWithParens(baseName: string, existingLower: Set<string>, maxLen = 30) {
  const base = stripParenSuffix(baseName) || "Relationship";
  const cleanBase = base.slice(0, maxLen).trim();

  if (!existingLower.has(cleanBase.toLowerCase())) return cleanBase;

  for (let n = 2; n < 10000; n++) {
    const suffix = ` (${n})`;
    const cut = Math.max(1, maxLen - suffix.length);
    const candidate = (base.slice(0, cut).trimEnd() + suffix).slice(0, maxLen);
    if (!existingLower.has(candidate.toLowerCase())) return candidate;
  }
  return cleanBase;
}

// ----------------- CSV helpers -----------------
type CsvRow = Record<string, string>;

function csvEscape(value: any): string {
  const s = (value ?? "").toString();
  if (/[\",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
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
    if (ch === "\r") continue;
    cur += ch;
  }

  row.push(cur);
  if (row.length > 1 || row[0].trim() !== "") rows.push(row);

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  const out: CsvRow[] = [];
  for (const r of rows) {
    if (r.every((c) => (c ?? "").trim() === "")) continue;
    const rec: CsvRow = {};
    for (let i = 0; i < headers.length; i++) {
      const k = headers[i];
      if (!k) continue;
      rec[k] = (r[i] ?? "").trim();
    }
    out.push(rec);
  }
  return { headers, rows: out };
}

export type RelationshipsEditorProps = {
  workspaceRoot: string;
  relatedDataPath: string; // resolved by App workspace scan (supports relate.dat variants)
  wrestlerDataPath: string;
};

export default function RelationshipsEditor(props: RelationshipsEditorProps) {
  const [filePath, setFilePath] = useState<string>("");
  const [records, setRecords] = useState<RelateRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const [dirty, setDirty] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");

  // Workers reference for dropdowns
  const [workers, setWorkers] = useState<Worker[]>([]);
  const workerById = useMemo(() => {
    const m = new Map<number, Worker>();
    // parseWrestlerDat returns Workers with an `id` field (1-based).
    for (const w of workers) m.set(Number((w as any).id ?? 0), w);
    return m;
  }, [workers]);

  const canLoadFromData = !!props.workspaceRoot && !!props.relatedDataPath;

  // Used for button gating to match other editors.
  const loaded = !!filePath;

  const selected = selectedIndex >= 0 ? records[selectedIndex] : null;

  // Relationship name draft (typed text should not immediately commit if it would violate uniqueness)
  const [nameDraft, setNameDraft] = useState<string>("");

  // Search/sort (left panel)
  const [search, setSearch] = useState<string>("");
  const [sortMode, setSortMode] = useState<"id" | "name">("name");

  // Filters (same behavior as other editors)
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [filters, setFilters] = useState<{ type: "Everyone" | RelationshipType }>({ type: "Everyone" });
  const [draftFilters, setDraftFilters] = useState<{ type: "Everyone" | RelationshipType }>({ type: "Everyone" });

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filters.type !== "Everyone") c++;
    return c;
  }, [filters]);

  // Multi-delete mode (matches other editors)
  const [multiDeleteMode, setMultiDeleteMode] = useState<boolean>(false);
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set());

  // Wrestler typeahead (matches Tag Teams editor behavior)
  const [w1Query, setW1Query] = useState<string>("");
  const [w2Query, setW2Query] = useState<string>("");
  const [w1Open, setW1Open] = useState<boolean>(false);
  const [w2Open, setW2Open] = useState<boolean>(false);
  const w1Ref = useRef<HTMLDivElement | null>(null);
  const w2Ref = useRef<HTMLDivElement | null>(null);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = records;

    if (filters.type !== "Everyone") {
      arr = arr.filter((r) => r.type === filters.type);
    }
    if (q) {
      arr = arr.filter((r) => {
        const a = workerLabel(r.personAId).toLowerCase();
        const b = workerLabel(r.personBId).toLowerCase();
        return (
          r.name.toLowerCase().includes(q) ||
          a.includes(q) ||
          b.includes(q) ||
          r.type.toLowerCase().includes(q)
        );
      });
    }
    const sorted = arr.slice().sort((x, y) => {
      if (sortMode === "name") return x.name.localeCompare(y.name);
      return x.index - y.index;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, search, sortMode, workerById, filters.type]);

  function workerLabel(id: number): string {
    if (!id) return "None";
    const w = workerById.get(id);
    if (!w) return `#${id}`;
    const full = normalize((w as any).fullName ?? "");
    return full || `#${id}`;
  }

  const sortedWorkers = useMemo(() => {
    const arr = Array.from(workerById.entries()).map(([id, w]) => {
      const full = normalize((w as any).fullName ?? "");
      const short = normalize((w as any).shortName ?? "");
      const name = full || short || `#${id}`;
      return { id, name };
    });
    arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [workerById]);

  function suggestions(query: string, excludeId: number): { id: number; name: string }[] {
    const q = normalize(query).toLowerCase();
    const out: { id: number; name: string }[] = [];
    for (const opt of sortedWorkers) {
      if (excludeId && opt.id === excludeId) continue;
      if (!q || opt.name.toLowerCase().includes(q)) out.push(opt);
      if (out.length >= 60) break;
    }
    return out;
  }

  function findDuplicatePair(aId: number, bId: number, excludeIdx: number): { idx: number; name: string } | null {
    const k = pairKey(aId, bId);
    for (let i = 0; i < records.length; i++) {
      if (i === excludeIdx) continue;
      const r = records[i];
      if (pairKey(r.personAId, r.personBId) === k) return { idx: i, name: r.name };
    }
    return null;
  }

  function onChangeWrestler(which: 1 | 2, newId: number) {
    if (!selected) return;

    const aId = which === 1 ? newId : selected.personAId;
    const bId = which === 2 ? newId : selected.personBId;

    // Wrestler 1 / Wrestler 2 cannot be blank.

    if (!aId || !bId) {
      alertWarning("Wrestler 1 and Wrestler 2 cannot be blank.");
      return;
    }

    if (aId && bId) {
      // Disallow self-relationship.
      if (aId === bId) {
        alertWarning("Wrestler 1 and Wrestler 2 must be different.");
        return;
      }

      const dup = findDuplicatePair(aId, bId, selectedIndex);
      if (dup) {
        alertWarning(
          `Only one relationship record is allowed per wrestler pair.

Existing: "${normalize(dup.name) || "(blank name)"}" (Record ${dup.idx + 1}).`
        );
        return;
      }
    }

    if (which === 1) updateSelected({ personAId: newId });
    else updateSelected({ personBId: newId });
  }


  async function loadWorkersReference(path: string) {
    try {
      if (!path) return;
      const u8 = await readFile(path);
      const bytes = new Uint8Array(u8 as any);
      validateWrestlerDatBytes(bytes);
      const parsed = parseWrestlerDat(toArrayBuffer(bytes));
      setWorkers(parsed as any);
    } catch {
      // Best-effort: editor still works by IDs if the reference file can't load.
      setWorkers([]);
    }
  }

  useEffect(() => {
    if (props.wrestlerDataPath) loadWorkersReference(props.wrestlerDataPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.wrestlerDataPath]);

  useEffect(() => {
    setNameDraft(selected ? selected.name : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, records.length]);

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      const t = ev.target as any;
      if (w1Ref.current && !w1Ref.current.contains(t)) setW1Open(false);
      if (w2Ref.current && !w2Ref.current.contains(t)) setW2Open(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function isDuplicateName(nextName: string, excludeIndex: number) {
    const key = normalize(nextName).toLowerCase();
    if (!key) return false;
    return records.some((r, i) => i !== excludeIndex && normalize(r.name).toLowerCase() === key);
  }

  function uniqueNameFromBase(base: string, excludeIndex: number): string {
    const existing = new Set(
      records
        .map((r, i) => (i === excludeIndex ? null : normalize(r.name).toLowerCase()))
        .filter(Boolean) as string[]
    );
    return nextNameWithParens(base, existing, 30);
  }

  function shortLabel(id: number): string {
    if (!id) return "";
    const w = workerById.get(id);
    if (!w) return `#${id}`;
    const short = normalize((w as any).shortName ?? "");
    if (short) return short;
    const full = normalize((w as any).fullName ?? "");
    return full || `#${id}`;
  }

  function makeAutoName(aId: number, bId: number): string {
    const a = shortLabel(aId);
    const b = shortLabel(bId);
    const sep = " & ";
    if (!a || !b) return "";
    const max = 30;
    const available = max - sep.length;
    if (available <= 2) return (a + sep + b).slice(0, max);

    let aMax = Math.floor(available / 2);
    let bMax = available - aMax;

    // Give unused space from the shorter name to the longer name.
    if (a.length < aMax) {
      bMax = Math.min(available - a.length, available - 1);
      aMax = available - bMax;
    } else if (b.length < bMax) {
      aMax = Math.min(available - b.length, available - 1);
      bMax = available - aMax;
    }

    const aTrim = a.slice(0, Math.max(1, aMax));
    const bTrim = b.slice(0, Math.max(1, bMax));
    return (aTrim + sep + bTrim).slice(0, max);
  }

  async function loadFromPath(path: string) {
    setStatus("");
    try {
      const u8 = await readFile(path);
      const bytes = new Uint8Array(u8 as any);

      const v = validateRelateDatBytes(bytes);
      if (!v.ok) {
        setStatus(v.error ?? "Invalid relate.dat.");
        return;
      }

      const parsed = parseRelateDat(bytes);
      setFilePath(path);
      setRecords(parsed);
      setSelectedIndex(parsed.length ? 0 : -1);
      setDirty(false);
      setStatus(`Loaded ${parsed.length} relationships.`);
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    }
  }

  async function onLoadFromData() {
    if (!canLoadFromData) return;
    await loadFromPath(props.relatedDataPath);
  }

  async function onCloseFile() {
    if (!filePath && records.length === 0) return;

    if (dirty) {
      const ok = confirmWarning("You have unsaved changes. Save before closing?");
      if (ok) {
        const saved = await onSaveFile();
        if (!saved) return;
      }
    }

    setFilePath("");
    setRecords([]);
    setSelectedIndex(-1);
    setDirty(false);
    setStatus("Closed file.");
  }

  async function onSaveFile(): Promise<boolean> {
    setStatus("");
    try {
      if (!records.length) {
        alertWarning("Nothing to save.");
        return false;
      }

      // Safety: prevent corrupt relate.dat (missing wrestlers / duplicate pairs / duplicate names).
      // We require wrestler.dat to be loaded so we can validate worker IDs before writing.
      if (!workers.length) {
        alertWarning("wrestler.dat must be loaded to validate relationships before saving.");
        return false;
      }

      const seenNames = new Set<string>();
      const seenPairs = new Set<string>();
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const nm = normalize(r.name).slice(0, 30);
        if (!nm) {
          alertWarning(`Record ${i + 1} has a blank Relationship Name. Fix it before saving.`);
          return false;
        }
        const nk = nm.toLowerCase();
        if (seenNames.has(nk)) {
          alertWarning(`Duplicate Relationship Name found: "${nm}". Names must be unique before saving.`);
          return false;
        }
        seenNames.add(nk);

        const a = Number((r as any).personAId ?? 0);
        const b = Number((r as any).personBId ?? 0);
        if (!a || !b) {
          alertWarning(`Record ${i + 1} has a blank Wrestler 1 or Wrestler 2. Fix it before saving.`);
          return false;
        }
        if (a === b) {
          alertWarning(`Record ${i + 1} has the same wrestler in both slots. Fix it before saving.`);
          return false;
        }
        // Ensure both worker IDs exist in the loaded wrestler.dat reference.
        if (!workerById.get(a) || !workerById.get(b)) {
          const wa = workerById.get(a);
          const wb = workerById.get(b);
          const aLabel = wa ? normalize((wa as any).fullName) || `#${a}` : `#${a}`;
          const bLabel = wb ? normalize((wb as any).fullName) || `#${b}` : `#${b}`;
          alertWarning(
            `Record ${i + 1} references a wrestler that does not exist in wrestler.dat.\n\nWrestler 1: ${aLabel}\nWrestler 2: ${bLabel}\n\nThis would corrupt relate.dat. Fix or delete the record before saving.`
          );
          return false;
        }
        const pk = pairKey(a, b);
        if (seenPairs.has(pk)) {
          alertWarning(`Duplicate wrestler pair found (only one relationship per pair is allowed): ${pk}`);
          return false;
        }
        seenPairs.add(pk);
      }

      let outPath = filePath;
      if (!outPath) {
        const picked = await save({
          title: "Save relate.dat",
          defaultPath: "relate.dat",
          filters: [{ name: "EWR relate.dat", extensions: ["dat"] }],
        });
        if (!picked) return false;
        outPath = String(picked);
      }

      const bytes = writeRelateDat(records);

      const bakPath = buildEwresBackupPath(outPath);
      try {
        const bakDir = bakPath.slice(0, bakPath.lastIndexOf("/"));
        await mkdir(bakDir, { recursive: true });
        const alreadyBak = await exists(bakPath);
        if (!alreadyBak) await copyFile(outPath, bakPath);
      } catch {
        // non-fatal
      }

      await writeFile(outPath, bytes);
      setFilePath(outPath);
      setDirty(false);
      setStatus("Saved.");
      return true;
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
      return false;
    }
  }

  function updateSelected(patch: Partial<RelateRecord>) {
    if (!selected) return;
    setRecords((prev) => {
      const next = prev.slice();
      next[selectedIndex] = { ...next[selectedIndex], ...patch };
      return next.map((r, i) => ({ ...r, index: i })); // keep indexes stable after edits
    });
    setDirty(true);
  }

  function commitNameDraft() {
    if (!selected) return;
    const next = normalize(nameDraft).slice(0, 30);
    if (!next) {
      alertWarning("Relationship Name cannot be blank.");
      setNameDraft(selected.name);
      return;
    }
    if (isDuplicateName(next, selectedIndex)) {
      const fixed = uniqueNameFromBase(next, selectedIndex);
      alertWarning(`Relationship Name must be unique.\n\nRenamed to: ${fixed}`);
      setNameDraft(fixed);
      if (fixed !== selected.name) updateSelected({ name: fixed });
      return;
    }
    if (next !== selected.name) updateSelected({ name: next });
  }

  function onAutoName() {
    if (!selected) return;
    if (!selected.personAId || !selected.personBId) {
      alertWarning("Select Wrestler 1 and Wrestler 2 before using Auto Name.");
      return;
    }
    const base = makeAutoName(selected.personAId, selected.personBId);
    if (!base) {
      alertWarning("Auto Name requires wrestler short names (or full names) to be available.");
      return;
    }
    const unique = uniqueNameFromBase(base, selectedIndex);
    setNameDraft(unique);
    if (unique !== selected.name) updateSelected({ name: unique });
  }

  function addNewRelationship() {
    const existing = new Set(records.map((r) => normalize(r.name).toLowerCase()));
    const name = nextNameWithParens("New Relationship", existing, 30);

    const rec: RelateRecord = {
      index: records.length,
      name,
      personAId: 0,
      personBId: 0,
      type: "Friendship",
    };

    setRecords((prev) => [...prev, rec].map((r, idx) => ({ ...r, index: idx })));
    setSelectedIndex(records.length);
    setDirty(true);
  }

  function deleteSelectedNoConfirm() {
    if (!selected) return;

    const idx = selectedIndex;
    setRecords((prev) => prev.filter((_, i) => i !== idx).map((r, i2) => ({ ...r, index: i2 })));
    setSelectedIndex((prevIdx) => {
      const nextLen = records.length - 1;
      if (nextLen <= 0) return -1;
      return Math.max(0, Math.min(prevIdx, nextLen - 1));
    });
    setDirty(true);
  }

  // ------------- Multi-delete (standard workflow) -------------
  function toggleMultiDeleteSelection(arrayIndex: number) {
    setMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(arrayIndex)) next.delete(arrayIndex);
      else next.add(arrayIndex);
      return next;
    });
  }

  function exitMultiDeleteMode() {
    setMultiDeleteMode(false);
    setMultiSelected(new Set());
  }

  function applyMultiDelete() {
    if (!multiSelected.size) {
      exitMultiDeleteMode();
      return;
    }

    const ok = confirmWarning(
      `Delete ${multiSelected.size} relationship${multiSelected.size === 1 ? "" : "s"}?\n\nThis will permanently remove the selected records.`
    );
    if (!ok) return;

    const kill = new Set(multiSelected);
    setRecords((prev) => prev.filter((_, i) => !kill.has(i)).map((r, i) => ({ ...r, index: i })));

    // Selection fixup
    setSelectedIndex((prevIdx) => {
      const nextLen = records.length - kill.size;
      if (nextLen <= 0) return -1;
      const sorted = Array.from(kill).sort((a, b) => a - b);

      if (kill.has(prevIdx)) {
        const before = prevIdx - 1;
        return Math.max(0, Math.min(before, nextLen - 1));
      }

      const removedBefore = sorted.filter((x) => x < prevIdx).length;
      return Math.max(0, Math.min(prevIdx - removedBefore, nextLen - 1));
    });

    setDirty(true);
    exitMultiDeleteMode();
    setStatus(`Multi-deleted ${kill.size} relationship${kill.size === 1 ? "" : "s"}. Click Save to write relate.dat.`);
  }

  // ------------- Import DAT -------------
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importRows, setImportRows] = useState<RelateRecord[]>([]);
  const [importSourcePath, setImportSourcePath] = useState<string>("");
  const [importSearch, setImportSearch] = useState<string>("");
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());

  const [importSourceWorkers, setImportSourceWorkers] = useState<Worker[]>([]);
  const importSourceWorkerById = useMemo(() => {
    const m = new Map<number, Worker>();
    for (const w of importSourceWorkers) {
      // IMPORTANT: relate.dat stores Worker IDs (the u16 id from wrestler.dat at offset 1),
      // NOT the record index. Do NOT map by index+1 here or you'll mis-resolve names whenever
      // id != (recordIndex+1), which is common in real datasets.
      // @ts-ignore
      const id = Number((w as any).id ?? 0);
      if (id > 0) m.set(id, w);
    }
    return m;
  }, [importSourceWorkers]);

  const targetWorkerByFullNameKey = useMemo(() => {
    const m = new Map<string, Worker>();
    for (const w of workers) {
      // Use a *stable* lookup key: whitespace-normalized + lowercased.
      // (Both source + target must use the same keying strategy or imports will
      // incorrectly report "Target missing" even when the worker exists.)
      const key = normalizeFullNameKey((w as any).fullName).toLowerCase();
      if (!key) continue;
      // If duplicates exist in the target roster, keep the first; importing becomes ambiguous otherwise.
      if (!m.has(key)) m.set(key, w);
    }
    return m;
  }, [workers]);



  
  const importRowsWithFlags = useMemo(() => {
    // Enforce: imports must resolve by EXACT full name match between source and target datasets.
    const existingNames = new Set(records.map((r) => normalize(r.name).toLowerCase()));
    const existingPairs = new Set(records.map((r) => pairKey(r.personAId, r.personBId)));

    return importRows.map((r) => {
      const name = normalize(r.name).slice(0, 30);

      // Resolve SOURCE wrestler full names from the source wrestler.dat (same folder as imported relate.dat).
      const srcA = importSourceWorkerById.get(r.personAId);
      const srcB = importSourceWorkerById.get(r.personBId);
      const srcAName = normalize((srcA as any)?.fullName);
      const srcBName = normalize((srcB as any)?.fullName);

      if (!name) return { ...r, __importable: false, __importReason: "Missing name." } as any;

      if (!r.personAId || !r.personBId) {
        return { ...r, __importable: false, __importReason: "Missing wrestler selection." } as any;
      }
      if (r.personAId === r.personBId) {
        return { ...r, __importable: false, __importReason: "Wrestler 1 and Wrestler 2 cannot be the same." } as any;
      }
      if (!srcAName || !srcBName) {
        return {
          ...r,
          __importable: false,
          __importReason: "Source wrestler.dat missing one or both workers (cannot name-match).",
          __srcAName: srcAName,
          __srcBName: srcBName,
        } as any;
      }

      // Map to TARGET worker IDs by exact fullName match (case-insensitive, trimmed).
      const srcAKey = normalizeFullNameKey(srcAName).toLowerCase();
      const srcBKey = normalizeFullNameKey(srcBName).toLowerCase();
      const tgtA = targetWorkerByFullNameKey.get(srcAKey);
      const tgtB = targetWorkerByFullNameKey.get(srcBKey);

      if (!tgtA || !tgtB) {
        const missing: string[] = [];
        if (!tgtA) missing.push(`Target missing: ${srcAName}`);
        if (!tgtB) missing.push(`Target missing: ${srcBName}`);
        return {
          ...r,
          __importable: false,
          __importReason: missing.join(" | "),
          __srcAName: srcAName,
          __srcBName: srcBName,
        } as any;
      }

      const nameKey = name.toLowerCase();
      if (existingNames.has(nameKey)) {
        return { ...r, __importable: false, __importReason: "Duplicate relationship name.", __srcAName: srcAName, __srcBName: srcBName } as any;
      }

      const tgtAId = Number((tgtA as any).id ?? 0);
      const tgtBId = Number((tgtB as any).id ?? 0);
      if (!tgtAId || !tgtBId) {
        return { ...r, __importable: false, __importReason: "Target wrestler is missing a valid Worker ID.", __srcAName: srcAName, __srcBName: srcBName } as any;
      }
      // Final safety: ensure the mapped IDs exist in the currently loaded target wrestler.dat
      if (!workerById.get(tgtAId) || !workerById.get(tgtBId)) {
        return { ...r, __importable: false, __importReason: `Mapped target ID not found in wrestler.dat (would corrupt): ${tgtAId}↔${tgtBId}`, __srcAName: srcAName, __srcBName: srcBName } as any;
      }

      const pk = pairKey(tgtAId, tgtBId);
      if (existingPairs.has(pk)) {
        return { ...r, __importable: false, __importReason: "Duplicate wrestler pair.", __srcAName: srcAName, __srcBName: srcBName } as any;
      }

      return {
        ...r,
        __importable: true,
        __importReason: "",
        __srcAName: srcAName,
        __srcBName: srcBName,
        __tgtAId: Number((tgtA as any).id ?? 0),
        __tgtBId: Number((tgtB as any).id ?? 0),
      } as any;
    });
  }, [importRows, records, importSourceWorkerById, targetWorkerByFullNameKey]);


  
  const importVisibleRows = useMemo(() => {
    const q = normalize(importSearch).toLowerCase();

    const base = !q
      ? importRowsWithFlags
      : importRowsWithFlags.filter((r: any) => {
          const name = normalize(r.name).toLowerCase();
          const a = normalize(r.__srcAName || "").toLowerCase();
          const b = normalize(r.__srcBName || "").toLowerCase();
          const t = String(r.type ?? "").toLowerCase();
          return name.includes(q) || a.includes(q) || b.includes(q) || t.includes(q);
        });

    // Sort: importable first (A->Z), then blocked (A->Z)
    return [...base].sort((ra: any, rb: any) => {
      const aGrp = ra.__importable ? 0 : 1;
      const bGrp = rb.__importable ? 0 : 1;
      if (aGrp !== bGrp) return aGrp - bGrp;

      const aName = normalize(ra.name).toLowerCase();
      const bName = normalize(rb.name).toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;

      const aA = normalize(ra.__srcAName || "").toLowerCase();
      const bA = normalize(rb.__srcAName || "").toLowerCase();
      if (aA < bA) return -1;
      if (aA > bA) return 1;

      const aB = normalize(ra.__srcBName || "").toLowerCase();
      const bB = normalize(rb.__srcBName || "").toLowerCase();
      if (aB < bB) return -1;
      if (aB > bB) return 1;

      return 0;
    });
  }, [importRowsWithFlags, importSearch]);


  async function startImport() {
    setStatus("");
    try {
      const chosen = await open({
        title: "Import Relationship(s)",
        multiple: false,
        filters: [{ name: "EWR relate.dat", extensions: ["dat"] }],
      });
      if (!chosen || Array.isArray(chosen)) return;

      const u8 = await readFile(String(chosen));
      const bytes = new Uint8Array(u8 as any);
      const v = validateRelateDatBytes(bytes);
      if (!v.ok) {
        setStatus(v.error ?? "Invalid relate.dat.");
        return;
      }

      
      const parsed = parseRelateDat(bytes);

      // Try to load SOURCE wrestler.dat from the same folder as the imported relate.dat.
      // IMPORTANT: do not rely on IDs across datasets; we use source wrestler.dat only to resolve
      // source IDs -> source Full Names, then map by exact Full Name into the target dataset.
      const chosenPathRaw = String(chosen);

      // Normalize a path that may be returned in different formats depending on platform.
      const chosenPath = chosenPathRaw
        .replace(/^file:\/\//i, "")
        .replace(/\\/g, "/")
        .trim();

      const lastSlash = chosenPath.lastIndexOf("/");
      const dir = lastSlash >= 0 ? chosenPath.slice(0, lastSlash) : "";

      // Preferred: scan directory entries (handles case differences / odd path formats).
      const cand1 = dir ? `${dir}/wrestler.dat` : "wrestler.dat";
      const cand2 = dir ? `${dir}/wrestlers.dat` : "wrestlers.dat";
      let sourceWorkers: Worker[] = [];
      try {
        let wPath = "";

        if (dir) {
          try {
            const entries = await readDir(dir);
            const found = entries.find((e: any) => {
              const n = String(e?.name ?? "").toLowerCase();
              return n === "wrestler.dat" || n === "wrestlers.dat";
            });
            if ((found as any)?.path) wPath = String((found as any).path);
          } catch {
            // ignore; fall back to exists() probes below
          }
        }

        if (!wPath) {
          const has1 = await exists(cand1);
          const has2 = !has1 && (await exists(cand2));
          wPath = has1 ? cand1 : has2 ? cand2 : "";
        }

        if (wPath) {
          const wu8 = await readFile(wPath);
          const wbytes = new Uint8Array(wu8 as any);
          try {
            // validateWrestlerDatBytes throws on invalid data
            validateWrestlerDatBytes(wbytes);
            sourceWorkers = parseWrestlerDat(toArrayBuffer(wbytes));
          } catch (err: any) {
            await alertWarning(
                `Source wrestler.dat is invalid.\n\n${err?.message ?? ""}`.trim() ||
                "Source wrestler.dat is invalid."
            );
          }
        } else {
          // Fallback: ask the user to locate the source wrestler.dat explicitly.
          const picked = await open({
            title: "Select source wrestler.dat",
            multiple: false,
            filters: [{ name: "DAT", extensions: ["dat"] }],
          });

          const pickedPath = (picked ? String(picked) : "")
            .replace(/^file:\/\//i, "")
            .replace(/\\/g, "/")
            .trim();

          if (pickedPath) {
            const wu8 = await readFile(pickedPath);
            const wbytes = new Uint8Array(wu8 as any);
            try {
            // validateWrestlerDatBytes throws on invalid data
            validateWrestlerDatBytes(wbytes);
            sourceWorkers = parseWrestlerDat(toArrayBuffer(wbytes));
          } catch (err: any) {
            await alertWarning(
                `Source wrestler.dat is invalid.

${err?.message ?? ""}`.trim() ||
                "Source wrestler.dat is invalid."
            );
          }
          } else {
            await alertWarning(`Could not find source wrestler.dat next to the selected relate.dat.

` +
                `To import by exact Full Name matching, the source DATA folder must include wrestler.dat.`
            );
          }
        }

      } catch (e: any) {
        await alertWarning(`Failed to load source wrestler.dat: ${e?.message ?? String(e)}`);
      }

      setImportRows(parsed);
      setImportSourceWorkers(sourceWorkers);
      setImportSourcePath(chosenPath);
      setImportSearch("");

      // Default selection: select all importable rows (based on exact full-name mapping to target).
      const targetByFullName = new Map<string, Worker>();
      for (const w of workers) {
        const k = normalize((w as any).fullName).toLowerCase();
        if (k && !targetByFullName.has(k)) targetByFullName.set(k, w);
      }
      const sourceById = new Map<number, Worker>();
      for (const w of sourceWorkers) {
        // relate.dat stores *worker id* (u16 at offset 1 in wrestler.dat), but some datasets may instead use 1-based record index.
        // We support both, but NEVER overwrite an existing mapping (worker-id must win over index collisions).
        // @ts-ignore
        const wid = typeof (w as any).id === "number" ? (w as any).id : null;
        // @ts-ignore
        const widx1 = typeof (w as any).index === "number" ? ((w as any).index as number) + 1 : null;

        if (wid != null && !sourceById.has(wid)) sourceById.set(wid, w);
        if (widx1 != null && !sourceById.has(widx1)) sourceById.set(widx1, w);
      }

      const existingNames = new Set(records.map((r) => normalize(r.name).toLowerCase()));
      const existingPairs = new Set(records.map((r) => pairKey(r.personAId, r.personBId)));
      const sel = new Set<number>();

      for (const r of parsed) {
        const name = normalize(r.name).slice(0, 30);
        if (!name) continue;
        if (!r.personAId || !r.personBId) continue;
        if (r.personAId === r.personBId) continue;

        const srcA = sourceById.get(r.personAId);
        const srcB = sourceById.get(r.personBId);
        const srcAName = normalize((srcA as any)?.fullName);
        const srcBName = normalize((srcB as any)?.fullName);
        if (!srcAName || !srcBName) continue;

        const tgtA = targetByFullName.get(srcAName.toLowerCase());
        const tgtB = targetByFullName.get(srcBName.toLowerCase());
        if (!tgtA || !tgtB) continue;

        const nameKey = name.toLowerCase();
        if (existingNames.has(nameKey)) continue;

        const tgtAId = (tgtA as any).id ?? ((tgtA as any).index + 1);
        const tgtBId = (tgtB as any).id ?? ((tgtB as any).index + 1);
        const pk = pairKey(tgtAId, tgtBId);
        if (existingPairs.has(pk)) continue;

        sel.add(r.index);
      }

      setImportSelection(sel);
      setImportOpen(true);
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    }
  }

  
  function doImport() {
    const chosen = importRowsWithFlags.filter((r: any) => importSelection.has(r.index));
    if (!chosen.length) {
      setImportOpen(false);
      return;
    }

    const existingNames = new Set(records.map((r) => normalize(r.name).toLowerCase()));
    const existingPairs = new Set(records.map((r) => pairKey(r.personAId, r.personBId)));

    const add: RelateRecord[] = [];
    for (const r of chosen) {
      // Only import rows that are explicitly marked importable (exact full-name mapping succeeded).
      if (!r.__importable) continue;

      const name = normalize(r.name).slice(0, 30);
      if (!name) continue;

      const tgtAId = Number(r.__tgtAId ?? 0);
      const tgtBId = Number(r.__tgtBId ?? 0);
      if (!tgtAId || !tgtBId) continue;
      if (tgtAId === tgtBId) continue;

      const nameKey = name.toLowerCase();
      const pk = pairKey(tgtAId, tgtBId);
      if (existingNames.has(nameKey)) continue;
      if (existingPairs.has(pk)) continue;

      existingNames.add(nameKey);
      existingPairs.add(pk);

      add.push({
        index: 0,
        name,
        personAId: tgtAId,
        personBId: tgtBId,
        type: r.type,
      });
    }

    if (!add.length) {
      setStatus("Nothing imported (all were blocked or duplicates).");
      setImportOpen(false);
      return;
    }

    setRecords((prev) => [...prev, ...add].map((rr, i) => ({ ...rr, index: i })));
    setDirty(true);
    setStatus(`Imported ${add.length} relationship(s).`);
    setImportOpen(false);
  }

  function copyRelationshipAt(arrayIndex: number) {
    if (arrayIndex < 0 || arrayIndex >= records.length) return;
    const src = records[arrayIndex];

    const existingNames = new Set(records.map((r) => normalize(r.name).toLowerCase()));
    const name = nextNameWithParens(src.name, existingNames, 30);

    const copy: RelateRecord = {
      index: 0,
      name,
      personAId: src.personAId,
      personBId: src.personBId,
      type: src.type,
    };

    setRecords((prev) => [...prev, copy].map((r, idx) => ({ ...r, index: idx })));
    setSelectedIndex(records.length);
    setDirty(true);
  }

  // ------------- External Editing (CSV) -------------
  const [externalEditingOpen, setExternalEditingOpen] = useState(false);

  const RELATIONSHIPS_CSV_HEADERS = [
    "Relationship Name",
    "Wrestler 1 (Full Name)",
    "Wrestler 2 (Full Name)",
    "Relationship Type",
  ];

  function buildFullNameLookupExact(list: Worker[]) {
    const map = new Map<string, number[]>();
    for (const w of list) {
      const key = normalizeFullNameKey((w as any).fullName ?? "");
      const id = Number((w as any).id ?? 0);
      if (!key || !id) continue;
      const arr = map.get(key) ?? [];
      arr.push(id);
      map.set(key, arr);
    }
    return map;
  }

  function coerceRelationshipType(raw: string): RelationshipType | null {
    const s = normalize(raw);
    if (!s) return null;
    const hit = RELATIONSHIP_TYPE_OPTIONS.find((o) => o.toLowerCase() === s.toLowerCase());
    return (hit as RelationshipType) ?? null;
  }

  async function onExportRelationshipsCsv() {
    try {
      if (!loaded) {
        setStatus("Load relate.dat first.");
        return;
      }
      if (!workers.length) {
        setStatus("Load wrestler.dat first (needed to export Full Names).");
        return;
      }

      const defaultName = filePath ? filePath.replace(/\.dat$/i, ".csv") : "relationships_external.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const workerById = new Map<number, Worker>();
      for (const w of workers) workerById.set(Number((w as any).id ?? 0), w);

      const lines: string[] = [];
      lines.push(RELATIONSHIPS_CSV_HEADERS.map(csvEscape).join(","));

      const sorted = [...records].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
      for (const r of sorted) {
        const w1 = workerById.get(Number(r.personAId ?? 0));
        const w2 = workerById.get(Number(r.personBId ?? 0));
        lines.push(
          [
            String(r.name ?? ""),
            normalizeFullNameKey((w1 as any)?.fullName ?? ""),
            normalizeFullNameKey((w2 as any)?.fullName ?? ""),
            String(r.type ?? ""),
          ]
            .map(csvEscape)
            .join(",")
        );
      }

      await writeFile(outPath, new TextEncoder().encode(lines.join("\n")));
      setExternalEditingOpen(false);
      setStatus(`Exported CSV: ${outPath}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onImportRelationshipsCsv() {
    try {
      if (!loaded) {
        setStatus("Load relate.dat first.");
        return;
      }
      if (!workers.length) {
        setStatus("Load wrestler.dat first (needed to match Full Names).");
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

      const actual = parsed.headers.map((hh) => String(hh ?? "").trim());
      const missing = RELATIONSHIPS_CSV_HEADERS.filter((hh) => !actual.includes(hh));
      if (missing.length) {
        setStatus(`CSV header mismatch. Missing: ${missing.join(", ")}`);
        setExternalEditingOpen(false);
        return;
      }

      const nameToIds = buildFullNameLookupExact(workers);

      const nextList: any[] = (records as any[]).map((r) => ({
        ...r,
        _raw: new Uint8Array((r as any)._raw ?? new Uint8Array(37)),
      }));

      const keyToIndex = new Map<string, number>();
      for (let i = 0; i < nextList.length; i++) {
        const r = nextList[i];
        const a = Number(r.personAId ?? 0);
        const b = Number(r.personBId ?? 0);
        if (!a || !b || a === b) continue;
        keyToIndex.set(pairKey(a, b), i);
      }

      const existingLower = new Set(nextList.map((r) => String(r.name ?? "").trim().toLowerCase()).filter(Boolean));

      let updated = 0;
      let added = 0;
      let skipped = 0;

      for (const row of parsed.rows) {
        const rawName = normalize(String((row as any)["Relationship Name"] ?? ""));
        const rawW1 = normalizeFullNameKey(String((row as any)["Wrestler 1 (Full Name)"] ?? ""));
        const rawW2 = normalizeFullNameKey(String((row as any)["Wrestler 2 (Full Name)"] ?? ""));
        const rawType = normalize(String((row as any)["Relationship Type"] ?? ""));

        if (!rawW1 || !rawW2) {
          skipped += 1;
          continue;
        }

        const ids1 = nameToIds.get(rawW1) ?? [];
        const ids2 = nameToIds.get(rawW2) ?? [];
        if (ids1.length != 1 || ids2.length != 1) {
          skipped += 1;
          continue;
        }

        const id1 = ids1[0];
        const id2 = ids2[0];
        if (!id1 || !id2 || id1 === id2) {
          skipped += 1;
          continue;
        }

        const type = coerceRelationshipType(rawType);
        if (!type) {
          skipped += 1;
          continue;
        }

        const key = pairKey(id1, id2);
        const hit = keyToIndex.get(key);

        if (hit != null) {
          const prev = nextList[hit];
          const next: any = { ...prev, personAId: id1, personBId: id2, type };

          if (rawName) {
            const prevLower = String(prev.name ?? "").trim().toLowerCase();
            const desiredLower = rawName.toLowerCase();
            if (desiredLower !== prevLower) {
              if (prevLower) existingLower.delete(prevLower);
              const unique = nextNameWithParens(rawName, existingLower, 30);
              next.name = unique;
              existingLower.add(unique.toLowerCase());
              if (prevLower && prevLower !== unique.toLowerCase()) existingLower.add(prevLower);
            }
          }

          nextList[hit] = next;
          updated += 1;
          continue;
        }

        let finalName = rawName || "Relationship";
        finalName = nextNameWithParens(finalName, existingLower, 30);
        existingLower.add(finalName.toLowerCase());

        nextList.push({
          index: 0,
          name: finalName,
          personAId: id1,
          personBId: id2,
          type,
          _raw: new Uint8Array(37),
        });
        keyToIndex.set(key, nextList.length - 1);
        added += 1;
      }

      const finalList = nextList.map((r, idx) => ({ ...r, index: idx }));
      setRecords(finalList);
      if (updated || added) setDirty(true);
      setExternalEditingOpen(false);
      setStatus(`CSV import done. Updated: ${updated}, Added: ${added}, Skipped: ${skipped}.`);
    } catch (e: any) {
      console.error(e);
      setExternalEditingOpen(false);
      setStatus(`Import CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  function clearAllFilters() {
    const cleared = { type: "Everyone" as const };
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
        <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
          <div className="ewr-label">Relationship Type</div>
          <EwrSelectCompat
            className="ewr-input"
            value={draftFilters.type}
            onChange={(e) => setDraftFilters((p) => ({ ...p, type: e.target.value as any }))}
          >
            <option value="Everyone">Any</option>
            {RELATIONSHIP_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </EwrSelectCompat>
        </div>
      </div>
    </div>
  );

  
  // ------------- Render -------------
  return (
    <div className="ewr-app">
      {/* LEFT PANEL */}
      <div className="ewr-panel ewr-left">
        <div className="ewr-panelHeader">
          <LeftPanelFileActions
            title="Relationships"
            subtitle="relate.dat"
            loadFromData={{
              disabled: !canLoadFromData,
              title: !props.workspaceRoot
                ? "Select a DATA folder first"
                : !props.relatedDataPath
                  ? "relate.dat not found in DATA folder"
                  : "Load relate.dat from DATA folder",
              onClick: onLoadFromData,
              label: "Load from DATA",
            }}
            closeFile={{
              onClick: onCloseFile,
              disabled: !filePath && records.length === 0,
              label: "Close File",
              title: "Close the loaded file",
            }}
            saveFile={{
              onClick: onSaveFile,
              disabled: !dirty || records.length === 0,
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
              searchPlaceholder="Search relationships..."
              sortValue={sortMode}
              onSortChange={(v) => setSortMode(v)}
              sortOptions={[
                { value: "id", label: "ID" },
                { value: "name", label: "Name" },
              ]}
              showingCount={list.length}
              totalCount={records.length}
              filtersOpen={filtersOpen}
              onToggleFilters={() => {
                setDraftFilters(filters);
                setFiltersOpen((v) => !v);
              }}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
            />

            {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
          </div>

          {multiDeleteMode ? (
            <div style={{ padding: "0 14px 10px" }}>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="ewr-button ewr-buttonSmall"
                  onClick={() => setMultiSelected(new Set(list.map((r) => records.findIndex((x) => x.index === r.index))))}
                >
                  Select All
                </button>
                <button type="button" className="ewr-button ewr-buttonSmall" onClick={() => setMultiSelected(new Set())}>
                  Select None
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ padding: "0 14px 14px" }}>
            {list.map((r) => {
              const idx = records.findIndex((x) => x.index === r.index);
              const isSelected = selectedIndex === idx;
              const checked = multiSelected.has(idx);
              return (
                <LeftPanelNameCard
                  key={`${r.index}-${r.name}`}
                  name={normalize(r.name)}
                  isSelected={isSelected}
                  leading={
                    multiDeleteMode ? (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleMultiDeleteSelection(idx);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${normalize(r.name) || "(blank name)"} for deletion`}
                      />
                    ) : null
                  }
                  onSelect={() => {
                    if (multiDeleteMode) {
                      toggleMultiDeleteSelection(idx);
                      return;
                    }
                    setSelectedIndex(idx);
                  }}
                  onCopy={() => copyRelationshipAt(idx)}
                  onDelete={() => {
                    setSelectedIndex(idx);
                    deleteSelectedNoConfirm();
                  }}
                  copyTitle="Copy relationship"
                  deleteTitle="Delete relationship"
                />
              );
            })}

            {!records.length ? (
              <div className="ewr-muted" style={{ padding: "10px 4px" }}>
                Open relate.dat to begin.
              </div>
            ) : null}
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              icon: <IconPlus className="btnSvg" />,
              label: "Add New Relationship",
              onClick: () => {
                if (multiDeleteMode) exitMultiDeleteMode();
                addNewRelationship();
              },
              title: "Add a new relationship",
            },
            {
              key: "multi",
              icon: <IconChecklist className="btnSvg" />,
              label: multiDeleteMode
                ? multiSelected.size > 0
                  ? `Delete Selected (${multiSelected.size})`
                  : "Cancel Multi-Delete"
                : "Multi-Delete",
              style:
                multiDeleteMode && multiSelected.size > 0
                  ? { background: "rgba(255,70,70,0.18)", border: "1px solid rgba(255,70,70,0.60)" }
                  : undefined,
              onClick: () => {
                if (!records.length) return;
                if (!multiDeleteMode) {
                  setMultiDeleteMode(true);
                  setMultiSelected(new Set());
                  return;
                }
                if (multiSelected.size === 0) {
                  exitMultiDeleteMode();
                  return;
                }
                applyMultiDelete();
              },
              disabled: !records.length,
              title: !multiDeleteMode
                ? "Multi-delete relationships"
                : multiSelected.size
                  ? "Delete selected"
                  : "Cancel multi-delete",
            },
            {
              key: "import",
              icon: <IconImport className="btnSvg" />,
              label: "Import Relationship(s)",
              onClick: () => {
                if (multiDeleteMode) exitMultiDeleteMode();
                startImport();
              },
              title: "Import from another relate.dat",
            },
            {
              key: "external",
              icon: <IconGrid className="btnSvg" />,
              label: "External Editing",
              onClick: () => {
                if (multiDeleteMode) exitMultiDeleteMode();
                setExternalEditingOpen((v) => !v);
              },
              title: "Export/import CSV",
              className: "ewr-button ewr-buttonYellow",
            },
          ]}
        
        after={
          externalEditingOpen ? (
            <div className="ewr-footerGrid ewr-footerGrid--two">
              <button
                className="ewr-button ewr-buttonSmall"
                onClick={() => void onExportRelationshipsCsv()}
                title="Export an editable CSV for external editing"
              >
                Export CSV
              </button>
              <button
                className="ewr-button ewr-buttonSmall"
                onClick={() => void onImportRelationshipsCsv()}
                title="Import an edited CSV and apply updates"
              >
                Import CSV
              </button>
            </div>
          ) : null
        }
      />

      </div>

      {/* RIGHT PANEL */}
      <RightPanelShell
        header={
          <EditorHeader
            title={selected ? `Editing: ${(selected.name ?? "").trim() || "(blank)"}` : "Relationships"}
            leftPills={[
              "Category: Relationships",
              <>
                Loaded: <b>{records.length || 0}</b>
              </>,
              selected ? `Record #${selected.index} — ID ${selected.index + 1}` : null,
            ]}
            rightPills={[filePath ? "relate.dat loaded" : "No file loaded", dirty ? "Unsaved changes" : null, status ? status : null]}
          />
        }
      >
        {!selected ? (
          <div className="ewr-muted">Load relate.dat to begin.</div>
        ) : (
          <div className="ewr-section">
            <div className="ewr-sectionHeader">
              <div className="ewr-sectionTitle">Relationship</div>
            </div>
            <div className="ewr-sectionBody">
              <div className="ewr-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                  <div className="ewr-label">Relationship Name (30)</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      className="ewr-input"
                      value={nameDraft}
                      maxLength={30}
                      onChange={(e) => setNameDraft(e.target.value.slice(0, 30))}
                      onBlur={commitNameDraft}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder="30 character max"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="ewr-button ewr-buttonSmall"
                      onClick={onAutoName}
                      title="Fill using Wrestler 1 and Wrestler 2 short names"
                      disabled={!selected.personAId || !selected.personBId}
                    >
                      Auto Name
                    </button>
                  </div>
                  <div className="ewr-muted" style={{ marginTop: 6 }}>
                    {nameDraft.length}/30
                  </div>
                </div>

                <div className="ewr-field" ref={w1Ref} style={{ position: "relative" }}>
                  <div className="ewr-label">Wrestler 1 (Worker ID)</div>
                  <input
                    className="ewr-input"
                    value={w1Query}
                    placeholder={
                      selected.personAId
                        ? `${workerById.get(selected.personAId)?.fullName ?? workerById.get(selected.personAId)?.shortName ?? "(Missing)"} (#${selected.personAId})`
                        : "Type to search..."
                    }
                    onFocus={() => setW1Open(true)}
                    onChange={(e) => {
                      setW1Query(e.target.value);
                      setW1Open(true);
                    }}
                  />
                  {w1Open ? (
                    <div className="ewr-dropdown" style={{ position: "absolute", zIndex: 5, left: 0, right: 0, marginTop: 6, maxHeight: 260, overflow: "auto" }}>
                      <div
                        className="ewr-dropdownItem"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          onChangeWrestler(1, 0);
                          setW1Query("");
                          setW1Open(false);
                        }}
                      >
                        (Clear)
                      </div>
                      {suggestions(w1Query, selected.personBId).map((opt) => (
                        <div
                          key={`w1-${opt.id}`}
                          className="ewr-dropdownItem"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            onChangeWrestler(1, opt.id);
                            setW1Query("");
                            setW1Open(false);
                          }}
                        >
                          {opt.name} <span className="ewr-muted">(#{opt.id})</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="ewr-field" ref={w2Ref} style={{ position: "relative" }}>
                  <div className="ewr-label">Wrestler 2 (Worker ID)</div>
                  <input
                    className="ewr-input"
                    value={w2Query}
                    placeholder={
                      selected.personBId
                        ? `${workerById.get(selected.personBId)?.fullName ?? workerById.get(selected.personBId)?.shortName ?? "(Missing)"} (#${selected.personBId})`
                        : "Type to search..."
                    }
                    onFocus={() => setW2Open(true)}
                    onChange={(e) => {
                      setW2Query(e.target.value);
                      setW2Open(true);
                    }}
                  />
                  {w2Open ? (
                    <div className="ewr-dropdown" style={{ position: "absolute", zIndex: 5, left: 0, right: 0, marginTop: 6, maxHeight: 260, overflow: "auto" }}>
                      <div
                        className="ewr-dropdownItem"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          onChangeWrestler(2, 0);
                          setW2Query("");
                          setW2Open(false);
                        }}
                      >
                        (Clear)
                      </div>
                      {suggestions(w2Query, selected.personAId).map((opt) => (
                        <div
                          key={`w2-${opt.id}`}
                          className="ewr-dropdownItem"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            onChangeWrestler(2, opt.id);
                            setW2Query("");
                            setW2Open(false);
                          }}
                        >
                          {opt.name} <span className="ewr-muted">(#{opt.id})</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="ewr-field" style={{ gridColumn: "1 / -1" }}>
                  <div className="ewr-label">Relationship Type</div>
                  <EwrSelectCompat
                    className="ewr-input"
                    value={selected.type}
                    onChange={(e) => updateSelected({ type: e.target.value as RelationshipType })}
                  >
                    {RELATIONSHIP_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </EwrSelectCompat>
                </div>

                {selected.personAId && selected.personBId ? (
                  <div className="ewr-muted" style={{ gridColumn: "1 / -1" }}>
                    Pair key: {pairKey(selected.personAId, selected.personBId)}
                  </div>
                ) : null}

                {workerById.size === 0 ? (
                  <div className="ewr-muted" style={{ gridColumn: "1 / -1" }}>
                    wrestlers.dat is not loaded, so wrestler search may be empty. Link a DATA folder that includes wrestlers.dat.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </RightPanelShell>

      {/* Import modal (match Wrestler import styling) */}
      {importOpen ? (
        <div
          className="ewr-modalOverlay"
          onMouseDown={() => setImportOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ewr-modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div className="ewr-modalTitle">Import Relationships</div>
                <div className="ewr-modalSub">
                  Source: <span className="ewr-mono">{importSourcePath ? importSourcePath.split(/[\\/]/).pop() : ""}</span>
                </div>
              </div>

              <button
                className="ewr-iconBtn"
                title="Close"
                onClick={() => setImportOpen(false)}
                aria-label="Close import"
              >
                ×
              </button>
            </div>

            <div className="ewr-modalBody">
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="ewr-input"
                  style={{ flex: 1, minWidth: 220 }}
                  placeholder="Filter relationships by name / wrestler / type…"
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                />

                <button
                  className="ewr-button ewr-buttonSmall"
                  type="button"
                  onClick={() => {
                    const all = new Set<number>();
                    importVisibleRows.forEach((r: any) => {
                      if (r.__importable) all.add(r.index);
                    });
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
                {importVisibleRows.length === 0 ? (
                  <div className="ewr-muted">No relationships found.</div>
                ) : (
                  importVisibleRows.map((r: any) => {
                    const checked = importSelection.has(r.index);
                    const importable = !!r.__importable;
                    const reason = String(r.__importReason || "");
                    const disabled = !importable;

                    const badgeLabel = disabled ? "Blocked" : "Importable";
                    const badgeStyle: any = disabled
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

                    const name = normalize(r.name || "(no name)");
                                        const aDisp = normalize(r.__srcAName || (r.personAId ? `#${r.personAId}` : ""));
                    const bDisp = normalize(r.__srcBName || (r.personBId ? `#${r.personBId}` : ""));
                    const line = `${name} — ${aDisp} ↔ ${bDisp} (${r.type})`;

                    return (
                      <label
                        key={`imp-rel-${r.index}`}
                        className="ewr-importRow"
                        style={{ opacity: disabled ? 0.55 : 1 }}
                      >
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={checked}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setImportSelection((prev) => {
                              const next = new Set(prev);
                              if (on) next.add(r.index);
                              else next.delete(r.index);
                              return next;
                            });
                          }}
                        />
                        <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span>
                            {line}
                            <span style={badgeStyle}>{badgeLabel}</span>
                          </span>
                          {disabled && reason ? <span className="ewr-muted">{reason}</span> : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="ewr-modalFooter">
              <div className="ewr-muted" style={{ marginRight: "auto" }}>
                Selected: {importSelection.size} / {importRowsWithFlags.length}
              </div>

              <button className="ewr-button" type="button" onClick={() => setImportOpen(false)}>
                Cancel
              </button>

              <button
                className="ewr-button ewr-buttonOrange"
                type="button"
                onClick={doImport}
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
