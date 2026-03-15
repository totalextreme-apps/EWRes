import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { open, save } from "@tauri-apps/plugin-dialog";
import {exists, readFile, writeFile, copyFile, mkdir} from "@tauri-apps/plugin-fs";

import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { parseTeamsDat, type Team } from "./ewr/parseTeamsDat";
import { validateTeamsDatBytes } from "./ewr/validateTeamsDat";
import { writeTeamsDat } from "./ewr/writeTeamsDat";

import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import LeftPanelSearchHeader from "./components/leftpanel/LeftPanelSearchHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import LeftPanelActionGrid from "./components/leftpanel/LeftPanelActionGrid";
import { IconChecklist, IconGrid, IconImport, IconPlus } from "./components/icons/EwrIcons";
import { EditorHeader } from "./components/rightpanel/EditorHeader";

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
  teamsDataPath?: string;
  wrestlerDataPath?: string;
};

type SortKey = "record" | "name";

// ---------- CSV helpers (mirrors wrestler/staff external editor) ----------
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
      // Ignore and let \n handle line end
      continue;
    }

    cur += ch;
  }

  // tail
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

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

function yesNoToBool(s: string): boolean {
  const v = (s ?? "").trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

function boolToYesNo(b: boolean): string {
  return b ? "Yes" : "No";
}

function parseIntOrNull(v: any): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

type ImportTeamRow = {
  sourceIndex: number; // original record index in source file
  sourceTeam: Team;
  teamName: string;
  partner1Name: string;
  partner2Name: string;
  mappedPartner1Id: number;
  mappedPartner2Id: number;
  blockedReason: string | null; // null => importable
};

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function truncateAscii(s: string, maxLen: number) {
  const raw = String(s ?? "");
  return raw.length <= maxLen ? raw : raw.slice(0, maxLen);
}

function clampStr(s: any, maxLen: number) {
  const raw = String(s ?? "").trim();
  return truncateAscii(raw, maxLen);
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function normQuery(q: string) {
  return q.trim().toLowerCase();
}

function deriveTeamKey(t: { partner1Id: number; partner2Id: number }) {
  const a = Number(t.partner1Id || 0);
  const b = Number(t.partner2Id || 0);
  if (a <= 0 || b <= 0) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}-${hi}`;
}


export default function TeamsEditor(props: Props) {
  const [status, setStatus] = useState<string>("");
  const [filePath, setFilePath] = useState<string>(props.teamsDataPath ?? "");
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Wrestler lookup (for partner selection)
  const [workers, setWorkers] = useState<Worker[]>([]);
  const workersById = useMemo(() => {
    const m = new Map<number, Worker>();
    for (const w of workers) m.set(w.id, w);
    return m;
  }, [workers]);

  // Left panel
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filters
  const [filterActive, setFilterActive] = useState<"" | "yes" | "no">("");
  const [filterExpMin, setFilterExpMin] = useState<string>("");
  const [filterExpMax, setFilterExpMax] = useState<string>("");
  const [filterFinisherNone, setFilterFinisherNone] = useState<boolean>(false);

  // Multi-delete
  const [multiDeleteMode, setMultiDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());

  // Import Teams (from another teams.dat + wrestler.dat)
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importInfo, setImportInfo] = useState<string>("");
  const [importSearch, setImportSearch] = useState<string>("");
  const [importRows, setImportRows] = useState<ImportTeamRow[]>([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set()); // sourceIndex set
  const [importSourceTeamsPath, setImportSourceTeamsPath] = useState<string>("");
  const [importSourceWrestlerPath, setImportSourceWrestlerPath] = useState<string>("");

  const [externalEditingOpen, setExternalEditingOpen] = useState<boolean>(false);

  // Partner autocomplete
  const [p1Query, setP1Query] = useState("");
  const [p2Query, setP2Query] = useState("");
  const [p1Open, setP1Open] = useState(false);
  const [p2Open, setP2Open] = useState(false);
  const p1Ref = useRef<HTMLDivElement | null>(null);
  const p2Ref = useRef<HTMLDivElement | null>(null);

  const selectedTeam = teams[selectedIndex] ?? null;

  // --- file I/O ---
  async function openTeamsFromPath(path: string) {
    setStatus("");
    try {
      const bytes = await readFile(path);
      validateTeamsDatBytes(bytes);
      const parsed = parseTeamsDat(bytes);

      setFilePath(path);
      setRawBytes(bytes);
      setTeams(parsed.teams);
      setSelectedIndex(parsed.teams[0]?.index ?? 0);
      setDirty(false);
      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
      setStatus(`Loaded: ${parsed.teams.length} tag teams`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Open failed: ${e?.message ?? String(e)}`);
    }
  }

  async function openWrestlersForLookup(path: string) {
    try {
      const bytes = await readFile(path);
      const parsed = parseWrestlerDat(toArrayBuffer(bytes));
      setWorkers(parsed);
    } catch (e) {
      console.error(e);
      // Lookup is optional; UI will show missing workers.
    }
  }

  async function onLoadFromData() {
    if (!props.teamsDataPath) return;
    await openTeamsFromPath(props.teamsDataPath);
    if (props.wrestlerDataPath) await openWrestlersForLookup(props.wrestlerDataPath);
  }

  async function onSaveTeams() {
    if (!filePath) {
      setStatus("No teams.dat path. Use Open File first.");
      return;
    }
    try {
      const bakPath = buildEwresBackupPath(filePath);
      try {
        const bakDir = bakPath.slice(0, bakPath.lastIndexOf("/"));
        await mkdir(bakDir, { recursive: true });
        const alreadyBak = await exists(bakPath);
        if (!alreadyBak) await copyFile(filePath, bakPath);
      } catch {
        // non-fatal
      }

      const nextBytes = writeTeamsDat(
        teams.map((t, i) => ({ ...t, index: i })),
        rawBytes ?? undefined
      );
      await writeFile(filePath, nextBytes);
      setRawBytes(nextBytes);
      setDirty(false);
      setStatus(`Saved: ${teams.length} tag teams`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Save failed: ${e?.message ?? String(e)}`);
    }
  }

  // --- import teams ---
  function closeImportModal() {
    setImportModalOpen(false);
    setImportInfo("");
    setImportSearch("");
    setImportRows([]);
    setImportSelection(new Set());
    setImportSourceTeamsPath("");
    setImportSourceWrestlerPath("");
  }

  function toggleImportSelection(sourceIndex: number, checked: boolean) {
    setImportSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceIndex);
      else next.delete(sourceIndex);
      return next;
    });
  }

  function buildUniqueImportedTeamName(base: string, existingNames: Set<string>) {
    const trimmed = base.trim() || "Imported Team";
    if (!existingNames.has(trimmed)) return trimmed;
    for (let n = 1; n < 9999; n++) {
      const cand = `${trimmed} (${n})`;
      if (!existingNames.has(cand)) return cand;
    }
    return `${trimmed} (Imported)`;
  }

  async function onImportTeams() {
    setStatus("");
    if (!rawBytes || !teams.length) {
      setStatus("Load teams.dat first.");
      return;
    }
    if (!workers.length) {
      setStatus("Load wrestler.dat first (needed to validate imported partner names). Use Load from DATA or open wrestler.dat in Wrestlers editor.");
      return;
    }

    try {
      const pickedTeams = await open({
        title: "Import from another teams.dat",
        multiple: false,
        filters: [{ name: "EWR teams.dat", extensions: ["dat"] }],
      });
      if (!pickedTeams) return;
      const teamsPath = Array.isArray(pickedTeams) ? pickedTeams[0] : pickedTeams;

      const sourceTeamsBytes = await readFile(teamsPath);
      validateTeamsDatBytes(sourceTeamsBytes);
      const parsedTeams = parseTeamsDat(sourceTeamsBytes);

      // Attempt to auto-locate wrestler.dat in the same folder.
      let sourceWrestlerPath = teamsPath.replace(/teams\.dat$/i, "wrestler.dat");
      let sourceWrestlerBytes: Uint8Array | null = null;
      if (sourceWrestlerPath !== teamsPath) {
        try {
          if (await exists(sourceWrestlerPath)) {
            sourceWrestlerBytes = await readFile(sourceWrestlerPath);
          }
        } catch {
          // ignore
        }
      }
      if (!sourceWrestlerBytes) {
        const pickedWrestlers = await open({
          title: "Select wrestler.dat for the same dataset (needed to resolve partner names)",
          multiple: false,
          filters: [{ name: "EWR wrestler.dat", extensions: ["dat"] }],
        });
        if (!pickedWrestlers) return;
        sourceWrestlerPath = Array.isArray(pickedWrestlers) ? pickedWrestlers[0] : pickedWrestlers;
        sourceWrestlerBytes = await readFile(sourceWrestlerPath);
      }

      const sourceWorkers = parseWrestlerDat(toArrayBuffer(sourceWrestlerBytes));
      const sourceWorkersById = new Map<number, Worker>();
      for (const w of sourceWorkers) sourceWorkersById.set(w.id, w);

      // Build exact fullName -> workerId mapping for CURRENT dataset.
      const nameCounts = new Map<string, number>();
      for (const w of workers) {
        const nm = String(w.fullName ?? "").trim();
        if (!nm) continue;
        nameCounts.set(nm, (nameCounts.get(nm) ?? 0) + 1);
      }
      const currentByFullName = new Map<string, number>();
      for (const w of workers) {
        const nm = String(w.fullName ?? "").trim();
        if (!nm) continue;
        if ((nameCounts.get(nm) ?? 0) === 1) currentByFullName.set(nm, w.id);
      }

      const existingPairKeys = new Set<string>();
      for (const t of teams) {
        const k = deriveTeamKey(t);
        if (k) existingPairKeys.add(k);
      }

      const rows: ImportTeamRow[] = parsedTeams.teams
        .map((t) => {
          const teamName = String(t.teamName ?? "").trim() || "(blank team name)";
          const p1w = sourceWorkersById.get(t.partner1Id);
          const p2w = sourceWorkersById.get(t.partner2Id);
          const p1Name = String(p1w?.fullName ?? "").trim();
          const p2Name = String(p2w?.fullName ?? "").trim();

          let reason: string | null = null;
          let mapped1 = 0;
          let mapped2 = 0;

          if (!p1Name || !p2Name) {
            reason = "Missing partner full name in source wrestler.dat";
          } else {
            const m1 = currentByFullName.get(p1Name) ?? 0;
            const m2 = currentByFullName.get(p2Name) ?? 0;
            if (!m1 || !m2) {
              reason = "Partner not found in current wrestler.dat (requires exact Full Name match)";
            } else {
              mapped1 = m1;
              mapped2 = m2;

              if (mapped1 === mapped2) {
                reason = "Partner 1 and Partner 2 cannot be the same worker";
              } else {
                const k = deriveTeamKey({ partner1Id: mapped1, partner2Id: mapped2 });
                if (k && existingPairKeys.has(k)) {
                  reason = "Team already exists in current teams.dat";
                }
              }
            }

            // Ambiguous full-name collision in current dataset
            if (!reason) {
              if ((nameCounts.get(p1Name) ?? 0) > 1 || (nameCounts.get(p2Name) ?? 0) > 1) {
                reason = "Ambiguous Full Name match in current wrestler.dat (duplicate names)";
              }
            }
          }

          return {
            sourceIndex: t.index,
            sourceTeam: t,
            teamName,
            partner1Name: p1Name || "(unknown)",
            partner2Name: p2Name || "(unknown)",
            mappedPartner1Id: mapped1,
            mappedPartner2Id: mapped2,
            blockedReason: reason,
          };
        })
        .sort((a, b) => {
          // Importable teams first, then blocked teams. Within each group, sort alphabetically by team name.
          const aBlocked = a.blockedReason ? 1 : 0;
          const bBlocked = b.blockedReason ? 1 : 0;
          if (aBlocked !== bBlocked) return aBlocked - bBlocked;
          return a.teamName.toLowerCase().localeCompare(b.teamName.toLowerCase());
        });

      const importableCount = rows.filter((r) => !r.blockedReason).length;
      setImportSourceTeamsPath(teamsPath);
      setImportSourceWrestlerPath(sourceWrestlerPath);
      setImportRows(rows);
      setImportSelection(new Set());
      setImportSearch("");
      setImportInfo(
        importableCount
          ? "Select team(s) to import. Only teams with both partners matched to current wrestler.dat and not already present are selectable."
          : "No importable teams found. Every team was blocked by duplicate team keys and/or missing partner matches."
      );
      setImportModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import load failed: ${e?.message ?? String(e)}`);
    }
  }

  function commitImportSelected() {
    try {
      if (!importRows.length) {
        setImportInfo("No import file loaded.");
        return;
      }
      const picked = importRows.filter((r) => importSelection.has(r.sourceIndex) && !r.blockedReason);
      if (!picked.length) {
        setImportInfo("Select at least one importable team.");
        return;
      }

      const existingNames = new Set(teams.map((t) => String(t.teamName ?? "").trim()).filter(Boolean));
      const newTeams: Team[] = [];

      for (const r of picked) {
        const src = r.sourceTeam;
        const name = truncateAscii(buildUniqueImportedTeamName(String(src.teamName ?? "Imported Team"), existingNames), 25);
        existingNames.add(name);

        const p1 = Number(r.mappedPartner1Id || 0);
        const p2 = Number(r.mappedPartner2Id || 0);
        if (!p1 || !p2 || p1 === p2) continue;

        const next: Team = {
          index: 0,
          teamName: name,
          partner1Id: p1,
          partner2Id: p2,
          finisher: truncateAscii(String(src.finisher ?? "None"), 25),
          experience: clamp(Number(src.experience ?? 0), 0, 100),
          active: !!src.active,
          _raw: new Uint8Array(59),
        };
        newTeams.push(next);
      }

      if (!newTeams.length) {
        setImportInfo("Nothing was imported (all selected rows were invalid after mapping).");
        return;
      }

      setTeams((prev) => {
        const merged = [...prev, ...newTeams].map((t, i) => ({ ...t, index: i }));
        return merged;
      });
      setDirty(true);
      setStatus(`Imported ${newTeams.length} team(s). Click Save to write to disk.`);
      closeImportModal();
    } catch (e: any) {
      console.error(e);
      setImportInfo(`Import failed: ${e?.message ?? String(e)}`);
    }
  }

  // --- list derivation ---
  const filteredTeams = useMemo(() => {
    const q = normQuery(search);
    let list = teams;

    // Apply filters
    if (filterActive) {
      const want = filterActive === "yes";
      list = list.filter((t) => !!t.active === want);
    }

    const expMin = filterExpMin.trim() === "" ? null : clamp(Number(filterExpMin), 0, 100);
    const expMax = filterExpMax.trim() === "" ? null : clamp(Number(filterExpMax), 0, 100);
    if (expMin !== null || expMax !== null) {
      list = list.filter((t) => {
        const v = clamp(Number(t.experience ?? 0), 0, 100);
        if (expMin !== null && v < expMin) return false;
        if (expMax !== null && v > expMax) return false;
        return true;
      });
    }

    if (filterFinisherNone) {
      list = list.filter((t) => String(t.finisher ?? "").trim().toLowerCase() === "none");
    }

    if (q) {
      list = list.filter((t) => {
        const name = (t.teamName ?? "").toLowerCase();
        if (name.includes(q)) return true;
        const p1 = workersById.get(t.partner1Id);
        const p2 = workersById.get(t.partner2Id);
        const p1n = String(p1?.fullName ?? p1?.shortName ?? "").toLowerCase();
        const p2n = String(p2?.fullName ?? p2?.shortName ?? "").toLowerCase();
        return p1n.includes(q) || p2n.includes(q);
      });
    }

    const sorted = [...list].sort((a, b) => {
      if (sortKey === "record") return (a.index ?? 0) - (b.index ?? 0);
      const an = String(a.teamName ?? "").trim().toLowerCase();
      const bn = String(b.teamName ?? "").trim().toLowerCase();
      return an.localeCompare(bn);
    });

    return sorted;
  }, [teams, search, sortKey, workersById, filterActive, filterExpMin, filterExpMax, filterFinisherNone]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterActive) n++;
    if (filterExpMin.trim() !== "") n++;
    if (filterExpMax.trim() !== "") n++;
    if (filterFinisherNone) n++;
    return n;
  }, [filterActive, filterExpMin, filterExpMax, filterFinisherNone]);

  const importVisibleTeams = useMemo(() => {
    const q = normQuery(importSearch);
    if (!q) return importRows;
    return importRows.filter((r) => {
      const hay = `${r.teamName} ${r.partner1Name} ${r.partner2Name}`.toLowerCase();
      return hay.includes(q);
    });
  }, [importRows, importSearch]);

  function clearAllFilters() {
    setFilterActive("");
    setFilterExpMin("");
    setFilterExpMax("");
    setFilterFinisherNone(false);
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
          <div className="ewr-label">Active</div>
          <div className="ewr-filterTileGrid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="ewr-filterTile ewr-filterTileStack">
              <span className="ewr-filterTileLabel">Active status</span>
              <EwrSelectCompat className="ewr-input ewr-filterTileSelect" value={filterActive} onChange={(e) => setFilterActive(e.target.value as any)}>
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </EwrSelectCompat>
            </label>
          </div>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Experience (0–100)</div>
          <div className="ewr-rangeRow">
            <input
              className="ewr-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              placeholder="Min"
              value={filterExpMin}
              onChange={(e) => setFilterExpMin(e.target.value)}
            />
            <input
              className="ewr-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              placeholder="Max"
              value={filterExpMax}
              onChange={(e) => setFilterExpMax(e.target.value)}
            />
          </div>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Finisher</div>
          <div className="ewr-filterTileGrid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="ewr-checkboxRow ewr-filterTile">
              <input
                className="ewr-filterTileControl"
                type="checkbox"
                checked={filterFinisherNone}
                onChange={(e) => setFilterFinisherNone(e.target.checked)}
              />
              <span className="ewr-filterTileLabel">None</span>
            </label>
          </div>
        </div>
      </div>
    </div>


  );

  // --- helpers ---
  function setTeamPatch(idx: number, patch: Partial<Team>) {
    setTeams((prev) => {
      const next = [...prev];
      const cur = next[idx];
      if (!cur) return prev;
      next[idx] = { ...cur, ...patch };
      return next;
    });
    setDirty(true);
  }

  function addNewTeam() {
    const blank: Team = {
      index: teams.length,
      teamName: "New Team",
      partner1Id: 0,
      partner2Id: 0,
      finisher: "None",
      experience: 0,
      active: true,
      _raw: new Uint8Array(59),
    };
    setTeams((prev) => [...prev, blank]);
    setSelectedIndex(teams.length);
    setDirty(true);
    setStatus("Added new team. Click Save to write to disk.");
  }

  function makeUniqueCopyName(base: string, list: Team[]) {
    const trimmedBase = (base ?? "").trim() || "New Team";
    const existing = new Set(list.map((t) => (t.teamName ?? "").trim()));
    if (!existing.has(trimmedBase)) return trimmedBase;

    let i = 1;
    while (existing.has(`${trimmedBase} (${i})`)) i++;
    return `${trimmedBase} (${i})`;
  }

  function copySingleTeam(teamIndex: number) {
    const src = teams[teamIndex];
    if (!src) return;

    const newName = makeUniqueCopyName((src.teamName ?? "New Team").trim(), teams);

    const copy: Team = {
      index: teams.length,
      teamName: truncateAscii(newName, 25),
      // Rule: copied teams start with blank partners
      partner1Id: 0,
      partner2Id: 0,
      finisher: truncateAscii(src.finisher ?? "None", 25) || "None",
      experience: clamp(Number(src.experience ?? 0), 0, 100),
      active: !!src.active,
      _raw: new Uint8Array(59),
    };

    setTeams((prev) => [...prev, copy]);
    setSelectedIndex(teams.length);
    setDirty(true);
    setStatus("Copied team. Partners cleared; set Partner 1 and Partner 2 before saving.");
  }

  // ---------- External Editing (CSV) ----------
  const TEAMS_CSV_HEADERS = [
    "Record #",
    "Team Name",
    "Active (Yes/No)",
    "Partner 1",
    "Partner 2",
    "Finisher",
    "Experience",
  ];

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

  async function onExportTeamsCsv() {
    try {
      if (!rawBytes) {
        setStatus("Load teams.dat first.");
        return;
      }
      const defaultName = filePath ? filePath.replace(/\.dat$/i, ".csv") : "teams.csv";
      const outPath = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!outPath) return;

      const workerById = new Map<number, Worker>();
      for (const w of workers) workerById.set(Number((w as any).id ?? 0), w);

      const lines: string[] = [];
      lines.push(TEAMS_CSV_HEADERS.map(csvEscape).join(","));
      const sorted = [...teams].sort((a, b) => Number(a.index) - Number(b.index));
      for (const t of sorted) {
        const p1 = workerById.get(Number(t.partner1Id ?? 0));
        const p2 = workerById.get(Number(t.partner2Id ?? 0));
        const row = [
          Number(t.index ?? 0),
          String(t.teamName ?? ""),
          boolToYesNo(Boolean(t.active)),
          normalizeFullName((p1 as any)?.fullName ?? ""),
          normalizeFullName((p2 as any)?.fullName ?? ""),
          String(t.finisher ?? ""),
          Number(t.experience ?? 0),
        ]
          .map(csvEscape)
          .join(",");
        lines.push(row);
      }

      await writeFile(outPath, new TextEncoder().encode(lines.join("\n")));
      setExternalEditingOpen(false);
      setStatus(`Exported CSV: ${outPath}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Export CSV failed: ${e?.message ?? String(e)}`);
    }
  }

  async function onImportTeamsCsv() {
    try {
      if (!rawBytes) {
        setStatus("Load teams.dat first.");
        return;
      }
      if (!workers.length) {
        setStatus("Load wrestler.dat first (needed to match partners by Full Name).");
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

      const actual = parsed.headers.map((h) => String(h ?? "").trim());
      const missing = TEAMS_CSV_HEADERS.filter((h) => !actual.includes(h));
      if (missing.length) {
        setStatus(`CSV header mismatch. Missing: ${missing.join(", ")}`);
        setExternalEditingOpen(false);
        return;
      }

      const nameToIds = buildFullNameLookup(workers);

      let updated = 0;
      let added = 0;
      let skipped = 0;

      const nextList: Team[] = teams.map((t) => ({ ...t, _raw: new Uint8Array(t._raw) }));

      function makeUniqueName(base: string) {
        const existing = new Set(nextList.map((t) => (t.teamName ?? "").trim()));
        if (!existing.has(base)) return base;
        let i = 1;
        while (existing.has(`${base} (${i})`)) i++;
        return `${base} (${i})`;
      }

const keyToIndex = new Map<string, number>();
function teamKey(aId: number, bId: number) {
  const a = Number(aId ?? 0);
  const b = Number(bId ?? 0);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}-${hi}`;
}
// Seed existing partner-pair keys from the current file.
for (let i = 0; i < nextList.length; i++) {
  const t = nextList[i];
  const a = Number(t.partner1Id ?? 0);
  const b = Number(t.partner2Id ?? 0);
  if (!a || !b || a === b) continue;
  keyToIndex.set(teamKey(a, b), i);
}

      for (const row of parsed.rows) {
        const recNo = parseIntOrNull(row["Record #"]);
        const teamNameRaw = String(row["Team Name"] ?? "");
        const activeRaw = String(row["Active (Yes/No)"] ?? "");
        const p1Name = normalizeFullName(String(row["Partner 1"] ?? ""));
        const p2Name = normalizeFullName(String(row["Partner 2"] ?? ""));
        const finisherRaw = String(row["Finisher"] ?? "");
        const expRaw = parseIntOrNull(row["Experience"]);

        // Partner rules: must exist, must be unique, must map to EXACTLY ONE worker id.
        const p1Ids = p1Name ? nameToIds.get(p1Name) ?? [] : [];
        const p2Ids = p2Name ? nameToIds.get(p2Name) ?? [] : [];
        if (p1Ids.length !== 1 || p2Ids.length !== 1) {
          skipped++;
          continue;
        }
        const partner1Id = Number(p1Ids[0] ?? 0);
        const partner2Id = Number(p2Ids[0] ?? 0);
        if (!partner1Id || !partner2Id || partner1Id === partner2Id) {
          skipped++;
          continue;
        }

        const active = yesNoToBool(activeRaw);
        const experience = clamp(Number(expRaw ?? 0), 0, 100);
        const finisher = clampStr(finisherRaw, 25) || "None";
        const teamName = clampStr(teamNameRaw, 25);

        // Prefer matching by partner-pair (order-insensitive). This prevents duplicate teams
// with the same wrestlers under a different name (e.g., "New Age Outlaws" -> "Voodoo Kin Mafia").
const key = teamKey(partner1Id, partner2Id);
const existingIdx = keyToIndex.get(key);

if (existingIdx !== undefined) {
  const cur = nextList[existingIdx];
  nextList[existingIdx] = {
    ...cur,
    teamName: teamName || cur.teamName,
    active,
    // partners remain the same pair by definition of the key, but we still assign for clarity
    partner1Id,
    partner2Id,
    finisher,
    experience,
  };
  updated++;
  continue;
}

// Fallback: update by Record # when in range, but do not create a duplicate partner-pair.
if (recNo !== null && recNo >= 0 && recNo < nextList.length) {
  const cur = nextList[recNo];

  // If this record previously had a key, remove it before changing partners.
  const oldA = Number(cur.partner1Id ?? 0);
  const oldB = Number(cur.partner2Id ?? 0);
  if (oldA && oldB && oldA !== oldB) {
    const oldKey = teamKey(oldA, oldB);
    if (keyToIndex.get(oldKey) === recNo) keyToIndex.delete(oldKey);
  }

  nextList[recNo] = {
    ...cur,
    teamName: teamName || cur.teamName,
    active,
    partner1Id,
    partner2Id,
    finisher,
    experience,
  };

  // Register the new key for this record.
  keyToIndex.set(key, recNo);

  updated++;
} else {
  const blank: Team = {
    index: nextList.length,
    teamName: makeUniqueName(teamName || "New Team"),
    partner1Id,
    partner2Id,
    finisher,
    experience,
    active,
    _raw: new Uint8Array(59),
  };
  nextList.push(blank);
  keyToIndex.set(key, nextList.length - 1);
  added++;
}

      }

      // Normalize indices and enforce global partner rule one more time.
      const finalList = nextList
        .filter((t) => Number(t.partner1Id ?? 0) !== Number(t.partner2Id ?? 0))
        .map((t, i) => ({ ...t, index: i }));

      setTeams(finalList);
      if (added || updated) {
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

  function toggleMultiDelete() {
    setStatus("");
    setMultiDeleteMode((prev) => {
      const next = !prev;
      if (!next) setSelectedForDelete(new Set());
      return next;
    });
  }

  function toggleSelectedForDelete(idx: number, checked: boolean) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (checked) next.add(idx);
      else next.delete(idx);
      return next;
    });
  }

  function commitMultiDelete() {
    if (!selectedForDelete.size) {
      setStatus("No teams selected for deletion.");
      return;
    }
    const indicesDesc = Array.from(selectedForDelete).sort((a, b) => b - a);
    const ok = window.confirm(`Delete ${indicesDesc.length} team(s)?`);
    if (!ok) return;

    setTeams((prev) => prev.filter((t) => !selectedForDelete.has(t.index)).map((t, i) => ({ ...t, index: i })));
    setSelectedForDelete(new Set());
    setMultiDeleteMode(false);
    setSelectedIndex(0);
    setDirty(true);
    setStatus(`Deleted ${indicesDesc.length} team(s). Click Save to write to disk.`);
  }

  function selectAllVisibleForDelete() {
    // Match Wrestlers/Sponsors behavior: select all CURRENTLY visible rows.
    const indices = filteredTeams.map((t) => t.index);
    setSelectedForDelete(new Set(indices));
  }

  function selectNoneForDelete() {
    setSelectedForDelete(new Set());
  }

  function deleteSingleTeam(teamIndex: number) {
    const t = teams[teamIndex];
    if (!t) return;
    const name = t.teamName?.trim() || "(blank team name)";

    setTeams((prev) => prev.filter((x) => x.index !== teamIndex).map((x, i) => ({ ...x, index: i })));
    setDirty(true);
    setStatus(`Deleted team: ${name}. Click Save to write to disk.`);

    // Adjust selection after delete
    setSelectedIndex((prevSel) => {
      if (prevSel === teamIndex) return 0;
      if (prevSel > teamIndex) return prevSel - 1;
      return prevSel;
    });
  }

  // --- autocomplete ---
  const workerOptions = useMemo(() => {
    // Basic list for autocomplete (filter later)
    return workers
      .map((w) => ({
        id: w.id,
        name: String(w.fullName ?? w.shortName ?? "").trim() || `Worker #${w.id}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [workers]);

  function suggestions(q: string, excludeId?: number) {
    const qq = normQuery(q);
    if (!qq) return workerOptions.slice(0, 25);
    const out = workerOptions.filter((o) => {
      if (excludeId && o.id === excludeId) return false;
      return o.name.toLowerCase().includes(qq) || String(o.id).includes(qq);
    });
    return out.slice(0, 25);
  }

  // close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (p1Ref.current && !p1Ref.current.contains(t)) setP1Open(false);
      if (p2Ref.current && !p2Ref.current.contains(t)) setP2Open(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // keep filePath in sync when workspace path changes
  useEffect(() => {
    if (props.teamsDataPath) setFilePath(props.teamsDataPath);
  }, [props.teamsDataPath]);

  return (
    <>
      <div className="ewr-app">
      <div className="ewr-panel ewr-left">
        <div className="ewr-panelHeader">
          <LeftPanelFileActions
            title="Tag Teams"
            subtitle="teams.dat"
            loadFromData={{
              disabled: !props.workspaceRoot || !props.teamsDataPath,
              onClick: onLoadFromData,
              label: "Load from DATA",
            }}            closeFile={{
              onClick: async () => {
                if (!filePath && !teams.length) return;
                if (dirty) {
                  const ok = window.confirm("You have unsaved changes. Save before closing?\n\nOK = Save, Cancel = Close without saving");
                  if (ok) {
                    await onSaveTeams();
                    if (dirty) return;
                  }
                }
                setFilePath("");
                setRawBytes(null);
                setTeams([]);
                setSelectedIndex(0);
                setSearch("");
                setDirty(false);
                setStatus("Closed file.");
              },
              label: "Close File",
              disabled: !filePath && !teams.length,
              title: !filePath && !teams.length ? "No file loaded" : "Close teams.dat",
            }}
            saveFile={{
              disabled: !rawBytes || !dirty,
              onClick: onSaveTeams,
              label: "Save File",
              title: dirty ? "Save teams.dat" : "No changes to save",
            }}
          />
        </div>

        {/* Match the canonical left panel layout (padding + scroll) used by Wrestlers/Sponsors */}
        <div className="ewr-leftMiddle ewr-scroll">
          <div className="ewr-leftBody">
            <LeftPanelSearchHeader<SortKey>
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search teams / partners"
              sortValue={sortKey}
              onSortChange={setSortKey}
              sortOptions={[
                { value: "record", label: "Sort: Record" },
                { value: "name", label: "Sort: Name" },
              ]}
              showingCount={filteredTeams.length}
              totalCount={teams.length}
              filtersOpen={filtersOpen}
              onToggleFilters={() => setFiltersOpen((p) => !p)}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
            />

            {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
          </div>

          <div style={{ padding: "0 14px 14px" }}>
            {filteredTeams.map((t) => {
              const isSelected = t.index === selectedIndex;
              const displayName = t.teamName?.trim() || "(blank team name)";
              const leading = multiDeleteMode ? (
                <input
                  type="checkbox"
                  checked={selectedForDelete.has(t.index)}
                  onChange={(e) => toggleSelectedForDelete(t.index, e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 18, height: 18 }}
                  title="Select for multi-delete"
                />
              ) : undefined;

              return (
                <LeftPanelNameCard
                  key={`team-${t.index}`}
                  name={displayName}
                  isSelected={isSelected}
                  onSelect={() => setSelectedIndex(t.index)}
                  leading={leading}
                  onCopy={() => copySingleTeam(t.index)}
                  copyTitle="Copy Team"
                  onDelete={() => deleteSingleTeam(t.index)}
                  deleteTitle="Delete Team"
                />
              );
            })}
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            {
              key: "add",
              label: "Add New",
              icon: <IconPlus className="btnSvg" />,
              onClick: addNewTeam,
              className: "ewr-button ewr-buttonPrimary",
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
                if (!multiDeleteMode) return toggleMultiDelete();
                if (!selectedForDelete.size) return toggleMultiDelete();
                return commitMultiDelete();
              },
              className: "ewr-button",
              style:
                multiDeleteMode && selectedForDelete.size > 0
                  ? { background: "rgba(255,70,70,0.18)", border: "1px solid rgba(255,70,70,0.60)" }
                  : undefined,
            },
            {
              key: "import",
              label: "Import Team",
              icon: <IconImport className="btnSvg" />,
              disabled: !rawBytes || !teams.length,
              onClick: onImportTeams,
              title: "Import teams from another dataset",
            },
            {
              key: "external",
              label: "External Editing",
              icon: <IconGrid className="btnSvg" />,
              disabled: !rawBytes,
              onClick: () => setExternalEditingOpen((v) => !v),
              title: "Export / import CSV for bulk edits",
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
                    onClick={onExportTeamsCsv}
                    disabled={!rawBytes}
                    title="Export teams to CSV"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="ewr-button"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={onImportTeamsCsv}
                    disabled={!rawBytes}
                    title="Import teams from CSV"
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
                    onClick={selectAllVisibleForDelete}
                    title="Select all visible tag teams"
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

              {/* Status is already reflected in the header pills; avoid duplicating messages in the left panel. */}
            </>
          }
        />
      </div>

      <div className="ewr-panel ewr-main">
        <div className="ewr-mainHeader">
          <EditorHeader
            title={
              selectedTeam
                ? `Editing: ${selectedTeam.teamName || "(blank)"}`
                : "No team selected"
            }
            leftPills={[
              "Category: Tag Teams",
              <>
                Loaded: <b>{teams.length}</b>
              </>,
              selectedTeam ? (
                <>
                  Record <b>#{selectedTeam.index}</b>
                </>
              ) : null,
              selectedTeam && deriveTeamKey(selectedTeam) ? (
                <>
                  Team Key: <b>{deriveTeamKey(selectedTeam)}</b>
                </>
              ) : null,
            ]}
            rightPills={[
              filePath ? "teams.dat loaded" : "No file loaded",
              status ? status : null,
              "Tag Teams Editor",
            ]}
          />
        </div>

        <div className="ewr-mainBody ewr-mainBodyScroll">
          {!selectedTeam ? (
            <div className="ewr-muted">Load teams.dat to begin.</div>
          ) : (
            <>
              <div className="ewr-section ewr-sectionOverflowVisible">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Team Identity</div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-grid ewr-gridAuto">
                    <div className="ewr-field">
                      <div className="ewr-label">Team Name (25)</div>
                      <input
                        className="ewr-input"
                        value={selectedTeam.teamName}
                        onChange={(e) => setTeamPatch(selectedTeam.index, { teamName: truncateAscii(e.target.value, 25) })}
                        maxLength={25}
                      />
                    </div>
                  </div>

                  <div className="ewr-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
                    <div className="ewr-field" ref={p1Ref} style={{ position: "relative" }}>
                      <div className="ewr-label">Partner 1 (Worker ID)</div>
                      <input
                        className="ewr-input"
                        value={p1Query}
                        placeholder={
                          selectedTeam.partner1Id
                            ? `${workersById.get(selectedTeam.partner1Id)?.fullName ?? workersById.get(selectedTeam.partner1Id)?.shortName ?? "(Missing)"} (#${selectedTeam.partner1Id})`
                            : "Type to search..."
                        }
                        onFocus={() => setP1Open(true)}
                        onChange={(e) => {
                          setP1Query(e.target.value);
                          setP1Open(true);
                        }}
                      />
                      {p1Open ? (
                        <div className="ewr-dropdown" style={{ position: "absolute", zIndex: 5, left: 0, right: 0, marginTop: 6, maxHeight: 260, overflow: "auto" }}>
                          <div className="ewr-dropdownItem" role="button" tabIndex={0} onClick={() => {
                            setTeamPatch(selectedTeam.index, { partner1Id: 0 });
                            setP1Query("");
                            setP1Open(false);
                          }}>
                            (Clear)
                          </div>
                          {suggestions(p1Query, selectedTeam.partner2Id).map((opt) => (
                            <div
                              key={`p1-${opt.id}`}
                              className="ewr-dropdownItem"
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setTeamPatch(selectedTeam.index, { partner1Id: opt.id });
                                setP1Query("");
                                setP1Open(false);
                              }}
                            >
                              {opt.name} <span className="ewr-muted">(#{opt.id})</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="ewr-field" ref={p2Ref} style={{ position: "relative" }}>
                      <div className="ewr-label">Partner 2 (Worker ID)</div>
                      <input
                        className="ewr-input"
                        value={p2Query}
                        placeholder={
                          selectedTeam.partner2Id
                            ? `${workersById.get(selectedTeam.partner2Id)?.fullName ?? workersById.get(selectedTeam.partner2Id)?.shortName ?? "(Missing)"} (#${selectedTeam.partner2Id})`
                            : "Type to search..."
                        }
                        onFocus={() => setP2Open(true)}
                        onChange={(e) => {
                          setP2Query(e.target.value);
                          setP2Open(true);
                        }}
                      />
                      {p2Open ? (
                        <div className="ewr-dropdown" style={{ position: "absolute", zIndex: 5, left: 0, right: 0, marginTop: 6, maxHeight: 260, overflow: "auto" }}>
                          <div className="ewr-dropdownItem" role="button" tabIndex={0} onClick={() => {
                            setTeamPatch(selectedTeam.index, { partner2Id: 0 });
                            setP2Query("");
                            setP2Open(false);
                          }}>
                            (Clear)
                          </div>
                          {suggestions(p2Query, selectedTeam.partner1Id).map((opt) => (
                            <div
                              key={`p2-${opt.id}`}
                              className="ewr-dropdownItem"
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setTeamPatch(selectedTeam.index, { partner2Id: opt.id });
                                setP2Query("");
                                setP2Open(false);
                              }}
                            >
                              {opt.name} <span className="ewr-muted">(#{opt.id})</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="ewr-section">
                <div className="ewr-sectionHeader">
                  <div className="ewr-sectionTitle">Team Attributes</div>
                </div>
                <div className="ewr-sectionBody">
                  <div className="ewr-grid ewr-gridAuto">
                    <div className="ewr-field">
                      <div className="ewr-label">Finisher (25)</div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <input
                          className="ewr-input"
                          value={selectedTeam.finisher}
                          onChange={(e) => setTeamPatch(selectedTeam.index, { finisher: truncateAscii(e.target.value, 25) })}
                          maxLength={25}
                        />
                        <button
                          type="button"
                          className="ewr-button"
                          onClick={() => setTeamPatch(selectedTeam.index, { finisher: "None" })}
                        >
                          Set None
                        </button>
                      </div>
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Experience (0–100)</div>
                      <input
                        className="ewr-input"
                        type="number"
                        min={0}
                        max={100}
                        value={selectedTeam.experience}
                        onChange={(e) =>
                          setTeamPatch(selectedTeam.index, { experience: clamp(parseInt(e.target.value || "0", 10), 0, 100) })
                        }
                      />
                    </div>

                    <div className="ewr-field">
                      <div className="ewr-label">Active</div>
                      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={!!selectedTeam.active}
                          onChange={(e) => setTeamPatch(selectedTeam.index, { active: e.target.checked })}
                        />
                        Is this tag team currently active?
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>

    {importModalOpen ? (
      <div className="ewr-modalOverlay" onMouseDown={closeImportModal} role="dialog" aria-modal="true">
        <div className="ewr-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="ewr-modalHeader">
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div className="ewr-modalTitle">Import Tag Teams</div>
              <div className="ewr-modalSub">
                Source teams.dat:{" "}
                <span className="ewr-mono">
                  {importSourceTeamsPath ? importSourceTeamsPath.split(/[\\/]/).pop() : ""}
                </span>
              </div>
              <div className="ewr-modalSub">
                Source wrestler.dat:{" "}
                <span className="ewr-mono">
                  {importSourceWrestlerPath ? importSourceWrestlerPath.split(/[\\/]/).pop() : ""}
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
                placeholder="Filter teams by name / partners…"
                value={importSearch}
                onChange={(e) => setImportSearch(e.target.value)}
              />

              <button
                className="ewr-button ewr-buttonSmall"
                type="button"
                onClick={() => {
                  const all = new Set(importVisibleTeams.filter((r) => !r.blockedReason).map((r) => r.sourceIndex));
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
              {importVisibleTeams.length === 0 ? (
                <div className="ewr-muted">No teams found.</div>
              ) : (
                importVisibleTeams.map((r) => {
                  const checked = importSelection.has(r.sourceIndex);
                  const disabled = !!r.blockedReason;
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
                      key={`imp-team-${r.sourceIndex}`}
                      className="ewr-importRow"
                      style={{ opacity: disabled ? 0.55 : 1 }}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        onChange={(e) => toggleImportSelection(r.sourceIndex, e.target.checked)}
                      />
                      <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span>
                          {r.teamName || "(no name)"}
                          <span style={badgeStyle}>{badgeLabel}</span>
                          {r.partner1Name || r.partner2Name ? (
                            <span className="ewr-muted" style={{ marginLeft: 8, fontWeight: 500 }}>
                              {r.partner1Name} / {r.partner2Name}
                            </span>
                          ) : null}
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
    </>
  );
}