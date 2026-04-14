/**
 * Sanity harness for the ported logic modules.
 *
 * Runs a handful of representative parseBlock+compute cases plus a few
 * flipLine and formatResultValue checks. Not a full test suite — just
 * enough to confirm the port didn't regress anything while we rewire
 * the UI. Prints a pass/fail summary and exits with a non-zero code
 * on any failure so `npm test` surfaces regressions.
 *
 * Run via `npm test` (which builds this file to dist/harness.cjs and
 * executes it with node). See scripts/run-harness.mjs.
 */

import { parseBlock, parseDocument, flipLine, UnitTerm } from './parser';
import { compute } from './compute';
import {
	formatResultValue,
	prettyPrintExpression,
	serializeResultAsFactorLine,
	serializeResultValue,
	serializeUnits,
} from './format';
import { evaluateExpression } from './expression';

interface Case {
	name: string;
	run: () => void;
}

const cases: Case[] = [];
let failures = 0;
let current = '';

function test(name: string, run: () => void): void {
	cases.push({ name, run });
}

function fail(message: string): void {
	failures++;
	console.error(`  FAIL [${current}] ${message}`);
}

function assertEq<T>(actual: T, expected: T, label = ''): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) {
		fail(`${label || 'assertEq'}\n    expected: ${e}\n    actual:   ${a}`);
	}
}

function assertClose(actual: number, expected: number, tol = 1e-9, label = ''): void {
	if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
		fail(`${label || 'assertClose'} — expected ${expected}, got ${actual}`);
	}
}

// Helper: sort UnitTerm[] by symbol for order-independent comparison when needed.
function byUnits(units: UnitTerm[]): UnitTerm[] {
	return [...units].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ---------- parser / compute ----------

test('basic quantity: "5 km"', () => {
	const { factors, errors } = parseBlock('5 km');
	assertEq(errors, []);
	assertEq(factors.length, 1);
	const f = factors[0]!;
	assertEq(f.numerator.value, 5);
	assertEq(f.numerator.units, [{ symbol: 'km', exponent: 1 }]);
	assertEq(f.denominator, undefined);

	const { value, residualUnits } = compute(factors);
	assertEq(value, 5);
	assertEq(residualUnits, [{ symbol: 'km', exponent: 1 }]);
});

test('compound units: "9.8 m/s^2"', () => {
	const { factors, errors } = parseBlock('9.8 m/s^2');
	assertEq(errors, []);
	const f = factors[0]!;
	assertEq(f.numerator.value, 9.8);
	assertEq(f.numerator.units, [
		{ symbol: 'm', exponent: 1 },
		{ symbol: 's', exponent: -2 },
	]);
});

test('scientific notation: "3*10^8 m/s"', () => {
	const { factors, errors } = parseBlock('3*10^8 m/s');
	assertEq(errors, []);
	const f = factors[0]!;
	assertClose(f.numerator.value, 3e8);
	assertEq(f.numerator.units, [
		{ symbol: 'm', exponent: 1 },
		{ symbol: 's', exponent: -1 },
	]);
	assertEq(f.numerator.displayValue, '3 × 10⁸');
});

test('line-level fraction: "1.609 km / 1 mi"', () => {
	const { factors, errors } = parseBlock('1.609 km / 1 mi');
	assertEq(errors, []);
	const f = factors[0]!;
	assertEq(f.numerator.units, [{ symbol: 'km', exponent: 1 }]);
	assertEq(f.numerator.value, 1.609);
	assertEq(f.denominator?.units, [{ symbol: 'mi', exponent: 1 }]);
	assertEq(f.denominator?.value, 1);
});

test('bare dimensionless numerator: "1 / 5 km"', () => {
	const { factors, errors } = parseBlock('1 / 5 km');
	assertEq(errors, []);
	const f = factors[0]!;
	assertEq(f.numerator.units, []);
	assertEq(f.numerator.value, 1);
	assertEq(f.denominator?.units, [{ symbol: 'km', exponent: 1 }]);
	assertEq(f.denominator?.value, 5);
});

test('expression card: "`4*pi*6.4^2` m^2"', () => {
	const { factors, errors } = parseBlock('`4*pi*6.4^2` m^2');
	assertEq(errors, []);
	const f = factors[0]!;
	assertClose(f.numerator.value, 4 * Math.PI * 6.4 * 6.4);
	assertEq(f.numerator.units, [{ symbol: 'm', exponent: 2 }]);
	// Pretty-print: * → ·, pi → π, ^2 → ², with parens preserved only if present.
	assertEq(f.numerator.displayValue, '4·π·6.4²');
});

test('label before factor, result label after', () => {
	const src = [
		'# surface area',
		'`4*pi*6.4^2` m^2',
		'# speed of light',
		'3*10^8 m/s',
		'# final',
	].join('\n');
	const { factors, errors, resultLabel } = parseBlock(src);
	assertEq(errors, []);
	assertEq(factors.length, 2);
	assertEq(factors[0]!.label, 'surface area');
	assertEq(factors[1]!.label, 'speed of light');
	assertEq(resultLabel, 'final');
});

test('full chain km → km/s with cancellation annotations', () => {
	const src = ['5 km', '1 hr / 3600 s'].join('\n');
	const { factors, errors } = parseBlock(src);
	assertEq(errors, []);

	const result = compute(factors);
	// 5 * (1/3600) = 0.00138888...
	assertClose(result.value, 5 / 3600);
	// Residual should be km^1 and s^-1; hr cancels nothing (there's no hr^-1).
	// Order-independent check.
	assertEq(byUnits(result.residualUnits), byUnits([
		{ symbol: 'km', exponent: 1 },
		{ symbol: 'hr', exponent: 1 },
		{ symbol: 's', exponent: -1 },
	]));
});

test('cancellation: m^2 / m leaves m^1 with pair annotations', () => {
	const src = ['5 m^2', '1 / 2 m'].join('\n');
	const { factors } = parseBlock(src);
	const { annotated, value, residualUnits } = compute(factors);

	assertClose(value, 2.5);
	assertEq(residualUnits, [{ symbol: 'm', exponent: 1 }]);

	// factor 0 numerator m^2: 2 slots total, 1 cancelled, 1 pair id.
	const f0m = annotated[0]!.numerator.units[0]!;
	assertEq(f0m.symbol, 'm');
	assertEq(f0m.exponent, 2);
	assertEq(f0m.cancelledSlots, 1);
	assertEq(f0m.cancelledPairIds.length, 1);

	// factor 1 denominator m^1: 1 slot total, 1 cancelled, matching pair id.
	const f1m = annotated[1]!.denominator!.units[0]!;
	assertEq(f1m.symbol, 'm');
	assertEq(f1m.exponent, 1);
	assertEq(f1m.cancelledSlots, 1);
	assertEq(f1m.cancelledPairIds, f0m.cancelledPairIds);
});

test('parse error: non-sense input is reported, not thrown', () => {
	const { factors, errors } = parseBlock('not a quantity');
	assertEq(factors.length, 0);
	assertEq(errors.length, 1);
	assertEq(errors[0]!.line, 1);
});

// ---------- parseDocument ----------

test('parseDocument: single block with no separator', () => {
	const blocks = parseDocument('5 km\n1 hr / 3600 s');
	assertEq(blocks.length, 1);
	assertEq(blocks[0]!.startLine, 0);
	assertEq(blocks[0]!.factors.length, 2);
	assertEq(blocks[0]!.factors[0]!.sourceLine, 0);
	assertEq(blocks[0]!.factors[1]!.sourceLine, 1);
});

test('parseDocument: split on --- separator line', () => {
	const src = ['5 km', '---', '9.8 m/s^2'].join('\n');
	const blocks = parseDocument(src);
	assertEq(blocks.length, 2);
	assertEq(blocks[0]!.startLine, 0);
	assertEq(blocks[0]!.factors.length, 1);
	assertEq(blocks[0]!.factors[0]!.sourceLine, 0);
	assertEq(blocks[1]!.startLine, 2);
	assertEq(blocks[1]!.factors.length, 1);
	// sourceLine is absolute — line 2 of the full doc (0-based).
	assertEq(blocks[1]!.factors[0]!.sourceLine, 2);
});

test('parseDocument: split on 2+ blank lines', () => {
	const src = ['5 km', '', '', '9.8 m/s^2'].join('\n');
	const blocks = parseDocument(src);
	assertEq(blocks.length, 2);
	assertEq(blocks[0]!.factors[0]!.sourceLine, 0);
	assertEq(blocks[1]!.startLine, 3);
	assertEq(blocks[1]!.factors[0]!.sourceLine, 3);
});

test('parseDocument: single blank line does NOT split', () => {
	const src = ['5 km', '', '9.8 m/s^2'].join('\n');
	const blocks = parseDocument(src);
	assertEq(blocks.length, 1);
	assertEq(blocks[0]!.factors.length, 2);
});

test('parseDocument: empty blocks between separators are skipped', () => {
	const src = ['---', '5 km', '---', '---', '9.8 m/s^2', '---'].join('\n');
	const blocks = parseDocument(src);
	assertEq(blocks.length, 2);
	assertEq(blocks[0]!.factors[0]!.sourceLine, 1);
	assertEq(blocks[1]!.factors[0]!.sourceLine, 4);
});

test('parseDocument: "----abc" is NOT a separator', () => {
	// Trimmed line must be all dashes to count as a separator. "----abc" isn't.
	const src = ['5 km', '----abc', '9.8 m/s^2'].join('\n');
	const blocks = parseDocument(src);
	// The stray text produces a parse error, but the block is not split.
	assertEq(blocks.length, 1);
	assertEq(blocks[0]!.factors.length, 2);
	assertEq(blocks[0]!.errors.length, 1);
	assertEq(blocks[0]!.errors[0]!.line, 2);
});

test('parseDocument: exactly three dashes counts, two does not', () => {
	const srcThree = ['5 km', '---', '9.8 m/s^2'].join('\n');
	const srcTwo = ['5 km', '--', '9.8 m/s^2'].join('\n');
	assertEq(parseDocument(srcThree).length, 2);
	// "--" is a parse error, but not a separator.
	const blocks = parseDocument(srcTwo);
	assertEq(blocks.length, 1);
	assertEq(blocks[0]!.errors.length, 1);
});

test('parseDocument: labels and resultLabel stay per-block', () => {
	const src = [
		'# surface area',
		'`4*pi*6.4^2` m^2',
		'# final',
		'---',
		'# speed of light',
		'3*10^8 m/s',
	].join('\n');
	const blocks = parseDocument(src);
	assertEq(blocks.length, 2);
	assertEq(blocks[0]!.factors[0]!.label, 'surface area');
	assertEq(blocks[0]!.resultLabel, 'final');
	assertEq(blocks[1]!.factors[0]!.label, 'speed of light');
	assertEq(blocks[1]!.resultLabel, undefined);
});

// ---------- flipLine ----------

test('flipLine: bare quantity → fraction with 1 numerator', () => {
	assertEq(flipLine('5 km'), '1 / 5 km');
});

test('flipLine: bare-1 fraction collapses', () => {
	assertEq(flipLine('1 / 5 km'), '5 km');
});

test('flipLine: fraction swaps numerator and denominator', () => {
	assertEq(flipLine('1.609 km / 1 mi'), '1 mi / 1.609 km');
});

// ---------- format ----------

test('formatResultValue: comfortable range stays decimal', () => {
	assertEq(formatResultValue(0.001389), '0.00139');
	assertEq(formatResultValue(9.8), '9.8');
	assertEq(formatResultValue(1234), '1230'); // rounded to 3 sig figs
});

test('formatResultValue: large magnitude → scientific', () => {
	assertEq(formatResultValue(3e8), '3 × 10⁸');
	assertEq(formatResultValue(6.022e23), '6.02 × 10²³');
});

test('formatResultValue: small magnitude → scientific', () => {
	assertEq(formatResultValue(9.11e-31), '9.11 × 10⁻³¹');
});

test('prettyPrintExpression: pi, exponents, multiplication', () => {
	assertEq(prettyPrintExpression('4*pi*6.4^2'), '4·π·6.4²');
	assertEq(prettyPrintExpression('(3*10^8)^2'), '(3 × 10⁸)²');
});

// ---------- copy-card serializers ----------

test('serializeResultValue: comfortable range → plain decimal', () => {
	assertEq(serializeResultValue(0.001389), '0.00139');
	assertEq(serializeResultValue(13.4083), '13.4');
	assertEq(serializeResultValue(9.8), '9.8');
});

test('serializeResultValue: large/small → parseable scientific', () => {
	// Uses `*10^` instead of Unicode superscript so the emitted text
	// round-trips through parseBlock.
	assertEq(serializeResultValue(3e8), '3*10^8');
	assertEq(serializeResultValue(6.022e23), '6.02*10^23');
	assertEq(serializeResultValue(9.11e-31), '9.11*10^-31');
});

test('serializeResultValue: 0 and NaN', () => {
	assertEq(serializeResultValue(0), '0');
	assertEq(serializeResultValue(NaN), 'NaN');
});

test('serializeUnits: positives only', () => {
	assertEq(serializeUnits([{ symbol: 'kg', exponent: 1 }]), 'kg');
	assertEq(
		serializeUnits([
			{ symbol: 'kg', exponent: 1 },
			{ symbol: 'm', exponent: 2 },
		]),
		'kg*m^2'
	);
});

test('serializeUnits: mixed positives and negatives → top/bottom form', () => {
	assertEq(
		serializeUnits([
			{ symbol: 'kg', exponent: 1 },
			{ symbol: 'm', exponent: 1 },
			{ symbol: 's', exponent: -2 },
		]),
		'kg*m/s^2'
	);
	assertEq(
		serializeUnits([
			{ symbol: 'm', exponent: 1 },
			{ symbol: 's', exponent: -1 },
		]),
		'm/s'
	);
});

test('serializeUnits: negatives only → signed exponents', () => {
	// A bare leading `/` is not a valid unit expression, so fall back
	// to signed exponents in this case.
	assertEq(serializeUnits([{ symbol: 's', exponent: -1 }]), 's^-1');
	assertEq(
		serializeUnits([
			{ symbol: 'Hz', exponent: -2 },
		]),
		'Hz^-2'
	);
});

test('serializeUnits: dimensionless → empty string', () => {
	assertEq(serializeUnits([]), '');
});

test('serializeResultAsFactorLine: value + units composed with a space', () => {
	assertEq(
		serializeResultAsFactorLine(13.4083, [
			{ symbol: 'm', exponent: 1 },
			{ symbol: 's', exponent: -1 },
		]),
		'13.4 m/s'
	);
	// Dimensionless result: no unit portion.
	assertEq(serializeResultAsFactorLine(0.5, []), '0.5');
});

test('copy snippet round-trips through parseBlock', () => {
	// Build a realistic snippet the copy button would insert, then parse
	// it to confirm the factor's value and residual units match the
	// original result. This is the end-to-end guarantee that copying a
	// result card and pasting it in as a factor behaves correctly.
	const snippet = serializeResultAsFactorLine(13.4083, [
		{ symbol: 'm', exponent: 1 },
		{ symbol: 's', exponent: -1 },
	]);
	const parsed = parseBlock(snippet);
	assertEq(parsed.errors.length, 0);
	assertEq(parsed.factors.length, 1);
	const f = parsed.factors[0]!;
	assertClose(f.numerator.value, 13.4);
	assertEq(f.numerator.units as UnitTerm[], [
		{ symbol: 'm', exponent: 1 },
		{ symbol: 's', exponent: -1 },
	]);
});

test('copy snippet round-trip: scientific-notation result', () => {
	const snippet = serializeResultAsFactorLine(3e8, [
		{ symbol: 'm', exponent: 1 },
		{ symbol: 's', exponent: -1 },
	]);
	// "3*10^8 m/s" — the `*10^` form is what the parser expects.
	assertEq(snippet, '3*10^8 m/s');
	const parsed = parseBlock(snippet);
	assertEq(parsed.errors.length, 0);
	assertEq(parsed.factors.length, 1);
	assertClose(parsed.factors[0]!.numerator.value, 3e8);
});

test('copy snippet round-trip: negatives-only result', () => {
	// 60 Hz as 1/s → factor line "60 s^-1"
	const snippet = serializeResultAsFactorLine(60, [
		{ symbol: 's', exponent: -1 },
	]);
	assertEq(snippet, '60 s^-1');
	const parsed = parseBlock(snippet);
	assertEq(parsed.errors.length, 0);
	assertEq(parsed.factors.length, 1);
	const f = parsed.factors[0]!;
	assertClose(f.numerator.value, 60);
	assertEq(f.numerator.units as UnitTerm[], [
		{ symbol: 's', exponent: -1 },
	]);
});

// ---------- expression evaluator ----------

test('evaluateExpression: arithmetic precedence', () => {
	assertClose(evaluateExpression('2 + 3 * 4')!, 14);
	assertClose(evaluateExpression('2^3^2')!, 512); // right-associative
	assertClose(evaluateExpression('-(2+3)')!, -5);
	assertClose(evaluateExpression('pi')!, Math.PI);
});

test('evaluateExpression: malformed returns null', () => {
	assertEq(evaluateExpression('2 +'), null);
	assertEq(evaluateExpression('unknown_ident'), null);
	assertEq(evaluateExpression(''), null);
});

// ---------- runner ----------

function main(): void {
	let passed = 0;
	for (const c of cases) {
		current = c.name;
		const before = failures;
		try {
			c.run();
		} catch (err) {
			fail(`threw: ${(err as Error).message}`);
		}
		if (failures === before) {
			passed++;
			console.log(`  OK   ${c.name}`);
		}
	}
	console.log('');
	console.log(`${passed}/${cases.length} passed, ${failures} failure(s)`);
	if (failures > 0) process.exit(1);
}

main();
