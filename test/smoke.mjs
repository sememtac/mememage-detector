// mememage-detector — smoke test.
//
// Construction, API shape, the decode guard, start/stop, and the detectAt decode path
// against a stub DOM + stub decode. This proves the module LOADS and its seam is wired.
// The full behavioral gate (real markers on a real page, geometry, mutation tracking) is
// the browser extension's machine test — the detector's reference consumer.
import { createDetector } from "../src/index.js";
import assert from "node:assert";

let failures = 0;
function ok(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (e) { failures++; console.log("FAIL  " + name + " — " + (e && e.message)); }
}

// ---- a DOM stub just deep enough to construct + run start/stop ----
class Obs { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} }
const win = {
  IntersectionObserver: Obs, ResizeObserver: Obs, MutationObserver: Obs,
  innerWidth: 1200, innerHeight: 800,
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  performance: { now() { return 0; } },
  getComputedStyle() { return {}; },
  addEventListener() {}, removeEventListener() {},
  location: { href: "http://example/" },
  Element: class {},
};
const emptyNode = { tagName: "HTML", querySelectorAll() { return []; } };
const doc = {
  documentElement: emptyNode,
  createElement() { return { getContext() { return { drawImage() {} }; }, toDataURL() { return "data:png"; } }; },
  addEventListener() {}, removeEventListener() {},
};
const dom = { document: doc, window: win, root: emptyNode };

const stubDecode = () => Promise.resolve({ found: false });

ok("throws without a decode function", () => {
  assert.throws(() => createDetector({}), /decode/);
  assert.throws(() => createDetector({ decode: 5, ...dom }), /decode/);
});

ok("constructs and exposes the API", () => {
  const d = createDetector({ decode: stubDecode, ...dom });
  ["on", "place", "detectAt", "start", "stop"].forEach((k) =>
    assert.strictEqual(typeof d[k], "function", k + " should be a function"));
  assert.strictEqual(d.MIN_W, 200);
  assert.strictEqual(d.MIN_H, 48);
});

ok("honors option overrides", () => {
  const d = createDetector({ decode: stubDecode, ...dom, options: { minWidth: 64, minHeight: 16 } });
  assert.strictEqual(d.MIN_W, 64);
  assert.strictEqual(d.MIN_H, 16);
});

ok("start() then stop() do not throw", () => {
  const d = createDetector({ decode: stubDecode, ...dom });
  d.start();
  d.stop();
});

await new Promise((resolve) => {
  const bar = { identifier: "mememage-0000000000000000", contentHash: "deadbeefdeadbeef",
                bottomRow: 1, left: 0, right: 9 };
  const decode = () => Promise.resolve({ found: true, width: 10, height: 2, bars: [bar] });
  const d = createDetector({ decode, ...dom });
  d.detectAt("http://example/img.png", null).then((res) => {
    ok("detectAt resolves a found detection", () => {
      assert.strictEqual(res.found, true);
      assert.strictEqual(res.detection.bars[0].identifier, bar.identifier);
      assert.strictEqual(res.detection.bars[0]._sw, 10);   // scan width stamped onto the bar
      assert.strictEqual(res.detection.scanHeight, 2);
    });
    resolve();
  });
});

await new Promise((resolve) => {
  const d = createDetector({ decode: () => Promise.resolve({ found: false }), ...dom });
  d.detectAt("http://example/plain.png", null).then((res) => {
    ok("detectAt reports noBar when nothing is found", () => assert.strictEqual(res.noBar, true));
    resolve();
  });
});

console.log(failures ? "\n" + failures + " FAILED" : "\nall smoke checks passed");
process.exit(failures ? 1 : 0);
