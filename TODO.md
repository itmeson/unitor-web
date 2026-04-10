# Dimensional plugin — roadmap and deferred issues

## Roadmap

### Done
- Code block processor registered for `dimensional` language tag
- Line parser for quantities and factors
- Pairwise unit cancellation
- Card-based rendering with fraction bars and result card
- Scientific notation input (`3*10^8`) and display (`3 × 10⁸`)
- Result rounding to 3 sig figs with auto scientific notation for
  large/small magnitudes
- Bare dimensionless numerators (`1 / 5 km`)
- Compound unit expressions (`kg*m/s^2`, `m^2`)
- Partial cancellation rendering
- Color-coded cancellation pairs
- Expression cards with backtick-delimited arithmetic
  (`` `4*pi*6.4^2` m^2 ``)
- Side-panel live preview view (command: "Open Unitor preview panel")
- Card flipping via flip button (⇅) in preview panel
- Expression cards: pretty-printed formula on factor cards
  (`4·π·6.4²`), numeric result only on the result card
- Card annotations/labels (`# label` line before a factor)
- Result card label (trailing `# label` at end of block)

### In progress / next
- (none currently — testing and feedback)

### Later
- Inline live rendering (CodeMirror 6 editor extension, like math
  blocks) — also consider how this interacts with card flipping and
  other interactive features
- Card addition and subtraction with unit compatibility checking
- Stored conversion cards / unit definition library for reuse
- Preview panel tuning: revisit debounce rate (none today) and the
  rule for which block(s) to display (currently: cursor-in-block →
  that one, else all)
- Literal `×` and Unicode superscripts in source
- Parentheses in unit expressions
- Fractional unit exponents
- Standard conversion shortcuts (editor command inserting a factor)
- Minimum sig figs derived from inputs
- Configurable max sig figs
- Strict-teaching sig-figs mode
- Named constants (π, c, g, …)

---

## Details

## Expression cards — follow-ups
Backtick-delimited expressions work: `` `4*pi*6.4^2` m^2 `` evaluates
at parse time and plugs into the Quantity pipeline. Follow-ups:
- Optionally show the formula text alongside the computed value on
  the card, rather than just the number. Would need UI for a toggle
  or a separate card layout.
- Add more named constants (c, g, h, k_B, …). Today only `pi`, `π`,
  and `e` are supported.

## Number notation in parser — remaining niceties
Scientific notation `3*10^8` is parsed and rendered as `3 × 10⁸`.
Still open:
- Accept a literal `×` as a multiplier (so `3 × 10^8` also works).
- Accept Unicode superscript digits directly in source.

## Compound units — remaining follow-ups
Compound unit expressions (`kg*m/s^2`, `m^2`, etc.) work. Not yet
addressed:
- Parentheses in unit expressions (currently strictly left-to-right).
- Fractional exponents (only integers today).

## Standard conversion shortcuts
Build a small library of common conversion factors with shortcuts.

Two flavors to consider:
- **Bare-name expansion in source**, e.g. writing `mi_to_km` on a line
  expands to `1.609 km / 1 mi` at parse time. Terse, but adds parser
  complexity and requires memorizing names.
- **Editor command / slash-menu** that inserts the conversion text at
  the cursor inside the code block. Pure UX layer, zero parser risk,
  more discoverable. Use Obsidian's `addCommand` with an
  `editorCallback`.

Lean toward the editor-command approach first; it's a place to build
up a personal library of frequently-used factors without committing to
any new syntax.

## Significant figures — follow-ups
Results are rounded to at most 3 sig figs for display, and large /
small magnitudes switch to scientific notation. That solved the
"too many digits" problem. Still open:

- **Minimum sig figs based on inputs.** Track the sig figs of each
  input quantity and ensure the displayed result has at least as
  many sig figs as the most precise input requires (while still
  capping at the max). I.e. the current cap is a ceiling; add a
  floor derived from the inputs.
- Make the max sig-figs count configurable (plugin setting or
  per-block annotation) rather than hard-coded at 3.
- Consider a stricter teaching mode that displays exactly the min
  sig figs of the inputs (the textbook rule for mult/div).

## Expression cards — display formula on left side
Currently expression cards (`` `4*pi*6.4^2` m^2 ``) evaluate
immediately and show the computed number on the factor card. The
desired behavior: the left-side (factor) card should display a
pretty-printed version of the original expression (e.g. `4·π·6.4²`
with Unicode operators and superscripts), preserving the student's
reasoning. Only the final result card on the right resolves to the
numeric value. The computed value is still used internally for the
arithmetic — this is purely a display change on the factor cards.

Pretty-printing means at minimum: `*` → `·`, `pi`/`π` → `π`,
`^n` → Unicode superscript, parentheses preserved. More ambitious:
render as a small fraction or sub/superscript layout. Start with
simple Unicode substitution.

## Card annotations / labels
Any card (especially factor cards) can carry a short label or header
describing what it represents — "speed of light", "surface area",
"conversion factor", etc. The whole point of the plugin is making
reasoning visible, and labels are part of that reasoning.

Syntax options to consider:
- A `# label` line immediately before the factor line, rendered as
  a small header above the card.
- An inline annotation after the factor, e.g. `3e8 m/s  [speed of
  light]` with brackets parsed and rendered as a caption.
- A YAML-style prefix: `label: speed of light` on its own line.

The label should appear on the rendered card in a muted, smaller
font — above or below the quantity — without affecting parsing.

## Inline live rendering (CodeMirror 6)
Render dimensional blocks directly in the editor, the way `$$` math
blocks render inline in Live Preview. Implementation would be a
`ViewPlugin` with `Decoration.widget` placed below the closing fence.
When the cursor enters the block the widget hides and the student
sees raw source; when the cursor leaves, the widget appears showing
the rendered cards.

This becomes more important as interactive features like card
flipping are added: inline rendering means a student can click a
card directly in the document to flip it, and the source edits
happen right there. With the side-panel approach, flipping still
works but the interaction is split across two locations.

Consider keeping the side panel as an alternative view even after
inline rendering is added — it serves a different workflow (overview
of all blocks at once).

## Card addition and subtraction
Extend the block syntax to support additive operations between
factor chains. Today every line is a multiplicative factor. With
addition/subtraction, some lines would combine additively.

Possible syntax: a `+` or `-` prefix on a line signals that this
line's resolved value should be added/subtracted rather than
multiplied.

```
60 mi / hr
+ 10 mi / hr
```
Result: 70 mi/hr.

**Unit compatibility:** If units don't match after cancellation,
show an error ("cannot add mi/hr to km — incompatible units").
This is the pedagogically valuable part — students see *why* you
can't just add quantities with different dimensions.

Design questions:
- Can multiplicative chains and additive operations mix in one
  block? E.g. a multi-line product, then `+` another multi-line
  product? Would need grouping syntax or blank-line separation.
- Should auto-conversion be attempted when units are compatible but
  not identical (mi/hr + km/hr)? Probably not initially — force
  students to do the conversion explicitly.

## Stored conversion cards / unit definitions
Allow frequently-used conversion factors to be saved and reused by
name, so students don't have to remember that 1 J = 1 kg·m²·s⁻².

Possible approaches:
- A definitions block (`` ```dimensional-defs ``) in a note or
  vault-level file that maps names to factor expressions. Referenced
  in a dimensional block by name.
- A plugin settings dictionary.
- An editor command / slash-menu that inserts the factor text at the
  cursor (the existing "standard conversion shortcuts" idea).

This interacts with the card labels feature — a stored conversion
would naturally carry a label. Also interacts with the
editor-command approach already described in the conversion shortcuts
section above.

## Card flipping
Allow the student to invert a factor card in place. If a card shows
`5 km`, flipping it produces `1 / 5 km`. If a card is already a
fraction `1.609 km / 1 mi`, flipping swaps numerator and denominator
to `1 mi / 1.609 km`.

This is pedagogically critical: a student sets up a dimensional
analysis chain, sees that the units don't cancel as intended, and
flips a card to fix it — seeing the cancellations update in real
time.

Implementation considerations:
- Clicking a rendered card (or a flip button/icon on the card) edits
  the underlying source line, swapping numerator and denominator.
- In the side panel, the flip click would need to locate the
  corresponding line in the editor and edit it.
- With inline rendering, the flip click edits the source directly
  beneath the widget, which is a more natural interaction.
- The flip must preserve expression-card syntax (backtick
  expressions stay intact, just move between numerator/denominator
  positions).
