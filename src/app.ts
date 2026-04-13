/**
 * Unitor web-app entry point.
 *
 * Steps 1–5 complete. The pipeline is:
 *
 *   textarea input
 *     → localStorage.setItem(STORAGE_KEY, source)       (persist)
 *     → history.replaceState(..., "#<encoded source>")  (permalink)
 *     → renderDimensionalBlock(source, preview)         (render)
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
 */

import { renderDimensionalBlock } from './render';
import { flipLine } from './parser';

const STORAGE_KEY = 'unitor:block';
const FLASH_DURATION_MS = 1500;

const DEFAULT_BLOCK = [
	'# surface area of Earth',
	'`4*pi*6.4^2` m^2',
	'',
	'5 km',
	'1 hr / 3600 s',
	'# speed in km/s',
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

	// Re-render with the flip callback wired in, so every render produces
	// interactive flip buttons.
	function render(source: string): void {
		renderDimensionalBlock(source, preview, handleFlip);
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
