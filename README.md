# Unitor

A pedagogical dimensional-analysis tool for physics and science students.
Write a chain of factor cards, see units cancel between them in matching
colors, and read the final quantity off the result card.

This is the standalone web-app version. Its older sibling is an Obsidian
plugin; the pure-logic core (parser, compute, formatter, expression
evaluator) is shared between them.

## What it looks like

Type a block like this into the textarea:

```
# surface area of Earth
`4*pi*6.4^2` m^2

5 km
1 hr / 3600 s
# speed in km/s
```

The preview renders a horizontal row of cards joined by `×` and `=`, with
units struck through and color-matched where they cancel between adjacent
cards. The first section shows the surface area (with the expression
`4·π·6.4²` displayed on the factor card and the numeric result on the
result card). The second section multiplies `5 km` by `1 hr / 3600 s`,
with no cancellation (`hr` and `s` remain as residual units).

## Input syntax

A **block** is the text in the textarea. Each non-empty, non-comment line
is a factor (one card); the result card is computed automatically.

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
  caption above that card. A trailing `# label` at the end of the block
  (with no factor after it) labels the result card.

Parse errors are reported per-line below the preview; one bad line
doesn't break the rest of the block.

## Interactive features

- **Live preview.** Every keystroke re-renders.
- **Cancellation.** Matching unit slots between adjacent cards are struck
  through in a color unique to that pair (8-color palette, cycles if
  there are more than 8 pairs).
- **Flip buttons (⇅).** Each factor card has a small flip button that
  swaps its numerator and denominator and rewrites the corresponding
  source line. Useful when a student sets up a chain, sees units don't
  cancel the way they expected, and flips a card to fix it.
- **Persistent session.** The textarea content is saved to
  `localStorage`, so reopening the page restores your last block.
- **Shareable URLs.** The textarea content is also encoded in the URL
  hash. The "Copy share link" button in the header copies the current
  URL; pasting it into another browser loads the same block. If you
  edit the URL hash directly, the page updates to match.

The priority on load is URL hash → localStorage → a small default block,
so a shared link always wins over a saved session.

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
- `npm run test` — run the parser/compute/format harness in
  `src/harness.ts`.
- `npm run lint` — ESLint.

## Deploying

The app is a static site: `index.html`, `styles.css`, and `dist/app.js`.
Any static host will serve it. There is no backend.

## Project layout

```
src/
  app.ts         — entry point: DOM wiring, persistence, flip/share UI
  render.ts      — DOM renderer (pure function of source string)
  parser.ts      — parseBlock, parseLine, parseUnitExpression, flipLine
  compute.ts     — slot-based cancellation with pair IDs
  format.ts      — formatResultValue, superscript, prettyPrintExpression
  expression.ts  — recursive-descent evaluator for backtick expressions
  harness.ts     — test harness
scripts/
  run-harness.mjs — bundles src/harness.ts and runs it under node
index.html       — two-pane layout: source textarea left, preview right
styles.css       — self-contained CSS custom properties with dark-mode
                   override via prefers-color-scheme
esbuild.config.mjs — dev server + production bundler
```

`parser.ts`, `compute.ts`, `format.ts`, and `expression.ts` have zero DOM
or browser dependencies and can be run in Node directly. `render.ts` and
`app.ts` are the only files that touch the DOM.

## Author

Mark Betnel, Seattle Academy. Originally built as an Obsidian plugin for
classroom use; the web app exists so students can access it without
installing anything.

## License

0-BSD. See `LICENSE`.
