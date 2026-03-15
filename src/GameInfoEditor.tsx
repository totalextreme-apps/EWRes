import React, { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {copyFile, exists, readFile, writeFile} from "@tauri-apps/plugin-fs";
import LeftPanelFileActions from "./components/leftpanel/LeftPanelFileActions";
import { RightPanelShell } from "./components/rightpanel/RightPanelShell";

function buildEwresBackupPath(path: string, suffix = ""): string {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/EWRes/backups/${base}${suffix}.bak`;
}

type Props = {
  workspaceRoot: string;
};

type GameInfoModel = {
  username: string;
  saveName: string;
  currentDate: string;
  startDate: string;
  joinedDate: string;
  rawCurrentOle: number;
  rawStartOle: number;
  rawJoinedOle: number;
};


const USERNAME_OFFSET = 0x00;
const USERNAME_LENGTH = 25;
const START_DATE_OFFSET = 0x1B;
const JOINED_DATE_OFFSET = 0x6B;
const CURRENT_DATE_OFFSET = 0x183;
const SAVE_NAME_OFFSET = 0x15B;
const SAVE_NAME_LENGTH = 30;

function getBaseName(filePath: string) {
  const s = String(filePath ?? "").trim().replace(/\\/g, "/");
  if (!s) return "";
  const idx = s.lastIndexOf("/");
  return idx >= 0 ? s.slice(idx + 1) : s;
}

function decodePaddedString(bytes: Uint8Array, offset: number, length: number) {
  const slice = bytes.slice(offset, offset + length);
  const chars: string[] = [];
  for (const b of slice) {
    if (b === 0) break;
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b > 126) break;
    chars.push(String.fromCharCode(b));
  }
  return chars.join("").replace(/\s+$/g, "");
}

function encodePaddedString(value: string, length: number) {
  const clean = String(value ?? "");
  const out = new Uint8Array(length);
  out.fill(0x20);
  const limit = Math.min(length, clean.length);
  for (let i = 0; i < limit; i += 1) {
    const code = clean.charCodeAt(i);
    out[i] = code >= 0 && code <= 255 ? code : 0x20;
  }
  return out;
}

function readF64LE(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getFloat64(offset, true);
}

function writeF64LE(bytes: Uint8Array, offset: number, value: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setFloat64(offset, value, true);
}

function oleDateToYmd(value: number) {
  if (!Number.isFinite(value)) return "";
  const baseUtcMs = Date.UTC(1899, 11, 30, 0, 0, 0, 0);
  const ms = baseUtcMs + value * 86400000;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ymdToOleDate(value: string, fallbackFraction = 0) {
  const m = /^(\d{1,4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) throw new Error("Date must be in YYYY-MM-DD format.");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const baseUtcMs = Date.UTC(1899, 11, 30, 0, 0, 0, 0);
  return (utc - baseUtcMs) / 86400000 + fallbackFraction;
}

function getDateParts(value: string) {
  const m = /^(\d{1,4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return { year: "", month: "", day: "" };
  return {
    year: String(Number(m[1])),
    month: String(Number(m[2])),
    day: String(Number(m[3])),
  };
}

function updateDatePart(value: string, part: "year" | "month" | "day", nextRaw: string) {
  const current = getDateParts(value);
  const digitsOnly = String(nextRaw ?? "").replace(/[^0-9]/g, "");
  const next = {
    year: current.year || "1900",
    month: current.month || "1",
    day: current.day || "1",
  };
  if (part === "year") next.year = digitsOnly.slice(0, 4) || "0";
  if (part === "month") next.month = digitsOnly.slice(0, 2) || "1";
  if (part === "day") next.day = digitsOnly.slice(0, 2) || "1";

  const yyyy = String(Math.max(0, Number(next.year || "0"))).padStart(4, "0");
  const mm = String(Math.min(12, Math.max(1, Number(next.month || "1")))).padStart(2, "0");
  const dd = String(Math.min(31, Math.max(1, Number(next.day || "1")))).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseGameInfo(bytes: Uint8Array): GameInfoModel {
  if (bytes.byteLength < CURRENT_DATE_OFFSET + 8 || bytes.byteLength < SAVE_NAME_OFFSET + SAVE_NAME_LENGTH) {
    throw new Error("gameinfo.dat is smaller than expected and could not be parsed.");
  }

  const username = decodePaddedString(bytes, USERNAME_OFFSET, USERNAME_LENGTH);
  const saveName = decodePaddedString(bytes, SAVE_NAME_OFFSET, SAVE_NAME_LENGTH);
  const startOle = readF64LE(bytes, START_DATE_OFFSET);
  const joinedOle = readF64LE(bytes, JOINED_DATE_OFFSET);
  const currentOle = readF64LE(bytes, CURRENT_DATE_OFFSET);

  return {
    username,
    saveName,
    currentDate: oleDateToYmd(currentOle),
    startDate: oleDateToYmd(startOle),
    joinedDate: oleDateToYmd(joinedOle),
    rawCurrentOle: currentOle,
    rawStartOle: startOle,
    rawJoinedOle: joinedOle,
  };
}

function writeGameInfo(original: Uint8Array, model: GameInfoModel) {
  const next = new Uint8Array(original);
  const currentFraction = Number.isFinite(model.rawCurrentOle)
    ? model.rawCurrentOle - Math.trunc(model.rawCurrentOle)
    : 0;
  const startFraction = Number.isFinite(model.rawStartOle)
    ? model.rawStartOle - Math.trunc(model.rawStartOle)
    : 0;
  const joinedFraction = Number.isFinite(model.rawJoinedOle)
    ? model.rawJoinedOle - Math.trunc(model.rawJoinedOle)
    : 0;

  next.set(encodePaddedString(model.username, USERNAME_LENGTH), USERNAME_OFFSET);
  next.set(encodePaddedString(model.saveName, SAVE_NAME_LENGTH), SAVE_NAME_OFFSET);
  writeF64LE(next, START_DATE_OFFSET, ymdToOleDate(model.startDate, startFraction));
  writeF64LE(next, JOINED_DATE_OFFSET, ymdToOleDate(model.joinedDate, joinedFraction));
  writeF64LE(next, CURRENT_DATE_OFFSET, ymdToOleDate(model.currentDate, currentFraction));

  return next;
}

const NEWS_RECORD_LENGTH = 205;

function encodeAsciiFixed(value: string, length: number) {
  const out = new Uint8Array(length);
  out.fill(0x20);
  const clean = String(value ?? "");
  const limit = Math.min(length, clean.length);
  for (let i = 0; i < limit; i += 1) {
    const code = clean.charCodeAt(i);
    out[i] = code >= 0 && code <= 255 ? code : 0x20;
  }
  return out;
}

function syncUsernameInNewsDat(original: Uint8Array, previousUsername: string, nextUsername: string) {
  const oldName = String(previousUsername ?? "").trim();
  const newName = String(nextUsername ?? "").trim();
  if (!oldName || !newName || oldName === newName) return new Uint8Array(original);

  const next = new Uint8Array(original);
  for (let offset = 0; offset + NEWS_RECORD_LENGTH <= next.byteLength; offset += NEWS_RECORD_LENGTH) {
    const record = next.slice(offset, offset + NEWS_RECORD_LENGTH);
    const text = Array.from(record, (b) => String.fromCharCode(b)).join("");
    if (!text.includes(oldName)) continue;
    const replaced = text.split(oldName).join(newName);
    next.set(encodeAsciiFixed(replaced, NEWS_RECORD_LENGTH), offset);
  }
  return next;
}

type DateFieldProps = {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  hint: React.ReactNode;
};

function GameInfoDateField({ label, value, onChange, hint }: DateFieldProps) {
  const parts = getDateParts(value);

  return (
    <div className="ewr-groupCard" style={{ padding: 14, display: "grid", gap: 10, alignContent: "start" }}>
      <div className="ewr-sectionTitle" style={{ margin: 0 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div className="ewr-hint" style={{ fontSize: 11 }}>Month</div>
          <input
            className="ewr-input"
            type="number"
            step="1"
            min="1"
            max="12"
            value={parts.month}
            onChange={(e) => onChange(updateDatePart(value, "month", e.target.value))}
          />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <div className="ewr-hint" style={{ fontSize: 11 }}>Day</div>
          <input
            className="ewr-input"
            type="number"
            step="1"
            min="1"
            max="31"
            value={parts.day}
            onChange={(e) => onChange(updateDatePart(value, "day", e.target.value))}
          />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <div className="ewr-hint" style={{ fontSize: 11 }}>Year</div>
          <input
            className="ewr-input"
            type="number"
            step="1"
            value={parts.year}
            onChange={(e) => onChange(updateDatePart(value, "year", e.target.value))}
          />
        </div>
      </div>
      <div className="ewr-hint" style={{ lineHeight: 1.45 }}>{hint}</div>
    </div>
  );
}

export default function GameInfoEditor({ workspaceRoot: _workspaceRoot }: Props) {
  const [filePath, setFilePath] = useState("");
  const [model, setModel] = useState<GameInfoModel | null>(null);
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | null>(null);
  const [, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function loadFromPath(path: string) {
    try {
      setIsBusy(true);
      setError("");
      setStatus("");
      const bytes = await readFile(path);
      const parsed = parseGameInfo(bytes);
      setOriginalBytes(bytes);
      setModel(parsed);
      setFilePath(path);
      setStatus(`Loaded ${getBaseName(path)}.`);
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus("");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenFile() {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "DAT", extensions: ["dat"] }],
      });
      if (!picked || Array.isArray(picked)) return;
      await loadFromPath(String(picked));
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function handleSave() {
    if (!model || !originalBytes || !filePath) {
      setError("Load a gameinfo.dat file first.");
      return;
    }
    try {
      setIsBusy(true);
      setError("");
      const previousModel = parseGameInfo(originalBytes);
      const nextBytes = writeGameInfo(originalBytes, model);
      const backupPath = buildEwresBackupPath(filePath);
      if (await exists(filePath)) {
        try {
          await copyFile(filePath, backupPath);
        } catch {}
      }
      await writeFile(filePath, nextBytes);

      const normalizedPath = String(filePath ?? "").replace(/\\/g, "/");
      const slash = normalizedPath.lastIndexOf("/");
      const dir = slash >= 0 ? normalizedPath.slice(0, slash) : ".";
      const newsPath = `${dir}/news.dat`;
      if (await exists(newsPath)) {
        try {
          const newsBytes = await readFile(newsPath);
          const syncedNewsBytes = syncUsernameInNewsDat(newsBytes, previousModel.username, model.username);
          const newsBackupPath = buildEwresBackupPath(newsPath);
          if (await exists(newsPath)) {
            try {
              await copyFile(newsPath, newsBackupPath);
            } catch {}
          }
          await writeFile(newsPath, syncedNewsBytes);
        } catch {}
      }

      setOriginalBytes(nextBytes);
      setModel(parseGameInfo(nextBytes));
      setStatus(`Saved ${getBaseName(filePath)}.`);
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus("");
    } finally {
      setIsBusy(false);
    }
  }

  function handleCloseFile() {
    setFilePath("");
    setModel(null);
    setOriginalBytes(null);
    setError("");
    setStatus("Closed gameinfo.dat.");
  }

  return (
    <div className="ewr-app">
      <div className="ewr-panel ewr-left">
        <div className="ewr-leftBody" style={{ display: "grid", gap: 12 }}>
          <LeftPanelFileActions
            title="Game Info"
            subtitle="gameinfo.dat"
            loadFromData={{
              disabled: isBusy,
              onClick: () => void handleOpenFile(),
              label: "Load File",
              title: "Open gameinfo.dat",
            }}
            closeFile={{
              disabled: isBusy || !filePath,
              onClick: handleCloseFile,
              label: "Close File",
              title: "Close gameinfo.dat",
            }}
            saveFile={{
              disabled: isBusy || !model || !originalBytes || !filePath,
              onClick: () => void handleSave(),
              label: "Save File",
              title: "Save gameinfo.dat",
            }}
          />

          <div className="ewr-field">
            <div className="ewr-label">Current File Path</div>
            <div className="ewr-hint" style={{ wordBreak: "break-all", lineHeight: 1.45 }}>
              {filePath || "No gameinfo.dat loaded yet."}
            </div>
          </div>

          <div className="ewr-divider" />

          <div className="ewr-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
            This editor works with <b>gameinfo.dat</b> from an EWR save folder, not the normal DATA folder files.
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div className="ewr-sectionTitle" style={{ margin: 0 }}>What this edits</div>
            <div className="ewr-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
              This section edits the master save information block in <b>gameinfo.dat</b>. It lets you change the player username, the displayed save name, the in-game <b>Current Date</b>, the player&apos;s <b>Joined</b> date for the current promotion, and the database <b>Began</b> date.
            </div>
          </div>

          {error ? <div className="ewr-errorText">{error}</div> : null}
        </div>
      </div>

      <RightPanelShell
        header={<>
          <div className="ewr-mainTitleBar">Game Info Editor</div>
          <div className="ewr-mainMetaRow">
            <div className="ewr-pillRow">
              <div className="ewr-pill">Category: Save Utilities</div>
              {model ? <div className="ewr-pill">Master save block ready</div> : null}
              <div className="ewr-pill">Username field: {USERNAME_LENGTH} bytes</div>
              <div className="ewr-pill">Save name field: {SAVE_NAME_LENGTH} bytes</div>
            </div>
          </div>
        </>}
      >
        {!model ? (
          <div className="ewr-groupCard" style={{ padding: 18 }}>
            <div className="ewr-muted" style={{ lineHeight: 1.6 }}>
              Open <b>gameinfo.dat</b> from an EWR save folder to begin editing the save header information.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="ewr-section">
              <div className="ewr-sectionHeader">
                <div className="ewr-sectionTitle">Identity</div>
              </div>
              <div className="ewr-sectionBody">
                <div className="ewr-grid ewr-gridAuto">
                  <div className="ewr-field">
                    <div className="ewr-label">Username</div>
                    <input
                      className="ewr-input"
                      value={model.username}
                      maxLength={USERNAME_LENGTH}
                      onChange={(e) => setModel({ ...model, username: e.target.value.slice(0, USERNAME_LENGTH) })}
                    />
                    <div className="ewr-hint">Stored in the first 25-byte username field in gameinfo.dat. When saving from a real save folder, the editor also updates matching username text inside <b>news.dat</b> so the main screen stays in sync. **This must be performed with your save game closed**</div>
                  </div>

                  <div className="ewr-field">
                    <div className="ewr-label">Game Save Name</div>
                    <input
                      className="ewr-input"
                      value={model.saveName}
                      maxLength={SAVE_NAME_LENGTH}
                      onChange={(e) => setModel({ ...model, saveName: e.target.value.slice(0, SAVE_NAME_LENGTH) })}
                    />
                    <div className="ewr-hint">Stored in the later 30-byte save name field in gameinfo.dat.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="ewr-section">
              <div className="ewr-sectionHeader">
                <div className="ewr-sectionTitle">Date Settings</div>
              </div>
              <div className="ewr-sectionBody">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                  <GameInfoDateField
                    label="Current Date"
                    value={model.currentDate}
                    onChange={(nextValue) => setModel({ ...model, currentDate: nextValue })}
                    hint={<>This is the <b>Current In-Game Date.</b></>}
                  />
                  <GameInfoDateField
                    label="Database Start Date (Began)"
                    value={model.startDate}
                    onChange={(nextValue) => setModel({ ...model, startDate: nextValue })}
                    hint={<>This is the <b>In-Game Date the Save Began.</b></>}
                  />
                  <GameInfoDateField
                    label="Joined Date"
                    value={model.joinedDate}
                    onChange={(nextValue) => setModel({ ...model, joinedDate: nextValue })}
                    hint={<>This is the <b>In-Game Date Your User Character Joined the Current Promotion</b> (Usually the Same as Database Start Date.)</>}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </RightPanelShell>
    </div>
  );
}