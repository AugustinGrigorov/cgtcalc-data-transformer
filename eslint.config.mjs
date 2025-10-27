import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";
import { defineConfig } from "eslint/config";

// Use flat config 'ignores' to skip generated files (package-lock, node_modules, coverage)
// and put per-file settings under 'overrides' for compatibility with the existing array form.
export default defineConfig([
  { ignores: ["package-lock.json", "node_modules/**", "coverage/**"] },
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.node } },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { files: ["**/*.json"], plugins: { json }, language: "json/json", extends: ["json/recommended"] },
  { files: ["**/__tests__/**", "**/*.test.js"], languageOptions: { globals: { ...globals.node, ...globals.jest } } },
]);
