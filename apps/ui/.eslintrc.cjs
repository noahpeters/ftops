module.exports = {
  root: true,
  ignorePatterns: ["vite.config.d.ts"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
    project: ["./tsconfig.eslint.json"],
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint", "react", "react-hooks"],
  extends: ["plugin:react/recommended", "plugin:react-hooks/recommended", "prettier"],
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: {
    "react/react-in-jsx-scope": "off",
    "@typescript-eslint/return-await": ["error", "always"],
  },
  overrides: [
    {
      files: ["**/*.{ts,tsx}"],
      excludedFiles: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
      // Guard against raw className strings now that StyleX is the only static styling mechanism.
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector: "JSXAttribute[name.name='className'][value.type='Literal']",
            message: "Static className strings are disallowed. Use StyleX via lib/stylex instead.",
          },
          {
            selector: "JSXAttribute[name.name='className'] > JSXExpressionContainer > Literal",
            message: "Static className strings are disallowed. Use StyleX via lib/stylex instead.",
          },
          {
            selector:
              "JSXAttribute[name.name='className'] > JSXExpressionContainer > TemplateLiteral",
            message: "Static className strings are disallowed. Use StyleX via lib/stylex instead.",
          },
        ],
      },
    },
  ],
};
