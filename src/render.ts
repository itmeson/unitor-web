/**
 * DOM renderer for a dimensional-analysis block.
 *
 * Ported from the Obsidian plugin's `main.ts`. The rendering contract
 * is identical:
 *
 *   - one horizontal row of factor cards joined by `×`
 *   - a final `=` operator and a result card on the right
 *   - cancelled unit slots are struck through and colored by pair-id
 *   - labels appear above their card in muted type
 *   - optional flip button (⇅) appears on hover when `onFlip` is given
 *
 * The only differences vs. the plugin are mechanical: Obsidian's
 * `createDiv`/`createSpan`/`createEl` helpers are replaced with a small
 * `el()` wrapper around `document.createElement`, and the CSS relies on
 * self-contained custom properties defined in `styles.css` rather than
 * the Obsidian theme's `var(--*)` variables.
 */

import { parseBlock, parseDocument, ParseResult, UnitTerm } from './parser';
import { compute, AnnotatedUnitTerm, AnnotatedQuantity } from './compute';
import {
	formatResultValue,
	serializeResultAsFactorLine,
	superscript,
} from './format';

/** Size of the cancellation color palette defined in `styles.css`. */
const CANCEL_PALETTE_SIZE = 8;

/** Callback to flip a factor card; receives the 0-based line within the block. */
export type OnFlipCallback = (sourceLine: number) => void;

/**
 * Callback to copy a card's source into the document. Receives the
 * ready-to-insert source snippet (one or two lines: an optional `#
 * label` line followed by a factor line). The app layer handles where
 * to splice it.
 */
export type OnCopyCallback = (snippet: string) => void;

/**
 * Callback to save (or unsave) a factor card to the library. Receives
 * the card's raw source line and its current label if any. The app
 * layer decides whether this is an add or a remove by consulting the
 * library state; the renderer only signals the click. When the card
 * has no label, the app is expected to prompt the user.
 */
export type OnSaveCallback = (rawLine: string, label: string | undefined) => void;

/**
 * Predicate: is this (rawLine, label) pair already in the library? The
 * renderer calls this once per factor card to decide between the empty
 * (☆) and filled (★) star glyph. Unlabeled cards are never considered
 * "saved" because the library keys on label.
 */
export type IsSavedPredicate = (
	rawLine: string,
	label: string | undefined
) => boolean;

/**
 * Bundle of optional interaction hooks the caller can wire into the
 * renderer. Grouped into a single options object so adding more
 * affordances later doesn't balloon the positional-argument list.
 */
export interface RenderCallbacks {
	onFlip?: OnFlipCallback;
	onCopy?: OnCopyCallback;
	onSave?: OnSaveCallback;
	isSaved?: IsSavedPredicate;
	/** Significant figures for result-card values. Defaults to 3. */
	sigFigs?: number;
}

/** Build the snippet inserted when a factor card's copy button is clicked. */
function factorSnippet(rawLine: string, label: string | undefined): string {
	const factorLine = rawLine.trim();
	if (label) return `#${label}\n${factorLine}`;
	return factorLine;
}

/** Build the snippet inserted when a result card's copy button is clicked. */
function resultSnippet(
	value: number,
	residualUnits: UnitTerm[],
	resultLabel: string | undefined,
	sigFigs: number = 3
): string {
	const factorLine = serializeResultAsFactorLine(value, residualUnits, sigFigs);
	if (resultLabel) return `#${resultLabel}\n${factorLine}`;
	return factorLine;
}

/**
 * Attach a small "copy this card" button to a card wrapper. Styled
 * identically to the flip button but positioned on the left.
 */
function attachCopyButton(
	cardWrap: HTMLElement,
	snippet: string,
	onCopy: OnCopyCallback
): void {
	const btn = document.createElement('button');
	btn.className = 'dimensional-copy-btn';
	btn.textContent = '⧉';
	btn.setAttribute('aria-label', 'Copy this card into the document');
	btn.setAttribute('title', 'Copy to cursor');
	btn.setAttribute('type', 'button');
	// Don't steal focus from the textarea so the cursor stays where the
	// user last placed it — that's where the copy lands.
	btn.addEventListener('mousedown', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		onCopy(snippet);
	});
	cardWrap.appendChild(btn);
}

/**
 * Attach a small "save to library" star button to a factor card. The
 * glyph is filled (★) when the predicate says this (rawLine, label) is
 * already in the library, empty (☆) otherwise. Click toggles via
 * `onSave`; the app decides whether that means add or remove based on
 * its own library state.
 */
function attachSaveButton(
	cardWrap: HTMLElement,
	rawLine: string,
	label: string | undefined,
	saved: boolean,
	onSave: OnSaveCallback
): void {
	const btn = document.createElement('button');
	btn.className = saved
		? 'dimensional-save-btn is-saved'
		: 'dimensional-save-btn';
	btn.textContent = saved ? '★' : '☆';
	btn.setAttribute(
		'aria-label',
		saved ? 'Remove from library' : 'Save to library'
	);
	btn.setAttribute('title', saved ? 'Saved — click to remove' : 'Save to library');
	btn.setAttribute('type', 'button');
	btn.addEventListener('mousedown', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		onSave(rawLine, label);
	});
	cardWrap.appendChild(btn);
}

interface ElOpts {
	className?: string;
	text?: string;
	attrs?: Record<string, string>;
}

/** document.createElement with common conveniences. Returns the new element. */
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	opts?: ElOpts
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (opts?.className) node.className = opts.className;
	if (opts?.text !== undefined) node.textContent = opts.text;
	if (opts?.attrs) {
		for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
	}
	return node;
}

/** Append a new element to `parent` and return it. */
function child<K extends keyof HTMLElementTagNameMap>(
	parent: Element,
	tag: K,
	opts?: ElOpts
): HTMLElementTagNameMap[K] {
	const node = el(tag, opts);
	parent.appendChild(node);
	return node;
}

/**
 * Render a compact piece of a unit term — symbol, optional exponent,
 * with optional strikethrough + color class for cancelled pieces.
 */
function renderTermPiece(
	parent: Element,
	symbol: string,
	exponent: number,
	cancelledPairId: number | null
): void {
	const text = exponent === 1 ? symbol : symbol + superscript(exponent);
	let className = 'dimensional-unit';
	if (cancelledPairId !== null) {
		const paletteIdx = cancelledPairId % CANCEL_PALETTE_SIZE;
		className += ` dimensional-cancelled dimensional-cancelled-${paletteIdx}`;
	}
	child(parent, 'span', { className, text });
}

/**
 * Render a single unit term, handling full, none, or partial
 * cancellation. A term with all slots uncancelled renders compactly
 * (`s²`). With any cancellation, the term is expanded into one piece
 * per cancellation "run" (consecutive cancelled slots sharing a pair
 * ID collapse to a single piece like `s̶²`), followed by one live
 * piece for the residual exponent.
 */
function renderUnitTerm(parent: Element, term: AnnotatedUnitTerm): void {
	const absExp = Math.abs(term.exponent);
	if (absExp === 0) return;

	if (term.cancelledSlots === 0) {
		renderTermPiece(parent, term.symbol, absExp, null);
		return;
	}

	let first = true;
	const writeSeparator = () => {
		if (!first) child(parent, 'span', { text: '·' });
		first = false;
	};

	// Chunk cancelled slots into runs of equal pair ID.
	let i = 0;
	while (i < term.cancelledSlots) {
		const pairId = term.cancelledPairIds[i] ?? 0;
		let j = i + 1;
		while (
			j < term.cancelledSlots &&
			(term.cancelledPairIds[j] ?? 0) === pairId
		) {
			j++;
		}
		const runLen = j - i;
		writeSeparator();
		renderTermPiece(parent, term.symbol, runLen, pairId);
		i = j;
	}

	const live = absExp - term.cancelledSlots;
	if (live > 0) {
		writeSeparator();
		renderTermPiece(parent, term.symbol, live, null);
	}
}

/**
 * Render an annotated unit expression inline as "a·b/c·d", with
 * positive-exponent terms on the left of the `/` and negative ones
 * on the right (displayed with positive exponents). Each term is its
 * own span so strikethroughs work per-term.
 */
function renderUnitExpressionInline(
	parent: Element,
	units: AnnotatedUnitTerm[]
): void {
	const positives = units.filter((u) => u.exponent > 0);
	const negatives = units.filter((u) => u.exponent < 0);

	if (positives.length === 0 && negatives.length === 0) return;

	if (positives.length > 0) {
		positives.forEach((t, i) => {
			if (i > 0) child(parent, 'span', { text: '·' });
			renderUnitTerm(parent, t);
		});
	} else {
		child(parent, 'span', { text: '1' });
	}

	if (negatives.length > 0) {
		child(parent, 'span', { text: '/' });
		negatives.forEach((t, i) => {
			if (i > 0) child(parent, 'span', { text: '·' });
			renderUnitTerm(parent, t);
		});
	}
}

/** Render a quantity into a factor-card cell: value, space, unit expression. */
function renderQuantityCell(
	parent: Element,
	q: AnnotatedQuantity,
	cellCls: string
): void {
	const cell = child(parent, 'div', { className: `dimensional-cell ${cellCls}` });
	child(cell, 'span', {
		className: 'dimensional-value',
		text: q.displayValue ?? String(q.value),
	});
	if (q.units.length > 0) {
		child(cell, 'span', { text: ' ' });
		renderUnitExpressionInline(cell, q.units);
	}
}

/**
 * Render a plain (non-annotated) unit term list — used for the residual
 * units in the result card. No cancellation markup.
 */
function renderResidualTerms(parent: Element, terms: UnitTerm[]): void {
	terms.forEach((t, i) => {
		if (i > 0) child(parent, 'span', { text: '·' });
		const abs = Math.abs(t.exponent);
		const text = abs === 1 ? t.symbol : t.symbol + superscript(abs);
		child(parent, 'span', { className: 'dimensional-unit', text });
	});
}

/**
 * Append a single parsed block's DOM into `host` without clearing it.
 * Used by both `renderDimensionalBlock` (which clears first) and
 * `renderDocument` (which may append multiple blocks separated by
 * horizontal rules).
 */
function appendParsedBlock(
	parsed: ParseResult,
	host: HTMLElement,
	callbacks: RenderCallbacks
): void {
	const { factors, errors, resultLabel } = parsed;
	const { onFlip, onCopy, onSave, isSaved, sigFigs = 3 } = callbacks;
	const container = child(host, 'div', { className: 'dimensional-block' });

	if (factors.length > 0) {
		const { annotated, value, residualUnits } = compute(factors);

		const row = child(container, 'div', { className: 'dimensional-row' });

		annotated.forEach((f, i) => {
			if (i > 0) {
				child(row, 'div', { className: 'dimensional-op', text: '×' });
			}
			const cardWrap = child(row, 'div', {
				className: 'dimensional-card-wrap',
				attrs: { 'data-source-line': String(f.sourceLine) },
			});
			if (f.label) {
				child(cardWrap, 'div', { className: 'dimensional-label', text: f.label });
			}
			const card = child(cardWrap, 'div', { className: 'dimensional-card' });
			renderQuantityCell(card, f.numerator, 'dimensional-num');
			if (f.denominator) {
				child(card, 'div', { className: 'dimensional-bar' });
				renderQuantityCell(card, f.denominator, 'dimensional-den');
			}
			if (onFlip) {
				const btn = child(cardWrap, 'button', {
					className: 'dimensional-flip-btn',
					text: '⇅',
					attrs: { 'aria-label': 'Flip this factor', title: 'Flip', type: 'button' },
				});
				const line = f.sourceLine;
				// Prevent mousedown from stealing focus from the textarea.
				btn.addEventListener('mousedown', (e) => {
					e.preventDefault();
					e.stopPropagation();
				});
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					onFlip(line);
				});
			}
			if (onCopy) {
				attachCopyButton(cardWrap, factorSnippet(f.raw, f.label), onCopy);
			}
			if (onSave) {
				const saved = Boolean(
					isSaved && isSaved(f.raw, f.label)
				);
				attachSaveButton(cardWrap, f.raw, f.label, saved, onSave);
			}
		});

		child(row, 'div', { className: 'dimensional-op', text: '=' });

		const resultWrap = child(row, 'div', { className: 'dimensional-card-wrap' });
		if (resultLabel) {
			child(resultWrap, 'div', { className: 'dimensional-label', text: resultLabel });
		}
		const resultCard = child(resultWrap, 'div', {
			className: 'dimensional-card dimensional-result',
		});
		const posRes = residualUnits.filter((u) => u.exponent > 0);
		const negRes = residualUnits.filter((u) => u.exponent < 0);

		const resultTop = child(resultCard, 'div', { className: 'dimensional-cell' });
		child(resultTop, 'span', {
			className: 'dimensional-value',
			text: formatResultValue(value, sigFigs),
		});
		if (posRes.length > 0) {
			child(resultTop, 'span', { text: ' ' });
			renderResidualTerms(resultTop, posRes);
		}

		if (negRes.length > 0) {
			child(resultCard, 'div', { className: 'dimensional-bar' });
			const resultBot = child(resultCard, 'div', { className: 'dimensional-cell' });
			renderResidualTerms(resultBot, negRes);
		}

		if (onCopy) {
			attachCopyButton(
				resultWrap,
				resultSnippet(value, residualUnits, resultLabel, sigFigs),
				onCopy
			);
		}
	}

	for (const err of errors) {
		child(container, 'div', {
			className: 'dimensional-error',
			text: `line ${err.line}: ${err.message}`,
		});
	}
}

/**
 * Render a single dimensional block's source into the given host
 * element, replacing its previous contents.
 *
 * The callbacks object wires in per-card affordances. Each one is
 * independently optional so callers can enable only the set they
 * support:
 *   - `onFlip` — adds a ⇅ button that invokes the callback with the
 *     factor's absolute source-line index.
 *   - `onCopy` — adds a ⧉ button on both factor and result cards that
 *     invokes the callback with a ready-to-insert source snippet.
 *   - `onSave` — adds a ☆/★ button on factor cards that invokes the
 *     callback with the raw source line and the card's label. Used
 *     with `isSaved` to pick the correct glyph.
 */
export function renderDimensionalBlock(
	source: string,
	host: HTMLElement,
	callbacks: RenderCallbacks = {}
): void {
	host.textContent = '';
	appendParsedBlock(parseBlock(source), host, callbacks);
}

/**
 * Render a multi-block document (one full textarea's worth of source)
 * into the given host, replacing its previous contents.
 *
 * Blocks are separated in the source by either a line of three-or-more
 * dashes (`---`) or two-or-more consecutive blank lines — see
 * `parseDocument`. Each block is rendered into the host and neighbouring
 * blocks are separated by an `<hr class="dimensional-block-separator">`
 * so the preview's structure mirrors the source's structure.
 *
 * Flip callbacks use source-line indices that are absolute within the
 * full document, so `src/app.ts`'s flip handler can splice the correct
 * textarea line regardless of which block the factor belongs to. Copy
 * callbacks just receive the pre-built source snippet to insert. See
 * `RenderCallbacks` for the full set of optional affordances.
 */
export function renderDocument(
	source: string,
	host: HTMLElement,
	callbacks: RenderCallbacks = {}
): void {
	host.textContent = '';
	const blocks = parseDocument(source);
	blocks.forEach((block, i) => {
		if (i > 0) {
			child(host, 'hr', { className: 'dimensional-block-separator' });
		}
		appendParsedBlock(block, host, callbacks);
	});
}
