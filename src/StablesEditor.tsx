import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {copyFile, exists, readFile, writeFile, mkdir} from "@tauri-apps/plugin-fs";

import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { parsePromosDat, type Promo } from "./ewr/parsePromosDat";
import { parseStablesDat, type Stable } from "./ewr/parseStablesDat";
import { validateStablesDatBytes } from "./ewr/validateStablesDat";
import { writeStablesDat } from "./ewr/writeStablesDat";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";
import { EditorHeader } from "./components/rightpanel/EditorHeader";
import { IconChecklist, IconGrid, IconImport, IconPlus } from "./components/icons/EwrIcons";

function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type Props = {
  workspaceRoot: string;
  stablesDataPath?: string;
  wrestlerDataPath?: string;
  promosDataPath?: string;
};

type SortKey = "record" | "name";

type CsvRecord = Record<string, string>;

function csvEscape(value: any): string {
  const s = (value ?? "").toString();
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

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
        if (next === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ""; continue; }
    if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (ch === "\r") continue;
    cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }

  const headerRow = rows.shift() ?? [];
  const headers = headerRow.map((h) => (h ?? "").trim());
  const outRows: CsvRecord[] = [];
  for (const r of rows) {
    if (!r.some((c) => String(c ?? "").trim().length)) continue;
    const rec: CsvRecord = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      rec[key] = (r[i] ?? "").toString();
    }
    outRows.push(rec);
  }
  return { headers, rows: outRows };
}

const STABLES_CSV_HEADERS = [
  "Record #",
  "Stable Name",
  "Promotion Initials",
  "Leader",
  ...Array.from({ length: 20 }, (_, i) => `Member ${i + 1}`),
];


function truncateAscii(s: string, maxLen: number) {
  const raw = String(s ?? "");
  return raw.length <= maxLen ? raw : raw.slice(0, maxLen);
}

function norm(s: string) {
  return (s ?? "").trim().toLowerCase();
}


function createBlankStable(index: number, defaultPromotionId: number = 0): Stable {
  const raw = new Uint8Array(70);
  raw[0] = 52;
  return {
    index,
    stableName: "New Stable",
    promotionId: defaultPromotionId,
    leaderId: 0,
    memberIds: Array.from({ length: 20 }, () => 0),
    _raw: raw,
  };
}

export default function StablesEditor(props: Props) {
  const [, setStatus] = useState("");
  const [filePath, setFilePath] = useState(props.stablesDataPath ?? "");
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [dirty, setDirty] = useState(false);

  const [stables, setStables] = useState<Stable[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterPromotionId, setFilterPromotionId] = useState("");
  const [filterLeaderNone, setFilterLeaderNone] = useState(false);
  const [multiDeleteMode, setMultiDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());
  const [memberToAddId, setMemberToAddId] = useState(0);
  const [memberToRemoveId, setMemberToRemoveId] = useState(0);
  const [externalEditingOpen, setExternalEditingOpen] = useState(false);

  const selectedStable = stables[selectedIndex] ?? null;

  const workersAlpha = useMemo(() => {
    const list = [...workers];
    list.sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? ""), undefined, { sensitivity: "base" }));
    return list;
  }, [workers]);

  const workersById = useMemo(() => {
    const m = new Map<number, Worker>();
    for (const w of workers) m.set(Number(w.id || 0), w);
    return m;
  }, [workers]);

  const promosAlpha = useMemo(() => {
    const list = [...promos];
    list.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" }));
    return list;
  }, [promos]);

  const promosById = useMemo(() => {
    const m = new Map<number, Promo>();
    for (const p of promos) m.set(Number(p.id || 0), p);
    return m;
  }, [promos]);

  function normalizeFullName(s: string) {
    return (s ?? "").trim();
  }

  function buildFullNameLookup(list: Worker[]) {
    const map = new Map<string, number[]>();
    for (const w of list) {
      const k = normalizeFullName((w as any).fullName ?? "");
      if (!k) continue;
      const arr = map.get(k) ?? [];
      arr.push(Number((w as any).id ?? 0));
      map.set(k, arr);
    }
    return map;
  }

  const selectedPromoWorkersAlpha = useMemo(() => {
    const promoId = Number(selectedStable?.promotionId || 0);
    if (!promoId) return [] as Worker[];
    const list = workers.filter((w) => {
      const employerIds = [
        Number((w as any).employer1PromoId || 0),
        Number((w as any).employer2PromoId || 0),
        Number((w as any).employer3PromoId || 0),
      ];
      return employerIds.includes(promoId);
    });
    list.sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? ""), undefined, { sensitivity: "base" }));
    return list;
  }, [workers, selectedStable]);

  const currentMemberIds = useMemo(() => {
    const set = new Set<number>();
    if (!selectedStable) return set;
    for (const id of selectedStable.memberIds) {
      const n = Number(id || 0);
      if (n > 0) set.add(n);
    }
    return set;
  }, [selectedStable]);

  const leaderWorkersAlpha = useMemo(() => {
    const list = workersAlpha.filter((w) => currentMemberIds.has(Number(w.id || 0)));
    return list;
  }, [workersAlpha, currentMemberIds]);

  const addablePromoWorkersAlpha = useMemo(() => {
    return selectedPromoWorkersAlpha.filter((w) => !currentMemberIds.has(Number(w.id || 0)));
  }, [selectedPromoWorkersAlpha, currentMemberIds]);

  const removablePromoWorkersAlpha = useMemo(() => {
    return selectedPromoWorkersAlpha.filter((w) => currentMemberIds.has(Number(w.id || 0)));
  }, [selectedPromoWorkersAlpha, currentMemberIds]);


  async function onExportStablesCsv() {
    try {
      if (!stables.length) { setStatus("No stables loaded."); return; }
      const outPath = await save({
        title: "Export Stables CSV",
        defaultPath: filePath ? filePath.replace(/\.dat$/i, ".csv") : "stables.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const lines: string[] = [];
      lines.push(STABLES_CSV_HEADERS.map(csvEscape).join(","));
      for (const s of stables) {
        const promo = promosById.get(Number(s.promotionId || 0));
        const leader = workersById.get(Number(s.leaderId || 0));
        const memberNames = Array.from({ length: 20 }, (_, i) => {
          const id = Number(s.memberIds?.[i] || 0);
          return id > 0 ? (workersById.get(id)?.fullName || "") : "";
        });
        const row = [
          s.index,
          s.stableName || "",
          promo?.shortName || "",
          leader?.fullName || "",
          ...memberNames,
        ];
        lines.push(row.map(csvEscape).join(","));
      }
      const csv = "\ufeff" + lines.join("\r\n");
      await writeFile(outPath, new TextEncoder().encode(csv));
      setStatus(`Exported ${stables.length} stables to CSV.`);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message || "Failed to export CSV.");
    }
  }

  async function onImportStablesCsv() {
    try {
      if (!rawBytes) { setStatus("Open a stables.dat file first."); return; }
      const csvPath = await open({
        title: "Import Stables CSV",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!csvPath || Array.isArray(csvPath)) return;

      const bytes = await readFile(csvPath);
      let text = new TextDecoder("utf-8").decode(bytes);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const parsed = parseCsv(text);
      const fullNameLookup = buildFullNameLookup(workers);
      const promoByAnyName = new Map<string, number>();
      for (const p of promos) {
        const pid = Number(p.id || 0);
        if ((p.name || '').trim()) promoByAnyName.set(norm(p.name), pid);
        if ((p.shortName || '').trim()) promoByAnyName.set(norm(p.shortName), pid);
      }

      const next = [...stables];
      let updated = 0;
      let added = 0;

      for (const row of parsed.rows) {
        const name = truncateAscii(String(row["Stable Name"] || "").trim(), 25) || "New Stable";
        const recRaw = String(row["Record #"] || "").trim();
        const recNum = recRaw !== "" ? Number(recRaw) : NaN;
        let targetIndex = Number.isFinite(recNum) && recNum >= 0 && recNum < next.length ? recNum : -1;
        if (targetIndex < 0 && name) targetIndex = next.findIndex((s) => norm(s.stableName) === norm(name));

        const promoText = String(row["Promotion Initials"] || row["Promotion"] || "").trim();
        let promotionId = promoByAnyName.get(norm(promoText)) || 0;
        if (!promotionId) promotionId = Number(next[targetIndex]?.promotionId || promosAlpha[0]?.id || 0);

        const memberIds = Array.from({ length: 20 }, (_, i) => {
          const memberName = String(row[`Member ${i + 1}`] || "").trim();
          if (!memberName) return 0;
          const ids = fullNameLookup.get(memberName) || fullNameLookup.get(memberName.trim()) || [];
          return Number(ids[0] || 0);
        });

        let leaderId = 0;
        const leaderName = String(row["Leader"] || "").trim();
        if (leaderName) {
          const ids = fullNameLookup.get(leaderName) || fullNameLookup.get(leaderName.trim()) || [];
          leaderId = Number(ids[0] || 0);
        }
        if (leaderId > 0 && !memberIds.includes(leaderId)) {
          const emptyIdx = memberIds.findIndex((id) => !id);
          if (emptyIdx >= 0) memberIds[emptyIdx] = leaderId;
          else memberIds[0] = leaderId;
        }

        const stable = {
          index: targetIndex >= 0 ? targetIndex : next.length,
          stableName: name,
          promotionId,
          leaderId,
          memberIds,
          _raw: createBlankStable(0, promotionId)._raw,
        } as Stable;

        if (targetIndex >= 0) {
          next[targetIndex] = stable;
          updated += 1;
        } else {
          next.push(stable);
          added += 1;
        }
      }

      next.forEach((s, i) => { s.index = i; });
      setStables(next);
      setDirty(true);
      setStatus(`Imported CSV: ${updated} updated, ${added} added.`);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message || "Failed to import CSV.");
    }
  }

  async function ensureBakOnce(path: string) {
    const bak = buildEwresBackupPath(path);
    const bakDir = bak.slice(0, bak.lastIndexOf("/"));
    await mkdir(bakDir, { recursive: true });
    if (!(await exists(bak))) await copyFile(path, bak);
  }

  async function loadWorkers() {
    const path = props.wrestlerDataPath;
    if (!path) return setWorkers([]);
    try {
      const bytes = await readFile(path);
      const parsed = parseWrestlerDat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      setWorkers(parsed ?? []);
    } catch (e) {
      console.error(e);
      setWorkers([]);
    }
  }

  async function loadPromos() {
    const path = props.promosDataPath;
    if (!path) return setPromos([]);
    try {
      const bytes = await readFile(path);
      const parsed = parsePromosDat(bytes);
      setPromos(parsed.promos ?? []);
    } catch (e) {
      console.error(e);
      setPromos([]);
    }
  }

  async function openStablesFromPath(path: string) {
    setStatus("");
    try {
      const bytes = await readFile(path);
      validateStablesDatBytes(bytes);
      const parsed = parseStablesDat(bytes);
      setFilePath(path);
      setRawBytes(bytes);
      setStables(parsed.stables);
      setSelectedIndex(0);
      setDirty(false);
      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
    } catch (e: any) {
      console.error(e);
      setStatus(`Load failed: ${e?.message || e}`);
    }
  }

  useEffect(() => {
    loadWorkers();
  }, [props.wrestlerDataPath]);

  useEffect(() => {
    loadPromos();
  }, [props.promosDataPath]);

  useEffect(() => {
    if (props.stablesDataPath && props.stablesDataPath !== filePath) {
      openStablesFromPath(props.stablesDataPath);
    }
  }, [props.stablesDataPath]);

  async function handleLoadFromData() {
    if (props.stablesDataPath) return openStablesFromPath(props.stablesDataPath);
    const picked = await open({
      multiple: false,
      filters: [{ name: "DAT files", extensions: ["dat"] }],
    });
    if (typeof picked === "string") await openStablesFromPath(picked);
  }

  function handleCloseFile() {
    setFilePath("");
    setRawBytes(null);
    setStables([]);
    setSelectedIndex(0);
    setDirty(false);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());
    setStatus("Closed stables.dat");
  }

  async function handleSave() {
    if (!filePath) {
      setStatus("No stables.dat file is open.");
      return;
    }
    try {
      const normalized = stables.map((s, i) => ({ ...s, index: i }));
      const out = writeStablesDat(normalized);
      await ensureBakOnce(filePath);
      await writeFile(filePath, out);
      setRawBytes(out);
      setStables(normalized);
      setDirty(false);
      setStatus(`Saved: ${normalized.length} stables`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Save failed: ${e?.message || e}`);
    }
  }

  function patchSelected(mutator: (s: Stable) => Stable) {
    setStables((prev) => {
      if (!prev[selectedIndex]) return prev;
      const next = prev.slice();
      next[selectedIndex] = mutator({ ...next[selectedIndex], memberIds: [...next[selectedIndex].memberIds] });
      return next;
    });
    setDirty(true);
  }


  function setLeader(workerId: number) {
    patchSelected((s) => {
      const oldLeader = Number(s.leaderId || 0);
      s.leaderId = workerId;
      if ((Number(s.memberIds[0] || 0) === 0 || Number(s.memberIds[0] || 0) === oldLeader) && workerId > 0) {
        s.memberIds[0] = workerId;
      }
      return s;
    });
  }


  function addMember(workerId: number) {
    if (!workerId) return;
    patchSelected((s) => {
      if (s.memberIds.some((id) => Number(id || 0) === workerId)) return s;
      const emptySlot = s.memberIds.findIndex((id) => Number(id || 0) === 0);
      if (emptySlot >= 0) s.memberIds[emptySlot] = workerId;
      return s;
    });
    setMemberToAddId(0);
  }

  function removeMember(workerId: number) {
    if (!workerId) return;
    patchSelected((s) => {
      s.memberIds = s.memberIds.map((id) => (Number(id || 0) === workerId ? 0 : Number(id || 0)));
      if (Number(s.leaderId || 0) === workerId) s.leaderId = 0;
      return s;
    });
    setMemberToRemoveId(0);
  }

  function handleAddNew() {
    const defaultPromotionId = Number(promosAlpha[0]?.id ?? 0);
    setStables((prev) => {
      const next = [...prev, createBlankStable(prev.length, defaultPromotionId)];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setDirty(true);
    setStatus("Added new stable.");
  }

  function deleteStableByIndex(recordIndex: number) {
    const doomed = stables.find((s) => s.index === recordIndex);
    if (!doomed) return;
    setStables((prev) => prev.filter((s) => s.index !== recordIndex).map((s, i) => ({ ...s, index: i })));
    setSelectedIndex((prev) => {
      if (prev > recordIndex) return prev - 1;
      if (prev === recordIndex) return Math.max(0, prev - 1);
      return prev;
    });
    setDirty(true);
    setStatus(`Deleted stable: ${doomed.stableName || `Record #${recordIndex}`}`);
  }


  function toggleMultiDeleteMode() {
    setMultiDeleteMode((v) => !v);
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
    if (!selectedForDelete.size) return;
    setStables((prev) => prev.filter((s) => !selectedForDelete.has(s.index)).map((s, i) => ({ ...s, index: i })));
    setSelectedIndex(0);
    setDirty(true);
    setMultiDeleteMode(false);
    setStatus(`Deleted ${selectedForDelete.size} stable(s).`);
    setSelectedForDelete(new Set());
  }

  const filteredStables = useMemo(() => {
    const q = norm(search);
    let list = [...stables];

    if (filterPromotionId !== "") {
      const wantPromoId = Number(filterPromotionId || 0);
      list = list.filter((s) => Number(s.promotionId || 0) === wantPromoId);
    }

    if (filterLeaderNone) {
      list = list.filter((s) => Number(s.leaderId || 0) === 0);
    }

    if (q) {
      list = list.filter((s) => {
        const leaderName = workersById.get(Number(s.leaderId || 0))?.fullName ?? "";
        const promoName = promosById.get(Number(s.promotionId || 0))?.name ?? "";
        return [s.stableName, leaderName, promoName].some((v) => norm(String(v)).includes(q));
      });
    }

    list.sort((a, b) => {
      if (sortKey === "name") {
        const c = String(a.stableName || "").localeCompare(String(b.stableName || ""), undefined, { sensitivity: "base" });
        if (c !== 0) return c;
      }
      return a.index - b.index;
    });
    return list;
  }, [stables, search, sortKey, workersById, promosById, filterPromotionId, filterLeaderNone]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterPromotionId !== "") n++;
    if (filterLeaderNone) n++;
    return n;
  }, [filterPromotionId, filterLeaderNone]);

  function clearAllFilters() {
    setFilterPromotionId("");
    setFilterLeaderNone(false);
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
          <div className="ewr-label">Promotion</div>
          <div className="ewr-filterTileGrid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="ewr-filterTile ewr-filterTileStack">
              <span className="ewr-filterTileLabel">Promotion</span>
              <select
                className="ewr-input ewr-filterTileSelect"
                value={filterPromotionId}
                onChange={(e) => setFilterPromotionId(e.target.value)}
              >
                <option value="">Any</option>
                {promosAlpha.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Leader</div>
          <div className="ewr-filterTileGrid" style={{ gridTemplateColumns: "1fr" }}>
            <label className={`ewr-filterTile ${filterLeaderNone ? "is-on" : ""}`}>
              <input type="checkbox" checked={filterLeaderNone} onChange={(e) => setFilterLeaderNone(e.target.checked)} />
              <span className="ewr-filterTileLabel">None</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );

  const memberRows = useMemo(() => {
    if (!selectedStable) return [] as Array<{ slot: number; workerId: number; workerName: string; isLeader: boolean }>;
    return selectedStable.memberIds
      .map((id, idx) => ({
        slot: idx,
        workerId: Number(id || 0),
        workerName: Number(id || 0) ? (workersById.get(Number(id || 0))?.fullName ?? `Worker ID ${id}`) : "—",
        isLeader: Number(id || 0) > 0 && Number(id || 0) === Number(selectedStable.leaderId || 0),
      }))
      .filter((r) => r.workerId > 0);
  }, [selectedStable, workersById]);

  const header = (
    <EditorHeader
      title={selectedStable ? `Editing: ${selectedStable.stableName || "(blank stable name)"}` : "Stables Editor"}
      leftPills={selectedStable ? [
        `Category: Stables`,
        `Loaded: ${stables.length}`,
        `Record #${selectedStable.index}`,
        filePath ? `stables.dat loaded` : `No file loaded`,
        `Loaded: ${stables.length} stables`,
        `Stables Editor`,
      ] : []}
      rightPills={[]}
    />
  );

  return (
    <div className="ewr-app">
      <div className="ewr-panel ewr-left">
        <div style={{ padding: "12px 14px 0" }}>
          <LeftPanelFileActions
            title="Stables"
            subtitle="stables.dat"
            loadFromData={{ onClick: handleLoadFromData, disabled: !props.stablesDataPath && !props.workspaceRoot }}
            closeFile={{ onClick: handleCloseFile, disabled: !filePath }}
            saveFile={{ onClick: handleSave, disabled: !filePath || !dirty }}
          />
        </div>

        <div className="ewr-leftMiddle ewr-scroll">
          <div className="ewr-leftBody">
            <LeftPanelSearchHeader
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search stables / leaders"
              sortValue={sortKey}
              onSortChange={(value) => setSortKey(value as SortKey)}
              sortOptions={[
                { value: "record", label: "Sort: Record" },
                { value: "name", label: "Sort: Name" },
              ]}
              showingCount={filteredStables.length}
              totalCount={stables.length}
              filtersOpen={filtersOpen}
              onToggleFilters={() => setFiltersOpen((p) => !p)}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
            />

            {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
          </div>

          <div style={{ padding: filtersOpen ? "6px 14px 14px" : "0 14px 14px" }}>
            {filteredStables.map((s) => {
              const checked = selectedForDelete.has(s.index);
              return (
                <LeftPanelNameCard
                  key={s.index}
                  name={s.stableName || "(blank stable name)"}
                  isSelected={selectedStable?.index === s.index}
                  onSelect={() => setSelectedIndex(s.index)}
                  onCopy={() => {}}
                  disableCopy={true}
                  copyTitle="Copy coming later"
                  onDelete={() => deleteStableByIndex(s.index)}
                  deleteTitle="Delete"
                  leading={multiDeleteMode ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleSelectedForDelete(s.index, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 18, height: 18 }}
                      title="Select for multi-delete"
                    />
                  ) : undefined}
                />
              );
            })}
            {filteredStables.length === 0 ? <div className="ewr-muted">No stables found.</div> : null}
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              label: "Add New",
              icon: <IconPlus className="iconBtnSvg" />,
              onClick: handleAddNew,
              className: "ewr-button",
            },
            {
              key: "multi",
              label: multiDeleteMode
                ? (selectedForDelete.size > 0 ? `Delete Selected (${selectedForDelete.size})` : "Cancel Multi-Delete")
                : "Multi-Delete",
              icon: <IconChecklist className="iconBtnSvg" />,
              onClick: multiDeleteMode
                ? (selectedForDelete.size > 0 ? commitMultiDelete : toggleMultiDeleteMode)
                : toggleMultiDeleteMode,
              className: multiDeleteMode && selectedForDelete.size > 0 ? "ewr-button ewr-buttonRed" : "ewr-button",
              disabled: false,
            },
            {
              key: "import",
              label: "Import Stable",
              icon: <IconImport className="iconBtnSvg" />,
              disabled: true,
              title: "Not Active in Stables Editor",
              className: "ewr-button ewr-buttonDisabled",
            },
            {
              key: "external",
              label: "External Editing",
              icon: <IconGrid className="iconBtnSvg" />,
              disabled: !rawBytes,
              onClick: () => setExternalEditingOpen((v) => !v),
              title: "Export / import CSV for bulk edits",
              className: "ewr-button ewr-buttonYellow",
              style: externalEditingOpen ? { background: "rgba(255,190,70,0.12)", border: "1px solid rgba(255,190,70,0.55)" } : undefined,
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
                    onClick={onExportStablesCsv}
                    disabled={!rawBytes}
                    title="Export stables to CSV"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="ewr-button"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={onImportStablesCsv}
                    disabled={!rawBytes}
                    title="Import stables from CSV"
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
                    onClick={() => setSelectedForDelete(new Set(filteredStables.map((s) => s.index)))}
                    disabled={filteredStables.length === 0}
                    title="Select all currently listed stables"
                  >
                    Select All
                  </button>
                  <button
                    className="ewr-button ewr-buttonSmall"
                    type="button"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => setSelectedForDelete(new Set())}
                    disabled={selectedForDelete.size === 0}
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

      <RightPanelShell header={header}>
        <div style={{ paddingBottom: 24 }}>
          {!selectedStable ? (
            <div className="ewr-muted">Open a stables.dat file to begin.</div>
          ) : (
            <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 28, fontWeight: 950, lineHeight: 1.05 }}>{selectedStable.stableName || "(blank stable name)"}</div>
              <div className="ewr-muted" style={{ marginTop: 6, fontSize: 16 }}>
                {`Record #${selectedStable.index} — ${promosById.get(Number(selectedStable.promotionId || 0))?.shortName || "None"}`}
              </div>
            </div>

            <div className="ewr-section">
              <div className="ewr-sectionHeader">
                <div className="ewr-sectionTitle">Stable Details</div>
              </div>
              <div className="ewr-sectionBody">
                <div className="ewr-formRow">
                  <label className="ewr-field">
                    <div className="ewr-label">Stable Name (25)</div>
                    <input
                      className="ewr-input"
                      value={selectedStable.stableName}
                      onChange={(e) => patchSelected((s) => ({ ...s, stableName: truncateAscii(e.target.value, 25) }))}
                    />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, alignItems: "start" }}>
                  <label className="ewr-field">
                    <div className="ewr-label">Promotion</div>
                    <select
                      className="ewr-input"
                      value={selectedStable.promotionId || Number(promosAlpha[0]?.id ?? 0)}
                      onChange={(e) => {
                        const newPromoId = Number(e.target.value) | 0;
                        patchSelected((s) => ({
                          ...s,
                          promotionId: newPromoId,
                          leaderId: newPromoId === Number(s.promotionId || 0) ? s.leaderId : 0,
                          memberIds: newPromoId === Number(s.promotionId || 0)
                            ? [...s.memberIds]
                            : s.memberIds.map(() => 0),
                        }));
                        setMemberToAddId(0);
                        setMemberToRemoveId(0);
                      }}
                    >
                      {promosAlpha.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="ewr-field">
                    <div className="ewr-label">Leader</div>
                    <select className="ewr-input" value={selectedStable.leaderId} onChange={(e) => setLeader(Number(e.target.value) | 0)}>
                      <option value={0}>None</option>
                      {leaderWorkersAlpha.map((w) => (
                        <option key={w.id} value={w.id}>{w.fullName}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="ewr-section">
              <div className="ewr-sectionHeader">
                <div className="ewr-sectionTitle">Current Members</div>
              </div>
              <div className="ewr-sectionBody">
                {memberRows.length === 0 ? (
                  <div className="ewr-muted">No members assigned.</div>
                ) : (
                  <div className="ewr-stablesMembersTable" role="table" aria-label="Current stable members">
                    <div className="ewr-stablesMembersRow ewr-stablesMembersHeader" role="row">
                      <div className="ewr-stablesMembersCell" role="columnheader">Slot</div>
                      <div className="ewr-stablesMembersCell ewr-stablesMembersCell--name" role="columnheader">Worker</div>
                      <div className="ewr-stablesMembersCell" role="columnheader">Role</div>
                      <div className="ewr-stablesMembersCell" role="columnheader">Status</div>
                    </div>
                    {memberRows.map((row) => (
                      <div key={`${row.slot}-${row.workerId}`} className="ewr-stablesMembersRow" role="row">
                        <div className="ewr-stablesMembersCell" role="cell">{row.slot + 1}</div>
                        <div className="ewr-stablesMembersCell ewr-stablesMembersCell--name" role="cell">{row.workerName}</div>
                        <div className="ewr-stablesMembersCell" role="cell">{row.isLeader ? "Leader" : "Member"}</div>
                        <div className="ewr-stablesMembersCell" role="cell">
                          <button type="button" className="ewr-button ewr-buttonRed" onClick={() => removeMember(row.workerId)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="ewr-section">
              <div className="ewr-sectionHeader">
                <div className="ewr-sectionTitle">Member Controls</div>
              </div>
              <div className="ewr-sectionBody">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, alignItems: "start" }}>
                  <div className="ewr-field">
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "end" }}>
                      <select className="ewr-input" value={memberToAddId} onChange={(e) => setMemberToAddId(Number(e.target.value) | 0)}>
                        <option value={0}>Select worker to add</option>
                        {addablePromoWorkersAlpha.map((w) => (
                          <option key={w.id} value={w.id}>{w.fullName}</option>
                        ))}
                      </select>
                      <button type="button" className="ewr-button ewr-buttonGreen" onClick={() => addMember(memberToAddId)} disabled={!memberToAddId}>
                        Add Member
                      </button>
                    </div>
                  </div>

                  <div className="ewr-field">
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "end" }}>
                      <select className="ewr-input" value={memberToRemoveId} onChange={(e) => setMemberToRemoveId(Number(e.target.value) | 0)}>
                        <option value={0}>Select member to remove</option>
                        {removablePromoWorkersAlpha.map((w) => (
                          <option key={w.id} value={w.id}>{w.fullName}</option>
                        ))}
                      </select>
                      <button type="button" className="ewr-button ewr-buttonRed" onClick={() => removeMember(memberToRemoveId)} disabled={!memberToRemoveId}>
                        Remove Member
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </>
          )}
        </div>
      </RightPanelShell>
    </div>
  );
}
