import { RELATE_RECORD_SIZE } from "./parseRelateDat";

export function validateRelateDatBytes(u8: Uint8Array): { ok: boolean; error?: string } {
  if (u8.length === 0) return { ok: false, error: "File is empty." };
  if (u8.length % RELATE_RECORD_SIZE !== 0) {
    return {
      ok: false,
      error: `Invalid relate.dat size. Expected a multiple of ${RELATE_RECORD_SIZE} bytes, got ${u8.length}.`,
    };
  }
  return { ok: true };
}
