# Unitor web app — notes for future agents

## What this is
A small static web app (TypeScript + esbuild, no framework) that renders
dimensional-analysis chains as factor cards with color-matched unit
cancellation. Shipped as `index.html` + `styles.css` + `dist/app.js`. No
backend.

Start by reading, in order:
1. `README.md` — user-facing overview and input syntax
2. `CONTEXT.md` — core data flow, cancellation model, key types
3. `TODO.md` — current backlog and design discussions for future features

## Environment & tooling
- Node.js 16 or newer; npm.
- Bundler: esbuild, configured in `esbuild.config.mjs` (dev server + prod
  bundle).
- TypeScript with `strict` and `noUncheckedIndexedAccess`; targets ES2020
  with DOM libs.
- Linter: flat-config ESLint (`eslint.config.mts`).

### Scripts
- `npm run dev` — esbuild watch + static server on `127.0.0.1:5173`.
- `npm run build` — typecheck then produce `dist/app.js` for release.
- `npm run typecheck` — tsc --noEmit.
- `npm run test` — bundles `src/harness.ts` and runs it under node.
- `npm run lint` — ESLint over the repo.

## File & folder conventions
- `src/app.ts` is the DOM entry point: persistence, share link, flip
  wiring. Keep DOM-touching code contained to `app.ts` and `render.ts`.
- `src/render.ts` is the only other file that touches the DOM. It is a
  pure function of the source string; no global state.
- `src/parser.ts`, `src/compute.ts`, `src/format.ts`, `src/expression.ts`
  are the pure core. They must continue to import nothing from the DOM
  or browser runtime so the test harness can run them under node.
- `src/harness.ts` is the test harness. Add cases here when you change
  parser / compute / format / expression behavior.
- `dist/` is build output. Do not commit.
- `scripts/run-harness.mjs` bundles and runs the harness.

## Coding conventions
- Tabs, single quotes, trailing semicolons (match existing files).
- No dependencies beyond dev tooling. Adding a runtime dependency is a
  design decision worth raising first.
- When editing pure-core files, prefer adding a harness case over
  launching the dev server.
- Comments explain intent ("why"), not mechanics.

## Agent do / don't
**Do**
- Read `CONTEXT.md` before making architectural changes.
- Keep the pure-core / render / app layering intact.
- Add harness coverage when changing parser/compute/format semantics.
- Update `TODO.md` when a listed item is finished.

**Don't**
- Pull in a frontend framework (React, Vue, etc.).
- Add a backend or server-side code.
- Commit `dist/` or `node_modules/`.
- Re-introduce Obsidian-specific imports or build steps — the Obsidian
  plugin is a separate artifact and is not maintained from this repo.
