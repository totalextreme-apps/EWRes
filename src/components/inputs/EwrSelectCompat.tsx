import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type NativeOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type EwrSelectChangeEvent = { target: { value: string; name?: string; id?: string } };

type Props = {
  value?: string | number;
  onChange?: (event: EwrSelectChangeEvent) => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  title?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
};

type MenuRect = { top: number; left: number; width: number };

function flattenOptions(children: React.ReactNode): NativeOption[] {
  const out: NativeOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ value?: string | number; disabled?: boolean; children?: React.ReactNode }>(child)) return;
    const type = typeof child.type === "string" ? child.type.toLowerCase() : "";
    if (type === "option") {
      out.push({
        value: String(child.props.value ?? ""),
        label: child.props.children,
        disabled: !!child.props.disabled,
      });
    }
  });
  return out;
}

const MENU_BG = "linear-gradient(180deg, rgba(18, 26, 47, 0.995), rgba(9, 14, 26, 0.995))";
const MENU_BORDER = "1px solid rgba(110, 126, 173, 0.45)";
const MENU_TEXT = "#f5f7ff";
const MENU_HOVER = "rgba(46, 91, 255, 0.22)";
const MENU_SELECTED = "rgba(255, 255, 255, 0.14)";

export default function EwrSelectCompat({
  value,
  onChange,
  children,
  className,
  style,
  disabled,
  title,
  id,
  name,
  "aria-label": ariaLabel,
}: Props) {
  const options = useMemo(() => flattenOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const currentValue = String(value ?? "");
  const selected = options.find((opt) => opt.value === currentValue) ?? options[0];

  const updateMenuPosition = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setMenuRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, value, children]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onReposition = () => updateMenuPosition();
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const emitChange = (nextValue: string) => {
    onChange?.({ target: { value: nextValue, name, id } });
  };

  const menu = open && !disabled && menuRect
    ? createPortal(
        <div
          ref={menuRef}
          className="ewr-selectMenu"
          role="listbox"
          aria-labelledby={id}
          style={{
            position: "fixed",
            top: menuRect.top,
            left: menuRect.left,
            width: Math.max(menuRect.width, 220),
            zIndex: 2147483647,
            maxHeight: 280,
            overflowY: "auto",
            overflowX: "hidden",
            borderRadius: 12,
            border: MENU_BORDER,
            background: MENU_BG,
            boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
            padding: 6,
            color: MENU_TEXT,
            fontSize: 14,
            lineHeight: 1.2,
            boxSizing: "border-box",
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === currentValue;
            const isHovered = hovered === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                className={`ewr-selectOption${isSelected ? " is-selected" : ""}`}
                onMouseEnter={() => setHovered(opt.value)}
                onMouseLeave={() => setHovered((prev) => (prev === opt.value ? null : prev))}
                onFocus={() => setHovered(opt.value)}
                onBlur={() => setHovered((prev) => (prev === opt.value ? null : prev))}
                onClick={() => {
                  if (opt.disabled) return;
                  emitChange(opt.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                style={{
                  width: "100%",
                  display: "block",
                  textAlign: "left",
                  border: 0,
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: opt.disabled ? "not-allowed" : "pointer",
                  background: isHovered ? MENU_HOVER : isSelected ? MENU_SELECTED : "transparent",
                  color: MENU_TEXT,
                  opacity: opt.disabled ? 0.55 : 1,
                  fontSize: 14,
                  lineHeight: 1.2,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div ref={rootRef} className="ewr-select" style={{ position: "relative", width: "100%", ...style }}>
        <button
          ref={buttonRef}
          type="button"
          id={id}
          name={name}
          title={title}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          className={`${className ?? "ewr-input"} ewr-selectButton`}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
          }}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}
        >
          <span className="ewr-selectButtonLabel" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 auto" }}>{selected?.label ?? ""}</span>
          <span className="ewr-selectChevron" style={{ marginLeft: 10, opacity: 0.9, flex: "0 0 auto" }}>▾</span>
        </button>
      </div>
      {menu}
    </>
  );
}
