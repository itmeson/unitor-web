/**
 * Compressed URL encoding for Unitor document state.
 *
 * The previous URL format put source in the hash and library JSON in
 * `?lib=`, both percent-encoded. That works fine for small problems
 * but percent-encoding is brutally inefficient on JSON (every `"`,
 * `{`, `}`, `:` becomes a 3-byte `%xx` triplet), so a 20-factor
 * library + 20-line source could easily exceed the ~2 KB URL limit
 * imposed by Canvas, email clients, and other LMS transports.
 *
 * The compressed format concatenates source and library JSON with a
 * NUL separator (`\0`), deflates the result with pako (raw deflate,
 * no zlib/gzip header), and base64url-encodes the output. The
 * encoded string goes into a single `?d=` query parameter; the hash
 * is left empty. NUL is safe as a separator because neither UTF-8
 * source text nor JSON can contain the byte 0x00.
 *
 * On boot the app checks for `?d=` first. If absent, it falls back
 * to the legacy `?lib=` + `#source` format so old shared links keep
 * working forever. If both are absent, it's a bare URL → empty
 * calculator.
 *
 * All functions are pure and DOM-free so they run under Node for the
 * harness. pako is the only dependency.
 */

import { deflateRaw, inflateRaw } from 'pako';
import {
	LibraryData,
	decodeLibraryFromUrl,
	emptyLibrary,
	encodeLibraryForUrl,
} from './library';

/** The separator between source and library JSON in the raw payload. */
const SEP = '\0';

export interface DocumentState {
	source: string;
	library: LibraryData;
}

// ---------- base64url helpers ----------

/**
 * Encode a Uint8Array to a base64url string (RFC 4648 §5) with no
 * padding. Implemented manually to avoid relying on `btoa` (which
 * isn't available in Node < 16) or `Buffer` (which isn't available
 * in the browser).
 */
const B64URL =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64url(bytes: Uint8Array): string {
	let out = '';
	const len = bytes.length;
	for (let i = 0; i < len; i += 3) {
		const b0 = bytes[i]!;
		const b1 = i + 1 < len ? bytes[i + 1]! : 0;
		const b2 = i + 2 < len ? bytes[i + 2]! : 0;
		out += B64URL[(b0 >> 2) & 0x3f];
		out += B64URL[((b0 << 4) | (b1 >> 4)) & 0x3f];
		if (i + 1 < len) out += B64URL[((b1 << 2) | (b2 >> 6)) & 0x3f];
		if (i + 2 < len) out += B64URL[b2 & 0x3f];
	}
	return out;
}

export function fromBase64url(s: string): Uint8Array | null {
	// Build a reverse lookup on first call.
	const table = new Uint8Array(128);
	table.fill(0xff);
	for (let i = 0; i < 64; i++) table[B64URL.charCodeAt(i)] = i;

	// Ignore trailing `=` padding if present (we don't emit it, but
	// tolerate it from hand-edited URLs).
	const raw = s.replace(/=+$/, '');

	const outLen = Math.floor((raw.length * 3) / 4);
	const out = new Uint8Array(outLen);
	let j = 0;
	for (let i = 0; i < raw.length; i += 4) {
		const c0 = raw.charCodeAt(i);
		const c1 = i + 1 < raw.length ? raw.charCodeAt(i + 1) : 0;
		const c2 = i + 2 < raw.length ? raw.charCodeAt(i + 2) : 0;
		const c3 = i + 3 < raw.length ? raw.charCodeAt(i + 3) : 0;
		const b0 = c0 < 128 ? table[c0]! : 0xff;
		const b1 = c1 < 128 ? table[c1]! : 0xff;
		const b2 = c2 < 128 ? table[c2]! : 0xff;
		const b3 = c3 < 128 ? table[c3]! : 0xff;
		if (b0 === 0xff || b1 === 0xff) return null;
		out[j++] = (b0 << 2) | (b1 >> 4);
		if (i + 2 < raw.length) {
			if (b2 === 0xff) return null;
			out[j++] = ((b1 & 0xf) << 4) | (b2 >> 2);
		}
		if (i + 3 < raw.length) {
			if (b3 === 0xff) return null;
			out[j++] = ((b2 & 0x3) << 6) | b3;
		}
	}
	return out.slice(0, j);
}

// ---------- encode / decode ----------

/**
 * Encode a document state (source + library) into a compact string
 * suitable for a URL query parameter. The output is deflated +
 * base64url, so it's URL-safe without further percent-encoding.
 *
 * Returns `null` if both source and library are empty — the caller
 * should emit `?doc` instead for that case.
 */
export function encodeState(source: string, library: LibraryData): string | null {
	const libJson = library.entries.length > 0
		? encodeLibraryForUrl(library)
		: '';

	if (source.length === 0 && libJson.length === 0) return null;

	const payload = source + SEP + libJson;
	const raw = new TextEncoder().encode(payload);
	const compressed = deflateRaw(raw);
	return toBase64url(compressed);
}

/**
 * Decode a `?d=` value back into source + library. Returns `null` on
 * any failure: bad base64, corrupt deflate stream, missing separator,
 * or malformed library JSON. The caller falls back to an empty
 * calculator.
 */
export function decodeState(encoded: string): DocumentState | null {
	try {
		const bytes = fromBase64url(encoded);
		if (!bytes) return null;
		const inflated = inflateRaw(bytes);
		const payload = new TextDecoder().decode(inflated);
		const sepIdx = payload.indexOf(SEP);
		if (sepIdx === -1) return null;

		const source = payload.slice(0, sepIdx);
		const libJson = payload.slice(sepIdx + 1);

		let library: LibraryData;
		if (libJson.length === 0) {
			library = emptyLibrary();
		} else {
			library = decodeLibraryFromUrl(libJson) ?? emptyLibrary();
		}

		return { source, library };
	} catch {
		return null;
	}
}
