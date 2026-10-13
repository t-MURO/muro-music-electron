// ESLint flat config. Formatting is owned by Prettier (eslint-config-prettier
// is applied last), so this file only carries correctness/quality rules.
//
// Rules set to "warn" below have pre-existing hits that are being burned down
// gradually; promote them to "error" once their counts reach zero.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const unusedVarsOptions = {
  args: "after-used",
  argsIgnorePattern: "^_",
  varsIgnorePattern: "^_",
  destructuredArrayIgnorePattern: "^_",
  ignoreRestSiblings: true,
  // `catch (error) { ...fallback... }` without using `error` is common and
  // harmless here; don't churn those blocks just to satisfy the linter.
  caughtErrors: "none",
};

// Globals that Electron exposes to a sandboxed preload script in addition to
// the page's DOM globals (see Electron's "Process Sandboxing" docs).
const sandboxedPreloadGlobals = {
  require: "readonly",
  module: "readonly",
  exports: "writable",
  process: "readonly",
  Buffer: "readonly",
  global: "readonly",
  setImmediate: "readonly",
  clearImmediate: "readonly",
};

export default defineConfig([
  globalIgnores([
    "dist/",
    "build/",
    "release/",
    "out/",
    "coverage/",
    "docs/",
    ".claude/",
    "**/node_modules/",
  ]),

  {
    name: "muro/base",
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended],
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      "no-unused-vars": ["error", unusedVarsOptions],
    },
  },

  {
    name: "muro/typescript",
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", unusedVarsOptions],
    },
  },

  {
    name: "muro/renderer",
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      tseslint.configs.recommendedTypeCheckedOnly,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Classic hooks rules. rules-of-hooks stays an error (from the preset).
      "react-hooks/exhaustive-deps": "warn",

      // React-Compiler-oriented rules from eslint-plugin-react-hooks v6+. The
      // app doesn't use the compiler yet; these flag pre-existing patterns
      // (sync setState in effects, "latest value" refs, ...). Burn down, then
      // promote to "error".
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",

      // Only affects Vite HMR granularity in development.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true, allowCompoundComponents: true },
      ],

      // Type-aware rules with pre-existing hits. Async JSX event handlers
      // (onClick={async () => ...}) are idiomatic React, so they're exempt.
      "@typescript-eslint/no-misused-promises": [
        "warn",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/only-throw-error": "warn",
    },
  },

  {
    name: "muro/node-esm",
    files: [
      "electron/**/*.mjs",
      "packages/**/*.mjs",
      "scripts/**/*.mjs",
      "tests/**/*.mjs",
      "*.{js,mjs,ts}",
    ],
    languageOptions: {
      sourceType: "module",
      globals: globals.node,
    },
  },

  {
    name: "muro/node-cjs",
    files: [
      "electron/**/*.cjs",
      "packages/**/*.cjs",
      "scripts/**/*.cjs",
      "tests/**/*.cjs",
      "*.cjs",
    ],
    ignores: ["electron/preload.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },

  {
    name: "muro/preload",
    files: ["electron/preload.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.browser, ...sandboxedPreloadGlobals },
    },
  },

  {
    name: "muro/tests",
    files: ["tests/**/*.{mjs,cjs}"],
    rules: {
      // Best-effort cleanup in smoke/spike scripts: `try { await x.stop(); } catch {}`.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  prettier,
]);
