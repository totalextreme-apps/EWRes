// tools/fix_activeFilterCount.js
// Makes activeFilterCount immune to TDZ runtime errors by:
// 1) declaring `let activeFilterCount = 0;` near the top of the component
// 2) converting `const activeFilterCount = useMemo(...)` to `activeFilterCount = useMemo(...)`
//
// Run from repo root:
//   node tools/fix_activeFilterCount.js
//
const fs = require("fs");
const path = require("path");

const targets = [
  path.join("src", "App.tsx"),
  path.join("src", "SponsorEditor.tsx"),
];

function fail(msg) {
  console.error("[fix_activeFilterCount] " + msg);
  process.exit(1);
}

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`[skip] ${filePath} not found`);
    return { filePath, changed: false, reason: "not found" };
  }

  let src = fs.readFileSync(filePath, "utf8");
  let changed = false;

  // Find the activeFilterCount declaration
  const declRe = /const\s+activeFilterCount\s*=\s*useMemo\s*\(/;
  if (!declRe.test(src)) {
    console.log(`[skip] ${filePath} has no "const activeFilterCount = useMemo("`);
    return { filePath, changed: false, reason: "no decl" };
  }

  // Convert const -> assignment
  src2 = src.replace(declRe, "activeFilterCount = useMemo(");
  if (src2 !== src) changed = true;
  src = src2;

  // Insert `let activeFilterCount = 0;` as early as possible in the component body.
  // We do this by locating the default exported function component opening brace.
  // Handles patterns like:
  //   export default function X(...) {
  // or
  //   function X(...) { ... export default X;
  //
  // We'll try to find the first occurrence of "export default function <Name>("
  // and insert after its first "{"
  const fnRe = /export\s+default\s+function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/m;
  const m = src.match(fnRe);

  if (m) {
    const braceIndex = src.indexOf("{", m.index);
    if (braceIndex === -1) fail(`${filePath}: couldn't locate function body brace`);
    // Check if already inserted
    const alreadyRe = /\blet\s+activeFilterCount\s*=\s*0\s*;/;
    if (!alreadyRe.test(src)) {
      src = src.slice(0, braceIndex + 1) +
        "\n  // Prevent TDZ crashes if activeFilterCount is referenced before the useMemo assignment\n  let activeFilterCount = 0;\n" +
        src.slice(braceIndex + 1);
      changed = true;
    }
  } else {
    // Fallback: insert near top-level of the file just after imports (less ideal but still prevents TDZ if helper runs at module scope).
    const alreadyRe = /\blet\s+activeFilterCount\s*=\s*0\s*;/;
    if (!alreadyRe.test(src)) {
      const importBlockEnd = src.lastIndexOf("import");
      const insertPos = src.indexOf("\n", importBlockEnd);
      src = src.slice(0, insertPos + 1) +
        "\n// Prevent TDZ crashes if activeFilterCount is referenced before the useMemo assignment\nlet activeFilterCount = 0;\n" +
        src.slice(insertPos + 1);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, src, "utf8");
    console.log(`[ok] Patched ${filePath}`);
  } else {
    console.log(`[noop] ${filePath} already patched`);
  }

  return { filePath, changed, reason: changed ? "patched" : "noop" };
}

function main() {
  const results = targets.map(patchFile);
  console.log("\nDone.");
  console.log(JSON.stringify(results, null, 2));
}

main();
