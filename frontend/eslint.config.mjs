import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "web-build/**", "*.config.js"]
  },
  {
    // An eslint-disable comment that no longer suppresses anything is an error.
    linterOptions: { reportUnusedDisableDirectives: "error" }
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2022,
        sourceType: "module"
      },
      globals: {
        console: "readonly", require: "readonly", module: "readonly",
        exports: "readonly", process: "readonly", __DEV__: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", Promise: "readonly", JSON: "readonly",
        Math: "readonly", Date: "readonly", Error: "readonly",
        parseInt: "readonly", parseFloat: "readonly", isNaN: "readonly",
        String: "readonly", Number: "readonly", Boolean: "readonly",
        Array: "readonly", Object: "readonly", Symbol: "readonly",
        Map: "readonly", Set: "readonly", WeakMap: "readonly",
        fetch: "readonly", FormData: "readonly", Blob: "readonly",
        btoa: "readonly", atob: "readonly", URL: "readonly",
        MediaRecorder: "readonly", alert: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react": reactPlugin,
      "react-hooks": reactHooksPlugin
    },
    settings: { react: { version: "detect" } },
    rules: {
      // React
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/display-name": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        "args": "after-used", "argsIgnorePattern": "^_",
        "vars": "all", "varsIgnorePattern": "^_",
        "caughtErrors": "all", "ignoreRestSiblings": false
      }],
      // Replaces the deprecated no-var-requires: every require() is an error
      // except static assets (fonts / images), which Metro needs as require().
      "@typescript-eslint/no-require-imports": ["error", {
        "allow": ["\\.(ttf|otf|png|jpe?g|gif|webp|svg|mp3|wav)$"]
      }],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-assertion": "error",

      // Logic safety — these can hide real bugs
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-duplicate-case": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-sparse-arrays": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-loss-of-precision": "error",
      "no-promise-executor-return": "error",
      "no-template-curly-in-string": "error",
      "no-console": ["error", { "allow": ["warn", "error"] }],

      // Turn off rules that conflict with RN / our patterns
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off"
    }
  }
];
