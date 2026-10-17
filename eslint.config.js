import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const api = './apps/api/src';
const ctx = `${api}/contexts`;

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'packages/api-client/src/schema.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // API: cưỡng chế ranh giới Core / CRM / LMS (docs/architecture.md §3)
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: 'apps/api/tsconfig.json' })],
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm/mysql-core',
              importNames: ['json'],
              message: 'Dùng `jsonb` từ platform/db/columns — json() của Drizzle trả chuỗi trên MariaDB.',
            },
          ],
        },
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: `${ctx}/crm`, from: `${ctx}/lms`, message: 'CRM không được import LMS — dùng sự kiện (docs/events.md).' },
            { target: `${ctx}/lms`, from: `${ctx}/crm`, message: 'LMS không được import CRM — dùng sự kiện (docs/events.md).' },
            { target: `${ctx}/core`, from: [`${ctx}/crm`, `${ctx}/lms`], message: 'Core không phụ thuộc CRM/LMS.' },
            {
              target: [`${ctx}/crm`, `${ctx}/lms`],
              from: `${ctx}/core`,
              except: ['./contract'],
              message: 'Chỉ được dùng core/contract.',
            },
            { target: `${api}/platform`, from: ctx, message: 'platform/ không được biết nghiệp vụ.' },
            { target: `${api}/contracts`, from: [ctx, `${api}/platform`], message: 'contracts/ chỉ chứa kiểu dữ liệu sự kiện, không phụ thuộc gì.' },
          ],
        },
      ],
    },
  },

  // Web apps + UI kit
  {
    files: ['apps/*-web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}', 'packages/api-client/**/*.ts'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Không render HTML thô — nguy cơ XSS.',
        },
      ],
    },
  },
);
