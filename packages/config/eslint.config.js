import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared flat config. Type-aware rules require each package to pass its tsconfig root. */
export function createConfig(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'drizzle/**', '*.config.*'] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir } },
      rules: {
        'no-console': 'error',
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='localStorage']",
            message: 'No browser storage for auth or secrets (ADR-0001).',
          },
        ],
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
  );
}
