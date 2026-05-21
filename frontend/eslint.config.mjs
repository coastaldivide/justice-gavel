import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "web-build/**", "*.config.js"]
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
      "react-hooks/exhaustive-deps": "warn",

      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        "argsIgnorePattern": "^_", "varsIgnorePattern": "^_"
      }],
      "@typescript-eslint/no-var-requires": "warn",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-require-imports": "off",

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
      "no-promise-executor-return": "warn",
      "no-template-curly-in-string": "warn",
      "no-console": ["warn", { "allow": ["warn", "error"] }],

      // Turn off rules that conflict with RN / our patterns
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off"
    }
  }
];
