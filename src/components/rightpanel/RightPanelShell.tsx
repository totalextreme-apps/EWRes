import React from "react";

type Props = {
  /** Content rendered inside the fixed right-panel header area. */
  header: React.ReactNode;
  /** Main scrollable body content. */
  children: React.ReactNode;
  /** Optional extra class names for the outer panel container. */
  className?: string;
  /** Optional override for the main body container classes. */
  bodyClassName?: string;
};

/**
 * Universal shell for editor right panels.
 *
 * This standardizes:
 * - outer container class (ewr-panel ewr-main)
 * - header class (ewr-mainHeader)
 * - scrollable body classes (ewr-mainBody ewr-mainBodyScroll)
 */
export function RightPanelShell({ header, children, className, bodyClassName }: Props) {
  const outer = ["ewr-panel", "ewr-main", className].filter(Boolean).join(" ");
  const body = bodyClassName ?? "ewr-mainBody ewr-mainBodyScroll";
  return (
    <div className={outer}>
      <div className="ewr-mainHeader">{header}</div>
      <div className={body}>{children}</div>
    </div>
  );
}
