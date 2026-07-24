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

// ---- node-removal sweep (D1): an element removed from the DOM must (a) fire 'removed'
// and leave detectedEls (no orphaned markers, no leak under SPA churn), and (b) dispatch
// the mememage:removed DOM event on a CONNECTED node — a detached element can't bubble, so
// a document-level delegated listener would otherwise never hear it (the real-Chrome gap
// the in-world-only check missed). A controllable MutationObserver stub fires the removal;
// dispatch targets are recorded per node. ----
await new Promise((resolve) => {
  let moCb = null;
  class MO { constructor(cb) { moCb = cb; } observe() {} disconnect() {} }
  class CE { constructor(name, opts) { this.type = name; this.detail = (opts || {}).detail; } }
  const dispatchedOn = [];
  const mkNode = (props) => Object.assign(
    { dispatchEvent(ev) { dispatchedOn.push({ node: this, type: ev.type }); return true; } }, props);
  const rootNode = mkNode({ tagName: "HTML", isConnected: true, querySelectorAll() { return []; } });
  const el = mkNode({ tagName: "IMG", isConnected: true,
                      currentSrc: "http://example/x.png", src: "http://example/x.png" });
  const bar = { identifier: "mememage-0000000000000000", contentHash: "deadbeefdeadbeef",
                bottomRow: 1, left: 0, right: 9 };
  const decode = () => Promise.resolve({ found: true, width: 10, height: 2, bars: [bar] });
  const d = createDetector({ decode, document: doc,
                             window: { ...win, MutationObserver: MO, CustomEvent: CE }, root: rootNode });
  let removedEl = null, detectedCount = 0;
  d.on("detected", () => { detectedCount++; });
  d.on("removed", (e) => { removedEl = e.element; });
  d.start();                                       // installs the MutationObserver -> captures moCb
  d.detectAt("http://example/x.png", el).then(() => {
    ok("element is detected before removal", () => assert.strictEqual(detectedCount, 1));
    dispatchedOn.length = 0;                         // ignore the 'detected' dispatch
    el.isConnected = false;                          // simulate DOM removal (element detached)
    moCb([{ addedNodes: [], removedNodes: [el] }]);  // fire a removal mutation batch
    ok("removed element fires in-world 'removed'", () => assert.strictEqual(removedEl, el));
    ok("removed DOM event dispatches on a CONNECTED node (detached el can't bubble)", () => {
      const rem = dispatchedOn.find((x) => x.type === "mememage:removed");
      assert.ok(rem, "a mememage:removed DOM event should be dispatched");
      assert.strictEqual(rem.node, rootNode, "should target the connected root, not the detached element");
    });
    el.isConnected = true;                           // reconnect + re-detect: a leaked entry
    d.detectAt("http://example/x.png", el).then(() => {   // would be swallowed by the dedup Set
      ok("re-detect after removal emits a fresh detection (stale entry was cleared)",
         () => assert.strictEqual(detectedCount, 2));
      d.stop();
      resolve();
    });
  });
});

// ---- D2: a REJECTING decode must resolve gracefully, not escape as an unhandled
// rejection. Without the .catch in send(), detectAt's promise rejects. ----
await new Promise((resolve) => {
  const d = createDetector({ decode: () => Promise.reject(new Error("boom")), ...dom });
  d.detectAt("http://example/x.png", null).then(
    (res) => {
      ok("rejecting decode resolves gracefully (no unhandled rejection)",
         () => assert.ok(res && (res.noBar || res.error), "expected a noBar/error result, got " + JSON.stringify(res)));
      resolve();
    },
    (err) => {
      ok("rejecting decode resolves gracefully (no unhandled rejection)",
         () => assert.fail("detectAt rejected instead of resolving: " + (err && err.message)));
      resolve();
    }
  );
});

// ---- D3: DOM events must be built with the INJECTED realm's CustomEvent (win.CustomEvent),
// not the ambient global — else a mismatched realm silently drops the event channel. A
// sentinel CustomEvent proves the constructor the code used. ----
await new Promise((resolve) => {
  let dispatchedCtor = null;
  class RealmCustomEvent { constructor(name, opts) { this.type = name; this.detail = (opts || {}).detail; } }
  const el = {
    tagName: "IMG", isConnected: true,
    currentSrc: "http://example/y.png", src: "http://example/y.png",
    dispatchEvent(ev) { dispatchedCtor = ev.constructor; return true; },
  };
  const bar = { identifier: "mememage-0000000000000000", contentHash: "deadbeefdeadbeef",
                bottomRow: 1, left: 0, right: 9 };
  const decode = () => Promise.resolve({ found: true, width: 10, height: 2, bars: [bar] });
  const d = createDetector({ decode, document: doc, window: { ...win, CustomEvent: RealmCustomEvent }, root: emptyNode });
  d.detectAt("http://example/y.png", el).then(() => {
    ok("DOM events use the injected realm's CustomEvent (win.CustomEvent)",
       () => assert.strictEqual(dispatchedCtor, RealmCustomEvent,
             "fireDom used the ambient CustomEvent, not the injected win's"));
    resolve();
  });
});

console.log(failures ? "\n" + failures + " FAILED" : "\nall smoke checks passed");
process.exit(failures ? 1 : 0);
