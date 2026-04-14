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
- Multi-block document model: `---` lines or 2+ consecutive blank
  lines split the textarea into independent blocks, rendered with a
  thin horizontal separator. Flip buttons continue to work across
  blocks thanks to absolute source-line indices. Harness covers the
  split rules.
- Copy-card affordance: each factor card and the result card carries a
  ⧉ button that inserts the card's source at the textarea cursor, on
  its own line, preserving any `#label` line. Result cards synthesize
  a factor line from the rounded value + residual units, using a
  parseable scientific form (`3*10^8 m/s`) so the inserted text
  round-trips through `parseBlock`.
- Repo cleanup: deleted `src/_legacy/` and the Obsidian release
  artifacts (`manifest.json`, `version-bump.mjs`, `versions.json`);
  dropped their entries from `tsconfig.json` and `eslint.config.mts`
- Stored conversion factors: `src/library.ts` stores a versioned
  `{ label, source }` list in localStorage; `src/palette.ts` renders
  a toggleable right-hand side panel with an Add form, Import/Export
  buttons, and click-to-insert entries. Factor cards gained a ☆/★
  star button that toggles library membership (prompting for a label
  on unlabeled cards). Export downloads the current library as a JSON
  file so teachers can share curated sets; Import merges an uploaded
  file, skipping duplicates by (label, source). Harness covers the
  store's add/remove/hasEntry/round-trip/import-merge behavior.
- Teacher-shareable URLs with embedded state ("document mode"):
  `?lib=` now carries the library JSON alongside `#source`. Share link
  captures both. Boot picks one of two modes based on whether the URL
  has any state (`?lib=…` or `#source`):
  - **Document mode** (URL has state) — URL is canonical; edits update
    the URL in place but NEVER write to localStorage. Students who
    open a teacher link see exactly that state, and their work on an
    assignment stays isolated from their personal library.
  - **Personal mode** (plain URL) — today's behavior; edits update
    both URL and localStorage so returning visitors resume where they
    left off.
  Mode is fixed at boot and doesn't flip mid-session. This cleanly
  solves the accumulation problem (teacher factors never leak into
  student localStorage) and lets teachers verify student work by
  opening the student's shared link. Harness covers
  `encodeLibraryForUrl` compactness and `encode → decode` round-trip
  plus malformed-input fallbacks.

### In progress / next
- Next feature: TBD. Candidates are Clear-all + Reset-to-example
  buttons, unit-compatible card addition, or preloaded starter
  libraries per discipline. Revisit once the teacher-workflow loop
  has some classroom use.

### Later
- **Clear-all button.** Wipe the textarea, the URL hash, and the
  localStorage entry in one click. Needs a confirm prompt since it's
  destructive.
- **Reset-to-example button.** Re-populate the textarea with
  `DEFAULT_BLOCK` (and clear hash + localStorage) so a student can get
  back to the built-in walkthrough without hunting for it. Probably
  lives next to Clear-all in the header.
- Card addition and subtraction with unit-compatibility errors
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

### Stored conversion factors — status
Implemented via a side palette. `src/library.ts` is a pure store
(localStorage-backed) of `{ label, source }` entries keyed by a
`version: 1` envelope so future schema changes can migrate forward.
`src/palette.ts` renders the panel statelessly — header with
Import/Export buttons, an Add-new form, and a scrollable list of
rows. The panel lives as a third grid column in the workspace and is
shown/hidden by a "Show library / Hide library" button in the header;
its open/closed state persists in localStorage. Factor cards render
a ☆/★ button that toggles library membership; unlabeled cards prompt
for a label before saving. Clicking a palette row inserts the
`#label \n source` snippet at the textarea cursor (same pipeline as
the card copy button). Export downloads the current library as a
pretty-printed JSON file; Import reads a file via a hidden file input
and merges by (label, source) exact match, skipping duplicates so
re-imports are idempotent.

Follow-ups deferred:
- Preloaded starter sets per discipline (chemistry, mechanics, etc.).
  We start empty so teachers can build and export their own.
- In-page label editing (today you'd delete and re-add).
- A `/search` or autocomplete affordance inside the textarea for
  discoverability when the library grows large.
- Cross-device sync / shared class libraries.

### Document mode vs personal mode — status
Persistence has two modes, decided once at boot from whether the URL
has any state in it:

- **Document mode** — URL has `#source` and/or `?lib=…`. The URL is
  the single source of truth. Every edit (typing, flip, star, palette
  add/delete/import) updates the URL in place via
  `history.replaceState`; localStorage is never touched in this mode.
  This makes teacher links deterministic: any student opening the
  link sees exactly the teacher's captured state regardless of their
  own Unitor history, and none of their assignment work leaks into
  their personal library. If the student wants to save their
  progress, they bookmark the URL or click "Copy share link".
- **Personal mode** — URL has no state (fresh visit, plain
  bookmark). Source and library come from localStorage; edits update
  localStorage plus the URL (so "Copy share link" always reflects
  current state). This is the single-user workspace pattern for
  students/teachers working on their own between assignments.

The mode is captured at boot (`documentMode` in `app.ts`) and is
fixed for the session. The URL always updates regardless of mode;
only the localStorage write is gated. `encodeLibraryForUrl` emits
compact (unindented) JSON to keep URLs short enough for LMS / email
transport; `exportLibrary` stays pretty-printed for file downloads.
Malformed `?lib=` values fall back to an empty library rather than
crashing the page. The hashchange listener re-syncs source on
external address-bar edits but deliberately does not re-read
`?lib=`, because browsers don't fire a standard event on query-only
changes and re-reading there would surprise users by wiping
in-session library edits.

Three URL signals trigger document mode: a non-empty `#source`, a
`?lib=…` query, and a bare `?doc` sentinel. The sentinel exists for
the "fully empty calculator" case — a teacher who clears both source
and library and clicks Copy share link. Without it the resulting URL
would carry neither a meaningful hash nor a `?lib=` and would drop
back to personal mode on reload, pulling in the student's
localStorage instead of reproducing the empty state. `updateUrl`
emits `?doc` only when document mode is active AND both source and
library are empty, so personal-mode sessions never grow a sentinel
in their URL.

A small dev handle is exposed on `window.unitor` for console
inspection: `documentMode`, `library`, and `source` are live
getters, and `urlHasState()` is callable. Harmless and useful for
triaging student reports about surprising state.

Follow-ups deferred:
- A "save this to my library" action for moving teacher-provided
  factors from an assignment's session library into localStorage.
  Today the only path is JSON export → open plain Unitor → JSON
  import. Add this if students actually ask for it.
- Visual indication of document mode (e.g., a subtle header badge).
  Skipped for v1; add only if users report confusion about why their
  edits aren't "sticking" between sessions on an assignment URL.
- URL length mitigation (compression / short-link service) if
  real-world libraries get too big for some LMS URL limits. Current
  compact JSON encoding is probably enough for classroom-sized
  libraries.

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

### Card copying — status
Implemented: each factor card and the result card carries a ⧉ button
at the bottom-left corner (the flip button ⇅ sits at the bottom-right).
Clicking inserts the card's source at the textarea cursor, on its own
line — the handler in `app.ts` auto-adds leading/trailing newlines
when the cursor is mid-line so the snippet never glues onto an
adjacent line, then runs the same persist + re-render pipeline as
typing.

Snippet shape:
- Factor card: the original source line, preceded by a `#label` line
  if one was present above it.
- Result card: a synthesized factor line `value units`, preceded by
  the block's `resultLabel` if set. The value is rounded to 3 sig
  figs and rendered as a plain decimal in the comfortable range, as
  `mantissa*10^exp` (not the Unicode `× 10ⁿ` display form) outside
  it, and negatives-only unit expressions fall back to signed
  exponents (`60 s^-1`) because a bare leading `/` is not a valid
  unit expression.

Serializers live in `src/format.ts` (`serializeResultValue`,
`serializeUnits`, `serializeResultAsFactorLine`). Harness covers
rounding, the three magnitude ranges, each unit-exponent shape, and
end-to-end round-trip through `parseBlock` for three representative
result shapes.

### Card flipping — status
Implemented: each factor card carries a ⇅ button that calls `flipLine`
on the corresponding source line, writes the new value into the
textarea, and runs the same persist + re-render pipeline as typing. A
flip on a card already in a cancellation pair recomputes cancellation
against its new neighbors correctly (cancellation is purely a function
of the post-flip source). The flip preserves expression-card syntax —
backtick expressions move between numerator and denominator positions
intact.
