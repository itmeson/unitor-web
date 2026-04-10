import { Plugin, ItemView, WorkspaceLeaf, MarkdownView, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from './settings';
import { parseBlock, UnitTerm, flipLine } from './parser';
import {
	compute,
	AnnotatedQuantity,
	AnnotatedUnitTerm,
} from './compute';
import { formatResultValue, superscript } from './format';

/**
 * Size of the cancellation color palette defined in `styles.css`.
 * Pair IDs are mapped into this range with `pairId % PALETTE_SIZE`.
 */
const CANCEL_PALETTE_SIZE = 8;

/**
 * Render a compact piece of a unit term — symbol, optional exponent,
 * with optional strikethrough + color class for cancelled pieces.
 */
function renderTermPiece(
	parent: HTMLElement,
	symbol: string,
	exponent: number,
	cancelledPairId: number | null
) {
	const text = exponent === 1 ? symbol : symbol + superscript(exponent);
	let cls = 'dimensional-unit';
	if (cancelledPairId !== null) {
		const paletteIdx = cancelledPairId % CANCEL_PALETTE_SIZE;
		cls += ` dimensional-cancelled dimensional-cancelled-${paletteIdx}`;
	}
	parent.createSpan({ cls, text });
}

/**
 * Render a single unit term, handling full, none, or partial
 * cancellation. A term with all slots uncancelled renders compactly
 * (`s²`). With any cancellation, the term is expanded into one piece
 * per cancellation "run" (consecutive cancelled slots sharing a pair
 * ID collapse to a single piece like `s̶²`), followed by one live
 * piece for the residual exponent.
 */
function renderUnitTerm(parent: HTMLElement, term: AnnotatedUnitTerm) {
	const absExp = Math.abs(term.exponent);
	if (absExp === 0) return;

	if (term.cancelledSlots === 0) {
		renderTermPiece(parent, term.symbol, absExp, null);
		return;
	}

	let first = true;
	const writeSeparator = () => {
		if (!first) parent.createSpan({ text: '·' });
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
	parent: HTMLElement,
	units: AnnotatedUnitTerm[]
) {
	const positives = units.filter((u) => u.exponent > 0);
	const negatives = units.filter((u) => u.exponent < 0);

	if (positives.length === 0 && negatives.length === 0) return;

	if (positives.length > 0) {
		positives.forEach((t, i) => {
			if (i > 0) parent.createSpan({ text: '·' });
			renderUnitTerm(parent, t);
		});
	} else {
		parent.createSpan({ text: '1' });
	}

	if (negatives.length > 0) {
		parent.createSpan({ text: '/' });
		negatives.forEach((t, i) => {
			if (i > 0) parent.createSpan({ text: '·' });
			renderUnitTerm(parent, t);
		});
	}
}

/**
 * Render a quantity into a factor-card cell: value, space, unit
 * expression.
 */
function renderQuantityCell(
	parent: HTMLElement,
	q: AnnotatedQuantity,
	cellCls: string
) {
	const cell = parent.createDiv({ cls: `dimensional-cell ${cellCls}` });
	cell.createSpan({
		cls: 'dimensional-value',
		text: q.displayValue ?? String(q.value),
	});
	if (q.units.length > 0) {
		cell.createSpan({ text: ' ' });
		renderUnitExpressionInline(cell, q.units);
	}
}

/**
 * Render a plain (non-annotated) unit term list — used for the
 * residual units in the result card. No cancellation markup.
 */
function renderResidualTerms(parent: HTMLElement, terms: UnitTerm[]) {
	terms.forEach((t, i) => {
		if (i > 0) parent.createSpan({ text: '·' });
		const abs = Math.abs(t.exponent);
		const text = abs === 1 ? t.symbol : t.symbol + superscript(abs);
		parent.createSpan({ cls: 'dimensional-unit', text });
	});
}

/**
 * Callback to flip a factor card. Receives the 0-based source line
 * index (within the block body) of the factor to flip.
 */
export type OnFlipCallback = (sourceLine: number) => void;

/**
 * Render a single dimensional block's source into the given host
 * element. Used by both the reading-mode code block processor and
 * the live preview side-panel view.
 *
 * When `onFlip` is provided, each factor card gets a small flip
 * button that invokes the callback with the factor's source line.
 */
export function renderDimensionalBlock(
	source: string,
	el: HTMLElement,
	onFlip?: OnFlipCallback
) {
	const container = el.createDiv({ cls: 'dimensional-block' });
	const { factors, errors } = parseBlock(source);

	if (factors.length > 0) {
		const { annotated, value, residualUnits } = compute(factors);

		const row = container.createDiv({ cls: 'dimensional-row' });

		annotated.forEach((f, i) => {
			if (i > 0) {
				row.createDiv({ cls: 'dimensional-op', text: '×' });
			}
			const cardWrap = row.createDiv({ cls: 'dimensional-card-wrap' });
			const card = cardWrap.createDiv({ cls: 'dimensional-card' });
			renderQuantityCell(card, f.numerator, 'dimensional-num');
			if (f.denominator) {
				card.createDiv({ cls: 'dimensional-bar' });
				renderQuantityCell(card, f.denominator, 'dimensional-den');
			}
			if (onFlip) {
				const btn = cardWrap.createEl('button', {
					cls: 'dimensional-flip-btn',
					attr: { 'aria-label': 'Flip this factor', title: 'Flip' },
				});
				btn.setText('⇅');
				const line = f.sourceLine;
				// Prevent mousedown from stealing focus away from the editor.
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

		row.createDiv({ cls: 'dimensional-op', text: '=' });

		const resultCard = row.createDiv({
			cls: 'dimensional-card dimensional-result',
		});
		const posRes = residualUnits.filter((u) => u.exponent > 0);
		const negRes = residualUnits.filter((u) => u.exponent < 0);

		const resultTop = resultCard.createDiv({ cls: 'dimensional-cell' });
		resultTop.createSpan({
			cls: 'dimensional-value',
			text: formatResultValue(value),
		});
		if (posRes.length > 0) {
			resultTop.createSpan({ text: ' ' });
			renderResidualTerms(resultTop, posRes);
		}

		if (negRes.length > 0) {
			resultCard.createDiv({ cls: 'dimensional-bar' });
			const resultBot = resultCard.createDiv({
				cls: 'dimensional-cell',
			});
			renderResidualTerms(resultBot, negRes);
		}
	}

	for (const err of errors) {
		container.createDiv({
			cls: 'dimensional-error',
			text: `line ${err.line}: ${err.message}`,
		});
	}
}

/**
 * Find all `dimensional` fenced code blocks in a document and return
 * each one's inner source plus line range (0-indexed, inclusive of
 * the opening/closing fence lines).
 */
interface DimensionalBlockLoc {
	source: string;
	fromLine: number;
	toLine: number;
}

export function findDimensionalBlocks(doc: string): DimensionalBlockLoc[] {
	const lines = doc.split('\n');
	const blocks: DimensionalBlockLoc[] = [];
	const fenceRe = /^(\s*)(```+)\s*dimensional\s*$/;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? '';
		const m = fenceRe.exec(line);
		if (!m) {
			i++;
			continue;
		}
		const fence = m[2] ?? '```';
		const closeRe = new RegExp('^\\s*' + fence + '\\s*$');
		const from = i;
		let j = i + 1;
		const bodyLines: string[] = [];
		while (j < lines.length && !closeRe.test(lines[j] ?? '')) {
			bodyLines.push(lines[j] ?? '');
			j++;
		}
		const to = j < lines.length ? j : lines.length - 1;
		blocks.push({ source: bodyLines.join('\n'), fromLine: from, toLine: to });
		i = j + 1;
	}
	return blocks;
}

export const DIMENSIONAL_PREVIEW_VIEW = 'dimensional-preview';

/**
 * Side-panel view that live-renders `dimensional` blocks from the
 * active markdown editor. If the cursor sits inside a block, only
 * that block is shown; otherwise all blocks in the document are
 * shown stacked.
 */
export class DimensionalPreviewView extends ItemView {
	private lastFile: TFile | null = null;
	/** Cached reference to the last known MarkdownView so flips that
	 *  steal focus don't lose track of the editor. */
	private lastMarkdownView: MarkdownView | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return DIMENSIONAL_PREVIEW_VIEW;
	}

	getDisplayText() {
		return 'Unitor preview';
	}

	getIcon() {
		return 'ruler';
	}

	async onOpen() {
		this.contentEl.addClass('dimensional-preview-view');
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.refresh())
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', () => this.refresh())
		);
		this.refresh();
	}

	async onClose() {}

	refresh() {
		const md =
			this.app.workspace.getActiveViewOfType(MarkdownView) ??
			this.lastMarkdownView;
		this.contentEl.empty();
		this.contentEl.addClass('dimensional-preview-view');

		if (!md) {
			this.contentEl.createDiv({
				cls: 'dimensional-preview-empty',
				text: 'Open a markdown note to preview Unitor blocks.',
			});
			return;
		}

		this.lastMarkdownView = md;
		this.lastFile = md.file;
		const editor = md.editor;
		const doc = editor.getValue();
		const blocks = findDimensionalBlocks(doc);

		if (blocks.length === 0) {
			this.contentEl.createDiv({
				cls: 'dimensional-preview-empty',
				text: 'No `dimensional` blocks in this note yet.',
			});
			return;
		}

		const cursorLine = editor.getCursor().line;
		const active = blocks.find(
			(b) => cursorLine >= b.fromLine && cursorLine <= b.toLine
		);
		const toRender = active ? [active] : blocks;

		for (const b of toRender) {
			const wrap = this.contentEl.createDiv({ cls: 'dimensional-preview-item' });
			// The block body starts on the line after the opening fence.
			const bodyStartLine = b.fromLine + 1;
			renderDimensionalBlock(b.source, wrap, (sourceLine) => {
				const docLine = bodyStartLine + sourceLine;
				const original = editor.getLine(docLine);
				const flipped = flipLine(original);
				editor.setLine(docLine, flipped);
				// editor-change event will trigger refresh automatically.
			});
		}
	}
}

export default class DimensionalPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor('dimensional', (source, el, _ctx) => {
			renderDimensionalBlock(source, el);
		});

		this.registerView(
			DIMENSIONAL_PREVIEW_VIEW,
			(leaf) => new DimensionalPreviewView(leaf)
		);

		this.addCommand({
			id: 'open-unitor-preview',
			name: 'Open Unitor preview panel',
			callback: () => this.activatePreview(),
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	async activatePreview() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(DIMENSIONAL_PREVIEW_VIEW)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			leaf = right;
			await leaf.setViewState({ type: DIMENSIONAL_PREVIEW_VIEW, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
