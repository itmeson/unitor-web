/**
 * Unitor web-app entry point.
 *
 * The pipeline is:
 *
 *   textarea input
 *     → localStorage.setItem(STORAGE_KEY, source)       (persist)
 *     → history.replaceState(..., "#<encoded source>")  (permalink)
 *     → renderDocument(source, preview)                 (render)
 *
 * On load, the initial source is chosen in this priority order:
 *   1. URL hash (so a shared link always wins)
 *   2. localStorage (returning visitors restore their last session)
 *   3. a small default block
 *
 * The "Copy share link" button copies location.href (which always
 * reflects the current source thanks to the live hash update) to the
 * clipboard with a brief "Copied!" flash. If the clipboard API isn't
 * available (insecure context, old browser), the button shows a
 * fallback message — the URL is already in the address bar either way.
 *
 * A hashchange listener keeps the textarea+preview in sync when the
 * hash is mutated *externally* (user edits the address bar, another
 * tab navigates here, back/forward button). Our own history.replaceState
 * does NOT fire hashchange, so no guard against self-triggered events
 * is needed.
 *
 * Clicking a factor's flip button rewrites its source line in-place via
 * `flipLine` and then runs the same pipeline as typing, so flips are
 * reflected in the textarea, localStorage, URL hash, and preview.
 *
 * Clicking a card's copy button (⧉) inserts the card's source at the
 * textarea cursor. The render module pre-builds the snippet (including
 * any `#label` line), so the app layer only has to splice it into the
 * textarea on its own line and then run the same persist pipeline as
 * typing. Copy buttons on result cards synthesize a factor line from
 * the rounded value and residual units.
 *
 * Clicking a factor card's star button (☆/★) toggles a library entry
 * for that card. Unlabeled cards trigger a prompt for a label before
 * saving. The library lives in localStorage via `src/library.ts`; the
 * side palette (`src/palette.ts`) renders it and surfaces add/insert/
 * delete/import/export controls.
 */

import { renderDocument, RenderCallbacks } from './render';
import { flipLine } from './parser';
import {
	LibraryData,
	addEntry,
	emptyLibrary,
	exportLibrary,
	hasEntry,
	importLibrary,
	loadLibrary,
	removeEntry,
	removeMatching,
	saveLibrary,
} from './library';
import { PaletteCallbacks, renderPalette } from './palette';

const STORAGE_KEY = 'unitor:block';
const PANEL_OPEN_KEY = 'unitor:library-open';
const FLASH_DURATION_MS = 1500;

const DEFAULT_BLOCK = [
	'#speed in miles per hour',
	'30 mile/hr',
	'1609 meters / 1 mile',
	'1 hr / 60 min',
	'1 min / 60 sec',
	'#speed in meters per sec',
].join('\n');

function $(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Missing element #${id}`);
	return el;
}

/** Decode the current location.hash to a source string, or null if absent/malformed. */
function decodeHash(): string | null {
	if (location.hash.length <= 1) return null;
	try {
		return decodeURIComponent(location.hash.slice(1));
	} catch {
		return null;
	}
}

/** Read from localStorage, tolerating private-mode restrictions that can throw. */
function readStorage(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeStorage(source: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, source);
	} catch {
		// Private mode, quota exceeded, or disabled storage — non-fatal.
	}
}

/** Remember whether the library panel was open across reloads. Failures are non-fatal. */
function readPanelOpen(): boolean {
	try {
		return localStorage.getItem(PANEL_OPEN_KEY) === '1';
	} catch {
		return false;
	}
}

function writePanelOpen(open: boolean): void {
	try {
		localStorage.setItem(PANEL_OPEN_KEY, open ? '1' : '0');
	} catch {
		// ignore
	}
}

function loadInitialSource(): string {
	// URL hash wins over localStorage so shared links override the saved session.
	const fromHash = decodeHash();
	if (fromHash !== null) return fromHash;
	const stored = readStorage();
	if (stored !== null) return stored;
	return DEFAULT_BLOCK;
}

/**
 * Replace the current URL hash with the encoded source, without
 * pushing a new history entry. Swallows errors from exotic hosts (some
 * browsers throw on certain `about:`/`file:` URLs) and from sources
 * too long for the browser's URL limit; a failed hash write is
 * non-fatal because localStorage still holds the source.
 */
function updateUrlHash(source: string): void {
	const encoded = encodeURIComponent(source);
	const newHash = '#' + encoded;
	if (location.hash === newHash) return;
	try {
		history.replaceState(null, '', newHash);
	} catch {
		// ignore — the source is still persisted in localStorage
	}
}

/**
 * Temporarily swap a button's label for user feedback. Uses
 * `data-default-label` as the source of truth for the pre-flash text
 * so rapid repeat clicks don't latch in the flashed state.
 */
function flashButton(btn: HTMLButtonElement, message: string): void {
	const defaultLabel = btn.dataset['defaultLabel'] ?? btn.textContent ?? '';
	btn.textContent = message;
	btn.classList.add('is-flashing');
	window.setTimeout(() => {
		btn.textContent = defaultLabel;
		btn.classList.remove('is-flashing');
	}, FLASH_DURATION_MS);
}

async function copyShareLink(btn: HTMLButtonElement): Promise<void> {
	const url = location.href;
	if (!navigator.clipboard?.writeText) {
		flashButton(btn, 'Copy unsupported — use address bar');
		return;
	}
	try {
		await navigator.clipboard.writeText(url);
		flashButton(btn, 'Copied!');
	} catch {
		flashButton(btn, 'Copy failed — use address bar');
	}
}

/**
 * Trigger a browser download for `content` under `filename`. Uses a
 * transient object URL + anchor click; revokes the URL asynchronously
 * so the download actually starts before the blob goes away.
 */
function downloadJson(filename: string, content: string): void {
	const blob = new Blob([content], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function boot(): void {
	const textarea = $('source') as HTMLTextAreaElement;
	const preview = $('preview');
	const shareBtn = $('share-link') as HTMLButtonElement;
	const libraryBtn = $('library-toggle') as HTMLButtonElement;
	const libraryPanel = $('library-panel');
	const workspace = document.querySelector('main.workspace') as HTMLElement;
	const fileInput = $('library-file-input') as HTMLInputElement;

	// In-memory mirror of the library. All mutations produce a new value
	// (`addEntry`/`removeEntry` are pure), which we then persist and
	// re-render. We treat the library as non-fatal: if loading throws,
	// we start empty.
	let library: LibraryData;
	try {
		library = loadLibrary();
	} catch {
		library = emptyLibrary();
	}

	/**
	 * Insert a snippet at the textarea cursor, ensuring it lands on its
	 * own line. Shared by card copy-buttons and by palette clicks so both
	 * paths produce identical results.
	 */
	function insertAtCursor(snippet: string): void {
		const value = textarea.value;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const before = value.slice(0, start);
		const after = value.slice(end);

		const needsNewlineBefore = before.length > 0 && !before.endsWith('\n');
		const needsNewlineAfter = after.length > 0 && !after.startsWith('\n');
		const prefix = needsNewlineBefore ? '\n' : '';
		const suffix = needsNewlineAfter ? '\n' : '';
		const toInsert = prefix + snippet + suffix;

		const updated = before + toInsert + after;
		const newCursor = start + prefix.length + snippet.length;

		textarea.value = updated;
		textarea.focus();
		textarea.setSelectionRange(newCursor, newCursor);
		writeStorage(updated);
		updateUrlHash(updated);
		render(updated);
	}

	// Re-render with the flip, copy, and save callbacks wired in, so
	// every render produces interactive buttons that stay in sync with
	// the current library.
	function render(source: string): void {
		const callbacks: RenderCallbacks = {
			onFlip: handleFlip,
			onCopy: insertAtCursor,
			onSave: handleSave,
			isSaved: (rawLine, label) =>
				label !== undefined && hasEntry(library, label, rawLine),
		};
		renderDocument(source, preview, callbacks);
	}

	/** Rebuild the side palette from the current library snapshot. */
	function rerenderPalette(): void {
		renderPalette(libraryPanel, library, paletteCallbacks);
	}

	/** Persist + re-render both panes after any library mutation. */
	function afterLibraryChange(): void {
		saveLibrary(library);
		rerenderPalette();
		// The preview's star glyphs depend on library membership, so
		// re-render it too.
		render(textarea.value);
	}

	// Flipping a factor rewrites the corresponding source line in the
	// textarea, then runs the full input pipeline (persist, update hash,
	// re-render) so the flipped state becomes the new shared state. The
	// `sourceLine` index is 0-based within the block (matches the parser's
	// 0-based line numbers).
	function handleFlip(sourceLine: number): void {
		const lines = textarea.value.split('\n');
		if (sourceLine < 0 || sourceLine >= lines.length) return;
		const original = lines[sourceLine] ?? '';
		lines[sourceLine] = flipLine(original);
		const updated = lines.join('\n');
		textarea.value = updated;
		writeStorage(updated);
		updateUrlHash(updated);
		render(updated);
	}

	/**
	 * Save (or un-save) a factor card. The library keys on
	 * (label, source), so:
	 *  - a labeled card toggles: if already saved, remove; else add.
	 *  - an unlabeled card always prompts for a label and adds. We don't
	 *    offer a remove path for unlabeled cards because they can't be
	 *    found without a label to match on.
	 */
	function handleSave(rawLine: string, label: string | undefined): void {
		const source = rawLine.trim();
		if (label && hasEntry(library, label, source)) {
			library = removeMatching(library, label, source);
			afterLibraryChange();
			return;
		}
		let finalLabel = label;
		if (!finalLabel) {
			const entered = window.prompt(
				'Label for this factor (shown in the library palette):',
				''
			);
			if (entered === null) return; // user cancelled
			const trimmed = entered.trim();
			if (!trimmed) return; // empty label — silently bail
			finalLabel = trimmed;
		}
		library = addEntry(library, { label: finalLabel, source });
		afterLibraryChange();
	}

	// Palette callbacks: palette clicks insert at the cursor (same pipe
	// as card copy-buttons); add/delete/import/export mutate the library
	// and re-render.
	const paletteCallbacks: PaletteCallbacks = {
		onInsert: insertAtCursor,
		onDelete: (index) => {
			library = removeEntry(library, index);
			afterLibraryChange();
		},
		onAdd: (entry) => {
			library = addEntry(library, entry);
			afterLibraryChange();
		},
		onExport: () => {
			downloadJson('unitor-library.json', exportLibrary(library));
		},
		onImport: () => {
			// Reset the value so selecting the same file twice in a row
			// still fires `change`.
			fileInput.value = '';
			fileInput.click();
		},
	};

	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			const text = typeof reader.result === 'string' ? reader.result : '';
			try {
				const summary = importLibrary(library, text);
				library = summary.library;
				afterLibraryChange();
				const msg =
					`Imported ${summary.added} new ` +
					`${summary.added === 1 ? 'entry' : 'entries'}` +
					(summary.skipped > 0
						? ` (${summary.skipped} duplicate${
								summary.skipped === 1 ? '' : 's'
							} skipped).`
						: '.');
				window.alert(msg);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				window.alert(`Import failed: ${msg}`);
			}
		};
		reader.onerror = () => {
			window.alert('Could not read the selected file.');
		};
		reader.readAsText(file);
	});

	// Library panel visibility. We toggle a class on the workspace grid
	// so CSS can widen to three columns; we also track the state in
	// localStorage so the panel's "open" choice survives reloads.
	function setPanelOpen(open: boolean): void {
		workspace.classList.toggle('library-open', open);
		libraryPanel.hidden = !open;
		libraryBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
		libraryBtn.textContent = open ? 'Hide library' : 'Show library';
		writePanelOpen(open);
	}

	libraryBtn.addEventListener('click', () => {
		const next = libraryPanel.hidden;
		setPanelOpen(next);
	});

	const initial = loadInitialSource();
	textarea.value = initial;
	render(initial);
	rerenderPalette();
	setPanelOpen(readPanelOpen());
	// Normalize the hash on load: if we arrived without one (or with a
	// malformed one) we set it so refreshing round-trips; if we arrived
	// with a valid hash already, updateUrlHash bails out early.
	updateUrlHash(initial);

	textarea.addEventListener('input', () => {
		const source = textarea.value;
		writeStorage(source);
		updateUrlHash(source);
		render(source);
	});

	shareBtn.addEventListener('click', () => {
		void copyShareLink(shareBtn);
	});

	// External hash changes (address-bar edits, back/forward, paste-and-go
	// in the same tab). history.replaceState does not trigger hashchange
	// so this only fires for genuinely external edits.
	window.addEventListener('hashchange', () => {
		const source = decodeHash();
		if (source === null) return;
		if (source === textarea.value) return;
		textarea.value = source;
		render(source);
		// Intentionally NOT writing to localStorage here: if the user
		// navigated to a shared link without editing, we don't want to
		// clobber their saved session. The first keystroke they make
		// will persist normally.
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot);
} else {
	boot();
}
