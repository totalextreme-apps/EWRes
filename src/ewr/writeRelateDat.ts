import {
  RELATE_RECORD_SIZE,
  relationshipTypeToCode,
  type RelateRecord,
} from "./parseRelateDat";

function encodeName(name: string): Uint8Array {
  const out = new Uint8Array(31);
  out[0] = 0x34; // '4' constant prefix observed in diffs

  const safe = (name ?? "").toString().slice(0, 30);
  const enc = new TextEncoder(); // utf-8; ASCII subset is identical, which is what base data uses
  const bytes = enc.encode(safe);

  // Write as bytes (best-effort). Non-ASCII will become multi-byte; clamp to 30 bytes.
  const max = Math.min(30, bytes.length);
  out.set(bytes.slice(0, max), 1);

  // Space pad the remainder
  for (let i = 1 + max; i < 31; i++) out[i] = 0x20;

  return out;
}

export function writeRelateDat(records: RelateRecord[]): Uint8Array {
  const buf = new Uint8Array(records.length * RELATE_RECORD_SIZE);
  const view = new DataView(buf.buffer);

  records.forEach((r, i) => {
    const base = i * RELATE_RECORD_SIZE;

    buf.set(encodeName(r.name), base);

    view.setUint16(base + 31, r.personAId & 0xffff, true);
    view.setUint16(base + 33, r.personBId & 0xffff, true);

    const code = relationshipTypeToCode(r.type);
    view.setUint16(base + 35, code & 0xffff, true);
  });

  return buf;
}
