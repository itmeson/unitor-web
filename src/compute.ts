import { Factor, UnitTerm } from './parser';

export interface AnnotatedUnitTerm extends UnitTerm {
	/**
	 * How many "slots" of this term were cancelled. Each term has
	 * `Math.abs(exponent)` slots; fully cancelled means
	 * `cancelledSlots === Math.abs(exponent)`.
	 */
	cancelledSlots: number;
	/**
	 * Pair IDs for each cancelled slot, in slot order. Length equals
	 * `cancelledSlots`. Two terms that cancel against each other share
	 * the same pair ID for the slots they paired on, which the
	 * renderer uses to color matching cancellations the same.
	 */
	cancelledPairIds: number[];
}

export interface AnnotatedQuantity {
	value: number;
	units: AnnotatedUnitTerm[];
	displayValue?: string;
}

export interface AnnotatedFactor {
	numerator: AnnotatedQuantity;
	denominator?: AnnotatedQuantity;
	raw: string;
	sourceLine: number;
	label?: string;
}

export interface ComputedResult {
	annotated: AnnotatedFactor[];
	value: number;
	/**
	 * Residual units across the whole block, with signed exponents.
	 * Positive exponents belong on top, negative on bottom.
	 */
	residualUnits: UnitTerm[];
}

function cloneQuantity(q: {
	value: number;
	units: UnitTerm[];
	displayValue?: string;
}): AnnotatedQuantity {
	return {
		value: q.value,
		units: q.units.map((u) => ({
			...u,
			cancelledSlots: 0,
			cancelledPairIds: [],
		})),
		displayValue: q.displayValue,
	};
}

/**
 * Pure function: takes parsed factors and returns annotated factors
 * with cancellation marked per unit-term, plus the numeric result and
 * residual unit exponents.
 *
 * Cancellation model: each unit term has |exponent| slots. For each
 * symbol, we pair positive-effective slots against negative-effective
 * slots in source order until one side runs out. "Effective" here
 * means: numerator-position terms contribute their exponent as-is,
 * denominator-position terms contribute with sign flipped.
 */
export function compute(factors: Factor[]): ComputedResult {
	const annotated: AnnotatedFactor[] = factors.map((f) => ({
		numerator: cloneQuantity(f.numerator),
		denominator: f.denominator ? cloneQuantity(f.denominator) : undefined,
		raw: f.raw,
		sourceLine: f.sourceLine,
		label: f.label,
	}));

	interface Slot {
		term: AnnotatedUnitTerm;
		remaining: number;
	}
	const positive = new Map<string, Slot[]>();
	const negative = new Map<string, Slot[]>();

	const addTerm = (term: AnnotatedUnitTerm, factorSide: 1 | -1) => {
		const effExp = term.exponent * factorSide;
		if (effExp === 0) return;
		const abs = Math.abs(effExp);
		const slot: Slot = { term, remaining: abs };
		const map = effExp > 0 ? positive : negative;
		if (!map.has(term.symbol)) map.set(term.symbol, []);
		map.get(term.symbol)!.push(slot);
	};

	for (const f of annotated) {
		for (const t of f.numerator.units) addTerm(t, 1);
		if (f.denominator) {
			for (const t of f.denominator.units) addTerm(t, -1);
		}
	}

	// Pair off slots per symbol, in source order. Each (posSlot, negSlot)
	// pair-off event gets a unique ID so the renderer can color matching
	// cancellations consistently.
	let nextPairId = 0;
	for (const [sym, posList] of positive) {
		const negList = negative.get(sym);
		if (!negList) continue;
		let pi = 0;
		let ni = 0;
		while (pi < posList.length && ni < negList.length) {
			const p = posList[pi];
			const n = negList[ni];
			if (!p || !n) break;
			const k = Math.min(p.remaining, n.remaining);
			const pairId = nextPairId++;
			for (let s = 0; s < k; s++) {
				p.term.cancelledPairIds.push(pairId);
				n.term.cancelledPairIds.push(pairId);
			}
			p.remaining -= k;
			n.remaining -= k;
			p.term.cancelledSlots += k;
			n.term.cancelledSlots += k;
			if (p.remaining === 0) pi++;
			if (n.remaining === 0) ni++;
		}
	}

	// Compute numeric value.
	let value = 1;
	for (const f of annotated) {
		value *= f.numerator.value;
		if (f.denominator) value /= f.denominator.value;
	}

	// Compute residual exponents per symbol from the leftover slots.
	const residualMap = new Map<string, number>();
	for (const [sym, posList] of positive) {
		for (const slot of posList) {
			if (slot.remaining > 0) {
				residualMap.set(sym, (residualMap.get(sym) ?? 0) + slot.remaining);
			}
		}
	}
	for (const [sym, negList] of negative) {
		for (const slot of negList) {
			if (slot.remaining > 0) {
				residualMap.set(sym, (residualMap.get(sym) ?? 0) - slot.remaining);
			}
		}
	}

	const residualUnits: UnitTerm[] = [];
	for (const [symbol, exponent] of residualMap) {
		if (exponent !== 0) residualUnits.push({ symbol, exponent });
	}

	return { annotated, value, residualUnits };
}
