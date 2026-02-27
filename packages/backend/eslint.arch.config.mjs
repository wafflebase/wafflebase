// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['src/*/*.controller'],
              message:
                'Do not import controllers via absolute module paths. Use services/providers.',
            },
            {
              group: ['src/*/*.module'],
              message:
                'Do not import Nest modules via absolute module paths. Wire modules in decorators.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/database/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'src/auth/*',
            'src/user/*',
            'src/document/*',
            'src/datasource/*',
            'src/share-link/*',
          ],
        },
      ],
    },
  },
  {
    files: ['src/auth/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['src/document/*', 'src/datasource/*', 'src/share-link/*'],
        },
      ],
    },
  },
  {
    files: ['src/user/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'src/auth/*',
            'src/document/*',
            'src/datasource/*',
            'src/share-link/*',
          ],
        },
      ],
    },
  },
);
