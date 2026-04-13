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

import { parseBlock, UnitTerm } from './parser';
import { compute, AnnotatedUnitTerm, AnnotatedQuantity } from './compute';
import { formatResultValue, superscript } from './format';

/** Size of the cancellation color palette defined in `styles.css`. */
const CANCEL_PALETTE_SIZE = 8;

/** Callback to flip a factor card; receives the 0-based line within the block. */
export type OnFlipCallback = (sourceLine: number) => void;

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
 * Render a single dimensional block's source into the given host
 * element, replacing its previous contents.
 *
 * When `onFlip` is provided, each factor card gets a small flip button
 * (⇅) that invokes the callback with the factor's 0-based source line.
 */
export function renderDimensionalBlock(
	source: string,
	host: HTMLElement,
	onFlip?: OnFlipCallback
): void {
	host.textContent = '';
	const container = child(host, 'div', { className: 'dimensional-block' });
	const { factors, errors, resultLabel } = parseBlock(source);

	if (factors.length > 0) {
		const { annotated, value, residualUnits } = compute(factors);

		const row = child(container, 'div', { className: 'dimensional-row' });

		annotated.forEach((f, i) => {
			if (i > 0) {
				child(row, 'div', { className: 'dimensional-op', text: '×' });
			}
			const cardWrap = child(row, 'div', { className: 'dimensional-card-wrap' });
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
			text: formatResultValue(value),
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
	}

	for (const err of errors) {
		child(container, 'div', {
			className: 'dimensional-error',
			text: `line ${err.line}: ${err.message}`,
		});
	}
}
