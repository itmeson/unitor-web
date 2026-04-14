// Number formatting helpers for the dimensional plugin.
//
// Conventions:
// - Results are rounded to at most 3 significant figures for display.
// - Very large / very small numbers are shown in scientific notation
//   with Unicode superscript exponents (e.g. `3 × 10⁸`).
// - Factor cards use the user's original source form when possible
//   (see Quantity.displayValue); this module is for the computed
//   result value.

import type { UnitTerm } from './parser';

const SUPERSCRIPT_DIGITS: Record<string, string> = {
	'0': '⁰',
	'1': '¹',
	'2': '²',
	'3': '³',
	'4': '⁴',
	'5': '⁵',
	'6': '⁶',
	'7': '⁷',
	'8': '⁸',
	'9': '⁹',
	'-': '⁻',
	'+': '⁺',
};

export function superscript(n: number): string {
	return String(n)
		.split('')
		.map((c) => SUPERSCRIPT_DIGITS[c] ?? c)
		.join('');
}

export function roundToSigFigs(value: number, sig: number): number {
	if (value === 0 || !Number.isFinite(value)) return value;
	const d = Math.ceil(Math.log10(Math.abs(value)));
	const power = sig - d;
	const magnitude = Math.pow(10, power);
	return Math.round(value * magnitude) / magnitude;
}

/**
 * Format a computed result value: round to 3 sig figs, then render
 * either as a plain decimal (when the magnitude is comfortable to
 * read) or in scientific notation with a superscript exponent.
 */
export function formatResultValue(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	const rounded = roundToSigFigs(value, 3);
	if (rounded === 0) return '0';

	const abs = Math.abs(rounded);
	if (abs >= 1e-3 && abs < 1e4) {
		// Plain decimal is readable in this range.
		return String(rounded);
	}

	// Scientific form.
	const exp = Math.floor(Math.log10(abs));
	const mantissa = rounded / Math.pow(10, exp);
	// Strip trailing zeros from mantissa (e.g. "3.00" -> "3").
	const mantStr = String(Number(mantissa.toPrecision(3)));
	return `${mantStr} × 10${superscript(exp)}`;
}

/**
 * Format a computed result value as machine-parseable source text.
 *
 * Like `formatResultValue`, this rounds to 3 sig figs. Unlike it, the
 * scientific form uses `<mant>*10^<exp>` rather than the Unicode-
 * superscript `<mant> × 10ⁿ` form, so the emitted string parses
 * cleanly via `parseBlock` and the resulting factor's displayValue is
 * recomputed to the pretty form at parse time.
 *
 * Used by the "copy card" feature to turn a result-card value back
 * into a factor line the student can insert into a new block.
 */
export function serializeResultValue(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	const rounded = roundToSigFigs(value, 3);
	if (rounded === 0) return '0';

	const abs = Math.abs(rounded);
	if (abs >= 1e-3 && abs < 1e4) {
		return String(rounded);
	}

	const exp = Math.floor(Math.log10(abs));
	const mantissa = rounded / Math.pow(10, exp);
	const mantStr = String(Number(mantissa.toPrecision(3)));
	return `${mantStr}*10^${exp}`;
}

/**
 * Serialize a residual-unit list back to the unit-expression form
 * `parseUnitExpression` accepts. Keeps the pedagogical top/bottom
 * layout when there is at least one positive exponent (`kg*m/s^2`),
 * and falls back to signed exponents in the negatives-only case
 * (`s^-1`) because a bare leading `/` is not a valid unit expression.
 */
export function serializeUnits(units: UnitTerm[]): string {
	const positives = units.filter((u) => u.exponent > 0);
	const negatives = units.filter((u) => u.exponent < 0);

	const formatPositive = (u: UnitTerm): string =>
		u.exponent === 1 ? u.symbol : `${u.symbol}^${u.exponent}`;

	const formatDenomTerm = (u: UnitTerm): string => {
		const abs = Math.abs(u.exponent);
		return abs === 1 ? u.symbol : `${u.symbol}^${abs}`;
	};

	if (positives.length === 0 && negatives.length === 0) return '';

	if (negatives.length === 0) {
		return positives.map(formatPositive).join('*');
	}

	if (positives.length === 0) {
		// Negatives only — emit signed exponents to stay a valid unit
		// expression (no leading `/`).
		return negatives
			.map((u) => `${u.symbol}^${u.exponent}`)
			.join('*');
	}

	const posText = positives.map(formatPositive).join('*');
	const negText = negatives.map(formatDenomTerm).join('*');
	return `${posText}/${negText}`;
}

/**
 * Compose a full factor line from a computed value and its residual
 * units, suitable for inserting into the textarea as source.
 */
export function serializeResultAsFactorLine(
	value: number,
	units: UnitTerm[]
): string {
	const v = serializeResultValue(value);
	const u = serializeUnits(units);
	return u ? `${v} ${u}` : v;
}

/**
 * Pretty-print a backtick-delimited expression for display on a
 * factor card. Applies Unicode substitutions so the card shows a
 * readable formula rather than raw source syntax.
 *
 *   `*` → `·`   (but not `*` inside `10^…` scientific notation)
 *   `pi` → `π`
 *   `^n` → Unicode superscript
 *   parentheses preserved as-is
 */
export function prettyPrintExpression(text: string): string {
	let result = text;

	// Named constants.
	result = result.replace(/\bpi\b/g, 'π');

	// Exponents: caret followed by a (possibly negative) integer or a
	// parenthesised integer.  Convert to Unicode superscript.
	result = result.replace(/\^(\((-?\d+)\))/g, (_m, _g1, inner: string) =>
		superscript(Number(inner))
	);
	result = result.replace(/\^(-?\d+)/g, (_m, digits: string) =>
		superscript(Number(digits))
	);

	// Multiplication: handle scientific notation `N*10<sup>` → `N × 10<sup>`
	// before converting remaining `*` → `·`.
	result = result.replace(
		/(\d)\s*\*\s*10(?=[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺])/g,
		'$1 × 10'
	);
	result = result.replace(/\*/g, '·');

	return result;
}
