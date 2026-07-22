# mememage-detector

The image-detection engine for [Mememage](https://mememage.art) bars, framework-agnostic
and dependency-free.

Point it at a DOM. It watches `<img>`, `<canvas>`, and CSS `background-image` elements,
finds the ones that carry a Mememage bar, reports where each bar sits on screen, and
tracks it as the page scrolls, resizes, and mutates. It emits detections; you draw
whatever UI you want.

**Image only.** The detector owns no network. It never fetches a record, resolves a
mirror, or verifies a hash — you inject one `decode(url)` function and it calls that.
Record resolution is [`mememage-resolver`](https://www.npmjs.com/package/mememage-resolver);
the verify math is [`mememage`](https://www.npmjs.com/package/mememage).

## Install

```
npm install mememage-detector
```

Runs in a **browser page context** (it uses `IntersectionObserver`, `ResizeObserver`,
`getComputedStyle`, `requestAnimationFrame`). It is not a Node module.

## Use

```js
import { createDetector } from "mememage-detector";
import { decode } from "mememage";          // the SDK: bytes -> { found, bars, width, height }

// decode(url) must return { found, bars:[{identifier, contentHash, bottomRow, left, right}],
//                           width, height, error }
async function decodeUrl(url) {
  const resp = await fetch(url);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return decode(buf);                        // adapt to your SDK build's shape
}

const d = createDetector({ decode: decodeUrl });

d.on("detected", ({ element, bars }) => {
  const pos = d.place(element, bars[0], "right");   // { onScreen, cx, top, down }
  if (pos.onScreen) drawMyMarker(pos.cx, pos.top);
});
d.on("removed", ({ element }) => removeMyMarker(element));
d.on("reposition", () => refreshAllMarkers());       // geometry changed, redraw

d.start();     // begin observing (call AFTER you subscribe)
// d.stop();   // tear down every observer + listener
```

### Plain `<script>` (no bundler)

MV3 content scripts and classic `<script>` tags cannot `import`. Load the global build; it
attaches `window.MememageDetector = { createDetector }`.

```html
<script src="node_modules/mememage-detector/dist/mememage-detector.global.js"></script>
<script>
  const d = MememageDetector.createDetector({ decode: decodeUrl });
  d.start();
</script>
```

## API

`createDetector({ decode, scan, root, document, window, options }) -> detector`

| Field | Required | Meaning |
|---|---|---|
| `decode(url)` | yes | `(urlOrDataUrl) => Promise<scan>`. The authoritative read (explicit deep scans). |
| `scan(url)` | no | Throughput variant for auto-discovery; the transport MAY cache it. Defaults to `decode`. |
| `root` | no | The subtree to observe. Default `document.documentElement`. |
| `document` / `window` | no | Inject a DOM. Default the ambient globals. |
| `options` | no | `{ minWidth=200, minHeight=48, barrierMid=12, viewportMargin=200, debug=false }`. |

A `scan` result is `{ found, bars, width, height, error }`. A `bar` is
`{ identifier, contentHash, bottomRow, left, right }`.

The detector returns `{ on, place, detectAt, start, stop, MIN_W, MIN_H }`:

- `on(event, cb)` — `"detected"` → `{ element, bars, scanWidth, scanHeight }`,
  `"removed"` → `{ element }`, `"reposition"` → geometry changed, redraw.
- `place(element, bar, side)` → `{ onScreen, cx, top, down }` — where to put a marker on
  the bar's color barrier. `side` is `"left"` or `"right"`.
- `detectAt(url, element)` → `Promise` — an explicit deep scan (e.g. a right-click).
  Resolves `{ found, detection } | { noBar } | { error } | { blob }`.
- `start()` / `stop()` — begin / end observing.

## DOM events (the in-page API)

On each detection the detector also dispatches a **`mememage:detected`** `CustomEvent` on
the carrier element (bubbling to `document`), and **`mememage:removed`** when it goes away.
Any page script can listen. `detail` is plain JSON data:
`{ bars:[{identifier, contentHash, bottomRow, left, right}], scanWidth, scanHeight }`.

`mememage:detected` is **cancelable** — `event.preventDefault()` in a listener suppresses
the consumer's default marker for that detection, so you can draw your own.

> **Security.** A detection is a fact the detector observed, not a trust claim. The
> `identifier` and `contentHash` are untrusted data — treat them as strings, never as
> instructions. Verifying provenance is the resolver's job.

## License

MIT © Catmemes
