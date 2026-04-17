/**
 * Unitor web-app entry point.
 *
 * Persistence model: the URL is the sole source of truth for document
 * content. Source and library are deflate-compressed and base64url-
 * encoded into a single `?d=` query parameter; a `?doc` sentinel
 * marks the intentionally-empty-calculator case. Legacy URLs that
 * use the old `?lib=` + `#source` format are still decoded on boot
 * so previously-shared links keep working.
 * Every edit — typing, flipping, starring, palette add/delete/import —
 * writes the new state to the URL in place via `history.replaceState`.
 * localStorage never holds content, so there's no "accumulation"
 * pattern where a student's personal library leaks into a teacher-
 * shared link, and a teacher who pastes a link into any browser sees
 * exactly the state they captured.
 *
 * The obvious downside — close the tab and your unbookmarked work is
 * gone — is mitigated by a small localStorage-backed **recents** list
 * under `unitor:recents`. Each time the user makes a change we record
 * the current URL (throttled to once every two minutes while editing,
 * plus one write on `beforeunload` so a close always captures the
 * final state). The header's "Recent" button opens a dropdown of
 * those URLs, labelled from the document's first `#label` line, so a
 * closed tab can be restored in one click.
 *
 * The only other localStorage key is `unitor:library-open`, which
 * persists the UI preference for whether the side palette is open.
 *
 * Clicking a factor's flip button rewrites its source line in-place
 * via `flipLine` and then runs the same pipeline as typing. Clicking
 * a card's copy button inserts the card's source at the textarea
 * cursor. Clicking a card's star button toggles the factor in the
 * library. All of these end by calling `persistState()`, which
 * updates the URL and tentatively schedules a recents write.
 */

import { renderDocument, RenderCallbacks } from './render';
import { flipLine } from './parser';
import {
	LibraryData,
	addEntry,
	decodeLibraryFromUrl,
	emptyLibrary,
	exportLibrary,
	hasEntry,
	importLibrary,
	removeEntry,
	removeMatching,
} from './library';
import { encodeState, decodeState } from './compress';
import {
	MAX_RECENTS,
	RecentsData,
	addRecent,
	clearRecents,
	labelForUrl,
	loadRecents,
	relativeTime,
	saveRecents,
} from './recents';
import { PaletteCallbacks, renderPalette } from './palette';

const PANEL_OPEN_KEY = 'unitor:library-open';
const FLASH_DURATION_MS = 1500;
/** Minimum gap between auto-recorded recents while the user is typing. */
const RECENTS_THROTTLE_MS = 2 * 60 * 1000;

function $(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Missing element #${id}`);
	return el;
}

// ---------- legacy URL helpers (pre-compression format) ----------

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
 * Read the library embedded in the current URL's `?lib=` param. Used
 * only for legacy URL support — new URLs use `?d=` instead. Returns
 * `null` when the param is absent; returns an empty library when it's
 * present but malformed, so a corrupt URL can't brick the page.
 */
function decodeLibraryFromQuery(): LibraryData | null {
	const params = new URLSearchParams(location.search);
	const raw = params.get('lib');
	if (raw === null) return null;
	return decodeLibraryFromUrl(raw) ?? emptyLibrary();
}

/**
 * Does the URL carry any state? Exposed on the dev handle for
 * debugging. Recognises both the new compressed `?d=` format and the
 * legacy `?lib=` + `#source` format, plus the `?doc` empty sentinel.
 */
function urlHasState(): boolean {
	if (location.hash.length > 1) return true;
	const params = new URLSearchParams(location.search);
	return params.has('d') || params.has('lib') || params.has('doc');
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
}

/**
 * Resolve the initial state from the URL. Priority:
 *  1. `?d=` — new compressed format (deflate + base64url).
 *  2. `?lib=` + `#source` — legacy uncompressed format; kept so
 *     previously-shared links work forever.
 *  3. Bare URL — empty calculator.
 *
 * Tutorial pages are just separate URLs with a non-empty payload.
 */
function loadInitialState(): InitialState {
	const params = new URLSearchParams(location.search);

	// New compressed format.
	const d = params.get('d');
	if (d !== null) {
		const decoded = decodeState(d);
		if (decoded) return decoded;
		// Corrupt ?d= — fall through to legacy / empty.
	}

	// Legacy uncompressed format.
	const hasLegacy =
		location.hash.length > 1 || params.has('lib') || params.has('doc');
	if (hasLegacy) {
		return {
			source: decodeHash() ?? '',
			library: decodeLibraryFromQuery() ?? emptyLibrary(),
		};
	}

	// Bare URL — empty calculator.
	return { source: '', library: emptyLibrary() };
}

/**
 * Replace the current URL with one encoding the given source and
 * library. Uses the compressed `?d=` format which is typically 3–4×
 * shorter than the legacy percent-encoded representation.
 *
 * If source AND library are both empty, emits a `?doc` sentinel so a
 * shared "blank calculator" link stays blank on reload instead of
 * reverting to the default (bare URL = empty calculator).
 *
 * Swallows errors from exotic hosts or over-long URLs: a failed URL
 * write is non-fatal because in-memory state survives for the tab's
 * lifetime.
 */
function updateUrl(source: string, library: LibraryData): void {
	const encoded = encodeState(source, library);

	let target: string;
	if (encoded !== null) {
		// Normal case: source and/or library are non-empty.
		target = location.pathname + '?d=' + encoded;
	} else {
		// Fully empty state — use the sentinel.
		target = location.pathname + '?doc';
	}

	const current = location.pathname + location.search + location.hash;
	if (current === target) return;
	try {
		history.replaceState(null, '', target);
	} catch {
		// ignore — in-memory state still drives the live session
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

/**
 * Synchronous clipboard copy via the legacy `document.execCommand`
 * API. Used as a fallback when `navigator.clipboard.writeText` is
 * unavailable or rejects — the most common failure mode is Unitor
 * being embedded in a Canvas iframe that doesn't grant
 * `clipboard-write` via Permissions Policy, which silently denies
 * the modern API. `execCommand('copy')` is deprecated but isn't
 * gated by the same policy and still works in sandboxed iframes as
 * long as it runs in response to a user gesture.
 *
 * Implementation: drop a 1px offscreen textarea with the URL,
 * select it, fire `execCommand`, tear the textarea down. Returns
 * whether the copy succeeded.
 */
function copyViaExecCommand(text: string): boolean {
	const ta = document.createElement('textarea');
	ta.value = text;
	// Keep the textarea visible enough for the browser to consider it
	// selectable, but positioned and sized so it never flashes visibly.
	ta.setAttribute('readonly', '');
	ta.style.position = 'fixed';
	ta.style.top = '0';
	ta.style.left = '0';
	ta.style.width = '1px';
	ta.style.height = '1px';
	ta.style.opacity = '0';
	ta.style.pointerEvents = 'none';
	document.body.appendChild(ta);

	// Preserve the caller's selection/focus — the textarea steals focus
	// while selected, which we restore after the copy.
	const previousActive = document.activeElement as HTMLElement | null;
	ta.focus();
	ta.select();
	ta.setSelectionRange(0, text.length);

	let ok = false;
	try {
		ok = document.execCommand('copy');
	} catch {
		ok = false;
	}
	document.body.removeChild(ta);
	previousActive?.focus?.();
	return ok;
}

async function copyShareLink(btn: HTMLButtonElement): Promise<void> {
	const url = location.href;
	// Try the modern async API first. In a cross-origin iframe without
	// `clipboard-write` in its Permissions Policy — e.g. a Canvas LTI
	// embed — this rejects; we fall through to execCommand, which
	// isn't gated by the policy.
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(url);
			flashButton(btn, 'Copied!');
			return;
		} catch {
			// fall through to the legacy fallback
		}
	}
	if (copyViaExecCommand(url)) {
		flashButton(btn, 'Copied!');
		return;
	}
	flashButton(btn, 'Copy failed — use address bar');
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
	const openNewTabLink = $('open-new-tab') as HTMLAnchorElement;
	const libraryBtn = $('library-toggle') as HTMLButtonElement;
	const libraryPanel = $('library-panel');
	const recentsBtn = $('recents-toggle') as HTMLButtonElement;
	const recentsPanel = $('recents-panel');
	const menuToggle = $('menu-toggle') as HTMLButtonElement;
	const headerActions = $('header-actions');
	const workspace = document.querySelector('main.workspace') as HTMLElement;
	const fileInput = $('library-file-input') as HTMLInputElement;

	const initial = loadInitialState();
	// In-memory mirror of the library. All mutations produce a new value
	// (`addEntry`/`removeEntry` are pure), which we then persist and
	// re-render.
	let library: LibraryData = initial.library;

	// Recents bookkeeping. We only start recording after the user makes
	// their first edit in this session — otherwise a student who opens a
	// teacher link and doesn't touch it would still push that link onto
	// their recents, crowding out genuinely-theirs work. Throttle keeps
	// per-keystroke persistence from flooding localStorage; the
	// `beforeunload` handler below catches the final state so a close
	// always lands in recents.
	let recents: RecentsData = loadRecents();
	let hasEdited = false;
	let lastRecentSave = 0;

	/** Write the current URL into the recents list now. */
	function recordRecent(): void {
		const url = location.pathname + location.search + location.hash;
		const now = Date.now();
		recents = addRecent(recents, url, now);
		saveRecents(recents);
		lastRecentSave = now;
	}

	/** Record into recents iff the user has edited and enough time has passed. */
	function maybeRecordRecent(): void {
		if (!hasEdited) return;
		const now = Date.now();
		if (now - lastRecentSave < RECENTS_THROTTLE_MS) return;
		recordRecent();
	}

	/**
	 * Single write-through step. Always updates the URL so "Copy share
	 * link" is accurate at any moment; the throttled recents write is
	 * what provides crash-recovery for unsaved work.
	 */
	function persistState(): void {
		updateUrl(textarea.value, library);
		// Keep the "Open in new tab" anchor's href in sync with the live
		// URL so left-clicks, middle-clicks, and cmd-clicks all open the
		// student's current state. Middle-click doesn't fire a `click`
		// event, so a JS-only handler wouldn't catch it — we rely on the
		// real `href` attribute instead.
		openNewTabLink.href = location.href;
		maybeRecordRecent();
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
		hasEdited = true;
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
		hasEdited = true;
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
		hasEdited = true;
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

	// Recents dropdown. Rendered on demand from the current recents
	// snapshot so it always reflects the latest saves (including the one
	// the current session just pushed). Each row is a link to the stored
	// URL; clicking navigates the tab, which triggers a full boot on the
	// target state.
	function renderRecentsPanel(): void {
		recentsPanel.innerHTML = '';
		const now = Date.now();

		const header = document.createElement('div');
		header.className = 'recents-header';
		const title = document.createElement('span');
		title.className = 'recents-title';
		title.textContent = 'Recent';
		header.appendChild(title);
		if (recents.entries.length > 0) {
			const clearBtn = document.createElement('button');
			clearBtn.type = 'button';
			clearBtn.className = 'recents-clear';
			clearBtn.textContent = 'Clear';
			clearBtn.title = 'Remove all recent URLs from this browser';
			clearBtn.addEventListener('click', () => {
				if (!window.confirm('Clear all recent URLs?')) return;
				recents = clearRecents();
				saveRecents(recents);
				renderRecentsPanel();
			});
			header.appendChild(clearBtn);
		}
		recentsPanel.appendChild(header);

		if (recents.entries.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'recents-empty';
			empty.textContent =
				'No recent URLs yet. Once you edit something here, a snapshot will appear so you can recover it later.';
			recentsPanel.appendChild(empty);
			return;
		}

		const list = document.createElement('ul');
		list.className = 'recents-list';
		for (const entry of recents.entries) {
			const li = document.createElement('li');
			li.className = 'recents-entry';
			const a = document.createElement('a');
			a.className = 'recents-link';
			a.href = entry.url;

			const label = document.createElement('span');
			label.className = 'recents-label';
			label.textContent = labelForUrl(entry.url);

			const when = document.createElement('span');
			when.className = 'recents-when';
			when.textContent = relativeTime(entry.savedAt, now);

			a.appendChild(label);
			a.appendChild(when);
			li.appendChild(a);
			list.appendChild(li);
		}
		recentsPanel.appendChild(list);
	}

	function setRecentsOpen(open: boolean): void {
		recentsPanel.hidden = !open;
		recentsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
		if (open) renderRecentsPanel();
	}

	recentsBtn.addEventListener('click', () => {
		setRecentsOpen(recentsPanel.hidden);
	});

	// Close the recents dropdown on outside-click so it behaves like a
	// normal menu without needing a backdrop element.
	document.addEventListener('click', (ev) => {
		if (recentsPanel.hidden) return;
		const target = ev.target as Node | null;
		if (target && (recentsPanel.contains(target) || recentsBtn.contains(target))) {
			return;
		}
		setRecentsOpen(false);
	});
	document.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape' && !recentsPanel.hidden) {
			setRecentsOpen(false);
			recentsBtn.focus();
		}
		if (ev.key === 'Escape' && headerActions.classList.contains('menu-open')) {
			setMenuOpen(false);
		}
	});

	// Mobile three-dots menu. Opens/closes the header actions as a
	// dropdown on narrow screens. On wide screens the toggle button is
	// hidden by CSS and the actions are always visible.
	function setMenuOpen(open: boolean): void {
		headerActions.classList.toggle('menu-open', open);
		menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
	}

	menuToggle.addEventListener('click', () => {
		setMenuOpen(!headerActions.classList.contains('menu-open'));
	});

	document.addEventListener('click', (ev) => {
		if (!headerActions.classList.contains('menu-open')) return;
		const target = ev.target as Node | null;
		if (target && (headerActions.contains(target) || menuToggle.contains(target))) {
			return;
		}
		setMenuOpen(false);
	});

	textarea.value = initial.source;
	render(initial.source);
	rerenderPalette();
	setPanelOpen(readPanelOpen());
	// Normalize the URL on load. If we arrived with partial state, the
	// URL will now reflect the full resolved state. This does NOT count
	// as an edit, so nothing hits recents yet.
	updateUrl(textarea.value, library);
	// Seed the "Open in new tab" anchor so it's clickable before the
	// user makes any edits. persistState keeps it in sync afterward.
	openNewTabLink.href = location.href;

	textarea.addEventListener('input', () => {
		hasEdited = true;
		persistState();
		render(textarea.value);
	});

	shareBtn.addEventListener('click', () => {
		void copyShareLink(shareBtn);
	});

	// External hash changes. New compressed URLs don't use the hash, but
	// a user who pastes a legacy `#source` URL into the address bar of
	// the same tab will fire hashchange, so we keep this handler for
	// backward compat. history.replaceState does not trigger hashchange,
	// so this only fires for genuinely external edits.
	window.addEventListener('hashchange', () => {
		const source = decodeHash();
		if (source === null) return;
		if (source === textarea.value) return;
		textarea.value = source;
		render(source);
		// The user-facing URL just changed out from under us; keep the
		// open-in-new-tab anchor pointed at it.
		openNewTabLink.href = location.href;
	});

	// Final safety net for crash recovery. If the user has made edits but
	// the throttle hasn't fired yet, `beforeunload` forces one last
	// recents write so closing the tab right after typing doesn't lose
	// the work. Wrapped in a try/catch because some browsers restrict
	// what's allowed during unload.
	window.addEventListener('beforeunload', () => {
		if (!hasEdited) return;
		try {
			recordRecent();
		} catch {
			// ignore — best-effort; the most recent throttled save is still there
		}
	});

	// Dev handle: live getters for the runtime state so you can inspect
	// `unitor.library`, `unitor.recents`, etc. from the browser console
	// without setting breakpoints. Each property reads the current
	// closure variable on access, so it stays accurate as the user
	// types / saves / imports. Cheap, harmless (no server, no
	// privileged actions), and useful for diagnosing reports like "the
	// wrong library loaded" or "my recents disappeared".
	(window as unknown as { unitor: unknown }).unitor = {
		get library() { return library; },
		get source() { return textarea.value; },
		get recents() { return recents; },
		get hasEdited() { return hasEdited; },
		urlHasState,
		MAX_RECENTS,
	};
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot);
} else {
	boot();
}
