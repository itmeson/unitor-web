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
 */

import { renderDocument } from './render';
import { flipLine } from './parser';

const STORAGE_KEY = 'unitor:block';
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

function boot(): void {
	const textarea = $('source') as HTMLTextAreaElement;
	const preview = $('preview');
	const shareBtn = $('share-link') as HTMLButtonElement;

	// Re-render with the flip and copy callbacks wired in, so every
	// render produces interactive flip and copy buttons.
	function render(source: string): void {
		renderDocument(source, preview, handleFlip, handleCopy);
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
	 * Insert a card's source snippet at the textarea cursor, ensuring it
	 * lands on its own line. We add a leading newline if there is
	 * non-newline content immediately before the cursor, and a trailing
	 * newline if non-newline content follows, so the snippet never glues
	 * onto an adjacent line. Any existing selection is replaced. After
	 * insertion the cursor sits at the end of the inserted snippet.
	 */
	function handleCopy(snippet: string): void {
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

	const initial = loadInitialSource();
	textarea.value = initial;
	render(initial);
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
