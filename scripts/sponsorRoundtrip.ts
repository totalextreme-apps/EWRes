import { readFileSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

// Adjust these imports to match your actual filenames:
import { parseSponsorDat } from "../src/ewr/parseSponsorDat";
import { writeSponsorDat } from "../src/ewr/writeSponsorDat";
import { validateSponsorDatBytes } from "../src/ewr/validateSponsorDat";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm run sponsor:roundtrip -- <inputSponsorDat> <outputSponsorDat>",
      "",
      "Examples:",
      '  npm run sponsor:roundtrip -- sponsor.dat sponsor_roundtrip.dat',
      '  npm run sponsor:roundtrip -- /abs/path/sponsor.dat /abs/path/sponsor_roundtrip.dat',
      "",
      "Notes:",
      "  When run via npm, relative paths are resolved from the directory you ran the npm command in (INIT_CWD),",
      "  not necessarily the project directory (process.cwd()).",
    ].join("\n")
  );
  process.exit(2);
}

function resolvePath(p: string, baseDir: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

function main() {
  const inputPath = process.argv[2];
  const outPath = process.argv[3];

  if (!inputPath || !outPath) usage();

  // When invoked via `npm`, INIT_CWD is the directory where you ran the command.
  // This is what people expect for resolving relative input/output file paths.
  const baseDir = process.env.INIT_CWD || process.cwd();

  const inAbs = resolvePath(inputPath, baseDir);
  const outAbs = resolvePath(outPath, baseDir);

  const original = new Uint8Array(readFileSync(inAbs));

  // validate input bytes
  validateSponsorDatBytes(original);

  // parse -> write roundtrip
  const sponsors = parseSponsorDat(
    original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)
  );
  const outBytes = writeSponsorDat(original, sponsors);

  writeFileSync(outAbs, outBytes);

  console.log(`Read:  ${inAbs}`);
  console.log(`Wrote: ${outAbs}`);
}

main();
