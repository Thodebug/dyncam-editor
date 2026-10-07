import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'assets/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'error',
      'object-shorthand': 'error',
    },
  },
];
