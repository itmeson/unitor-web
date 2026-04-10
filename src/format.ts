// Number formatting helpers for the dimensional plugin.
//
// Conventions:
// - Results are rounded to at most 3 significant figures for display.
// - Very large / very small numbers are shown in scientific notation
//   with Unicode superscript exponents (e.g. `3 × 10⁸`).
// - Factor cards use the user's original source form when possible
//   (see Quantity.displayValue); this module is for the computed
//   result value.

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
