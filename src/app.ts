/**
 * Unitor web-app entry point.
 *
 * Two persistence modes, decided once at boot by looking at the
 * incoming URL:
 *
 *  - **Document mode**: the URL is non-empty — a `#source` fragment,
 *    a `?lib=…` query, or both. The URL is the canonical state, and
 *    all subsequent edits update the URL in place via
 *    `history.replaceState`. localStorage is deliberately NOT
 *    touched in this mode. This is what makes teacher-shared links
 *    deterministic: every student who opens the link sees exactly
 *    the state the teacher captured, regardless of their own prior
 *    Unitor history, and nothing they do here leaks into their
 *    personal localStorage library.
 *
 *  - **Personal mode**: the URL has no state (plain bookmark, no
 *    query, no hash). Source comes from the localStorage draft and
 *    library comes from the localStorage-backed store. Edits update
 *    both the URL (so "Copy share link" is accurate at any moment)
 *    and localStorage (so returning visitors resume where they left
 *    off). This is the single-user workspace pattern.
 *
 * In both modes the URL always reflects the current state, so the
 * "Copy share link" button does the same thing either way: shares
 * the current source+library together.
 *
 * On boot, the initial source is chosen in this priority order:
 *   1. URL hash (any teacher-shared or self-shared link)          — document mode
 *   2. `?lib=` present but no hash                                — document mode, empty source
 *   3. localStorage draft (returning personal visitor)            — personal mode
 *   4. a small default block (first-ever visit)                   — personal mode
 *
 * The library follows the same priority: `?lib=` wins if present,
 * otherwise localStorage, otherwise empty.
 *
 * Clicking a factor's flip button rewrites its source line in-place
 * via `flipLine` and then runs the same pipeline as typing. Clicking
 * a card's copy button inserts the card's source at the textarea
 * cursor. Clicking a card's star button toggles the factor in the
 * library. All of these end by calling `persistState()`, which
 * writes to the URL and (in personal mode only) localStorage.
 */

import { renderDocument, RenderCallbacks } from './render';
import { flipLine } from './parser';
import {
	LibraryData,
	addEntry,
	decodeLibraryFromUrl,
	emptyLibrary,
	encodeLibraryForUrl,
	exportLibrary,
	hasEntry,
	importLibrary,
	loadLibrary,
	removeEntry,
	removeMatching,
	saveLibrary,
} from './library';
import { PaletteCallbacks, renderPalette } from './palette';

const SOURCE_STORAGE_KEY = 'unitor:block';
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

/**
 * Read the library embedded in the current URL, if any. `null` means
 * no `?lib=` param was supplied; an empty library means the param was
 * present but malformed (we swallow the error so a corrupt URL can't
 * brick the page).
 */
function decodeLibraryFromQuery(): LibraryData | null {
	const params = new URLSearchParams(location.search);
	const raw = params.get('lib');
	if (raw === null) return null;
	return decodeLibraryFromUrl(raw) ?? emptyLibrary();
}

/**
 * Does the URL carry any state? This is the sole signal that picks
 * document mode over personal mode, and it's fixed at boot time —
 * mode doesn't flip mid-session even as the URL updates in place.
 *
 * Three signals can trigger document mode:
 *  - a non-empty `#source` fragment (length > 1 because a bare `#` is
 *    often stripped by browsers during copy/paste and is unreliable);
 *  - a `?lib=…` query with an embedded library;
 *  - a `?doc` sentinel — used when a teacher captures an intentionally
 *    empty calculator (no source, no library) and needs the shared
 *    URL to stay document-mode on reload, not fall back to the
 *    student's localStorage.
 */
function urlHasState(): boolean {
	if (location.hash.length > 1) return true;
	const params = new URLSearchParams(location.search);
	return params.has('lib') || params.has('doc');
}

/** Read from localStorage, tolerating private-mode restrictions that can throw. */
function readSourceStorage(): string | null {
	try {
		return localStorage.getItem(SOURCE_STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeSourceStorage(source: string): void {
	try {
		localStorage.setItem(SOURCE_STORAGE_KEY, source);
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

interface InitialState {
	source: string;
	library: LibraryData;
	/** True if state was loaded from the URL → document mode. */
	fromUrl: boolean;
}

function loadInitialState(): InitialState {
	if (urlHasState()) {
		// Document mode. Missing hash means "start with empty source" —
		// a teacher who set up a library-only link expects students to
		// start from a blank textarea, not the default demo block.
		return {
			source: decodeHash() ?? '',
			library: decodeLibraryFromQuery() ?? emptyLibrary(),
			fromUrl: true,
		};
	}
	// Personal mode. Fall back through localStorage to the default demo.
	const stored = readSourceStorage();
	return {
		source: stored ?? DEFAULT_BLOCK,
		library: loadLibrary(),
		fromUrl: false,
	};
}

/**
 * Replace the current URL with one encoding the given source and
 * library. Always called regardless of mode so "Copy share link"
 * reflects current state. The query param is omitted entirely when
 * the library is empty, so a blank personal-mode session doesn't
 * carry a dangling `?lib=%7B…%7D` in the address bar.
 *
 * `documentMode` matters only for the edge case of a fully empty
 * document — no source AND no library. Without a signal the reload
 * would drop back to personal mode and pull in the student's
 * localStorage, ruining the "empty calculator" assignment. In that
 * case only, we emit a `?doc` sentinel so the URL stays document-
 * mode. Personal-mode sessions with empty content (e.g. a first
 * visit before the default block has been typed into) get a clean
 * URL without the sentinel.
 *
 * Swallows errors from exotic hosts or over-long URLs: a failed URL
 * write is non-fatal because personal mode still has localStorage and
 * document mode still has in-memory state for the tab's lifetime.
 */
function updateUrl(
	source: string,
	library: LibraryData,
	documentMode: boolean
): void {
	const libPresent = library.entries.length > 0;
	const sourcePresent = source.length > 0;
	const needsSentinel = documentMode && !libPresent && !sourcePresent;

	const params = new URLSearchParams();
	if (libPresent) params.set('lib', encodeLibraryForUrl(library));
	if (needsSentinel) params.set('doc', '');

	let target = location.pathname;
	const qs = params.toString();
	if (qs.length > 0) target += '?' + qs;
	target += '#' + encodeURIComponent(source);

	const current = location.pathname + location.search + location.hash;
	if (current === target) return;
	try {
		history.replaceState(null, '', target);
	} catch {
		// ignore — in-memory state and (personal mode) localStorage survive
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

	const initial = loadInitialState();
	// In-memory mirror of the library. All mutations produce a new value
	// (`addEntry`/`removeEntry` are pure), which we then persist and
	// re-render.
	let library: LibraryData = initial.library;
	// `fromUrl` is captured at boot and does NOT change even as the URL
	// updates in place. This keeps the persistence rule stable for the
	// session: document-mode sessions never write to localStorage,
	// personal-mode sessions always do.
	const documentMode = initial.fromUrl;

	/**
	 * Single write-through step. Always updates the URL so "Copy share
	 * link" is accurate at any moment; updates localStorage only in
	 * personal mode so document-mode sessions stay leak-free.
	 */
	function persistState(): void {
		updateUrl(textarea.value, library, documentMode);
		if (!documentMode) {
			writeSourceStorage(textarea.value);
			saveLibrary(library);
		}
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
		persistState();
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
		persistState();
		rerenderPalette();
		// The preview's star glyphs depend on library membership.
		render(textarea.value);
	}

	// Flipping a factor rewrites the corresponding source line in the
	// textarea, then runs the full input pipeline (persist, re-render)
	// so the flipped state becomes the new shared state. The
	// `sourceLine` index is 0-based within the block (matches the parser's
	// 0-based line numbers).
	function handleFlip(sourceLine: number): void {
		const lines = textarea.value.split('\n');
		if (sourceLine < 0 || sourceLine >= lines.length) return;
		const original = lines[sourceLine] ?? '';
		lines[sourceLine] = flipLine(original);
		const updated = lines.join('\n');
		textarea.value = updated;
		persistState();
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
	// (Panel-open state is a UI preference, not document state, so it
	// persists regardless of mode.)
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

	textarea.value = initial.source;
	render(initial.source);
	rerenderPalette();
	setPanelOpen(readPanelOpen());
	// Normalize the URL on load. If we arrived with partial state, the
	// URL will now reflect the full resolved state.
	persistState();

	textarea.addEventListener('input', () => {
		persistState();
		render(textarea.value);
	});

	shareBtn.addEventListener('click', () => {
		void copyShareLink(shareBtn);
	});

	// External hash changes (address-bar edits, back/forward, paste-and-go
	// in the same tab). history.replaceState does not trigger hashchange
	// so this only fires for genuinely external edits. We re-sync the
	// textarea and preview to the new hash; we don't touch localStorage,
	// matching document-mode semantics even in personal mode (an external
	// paste isn't an edit the user wants saved to their draft).
	//
	// We intentionally do NOT re-read `?lib=` here: hashchange doesn't
	// fire on query-only changes, and a teacher link opened in a fresh
	// tab goes through boot() which handles both. Mixing the two would
	// surprise users by blowing away in-session library mutations when
	// they tweak the hash externally.
	window.addEventListener('hashchange', () => {
		const source = decodeHash();
		if (source === null) return;
		if (source === textarea.value) return;
		textarea.value = source;
		render(source);
	});

	// Dev handle: live getters for the runtime state so you can inspect
	// `unitor.documentMode`, `unitor.library`, etc. from the browser
	// console without setting breakpoints. Each property reads the
	// current closure variable on access, so it stays accurate as the
	// user types / saves / imports. Cheap, harmless (no server, no
	// privileged actions), and useful for diagnosing teacher/student
	// reports like "the wrong library loaded".
	(window as unknown as { unitor: unknown }).unitor = {
		get documentMode() { return documentMode; },
		get library() { return library; },
		get source() { return textarea.value; },
		urlHasState,
	};
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot);
} else {
	boot();
}
