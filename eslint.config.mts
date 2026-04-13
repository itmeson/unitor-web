import tseslint from 'typescript-eslint';
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
					],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	...tseslint.configs.recommended,
	globalIgnores([
		"node_modules",
		"dist",
		"scripts/**",
		"esbuild.config.mjs",
		"eslint.config.mts",
	]),
);
