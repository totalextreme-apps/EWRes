import React, { useEffect, useMemo, useRef, useState } from "react";

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const currentValue = String(value ?? "");
  const selected = options.find((opt) => opt.value === currentValue) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open]);

  const emitChange = (nextValue: string) => {
    onChange?.({ target: { value: nextValue, name, id } });
  };

  return (
    <div ref={rootRef} className="ewr-select" style={style}>
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
      >
        <span className="ewr-selectButtonLabel">{selected?.label ?? ""}</span>
        <span className="ewr-selectChevron">▾</span>
      </button>
      {open && !disabled ? (
        <div className="ewr-selectMenu" role="listbox" aria-labelledby={id}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === currentValue}
              disabled={opt.disabled}
              className={`ewr-selectOption${opt.value === currentValue ? " is-selected" : ""}`}
              onClick={() => {
                if (opt.disabled) return;
                emitChange(opt.value);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
