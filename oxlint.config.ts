import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "vitest", "import"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
  },
  rules: {
    "typescript/no-floating-promises": [
      "error",
      {
        checkThenables: true,
        ignoreVoid: false,
      },
    ],
    "typescript/no-misused-promises": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/await-thenable": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-import-type-side-effects": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    eqeqeq: "error",
    curly: "error",
    "no-var": "error",
    "prefer-const": "error",
    "no-eval": "error",
    "no-new-func": "error",
    "no-nested-ternary": "error",
    "typescript/strict-boolean-expressions": [
      "error",
      {
        allowString: false,
        allowNumber: false,
        allowNullableObject: false,
      },
    ],
    "typescript/no-unnecessary-condition": "error",
    "typescript/only-throw-error": [
      "error",
      {
        allowThrowingAny: false,
        allowThrowingUnknown: false,
        allowRethrowing: true,
      },
    ],
    "typescript/no-deprecated": "error",
    "typescript/prefer-promise-reject-errors": [
      "error",
      {
        allowEmptyReject: false,
        allowThrowingAny: false,
        allowThrowingUnknown: false,
      },
    ],
    "typescript/return-await": ["error", "always"],
    "import/no-cycle": "error",
    "import/no-duplicates": "error",
    "typescript/consistent-type-exports": "error",
    "unicorn/prefer-node-protocol": "error",
    "typescript/restrict-plus-operands": [
      "error",
      {
        allowAny: false,
        allowBoolean: false,
        allowNullish: false,
        allowNumberAndString: false,
        allowRegExp: false,
      },
    ],
    "typescript/restrict-template-expressions": [
      "error",
      {
        allowAny: false,
        allowBoolean: false,
        allowNullish: false,
        allowNumber: false,
        allowRegExp: false,
      },
    ],
    "no-implicit-coercion": [
      "error",
      {
        boolean: true,
        number: true,
        string: true,
      },
    ],
    "no-extra-boolean-cast": "off",
    "typescript/prefer-nullish-coalescing": [
      "error",
      {
        ignoreConditionalTests: true,
        ignoreBooleanCoercion: true,
      },
    ],
    "typescript/array-type": [
      "error",
      {
        default: "array",
      },
    ],
    "typescript/method-signature-style": ["error", "property"],
    "typescript/prefer-includes": "error",
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-find": "error",
    "typescript/prefer-regexp-exec": "error",
    "typescript/ban-ts-comment": [
      "error",
      {
        "ts-ignore": true,
        "ts-nocheck": true,
        "ts-expect-error": "allow-with-description",
        minimumDescriptionLength: 10,
      },
    ],
    "no-array-constructor": "error",
    "no-empty-function": "error",
    "typescript/no-confusing-void-expression": "error",
    "typescript/no-dynamic-delete": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-invalid-void-type": "error",
    "typescript/no-mixed-enums": "error",
    "typescript/no-namespace": "error",
    "typescript/no-non-null-asserted-nullish-coalescing": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/prefer-literal-enum-member": "error",
    "typescript/prefer-reduce-type-parameter": "error",
    "typescript/prefer-return-this-type": "error",
    "typescript/related-getter-setter-pairs": "error",
    "typescript/require-await": "error",
    "typescript/promise-function-async": "error",
    "typescript/unified-signatures": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
    "typescript/adjacent-overload-signatures": "error",
    "typescript/ban-tslint-comment": "error",
    "typescript/class-literal-property-style": "error",
    "typescript/consistent-generic-constructors": "error",
    "typescript/consistent-indexed-object-style": ["error", "record"],
    "typescript/consistent-type-assertions": [
      "error",
      {
        assertionStyle: "as",
        objectLiteralTypeAssertions: "never",
        arrayLiteralTypeAssertions: "never",
      },
    ],
    "typescript/consistent-type-definitions": ["error", "interface"],
    "typescript/dot-notation": "error",
    "typescript/no-inferrable-types": "error",
    "typescript/prefer-for-of": "error",
    "typescript/prefer-function-type": "error",
    "typescript/prefer-string-starts-ends-with": "error",
    "typescript/prefer-readonly": "error",
    "typescript/explicit-module-boundary-types": "error",
    "max-lines": ["error", { max: 500 }],
    "max-lines-per-function": ["error", { max: 80 }],
  },
  ignorePatterns: ["node_modules/**", ".artifacts/**"],
  overrides: [
    {
      files: ["packages/**/*.ts", "templates/**/*.ts"],
      rules: {
        "no-console": "error",
      },
    },
    {
      files: ["packages/**/src/**", "templates/**/src/**"],
      rules: {
        "no-restricted-properties": [
          "error",
          {
            object: "JSON",
            property: "parse",
            message: "Parse boundary data through parseRecord in the package's records.ts module.",
          },
        ],
      },
    },
    {
      files: ["packages/**/src/**/records.ts", "templates/**/src/**/records.ts"],
      rules: {
        "no-restricted-properties": "off",
      },
    },
    {
      files: ["packages/plan/src/**"],
      rules: {
        "no-restricted-properties": "off",
      },
    },
    {
      files: ["**/tests/**", "**/*.test.mts"],
      rules: {
        "max-lines": "off",
        "max-lines-per-function": "off",
        "vitest/no-standalone-expect": [
          "error",
          { additionalTestBlockFunctions: ["test", "test.for"] },
        ],
      },
    },
    {
      files: ["packages/plan/**", "scripts/**"],
      rules: {
        "max-lines": "off",
        "max-lines-per-function": "off",
      },
    },
  ],
  options: {
    typeAware: true,
  },
});
