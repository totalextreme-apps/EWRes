import React from "react";
import EwrSelectCompat from "./EwrSelectCompat";

type OptionItem = {
  value: string | number;
  label: React.ReactNode;
  disabled?: boolean;
};

type Props = {
  value?: string | number;
  onChange?: (value: string) => void;
  options: OptionItem[];
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  title?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
};

export default function EwrSelect({
  value,
  onChange,
  options,
  className,
  style,
  disabled,
  title,
  id,
  name,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <EwrSelectCompat
      value={value}
      onChange={(event) => onChange?.(String(event.target.value ?? ""))}
      className={className ?? "ewr-input"}
      style={style}
      disabled={disabled}
      title={title}
      id={id}
      name={name}
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <option key={String(opt.value)} value={String(opt.value)} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </EwrSelectCompat>
  );
}
