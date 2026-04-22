# Unitor

A pedagogical dimensional-analysis tool for physics and science students.
Write a chain of factor cards, see units cancel between them in matching
colors, and read the final quantity off the result card.

This is the standalone web-app version. Its older sibling is an Obsidian
plugin; the pure-logic core (parser, compute, formatter, expression
evaluator) is shared between them.

**Live demo:** <https://itmeson.github.io/unitor-web/>

## What it looks like

Type a block like this into the textarea:

```
#speed in miles per hour
30 mile/hr
1609 meters / 1 mile
1 hr / 60 min
1 min / 60 sec
#speed in meters per sec
```

The preview renders a horizontal row of cards joined by `×` and `=`. Each
conversion factor cancels a unit against its neighbor — `mile` cancels
with `mile`, `hr` with `hr`, `min` with `min` — in matching colors, so a
student can see the dimensional bookkeeping as they set it up. The
residual units on the result card are `meters / sec`, with the numeric
answer filled in. The `#` lines label the first and last cards.

## Input syntax

Each non-empty, non-comment line is a factor (one card); the result card
is computed automatically. `---` lines or two or more consecutive blank
lines split the textarea into independent blocks, each with its own
result card.

- **Basic quantity:** `5 km`, `9.8 m/s^2`, `0.5 kg*m^2/s^2`. `*` is
  unit-level multiplication, `/` (with no spaces) is unit-level division.
- **Fraction card:** ` / ` with spaces on both sides splits a line into
  numerator and denominator: `1.609 km / 1 mi`.
- **Expression card:** backtick-delimited arithmetic in the numerator or
  denominator: `` `4*pi*6.4^2` m^2 ``. Constants `pi`, `π`, and `e` are
  recognised. The factor card shows the pretty-printed expression
  (`4·π·6.4²`); the result card resolves to the number.
- **Scientific notation:** `3*10^8` parses as 3 × 10⁸ and displays the same
  way on the card.
- **Bare dimensionless numerators:** `1 / 5 km` is valid — the numerator
  is just `1`.
- **Labels:** a `# label` line immediately before a factor attaches a
  caption above that card. A trailing `# label` at the end of a block
  (with no factor after it) labels the result card.

Parse errors are reported per-line below the preview; one bad line
doesn't break the rest of the block.

## Interactive features

- **Live preview.** Every keystroke re-renders.
- **Multi-block documents.** `---` or 2+ blank lines split the textarea
  into independent blocks, each rendered with its own result card and a
  thin separator between them.
- **Cancellation.** Matching unit slots between adjacent cards are struck
  through in a color unique to that pair (8-color palette, cycles if
  there are more than 8 pairs).
- **Flip buttons (⇅).** Each factor card has a small flip button that
  swaps its numerator and denominator and rewrites the corresponding
  source line.
- **Copy buttons (⧉).** Each card has a copy button that inserts the
  card's source at the textarea cursor. Result cards synthesize a
  parseable factor line from the rounded value and residual units.
- **Star buttons (☆/★).** Toggle a factor into/out of the library
  palette. Unlabeled cards prompt for a label first.
- **Library palette.** A side panel (toggled from the header) listing
  saved conversion factors. Click a row to insert it at the cursor.
  Import/export as JSON files, so teachers can distribute curated factor
  sets and students can build their own over time.
- **Shareable URLs.** Source and library are deflate-compressed and
  base64url-encoded into a `?d=` query parameter. The "Copy share link"
  button copies the current URL; anyone who opens it sees the same
  source and library. A clipboard fallback via `document.execCommand`
  handles Canvas/LMS iframe embeds where the modern Clipboard API is
  blocked by Permissions Policy. Legacy URLs using the older `?lib=` +
  `#source` format are still decoded on boot.
- **Open in new tab.** A header link that opens the current state in a
  full browser tab — useful when Unitor is embedded in a Canvas iframe.
- **Recents.** A header dropdown listing the last 20 URLs the user has
  edited, stored in `localStorage` under `unitor:recents`. Writes are
  throttled (every 2 minutes + a `beforeunload` flush) so closing a tab
  without bookmarking still leaves a recoverable snapshot. Each entry is
  labelled by the document's first `#label` line.
- **Mobile menu.** On narrow screens the header actions collapse behind
  a `⋮` button to avoid overlapping the branding.

The URL is the sole source of truth for document content. A bare URL is
a blank calculator; there is no default demo block. `localStorage` is
used only for the recents list and the library-panel open/closed
preference.

## Running locally

Requirements: Node.js 16 or newer. (Only needed for development — the
built app is static HTML/CSS/JS.)

```
npm install
npm run dev
```

Then open <http://127.0.0.1:5173>. The dev server rebuilds and serves
`dist/app.js` on every save.

Other scripts:

- `npm run build` — type-check and produce a production bundle in
  `dist/app.js`.
- `npm run typecheck` — TypeScript check only, no emit.
- `npm run test` — run the parser/compute/format/library/recents/compress
  harness in `src/harness.ts`.
- `npm run lint` — ESLint.

## Deploying

The app is a static site: `index.html`, `styles.css`, and `dist/app.js`.
Any static host will serve it. There is no backend.

## Project layout

```
src/
  app.ts         — entry point: DOM wiring, persistence, flip/copy/star/
                   share/recents UI, mobile menu toggle
  render.ts      — DOM renderer (pure function of source string)
  parser.ts      — parseBlock, parseDocument, parseLine,
                   parseUnitExpression, flipLine
  compute.ts     — slot-based cancellation with pair IDs
  format.ts      — formatResultValue, superscript, prettyPrintExpression,
                   serializeResultAsFactorLine
  expression.ts  — recursive-descent evaluator for backtick expressions
  library.ts     — pure in-memory library store (add, remove, has,
                   import/export, URL encode/decode)
  palette.ts     — DOM renderer for the library side panel
  recents.ts     — localStorage-backed recent-URLs list with labels and
                   relative-time formatting
  compress.ts    — deflate + base64url encoding for URL state
  harness.ts     — test harness (73 tests)
scripts/
  run-harness.mjs — bundles src/harness.ts and runs it under node
index.html       — app shell: header, two-pane layout, library panel,
                   mobile menu styles
styles.css       — card rendering, library palette, recents dropdown;
                   self-contained CSS custom properties with dark-mode
                   override via prefers-color-scheme
esbuild.config.mjs — dev server + production bundler
```

`parser.ts`, `compute.ts`, `format.ts`, `expression.ts`, `library.ts`,
`recents.ts`, and `compress.ts` have zero DOM or browser dependencies
and can be run in Node directly. `render.ts`, `palette.ts`, and `app.ts`
are the files that touch the DOM.

## Author

Mark Betnel, Seattle Academy. Originally built as an Obsidian plugin for
classroom use; the web app exists so students can access it without
installing anything.

## License

0-BSD. See `LICENSE`.
