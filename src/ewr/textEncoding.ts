// src/ewr/textEncoding.ts

export function decodeSingleByte(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x00) break;
    out += String.fromCharCode(b);
  }
  return out.replace(/\0/g, "").trimEnd().trim();
}

export function encodeSingleByteFixed(value: unknown, length: number, padByte = 0x20): Uint8Array {
  const s = String(value ?? "");
  const out = new Uint8Array(length);
  out.fill(padByte);
  let j = 0;
  for (let i = 0; i < s.length && j < length; i++) {
    const code = s.charCodeAt(i);
    out[j++] = code <= 0xff ? code : 0x3f;
  }
  return out;
}

export function writeSingleByteFixed(dst: Uint8Array, offset: number, value: unknown, length: number, padByte = 0x20) {
  dst.set(encodeSingleByteFixed(value, length, padByte), offset);
}

export function withUtf8Bom(text: string): Uint8Array {
  return new TextEncoder().encode("\uFEFF" + text);
}
