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
import {
	addEntry,
	decodeLibraryFromUrl,
	emptyLibrary,
	encodeLibraryForUrl,
	exportLibrary,
	hasEntry,
	importLibrary,
	removeEntry,
	removeMatching,
	LibraryData,
} from './library';
import {
	MAX_RECENTS,
	RecentsData,
	addRecent,
	emptyRecents,
	labelForUrl,
	relativeTime,
} from './recents';
import {
	encodeState,
	decodeState,
	toBase64url,
	fromBase64url,
} from './compress';

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

// ---------- library ----------

test('library: addEntry prepends, duplicates allowed', () => {
	let lib: LibraryData = emptyLibrary();
	lib = addEntry(lib, { label: 'mile to meter', source: '1609 m / 1 mi' });
	lib = addEntry(lib, { label: 'hr to sec', source: '3600 s / 1 hr' });
	assertEq(lib.entries.length, 2);
	assertEq(lib.entries[0]!.label, 'hr to sec');
	assertEq(lib.entries[1]!.label, 'mile to meter');

	// Add the same entry again — current policy is to keep the duplicate
	// (user deletes what they don't want; silent deduping hides clicks).
	lib = addEntry(lib, { label: 'hr to sec', source: '3600 s / 1 hr' });
	assertEq(lib.entries.length, 3);
});

test('library: addEntry trims label and source', () => {
	let lib: LibraryData = emptyLibrary();
	lib = addEntry(lib, { label: '  mi to m  ', source: '  1609 m / 1 mi  ' });
	assertEq(lib.entries[0]!.label, 'mi to m');
	assertEq(lib.entries[0]!.source, '1609 m / 1 mi');
});

test('library: hasEntry matches exact (label, source) after trim', () => {
	let lib: LibraryData = emptyLibrary();
	lib = addEntry(lib, { label: 'mi to m', source: '1609 m / 1 mi' });
	assertEq(hasEntry(lib, 'mi to m', '1609 m / 1 mi'), true);
	// Trims input as well.
	assertEq(hasEntry(lib, '  mi to m  ', '1609 m / 1 mi'), true);
	// Wrong source → no match, even with matching label.
	assertEq(hasEntry(lib, 'mi to m', '1.609 km / 1 mi'), false);
	// Wrong label → no match.
	assertEq(hasEntry(lib, 'miles to meters', '1609 m / 1 mi'), false);
});

test('library: removeEntry deletes by index, ignores out-of-range', () => {
	let lib: LibraryData = emptyLibrary();
	lib = addEntry(lib, { label: 'a', source: '1' });
	lib = addEntry(lib, { label: 'b', source: '2' });
	lib = addEntry(lib, { label: 'c', source: '3' });
	// Most-recent-first, so entries = [c, b, a]
	lib = removeEntry(lib, 1);
	assertEq(lib.entries.map((e) => e.label), ['c', 'a']);
	// Out-of-range is a no-op.
	lib = removeEntry(lib, 42);
	assertEq(lib.entries.length, 2);
	lib = removeEntry(lib, -1);
	assertEq(lib.entries.length, 2);
});

test('library: removeMatching removes first (label, source) match', () => {
	let lib: LibraryData = emptyLibrary();
	lib = addEntry(lib, { label: 'x', source: 'a' });
	lib = addEntry(lib, { label: 'x', source: 'b' });
	lib = addEntry(lib, { label: 'x', source: 'a' });
	// entries = [x/a, x/b, x/a]
	lib = removeMatching(lib, 'x', 'a');
	// First match removed → [x/b, x/a]
	assertEq(lib.entries.map((e) => e.source), ['b', 'a']);
	// No match → library unchanged.
	lib = removeMatching(lib, 'y', 'z');
	assertEq(lib.entries.length, 2);
});

test('library: exportLibrary/importLibrary round-trips', () => {
	let lib: LibraryData = emptyLibrary();
	lib = addEntry(lib, { label: 'mi to m', source: '1609 m / 1 mi' });
	lib = addEntry(lib, { label: 'hr to s', source: '3600 s / 1 hr' });

	const json = exportLibrary(lib);
	// Importing into an empty library should reproduce the original.
	const { library: restored, added, skipped } = importLibrary(
		emptyLibrary(),
		json
	);
	assertEq(added, 2);
	assertEq(skipped, 0);
	assertEq(restored.entries, lib.entries);
});

test('library: importLibrary merges, skipping duplicates by (label, source)', () => {
	let existing: LibraryData = emptyLibrary();
	existing = addEntry(existing, { label: 'mi to m', source: '1609 m / 1 mi' });
	existing = addEntry(existing, { label: 'hr to s', source: '3600 s / 1 hr' });

	// Incoming file has one duplicate of the existing library plus two new
	// entries.
	const incoming: LibraryData = {
		version: 1,
		entries: [
			{ label: 'kg to g', source: '1000 g / 1 kg' },
			{ label: 'hr to s', source: '3600 s / 1 hr' }, // duplicate
			{ label: 'L to m^3', source: '0.001 m^3 / 1 L' },
		],
	};
	const json = exportLibrary(incoming);

	const { library: merged, added, skipped } = importLibrary(existing, json);
	assertEq(added, 2);
	assertEq(skipped, 1);
	// New entries sit on top, in their incoming order, then the existing
	// entries preserve their order beneath.
	assertEq(merged.entries.map((e) => e.label), [
		'kg to g',
		'L to m^3',
		'hr to s',
		'mi to m',
	]);
});

test('library: importLibrary throws on bad JSON', () => {
	let threw = false;
	try {
		importLibrary(emptyLibrary(), '{ not valid json');
	} catch {
		threw = true;
	}
	assertEq(threw, true);
});

test('library: importLibrary throws on wrong schema', () => {
	// Missing version.
	let threw = false;
	try {
		importLibrary(emptyLibrary(), '{"entries":[]}');
	} catch {
		threw = true;
	}
	assertEq(threw, true);

	// Unknown version.
	threw = false;
	try {
		importLibrary(emptyLibrary(), '{"version":99,"entries":[]}');
	} catch {
		threw = true;
	}
	assertEq(threw, true);

	// Entry missing required fields.
	threw = false;
	try {
		importLibrary(emptyLibrary(), '{"version":1,"entries":[{"label":"x"}]}');
	} catch {
		threw = true;
	}
	assertEq(threw, true);
});

test('library: encodeLibraryForUrl is compact (no indentation)', () => {
	const lib: LibraryData = addEntry(emptyLibrary(), {
		label: 'mile to meter',
		source: '1609 meters / 1 mile',
	});
	const encoded = encodeLibraryForUrl(lib);
	// Compact means no newlines and no runs of 2+ spaces from indentation.
	assertEq(encoded.includes('\n'), false, 'should have no newlines');
	assertEq(encoded.includes('  '), false, 'should have no double spaces');
	// It's still valid JSON describing the same library.
	const parsed: unknown = JSON.parse(encoded);
	assertEq(parsed, lib);
});

test('library: encode → decode round-trips a non-trivial library', () => {
	const lib = addEntry(
		addEntry(emptyLibrary(), { label: 'second to hour', source: '1 hr / 3600 s' }),
		{ label: 'mile to meter', source: '1609 meters / 1 mile' }
	);
	const encoded = encodeLibraryForUrl(lib);
	const decoded = decodeLibraryFromUrl(encoded);
	assertEq(decoded, lib);
});

test('library: decodeLibraryFromUrl returns null on malformed JSON', () => {
	assertEq(decodeLibraryFromUrl('{not json'), null);
	// Valid JSON but wrong shape.
	assertEq(decodeLibraryFromUrl('[1,2,3]'), null);
	// Missing version.
	assertEq(decodeLibraryFromUrl('{"entries":[]}'), null);
	// Unknown version.
	assertEq(decodeLibraryFromUrl('{"version":99,"entries":[]}'), null);
	// Empty string — JSON.parse throws, caller gets null.
	assertEq(decodeLibraryFromUrl(''), null);
});

test('library: decodeLibraryFromUrl accepts an empty library', () => {
	const empty = emptyLibrary();
	const encoded = encodeLibraryForUrl(empty);
	const decoded = decodeLibraryFromUrl(encoded);
	assertEq(decoded, empty);
});

// ---------- recents ----------

test('recents: addRecent prepends new URLs newest-first', () => {
	let r: RecentsData = emptyRecents();
	r = addRecent(r, '/?doc#a', 100);
	r = addRecent(r, '/?doc#b', 200);
	r = addRecent(r, '/?doc#c', 300);
	assertEq(r.entries.map((e) => e.url), ['/?doc#c', '/?doc#b', '/?doc#a']);
	assertEq(r.entries.map((e) => e.savedAt), [300, 200, 100]);
});

test('recents: addRecent dedups by exact URL and refreshes timestamp', () => {
	let r: RecentsData = emptyRecents();
	r = addRecent(r, '/?doc#a', 100);
	r = addRecent(r, '/?doc#b', 200);
	// Revisit A at a later time — A should move to the top with the new
	// timestamp and there should still be only two entries.
	r = addRecent(r, '/?doc#a', 300);
	assertEq(r.entries.length, 2);
	assertEq(r.entries.map((e) => e.url), ['/?doc#a', '/?doc#b']);
	assertEq(r.entries[0]!.savedAt, 300);
});

test('recents: addRecent enforces MAX_RECENTS cap, oldest evicted', () => {
	let r: RecentsData = emptyRecents();
	for (let i = 0; i < MAX_RECENTS + 5; i++) {
		r = addRecent(r, `/?doc#${i}`, i);
	}
	assertEq(r.entries.length, MAX_RECENTS);
	// Newest-first: the last push (#24) is on top; the #0..#4 batch was evicted.
	assertEq(r.entries[0]!.url, `/?doc#${MAX_RECENTS + 4}`);
	assertEq(
		r.entries[r.entries.length - 1]!.url,
		`/?doc#${MAX_RECENTS + 5 - MAX_RECENTS}` // i.e. the oldest surviving
	);
});

test('recents: addRecent ignores empty URLs', () => {
	let r: RecentsData = emptyRecents();
	r = addRecent(r, '', 100);
	r = addRecent(r, '   ', 200);
	assertEq(r.entries.length, 0);
});

test('recents: labelForUrl uses the first "# label" line from the source', () => {
	// Hash carries the source; first # line wins even if non-label text appears above.
	const src = encodeURIComponent('# mile-to-meter conversion\n30 mile/hr');
	assertEq(labelForUrl(`/#${src}`), 'mile-to-meter conversion');
});

test('recents: labelForUrl falls back to the first non-empty source line', () => {
	const src = encodeURIComponent('\n\n30 mile/hr\n1609 m / 1 mi');
	assertEq(labelForUrl(`/#${src}`), '30 mile/hr');
});

test('recents: labelForUrl skips bare `#` with no text', () => {
	const src = encodeURIComponent('#\n30 mile/hr');
	assertEq(labelForUrl(`/#${src}`), '30 mile/hr');
});

test('recents: labelForUrl falls back to library-size hint when source is empty', () => {
	const lib: LibraryData = addEntry(
		addEntry(emptyLibrary(), { label: 'hr to s', source: '3600 s / 1 hr' }),
		{ label: 'mi to m', source: '1609 m / 1 mi' }
	);
	const libEncoded = encodeURIComponent(encodeLibraryForUrl(lib));
	assertEq(labelForUrl(`/?lib=${libEncoded}`), '2 factors');

	const oneLib: LibraryData = addEntry(emptyLibrary(), {
		label: 'hr to s',
		source: '3600 s / 1 hr',
	});
	const oneEncoded = encodeURIComponent(encodeLibraryForUrl(oneLib));
	assertEq(labelForUrl(`/?lib=${oneEncoded}`), '1 factor');
});

test('recents: labelForUrl handles the empty-calculator sentinel', () => {
	assertEq(labelForUrl('/?doc'), '(empty calculator)');
	assertEq(labelForUrl('/'), '(empty calculator)');
});

test('recents: labelForUrl returns "(invalid URL)" on malformed input', () => {
	// `new URL` with the fake base rejects truly broken inputs.
	assertEq(labelForUrl('http://['), '(invalid URL)');
});

test('recents: labelForUrl truncates very long labels', () => {
	const long = 'a'.repeat(120);
	const src = encodeURIComponent(`# ${long}`);
	const out = labelForUrl(`/#${src}`);
	// Truncate helper caps at 50 chars including the ellipsis.
	assertEq(out.length <= 50, true, `expected <=50 chars, got ${out.length}`);
	assertEq(out.endsWith('…'), true);
});

test('recents: relativeTime thresholds', () => {
	const now = 1_700_000_000_000;
	assertEq(relativeTime(now - 3_000, now), 'just now');
	assertEq(relativeTime(now - 30_000, now), '30 seconds ago');
	assertEq(relativeTime(now - 60_000, now), '1 minute ago');
	assertEq(relativeTime(now - 5 * 60_000, now), '5 minutes ago');
	assertEq(relativeTime(now - 60 * 60_000, now), '1 hour ago');
	assertEq(relativeTime(now - 3 * 60 * 60_000, now), '3 hours ago');
	assertEq(relativeTime(now - 24 * 60 * 60_000, now), 'yesterday');
	assertEq(relativeTime(now - 3 * 24 * 60 * 60_000, now), '3 days ago');
	// Future timestamps clamp to "just now" (never goes negative).
	assertEq(relativeTime(now + 10_000, now), 'just now');
});

// ---------- compress ----------

test('compress: base64url round-trips arbitrary bytes', () => {
	const input = new Uint8Array([0, 1, 127, 128, 254, 255, 42]);
	const encoded = toBase64url(input);
	// base64url uses only [-_A-Za-z0-9], no + or / or =
	assertEq(/^[A-Za-z0-9_-]+$/.test(encoded), true, 'should be url-safe chars');
	const decoded = fromBase64url(encoded);
	assertEq(decoded !== null, true, 'should decode');
	assertEq(Array.from(decoded!), Array.from(input));
});

test('compress: fromBase64url returns null on invalid chars', () => {
	assertEq(fromBase64url('!!!'), null);
});

test('compress: encodeState/decodeState round-trips source-only', () => {
	const source = '30 mile/hr\n1609 m / 1 mi';
	const lib = emptyLibrary();
	const encoded = encodeState(source, lib);
	assertEq(encoded !== null, true, 'should encode');
	const decoded = decodeState(encoded!);
	assertEq(decoded !== null, true, 'should decode');
	assertEq(decoded!.source, source);
	assertEq(decoded!.library.entries.length, 0);
});

test('compress: encodeState/decodeState round-trips library-only', () => {
	const source = '';
	const lib = addEntry(
		addEntry(emptyLibrary(), { label: 'hr to s', source: '3600 s / 1 hr' }),
		{ label: 'mi to m', source: '1609 m / 1 mi' }
	);
	const encoded = encodeState(source, lib);
	assertEq(encoded !== null, true);
	const decoded = decodeState(encoded!);
	assertEq(decoded !== null, true);
	assertEq(decoded!.source, '');
	assertEq(decoded!.library.entries.length, 2);
	assertEq(decoded!.library.entries[0]!.label, 'mi to m');
});

test('compress: encodeState/decodeState round-trips source + library', () => {
	const source = '# speed\n30 mile/hr\n1609 m / 1 mi\n1 hr / 3600 s';
	const lib = addEntry(
		addEntry(emptyLibrary(), { label: 'hr to s', source: '3600 s / 1 hr' }),
		{ label: 'mi to m', source: '1609 m / 1 mi' }
	);
	const encoded = encodeState(source, lib);
	assertEq(encoded !== null, true);
	const decoded = decodeState(encoded!);
	assertEq(decoded !== null, true);
	assertEq(decoded!.source, source);
	assertEq(decoded!.library.entries.length, 2);
});

test('compress: encodeState returns null for empty state', () => {
	assertEq(encodeState('', emptyLibrary()), null);
});

test('compress: decodeState returns null on garbage input', () => {
	assertEq(decodeState('not-valid-compressed-data'), null);
	assertEq(decodeState(''), null);
});

test('compress: compressed URL is shorter than legacy format', () => {
	// Build a realistic payload and compare compressed vs legacy sizes.
	const source = Array.from({ length: 15 }, (_, i) =>
		`# factor ${i}\n${1000 + i} meters / 1 mile`
	).join('\n');
	const lib: LibraryData = {
		version: 1,
		entries: Array.from({ length: 10 }, (_, i) => ({
			label: `conversion ${i}`,
			source: `${1000 + i} meters / 1 mile`,
		})),
	};

	const compressed = encodeState(source, lib);
	assertEq(compressed !== null, true);

	// Legacy format size: ?lib= + percent-encoded JSON + # + percent-encoded source
	const legacyLib = '?lib=' + encodeURIComponent(encodeLibraryForUrl(lib));
	const legacyHash = '#' + encodeURIComponent(source);
	const legacyLen = legacyLib.length + legacyHash.length;

	const compressedLen = ('?d=' + compressed!).length;

	// Compressed should be meaningfully shorter. We expect roughly 3-4x
	// improvement; assert at least 2x to avoid test brittleness.
	assertEq(
		compressedLen < legacyLen / 2,
		true,
		`compressed ${compressedLen} should be <50% of legacy ${legacyLen}`
	);
});

test('compress: labelForUrl works on compressed ?d= URLs', () => {
	const source = '# kinematics homework\n30 mile/hr';
	const lib = emptyLibrary();
	const encoded = encodeState(source, lib);
	const url = `/?d=${encoded}`;
	assertEq(labelForUrl(url), 'kinematics homework');
});

test('compress: labelForUrl still works on legacy ?lib=/#source URLs', () => {
	// Ensure old recents entries still label correctly.
	const src = encodeURIComponent('# old format test\n5 km');
	assertEq(labelForUrl(`/#${src}`), 'old format test');
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
