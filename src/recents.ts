/**
 * Recently-visited Unitor URLs — a bounded, localStorage-backed list
 * that lets the user recover state they didn't explicitly save.
 *
 * Design context: Unitor treats the URL as the sole source of truth
 * for document content (source + library). localStorage intentionally
 * does NOT hold content, so a student who closes a tab without
 * bookmarking or copying the share link would otherwise lose their
 * work. This module is the recovery affordance: we track a small
 * list of recently-live URLs and let the user navigate back to any of
 * them from a header dropdown.
 *
 * On-disk shape mirrors the library's for the same reasons — a
 * versioned envelope lets future migrations be additive:
 *
 *   {
 *     "version": 1,
 *     "entries": [
 *       { "url": "/?lib=…#…", "savedAt": 1712812800000 },
 *       …
 *     ]
 *   }
 *
 * Everything except `loadRecents` / `saveRecents` is a pure function
 * over an in-memory `RecentsData`, so the harness can exercise it
 * without a browser.
 */

import { decodeLibraryFromUrl } from './library';

const STORAGE_KEY = 'unitor:recents';
const CURRENT_VERSION = 1;

/** Hard cap on how many URLs we keep. FIFO eviction when exceeded. */
export const MAX_RECENTS = 20;

export interface RecentEntry {
	/**
	 * The pathname + search + hash portion of a previously-live URL,
	 * exactly as `location.pathname + location.search + location.hash`
	 * would produce it. We deliberately omit the origin so a recents
	 * list captured on localhost still works after deploying to
	 * gh-pages (and vice versa).
	 */
	url: string;
	/** `Date.now()` at save time, in ms since epoch. */
	savedAt: number;
}

export interface RecentsData {
	version: typeof CURRENT_VERSION;
	entries: RecentEntry[];
}

export function emptyRecents(): RecentsData {
	return { version: CURRENT_VERSION, entries: [] };
}

/**
 * Load the recents list from localStorage. Returns an empty list on
 * any failure mode: missing key, unreadable storage, malformed JSON,
 * wrong schema, or unknown version. Recents is a best-effort
 * affordance; corruption shouldn't brick boot.
 */
export function loadRecents(): RecentsData {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		return emptyRecents();
	}
	if (raw === null) return emptyRecents();
	try {
		const parsed: unknown = JSON.parse(raw);
		return coerceRecents(parsed) ?? emptyRecents();
	} catch {
		return emptyRecents();
	}
}

/** Persist the recents list; swallow quota / disabled-storage errors. */
export function saveRecents(data: RecentsData): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {
		// ignore — recents is a convenience, not a correctness feature
	}
}

/**
 * Add (or update) a recent URL. Dedup semantics: if the exact URL is
 * already present, we don't add a second row; we just refresh the
 * timestamp and float it to the top. This keeps continuous editing
 * of a single document from filling the list with intermediate
 * versions that evict older, genuinely-distinct sessions.
 *
 * The returned list is always sorted newest-first and capped at
 * `MAX_RECENTS`; older entries at the tail are evicted.
 */
export function addRecent(
	data: RecentsData,
	url: string,
	savedAt: number
): RecentsData {
	const trimmed = url.trim();
	if (trimmed.length === 0) return data;
	const rest = data.entries.filter((e) => e.url !== trimmed);
	const entries = [{ url: trimmed, savedAt }, ...rest].slice(0, MAX_RECENTS);
	return { ...data, entries };
}

/** Remove all recents. Returned value is the fresh empty list. */
export function clearRecents(): RecentsData {
	return emptyRecents();
}

/**
 * Produce a short human label for a recent URL. Priority:
 *  1. The first `# label` line in the source — matches the way a
 *     teacher or student is already annotating their work.
 *  2. Otherwise the first non-empty source line, truncated.
 *  3. Otherwise a library-size hint like "5 factors" if the URL has
 *     only a library and no source.
 *  4. Otherwise "(empty calculator)" for the fully-empty sentinel case.
 *
 * Parses the URL relative to a fake origin so this works on both
 * absolute and relative URL strings, and tolerates any malformed
 * input by falling back to a generic label.
 */
export function labelForUrl(url: string): string {
	let source = '';
	let libCount = 0;
	try {
		// The fake base is only used so `new URL` accepts a relative
		// "/?lib=…#…" string. The hostname it picks is discarded.
		const parsed = new URL(url, 'https://example.invalid');
		if (parsed.hash.length > 1) {
			try {
				source = decodeURIComponent(parsed.hash.slice(1));
			} catch {
				source = '';
			}
		}
		const libRaw = parsed.searchParams.get('lib');
		if (libRaw !== null) {
			const lib = decodeLibraryFromUrl(libRaw);
			if (lib) libCount = lib.entries.length;
		}
	} catch {
		return '(invalid URL)';
	}

	for (const line of source.split('\n')) {
		const t = line.trim();
		if (t.length === 0) continue;
		if (t.startsWith('#')) {
			const label = t.slice(1).trim();
			if (label.length > 0) return truncate(label);
			// `#` with no text — skip and keep looking for something else
			continue;
		}
		return truncate(t);
	}

	if (libCount > 0) {
		return libCount === 1 ? '1 factor' : `${libCount} factors`;
	}
	return '(empty calculator)';
}

/**
 * Render a timestamp as relative text ("3 minutes ago", "yesterday").
 * Fixed thresholds — good enough for a small dropdown without pulling
 * in a date library. Takes `now` explicitly so the harness can test
 * deterministically.
 */
export function relativeTime(savedAt: number, now: number): string {
	const diff = Math.max(0, now - savedAt);
	const sec = Math.floor(diff / 1000);
	if (sec < 10) return 'just now';
	if (sec < 60) return `${sec} seconds ago`;
	const min = Math.floor(sec / 60);
	if (min === 1) return '1 minute ago';
	if (min < 60) return `${min} minutes ago`;
	const hr = Math.floor(min / 60);
	if (hr === 1) return '1 hour ago';
	if (hr < 24) return `${hr} hours ago`;
	const day = Math.floor(hr / 24);
	if (day === 1) return 'yesterday';
	if (day < 7) return `${day} days ago`;
	// Beyond a week, show a date in the user's locale.
	try {
		return new Date(savedAt).toLocaleDateString();
	} catch {
		return `${day} days ago`;
	}
}

function truncate(s: string, max = 50): string {
	return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Best-effort coercion of arbitrary JSON into `RecentsData`. */
function coerceRecents(data: unknown): RecentsData | null {
	if (typeof data !== 'object' || data === null) return null;
	const obj = data as Record<string, unknown>;
	if (obj['version'] !== CURRENT_VERSION) return null;
	const rawEntries = obj['entries'];
	if (!Array.isArray(rawEntries)) return null;

	const entries: RecentEntry[] = [];
	for (const raw of rawEntries) {
		if (typeof raw !== 'object' || raw === null) continue;
		const e = raw as Record<string, unknown>;
		const url = e['url'];
		const savedAt = e['savedAt'];
		if (typeof url !== 'string' || typeof savedAt !== 'number') continue;
		entries.push({ url, savedAt });
	}
	return { version: CURRENT_VERSION, entries: entries.slice(0, MAX_RECENTS) };
}
