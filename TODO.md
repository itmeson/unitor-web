# Unitor web app — roadmap and deferred issues

## Roadmap

### Done
- TypeScript + esbuild scaffold with dev server, production build,
  typecheck, lint, and test scripts
- Pure-logic core ported from the Obsidian plugin: parser, compute,
  format, expression evaluator (no Obsidian imports, runs under node)
- Test harness (`src/harness.ts`) runnable via `npm run test`
- DOM renderer (`src/render.ts`) rewritten as a standalone function,
  replacing Obsidian's `createDiv`/`createSpan`/`createEl` helpers
- Self-contained CSS with `--unitor-*` custom properties and a
  `prefers-color-scheme: dark` override
- Two-pane layout: source textarea on the left, live preview on the
  right, re-rendering on every keystroke
- URL hash + localStorage persistence with priority ordering
  (hash → localStorage → default block), and a hashchange listener so
  address-bar edits and paste-into-private-window both work
- "Copy share link" header button with clipboard-API fallback messaging
- Card flipping: each factor card has a ⇅ button that rewrites its
  source line via `flipLine`, updates the textarea, and runs the full
  persist + re-render pipeline
- Repo cleanup: deleted `src/_legacy/` and the Obsidian release
  artifacts (`manifest.json`, `version-bump.mjs`, `versions.json`);
  dropped their entries from `tsconfig.json` and `eslint.config.mts`

### In progress / next
- Multi-block document model shipped: `---` lines or 2+ blank lines
  split the textarea into independent blocks, rendered with a thin
  separator. Flip buttons continue to work across blocks via absolute
  source-line indices. Harness covers the split rules.
- "Copy card" affordance so students can pull frequently-used factors
  into a new block (see *Stored conversion cards* below)

### Later
- **Clear-all button.** Wipe the textarea, the URL hash, and the
  localStorage entry in one click. Needs a confirm prompt since it's
  destructive.
- **Reset-to-example button.** Re-populate the textarea with
  `DEFAULT_BLOCK` (and clear hash + localStorage) so a student can get
  back to the built-in walkthrough without hunting for it. Probably
  lives next to Clear-all in the header.
- Card addition and subtraction with unit-compatibility errors
- Stored / named conversion cards for reuse
- Export: copy as text, save as PDF, paste into Google Docs
- Named physical constants (c, g, h, k_B, …); today only `pi`, `π`, `e`
- Literal `×` accepted as a multiplier in source
- Unicode superscripts accepted in source
- Parentheses in unit expressions
- Fractional unit exponents
- Minimum sig figs derived from inputs (the current 3-sig-fig cap is a
  ceiling; add a floor)
- Configurable max sig figs
- Strict-teaching sig-figs mode (display exactly the min sig figs of
  the inputs)
- Inline rendering inside the textarea (would require swapping the
  plain `<textarea>` for a code-editor component; lower value now that
  the side preview is already live)

---

## Details

### Multiple blocks — status
Implemented via a document-level parser: the textarea is split on
either a `---` line (trimmed, all dashes, 3+) or on runs of 2+
consecutive blank lines. Each block is parsed independently with its
own cancellation, errors, labels, and `resultLabel`. The preview pane
renders blocks in order with a thin `<hr>` separator between them.
Block `startLine` offsets keep `sourceLine` indices absolute across
the full document, so the existing flip handler works without any
changes. URL sharing encodes the entire document in the hash as
before, which is fine for the current block sizes.

Follow-ups that did not feel worth building immediately:
- Per-block headers or collapsible regions
- A "jump to block" TOC if documents grow long
- Tab UI if a single scrolling preview gets unwieldy

### Export
Students need to paste worked problems into lab reports. Possible
outputs:

- **Plain text** — already works via the textarea. Could add a "Copy
  source" button alongside "Copy share link".
- **Markdown / unicode** — copy a pretty text representation of the
  whole chain (`5 km · 1 hr / 3600 s = 0.00139 km/s`). Handy for
  pasting into Google Docs.
- **Image (PNG / SVG)** — render the preview to an image and download.
  Works well for visual cancellation but can't be edited downstream.
- **PDF** — useful for handing in homework; same caveats as image.

Start with the text / markdown option since it's cheapest and covers
the common "paste into doc" flow.

### Expression cards — follow-ups
Backtick-delimited expressions work: `` `4*pi*6.4^2` m^2 `` evaluates
at parse time and the pretty-printed formula (`4·π·6.4²`) is shown on
the factor card. Follow-ups:

- Add more named constants (c, g, h, k_B, …). Today only `pi`, `π`,
  and `e` are supported.
- Consider a small fraction or sub/superscript layout for complex
  pretty-printed expressions instead of flat inline text.

### Number notation in parser — remaining niceties
Scientific notation `3*10^8` is parsed and rendered as `3 × 10⁸`.
Still open:

- Accept a literal `×` as a multiplier (so `3 × 10^8` also works).
- Accept Unicode superscript digits directly in source.

### Compound units — remaining follow-ups
Compound unit expressions (`kg*m/s^2`, `m^2`, …) work. Not yet
addressed:

- Parentheses in unit expressions (currently strictly left-to-right).
- Fractional exponents (only integers today).

### Stored conversion cards / unit definitions
Let frequently-used conversion factors live in a shared library so
students don't have to retype them. Possible approaches in a web-app
context:

- **Sidebar / palette.** A collapsible panel lists saved factors; click
  one to insert it at the cursor in the textarea.
- **`@name` expansion in source.** Writing `@mi_to_km` expands to
  `1.609 km / 1 mi` at parse time. Terse but adds parser complexity
  and requires memorizing names.
- **Keyboard shortcut / slash menu.** Type `/mi` in the textarea and
  get an autocomplete of matching factors.

Storage: localStorage dictionary at first (per-browser, zero backend).
Later, optional import/export of a JSON dictionary so teachers can
distribute a standard set.

This interacts with card labels — a stored conversion would naturally
carry a label — and with the export story (a JSON dictionary is a
sharable artifact).

### Card addition and subtraction
Extend block syntax so some lines combine additively. Today every line
is a multiplicative factor. Possible syntax:

```
60 mi / hr
+ 10 mi / hr
```
Result: 70 mi/hr.

**Unit compatibility** is the pedagogically valuable part: show an
error ("cannot add mi/hr to km — incompatible units") when dimensions
don't match. Students *see* why it's wrong rather than getting a
nonsense number.

Design questions:
- Can multiplicative chains and additive operations mix in one block?
  Probably needs grouping syntax or blank-line separation.
- Auto-convert when units are compatible but not identical (mi/hr +
  km/hr)? Probably not initially — make students do the conversion
  explicitly.

### Significant figures — follow-ups
Results are rounded to at most 3 sig figs for display, and
large/small magnitudes switch to scientific notation. Still open:

- **Minimum sig figs based on inputs.** Track the sig figs of each
  input quantity and ensure the displayed result has at least as many
  as the most precise input requires (capped at the max). The current
  3 is a ceiling; add a floor derived from the inputs.
- Make the max sig-figs count configurable (a header flag per block, a
  URL query param, or a settings pane).
- A stricter teaching mode that displays exactly the min sig figs of
  the inputs (the textbook rule for mult/div).

### Card labels — status
Card annotations via a `# label` line above a factor are implemented,
as is the trailing `# label` labeling the result card. No known
follow-ups.

### Card flipping — status
Implemented: each factor card carries a ⇅ button that calls `flipLine`
on the corresponding source line, writes the new value into the
textarea, and runs the same persist + re-render pipeline as typing. A
flip on a card already in a cancellation pair recomputes cancellation
against its new neighbors correctly (cancellation is purely a function
of the post-flip source). The flip preserves expression-card syntax —
backtick expressions move between numerator and denominator positions
intact.
