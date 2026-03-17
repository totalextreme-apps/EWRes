import type { ReactNode } from "react";
import React from "react";

export type LeftPanelActionGridButton = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

export type LeftPanelActionGridProps = {
  /** Exactly 4 buttons (2x2). */
  buttons: [LeftPanelActionGridButton, LeftPanelActionGridButton, LeftPanelActionGridButton, LeftPanelActionGridButton];
  /** Optional content rendered below the 2x2 grid. */
  after?: ReactNode;
};

export default function LeftPanelActionGrid({ buttons, after }: LeftPanelActionGridProps) {
  return (
    <div className="ewr-leftFooter">
      <div className="ewr-footerGrid">
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            className={b.className ?? "ewr-button"}
            style={{ width: "100%", justifyContent: "center", ...(b.style ?? {}) }}
            onClick={b.onClick}
            disabled={!!b.disabled}
            title={b.title}
          >
            {b.icon}
            {b.label}
          </button>
        ))}
      </div>

      {after ? <div style={{ marginTop: 10 }}>{after}</div> : null}
    </div>
  );
}
