// tools/fix_staff_joinpath.cjs
// Fixes a common TS syntax break caused by an unescaped backslash in StaffEditor.tsx:
//
//   dir.endsWith("\")   <-- invalid
//
// This script rewrites the entire joinPath() function to a safe implementation that
// does not require embedding a backslash literal.
//
// Run from repo root:
//   node tools/fix_staff_joinpath.cjs
//
const fs = require("fs");
const path = require("path");

const FILE = path.join("src", "StaffEditor.tsx");

function fail(msg) {
  console.error("[fix_staff_joinpath] " + msg);
  process.exit(1);
}

if (!fs.existsSync(FILE)) fail(`Missing ${FILE}`);

let src = fs.readFileSync(FILE, "utf8");

const joinRe = /function\s+joinPath\s*\([\s\S]*?\n\}/m;
if (!joinRe.test(src)) {
  fail("Could not locate function joinPath(...) { ... } in src/StaffEditor.tsx");
}

const replacement = `function joinPath(dir: string, fileName: string) {
  if (!dir) return fileName;

  // Safe backslash constant (avoids string escaping issues)
  const BACKSLASH = String.fromCharCode(92);

  const last = dir.charAt(dir.length - 1);
  const hasSep = last === "/" || last === BACKSLASH;
  const sep = hasSep ? "" : "/";

  return \`\${dir}\${sep}\${fileName}\`;
}`;

src = src.replace(joinRe, replacement);

fs.writeFileSync(FILE, src, "utf8");
console.log("[fix_staff_joinpath] Patched src/StaffEditor.tsx joinPath()");
