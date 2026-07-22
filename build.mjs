// Build the plain-script (IIFE global) variant of mememage-detector from the ESM source.
//
// Why a build at all: MV3 content scripts and plain <script> tags cannot `import` ESM.
// So we ship BOTH — `src/detector.js` (ESM, for bundlers) and `dist/mememage-detector.global.js`
// (a classic script that attaches `window.MememageDetector = { createDetector }`).
//
// No bundler: the module is one dependency-free file, so the "build" is a text wrap —
// strip the two `export` statements and wrap the body in an IIFE that attaches to the
// global. Re-run after any change to src/detector.js: `node build.mjs`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "src", "detector.js"), "utf8");

// Transform ESM -> classic:
//   `export function createDetector`  ->  `function createDetector`
//   `export default createDetector;`  ->  removed (the global attach replaces it)
let body = src
  .replace(/^export\s+function\s+createDetector/m, "function createDetector")
  .replace(/^export\s+default\s+createDetector;\s*$/m, "");

if (body === src || /\bexport\b/.test(body)) {
  throw new Error("build: unexpected export shape in src/detector.js — cannot make the global build safely");
}

const out = `// mememage-detector — GENERATED plain-script build. DO NOT EDIT.
// Source: src/detector.js. Rebuild: node build.mjs.
// Attaches window.MememageDetector = { createDetector }.
(function (root) {
  "use strict";
${body.trim().replace(/^/gm, "  ")}
  var ns = root.MememageDetector = root.MememageDetector || {};
  ns.createDetector = createDetector;
})(typeof globalThis !== "undefined" ? globalThis
   : (typeof self !== "undefined" ? self : this));
`;

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "mememage-detector.global.js"), out);
console.log("built dist/mememage-detector.global.js (" + out.length + " bytes)");
