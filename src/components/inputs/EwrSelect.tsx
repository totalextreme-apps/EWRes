import React from "react";
import EwrSelectCompat, { type EwrSelectChangeEvent } from "./EwrSelectCompat";

type CompatProps = React.ComponentProps<typeof EwrSelectCompat>;
type Props = Omit<CompatProps, "onChange"> & {
  onChange?: ((value: string) => void) | ((event: EwrSelectChangeEvent) => void);
};

export default function EwrSelect({ onChange, ...props }: Props) {
  const handleChange = (event: EwrSelectChangeEvent) => {
    if (!onChange) return;
    if (onChange.length <= 1) {
      try {
        (onChange as (value: string) => void)(String(event.target.value ?? ""));
        return;
      } catch {}
    }
    (onChange as (event: EwrSelectChangeEvent) => void)(event);
  };
  return <EwrSelectCompat {...props} onChange={handleChange} />;
}
