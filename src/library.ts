/**
 * Stored conversion-factor library — a small, pure store that keeps a
 * list of `{ label, source }` entries. Entries are plain text: the
 * source string is whatever the user would type as a factor line in
 * the textarea (`1609 meters / 1 mile`, `60 s / 1 min`, …). The
 * palette renders them and inserts them back into the document; the
 * parser never looks at the library directly.
 *
 * The store is pure: no DOM, no globals besides `localStorage` which
 * is guarded. That keeps it easy to unit-test under node via the
 * harness, and means the same module can later back a UI prompt, a
 * URL-embedded library, or a future server sync.
 *
 * On-disk shape:
 *
 *   {
 *     "version": 1,
 *     "entries": [
 *       { "label": "mile to meter", "source": "1609 meters / 1 mile" },
 *       …
 *     ]
 *   }
 *
 * `version` lets future schema migrations be additive. Readers that
 * encounter a newer version fall back to an empty library rather than
 * crashing.
 */

const STORAGE_KEY = 'unitor:library';
const CURRENT_VERSION = 1;

export interface LibraryEntry {
	/** Short human name shown in the palette (also used as the `#label` when inserted). */
	label: string;
	/** The factor source text, exactly as it would appear in the textarea. */
	source: string;
}

export interface LibraryData {
	version: typeof CURRENT_VERSION;
	entries: LibraryEntry[];
}

/** A fresh, empty library. */
export function emptyLibrary(): LibraryData {
	return { version: CURRENT_VERSION, entries: [] };
}

/**
 * Load the library from localStorage. Returns an empty library on any
 * of: missing key, unreadable storage, malformed JSON, wrong schema,
 * or a future version we don't recognize. This keeps boot resilient.
 */
export function loadLibrary(): LibraryData {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		return emptyLibrary();
	}
	if (raw === null) return emptyLibrary();
	try {
		const parsed: unknown = JSON.parse(raw);
		return coerceLibrary(parsed) ?? emptyLibrary();
	} catch {
		return emptyLibrary();
	}
}

/**
 * Persist the library to localStorage. Swallows quota / disabled-
 * storage / private-mode errors; a missed write is non-fatal because
 * the in-memory state still drives the current session.
 */
export function saveLibrary(data: LibraryData): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {
		// ignore — private mode, quota, or disabled storage
	}
}

/**
 * Return a new library with `entry` prepended so the most recently
 * added item is always first in the list. Duplicates are allowed: if
 * a student saves the same factor twice they see two palette rows and
 * can delete whichever they want. Duplicate suppression at save time
 * would silently swallow a click that looks like it did nothing.
 */
export function addEntry(lib: LibraryData, entry: LibraryEntry): LibraryData {
	const cleaned: LibraryEntry = {
		label: entry.label.trim(),
		source: entry.source.trim(),
	};
	return { ...lib, entries: [cleaned, ...lib.entries] };
}

/** Return a new library with the entry at `index` removed. Out-of-range indices are ignored. */
export function removeEntry(lib: LibraryData, index: number): LibraryData {
	if (index < 0 || index >= lib.entries.length) return lib;
	const entries = lib.entries.slice();
	entries.splice(index, 1);
	return { ...lib, entries };
}

/**
 * Does the library already contain an entry with this exact (label,
 * source) pair? Used by the star button on factor cards to decide
 * between the filled / empty glyph. Trims both sides so trivial
 * whitespace differences don't register as distinct.
 */
export function hasEntry(
	lib: LibraryData,
	label: string,
	source: string
): boolean {
	const l = label.trim();
	const s = source.trim();
	return lib.entries.some((e) => e.label === l && e.source === s);
}

/**
 * Remove the first entry whose (label, source) matches. Used by the
 * star button when a student un-saves an already-saved card. Returns
 * the library unchanged if no match is found.
 */
export function removeMatching(
	lib: LibraryData,
	label: string,
	source: string
): LibraryData {
	const l = label.trim();
	const s = source.trim();
	const idx = lib.entries.findIndex((e) => e.label === l && e.source === s);
	if (idx === -1) return lib;
	return removeEntry(lib, idx);
}

/**
 * Serialize the library to a pretty-printed JSON string, ready to hand
 * to a download link. Two-space indentation keeps the file readable if
 * a teacher wants to sanity-check it in a text editor, without
 * blowing up the file size for a classroom-sized library.
 */
export function exportLibrary(lib: LibraryData): string {
	return JSON.stringify(lib, null, 2);
}

/**
 * Serialize the library for embedding in a URL query parameter.
 * Compact (no indentation) since every extra byte lands in the URL;
 * the caller is responsible for percent-encoding the result when it
 * composes the final URL (URLSearchParams handles this automatically).
 */
export function encodeLibraryForUrl(lib: LibraryData): string {
	return JSON.stringify(lib);
}

/**
 * Parse a library that was embedded in a URL query parameter. Returns
 * `null` on malformed JSON, wrong schema, or unknown version, so the
 * caller can fall back to an empty library without crashing boot.
 * This is deliberately non-throwing: a broken URL shouldn't brick the
 * page, and the caller already has a good default.
 */
export function decodeLibraryFromUrl(raw: string): LibraryData | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		return coerceLibrary(parsed);
	} catch {
		return null;
	}
}

export interface ImportSummary {
	library: LibraryData;
	/** Entries whose (label, source) was genuinely new and got added. */
	added: number;
	/** Entries skipped because an identical (label, source) already existed. */
	skipped: number;
}

/**
 * Parse a JSON string as a library and merge its entries into `lib`.
 *
 * Merge semantics:
 *  - Each incoming entry is checked against the existing library by
 *    exact (label, source) match. Matches are skipped, so re-importing
 *    a file the student already had is idempotent.
 *  - Non-matches are prepended in their incoming order. The net effect
 *    is that a freshly-imported set sits at the top of the palette and
 *    the student's existing entries survive underneath.
 *
 * Throws on malformed JSON, schema mismatch, or an unknown version, so
 * the caller can surface a user-visible error.
 */
export function importLibrary(lib: LibraryData, json: string): ImportSummary {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`Not valid JSON: ${msg}`);
	}
	const incoming = coerceLibrary(parsed);
	if (!incoming) {
		throw new Error(
			'Not a Unitor library file (expected {"version":1,"entries":[…]}).'
		);
	}

	let added = 0;
	let skipped = 0;
	// Build the new entry list in order: new-and-unique incoming first,
	// then existing entries. Incoming order is preserved within the new
	// block so the exporter's top-of-list factors stay on top.
	const newEntries: LibraryEntry[] = [];
	for (const entry of incoming.entries) {
		if (hasEntry(lib, entry.label, entry.source)) {
			skipped++;
			continue;
		}
		newEntries.push({
			label: entry.label.trim(),
			source: entry.source.trim(),
		});
		added++;
	}

	return {
		library: { ...lib, entries: [...newEntries, ...lib.entries] },
		added,
		skipped,
	};
}

/**
 * Best-effort parser for arbitrary JSON into a `LibraryData`. Returns
 * `null` on schema mismatch or unknown version. We accept unknown
 * extra fields on both the top level and on individual entries so a
 * forward-extended library (e.g. one with a future `notes` field on
 * entries) still imports its known fields cleanly.
 */
function coerceLibrary(data: unknown): LibraryData | null {
	if (typeof data !== 'object' || data === null) return null;
	const obj = data as Record<string, unknown>;
	if (obj['version'] !== CURRENT_VERSION) return null;
	const rawEntries = obj['entries'];
	if (!Array.isArray(rawEntries)) return null;

	const entries: LibraryEntry[] = [];
	for (const raw of rawEntries) {
		if (typeof raw !== 'object' || raw === null) return null;
		const e = raw as Record<string, unknown>;
		const label = e['label'];
		const source = e['source'];
		if (typeof label !== 'string' || typeof source !== 'string') return null;
		entries.push({ label, source });
	}

	return { version: CURRENT_VERSION, entries };
}
