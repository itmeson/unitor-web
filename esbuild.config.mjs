import esbuild from "esbuild";
import process from "process";

const banner =
`/*
 * Unitor — dimensional analysis for physics students
 * Bundled by esbuild. Source: https://github.com/mbetnel/unitor-web
 */
`;

const prod = (process.argv[2] === "production");

/** @type {import("esbuild").BuildOptions} */
const buildOptions = {
	banner: { js: banner },
	entryPoints: ["src/app.ts"],
	bundle: true,
	format: "iife",
	platform: "browser",
	target: ["es2020"],
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "dist/app.js",
	minify: prod,
};

if (prod) {
	await esbuild.build(buildOptions);
	process.exit(0);
} else {
	const context = await esbuild.context(buildOptions);
	await context.watch();
	// Serve the repo root so index.html, styles.css, and dist/app.js are all reachable.
	const { host, port } = await context.serve({ servedir: ".", host: "127.0.0.1", port: 5173 });
	console.log(`\nUnitor dev server: http://${host}:${port}/\n`);
}
