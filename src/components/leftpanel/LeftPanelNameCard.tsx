import React from "react";
import { IconCopy, IconTrash } from "../icons/EwrIcons";

export type LeftPanelNameCardProps = {
  name: string;
  isSelected: boolean;
  onSelect: () => void;

  onCopy?: () => void;
  onDelete?: () => void;
  copyTitle?: string;
  deleteTitle?: string;
  disableCopy?: boolean;
  disableDelete?: boolean;

  /**
   * When false, hides the copy/delete icon buttons entirely.
   * Used for Multi-Delete mode so cards stay clean and consistent.
   */
  showActions?: boolean;

  leading?: React.ReactNode;
  // Useful for virtualization: put a stable key on parent
  tabIndex?: number;
};

export default function LeftPanelNameCard(props: LeftPanelNameCardProps) {
  const canShowActions = props.showActions !== false && (!!props.onCopy || !!props.onDelete);

  return (
    <div
      className={`ewr-workerRow ${props.isSelected ? "ewr-workerRowActive" : ""}`}
      role="button"
      tabIndex={props.tabIndex ?? 0}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
    >
      <div
        className="ewr-workerRowInner"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          // When we hide actions (multi-delete), stop "space-between" from pushing the name right.
          justifyContent: canShowActions ? undefined : "flex-start",
        }}
      >
        {props.leading ? <div style={{ flexShrink: 0 }}>{props.leading}</div> : null}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ewr-workerName" style={{ textAlign: "left" }}>
            {props.name || "(blank name)"}
          </div>
        </div>

        {canShowActions ? (
          <div className="ewr-workerActions" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {props.onCopy ? (
              <button
                type="button"
                className={`ewr-iconBtn ewr-iconBtnBlue ${props.disableCopy ? "ewr-buttonDisabled" : ""}`}
                title={props.copyTitle ?? "Copy"}
                aria-label={props.copyTitle ?? "Copy"}
                disabled={!!props.disableCopy}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onCopy?.();
                }}
              >
                <IconCopy className="iconBtnSvg" />
              </button>
            ) : null}

            {props.onDelete ? (
              <button
                type="button"
                className={`ewr-iconBtn ewr-iconBtnRed ${props.disableDelete ? "ewr-buttonDisabled" : ""}`}
                title={props.deleteTitle ?? "Delete"}
                aria-label={props.deleteTitle ?? "Delete"}
                disabled={!!props.disableDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete?.();
                }}
              >
                <IconTrash className="iconBtnSvg" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
