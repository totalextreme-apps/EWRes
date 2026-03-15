import React from "react";

export type EditorHeaderProps = {
  title: React.ReactNode;
  leftPills?: React.ReactNode[];
  rightPills?: React.ReactNode[];
};

function renderPills(list?: React.ReactNode[]) {
  if (!list || list.length === 0) return null;
  return list
    .map((node, i) => {
      if (node === null || node === undefined || node === false) return null;
      // If caller already passed an element with className="ewr-pill", keep it.
      if (React.isValidElement(node)) {
        const cn = (node.props as any)?.className;
        if (typeof cn === "string" && cn.split(/\s+/).includes("ewr-pill")) return React.cloneElement(node, { key: i });
      }
      return (
        <div key={i} className="ewr-pill">
          {node}
        </div>
      );
    })
    .filter(Boolean);
}

export function EditorHeader({ title, leftPills, rightPills }: EditorHeaderProps) {
  const left = renderPills(leftPills);
  const right = renderPills(rightPills);

  return (
    <>
      <div className="ewr-mainTitleBar">{title}</div>
      <div className="ewr-mainMetaRow">
        <div className="ewr-pillRow">{left}</div>
        <div className="ewr-pillRow">{right}</div>
      </div>
    </>
  );
}
