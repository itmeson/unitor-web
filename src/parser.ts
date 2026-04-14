import { superscript, prettyPrintExpression } from './format';
import { evaluateExpression } from './expression';

export interface UnitTerm {
	symbol: string;
	/** Signed integer exponent. `m` → 1, `s^2` → 2, `s^-2` → -2. */
	exponent: number;
}

export interface Quantity {
	value: number;
	/**
	 * Unit expression as a list of (symbol, exponent) terms. Terms with
	 * repeated symbols are combined during parsing; zero-exponent terms
	 * are dropped. A dimensionless quantity has `units: []`.
	 */
	units: UnitTerm[];
	/**
	 * Optional pretty form of the value, preserved from source. Set when
	 * the user wrote the number as `<mantissa>*10^<exponent>` so the
	 * renderer can show it as `mantissa × 10ⁿ` instead of a plain float.
	 */
	displayValue?: string;
}

export interface Factor {
	numerator: Quantity;
	denominator?: Quantity;
	raw: string;
	/** 0-based line index within the block source. */
	sourceLine: number;
	/** Optional label from a preceding `# label` line. */
	label?: string;
}

export interface ParseError {
	line: number;
	raw: string;
	message: string;
}

export interface ParseResult {
	factors: Factor[];
	errors: ParseError[];
	/** Label from a trailing `# label` line (no factor after it). */
	resultLabel?: string;
}

// A quantity is: <number>[ *10^<exp>][ <unit-expression>]
// The unit expression is a single no-whitespace token; it's further
// parsed by `parseUnitExpression` below.
const QUANTITY_RE =
	/^\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)(?:\s*\*\s*10\s*\^\s*(-?\d+))?(?:\s+(\S+))?\s*$/;

// A single unit term: `symbol` or `symbol^integer` (integer may be signed).
const UNIT_TERM_RE = /^([A-Za-z][A-Za-z_-]*)(?:\^(-?\d+))?$/;

function parseUnitTerm(text: string): UnitTerm | null {
	const m = text.match(UNIT_TERM_RE);
	if (!m || !m[1]) return null;
	const exponent = m[2] !== undefined ? Number(m[2]) : 1;
	if (!Number.isFinite(exponent) || !Number.isInteger(exponent)) return null;
	return { symbol: m[1], exponent };
}

/**
 * Parse a unit expression like `kg*m/s^2` or `m^2`. Operators `*` and
 * `/` are evaluated strictly left-to-right: each operator applies to
 * the single term that follows it. Repeated symbols are combined by
 * summing exponents; zero-net terms are dropped.
 *
 * Returns `null` on a malformed expression. An empty string is a valid
 * dimensionless expression and returns `[]`.
 */
export function parseUnitExpression(text: string): UnitTerm[] | null {
	if (!text) return [];

	// Split while capturing operators so we can tell `*` and `/` apart.
	// "kg*m/s^2" -> ["kg", "*", "m", "/", "s^2"]
	const parts = text.split(/([*/])/);
	if (parts.length === 0 || parts.length % 2 === 0) return null;

	const collected: UnitTerm[] = [];
	let sign = 1;
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			// Operator position.
			const op = parts[i];
			if (op === '*') sign = 1;
			else if (op === '/') sign = -1;
			else return null;
			continue;
		}
		const termText = parts[i] ?? '';
		if (!termText) return null;
		const term = parseUnitTerm(termText);
		if (!term) return null;
		collected.push({ symbol: term.symbol, exponent: term.exponent * sign });
	}

	// Combine repeated symbols; preserve first-seen order.
	const order: string[] = [];
	const map = new Map<string, number>();
	for (const t of collected) {
		if (!map.has(t.symbol)) order.push(t.symbol);
		map.set(t.symbol, (map.get(t.symbol) ?? 0) + t.exponent);
	}
	const out: UnitTerm[] = [];
	for (const sym of order) {
		const exp = map.get(sym) ?? 0;
		if (exp !== 0) out.push({ symbol: sym, exponent: exp });
	}
	return out;
}

function parseQuantity(text: string): Quantity | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Backtick-delimited expression form: `<expr>`[ <unit>]
	if (trimmed.startsWith('`')) {
		const closeIdx = trimmed.indexOf('`', 1);
		if (closeIdx === -1) return null;
		const exprText = trimmed.slice(1, closeIdx);
		const value = evaluateExpression(exprText);
		if (value === null) return null;
		const rest = trimmed.slice(closeIdx + 1).trim();
		const units = parseUnitExpression(rest);
		if (units === null) return null;
		// Show the pretty-printed formula on the factor card.
		return { value, units, displayValue: prettyPrintExpression(exprText) };
	}

	const m = trimmed.match(QUANTITY_RE);
	if (!m) return null;
	const mantissa = Number(m[1]);
	if (!Number.isFinite(mantissa)) return null;

	let value = mantissa;
	let displayValue: string | undefined;
	if (m[2] !== undefined) {
		const exp = Number(m[2]);
		if (!Number.isFinite(exp)) return null;
		value = mantissa * Math.pow(10, exp);
		displayValue = `${m[1]} × 10${superscript(exp)}`;
	}

	const unitText = m[3] ?? '';
	const units = parseUnitExpression(unitText);
	if (units === null) return null;

	return { value, units, displayValue };
}

/**
 * Split a line on its line-level division operator (whitespace-slash-
 * whitespace), ignoring any slashes that appear inside backtick-
 * delimited expression quotes. Returns the trimmed parts.
 */
function splitOnLineLevelDivision(line: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let inBacktick = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '`') {
			inBacktick = !inBacktick;
			continue;
		}
		if (inBacktick || ch !== '/') continue;
		const prev = line[i - 1];
		const next = line[i + 1];
		if (prev && /\s/.test(prev) && next && /\s/.test(next)) {
			parts.push(line.slice(start, i).trim());
			start = i + 1;
		}
	}
	parts.push(line.slice(start).trim());
	return parts;
}

export function parseLine(line: string, sourceLine: number): Factor | string {
	const trimmed = line.trim();
	if (!trimmed) return 'empty line';

	// Line-level division requires whitespace on both sides of the `/`.
	// This distinguishes it from unit-level division like `m/s^2`, and
	// we skip any `/` inside backtick-delimited expressions.
	const parts = splitOnLineLevelDivision(trimmed);
	if (parts.length === 1) {
		const text = parts[0] ?? '';
		const q = parseQuantity(text);
		if (!q) return `could not parse quantity: "${text}"`;
		return { numerator: q, raw: line, sourceLine };
	}
	if (parts.length === 2) {
		const numText = parts[0] ?? '';
		const denText = parts[1] ?? '';
		const num = parseQuantity(numText);
		const den = parseQuantity(denText);
		if (!num) return `could not parse numerator: "${numText}"`;
		if (!den) return `could not parse denominator: "${denText}"`;
		return { numerator: num, denominator: den, raw: line, sourceLine };
	}
	return `expected at most one " / " per line, got ${parts.length - 1}`;
}

/**
 * Flip a factor line: swap numerator and denominator. The
 * transformation preserves the original text, just rearranges it.
 *
 * - `5 km`          → `1 / 5 km`
 * - `1 / 5 km`      → `5 km`        (bare-1 numerator collapses)
 * - `1.609 km / 1 mi` → `1 mi / 1.609 km`
 */
export function flipLine(line: string): string {
	const trimmed = line.trim();
	const parts = splitOnLineLevelDivision(trimmed);

	if (parts.length === 1) {
		// Bare quantity → fraction with 1 in the numerator.
		return `1 / ${trimmed}`;
	}

	if (parts.length === 2) {
		const numText = (parts[0] ?? '').trim();
		const denText = (parts[1] ?? '').trim();

		// If the new denominator (old numerator) is bare "1", collapse
		// to just the new numerator (old denominator) without a fraction.
		if (numText === '1') return denText;

		return `${denText} / ${numText}`;
	}

	// Shouldn't happen on a valid line; return unchanged.
	return trimmed;
}

/**
 * Parse a block of source into factors, errors, and an optional trailing
 * result label.
 *
 * `startLine` is the 0-based index of the first line of `source` within
 * its containing document (the full textarea). It defaults to 0 for a
 * single-block document; `parseDocument` passes the correct offset for
 * each chunk so `Factor.sourceLine` and `ParseError.line` stay
 * absolute — crucial so the app's flip handler can splice the correct
 * textarea line.
 */
export function parseBlock(source: string, startLine = 0): ParseResult {
	const factors: Factor[] = [];
	const errors: ParseError[] = [];
	const lines = source.split('\n');
	let pendingLabel: string | undefined;
	lines.forEach((line, i) => {
		const absLine = startLine + i;
		const trimmed = line.trim();
		if (!trimmed) {
			pendingLabel = undefined;
			return;
		}
		// Lines starting with `#` are labels for the next factor.
		if (trimmed.startsWith('#')) {
			pendingLabel = trimmed.slice(1).trim() || undefined;
			return;
		}
		const result = parseLine(line, absLine);
		if (typeof result === 'string') {
			errors.push({ line: absLine + 1, raw: line, message: result });
			pendingLabel = undefined;
		} else {
			if (pendingLabel) {
				result.label = pendingLabel;
				pendingLabel = undefined;
			}
			factors.push(result);
		}
	});
	return { factors, errors, resultLabel: pendingLabel };
}

/** One entry in a parsed multi-block document. */
export interface DocumentBlock extends ParseResult {
	/** 0-based textarea line index of this block's first line. */
	startLine: number;
	/** Raw source text for this block (used for re-rendering). */
	source: string;
}

/**
 * Test whether a line is a block separator. A separator is a trimmed
 * line consisting of three or more dashes and nothing else.
 */
function isSeparatorLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length < 3) return false;
	return /^-{3,}$/.test(trimmed);
}

/**
 * Split the textarea contents into one or more blocks and parse each.
 *
 * Two kinds of separator end the current block:
 *   1. A line of three-or-more dashes (`---`, `----`, …). The separator
 *      line itself is consumed and does not belong to either block.
 *   2. Two or more consecutive blank lines. All of them are consumed.
 *
 * Blank blocks (no factors, no trailing label) are omitted from the
 * returned array so stray separators don't produce empty preview slots.
 * Line indices in each block's `factors` and `errors` are absolute (i.e.
 * they refer to positions in the full source) so downstream operations
 * like flipping a factor can splice the correct textarea line.
 */
export function parseDocument(source: string): DocumentBlock[] {
	const rawLines = source.split('\n');
	const blocks: DocumentBlock[] = [];

	let blockStart = 0;
	let i = 0;

	const flushBlock = (endExclusive: number) => {
		const blockLines = rawLines.slice(blockStart, endExclusive);
		const blockSource = blockLines.join('\n');
		const parsed = parseBlock(blockSource, blockStart);
		if (parsed.factors.length === 0 && parsed.errors.length === 0 && !parsed.resultLabel) {
			return;
		}
		blocks.push({ ...parsed, startLine: blockStart, source: blockSource });
	};

	while (i < rawLines.length) {
		const line = rawLines[i] ?? '';
		if (isSeparatorLine(line)) {
			flushBlock(i);
			blockStart = i + 1;
			i += 1;
			continue;
		}
		// Collapse runs of two or more blank lines into a separator.
		if (line.trim() === '') {
			let j = i;
			while (j < rawLines.length && (rawLines[j] ?? '').trim() === '') {
				j += 1;
			}
			const blankRun = j - i;
			if (blankRun >= 2) {
				flushBlock(i);
				blockStart = j;
				i = j;
				continue;
			}
		}
		i += 1;
	}

	flushBlock(rawLines.length);
	return blocks;
}
