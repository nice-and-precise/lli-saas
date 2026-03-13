const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["coverage/**", "dist/**", "build/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.js", "vitest.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.es2024,
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "off",
    },
  },
];
