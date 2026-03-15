// src/ewr/validateAlterDat.ts
//
// Minimal structural validation for alter.dat.
// We only enforce record size; field semantics are handled by UI constraints.

import { ALTER_LAYOUT } from "./parseAlterDat";

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function validateAlterDatBytes(bytes: Uint8Array) {
  assert(bytes.length > 0, "alter.dat is empty.");
  assert(bytes.length % ALTER_LAYOUT.recordSize === 0, `alter.dat size must be a multiple of ${ALTER_LAYOUT.recordSize}.`);
  return true;
}
