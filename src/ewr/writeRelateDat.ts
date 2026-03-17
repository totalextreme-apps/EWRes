import { encodeSingleByteFixed } from "./textEncoding";
import {
  RELATE_RECORD_SIZE,
  relationshipTypeToCode,
  type RelateRecord,
} from "./parseRelateDat";

function encodeName(name: string): Uint8Array {
  const out = new Uint8Array(31);
  out[0] = 0x34;
  out.set(encodeSingleByteFixed((name ?? "").toString(), 30), 1);
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
