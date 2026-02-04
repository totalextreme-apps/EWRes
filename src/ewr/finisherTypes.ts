// src/ewr/finisherTypes.ts
// EWR 4.2 wrestler.dat finisher type flags (locked 3-flag layout)
//
// Flags are u16le booleans: 0x0000 (off) or 0xFFFF (on)

export type FinisherType =
  | "Impact"
  | "Submission"
  | "Top Rope"
  | "Ground"
  | "Corner"
  | "Top Rope Standing";

export function decodeFinisherType(flagA: number, flagB: number, flagC: number): FinisherType {
  const A = flagA === 0xffff;
  const B = flagB === 0xffff;
  const C = flagC === 0xffff;

  // Multi-flag combos first
  if (A && B && !C) return "Top Rope Standing";
  if (!A && B && C) return "Corner";

  // Single-flag types
  if (A && !B && !C) return "Submission";
  if (!A && B && !C) return "Top Rope";
  if (!A && !B && C) return "Ground";

  // None set (or unexpected combos)
  return "Impact";
}

export function encodeFinisherType(type: FinisherType): { flagA: number; flagB: number; flagC: number } {
  switch (type) {
    case "Impact":
      return { flagA: 0x0000, flagB: 0x0000, flagC: 0x0000 };
    case "Submission":
      return { flagA: 0xffff, flagB: 0x0000, flagC: 0x0000 };
    case "Top Rope":
      return { flagA: 0x0000, flagB: 0xffff, flagC: 0x0000 };
    case "Ground":
      return { flagA: 0x0000, flagB: 0x0000, flagC: 0xffff };
    case "Top Rope Standing":
      return { flagA: 0xffff, flagB: 0xffff, flagC: 0x0000 };
    case "Corner":
      return { flagA: 0x0000, flagB: 0xffff, flagC: 0xffff };
    default:
      return { flagA: 0x0000, flagB: 0x0000, flagC: 0x0000 };
  }
}
