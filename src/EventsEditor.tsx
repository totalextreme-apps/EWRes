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

import { parseEventDat, type EventMonthId, type EventRecord, type EventShowType } from "./ewr/parseEventDat";
import { validateEventDatBytes } from "./ewr/validateEventDat";
import { writeEventDat } from "./ewr/writeEventDat";
import { parsePromosDat, type Promo } from "./ewr/parsePromosDat";

function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type Props = {
  workspaceRoot: string;
  eventDataPath?: string;
  promosDataPath?: string;
};

type SortKey = "record" | "name";
type LookupOption = { id: number; name: string };
type FilterPick = "Everyone" | string;
type EventFilters = {
  promotionId: FilterPick;
  month: FilterPick;
  showType: FilterPick;
};

type ImportEventRow = {
  sourceIndex: number;
  name: string;
  record: EventRecord;
  duplicateName: boolean;
  missingPromotion: boolean;
  slotConflict: boolean;
};

const MONTH_OPTIONS: { value: EventMonthId; label: string }[] = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
  { value: 13, label: "Weekly" },
];

const SHOW_TYPE_OPTIONS: { value: EventShowType; label: string }[] = [
  { value: 1, label: "Pay-Per-View" },
  { value: 2, label: "Large" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Small" },
];

const CSV_HEADERS = ["Record #", "Event Name", "Promotion", "Month", "Type Of Show", "Event Date (Save File Only)"];

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function truncateName(s: string) {
  const value = String(s ?? "");
  return value.length <= 32 ? value : value.slice(0, 32);
}

function normalizeName(s: string) {
  return String(s ?? "").trim().toLowerCase();
}

function monthLabel(value: EventMonthId) {
  return MONTH_OPTIONS.find((opt) => opt.value === value)?.label ?? "January";
}

function monthFromLabel(value: string): EventMonthId | null {
  const normalized = normalizeName(value);
  const found = MONTH_OPTIONS.find((opt) => normalizeName(opt.label) === normalized);
  return found?.value ?? null;
}

function showTypeLabel(value: EventShowType) {
  return SHOW_TYPE_OPTIONS.find((opt) => opt.value === value)?.label ?? "Pay-Per-View";
}

function showTypeFromLabel(value: string): EventShowType | null {
  const normalized = normalizeName(value);
  const found = SHOW_TYPE_OPTIONS.find((opt) => normalizeName(opt.label) === normalized);
  return found?.value ?? null;
}

function normalizeIsoDate(value: string): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const month = String(Number(m[1])).padStart(2, "0");
      const day = String(Number(m[2])).padStart(2, "0");
      const year = m[3];
      m = ["", year, month, day] as RegExpMatchArray;
    }
  }
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}


function promotionNameById(list: Promo[], id: number) {
  return list.find((item) => Number(item.id) === Number(id))?.name ?? "None";
}

function promotionInitialsById(list: Promo[], id: number) {
  const promo = list.find((item) => Number(item.id) === Number(id));
  return String((promo as any)?.shortName ?? (promo as any)?.initials ?? "").trim() || "None";
}

function promoIdFromName(list: Promo[], value: string): number | null {
  const normalized = normalizeName(value);
  const found = list.find((item) => normalizeName(item.name) === normalized || normalizeName(String((item as any)?.shortName ?? "")) === normalized || normalizeName(String((item as any)?.initials ?? "")) === normalized);
  return found ? Number(found.id) : null;
}

function hasAnyEventForPromotion(records: EventRecord[], promotionId: number, excludeIndex?: number) {
  return records.some((record) => record.index !== excludeIndex && Number(record.promotionId) === Number(promotionId));
}

function eventSlotConflict(records: EventRecord[], promotionId: number, month: EventMonthId, excludeIndex?: number) {
  return records.some((record) => {
    if (record.index === excludeIndex) return false;
    if (Number(record.promotionId) !== Number(promotionId)) return false;
    if (Number(month) === 13 || Number(record.month) === 13) return true;
    return Number(record.month) === Number(month);
  });
}

function findFirstAvailableMonthForPromotion(records: EventRecord[], promotionId: number, excludeIndex?: number): EventMonthId | null {
  if (!hasAnyEventForPromotion(records, promotionId, excludeIndex)) return 1;
  if (eventSlotConflict(records, promotionId, 13, excludeIndex)) {
    for (const opt of MONTH_OPTIONS.filter((opt) => opt.value !== 13)) {
      if (!eventSlotConflict(records, promotionId, opt.value, excludeIndex)) return opt.value;
    }
    return null;
  }
  for (const opt of MONTH_OPTIONS.filter((opt) => opt.value !== 13)) {
    if (!eventSlotConflict(records, promotionId, opt.value, excludeIndex)) return opt.value;
  }
  return null;
}

function findFirstAvailableEventSlot(records: EventRecord[], promoIds: number[], preferredPromoId?: number, excludeIndex?: number) {
  const orderedPromoIds = [
    ...(preferredPromoId && promoIds.includes(preferredPromoId) ? [preferredPromoId] : []),
    ...promoIds.filter((id) => id !== preferredPromoId),
  ];

  for (const promoId of orderedPromoIds) {
    const month = findFirstAvailableMonthForPromotion(records, promoId, excludeIndex);
    if (month != null) return { promotionId: promoId, month };
  }
  return null;
}

function createBlankEvent(index: number, existingNames: string[], promotionId: number, month: EventMonthId): EventRecord {
  const raw = new Uint8Array(47);
  raw[0] = 52;
  raw.set(Uint8Array.from([0, 0, 0, 0, 64, 137, 220, 64]), 39);
  return {
    index,
    name: makeUniqueEventName("New Event", existingNames),
    promotionId,
    month,
    showType: 1,
    eventDate: null,
    _raw: raw,
  };
}

function makeUniqueEventName(baseName: string, existingNames: string[]) {
  const base = truncateName(String(baseName ?? "").trim() || "New Event");
  const taken = new Set(existingNames.map((name) => normalizeName(name)));
  if (!taken.has(normalizeName(base))) return base;

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

function csvEscape(value: any): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ""; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (ch === '\r') continue;
    cur += ch;
  }
  row.push(cur);
  if (row.length > 1 || row[0].trim() !== "") rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { rec[h] = cols[idx] ?? ""; });
    return rec;
  });
}

export default function EventsEditor(props: Props) {
  const isDataFolderWorkspace = /(^|[\/])DATA[\/]*$/i.test(String(props.workspaceRoot || "")) || /(^|[\/])DATA[\/]event\.dat$/i.test(String(props.eventDataPath || ""));

  const [status, setStatus] = useState("");
  const [filePath, setFilePath] = useState(props.eventDataPath ?? "");
  const [dirty, setDirty] = useState(false);

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<EventFilters>({
    promotionId: "Everyone",
    month: "Everyone",
    showType: "Everyone",
  });
  const [draftFilters, setDraftFilters] = useState<EventFilters>({
    promotionId: "Everyone",
    month: "Everyone",
    showType: "Everyone",
  });
  const [multiDeleteMode, setMultiDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState("");
  const [importInfo, setImportInfo] = useState("");
  const [importSearch, setImportSearch] = useState("");
  const [importRows, setImportRows] = useState<ImportEventRow[]>([]);
  const [importSelection, setImportSelection] = useState<Set<number>>(new Set());

  const [externalEditingOpen, setExternalEditingOpen] = useState(false);

  const selectedEvent = events[selectedIndex] ?? null;

  const promoOptions: LookupOption[] = useMemo(
    () => promos.map((promo) => ({ id: Number(promo.id), name: promo.name })),
    [promos]
  );

  async function ensureBakOnce(path: string) {
    const bak = buildEwresBackupPath(path);
    const bakDir = bak.slice(0, bak.lastIndexOf("/"));
    await mkdir(bakDir, { recursive: true });
    if (!(await exists(bak))) await copyFile(path, bak);
  }

  async function loadPromos() {
    try {
      if (props.promosDataPath && await exists(props.promosDataPath)) {
        const bytes = await readFile(props.promosDataPath);
        setPromos(parsePromosDat(bytes).promos);
      } else setPromos([]);
    } catch {
      setPromos([]);
    }
  }

  async function openEventFromPath(path: string) {
    setStatus("");
    try {
      const bytes = await readFile(path);
      validateEventDatBytes(bytes);
      const parsed = parseEventDat(bytes);
      setFilePath(path);
      setEvents(parsed.events);
      setSelectedIndex(0);
      setDirty(false);
      setMultiDeleteMode(false);
      setSelectedForDelete(new Set());
      await loadPromos();
    } catch (e: any) {
      console.error(e);
      setStatus(`Load failed: ${e?.message || e}`);
    }
  }

  useEffect(() => {
    if (props.eventDataPath && props.eventDataPath !== filePath) openEventFromPath(props.eventDataPath);
  }, [props.eventDataPath]);

  useEffect(() => { loadPromos(); }, [props.promosDataPath]);

  async function handleLoadFromData() {
    if (props.eventDataPath) return openEventFromPath(props.eventDataPath);
    const picked = await open({ multiple: false, filters: [{ name: "DAT files", extensions: ["dat"] }] });
    if (typeof picked === "string") await openEventFromPath(picked);
  }

  function handleCloseFile() {
    setFilePath("");
    setEvents([]);
    setSelectedIndex(0);
    setDirty(false);
    setMultiDeleteMode(false);
    setSelectedForDelete(new Set());
    setExternalEditingOpen(false);
    setStatus("Closed event.dat");
  }

  function validateAllEventRules(records: EventRecord[]) {
    for (const record of records) {
      if (eventSlotConflict(records, Number(record.promotionId), record.month, record.index)) {
        throw new Error("A promotion cannot have multiple events in the same month, and cannot mix Weekly with monthly events.");
      }
    }
  }

  async function handleSave() {
    if (!filePath) {
      setStatus("No event.dat file is open.");
      return;
    }
    try {
      const normalized = events.map((record, index) => ({ ...record, index }));
      validateAllEventRules(normalized);
      const out = writeEventDat(normalized);
      await ensureBakOnce(filePath);
      await writeFile(filePath, out);
      setEvents(normalized);
      setDirty(false);
      setStatus(`Saved: ${normalized.length} events`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Save failed: ${e?.message || e}`);
    }
  }

  function patchSelected(mutator: (record: EventRecord) => EventRecord) {
    setEvents((prev) => {
      if (!prev[selectedIndex]) return prev;
      const next = prev.slice();
      next[selectedIndex] = mutator({ ...next[selectedIndex] });
      return next;
    });
    setDirty(true);
  }

  function patchSelectedField<K extends keyof EventRecord>(key: K, value: EventRecord[K]) {
    patchSelected((record) => ({ ...record, [key]: value }));
  }

  function handleAddNew() {
    const promoIds = promoOptions.map((opt) => opt.id).filter((id) => Number(id) > 0);
    const slot = findFirstAvailableEventSlot(events, promoIds);
    if (!slot) {
      setStatus("No valid promotion/month slots are available.");
      return;
    }
    setEvents((prev) => {
      const next = [...prev, createBlankEvent(prev.length, prev.map((item) => item.name), slot.promotionId, slot.month)];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setDirty(true);
    setStatus(`Added new event in ${monthLabel(slot.month)} for ${promotionInitialsById(promos, slot.promotionId)}.`);
  }

  function handleCopySelected() {
    if (!selectedEvent) return;
    const promoIds = promoOptions.map((opt) => opt.id).filter((id) => Number(id) > 0);
    const preferredMonth = findFirstAvailableMonthForPromotion(events, selectedEvent.promotionId);
    const slot = preferredMonth != null
      ? { promotionId: Number(selectedEvent.promotionId), month: preferredMonth }
      : findFirstAvailableEventSlot(events, promoIds, Number(selectedEvent.promotionId));
    if (!slot) {
      setStatus("No valid promotion/month slots are available.");
      return;
    }
    setEvents((prev) => {
      const copy: EventRecord = {
        ...selectedEvent,
        index: prev.length,
        name: makeUniqueEventName(selectedEvent.name, prev.map((item) => item.name)),
        promotionId: slot.promotionId,
        month: slot.month,
        _raw: selectedEvent._raw ? new Uint8Array(selectedEvent._raw) : new Uint8Array(47),
      };
      const next = [...prev, copy];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setDirty(true);
    setStatus(`Copied event to ${monthLabel(slot.month)} for ${promotionInitialsById(promos, slot.promotionId)}.`);
  }

  function deleteEventByIndex(index: number) {
    setEvents((prev) => {
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

  function toggleSelectedForDelete(index: number, checked: boolean) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (checked) next.add(index); else next.delete(index);
      return next;
    });
  }

  function toggleMultiDeleteMode() {
    setMultiDeleteMode((prev) => !prev);
    setSelectedForDelete(new Set());
  }

  function commitMultiDelete() {
    if (!selectedForDelete.size) {
      setMultiDeleteMode(false);
      return;
    }
    setEvents((prev) => prev.filter((record) => !selectedForDelete.has(record.index)).map((record, index) => ({ ...record, index })));
    setSelectedIndex(0);
    setSelectedForDelete(new Set());
    setMultiDeleteMode(false);
    setDirty(true);
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
      if (checked) next.add(sourceIndex); else next.delete(sourceIndex);
      return next;
    });
  }

  async function handleImportEvent() {
    if (!events.length) {
      setStatus("Load event.dat first.");
      return;
    }
    try {
      const picked = await open({ title: "Import from another event.dat", multiple: false, filters: [{ name: "EWR event.dat", extensions: ["dat"] }] });
      if (!picked) return;
      const sourcePath = Array.isArray(picked) ? picked[0] : picked;
      const bytes = await readFile(sourcePath);
      validateEventDatBytes(bytes);
      const parsed = parseEventDat(bytes);
      const existingNames = new Set(events.map((record) => normalizeName(record.name)));
      const promoIds = new Set(promos.map((promo) => Number(promo.id)));
      const rows: ImportEventRow[] = parsed.events.map((record, idx) => {
        const name = truncateName(String(record.name ?? "").trim());
        return {
          sourceIndex: idx,
          name,
          record: { ...record, name },
          duplicateName: !name || existingNames.has(normalizeName(name)),
          missingPromotion: !promoIds.has(Number(record.promotionId)),
          slotConflict: eventSlotConflict(events, Number(record.promotionId), record.month),
        };
      });
      const importable = rows.filter((row) => !row.duplicateName && !row.missingPromotion && !row.slotConflict).length;
      setImportSourcePath(sourcePath);
      setImportRows(rows);
      setImportSelection(new Set(rows.filter((row) => !row.duplicateName && !row.missingPromotion && !row.slotConflict).map((row) => row.sourceIndex)));
      setImportInfo(`Loaded ${rows.length} events from source. ${importable} can be imported.`);
      setImportSearch("");
      setImportModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setStatus(`Import failed: ${e?.message ?? String(e)}`);
    }
  }

  function commitImportedEvents() {
    const selectedRows = importRows.filter((row) => importSelection.has(row.sourceIndex) && !row.duplicateName && !row.missingPromotion && !row.slotConflict);
    if (!selectedRows.length) {
      setStatus("No importable events selected.");
      return;
    }
    setEvents((prev) => {
      const next = prev.slice();
      const existingNames = new Set(prev.map((record) => normalizeName(record.name)));
      for (const row of selectedRows) {
        const normalized = normalizeName(row.name);
        if (!normalized || existingNames.has(normalized)) continue;
        if (eventSlotConflict(next, Number(row.record.promotionId), row.record.month)) continue;
        existingNames.add(normalized);
        next.push({ ...row.record, index: next.length, name: row.name, _raw: row.record._raw ? new Uint8Array(row.record._raw) : new Uint8Array(47) });
      }
      setSelectedIndex(next.length ? next.length - 1 : 0);
      return next.map((record, index) => ({ ...record, index }));
    });
    setDirty(true);
    setStatus(`Imported ${selectedRows.length} events. Click Save to write to disk.`);
    closeImportModal();
  }

  async function handleExportCsv() {
    if (!events.length) {
      setStatus("Nothing to export.");
      return;
    }
    try {
      const target = await save({
        title: "Export Events CSV",
        defaultPath: "events.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!target) return;
      const rows = [CSV_HEADERS.join(",")].concat(
        events.map((record) => [
          record.index,
          csvEscape(record.name),
          csvEscape(promotionNameById(promos, record.promotionId)),
          csvEscape(monthLabel(record.month)),
          csvEscape(showTypeLabel(record.showType)),
          csvEscape(record.eventDate ?? ""),
        ].join(","))
      );
      const payload = new TextEncoder().encode("\ufeff" + rows.join("\r\n"));
      await writeFile(target, payload);
      setStatus(`Exported CSV: ${String(target).split(/[\\/]/).pop()}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`CSV export failed: ${e?.message ?? String(e)}`);
    }
  }

  async function handleImportCsv() {
    if (!events.length) {
      setStatus("Load event.dat first.");
      return;
    }
    try {
      const picked = await open({ title: "Import Events CSV", multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      const bytes = await readFile(path);
      let text = new TextDecoder("utf-8").decode(bytes);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("CSV is empty.");

      const promoIds = new Set(promos.map((promo) => Number(promo.id)));
      let updated = 0;
      let added = 0;
      let skipped = 0;

      setEvents((prev) => {
        const next = prev.map((record) => ({ ...record, _raw: record._raw ? new Uint8Array(record._raw) : new Uint8Array(47) }));
        for (const row of rows) {
          const name = truncateName(String(row["Event Name"] ?? "").trim());
          const promoId = promoIdFromName(promos, String(row["Promotion"] ?? ""));
          const month = monthFromLabel(String(row["Month"] ?? ""));
          const showType = showTypeFromLabel(String(row["Type Of Show"] ?? "")) ?? 1;
          const eventDate = normalizeIsoDate(String(row["Event Date (Save File Only)"] ?? ""));
          if (!name || promoId == null || !promoIds.has(promoId) || month == null) { skipped += 1; continue; }

          const recField = String(row["Record #"] ?? "").trim();
          const recordIndex = /^\d+$/.test(recField) ? Number(recField) : -1;
          if (recordIndex >= 0 && recordIndex < next.length) {
            const existingNameOwner = next.find((r) => r.index !== recordIndex && normalizeName(r.name) === normalizeName(name));
            if (existingNameOwner || eventSlotConflict(next, promoId, month, recordIndex)) { skipped += 1; continue; }
            next[recordIndex] = { ...next[recordIndex], name, promotionId: promoId, month, showType, eventDate };
            updated += 1;
          } else {
            const dupe = next.some((r) => normalizeName(r.name) === normalizeName(name));
            if (dupe || eventSlotConflict(next, promoId, month)) { skipped += 1; continue; }
            next.push({ index: next.length, name, promotionId: promoId, month, showType, eventDate, _raw: new Uint8Array(47) });
            added += 1;
          }
        }
        return next.map((record, index) => ({ ...record, index }));
      });

      setDirty(true);
      setStatus(`CSV import complete: ${updated} updated, ${added} added, ${skipped} skipped.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`CSV import failed: ${e?.message ?? String(e)}`);
    }
  }

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.promotionId !== "Everyone") n++;
    if (filters.month !== "Everyone") n++;
    if (filters.showType !== "Everyone") n++;
    return n;
  }, [filters]);

  function clearAllFilters() {
    const cleared: EventFilters = {
      promotionId: "Everyone",
      month: "Everyone",
      showType: "Everyone",
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
          <div className="ewr-label">Promotion</div>
          <select
            className="ewr-input"
            value={draftFilters.promotionId}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, promotionId: e.target.value as FilterPick }))}
          >
            <option value="Everyone">Any</option>
            {promos
              .slice()
              .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }))
              .map((promo) => (
                <option key={promo.id} value={String(promo.id)}>
                  {promo.name || `(Promotion #${promo.id})`}
                </option>
              ))}
          </select>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Type of Show</div>
          <select
            className="ewr-input"
            value={draftFilters.showType}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, showType: e.target.value as FilterPick }))}
          >
            <option value="Everyone">Any</option>
            {SHOW_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ewr-field">
          <div className="ewr-label">Month</div>
          <select
            className="ewr-input"
            value={draftFilters.month}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, month: e.target.value as FilterPick }))}
          >
            <option value="Everyone">Any</option>
            {MONTH_OPTIONS.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  const filteredEvents = useMemo(() => {
    const q = normalizeName(search);
    const next = events.filter((record) => {
      const matchesSearch = !q || [record.name, promotionNameById(promos, record.promotionId), monthLabel(record.month), showTypeLabel(record.showType), record.eventDate ?? ""]
        .some((value) => normalizeName(value).includes(q));
      if (!matchesSearch) return false;

      if (filters.promotionId !== "Everyone" && String(record.promotionId) !== String(filters.promotionId)) return false;
      if (filters.month !== "Everyone" && String(record.month) !== String(filters.month)) return false;
      if (filters.showType !== "Everyone" && String(record.showType) !== String(filters.showType)) return false;

      return true;
    });
    next.sort((a, b) => sortKey === "name" ? a.name.localeCompare(b.name) || a.index - b.index : a.index - b.index);
    return next;
  }, [events, promos, search, sortKey, filters]);

  const filteredImportRows = useMemo(() => {
    const q = normalizeName(importSearch);
    const visible = q ? importRows.filter((row) => normalizeName(row.name).includes(q)) : importRows;
    return [...visible].sort((a, b) => {
      const aBlocked = a.duplicateName || a.missingPromotion || a.slotConflict ? 1 : 0;
      const bBlocked = b.duplicateName || b.missingPromotion || b.slotConflict ? 1 : 0;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    });
  }, [importRows, importSearch]);

  const header = (
    <EditorHeader
      title={selectedEvent ? `Editing: ${selectedEvent.name || "(blank event name)"}` : "Events"}
      leftPills={selectedEvent ? [
        selectedEvent.name || "(blank event name)",
        `Record #${selectedEvent.index} — ${promotionInitialsById(promos, selectedEvent.promotionId)}`,
      ] : []}
      rightPills={[filePath ? "event.dat loaded" : "event.dat not loaded", ...(status ? [status] : [])]}
    />
  );

  return (
    <div className="ewr-app">
      <div className="ewr-panel ewr-left">
        <div style={{ padding: "12px 14px 0" }}>
          <LeftPanelFileActions
            title="Events"
            subtitle="event.dat"
            loadFromData={{ onClick: handleLoadFromData, disabled: !props.eventDataPath && !props.workspaceRoot }}
            closeFile={{ onClick: handleCloseFile, disabled: !filePath }}
            saveFile={{ onClick: handleSave, disabled: !filePath || !dirty }}
          />
        </div>

        <div className="ewr-leftMiddle ewr-scroll">
          <div className="ewr-leftBody">
            <LeftPanelSearchHeader
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search events"
              sortValue={sortKey}
              onSortChange={(value) => setSortKey(value as SortKey)}
              sortOptions={[{ value: "record", label: "Sort: Record" }, { value: "name", label: "Sort: Name" }]}
              showingCount={filteredEvents.length}
              totalCount={events.length}
              filtersOpen={filtersOpen}
              onToggleFilters={() => {
                if (!filtersOpen) setDraftFilters(filters);
                setFiltersOpen((prev) => !prev);
              }}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
              clearFiltersDisabled={activeFilterCount === 0}
            />
            {filtersOpen ? renderFilterPanel(() => setFiltersOpen(false)) : null}
          </div>

          <div style={{ padding: "0 14px 14px" }}>
            {filteredEvents.map((record) => (
              <LeftPanelNameCard
                key={record.index}
                name={record.name || "(blank event name)"}
                isSelected={selectedEvent?.index === record.index}
                onSelect={() => setSelectedIndex(record.index)}
                onCopy={() => { setSelectedIndex(record.index); setTimeout(handleCopySelected, 0); }}
                onDelete={() => deleteEventByIndex(record.index)}
                copyTitle="Copy Event"
                deleteTitle="Delete Event"
                showActions={true}
                leading={multiDeleteMode ? (
                  <input
                    type="checkbox"
                    checked={selectedForDelete.has(record.index)}
                    onChange={(e) => toggleSelectedForDelete(record.index, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 18, height: 18 }}
                    title="Select for multi-delete"
                  />
                ) : undefined}
              />
            ))}
            {filteredEvents.length === 0 ? <div className="ewr-muted">No events found.</div> : null}
          </div>
        </div>

        <LeftPanelActionGrid
          buttons={[
            { key: "add", label: "Add New Event", icon: <IconPlus className="btnSvg" />, onClick: handleAddNew, className: "ewr-button" },
            {
              key: "multi",
              label: multiDeleteMode ? (selectedForDelete.size > 0 ? `Delete Selected (${selectedForDelete.size})` : "Cancel Multi-Delete") : "Multi-Delete",
              icon: <IconChecklist className="btnSvg" />,
              onClick: multiDeleteMode ? (selectedForDelete.size > 0 ? commitMultiDelete : toggleMultiDeleteMode) : toggleMultiDeleteMode,
              className: "ewr-button",
              style: multiDeleteMode && selectedForDelete.size > 0 ? { background: "rgba(255,70,70,0.18)", border: "1px solid rgba(255,70,70,0.60)" } : undefined,
            },
            { key: "import", label: "Import Event", icon: <IconImport className="btnSvg" />, disabled: !events.length, onClick: handleImportEvent, className: "ewr-button" },
            {
              key: "external",
              label: "External Editing",
              icon: <IconGrid className="btnSvg" />,
              disabled: !events.length,
              onClick: () => setExternalEditingOpen((prev) => !prev),
              className: "ewr-button ewr-buttonYellow",
              style: externalEditingOpen ? { background: "rgba(255,190,70,0.12)", border: "1px solid rgba(255,190,70,0.55)" } : undefined,
            },
          ]}
          after={
            <>
              {externalEditingOpen ? (
                <div className="ewr-footerGrid" style={{ marginTop: 10 }}>
                  <button type="button" className="ewr-button" style={{ width: "100%", justifyContent: "center" }} onClick={handleExportCsv}>Export CSV</button>
                  <button type="button" className="ewr-button" style={{ width: "100%", justifyContent: "center" }} onClick={handleImportCsv}>Import CSV</button>
                </div>
              ) : null}
              {multiDeleteMode ? (
                <div className="ewr-footerGrid" style={{ marginTop: 10 }}>
                  <button type="button" className="ewr-button" style={{ width: "100%", justifyContent: "center" }} onClick={() => setSelectedForDelete(new Set(filteredEvents.map((record) => record.index)))}>Select All</button>
                  <button type="button" className="ewr-button" style={{ width: "100%", justifyContent: "center" }} onClick={() => setSelectedForDelete(new Set())}>Select None</button>
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
                <div className="ewr-modalTitle">Import Events</div>
                <div className="ewr-modalSub">Source: <span className="ewr-mono">{importSourcePath ? importSourcePath.split(/[\\/]/).pop() : "event.dat"}</span></div>
              </div>
              <button className="ewr-iconBtn" title="Close" onClick={closeImportModal} aria-label="Close import">×</button>
            </div>
            <div className="ewr-modalBody">
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input className="ewr-input" style={{ flex: 1, minWidth: 220 }} placeholder="Filter events by name..." value={importSearch} onChange={(e) => setImportSearch(e.target.value)} />
                <button className="ewr-button ewr-buttonSmall" type="button" onClick={() => setImportSelection(new Set(filteredImportRows.filter((row) => !row.duplicateName && !row.missingPromotion && !row.slotConflict).map((row) => row.sourceIndex)))}>Select All</button>
                <button className="ewr-button ewr-buttonSmall" type="button" onClick={() => setImportSearch("")}>Clear</button>
              </div>
              <div className="ewr-modalList">
                {filteredImportRows.length === 0 ? <div className="ewr-muted">No events found.</div> : filteredImportRows.map((row) => {
                  const checked = importSelection.has(row.sourceIndex);
                  const disabled = row.duplicateName || row.missingPromotion || row.slotConflict;
                  const badgeStyle = {
                    display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999, fontWeight: 900, fontSize: 11,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: disabled ? "rgba(220, 38, 38, 0.18)" : "rgba(34, 197, 94, 0.16)",
                    color: "rgba(255,255,255,0.95)", marginLeft: 10,
                  } as const;
                  const blockedReason = row.duplicateName ? "Duplicate event name" : row.missingPromotion ? "Promotion not present in current data" : "Promotion / month rule conflict";
                  return (
                    <label key={row.sourceIndex} className="ewr-importRow" style={{ opacity: disabled ? 0.55 : 1 }}>
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => toggleImportSelection(row.sourceIndex, e.target.checked)} />
                      <span className="ewr-importName" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span>{row.name || "(blank event name)"}<span style={badgeStyle}>{disabled ? "Blocked" : "Importable"}</span></span>
                        <span className="ewr-muted">Source record #{row.sourceIndex}{disabled ? ` • ${blockedReason}` : ""}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {importInfo ? <div className="ewr-importInfo">{importInfo}</div> : null}
            </div>
            <div className="ewr-modalFooter">
              <div className="ewr-muted" style={{ marginRight: "auto" }}>Selected: {Array.from(importSelection).filter((sourceIndex) => importRows.some((row) => row.sourceIndex === sourceIndex && !row.duplicateName && !row.missingPromotion && !row.slotConflict)).length} / {importRows.length}</div>
              <button className="ewr-button" type="button" onClick={closeImportModal}>Cancel</button>
              <button className="ewr-button ewr-buttonOrange" type="button" onClick={commitImportedEvents} disabled={!Array.from(importSelection).some((sourceIndex) => importRows.some((row) => row.sourceIndex === sourceIndex && !row.duplicateName && !row.missingPromotion && !row.slotConflict))}>Import Selected</button>
            </div>
          </div>
        </div>
      ) : null}

      <RightPanelShell header={header}>
        {!selectedEvent ? (
          <div className="ewr-muted">Load event.dat to edit events.</div>
        ) : (
          <>
            <h2 className="ewr-h2">{selectedEvent.name || "(blank event name)"}</h2>
            <div className="ewr-subtitle">{`Record #${selectedEvent.index} — ${promotionInitialsById(promos, selectedEvent.promotionId)}`}</div>

            <div className="ewr-sectionTitle" style={{ marginTop: 18 }}>Event Configuration</div>

            <label className="ewr-field" style={{ marginTop: 12, display: "block" }}>
              <div className="ewr-label">Event Name (32)</div>
              <input className="ewr-input" style={{ width: "100%" }} value={selectedEvent.name} maxLength={32} onChange={(e) => patchSelectedField("name", truncateName(e.target.value) as any)} />
            </label>

            <div className="ewr-grid" style={{ marginTop: 12, gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
              <label className="ewr-field">
                <div className="ewr-label">Promotion</div>
                <select
                  className="ewr-input"
                  value={selectedEvent.promotionId}
                  onChange={(e) => {
                    const nextPromotionId = clamp(Number(e.target.value) || 0, 0, 65535);
                    if (eventSlotConflict(events, nextPromotionId, selectedEvent.month, selectedEvent.index)) {
                      setStatus("A promotion cannot mix Weekly with monthly events, and cannot have multiple events in the same month.");
                      return;
                    }
                    patchSelectedField("promotionId", nextPromotionId as any);
                  }}
                >
                  {promoOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>

              <label className="ewr-field">
                <div className="ewr-label">Month</div>
                <select
                  className="ewr-input"
                  value={selectedEvent.month}
                  onChange={(e) => {
                    const nextMonth = Number(e.target.value) as EventMonthId;
                    if (eventSlotConflict(events, selectedEvent.promotionId, nextMonth, selectedEvent.index)) {
                      setStatus("A promotion cannot mix Weekly with monthly events, and cannot have multiple events in the same month.");
                      return;
                    }
                    patchSelectedField("month", nextMonth as any);
                  }}
                >
                  {MONTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>

              <label className="ewr-field">
                <div className="ewr-label">Type Of Show</div>
                <select className="ewr-input" value={selectedEvent.showType} onChange={(e) => patchSelectedField("showType", Number(e.target.value) as EventShowType as any)}>
                  {SHOW_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <div className="ewr-sectionTitle" style={{ marginTop: 18 }}>Save File Date</div>
            <div className="ewr-muted" style={{ marginTop: 6 }}>
              This date field is meant for save-file event.dat entries. It is disabled when you are working from a normal DATA folder workspace to avoid corrupting database files.
            </div>
            <label className="ewr-field" style={{ marginTop: 12, display: "block", maxWidth: 280 }}>
              <div className="ewr-label">Event Date (Save File Only)</div>
              <input
                className="ewr-input"
                style={{ width: "100%", opacity: isDataFolderWorkspace ? 0.65 : 1 }}
                type="date"
                value={selectedEvent.eventDate ?? ""}
                disabled={isDataFolderWorkspace}
                onChange={(e) => patchSelectedField("eventDate", normalizeIsoDate(e.target.value) as any)}
              />
              {isDataFolderWorkspace ? <div className="ewr-muted" style={{ marginTop: 6, fontSize: 12 }}>Disabled in DATA folder workspaces.</div> : null}
            </label>
          </>
        )}
      </RightPanelShell>
    </div>
  );
}
