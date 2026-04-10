// Small recursive-descent evaluator for numeric expressions used in
// the value slot of a dimensional-analysis quantity.
//
// Grammar (standard precedence):
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := ('+' | '-') unary | power
//   power   := primary ('^' unary)?         // right-associative
//   primary := number | identifier | '(' expr ')'
//
// Supported named constants: pi, π, e. No user-defined variables,
// no function calls — this is a calculator, not a CAS.

const CONSTANTS: Record<string, number> = {
	pi: Math.PI,
	'π': Math.PI,
	e: Math.E,
};

type Token =
	| { kind: 'num'; value: number }
	| { kind: 'ident'; name: string }
	| { kind: 'op'; op: '+' | '-' | '*' | '/' | '^' }
	| { kind: 'lparen' }
	| { kind: 'rparen' }
	| { kind: 'eof' };

const NUMBER_RE = /^(\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?/;
const IDENT_RE = /^[A-Za-zπ][A-Za-z_]*/;

function tokenize(text: string): Token[] | null {
	const tokens: Token[] = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i]!;
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (/[0-9.]/.test(c)) {
			const m = text.slice(i).match(NUMBER_RE);
			if (!m) return null;
			const n = Number(m[0]);
			if (!Number.isFinite(n)) return null;
			tokens.push({ kind: 'num', value: n });
			i += m[0].length;
			continue;
		}
		if (/[A-Za-zπ]/.test(c)) {
			const m = text.slice(i).match(IDENT_RE);
			if (!m) return null;
			tokens.push({ kind: 'ident', name: m[0] });
			i += m[0].length;
			continue;
		}
		if (c === '(') {
			tokens.push({ kind: 'lparen' });
			i++;
			continue;
		}
		if (c === ')') {
			tokens.push({ kind: 'rparen' });
			i++;
			continue;
		}
		if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
			tokens.push({ kind: 'op', op: c });
			i++;
			continue;
		}
		return null;
	}
	tokens.push({ kind: 'eof' });
	return tokens;
}

interface State {
	tokens: Token[];
	pos: number;
}

function peek(s: State): Token {
	return s.tokens[s.pos] ?? { kind: 'eof' };
}

function advance(s: State): Token {
	const t = s.tokens[s.pos] ?? { kind: 'eof' };
	s.pos++;
	return t;
}

function parseExpr(s: State): number | null {
	let left = parseTerm(s);
	if (left === null) return null;
	for (;;) {
		const t = peek(s);
		if (t.kind !== 'op' || (t.op !== '+' && t.op !== '-')) break;
		advance(s);
		const right = parseTerm(s);
		if (right === null) return null;
		left = t.op === '+' ? left + right : left - right;
	}
	return left;
}

function parseTerm(s: State): number | null {
	let left = parseUnary(s);
	if (left === null) return null;
	for (;;) {
		const t = peek(s);
		if (t.kind !== 'op' || (t.op !== '*' && t.op !== '/')) break;
		advance(s);
		const right = parseUnary(s);
		if (right === null) return null;
		left = t.op === '*' ? left * right : left / right;
	}
	return left;
}

function parseUnary(s: State): number | null {
	const t = peek(s);
	if (t.kind === 'op' && (t.op === '+' || t.op === '-')) {
		advance(s);
		const v = parseUnary(s);
		if (v === null) return null;
		return t.op === '-' ? -v : v;
	}
	return parsePower(s);
}

function parsePower(s: State): number | null {
	const base = parsePrimary(s);
	if (base === null) return null;
	const t = peek(s);
	if (t.kind === 'op' && t.op === '^') {
		advance(s);
		// Right-associative: `-x^y^z` parses as `-(x^(y^z))`.
		const exp = parseUnary(s);
		if (exp === null) return null;
		return Math.pow(base, exp);
	}
	return base;
}

function parsePrimary(s: State): number | null {
	const t = advance(s);
	if (t.kind === 'num') return t.value;
	if (t.kind === 'ident') {
		const key = t.name === 'π' ? 'π' : t.name.toLowerCase();
		const v = CONSTANTS[key];
		if (v === undefined) return null;
		return v;
	}
	if (t.kind === 'lparen') {
		const v = parseExpr(s);
		if (v === null) return null;
		const close = advance(s);
		if (close.kind !== 'rparen') return null;
		return v;
	}
	return null;
}

/**
 * Evaluate an arithmetic expression string to a finite number, or
 * return `null` if the expression is malformed, references an unknown
 * identifier, or produces a non-finite result.
 */
export function evaluateExpression(text: string): number | null {
	const tokens = tokenize(text);
	if (!tokens) return null;
	const state: State = { tokens, pos: 0 };
	const value = parseExpr(state);
	if (value === null) return null;
	if (peek(state).kind !== 'eof') return null;
	if (!Number.isFinite(value)) return null;
	return value;
}
