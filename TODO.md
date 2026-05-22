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
- Teacher-shareable URLs with embedded state: `?lib=` carries the
  library JSON alongside `#source`, so a single URL captures both the
  source and the factor palette. The share-link button always copies
  the current URL so "send this to a student" and "bookmark this for
  later" are the same action. Harness covers `encodeLibraryForUrl`
  compactness and `encode → decode` round-trip plus malformed-input
  fallbacks.
- URL-as-sole-state persistence: localStorage no longer holds
  document content. Every edit updates the URL in place via
  `history.replaceState`; an empty calculator is marked with a
  `?doc` sentinel so a shared blank state round-trips. This
  eliminates the accumulation pattern (the student's prior state
  can't leak into a teacher-shared link) and makes the tool behave
  the same in normal, private, and incognito tabs.
- Compressed URL encoding (`src/compress.ts`): source and library
  are concatenated with a NUL separator, deflated via pako (raw
  deflate, no headers), and base64url-encoded into a single `?d=`
  query parameter. Typically 3–4× shorter than the legacy
  `?lib=` + `#source` percent-encoded format, bringing a 20-line
  source + 20-factor library well under the ~2 KB LMS/email URL
  limit. Legacy URLs (`?lib=`/`#source`) are still decoded on boot
  so previously-shared links work forever. Harness covers
  encode/decode round-trips, empty-state handling, garbage-input
  rejection, and a size-improvement assertion.
- Recents list for crash recovery: localStorage keeps a small
  (`MAX_RECENTS = 20`) list of URLs the user has edited under
  `unitor:recents`. Writes are throttled to once every two minutes
  during active editing plus a `beforeunload` flush, so closing a
  tab without bookmarking still leaves a recoverable snapshot. The
  header's "Recent" button opens a dropdown that labels each entry
  by its first `#label` line (falling back to first non-empty source
  line, then a library-size hint, then "(empty calculator)") and its
  save time relative to now. Harness covers dedup, cap, label
  priority, empty-URL refusal, and relative-time thresholds.
- Configurable significant figures: a header-bar spinner (1–10,
  default 3) controls how many sig figs result cards display. The
  value is encoded in the compressed URL state so shared links
  preserve the teacher's choice. Changing the input re-renders all
  result tiles immediately. Backward compatible: URLs without the
  options segment default to 3. Harness covers format, serialize,
  and compress round-trip with non-default values.

### In progress / next
- Next feature: TBD. Candidates are Clear-all + Reset-to-example
  buttons, unit-compatible card addition, or preloaded starter
  libraries per discipline. Revisit once the URL-only model has some
  classroom use.

### Later
- **Source ↔ preview linking.** Tighten the connection between the
  two panes without rebuilding the editing model. Candidates:
  click a card to scroll-to / highlight its source line; hover a
  card to highlight the corresponding source line (and vice-versa).
  Low-effort, high-payoff alternative to a full card-based editing
  refactor.
- **Clear-all button.** Wipe the textarea and library in one click
  (navigating to a bare `?doc` URL). Needs a confirm prompt since
  it's destructive. Recents will still contain the prior state so
  recovery remains one click away.
- **Tutorial / walkthrough links.** The bare URL is now a blank
  calculator — there is no built-in demo. If we want an onboarding
  path, ship it as a distinct URL (or a small set of them) whose
  `#source` seeds a worked example. Could link from a "Help" button
  in the header or from a first-run hint.
- Card addition and subtraction with unit-compatibility errors
- Export: copy as text, save as PDF, paste into Google Docs
- Named physical constants (c, g, h, k_B, …); today only `pi`, `π`, `e`
- Literal `×` accepted as a multiplier in source
- Unicode superscripts accepted in source
- Parentheses in unit expressions
- Fractional unit exponents
- Minimum sig figs derived from inputs (the configurable sig-fig count
  is a ceiling; add a floor)
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

### URL-as-sole-state persistence — status
The URL is the single source of truth for document content. Source
and library are deflate-compressed and base64url-encoded into a
single `?d=` query parameter (`src/compress.ts`). A `?doc` sentinel
marks the intentionally-empty-calculator case so a shared blank link
round-trips instead of reverting to the bare-URL default. Every edit
(typing, flip, star, palette add/delete/import/export) writes the
new state to the URL in place via `history.replaceState`.
localStorage never holds content.

On boot, priority is: `?d=` (new compressed) → `?lib=` + `#source`
(legacy uncompressed, for backward compat) → bare URL (empty
calculator). Legacy URLs work forever; newly generated URLs always
use `?d=`. The `hashchange` listener re-syncs the textarea on
external address-bar edits (relevant for legacy URLs) but does not
re-read `?lib=`.

The compressed format concatenates source and library JSON with a
NUL separator, runs raw deflate via pako, and base64url-encodes the
result. Typical compression ratio is 3–4× vs. the legacy format; a
20-line source + 20-factor library comes in around 800 bytes instead
of 3 KB. `exportLibrary` stays pretty-printed for JSON file
downloads. Malformed `?d=` or `?lib=` values fall back to an empty
state rather than crashing the page.

The trade-off for URL-as-sole-state — close a tab without
bookmarking and your work is gone — is softened by the recents list
described below.

### Recents list — status
Because content lives only in the URL, closing a tab without
bookmarking would otherwise lose work. `src/recents.ts` backs a
small `unitor:recents` localStorage entry with the last
`MAX_RECENTS = 20` URLs the user has edited, versioned the same way
as the library so future schema changes stay additive.

The app records to recents only after the user's first edit in the
session (so a student opening a teacher link and not touching it
doesn't pollute their recents), throttled to once every two minutes
while editing plus one final `beforeunload` flush so closing the
tab right after typing still captures the final state. Dedup is by
exact URL — repeated edits to the same document refresh one row
rather than filling the list with intermediate versions.

The "Recent" header button opens a floating dropdown of these URLs.
Each row labels the entry by the document's first `#label` line,
falling back to the first non-empty source line, then a library-
size hint like "3 factors", then "(empty calculator)". Relative
save times ("3 minutes ago", "yesterday") are fixed-threshold and
locale-formatted beyond a week. Clicking a row navigates the tab,
which triggers a fresh boot with the stored URL's state.

A dev handle is exposed on `window.unitor` for console inspection:
`library`, `source`, `recents`, and `hasEdited` are live getters,
`urlHasState()` is callable, and `MAX_RECENTS` is a constant.
Harmless and useful for triaging reports about surprising state.

Follow-ups deferred:
- URL length mitigation beyond compression (short-link service) if
  real-world libraries exceed even the compressed URL's headroom.
  Current deflate + base64url encoding is probably enough for
  classroom-sized libraries (~40 factors + 30 lines stays under 2 KB).
- Full-document export/import (source + library in one `.json` or
  `.unitor` file) as an escape valve for very large factor sets that
  don't fit in a URL. Teachers would distribute a file instead of a
  link.
- A "pin" affordance for recents entries the student wants to keep
  around even as older work pushes newer items off the list.
- Cross-device sync for recents (e.g., behind a login). Probably
  out of scope for a classroom tool; bookmarks and share-links cover
  the cross-device story.

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
