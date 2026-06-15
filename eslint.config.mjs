import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    },
  },
  {
    ignores: ["node_modules/", ".next/", "dist/", "agent/", ".dynamodb-backups/", "*.js", "*.mjs"],
  },
];
