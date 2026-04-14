/**
 * Library palette — the side panel that lists stored conversion
 * factors and provides add / import / export controls.
 *
 * This module is a straightforward renderer: `renderPalette` rebuilds
 * the panel's DOM from a `LibraryData` snapshot on every call. The app
 * layer owns the library state and re-renders the palette whenever
 * that state changes (after an add, delete, or import). Since the
 * panel is only one screen, a full DOM rebuild is cheap and keeps this
 * module stateless — no refs, no diffing.
 *
 * User actions bubble up through `PaletteCallbacks` so the app can
 * coordinate library mutations with the textarea pipeline (e.g.
 * inserting an entry re-uses the same cursor-splice helper that the
 * copy-card button uses).
 */

import type { LibraryData, LibraryEntry } from './library';

export interface PaletteCallbacks {
	/**
	 * Invoked when the user clicks an entry to insert it into the
	 * document. Receives a ready-to-splice snippet (label line then
	 * factor line) — same shape as the copy-card button emits, so the
	 * app's insertion helper can consume both uniformly.
	 */
	onInsert: (snippet: string) => void;
	/** Invoked when the user clicks an entry's delete button. */
	onDelete: (index: number) => void;
	/** Invoked when the user submits the add form with non-empty fields. */
	onAdd: (entry: LibraryEntry) => void;
	/** Invoked when the user clicks Export. */
	onExport: () => void;
	/** Invoked when the user clicks Import. */
	onImport: () => void;
}

/** Build the source snippet the app should insert for a palette entry. */
export function entrySnippet(entry: LibraryEntry): string {
	return `#${entry.label}\n${entry.source}`;
}

interface ElOpts {
	className?: string;
	text?: string;
	attrs?: Record<string, string>;
}

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

function child<K extends keyof HTMLElementTagNameMap>(
	parent: Element,
	tag: K,
	opts?: ElOpts
): HTMLElementTagNameMap[K] {
	const node = el(tag, opts);
	parent.appendChild(node);
	return node;
}

/** Build the "Library" header strip with Import/Export buttons. */
function renderHeader(host: Element, callbacks: PaletteCallbacks): void {
	const header = child(host, 'div', { className: 'library-header' });
	child(header, 'div', { className: 'library-title', text: 'Library' });
	const actions = child(header, 'div', { className: 'library-actions' });

	const importBtn = child(actions, 'button', {
		className: 'app-button',
		text: 'Import',
		attrs: { type: 'button', title: 'Import a library JSON file' },
	});
	importBtn.addEventListener('click', () => callbacks.onImport());

	const exportBtn = child(actions, 'button', {
		className: 'app-button',
		text: 'Export',
		attrs: { type: 'button', title: 'Download the current library as JSON' },
	});
	exportBtn.addEventListener('click', () => callbacks.onExport());
}

/** Build the "Add new…" form. On submit, fires `onAdd` with trimmed values. */
function renderAddForm(host: Element, callbacks: PaletteCallbacks): void {
	const form = child(host, 'form', { className: 'library-add-form' });
	form.setAttribute('autocomplete', 'off');

	const labelInput = child(form, 'input', {
		className: 'library-input',
		attrs: {
			type: 'text',
			placeholder: 'Label (e.g. mile to meter)',
			'aria-label': 'Label for the new factor',
		},
	});
	const sourceInput = child(form, 'input', {
		className: 'library-input library-input-mono',
		attrs: {
			type: 'text',
			placeholder: 'Factor (e.g. 1609 m / 1 mi)',
			'aria-label': 'Source text for the new factor',
		},
	});
	const addBtn = child(form, 'button', {
		className: 'app-button',
		text: 'Add',
		attrs: { type: 'submit' },
	});
	// Refuse to submit an empty pair; leave validation to the app in case
	// it wants to run parseLine before actually storing.
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const label = labelInput.value.trim();
		const source = sourceInput.value.trim();
		if (!label || !source) {
			// Lightly signal the empty field — focus the one they missed.
			(label ? sourceInput : labelInput).focus();
			return;
		}
		callbacks.onAdd({ label, source });
		// The app will re-render the palette, which wipes the form; nothing
		// to clear here. Keep `addBtn` in play to silence lint.
		void addBtn;
	});
}

/** Render the scrollable entries list. Shows an empty-state hint when empty. */
function renderList(
	host: Element,
	library: LibraryData,
	callbacks: PaletteCallbacks
): void {
	const list = child(host, 'div', { className: 'library-list' });

	if (library.entries.length === 0) {
		child(list, 'div', {
			className: 'library-empty',
			text:
				'No saved factors yet. Save a card with ☆ from the preview, ' +
				'or add one above. Import a JSON file to load a curated set.',
		});
		return;
	}

	library.entries.forEach((entry, i) => {
		const row = child(list, 'div', { className: 'library-entry' });

		// Clicking the row (label or source preview) inserts the snippet.
		// The delete button stops propagation so it doesn't also insert.
		const clickTarget = child(row, 'button', {
			className: 'library-entry-body',
			attrs: { type: 'button', title: 'Insert this factor at the cursor' },
		});
		child(clickTarget, 'div', {
			className: 'library-entry-label',
			text: entry.label,
		});
		child(clickTarget, 'div', {
			className: 'library-entry-source',
			text: entry.source,
		});
		// Don't steal focus from the textarea on mousedown (mirrors the
		// flip and copy buttons' behavior).
		clickTarget.addEventListener('mousedown', (e) => e.preventDefault());
		clickTarget.addEventListener('click', () => {
			callbacks.onInsert(entrySnippet(entry));
		});

		const deleteBtn = child(row, 'button', {
			className: 'library-entry-delete',
			text: '×',
			attrs: {
				type: 'button',
				title: 'Remove from library',
				'aria-label': `Remove ${entry.label}`,
			},
		});
		deleteBtn.addEventListener('mousedown', (e) => e.preventDefault());
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			callbacks.onDelete(i);
		});
	});
}

/**
 * Render the full library palette into `host`, replacing its previous
 * contents. Call again whenever `library` changes.
 */
export function renderPalette(
	host: HTMLElement,
	library: LibraryData,
	callbacks: PaletteCallbacks
): void {
	host.textContent = '';
	renderHeader(host, callbacks);
	renderAddForm(host, callbacks);
	renderList(host, library, callbacks);
}
