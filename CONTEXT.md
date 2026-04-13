# Unitor — web app project context

This document is a briefing for a new AI session starting work on the
standalone web app version of Unitor. Read it before writing any code
or making architectural proposals.

---

## What this is

Unitor is a pedagogical dimensional analysis tool for physics/science
students. It renders a list of "factor cards" as a horizontal row:
each card shows a quantity (a number and its units, optionally as a
fraction), the units that cancel between adjacent cards are shown
struck through in matching colors, and the result of the whole chain
appears on a final card on the right. The goal is to make the
*reasoning* of dimensional analysis visible and interactive, not just
the arithmetic.

This repo contains a port-in-progress from an Obsidian plugin to a
standalone web app. The Obsidian plugin is complete and working; the
web app is being built fresh here. The plugin source is the reference
implementation — the core logic (parser, compute, formatter,
expression evaluator) ports almost directly.

The author is a high school science teacher (Mark Betnel,
mbetnel@seattleacademy.org). He built the plugin for his own use and
now wants a version students can access without installing anything.

---

## Design constraints

- **Single HTML file preferred.** The ideal deliverable is `index.html`
  with JS and CSS either inlined or in adjacent files that don't
  require a build step to *use*. Students should be able to bookmark
  a URL or open a local file.
- **No framework dependencies.** No React, Vue, etc. Plain JS/CSS.
- **TypeScript + esbuild is fine for development.** The author is
  comfortable with this workflow from the plugin. Whether to keep it
  or drop to plain JS for the web app is an open question — discuss
  before deciding.
- **No server.** Everything runs in the browser. State can live in
  the URL hash (for sharing) or localStorage (for persistence between
  sessions), but there is no backend.

---

## Input syntax

A "block" is the text the user types. Each non-empty, non-comment
line is a **factor** (one card in the chain). The result card is
computed automatically.

### Basic quantity

```
5 km
```
A number followed by an optional unit expression. The unit expression
uses `*` for multiplication and `/` for unit-level division (no
spaces around `/`).

```
9.8 m/s^2
3*10^8 m/s
0.5 kg*m^2/s^2
```

### Factor as a fraction (line-level division)

A ` / ` with spaces on both sides splits a line into numerator and
denominator, producing a fraction card:

```
1.609 km / 1 mi
1 J / 1 kg*m^2*s^-2
```

The space rule distinguishes line-level `/` (fraction card) from
unit-level `/` (compound unit).

### Expression cards

Backtick-delimited arithmetic in the numerator or denominator:

```
`4*pi*6.4^2` m^2
`(3*10^8)^2` m^2/s^2
```

The expression is evaluated at parse time. Constants `pi`, `π`, `e`
are recognised. The pretty-printed expression (`4·π·6.4²`) appears on
the factor card; only the result card shows the computed number.

### Card labels

A `# label` line immediately before a factor attaches a caption above
that card:

```
# surface area of Earth
`4*pi*6.4^2` m^2
```

A trailing `# label` at the end of the block (with no factor after
it) labels the result card:

```
5 km
1 hr / 3600 s
# speed in km/s
```

### Bare dimensionless numerators

`1 / 5 km` is valid — the numerator `1` is a dimensionless quantity.
Useful when a student isn't sure whether a conversion factor goes on
top or bottom.

### Scientific notation

`3*10^8` is parsed as 3 × 10⁸. Displayed as `3 × 10⁸` on cards.

---

## Core data flow

```
source text (string)
  → parseBlock()   → { factors: Factor[], errors: ParseError[], resultLabel? }
  → compute()      → { annotated: AnnotatedFactor[], value, residualUnits }
  → render()       → DOM
```

All pure functions. No mutation of input. Errors are collected and
displayed per-line rather than aborting the whole block.

### Key types (from the plugin)

```typescript
interface UnitTerm       { symbol: string; exponent: number }
interface Quantity       { value: number; units: UnitTerm[]; displayValue?: string }
interface Factor         { numerator: Quantity; denominator?: Quantity;
                           raw: string; sourceLine: number; label?: string }
interface AnnotatedUnitTerm extends UnitTerm
                         { cancelledSlots: number; cancelledPairIds: number[] }
interface AnnotatedFactor { numerator: AnnotatedQuantity; denominator?: AnnotatedQuantity;
                            raw: string; sourceLine: number; label?: string }
interface ComputedResult { annotated: AnnotatedFactor[]; value: number;
                           residualUnits: UnitTerm[] }
```

---

## Source files to port

These four files from `src/` are pure logic with no Obsidian
dependency. They need only minor adjustments (imports, module format):

| File | What it does |
|---|---|
| `src/parser.ts` | `parseBlock`, `parseLine`, `parseUnitExpression`, `flipLine` |
| `src/compute.ts` | `compute` — slot-based cancellation with pair IDs |
| `src/format.ts` | `formatResultValue`, `superscript`, `prettyPrintExpression` |
| `src/expression.ts` | Recursive-descent arithmetic evaluator for backtick expressions |

These are **Obsidian-specific and should not be ported:**
- `src/main.ts` — Obsidian plugin entry, ItemView, registerMarkdownCodeBlockProcessor
- `src/settings.ts` — Obsidian settings tab boilerplate

The rendering logic in `main.ts` (functions `renderTermPiece`,
`renderUnitTerm`, `renderUnitExpressionInline`, `renderQuantityCell`,
`renderResidualTerms`, `renderDimensionalBlock`) should be ported but
rewritten as standalone DOM functions rather than using Obsidian's
`createDiv`/`createSpan` helpers.

---

## What needs to be built new

1. **Input UI** — a `<textarea>` where the user types factor lines,
   live-updating a preview panel. In the Obsidian plugin this was the
   editor with a side panel; here it's two panes on one page.

2. **Render wiring** — call `parseBlock` → `compute` → `renderDimensionalBlock`
   on every input change.

3. **Card flipping** — in the plugin, flip buttons edit the source
   line via the Obsidian editor API. In the web app, the textarea is
   the source of truth, so a flip writes back to `textarea.value`
   directly and re-renders.

4. **URL sharing** — encode the textarea content in the URL hash
   (`location.hash`) so students can share or bookmark a specific
   computation.

5. **Multiple blocks** — the plugin handled one block at a time
   (delimited by fences). In the web app, the input might be one
   textarea per block, or multiple blocks separated by blank lines,
   or tabs — worth discussing before implementing.

---

## Cancellation model (important — non-obvious)

Each unit term has `|exponent|` "slots". The compute step walks all
factors in order and pairs off slots between positive (numerator)
and negative (denominator) positions for the same unit symbol. Each
pairing event gets a unique incrementing `pairId`. The renderer uses
`pairId % 8` to assign a color class from a palette of 8 colors, so
matching cancellations share a color. Partially-cancelled terms (e.g.
`m²` where only one of two slots cancels) split into a struck-through
piece and a live piece.

---

## Rendering details

- Cards are `display: flex; flex-direction: column` with a horizontal
  `1px` bar separating numerator from denominator cells.
- The `×` and `=` operators are siblings of the card-wraps in a
  `display: flex; align-items: flex-end` row.
- Cancelled unit spans get `text-decoration: line-through` plus a
  color class (`dimensional-cancelled-0` through `dimensional-cancelled-7`).
- Result card has a distinct background.
- Labels appear above their card in a small muted font.
- Flip buttons (⇅) appear on hover, positioned absolute at the
  bottom-right of each factor card-wrap.

The palette colors (chosen to work on both light and dark backgrounds):
`#c0504d` `#4a7cbf` `#5aa45a` `#c98a3a` `#8a5cbf` `#3aa6a0`
`#bf5a9a` `#6d6d6d`

---

## Feature backlog (carry forward from plugin)

**High priority for web app:**
- Card flipping (click to invert a factor)
- URL sharing / permalink
- Multiple blocks in one session

**Medium priority:**
- Card addition and subtraction with unit compatibility error
- Stored/named conversion cards for reuse
- Minimum sig figs derived from inputs
- Configurable max sig figs (currently hard-coded at 3)

**Lower priority / later:**
- Named physical constants (c, g, h, k_B, …); today only `pi`, `π`, `e`
- Literal `×` accepted in input for scientific notation
- Parentheses in unit expressions
- Fractional unit exponents
- Strict sig-figs teaching mode (display exactly min sig figs of inputs)
- Export (copy as text, save as PDF, paste into Google Docs)

---

## Open architectural questions to discuss before coding

1. **TypeScript + esbuild vs. plain JS?** The plugin uses TS with
   `noUncheckedIndexedAccess` and strict mode. Keeping this gives
   type safety and the familiar workflow; dropping to plain JS removes
   the build step entirely. The author is comfortable either way.

2. **One textarea or multiple?** The plugin had one block per fenced
   code block. The web app could have a single textarea for one
   computation, or a more document-like interface with multiple
   named blocks. The former is simpler to start; the latter is closer
   to the original vision of documenting a whole worked problem.

3. **Persistence model?** URL hash (shareable, ephemeral), localStorage
   (persistent, local only), or both?