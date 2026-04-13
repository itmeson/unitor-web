/**
 * Build + run the sanity harness.
 *
 * Bundles src/harness.ts to dist/harness.cjs (node target, no inlined
 * browser shims) and executes it. Exits with the harness's exit code
 * so `npm test` passes/fails correctly in CI.
 */

import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const outfile = resolve(repoRoot, 'dist', 'harness.cjs');

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
	entryPoints: [resolve(repoRoot, 'src', 'harness.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: ['node16'],
	sourcemap: 'inline',
	logLevel: 'info',
	outfile,
});

const result = spawnSync(process.execPath, [outfile], {
	stdio: 'inherit',
	cwd: repoRoot,
});

process.exit(result.status ?? 1);
