import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**']
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      curly: 'error'
    }
  },
  {
    // The vscode stub deliberately types host objects loosely.
    files: ['src/test/vscode.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
