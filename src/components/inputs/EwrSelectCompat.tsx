import React, { useEffect, useMemo, useRef, useState } from "react";

type OptionItem = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  isGroupLabel?: boolean;
};

type ChangeEventLike = {
  target: { value: string };
  currentTarget: { value: string };
};

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "children"> & {
  value?: string | number;
  onChange?: (event: ChangeEventLike) => void;
  children?: React.ReactNode;
};

function flattenChildren(children: React.ReactNode): OptionItem[] {
  const items: OptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const type = typeof child.type === "string" ? child.type.toLowerCase() : "";
    if (type === "option") {
      const props = child.props as any;
      items.push({
        value: String(props.value ?? ""),
        label: props.children,
        disabled: !!props.disabled,
      });
      return;
    }
    if (type === "optgroup") {
      const props = child.props as any;
      if (props.label) {
        items.push({
          value: `__group__${String(props.label)}`,
          label: props.label,
          disabled: true,
          isGroupLabel: true,
        });
      }
      React.Children.forEach(props.children, (grandchild) => {
        if (!React.isValidElement(grandchild)) return;
        const gType = typeof grandchild.type === "string" ? grandchild.type.toLowerCase() : "";
        if (gType !== "option") return;
        const gProps = grandchild.props as any;
        items.push({
          value: String(gProps.value ?? ""),
          label: gProps.children,
          disabled: !!gProps.disabled,
        });
      });
    }
  });
  return items;
}

export default function EwrSelectCompat({
  value,
  onChange,
  children,
  className,
  style,
  disabled,
  "aria-label": ariaLabel,
  title,
  id,
  name,
}: Props) {
  const rootClassName = String(className ?? "").replace(/\bewr-input\b/g, " ").replace(/\s+/g, " ").trim();
  const options = useMemo(() => flattenChildren(children), [children]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const normalizedValue = String(value ?? "");
  const enabledOptions = useMemo(() => options.filter((opt) => !opt.disabled && !opt.isGroupLabel), [options]);
  const selectedIndex = useMemo(() => options.findIndex((opt) => opt.value === normalizedValue), [options, normalizedValue]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    function onDocPointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onDocEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onDocEscape);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onDocEscape);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const nextIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex((opt) => !opt.disabled && !opt.isGroupLabel);
    setHighlightedIndex(nextIndex);
  }, [open, options, selectedIndex]);

  function emitChange(nextValue: string) {
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } });
  }

  function commitByIndex(index: number) {
    const next = options[index];
    if (!next || next.disabled || next.isGroupLabel) return;
    emitChange(next.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function moveHighlight(delta: number) {
    if (!enabledOptions.length) return;
    const currentEnabledIndex = enabledOptions.findIndex((opt) => opt.value === options[highlightedIndex]?.value);
    const start = currentEnabledIndex >= 0 ? currentEnabledIndex : 0;
    const nextEnabledIndex = (start + delta + enabledOptions.length) % enabledOptions.length;
    const nextValue = enabledOptions[nextEnabledIndex]?.value;
    const nextIndex = options.findIndex((opt) => opt.value === nextValue);
    if (nextIndex >= 0) setHighlightedIndex(nextIndex);
  }

  return (
    <div ref={rootRef} className={`ewr-select ${rootClassName}`.trim()} style={style} data-name={name}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        title={title}
        className={`ewr-input ewr-selectButton${open ? " is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            moveHighlight(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
      >
        <span className="ewr-selectButtonLabel">{selected?.label ?? "Select"}</span>
        <span className="ewr-selectChevron" aria-hidden="true">▾</span>
      </button>

      {open && !disabled ? (
        <div
          className="ewr-selectMenu"
          role="listbox"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveHighlight(1);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              moveHighlight(-1);
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (highlightedIndex >= 0) commitByIndex(highlightedIndex);
            }
          }}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === normalizedValue;
            const isHighlighted = highlightedIndex === index;
            return (
              <button
                key={`${opt.value}-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled || opt.isGroupLabel}
                className={`ewr-selectOption${opt.isGroupLabel ? " is-groupLabel" : ""}${isSelected ? " is-selected" : ""}${isHighlighted ? " is-highlighted" : ""}`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => commitByIndex(index)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
