import { decodeSingleByte } from "./textEncoding";
export type RelationshipType =
  | "Blood Relative"
  | "Love"
  | "Hate"
  | "Loyalty"
  | "Dislike"
  | "Friendship";

export const RELATIONSHIP_TYPE_OPTIONS: RelationshipType[] = [
  "Blood Relative",
  "Dislike",
  "Friendship",
  "Hate",
  "Love",
  "Loyalty",
];

// EWR stores this as a u16 where the high byte is always 0 in our diffs.
export function relationshipTypeToCode(t: RelationshipType): number {
  switch (t) {
    case "Blood Relative":
      return 0;
    case "Love":
      return 1;
    case "Hate":
      return 2;
    case "Loyalty":
      return 3;
    case "Dislike":
      return 4;
    case "Friendship":
      return 5;
    default:
      return 0;
  }
}

export function relationshipCodeToType(code: number): RelationshipType {
  switch (code) {
    case 0:
      return "Blood Relative";
    case 1:
      return "Love";
    case 2:
      return "Hate";
    case 3:
      return "Loyalty";
    case 4:
      return "Dislike";
    case 5:
      return "Friendship";
    default:
      return "Blood Relative";
  }
}

export const RELATE_RECORD_SIZE = 37;

// Layout (0-based offsets):
// 0        : 0x34 ('4') constant string prefix
// 1..30    : Relationship Name (30 chars), space padded
// 31..32   : Person A ID (u16 LE)  (appears 1-based in shipped data; allow 0 for None)
// 33..34   : Person B ID (u16 LE)
// 35..36   : Relationship Type (u16 LE), low byte used (0..5)
export type RelateRecord = {
  index: number;
  name: string;
  personAId: number; // stored ID (1-based); 0 allowed for None
  personBId: number;
  type: RelationshipType;
};

function decodeName(bytes: Uint8Array): string {
  // bytes length must be 31 (prefix + 30 chars)
  const raw = bytes.slice(1, 31);
  // Latin-1 keeps bytes stable; the game uses ANSI-ish text in many dat files
  return decodeSingleByte(raw);
}

export function parseRelateDat(u8: Uint8Array): RelateRecord[] {
  const out: RelateRecord[] = [];
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  const count = Math.floor(u8.length / RELATE_RECORD_SIZE);
  for (let i = 0; i < count; i++) {
    const base = i * RELATE_RECORD_SIZE;

    const nameBytes = u8.slice(base, base + 31);
    const name = decodeName(nameBytes);

    const personAId = view.getUint16(base + 31, true);
    const personBId = view.getUint16(base + 33, true);
    const typeCode = view.getUint16(base + 35, true);

    out.push({
      index: i,
      name,
      personAId,
      personBId,
      type: relationshipCodeToType(typeCode),
    });
  }
  return out;
}
