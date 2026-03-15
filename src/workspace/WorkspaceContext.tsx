import React, { createContext, useContext, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";

export type WorkspaceFileKey = "wrestlers" | "sponsors" | "staff" | "promos" | "teams";

type WorkspaceState = {
  root: string | null;
  files: Partial<Record<WorkspaceFileKey, string>>;
};

type WorkspaceContextValue = {
  state: WorkspaceState;
  openWorkspace: () => Promise<void>;
  clearWorkspace: () => void;
  hasFile: (key: WorkspaceFileKey) => boolean;
  getFilePath: (key: WorkspaceFileKey) => string | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function joinPath(dir: string, fileName: string) {
  if (!dir) return fileName;
  const sep = dir.endsWith("/") || dir.endsWith("\\") ? "" : "/";
  return `${dir}${sep}${fileName}`;
}

// For robustness, support both singular/plural names that appear in various EWR data sets.
const CANDIDATES: Record<WorkspaceFileKey, string[]> = {
  wrestlers: ["wrestler.dat", "wrestlers.dat"],
  sponsors: ["sponsor.dat", "sponsors.dat"],
  staff: ["staff.dat"],
  promos: ["promos.dat", "promo.dat", "promotions.dat"],
  teams: ["teams.dat", "tagteams.dat", "tag_teams.dat"],
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({ root: null, files: {} });

  async function openWorkspace() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Select EWR DATA folder",
    });

    if (!picked || Array.isArray(picked)) return;

    const root = String(picked);
    const found: Partial<Record<WorkspaceFileKey, string>> = {};

    for (const key of Object.keys(CANDIDATES) as WorkspaceFileKey[]) {
      for (const fileName of CANDIDATES[key]) {
        const full = joinPath(root, fileName);
        try {
          if (await exists(full)) {
            found[key] = full;
            break;
          }
        } catch {
          // best-effort; ignore and keep scanning
        }
      }
    }

    setState({ root, files: found });
  }

  function clearWorkspace() {
    setState({ root: null, files: {} });
  }

  function hasFile(key: WorkspaceFileKey) {
    return !!state.files[key];
  }

  function getFilePath(key: WorkspaceFileKey) {
    return state.files[key] ?? null;
  }

  const value = useMemo<WorkspaceContextValue>(
    () => ({ state, openWorkspace, clearWorkspace, hasFile, getFilePath }),
    [state]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
